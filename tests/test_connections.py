"""Connections (connections.py): HA and MA set up from the admin page, tested live, sealed, hot-applied.

Everything runs against fake Home Assistant and Music Assistant servers on loopback (fictional tokens,
fictional entities). Nothing here reads ~/.config/mantel or contacts a real house.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from connector_fakes import FakeMa, wait_for
from mantel_server import connections
from mantel_server.atrest import SecretBox
from mantel_server.config import Config
from mantel_server.server import build_app
from mantel_server.store import Store

PASSWORD = "correct horse battery staple"
TOKEN_A = "fictional-ha-token-AAAA-0123456789"
TOKEN_B = "fictional-ha-token-BBBB-9876543210"
INSTALL_TOKEN = "fictional-install-token-CCCC-5555"
MA_TOKEN_A = "fictional-ma-token-AAAA"
MA_TOKEN_B = "fictional-ma-token-BBBB"
SECRETS = (TOKEN_A, TOKEN_B, INSTALL_TOKEN, MA_TOKEN_A, MA_TOKEN_B, "fictional-access", "fictional-refresh",
           "fictional-llat")


class FakeHa:
    """Just enough of Home Assistant: WebSocket auth, who am I, states, registries, the entity subscription,
    get_config, long-lived token creation, and /auth/token (code exchange and revoke)."""

    def __init__(self, tokens, entities=("light.kitchen", "sensor.porch"), user="mantel-server", admin=True,
                 version="2026.10.1") -> None:
        self.tokens = set(tokens)
        self.entities = list(entities)
        self.user, self.admin, self.version = user, admin, version
        self.frames: list[dict] = []
        self.auth_seen: list[str] = []
        self.sockets: list[web.WebSocketResponse] = []
        self.codes: dict[str, tuple[str, str]] = {}
        self.revoked: list[str] = []
        self.llat_names: list[str] = []
        self.server: TestServer | None = None

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/api/websocket", self.ws)
        app.router.add_post("/auth/token", self.token)
        return app

    async def start(self) -> str:
        self.server = TestServer(self.app())
        await self.server.start_server()
        return str(self.server.make_url("")).rstrip("/")

    async def close(self) -> None:
        if self.server is not None:
            await self.server.close()

    def connected(self) -> int:
        return sum(1 for ws in self.sockets if not ws.closed)

    async def token(self, request: web.Request) -> web.Response:
        form = await request.post()
        if form.get("action") == "revoke":
            self.revoked.append(form.get("token"))
            return web.Response(status=200)
        code = form.get("code")
        if form.get("grant_type") != "authorization_code" or code not in self.codes:
            return web.json_response({"error": "invalid_request"}, status=400)
        access, refresh = self.codes.pop(code)
        self.tokens.add(access)
        return web.json_response({"access_token": access, "refresh_token": refresh, "token_type": "Bearer",
                                  "expires_in": 1800})

    async def ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required", "ha_version": self.version})
        first = await ws.receive_json()
        self.auth_seen.append(first.get("access_token"))
        if first.get("access_token") not in self.tokens:
            await ws.send_json({"type": "auth_invalid", "message": "Invalid access token or password"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": self.version})
        self.sockets.append(ws)
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                break
            msg = json.loads(m.data)
            self.frames.append(msg)
            mid, t = msg.get("id"), msg.get("type")

            async def ok(result=None):
                await ws.send_json({"id": mid, "type": "result", "success": True, "result": result})
            if t == "auth/current_user":
                await ok({"id": "ha-user-1", "name": self.user, "is_admin": self.admin, "is_owner": False})
            elif t == "get_states":
                await ok([{"entity_id": e, "state": "on", "attributes": {}} for e in self.entities])
            elif t in ("config/area_registry/list", "config/device_registry/list", "config/entity_registry/list",
                       "config/floor_registry/list"):
                await ok([])
            elif t == "subscribe_events":
                await ok()
            elif t == "subscribe_entities":
                await ok()
                await ws.send_json({"id": mid, "type": "event", "event": {"a": {
                    e: {"s": "on", "a": {"friendly_name": e}, "c": "x", "lc": 1.0, "lu": 1.0} for e in self.entities}}})
            elif t == "get_config":
                await ok({"time_zone": "UTC"})
            elif t == "auth/long_lived_access_token":
                self.llat_names.append(msg.get("client_name"))
                self.tokens.add("fictional-llat")
                await ok("fictional-llat")
            else:
                await ws.send_json({"id": mid, "type": "result", "success": False, "error": {"code": "unknown_command"}})
        return ws


class LoginMa(FakeMa):
    """FakeMa plus Music Assistant 2.7's sign-in: auth/login and auth/token/create."""

    def __init__(self, token, user="mantel", password="fictional ma password") -> None:
        super().__init__(token)
        self.login_user, self.login_password = user, password
        self.created: list[str] = []

    async def ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.connections += 1
        await ws.send_json({"server_id": "fake-ma", "server_version": "2.10.6", "schema_version": 28})
        authed = False
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                break
            msg = json.loads(m.data)
            self.frames.append(msg)
            mid, cmd, args = msg.get("message_id"), msg.get("command"), msg.get("args") or {}
            if cmd == "auth/login":
                if args.get("username") == self.login_user and args.get("password") == self.login_password:
                    await ws.send_json({"message_id": mid, "result": {"success": True, "access_token": "fictional-ma-session",
                                        "user": {"user_id": "u1", "username": self.login_user, "role": "admin"}}})
                else:
                    await ws.send_json({"message_id": mid, "result": {"success": False, "error": "Invalid credentials"}})
                continue
            if cmd == "auth":
                if args.get("token") in (self.token, "fictional-ma-session"):
                    authed = True
                    self.sockets.append(ws)
                    await ws.send_json({"message_id": mid, "result": {"authenticated": True,
                                        "user": {"user_id": "u1", "username": self.login_user, "display_name": "Mantel",
                                                 "role": "admin"}}})
                else:
                    self.auth_failures += 1
                    await ws.send_json({"message_id": mid, "error_code": 20, "details": "Invalid or expired token"})
                continue
            if not authed:
                await ws.send_json({"message_id": mid, "error_code": 20, "details": "Authentication required."})
                continue
            if cmd == "auth/token/create":
                self.created.append(args.get("name"))
                await ws.send_json({"message_id": mid, "result": self.token})
                continue
            await self.answer(ws, mid, cmd, args)
        return ws


async def start_ma(fake) -> tuple[TestServer, str]:
    server = TestServer(fake.app())
    await server.start_server()
    return server, str(server.make_url("")).rstrip("/")


class Env:
    def __init__(self, app, client, store, now, cfg) -> None:
        self.app, self.client, self.store, self.now, self.cfg = app, client, store, now, cfg
        self.bodies: list[str] = []

    def cookie(self, name):
        jar = self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))
        return jar[name].value if name in jar else None

    def h(self, tunnel=False):
        out = {}
        if self.cookie("mantel_csrf"):
            out["X-CSRF-Token"] = self.cookie("mantel_csrf")
        if tunnel:
            out["X-Mantel-Door"] = "tunnel"
        return out

    async def call(self, method, path, body=None, tunnel=False):
        kw = {"headers": self.h(tunnel)}
        if body is not None:
            kw["json"] = body
        r = await self.client.request(method, path, **kw)
        text = await r.text()
        self.bodies.append(text)
        try:
            data = json.loads(text)
        except ValueError:
            data = text
        return r.status, data

    async def user(self, username, role):
        return await self.app["accounts"].create_user(username, username.title(), role, PASSWORD)

    async def sign_in(self, username, tunnel=False):
        r = await self.client.post("/api/auth/password", json={"username": username, "password": PASSWORD},
                                   headers={"X-Mantel-Door": "tunnel"} if tunnel else {})
        assert r.status == 200, await r.text()

    def leaked(self) -> list[str]:
        text = "\n".join(self.bodies)
        return [s for s in SECRETS if s in text]


async def make_env(tmp_path, *, token="", ha_url="", connect_ha=True, token_file=None, ma_url="", ma_token_file=None,
                   app_mode=False, sub="one"):
    cfg = Config(data_dir=tmp_path / sub / "data", secrets_dir=tmp_path / sub / "secrets", port=0, ha_url=ha_url,
                 token_file=token_file or (tmp_path / "no-such-ha-token"), ma_url=ma_url,
                 ma_token_file=ma_token_file or (tmp_path / "no-such-ma-token"), ha_managed_by_app=app_mode)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, token, store=store, connect_ha=connect_ha, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    client = TestClient(TestServer(app))
    await client.start_server()
    client.session.headers["Origin"] = str(client.make_url("")).rstrip("/")
    return Env(app, client, store, now, cfg)


@pytest.fixture
async def envs(tmp_path):
    made: list[Env] = []
    fakes: list = []

    async def factory(**kw):
        e = await make_env(tmp_path, sub=f"m{len(made)}", **kw)
        made.append(e)
        return e
    factory.fakes = fakes
    yield factory
    for e in made:
        await e.client.close()
        e.store.db.close()
    for f in fakes:
        await f.close()


async def fake_ha(envs, *tokens, **kw):
    fake = FakeHa(tokens, **kw)
    url = await fake.start()
    envs.fakes.append(fake)
    return fake, url


async def owner(env, name="avery", tunnel=False):
    await env.user(name, "owner")
    await env.sign_in(name, tunnel=tunnel)


# -- not set up, first run ------------------------------------------------------------------------------
async def test_first_run_runs_without_home_assistant_and_says_so(envs):
    env = await envs()
    await owner(env)
    status, body = await env.call("GET", "/api/connections")
    assert status == 200 and body["can_edit"] is True and body["needs_fresh"] is False
    ha = body["connections"]["ha"]
    assert ha["state"] == "not_set_up" and ha["source"] is None and ha["editable"] is True
    assert ha["live"]["connected"] is False
    assert body["connections"]["ma"]["state"] == "not_set_up"
    _, ov = await env.call("GET", "/api/admin/overview")
    assert ov["ha_set_up"] is False and "connections" in ov["sections"]
    assert env.app["hub"].ha._token == "" and env.app["connections"].ha_token() == ""
    r = await env.client.get("/login/ha", allow_redirects=False)            # Sign in with HA: not yet
    assert r.status == 409 and "not connected yet" in await r.text()


# -- RBAC ------------------------------------------------------------------------------------------------
async def test_who_may_see_and_who_may_change(envs):
    fake, url = await fake_ha(envs, TOKEN_A)
    env = await envs()
    for name, role in (("kid", "child"), ("mom", "adult"), ("boss", "admin")):
        await env.user(name, role)
    await env.user("avery", "owner")
    for name in ("kid", "mom"):
        await env.sign_in(name)
        assert (await env.call("GET", "/api/connections"))[0] == 403
        assert (await env.call("POST", "/api/connections/ha/test", {"url": url, "token": TOKEN_A}))[0] == 403
    await env.sign_in("boss")
    status, body = await env.call("GET", "/api/connections")
    assert status == 200 and body["can_edit"] is False
    for method, path, payload in (("POST", "/api/connections/ha/test", {"url": url, "token": TOKEN_A}),
                                  ("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}),
                                  ("POST", "/api/connections/ha/oauth/start", {"url": url}),
                                  ("DELETE", "/api/connections/ma", None)):
        status, body = await env.call(method, path, payload)
        assert status == 403 and body["error"] == "owner_only", (path, body)
    assert fake.auth_seen == []                                     # nothing was tried on HA's side
    # no CSRF token: refused by the middleware before anything happens
    await env.sign_in("avery")
    r = await env.client.post("/api/connections/ha/test", json={"url": url, "token": TOKEN_A})
    assert r.status == 403 and fake.auth_seen == []


async def test_a_wall_tablet_gets_nothing(envs):
    env = await envs()
    await owner(env)
    status, _ = await env.call("POST", "/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert status == 201
    status, body = await env.call("GET", "/api/connections")
    assert status == 403


async def test_the_tunnel_door_needs_a_fresh_factor(envs):
    fake, url = await fake_ha(envs, TOKEN_A)
    env = await envs()
    uid = await env.user("avery", "owner")
    issued = env.app["sessions"].create(uid, "tunnel", "passkey")
    env.client.session.cookie_jar.update_cookies({"mantel_session": issued.access, "mantel_csrf": issued.csrf},
                                                 response_url=env.client.make_url("/"))
    env.now[0] += 360                                               # the sign-in factor is no longer fresh
    status, body = await env.call("GET", "/api/connections", tunnel=True)
    assert status == 200 and body["can_edit"] is True and body["needs_fresh"] is True
    status, body = await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}, tunnel=True)
    assert status == 403 and body["error"] == "step_up_required" and fake.auth_seen == []
    env.store.db.execute("UPDATE sessions SET fresh_factor_at = ?", (env.now[0],))
    status, body = await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}, tunnel=True)
    assert status == 200, body


def test_the_ha_door_counts_has_sign_in_only_when_the_sidebar_is_trusted():
    from types import SimpleNamespace

    from mantel_server.sessions import Identity, User
    owner_ = User(id="u1", name="Avery", role="owner", kind="ha_linked", username=None, ha_user_id="h1")

    def rule(door, trusted, fresh=None):
        authz = SimpleNamespace(ha_trusted=lambda ident: ident.door == "ha" and trusted)
        req = SimpleNamespace(app={"authz": authz, "clock": lambda: 1000.0})
        return connections.edit_rule(req, Identity(user=owner_, device=None, door=door, fresh_factor_at=fresh))
    assert rule("lan", False) == "ok"
    assert rule("ha", True) == "ok"
    assert rule("ha", False) == "fresh" and rule("ha", False, fresh=990.0) == "ok"
    assert rule("tunnel", True) == "fresh" and rule("tunnel", True, fresh=990.0) == "ok"
    adult = User(id="u2", name="Mom", role="adult", kind="local", username="mom", ha_user_id=None)
    req = SimpleNamespace(app={"authz": None, "clock": lambda: 1000.0})
    assert connections.edit_rule(req, Identity(user=adult, device=None, door="lan")) == "owner_only"


# -- test, save, seal, hot apply ------------------------------------------------------------------------------
def free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def test_a_test_explains_failures_plainly_and_never_echoes_the_token(envs):
    unused_tcp_port = free_port()
    fake, url = await fake_ha(envs, TOKEN_A)
    env = await envs()
    await owner(env)
    cases = [
        ({"url": "homeassistant.local:8123", "token": TOKEN_A}, "url_invalid"),
        ({"url": "ftp://ha.example", "token": TOKEN_A}, "url_invalid"),
        ({"url": "http://user:pw@ha.example", "token": TOKEN_A}, "url_invalid"),
        ({"url": url, "token": ""}, "token_missing"),
        ({"url": url, "token": "two words"}, "token_invalid"),
        ({"url": f"http://127.0.0.1:{unused_tcp_port}", "token": TOKEN_A}, "unreachable"),
        ({"url": url, "token": TOKEN_B}, "token_refused"),
    ]
    for payload, code in cases:
        status, body = await env.call("POST", "/api/connections/ha/test", payload)
        assert status == 422 and body["error"] == code, (payload, body)
        assert body["message"] and TOKEN_A not in body["message"] and TOKEN_B not in body["message"]
    status, body = await env.call("POST", "/api/connections/ha/test", {"url": url + "/", "token": TOKEN_A})
    assert status == 200
    assert body["result"] == {"entities": 2, "user": {"id": "ha-user-1", "name": "mantel-server", "is_admin": True},
                              "version": "2026.10.1"}
    assert body["warnings"] == []
    assert not (env.cfg.connections_dir / "ha.connection").exists()   # a test saves nothing
    assert env.leaked() == []


async def test_save_seals_applies_at_once_and_never_shows_the_token(envs, caplog):
    caplog.set_level(logging.DEBUG)
    fake, url = await fake_ha(envs, TOKEN_A, admin=False)
    env = await envs()
    await owner(env)
    status, body = await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A})
    assert status == 200, body
    saved = body["connection"]
    assert saved["source"] == "mantel" and saved["saved"]["user"]["name"] == "mantel-server"
    assert saved["saved"]["method"] == "token" and saved["saved"]["since"] == env.now[0]
    # the file: 0600 in a 0700 folder, sealed (no token bytes), opens only with the at-rest key and its own label
    path = env.cfg.connections_dir / "ha.connection"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600 and stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    raw = path.read_bytes()
    assert TOKEN_A.encode() not in raw and b"mantel-server" not in raw
    box = SecretBox(env.cfg.secrets_dir / "at_rest.key")
    assert json.loads(box.open(raw, "connection:ha"))["token"] == TOKEN_A
    with pytest.raises(Exception):
        box.open(raw, "connection:ma")
    # hot apply: Mantel's HA connection is up with the new credential, no restart
    hub = env.app["hub"]
    await wait_for(lambda: hub.ha.connected_since is not None and len(hub.store.states) == 2, 5)
    assert env.cfg.ha_url == url and fake.auth_seen[-1] == TOKEN_A
    status, body = await env.call("GET", "/api/connections")
    ha = body["connections"]["ha"]
    assert ha["live"]["connected"] is True and ha["live"]["entities"] == 2 and ha["live"]["version"] == "2026.10.1"
    # audited, without the token
    rows = env.app["audit"].rows(kind="config")
    row = [r for r in rows if r["action"] == "connection.ha.saved"][-1]
    assert url in row["target"] and "mantel-server" in row["target"] and TOKEN_A not in json.dumps(rows)
    # and the token is nowhere a page or a log could see it
    assert env.leaked() == []
    assert not [s for s in SECRETS if s in caplog.text]


async def test_a_non_admin_ha_user_is_saved_with_a_warning(envs):
    fake, url = await fake_ha(envs, TOKEN_A, admin=False)
    env = await envs(connect_ha=False)
    await owner(env)
    status, body = await env.call("POST", "/api/connections/ha/test", {"url": url, "token": TOKEN_A})
    assert status == 200 and any("not an administrator" in w for w in body["warnings"])


async def test_replace_moves_mantel_to_another_home_assistant_and_open_pages_just_reconnect(envs):
    fake_a, url_a = await fake_ha(envs, TOKEN_A, entities=("light.kitchen",))
    fake_b, url_b = await fake_ha(envs, TOKEN_B, entities=("light.loft", "switch.fan"))
    env = await envs()
    await owner(env)
    assert (await env.call("POST", "/api/connections/ha", {"url": url_a, "token": TOKEN_A}))[0] == 200
    hub = env.app["hub"]
    await wait_for(lambda: "light.kitchen" in hub.store.states, 5)
    # a page is connected to Mantel's hub, subscribed to everything
    ws = await env.client.ws_connect("/ws")
    await ws.send_json({"type": "subscribe", "all": True})
    snap = await ws.receive_json(timeout=5)
    while snap.get("type") != "snapshot":
        snap = await ws.receive_json(timeout=5)
    assert "light.kitchen" in snap["entities"]
    # also Mantel's own read connection, used once
    got = await hub.readproxy.request({"type": "get_config"})
    assert got == {"time_zone": "UTC"}
    status, body = await env.call("POST", "/api/connections/ha", {"url": url_b, "token": TOKEN_B})
    assert status == 200, body
    await wait_for(lambda: "light.loft" in hub.store.states and "light.kitchen" not in hub.store.states, 5)
    await wait_for(lambda: fake_a.connected() == 0, 5)               # the old connections are closed
    # the page saw a change, not an error, and its socket is still open
    seen = set()
    while "light.loft" not in seen:
        msg = await ws.receive_json(timeout=5)
        assert msg.get("type") != "error", msg
        seen |= set(msg.get("added") or {}) | set(msg.get("changes") or {}) | set(msg.get("entities") or {})
    assert not ws.closed
    # Mantel's reads now go to the new Home Assistant with the new credential
    assert await hub.readproxy.request({"type": "get_config"}) == {"time_zone": "UTC"}
    assert fake_b.auth_seen.count(TOKEN_B) >= 2 and TOKEN_A not in fake_b.auth_seen
    await ws.close()


async def test_install_file_is_shown_kept_overridden_and_comes_back(envs, tmp_path):
    fake, url = await fake_ha(envs, INSTALL_TOKEN, TOKEN_A)
    token_file = tmp_path / "ha_token"
    token_file.write_text(INSTALL_TOKEN + "\n")
    env = await envs(token=INSTALL_TOKEN, ha_url=url, token_file=token_file)
    await owner(env)
    hub = env.app["hub"]
    await wait_for(lambda: hub.ha.connected_since is not None, 5)
    status, body = await env.call("GET", "/api/connections")
    ha = body["connections"]["ha"]
    assert ha["source"] == "install" and ha["install"]["present"] is True and ha["install"]["file"] == str(token_file)
    assert ha["saved"] is None and ha["url"] == url
    status, body = await env.call("DELETE", "/api/connections/ha")
    assert status == 409 and body["error"] == "set_by_installation"
    # Replace: Mantel's own copy wins (the file is untouched)
    assert (await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}))[0] == 200
    await wait_for(lambda: fake.auth_seen and fake.auth_seen[-1] == TOKEN_A and hub.ha.connected_since is not None, 5)
    _, body = await env.call("GET", "/api/connections")
    assert body["connections"]["ha"]["source"] == "mantel" and body["connections"]["ha"]["install"]["overridden"] is True
    assert token_file.read_text().strip() == INSTALL_TOKEN
    # Disconnect Mantel's copy: back to the installation's file, live
    n = len(fake.auth_seen)
    status, body = await env.call("DELETE", "/api/connections/ha")
    assert status == 200 and body["connection"]["source"] == "install"
    await wait_for(lambda: len(fake.auth_seen) > n and fake.auth_seen[-1] == INSTALL_TOKEN, 5)
    assert not (env.cfg.connections_dir / "ha.connection").exists()
    rows = [r["action"] for r in env.app["audit"].rows(kind="config")]
    assert "connection.ha.saved" in rows and "connection.ha.disconnected" in rows
    assert env.leaked() == []


async def test_disconnect_without_an_install_file_leaves_ha_not_set_up(envs):
    fake, url = await fake_ha(envs, TOKEN_A)
    env = await envs()
    await owner(env)
    assert (await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}))[0] == 200
    hub = env.app["hub"]
    await wait_for(lambda: hub.ha.connected_since is not None, 5)
    status, body = await env.call("DELETE", "/api/connections/ha")
    assert status == 200 and body["connection"]["state"] == "not_set_up"
    await wait_for(lambda: fake.connected() == 0 and hub.ha.connected_since is None, 5)
    assert (await env.call("DELETE", "/api/connections/ha"))[0] == 404


async def test_a_saved_connection_wins_at_the_next_start(envs, tmp_path):
    fake, url = await fake_ha(envs, TOKEN_A)
    env = await envs(connect_ha=False)
    await owner(env)
    assert (await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}))[0] == 200
    # a second server on the same data and secrets, started with another (installation) address and token
    cfg = Config(data_dir=env.cfg.data_dir, secrets_dir=env.cfg.secrets_dir, port=0, ha_url="http://192.0.2.1:8123",
                 token_file=tmp_path / "none")
    store = Store(cfg.data_dir / "mantel.db")
    try:
        app = build_app(cfg, "fictional-old-token", store=store, connect_ha=False)
        assert cfg.ha_url == url and app["hub"].ha._token == TOKEN_A
        assert app["connections"].current("ha").source == "mantel"
    finally:
        store.db.close()


async def test_a_damaged_or_foreign_file_is_reported_not_fatal(envs, tmp_path):
    env = await envs(connect_ha=False)
    folder = env.cfg.connections_dir
    folder.mkdir(parents=True)
    (folder / "ha.connection").write_bytes(b"\x01" + os.urandom(64))
    SecretBox(env.cfg.secrets_dir / "at_rest.key").seal(b"x", "warm-up")      # the key exists
    cfg = Config(data_dir=env.cfg.data_dir, secrets_dir=env.cfg.secrets_dir, port=0, ha_url="", token_file=tmp_path / "x")
    store = Store(cfg.data_dir / "mantel.db")
    try:
        app = build_app(cfg, "", store=store, connect_ha=False)
        conns = app["connections"]
        assert conns.current("ha") is None and "ha" in conns.unreadable
    finally:
        store.db.close()


# -- HA App mode ----------------------------------------------------------------------------------------------
async def test_app_mode_shows_ha_as_provided_and_refuses_to_edit_it(envs, tmp_path):
    fake, url = await fake_ha(envs, INSTALL_TOKEN)
    ma = FakeMa(MA_TOKEN_A)
    server, ma_url = await start_ma(ma)
    try:
        token_file = tmp_path / "app_token"
        token_file.write_text(INSTALL_TOKEN)
        env = await envs(token=INSTALL_TOKEN, ha_url=url, token_file=token_file, app_mode=True, connect_ha=False)
        await owner(env)
        _, body = await env.call("GET", "/api/connections")
        ha = body["connections"]["ha"]
        assert ha["source"] == "app" and ha["editable"] is False and ha["state"] == "set"
        assert body["connections"]["ma"]["editable"] is True
        for method, path, payload in (("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}),
                                      ("POST", "/api/connections/ha/test", {"url": url, "token": TOKEN_A}),
                                      ("POST", "/api/connections/ha/oauth/start", {"url": url}),
                                      ("DELETE", "/api/connections/ha", None)):
            status, body = await env.call(method, path, payload)
            assert status == 409 and body["error"] == "provided_by_app", path
        # Music Assistant stays editable in App mode
        status, body = await env.call("POST", "/api/connections/ma", {"url": ma_url, "token": MA_TOKEN_A})
        assert status == 200, body
        assert not (env.cfg.connections_dir / "ha.connection").exists()
    finally:
        await server.close()


# -- Connect to Home Assistant (OAuth) ------------------------------------------------------------------------
async def test_oauth_flow_makes_a_long_lived_token_and_revokes_the_sign_in(envs):
    fake, url = await fake_ha(envs)
    env = await envs()
    await owner(env)
    status, body = await env.call("POST", "/api/connections/ha/oauth/start", {"url": url})
    assert status == 200
    from urllib.parse import parse_qs, urlparse
    auth = urlparse(body["authorize_url"])
    q = parse_qs(auth.query)
    assert f"{auth.scheme}://{auth.netloc}" == url and auth.path == "/auth/authorize"
    assert q["client_id"] == [env.cfg.client_id]
    assert q["redirect_uri"] == [env.cfg.base_url + "auth/connection/callback"]
    pid = body["pending"]
    status, body = await env.call("GET", f"/api/connections/pending/{pid}")
    assert body["pending"]["state"] == "waiting"
    # the browser signs in at HA as mantel-server and comes back (public route: no session cookie needed)
    fake.codes["fictional-code"] = ("fictional-access", "fictional-refresh")
    if True:
        bad = await env.client.session.get(env.client.make_url("/auth/connection/callback?state=nope&code=x"))
        assert bad.status == 400
        good = await env.client.session.get(env.client.make_url(f"/auth/connection/callback?state={q['state'][0]}&code=fictional-code"),
                                            )
        text = await good.text()
        assert good.status == 200 and f"admin?connection={pid}#connections" in text
        replay = await env.client.session.get(env.client.make_url(f"/auth/connection/callback?state={q['state'][0]}&code=fictional-code"))
        assert replay.status == 400                                   # single use
    status, body = await env.call("GET", f"/api/connections/pending/{pid}")
    p = body["pending"]
    assert p["state"] == "ready" and p["result"]["user"]["name"] == "mantel-server" and p["result"]["entities"] == 2
    assert "fictional-access" not in json.dumps(body) and "fictional-refresh" not in json.dumps(body)
    assert not (env.cfg.connections_dir / "ha.connection").exists()          # nothing saved yet
    # another Owner cannot see or save someone else's pending sign-in
    await env.user("jordan", "owner")
    await env.sign_in("jordan")
    assert (await env.call("GET", f"/api/connections/pending/{pid}"))[0] == 404
    assert (await env.call("POST", "/api/connections/ha", {"pending": pid}))[0] == 404
    await env.sign_in("avery")
    status, body = await env.call("POST", "/api/connections/ha", {"pending": pid})
    assert status == 200, body
    assert body["connection"]["saved"]["method"] == "oauth" and body["connection"]["saved"]["user"]["name"] == "mantel-server"
    assert fake.llat_names and fake.llat_names[0].startswith("Mantel Server (")
    await wait_for(lambda: "fictional-refresh" in fake.revoked, 3)
    box = SecretBox(env.cfg.secrets_dir / "at_rest.key")
    rec = json.loads(box.open((env.cfg.connections_dir / "ha.connection").read_bytes(), "connection:ha"))
    assert rec["token"] == "fictional-llat" and rec["method"] == "oauth"
    hub = env.app["hub"]
    await wait_for(lambda: hub.ha.connected_since is not None and fake.auth_seen[-1] == "fictional-llat", 5)
    assert (await env.call("GET", f"/api/connections/pending/{pid}"))[0] == 404     # spent
    assert env.leaked() == []


async def test_oauth_cancel_and_failure_revoke_and_save_nothing(envs):
    fake, url = await fake_ha(envs)
    env = await envs(connect_ha=False)
    await owner(env)
    _, body = await env.call("POST", "/api/connections/ha/oauth/start", {"url": url})
    from urllib.parse import parse_qs, urlparse
    state = parse_qs(urlparse(body["authorize_url"]).query)["state"][0]
    pid = body["pending"]
    fake.codes["c1"] = ("fictional-access", "fictional-refresh")
    r = await env.client.session.get(env.client.make_url(f"/auth/connection/callback?state={state}&code=c1"))
    assert r.status == 200
    assert (await env.call("DELETE", f"/api/connections/pending/{pid}"))[0] == 200
    await wait_for(lambda: "fictional-refresh" in fake.revoked, 3)
    assert not (env.cfg.connections_dir / "ha.connection").exists()
    # HA refusing the code: an explained error on the page, nothing saved
    _, body = await env.call("POST", "/api/connections/ha/oauth/start", {"url": url})
    state = parse_qs(urlparse(body["authorize_url"]).query)["state"][0]
    r = await env.client.session.get(env.client.make_url(f"/auth/connection/callback?state={state}&code=wrong"))
    assert r.status == 200
    _, got = await env.call("GET", f"/api/connections/pending/{body['pending']}")
    assert got["pending"]["state"] == "error" and got["pending"]["error"]["code"] == "oauth_failed"
    assert (await env.call("POST", "/api/connections/ha", {"pending": body["pending"]}))[0] == 404
    # an expired pending sign-in is gone
    _, body = await env.call("POST", "/api/connections/ha/oauth/start", {"url": url})
    env.now[0] += connections.PENDING_TTL + 1
    assert (await env.call("GET", f"/api/connections/pending/{body['pending']}"))[0] == 404


# -- Music Assistant ------------------------------------------------------------------------------------------
async def test_music_assistant_token_save_builds_the_connector_live_and_replace_retargets_it(envs):
    ma_a, ma_b = FakeMa(MA_TOKEN_A), FakeMa(MA_TOKEN_B)
    sa, url_a = await start_ma(ma_a)
    sb, url_b = await start_ma(ma_b)
    try:
        env = await envs(connect_ha=False)
        await owner(env)
        assert env.app["ma"] is None
        status, body = await env.call("POST", "/api/connections/ma/test", {"url": url_a, "token": MA_TOKEN_B})
        assert status == 422 and body["error"] == "token_refused"
        status, body = await env.call("POST", "/api/connections/ma/test", {"url": url_a, "token": MA_TOKEN_A})
        assert status == 200 and body["result"]["version"] == "2.10.6" and body["result"]["server_id"] == "fake-ma"
        status, body = await env.call("POST", "/api/connections/ma", {"url": url_a, "token": MA_TOKEN_A})
        assert status == 200, body
        client = env.app["ma"]
        assert client is not None
        await asyncio.wait_for(client.connected.wait(), 5)
        assert await client.read("players/all") == [{"player_id": "fake-den", "display_name": "Den", "state": "idle"}]
        # a page's MA read works through the (new) client
        ws = await env.client.ws_connect("/ws")
        await ws.send_json({"type": "ma/read", "id": 1, "command": "players/all", "args": {}})
        msg = await ws.receive_json(timeout=5)
        while msg.get("type") != "ma_result":
            msg = await ws.receive_json(timeout=5)
        assert msg.get("result") or msg.get("error", {}).get("code") == "forbidden"
        # Replace: same client object, now at the other MA with the other token
        events = []
        client.subscribe(lambda ev: events.append(ev["event"]), None)
        status, body = await env.call("POST", "/api/connections/ma", {"url": url_b, "token": MA_TOKEN_B})
        assert status == 200
        assert env.app["ma"] is client
        await wait_for(lambda: ma_b.connections >= 1 and client.connected.is_set() and "mantel_reconnected" in events, 8)
        assert [f["args"]["token"] for f in ma_b.frames if f["command"] == "auth"][-1] == MA_TOKEN_B
        status, body = await env.call("GET", "/api/connections")
        assert body["connections"]["ma"]["live"]["connected"] is True
        # Disconnect: the connector is gone; page reads answer unavailable
        assert (await env.call("DELETE", "/api/connections/ma"))[0] == 200
        assert env.app["ma"] is None
        await ws.send_json({"type": "ma/read", "id": 2, "command": "players/all", "args": {}})
        msg = await ws.receive_json(timeout=5)
        while msg.get("type") != "ma_result":
            msg = await ws.receive_json(timeout=5)
        assert msg["error"]["code"] in ("unavailable", "forbidden")
        await ws.close()
        assert env.leaked() == []
    finally:
        await sa.close()
        await sb.close()


async def test_music_assistant_sign_in_makes_a_token_and_forgets_the_password(envs, caplog):
    caplog.set_level(logging.DEBUG)
    ma = LoginMa(MA_TOKEN_A)
    server, url = await start_ma(ma)
    try:
        env = await envs(connect_ha=False)
        await owner(env)
        status, body = await env.call("POST", "/api/connections/ma/test", {"url": url, "username": "mantel", "password": "nope"})
        assert status == 422 and body["error"] == "login_refused"
        status, body = await env.call("POST", "/api/connections/ma/test",
                                      {"url": url, "username": "mantel", "password": "fictional ma password"})
        assert status == 200 and ma.created == []                       # a test makes no token
        status, body = await env.call("POST", "/api/connections/ma",
                                      {"url": url, "username": "mantel", "password": "fictional ma password"})
        assert status == 200, body
        saved = body["connection"]["saved"]
        assert saved["method"] == "login" and saved["expires"] == env.now[0] + 365 * 86400
        assert ma.created and ma.created[0].startswith("Mantel Server (")
        raw = (env.cfg.connections_dir / "ma.connection").read_bytes()
        rec = json.loads(SecretBox(env.cfg.secrets_dir / "at_rest.key").open(raw, "connection:ma"))
        assert rec["token"] == MA_TOKEN_A and "password" not in json.dumps(rec) and "fictional ma password" not in json.dumps(rec)
        await asyncio.wait_for(env.app["ma"].connected.wait(), 5)
        assert "fictional ma password" not in caplog.text and MA_TOKEN_A not in caplog.text
        assert env.leaked() == [] and not any("fictional ma password" in b for b in env.bodies)
        await env.app["ma"].close()                 # before the fake goes away (its shutdown waits for sockets)
    finally:
        await server.close()


# -- backups ---------------------------------------------------------------------------------------------------
async def test_backups_carry_the_sealed_connections_and_restore_them(envs, tmp_path):
    from mantel_server import backup
    fake, url = await fake_ha(envs, TOKEN_A)
    env = await envs(connect_ha=False)
    await owner(env)
    assert (await env.call("POST", "/api/connections/ha", {"url": url, "token": TOKEN_A}))[0] == 200
    target = tmp_path / "nas"
    target.mkdir()
    key = os.urandom(32)
    made = backup.create_backup(env.cfg.data_dir, target, key)
    assert TOKEN_A.encode() not in made.read_bytes()
    fresh = tmp_path / "restored"
    report = backup.restore(made, key, fresh)
    assert not report.verified_only
    restored = fresh / "connections" / "ha.connection"
    assert restored.read_bytes() == (env.cfg.connections_dir / "ha.connection").read_bytes()
    assert stat.S_IMODE(restored.stat().st_mode) == 0o600 and stat.S_IMODE(restored.parent.stat().st_mode) == 0o700
    box = SecretBox(env.cfg.secrets_dir / "at_rest.key")
    assert json.loads(box.open(restored.read_bytes(), "connection:ha"))["url"] == url


# -- the pages' scripts (no browser: node) --------------------------------------------------------------
STATIC = Path(__file__).resolve().parents[1] / "hosts/server/mantel_server/static"
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_admin_and_login_scripts_parse():
    for rel in ("admin/admin.js", "login/login.js"):
        out = subprocess.run([NODE, "--check", str(STATIC / rel)], capture_output=True, text=True)
        assert out.returncode == 0, out.stderr


def test_the_connections_section_keeps_secrets_out_of_the_page_state():
    js = (STATIC / "admin/admin.js").read_text()
    start = js.index("// Connections: Home Assistant and Music Assistant")
    part = js[start:js.index("// Audit", start)]
    assert "type: 'password'" in part and "autocomplete: 'off'" in part      # never shown, never autofilled
    assert "forget()" in part                                              # cleared after a save
    for banned in ("localStorage", "sessionStorage", "innerHTML", "console.log"):
        assert banned not in part, banned


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_login_page_offers_the_first_start_and_sends_the_owner_to_connections():
    js = (f"const m = await import({json.dumps((STATIC / 'login/login.js').as_uri())});\n"
          """const sent = [];
          const fetchImpl = async (url, init = {}) => {
            sent.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : null]);
            const answer = url.endsWith('/api/bootstrap') && !init.method ? {ok: true, open: true}
              : init.body && JSON.parse(init.body).token === 'good' ? {ok: true, user: {}} : {error: 'bootstrap_token_invalid'};
            return {status: answer.error ? 401 : 200, json: async () => answer};
          };
          const flow = m.signIn({fetchImpl, base: ''});
          const open = await flow.setupOpen();
          const bad = await flow.bootstrap('nope', 'avery', 'Avery', 'a long enough password');
          const good = await flow.bootstrap('good', 'avery', '', 'a long enough password');
          console.log(JSON.stringify({open, bad, good: good.kind, sent}));""")
    out = json.loads(subprocess.run([NODE, "--input-type=module", "-e", js], capture_output=True, text=True,
                                    check=True).stdout)
    assert out["open"] is True and out["good"] == "done"
    assert out["bad"]["kind"] == "error" and "setup code" in out["bad"]["message"]
    assert out["sent"][2] == ["POST", "/api/bootstrap", {"token": "good", "username": "avery", "name": "avery",
                                                          "password": "a long enough password"}]
    html = (STATIC / "login/index.html").read_text()
    assert 'id="setup-form"' in html and "hidden" in html.split('id="setup-form"')[1].split(">")[0]
    assert "admin#connections" in (STATIC / "login/login.js").read_text()


async def test_bootstrap_then_the_admin_page_starts_on_connections(envs):
    env = await envs(connect_ha=False)
    status, body = await env.call("GET", "/api/bootstrap")
    assert body["open"] is True
    token = env.app["accounts"].issue_bootstrap_token()
    r = await env.client.post("/api/bootstrap", json={"token": token, "username": "avery", "name": "Avery",
                                                      "password": PASSWORD})
    assert r.status == 200
    _, ov = await env.call("GET", "/api/admin/overview")
    assert ov["user"]["role"] == "owner" and ov["ha_set_up"] is False and ov["sections"][:2] == ["me", "connections"]
