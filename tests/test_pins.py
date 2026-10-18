"""A person's PIN (pins.py) and the person-at-a-wall-tablet step-up through the gateway: set/change from
the person's own session, hashed, unique, rate limited, locked after wrong PINs; at a tablet the PIN
names the person and the command is decided as person ∩ tablet; the audit names that person."""
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
    assert await gw.app["pins"].verify_user(uid(gw, "jordan"), "3691", ip=None) == ("ok", 0.0)
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


# -- a person's PIN at a wall tablet ----------------------------------------------------------------
async def test_an_adults_pin_at_the_tablet_unlocks_and_the_audit_names_the_adult(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    device_id = await tablet(gw)
    ws = await gw.socket()
    first = await gw.command(ws, **unlock())
    assert first["type"] == "step_up_required" and first["reason"] == "person_pin_required"
    assert first["methods"] == ["pin"]
    assert gw.fake.sent == []
    again = await gw.command(ws, id=2, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert again["type"] == "command_result" and "result" in again, again
    assert gw.fake.sent == ["lock.unlock"]
    assert "step_up" not in json.dumps(gw.fake.frames)                                # never forwarded
    row = gw.audit(id=again["audit_id"])[0]
    assert (row["actor"], row["actor_name"], row["role"]) == (uid(gw, "jordan"), "Jordan", "adult")
    assert (row["device"], row["device_role"]) == (device_id, "wall_tablet")
    assert (row["decision"], row["sensitive"], row["step_up"], row["step_up_age"], row["result"]) == \
        ("allowed", "lock", "pin", 0, "ok")
    # for that one command only: the tablet alone still needs a person for the next one
    third = await gw.command(ws, id=3, **unlock())
    assert third["type"] == "step_up_required" and third["reason"] == "person_pin_required"
    assert ADULT_PIN not in json.dumps(gw.audit())
    await ws.close()


async def test_a_childs_pin_at_the_tablet_cannot_unlock(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await set_pin(gw, "cody", "child", CHILD_PIN)
    device_id = await tablet(gw)
    ws = await gw.socket()
    reply = await gw.command(ws, **unlock(step_up={"method": "pin", "pin": CHILD_PIN}))
    assert reply["type"] == "command_result" and reply["error"]["code"] == "forbidden"
    assert reply["error"]["reason"] == "explicit_deny"
    assert gw.fake.sent == []
    row = gw.audit(id=reply["audit_id"])[0]
    assert (row["actor"], row["role"], row["device"], row["decision"], row["result"]) == \
        (uid(gw, "cody"), "child", device_id, "denied", "not_sent")
    # a correct-but-not-allowed PIN is not a wrong PIN: the pad is not counted toward a lockout
    assert gw.app["store"].db.execute("SELECT COUNT(*) FROM pin_lockouts WHERE failed > 0").fetchone()[0] == 0
    await ws.close()


async def test_the_person_gets_only_what_the_tablet_also_may(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await tablet(gw)
    ws = await gw.socket()
    other_room = await gw.command(ws, **service("light", "turn_on", "light.cody",
                                               step_up={"method": "pin", "pin": ADULT_PIN}))
    assert other_room["error"]["code"] == "forbidden" and other_room["error"]["reason"] == "no_grant"
    row = gw.audit(id=other_room["audit_id"])[0]
    assert row["actor"] == uid(gw, "jordan") and row["decision"] == "denied"
    assert gw.fake.sent == []
    await ws.close()


async def test_wrong_pins_lock_the_tablets_pad(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    device_id = await tablet(gw)
    ws = await gw.socket()
    for n in range(1, LOCK_AFTER):
        reply = await gw.command(ws, id=n, **unlock(step_up={"method": "pin", "pin": "9999"}))
        assert reply["type"] == "step_up_required" and reply["pin_error"] == "invalid_pin", reply
        assert reply["methods"] == ["pin"] and reply["reason"] == "person_pin_required"
    reply = await gw.command(ws, id=10, **unlock(step_up={"method": "pin", "pin": "8642"}))
    assert reply["pin_error"] == "locked" and reply["retry_after"] == LOCK_SECONDS + 1
    # locked: even the right PIN is refused, and nothing is sent
    reply = await gw.command(ws, id=11, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert reply["pin_error"] == "locked" and gw.fake.sent == []
    rows = gw.audit()
    assert {r["reason"] for r in rows if r["decision"] == "denied"} == {"pin_invalid", "pin_locked"}
    assert all(r["device"] == device_id and r["actor"] is None for r in rows)
    # the lockout is stored: another Pins over the same database sees it
    fresh = Pins(gw.app["store"].db, lambda: gw.now[0], hasher=lambda: gw.app["accounts"].hasher)
    status, wait = await fresh.identify(ADULT_PIN, device_id=device_id, ip="198.51.100.9")
    assert status == "locked" and wait > 0
    gw.now[0] += LOCK_SECONDS + 1
    reply = await gw.command(ws, id=12, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert "result" in reply and gw.fake.sent == ["lock.unlock"]
    await ws.close()


async def test_nobody_with_a_pin_means_no_pin_pad(gw):
    await tablet(gw)
    ws = await gw.socket()
    reply = await gw.command(ws, **unlock())
    assert reply["reason"] == "person_pin_required" and reply["methods"] == []
    reply = await gw.command(ws, id=2, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert reply["pin_error"] == "invalid_pin" and gw.fake.sent == []
    await ws.close()


async def test_a_malformed_step_up_is_refused(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await tablet(gw)
    ws = await gw.socket()
    for n, step in enumerate(({"method": "totp", "pin": ADULT_PIN}, {"method": "pin"}, "2580",
                              {"method": "pin", "pin": 2580}, {"method": "pin", "pin": ADULT_PIN, "user": "x"}), 1):
        reply = await gw.command(ws, id=n, **unlock(step_up=step))
        assert reply["error"]["code"] == "invalid_command", (step, reply)
    assert gw.fake.sent == []
    assert {r["reason"] for r in gw.audit()} == {"invalid_step_up"}
    await ws.close()


async def test_disabled_people_are_not_named_by_their_pin(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    with gw.app["store"].db:
        gw.app["store"].db.execute("UPDATE users SET disabled = 1 WHERE username = 'jordan'")
    await tablet(gw)
    ws = await gw.socket()
    reply = await gw.command(ws, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert reply["pin_error"] == "invalid_pin" and gw.fake.sent == []
    await ws.close()


async def test_two_people_sharing_a_pin_are_refused_never_guessed(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    await set_pin(gw, "sam", "adult", "3691")
    # forced into the database (the API refuses it): a PIN that names two people names nobody
    h = gw.app["store"].db.execute("SELECT pin_hash FROM user_pins WHERE user_id = ?", (uid(gw, "jordan"),)).fetchone()[0]
    with gw.app["store"].db:
        gw.app["store"].db.execute("UPDATE user_pins SET pin_hash = ? WHERE user_id = ?", (h, uid(gw, "sam")))
    await tablet(gw)
    ws = await gw.socket()
    reply = await gw.command(ws, **unlock(step_up={"method": "pin", "pin": ADULT_PIN}))
    assert reply["pin_error"] == "ambiguous" and gw.fake.sent == []
    await ws.close()


# -- a person's PIN on their own session -----------------------------------------------------------
async def test_a_pin_is_a_step_up_factor_on_a_persons_own_session(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    gw.now[0] += 301
    ws = await gw.socket()
    first = await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    assert first["type"] == "step_up_required" and first["methods"] == ["pin"]
    for n in range(2, 2 + LOCK_AFTER - 1):
        bad = await gw.command(ws, id=n, **service("lock", "unlock", "lock.front_door",
                                                  step_up={"method": "pin", "pin": "9999"}))
        assert bad["pin_error"] == "invalid_pin" and bad["reason"] == "step_up_required"
    good = await gw.command(ws, id=20, **service("lock", "unlock", "lock.front_door",
                                                step_up={"method": "pin", "pin": ADULT_PIN}))
    assert "result" in good and gw.fake.sent == ["lock.unlock"]
    row = gw.audit(id=good["audit_id"])[0]
    assert (row["actor"], row["device"], row["step_up"]) == (uid(gw, "jordan"), None, "pin")
    # the session is fresh now: the next sensitive command needs no prompt
    assert "result" in await gw.command(ws, id=21, **service("lock", "lock", "lock.front_door"))
    await ws.close()


async def test_a_persons_own_wrong_pins_lock_that_person(gw):
    await set_pin(gw, "jordan", "adult", ADULT_PIN)
    gw.now[0] += 301
    ws = await gw.socket()
    for n in range(LOCK_AFTER):
        reply = await gw.command(ws, id=n + 1, **service("lock", "unlock", "lock.front_door",
                                                        step_up={"method": "pin", "pin": "9999"}))
    assert reply["pin_error"] == "locked"
    reply = await gw.command(ws, id=10, **service("lock", "unlock", "lock.front_door",
                                                 step_up={"method": "pin", "pin": ADULT_PIN}))
    assert reply["pin_error"] == "locked" and gw.fake.sent == []
    await ws.close()


async def test_with_commands_off_a_pin_changes_nothing(off):
    await set_pin(off, "jordan", "adult", ADULT_PIN)
    await tablet(off)
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "command", "id": 1, **unlock(step_up={"method": "pin", "pin": ADULT_PIN})})
    reply = await ws.receive_json()
    assert reply["code"] == "commands_disabled" and reply["id"] == 1
    assert off.audit() == []
    await ws.close()
