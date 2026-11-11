"""Camera stills through Mantel (connectors/camera_still.py): states sent to a page carry no HA camera token
and point at Mantel's still route; the route decides with the live-view policy minus step-up (the door's
camera rules included) and streams HA's camera_proxy with Mantel's own credential. Fictional house; the
HA here is a local fake that records what it was asked."""
from __future__ import annotations

import asyncio
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import Mantel
from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, STATES, recv
from mantel_server.connectors import camera_still
from mantel_server.view import ClientView, Coalescing

TOKEN = "fictional-mantel-ha-credential"
HA_CAM_TOKEN = "fictionalcamtoken0123456789abcdef"
JPEG = b"\xff\xd8\xff\xe0fictional-jpeg-bytes\xff\xd9"


def cam_state(token=HA_CAM_TOKEN, eid="camera.doorbell"):
    return {"s": "idle", "a": {"friendly_name": "Doorbell", "access_token": token,
                               "entity_picture": f"/api/camera_proxy/{eid}?token={token}"},
            "lc": 1.0, "lu": 1.0}


class FakeHaRest:
    """HA's /api/camera_proxy/<entity>: an image for a camera it has, 404 otherwise."""

    def __init__(self):
        self.asked: list[dict] = []
        self.cameras = {"camera.doorbell"}
        self.delay = 0.0

    def app(self):
        app = web.Application()
        app.router.add_get("/api/camera_proxy/{eid}", self.proxy)
        return app

    async def proxy(self, request):
        self.asked.append({"eid": request.match_info["eid"], "auth": request.headers.get("Authorization"),
                           "query": dict(request.query)})
        if self.delay:
            await asyncio.sleep(self.delay)
        if request.match_info["eid"] not in self.cameras:
            return web.Response(status=404)
        return web.Response(body=JPEG, content_type="image/jpeg")


async def make(tmp_path, monkeypatch, ha_url):
    from mantel_server.config import Config
    from mantel_server.ha.ha_client import HaClient
    from mantel_server.ha.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.storage.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("camera still tests attempted other upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(ha_url=ha_url, data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, TOKEN, store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    hub = app["hub"]
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": "camera.attic", "area_id": "porch"}])
    states = {k: dict(v) for k, v in STATES.items()}
    states["camera.doorbell"] = cam_state()
    states["camera.attic"] = cam_state(eid="camera.attic")
    hub.store.apply_event({"a": states})
    return app, store, now


@pytest.fixture
async def env(tmp_path, monkeypatch):
    fha = FakeHaRest()
    async with TestServer(fha.app()) as ha_srv:
        app, store, now = await make(tmp_path, monkeypatch, str(ha_srv.make_url("")).rstrip("/"))
        async with TestClient(TestServer(app)) as client:
            origin = str(client.make_url("")).rstrip("/")
            client.session.headers["Origin"] = origin
            m = Mantel(app, client, store, now, origin)
            m.fha = fha
            yield m
        store.db.close()


async def login(m, username, role, tunnel=False):
    m.forget_cookies()
    if m.app["accounts"].db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone() is None:
        await m.user(username, role)
    r, body = await m.sign_in(username, tunnel=tunnel)
    assert r.status == 200, body


async def still(m, eid="camera.doorbell", query="", tunnel=False):
    return await m.get(f"/api/camera/{eid}/still{query}", tunnel=tunnel)


# -- shaping (pure) --------------------------------------------------------------------------------------
def test_shape_removes_the_camera_token_and_points_at_mantel():
    st = cam_state()
    out = camera_still.shape("camera.doorbell", st)
    assert "access_token" not in out["a"] and HA_CAM_TOKEN not in json.dumps(out) and "token=" not in json.dumps(out)
    pic = out["a"]["entity_picture"]
    assert pic.startswith("/api/camera/camera.doorbell/still?v=") and len(pic.split("v=")[1]) == 16
    assert st["a"]["access_token"] == HA_CAM_TOKEN               # the store's state is never mutated
    # the version follows HA's token rotation (so a card retries after one) and is stable otherwise
    assert camera_still.shape("camera.doorbell", cam_state())["a"]["entity_picture"] == pic
    assert camera_still.shape("camera.doorbell", cam_state("rotated"))["a"]["entity_picture"] != pic
    # under the Ingress prefix
    pre = "/api/hassio_ingress/Fict1onal"
    assert camera_still.shape("camera.doorbell", st, pre)["a"]["entity_picture"].startswith(pre + "/api/camera/")


def test_shape_leaves_everything_else_alone():
    light = {"s": "on", "a": {"entity_picture": "/local/x.png"}, "lc": 1, "lu": 1}
    assert camera_still.shape("light.kitchen", light) is light
    plain = {"s": "idle", "a": {"friendly_name": "Cam"}, "lc": 1, "lu": 1}
    assert camera_still.shape("camera.x", plain) is plain
    only_token = {"s": "idle", "a": {"access_token": "t"}, "lc": 1, "lu": 1}
    assert camera_still.shape("camera.x", only_token)["a"] == {}


def test_every_view_shapes_even_without_a_gate():
    from mantel_server.ha.registry import Registry
    from mantel_server.ha.state import StateStore
    store, reg = StateStore(), Registry()
    store.apply_event({"a": {"camera.doorbell": cam_state()}})
    view = ClientView(store, reg, Coalescing())
    snap = view.select(["camera.doorbell"], [], 0.0)
    assert HA_CAM_TOKEN not in json.dumps(snap)
    store.apply_event({"c": {"camera.doorbell": {"+": {"a": {"access_token": "rot",
                                                              "entity_picture": "/api/camera_proxy/camera.doorbell?token=rot"}}}}})
    view.on_change({"camera.doorbell"})
    diff, _ = view.flush(10.0)
    text = json.dumps(diff)
    assert "rot" not in text and "token" not in text
    assert diff["changes"]["camera.doorbell"]["+"]["a"]["entity_picture"].startswith("/api/camera/camera.doorbell/still?v=")


# -- the socket: no HA token ever reaches a page ------------------------------------------------------------
async def test_states_sent_to_a_page_carry_no_camera_token(env):
    await login(env, "avery", "owner")
    ws = await env.client.ws_connect("/ws")
    await ws.send_json({"type": "subscribe", "all": True})
    raw = await asyncio.wait_for(ws.receive_str(), 3)
    assert HA_CAM_TOKEN not in raw and "token=" not in raw and "access_token" not in raw
    snap = json.loads(raw)
    assert snap["entities"]["camera.doorbell"]["a"]["entity_picture"].startswith("/api/camera/camera.doorbell/still?v=")
    hub = env.app["hub"]
    hub.store.apply_event({"c": {"camera.doorbell": {"+": {"a": {"access_token": "rotatedtok",
                                                                  "entity_picture": "/api/camera_proxy/camera.doorbell?token=rotatedtok"}}}}})
    hub.on_change({"camera.doorbell"})
    raw = await asyncio.wait_for(ws.receive_str(), 3)
    assert "rotatedtok" not in raw and "token=" not in raw
    assert json.loads(raw)["changes"]["camera.doorbell"]["+"]["a"]["entity_picture"].startswith("/api/camera/")
    await ws.close()


# -- the route ----------------------------------------------------------------------------------------------
async def test_an_allowed_role_gets_the_still_with_mantels_credential(env):
    await login(env, "avery", "owner")
    r = await still(env, query="?v=abc&_hk=3&width=480&height=270")
    assert r.status == 200 and await r.read() == JPEG
    assert r.headers["Content-Type"] == "image/jpeg" and r.headers["Cache-Control"] == "no-store"
    assert env.fha.asked == [{"eid": "camera.doorbell", "auth": f"Bearer {TOKEN}",
                              "query": {"width": "480", "height": "270"}}]
    assert TOKEN not in json.dumps(dict(r.headers))
    # one of width/height alone is not forwarded (HA ignores it anyway)
    r = await still(env, query="?width=480")
    assert r.status == 200 and env.fha.asked[-1]["query"] == {}
    assert env.app["camera_stills"]["served"] == 2


# -- one fetch for several tablets (2026-10-29) ---------------------------------------------------------------------
@pytest.fixture
def clock(env):
    t = [100.0]
    env.app["camera_still_share"].now = lambda: t[0]
    return t


async def test_tablets_asking_for_one_still_within_two_seconds_cost_ha_one_fetch(env, clock):
    await login(env, "avery", "owner")
    q = "?v=abc&_hk=1&width=480&height=270"
    first = await still(env, query=q)
    assert first.status == 200 and await first.read() == JPEG
    clock[0] += 1.9
    again = await still(env, query="?v=abc&_hk=2&width=480&height=270")     # another tablet, another cache-buster
    assert again.status == 200 and await again.read() == JPEG
    assert len(env.fha.asked) == 1
    for r in (first, again):                                                  # the browser is still told not to keep it
        assert r.headers["Cache-Control"] == "no-store" and r.headers["Content-Type"] == "image/jpeg"
        assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert env.app["camera_stills"]["served"] == 2
    clock[0] += 0.2                                                           # two seconds on: HA is asked again
    assert (await still(env, query=q)).status == 200
    assert len(env.fha.asked) == 2


async def test_each_size_and_camera_has_its_own_copy(env, clock):
    await login(env, "avery", "owner")
    env.fha.cameras.add("camera.attic")
    for eid, q in (("camera.doorbell", "?width=480&height=270"), ("camera.doorbell", "?width=960&height=540"),
                   ("camera.doorbell", ""), ("camera.attic", "?width=480&height=270")):
        assert (await still(env, eid, q)).status == 200
    assert len(env.fha.asked) == 4
    assert (await still(env, "camera.doorbell", "?width=480")).status == 200       # one side alone: the same as none
    assert len(env.fha.asked) == 4


async def test_tablets_asking_while_it_is_fetched_share_that_fetch(env, clock):
    await login(env, "avery", "owner")
    env.fha.delay = 0.15
    rs = await asyncio.gather(*(still(env, query=f"?width=480&height=270&_hk={i}") for i in range(5)))
    assert [r.status for r in rs] == [200] * 5 and [await r.read() for r in rs] == [JPEG] * 5
    assert len(env.fha.asked) == 1


async def test_the_shared_copy_is_never_a_way_round_the_roles(env, clock):
    await login(env, "avery", "owner")
    assert (await still(env, query="?width=480&height=270")).status == 200
    await login(env, "cody", "child")
    assert (await still(env, query="?width=480&height=270")).status == 403
    env.forget_cookies()
    assert (await still(env, query="?width=480&height=270")).status == 401
    assert len(env.fha.asked) == 1


async def test_a_failed_fetch_is_not_kept(env, clock):
    await login(env, "avery", "owner")
    env.fha.cameras.clear()
    assert (await still(env, query="?width=480&height=270")).status == 404
    env.fha.cameras.add("camera.doorbell")
    r = await still(env, query="?width=480&height=270")                          # the next ask goes to HA at once
    assert r.status == 200 and len(env.fha.asked) == 2


async def test_a_still_nobody_waits_for_any_more_still_finishes(env, clock):
    """A tablet that goes away mid-fetch does not cancel the fetch the others share."""
    await login(env, "avery", "owner")
    env.fha.delay = 0.15
    first = asyncio.ensure_future(still(env, query="?width=480&height=270"))
    await asyncio.sleep(0.03)
    second = asyncio.ensure_future(still(env, query="?width=480&height=270&_hk=2"))
    await asyncio.sleep(0.03)
    first.cancel()
    r = await second
    assert r.status == 200 and await r.read() == JPEG and len(env.fha.asked) == 1


async def test_a_refused_role_gets_nothing_and_ha_is_not_asked(env):
    await login(env, "cody", "child")
    r = await still(env)
    assert r.status == 403 and (await r.json())["error"] == "forbidden"
    await login(env, "gwen", "guest")
    assert (await still(env)).status == 403
    assert env.fha.asked == [] and env.app["camera_stills"]["refused"] == 2


async def test_signed_out_is_refused(env):
    env.forget_cookies()
    assert (await still(env)).status == 401
    assert env.fha.asked == []


async def test_tunnel_needs_the_roles_camera_switch_but_no_step_up(env):
    from mantel_server.identity.accounts import totp
    from gateway_fakes import seed_of
    await login(env, "jordan", "adult")
    r = await env.post("/api/auth/totp/enroll")
    seed = seed_of((await r.json())["secret"])
    assert (await env.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, env.now[0])})).status == 200
    env.forget_cookies()
    env.now[0] += 60
    r, body = await env.sign_in("jordan", tunnel=True)
    r = await env.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, env.now[0])},
                       csrf=False, tunnel=True)
    assert r.status == 200
    env.now[0] += 3600                                     # the sign-in's factor is long stale now
    # live view on the tunnel needs a fresh factor; a still does not (the policy minus step-up)
    assert (await still(env, tunnel=True)).status == 200
    env.app["rbac"].set_override("adult", {"tunnel_cameras": False})
    assert (await still(env, tunnel=True)).status == 403
    assert len(env.fha.asked) == 1


async def test_unknown_and_non_camera_entities(env):
    await login(env, "avery", "owner")
    r = await still(env, "camera.nowhere")
    assert r.status == 404 and (await r.json())["error"] == "unknown_camera"
    r = await still(env, "light.kitchen")
    assert r.status == 404 and (await r.json())["error"] == "not_a_camera"
    assert (await still(env, "camera.Bad-Id")).status == 404
    assert (await still(env, query="?width=0&height=10")).status == 400
    assert (await still(env, query="?width=99999&height=10")).status == 400
    assert (await still(env, query="?token=x")).status == 400
    assert env.fha.asked == []
    # known to Mantel but HA has no such camera (yet): 404 passed on; never HA's body
    r = await still(env, "camera.attic")
    assert r.status == 404 and env.fha.asked[-1]["eid"] == "camera.attic"


async def test_a_refused_still_is_not_an_existence_oracle(env):
    await login(env, "cody", "child")
    assert (await still(env, "camera.nowhere")).status == 403


async def test_ha_unreachable_is_a_502(env):
    await login(env, "avery", "owner")
    env.app["cfg"].ha_url = "http://127.0.0.1:9"                  # nothing listens on discard
    r = await still(env)
    assert r.status == 502 and (await r.json())["error"] == "camera_unavailable"


def test_may_still_is_the_live_view_policy():
    from mantel_server.identity import sessions
    from mantel_server.identity.authz import Authz, Principal
    from mantel_server.identity.rbac import Policy, Subject

    class Store:
        def policy(self):
            return Policy.build()

    class Hub:
        from mantel_server.ha.registry import Registry
        from mantel_server.ha.state import StateStore
        registry, store = Registry(), StateStore()

    a = Authz({"cfg": None}, Hub(), Store(), clock=lambda: 1000.0)
    ident = sessions.Identity(sessions.User("u", "U", "adult", "password"), None, "tunnel")
    p = Principal(ident, Subject(user_role="adult", user_id="u", door="tunnel"))
    assert a.may_view(p, "camera.doorbell") is True                 # live view: no step-up (decision 25)
    assert a.may_still(p, "camera.doorbell") is True
    off = Principal(ident, Subject(user_role="guest", user_id="g", door="tunnel"))
    assert a.may_view(off, "camera.doorbell") is False and a.may_still(off, "camera.doorbell") is False
    assert a.may_still(p, "light.kitchen") is False and a.may_still(p, "camera.Bad") is False
    assert a.may_still("adult", "camera.doorbell") is False
    child = Principal(ident, Subject(user_role="child", user_id="c", door="lan"))
    assert a.may_still(child, "camera.doorbell") is False


# -- HA App mode (Ingress): the 'ha' door and the prefix ---------------------------------------------------
async def test_through_ingress_the_page_gets_prefixed_stills_and_the_ha_door_rules(tmp_path, monkeypatch):
    import test_ingress as ti
    fha = FakeHaRest()
    async with TestServer(fha.app()) as ha_srv:
        m = await ti.make(tmp_path, monkeypatch)
        try:
            m.app["cfg"].ha_url = str(ha_srv.make_url("")).rstrip("/")
            hub = m.app["hub"]
            hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES)
            hub.store.apply_event({"a": {"camera.doorbell": cam_state()}})
            m.store.link(ti.OWNER_HA, "owner", "Fictional Owner")
            assert (await m.page()).status == 200
            origin = str(m.client.make_url("")).rstrip("/")
            ws = await m.client.ws_connect("/ws", headers={**m.ha(), "Cookie": m._cookie_header(), "Origin": origin})
            await ws.send_json({"type": "subscribe", "entity_ids": ["camera.doorbell"]})
            raw = await asyncio.wait_for(ws.receive_str(), 3)
            assert HA_CAM_TOKEN not in raw and "token=" not in raw
            pic = json.loads(raw)["entities"]["camera.doorbell"]["a"]["entity_picture"]
            assert pic.startswith(ti.PREFIX + "/api/camera/camera.doorbell/still?v=")
            await ws.close()
            # the Supervisor strips the prefix: the server sees /api/camera/...
            path = pic[len(ti.PREFIX):]
            r = await m.request("GET", path + "&width=480&height=270", m.ha())
            assert r.status == 200 and await r.read() == JPEG
            assert fha.asked[-1]["auth"] == "Bearer unused-fictional-token"
            # the 'ha' door has the tunnel's rules: a role without tunnel cameras is refused
            m.store.link(ti.ADULT_HA, "adult", "Fictional Adult")
            m.jar.clear()
            assert (await m.request("GET", "/dashboard-kitchen/home", {**m.ha(ti.ADULT_HA), **ti.PAGE})).status == 200
            assert (await m.request("GET", path, m.ha(ti.ADULT_HA))).status == 200
            m.app["rbac"].set_override("adult", {"tunnel_cameras": False})
            assert (await m.request("GET", path, m.ha(ti.ADULT_HA))).status == 403
            assert len(fha.asked) == 2
        finally:
            await m.client.close()
            m.store.db.close()
