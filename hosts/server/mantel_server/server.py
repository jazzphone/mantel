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

from . import auth, proof2
from .config import Config
from .ha_oauth import HaOAuth
from .readproxy import ReadBlocked, ReadProxy
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
    if kind in ("subscribe", "unsubscribe", "ping", "watch_stats", "read", "read_subscribe", "read_unsubscribe"):
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
        self.readproxy: ReadProxy | None = None

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
        self.read_subs: dict[int, int] = {}  # page's read id -> ReadProxy subscription id

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
            snap = self.view.select(ids, areas, asyncio.get_running_loop().time(), all_entities=bool(msg.get("all")))
            self.subscribed = True
            await self.send(snap)
        elif kind == "unsubscribe":
            self.subscribed = False
            self.view.select([], [], 0.0)
        elif kind == "ping":
            await self.send({"type": "pong"}, count=False)
        elif kind == "watch_stats":
            self.watch = True
        elif kind in ("read", "read_subscribe", "read_unsubscribe"):
            asyncio.get_running_loop().create_task(self.read(kind, msg))
        else:
            await self.send({"type": "error", "code": "unknown_type"}, count=False)

    async def read(self, kind: str, msg: dict) -> None:
        """Live HA reads for the page, through the ReadProxy and its own allowlist."""
        rid = msg.get("id")
        proxy = self.hub.readproxy

        async def fail(code: str, text: str = "") -> None:
            await self.send({"type": "read_result", "id": rid, "error": {"code": code, "message": text}}, count=False)

        if proxy is None or not isinstance(rid, int):
            return await fail("unavailable")
        try:
            if kind == "read_unsubscribe":
                mid = self.read_subs.pop(rid, None)
                if mid is not None:
                    await proxy.unsubscribe(mid)
                return
            inner = msg.get("msg")
            if not isinstance(inner, dict):
                return await fail("invalid")
            if kind == "read":
                result = await proxy.request(inner)
                await self.send({"type": "read_result", "id": rid, "result": result})
            else:
                loop = asyncio.get_running_loop()

                def on_event(ev: dict) -> None:
                    loop.create_task(self.send({"type": "read_event", "id": rid, "event": ev}))

                self.read_subs[rid] = await proxy.subscribe(inner, on_event)
                await self.send({"type": "read_result", "id": rid, "result": None}, count=False)
        except ReadBlocked as exc:
            log.warning("blocked a read: %s", exc)
            await fail("not_allowed", str(exc))
        except Exception as exc:  # noqa: BLE001 -- a failed read is the page's error, never the socket's
            await fail("failed", str(exc))

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
            if self.hub.readproxy:
                for mid in self.read_subs.values():
                    await self.hub.readproxy.unsubscribe(mid)


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


WEB_TYPES = frozenset({".woff2", ".woff", ".ttf", ".otf", ".css", ".js", ".mjs", ".map", ".html", ".json", ".svg",
                       ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".avif", ".webm", ".mp4", ".txt"})
NO_CACHE = {"Cache-Control": "no-cache"}
FIXTURE_FILES = {  # message type -> file under cfg.fixtures (written by tools/capture_fixtures.py)
    "hk_frontend/settings/subscribe": "settings.json",
    "hk_frontend/page_headers/subscribe": "page_headers.json",
    "hk_frontend/snooze/subscribe": "snooze.json",
    "hk_music/subscribe": "music.json",
}


def safe_file(base, rel: str):
    """base/rel if it is a web file inside base (no .. tricks, no symlink out), else None."""
    try:
        path = (base / rel).resolve()
        path.relative_to(base.resolve())
    except (ValueError, OSError):
        return None
    if path.is_file() and path.suffix.lower() in WEB_TYPES:
        return path
    return None


async def hk_file(request: web.Request) -> web.StreamResponse:
    """/hk/<path>: "Your files" first, HK's bundled frontend otherwise (backend/files.py's rule)."""
    cfg: Config = request.app["cfg"]
    rel = request.match_info["path"]
    # Shared modules are composed at the same /hk URLs used by the HA build.
    override = safe_file(cfg.hk_files, rel)
    if override:
        return web.FileResponse(override, headers=NO_CACHE)
    shared = request.app["shared_assets"].get(rel)
    if shared:
        path = safe_file(cfg.web, shared)
        if path:
            return web.FileResponse(path, headers=NO_CACHE)
    for base in (cfg.hk_frontend,):
        path = safe_file(base, rel)
        if path:
            return web.FileResponse(path, headers=NO_CACHE)
    raise web.HTTPNotFound()


async def web_file(request: web.Request) -> web.StreamResponse:
    path = safe_file(request.app["cfg"].web, request.match_info["path"])
    if not path:
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers=NO_CACHE)


async def mdi_file(request: web.Request) -> web.StreamResponse:
    path = safe_file(request.app["cfg"].web / "mdi", request.match_info["name"])
    if not path:
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers=NO_CACHE)


async def home_redirect(request: web.Request) -> web.StreamResponse:
    raise web.HTTPFound(f"/{request.app['cfg'].default_screen}/home" + (f"?{request.query_string}" if request.query_string else ""))


async def home_page(request: web.Request) -> web.StreamResponse:
    return web.FileResponse(request.app["cfg"].web / "home.html", headers=NO_CACHE)


async def api_registry(request: web.Request) -> web.Response:
    return web.json_response(request.app["hub"].registry.frontend_shapes())


async def api_fixtures(request: web.Request) -> web.Response:
    base = request.app["cfg"].fixtures
    out = {}
    for kind, name in FIXTURE_FILES.items():
        f = base / name
        if f.is_file():
            out[kind] = json.loads(f.read_text())
    return web.json_response(out)


async def api_hk_cards(request: web.Request) -> web.Response:
    folder = request.app["cfg"].hk_frontend / "cards"
    names = sorted(p.name for p in folder.glob("*.js") if p.name != "hk-strategy.js") if folder.is_dir() else []
    return web.json_response(names)


def build_app(cfg: Config, token: str, store: Store | None = None, connect_ha: bool = True,
              clock=time.time) -> web.Application:
    app = web.Application(middlewares=[loopback_only, auth.require_session])
    hub = Hub(cfg)
    app["store"] = store or Store(cfg.data_dir / "mantel.db")
    app["oauth"] = HaOAuth(cfg.ha_url, cfg.client_id, cfg.redirect_uri)
    app["state_secret"] = secrets.token_bytes(32)
    app["clock"] = clock
    auth.add_routes(app)
    app.router.add_post(proof2.PATH, proof2.command)
    hub.ha = HaClient(cfg.ha_url, token, hub.store, hub.registry, hub.on_change, hub.on_registry)
    app["cfg"] = cfg
    manifest = cfg.web / "shared-assets.json"
    app["shared_assets"] = json.loads(manifest.read_text()) if manifest.is_file() else {}
    app["hub"] = hub
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/", root)
    app.router.add_get("/dev", dev_page)
    app.router.add_get("/home", home_redirect)
    app.router.add_get("/hk/{path:.+}", hk_file)
    app.router.add_get("/web/{path:.+}", web_file)
    app.router.add_get("/static/mdi/{name}", mdi_file)
    app.router.add_get("/api/registry", api_registry)
    app.router.add_get("/api/fixtures", api_fixtures)
    app.router.add_get("/api/hk-cards", api_hk_cards)
    app.router.add_get("/api/entities", api_entities)
    app.router.add_get("/api/areas", api_areas)
    app.router.add_get("/api/stats", api_stats)

    # last: the page HK's cards draw into, for every view of a dashboard (HK's view host draws the
    # one the address names). A dashboard's address has a hyphen, as HA requires (dashboard-kitchen),
    # so /api/…, /hk/…, /web/… and /static/… never land here.
    app.router.add_get("/{seg}/home", home_page)
    app.router.add_get(r"/{seg:[A-Za-z0-9_]+-[A-Za-z0-9_-]*}/{view:[A-Za-z0-9_-]+}", home_page)

    async def start(app: web.Application) -> None:
        app["http"] = aiohttp.ClientSession()
        if connect_ha:
            hub.readproxy = ReadProxy(cfg.ha_url, token)
            app["ha_task"] = asyncio.create_task(hub.ha.run())

    async def stop(app: web.Application) -> None:
        await app["http"].close()
        if hub.readproxy:
            await hub.readproxy.close()
        if connect_ha:
            app["ha_task"].cancel()
            try:
                await app["ha_task"]
            except (asyncio.CancelledError, Exception):
                pass

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return app
