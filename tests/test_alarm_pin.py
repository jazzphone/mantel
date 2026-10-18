"""HK's Alarm PIN in Mantel (alarm_pin.py, gateway.Gateway._alarm, pins.Pins.keypad): the keypad card's
code is taken out of the command, checked by Mantel (the house's Alarm PIN or a person's PIN), never
forwarded or audited; arm/disarm are decided with `control.sensitive` on the keypad panel and the alarm;
the audit row is written first; the alarm's own HA code comes from Mantel's store. Over the real hub
socket of a full app with the fake command connection (it checks every frame and ticket like
HaCommander and sends nothing anywhere). Nothing real is sent."""
import asyncio
import json

import pytest

from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, gw, off, service  # noqa: F401 -- fixtures
from mantel_server import alarm_pin as A
from mantel_server.accounts import totp
from mantel_server.gateway import Refused, classify, load_writes
from mantel_server.linked import LinkedError
from mantel_server.pins import LOCK_AFTER, LOCK_SECONDS
from mantel_server.sessions import Identity, User

WRITES = load_writes()
ALARM = "alarm_control_panel.house"              # the alarm itself (takes no code: Alarm PIN's case)
PANEL = "alarm_control_panel.house_pin"          # HA's Alarm PIN panel in front of it (what HK's keypad names)
HOUSE_CODE, ADULT_PIN, CHILD_PIN, OWNER_PIN = "8642", "2580", "7913", "4826"
HA_CODE = "HA-own-code-5150"


def add_panel(env, *, code_format=None):
    hub = env.app["hub"]
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": PANEL, "area_id": "porch"}])
    hub.store.apply_event({"a": {
        PANEL: {"s": "armed_away", "a": {"protects": ALARM, "code_format": "number"}, "lc": 1.0, "lu": 1.0},
        ALARM: {"s": "armed_away", "a": {"code_format": code_format} if code_format else {}, "lc": 1.0, "lu": 1.0}}})


async def keypad(env, *, pin=HOUSE_CODE, **kw):
    add_panel(env, code_format=kw.pop("code_format", None))
    args = {"forward_to": ALARM, **kw}
    if pin is not None:
        args.update(pin=pin, pin_again=pin)
    return await env.app["alarm_pin"].set(PANEL, **args)


def disarm(code=None, entity=PANEL, svc="alarm_disarm"):
    data = {"entity_id": entity}
    if code is not None:
        data["code"] = code
    return {"kind": "service", "domain": "alarm_control_panel", "service": svc, "data": data}


def uid(env, username):
    return env.app["store"].db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()[0]


async def set_pin(env, username, role, pin):
    await env.login(username, role)
    r = await env.m.client.put("/api/account/pin", json={"pin": pin}, headers=env.m.headers())
    assert r.status == 200, await r.text()


async def tablet(env, room="kitchen"):
    await env.login("avery", "owner")
    r = await env.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": room})
    assert r.status == 201
    return (await r.json())["device"]["id"]


def secrets_absent(env, *values):
    """No code, PIN or HA code anywhere in the audit."""
    text = json.dumps(env.audit(), default=str)
    for v in values:
        assert v not in text


# -- classification: the code comes out before anything else --------------------------------------------
def test_the_code_is_taken_out_of_the_command():
    cmd = classify(disarm("8642"), WRITES)
    assert cmd.alarm == ("alarm_disarm", PANEL) and cmd.code == "8642"
    assert cmd.frame == {"type": "call_service", "domain": "alarm_control_panel", "service": "alarm_disarm",
                         "service_data": {"entity_id": PANEL}}
    assert "8642" not in repr(cmd)
    ws = classify({"kind": "ws", "msg": {"type": "call_service", "domain": "alarm_control_panel",
                                         "service": "alarm_arm_away", "service_data": {"entity_id": PANEL, "code": "1"}}},
                  WRITES)
    assert ws.alarm == ("alarm_arm_away", PANEL) and ws.code == "1" and "code" not in ws.frame["service_data"]
    assert classify(disarm(""), WRITES).code is None


@pytest.mark.parametrize("msg,code", [
    ({"kind": "http", "method": "POST", "path": "/api/services/alarm_control_panel/alarm_disarm",
      "body": {"entity_id": PANEL, "code": "8642"}}, "unsupported_command"),
    ({**disarm("8642"), "data": {"entity_id": PANEL, "code": "8642", "extra": 1}}, "invalid_command"),
    ({**disarm(), "data": {"entity_id": [PANEL, ALARM]}}, "unsupported_target"),
    ({**disarm(), "data": {"entity_id": PANEL, "code": 8642}}, "invalid_command"),
    ({**disarm(), "data": {"entity_id": "light.kitchen"}}, "unsupported_target"),
])
def test_malformed_alarm_commands_are_refused(msg, code):
    with pytest.raises(Refused) as exc:
        classify(msg, WRITES)
    assert exc.value.code == code and "8642" not in str(exc.value)


# -- the house code -----------------------------------------------------------------------------------------
async def test_the_house_code_disarms_audit_first_and_the_code_never_leaves(gw, monkeypatch):
    await keypad(gw)
    await gw.login("jordan", "adult")
    gw.now[0] += 3600                                 # the sign-in factor is long stale: the code is the factor
    ws = await gw.socket()
    seen = []
    real = gw.fake.call

    async def call(frame, ticket):
        (row,) = gw.audit()                            # THE ROW FIRST: written, result not yet known
        seen.append((row["decision"], row["result"], ticket.audit_id))
        return await real(frame, ticket)

    monkeypatch.setattr(gw.fake, "call", call)
    reply = await gw.command(ws, **disarm(HOUSE_CODE))
    assert reply["type"] == "command_result" and "result" in reply, reply
    assert seen == [("allowed", None, reply["audit_id"])]
    # sent to the alarm itself, with no code (it asks for none)
    assert gw.fake.frames == [{"type": "call_service", "domain": "alarm_control_panel", "service": "alarm_disarm",
                               "service_data": {"entity_id": ALARM}}]
    (row,) = gw.audit()
    assert row["decision"] == "allowed" and row["result"] == "ok" and row["sensitive"] == "alarm_control_panel"
    assert json.loads(row["target"]) == [PANEL, ALARM] and row["step_up"] == "alarm_pin" and row["role"] == "adult"
    secrets_absent(gw, HOUSE_CODE)
    await ws.close()


async def test_a_wrong_code_is_wrong_code_audited_and_nothing_is_sent(gw):
    await keypad(gw)
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    reply = await gw.command(ws, **disarm("9999"))
    assert reply["error"]["code"] == "invalid_code" and reply["error"]["message"] == "Wrong code"
    assert gw.fake.sent == []
    (row,) = gw.audit()
    assert (row["decision"], row["reason"], row["result"]) == ("denied", "alarm_code_invalid", "not_sent")
    secrets_absent(gw, "9999")
    await ws.close()


async def test_disarming_always_needs_the_code_arming_as_the_rule_says(gw):
    await keypad(gw, arm_required=True)
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    for svc in ("alarm_disarm", "alarm_arm_away"):
        r = await gw.command(ws, **disarm(None, svc=svc))
        assert r["error"]["code"] == "code_required" and r["error"]["message"] == "Enter the alarm code"
    await gw.app["alarm_pin"].set(PANEL, arm_required=False)
    gw.now[0] += 3600                                  # stale factor: arming without a code is plain control
    r = await gw.command(ws, id=3, **disarm(None, svc="alarm_arm_away"))
    assert "result" in r and gw.fake.sent == ["alarm_control_panel.alarm_arm_away"]
    assert gw.audit()[-1]["sensitive"] is None
    r = await gw.command(ws, id=4, **disarm(None))
    assert r["error"]["code"] == "code_required"                 # disarm: always
    r = await gw.command(ws, id=5, **disarm("1111", svc="alarm_arm_home"))
    assert r["error"]["code"] == "invalid_code"                   # a code that IS given must still be right
    assert gw.fake.sent == ["alarm_control_panel.alarm_arm_away"]
    await ws.close()


async def test_the_alarms_own_ha_code_comes_from_mantel_never_the_page(gw):
    await keypad(gw, code_format="number")
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(HOUSE_CODE))
    assert r["error"] == {"code": "unavailable", "message": "alarm_ha_code_missing"} and gw.fake.sent == []
    await gw.app["alarm_pin"].set(PANEL, ha_code=HA_CODE)
    sealed = gw.app["store"].db.execute("SELECT ha_code FROM alarm_pins").fetchone()[0]
    assert HA_CODE.encode() not in bytes(sealed)                   # sealed at rest
    r = await gw.command(ws, id=2, **disarm(HOUSE_CODE))
    assert "result" in r
    assert gw.fake.frames[-1]["service_data"] == {"entity_id": ALARM, "code": HA_CODE}
    secrets_absent(gw, HOUSE_CODE, HA_CODE)
    await ws.close()


# -- lockout -------------------------------------------------------------------------------------------------
async def test_wrong_codes_lock_the_tablets_keypad_shared_with_its_pin_pad(gw):
    await keypad(gw)
    device_id = await tablet(gw, room="porch")
    ws = await gw.socket()
    for i in range(LOCK_AFTER - 1):
        r = await gw.command(ws, id=i + 1, **disarm("1357"))
        assert r["error"]["code"] == "invalid_code"
    r = await gw.command(ws, id=50, **disarm("1357"))
    assert r["error"]["code"] == "code_locked" and r["error"]["retry_after"] == LOCK_SECONDS + 1
    r = await gw.command(ws, id=51, **disarm(HOUSE_CODE))            # even the right code, for now
    assert r["error"]["code"] == "code_locked" and gw.fake.sent == []
    row = gw.app["store"].db.execute("SELECT * FROM pin_lockouts WHERE place = ?", (f"device:{device_id}",)).fetchone()
    assert row["locked_until"] > gw.now[0]                         # the tablet's own PIN pad is locked too
    gw.now[0] += LOCK_SECONDS + 1
    r = await gw.command(ws, id=52, **disarm(HOUSE_CODE))
    assert "result" in r and gw.fake.sent == ["alarm_control_panel.alarm_disarm"]
    reasons = [r["reason"] for r in gw.audit()]
    assert reasons.count("alarm_code_invalid") == LOCK_AFTER - 1 and reasons.count("alarm_code_locked") == 2
    await ws.close()


async def test_a_persons_session_keypad_locks_that_person(gw):
    await keypad(gw)
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    for i in range(LOCK_AFTER):
        await gw.command(ws, id=i + 1, **disarm("1357"))
    r = await gw.command(ws, id=9, **disarm(HOUSE_CODE))
    assert r["error"]["code"] == "code_locked" and gw.fake.sent == []
    assert gw.app["store"].db.execute("SELECT 1 FROM pin_lockouts WHERE place = ?",
                                      (f"keypad:user:{uid(gw, 'jordan')}",)).fetchone()
    await ws.close()


# -- wall tablets and people's PINs ------------------------------------------------------------------------
async def test_a_wall_tablet_uses_the_house_code_and_the_audit_names_the_tablet(gw):
    await keypad(gw)                                   # tablets: on (HK's keypad on every screen)
    device_id = await tablet(gw)                       # the kitchen: the alarm is in the porch
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(HOUSE_CODE))
    assert "result" in r and gw.fake.sent == ["alarm_control_panel.alarm_disarm"]
    row = gw.audit()[-1]
    assert row["actor"] is None and row["device"] == device_id and row["step_up"] == "alarm_pin"
    # tablets off: the kitchen tablet has no grant on the porch's alarm
    await gw.app["alarm_pin"].set(PANEL, tablets=False)
    r = await gw.command(ws, id=2, **disarm(HOUSE_CODE))
    assert r["error"]["code"] == "forbidden" and r["error"]["reason"] == "no_grant"
    assert gw.fake.sent == ["alarm_control_panel.alarm_disarm"]
    await ws.close()


async def test_an_owners_deny_grant_wins_over_the_keypad_grant(gw):
    await keypad(gw)
    device_id = await tablet(gw)
    from mantel_server.rbac import Grant
    gw.app["rbac"].add_grant(Grant(effect="deny", actions=("control.sensitive",), resource_kind="entity",
                                   resource=ALARM, devices={device_id}))
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(HOUSE_CODE))
    assert r["error"]["reason"] == "explicit_deny" and gw.fake.sent == []
    await ws.close()


async def test_an_adults_pin_at_the_tablet_disarms_as_the_adult(gw):
    await keypad(gw, pin=None)                         # no house code: people's PINs only
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    device_id = await tablet(gw)
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(ADULT_PIN))
    assert "result" in r
    row = gw.audit()[-1]
    assert row["actor"] == uid(gw, "jordan") and row["role"] == "adult" and row["device"] == device_id
    assert row["step_up"] == "pin"
    r = await gw.command(ws, id=2, **disarm(HOUSE_CODE))            # no house code set: wrong
    assert r["error"]["code"] == "invalid_code"
    secrets_absent(gw, ADULT_PIN)
    await ws.close()


async def test_a_child_is_refused_whatever_code_they_type(gw):
    await keypad(gw)
    await set_pin(gw, "cody", "child", CHILD_PIN)
    ws = await gw.socket()
    for i, code in enumerate((HOUSE_CODE, CHILD_PIN)):              # the house code, their own PIN
        r = await gw.command(ws, id=i + 1, **disarm(code))
        assert r["error"]["code"] == "forbidden" and r["error"]["reason"] == "explicit_deny", r
    await ws.close()
    await tablet(gw)                                                 # at a tablet the PIN names the child
    ws = await gw.socket()
    r = await gw.command(ws, id=3, **disarm(CHILD_PIN))
    assert r["error"]["code"] == "forbidden" and r["error"]["reason"] == "explicit_deny"
    assert gw.audit()[-1]["actor"] == uid(gw, "cody")
    assert gw.fake.sent == []
    await ws.close()


async def test_an_alarm_mantel_does_not_guard_checks_the_code_as_a_persons_pin(gw):
    add_panel(gw)
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(ADULT_PIN, entity=ALARM))
    assert "result" in r and gw.fake.frames[-1]["service_data"] == {"entity_id": ALARM}   # never the code
    r = await gw.command(ws, id=2, **disarm("1357", entity=ALARM))
    assert r["error"]["code"] == "invalid_code"
    gw.now[0] += 3600                                                 # no code: the ordinary step-up path
    r = await gw.command(ws, id=3, **disarm(None, entity=ALARM))
    assert r["type"] == "step_up_required" and "pin" in r["methods"]
    assert gw.fake.sent == ["alarm_control_panel.alarm_disarm"]
    await ws.close()


async def test_without_the_keypad_engine_a_code_is_never_forwarded(gw):
    add_panel(gw)
    gw.app._state.pop("alarm_pin")
    await gw.login("jordan", "adult")
    ws = await gw.socket()
    r = await gw.command(ws, **disarm(HOUSE_CODE))
    assert r["error"] == {"code": "unavailable", "message": "alarm_pin_unavailable"} and gw.fake.sent == []
    await ws.close()


# -- doors -----------------------------------------------------------------------------------------------------
async def test_on_the_tunnel_the_house_code_is_not_the_factor_and_the_owners_hear(gw):
    await keypad(gw)
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.m.forget_cookies()
    gw.now[0] += 60
    r, body = await gw.m.sign_in("jordan", tunnel=True)
    r = await gw.m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, gw.now[0])},
                        csrf=False, tunnel=True)
    assert r.status == 200
    gw.now[0] += 301                                                  # the sign-in factor is stale
    ws = await gw.socket(tunnel=True)
    first = await gw.command(ws, **disarm(HOUSE_CODE))
    assert first["type"] == "step_up_required" and first["reason"] == "step_up_required" and gw.fake.sent == []
    r = await gw.m.post("/api/auth/totp/step-up", {"code": totp(seed, gw.now[0])}, tunnel=True)
    assert r.status == 200
    wrong = await gw.command(ws, id=2, **disarm("1357"))              # fresh, but the code must still be right
    assert wrong["error"]["code"] == "invalid_code"
    again = await gw.command(ws, id=3, **disarm(HOUSE_CODE))
    assert "result" in again
    await asyncio.sleep(0.05)
    assert gw.fake.sent == ["alarm_control_panel.alarm_disarm", "persistent_notification.create"]
    note = gw.fake.frames[1]["service_data"]
    assert "alarm_control_panel.alarm_disarm" in note["message"] and "tunnel" in note["message"]
    assert HOUSE_CODE not in json.dumps(gw.fake.frames)
    await ws.close()


async def test_a_tablet_on_the_tunnel_never_reaches_the_keypad(gw):
    from aiohttp import WSServerHandshakeError
    await keypad(gw)
    await tablet(gw)
    with pytest.raises(WSServerHandshakeError):                      # devices are LAN-only
        await gw.socket(tunnel=True, expect_caps=False)
    assert gw.fake.sent == []


async def _ha_door(gw, mode, monkeypatch):
    """A person through HA's sidebar (the `ha` door), with ha_door_rules = `mode`."""
    authz = gw.app["authz"]
    monkeypatch.setattr(authz, "ha_door_mode", lambda: mode)
    if gw.app["store"].db.execute("SELECT 1 FROM users WHERE username = 'kim'").fetchone() is None:
        await gw.m.user("kim", "adult")
    ident = Identity(User(uid(gw, "kim"), "Kim", "adult", "ha_linked"), None, "ha")
    from mantel_server.authz import Principal
    p = Principal(ident, authz.subject_of(ident), "172.30.32.2")
    got = []

    async def run(msg):
        got.clear()

        async def send(reply):
            got.append(reply)
        await gw.app["gateway"].handle(p, {"type": "command", "id": 1, **msg}, send)
        return got[0]
    return run


async def test_trusted_ha_door_still_asks_the_alarms_pin_and_no_owner_notice(gw, monkeypatch):
    await keypad(gw)
    run = await _ha_door(gw, "trusted", monkeypatch)
    r = await run(disarm(None))
    assert r["error"]["code"] == "code_required"            # HA's sign-in is the factor, not the alarm's PIN
    r = await run(disarm("1357"))
    assert r["error"]["code"] == "invalid_code"
    r = await run(disarm(HOUSE_CODE))
    assert "result" in r
    await asyncio.sleep(0.05)
    assert gw.fake.sent == ["alarm_control_panel.alarm_disarm"]   # trusted: no Owner notice
    assert gw.audit()[-1]["door"] == "ha"


async def test_ha_door_under_tunnel_rules_wants_a_fresh_factor_then_notifies(gw, monkeypatch):
    await keypad(gw)
    await gw.login("kim", "adult")
    r = await gw.m.client.put("/api/account/pin", json={"pin": ADULT_PIN}, headers=gw.m.headers())
    assert r.status == 200
    run = await _ha_door(gw, "tunnel", monkeypatch)
    r = await run(disarm(HOUSE_CODE))
    assert r["type"] == "step_up_required" and gw.fake.sent == []
    r = await run(disarm(ADULT_PIN))                        # their own PIN names them: a fresh factor
    assert "result" in r
    await asyncio.sleep(0.05)
    assert gw.fake.sent == ["alarm_control_panel.alarm_disarm", "persistent_notification.create"]
    assert "Home Assistant's sidebar" in gw.fake.frames[1]["service_data"]["message"]


# -- commands off -----------------------------------------------------------------------------------------------
async def test_with_commands_off_nothing_is_sent(off):
    await keypad(off)
    await off.login("jordan", "adult")
    ws = await off.m.client.ws_connect("/ws")
    await ws.send_json({"type": "command", "id": 1, **disarm(HOUSE_CODE)})
    while True:
        reply = await asyncio.wait_for(ws.receive_json(), 3)
        if reply.get("id") == 1:
            break
    assert reply["type"] == "error" and reply["code"] == "commands_disabled"
    assert off.audit() == [] and off.app.get("gateway") is None and off.app.get("commander") is None
    await ws.close()


# -- linked mode --------------------------------------------------------------------------------------------------
async def test_linked_mode_runs_the_same_path(gw):
    await keypad(gw)
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    with pytest.raises(LinkedError) as exc:
        await A.linked_command(gw.app, entity=PANEL, command="alarm_disarm", code="1357", peer="192.168.1.5")
    assert exc.value.code == "invalid_code"
    with pytest.raises(LinkedError) as exc:
        await A.linked_command(gw.app, entity=PANEL, command="alarm_disarm", code=None)
    assert exc.value.code == "code_required"
    await A.linked_command(gw.app, entity=PANEL, command="alarm_disarm", code=HOUSE_CODE, peer="192.168.1.5")
    assert gw.audit()[-1]["actor"] == A.LINKED_ACTOR and gw.audit()[-1]["source_ip"] == "192.168.1.5"
    await A.linked_command(gw.app, entity=PANEL, command="alarm_arm_away", code=ADULT_PIN)
    assert gw.audit()[-1]["actor"] == uid(gw, "jordan")       # the person whose PIN it was
    assert gw.fake.sent == ["alarm_control_panel.alarm_disarm", "alarm_control_panel.alarm_arm_away"]
    with pytest.raises(LinkedError) as exc:
        await A.linked_command(gw.app, entity=PANEL, command="turn_off", code=HOUSE_CODE)
    assert exc.value.code == "unknown_command"
    secrets_absent(gw, HOUSE_CODE, ADULT_PIN)


async def test_linked_mode_with_commands_off_audits_and_sends_nothing(off):
    await keypad(off)
    with pytest.raises(LinkedError) as exc:
        await A.linked_command(off.app, entity=PANEL, command="alarm_disarm", code=HOUSE_CODE)
    assert exc.value.code == "commands_disabled"
    row = off.audit()[-1]
    assert (row["decision"], row["reason"], row["result"]) == ("denied", "commands_disabled", "not_sent")
    with pytest.raises(LinkedError) as exc:                       # the code is still checked first
        await A.linked_command(off.app, entity=PANEL, command="alarm_disarm", code="1357")
    assert exc.value.code == "invalid_code"


# -- the keypad check itself ---------------------------------------------------------------------------------
async def test_both_codes_are_checked_every_time(gw, monkeypatch):
    await keypad(gw)
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    calls = []
    real = gw.app["alarm_pin"].house_matches

    async def spy(entity, code):
        calls.append(entity)
        return await real(entity, code)
    monkeypatch.setattr(gw.app["alarm_pin"], "house_matches", spy)
    await tablet(gw)
    ws = await gw.socket()
    assert "result" in await gw.command(ws, **disarm(ADULT_PIN))   # a person's PIN: the house code checked too
    assert calls == [PANEL]
    await ws.close()


async def test_no_house_code_still_takes_the_time_of_one(gw):
    pins = gw.app["alarm_pin"]
    add_panel(gw)
    await pins.set(PANEL, forward_to=ALARM)
    assert await pins.house_matches(PANEL, HOUSE_CODE) is False and pins._dummy is not None


# -- REST -----------------------------------------------------------------------------------------------------------
async def test_rest_owner_sets_lists_and_removes_never_shows_a_pin(gw):
    add_panel(gw)
    await gw.login("avery", "owner")
    url = f"/api/alarm/pins/{PANEL}"
    r = await gw.m.client.put(url, json={"forward_to": ALARM, "pin": HOUSE_CODE, "pin_again": "8643"},
                              headers=gw.m.headers())
    assert r.status == 400 and (await r.json())["field"] == "pin_again"
    r = await gw.m.client.put(url, json={"pin": "12a4", "pin_again": "12a4"}, headers=gw.m.headers())
    assert r.status == 400 and (await r.json())["field"] == "pin"
    r = await gw.m.client.put(url, json={"forward_to": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE,
                                         "arm_required": False, "ha_code": HA_CODE}, headers=gw.m.headers())
    assert r.status == 200, await r.text()
    body = await r.json()
    assert body["house_code"] is True and body["ha_code"] is True and body["arm_required"] is False
    r = await gw.m.get("/api/alarm/pins")
    text = await r.text()
    assert HOUSE_CODE not in text and HA_CODE not in text and "argon2" not in text
    assert (await r.json())["alarms"][0]["forward_to"] == ALARM
    row = gw.app["store"].db.execute("SELECT pin_hash FROM alarm_pins").fetchone()
    assert row["pin_hash"].startswith("$argon2id$")
    config = [r for r in gw.audit() if r["kind"] == "config" and "alarm_pin" in (r["action"] or "")]
    assert config and HOUSE_CODE not in json.dumps(config) and HA_CODE not in json.dumps(config)
    r = await gw.m.client.delete(url, headers=gw.m.headers())
    assert (await r.json())["removed"] is True and gw.app["alarm_pin"].entries() == []


async def test_rest_needs_a_manager_with_a_fresh_factor(gw):
    add_panel(gw)
    url = f"/api/alarm/pins/{PANEL}"
    await gw.login("jordan", "adult")
    r = await gw.m.client.put(url, json={"pin": HOUSE_CODE, "pin_again": HOUSE_CODE}, headers=gw.m.headers())
    assert r.status == 403
    r = await gw.m.get("/api/alarm/pins")
    assert r.status == 403
    await gw.login("avery", "owner")
    gw.now[0] += 301
    r = await gw.m.client.put(url, json={"pin": HOUSE_CODE, "pin_again": HOUSE_CODE}, headers=gw.m.headers())
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    await tablet(gw)
    r = await gw.m.get("/api/alarm/pins")
    assert r.status == 403
    assert gw.app["alarm_pin"].entries() == []


async def test_import_from_has_alarm_pin_page(gw):
    page = {"configured": True, "min_length": 4, "alarms": [
        {"entry_id": "e1", "title": "House PIN", "state": "loaded", "alarm": ALARM, "alarm_name": "House",
         "panel": PANEL, "panel_name": "House PIN", "arm_required": False, "pin_set": True},
        {"entry_id": "e2", "alarm": "light.nope", "panel": PANEL}]}
    asked = []

    class Proxy:
        async def read_server(self, msg):
            asked.append(msg)
            return page

        async def close(self):
            pass
    gw.app["hub"].readproxy = Proxy()
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/alarm/pins/import", {})
    assert r.status == 200, await r.text()
    assert await r.json() == {"ok": True, "imported": [PANEL], "need_pin": [PANEL]}
    assert asked == [{"type": "hk_alarm_pin/settings/get"}]
    (e,) = gw.app["alarm_pin"].entries()
    assert e.forward_to == ALARM and e.arm_required is False and not e.house_code
