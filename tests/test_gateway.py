"""P3.3 the command gateway: every path, over the real hub socket of a full app, with a fake command
connection (it checks every frame and ticket like HaCommander and sends nothing anywhere)."""
import asyncio
import json
import sqlite3

import pytest

from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, gw, off, recv, service  # noqa: F401 -- fixtures
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


# -- no step-up (decision 25): locks and the garage go through on roles alone, on every door --------
GARAGE = "cover.garage_door"


def add_garage(env):
    hub = env.app["hub"]
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": GARAGE, "area_id": "kitchen",
                                                          "device_class": "garage"}])
    hub.store.apply_event({"a": {GARAGE: {"s": "closed", "a": {"device_class": "garage"}, "lc": 1.0, "lu": 1.0}}})


def sensitive_rows(env):
    return [(r["decision"], r["reason"], r["action"], r["sensitive"], r["result"], r["door"], r["step_up"])
            for r in env.audit()]


async def test_adult_unlocks_and_opens_the_garage_with_no_pin_and_no_fresh_factor(gw):
    add_garage(gw)
    await gw.login("jordan", "adult")
    gw.now[0] += 86400                                        # long after the sign-in: nothing is "fresh"
    ws = await gw.socket()
    unlock = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert unlock["type"] == "command_result" and "result" in unlock
    garage = await gw.command(ws, id=2, **service("cover", "open_cover", GARAGE))
    assert garage["type"] == "command_result" and "result" in garage
    assert gw.fake.sent == ["lock.unlock", "cover.open_cover"]
    assert sensitive_rows(gw) == [("allowed", "granted", "lock.unlock", "lock", "ok", "lan", None),
                                  ("allowed", "granted", "cover.open_cover", "garage", "ok", "lan", None)]
    assert [r["role"] for r in gw.audit()] == ["adult", "adult"]
    await ws.close()


async def test_a_wall_tablet_alone_unlocks_and_opens_its_rooms_garage_with_no_pin(gw):
    add_garage(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    light = await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    assert "result" in light                                    # its room
    lock = await gw.command(ws, id=2, **service("lock", "unlock", "lock.kitchen_door"))
    assert lock["type"] == "command_result" and "result" in lock    # no person's PIN (decision 25)
    garage = await gw.command(ws, id=3, **service("cover", "open_cover", GARAGE))
    assert garage["type"] == "command_result" and "result" in garage
    # still only its room: the front door (porch) and Cody's light are refused by its role
    other = await gw.command(ws, id=4, **service("lock", "unlock", "lock.front_door"))
    assert other["error"]["code"] == "forbidden" and other["error"]["reason"] == "no_grant"
    other = await gw.command(ws, id=5, **service("light", "turn_on", "light.cody"))
    assert other["error"]["reason"] == "no_grant"
    enrolled, *rows = gw.audit()                                # the enrolment (by the Owner), then the commands
    assert (enrolled["kind"], enrolled["action"], enrolled["role"]) == ("config", "device.enroll", "owner")
    assert all(r["actor"] is None and r["device_role"] == "wall_tablet" and r["device"] for r in rows)
    assert [(r["action"], r["decision"], r["sensitive"]) for r in rows] == [
        ("light.turn_on", "allowed", None), ("lock.unlock", "allowed", "lock"),
        ("cover.open_cover", "allowed", "garage"), ("lock.unlock", "denied", "lock"),
        ("light.turn_on", "denied", None)]
    assert gw.fake.sent == ["light.turn_on", "lock.unlock", "cover.open_cover"]
    await ws.close()


async def test_a_child_is_still_refused_the_lock_and_the_garage_by_role(gw):
    add_garage(gw)
    await gw.login("cody", "child")
    ws = await gw.socket()
    for i, body in enumerate((service("lock", "unlock", "lock.kitchen_door"),
                              service("cover", "open_cover", GARAGE)), 1):
        reply = await gw.command(ws, id=i, **body)
        assert reply["error"]["code"] == "forbidden" and reply["error"]["reason"] == "explicit_deny"
    assert gw.fake.sent == []
    assert [(r["decision"], r["reason"], r["result"]) for r in gw.audit()] == [
        ("denied", "explicit_deny", "not_sent")] * 2
    await ws.close()


async def test_an_owners_deny_grant_still_wins(gw):
    from mantel_server.rbac import Grant
    await gw.login("jordan", "adult")
    gw.app["rbac"].add_grant(Grant(effect="deny", actions=("control.sensitive",), resource_kind="entity",
                                   resource="lock.front_door", users={gw.app["store"].db.execute(
                                       "SELECT id FROM users WHERE username = 'jordan'").fetchone()[0]}))
    ws = await gw.socket()
    reply = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert reply["error"]["reason"] == "explicit_deny" and gw.fake.sent == []
    await ws.close()


async def test_on_the_tunnel_an_adult_unlocks_with_no_step_up_and_the_owners_hear(gw):
    add_garage(gw)
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.m.forget_cookies()
    gw.now[0] += 60                                           # a new TOTP window
    r, body = await gw.m.sign_in("jordan", tunnel=True)
    r = await gw.m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, gw.now[0])},
                        csrf=False, tunnel=True)
    assert r.status == 200
    gw.now[0] += 3600                                         # the sign-in factor is long stale
    ws = await gw.socket(tunnel=True)
    unlock = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert unlock["type"] == "command_result" and "result" in unlock
    garage = await gw.command(ws, id=2, **service("cover", "open_cover", GARAGE))
    assert garage["type"] == "command_result" and "result" in garage
    # the remote unlock still notifies the Owners (kept: it never depended on the step-up)
    assert gw.fake.sent == ["lock.unlock", "persistent_notification.create", "cover.open_cover"]
    rows = [r for r in gw.audit() if r["kind"] not in ("system", "config")]   # (not the TOTP enrolment)
    assert [(r["action"], r["decision"], r["door"], r["step_up"]) for r in rows] == [
        ("lock.unlock", "allowed", "tunnel", None), ("cover.open_cover", "allowed", "tunnel", None)]
    # the role's tunnel switch still decides
    gw.app["rbac"].set_override("adult", {"tunnel_sensitive": False})
    reply = await gw.command(ws, id=3, **service("lock", "unlock", "lock.front_door"))
    assert reply["error"]["reason"] == "tunnel_lan_only"
    await ws.close()


async def test_a_command_carrying_a_step_up_is_refused_and_nothing_is_forwarded(gw):
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    reply = await gw.command(ws, **service("lock", "unlock", "lock.front_door"),
                             step_up={"method": "pin", "pin": "2580"})
    assert reply["error"]["code"] == "invalid_command" and gw.fake.sent == []
    (row,) = gw.audit()
    assert (row["decision"], row["reason"], row["result"]) == ("denied", "invalid_step_up", "not_sent")
    # the PIN never in the row: as a whole value, not a substring (a random id may contain those digits)
    assert '"2580"' not in json.dumps(row) and not any("pin" in str(k).lower() for k in row)
    await ws.close()


async def test_capabilities_name_no_step_up_window(gw):
    await gw.login("jordan", "adult")
    ws = await gw.m.client.ws_connect("/ws")
    caps = await recv(ws)
    assert caps == {"type": "capabilities", "commands": True, "door": "lan"}
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
    # straight in the database: SessionManager.revoke now also ends the socket at once (live.py), and this is the
    # gateway's own check, made at each command whatever closed or not
    with gw.app["store"].db:
        gw.app["store"].db.execute("UPDATE sessions SET revoked = 1, revoked_reason = 'test' WHERE id = ?", (sid,))
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
    rows = [r for r in gw.audit() if r["kind"] != "config"]               # (not the TOTP enrolment's row)
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


MA_SPEAKERS = [{"entity_id": "media_player.kitchen_ma", "platform": "music_assistant", "unique_id": "q",
                "area_id": "kitchen"},
               {"entity_id": "media_player.cody_ma", "platform": "music_assistant", "unique_id": "cody",
                "area_id": "cody_room"}]


async def test_music_commands_are_unavailable_without_music_assistant(gw):
    gw.app["hub"].registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + MA_SPEAKERS)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    reply = await gw.command(ws, kind="ma", command="player_queues/play", args={"queue_id": "q"})
    assert reply["error"]["code"] == "unavailable"
    assert gw.audit()[0]["reason"] == "music_assistant_off"
    await ws.close()


def test_a_settings_row_s_reason_is_the_role_that_made_the_change(tmp_path):
    from mantel_server.store import Store
    db = Store(tmp_path / "m.db").db
    audit = gateway.Audit(db, lambda: 1.0)
    audit.config_event({"actor": "u1", "role": "admin", "action": "account.role", "detail": {"user": "u2"}})
    audit.config_event({"actor": "u0", "role": "owner", "action": "grant.add", "detail": {}})
    audit.config_event({"actor": "u0", "action": "grant.add", "detail": {}, "reason": "bootstrap"})
    assert [r["reason"] for r in audit.rows(kind="config")] == ["admin", "owner", "bootstrap"]


async def test_a_room_moved_in_home_assistant_counts_at_once_not_at_the_next_restart(gw):
    """The decisions' registry lookups read the registry's current tables: a reload replaces them, and the
    kitchen tablet must lose a lock the Owner moves to the porch without Mantel restarting."""
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    gw.app["authz"].context()                                    # some decision built the lookups already
    moved = [dict(e, area_id="porch") if e["entity_id"] == "lock.kitchen_door" else e for e in HOUSE_ENTITIES]
    gw.app["hub"].registry.load(HOUSE_AREAS, [], moved)
    assert gw.app["authz"].context().area_of("lock.kitchen_door") == "porch"
    rep = await gw.command(ws, id=9, **service("lock", "unlock", "lock.kitchen_door"))
    assert "result" not in rep and rep["error"]["code"] == "forbidden", rep
    assert gw.fake.sent == []
    await ws.close()


async def test_a_garage_that_appears_after_a_reconnect_is_still_a_garage(gw):
    """The state store replaces its dict on every reconnect (state.replace_all); device_class must come from
    the current one, or a Guest could open a garage door Home Assistant first reports after a restart."""
    from gateway_fakes import STATES
    from mantel_server.rbac import Subject
    authz, hub = gw.app["authz"], gw.app["hub"]
    authz.context()
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": "cover.garage_2", "area_id": "kitchen"}])
    hub.store.replace_all({"a": {**{k: dict(v) for k, v in STATES.items()},
                                 "cover.garage_2": {"s": "closed", "a": {"device_class": "garage"}, "lc": 2, "lu": 2}}})
    assert authz.context().device_class_of("cover.garage_2") == "garage"
    guest = Subject(user_role="guest", user_id="g1", user_areas={"kitchen"})
    assert authz.decide(guest, "cover.open_cover", "cover.garage_2").allowed is False


def _uid(env, name):
    return env.app["store"].db.execute("SELECT id FROM users WHERE username = ?", (name,)).fetchone()[0]


async def test_entities_named_in_a_services_data_are_decided_too(gw):
    """Only target/entity_id was decided: a Child refused the kitchen speaker's volume could join it to their own
    player (group_members), and cast any camera to their TV (media-source://camera/...)."""
    hub = gw.app["hub"]
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": "media_player.cody", "area_id": "cody_room"},
                                                         {"entity_id": "media_player.kitchen", "area_id": "kitchen"}])
    await gw.login("cody", "child")
    gw.app["rbac"].set_scopes("user", _uid(gw, "cody"), ["cody_room"])
    ws = await gw.socket()
    join = await gw.command(ws, id=1, **service("media_player", "join", "media_player.cody",
                                                data={"group_members": ["media_player.kitchen"]}))
    cast = await gw.command(ws, id=2, **service("media_player", "play_media", "media_player.cody",
                                                data={"media_content_id": "media-source://camera/camera.doorbell",
                                                      "media_content_type": "application/vnd.apple.mpegurl"}))
    music = await gw.command(ws, id=3, **service("media_player", "play_media", "media_player.cody",
                                                 data={"media_content_id": "media-source://radio/x",
                                                       "media_content_type": "music"}))
    clip = await gw.command(ws, id=4, **service("media_player", "play_media", "media_player.cody",
                                                data={"media_content_id": "media-source://frigate/frigate/event/x",
                                                      "media_content_type": "video"}))
    assert join["error"]["code"] == "forbidden" and cast["error"]["code"] == "forbidden", (join, cast)
    assert clip["error"]["code"] == "forbidden", clip
    assert "result" in music and gw.fake.sent == ["media_player.play_media"]
    await ws.close()


async def test_a_wall_tablet_may_watch_the_doorbell_but_not_switch_off_or_record_cameras(gw):
    """HOUSE_GRANTS gave tablets control.sensitive on every camera, for the doorbell pop-up's live view and
    talk-back; that is every camera service. Live view and talk keep it (authz.DOORBELL_GRANTS), nothing else."""
    await gw.login("avery", "owner")
    assert (await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})).status == 201
    ws = await gw.socket()
    for i, (svc, data) in enumerate([("turn_off", {}), ("disable_motion_detection", {}),
                                     ("record", {"filename": "/config/www/x.mp4"}),
                                     ("play_stream", {"media_player": "media_player.anything"})], 1):
        rep = await gw.command(ws, id=i, **service("camera", svc, "camera.doorbell", data=data))
        assert rep.get("error", {}).get("code") == "forbidden", (svc, rep)
    assert gw.fake.sent == []
    (s,) = list(gw.app["hub"].sessions)
    assert gw.app["authz"].may_view(s.principal, "camera.doorbell") is True
    await ws.close()



async def test_a_raw_music_assistant_command_is_decided_on_each_player_it_names(gw):
    """kind "ma" was decided on the music feature alone: a Child with music control drove every speaker, and had
    Music Assistant fetch any address with an announcement."""
    class Ma:
        def __init__(self):
            self.sent = []

        async def command(self, identity, command, **args):
            assert gw.app["gateway"].allow(identity, command, dict(args)) is True
            self.sent.append(command)
            return {"ok": True}

        async def close(self):
            pass
    gw.app["ma"] = ma = Ma()
    gw.app["hub"].registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + MA_SPEAKERS)
    await gw.login("cody", "child")
    gw.app["rbac"].set_scopes("user", _uid(gw, "cody"), ["cody_room"])
    ws = await gw.socket()
    other = await gw.command(ws, id=1, kind="ma", command="players/cmd/power", args={"player_id": "q", "powered": False})
    group = await gw.command(ws, id=2, kind="ma", command="players/cmd/group_many",
                             args={"target_player": "cody", "child_player_ids": ["q"]})
    unknown = await gw.command(ws, id=3, kind="ma", command="players/cmd/play", args={"player_id": "nowhere"})
    say = await gw.command(ws, id=4, kind="ma", command="players/cmd/play_announcement",
                           args={"player_id": "cody", "url": "http://198.51.100.7/x.mp3"})
    mine = await gw.command(ws, id=5, kind="ma", command="players/cmd/play", args={"player_id": "cody"})
    assert [r.get("error", {}).get("code") for r in (other, group, unknown, say)] == \
        ["forbidden", "forbidden", "unsupported_target", "forbidden"]
    assert "result" in mine and ma.sent == ["players/cmd/play"]
    await ws.close()


async def test_the_person_who_unlocked_from_away_cannot_dismiss_the_owners_notice(gw):
    """The Owners' "remote access" notice is mantel_remote_<audit id>, and the client is told the audit id: the
    Adult who unlocked from away could dismiss the notice about it. Mantel's own notices, and dismissing every
    notice at once, are settings-level."""
    import asyncio
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.m.forget_cookies()
    gw.now[0] += 60
    r, body = await gw.m.sign_in("jordan", tunnel=True)
    r = await gw.m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, gw.now[0])},
                        csrf=False, tunnel=True)
    ws = await gw.socket(tunnel=True)
    rep = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    await asyncio.sleep(0.05)
    mine = await gw.command(ws, id=2, kind="service", domain="persistent_notification", service="dismiss",
                            data={"notification_id": f"mantel_remote_{rep['audit_id']}"})
    every = await gw.command(ws, id=3, kind="service", domain="persistent_notification", service="dismiss_all")
    other = await gw.command(ws, id=4, kind="service", domain="persistent_notification", service="dismiss",
                             data={"notification_id": "washer_done"})
    assert mine["error"]["code"] == "forbidden" and every["error"]["code"] == "forbidden"
    assert "result" in other
    assert gw.fake.sent == ["lock.unlock", "persistent_notification.create", "persistent_notification.dismiss"]
    await ws.close()
