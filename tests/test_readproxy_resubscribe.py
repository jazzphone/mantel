"""The read proxy's subscriptions (weather forecast, notifications, music) across a Home Assistant restart
(2026-11-01, audit 3, LINK-4): the proxy dropped them with the socket and never asked again, so a wall tablet
kept a frozen forecast until it reloaded. Against a fake Home Assistant socket; nothing else is contacted."""
import asyncio

from aiohttp import web
from aiohttp.test_utils import TestServer

from mantel_server.readproxy import ReadProxy

FORECAST = {"type": "weather/subscribe_forecast", "entity_id": "weather.home", "forecast_type": "daily"}


class FakeHA:
    def __init__(self):
        self.sockets, self.subs, self.unsubs, self.refuse = [], [], [], False
        self.up = True

    async def handler(self, request):
        if not self.up:
            return web.Response(status=503)
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.sockets.append(ws)
        await ws.send_json({"type": "auth_required"})
        await ws.receive_json()
        await ws.send_json({"type": "auth_ok"})
        async for m in ws:
            d = m.json()
            if d["type"] == "weather/subscribe_forecast":
                self.subs.append(d["id"])
                if self.refuse:
                    await ws.send_json({"id": d["id"], "type": "result", "success": False,
                                        "error": {"code": "not_found", "message": "gone"}})
                    continue
                await ws.send_json({"id": d["id"], "type": "result", "success": True, "result": None})
                await ws.send_json({"id": d["id"], "type": "event",
                                    "event": {"type": "daily", "forecast": [{"t": f"forecast {len(self.sockets)}"}]}})
            elif d["type"] == "unsubscribe_events":
                self.unsubs.append(d["subscription"])
                await ws.send_json({"id": d["id"], "type": "result", "success": True, "result": None})
            elif d["type"] == "get_config":
                await ws.send_json({"id": d["id"], "type": "result", "success": True, "result": {}})
        return ws

    async def start(self):
        app = web.Application()
        app.router.add_get("/api/websocket", self.handler)
        self.server = TestServer(app, host="127.0.0.1")
        await self.server.start_server()
        return f"http://127.0.0.1:{self.server.port}"


async def _until(cond, seconds=5.0):
    for _ in range(int(seconds / 0.02)):
        if cond():
            return True
        await asyncio.sleep(0.02)
    return cond()


async def test_a_subscription_is_asked_for_again_after_home_assistant_restarts():
    ha = FakeHA()
    proxy = ReadProxy(await ha.start(), "tok")
    got = []
    try:
        mid = await proxy.subscribe(FORECAST, got.append)
        assert await _until(lambda: got)
        assert got[-1]["forecast"] == [{"t": "forecast 1"}]
        await ha.sockets[0].close()                 # Home Assistant restarts; no page asks the proxy for anything
        assert await _until(lambda: len(ha.subs) == 2), "the proxy asked Home Assistant for the forecast again"
        assert await _until(lambda: got[-1]["forecast"] == [{"t": "forecast 2"}]), "and the consumer got the new one"
        # the consumer's handle still ends it, with the id Home Assistant knows it by now
        await proxy.unsubscribe(mid)
        assert await _until(lambda: ha.unsubs == [ha.subs[1]])
        await ha.sockets[1].close()
        await asyncio.sleep(0.3)
        assert len(ha.subs) == 2, "an ended subscription is not asked for again"
    finally:
        await proxy.close()
        await ha.server.close()


async def test_resubscribing_waits_out_a_home_assistant_that_is_still_down(monkeypatch):
    monkeypatch.setattr(ReadProxy, "RESUBSCRIBE_BACKOFF", (0.05, 0.05))
    ha = FakeHA()
    proxy = ReadProxy(await ha.start(), "tok")
    got = []
    try:
        await proxy.subscribe(FORECAST, got.append)
        assert await _until(lambda: got)
        ha.up = False
        await ha.sockets[0].close()
        await asyncio.sleep(0.3)                    # several refused attempts
        assert len(ha.subs) == 1
        ha.up = True
        assert await _until(lambda: len(ha.subs) == 2)
        assert await _until(lambda: got[-1]["forecast"] == [{"t": "forecast 2"}])
    finally:
        await proxy.close()
        await ha.server.close()


async def test_a_subscription_home_assistant_now_refuses_is_dropped_and_the_others_continue(monkeypatch):
    ha = FakeHA()
    proxy = ReadProxy(await ha.start(), "tok")
    kept, gone = [], []
    try:
        await proxy.subscribe(FORECAST, gone.append)
        await proxy.subscribe({**FORECAST, "entity_id": "weather.cabin"}, kept.append)
        assert await _until(lambda: gone and kept)
        ha.refuse = True
        await ha.sockets[0].close()
        assert await _until(lambda: len(ha.subs) == 4)
        ha.refuse = False
        await asyncio.sleep(0.2)
        assert len(ha.subs) == 4 and not proxy._defs, "refused: not asked for again in a loop"
    finally:
        await proxy.close()
        await ha.server.close()


async def test_a_consumer_that_raises_does_not_end_the_proxys_reader():
    ha = FakeHA()
    proxy = ReadProxy(await ha.start(), "tok")
    calls = []

    def bad(_event):
        calls.append(1)
        raise ValueError("a consumer trips on this event")
    try:
        await proxy.subscribe(FORECAST, bad)
        assert await _until(lambda: calls)
        assert await proxy.request({"type": "get_config"}) == {}
        assert len(ha.sockets) == 1, "the same socket still answers"
    finally:
        await proxy.close()
        await ha.server.close()
