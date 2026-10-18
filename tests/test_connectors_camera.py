"""connectors/camera.py against a fake HA: WebRTC signaling relayed, ICE config unchanged, the view hook
asked first (denied -> nothing forwarded), candidates only for this connection's own sessions."""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from connector_fakes import HA_TOKEN, ICE, FakeHa, wait_for
from mantel_server.config import Config
from mantel_server.connectors import Ctx, Forbidden, Hooks
from mantel_server.connectors import camera
from mantel_server.connectors.camera import CameraSignaling, SignalingProxy
from mantel_server.ha_client import ALLOWED_TYPES, CommandBlocked

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
