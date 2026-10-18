"""A FAKE go2rtc for the Live TV tests: the parts of go2rtc 1.9's API Mantel uses, behaving as the real
one was seen to behave (checked against the transcode image's go2rtc 1.9.9 on 2026-10-18):

  PATCH  /api/streams?name&src   adds the stream in memory, 200 (an ``exec:`` source is refused, 400)
  DELETE /api/streams?src        removes it, then answers 400 (it cannot write its read-only config)
  GET    /api/streams            {name: {"producers": [{"url"}], "consumers": [...]}}
  GET    /api/ws?src             WebSocket: {"type":"webrtc/offer","value":sdp} -> webrtc/answer + one
                                 webrtc/candidate; client webrtc/candidate frames are recorded

Nothing here touches a real tuner or go2rtc."""
from __future__ import annotations

import asyncio
import json

from aiohttp import WSMsgType, web

ANSWER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1\r\n"
CANDIDATE = "candidate:1 1 udp 2130706431 192.0.2.10 8555 typ host"


class FakeGo2rtc:
    def __init__(self) -> None:
        self.streams: dict[str, str] = {}
        self.calls: list[tuple[str, str]] = []
        self.offers: list[tuple[str, str]] = []
        self.candidates: list[tuple[str, str]] = []
        self.open: dict[str, int] = {}
        self.fail_patch = False

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_route("PATCH", "/api/streams", self.patch)
        app.router.add_route("PUT", "/api/streams", self.put)
        app.router.add_delete("/api/streams", self.delete)
        app.router.add_get("/api/streams", self.list)
        app.router.add_get("/api/ws", self.ws)
        return app

    async def patch(self, request: web.Request) -> web.Response:
        name, src = request.query.get("name", ""), request.query.get("src", "")
        self.calls.append(("PATCH", name))
        if self.fail_patch or src.startswith("exec:") or not name:
            return web.Response(status=400)
        self.streams[name] = src
        return web.Response(status=200)

    async def put(self, request: web.Request) -> web.Response:
        self.calls.append(("PUT", request.query.get("name", "")))
        return web.Response(status=400, text="open /config/go2rtc.yaml: read-only file system")

    async def delete(self, request: web.Request) -> web.Response:
        name = request.query.get("src", "")
        self.calls.append(("DELETE", name))
        self.streams.pop(name, None)
        return web.Response(status=400, text="open /config/go2rtc.yaml: read-only file system")

    async def list(self, _request: web.Request) -> web.Response:
        return web.json_response({n: {"producers": [{"url": s}], "consumers": [{}] * self.open.get(n, 0)}
                                  for n, s in self.streams.items()})

    async def ws(self, request: web.Request) -> web.WebSocketResponse:
        name = request.query.get("src", "")
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.open[name] = self.open.get(name, 0) + 1
        try:
            async for m in ws:
                if m.type != WSMsgType.TEXT:
                    break
                d = json.loads(m.data)
                if d.get("type") == "webrtc/offer":
                    self.offers.append((name, d.get("value")))
                    if name not in self.streams:
                        await ws.send_json({"type": "error", "value": "streams: stream not found"})
                        continue
                    await ws.send_json({"type": "webrtc/answer", "value": ANSWER})
                    await asyncio.sleep(0)
                    await ws.send_json({"type": "webrtc/candidate", "value": CANDIDATE})
                elif d.get("type") == "webrtc/candidate":
                    self.candidates.append((name, d.get("value")))
        finally:
            self.open[name] -= 1
        return ws
