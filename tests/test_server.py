"""Server protocol tests against a fake upstream: no Home Assistant, no network."""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mantel_server.config import Config
from mantel_server.server import Hub, classify, loopback_only, ws_handler, api_entities


@pytest.fixture
async def client():
    hub = Hub(Config())
    hub.registry.load([{"area_id": "kitchen", "name": "Kitchen"}], [],
                      [{"entity_id": "light.a", "area_id": "kitchen"}])
    hub.store.apply_event({"a": {
        "light.a": {"s": "on", "a": {"friendly_name": "A"}, "lc": 1.0},
        "sensor.x": {"s": "1", "a": {}, "lc": 1.0},
    }})

    class FakeHa:
        class _C:
            msgs = bytes = 0
        rx = _C()
    hub.ha = FakeHa()
    app = web.Application(middlewares=[loopback_only])
    app["hub"] = hub
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/entities", api_entities)
    async with TestClient(TestServer(app)) as c:
        c.hub = hub
        yield c


async def recv(ws, timeout=2):
    return await asyncio.wait_for(ws.receive_json(), timeout)


async def test_snapshot_then_only_subscribed_diffs(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "subscribe", "entity_ids": [], "areas": ["Kitchen"]})
    snap = await recv(ws)
    assert snap["type"] == "snapshot" and set(snap["entities"]) == {"light.a"}

    client.hub.store.apply_event({"c": {"sensor.x": {"+": {"s": "2", "lc": 2.0}}}})
    client.hub.on_change({"sensor.x"})          # not subscribed: nothing arrives
    client.hub.store.apply_event({"c": {"light.a": {"+": {"s": "off", "lc": 3.0}}}})
    client.hub.on_change({"light.a"})
    diff = await recv(ws)
    assert diff == {"type": "diff", "changes": {"light.a": {"+": {"s": "off", "lc": 3.0, "lu": 3.0}}}}
    await ws.close()


@pytest.mark.parametrize("cmd", [
    {"id": 5, "type": "call_service", "domain": "valve", "service": "close_valve"},
    {"type": "command", "target": "valve.main"},
    {"cmd": "light.turn_on", "target": "light.a"},
    {"type": "anything", "service": "lock.unlock"},
])
async def test_commands_are_refused_with_explicit_error(client, cmd):
    ws = await client.ws_connect("/ws")
    await ws.send_json(cmd)
    err = await recv(ws)
    assert err["type"] == "error" and err["code"] == "commands_disabled"
    if "id" in cmd:
        assert err["id"] == cmd["id"]
    await ws.close()


def test_classify():
    assert classify({"type": "subscribe"}) == "subscribe"
    assert classify({"type": "call_service"}) == "command"
    assert classify([1]) == "invalid"
    assert classify({"type": "mystery"}) == "unknown"


async def test_foreign_host_and_origin_are_refused(client):
    r = await client.get("/api/entities", headers={"Host": "evil.example.com"})
    assert r.status == 403
    r = await client.get("/api/entities", headers={"Origin": "http://evil.example.com"})
    assert r.status == 403
    r = await client.get("/api/entities")
    assert r.status == 200


async def test_coalescing_is_enforced_per_client(client):
    client.hub.coalescing.default = 0.4
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "subscribe", "entity_ids": ["sensor.x"]})
    await recv(ws)
    for i in range(5):
        client.hub.store.apply_event({"c": {"sensor.x": {"+": {"s": str(10 + i), "lc": 10.0 + i}}}})
        client.hub.on_change({"sensor.x"})
        await asyncio.sleep(0.02)
    diff = await recv(ws)                       # arrives after the interval, carries the final value
    assert diff["changes"]["sensor.x"]["+"]["s"] == "14"
    with pytest.raises(asyncio.TimeoutError):
        await recv(ws, timeout=0.6)             # and nothing else
    await ws.close()
