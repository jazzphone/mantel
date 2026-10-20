"""A wall tablet's Direct Connection: Mantel talking to the tablet's kiosk app itself (docs/phase8/KIOSK.md: pairing
and status, and the two commands HK Settings' Wall Tablets pages press, Reload and Clear Cache).

One entry per **HK tablet** (the tablet id in HK's settings, as the Sleep engine, ``tablet_items`` and
``?hk_tablet=`` know it), for a tablet whose Kiosk App is Kiosk Satellite (connectors/kiosk_satellite.py) or Fully
Kiosk (connectors/fully.py). It is set up on the tablet's own page in Mantel Settings (Wall Tablets → the tablet →
Direct Connection) and listed under Connections → Wall Tablets; both draw these routes.

**What is kept** (``<data_dir>/connections/tablet-<id>.connection``, sealed exactly as connections.py seals HA's
and MA's, associated data ``connection:tablet-<id>``, inside every encrypted backup): the address, and for Kiosk
Satellite a token the tablet made from its admin password (``ttl_days`` 3650; the password is used
for that one login and kept nowhere), for Fully the Remote Admin password itself (Fully has no tokens). The secret
is accepted from the page once, tested live, and from then on only used: never in a response, a log line, an audit
row or an exception's text.

**Who.** Owners and Admins see the entries and the tablets' live state (not from a wall tablet). Only an Owner pairs,
replaces or disconnects, with connections.py's rule for the door (``edit_rule``). Every change is audited before it
applies (kind ``config``, ``connection.tablet-<id>.saved|disconnected``, with the address, the app and the tablet's
own name, never the secret); if the audit cannot be written nothing changes.

**Reads, and two commands.** Pairing and status send only reads: Kiosk Satellite's login, ``/api/info``,
``/api/commands`` and ``/api/health``; Fully's ``deviceInfo``. The only commands are VERBS (Reload, Clear Cache),
and only through the command gateway (kind ``tablet``, gateway.TABLET_VERBS): they need ``commands_enabled``, RBAC
``configure`` on ``settings`` (Owner/Admin; never a wall tablet), and the audit row is written first (kind
``tablet``, action ``tablet.<verb>``, target ``tablet:<id>``; the result once). ``send`` is the gateway's call; the
route below only hands the request to the gateway. With commands off the route answers ``commands_disabled`` and
nothing is sent or recorded. HK Settings' Reload, Clear Cache & Reload and All at Once (hk-settings.js) find these
as the tablet's ``parts`` (``panel_parts``) and press them through Mantel's host (mantel-settings.js ``press``).

Routes (``API`` = /api/connections/tablets):

* ``GET  API``                 every HK tablet and its entry (``?live=1``: each saved tablet read now, at once)
* ``GET  API/{id}/live``       one tablet read now
* ``POST API/{id}/test``       ``{address, password}``: the pairing tried, nothing saved (Kiosk Satellite's test token
                               lapses in a day and is dropped)
* ``POST API/{id}``            ``{address, password}``: paired, checked with the new secret, sealed
* ``DELETE API/{id}``          Mantel's copy forgotten (a Kiosk Satellite token stays valid until it lapses: the
                               app's tokens are stateless; its own reset cuts them off)
* ``POST API/{id}/command``    ``{verb}``: one of VERBS, through the gateway as the person asking
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping

import aiohttp
from aiohttp import web

from . import atrest
from . import connections as C
from .accounts import read_json
from .connectors import fully, kiosk_satellite as KS
from .connectors.kiosk import KioskFailed, address_text
from .sessions import Identity, error, identity, ok

log = logging.getLogger("mantel.tablet_links")

API = "/api/connections/tablets"
APPS = {"kiosk_satellite": "Kiosk Satellite", "fully": "Fully Kiosk"}
TID_RE = re.compile(r"^[a-z0-9_]{1,64}$")
LIVE_TIMEOUT = 5.0
REACH_TIMEOUT = 4.0
COMMAND_TIMEOUT = 15.0
# Mantel's verb -> each app's (the gateway's TABLET_VERBS): Kiosk Satellite's commands (kiosk_satellite.COMMANDS),
# Fully's verbs (fully.COMMANDS). Fully's Reload is Load Start URL, as HK's own Fully parts are (hk_core.tablets).
VERBS = {"reload": {"kiosk_satellite": "reload", "fully": "load_start_url"},
         "clear_cache": {"kiosk_satellite": "clear_cache", "fully": "clear_cache"}}
PART_PREFIX = "mantel-tablet:"     # a part HK Settings presses through Mantel's host, never an HA entity id


@dataclass
class TabletRecord:
    """One tablet's sealed entry. ``repr`` never shows the secret."""
    kind: str                          # "tablet-<id>" (the sealed file's name and associated data)
    tablet: str                        # HK's tablet id
    app: str                           # kiosk_satellite | fully
    url: str                           # http://<host>:<port>
    token: str = field(repr=False)     # Kiosk Satellite: its token; Fully: the Remote Admin password
    since: float = 0.0
    device: dict | None = None         # the tablet's own name, model and version when paired
    by: str | None = None
    by_name: str | None = None
    expires: float | None = None       # Kiosk Satellite: read from the token itself
    missing: list = field(default_factory=list)   # commands later slices need that this app version lacks

    def public(self) -> dict:
        return {"app": self.app, "url": self.url, "since": self.since, "device": self.device, "by": self.by,
                "by_name": self.by_name, "expires": self.expires, "missing": list(self.missing)}


def kind_of(tid: str) -> str:
    return f"tablet-{tid}"


class TabletLinks:
    """Every tablet's sealed entry, loaded at start (a damaged or foreign file is reported, never fatal)."""

    def __init__(self, cfg, box: atrest.SecretBox, clock: Callable[[], float] = time.time) -> None:
        self.files = C.SealedFiles(cfg.connections_dir, box, TabletRecord)
        self.clock = clock
        self.own: dict[str, TabletRecord] = {}
        self.unreadable: dict[str, str] = {}
        self._lock = asyncio.Lock()
        folder = Path(self.files.folder)
        for p in sorted(folder.glob("tablet-*.connection")) if folder.is_dir() else []:
            tid = p.name[len("tablet-"):-len(".connection")]
            if not TID_RE.match(tid):
                continue
            try:
                rec = self.files.load(kind_of(tid))
                if rec is None or rec.tablet != tid or rec.app not in APPS:
                    raise ValueError("not this tablet's entry")
                self.own[tid] = rec
            except Exception as exc:  # noqa: BLE001 -- a key change or a damaged file: say so, keep running
                self.unreadable[tid] = type(exc).__name__
                log.error("tablet_links: the saved direct connection for tablet %s could not be opened (%s); is this "
                          "the same at_rest.key it was saved with? Pair the tablet again.", tid, type(exc).__name__)

    def get(self, tid: str) -> TabletRecord | None:
        return self.own.get(tid)

    async def save(self, rec: TabletRecord) -> None:
        async with self._lock:
            self.files.save(rec)
            self.own[rec.tablet] = rec
            self.unreadable.pop(rec.tablet, None)

    async def delete(self, tid: str) -> bool:
        async with self._lock:
            gone = self.files.delete(kind_of(tid))
            self.own.pop(tid, None)
            self.unreadable.pop(tid, None)
            return gone


# -- HK's tablets, and what Mantel already knows of them ------------------------------------------------------
def hk_tablets(app: web.Application) -> dict[str, dict]:
    """HK's tablets as Mantel's settings say ({id: the tablet's settings})."""
    svc = app.get("settings")
    if svc is None:
        return {}
    try:
        return {k: dict(d.body) for k, d in svc.store.docs("tablet").items() if TID_RE.match(k)}
    except Exception:  # noqa: BLE001 -- the list still answers, with no tablets
        log.exception("tablet_links: HK's tablets could not be read")
        return {}


def suggested_address(app: web.Application, t: Mapping[str, Any]) -> str | None:
    """Where the tablet probably is: Kiosk Satellite's own ``sensor.<kiosk>_ipv4_address`` (HA's ESPHome entity,
    already in Mantel's copy of the house's states) with the app's port. Reads only."""
    if t.get("app") != "kiosk_satellite" or not t.get("device"):
        return None
    hub = app.get("hub")
    if hub is None:
        return None
    from hk_core.tablets import kiosk as TK
    from .house import MantelHouse
    try:
        house = MantelHouse(hub.store, hub.registry)          # no caller: it cannot send anything
        eid = TK.parts(house, "kiosk_satellite", str(t["device"])).get("ip")
        st = house.state(eid) if eid else None
        host, port = KS.clean_address(st.state) if st is not None else (None, None)
    except Exception:  # noqa: BLE001 -- KioskFailed or a registry surprise: no suggestion is fine
        return None
    return address_text(host, port) if host else None


# -- the live reads ---------------------------------------------------------------------------------------------
async def read_now(http: aiohttp.ClientSession, rec: TabletRecord, timeout: float = LIVE_TIMEOUT) -> dict[str, Any]:
    """The tablet's state now, with Mantel's secret: {"ok": True, "info": {...}} or {"ok": False, "error"}."""
    try:
        if rec.app == "kiosk_satellite":
            info = await KS.KioskSatellite.of(http, rec.url, rec.token, timeout=timeout).info()
        else:
            info = await fully.FullyClient.of(http, rec.url, rec.token, timeout=timeout).info()
    except KioskFailed as exc:
        return {"ok": False, "error": {"code": exc.code, "message": exc.message}}
    return {"ok": True, "info": info}


async def reach(http: aiohttp.ClientSession, rec: TabletRecord, timeout: float = REACH_TIMEOUT) -> dict[str, Any]:
    """Setup Check's "reachable": Kiosk Satellite's /api/health (no token), Fully's deviceInfo."""
    try:
        if rec.app == "kiosk_satellite":
            await KS.health(http, rec.url, timeout=timeout)
        else:
            await fully.FullyClient.of(http, rec.url, rec.token, timeout=timeout).info()
    except KioskFailed as exc:
        return {"ok": False, "code": exc.code, "message": exc.message}
    return {"ok": True}


async def setup_lines(app: web.Application) -> list[dict[str, Any]]:
    """Setup Check's Wall Tablets line: every tablet with a Direct Connection reached at once (reads only). None
    when no tablet has one."""
    links: TabletLinks | None = app.get("tablet_links")
    http = app.get("http")
    if links is None or http is None or not (links.own or links.unreadable):
        return []
    names = {k: t.get("name") or k for k, t in hk_tablets(app).items()}
    recs = sorted(links.own.values(), key=lambda r: names.get(r.tablet, r.tablet).lower())
    got = await asyncio.gather(*(reach(http, r) for r in recs))
    bad = [(names.get(r.tablet, r.tablet), g) for r, g in zip(recs, got) if not g["ok"]]
    bad += [(names.get(tid, tid), {"message": "Its saved connection could not be opened. Pair it again."})
            for tid in sorted(links.unreadable)]
    total = len(recs) + len(links.unreadable)
    if not bad:
        return [{"ok": True, "title": "Wall Tablets",
                 "detail": f"{total} reachable directly: " + ", ".join(names.get(r.tablet, r.tablet) for r in recs) + "."}]
    return [{"ok": False, "title": "Wall Tablets",
             "detail": f"{total - len(bad)} of {total} reachable directly. " +
                       " ".join(f"{n}: {g.get('message')}" for n, g in bad)}]


# -- commands (the gateway's) -----------------------------------------------------------------------------------
async def send(app: web.Application, tid: str, verb: str) -> dict[str, Any]:
    """One of VERBS to a paired tablet. ONLY the gateway calls this, after RBAC and the audit row (gateway._forward);
    KioskFailed (its message safe to show) when the tablet could not be reached or refused it."""
    links: TabletLinks | None = app.get("tablet_links")
    rec = links.get(tid) if links is not None else None
    if rec is None or verb not in VERBS:
        raise KioskFailed("not_set_up", "This tablet has no direct connection. Pair it on its page first.")
    http: aiohttp.ClientSession = app["http"]
    if rec.app == "kiosk_satellite":
        await KS.KioskSatellite.of(http, rec.url, rec.token).send(VERBS[verb]["kiosk_satellite"])
    else:
        await fully.FullyClient.of(http, rec.url, rec.token).send(VERBS[verb]["fully"])
    log.info("tablet_links: %s sent to tablet %s", verb, tid)
    return {"tablet": tid, "verb": verb}


def panel_parts(app: web.Application) -> dict[str, dict[str, str]]:
    """{tablet id: {"reload", "clear_cache"}} for every paired tablet: HK Settings' parts (its Reload buttons), as
    ``mantel-tablet:<id>:<verb>``, which Mantel's settings host presses through the command gateway."""
    links: TabletLinks | None = app.get("tablet_links")
    if links is None:
        return {}
    return {tid: {verb: f"{PART_PREFIX}{tid}:{verb}" for verb in VERBS} for tid in links.own}


COMMAND_STATUS = {"forbidden": 403, "unauthenticated": 401, "invalid_command": 400, "audit_unavailable": 503,
                  "unavailable": 409}
COMMAND_WORDS = {
    "tablet_not_paired": "This tablet has no direct connection. An Owner pairs it on its page (Direct Connection).",
    "commands_disabled": "Commands are off on this Mantel, so nothing was sent to the tablet.",
}


async def api_command(request: web.Request) -> web.Response:
    """Reload or Clear Cache, from HK Settings' Wall Tablets pages: handed to the command gateway as the person
    asking (its RBAC, its audit row, its refusals). Commands off: refused here, nothing sent or recorded."""
    ident = identity(request)
    if ident.user is None:
        return error(401, "unauthenticated")
    if ident.device is not None:                 # a wall tablet sends no tablet commands (it drives its own page)
        return error(403, "forbidden", message="A wall tablet cannot reload tablets.")
    tid = _tid(request)
    body = await read_json(request)
    verb = body.get("verb")
    if set(body) - {"verb"} or verb not in VERBS:
        return error(400, "invalid_command", message="verb is reload or clear_cache")
    gw = request.app.get("gateway")
    if gw is None:
        return error(503, "commands_disabled", message=COMMAND_WORDS["commands_disabled"])
    authz = request.app.get("authz")
    principal = authz.principal(request)
    replies: list[dict] = []

    async def reply(msg: dict) -> None:
        replies.append(msg)
    try:
        await asyncio.wait_for(gw.handle(principal, {"type": "command", "id": 1, "kind": "tablet", "tablet": tid,
                                                     "verb": verb}, reply), COMMAND_TIMEOUT)
    except TimeoutError:
        return error(504, "timeout", message="The tablet did not answer in time.")
    got = replies[-1] if replies else {"error": {"code": "unavailable"}}
    if "error" in got:
        e = got["error"]
        code, why = e.get("code") or "failed", e.get("message") or ""
        if code == "unavailable" and why in COMMAND_WORDS:
            return error(409 if why == "tablet_not_paired" else 503, why, message=COMMAND_WORDS[why],
                         audit_id=got.get("audit_id"))
        if code == "forbidden":
            why = "Only an Owner or an Admin can reload a tablet."
        return error(COMMAND_STATUS.get(code, 502), code, message=why or code, audit_id=got.get("audit_id"))
    return ok({"result": got.get("result"), "audit_id": got.get("audit_id")})


# -- REST ----------------------------------------------------------------------------------------------------
def _links(request: web.Request) -> TabletLinks:
    return request.app["tablet_links"]


def _tid(request: web.Request) -> str:
    tid = request.match_info.get("tid", "")
    if not TID_RE.match(tid):
        raise web.HTTPNotFound(text='{"error":"not_found"}', content_type="application/json")
    return tid


def _tablet(request: web.Request, tid: str) -> dict:
    t = hk_tablets(request.app).get(tid)
    if t is None:
        raise web.HTTPNotFound(text='{"error":"not_found"}', content_type="application/json")
    if t.get("app") not in APPS:
        raise web.HTTPConflict(text='{"error":"no_direct_connection","message":"This tablet’s Kiosk App has no '
                                    'direct connection. Kiosk Satellite and Fully Kiosk do."}',
                               content_type="application/json")
    return t


def entry(app: web.Application, tid: str, t: Mapping[str, Any] | None) -> dict[str, Any]:
    links: TabletLinks = app["tablet_links"]
    rec = links.get(tid)
    a = (t or {}).get("app") or (rec.app if rec else None)
    return {"id": tid, "name": (t or {}).get("name") or tid, "app": a, "app_label": APPS.get(a or ""),
            "room": (t or {}).get("room") or None, "in_hk": t is not None,
            "supported": (a in APPS) and (rec is None or rec.app == a),
            "state": "set" if rec is not None else "not_set_up",
            "url": rec.url if rec else None,
            "suggested_url": None if rec else (suggested_address(app, t) if t else None),
            "saved": rec.public() if rec else None,
            "unreadable": tid in links.unreadable}


async def api_list(request: web.Request) -> web.Response:
    ident = C._viewer(request)
    app = request.app
    tablets = hk_tablets(app)
    links: TabletLinks = app["tablet_links"]
    ids = sorted(set(tablets) | set(links.own) | set(links.unreadable),
                 key=lambda k: ((tablets.get(k) or {}).get("name") or k).lower())
    out = [entry(app, k, tablets.get(k)) for k in ids]
    if request.query.get("live") == "1":
        http = app["http"]
        recs = [links.get(e["id"]) for e in out]
        got = await asyncio.gather(*(read_now(http, r) if r is not None else _none() for r in recs))
        for e, g in zip(out, got):
            e["live"] = g
    rule = C.edit_rule(request, ident)
    return ok({"tablets": out, "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh"})


async def _none() -> None:
    return None


async def api_live(request: web.Request) -> web.Response:
    C._viewer(request)
    tid = _tid(request)
    rec = _links(request).get(tid)
    if rec is None:
        return error(404, "not_set_up", message="This tablet has no direct connection yet.")
    return ok({"live": await read_now(request.app["http"], rec)})


async def _pair(request: web.Request, tid: str, t: Mapping[str, Any], body: dict, save: bool) -> dict[str, Any]:
    """Try the address and password the page sent: {"url", "token", "expires", "info", "missing"}."""
    http: aiohttp.ClientSession = request.app["http"]
    password = body.get("password")
    if t["app"] == "kiosk_satellite":
        host, port = KS.clean_address(body.get("address"))
        got = await KS.pair(http, address_text(host, port), password,
                            ttl_days=KS.TOKEN_DAYS if save else KS.TEST_TOKEN_DAYS)
        return {"url": address_text(host, port), **got}
    host, port = fully.clean_address(body.get("address"))
    info = await fully.FullyClient.of(http, address_text(host, port), password).info()
    return {"url": address_text(host, port), "token": fully.clean_password(password), "expires": None,
            "info": info, "missing": []}


def _failed(exc: KioskFailed) -> web.Response:
    return error(422, exc.code, message=exc.message)


def _says(got: Mapping[str, Any]) -> dict[str, Any]:
    """What a test or save shows (never the secret)."""
    return {"url": got["url"], "info": got["info"], "expires": got["expires"], "missing": got["missing"]}


async def api_test(request: web.Request) -> web.Response:
    C._editor(request)
    tid = _tid(request)
    t = _tablet(request, tid)
    body = await read_json(request)
    try:
        got = await _pair(request, tid, t, body, save=False)
    except KioskFailed as exc:
        return _failed(exc)
    return ok({"result": _says(got)})


async def api_save(request: web.Request) -> web.Response:
    ident = C._editor(request)
    tid = _tid(request)
    t = _tablet(request, tid)
    body = await read_json(request)
    try:
        got = await _pair(request, tid, t, body, save=True)
    except KioskFailed as exc:
        return _failed(exc)
    links = _links(request)
    info = got["info"] or {}
    rec = TabletRecord(kind=kind_of(tid), tablet=tid, app=t["app"], url=got["url"], token=got["token"],
                       since=request.app["clock"](),
                       device={k: info.get(k) for k in ("name", "model", "version")},
                       by=ident.user.id, by_name=ident.user.name or ident.user.username,
                       expires=got["expires"], missing=list(got["missing"]))
    got.pop("token", None)
    refused = C._audit(request, ident, f"connection.{rec.kind}.saved",
                       {"url": rec.url, "app": rec.app, "as": (rec.device or {}).get("name"),
                        "replaces": links.get(tid) is not None})
    if refused is not None:
        return refused
    try:
        await links.save(rec)
    except (OSError, atrest.SecretKeyError) as exc:
        log.error("tablet_links: could not save tablet %s's direct connection (%s)", tid, type(exc).__name__)
        return error(500, "save_failed", message="Mantel could not write its secret file. Check that the data "
                     "folder is writable and the at-rest key is readable.")
    log.info("tablet_links: tablet %s paired directly by %s (%s, %s)", tid, ident.user.name or ident.user.id,
             rec.app, rec.url)
    return ok({"tablet": entry(request.app, tid, t), "result": _says(got)})


async def api_disconnect(request: web.Request) -> web.Response:
    ident = C._editor(request)
    tid = _tid(request)
    links = _links(request)
    rec = links.get(tid)
    if rec is None and tid not in links.unreadable:
        return error(404, "not_set_up", message="This tablet has no direct connection.")
    refused = C._audit(request, ident, f"connection.{kind_of(tid)}.disconnected",
                       {"url": rec.url if rec else None, "app": rec.app if rec else None})
    if refused is not None:
        return refused
    try:
        await links.delete(tid)
    except OSError as exc:
        log.error("tablet_links: could not remove tablet %s's direct connection (%s)", tid, type(exc).__name__)
        return error(500, "save_failed", message="Mantel could not remove its secret file.")
    log.info("tablet_links: tablet %s's direct connection removed by %s", tid, ident.user.name or ident.user.id)
    return ok({"tablet": entry(request.app, tid, hk_tablets(request.app).get(tid))})


def register(app: web.Application, links: TabletLinks) -> None:
    app["tablet_links"] = links
    r = app.router
    r.add_get(API, api_list)
    r.add_get(API + "/{tid}/live", api_live)
    r.add_post(API + "/{tid}/test", api_test)
    r.add_post(API + "/{tid}/command", api_command)
    r.add_post(API + "/{tid}", api_save)
    r.add_delete(API + "/{tid}", api_disconnect)
