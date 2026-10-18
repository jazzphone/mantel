"""Media player artwork through Mantel (connectors/media_art.py): states and history answers sent to a
page carry no HA artwork or camera token; GET /api/media/<entity>/art lets whoever may view the player
see its artwork, streamed from HA's media_player_proxy with Mantel's own credential. Fictional house;
the HA here is a local fake that records what it was asked."""
from __future__ import annotations

import asyncio
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import Mantel
from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, STATES
from mantel_server.connectors import media_art

TOKEN = "fictional-mantel-ha-credential"
ART_TOKEN = "fictionalarttoken0123456789abcdef"
PNG = b"\x89PNG\r\n\x1a\nfictional-artwork"


def player_state(token=ART_TOKEN, cache="c1", eid="media_player.kitchen"):
    pic = f"/api/media_player_proxy/{eid}?token={token}&cache={cache}"
    return {"s": "playing", "a": {"friendly_name": "Kitchen speaker", "media_title": "A fictional song",
                                  "entity_picture": pic, "entity_picture_local": pic}, "lc": 1.0, "lu": 1.0}


class FakeHaRest:
    def __init__(self):
        self.asked: list[dict] = []

    def app(self):
        app = web.Application()
        app.router.add_get("/api/media_player_proxy/{eid}", self.proxy)
        return app

    async def proxy(self, request):
        self.asked.append({"eid": request.match_info["eid"], "auth": request.headers.get("Authorization"),
                           "query": dict(request.query)})
        if request.match_info["eid"] != "media_player.kitchen":
            return web.Response(status=404)
        return web.Response(body=PNG, content_type="image/png")


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
                                                             {"entity_id": "media_player.loft", "area_id": "kitchen"}])
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
