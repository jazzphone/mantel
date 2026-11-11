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


# -- stopping the server (audit, second pass) ---------------------------------------------------------------
async def test_stopping_closes_open_page_sockets_instead_of_waiting_them_out(mantel):
    """DEP-1 (audit, second pass): only /linked/ws was closed on shutdown, so AppRunner.cleanup() waited out
    shutdown_timeout (60 s) for every screen's /ws, and Docker's and the Supervisor's 10 s stop ended in SIGKILL
    (on_cleanup never ran). on_shutdown now closes every page socket with 1001 (going away)."""
    from aiohttp import WSMsgType
    await mantel.user("avery", "owner")
    r, _ = await mantel.sign_in("avery")
    assert r.status == 200
    ws = await mantel.client.ws_connect("/ws")                 # a screen, idle
    cleanup = asyncio.ensure_future(mantel.client.server.runner.cleanup())   # what SIGTERM leads to in run_app
    msg = await ws.receive(timeout=5)
    assert msg.type == WSMsgType.CLOSE and msg.data == 1001
    done, _ = await asyncio.wait({cleanup}, timeout=5)          # Docker's stop timeout is 10 s
    assert done, "AppRunner.cleanup() was still waiting on an open /ws after 5 s"
    await cleanup


async def test_stopping_closes_every_kind_of_long_lived_socket(mantel):
    """DEP-1 (audit, second pass): the shutdown handler also ends the media proxy's sockets, the live talk
    relay's streams and the proxy test's, each with 1001, and does not stop at one that will not answer."""
    class Sock:
        def __init__(self, answers=True):
            self.codes, self.answers = [], answers

        async def close(self, code=1000, message=b""):
            self.codes.append(code)
            if not self.answers:
                await asyncio.sleep(60)

    class Stream:
        def __init__(self, ws):
            self.ws = ws

    app = mantel.app
    proxy_sock, check_sock, talk_sock, silent = Sock(), Sock(), Sock(), Sock(answers=False)
    app["media_proxy"].sockets.update({proxy_sock, silent})
    app["proxy_check_sockets"].add(check_sock)
    talk = app.get("talk")
    if talk is None:                                           # commands are off in this app: a stand-in relay
        class Relay:
            streams = set()
        talk = Relay()
        app._state["talk"] = talk
    talk.streams.add(Stream(talk_sock))
    try:
        await asyncio.wait_for(app.shutdown(), 10)
    finally:
        app["media_proxy"].sockets.clear()
        talk.streams.clear()
    assert proxy_sock.codes == check_sock.codes == talk_sock.codes == silent.codes == [1001]


async def test_the_database_is_closed_when_the_server_stops(mantel):
    """DEP-1 (audit, second pass): nothing closed the SQLite connection, so a clean stop never checkpointed the
    WAL. It is the last cleanup, after everything that may still write has stopped."""
    import sqlite3
    await mantel.client.server.runner.cleanup()
    with pytest.raises(sqlite3.ProgrammingError):
        mantel.store.db.execute("SELECT 1")


def test_every_listener_gives_open_sockets_seconds_not_a_minute():
    """DEP-1 (audit, second pass): run_app and the two AppRunners (direct access, Connect) waited the default 60 s
    for open handlers; each now passes a short shutdown_timeout (less than a container's 10 s stop)."""
    import inspect

    from mantel_server import __main__ as entry
    from mantel_server.network import connect_pairing, direct
    assert entry.SHUTDOWN_TIMEOUT == direct.SHUTDOWN_TIMEOUT == connect_pairing.SHUTDOWN_TIMEOUT
    assert 0 < entry.SHUTDOWN_TIMEOUT < 10
    assert "shutdown_timeout=SHUTDOWN_TIMEOUT" in inspect.getsource(entry.main)
    for mod in (direct, connect_pairing):
        assert "web.AppRunner(app, shutdown_timeout=SHUTDOWN_TIMEOUT)" in inspect.getsource(mod.serve)
