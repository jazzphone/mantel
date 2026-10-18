"""Client-facing side: a WebSocket hub on loopback, a /dev test page, and a few read-only JSON endpoints.

Client protocol (JSON text frames, /ws):
  -> {"type":"subscribe","entity_ids":[...],"areas":[...],"min_interval":0}
  <- {"type":"snapshot","entities":{id:{s,a,lc,lu}},"missing":[...]}
  <- {"type":"diff","changes":{id:{"+":{...},"-":{"a":[...]}}},"added":{...},"removed":[...]}
  -> {"type":"unsubscribe"} | {"type":"ping"} | {"type":"watch_stats"}
  -> any type in app["ws_handlers"] (P3.4: read, read_subscribe, read_unsubscribe, read_api, ma/*)
Anything that looks like a command gets {"type":"error","code":"commands_disabled"} -- unless the
server's operator turned the command gateway on (cfg.commands_enabled), in which case the socket
first receives {"type":"capabilities","commands":true,...} and {"type":"command",...} messages go
to gateway.py (RBAC, step-up, audit, then Home Assistant).

P3.7 wiring (build_app): every slice's register(); one Principal per socket (authz.py: the session's
user and device, the door, the fresh factor) whose RBAC gate filters the socket's view and whose
identity the connectors and the gateway decide with; a once-a-minute policy tick (schedules, guest
windows, revocations); the house time zone from HA's get_config, with cfg.house_tz as the fallback.
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

from . import music
from . import accounts, alarm_pin, auth, connect_pairing, devices, gateway, health, ingress, pins, proof2, rbac_store, readproxy, sessions, settings_store
from . import (admin_page, atrest, backup, connections, features, linked, linked_house, linked_owners, login_page,
               service_accounts, talk_relay, user_files)
from .authz import Authz, Principal, resolve_door
from .config import Config
from .connectors import REFUSE_ALL, Ctx, Hooks
from .connectors import camera as camera_connector
from .connectors import camera_still, media_art
from .connectors import ma as ma_connector
from .ha_oauth import HaOAuth
from .readproxy import ReadProxy
from .store import Store
from .ha_client import HaClient, commander_for
from .registry import Registry
from .state import StateStore
from .stats import Counter
from .view import ClientView, Coalescing, filter_registry

POLICY_TICK = 60.0          # seconds between re-checks of what each socket may see (schedules, revocations)

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
    def __init__(self, hub: Hub, ws: web.WebSocketResponse, principal: Principal | None = None,
                 app: web.Application | None = None, base: str = "") -> None:
        self.hub = hub
        self.ws = ws
        self.app = app
        self.principal = principal  # None only in a bare app with no sign-in (tests of the hub itself)
        gate = principal.gate if principal is not None else None
        # `base`: the page's Ingress prefix ('' elsewhere), for the camera still URLs states carry
        self.view = ClientView(hub.store, hub.registry, hub.coalescing, gate=gate, shape=media_art.page_shaper(base))
        self.wake = asyncio.Event()
        self.tx = Counter()  # snapshot + diff frames only (stats frames are excluded)
        self.subscribed = False
        self.watch = False
        # P3.4's per-connection context: the connectors' handlers answer through it, and close() ends
        # every subscription they opened (WebRTC sessions, forecasts, MA events)
        self.ctx = Ctx(send=self.send, identity=principal)
        self.tasks: set[asyncio.Task] = set()

    def spawn(self, coro) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        self.tasks.add(t)
        t.add_done_callback(self.tasks.discard)

    async def send_quiet(self, msg: dict) -> None:
        await self.send(msg, count=False)

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
            gw = self.app.get("gateway") if self.app is not None else None
            if gw is not None and self.principal is not None and isinstance(msg, dict) and msg.get("type") == "command":
                self.spawn(gw.handle(self.principal, msg, self.send_quiet))
                return
            if gw is not None:
                err = {"type": "error", "code": "invalid_command",
                       "message": 'send {"type": "command", "kind": "service"|"ws"|"http"|"ma", ...}'}
            else:
                err = dict(COMMANDS_DISABLED)
                log.warning("blocked a command-type message from a client")
            if "id" in msg:
                err["id"] = msg["id"]
            await self.send(err, count=False)
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
        else:
            # P3.4's handler table (reads, camera signaling, MA reads): after classify(), so nothing
            # command-shaped ever reaches a connector whatever is registered there
            handlers = self.app.get("ws_handlers", {}) if self.app is not None else {}
            handler = handlers.get(msg.get("type")) if isinstance(msg, dict) else None
            if handler is None:
                await self.send({"type": "error", "code": "unknown_type"}, count=False)
            else:
                self.spawn(handler(self.ctx, msg))

    async def run(self) -> None:
        tasks = [asyncio.create_task(self.pump()), asyncio.create_task(self.stats_loop())]
        try:
            gw = self.app.get("gateway") if self.app is not None else None
            if gw is not None:  # only when the operator turned commands on: the page then offers actions
                await self.send(gw.capabilities(self.principal), count=False)
            async for m in self.ws:
                if m.type == WSMsgType.TEXT:
                    await self.handle(m.data)
                elif m.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        finally:
            for t in tasks:
                t.cancel()
            for t in list(self.tasks):
                t.cancel()
            await self.ctx.close()


@web.middleware
async def loopback_only(request: web.Request, handler):
    """Defense against DNS rebinding and cross-site WebSocket hijacking on localhost."""
    hostname = request.host.rsplit(":", 1)[0] if not request.host.endswith("]") else request.host
    hub = request.app.get("hub")
    allowed = hub.cfg.host_allowed(hostname) if hub is not None else hostname in {"127.0.0.1", "localhost", "[::1]"}
    # a paired Connect App reaches Mantel by whatever address it was given (mutual TLS is the defence
    # against rebinding there); the browser's own host rides in X-Forwarded-Host (ingress.origin_ok)
    allowed = allowed or request.get("connect_peer") is not None
    if not allowed:  # container mode adds the public name (--public-url / --allow-host); loopback otherwise
        raise web.HTTPForbidden(text="bad Host")
    origin = request.headers.get("Origin")
    # through HA's Ingress (HA App mode) the browser's host may arrive as X-Forwarded-Host (ingress.py)
    if origin and urlparse(origin).netloc != request.host and not ingress.origin_ok(request, urlparse(origin).netloc):
        raise web.HTTPForbidden(text="bad Origin")
    return await handler(request)


async def ws_handler(request: web.Request) -> web.StreamResponse:
    hub: Hub = request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=1 << 20)
    authz: Authz | None = request.app.get("authz")
    principal = authz.principal(request) if authz is not None else None
    await ws.prepare(request)
    session = ClientSession(hub, ws, principal, request.app, base=request.get("mantel_base", ""))
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


def request_gate(request: web.Request):
    """The RBAC read filter for a REST read (the same gate a socket of this identity gets)."""
    authz: Authz | None = request.app.get("authz")
    return authz.principal(request).gate if authz is not None else None


async def api_entities(request: web.Request) -> web.Response:
    hub: Hub = request.app["hub"]
    reg = hub.registry
    gate = request_gate(request)
    out = []
    for eid, st in hub.store.states.items():
        if gate is not None and not gate.visible(eid):
            continue
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
    # (ingress.file_response: a plain FileResponse, except through HA's Ingress, where HK's code is
    # served for the page's prefix; see ingress.py)
    override = safe_file(cfg.hk_files, rel)
    if override:
        return ingress.file_response(request, override, NO_CACHE)
    shared = request.app["shared_assets"].get(rel)
    if shared:
        path = safe_file(cfg.web, shared)
        if path:
            return ingress.file_response(request, path, NO_CACHE)
    for base in (cfg.hk_frontend,):
        path = safe_file(base, rel)
        if path:
            return ingress.file_response(request, path, NO_CACHE)
    raise web.HTTPNotFound()


async def web_file(request: web.Request) -> web.StreamResponse:
    path = safe_file(request.app["cfg"].web, request.match_info["path"])
    if not path:
        raise web.HTTPNotFound()
    return ingress.file_response(request, path, NO_CACHE)


async def mdi_file(request: web.Request) -> web.StreamResponse:
    path = safe_file(request.app["cfg"].web / "mdi", request.match_info["name"])
    if not path:
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers=NO_CACHE)


async def home_redirect(request: web.Request) -> web.StreamResponse:
    raise web.HTTPFound(f"/{request.app['cfg'].default_screen}/home" + (f"?{request.query_string}" if request.query_string else ""))


async def home_page(request: web.Request) -> web.StreamResponse:
    return ingress.file_response(request, request.app["cfg"].web / "home.html", NO_CACHE, page=True)


async def api_registry(request: web.Request) -> web.Response:
    return web.json_response(filter_registry(request.app["hub"].registry.frontend_shapes(), request_gate(request)))


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
    app = web.Application(middlewares=[connect_pairing.middleware, loopback_only, ingress.middleware,
                                       auth.require_session])
    hub = Hub(cfg)
    app["store"] = store or Store(cfg.data_dir / "mantel.db")
    # Connections (connections.py): Mantel's own saved HA/MA credentials win over the installation's files;
    # everything below is built with what is in effect, and retargeted in place when it changes
    conns = connections.Connections(cfg, atrest.SecretBox(cfg.secrets_dir / atrest.KEY_FILE), clock,
                                    install_ha_token=token)
    own_ha, own_ma = conns.current("ha"), conns.current("ma")
    if own_ha is not None and own_ha.source == "mantel":
        cfg.ha_url = own_ha.url
    if own_ma is not None and own_ma.source == "mantel":
        cfg.ma_url = own_ma.url
    token = conns.ha_token()
    app["ma_token_source"] = conns.ma_token
    connections.register(app, conns)
    app["oauth"] = HaOAuth(cfg.ha_url, cfg.client_id, cfg.redirect_uri)
    app["state_secret"] = secrets.token_bytes(32)
    app["clock"] = clock
    auth.add_routes(app)
    app.router.add_post(proof2.PATH, proof2.command)
    hub.ha = HaClient(cfg.ha_url, token, hub.store, hub.registry, hub.on_change, hub.on_registry,
                      ws_url=cfg.ha_ws_url or None)
    app["cfg"] = cfg
    manifest = cfg.web / "shared-assets.json"
    app["shared_assets"] = json.loads(manifest.read_text()) if manifest.is_file() else {}
    app["hub"] = hub
    sessions.register(app, hub)
    accounts.register(app, hub)
    devices.register(app, hub)
    login_page.register(app, hub)     # /login (passkey, password + TOTP, Sign in with HA via /login/ha)
    admin_page.register(app, hub)     # /admin (people, devices, roles, service accounts, audit, my PIN)
    pins.register(app, hub)
    alarm_pin.register(app, hub)      # HK's Alarm PIN: the keypad's code checked by Mantel (GATEWAY.md "The alarm")
    ingress.register(app, hub, token)                   # HA App mode / Connect (cfg.ingress); inert otherwise
    wire(app, hub, token, connect_ha)
    connect_pairing.register(app, hub)                  # Mantel Connect (cfg.connect): pairing + the mTLS listener
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
        app["tick_task"] = asyncio.create_task(policy_tick(app, hub))
        if connect_ha:
            hub.readproxy = ReadProxy(cfg.ha_url, conns.ha_token(), ws_url=cfg.ha_ws_url or None)
            app["ha_task"] = asyncio.create_task(hub.ha.run())
            app["tz_task"] = asyncio.create_task(house_tz(app, hub))

    async def stop(app: web.Application) -> None:
        await app["http"].close()
        for name in ("tick_task", "tz_task"):
            if name in app:
                app[name].cancel()
        if app.get("commander") is not None:
            await app["commander"].close()
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


# -- P3.7 wiring ------------------------------------------------------------------------------------
def _rbac_identity(request: web.Request) -> dict | None:
    """rbac_store's resolver: the signed-in user (its REST is Owner-only; a device alone is no one)."""
    ident = sessions.identity(request)
    return {"user_id": ident.user.id, "role": ident.user.role} if ident.user is not None else None


def _csrf_ok(request: web.Request) -> bool:
    try:
        sessions.check_csrf(request, sessions.identity(request))
    except web.HTTPForbidden:
        return False
    return True


def wire(app: web.Application, hub: Hub, token: str, connect_ha: bool) -> None:
    """Register P3.2 (RBAC), P3.3 (gateway), P3.4 (connectors) and P3.6 (health) with real hooks."""
    cfg: Config = app["cfg"]
    app["door_resolver"] = resolve_door                     # X-Mantel-Door believed from trusted proxies only
    audit = gateway.Audit(app["store"].db, lambda: app["clock"]())
    app["audit"] = audit
    gateway.register_audit(app)                             # GET /api/audit (Owner/Admin)
    store = rbac_store.register(app, hub, identity=_rbac_identity, store=rbac_store.RbacStore(app["store"].db),
                                csrf=_csrf_ok, audit=audit.config_event)
    authz = Authz(app, hub, store, lambda: app["clock"]())
    app["authz"] = authz
    writes = gateway.load_writes()
    commander = commander_for(cfg, token, writes)        # None unless cfg.commands_enabled
    app["commander"] = commander
    gw = gateway.Gateway(app, authz, audit, commander, writes, lambda: app["clock"]()) if cfg.commands_enabled else None
    app["gateway"] = gw
    # live talk (GATEWAY.md "Doorbell talk-back"): /ws/talk, opened only with a gateway ticket; the
    # relay exists only while commands are on (the route then refuses before the upgrade)
    talk_relay.register(app, audit, authz, lambda: app["clock"]())
    conns: connections.Connections = app["connections"]
    hooks = Hooks(may_read=authz.may_read, may_view=authz.may_view, ma_gate=gw if gw is not None else REFUSE_ALL,
                  ha_token=conns.ha_token if connect_ha else None)
    readproxy.register(app, hub, hooks)
    camera_connector.register(app, hub, hooks)
    camera_still.register(app, hub, authz, conns.ha_token)   # GET /api/camera/<entity>/still (RBAC, HA's token stays here)
    media_art.register(app, hub, authz, conns.ha_token)      # GET /api/media/<entity>/art (view the player)
    ma_connector.register(app, hub, hooks)
    conns.appliers.append(lambda kind, cur: apply_connection(app, hub, connect_ha, kind, cur))
    health.register(app, hub)
    # P3.5: HK's settings from Mantel's own store (reads + settings_write saves). HK's own data, not a
    # house command, so saves work while commands are off; each save asks RBAC `configure`.
    settings_store.register(app, hub, settings_store.SettingsHooks(
        may_configure=settings_store.rbac_may_configure(rbac_store=store, clock=lambda: app["clock"]())))
    # Phase 5: Service accounts (Owner-only REST) and the linked hk_frontend's endpoint (/linked/ws,
    # LAN door + a Service credential with the `linked` scope; Mantel can't call HA through it).
    service_accounts.register(app, hub)
    linked.register(app, hub)
    # linked mode's per-tablet ownership (CUTOVER §1 Option A): every tablet HA's until an Owner moves
    # it (PUT /api/linked/owners, audited); HA is told in the link's hello and `owners` frames
    linked_owners.register(app, hub)
    # Phase 4: hk_core's features on Mantel (each off until an Owner enables it; house commands only
    # through the gateway as the `mantel:features` Service actor)
    features.register(app, hub, hooks)
    # Phase 4: whole-home music on Mantel, talking to Music Assistant directly (music.py). Its reads answer
    # in front of the interim bridge once MA and the music settings are in Mantel; its actions run only
    # through the gateway (commands off: refused, nothing reaches MA)
    music.register(app, hub, hooks)
    # linked mode's notify and the rest of the entry (Seasonal decorations, Alarm PIN through the
    # gateway as the person whose PIN it is, Live TV), published only while Mantel owns `house`
    linked_house.register(app, hub)
    # the home's own files (fonts, glyphs, photos; Owner/Admin upload) and the nightly encrypted
    # backup (off unless --backup-target is set)
    user_files.register(app, hub)
    backup.register(app, hub)
    if cfg.commands_enabled:
        log.warning("COMMANDS ARE ENABLED on this server: signed-in users may control Home Assistant within "
                    "their roles (step-up and an audit row for every command)")


def _set(app: web.Application, key: str, value) -> None:
    """Replace one app entry after start-up (the MA client is built or removed at run time). aiohttp warns
    about changing a started app's state; this one key is read at each use (app.get("ma")), so it is safe."""
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        app[key] = value


async def apply_connection(app: web.Application, hub: Hub, connect_ha: bool, kind: str,
                           cur: "connections.Current | None") -> None:
    """Hot apply (connections.py): a saved, replaced or removed connection takes effect without a restart.
    The HA objects are retargeted in place (nothing holds a stale one); MA's client is built, retargeted or
    removed. Each closes its socket and reconnects at once; pages keep their own sockets to Mantel."""
    cfg: Config = app["cfg"]
    conns: connections.Connections = app["connections"]
    if kind == "ha":
        if conns.app_mode:
            return
        url = cur.url if cur is not None else conns.install_url["ha"]
        token = cur.token if cur is not None else ""
        cfg.ha_url = url
        ws = cfg.ws_url
        hub.ha.retarget(ws, token)
        if hub.readproxy is not None:
            hub.readproxy.retarget(url, token, ws_url=cfg.ha_ws_url or None)
        elif connect_ha:
            hub.readproxy = ReadProxy(url, token, ws_url=cfg.ha_ws_url or None)
        if app.get("commander") is not None:
            app["commander"].retarget(url, ws, token)
        if app.get("ha_directory") is not None:
            app["ha_directory"].retarget(ws, token)
        holder = app.get("camera_signaling_holder")
        if holder is not None:
            if holder.get("proxy") is not None:
                holder["proxy"].retarget(url, token, ws_url=cfg.ha_ws_url or None)
            elif connect_ha:
                from .connectors.camera import SignalingProxy
                holder["proxy"] = SignalingProxy(url, token, ws_url=cfg.ha_ws_url or None)
        app["oauth"].ha_url = url.rstrip("/")             # "Sign in with Home Assistant" goes to the new address
        return
    # Music Assistant. The music engine (music.py) reads app["ma"] at each use, so it follows at once: with a
    # client it is Mantel's engine (when the music settings are imported), with none the interim bridge to HA.
    client = app.get("ma")
    if cur is None:
        cfg.ma_url = ""
        _set(app, "ma", None)
        if client is not None:
            await client.close()
    else:
        cfg.ma_url = cur.url
        if client is None:
            client = ma_connector.MaClient(cur.url, cfg.ma_token_file, gate=app.get("ma_gate") or REFUSE_ALL,
                                           token_source=conns.ma_token)
            _set(app, "ma", client)
            client.start()
        else:
            client.token_source = conns.ma_token
            client.retarget(cur.url, conns.ma_token)
            client.start()           # it may have stopped earlier for want of a token
    music_host = app.get("music")
    if music_host is not None:
        music_host.connection_changed()


async def policy_tick(app: web.Application, hub: Hub, every: float = POLICY_TICK) -> None:
    """Once a minute: schedules and guest windows open or close, roles change, sessions and devices
    are revoked. Each socket's principal is re-read; a socket whose session is gone is closed."""
    while True:
        await asyncio.sleep(every)
        try:
            await tick_once(app, hub)
        except Exception:  # noqa: BLE001 -- the next tick tries again
            log.exception("policy tick failed")


async def tick_once(app: web.Application, hub: Hub) -> None:
    audit = app.get("audit")
    if audit is not None:
        try:  # the audit's retention window (at most hourly; the maintenance path logs what it deleted)
            audit.maybe_purge(getattr(app["cfg"], "audit_retention_days", 365.0))
        except Exception:  # noqa: BLE001 -- never let maintenance stop the policy tick
            log.exception("audit retention step failed (nothing was deleted)")
    talk = app.get("talk")
    if talk is not None:          # unused live-talk tickets get their audit result; revoked streams close
        try:
            await talk.tick()
        except Exception:  # noqa: BLE001
            log.exception("live talk tick failed")
    authz: Authz | None = app.get("authz")
    for s in list(hub.sessions):
        if authz is not None and s.principal is not None and not authz.refresh(s.principal):
            log.info("closing a socket whose session or device ended")
            await s.ws.close()
            continue
        s.view.policy_changed()
        s.wake.set()


async def house_tz(app: web.Application, hub: Hub, attempts: int = 30) -> None:
    """The house's time zone (for grant schedules) from HA's get_config, cfg.house_tz until then."""
    authz: Authz = app["authz"]
    delay = 2.0
    for _ in range(attempts):
        try:
            got = await hub.readproxy.request({"type": "get_config"})  # type: ignore[union-attr]
            tz = got.get("time_zone") if isinstance(got, dict) else None
            if isinstance(tz, str) and tz:
                if authz.set_tz(tz, "home_assistant"):
                    await tick_once(app, hub)
                log.info("house time zone: %s (from Home Assistant)", authz.tz)
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- HA not up yet: keep the fallback and retry
            log.info("house time zone not read yet (%s); using %s", type(exc).__name__, authz.tz)
        await asyncio.sleep(delay)
        delay = min(delay * 2, 60.0)
