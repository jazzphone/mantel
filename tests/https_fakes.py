"""Fakes for the HTTPS / proxy tests: a full Mantel app whose socket peer a test chooses (the aiohttp test
client always connects from 127.0.0.1), and fictional Music Assistant and go2rtc upstreams that record
what reached them. No real service is contacted."""
from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass, field

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

PASSWORD = "correct horse battery staple"
TEST_PEER = "X-Test-Peer"          # read ONLY by the fake-peer middleware below, never by Mantel


@web.middleware
async def fake_peer(request: web.Request, handler):
    """Stand-in for the network: the socket peer is whatever the test says (X-Test-Peer), as if the
    request had come from that address. Set on the request object itself (aiohttp's cached `remote`,
    what .clone(remote=) sets), so the response hooks, which get this same object, see it too."""
    peer = request.headers.get(TEST_PEER)
    if peer:
        request._cache["remote"] = peer
    return await handler(request)


# -- fictional upstreams ------------------------------------------------------------------------------
MA_USERS = {"page-token-user": {"user_id": "u1", "username": "listener", "display_name": "Listener", "role": "user"},
            "admin-token": {"user_id": "u0", "username": "admin", "display_name": "Admin", "role": "admin"}}


@dataclass
class Upstream:
    hits: list = field(default_factory=list)       # (method, path_qs, headers dict, body bytes)
    server: TestServer | None = None
    commands: list = field(default_factory=list)   # MA socket commands received
    revoked: set = field(default_factory=set)      # tokens MA no longer accepts
    sent: int = 0                                  # go2rtc's mjpeg stand-in: chunks written to the viewer
    cut: bool = False                              # ...and whether the viewer's side was dropped

    @property
    def url(self) -> str:
        return str(self.server.make_url("/")).rstrip("/")

    def paths(self) -> list[str]:
        return [h[1] for h in self.hits]


def ma_app(up: Upstream) -> web.Application:
    app = web.Application()

    async def record(request: web.Request) -> bytes:
        body = await request.read()
        up.hits.append((request.method, request.path_qs, dict(request.headers), body))
        return body

    async def index(request):
        await record(request)
        html = (f"<!doctype html><html><head><base href='./'><script>window.MA_SERVER='{up.url}';</script>"
                f"<script type=module src='./assets/app.js'></script></head><body>Music Assistant "
                f"<img src='{up.url}/imageproxy?path=x'></body></html>")
        return web.Response(text=html, content_type="text/html",
                            headers={"Set-Cookie": "ma_session=fictional; Path=/", "Server": "FictionalMA/1.0",
                                     "Content-Security-Policy": "default-src *", "X-Frame-Options": "DENY"})

    async def asset(request):
        await record(request)
        return web.Response(text="export const ok = 1;", content_type="application/javascript")

    async def image(request):
        await record(request)
        return web.Response(body=b"\x89PNG fictional", content_type="image/png")

    async def info(request):
        await record(request)
        return web.json_response({"server_id": "fictional", "base_url": up.url, "server_version": "2.7.0"})

    async def api(request):
        await record(request)
        return web.json_response({"result": "the JSON-RPC API must never be reached"})

    async def login(request):
        body = await record(request)
        if request.method == "POST":
            return web.json_response({"posted": body.decode()})
        raise web.HTTPFound(f"{up.url}/#/login-done")

    async def away(request):
        await record(request)
        raise web.HTTPFound("https://elsewhere.example/steal")

    async def ws(request):
        await record(request)
        sock = web.WebSocketResponse()
        await sock.prepare(request)
        await sock.send_str(json.dumps({"server_id": "fictional", "base_url": "http://192.0.2.30:8095",
                                        "server_version": "2.7.0", "homeassistant_addon": False}))
        user = None
        async for m in sock:
            if m.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                msg = json.loads(m.data)
            except ValueError:
                msg = {}
            cmd, mid = msg.get("command"), msg.get("message_id")
            up.commands.append(cmd)
            if cmd == "auth":                       # MA 2.7's socket sign-in with a token
                token = (msg.get("args") or {}).get("token")
                who = MA_USERS.get(token) if token not in up.revoked else None
                if who is not None:
                    user = who
                await sock.send_str(json.dumps({"message_id": mid, "result": {"authenticated": who is not None,
                                                                                **({"user": who} if who else {})}}))
            elif cmd == "auth/me":
                await sock.send_str(json.dumps({"message_id": mid, **({"result": user} if user else
                                                                       {"error_code": 401, "details": "unauthenticated"})}))
            elif cmd == "auth/login":
                args = msg.get("args") or {}
                good = args.get("username") == "listener" and args.get("password") == "fictional-pass"
                await sock.send_str(json.dumps({"message_id": mid, "result": {"success": good, **(
                    {"access_token": "session-of-listener", "user": MA_USERS["page-token-user"]} if good else {})}}))
                if good:
                    MA_USERS["session-of-listener"] = MA_USERS["page-token-user"]
            elif cmd == "auth/token/create":
                await sock.send_str(json.dumps({"message_id": mid, "result": "page-token-user"}))
            else:
                await sock.send_str(json.dumps({"echo": m.data, "img": "http://192.0.2.30:8095/imageproxy?x=1"}))
        return sock

    app.router.add_get("/", index)
    app.router.add_get("/index.html", index)
    app.router.add_get("/assets/{name}", asset)
    app.router.add_get("/imageproxy", image)
    app.router.add_get("/imageproxy/{image_id}", image)
    app.router.add_get("/info", info)
    app.router.add_route("*", "/api", api)
    app.router.add_route("*", "/login", login)
    app.router.add_get("/away.json", away)
    app.router.add_get("/ws", ws)
    return app


def go2rtc_app(up: Upstream) -> web.Application:
    app = web.Application()

    async def record(request: web.Request) -> bytes:
        body = await request.read()
        up.hits.append((request.method, request.path_qs, dict(request.headers), body))
        return body

    async def ws(request):
        await record(request)
        sock = web.WebSocketResponse()
        await sock.prepare(request)
        async for m in sock:
            if m.type == aiohttp.WSMsgType.TEXT:
                await sock.send_str(json.dumps({"type": "webrtc/answer", "src": request.query.get("src"),
                                                "got": m.data}))
            elif m.type == aiohttp.WSMsgType.BINARY:
                await sock.send_bytes(m.data[::-1])
        return sock

    async def webrtc(request):
        body = await record(request)
        return web.Response(text="v=0 answer for " + body.decode(), content_type="application/sdp", status=201)

    async def frame(request):
        await record(request)
        return web.Response(body=b"\xff\xd8 fictional jpeg", content_type="image/jpeg")

    async def mjpeg(request):
        """A camera's stream: a chunk every 50 ms until the viewer leaves (or 20 s: a test that forgets to close)."""
        await record(request)
        resp = web.StreamResponse(headers={"Content-Type": "multipart/x-mixed-replace; boundary=frame"})
        await resp.prepare(request)
        up.sent = 0
        try:
            for _ in range(400):
                await resp.write(b"--frame\r\nfictional jpeg\r\n")
                up.sent += 1
                await asyncio.sleep(0.05)
        except (ConnectionResetError, asyncio.CancelledError):
            up.cut = True
            raise
        return resp

    async def m3u8(request):
        """go2rtc's master playlist: an HLS session id of its own for this stream."""
        await record(request)
        sid = "sess" + hashlib.sha1(request.query.get("src", "").encode()).hexdigest()[:12]
        return web.Response(text=f"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhls/playlist.m3u8?id={sid}\n",
                            content_type="application/vnd.apple.mpegurl")

    async def hls(request):
        await record(request)
        return web.Response(body=b"fictional segment", content_type="video/mp2t")

    async def anything(request):
        await record(request)
        return web.json_response({"must": "never be reached"})

    app.router.add_get("/api/ws", ws)
    app.router.add_get("/api/stream.mjpeg", mjpeg)
    app.router.add_get("/api/stream.m3u8", m3u8)
    app.router.add_get("/api/hls/{name}", hls)
    app.router.add_post("/api/webrtc", webrtc)
    app.router.add_get("/api/frame.jpeg", frame)
    app.router.add_get("/video-stream.js", frame)
    app.router.add_route("*", "/{tail:.*}", anything)
    return app


async def start_upstream(make) -> Upstream:
    up = Upstream()
    up.server = TestServer(make(up))
    await up.server.start_server()
    return up


# -- Mantel ---------------------------------------------------------------------------------------------
@dataclass
class M:
    app: web.Application
    client: TestClient
    store: object
    now: list
    origin: str

    def cookie(self, name):
        jar = self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))
        return jar[name].value if name in jar else None

    def csrf(self):
        return {"X-CSRF-Token": self.cookie("mantel_csrf")} if self.cookie("mantel_csrf") else {}

    async def user(self, username, role):
        return await self.app["accounts"].create_user(username, username.title(), role, PASSWORD)

    async def sign_in(self, username, headers=None):
        r = await self.client.post("/api/auth/password", json={"username": username, "password": PASSWORD},
                                   headers=headers or {})
        assert r.status == 200, await r.text()
        return await r.json()

    async def as_role(self, role, username=None):
        name = username or role
        await self.user(name, role)
        self.client.session.cookie_jar.clear()
        return await self.sign_in(name)


async def make_mantel(tmp_path, monkeypatch, app_items: dict | None = None, **cfg_kw) -> M:
    from mantel_server.config import Config
    from mantel_server.ha.ha_client import HaClient
    from mantel_server.ha.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("these tests attempted to reach Home Assistant")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, **cfg_kw)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app.middlewares.insert(0, fake_peer)
    app.update(app_items or {})
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    client = TestClient(TestServer(app))
    await client.start_server()
    origin = str(client.make_url("")).rstrip("/")
    client.session.headers["Origin"] = origin
    return M(app, client, store, now, origin)
