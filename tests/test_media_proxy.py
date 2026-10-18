"""Music Assistant's web app and go2rtc under Mantel's own address (media_proxy.py): sign-in and RBAC first,
only the allowlisted paths, WebSockets, nothing of the upstream (address, cookies, headers) reaching the
page, the Ingress prefix. Fictional upstreams only (tests/https_fakes.py)."""
from __future__ import annotations

import asyncio
import json

import aiohttp
import pytest

from mantel_server import media_proxy
from https_fakes import go2rtc_app, ma_app, make_mantel, start_upstream


@pytest.fixture
async def env(tmp_path, monkeypatch):
    ma = await start_upstream(ma_app)
    g2 = await start_upstream(go2rtc_app)
    m = await make_mantel(tmp_path, monkeypatch, ma_web_url=ma.url + "/", go2rtc_url=g2.url)
    yield m, ma, g2
    await m.client.close()
    await ma.server.close()
    await g2.server.close()
    m.store.db.close()


FORBIDDEN_UPSTREAM_HEADERS = ("Cookie", "Authorization", "Origin", "X-Forwarded-For", "X-Forwarded-Host",
                              "X-Forwarded-Proto", "X-Mantel-Door", "X-CSRF-Token", "X-Remote-User-Id")


async def test_music_assistant_is_served_same_origin_with_nothing_of_the_upstream(env):
    m, ma, _ = env
    await m.as_role("owner")
    r = await m.client.get("/ma/", headers={"Authorization": "Bearer fictional", "X-Forwarded-For": "203.0.113.9"})
    text = await r.text()
    assert r.status == 200 and "Music Assistant" in text
    # the upstream's address is gone from the page, replaced by Mantel's own /ma
    assert ma.url not in text and f"{m.origin}/ma/imageproxy?path=x" in text and f"'{m.origin}/ma'" in text
    # its cookies, server name and own policy do not come through; Mantel's MA policy does
    assert "Set-Cookie" not in r.headers or "ma_session" not in r.headers.get("Set-Cookie", "")
    assert "FictionalMA" not in r.headers.get("Server", "") and "X-Frame-Options" not in r.headers
    csp = r.headers["Content-Security-Policy"]
    assert "frame-ancestors 'self'" in csp and "default-src *" not in csp and "'unsafe-eval'" not in csp
    # what reached MA: no Mantel cookie, credential, origin or forwarding header
    method, path, headers, _ = ma.hits[-1]
    assert method == "GET" and path == "/"
    for h in FORBIDDEN_UPSTREAM_HEADERS:
        assert h not in headers, h
    # an asset and the image proxy pass (binary untouched)
    assert (await m.client.get("/ma/assets/app.js")).status == 200
    r = await m.client.get("/ma/imageproxy?path=x&size=200")
    assert r.status == 200 and await r.read() == b"\x89PNG fictional"
    assert ma.hits[-1][1] == "/imageproxy?path=x&size=200"
    # the bare prefix goes to the app
    r = await m.client.get("/ma", allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/ma/"


async def test_json_answers_have_mas_announced_address_replaced(env):
    m, ma, _ = env
    await m.as_role("owner")
    body = await (await m.client.get("/ma/info")).json()
    assert body["base_url"] == f"{m.origin}/ma"


async def test_signed_out_and_unpermitted_people_never_reach_the_upstream(env):
    m, ma, g2 = env
    m.client.session.cookie_jar.clear()
    for path in ("/ma/", "/ma/assets/app.js", "/go2rtc/api/frame.jpeg?src=camera.front"):
        r = await m.client.get(path)
        assert r.status == 401, path
    assert ma.hits == [] and g2.hits == []
    # a guest has no music: MA is refused; a child has the Music page: allowed
    await m.as_role("guest")
    r = await m.client.get("/ma/")
    assert r.status == 403 and (await r.json()) == {"error": "forbidden", "service": "Music Assistant"}
    assert ma.hits == []
    await m.as_role("child")
    assert (await m.client.get("/ma/")).status == 200


@pytest.mark.parametrize("method,path", [
    ("GET", "/ma/api"), ("POST", "/ma/api"), ("GET", "/ma/api/players"), ("GET", "/ma/api-docs"),
    ("GET", "/ma/..%2F..%2Fetc/passwd"), ("GET", "/ma/assets/../../secret.js"), ("GET", "/ma/assets//x.js"),
    ("GET", "/ma/somewhere"), ("DELETE", "/ma/"), ("PUT", "/ma/login"), ("GET", "/ma/ws"),
    ("GET", "/go2rtc/"), ("GET", "/go2rtc/api"), ("GET", "/go2rtc/api/streams"), ("PUT", "/go2rtc/api/streams?src=x"),
    ("DELETE", "/go2rtc/api/streams?src=x"), ("GET", "/go2rtc/api/config"), ("POST", "/go2rtc/api/restart"),
    ("POST", "/go2rtc/api/exit"), ("GET", "/go2rtc/api/log"), ("GET", "/go2rtc/editor.html"),
    ("GET", "/go2rtc/api/frame.jpeg"), ("GET", "/go2rtc/api/frame.jpeg?src=bad%20name"),
    ("GET", "/go2rtc/api/frame.jpeg?src=camera.front&src=camera.back"),
    ("GET", "/go2rtc/api/frame.jpeg?src=camera.front&url=http://evil"),
    ("POST", "/go2rtc/api/webrtc?dst=camera.front"), ("GET", "/go2rtc/api/ws?src=camera.front"),
    ("GET", "/go2rtc/api/hls/segment.ts?id=../x"),
])
async def test_only_the_allowlisted_paths_exist(env, method, path):
    m, ma, g2 = env
    await m.as_role("owner")
    r = await m.client.request(method, path, headers=m.csrf(), allow_redirects=False)
    assert r.status == 404, (method, path, r.status)
    assert ma.hits == [] and g2.hits == []


async def test_ma_websocket_relays_both_ways_with_the_address_replaced(env):
    m, ma, _ = env
    await m.as_role("owner")
    async with m.client.ws_connect("/ma/ws") as ws:
        hello = json.loads((await ws.receive(timeout=5)).data)
        assert hello["base_url"] == f"{m.origin}/ma"          # MA's announced address, replaced
        await ws.send_str(json.dumps({"command": "players/all", "message_id": 1}))
        echo = json.loads((await ws.receive(timeout=5)).data)
        assert json.loads(echo["echo"])["command"] == "players/all"
        assert echo["img"] == f"{m.origin}/ma/imageproxy?x=1"
    headers = ma.hits[-1][2]
    for h in FORBIDDEN_UPSTREAM_HEADERS:
        assert h not in headers, h


async def test_sockets_need_an_origin(env):
    m, ma, _ = env
    await m.as_role("owner")
    del m.client.session.headers["Origin"]
    r = await m.client.get("/ma/ws", headers={"Upgrade": "websocket", "Connection": "Upgrade",
                                              "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="})
    assert r.status == 403
    assert ma.hits == []


async def test_a_socket_closes_when_the_session_ends(env, monkeypatch):
    m, _, _ = env
    monkeypatch.setattr(media_proxy, "RECHECK", 0.05)
    await m.as_role("owner")
    async with m.client.ws_connect("/ma/ws") as ws:
        await ws.receive(timeout=5)
        m.store.db.execute("DELETE FROM sessions")
        m.store.db.commit()
        msg = await ws.receive(timeout=5)
        assert msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING)


async def test_redirects_stay_under_the_prefix_and_never_leave_for_another_site(env):
    m, _, _ = env
    await m.as_role("owner")
    r = await m.client.get("/ma/login", allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/ma/#/login-done"
    r = await m.client.get("/ma/away.json", allow_redirects=False)
    assert r.status == 502 and "elsewhere" not in await r.text()


async def test_ma_login_form_posts_pass(env):
    m, ma, _ = env
    await m.as_role("owner")
    r = await m.client.post("/ma/login", data=b"user=fictional", headers=m.csrf())
    assert r.status == 200 and (await r.json())["posted"] == "user=fictional"


async def test_go2rtc_cameras_follow_live_view_and_live_tv_must_be_registered(env):
    m, _, g2 = env
    await m.as_role("owner")
    r = await m.client.get("/go2rtc/api/frame.jpeg?src=camera.front_door")
    assert r.status == 200 and await r.read() == b"\xff\xd8 fictional jpeg"
    assert g2.hits[-1][1] == "/api/frame.jpeg?src=camera.front_door"
    # an unknown stream is refused until Live TV registers it
    r = await m.client.get("/go2rtc/api/frame.jpeg?src=tv_4_1")
    assert r.status == 403
    m.app["go2rtc_streams"].allow("tv_4_1", "live_tv")
    assert (await m.client.get("/go2rtc/api/frame.jpeg?src=tv_4_1")).status == 200
    # a child: no cameras, but Live TV
    await m.as_role("child")
    assert (await m.client.get("/go2rtc/api/frame.jpeg?src=camera.front_door")).status == 403
    assert (await m.client.get("/go2rtc/api/frame.jpeg?src=tv_4_1")).status == 200
    m.app["go2rtc_streams"].forget("tv_4_1")
    assert (await m.client.get("/go2rtc/api/frame.jpeg?src=tv_4_1")).status == 403
    # go2rtc's player module is plain code: any signed-in person
    assert (await m.client.get("/go2rtc/video-stream.js")).status == 200


async def test_go2rtc_signaling_socket_and_whep_post(env):
    m, _, g2 = env
    await m.as_role("owner")
    m.app["go2rtc_streams"].allow("tv_4_1", "live_tv")
    async with m.client.ws_connect("/go2rtc/api/ws?src=tv_4_1") as ws:
        await ws.send_str(json.dumps({"type": "webrtc/offer", "value": "v=0 fictional"}))
        got = json.loads((await ws.receive(timeout=5)).data)
        assert got["src"] == "tv_4_1" and "fictional" in got["got"]
        await ws.send_bytes(b"\x01\x02\x03")
        assert (await ws.receive(timeout=5)).data == b"\x03\x02\x01"
    r = await m.client.post("/go2rtc/api/webrtc?src=tv_4_1", data=b"v=0 offer", headers=m.csrf())
    assert r.status == 201 and (await r.text()) == "v=0 answer for v=0 offer"
    assert g2.hits[-1][3] == b"v=0 offer"
    for h in FORBIDDEN_UPSTREAM_HEADERS:
        assert h not in g2.hits[-1][2], h
    r = await m.client.post("/go2rtc/api/webrtc?src=tv_4_1", data=b"x" * (2 << 20), headers=m.csrf())
    assert r.status == 413


async def test_an_unreachable_upstream_says_so_without_its_address(tmp_path, monkeypatch):
    m = await make_mantel(tmp_path, monkeypatch, ma_web_url="http://127.0.0.1:9/", go2rtc_url="http://127.0.0.1:9")
    try:
        await m.as_role("owner")
        r = await m.client.get("/ma/")
        text = await r.text()
        assert r.status == 502 and "127.0.0.1:9" not in text and json.loads(text)["service"] == "Music Assistant"
    finally:
        await m.client.close()
        m.store.db.close()


async def test_services_say_what_this_identity_may_use(env, tmp_path, monkeypatch):
    m, _, _ = env
    await m.as_role("owner")
    assert await (await m.client.get("/api/services")).json() == {"music_assistant": "/ma/", "go2rtc": "/go2rtc/"}
    await m.as_role("guest")
    assert await (await m.client.get("/api/services")).json() == {"music_assistant": None, "go2rtc": "/go2rtc/"}
    m.client.session.cookie_jar.clear()
    assert (await m.client.get("/api/services")).status == 401
    plain = await make_mantel(tmp_path / "plain", monkeypatch)
    try:
        await plain.as_role("owner")
        assert await (await plain.client.get("/api/services")).json() == {"music_assistant": None, "go2rtc": None}
        assert (await plain.client.get("/ma/")).status == 404        # not configured: no route at all
    finally:
        await plain.client.close()
        plain.store.db.close()


def test_ma_web_address_defaults_to_the_api_host():
    from mantel_server.config import Config
    ups = media_proxy.upstreams_from(Config(ma_url="ws://ma.local:8095/ws"))
    assert [u.base for u in ups] == ["http://ma.local:8095"]
    ups = media_proxy.upstreams_from(Config(ma_url="wss://ma.local/ws", go2rtc_url="http://go2rtc:1984"))
    assert [u.base for u in ups] == ["https://ma.local", "http://go2rtc:1984"]
    assert media_proxy.upstreams_from(Config()) == []


def test_safe_tail_and_redirect_rules():
    assert media_proxy.safe_tail("assets/app.js") == "assets/app.js"
    assert media_proxy.safe_tail("") == "" and media_proxy.safe_tail("assets/") == "assets/"
    for bad in ("../x", "a/../b", "a//b", "./a", "a\\b", "a\x00b", "x" * 2000):
        assert media_proxy.safe_tail(bad) is None, bad
    up = media_proxy.MusicAssistant("http://ma:8095/")
    assert media_proxy._location(up, "http://ma:8095/x?y=1#z") == "/ma/x?y=1#z"
    assert media_proxy._location(up, "/login") == "/ma/login"
    assert media_proxy._location(up, "next") == "next"
    assert media_proxy._location(up, "https://evil.example/") is None


# -- through HA's Ingress: the prefix ---------------------------------------------------------------------
async def test_through_ingress_the_prefix_is_kept(tmp_path, monkeypatch):
    from test_ingress import OWNER_HA, PREFIX, FakeDirectory
    from mantel_server import ingress
    ma = await start_upstream(ma_app)
    m = await make_mantel(tmp_path, monkeypatch, {"ha_directory": FakeDirectory()}, ma_web_url=ma.url, ingress=True,
                          ingress_peers=("127.0.0.1",), ha_door_rules="trusted")
    try:
        m.store.link(OWNER_HA, "owner")
        h = {"X-Ingress-Path": PREFIX, ingress.USER_ID: OWNER_HA, ingress.USER_NAME: "fictional",
             ingress.USER_DISPLAY: "Fictional Owner", "X-Forwarded-Proto": "https",
             "X-Forwarded-Host": "ha.example.com", "X-Forwarded-For": "192.0.2.10, 172.30.32.1"}
        r = await m.client.get("/ma/", headers=h)
        text = await r.text()
        assert r.status == 200 and f"https://ha.example.com{PREFIX}/ma/imageproxy" in text and ma.url not in text
        assert "Strict-Transport-Security" not in r.headers        # HA's origin: not Mantel's to pin
        r = await m.client.get("/ma/login", headers=h, allow_redirects=False)
        assert r.status == 302 and r.headers["Location"] == f"{PREFIX}/ma/#/login-done"
        assert await (await m.client.get("/api/services", headers=h)).json() == {"music_assistant": "/ma/", "go2rtc": None}
        # the identity headers from anyone but the Ingress proxy are not an identity
        r = await m.client.get("/ma/", headers={**h, "X-Test-Peer": "192.0.2.99"})
        assert r.status == 401
    finally:
        await m.client.close()
        await ma.server.close()
        m.store.db.close()
