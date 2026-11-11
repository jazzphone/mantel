"""The gaps Phase 2's route guards closed (guards.py, audit.py), each pinned here.

* Changes that wrote no audit row: sign-in methods added or removed, sessions and service credentials revoked, push
  targets, default screens, the setup guide, the app's devices.
* Rows written after the change (or swallowed when they failed): they are written first now, and no row means no
  change (503 ``audit_unavailable``).
* Routes that let a wall tablet's session through: an Owner or Admin signed in at a tablet gets Me only.

Every name and address here is invented.
"""
from __future__ import annotations

import re
import json

import pytest

from conftest import PASSWORD  # noqa: F401
from gateway_fakes import off  # noqa: F401 -- fixture
from test_features import make_env  # noqa: F401 -- fixture
from test_accounts import seed_of
from mantel_server.identity.accounts import totp


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


# -- the Alarm PIN: the row before the keypad changes ---------------------------------------------------------------
async def test_an_alarm_pin_saved_by_rest_is_audited_before_it_is_stored(off, monkeypatch):
    from test_alarm_pin import ALARM, HOUSE_CODE, PANEL, add_panel
    add_panel(off)
    await off.login("avery", "owner")
    url = f"/api/alarm/pins/{PANEL}"
    body = {"forward_to": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE}
    broken_audit(monkeypatch, off.m)
    r = await off.m.client.put(url, json=body, headers=off.m.headers())
    assert r.status == 503 and (await r.json())["error"] == "audit_unavailable"
    assert off.app["alarm_pin"].entries() == []
    monkeypatch.undo()
    assert (await off.m.client.put(url, json=body, headers=off.m.headers())).status == 200
    broken_audit(monkeypatch, off.m)
    assert (await off.m.client.delete(url, headers=off.m.headers())).status == 503
    assert off.app["alarm_pin"].entry(PANEL) is not None
    monkeypatch.undo()
    [row] = rows(off.m, "alarm_pin.")
    assert row["action"] == "alarm_pin.set" and json.loads(row["target"]) == {"entity": PANEL,
                                                                            "changed": sorted(body)}
    assert row["door"] == "lan" and not re.search(rf'(?<![0-9a-f]){HOUSE_CODE}(?![0-9a-f])', json.dumps(off.audit()))


async def test_an_alarm_pin_saved_on_the_settings_page_is_audited_before_it_is_stored(off, monkeypatch):
    from test_alarm_pin import ALARM, HOUSE_CODE
    from test_alarm_pin_page import only_alarm, save, NoHa
    only_alarm(off)
    off.app["hub"].readproxy = NoHa()
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    broken_audit(monkeypatch, off.m)
    got = await save(ws, 2, {"type": "hk_alarm_pin/add", "alarm": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE})
    assert got["error"]["code"] == "audit_unavailable"
    assert off.app["alarm_pin"].entries() == []
    monkeypatch.undo()
    got = await save(ws, 3, {"type": "hk_alarm_pin/add", "alarm": ALARM, "pin": HOUSE_CODE, "pin_again": HOUSE_CODE})
    (a,) = got["result"]["alarms"]
    broken_audit(monkeypatch, off.m)
    got = await save(ws, 4, {"type": "hk_alarm_pin/settings/set", "entry_id": a["panel"],
                             "changes": {"pin": "97531", "pin_again": "97531"}})
    assert got["error"]["code"] == "audit_unavailable"
    assert await off.app["alarm_pin"].house_matches(a["panel"], HOUSE_CODE)
    monkeypatch.undo()
    [row] = rows(off.m, "alarm_pin.")
    assert row["action"] == "alarm_pin.add" and row["door"] == "lan"
    await ws.close()


# -- the HA App's wall tablets and people page ----------------------------------------------------------------------
async def test_linking_and_unlinking_a_wall_tablet_is_audited_before_it_changes(tmp_path, monkeypatch):
    from mantel_server import ingress
    from test_ingress_tablets import TABLET_HA, make, owner_page
    m = await make(tmp_path, monkeypatch)
    try:
        origin = await owner_page(m)
        h = {**m.ha(), **origin, "X-CSRF-Token": m.jar["mantel_csrf"]}
        devices = m.store.db.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
        broken_audit(monkeypatch, m)
        r = await m.request("POST", "/api/ingress/tablets", h, json={"ha_user_id": TABLET_HA, "room": "kitchen"})
        assert r.status == 503 and ingress.tablet_link(m.store.db, TABLET_HA) is None
        assert m.store.db.execute("SELECT COUNT(*) FROM devices").fetchone()[0] == devices    # no device made either
        monkeypatch.undo()
        r = await m.request("POST", "/api/ingress/tablets", h, json={"ha_user_id": TABLET_HA, "room": "kitchen"})
        assert r.status == 201
        broken_audit(monkeypatch, m)
        r = await m.request("DELETE", f"/api/ingress/tablets/{TABLET_HA}", h)
        assert r.status == 503 and ingress.tablet_link(m.store.db, TABLET_HA) is not None
        monkeypatch.undo()
        [row] = rows(m, "ingress.")
        assert row["action"] == "ingress.link_tablet" and row["door"] == "ha" and row["source_ip"]
        detail = json.loads(row["target"])
        assert detail["room"] == "kitchen" and detail["new_device"] is True
        assert detail["device_id"] == ingress.tablet_link(m.store.db, TABLET_HA)["id"]
    finally:
        await m.client.close()
        m.store.db.close()


async def test_the_ingress_people_page_refuses_an_owner_at_a_wall_tablet(tmp_path, monkeypatch):
    """An Owner's session with a wall tablet's device beside it (a person at a tablet): Me only, as everywhere."""
    from mantel_server.identity import sessions
    from test_ingress_tablets import PAGE, TABLET_HA, make, owner_page, owner_user
    from mantel_server import ingress
    m = await make(tmp_path, monkeypatch)
    try:
        await owner_page(m)
        ingress.link_tablet(m.app, TABLET_HA, owner_user(m), room="kitchen")
        row = ingress.tablet_link(m.store.db, TABLET_HA)
        at_tablet = sessions.Identity(user=owner_user(m), door="ha", csrf="fictional-csrf",
                                      device=sessions.Device(row["id"], row["name"], row["role"], row["room"]))
        monkeypatch.setattr(sessions, "identity", lambda request: at_tablet)
        r = await m.request("GET", "/ingress/people", {**m.ha(), **PAGE})
        assert r.status == 403
        r = await m.request("GET", "/api/ingress/tablets", m.ha())
        assert r.status == 403
    finally:
        await m.client.close()
        m.store.db.close()


# -- Mantel Photos and Your Files: the row first, and no row no change (they were written after, failures swallowed)
async def test_mantel_photos_changes_are_audited_before_they_are_made(mantel, monkeypatch):
    import io
    from PIL import Image
    from test_photos import upload
    await owner(mantel)
    broken_audit(monkeypatch, mantel)
    r = await mantel.post("/api/photos/albums", {"name": "Fictional Holiday"})
    assert r.status == 503 and mantel.app["photos"].albums() == []
    monkeypatch.undo()
    aid = (await (await mantel.post("/api/photos/albums", {"name": "Fictional Holiday"})).json())["album"]["id"]
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 140, 200)).save(buf, "JPEG")
    broken_audit(monkeypatch, mantel)
    r, _ = await upload(mantel, aid, buf.getvalue())
    assert r.status == 503 and mantel.app["photos"].count() == 0
    assert not any(mantel.app["photos"].root.rglob("*.jpg"))
    r = await mantel.client.put("/api/photos/limits", json={"file_mb": 2}, headers=mantel.headers())
    assert r.status == 503 and mantel.app["photos"].limits()["file_mb"] != 2
    monkeypatch.undo()
    assert [r["action"] for r in rows(mantel, "photos.")] == ["photos.album.create"]
    assert rows(mantel, "photos.")[0]["door"] == "lan"


async def test_your_files_changes_are_audited_before_they_are_written(mantel, monkeypatch):
    from test_user_files import dummy_sfnt, upload
    await owner(mantel)
    broken_audit(monkeypatch, mantel)
    r = await upload(mantel, "font", dummy_sfnt(), "Fictional.ttf")
    assert r.status == 503 and not (mantel.app["user_files"].hk / "fonts" / "Fictional.ttf").exists()
    monkeypatch.undo()
    assert (await upload(mantel, "font", dummy_sfnt(), "Fictional.ttf")).status == 201
    broken_audit(monkeypatch, mantel)
    r = await mantel.client.delete("/api/user-files/font/Fictional.ttf", headers=mantel.headers())
    assert r.status == 503 and (mantel.app["user_files"].hk / "fonts" / "Fictional.ttf").exists()
    monkeypatch.undo()
    assert [r["action"] for r in rows(mantel, "user_files.")] == ["user_files.upload.font"]


# -- notifications and the Mantel apps ------------------------------------------------------------------------------
async def test_push_targets_are_audited_first_never_their_endpoint(mantel, monkeypatch):
    from test_push import GOOD, subscription
    await mantel.user("ann", "adult")
    await mantel.sign_in("ann")
    _, sub = subscription()
    broken_audit(monkeypatch, mantel)
    r = await mantel.post("/api/push/web/subscribe", {"subscription": sub, "name": "Fictional Phone"})
    assert r.status == 503 and mantel.app["pusher"].targets.everyone() == []
    monkeypatch.undo()
    assert (await mantel.post("/api/push/web/subscribe", {"subscription": sub, "name": "Fictional Phone"})).status == 201
    tid = (await (await mantel.get("/api/push/targets")).json())["targets"][0]["id"]
    broken_audit(monkeypatch, mantel)
    assert (await mantel.client.delete(f"/api/push/targets/{tid}", headers=mantel.headers())).status == 503
    assert (await mantel.post("/api/push/web/unsubscribe", {"endpoint": GOOD})).status == 503
    assert len(mantel.app["pusher"].targets.everyone()) == 1
    monkeypatch.undo()
    assert (await mantel.post("/api/push/web/unsubscribe", {"endpoint": GOOD})).status == 200
    got = [(r["action"], json.loads(r["target"])) for r in rows(mantel, "push.")]
    assert got == [("push.subscribe", {"kind": "web", "name": "Fictional Phone", "service": "web.push.apple.com"}),
                   ("push.unsubscribe", {"target": tid, "kind": "web", "name": "Fictional Phone"})]
    assert GOOD not in json.dumps(mantel.app["audit"].rows()) and sub["keys"]["auth"] not in json.dumps(got)


async def test_revoking_a_signed_in_app_is_audited_first(mantel, monkeypatch):
    from test_app_auth import sign_in_app
    phone, tok = await sign_in_app(mantel)
    broken_audit(monkeypatch, mantel)
    r = await mantel.client.delete(f"/api/app/devices/{tok['credential_id']}", headers=mantel.headers())
    assert r.status == 503 and (await phone.call("GET", "/api/app/me"))[0].status == 200
    monkeypatch.undo()
    assert (await mantel.client.delete(f"/api/app/devices/{tok['credential_id']}", headers=mantel.headers())).status == 200
    [row] = rows(mantel, "app.")
    assert row["action"] == "app.revoke" and json.loads(row["target"])["app"] == tok["credential_id"]
    assert json.loads(row["target"])["name"] == "Ann's iPhone"


# -- Service credentials, Mantel Link pairing, Mantel Connect ---------------------------------------------------------
async def test_making_and_revoking_a_service_credential_is_audited_first(mantel, monkeypatch):
    await owner(mantel)
    broken_audit(monkeypatch, mantel)
    r = await mantel.post("/api/service-accounts", {"name": "home-assistant", "scopes": ["linked"]})
    assert r.status == 503 and mantel.app["service_accounts"].list() == []
    monkeypatch.undo()
    r = await mantel.post("/api/service-accounts", {"name": "home-assistant", "scopes": ["linked"]})
    assert r.status == 201
    body = await r.json()
    aid = body["account"]["id"]
    broken_audit(monkeypatch, mantel)
    assert (await mantel.client.delete(f"/api/service-accounts/{aid}", headers=mantel.headers())).status == 503
    assert mantel.app["service_accounts"].verify(body["token"], "linked") is not None
    monkeypatch.undo()
    assert (await mantel.client.delete(f"/api/service-accounts/{aid}", headers=mantel.headers())).status == 200
    got = [(r["action"], json.loads(r["target"])) for r in rows(mantel, "service_account.")]
    assert got == [("service_account.create", {"account": aid, "name": "home-assistant", "scopes": ["linked"]}),
                   ("service_account.revoke", {"account": aid, "name": "home-assistant"})]
    assert body["token"] not in json.dumps(mantel.app["audit"].rows())


async def test_mantel_link_pairing_writes_its_rows_first(make_env, monkeypatch):
    from test_linked_pairing import body_for, pair
    env = await make_env()
    await env.login("owner1", "owner")
    broken_audit(monkeypatch, env.m)
    r = await env.m.client.post("/api/linked/pair", headers=env.m.headers())
    assert r.status == 503 and env.app["linked_pairing"].pending() is None
    monkeypatch.undo()
    code = (await (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).json())["code"]
    body, _key, _nonce = body_for(code)
    broken_audit(monkeypatch, env.m)
    r = await pair(env, body)
    assert r.status == 503 and env.app["service_accounts"].list() == []
    monkeypatch.undo()
    assert [r["action"] for r in rows(env.m, "linked.pair")] == ["linked.pair_start"]


async def test_revoking_a_connect_pairing_is_audited_first(tmp_path, monkeypatch):
    from aiohttp.test_utils import TestClient, TestServer
    from conftest import Mantel
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    from argon2 import PasswordHasher
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, connect=True, ingress=True,
                 ingress_peers=(), ha_door_rules="trusted")
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: 1_000_000.0)
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        m = Mantel(app, client, store, [1_000_000.0], origin)
        await owner(m)
        pid = "ab" * 8
        store.db.execute("INSERT INTO connect_pairings (id, name, created, cert_fp, cert_expires) VALUES (?,?,?,?,?)",
                         (pid, "Fictional Home Assistant", 1_000_000.0, "f" * 64, 1_001_000.0))
        broken_audit(monkeypatch, m)
        r = await client.delete(f"/api/connect/pairings/{pid}", headers=m.headers())
        assert r.status == 503
        assert store.db.execute("SELECT revoked FROM connect_pairings").fetchone()[0] is None
        monkeypatch.undo()
        assert (await client.delete(f"/api/connect/pairings/{pid}", headers=m.headers())).status == 200
        [row] = rows(m, "connect.revoke")
        assert json.loads(row["target"])["pairing"] == pid and row["door"] == "lan"
    store.db.close()


async def test_connect_is_managed_where_service_credentials_are_a_trusted_sidebar_too(tmp_path, monkeypatch):
    """connect_pairing's Owner rule is service_accounts' (authz.home_door): the LAN door, or HA's sidebar with the
    home rules (the HA App has no LAN door). The tunnel and an untrusted sidebar stay refused."""
    from aiohttp.test_utils import TestClient, TestServer
    from mantel_server.identity import sessions
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    for rules, door, status in (("trusted", "ha", 200), ("tunnel", "ha", 403), ("trusted", "tunnel", 403)):
        cfg = Config(data_dir=tmp_path / rules / door / "data", secrets_dir=tmp_path / rules / door / "secrets",
                     port=0, connect=True, ingress=True, ingress_peers=(), ha_door_rules=rules)
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: 1_000_000.0)
        boss = sessions.User(id="f" * 32, name="Fictional Owner", role="owner", kind="hk")
        monkeypatch.setattr(sessions, "identity",
                            lambda request, d=door: sessions.Identity(user=boss, device=None, door=d))
        async with TestClient(TestServer(app)) as client:
            assert (await client.get("/api/connect")).status == status, (rules, door)
            assert (await client.get("/api/service-accounts")).status == status, (rules, door)
        monkeypatch.undo()
        store.db.close()


# -- a wall tablet's session is refused -------------------------------------------------------------------------------
@pytest.mark.parametrize("method,path", [
    ("GET", "/api/rbac/grants"), ("GET", "/api/rbac/roles"), ("POST", "/api/rbac/grants"),
    ("GET", "/api/features/status"), ("GET", "/api/features/settings"), ("PUT", "/api/features/settings"),
    ("GET", "/api/settings/import"), ("POST", "/api/settings/import"), ("GET", "/api/live_tv/status"),
])
async def test_an_owner_signed_in_at_a_wall_tablet_gets_me_only(mantel, method, path):
    await at_a_tablet(mantel)
    r = await mantel.client.request(method, path, json={}, headers=mantel.headers())
    assert r.status == 403, (path, r.status, await r.text())
