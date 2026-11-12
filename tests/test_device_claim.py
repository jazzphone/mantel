"""A tablet app paired by a one-time code (docs/phase26/ANDROID-APP.md "Enrolling a tablet without a password on it")
and the tablet app's updates (apps/android.py)."""
import hashlib
import json

from mantel_server.identity import device_claim as C


async def make(mantel, **body):
    r = await mantel.post(C.CODES_API, {"room": "kitchen", **body})
    return r, await r.json()


async def claim(mantel, code, tunnel=False):
    r = await mantel.post(C.CLAIM_API, {"code": code}, csrf=False, tunnel=tunnel)
    return r, await r.json()


def audit(mantel, prefix="device."):
    return [x for x in mantel.app["audit"].rows(kind="config") if x["action"].startswith(prefix)]


def test_codes_are_typed_loosely_and_have_no_look_alikes():
    assert C.normalize("abcd-2345") == "ABCD2345" and C.normalize(" AB CD 23 45 ") == "ABCD2345"
    assert C.normalize("ABCD-234O") is None and C.normalize("ABC") is None and C.normalize(None) is None
    assert not set("01OIL") & set(C.ALPHABET)
    assert C.shown("ABCD2345") == "ABCD-2345"


async def test_an_owner_makes_a_code_and_the_tablet_becomes_the_tablet(mantel):
    uid = await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, body = await make(mantel, name="Kitchen Kiosk")
    assert r.status == 201 and body["expires_in"] == 600 and body["name"] == "Kitchen Kiosk"
    code = body["code"]
    assert C.normalize(code) and code[4] == "-"
    [row] = audit(mantel, "device.claim_code")
    assert row["actor"] == uid and code not in json.dumps(row)               # the code itself is never written
    mantel.forget_cookies()                                                  # the tablet: nobody signed in
    r, body = await claim(mantel, code.lower())
    assert r.status == 201 and body["device"]["role"] == "wall_tablet" and body["device"]["room"] == "kitchen"
    assert body["device"]["name"] == "Kitchen Kiosk"
    c = r.cookies["mantel_device"]
    assert c["httponly"] and c["samesite"] == "Strict"
    me = await (await mantel.get("/api/session")).json()
    assert me["user"] is None and me["device"]["name"] == "Kitchen Kiosk"
    [enrolled] = [x for x in audit(mantel) if x["action"] == "device.enroll"]
    assert enrolled["actor"] == uid and json.loads(enrolled["target"])["via"] == "claim_code"
    row = mantel.store.db.execute("SELECT enrolled_by, role FROM devices").fetchone()
    assert tuple(row) == (uid, "wall_tablet")
    # single use
    mantel.forget_cookies()
    assert (await claim(mantel, code))[0].status == 403


async def test_codes_run_out(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    code = (await make(mantel))[1]["code"]
    mantel.forget_cookies()
    mantel.now[0] += C.TTL + 1
    r, body = await claim(mantel, code)
    assert r.status == 403 and body["error"] == "invalid_code"
    assert mantel.store.db.execute("SELECT COUNT(*) FROM devices").fetchone()[0] == 0


async def test_only_managers_make_codes_and_never_from_a_tablet(mantel):
    await mantel.user("kid", "adult")
    await mantel.sign_in("kid")
    assert (await make(mantel))[0].status == 403
    mantel.forget_cookies()
    await mantel.user("ada", "admin")
    await mantel.sign_in("ada")
    assert (await make(mantel))[0].status == 201
    r, body = await make(mantel, room=None)
    assert r.status == 400 and body["error"] == "room_required"
    # an Owner signed in at a wall tablet is refused (a forgotten sign-in on the kitchen tablet)
    code = (await make(mantel))[1]["code"]
    mantel.forget_cookies()
    await claim(mantel, code)
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    assert (await make(mantel))[0].status == 403


async def test_claiming_is_home_network_only_and_rate_limited(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    code = (await make(mantel))[1]["code"]
    mantel.forget_cookies()
    r, body = await claim(mantel, code, tunnel=True)
    assert r.status == 403 and body["error"] == "lan_only" and "mantel_device" not in r.cookies
    for _ in range(C.TRIES):
        assert (await claim(mantel, "ZZZZ-ZZZZ"))[0].status == 403
    r, body = await claim(mantel, code)                                      # the right one, too soon
    assert r.status == 429 and body["error"] == "too_many_attempts"
    mantel.now[0] += C.TRY_WINDOW + 1
    assert (await claim(mantel, code))[0].status == 201                     # the code was not spent by the wait


async def test_the_claim_page_is_a_form_with_a_strict_policy(mantel):
    r = await mantel.get(C.CLAIM_PAGE)
    assert r.status == 200 and r.headers["Cache-Control"] == "no-store"
    csp = r.headers["Content-Security-Policy"]
    assert "script-src 'nonce-" in csp and "default-src 'none'" in csp and "connect-src 'self'" in csp
    text = await r.text()
    assert "Pair This Tablet" in text and "/api/devices/claim" in text


# -- the tablet app's updates ---------------------------------------------------------------------------------------
def publish(mantel, data=b"PK\x03\x04 a fictional apk", name="mantel-0.2.0.apk", **extra):
    folder = mantel.app["cfg"].data_dir / "android"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)
    (folder / "latest.json").write_text(json.dumps({"version_code": 2, "version_name": "0.2.0", "file": name,
                                                    "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                                                    **extra}))
    return data


async def test_a_paired_tablet_reads_its_update(mantel):
    assert (await mantel.get("/apps/android/latest.json")).status == 401     # nobody signed in
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    code = (await make(mantel))[1]["code"]
    mantel.forget_cookies()
    await claim(mantel, code)
    r = await mantel.get("/apps/android/latest.json")
    assert r.status == 404 and (await r.json())["error"] == "no_release"
    data = publish(mantel, secret="never served")
    r = await mantel.get("/apps/android/latest.json")
    got = await r.json()
    assert r.status == 200 and got["version_code"] == 2 and got["file"] == "mantel-0.2.0.apk" and "secret" not in got
    r = await mantel.get("/apps/android/mantel-0.2.0.apk")
    assert r.status == 200 and await r.read() == data
    assert r.headers["Content-Type"] == "application/vnd.android.package-archive"
    # only the file the manifest names, and nothing outside the folder
    (mantel.app["cfg"].data_dir / "android" / "old.apk").write_bytes(b"x")
    assert (await mantel.get("/apps/android/old.apk")).status == 404
    assert (await mantel.get("/apps/android/..%2Fmantel.db")).status == 404
    assert (await mantel.get("/apps/android/mantel-0.2.0.apk", tunnel=True)).status == 401


async def test_a_code_dies_with_its_makers_right_to_add_tablets(mantel):
    uid = await mantel.user("ada", "admin")
    await mantel.sign_in("ada")
    code = (await make(mantel))[1]["code"]
    mantel.store.db.execute("UPDATE users SET role = 'adult' WHERE id = ?", (uid,))
    mantel.store.db.commit()
    mantel.forget_cookies()
    r, body = await claim(mantel, code)
    assert r.status == 403 and body["error"] == "invalid_code"
    assert mantel.store.db.execute("SELECT COUNT(*) FROM devices").fetchone()[0] == 0


async def test_a_browser_that_is_a_tablet_already_is_replaced_not_doubled(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    first, second = (await make(mantel))[1]["code"], (await make(mantel, room="living_room"))[1]["code"]
    mantel.forget_cookies()
    old = (await claim(mantel, first))[1]["device"]["id"]
    r, body = await claim(mantel, second)
    assert r.status == 201 and body["device"]["room"] == "living_room"
    rows = {r_["id"]: r_["revoked_reason"] for r_ in mantel.store.db.execute("SELECT id, revoked_reason FROM devices")}
    assert rows[old] == "replaced" and rows[body["device"]["id"]] is None
    assert [x["action"] for x in audit(mantel)][-2:] == ["device.enroll", "device.revoke"]
