"""A person's PIN (pins.py): set/change from the person's own session, hashed, unique, rate limited. Since
decision 25 (Avery 2026-10-18) nothing asks for it or accepts it: a wall tablet and a person's own session
unlock with no PIN at all, a PIN sent with a command is refused, and the alarm keypad's lockout
(``Pins.keypad``) counts only the house Alarm PIN's wrong codes (tests/test_alarm_pin.py)."""
import json

import pytest

from gateway_fakes import gw, off, service  # noqa: F401 -- fixtures
from mantel_server import pins as pins_mod
from mantel_server.accounts import PolicyError
from mantel_server.pins import LOCK_AFTER, LOCK_SECONDS, Pins, check_pin

ADULT_PIN, CHILD_PIN, OWNER_PIN = "2580", "7913", "4826"


def uid(gw, username):
    return gw.app["store"].db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()[0]


async def set_pin(gw, username, role, pin):
    await gw.login(username, role)
    r = await gw.m.client.put("/api/account/pin", json={"pin": pin}, headers=gw.m.headers())
    assert r.status == 200, await r.text()
    return await r.json()


async def tablet(gw, room="kitchen"):
    """Sign in as the Owner and make this browser a wall tablet (the session ends: device only)."""
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": room})
    assert r.status == 201
    return (await r.json())["device"]["id"]


def unlock(**extra):
    return service("lock", "unlock", "lock.kitchen_door", **extra)


# -- the PIN itself ---------------------------------------------------------------------------------
@pytest.mark.parametrize("pin,code", [("123", "pin_invalid"), ("123456789", "pin_invalid"), ("12a4", "pin_invalid"),
                                      (1234, "pin_invalid"), ("0000", "pin_too_simple"), ("1234", "pin_too_simple"),
                                      ("98765", "pin_too_simple"), ("", "pin_invalid")])
def test_pin_rules(pin, code):
    with pytest.raises(PolicyError) as exc:
        check_pin(pin)
    assert exc.value.code == code


def test_good_pins():
    for pin in ("2580", "7913", "04827", "13572468"):
        assert check_pin(pin) == pin


async def test_a_person_sets_their_pin_from_their_session_hashed(gw):
    body = await set_pin(gw, "jordan", "adult", ADULT_PIN)
    assert body["pin"] is True
    r = await gw.m.get("/api/account/pin")
    assert (await r.json())["pin"] is True
    row = gw.app["store"].db.execute("SELECT * FROM user_pins").fetchone()
    assert row["pin_hash"].startswith("$argon2id$") and ADULT_PIN not in row["pin_hash"]
    # change it (still fresh), then remove it
    r = await gw.m.client.put("/api/account/pin", json={"pin": "3691"}, headers=gw.m.headers())
    assert r.status == 200
    row = gw.app["store"].db.execute("SELECT pin_hash FROM user_pins").fetchone()
    assert await gw.app["pins"]._verify(row["pin_hash"], "3691")
    r = await gw.m.client.delete("/api/account/pin", headers=gw.m.headers())
    assert (await r.json())["removed"] is True and not gw.app["pins"].has_pin(uid(gw, "jordan"))


async def test_setting_a_pin_needs_a_fresh_factor_csrf_and_a_person(gw):
    await gw.login("jordan", "adult")
    r = await gw.m.client.put("/api/account/pin", json={"pin": ADULT_PIN})             # no CSRF header
    assert r.status == 403
    gw.now[0] += 301                                                                   # sign-in factor stale
    r = await gw.m.client.put("/api/account/pin", json={"pin": ADULT_PIN}, headers=gw.m.headers())
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    r = await gw.m.client.put("/api/account/pin", json={"pin": "1111"}, headers=gw.m.headers())
    assert r.status == 403                                                             # refused before the rules
    await tablet(gw)                                                                   # a device alone
    r = await gw.m.client.put("/api/account/pin", json={"pin": ADULT_PIN}, headers=gw.m.headers())
    assert r.status == 403 and (await r.json())["error"] == "user_required"
    assert gw.app["store"].db.execute("SELECT COUNT(*) FROM user_pins").fetchone()[0] == 0


async def test_two_people_cannot_share_a_pin_and_probing_is_limited(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await gw.login("cody", "child")
    for _ in range(pins_mod.SET_REFUSALS):
        r = await gw.m.client.put("/api/account/pin", json={"pin": ADULT_PIN}, headers=gw.m.headers())
        assert r.status == 400 and (await r.json())["error"] == "pin_unavailable"
    r = await gw.m.client.put("/api/account/pin", json={"pin": CHILD_PIN}, headers=gw.m.headers())
    assert r.status == 429                                                             # even a good one, for now
    gw.now[0] += pins_mod.WINDOW + 1
    await gw.login("cody", "child")                                                    # fresh again
    r = await gw.m.client.put("/api/account/pin", json={"pin": CHILD_PIN}, headers=gw.m.headers())
    assert r.status == 200


async def test_an_owner_clears_a_pin_an_admin_not_an_owners(gw):
    await set_pin(gw, "avery", "owner", OWNER_PIN)
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await gw.login("alex", "admin")
    r = await gw.m.client.delete(f"/api/users/{uid(gw, 'avery')}/pin", headers=gw.m.headers())
    assert r.status == 403
    r = await gw.m.client.delete(f"/api/users/{uid(gw, 'jordan')}/pin", headers=gw.m.headers())
    assert r.status == 200 and (await r.json())["removed"] is True
    await gw.login("cody", "child")
    r = await gw.m.client.delete(f"/api/users/{uid(gw, 'avery')}/pin", headers=gw.m.headers())
    assert r.status == 403
    assert gw.app["pins"].has_pin(uid(gw, "avery"))


# -- nothing asks for a person's PIN (decision 25) ---------------------------------------------------
async def test_a_tablet_unlocks_with_no_pin_even_when_people_have_one(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    device_id = await tablet(gw)
    ws = await gw.socket()
    reply = await gw.command(ws, **unlock())
    assert reply["type"] == "command_result" and "result" in reply, reply
    assert gw.fake.sent == ["lock.unlock"]
    row = gw.audit(id=reply["audit_id"])[0]
    assert (row["actor"], row["device"], row["device_role"], row["decision"], row["sensitive"], row["step_up"]) == \
        (None, device_id, "wall_tablet", "allowed", "lock", None)
    # the tablet's room still binds
    other = await gw.command(ws, id=2, **service("light", "turn_on", "light.cody"))
    assert other["error"]["reason"] == "no_grant" and gw.fake.sent == ["lock.unlock"]
    await ws.close()


async def test_a_pin_sent_with_a_command_is_refused_never_used(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await tablet(gw)
    ws = await gw.socket()
    reply = await gw.command(ws, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert reply["error"]["code"] == "invalid_command" and gw.fake.sent == []
    row = gw.audit(id=reply["audit_id"])[0]
    assert (row["actor"], row["reason"], row["result"]) == (None, "invalid_step_up", "not_sent")
    assert ADULT_PIN not in json.dumps(gw.audit())
    await ws.close()


async def test_a_person_unlocks_on_their_own_session_with_no_pin(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    gw.now[0] += 3600                                         # the session's factor is long stale
    ws = await gw.socket()
    good = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert "result" in good and gw.fake.sent == ["lock.unlock"]
    row = gw.audit(id=good["audit_id"])[0]
    assert (row["actor"], row["device"], row["step_up"]) == (uid(gw, "jordan"), None, None)
    await ws.close()


async def test_the_keypad_lockout_is_stored_and_counts_only_wrong_codes(gw):
    pins = gw.app["pins"]

    async def house(code):
        return code == "8642"
    for _ in range(LOCK_AFTER - 1):
        assert await pins.keypad("1357", place="device:t1", ip="198.51.100.9", house=house) == ("invalid", 0.0)
    assert await pins.keypad("8642", place="device:t1", ip="198.51.100.9", house=house) == ("house", 0.0)
    for _ in range(LOCK_AFTER - 1):
        await pins.keypad("1357", place="device:t1", ip="198.51.100.9", house=house)
    status, wait = await pins.keypad("1357", place="device:t1", ip="198.51.100.9", house=house)
    assert (status, wait) == ("locked", float(LOCK_SECONDS))
    # stored: another Pins over the same database sees it, even for the right code
    fresh = Pins(gw.app["store"].db, lambda: gw.now[0], hasher=lambda: gw.app["accounts"].hasher)
    status, wait = await fresh.keypad("8642", place="device:t1", ip="203.0.113.7", house=house)
    assert status == "locked" and wait > 0
    gw.now[0] += LOCK_SECONDS + 1
    assert await fresh.keypad("8642", place="device:t1", ip="203.0.113.7", house=house) == ("house", 0.0)
    for gone in ("identify", "verify_user", "any_pin"):
        assert not hasattr(pins, gone)


async def test_a_malformed_step_up_is_refused(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await tablet(gw)
    ws = await gw.socket()
    for n, step in enumerate(({"method": "totp", "pin": ADULT_PIN}, {"method": "pin"}, "2580",
                              {"method": "pin", "pin": 2580}, {"method": "pin", "pin": ADULT_PIN, "user": "x"}), 1):
        reply = await gw.command(ws, id=n, **unlock(step_up=step))
        assert reply["error"]["code"] == "invalid_command", (step, reply)
    assert gw.fake.sent == []
    # the tablet's enrolment is a settings row (device.enroll); every command row is the refusal
    assert {r["reason"] for r in gw.audit() if r["kind"] != "config"} == {"invalid_step_up"}
    await ws.close()


async def test_with_commands_off_a_pin_changes_nothing(off):
    await set_pin(off, "jordan", "adult", ADULT_PIN)
    await tablet(off)
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "command", "id": 1, **unlock(step_up={"method": "pin", "pin": ADULT_PIN})})
    reply = await ws.receive_json()
    assert reply["code"] == "commands_disabled" and reply["id"] == 1
    assert [r["action"] for r in off.audit() if not r["action"].startswith("account.pin")] == ["device.enroll"]  # no command
    await ws.close()
