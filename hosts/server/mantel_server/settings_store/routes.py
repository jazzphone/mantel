"""``register``: fills ``app["read_routes"]``, ``app["ws_handlers"]`` and the REST routes, and keeps Status & Chips current."""
from __future__ import annotations

import logging
import asyncio
import sqlite3
import time
from typing import Any, Callable

from aiohttp import web

from ..connectors import Ctx, Forbidden, Route, read_routes, ws_handlers
from .docs import Scope, SettingsError
from .hooks import actor_of
from .importing import NO_HK_FRONTEND, import_settings
from .model import ThinModel
from .service import SettingsService
from .store import SettingsStore

log = logging.getLogger("mantel.settings")

# ------------------------------------------------------------------------------------- register
def _error(exc: BaseException) -> dict:
    if isinstance(exc, SettingsError):
        return {"code": exc.code, "message": str(exc)}
    if isinstance(exc, Forbidden):
        return {"code": "forbidden", "message": str(exc)}
    return {"code": "failed", "message": "the settings store failed"}


def register(app: web.Application, hub: Any, hooks: Any = None, *, store: SettingsStore | None = None,
             conn: sqlite3.Connection | None = None, model: ThinModel | None = None) -> SettingsService:
    """Offer HK's settings from Mantel's store.

    * ``app["read_routes"]``: ``hk_frontend/settings/subscribe`` (subscription), ``hk_frontend/panel/get``,
      ``mantel/settings/get``, ``mantel/settings/history`` — the page's ``read`` / ``read_subscribe``
      frames reach these (readproxy.register looks here first), never Home Assistant.
    * ``app["ws_handlers"]["settings_write"]``: ``{type: "settings_write", id, msg: <the save, exactly as
      the page sends it to HA>}`` -> ``{type: "settings_result", id, result}`` or ``{..., error: {code,
      message}}``. Not a command type: server.classify lets it through while commands are disabled,
      on purpose (HK's own data; nothing reaches HA or a device).
    * REST ``GET /api/settings/import`` (the import's record; Owner/Admin) and ``POST
      /api/settings/import`` (run it; Owner only).
    """
    if store is None:
        if conn is None:
            st = app.get("store") if hasattr(app, "get") else None
            conn = getattr(st, "db", None)
        if conn is None:
            raise ValueError("settings_store.register needs a store, a connection, or app['store']")
        store = SettingsStore(conn, app.get("clock", time.time) if hasattr(app, "get") else time.time)
    service = SettingsService(store, hooks, model)
    service.hiding = lambda: app.get("hiding") if hasattr(app, "get") else None
    # (who may view what, asked of the app's own authz when no feature host hands the read hook over: the feed's cut,
    # SRV-4, failed closed for an Owner too where the features host wasn't attached -- the headless checks' houses)
    service.authz = lambda: app.get("authz") if hasattr(app, "get") else None
    app["settings"] = service

    async def feed(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        SettingsService._only(msg, set())
        end = service.subscribe_feed(ctx.identity, on_event)

        async def unsubscribe() -> None:
            end()
        # live.py: the principal is read again before this (a session or device gone ends the feed)
        unsubscribe.recheck = lambda: getattr(ctx.identity, "valid", True) is not False   # type: ignore[attr-defined]
        return unsubscribe

    async def panel_get(ctx: Ctx, msg: dict):
        payload = await service.panel_get(ctx.identity, msg)
        # a paired tablet's Reload and Clear Cache (tablet_links.panel_parts): HK Settings' Wall Tablets buttons,
        # pressed through Mantel's host and the command gateway (HA works these out from the tablet's entities)
        from .. import tablet_links
        parts = tablet_links.panel_parts(app)
        if parts:
            payload = {**payload, "tablets": {k: {**t, "parts": {**(t.get("parts") or {}), **parts.get(k, {})}}
                                              for k, t in (payload.get("tablets") or {}).items()}}
        # Hidden Accessories (HA: hiding.snapshot in panel.py), worked out from Mantel's own states and
        # registries (hidden.py, installed by readproxy.register) and cut down to what the person may view
        hiding, reads = app.get("hiding"), app.get("filtered_reads")
        if hiding is not None and hiding.ready and reads is not None:
            from ..connectors import allowed_ids
            settings = {**service.house_settings(),
                        "accessories": service.store.body("house", "accessories") or {"entities": {}}}
            snap = hiding.snapshot(settings)
            visible = await allowed_ids(reads.hooks, ctx.identity, "view", sorted(hiding.entity_ids_in(snap)))
            payload = {**payload, "hidden": hiding.only_visible(snap, set(visible), None)}
            # Status & Chips kind by kind (HA: panel._counts) and how many each counts (HA's `kinds`): what a
            # chip's What It Counts and Accessories' types show, cut down to what the person may view
            if service.house_ready():
                counts = hiding.counts(settings)
                ids = {e for c in counts.values() for k in ("auto", "found", "exclude", "include") for e in c[k]}
                ok = set(await allowed_ids(reads.hooks, ctx.identity, "view", sorted(ids)))
                counts = {k: {**c, **{f: [e for e in c[f] if e in ok] for f in ("auto", "found", "exclude", "include")}}
                          for k, c in counts.items()}
                payload = {**payload, "counts": counts, "kinds": {k: len(c["found"]) for k, c in counts.items()}}
        return payload

    async def setup_check(ctx: Ctx, msg: dict):
        # HK Settings' Setup Check: Mantel's own needs (setup_check.py), never HA's check
        SettingsService._only(msg, set())
        if not await service.allowed(ctx.identity, Scope("house", "settings")):
            raise Forbidden("HK Settings needs configure on settings")
        from .. import setup_check as checks
        from .. import tablet_links
        lines = checks.lines(app, len(service.store.docs("board")))
        return {"lines": lines + await tablet_links.setup_lines(app)}

    async def get(ctx: Ctx, msg: dict):
        return await service.get(ctx.identity, msg)

    async def history(ctx: Ctx, msg: dict):
        return await service.history(ctx.identity, msg)

    async def grid_starter(ctx: Ctx, msg: dict):
        return await service.grid_starter(ctx.identity, msg)

    read_routes(app).update({
        "hk_frontend/settings/subscribe": Route(subscribe=feed),
        "hk_frontend/panel/get": Route(request=panel_get),
        "hk_frontend/grid/starter": Route(request=grid_starter),
        "hk_frontend/setup/check": Route(request=setup_check),
        "mantel/settings/get": Route(request=get),
        "mantel/settings/history": Route(request=history),
    })

    async def on_write(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        try:
            if set(msg) - {"type", "id", "msg"}:
                raise SettingsError("invalid_format", fields={k: "unexpected" for k in sorted(set(msg) - {"type", "id", "msg"})})
            result = await service.save(ctx.identity, msg.get("msg"))
        except Exception as exc:  # noqa: BLE001 -- a refused save is the page's error, never the socket's
            if not isinstance(exc, (SettingsError, Forbidden)):
                log.exception("settings save failed")
            await ctx.send({"type": "settings_result", "id": rid, "error": _error(exc)})
            return
        await ctx.send({"type": "settings_result", "id": rid, "result": result})

    ws_handlers(app)["settings_write"] = on_write


    async def fetch_from_hub() -> Any:
        proxy = getattr(hub, "readproxy", None)
        if proxy is None or not hasattr(proxy, "read_hk_settings"):
            raise SettingsError("unavailable", "no connection to Home Assistant to import from")
        try:
            return await proxy.read_hk_settings()
        except RuntimeError as exc:
            if str(exc) == "unknown_command":       # HA answered: it doesn't know hk_frontend/panel/get
                raise SettingsError("no_hk_frontend", NO_HK_FRONTEND) from None
            raise

    from ..identity.guards import guard
    from ..identity.guards import ident as guarded

    @guard("manager", reads="admin")                                   # an Owner or Admin, never at a wall tablet
    async def import_status(request: web.Request) -> web.Response:
        return web.json_response({"import": store.import_record(), "empty": store.empty()})

    @guard("owner", no_audit="the import is the settings store's record (import_record) and history, with its actor")
    async def run_import(request: web.Request) -> web.Response:
        ident = guarded(request)
        try:
            got = await import_settings(store, service.hooks.fetch_ha_settings or fetch_from_hub,
                                        actor=actor_of(ident), model=service.model,
                                        read_features=service.hooks.feature_reader(getattr(hub, "readproxy", None)))
        except SettingsError as exc:
            status = {"unavailable": 503, "no_hk_frontend": 409}.get(exc.code, 400)
            return web.json_response({"error": exc.code, "message": str(exc)}, status=status)
        except Exception as exc:  # noqa: BLE001 -- HA unreachable or refused
            log.warning("settings import failed: %s", exc)
            return web.json_response({"error": "import_failed", "message": str(exc)}, status=502)
        if got.get("imported"):
            service.publish()
        return web.json_response(got)

    app.router.add_get("/api/settings/import", import_status)
    app.router.add_post("/api/settings/import", run_import)
    _watch_kinds(service, hub)
    return service


# ------------------------------------------------------------------------------------- Status & Chips, kept current
KINDS_COOLDOWN_S = 1.0


def _watch_kinds(service: SettingsService, hub: Any) -> None:
    """HA's kinds.Tracker: the screens are sent the feed again (at most once a second) when what a kind counts
    changed -- an entity appeared or went, its device class or group members changed, a thermostat gained or
    lost a reading, a registry changed -- and only when a list really changed. Chained after HaClient's own
    callbacks, as features.py's are."""
    ha = getattr(hub, "ha", None)
    if ha is None:
        return
    service.house_ready = lambda: ha.ready.is_set() and getattr(hub, "registry", None) is not None
    from hk_core.settings.kinds import KINDS
    wanted = {d for k in KINDS.values() for d in k.domains + k.also}
    seen: dict[str, tuple] = {}
    timer: list[asyncio.TimerHandle | None] = [None]

    def check() -> None:
        timer[0] = None
        if service.kind_lists() != service.kinds_sent:
            service.publish()

    def poke() -> None:
        if timer[0] is not None:
            return
        try:
            timer[0] = asyncio.get_running_loop().call_later(KINDS_COOLDOWN_S, check)
        except RuntimeError:                     # no loop (a test without one): nothing to keep current
            pass

    def what(eid: str) -> tuple | None:
        st = hub.store.states.get(eid)
        if st is None:
            return None
        a = st.get("a") or {}
        live = st.get("s") not in ("unavailable", "unknown")
        return (a.get("device_class"), isinstance(a.get("entity_id"), list), isinstance(a.get("group_entities"), list),
                live and "current_temperature" in a, live and "current_humidity" in a)

    first_change, first_registry = ha.on_change, ha.on_registry

    def on_change(changed: set[str]) -> None:
        first_change(changed)
        try:
            moved = False
            for eid in changed:
                if eid.split(".", 1)[0] not in wanted:
                    continue
                now = what(eid)
                if seen.get(eid, ()) != now:
                    seen[eid] = now
                    moved = True
            if moved:
                poke()
        except Exception:  # noqa: BLE001 -- never break the hub's own callback
            log.exception("Status & Chips' kinds: a state change failed")

    def on_registry() -> None:
        if first_registry is not None:
            first_registry()
        poke()
    ha.on_change, ha.on_registry = on_change, on_registry
