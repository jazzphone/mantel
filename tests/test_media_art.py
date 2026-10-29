"""Media player artwork through Mantel (connectors/media_art.py): states and history answers sent to a
page carry no HA artwork or camera token; GET /api/media/<entity>/art lets whoever may view the player
see its artwork, streamed from HA's media_player_proxy with Mantel's own credential. Fictional house;
the HA here is a local fake that records what it was asked."""
from __future__ import annotations

import asyncio
import io
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher
from PIL import Image

from conftest import Mantel
from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, STATES
from mantel_server.connectors import media_art, person_picture

TOKEN = "fictional-mantel-ha-credential"
ART_TOKEN = "fictionalarttoken0123456789abcdef"
PNG = b"\x89PNG\r\n\x1a\nfictional-artwork"


def player_state(token=ART_TOKEN, cache="c1", eid="media_player.kitchen"):
    pic = f"/api/media_player_proxy/{eid}?token={token}&cache={cache}"
    return {"s": "playing", "a": {"friendly_name": "Kitchen speaker", "media_title": "A fictional song",
                                  "entity_picture": pic, "entity_picture_local": pic}, "lc": 1.0, "lu": 1.0}


def picture(fmt="JPEG", size=(1200, 1200), color=(200, 40, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt)
    return buf.getvalue()


class FakeHaRest:
    def __init__(self):
        self.asked: list[dict] = []
        self.image, self.ctype, self.delay = PNG, "image/png", 0.0

    def app(self):
        app = web.Application()
        app.router.add_get("/api/media_player_proxy/{eid}", self.proxy)
        app.router.add_get("/api/image/serve/{image_id}/{size}", self.portrait)
        return app

    async def portrait(self, request):
        self.asked.append({"path": request.path, "auth": request.headers.get("Authorization")})
        return web.Response(body=PNG, content_type="image/png")

    async def proxy(self, request):
        self.asked.append({"eid": request.match_info["eid"], "auth": request.headers.get("Authorization"),
                           "query": dict(request.query)})
        if self.delay:
            await asyncio.sleep(self.delay)
        if request.match_info["eid"] != "media_player.kitchen":
            return web.Response(status=404)
        return web.Response(body=self.image, content_type=self.ctype)


@pytest.fixture
async def env(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("media art tests attempted other upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    fha = FakeHaRest()
    async with TestServer(fha.app()) as ha_srv:
        cfg = Config(ha_url=str(ha_srv.make_url("")).rstrip("/"), data_dir=tmp_path / "data",
                     secrets_dir=tmp_path / "secrets", port=0)
        store = Store(cfg.data_dir / "mantel.db")
        now = [1_000_000.0]
        app = build_app(cfg, TOKEN, store=store, connect_ha=False, clock=lambda: now[0])
        app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        hub = app["hub"]
        hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": "media_player.kitchen", "area_id": "kitchen"},
                                                             {"entity_id": "media_player.loft", "area_id": "kitchen"},
                                                             {"entity_id": "person.avery", "area_id": "kitchen"}])
        states = {k: dict(v) for k, v in STATES.items()}
        states["media_player.kitchen"] = player_state()
        states["media_player.loft"] = player_state(eid="media_player.loft")
        hub.store.apply_event({"a": states})
        async with TestClient(TestServer(app)) as client:
            origin = str(client.make_url("")).rstrip("/")
            client.session.headers["Origin"] = origin
            m = Mantel(app, client, store, now, origin)
            m.fha = fha
            yield m
        store.db.close()


async def login(m, username, role):
    m.forget_cookies()
    await m.user(username, role)
    r, body = await m.sign_in(username)
    assert r.status == 200, body


# -- shaping (pure) ----------------------------------------------------------------------------------
def test_shape_moves_signed_artwork_to_mantel():
    st = player_state()
    out = media_art.shape("media_player.kitchen", st)
    text = json.dumps(out)
    assert ART_TOKEN not in text and "token=" not in text and "media_player_proxy" not in text
    pic = out["a"]["entity_picture"]
    assert pic.startswith("/api/media/media_player.kitchen/art?v=") and out["a"]["entity_picture_local"] == pic
    assert st["a"]["entity_picture"].startswith("/api/media_player_proxy/")      # the store is never mutated
    # a new track (cache=) or a rotated token gives a new tag
    assert media_art.shape("media_player.kitchen", player_state(cache="c2"))["a"]["entity_picture"] != pic
    pre = "/api/hassio_ingress/Fict1onal"
    assert media_art.shape("media_player.kitchen", st, pre)["a"]["entity_picture"].startswith(pre + "/api/media/")


def test_shape_leaves_remote_and_other_pictures_alone():
    remote = {"s": "playing", "a": {"entity_picture": "https://art.example/cover.jpg"}, "lc": 1, "lu": 1}
    assert media_art.shape("media_player.x", remote) is remote
    light = {"s": "on", "a": {"entity_picture": "/api/media_player_proxy/x?token=t"}, "lc": 1, "lu": 1}
    assert media_art.shape("light.x", light) is light
    # the page shaper does both cameras and players
    cam = {"s": "idle", "a": {"access_token": "t", "entity_picture": "/api/camera_proxy/camera.d?token=t"}}
    assert "token" not in json.dumps(media_art.page_shaper("")("camera.d", cam))


def test_history_rows_lose_every_ha_token():
    rows = [player_state()["a"], {"access_token": "t", "entity_picture": "/api/camera_proxy/camera.d?token=t",
                                  "friendly_name": "D"}]
    p = media_art.strip_tokens("media_player.kitchen", {"s": "playing", "a": rows[0], "lu": 1})
    c = media_art.strip_tokens("camera.d", {"s": "idle", "a": rows[1], "lu": 1})
    assert "token" not in json.dumps(p) + json.dumps(c)
    assert p["a"]["media_title"] == "A fictional song" and c["a"] == {"friendly_name": "D"}
    plain = {"s": "on", "lu": 1}
    assert media_art.strip_tokens("light.x", plain) is plain


# -- the socket and history: no HA token ever reaches a page -------------------------------------------
async def test_states_sent_to_a_page_carry_no_artwork_token(env):
    await login(env, "avery", "owner")
    ws = await env.client.ws_connect("/ws")
    await ws.send_json({"type": "subscribe", "all": True})
    raw = await asyncio.wait_for(ws.receive_str(), 3)
    assert ART_TOKEN not in raw and "media_player_proxy" not in raw
    snap = json.loads(raw)
    assert snap["entities"]["media_player.kitchen"]["a"]["entity_picture"].startswith("/api/media/media_player.kitchen/art?v=")
    await ws.close()


async def test_history_answers_carry_no_token(env, monkeypatch):
    from mantel_server.readproxy import ReadProxy

    async def fake_request(self, msg, **kw):
        assert msg["type"] == "history/history_during_period"
        return {"media_player.kitchen": [{"s": "playing", "a": player_state()["a"], "lu": 1.0}],
                "camera.doorbell": [{"s": "idle", "a": {"access_token": "camtok",
                                                        "entity_picture": "/api/camera_proxy/camera.doorbell?token=camtok"},
                                     "lu": 1.0}]}

    monkeypatch.setattr(ReadProxy, "request", fake_request)
    env.app["hub"].readproxy = ReadProxy("http://ha.invalid", "x")
    await login(env, "avery", "owner")
    ws = await env.client.ws_connect("/ws")
    await ws.send_json({"type": "read", "id": 7, "msg": {"type": "history/history_during_period",
                                                         "start_time": "2026-10-18T00:00:00Z",
                                                         "entity_ids": ["media_player.kitchen", "camera.doorbell"]}})
    for _ in range(5):
        frame = json.loads(await asyncio.wait_for(ws.receive_str(), 3))
        if frame.get("type") == "read_result" and frame.get("id") == 7:
            break
    assert set(frame["result"]) == {"media_player.kitchen", "camera.doorbell"}, frame
    assert frame["result"]["media_player.kitchen"][0]["a"]["media_title"] == "A fictional song"
    text = json.dumps(frame)
    assert "token" not in text and ART_TOKEN not in text and "camtok" not in text, text
    await ws.close()


# -- the route --------------------------------------------------------------------------------------------
async def test_who_may_view_the_player_gets_its_artwork(env):
    await login(env, "avery", "owner")
    r = await env.get("/api/media/media_player.kitchen/art?v=abc&_hk=1")
    assert r.status == 200 and await r.read() == PNG and r.headers["Content-Type"] == "image/png"
    assert env.fha.asked == [{"eid": "media_player.kitchen", "auth": f"Bearer {TOKEN}", "query": {}}]
    assert env.app["media_art"]["served"] == 1


async def test_refusals_and_errors(env):
    await login(env, "cody", "child")                     # no kitchen in a child's rooms
    r = await env.get("/api/media/media_player.kitchen/art")
    assert r.status == 403 and env.fha.asked == []
    await login(env, "avery", "owner")
    assert (await env.get("/api/media/light.kitchen/art")).status == 404
    assert (await env.get("/api/media/media_player.nope/art")).status == 404
    assert (await env.get("/api/media/media_player.kitchen/art?token=x")).status == 400
    r = await env.get("/api/media/media_player.loft/art")       # HA has no artwork for it
    assert r.status == 404 and (await r.json())["error"] == "no_artwork"
    env.forget_cookies()
    assert (await env.get("/api/media/media_player.kitchen/art")).status == 401


def test_portrait_shaping_and_path_boundary():
    st = {"s": "home", "a": {"entity_picture": "/api/image/serve/fictional/512x512"}}
    out = media_art.page_shaper("/ingress/example")("person.avery", st)
    assert out["a"]["entity_picture"].startswith("/ingress/example/api/person/person.avery/picture?v=")
    assert st["a"]["entity_picture"].startswith("/api/image/serve/")
    absolute = {"s": "home", "a": {"entity_picture": "https://ha.example/local/people/avery.jpg"}}
    assert media_art.page_shaper("", "https://ha.example")("person.avery", absolute)["a"]["entity_picture"].startswith("/api/person/")
    assert person_picture.portrait_path("/local/people/avery.jpg") == "/local/people/avery.jpg"
    for path in ["//evil.example/a", "https://evil.example/api/image/serve/x/512x512", "/local/../secret", "/local/%2e%2e/secret", "/api/config", "/api/image/serve/x/512x512?token=secret", "/local/a.svg#fragment"]:
        assert person_picture.portrait_path(path, "https://ha.example") is None


async def test_person_portrait_requires_view_and_uses_server_credential(env):
    hub = env.app["hub"]
    hub.store.apply_event({"a": {"person.avery": {"s": "home", "a": {"entity_picture": "/api/image/serve/fictional/512x512"}, "lc": 1, "lu": 1}}})
    await login(env, "cody", "child")
    assert (await env.get("/api/person/person.avery/picture")).status == 403
    assert env.fha.asked == []
    await login(env, "avery", "owner")
    r = await env.get("/api/person/person.avery/picture?v=opaque")
    assert r.status == 200 and await r.read() == PNG
    assert env.fha.asked == [{"path": "/api/image/serve/fictional/512x512", "auth": f"Bearer {TOKEN}"}]
    assert (await env.get("/api/person/person.avery/picture?url=https://evil.example")).status == 400
    hub.store.states["person.avery"]["a"]["entity_picture"] = "https://evil.example/a.jpg"
    assert (await env.get("/api/person/person.avery/picture")).status == 404
    assert len(env.fha.asked) == 1
    env.forget_cookies()
    assert (await env.get("/api/person/person.avery/picture")).status == 401


# -- scaled to the tile (2026-10-29; hk_core/art) ---------------------------------------------------------
async def test_a_size_asked_for_is_a_scaled_jpeg_kept_for_the_next_tablet(env):
    env.fha.image, env.fha.ctype = picture(), "image/jpeg"
    await login(env, "avery", "owner")
    r = await env.get("/api/media/media_player.kitchen/art?v=abc&s=300")
    body = await r.read()
    assert r.status == 200 and r.headers["Content-Type"] == "image/jpeg" and Image.open(io.BytesIO(body)).size == (300, 300)
    assert len(body) < len(env.fha.image) // 4
    assert r.headers["Cache-Control"] == "private, max-age=86400" and r.headers["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in r.headers["Content-Security-Policy"]
    # another tablet, another cache-buster: the copy in memory, HA not asked again; a size inside the bucket is the same
    r = await env.get("/api/media/media_player.kitchen/art?v=zzz&_hk=2&s=250")
    assert r.status == 200 and await r.read() == body
    assert len(env.fha.asked) == 1 and env.app["media_art"]["scaled"] == 2
    # another bucket is its own copy
    r = await env.get("/api/media/media_player.kitchen/art?s=600")
    assert Image.open(io.BytesIO(await r.read())).size == (600, 600) and len(env.fha.asked) == 2


async def test_without_a_size_or_for_the_original_the_picture_comes_through_as_it_did(env):
    env.fha.image, env.fha.ctype = picture(), "image/jpeg"
    await login(env, "avery", "owner")
    for q in ("", "?s=0"):
        r = await env.get("/api/media/media_player.kitchen/art" + q)
        assert r.status == 200 and await r.read() == env.fha.image and r.headers["Cache-Control"] == "no-store", q


async def test_a_cover_already_small_goes_as_it_came_and_a_new_track_is_not_the_old_copy(env):
    small = picture("PNG", (100, 100))
    env.fha.image, env.fha.ctype = small, "image/png"
    await login(env, "avery", "owner")
    r = await env.get("/api/media/media_player.kitchen/art?s=300")
    assert r.status == 200 and await r.read() == small and r.headers["Content-Type"] == "image/png"
    # a new track: HA's address changes (cache=), and the page is told a new v; the old copy is not served for it
    env.fha.image, env.fha.ctype = picture(color=(0, 0, 200)), "image/jpeg"
    env.app["hub"].store.apply_event({"a": {"media_player.kitchen": player_state(cache="c2")}})
    r = await env.get("/api/media/media_player.kitchen/art?s=300&v=old-v-from-before")
    assert r.status == 200 and r.headers["Content-Type"] == "image/jpeg" and len(env.fha.asked) == 2


async def test_tablets_asking_while_a_cover_is_fetched_share_that_fetch(env):
    env.fha.image, env.fha.ctype, env.fha.delay = picture(), "image/jpeg", 0.15
    await login(env, "avery", "owner")
    rs = await asyncio.gather(*(env.get(f"/api/media/media_player.kitchen/art?s=300&_hk={i}") for i in range(4)))
    assert [r.status for r in rs] == [200] * 4 and len(env.fha.asked) == 1


async def test_what_is_not_a_picture_is_not_passed_on_and_nothing_is_kept(env):
    env.fha.image, env.fha.ctype = b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "image/svg+xml"
    await login(env, "avery", "owner")
    r = await env.get("/api/media/media_player.kitchen/art?s=300")
    assert r.status == 415 and (await r.json())["error"] == "artwork_unsupported"
    assert len(env.app["media_art_scaled"].cache) == 0
    await env.get("/api/media/media_player.kitchen/art?s=300")
    assert len(env.fha.asked) == 2                                  # a refusal is not kept either


async def test_the_roles_decide_before_the_scaled_copy_is_looked_at(env):
    env.fha.image, env.fha.ctype = picture(), "image/jpeg"
    await login(env, "avery", "owner")
    assert (await env.get("/api/media/media_player.kitchen/art?s=300")).status == 200
    await login(env, "cody", "child")
    assert (await env.get("/api/media/media_player.kitchen/art?s=300")).status == 403
    assert len(env.fha.asked) == 1


# -- covers on other hosts, fetched and scaled here --------------------------------------------------------
CDN = "https://is1-ssl.mzstatic.com/image/thumb/f-ye8/1000x1000bb.jpg"
MA = "http://192.0.2.53:8095/imageproxy/8f48?size=512&fmt=jpg"


class FakeWeb:
    """The internet as aiohttp's ClientSession shows it: ``get`` is an async context manager."""

    def __init__(self, pages):
        self.pages, self.asked = pages, []

    def get(self, url, **kw):
        self.asked.append(url)
        status, ctype, body, headers = self.pages.get(url, (404, "text/plain", b"", {}))

        class Body:
            async def iter_chunked(self, n):
                for i in range(0, len(body), n):
                    yield body[i:i + n]

        class R:
            def __init__(self):
                self.status, self.content = status, Body()
                self.headers = {"Content-Type": ctype, **headers}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False
        return R()


@pytest.fixture
def web_(env):
    where = {"is1-ssl.mzstatic.com": "17.253.1.1", "192.0.2.53": "192.0.2.53", "router.lan": "192.0.2.1",
             "metadata": "169.254.169.254", "x.test": "93.184.216.34"}

    async def resolve(host, port):
        if host not in where:
            raise OSError("no such host")
        return {where[host]}
    scaled = env.app["media_art_scaled"]
    scaled.resolve = resolve
    scaled.session = FakeWeb({CDN: (200, "image/jpeg", picture(), {}), MA: (200, "image/jpeg", picture(size=(800, 600)), {}),
                              "http://router.lan/admin.jpg": (200, "image/jpeg", picture(), {}),
                              "https://x.test/r": (302, "text/plain", b"", {"Location": "http://router.lan/admin.jpg"})})
    return scaled.session


def remote(url, s=300):
    return f"/api/media/art?e={media_art.art_fetch.enc(url)}&s={s}"


async def test_a_remote_cover_is_fetched_here_scaled_and_kept(env, web_):
    await login(env, "avery", "owner")
    r = await env.get(remote(CDN))
    body = await r.read()
    assert r.status == 200 and r.headers["Content-Type"] == "image/jpeg" and Image.open(io.BytesIO(body)).size == (300, 300)
    assert r.headers["Cache-Control"] == "private, max-age=86400" and "sandbox" in r.headers["Content-Security-Policy"]
    r = await env.get(remote(CDN))                                       # the next tile: from memory
    assert await r.read() == body and web_.asked == [CDN]
    r = await env.get(remote(MA, 150))                                   # Music Assistant's own proxy on the home network
    assert Image.open(io.BytesIO(await r.read())).size == (150, 113)
    r = await env.get(f"/api/media/art?e={media_art.art_fetch.enc(CDN)}")   # no size: 300
    assert r.status == 200 and Image.open(io.BytesIO(await r.read())).size == (300, 300) and web_.asked == [CDN, MA]


async def test_a_remote_cover_goes_only_where_covers_are(env, web_):
    await login(env, "avery", "owner")
    for url in ("http://router.lan/admin.jpg", "http://metadata/imageproxy/x", "https://nowhere.invalid/a.jpg",
                "https://x.test/r", "http://127.0.0.1:8123/api/states", "ftp://x.test/a.jpg"):
        r = await env.get(remote(url))
        assert r.status in (404, 400), (url, r.status)
    assert web_.asked == ["https://x.test/r"]                            # the redirect to the router was never followed
    assert (await env.get("/api/media/art?e=!!!")).status == 400
    assert (await env.get("/api/media/art")).status == 400
    assert (await env.get(remote(CDN) + "&token=x")).status == 400


async def test_a_remote_cover_needs_a_session_that_may_use_media(env, web_):
    env.forget_cookies()
    assert (await env.get(remote(CDN))).status == 401
    await login(env, "cody", "child")
    assert (await env.get(remote(CDN))).status == 200                   # (a child may, by default)
    env.app["rbac"].set_override("child", {"grants": []})               # ...until the house says no
    web_.asked.clear()
    env.app["media_art_scaled"].cache = media_art.art_resize.Cache()
    r = await env.get(remote(CDN))
    assert r.status == 404 and web_.asked == [] and env.app["media_art"]["refused"] == 1
