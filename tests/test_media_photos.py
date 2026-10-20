"""The screensaver's photos through Mantel (connectors/media_photos.py): Mantel answers media_source/resolve_media
itself (HA's signed address never reaches a page), and streams the photo from HA with its own credential to
whoever may use the media feature. Fictional house; the HA here is a local fake that records what it was asked."""
from __future__ import annotations

import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mantel_server.connectors import Ctx, Forbidden, Hooks, read_routes
from mantel_server.connectors import media_photos as MP
from mantel_server.readproxy import SERVER_ONLY_READS, ReadBlocked, check_read

TOKEN = "fictional-mantel-ha-credential"
JPEG = b"\xff\xd8\xff\xe0fictional-photo\xff\xd9"
CID = "media-source://media_source/local/screensaver/beach.jpg"


SIG = "eyJhbGciOiJIUzI1NiJ9.fictional.sig-0_1"


@pytest.mark.parametrize("url, want", [
    (f"/media/local/screensaver/beach.jpg?authSig={SIG}", f"/media/local/screensaver/beach.jpg?authSig={SIG}"),
    (f"/media/local/a%20b.jpg?authSig={SIG}", f"/media/local/a%20b.jpg?authSig={SIG}"),
    ("/media/local/x.jpg", None),                                  # HA's signature is the authorisation
    (f"/media/local/x.jpg?authSig={SIG}&other=1", None),
    ("/media/local/x.jpg?authSig=a b", None),
    (f"https://ha.home.example/media/local/x.jpg?authSig={SIG}", None),          # never another host
    (f"//evil.example/media/local/x.jpg?authSig={SIG}", None),
    (f"/api/states?authSig={SIG}", None), (f"/media/../api/states?authSig={SIG}", None),
    (f"/media/local/%2e%2e/x?authSig={SIG}", None), (f"/media//x?authSig={SIG}", None),
    (f"/media/local/x.jpg?authSig={SIG}#f", None), (None, None), (42, None),
])
def test_only_a_signed_path_under_media_is_kept(url, want):
    assert MP.ha_media_path(url) == want


@pytest.mark.parametrize("cfg, want", [
    ({"ha_url": "http://supervisor/core", "ha_oauth_url": "http://homeassistant:8123"}, "http://homeassistant:8123"),
    ({"ha_url": "http://supervisor/core", "ha_oauth_url": ""}, "http://homeassistant:8123"),   # the App, no sign-in
    ({"ha_url": "http://ha.home.example:8123/", "ha_oauth_url": ""}, "http://ha.home.example:8123"),
])
def test_photos_come_from_core_never_the_supervisors_proxy(cfg, want):
    assert MP.core_url(type("Cfg", (), cfg)()) == want


def test_ids_expire_and_the_oldest_go_first(monkeypatch):
    now = [0.0]
    p = MP.Photos(clock=lambda: now[0])
    a = p.add("/media/local/a.jpg")
    assert MP.PHOTO_ID.match(a) and p.get(a) == "/media/local/a.jpg"
    now[0] = MP.TTL_S + 1
    assert p.get(a) is None
    monkeypatch.setattr(MP, "MAX_KEPT", 2)
    ids = [p.add(f"/media/local/{i}.jpg") for i in range(3)]
    assert p.get(ids[0]) is None and p.get(ids[2]) == "/media/local/2.jpg"


def test_resolve_is_never_a_pages_read_of_ha():
    check_read({"type": MP.RESOLVE, "media_content_id": CID})       # allowed for Mantel itself...
    assert MP.RESOLVE in SERVER_ONLY_READS                           # ...never forwarded for a page
    with pytest.raises(ReadBlocked):
        check_read({"type": MP.RESOLVE, "media_content_id": CID, "entity_id": "x"})


class FakeProxy:
    def __init__(self, answer):
        self.answer, self.asked = answer, []

    async def request(self, msg, *, server_read=False):
        self.asked.append((msg, server_read))
        return self.answer


class FakeReads:
    def __init__(self, proxy, allowed):
        self.hooks = Hooks(may_read=lambda identity, kind, ids: set(ids) if allowed(identity) else set())
        self._p = proxy

    def _proxy(self):
        return self._p


class FakeAuthz:
    def principal(self, request):
        return request.headers.get("X-Who")

    def may_read(self, principal, kind, ids):
        return [i for i in ids if principal == "adult" and kind == "view"]


class FakeHa:
    def __init__(self):
        self.asked = []

    def app(self):
        a = web.Application()
        a.router.add_get("/media/{tail:.*}", self.media)
        return a

    async def media(self, request):
        self.asked.append({"path": request.path, "auth": request.headers.get("Authorization"), "query": dict(request.query)})
        return web.Response(body=JPEG, content_type="image/jpeg")


@pytest.fixture
async def env():
    fha = FakeHa()
    async with TestServer(fha.app()) as ha:
        app = web.Application()
        app["cfg"] = type("Cfg", (), {"ha_url": "http://supervisor/core", "ha_oauth_url": str(ha.make_url("")).rstrip("/")})()
        app["authz"] = FakeAuthz()
        proxy = FakeProxy({"url": f"/media/local/screensaver/beach.jpg?authSig={SIG}", "mime_type": "image/jpeg"})
        app["filtered_reads"] = FakeReads(proxy, lambda who: who == "adult")
        MP.register(app, TOKEN)
        async with TestClient(TestServer(app)) as client:
            yield type("Env", (), dict(app=app, client=client, proxy=proxy, fha=fha,
                                       resolve=read_routes(app)[MP.RESOLVE].request))


def ctx(who):
    async def send(_):
        pass
    return Ctx(send=send, identity=who)


async def test_a_photo_is_resolved_to_mantels_route_and_streamed_with_mantels_credential(env):
    got = await env.resolve(ctx("adult"), {"type": MP.RESOLVE, "id": 3, "media_content_id": CID})
    assert set(got) == {"url", "mime_type"} and got["mime_type"] == "image/jpeg"
    assert got["url"].startswith("/api/photo/") and "authSig" not in got["url"] and "media/local" not in got["url"]
    assert env.proxy.asked == [({"type": MP.RESOLVE, "media_content_id": CID, "expires": MP.TTL_S}, True)]  # Mantel's own
    r = await env.client.get(got["url"], headers={"X-Who": "adult"})
    assert r.status == 200 and await r.read() == JPEG and r.headers["Content-Type"] == "image/jpeg"
    # from Core's own address, with HA's signature and no credential of Mantel's
    assert env.fha.asked == [{"path": "/media/local/screensaver/beach.jpg", "auth": None, "query": {"authSig": SIG}}]
    assert SIG not in str(dict(r.headers)) and SIG not in got["url"]
    for _ in range(50):                                            # counted once the handler returns
        if env.app["media_photos"].stats["served"]:
            break
        await asyncio.sleep(0.01)
    assert env.app["media_photos"].stats == {"resolved": 1, "served": 1, "refused": 0}


async def test_without_the_media_feature_nothing_is_resolved_or_served(env):
    with pytest.raises(Forbidden):
        await env.resolve(ctx("child"), {"type": MP.RESOLVE, "media_content_id": CID})
    assert env.proxy.asked == []
    got = await env.resolve(ctx("adult"), {"type": MP.RESOLVE, "media_content_id": CID})
    for who in ("child", None):
        r = await env.client.get(got["url"], headers={"X-Who": who} if who else {})
        assert r.status == 404                                     # one answer: nothing to probe
    assert env.fha.asked == []


@pytest.mark.parametrize("msg", [
    {"media_content_id": "media-source://camera/camera.porch"},
    {"media_content_id": "media-source://tts/x"},
    {"media_content_id": 7},
    {"media_content_id": CID, "entity_id": "media_player.x"},
])
async def test_only_media_folders_and_only_media_content_id(env, msg):
    with pytest.raises(ReadBlocked):
        await env.resolve(ctx("adult"), {"type": MP.RESOLVE, **msg})
    assert env.proxy.asked == []


@pytest.mark.parametrize("answer", [
    {"url": "/media/local/clip.mp4?authSig=x", "mime_type": "video/mp4"},           # not a photo
    {"url": "https://elsewhere.example/a.jpg", "mime_type": "image/jpeg"},         # not HA's media folder
    {"url": "/api/camera_proxy/camera.porch", "mime_type": "image/jpeg"},
    {"mime_type": "image/jpeg"}, None,
])
async def test_an_answer_that_is_not_a_photo_in_a_media_folder_is_refused(env, answer):
    env.proxy.answer = answer
    with pytest.raises(ReadBlocked):
        await env.resolve(ctx("adult"), {"type": MP.RESOLVE, "media_content_id": CID})


async def test_unknown_expired_and_odd_ids_answer_404(env):
    for path in ("/api/photo/" + "0" * 32, "/api/photo/not-hex", "/api/photo/" + "a" * 31):
        assert (await env.client.get(path, headers={"X-Who": "adult"})).status == 404
    got = await env.resolve(ctx("adult"), {"type": MP.RESOLVE, "media_content_id": CID})
    assert (await env.client.get(got["url"] + "?x=1", headers={"X-Who": "adult"})).status == 404
    env.app["media_photos"].clock = lambda: 10 ** 12
    assert (await env.client.get(got["url"], headers={"X-Who": "adult"})).status == 404
    assert env.fha.asked == []
