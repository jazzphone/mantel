"""connectors/camera.py against a fake HA: WebRTC signaling relayed, ICE config unchanged, the view hook
asked first (denied -> nothing forwarded), candidates only for this connection's own sessions."""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from connector_fakes import HA_TOKEN, ICE, FakeHa, wait_for
from gateway_fakes import off  # noqa: F401 -- fixture
from mantel_server.config import Config
from mantel_server.connectors import Ctx, Forbidden, Hooks
from mantel_server.connectors import camera
from mantel_server.connectors.camera import CameraSignaling, SignalingProxy
from mantel_server.ha.ha_client import ALLOWED_TYPES, CommandBlocked

VIEWERS = {("adult", "camera.porch"), ("adult", "camera.garage"), ("other", "camera.porch")}


def may_view(identity, entity_id):
    return (identity, entity_id) in VIEWERS


@pytest.fixture
async def env():
    fake = FakeHa()
    async with TestServer(fake.app()) as server:
        proxy = SignalingProxy(str(server.make_url("")).rstrip("/"), HA_TOKEN)
        sig = CameraSignaling(lambda: proxy, Hooks(may_view=may_view))
        yield type("Env", (), dict(fake=fake, proxy=proxy, sig=sig))
        await proxy.close()


def ctx_for(identity):
    out = []

    async def send(m):
        out.append(m)
    c = Ctx(send=send, identity=identity)
    c.out = out
    return c


async def test_client_config_is_has_ice_config_unchanged(env):
    got = await env.sig.client_config(ctx_for("adult"), {"type": "camera/webrtc/get_client_config",
                                                         "entity_id": "camera.porch"})
    assert got == ICE
    assert env.fake.sent_types() == ["auth", "camera/webrtc/get_client_config"]


@pytest.mark.parametrize("who,entity", [("guest", "camera.porch"), ("adult", "camera.nursery"), (None, "camera.porch")])
async def test_denied_view_forwards_nothing(env, who, entity):
    c = ctx_for(who)
    with pytest.raises(Forbidden):
        await env.sig.client_config(c, {"type": "camera/webrtc/get_client_config", "entity_id": entity})
    with pytest.raises(Forbidden):
        await env.sig.offer(c, {"type": "camera/webrtc/offer", "entity_id": entity, "offer": "v=0"}, lambda e: None)
    with pytest.raises(Forbidden):
        await env.sig.candidate(c, {"type": "camera/webrtc/candidate", "entity_id": entity, "session_id": "s",
                                    "candidate": {}})
    assert env.fake.frames == []                    # no connection was even opened
    assert env.sig.forwarded == []


async def test_offer_relays_session_answer_candidates_then_candidate_and_unsubscribe(env):
    c, events = ctx_for("adult"), []
    unsub = await env.sig.offer(c, {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0 fake"},
                                events.append)
    await wait_for(lambda: len(events) == 3)
    assert [e["type"] for e in events] == ["session", "answer", "candidate"]
    session = events[0]["session_id"]
    cand = {"candidate": "candidate:2 1 udp 1 198.51.100.7 9 typ host", "sdpMid": "0", "sdpMLineIndex": 0}
    assert await env.sig.candidate(c, {"type": "camera/webrtc/candidate", "entity_id": "camera.porch",
                                       "session_id": session, "candidate": cand}) is None
    offer_frame = next(f for f in env.fake.frames if f["type"] == "camera/webrtc/offer")
    assert offer_frame == {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0 fake",
                           "id": offer_frame["id"]}
    assert env.fake.frames[-1] == {"type": "camera/webrtc/candidate", "entity_id": "camera.porch",
                                   "session_id": session, "candidate": cand, "id": env.fake.frames[-1]["id"]}
    await unsub()
    await wait_for(lambda: env.fake.frames[-1]["type"] == "unsubscribe_events")
    assert env.fake.frames[-1]["subscription"] == offer_frame["id"]
    with pytest.raises(Forbidden):                  # the session ended with the subscription
        await env.sig.candidate(c, {"type": "camera/webrtc/candidate", "entity_id": "camera.porch",
                                    "session_id": session, "candidate": cand})


async def test_candidates_only_for_this_connections_own_session_and_camera(env):
    mine, other, events = ctx_for("adult"), ctx_for("other"), []
    await env.sig.offer(mine, {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0"},
                        events.append)
    await wait_for(lambda: events)
    session = events[0]["session_id"]
    sent = len(env.fake.frames)
    with pytest.raises(Forbidden):                  # another viewer of the same camera
        await env.sig.candidate(other, {"type": "camera/webrtc/candidate", "entity_id": "camera.porch",
                                        "session_id": session, "candidate": {}})
    with pytest.raises(Forbidden):                  # my session, but named for a different camera
        await env.sig.candidate(mine, {"type": "camera/webrtc/candidate", "entity_id": "camera.garage",
                                       "session_id": session, "candidate": {}})
    with pytest.raises(Forbidden):
        await env.sig.candidate(mine, {"type": "camera/webrtc/candidate", "entity_id": "camera.porch",
                                       "session_id": "made-up", "candidate": {}})
    assert len(env.fake.frames) == sent


@pytest.mark.parametrize("msg", [
    {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0", "service": "turn_off"},
    {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": {"sdp": "v=0"}},
    {"type": "camera/webrtc/offer", "entity_id": "lock.front", "offer": "v=0"},
    {"type": "camera/webrtc/offer", "entity_id": ["camera.porch"], "offer": "v=0"},
])
async def test_malformed_offers_are_refused_before_ha(env, msg):
    with pytest.raises((CommandBlocked, Forbidden)):
        await env.sig.offer(ctx_for("adult"), msg, lambda e: None)
    assert env.fake.frames == []


async def test_signaling_connection_sends_nothing_but_signaling(env):
    for bad in ({"type": "history/history_during_period", "entity_ids": ["camera.porch"]},
                {"type": "call_service", "domain": "camera", "service": "turn_off"},
                {"type": "subscribe_events", "event_type": "area_registry_updated"},   # on HA's list, not signaling
                {"type": "camera/webrtc/candidate", "entity_id": "camera.porch", "session_id": "s", "candidate": {},
                 "extra": 1}):
        with pytest.raises(CommandBlocked):
            await env.proxy.request(bad)
    with pytest.raises(CommandBlocked):
        await env.proxy.get_calendar_events("calendar.x", "2026-10-18", "2026-10-19")
    assert env.fake.frames == []


async def test_every_frame_the_signaling_connection_sent_is_on_has_allowlist(env):
    c, events = ctx_for("adult"), []
    await env.sig.client_config(c, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.porch"})
    unsub = await env.sig.offer(c, {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0"},
                                events.append)
    await wait_for(lambda: events)
    await unsub()
    await wait_for(lambda: env.fake.sent_types()[-1] == "unsubscribe_events")
    assert set(env.fake.sent_types()) <= ALLOWED_TYPES
    assert not env.fake.unexpected


async def test_register_adds_read_routes_and_opens_with_the_ha_token():
    fake = FakeHa()
    async with TestServer(fake.app()) as server:
        app = web.Application()
        app["cfg"] = Config(ha_url=str(server.make_url("")).rstrip("/"))
        sig = camera.register(app, None, Hooks(may_view=may_view, ha_token=lambda: HA_TOKEN))
        assert set(app["read_routes"]) == {"camera/webrtc/get_client_config", "camera/webrtc/offer",
                                           "camera/webrtc/candidate"}
        assert app["read_routes"]["camera/webrtc/offer"].request is None       # a subscription only
        for fn in app.on_startup:
            await fn(app)
        got = await app["read_routes"]["camera/webrtc/get_client_config"].request(
            ctx_for("adult"), {"type": "camera/webrtc/get_client_config", "entity_id": "camera.porch"})
        assert got == ICE and sig.forwarded == ["camera/webrtc/get_client_config"]
        for fn in app.on_cleanup:
            await fn(app)


async def test_register_without_a_token_is_unavailable():
    app = web.Application()
    app["cfg"] = Config(ha_url="http://ha.fake.test:8123")
    camera.register(app, None, Hooks(may_view=may_view))
    for fn in app.on_startup:
        await fn(app)
    with pytest.raises(ConnectionError):
        await app["read_routes"]["camera/webrtc/get_client_config"].request(
            ctx_for("adult"), {"type": "camera/webrtc/get_client_config", "entity_id": "camera.porch"})


# -- the full app: who may watch, and for how long (the 2026-10 audit) ------------------------------------
class RecordingProxy:
    """Stands in for the signaling connection to HA: what would reach HA, and what is still live there."""

    def __init__(self, delay=0.0):
        self.subscribed, self.unsubscribed, self.live, self.delay, self._n = [], [], {}, delay, 0

    async def subscribe(self, msg, on_event):
        self._n += 1
        mid = self._n
        await asyncio.sleep(self.delay)                  # a round trip to HA
        self.subscribed.append(mid)
        self.live[mid] = on_event
        on_event({"type": "session", "session_id": f"s{mid}"})
        return mid

    async def unsubscribe(self, mid):
        self.unsubscribed.append(mid)
        self.live.pop(mid, None)

    async def request(self, msg):
        return None

    async def close(self):
        pass


def _offer(rid, cam="camera.doorbell"):
    return {"type": "read_subscribe", "id": rid,
            "msg": {"type": "camera/webrtc/offer", "entity_id": cam, "offer": "v=0"}}


async def test_the_same_subscription_id_twice_never_leaks_a_session_at_ha(off):
    rec = RecordingProxy(delay=0.05)
    off.app["camera_signaling_holder"]["proxy"] = rec
    await off.login("alex", "adult")
    ws = await off.socket(expect_caps=False)
    await ws.send_json(_offer(5))
    await ws.send_json(_offer(5))                        # the same id, before the first answer
    await asyncio.sleep(0.3)
    await ws.close()
    await asyncio.sleep(0.3)
    assert rec.subscribed == [1] and rec.live == {}


async def test_a_camera_hidden_by_a_deny_on_view_cannot_be_watched_either(off):
    from gateway_fakes import recv
    from mantel_server.identity.rbac import Grant
    rec = RecordingProxy()
    off.app["camera_signaling_holder"]["proxy"] = rec
    await off.login("alex", "adult")
    off.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="entity",
                                        resource="camera.doorbell", roles={"adult"}))
    ws = await off.socket(expect_caps=False)
    await ws.send_json(_offer(2))
    got = await recv(ws)
    while got.get("id") != 2:
        got = await recv(ws)
    assert got.get("error", {}).get("code") in ("forbidden", "not_allowed") and rec.subscribed == []
    await ws.close()


async def test_losing_a_camera_ends_its_live_stream_at_the_next_tick(off):
    from mantel_server import server
    from mantel_server.identity.rbac import Grant
    rec = RecordingProxy()
    off.app["camera_signaling_holder"]["proxy"] = rec
    await off.login("alex", "adult")
    ws = await off.socket(expect_caps=False)
    await ws.send_json(_offer(1))
    await asyncio.sleep(0.2)
    assert list(rec.live) == [1]
    off.app["rbac"].add_grant(Grant(effect="deny", actions=("*",), resource_kind="entity",
                                        resource="camera.doorbell", roles={"adult"}))
    await server.tick_once(off.app, off.app["hub"])
    assert rec.unsubscribed == [1] and rec.live == {}
    await ws.close()


# -- the second audit (2026-10): how many streams one tab, and the house, may ask HA for ------------------------------
async def test_one_socket_cannot_start_unlimited_camera_streams(off):
    """MED-6 (audit, second pass): Live TV caps its WebRTC sessions (4 a socket, 32 in all); camera offers had no cap:
    sixty offers on one browser tab were sixty live streams at Home Assistant. A socket may hold
    ``MAX_OFFERS_PER_SOCKET`` (16: the Cameras page opens one live tile per camera, nine in the house it was built
    against, on its one socket); the rest are refused as ``forbidden``, which both camera cards already handle (the
    picture card stays on its still, the doorbell card backs off and tries later). A stream that ends frees its place."""
    from gateway_fakes import recv
    rec = RecordingProxy()
    off.app["camera_signaling_holder"]["proxy"] = rec
    await off.login("alex", "adult")
    ws = await off.socket(expect_caps=False)
    for i in range(1, 61):
        await ws.send_json(_offer(i))
    answers = {}
    while len(answers) < 60:
        got = await recv(ws)
        if got.get("type") == "read_result":
            answers[got["id"]] = got
    refused = [i for i, a in answers.items() if "error" in a]
    assert len(rec.live) == camera.MAX_OFFERS_PER_SOCKET and len(refused) == 60 - camera.MAX_OFFERS_PER_SOCKET
    assert {answers[i]["error"]["code"] for i in refused} == {"forbidden"}
    assert len(rec.subscribed) == camera.MAX_OFFERS_PER_SOCKET                       # the refused never reached HA
    await ws.send_json({"type": "read_unsubscribe", "id": next(iter(rec.live))})     # one tile closes ...
    await asyncio.sleep(0.2)
    await ws.send_json(_offer(100))                                                  # ... and another may open
    await asyncio.sleep(0.2)
    assert len(rec.live) == camera.MAX_OFFERS_PER_SOCKET
    await ws.close()
    await asyncio.sleep(0.3)
    assert rec.live == {} and off.app["camera_signaling"].offers == 0                # all let go with the socket


async def test_all_the_sockets_together_have_a_total_cap_too(off, monkeypatch):
    """MED-6 (audit, second pass): and across tabs and tablets at most ``MAX_OFFERS`` in all."""
    monkeypatch.setattr(camera, "MAX_OFFERS", 5)
    rec = RecordingProxy()
    off.app["camera_signaling_holder"]["proxy"] = rec
    await off.login("alex", "adult")
    a, b = await off.socket(expect_caps=False), await off.socket(expect_caps=False)
    for i in range(1, 4):
        await a.send_json(_offer(i))
    for i in range(1, 4):
        await b.send_json(_offer(i))
    await asyncio.sleep(0.4)
    assert len(rec.live) == 5 and off.app["camera_signaling"].offers == 5
    await a.close()
    await b.close()
    await asyncio.sleep(0.3)
    assert rec.live == {} and off.app["camera_signaling"].offers == 0


async def test_an_offer_that_fails_at_home_assistant_frees_its_place(off, monkeypatch):
    """MED-6 (audit, second pass): the cap counts an offer from before the await to HA, so one that fails there must
    give its place back, or a Home Assistant that is down would use the whole cap up on errors."""
    monkeypatch.setattr(camera, "MAX_OFFERS_PER_SOCKET", 2)

    class Down(RecordingProxy):
        async def subscribe(self, msg, on_event):
            raise ConnectionError("unavailable")

    off.app["camera_signaling_holder"]["proxy"] = Down()
    await off.login("alex", "adult")
    ws = await off.socket(expect_caps=False)
    for i in range(1, 7):
        await ws.send_json(_offer(i))
        await asyncio.sleep(0.05)
    await asyncio.sleep(0.2)
    assert off.app["camera_signaling"].offers == 0
    rec = RecordingProxy()
    off.app["camera_signaling_holder"]["proxy"] = rec
    await ws.send_json(_offer(10))
    await asyncio.sleep(0.2)
    assert len(rec.live) == 1                                # HA is back: the offer is not refused as "too many"
    await ws.close()
