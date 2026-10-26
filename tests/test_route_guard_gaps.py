"""The gaps Phase 2's route guards closed (guards.py, audit.py), each pinned here.

* Changes that wrote no audit row: sign-in methods added or removed, sessions and service credentials revoked, push
  targets, default screens, the setup guide, the app's devices.
* Rows written after the change (or swallowed when they failed): they are written first now, and no row means no
  change (503 ``audit_unavailable``).
* Routes that let a wall tablet's session through: an Owner or Admin signed in at a tablet gets Me only.

Every name and address here is invented.
"""
from __future__ import annotations

import json

import pytest

from conftest import PASSWORD
from test_accounts import seed_of
from mantel_server.accounts import totp


def rows(mantel, prefix: str) -> list[dict]:
    return [r for r in mantel.app["audit"].rows(kind="config") if r["action"].startswith(prefix)]


def broken_audit(monkeypatch, mantel):
    def broken(event):
        raise RuntimeError("the audit table is gone")
    monkeypatch.setattr(mantel.app["audit"], "config_event", broken)


async def owner(mantel, username="robin"):
    uid = await mantel.user(username, "owner")
    r, _ = await mantel.sign_in(username)
    assert r.status == 200
    return uid


async def at_a_tablet(mantel, role="owner", username="robin"):
    """An Owner (or Admin) signed in, then the browser enrolled as a wall tablet and the person signed in again
    there: the person-at-a-tablet session the guards refuse."""
    await mantel.user(username, role)
    await mantel.sign_in(username)
    r = await mantel.post("/api/devices/enroll", {"name": "Hall tablet"})
    assert r.status == 201, await r.text()
    r, _ = await mantel.sign_in(username)
    assert r.status == 200
    me = await (await mantel.get("/api/session")).json()
    assert me["device"] is not None and me["user"]["role"] == role
    return me


# -- sign-in methods ---------------------------------------------------------------------------------------------
async def test_adding_and_removing_an_authenticator_app_is_audited_first(mantel, monkeypatch):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    seed = seed_of((await (await mantel.post("/api/auth/totp/enroll")).json())["secret"])
    assert rows(mantel, "account.totp") == []                         # starting an enrolment changes nothing
    r = await mantel.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, mantel.now[0])})
    assert r.status == 200
    [row] = rows(mantel, "account.totp")
    assert row["action"] == "account.totp.add" and row["door"] == "lan" and row["source_ip"]
    assert json.loads(row["target"])["username"] == "jordan" and str(seed) not in row["target"]
    broken_audit(monkeypatch, mantel)
    r = await mantel.client.delete("/api/auth/totp", headers=mantel.headers())
    assert r.status == 503 and (await r.json())["error"] == "audit_unavailable"
    assert mantel.app["accounts"].has_totp(mantel.store.db.execute("SELECT id FROM users").fetchone()[0])
    monkeypatch.undo()
    r = await mantel.client.delete("/api/auth/totp", headers=mantel.headers())
    assert r.status == 200 and (await r.json())["removed"] is True
    assert [x["action"] for x in rows(mantel, "account.totp")] == ["account.totp.add", "account.totp.remove"]


async def test_a_wrong_first_code_writes_no_row_and_no_row_means_no_authenticator(mantel, monkeypatch):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    seed = seed_of((await (await mantel.post("/api/auth/totp/enroll")).json())["secret"])
    assert (await mantel.post("/api/auth/totp/enroll/confirm", {"code": "000000"})).status == 400
    assert rows(mantel, "account.totp") == []
    broken_audit(monkeypatch, mantel)
    r = await mantel.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, mantel.now[0])})
    assert r.status == 503
    uid = mantel.store.db.execute("SELECT id FROM users").fetchone()[0]
    assert not mantel.app["accounts"].has_totp(uid)


async def test_adding_and_removing_a_passkey_is_audited_first(mantel, monkeypatch):
    from test_passkeys import SoftAuthenticator, localhost, register
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    broken_audit(monkeypatch, mantel)
    r = await register(mantel, SoftAuthenticator())
    assert r.status == 503 and mantel.store.db.execute("SELECT COUNT(*) FROM passkeys").fetchone()[0] == 0
    monkeypatch.undo()
    r = await register(mantel, SoftAuthenticator(), name="Pocket phone")
    assert r.status == 201
    cred = (await r.json())["id"]
    [row] = rows(mantel, "account.passkey")
    assert row["action"] == "account.passkey.add"
    assert json.loads(row["target"]) == {"user": json.loads(row["target"])["user"], "username": "jordan",
                                         "name": "Jordan", "passkey": "Pocket phone"}
    _, h = localhost(mantel)
    r = await mantel.client.delete(f"/api/auth/passkeys/{cred}", headers={**mantel.headers(), **h})
    assert r.status == 200
    assert [x["action"] for x in rows(mantel, "account.passkey")] == ["account.passkey.add", "account.passkey.remove"]
    assert json.loads(rows(mantel, "account.passkey")[1]["target"])["passkey"] == "Pocket phone"


# -- sessions -----------------------------------------------------------------------------------------------------
async def test_revoking_a_session_is_audited_first(mantel, monkeypatch):
    uid = await mantel.user("jordan", "adult")
    other = mantel.app["sessions"].create(uid, "lan", "password", user_agent="Fictional Phone")
    await mantel.sign_in("jordan")
    broken_audit(monkeypatch, mantel)
    r = await mantel.client.delete(f"/api/sessions/{other.session_id}", headers=mantel.headers())
    assert r.status == 503 and mantel.app["sessions"].from_access(other.access) is not None
    monkeypatch.undo()
    r = await mantel.client.delete(f"/api/sessions/{other.session_id}", headers=mantel.headers())
    assert r.status == 200 and mantel.app["sessions"].from_access(other.access) is None
    [row] = rows(mantel, "session.")
    assert row["action"] == "session.revoke" and row["actor"] == uid
    assert json.loads(row["target"]) == {"session": other.session_id, "user": uid, "own": True}


# -- screens and the setup guide ------------------------------------------------------------------------------------
async def test_default_screens_are_audited_first(mantel, monkeypatch):
    from test_default_screens import boards, put
    boards(mantel, "dashboard-kitchen", "dashboard-loft")
    kid = await mantel.user("kid", "child")
    await owner(mantel)
    assert (await put(mantel, "/api/default-screen", "dashboard-loft")).status == 200
    assert (await put(mantel, f"/api/users/{kid}/default-screen", "dashboard-kitchen")).status == 200
    got = [(r["action"], json.loads(r["target"])) for r in rows(mantel, "default_screen.")]
    me = mantel.store.db.execute("SELECT id FROM users WHERE username = 'robin'").fetchone()[0]
    assert got == [("default_screen.set", {"user": me, "screen": "dashboard-loft"}),
                   ("default_screen.set", {"user": kid, "screen": "dashboard-kitchen"})]
    broken_audit(monkeypatch, mantel)
    r = await put(mantel, "/api/default-screen", "dashboard-kitchen")
    assert r.status == 503
    monkeypatch.undo()
    assert (await (await mantel.get("/api/default-screen")).json())["screen"] == "dashboard-loft"


async def test_the_setup_guide_s_choices_are_audited_first(mantel, monkeypatch):
    from test_setup_guide import put
    await owner(mantel)
    assert (await put(mantel, "/api/setup/steps/people", {"state": "skipped"})).status == 200
    assert (await put(mantel, "/api/setup", {"dismissed": True})).status == 200
    got = [(r["action"], json.loads(r["target"])) for r in rows(mantel, "setup.")]
    assert got == [("setup.step", {"step": "people", "state": "skipped"}), ("setup.dismissed", {"dismissed": True})]
    broken_audit(monkeypatch, mantel)
    assert (await put(mantel, "/api/setup", {"dismissed": False})).status == 503
    monkeypatch.undo()
    assert (await (await mantel.get("/api/setup")).json())["dismissed"] is True


async def test_keypad_pins_are_audited_first_never_the_pin(mantel, monkeypatch):
    kid = await mantel.user("kid", "child")
    await owner(mantel)
    h = mantel.headers()
    assert (await mantel.client.put("/api/account/pin", json={"pin": "482916"}, headers=h)).status == 200
    assert (await mantel.client.delete("/api/account/pin", headers=h)).status == 200
    broken_audit(monkeypatch, mantel)
    assert (await mantel.client.put("/api/account/pin", json={"pin": "482916"}, headers=h)).status == 503
    monkeypatch.undo()
    assert (await (await mantel.get("/api/account/pin")).json())["pin"] is False
    await mantel.app["pins"].set_pin(kid, "731594")
    assert (await mantel.client.delete(f"/api/users/{kid}/pin", headers=h)).status == 200
    got = [r["action"] for r in rows(mantel, "account.pin")]
    assert got == ["account.pin.set", "account.pin.remove", "account.pin.clear"]
    assert "482916" not in json.dumps(mantel.app["audit"].rows())
