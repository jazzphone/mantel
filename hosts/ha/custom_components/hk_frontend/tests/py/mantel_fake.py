"""A stand-in for Mantel Server's linked endpoint (/linked/ws), on 127.0.0.1,
for the linked mode tests (test_linked_mode.py). It speaks the link's protocol
(mantel_link.py's docstring), records every frame and header it gets, and the
test decides what it answers and pushes. Fictional house: one wall tablet
(Hall), Live TV's viewers and one channel, one Alarm PIN panel. By default
Mantel owns all of it (the whole entry: `owners`); a test sets its own."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from aiohttp import web
from aiohttp.test_utils import TestServer

ENTRY = "01JLINKEDHOUSEENTRY0000000"          # the house's entry id (unique ids start with it)
ALARM_ITEM = "01JLINKEDALARMPINITEM00000"      # the Alarm PIN item: its panel's unique id
TOKEN = "msvc_00112233445566aa_" + "A" * 43    # a fictional Service credential

BLACK = "switch.hall_black_screen"
PHOTOS = "switch.hall_photo_screensaver"
SLEEP = "sensor.hall_sleep_screen"
INUSE = "binary_sensor.hall_screen_in_use"
VIEWERS = "sensor.tv_viewers"
CAMERA = "camera.tv_channel_nine"
ALARM = "alarm_control_panel.house_alarm_pin"
FULL = {"house": "mantel", "tablets": ["hall"], "bridge": "hk_frontend"}        # Mantel owns the whole entry
DEVICE = {"identifier": f"{ENTRY}_hall", "name": "Hall", "manufacturer": "HK Frontend", "model": "Wall Tablet"}


def entities() -> list[dict[str, Any]]:
    """What Mantel publishes for the fictional house: the same unique ids and
    entity ids hk_frontend's own entities have."""
    return [
        {"unique_id": f"{ENTRY}_hall_black_screen", "platform": "switch", "entity_id": BLACK,
         "translation_key": "black_screen", "icon": "mdi:monitor-off", "device": DEVICE, "state": "off",
         "tablet": "hall", "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": None, "confirmed": False}},
        {"unique_id": f"{ENTRY}_hall_photo_screensaver", "platform": "switch", "entity_id": PHOTOS,
         "translation_key": "photo_screensaver", "icon": "mdi:image-multiple", "device": DEVICE, "state": "off",
         "tablet": "hall", "attributes": {"tablet": "hall", "starts_after": 180}},
        {"unique_id": f"{ENTRY}_hall_sleep_screen", "platform": "sensor", "entity_id": SLEEP,
         "translation_key": "sleep_screen", "device": DEVICE, "state": "dashboard", "tablet": "hall",
         "attributes": {"tablet": "hall", "decided_by": "hk_frontend", "why": "someone home"}},
        {"unique_id": f"{ENTRY}_hall_screen_in_use", "platform": "binary_sensor", "entity_id": INUSE,
         "translation_key": "screen_in_use", "device": DEVICE, "state": "off", "tablet": "hall",
         "attributes": {"tablet": "hall"}},
        {"unique_id": "01JLINKEDLIVETVITEM0000000_viewers", "platform": "sensor", "entity_id": VIEWERS,
         "has_entity_name": False, "name": "TV viewers", "icon": "mdi:account-eye", "state": 0,
         "attributes": {"users": [], "channels": []}},
        {"unique_id": "01JLINKEDLIVETVITEM0000000_9.1_camera", "platform": "camera", "entity_id": CAMERA,
         "has_entity_name": False, "name": "TV Channel Nine", "state": "idle", "attributes": {"channel": "9.1"},
         "features": {"stream_source": "http://127.0.0.1:8123/fictional/live_tv/9.1"}},
        {"unique_id": ALARM_ITEM, "platform": "alarm_control_panel", "entity_id": ALARM, "name": None,
         "device": {"identifier": ALARM_ITEM, "name": "House Alarm PIN"}, "state": "disarmed",
         "attributes": {"protects": "alarm_control_panel.house_alarm"},
         "features": {"supported_features": 3, "code_format": "number", "code_arm_required": True}},
    ]


class FakeMantel:
    def __init__(self, token: str = TOKEN) -> None:
        self.token = token
        self.entities = entities()
        self.owners: dict[str, Any] | None = dict(FULL)   # None: a hello without them
        self.received: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []
        self.sockets: list[web.WebSocketResponse] = []
        self.connects = 0
        self.answer = self.ok          # async (ws, msg) -> reply dict, or None for no answer
        self.server: TestServer | None = None
        self.url = ""

    async def ok(self, ws, msg):
        return {"id": msg["id"], "type": "result", "success": True, "result": {"ok": True}}

    async def start(self) -> "FakeMantel":
        app = web.Application()
        app.router.add_get("/linked/ws", self.handler)
        self.server = TestServer(app, host="127.0.0.1")
        await self.server.start_server()
        self.url = f"http://127.0.0.1:{self.server.port}"
        return self

    async def handler(self, request: web.Request) -> web.StreamResponse:
        self.headers.append(dict(request.headers))
        if request.headers.get("Authorization") != f"Bearer {self.token}":
            raise web.HTTPUnauthorized(text="credential refused")
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.connects += 1
        self.sockets.append(ws)
        hello = {"type": "hello", "protocol": 1, "services": ["set_black_screen", "show_popup", "close_popup",
                                                              "notify"], "entities": self.entities}
        if self.owners is not None:
            hello["owners"] = self.owners
        await ws.send_json(hello)
        try:
            async for frame in ws:
                msg = json.loads(frame.data)
                self.received.append(msg)
                reply = await self.answer(ws, msg)
                if reply is not None:
                    await ws.send_json(reply)
        finally:
            if ws in self.sockets:
                self.sockets.remove(ws)
        return ws

    def calls(self, type_: str = "call_service") -> list[dict[str, Any]]:
        return [m for m in self.received if m.get("type") == type_]

    async def push(self, msg: dict[str, Any]) -> None:
        for ws in list(self.sockets):
            await ws.send_json(msg)

    async def drop(self) -> None:
        for ws in list(self.sockets):
            await ws.close()

    async def close(self) -> None:
        await self.drop()
        if self.server is not None:
            await self.server.close()


async def until(hass, check, timeout: float = 5.0) -> None:
    """Wait (really: the link is a socket) until `check()` is true."""
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while True:
        await hass.async_block_till_done()
        if check():
            return
        if loop.time() > end:
            raise AssertionError("timed out waiting")
        await asyncio.sleep(0.02)
