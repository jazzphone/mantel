"""Fakes for the P3.4 connector tests: a fake Home Assistant (WebSocket + the calendar REST read) and
a fake Music Assistant (its WebSocket API). Fictional data only; no real HA or MA is ever contacted.
Both record every frame they receive so tests can assert on exactly what Mantel sent.
"""
from __future__ import annotations

import asyncio
import json

from aiohttp import WSMsgType, web

HA_TOKEN = "fake-ha-token"
MA_TOKEN = "fake-ma-token"
ICE = {"configuration": {"iceServers": [{"urls": ["stun:stun.fake.test:3478"]}]}, "getCandidatesUpfront": False}
PREFS = {
    "energy_sources": [
        {"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_in", "stat_cost": None}],
         "flow_to": [{"stat_energy_to": "sensor.grid_out"}], "cost_adjustment_day": 0},
        {"type": "solar", "stat_energy_from": "sensor.solar"},
    ],
    "device_consumption": [{"stat_consumption": "sensor.fridge"}, {"stat_consumption": "sensor.secret_lab"}],
}
# hk_music/subscribe's event as HA's hk_frontend sends it (MusicConfig.as_client + announcements), fictional
MUSIC = {
    "library_entry": "ma-entry-1", "configured": True,
    "speakers": [{"name": "Downstairs", "entity": "media_player.downstairs",
                  "members": ["media_player.den", "media_player.primary"]},
                 {"name": "Upstairs", "entity": "media_player.upstairs", "members": ["media_player.primary"]},
                 {"name": "Den", "entity": "media_player.den"},
                 {"name": "Primary Bedroom", "entity": "media_player.primary"}],
    "floors": [{"name": "Main", "entities": ["media_player.den"]},
               {"name": "Upper", "entities": ["media_player.primary"]}],
    "playlists": [{"name": "Morning", "icon": "mdi:coffee", "key": "p1"}],
    "home": "media_player.primary", "volume": 0.3, "ignore_announcements": True,
    "announcements": ["media_player.den", "media_player.primary"],
    "secret_extra": "dropped",
}
MUSIC_QUEUE = {"ok": True, "queue_id": "q-den", "index": 4, "items": [
    {"id": "i1", "title": "Song", "artist": "Band", "duration": 200, "image": "https://img.example/a.jpg",
     "extra": "x"},
    {"id": "i2", "title": "Song 2", "artist": "Band", "duration": 180,
     "image": "https://ma.example/imageproxy?path=x&access_token=fictional"},
    {"id": "i3", "title": "Song 3", "artist": "", "duration": None, "image": "/local/x.jpg"}]}


# hk_tv/channels as HA's Live TV feature answers it (ws_channels), fictional, with one misbehaving row
TV_CHANNELS = {"configured": True, "channels": [
    {"number": "4.1", "name": "NBC", "camera": "camera.live_tv_4_1", "now": "sensor.live_tv_4_1_now"},
    {"number": "5.1", "name": "FOX", "camera": "camera.live_tv_5_1", "now": "sensor.live_tv_5_1_now", "token": "x"},
    {"number": "7.1", "name": "ABC", "camera": "camera.live_tv_7_1", "now": "sensor.live_tv_7_1_now"},
    {"number": "../x", "name": "bad", "camera": "camera.live_tv_bad", "now": None},
    {"number": "9.1", "name": "not a camera", "camera": "light.kitchen", "now": None}]}
# each feature's HK Settings page as HA answers it (its <id>/settings/get), trimmed and fictional
FEATURE_PAGES = {
    "hk_clean_areas/settings/get": {
        "configured": True, "state": "loaded", "vacuums": [{"vacuum": "vacuum.robot", "taking_part": True}],
        "chosen_vacuums": ["vacuum.robot", "Not An Entity"], "chosen_areas": ["kitchen"], "offered": ["kitchen"],
        "areas": [], "unreached": []},
    "hk_energy/settings/get": {
        "configured": True, "state": "loaded",
        "options": {"follow": True, "title": "Power & Energy", "top": None, "power": {"path": "power", "home": "sensor.home_power"},
                    "sections": [{"id": "rooms", "name": "Rooms", "items": ["sensor.fridge"]}]},
        "plan": {"worked_out": "by HA"}, "devices": [], "batteries": [], "sections": [], "grid": None},
    "hk_notify/settings/get": {
        "configured": True, "state": "loaded",
        "options": {"stay": 15, "saver": "important", "chime": True, "dnd": {"schedule": False, "from": "22:00", "to": "07:00", "while": []}, "wake": False},
        "items": [{"id": "n_door", "entity": "binary_sensor.front_door", "when": "on", "title": "", "message": None,
                   "kind": "door", "name": "Front Door", "choices": [], "muted": []}, {"entity": "no id"}],
        "categories": [], "limits": {}},
    "hk_tv/settings/get": {
        "configured": True, "state": "loaded", "title": "Live TV", "host": "192.0.2.40", "guide_url": "http://192.0.2.41/xmltv.xml",
        "quality": "720", "channels": [{"number": "4.1", "name": "NBC"}, {"number": "x", "name": "bad"}], "lineup": None},
}


class FakeHa:
    def __init__(self) -> None:
        self.frames: list[dict] = []          # every WebSocket frame Mantel sent (auth included)
        self.rest: list[tuple[str, str, dict]] = []   # (method, path, query) of every REST request
        self.unexpected: list[str] = []
        self.sockets: list[web.WebSocketResponse] = []
        self.sessions = 0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/api/websocket", self.ws)
        app.router.add_route("*", "/api/{tail:.*}", self.api)
        return app

    def sent_types(self) -> list[str]:
        return [f.get("type") for f in self.frames]

    async def api(self, request: web.Request) -> web.StreamResponse:
        self.rest.append((request.method, request.path, dict(request.query)))
        if request.headers.get("Authorization") != f"Bearer {HA_TOKEN}":
            return web.json_response({"message": "unauthorized"}, status=401)
        if request.method == "GET" and request.path.startswith("/api/calendars/"):
            eid = request.path.rsplit("/", 1)[1]
            return web.json_response([{"summary": f"Fictional event on {eid}",
                                       "start": {"dateTime": request.query.get("start")},
                                       "end": {"dateTime": request.query.get("end")}}])
        self.unexpected.append(f"{request.method} {request.path}")
        return web.json_response({"message": "not here"}, status=404)

    async def ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.sockets.append(ws)
        await ws.send_json({"type": "auth_required", "ha_version": "fake"})
        first = await ws.receive_json()
        self.frames.append(first)
        if first.get("type") != "auth" or first.get("access_token") != HA_TOKEN:
            await ws.send_json({"type": "auth_invalid"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": "fake"})
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                break
            msg = json.loads(m.data)
            self.frames.append(msg)
            await self.answer(ws, msg)
        return ws

    async def answer(self, ws, msg: dict) -> None:
        mid, t = msg.get("id"), msg.get("type")

        async def ok(result=None):
            await ws.send_json({"id": mid, "type": "result", "success": True, "result": result})

        async def event(ev):
            await ws.send_json({"id": mid, "type": "event", "event": ev})

        if t == "camera/webrtc/get_client_config":
            return await ok(ICE)
        if t == "camera/webrtc/offer":
            self.sessions += 1
            await ok()
            await event({"type": "session", "session_id": f"fake-session-{self.sessions}"})
            await event({"type": "answer", "answer": "v=0 fake-answer"})
            return await event({"type": "candidate", "candidate": {"candidate": "candidate:1 1 udp 1 192.0.2.1 9 typ host",
                                                                   "sdpMLineIndex": 0}})
        if t in ("camera/webrtc/candidate", "unsubscribe_events"):
            return await ok()
        if t == "get_config":
            return await ok({"latitude": 10.5, "longitude": -20.25, "elevation": 3, "radius": 100,
                             "unit_system": {"temperature": "°F"}, "time_zone": "UTC", "location_name": "Fictional"})
        if t == "frontend/get_themes":
            return await ok({"themes": {}, "default_theme": "default"})
        if t == "history/history_during_period":
            ids = list(msg.get("entity_ids") or []) + ["sensor.leaked"]       # a misbehaving answer
            return await ok({e: [{"s": "on", "lu": 1.0}] for e in ids})
        if t == "logbook/get_events":
            rows = [{"when": 1.0, "entity_id": e, "state": "on", "context_entity_id": "lock.front"}
                    for e in msg.get("entity_ids") or []]
            return await ok(rows + [{"when": 2.0, "entity_id": "lock.front", "state": "unlocked"}, {"when": 3.0}])
        if t == "recorder/statistics_during_period":
            ids = list(msg.get("statistic_ids") or []) + ["sensor.leaked"]
            return await ok({s: [{"start": 0, "sum": 1.0}] for s in ids})
        if t == "energy/get_prefs":
            return await ok(json.loads(json.dumps(PREFS)))
        if t == "energy/info":
            return await ok({"cost_sensors": {}, "solar_forecast_domains": []})
        if t == "weather/subscribe_forecast":
            await ok()
            return await event({"type": msg.get("forecast_type"), "forecast": [{"datetime": "2026-10-18T00:00:00Z"}]})
        if t == "persistent_notification/subscribe":
            await ok()
            return await event({"type": "current", "notifications": {}})
        if t in ("media_player/browse_media", "media_player/search_media"):
            return await ok({"title": "Fictional", "children": [{"title": "Album", "media_content_id": "a1"}]})
        if t == "media_source/browse_media":
            return await ok({"title": "Media", "children": [
                {"title": "Photos", "media_content_id": "media-source://media_source/local/photos"},
                {"title": "Cameras", "media_content_id": "media-source://camera"},
                {"title": "Porch", "media_content_id": "media-source://camera/camera.porch"}]})
        if t == "hk_music/subscribe":
            await ok()
            await event(json.loads(json.dumps(MUSIC)))
            return await event({**json.loads(json.dumps(MUSIC)), "volume": 0.5})     # a change, in order
        if t == "hk_music/queue":
            return await ok(json.loads(json.dumps(MUSIC_QUEUE)))
        if t == "hk_music/settings/library":
            return await ok({"items": [{"uri": "library://playlist/1", "name": "Morning", "owner": "x"}, {"name": "no uri"}]})
        if t == "hk_tv/channels":
            return await ok(json.loads(json.dumps(TV_CHANNELS)))
        if t in FEATURE_PAGES:
            return await ok(json.loads(json.dumps(FEATURE_PAGES[t])))
        self.unexpected.append(t)
        await ws.send_json({"id": mid, "type": "result", "success": False, "error": {"code": "unknown_command"}})


class FakeMa:
    """Just enough of Music Assistant's WebSocket API (server info, auth, results, partials, events)."""

    def __init__(self, token: str = MA_TOKEN) -> None:
        self.token = token
        self.frames: list[dict] = []          # every frame received, auth included
        self.sockets: list[web.WebSocketResponse] = []
        self.auth_failures = 0
        self.connections = 0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/ws", self.ws)
        return app

    def commands(self) -> list[str]:
        return [f.get("command") for f in self.frames]

    async def drop(self) -> None:
        for ws in list(self.sockets):
            await ws.close()
        self.sockets.clear()

    async def push(self, event: dict) -> None:
        for ws in list(self.sockets):
            if not ws.closed:
                await ws.send_json(event)

    async def ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.connections += 1
        await ws.send_json({"server_id": "fake-ma", "server_version": "2.10.6", "schema_version": 28,
                            "min_supported_schema_version": 24, "base_url": "http://ma.fake.test:8095",
                            "homeassistant_addon": False, "onboard_done": True})
        authed = False
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                break
            msg = json.loads(m.data)
            self.frames.append(msg)
            mid, cmd, args = msg.get("message_id"), msg.get("command"), msg.get("args") or {}
            if cmd == "auth":
                if args.get("token") == self.token:
                    authed = True
                    self.sockets.append(ws)
                    await ws.send_json({"message_id": mid, "result": {"authenticated": True,
                                                                      "user": {"username": "mantel-fake"}}})
                else:
                    self.auth_failures += 1
                    await ws.send_json({"message_id": mid, "error_code": 20, "details": "Invalid or expired token"})
                continue
            if not authed:
                await ws.send_json({"message_id": mid, "error_code": 20, "details": "Authentication required."})
                continue
            await self.answer(ws, mid, cmd, args)
        return ws

    async def answer(self, ws, mid, cmd, args) -> None:
        async def ok(result, partial=False):
            await ws.send_json({"message_id": mid, "result": result, "partial": partial})

        if cmd == "players/all":
            return await ok([{"player_id": "fake-den", "display_name": "Den", "state": "idle"}])
        if cmd == "player_queues/all":
            return await ok([{"queue_id": "fake-den", "items": 0}])
        if cmd == "player_queues/items":
            return await ok([{"queue_item_id": "q1", "name": "Fictional Song"}])
        if cmd == "music/tracks/library_items":       # streamed: two partial frames then the last
            await ok([{"item_id": "1"}, {"item_id": "2"}], partial=True)
            await ok([{"item_id": "3"}], partial=True)
            return await ok([{"item_id": "4"}])
        if cmd == "music/search":
            return await ok({"tracks": [{"item_id": "s1", "name": args.get("search_query")}]})
        if cmd == "music/browse":
            return await ok([{"path": "library://", "name": "Library"}])
        if cmd.startswith("player_queues/") or cmd.startswith("players/cmd/"):
            return await ok(None)
        await ws.send_json({"message_id": mid, "error_code": 1, "details": f"Invalid command: {cmd}"})


async def wait_for(cond, timeout: float = 3.0) -> None:
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not cond():
        if loop.time() > end:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.01)
