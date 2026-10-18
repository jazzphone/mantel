"""P3.3 the command gateway: every path, over the real hub socket of a full app, with a fake command
connection (it checks every frame and ticket like HaCommander and sends nothing anywhere)."""
import asyncio
import json
import sqlite3

import pytest

from gateway_fakes import gw, off, recv, service  # noqa: F401 -- fixtures
from mantel_server import gateway
from mantel_server.accounts import totp
from mantel_server.gateway import Refused, classify, load_writes
from mantel_server.ha_client import CommandBlocked, CommandTicket, check_command, check_http
from mantel_server.server import COMMANDS_DISABLED

WRITES = load_writes()


# -- allowed / denied ------------------------------------------------------------------------------
async def test_owner_command_is_allowed_audited_first_then_sent(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    reply = await gw.command(ws, **service("light", "turn_on", "light.kitchen", data={"brightness": 120}))
    assert reply["type"] == "command_result" and reply["result"] == {"context": {"id": "fictional"}, "response": None}
    assert gw.fake.sent == ["light.turn_on"]
    assert gw.fake.frames == [{"type": "call_service", "domain": "light", "service": "turn_on",
                               "service_data": {"brightness": 120}, "target": {"entity_id": "light.kitchen"}}]
    (row,) = gw.audit()
    assert row["id"] == reply["audit_id"] and row["decision"] == "allowed" and row["reason"] == "granted"
    assert row["result"] == "ok" and row["action"] == "light.turn_on" and json.loads(row["target"]) == ["light.kitchen"]
    assert row["role"] == "owner" and row["door"] == "lan" and row["kind"] == "service" and row["source_ip"] == "127.0.0.1"
    assert "120" not in json.dumps(row)                       # service data is never stored
    await ws.close()


async def test_child_is_denied_a_lock_nothing_sent_audit_denied(gw):
    await gw.login("cody", "child")
    ws = await gw.socket()
    reply = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert reply["error"]["code"] == "forbidden" and reply["error"]["reason"] == "explicit_deny"
    reply = await gw.command(ws, id=2, **service("lock", "lock", "lock.front_door"))
    assert reply["error"]["reason"] == "explicit_deny"
    assert gw.fake.sent == []
    rows = gw.audit()
    assert [(r["decision"], r["reason"], r["result"], r["role"]) for r in rows] == [
        ("denied", "explicit_deny", "not_sent", "child"), ("denied", "explicit_deny", "not_sent", "child")]
    await ws.close()


async def test_every_target_must_be_allowed(gw):
    await gw.login("cody", "child")
    uid = gw.app["store"].db.execute("SELECT id FROM users WHERE username = 'cody'").fetchone()[0]
    gw.app["rbac"].set_scopes("user", uid, ["cody_room"])
    ws = await gw.socket()
    ok = await gw.command(ws, **service("light", "turn_on", "light.cody"))
    assert "result" in ok
    mixed = await gw.command(ws, id=2, **service("light", "turn_on", None, target={"entity_id": ["light.cody", "light.kitchen"]}))
    assert mixed["error"]["code"] == "forbidden" and mixed["error"]["target"] == "light.kitchen"
    assert gw.fake.sent == ["light.turn_on"]
    await ws.close()


# -- step-up -----------------------------------------------------------------------------------------
async def test_adult_unlock_needs_step_up_then_succeeds_after_totp(gw):
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.now[0] += 301                                          # the sign-in / enrolment factor is stale now
    ws = await gw.socket()
    first = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert first["type"] == "step_up_required" and first["reason"] == "step_up_required"
    assert first["methods"] == ["totp"] and first["window"] == 300 and first["targets"] == ["lock.front_door"]
    assert gw.fake.sent == []
    r = await gw.m.post("/api/auth/totp/step-up", {"code": totp(seed, gw.now[0])})
    assert r.status == 200
    again = await gw.command(ws, id=2, **service("lock", "unlock", "lock.front_door"))
    assert again["type"] == "command_result" and "result" in again
    assert gw.fake.sent == ["lock.unlock"]
    rows = gw.audit()
    assert [(r["decision"], r["reason"], r["result"]) for r in rows] == [
        ("step_up", "step_up_required", "not_sent"), ("allowed", "granted", "ok")]
    assert rows[1]["sensitive"] == "lock" and rows[1]["step_up"] == "totp" and rows[1]["step_up_age"] == 0
    await ws.close()


async def test_a_stale_step_up_asks_again(gw):
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.now[0] += 400
    await gw.m.post("/api/auth/totp/step-up", {"code": totp(seed, gw.now[0])})
    ws = await gw.socket()
    gw.now[0] += 299
    assert "result" in await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    gw.now[0] += 2                                            # 301 s after the factor
    stale = await gw.command(ws, id=2, **service("lock", "unlock", "lock.front_door"))
    assert stale["type"] == "step_up_required"
    assert gw.fake.sent == ["lock.unlock"]
    await ws.close()


async def test_a_wall_tablet_alone_needs_a_person(gw):
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    light = await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    assert "result" in light                                    # its room
    lock = await gw.command(ws, id=2, **service("lock", "unlock", "lock.kitchen_door"))
    assert lock["type"] == "step_up_required" and lock["reason"] == "person_pin_required" and lock["methods"] == []
    other = await gw.command(ws, id=3, **service("light", "turn_on", "light.cody"))
    assert other["error"]["reason"] == "no_grant"
    rows = gw.audit()
    assert rows[0]["actor"] is None and rows[0]["device_role"] == "wall_tablet" and rows[0]["device"]
    assert gw.fake.sent == ["light.turn_on"]
    await ws.close()


# -- the audit closes the door -------------------------------------------------------------------
async def test_audit_failure_refuses_the_command_and_sends_nothing(gw, monkeypatch):
    await gw.login("avery", "owner")
    ws = await gw.socket()

    def broken(**kwargs):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(gw.app["audit"], "record", broken)
    reply = await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    assert reply["error"]["code"] == "audit_unavailable"
    assert gw.fake.sent == []
    await ws.close()


async def test_audit_rows_are_append_only_and_the_result_is_written_once(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    db = gw.app["store"].db
    for sql in ("UPDATE action_audit SET decision = 'denied'", "UPDATE action_audit SET result = 'error:x'",
                "UPDATE action_audit SET actor = 'someone'", "DELETE FROM action_audit"):
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            with db:
                db.execute(sql)
    aid = gw.app["audit"].record(principal=None, kind="service", action="x.y", targets=[], decision="allowed",
                                 reason="granted")
    gw.app["audit"].finish(aid, "ok")
    with pytest.raises(sqlite3.DatabaseError):
        with db:
            db.execute("UPDATE action_audit SET result = 'error:late' WHERE id = ?", (aid,))
    await ws.close()


async def test_a_failing_home_assistant_answer_is_the_rows_result(gw):
    from mantel_server.ha_client import HaCommandError
    await gw.login("avery", "owner")
    ws = await gw.socket()
    gw.fake.fail = HaCommandError("not_found", "Service light.turn_on not found")
    reply = await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    assert reply["error"]["code"] == "not_found"
    assert gw.audit()[0]["result"] == "error:not_found"
    await ws.close()


# -- commands disabled (the default) ---------------------------------------------------------------
async def test_commands_disabled_answers_exactly_as_before(off):
    assert off.app["gateway"] is None and off.app["commander"] is None
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "command", "id": 9, **service("light", "turn_on", "light.kitchen")})
    assert await recv(ws) == {**COMMANDS_DISABLED, "id": 9}
    await ws.send_json({"type": "ping"})
    assert (await recv(ws))["type"] == "pong"                 # and no capabilities frame came first
    await ws.close()
    assert off.audit() == []


async def test_with_the_gateway_on_only_its_own_shape_is_accepted(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await ws.send_json({"id": 4, "type": "call_service", "domain": "light", "service": "turn_on"})
    reply = await recv(ws)
    assert reply["code"] == "invalid_command" and reply["id"] == 4
    assert gw.fake.sent == [] and gw.audit() == []
    await ws.close()


# -- classification ---------------------------------------------------------------------------------
async def test_ws_writes_and_reads_are_told_apart(gw):
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    read = await gw.command(ws, kind="ws", msg={"type": "get_config"})
    assert read["error"]["code"] == "not_a_write"
    setting = await gw.command(ws, id=2, kind="ws", msg={"type": "hk_frontend/settings/set", "changes": {"a": 1}})
    assert setting["error"]["code"] == "forbidden" and setting["error"]["reason"] == "no_grant"
    via_ws = await gw.command(ws, id=3, kind="ws", msg={"type": "call_service", "domain": "light", "service": "toggle",
                                                       "target": {"entity_id": "light.kitchen"}})
    assert "result" in via_ws
    await ws.close()
    await gw.login("avery", "owner")
    ws = await gw.socket()
    ok = await gw.command(ws, kind="ws", msg={"type": "hk_frontend/settings/set", "changes": {"a": 1}})
    assert "result" in ok
    assert gw.fake.sent == ["light.toggle", "hk_frontend/settings/set"]
    assert gw.fake.frames[-1] == {"type": "hk_frontend/settings/set", "changes": {"a": 1}}
    await ws.close()


def test_classification_rules():
    c = classify(service("lock", "unlock", "lock.front_door"), WRITES)
    assert (c.kind, c.action, [ch.entity_id for ch in c.checks]) == ("service", "lock.unlock", ["lock.front_door"])
    c = classify({"kind": "service", "domain": "light", "service": "turn_on", "data": {"entity_id": "light.a, light.b"}}, WRITES)
    assert [ch.entity_id for ch in c.checks] == ["light.a", "light.b"]
    c = classify({"kind": "service", "domain": "notify", "service": "mobile_app_x"}, WRITES)
    assert c.checks[0].feature == "notifications"
    c = classify({"kind": "service", "domain": "script", "service": "good_night"}, WRITES)
    assert c.checks[0].entity_id == "script.good_night"
    c = classify({"kind": "service", "domain": "homeassistant", "service": "restart"}, WRITES)
    assert (c.checks[0].action, c.checks[0].feature) == ("configure", "settings")      # never an Adult's "control"
    c = classify({"kind": "ws", "msg": {"type": "config/entity_registry/update", "entity_id": "light.a", "name": "x"}}, WRITES)
    assert (c.checks[0].action, c.checks[0].entity_id) == ("configure", "light.a")
    c = classify({"kind": "http", "method": "POST", "path": "/api/services/lock/unlock", "body": {"entity_id": "lock.x"}}, WRITES)
    assert (c.checks[0].action, c.checks[0].entity_id, c.http[0]) == ("lock.unlock", "lock.x", "POST")
    c = classify({"kind": "http", "method": "POST", "path": "/api/config/config_entries/flow", "body": {}}, WRITES)
    assert c.checks[0].feature == "settings"
    c = classify({"kind": "ma", "command": "player_queues/play", "args": {"queue_id": "q"}}, WRITES)
    assert c.checks[0].feature == "music"
    for bad, code in [
        ({"kind": "service", "domain": "light", "service": "turn_on", "target": {"area_id": "kitchen"}}, "unsupported_target"),
        ({"kind": "service", "domain": "light", "service": "turn_on", "data": {"device_id": "d1"}}, "unsupported_target"),
        ({"kind": "service", "domain": "light", "service": "turn_on", "target": {"entity_id": "all"}}, "unsupported_target"),
        ({"kind": "service", "domain": "light", "service": "turn_on", "target": {"entity_id": ["light.a", 3]}}, "invalid_command"),
        ({"kind": "service", "domain": "Light!", "service": "on"}, "invalid_command"),
        ({"kind": "service", "domain": "light", "service": "turn_on", "role": "owner"}, "invalid_command"),
        ({"kind": "teleport"}, "invalid_command"),
        ({"kind": "ws", "msg": {"type": "auth/delete_all_refresh_tokens"}}, "not_a_write"),
        ({"kind": "ws", "msg": {"type": "execute_script", "sequence": []}}, "not_a_write"),
        ({"kind": "ws", "msg": {"type": "calendar/event/create"}}, "invalid_command"),
        ({"kind": "http", "method": "GET", "path": "/api/states"}, "not_a_write"),
        ({"kind": "http", "method": "POST", "path": "https://evil.example/api/x"}, "invalid_command"),
        ({"kind": "http", "method": "POST", "path": "/api/../auth/token"}, "invalid_command"),
        ({"kind": "http", "method": "POST", "path": "/api/x", "body": "raw audio"}, "unsupported_body"),
        ({"kind": "ma", "command": "players/cmd/everything", "args": {}}, "invalid_command"),
        ({"kind": "ma", "command": "player_queues/play", "args": {"queue_id": "q", "force": True}}, "invalid_command"),
    ]:
        with pytest.raises(Refused) as e:
            classify(bad, WRITES)
        assert e.value.code == code, (bad, e.value.code)


def test_every_catalog_write_has_a_rule():
    for t in WRITES - {"call_service"}:
        action, on = gateway.ws_rule(t)
        assert action in ("control", "configure") and on.split(":")[0] in ("entity", "feature"), t
    assert gateway.ws_rule("hk_music/settings/set") == ("configure", "feature:settings")
    assert gateway.ws_rule("hk_music/queue_play") == ("control", "feature:music")
    assert gateway.ws_rule("lovelace/config/save") == ("configure", "feature:settings")


async def test_unknown_targets_and_bad_shapes_are_audited_denials(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    reply = await gw.command(ws, **service("light", "turn_on", None, target={"area_id": "kitchen"}))
    assert reply["error"]["code"] == "unsupported_target"
    row = gw.audit()[0]
    assert (row["decision"], row["reason"], row["action"]) == ("denied", "unsupported_target", "light.turn_on")
    assert gw.fake.sent == []
    await ws.close()


async def test_http_write_goes_through_the_command_path(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    reply = await gw.command(ws, kind="http", method="POST", path="/api/config/config_entries/flow", body={"handler": "x"})
    assert reply["result"] == {"ok": True} and gw.fake.sent == ["POST /api/config/config_entries/flow"]
    await ws.close()


# -- revocation, tunnel, owner notification -----------------------------------------------------------
async def test_a_revoked_session_cannot_command_on_an_open_socket(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    sid = gw.app["store"].db.execute("SELECT id FROM sessions").fetchone()[0]
    gw.app["sessions"].revoke(sid, "test")
    reply = await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    assert reply["error"]["code"] == "unauthenticated" and gw.fake.sent == []
    assert gw.audit()[0]["reason"] == "unauthenticated"
    await ws.close()


async def test_a_role_change_counts_at_the_next_command(gw):
    await gw.login("kris", "adult")
    ws = await gw.socket()
    assert "result" in await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    db = gw.app["store"].db
    with db:
        db.execute("UPDATE users SET role = 'guest' WHERE username = 'kris'")
    assert (await gw.command(ws, id=2, **service("light", "turn_on", "light.kitchen")))["error"]["code"] == "forbidden"
    await ws.close()


async def test_remote_unlock_notifies_the_owners(gw):
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.m.forget_cookies()
    gw.now[0] += 60
    r, body = await gw.m.sign_in("jordan", tunnel=True)
    r = await gw.m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, gw.now[0])},
                        csrf=False, tunnel=True)
    assert r.status == 200
    ws = await gw.socket(tunnel=True)
    reply = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert "result" in reply                                      # fresh from the password+TOTP sign-in
    await asyncio.sleep(0.05)
    assert gw.fake.sent == ["lock.unlock", "persistent_notification.create"]
    note = gw.fake.frames[1]["service_data"]
    assert "lock.unlock" in note["message"] and "tunnel" in note["message"] and note["notification_id"].startswith("mantel_remote_")
    rows = gw.audit()
    assert rows[0]["door"] == "tunnel" and rows[1]["actor"] == "mantel" and rows[1]["kind"] == "system"
    assert rows[1]["reason"] == f"owner_notification:{rows[0]['id']}" and rows[1]["result"] == "ok"
    # a LAN unlock does not notify
    await ws.close()


async def test_a_guest_on_the_tunnel_never_gets_a_prompt_for_a_lock(gw):
    db = gw.app["store"].db
    await gw.login("gwen", "guest")
    uid = db.execute("SELECT id FROM users WHERE username = 'gwen'").fetchone()[0]
    from mantel_server.rbac import Grant
    gw.app["rbac"].add_grant(Grant(effect="allow", actions=("control", "control.sensitive"), resource_kind="entity",
                                   resource="lock.front_door", users={uid}))
    seed = await gw.enroll_totp()
    gw.m.forget_cookies()
    gw.now[0] += 60                                               # a new TOTP time step (each is single use)
    r, body = await gw.m.sign_in("gwen", tunnel=True)
    r = await gw.m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, gw.now[0])},
                        csrf=False, tunnel=True)
    assert r.status == 200
    ws = await gw.socket(tunnel=True)
    reply = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert reply["error"]["reason"] == "tunnel_lan_only" and gw.fake.sent == []
    await ws.close()


# -- the command path's own guards ----------------------------------------------------------------------
def test_the_command_connection_needs_a_fresh_ticket_bound_to_an_audit_row():
    frame = {"type": "call_service", "domain": "light", "service": "turn_on"}
    with pytest.raises(CommandBlocked):
        check_command(dict(frame), None, WRITES)
    with pytest.raises(CommandBlocked):
        check_command(dict(frame), CommandTicket(0, "ws"), WRITES)              # no audit row
    t = CommandTicket(7, "ws")
    check_command(dict(frame), t, WRITES)
    with pytest.raises(CommandBlocked):
        check_command(dict(frame), t, WRITES)                                   # spent
    with pytest.raises(CommandBlocked):
        check_command({"type": "fire_event", "event_type": "x"}, CommandTicket(8, "ws"), WRITES)
    with pytest.raises(CommandBlocked):
        check_command({**frame, "id": 3}, CommandTicket(9, "ws"), WRITES)
    with pytest.raises(CommandBlocked):
        check_command({**frame, "context": {}}, CommandTicket(10, "ws"), WRITES)
    with pytest.raises(CommandBlocked):
        check_http("POST", "/api/x", CommandTicket(11, "ws"))                    # a ws ticket is not an http one
    with pytest.raises(CommandBlocked):
        check_http("GET", "/api/x", CommandTicket(12, "http"))
    check_http("POST", "/api/x", CommandTicket(13, "http"))


async def test_the_music_assistant_gate_is_the_gateway(gw):
    from mantel_server.connectors import REFUSE_ALL
    g = gw.app["gateway"]
    assert g.allow(object(), "player_queues/play", {"queue_id": "q"}) is False
    who = object()
    g._ma_tickets[id(who)] = [("player_queues/play", json.dumps({"queue_id": "q"}), CommandTicket(5, "ma"))]
    assert g.allow(who, "player_queues/play", {"queue_id": "other"}) is False
    assert g.allow(who, "player_queues/play", {"queue_id": "q"}) is True
    assert g.allow(who, "player_queues/play", {"queue_id": "q"}) is False      # one shot
    assert REFUSE_ALL.allow(who, "player_queues/play", {}) is False


async def test_music_commands_are_unavailable_without_music_assistant(gw):
    await gw.login("avery", "owner")
    ws = await gw.socket()
    reply = await gw.command(ws, kind="ma", command="player_queues/play", args={"queue_id": "q"})
    assert reply["error"]["code"] == "unavailable"
    assert gw.audit()[0]["reason"] == "music_assistant_off"
    await ws.close()
