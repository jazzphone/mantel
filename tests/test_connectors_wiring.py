"""The three P3.4 registers wired the way P3.7 will (server.classify first, then app["ws_handlers"]),
over a real local WebSocket, against fake HA and fake MA. Commands stay disabled whatever is registered."""
import asyncio
import json

import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer

from connector_fakes import HA_TOKEN, ICE, MA_TOKEN, FakeHa, FakeMa, wait_for
from mantel_server import readproxy
from mantel_server.config import Config
from mantel_server.connectors import Ctx, Hooks, camera, ma
from mantel_server.readproxy import ReadProxy
from mantel_server.server import COMMAND_TYPES, COMMANDS_DISABLED, Hub, classify

EXPECTED_HANDLERS = {"read", "read_subscribe", "read_unsubscribe", "read_api", "ma/read", "ma/subscribe",
                     "ma/unsubscribe"}


def hooks():
    views = {"camera.porch", "light.kitchen", "feature:music"}
    return Hooks(may_read=lambda who, kind, ids: [i for i in ids if who == "adult" and i in views],
                 may_view=lambda who, eid: who == "adult" and eid == "camera.porch",
                 ha_token=lambda: HA_TOKEN)


async def ws_endpoint(request: web.Request) -> web.WebSocketResponse:
    """Stands in for P3.7's ClientSession dispatch."""
    app = request.app
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    ctx = Ctx(send=ws.send_json, identity=request.query.get("who"))
    tasks = set()
    try:
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                break
            msg = json.loads(m.data)
            if classify(msg) == "command":
                await ws.send_json({**COMMANDS_DISABLED, **({"id": msg["id"]} if "id" in msg else {})})
                continue
            handler = app["ws_handlers"].get(msg.get("type"))
            if handler is None:
                await ws.send_json({"type": "error", "code": "unknown_type"})
                continue
            t = asyncio.create_task(handler(ctx, msg))
            tasks.add(t)
            t.add_done_callback(tasks.discard)
    finally:
        await ctx.close()
    return ws


@pytest.fixture
async def env(tmp_path):
    fha, fma = FakeHa(), FakeMa()
    token = tmp_path / "ma_token"
    token.write_text(MA_TOKEN)
    async with TestServer(fha.app()) as ha_srv, TestServer(fma.app()) as ma_srv:
        ha_url = str(ha_srv.make_url("")).rstrip("/")
        cfg = Config(ha_url=ha_url, ma_url=str(ma_srv.make_url("")).rstrip("/"), ma_token_file=token)
        hub = Hub(cfg)
        hub.readproxy = ReadProxy(ha_url, HA_TOKEN)
        app = web.Application()
        app["cfg"] = cfg
        h = hooks()
        readproxy.register(app, hub, h)
        camera.register(app, hub, h)
        ma.register(app, hub, h)
        app.router.add_get("/ws", ws_endpoint)
        async with TestClient(TestServer(app)) as client:
            await asyncio.wait_for(app["ma"].connected.wait(), 3)
            yield type("Env", (), dict(fha=fha, fma=fma, client=client, app=app, hub=hub))
        await hub.readproxy.close()


async def recv(ws, timeout=3):
    return await asyncio.wait_for(ws.receive_json(), timeout)


def test_registered_handlers_are_pinned_and_none_is_a_command_type():
    app = web.Application()
    app["cfg"] = Config()
    hub = Hub(Config())
    readproxy.register(app, hub, None)
    camera.register(app, hub, None)
    ma.register(app, hub, None)
    assert set(app["ws_handlers"]) == EXPECTED_HANDLERS
    assert not set(app["ws_handlers"]) & COMMAND_TYPES
    assert all(classify({"type": t}) != "command" for t in EXPECTED_HANDLERS)


@pytest.mark.parametrize("cmd", [
    {"id": 1, "type": "call_service", "domain": "lock", "service": "unlock"},
    {"id": 2, "type": "ma/read", "command": "player_queues/play_media", "service": "x"},
    {"id": 4, "type": "command", "command": "players/cmd/power"},
])
async def test_command_shaped_messages_never_reach_a_connector(env, cmd):
    ws = await env.client.ws_connect("/ws?who=adult")
    await ws.send_json(cmd)
    reply = await recv(ws)
    assert reply["code"] == "commands_disabled"
    await ws.close()
    assert env.fha.frames == [] and env.fma.commands() == ["auth"]


async def test_a_command_inside_or_riding_on_a_read_is_refused(env):
    ws = await env.client.ws_connect("/ws?who=adult")
    await ws.send_json({"type": "read", "id": 5, "msg": {"type": "call_service", "domain": "lock", "service": "unlock"}})
    assert (await recv(ws))["error"]["code"] == "not_allowed"
    # server.classify() sees a read here (its type wins over a "cmd" key); the read handler refuses it
    await ws.send_json({"type": "read", "id": 6, "cmd": "light.turn_on", "msg": {"type": "get_config"}})
    assert (await recv(ws))["error"]["code"] == "not_allowed"
    await ws.send_json({"type": "ma/subscribe", "id": 7, "command": "players/cmd/power"})
    assert (await recv(ws))["error"]["code"] == "invalid"
    await ws.close()
    assert env.fha.frames == [] and env.fma.commands() == ["auth"]


async def test_camera_signaling_over_the_pages_read_messages(env):
    ws = await env.client.ws_connect("/ws?who=adult")
    await ws.send_json({"type": "read", "id": 1, "msg": {"type": "camera/webrtc/get_client_config",
                                                         "entity_id": "camera.porch"}})
    assert await recv(ws) == {"type": "read_result", "id": 1, "result": ICE}
    await ws.send_json({"type": "read_subscribe", "id": 2, "msg": {"type": "camera/webrtc/offer",
                                                                   "entity_id": "camera.porch", "offer": "v=0"}})
    frames = [await recv(ws) for _ in range(4)]
    assert frames[0] == {"type": "read_result", "id": 2, "result": None}
    assert [f["event"]["type"] for f in frames[1:]] == ["session", "answer", "candidate"]
    session = frames[1]["event"]["session_id"]
    await ws.send_json({"type": "read", "id": 3, "msg": {"type": "camera/webrtc/candidate", "entity_id": "camera.porch",
                                                         "session_id": session, "candidate": {"candidate": "c"}}})
    assert await recv(ws) == {"type": "read_result", "id": 3, "result": None}
    await ws.close()                                       # the socket ending ends the WebRTC session upstream
    await wait_for(lambda: "unsubscribe_events" in env.fha.sent_types())


async def test_camera_denied_over_the_socket_forwards_nothing(env):
    ws = await env.client.ws_connect("/ws?who=guest")
    await ws.send_json({"type": "read_subscribe", "id": 1, "msg": {"type": "camera/webrtc/offer",
                                                                   "entity_id": "camera.porch", "offer": "v=0"}})
    assert (await recv(ws))["error"]["code"] == "forbidden"
    await ws.close()
    assert env.fha.frames == []


async def test_filtered_reads_and_calendar_over_the_socket(env):
    ws = await env.client.ws_connect("/ws?who=adult")
    await ws.send_json({"type": "read", "id": 1, "msg": {"type": "history/history_during_period",
                                                         "entity_ids": ["light.kitchen", "lock.front"]}})
    got = await recv(ws)
    assert set(got["result"]) == {"light.kitchen"}
    await ws.send_json({"type": "read_api", "id": 2, "method": "GET",
                        "path": "calendars/calendar.family?start=2026-10-18&end=2026-10-19"})
    assert (await recv(ws))["error"]["code"] == "forbidden"     # adult may not view this calendar here
    await ws.close()
    assert env.fha.rest == []


async def test_ma_reads_over_the_socket(env):
    ws = await env.client.ws_connect("/ws?who=adult")
    await ws.send_json({"type": "ma/read", "id": 1, "command": "music/tracks/library_items", "args": {"limit": 5}})
    assert (await recv(ws))["result"] == [{"item_id": str(i)} for i in (1, 2, 3, 4)]
    await ws.close()
