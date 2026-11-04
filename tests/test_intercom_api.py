"""WHO MAY USE THE INTERCOM AND ITS SETTINGS (docs/phase17/INTERCOM.md "Permissions, audit, API and storage"; intercom/routes.py,
the gateway's ``intercom`` command, authz.decide_intercom), over a full app with a fake Music Assistant
(tests/intercom_fakes.py; no sound is made anywhere).

* The gateway command ``intercom`` by role: Owner, Admin, Adult and a wall tablet get a ticket; a Child and a Guest do
  not (an Owner may grant them), and a Child with a grant reaches only the rooms its areas allow; an explicit deny on
  a speaker wins; the Intercom's grants for tablets are for the Intercom only.
* The REST routes: Settings -> Intercom is the Owner's and Admin's, never a wall tablet's session, a fresh sign-in
  away from home, the CSRF header, and the audit row first (no row, no change). The settings round trip and every
  refusal of a bad value (400); one room's settings and Try Live Again; Check Reach against the fake Music
  Assistant; Send Test; the listener tablets' clip.
* The ``intercom/subscribe`` feed on the hub socket: forbidden without the feature, cut down by RBAC, pushed again
  after a save, and the ``play`` a listener tablet is told.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest

import intercom_fakes as IF
from hk_core.intercom import config as C
from intercom_fakes import (CODY, DEN, KITCHEN, RATE, chunks, closed, recv, recv_until, send_audio, until)
from mantel_server.intercom import routes as RT
from mantel_server.intercom.spool import wav_header
from mantel_server.rbac import Grant

ic = IF.fixture(commands=True)

SETTINGS = "/api/intercom/settings"
ROOM = f"/api/intercom/rooms/{KITCHEN}"
CHECK = "/api/intercom/check"
TEST = "/api/intercom/test"
MANAGER_CALLS = [("GET", SETTINGS, None), ("PUT", SETTINGS, {"max_message_s": 20}), ("PUT", ROOM, {"volume": 10}),
                 ("POST", CHECK, None)]


def config_rows(env, prefix="intercom."):
    return [r for r in env.audit(kind="config") if r["action"].startswith(prefix)]


def stored(env):
    return env.app["settings"].store.body("house", "intercom")


def child_grant(env, uid, areas=("kitchen",)):
    """What an Owner does to let a Child use the Intercom: an allow grant for the feature and the Child's areas."""
    env.app["rbac"].add_grant(Grant(effect="allow", actions=("view", "control"), resource_kind="feature",
                                    resource="intercom", users={uid}))
    env.app["rbac"].set_scopes("user", uid, list(areas))


async def broadcast(env, actor, rooms, parts=None):
    ws = await actor.talk()
    await send_audio(ws, parts or chunks(10))
    await ws.send_json({"type": "send", "rooms": list(rooms)})
    return ws


# -------------------------------------------------------------------- the gateway command, by role
@pytest.mark.parametrize("name,role", [("avery", "owner"), ("alex", "admin"), ("jordan", "adult")])
async def test_an_owner_an_admin_and_an_adult_get_a_ticket(ic, name, role):
    person = await ic.actor(name, role)
    reply = await person.ticket(await person.hub())
    assert reply["type"] == "command_result" and len(reply["result"]["ticket"]) >= 43
    (row,) = ic.audit()
    assert (row["kind"], row["action"], row["decision"], row["role"], row["door"]) == (
        "ma", "intercom.open", "allowed", role, "lan")


@pytest.mark.parametrize("name,role", [("cody", "child"), ("gwen", "guest")])
async def test_a_child_and_a_guest_get_no_ticket_and_the_refusal_is_audited(ic, name, role):
    person = await ic.actor(name, role)
    reply = await person.ticket(await person.hub())
    assert reply["error"]["code"] == "forbidden" and reply["error"]["reason"] == "no_grant"
    assert reply["error"]["target"] == "feature:intercom" and "result" not in reply
    (row,) = ic.audit()
    assert (row["decision"], row["reason"], row["result"], row["action"]) == ("denied", "no_grant", "not_sent",
                                                                             "intercom.open")
    assert ic.relay.tickets == {}


async def test_a_wall_tablet_gets_a_ticket_and_reaches_every_enabled_room(ic):
    tablet = await ic.tablet("Hall tablet", "den")
    ws = await tablet.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN, CODY]})
    events = await recv_until(ws, "sent")
    assert [r["room"] for r in events[0]["rooms"]] == [KITCHEN, DEN, CODY]      # not only its own room's speaker
    assert sorted(c["args"]["player_id"] for c in ic.ma.announced()) == ["ma-cody", "ma-den", "ma-kitchen"]
    (play,) = ic.play_rows()
    assert play["device"] == tablet.device_id and play["device_role"] == "wall_tablet"


async def test_the_intercoms_grants_for_a_tablet_are_for_the_intercom_only(ic):
    """A tablet may speak into any enabled room; its music is still its own room's."""
    tablet = await ic.tablet("Hall tablet", "den")
    hub = await tablet.hub()
    mine = await tablet.command(hub, kind="service", domain="media_player", service="volume_set",
                                target={"entity_id": DEN}, data={"volume_level": 0.5})
    assert "error" not in mine or mine["error"]["code"] != "forbidden", mine         # its own room's speaker
    other = await tablet.command(hub, id=2, kind="service", domain="media_player", service="volume_set",
                                 target={"entity_id": KITCHEN}, data={"volume_level": 0.5})
    assert other["error"]["code"] == "forbidden" and other["error"]["reason"] == "no_grant"
    raw = await tablet.command(hub, id=3, kind="ma", command="players/cmd/play_announcement",
                               args={"player_id": "ma-kitchen", "url": "http://127.0.0.1:1/x.wav"})
    assert raw["error"]["code"] == "forbidden"                                        # and no raw announcement
    assert ic.ma.announced() == []


async def test_a_page_cannot_send_a_raw_announcement_without_settings_rights(ic):
    jordan = await ic.actor("jordan", "adult")
    hub = await jordan.hub()
    reply = await jordan.command(hub, kind="ma", command="players/cmd/play_announcement",
                                 args={"player_id": "ma-kitchen", "url": "http://127.0.0.1:1/x.wav"})
    assert reply["error"]["code"] == "forbidden"
    assert ic.ma.announced() == []


async def test_a_child_with_a_grant_reaches_only_the_rooms_its_areas_allow(ic):
    cody = await ic.actor("cody", "child")
    child_grant(ic, cody.uid, ("kitchen",))
    ws = await cody.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN, CODY]})
    events = await recv_until(ws, "sent")
    assert [r["room"] for r in events[0]["rooms"]] == [KITCHEN]                       # the others never appear
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-kitchen"]
    assert ic.play_rows()[0]["target"] == f'["{KITCHEN}"]'
    # a pick of rooms outside its areas is "nothing to send to", and nothing is sent
    ws = await cody.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": ["all"]})
    assert [r["room"] for r in (await recv(ws))["rooms"]] == [KITCHEN]                # (Whole House is its one room)
    await recv_until(ws, "sent")
    assert len(ic.ma.announced()) == 2


async def test_a_child_whose_areas_hold_no_intercom_room_has_nothing_to_send_to(ic):
    cody = await ic.actor("cody", "child")
    child_grant(ic, cody.uid, ("porch",))
    ws = await cody.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN]})
    assert (await recv(ws))["rooms"] == []
    assert (await recv(ws))["code"] == "no_rooms" and ic.ma.announced() == []


async def test_an_explicit_deny_on_a_speaker_wins_for_a_person(ic):
    jordan = await ic.actor("jordan", "adult")
    ic.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="entity", resource=DEN,
                                   users={jordan.uid}))
    ws = await jordan.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN]})
    events = await recv_until(ws, "sent")
    assert [r["room"] for r in events[0]["rooms"]] == [KITCHEN]
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-kitchen"]


async def test_an_explicit_deny_on_a_speaker_wins_for_a_tablet(ic):
    ic.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="entity", resource=DEN,
                                   roles={"wall_tablet"}))
    tablet = await ic.tablet()
    ws = await tablet.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN]})
    events = await recv_until(ws, "sent")
    assert [r["room"] for r in events[0]["rooms"]] == [KITCHEN]


async def test_an_owner_can_take_the_intercom_from_the_tablets_with_a_deny_grant(ic):
    ic.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="feature", resource="intercom",
                                   roles={"wall_tablet"}))
    tablet = await ic.tablet()
    reply = await tablet.ticket(await tablet.hub())
    assert reply["error"]["reason"] == "explicit_deny" and reply["error"]["target"] == "feature:intercom"


async def test_a_deny_on_the_speaker_cannot_even_be_stored_against_an_owner(ic):
    avery = await ic.actor("avery", "owner")
    with pytest.raises(ValueError, match="Owners always keep every permission"):
        ic.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="entity", resource=DEN,
                                       users={avery.uid}))
    ws = await broadcast(ic, avery, [KITCHEN, DEN])
    assert [r["room"] for r in (await recv_until(ws, "sent"))[0]["rooms"]] == [KITCHEN, DEN]


async def test_away_from_home_a_message_may_be_sent_with_the_normal_sign_in(ic):
    away = await ic.actor("sam", "owner", tunnel=True)
    hub = await away.hub()
    ic.now[0] += 360                                                                # no step-up for a command
    ws = await away.talk(hub=hub)
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN]})
    assert (await recv_until(ws, "sent"))[-1]["rooms"] == 1
    assert ic.open_rows()[0]["door"] == "tunnel" and ic.play_rows()[0]["door"] == "tunnel"


@pytest.mark.parametrize("body,code", [
    ({"mode": "loud", "rate": RATE}, "invalid_command"), ({"mode": "message", "rate": 12345}, "invalid_command"),
    ({"mode": "message", "rate": True}, "invalid_command"), ({"mode": "message"}, "invalid_command"),
    ({"mode": "message", "rate": RATE, "rooms": [KITCHEN]}, "invalid_command"), ({"rate": RATE}, "invalid_command")])
async def test_a_malformed_intercom_command_is_refused_before_a_ticket(ic, body, code):
    avery = await ic.actor("avery", "owner")
    reply = await avery.command(await avery.hub(), kind="intercom", **body)
    assert reply["error"]["code"] == code
    (row,) = ic.audit()                                                              # (a refusal is a denied row)
    assert (row["decision"], row["reason"], row["result"]) == ("denied", "invalid_command", "not_sent")
    assert ic.relay.tickets == {}


@pytest.mark.parametrize("change,why", [
    ({"enabled": False}, "intercom_off"), ({"stream_base": ""}, "intercom_no_address")])
async def test_the_command_says_why_the_intercom_cannot_open_and_writes_a_denied_row(ic, change, why):
    ic.edit(**change)
    avery = await ic.actor("avery", "owner")
    reply = await avery.ticket(await avery.hub())
    assert reply["error"]["code"] == "unavailable" and reply["error"]["message"] == why
    (row,) = ic.audit()
    assert (row["decision"], row["reason"], row["result"]) == ("denied", why, "not_sent") and ic.relay.tickets == {}


async def test_the_command_says_when_the_listener_or_music_assistant_is_not_there(ic, monkeypatch):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    await ic.host.listener.stop()
    reply = await avery.ticket(hub)
    assert reply["error"]["message"] == "intercom_not_listening"
    await ic.host.apply()                                                           # (back on)
    assert (await avery.ticket(hub, id=2))["type"] == "command_result"
    monkeypatch.setattr(type(ic.host.music), "active", property(lambda self: False))   # Music Assistant is not set up
    reply = await avery.ticket(hub, id=3)
    assert reply["error"]["message"] == "music_assistant_off"


# ---------------------------------------------------------------------------- the REST routes, by role
async def test_owner_and_admin_may_manage_the_intercom(ic):
    for name, role in (("avery", "owner"), ("alex", "admin")):
        person = await ic.actor(name, role)
        for method, path, body in MANAGER_CALLS:
            status, got = await person.call(method, path, body)
            assert status == 200, (role, method, path, got)
    assert [r["action"] for r in config_rows(ic)] == ["intercom.settings.saved", "intercom.room.saved"] * 2


@pytest.mark.parametrize("name,role", [("jordan", "adult"), ("cody", "child"), ("gwen", "guest")])
async def test_an_adult_a_child_and_a_guest_manage_nothing(ic, name, role):
    person = await ic.actor(name, role)
    before = stored(ic)
    for method, path, body in MANAGER_CALLS + [("POST", TEST, {"room": KITCHEN})]:
        status, got = await person.call(method, path, body)
        assert status == 403, (role, method, path, got)
    assert stored(ic) == before and config_rows(ic) == [] and ic.ma.announced() == [] and ic.ma.fetches == []


async def test_an_admin_does_not_send_the_test_chime_that_is_the_owners(ic):
    alex = await ic.actor("alex", "admin")
    status, got = await alex.post(TEST, {"room": KITCHEN})
    assert status == 403 and got["error"] == "owner_only"
    assert ic.ma.announced() == []


async def test_never_a_wall_tablets_session_on_the_settings_routes(ic):
    tablet = await ic.tablet()
    before = stored(ic)
    for method, path, body in MANAGER_CALLS + [("POST", TEST, {"room": KITCHEN})]:
        status, got = await tablet.call(method, path, body)
        assert status == 403 and got["error"] == "forbidden", (method, path, got)
    assert stored(ic) == before and config_rows(ic) == [] and ic.ma.announced() == []


async def test_signed_out_gets_nothing(ic):
    anon = IF.Actor(ic, "anon")
    ic.actors.append(anon)
    for method, path, body in MANAGER_CALLS + [("POST", TEST, {"room": KITCHEN}), ("GET", "/api/intercom/clip/x.wav", None)]:
        status, _ = await anon.call(method, path, body, csrf=False)
        assert status == 401, (method, path)
    assert stored(ic) is not None and config_rows(ic) == []


# ------------------------------------------------------------------- step-up, CSRF, audit first
@pytest.mark.parametrize("name,role", [("sam", "owner"), ("sue", "admin")])
async def test_away_from_home_a_change_asks_for_a_fresh_sign_in(ic, name, role):
    away = await ic.actor(name, role, tunnel=True)
    ic.now[0] += 360                                                                # the sign-in factor is no longer fresh
    before = stored(ic)
    status, got = await away.get(SETTINGS)
    assert status == 200                                                            # reading needs no step-up
    calls = [c for c in MANAGER_CALLS if c[0] != "GET"] + ([("POST", TEST, {"room": KITCHEN})] if role == "owner" else [])
    for method, path, body in calls:
        status, got = await away.call(method, path, body)
        assert status == 403 and got["error"] == "step_up_required", (role, method, path, got)
    assert stored(ic) == before and config_rows(ic) == [] and ic.ma.announced() == [] and ic.ma.fetches == []
    ic.app["store"].db.execute("UPDATE sessions SET fresh_factor_at = ?", (ic.now[0],))
    status, got = await away.put(SETTINGS, {"max_message_s": 20})
    assert status == 200 and got["settings"]["max_message_s"] == 20


async def test_on_the_home_network_no_step_up_is_asked(ic):
    avery = await ic.actor("avery", "owner")
    ic.now[0] += 3600
    assert (await avery.put(SETTINGS, {"max_message_s": 20}))[0] == 200


async def test_a_change_without_the_csrf_header_is_refused(ic):
    avery = await ic.actor("avery", "owner")
    before = stored(ic)
    for method, path, body in MANAGER_CALLS[1:]:
        status, got = await avery.call(method, path, body, csrf=False)
        assert status == 403, (method, path, got)
        status, _ = await avery.call(method, path, body, csrf=False, tunnel=False)
    wrong = await avery.http.put(SETTINGS, json={"max_message_s": 20}, headers={"X-CSRF-Token": "wrong"})
    assert wrong.status == 403
    assert stored(ic) == before and config_rows(ic) == []


async def test_no_audit_row_no_change(ic, monkeypatch):
    avery = await ic.actor("avery", "owner")
    before = stored(ic)

    def broken(event):
        raise sqlite3.OperationalError("database or disk is full")
    monkeypatch.setattr(ic.app["audit"], "config_event", broken)
    for method, path, body in (("PUT", SETTINGS, {"max_message_s": 20}), ("PUT", ROOM, {"enabled": False}),
                               ("PUT", ROOM, {"reset_live": True}), ("POST", TEST, {"room": KITCHEN})):
        status, got = await avery.call(method, path, body)
        assert status == 503 and got == {"error": "audit_unavailable"}, (method, path, status, got)
    assert stored(ic) == before and ic.ma.announced() == [] and ic.ma.fetches == []
    assert await ic.host.apply() is None and ic.host.listener.running            # and the listener was left alone


# ----------------------------------------------------------------------------- settings, round trip
async def test_get_settings_gives_the_page_everything_it_draws(ic):
    avery = await ic.actor("avery", "owner")
    tablet = await ic.tablet("Hall tablet", "den")
    status, got = await avery.get(SETTINGS)
    assert status == 200 and set(got) - {"ok"} == {"settings", "rooms", "tablets", "suggested_base", "stream_port",
                                                   "listening", "ma"}
    assert got["settings"] == ic.host.doc() and got["settings"]["enabled"] is True
    assert got["stream_port"] == ic.port and got["listening"] is True and got["ma"] is True
    assert got["suggested_base"] == ic.base                                        # the address this browser used
    assert {r["room"]: (r["name"], r["ma"], r["live_fails"], r["demoted"]) for r in got["rooms"]} == {
        KITCHEN: ("Kitchen", True, 0, False), DEN: ("Den", True, 0, False), CODY: ("Cody's Room", True, 0, False)}
    assert {r["floor"] for r in got["rooms"]} <= {"Main Floor", "Upstairs", None}
    assert got["tablets"] == [{"id": tablet.device_id, "name": "Hall tablet", "room": "den"}]


async def test_get_settings_lists_only_wall_tablets_that_are_not_revoked(ic):
    avery = await ic.actor("avery", "owner")
    _kept, gone = await ic.tablet("Hall tablet", "den"), await ic.tablet("Old tablet", "kitchen")
    ic.app["devices"].revoke(gone.device_id, "test")
    got = (await avery.get(SETTINGS))[1]
    assert [t["name"] for t in got["tablets"]] == ["Hall tablet"]


def test_the_suggested_address_is_only_ever_a_private_one(monkeypatch):
    monkeypatch.setattr(C, "base_problem", IF.REAL_BASE_PROBLEM)
    req = lambda host: SimpleNamespace(host=host)  # noqa: E731
    assert RT._suggested_base(req("10.0.0.5:8765"), 8767) == "http://10.0.0.5:8767"
    assert RT._suggested_base(req("mantel.local:8765"), 8767) == "http://mantel.local:8767"
    assert RT._suggested_base(req("mantel.local"), 8767) == "http://mantel.local:8767"
    for host in ("mantel.example.com", "203.0.113.7:8765", "127.0.0.1:8765", "localhost:8765", ""):
        assert RT._suggested_base(req(host), 8767) is None, host
    assert RT._suggested_base(req("10.0.0.5:8765"), 0) is None                     # no listener port: no suggestion


async def test_put_settings_round_trips_and_is_audited(ic):
    avery = await ic.actor("avery", "owner")
    status, got = await avery.put(SETTINGS, {"max_message_s": 20, "max_live_s": 90, "max_volume": 55,
                                             "chime": {"live": True}, "default_mode": "message",
                                             "quiet_default": {"schedule": True, "from": "20:30", "to": "06:00"}})
    assert status == 200
    s = got["settings"]
    assert (s["max_message_s"], s["max_live_s"], s["max_volume"]) == (20, 90, 55)
    assert s["chime"] == {"message": True, "live": True}                            # a half chime keeps its other half
    assert s["quiet_default"] == {"schedule": True, "from": "20:30", "to": "06:00", "while": []}
    assert s["rooms"] == ic.host.doc()["rooms"] and s["enabled"] is True and s["stream_base"] == ic.base
    assert (await avery.get(SETTINGS))[1]["settings"] == s
    assert stored(ic)["max_message_s"] == 20
    (row,) = config_rows(ic)
    assert row["action"] == "intercom.settings.saved" and row["role"] == "owner" and row["door"] == "lan"
    assert json.loads(row["target"]) == {"max_message_s": 20, "max_live_s": 90, "max_volume": 55,
                                         "chime": {"live": True}, "default_mode": "message",
                                         "quiet_default": {"schedule": True, "from": "20:30", "to": "06:00"}}
    # a change reaches the next socket: its limit is the one saved
    ws = await avery.talk()
    assert ws.ok["max_s"] == 20


async def test_a_live_default_waits_for_live_to_be_allowed(ic):
    avery = await ic.actor("avery", "owner")
    status, got = await avery.put(SETTINGS, {"default_mode": "live"})
    assert status == 200 and got["settings"]["default_mode"] == "message"          # (check(): no Live default without Live)
    status, got = await avery.put(SETTINGS, {"live_allowed": True, "default_mode": "live"})
    assert got["settings"]["default_mode"] == "live" and got["settings"]["live_allowed"] is True


@pytest.mark.parametrize("body", [
    {}, {"nope": 1}, {"rooms": {}}, {"enabled": "yes"}, {"live_allowed": 1}, {"default_mode": "loud"},
    {"max_live_s": 14}, {"max_live_s": 121}, {"max_live_s": "60"}, {"max_live_s": True}, {"max_live_s": 60.5},
    {"max_message_s": 9}, {"max_message_s": 61}, {"max_volume": 0}, {"max_volume": 101}, {"chime": "on"},
    {"chime": {"message": "yes"}}, {"quiet_default": "night"},
    {"stream_base": "https://mantel.example.com:8767"}, {"stream_base": "http://203.0.113.7:8767"},
    {"stream_base": "http://10.0.0.5"}, {"stream_base": "http://10.0.0.5:8767/path"}, {"stream_base": "ftp://10.0.0.5:8767"},
    {"stream_base": "http://user:pw@10.0.0.5:8767"}, {"stream_base": "http://localhost:8767"}, {"stream_base": 7},
    {"lag_ms": 4000}, {"lag_ms": None}])
async def test_a_bad_setting_is_a_400_with_words_and_nothing_is_saved(ic, body):
    avery = await ic.actor("avery", "owner")
    before = stored(ic)
    status, got = await avery.put(SETTINGS, body)
    assert status == 400 and got["error"] == "invalid" and got["message"], (body, status, got)
    assert stored(ic) == before and config_rows(ic) == []


@pytest.mark.parametrize("path", [SETTINGS, ROOM])
@pytest.mark.parametrize("body,status", [([], 400), ("text", 400), (None, 415)])
async def test_a_body_that_is_not_a_json_object_is_refused(ic, path, body, status):
    avery = await ic.actor("avery", "owner")
    before = stored(ic)
    got_status, got = await avery.put(path, body)
    assert got_status == status, got
    assert stored(ic) == before and config_rows(ic) == []


async def test_lag_ms_is_the_proofs_measurement_not_a_setting(ic):
    avery = await ic.actor("avery", "owner")
    status, got = await avery.put(SETTINGS, {"lag_ms": 4000})
    assert status == 400 and "proof" in got["message"]
    assert ic.host.doc()["lag_ms"] is None


async def test_the_listener_follows_the_intercom_switch_and_the_address(ic):
    avery = await ic.actor("avery", "owner")
    assert ic.host.listener.running
    status, got = await avery.put(SETTINGS, {"enabled": False})
    assert status == 200 and got["settings"]["enabled"] is False
    assert ic.host.listener is None                                                 # closed with the switch
    assert (await avery.ticket(await avery.hub()))["error"]["message"] == "intercom_off"
    status, got = await avery.put(SETTINGS, {"enabled": True})
    assert status == 200 and ic.host.listener is not None and ic.host.listener.running
    status, got = await avery.put(SETTINGS, {"stream_base": ""})
    assert status == 200 and got["settings"]["stream_base"] == ""
    reply = await avery.ticket(await avery.hub(), id=4)
    assert reply["error"]["message"] == "intercom_no_address"


# ---------------------------------------------------------------------------------- one room's settings
async def test_put_room_saves_one_room_and_the_page_gets_the_whole_document(ic):
    avery = await ic.actor("avery", "owner")
    status, got = await avery.put(ROOM, {"enabled": False, "live": False, "volume": 30,
                                         "quiet": {"schedule": True, "from": "20:00", "to": "06:00", "while": []},
                                         "listeners": ["tablet-a", "tablet-a", "tablet-b"]})
    assert status == 200
    room = got["settings"]["rooms"][KITCHEN]
    assert room["enabled"] is False and room["live"] is False and room["volume"] == 30
    assert room["quiet"] == {"schedule": True, "from": "20:00", "to": "06:00", "while": []}
    assert room["listeners"] == ["tablet-a", "tablet-b"]
    assert got["settings"]["rooms"][DEN] == ic.host.doc()["rooms"][DEN]             # the others are untouched
    (row,) = config_rows(ic)
    assert row["action"] == "intercom.room.saved"
    assert json.loads(row["target"])["room"] == KITCHEN and json.loads(row["target"])["volume"] == 30
    status, got = await avery.put(ROOM, {"volume": None, "quiet": None})
    assert got["settings"]["rooms"][KITCHEN]["volume"] is None and got["settings"]["rooms"][KITCHEN]["quiet"] is None


async def test_a_room_turned_off_is_gone_from_the_next_broadcast(ic):
    avery = await ic.actor("avery", "owner")
    await avery.put(ROOM, {"enabled": False})
    ws = await broadcast(ic, avery, [KITCHEN, DEN])
    events = await recv_until(ws, "sent")
    assert [r["room"] for r in events[0]["rooms"]] == [DEN]


async def test_try_live_again_resets_the_rooms_live_health_under_its_own_audit_action(ic):
    avery = await ic.actor("avery", "owner")
    ic.edit(rooms={**ic.doc()["rooms"], KITCHEN: {**ic.doc()["rooms"][KITCHEN], "live_fails": 3, "demoted": True}})
    got = (await avery.get(SETTINGS))[1]
    assert [(r["live_fails"], r["demoted"]) for r in got["rooms"] if r["room"] == KITCHEN] == [(3, True)]
    status, got = await avery.put(ROOM, {"reset_live": True})
    assert status == 200
    assert (got["settings"]["rooms"][KITCHEN]["live_fails"], got["settings"]["rooms"][KITCHEN]["demoted"]) == (0, False)
    (row,) = config_rows(ic)
    assert row["action"] == "intercom.live.reset" and json.loads(row["target"]) == {"room": KITCHEN, "reset_live": True}
    assert [(r["live_fails"], r["demoted"]) for r in (await avery.get(SETTINGS))[1]["rooms"] if r["room"] == KITCHEN] \
        == [(0, False)]


async def test_a_reset_with_other_changes_is_a_room_save(ic):
    avery = await ic.actor("avery", "owner")
    await avery.put(ROOM, {"reset_live": True, "volume": 12})
    assert [r["action"] for r in config_rows(ic)] == ["intercom.room.saved"]


@pytest.mark.parametrize("body", [
    {}, {"nope": 1}, {"live_fails": 0}, {"demoted": False}, {"enabled": "yes"}, {"volume": 101}, {"volume": -1},
    {"volume": "loud"}, {"quiet": "night"}, {"listeners": "tablet"}, {"listeners": [7]}, {"listeners": ["bad id!"]},
    {"reset_live": True, "extra": 1}])
async def test_a_bad_room_setting_is_a_400_and_nothing_is_saved(ic, body):
    avery = await ic.actor("avery", "owner")
    before = stored(ic)
    status, got = await avery.put(ROOM, body)
    assert status == 400 and got["error"] == "invalid", (body, status, got)
    assert stored(ic) == before and config_rows(ic) == []


@pytest.mark.parametrize("entity", ["media_player.garage_ma", "media_player.nope", "light.kitchen", "media_player.Kitchen",
                                    "media_player.tv"])
async def test_only_the_houses_music_rooms_have_settings(ic, entity):
    avery = await ic.actor("avery", "owner")
    before = stored(ic)
    status, got = await avery.put(f"/api/intercom/rooms/{entity}", {"enabled": True})
    assert status in (404, 400) and stored(ic) == before and config_rows(ic) == [], (entity, status, got)


# ---------------------------------------------------------------------------------------------- Check Reach
async def test_check_reach_is_ok_when_music_assistant_fetches_the_silent_link(ic):
    avery = await ic.actor("avery", "owner")
    status, got = await avery.post(CHECK)
    assert status == 200 and got == {"ok": True, "message": "Music Assistant fetched it."}
    (call,) = ic.ma.item_calls                                                       # a read: nothing was announced
    assert call["uri"].startswith(ic.base + "/s/") and call["uri"].endswith(".wav")
    (fetch,) = ic.ma.fetches
    assert fetch["status"] == 200 and fetch["body"] == wav_header(16000, 6400) + bytes(6400)   # 0.2 s of silence
    assert ic.ma.announced() == [] and len(ic.host.links) == 0 and ic.host.listener.running
    assert config_rows(ic) == [] and ic.play_rows() == []


async def test_check_reach_is_not_ok_when_music_assistant_does_not_fetch(ic, monkeypatch):
    monkeypatch.setattr(RT, "CHECK_WAIT", 0.3)
    ic.ma.item_fetch = False
    avery = await ic.actor("avery", "owner")
    status, got = await avery.post(CHECK)
    assert status == 200 and got == {"ok": False, "message": "Music Assistant could not reach this address."}
    assert ic.ma.fetches == [] and len(ic.host.links) == 0


async def test_check_reach_starts_the_listener_for_its_own_link_when_the_intercom_is_off(ic):
    avery = await ic.actor("avery", "owner")
    await avery.put(SETTINGS, {"enabled": False})
    assert ic.host.listener is None
    status, got = await avery.post(CHECK)
    assert got["ok"] is True
    assert ic.host.listener is None                                                  # and the port is closed again


async def test_check_reach_says_what_is_missing(ic):
    avery = await ic.actor("avery", "owner")
    ic.edit(stream_base="")
    status, got = await avery.post(CHECK)
    assert got == {"ok": False, "message": "Enter the address for Music Assistant first."}
    ic.edit(stream_base=ic.base)
    ic.host.stream_port = 0
    await ic.host.listener.stop()
    ic.host.listener = None
    status, got = await avery.post(CHECK)
    assert got["ok"] is False and "--stream-port" in got["message"]
    assert ic.ma.item_calls == []


# ----------------------------------------------------------------------------------------------- Send Test
async def test_send_test_plays_a_soft_chime_on_one_room_with_both_rows(ic):
    avery = await ic.actor("avery", "owner")
    status, got = await avery.post(TEST, {"room": KITCHEN})
    assert status == 200 and got == {"ok": True, "message": "Sent a test to Kitchen."}
    (call,) = ic.ma.announced()
    assert call["args"]["player_id"] == "ma-kitchen" and call["args"]["pre_announce"] is False
    (fetch,) = ic.ma.fetches
    assert fetch["body"][:44] == wav_header(24000, 28800) and len(fetch["body"]) == 44 + 28800     # 0.6 s
    assert any(fetch["body"][44:])                                                   # a tone, not silence
    assert [r["action"] for r in config_rows(ic)] == ["intercom.test"]
    assert await until(lambda: ic.play_rows()[0]["result"] == "ok")
    assert ic.play_rows()[0]["reason"].startswith("send_test mode:message rooms:1")
    assert len(ic.host.links) == 0


async def test_send_test_is_rate_limited_and_waits_for_the_floor(ic, monkeypatch):
    avery = await ic.actor("avery", "owner")
    assert (await avery.post(TEST, {"room": KITCHEN}))[1]["ok"] is True
    status, got = await avery.post(TEST, {"room": KITCHEN})
    assert status == 429 and got["error"] == "rate"
    ic.host.last_test = -1e9
    ic.ma.delay = 0.6
    jordan = await ic.actor("jordan", "adult")
    ws = await broadcast(ic, jordan, [DEN])
    await recv_until(ws, "sending")
    status, got = await avery.post(TEST, {"room": KITCHEN})
    assert status == 200 and got == {"ok": False, "message": "Jordan is announcing."}
    await recv_until(ws, "sent")


@pytest.mark.parametrize("body,status", [({}, 400), ({"room": 7}, 400), ({"room": None}, 400), (None, 400)])
async def test_send_test_needs_a_room(ic, body, status):
    avery = await ic.actor("avery", "owner")
    ic.host.last_test = -1e9
    got_status, got = await avery.post(TEST, body)
    assert got_status == status and ic.ma.announced() == []


async def test_send_test_to_a_room_that_is_not_an_intercom_room_sends_nothing(ic):
    avery = await ic.actor("avery", "owner")
    for room in ("media_player.garage_ma", "light.kitchen", "all", "floor:main_floor", "preset:pre1"):   # (ONE room only)
        ic.host.last_test = -1e9                                                     # (one press every ten seconds)
        status, got = await avery.post(TEST, {"room": room})
        assert status == 200 and got["ok"] is False, room
    assert ic.ma.announced() == [] and ic.play_rows() == []


async def test_send_test_is_refused_while_the_intercom_is_off(ic):
    avery = await ic.actor("avery", "owner")
    await avery.put(SETTINGS, {"enabled": False})
    status, got = await avery.post(TEST, {"room": KITCHEN})
    assert status == 409 and got["error"] == "intercom_off" and ic.ma.announced() == []


async def test_send_test_makes_no_sound_without_its_play_row(ic, monkeypatch):
    real = ic.app["audit"].record

    def record(*args, **kw):
        if kw.get("action") == "intercom.play":
            raise sqlite3.OperationalError("database or disk is full")
        return real(*args, **kw)
    monkeypatch.setattr(ic.app["audit"], "record", record)
    avery = await ic.actor("avery", "owner")
    status, got = await avery.post(TEST, {"room": KITCHEN})
    assert status >= 500
    assert ic.ma.announced() == [] and ic.ma.fetches == [] and len(ic.host.links) == 0


# ------------------------------------------------------------------------------------ the feed (hub socket)
async def subscribe(ws, rid=7):
    await ws.send_json({"type": "intercom/subscribe", "id": rid})
    result = event = None
    while result is None or ("error" not in result and event is None):
        msg = await recv(ws)
        if msg.get("id") != rid:
            continue
        if msg["type"] == "intercom_result":
            result = msg
        elif msg["type"] == "intercom_event":
            event = msg["event"]
    return result, event


async def next_event(ws, rid=7, timeout=3):
    while True:
        msg = await recv(ws, timeout)
        if msg.get("type") == "intercom_event" and msg.get("id") == rid:
            return msg["event"]


async def test_the_feed_gives_the_owner_the_whole_picture(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    result, ev = await subscribe(hub)
    assert result == {"type": "intercom_result", "id": 7, "result": None}
    assert (ev["enabled"], ev["live_allowed"], ev["default_mode"], ev["max_live_s"], ev["max_message_s"], ev["lag_ms"]) \
        == (True, False, "message", 60, 30, None)
    assert ev["can_override"] is True and ev["away"] is False and ev["here"] == [] and ev["listener"] is False
    assert ev["play"] is None
    assert [(r["room"], r["name"], r["state"], r["why"], r["floor"]) for r in ev["rooms"]][:3] == [
        (KITCHEN, "Kitchen", "ok", None, "Main Floor"), (DEN, "Den", "ok", None, "Main Floor"),
        (CODY, "Cody's Room", "ok", None, "Upstairs")]
    assert {f["name"]: f["rooms"] for f in ev["floors"]} == {"Main Floor": [KITCHEN, DEN], "Upstairs": [CODY]}
    assert [(p["id"], p["name"], p["rooms"]) for p in ev["presets"]] == [("preset:pre1", "Downstairs", [KITCHEN, DEN])]


async def test_the_feed_is_forbidden_without_the_feature(ic):
    for name, role in (("cody", "child"), ("gwen", "guest")):
        person = await ic.actor(name, role)
        hub = await person.hub()
        await hub.send_json({"type": "intercom/subscribe", "id": 3})
        assert await recv(hub) == {"type": "intercom_result", "id": 3, "error": {"code": "forbidden"}}


@pytest.mark.parametrize("msg", [{"type": "intercom/subscribe"}, {"type": "intercom/subscribe", "id": "7"},
                                 {"type": "intercom/subscribe", "id": 7, "rooms": []}])
async def test_a_malformed_subscribe_is_refused(ic, msg):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    await hub.send_json(msg)
    got = await recv(hub)
    assert got["type"] == "intercom_result" and got["error"] == {"code": "invalid"}


async def test_the_feed_is_cut_down_by_rbac(ic):
    cody = await ic.actor("cody", "child")
    child_grant(ic, cody.uid, ("kitchen",))
    hub = await cody.hub()
    _, ev = await subscribe(hub)
    assert [r["room"] for r in ev["rooms"]] == [KITCHEN]
    assert [f["rooms"] for f in ev["floors"]] == [[KITCHEN]] and [p["rooms"] for p in ev["presets"]] == [[KITCHEN]]
    assert ev["can_override"] is False                                               # a Child may not Send Anyway
    jordan = await ic.actor("jordan", "adult")
    ic.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="entity", resource=DEN,
                                   users={jordan.uid}))
    _, ev = await subscribe(await jordan.hub())
    assert [r["room"] for r in ev["rooms"]] == [KITCHEN, CODY] and ev["can_override"] is True


async def test_the_feed_tells_a_tablet_its_own_room_and_whether_it_listens(ic):
    tablet = await ic.tablet("Kitchen tablet", "kitchen")
    _, ev = await subscribe(await tablet.hub())
    assert ev["here"] == [KITCHEN] and ev["listener"] is False and ev["can_override"] is False
    ic.edit(rooms={**ic.doc()["rooms"], DEN: {**ic.doc()["rooms"][DEN], "listeners": [tablet.device_id]}})
    _, ev = await subscribe(await tablet.hub())
    assert ev["listener"] is True and sorted(ev["here"]) == sorted([KITCHEN, DEN])


async def test_the_feed_says_the_sender_is_away_from_home(ic):
    away = await ic.actor("sam", "owner", tunnel=True)
    _, ev = await subscribe(await away.hub())
    assert ev["away"] is True and ev["can_override"] is True


async def test_the_feed_is_pushed_again_after_a_save(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    _, ev = await subscribe(hub)
    assert [r["room"] for r in ev["rooms"]] == [KITCHEN, DEN, CODY]
    assert (await avery.put(ROOM.replace(KITCHEN, DEN), {"enabled": False}))[0] == 200
    ev = await next_event(hub)
    assert [r["room"] for r in ev["rooms"]] == [KITCHEN, CODY]
    assert (await avery.put(SETTINGS, {"max_message_s": 25}))[0] == 200
    ev = await next_event(hub)
    assert ev["max_message_s"] == 25
    assert (await avery.put(SETTINGS, {"enabled": False}))[0] == 200
    ev = await next_event(hub)
    assert ev["enabled"] is False and ev["rooms"] == []                              # "Intercom is off"


async def test_unsubscribing_stops_the_pushes(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    await subscribe(hub)
    await hub.send_json({"type": "intercom/unsubscribe", "id": 7})
    await asyncio.sleep(0.1)
    await avery.put(SETTINGS, {"max_message_s": 25})
    with pytest.raises(asyncio.TimeoutError):
        await next_event(hub, timeout=0.5)
    assert ic.host.listeners_feed.subs == {}


async def test_a_subscription_ends_when_the_feature_is_taken_away(ic):
    jordan = await ic.actor("jordan", "adult")
    hub = await jordan.hub()
    await subscribe(hub)
    ic.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="feature", resource="intercom",
                                   users={jordan.uid}))
    from mantel_server.server import tick_once
    await tick_once(ic.app, ic.hub)
    assert await until(lambda: ic.host.listeners_feed.subs == {})


# --------------------------------------------------------------- listener tablets: the hub event and the clip
async def listener_setup(ic, tablet_name="Hall tablet", room="den"):
    tablet = await ic.tablet(tablet_name, room)
    ic.edit(rooms={**ic.doc()["rooms"], KITCHEN: {**ic.doc()["rooms"][KITCHEN], "listeners": [tablet.device_id]}})
    return tablet


async def test_a_listener_tablet_is_told_and_fetches_the_clip_while_the_broadcast_lasts(ic):
    ic.ma.delay = 1.0                                                                # the broadcast lasts a moment
    tablet = await listener_setup(ic)
    stranger = await ic.tablet("Other tablet", "cody_room")                           # a tablet nobody listed
    avery = await ic.actor("avery", "owner")
    thub = await tablet.hub()
    _, ev = await subscribe(thub)
    assert ev["listener"] is True and ev["play"] is None
    ws = await broadcast(ic, avery, [KITCHEN])
    play = (await next_event(thub))["play"]
    assert play["url"] == f"/api/intercom/clip/{play['id']}.wav" and play["volume"] == 0.4        # the room's 40
    pcm = b"".join(chunks(10))
    status, headers, body = await clip(tablet, play["url"])
    assert status == 200 and headers["Content-Type"] == "audio/wav" and headers["Cache-Control"] == "no-store"
    assert body == wav_header(RATE, len(pcm)) + pcm
    for other in (stranger, avery):                                                  # not listed; and not a tablet at all
        assert (await clip(other, play["url"]))[0] == 404
    assert (await clip(tablet, "/api/intercom/clip/nope.wav"))[0] == 404
    assert (await clip(tablet, f"/api/intercom/clip/{play['id'][::-1]}.wav"))[0] == 404
    await recv_until(ws, "sent")
    assert await closed(ws) == 1000
    assert (await clip(tablet, play["url"]))[0] == 404                               # the broadcast is over: the audio is gone


async def clip(actor, path):
    r = await actor.http.get(path, headers=actor.headers(False))
    return r.status, dict(r.headers), await r.read()


async def test_a_tablet_that_is_speaking_is_not_a_listener_of_its_own_broadcast(ic):
    tablet = await ic.tablet("Kitchen tablet", "kitchen")
    ic.edit(rooms={**ic.doc()["rooms"], KITCHEN: {**ic.doc()["rooms"][KITCHEN], "listeners": [tablet.device_id]}})
    thub = await tablet.hub()
    await subscribe(thub)
    ws = await broadcast(ic, tablet, [KITCHEN])
    await recv_until(ws, "sent")
    with pytest.raises(asyncio.TimeoutError):
        await next_event(thub, timeout=0.5)
    assert ic.host.listeners_feed.clips == {}


async def test_no_listener_tablets_means_no_clip(ic):
    avery = await ic.actor("avery", "owner")
    ws = await broadcast(ic, avery, [KITCHEN])
    await recv_until(ws, "sent")
    assert ic.host.listeners_feed.clips == {}


async def test_a_clip_id_dies_with_its_time_to_live(ic, monkeypatch):
    ic.ma.delay = 1.0
    tablet = await listener_setup(ic)
    avery = await ic.actor("avery", "owner")
    thub = await tablet.hub()
    await subscribe(thub)
    ws = await broadcast(ic, avery, [KITCHEN])
    play = (await next_event(thub))["play"]
    assert (await clip(tablet, play["url"]))[0] == 200
    monkeypatch.setattr(RT, "CLIP_TTL", -1)
    ic.host.listeners_feed.clips = {k: (v[0], v[1], 0.0, v[3]) for k, v in ic.host.listeners_feed.clips.items()}
    assert (await clip(tablet, play["url"]))[0] == 404
    await recv_until(ws, "sent")
