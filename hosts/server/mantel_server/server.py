"""Client-facing side: a WebSocket hub on loopback, a /dev test page, and a few read-only JSON endpoints.

Client protocol (JSON text frames, /ws):
  -> {"type":"subscribe","entity_ids":[...],"areas":[...],"min_interval":0}
  <- {"type":"snapshot","entities":{id:{s,a,lc,lu}},"missing":[...]}
  <- {"type":"diff","changes":{id:{"+":{...},"-":{"a":[...]}}},"added":{...},"removed":[...]}
  -> {"type":"unsubscribe"} | {"type":"ping"} | {"type":"watch_stats"}
Anything that looks like a command gets {"type":"error","code":"commands_disabled"}.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from importlib.resources import files
from urllib.parse import urlparse

import aiohttp
from aiohttp import WSMsgType, web

from . import auth
from .config import Config
from .ha_oauth import HaOAuth
from .store import Store
from .ha_client import HaClient
from .registry import Registry
from .state import StateStore
from .stats import Counter
from .view import ClientView, Coalescing

log = logging.getLogger("mantel.server")

COMMAND_TYPES = frozenset({"call_service", "command", "cmd", "service", "fire_event", "execute", "turn_on", "turn_off"})
COMMANDS_DISABLED = {
    "type": "error",
    "code": "commands_disabled",
    "message": "Commands are disabled on this server. It is read-only and never calls a Home Assistant service.",
}


def classify(msg: object) -> str:
    """'subscribe' | 'unsubscribe' | 'ping' | 'watch_stats' | 'command' | 'invalid' | 'unknown'."""
    if not isinstance(msg, dict):
        return "invalid"
    kind = msg.get("type")
    if kind in ("subscribe", "unsubscribe", "ping", "watch_stats"):
        return kind
    if kind in COMMAND_TYPES or "cmd" in msg or "service" in msg:
        return "command"
    return "unknown"


class Hub:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.store = StateStore()
        self.registry = Registry()
        self.coalescing = Coalescing(cfg.default_interval, list(cfg.overrides))
        self.sessions: set[ClientSession] = set()
        self.ha: HaClient | None = None

    def on_change(self, changed: set[str]) -> None:
        for s in self.sessions:
            if s.view.on_change(changed):
                s.wake.set()

    def on_registry(self) -> None:
        for s in self.sessions:
            s.view.registry_changed()
            s.wake.set()


class ClientSession:
    def __init__(self, hub: Hub, ws: web.WebSocketResponse) -> None:
        self.hub = hub
        self.ws = ws
        self.view = ClientView(hub.store, hub.registry, hub.coalescing)
        self.wake = asyncio.Event()
        self.tx = Counter()  # snapshot + diff frames only (stats frames are excluded)
        self.subscribed = False
        self.watch = False

    async def send(self, msg: dict, count: bool = True) -> None:
        data = json.dumps(msg, separators=(",", ":"))
        if count:
            self.tx.add(len(data))
        await self.ws.send_str(data)

    async def pump(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            self.wake.clear()  # clear before flushing so a change during the send is not lost
            msg, due = self.view.flush(loop.time()) if self.subscribed else (None, None)
            if msg:
                await self.send(msg)
            timeout = None if due is None else max(0.0, due - loop.time())
            try:
                await asyncio.wait_for(self.wake.wait(), timeout)
            except asyncio.TimeoutError:
                pass

    async def stats_loop(self) -> None:
        ha = self.hub.ha
        last = (time.monotonic(), ha.rx.msgs, ha.rx.bytes, self.tx.msgs, self.tx.bytes)
        while True:
            await asyncio.sleep(1.0)
            if not self.watch:
                continue
            cur = (time.monotonic(), ha.rx.msgs, ha.rx.bytes, self.tx.msgs, self.tx.bytes)
            dt = max(cur[0] - last[0], 1e-6)
            await self.send({
                "type": "stats",
                "upstream": {"msgs_s": (cur[1] - last[1]) / dt, "bytes_s": (cur[2] - last[2]) / dt,
                             "msgs": cur[1], "bytes": cur[2]},
                "client": {"msgs_s": (cur[3] - last[3]) / dt, "bytes_s": (cur[4] - last[4]) / dt,
                           "msgs": cur[3], "bytes": cur[4], "selected": len(self.view.selected)},
                "ha_entities": len(self.hub.store.states),
            }, count=False)
            last = cur

    async def handle(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            await self.send({"type": "error", "code": "invalid_json"}, count=False)
            return
        kind = classify(msg)
        if kind == "command":
            err = dict(COMMANDS_DISABLED)
            if "id" in msg:
                err["id"] = msg["id"]
            await self.send(err, count=False)
            log.warning("blocked a command-type message from a client")
        elif kind == "subscribe":
            ids = [e for e in msg.get("entity_ids") or [] if isinstance(e, str)]
            areas = [a for a in msg.get("areas") or [] if isinstance(a, str)]
            try:
                self.view.client_min = max(0.0, float(msg.get("min_interval") or 0.0))
            except (TypeError, ValueError):
                self.view.client_min = 0.0
            snap = self.view.select(ids, areas, asyncio.get_running_loop().time())
            self.subscribed = True
            await self.send(snap)
        elif kind == "unsubscribe":
            self.subscribed = False
            self.view.select([], [], 0.0)
        elif kind == "ping":
            await self.send({"type": "pong"}, count=False)
        elif kind == "watch_stats":
            self.watch = True
        else:
            await self.send({"type": "error", "code": "unknown_type"}, count=False)

    async def run(self) -> None:
        tasks = [asyncio.create_task(self.pump()), asyncio.create_task(self.stats_loop())]
        try:
            async for m in self.ws:
                if m.type == WSMsgType.TEXT:
                    await self.handle(m.data)
                elif m.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        finally:
            for t in tasks:
                t.cancel()


@web.middleware
async def loopback_only(request: web.Request, handler):
    """Defense against DNS rebinding and cross-site WebSocket hijacking on localhost."""
    hostname = request.host.rsplit(":", 1)[0] if not request.host.endswith("]") else request.host
    if hostname not in {"127.0.0.1", "localhost", "[::1]"}:
        raise web.HTTPForbidden(text="bad Host")
    origin = request.headers.get("Origin")
    if origin and urlparse(origin).netloc != request.host:
        raise web.HTTPForbidden(text="bad Origin")
    return await handler(request)


async def ws_handler(request: web.Request) -> web.StreamResponse:
    hub: Hub = request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=1 << 20)
    await ws.prepare(request)
    session = ClientSession(hub, ws)
    hub.sessions.add(session)
    try:
        await session.run()
    finally:
        hub.sessions.discard(session)
    return ws


async def root(request: web.Request) -> web.Response:
    raise web.HTTPFound("/dev")


async def dev_page(request: web.Request) -> web.Response:
    html = files("mantel_server").joinpath("static/dev.html").read_text()
    return web.Response(text=html, content_type="text/html", headers={"Cache-Control": "no-store"})


async def api_entities(request: web.Request) -> web.Response:
    hub: Hub = request.app["hub"]
    reg = hub.registry
    out = []
    for eid, st in hub.store.states.items():
        area = reg.entity_area.get(eid)
        out.append({"id": eid, "name": st["a"].get("friendly_name") or "", "area": reg.areas.get(area, "") if area else ""})
    out.sort(key=lambda e: e["id"])
    return web.json_response(out)


async def api_areas(request: web.Request) -> web.Response:
    reg = request.app["hub"].registry
    return web.json_response([{"id": a, "name": n, "entities": len(reg.by_area.get(a, ()))}
                              for a, n in sorted(reg.areas.items(), key=lambda kv: kv[1])])


async def api_stats(request: web.Request) -> web.Response:
    hub: Hub = request.app["hub"]
    ha = hub.ha
    return web.json_response({
        "time": time.time(),
        "ha_connected_since": ha.connected_since,
        "ha_entities": len(hub.store.states),
        "upstream": {**ha.rx.as_dict(), "initial_snapshot_bytes": ha.initial_bytes,
                     "sent": ha.tx.as_dict(),
                     "entity_updates": ha.entity_updates,
                     "big_frames": ha.biggest,
                     "top_entities": ha.updates_by_entity.most_common(15),
                     "by_type": {k: v.as_dict() for k, v in ha.rx_types.items()}},
        "clients": [{**s.tx.as_dict(), "selected": len(s.view.selected), "subscribed": s.subscribed}
                    for s in hub.sessions],
    })


def build_app(cfg: Config, token: str, store: Store | None = None, connect_ha: bool = True,
              clock=time.time) -> web.Application:
    app = web.Application(middlewares=[loopback_only, auth.require_session])
    hub = Hub(cfg)
    app["store"] = store or Store(cfg.data_dir / "mantel.db")
    app["oauth"] = HaOAuth(cfg.ha_url, cfg.client_id, cfg.redirect_uri)
    app["state_secret"] = secrets.token_bytes(32)
    app["clock"] = clock
    auth.add_routes(app)
    hub.ha = HaClient(cfg.ha_url, token, hub.store, hub.registry, hub.on_change, hub.on_registry)
    app["cfg"] = cfg
    app["hub"] = hub
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/", root)
    app.router.add_get("/dev", dev_page)
    app.router.add_get("/api/entities", api_entities)
    app.router.add_get("/api/areas", api_areas)
    app.router.add_get("/api/stats", api_stats)

    async def start(app: web.Application) -> None:
        app["http"] = aiohttp.ClientSession()
        if connect_ha:
            app["ha_task"] = asyncio.create_task(hub.ha.run())

    async def stop(app: web.Application) -> None:
        await app["http"].close()
        if connect_ha:
            app["ha_task"].cancel()
            try:
                await app["ha_task"]
            except (asyncio.CancelledError, Exception):
                pass

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return app
