"""A FAKE go2rtc for the Live TV tests: the parts of go2rtc 1.9's API Mantel uses, behaving as the real
one was seen to behave (checked against the transcode image's go2rtc 1.9.9 on 2026-10-18):

  PATCH  /api/streams?name&src   adds the stream in memory, 200 (an ``exec:`` source is refused, 400)
  DELETE /api/streams?src        removes it, then answers 400 (it cannot write its read-only config)
  GET    /api/streams            {name: {"producers": [{"url"}], "consumers": [...]}}
  GET    /api/streams?src&video=all&audio=all
                                 the PROBE (the cameras' Test, camera_setup.py; checked 2026-11-02): the stream's
                                 producer with its medias and its url WITH the credentials in it, or 500 with go2rtc's
                                 reason as plain text ("streams: wrong user/pass", ...)
  GET    /api/frame.jpeg?src     one JPEG of a stream it has (404 otherwise); the query is recorded. A stream it could
                                 not open answers 200 with an EMPTY body (go2rtc 1.9.9 does, whatever went wrong)
  GET    /api/ws?src             WebSocket: {"type":"webrtc/offer","value":sdp} -> webrtc/answer + one
                                 webrtc/candidate; client webrtc/candidate frames are recorded

Nothing here touches a real tuner or go2rtc."""
from __future__ import annotations

import asyncio
import json

from aiohttp import WSMsgType, web

ANSWER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1\r\n"
FRAME = b"\xff\xd8fictional frame\xff\xd9"
CANDIDATE = "candidate:1 1 udp 2130706431 192.0.2.10 8555 typ host"


class FakeGo2rtc:
    def __init__(self) -> None:
        self.streams: dict[str, str] = {}
        self.calls: list[tuple[str, str]] = []
        self.offers: list[tuple[str, str]] = []
        self.candidates: list[tuple[str, str]] = []
        self.open: dict[str, int] = {}
        self.fail_patch = False
        self.frames: list[dict[str, str]] = []
        # the probe: a stream whose url holds one of these words answers 500 with that reason (and a frame of
        # nothing); one that holds a word of `silent` has a frame of nothing; `medias` is what a healthy one carries
        self.patched: list[tuple[str, str]] = []              # every stream put in: (name, src), for what was sent
        self.probe_fail: dict[str, str] = {}
        self.silent: set[str] = set()
        self.medias = ["video, recvonly, H264", "audio, recvonly, PCMA"]
        self.probes: list[dict[str, str]] = []
        self.probe_delay = 0.0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_route("PATCH", "/api/streams", self.patch)
        app.router.add_route("PUT", "/api/streams", self.put)
        app.router.add_delete("/api/streams", self.delete)
        app.router.add_get("/api/streams", self.list)
        app.router.add_get("/api/ws", self.ws)
        app.router.add_get("/api/frame.jpeg", self.frame)
        return app

    async def patch(self, request: web.Request) -> web.Response:
        name, src = request.query.get("name", ""), request.query.get("src", "")
        self.calls.append(("PATCH", name))
        if self.fail_patch or src.startswith("exec:") or not name:
            return web.Response(status=400)
        self.streams[name] = src
        self.patched.append((name, src))
        return web.Response(status=200)

    async def put(self, request: web.Request) -> web.Response:
        self.calls.append(("PUT", request.query.get("name", "")))
        return web.Response(status=400, text="open /config/go2rtc.yaml: read-only file system")

    async def delete(self, request: web.Request) -> web.Response:
        name = request.query.get("src", "")
        self.calls.append(("DELETE", name))
        self.streams.pop(name, None)
        return web.Response(status=400, text="open /config/go2rtc.yaml: read-only file system")

    async def list(self, request: web.Request) -> web.Response:
        if "src" in request.query:
            return await self.probe(request)
        return web.json_response({n: {"producers": [{"url": s}], "consumers": [{}] * self.open.get(n, 0)}
                                  for n, s in self.streams.items()})

    async def probe(self, request: web.Request) -> web.Response:
        self.probes.append(dict(request.query))
        url = self.streams.get(request.query.get("src", ""))
        if url is None:
            return web.Response(status=404, text="stream not found")
        if self.probe_delay:
            await asyncio.sleep(self.probe_delay)
        for word, reason in self.probe_fail.items():
            if word in url:
                return web.Response(status=500, text=reason + "\n", content_type="text/plain")
        return web.json_response({"producers": [{"id": 1, "format_name": "rtsp", "url": url, "medias": list(self.medias)}],
                                  "consumers": None})

    async def frame(self, request: web.Request) -> web.Response:
        self.frames.append(dict(request.query))
        url = self.streams.get(request.query.get("src", ""))
        if url is None:
            return web.Response(status=404, text="stream not found")
        if any(w in url for w in self.silent) or any(w in url for w in self.probe_fail):
            return web.Response(status=200, body=b"")
        return web.Response(body=FRAME, content_type="image/jpeg")

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
