"""Mantel's screens in Home Assistant's sidebar: one Webpage dashboard per chosen screen
(docs/phase3/HA-SIDEBAR-SCREENS.md, step 3).

A Webpage dashboard is an ordinary storage-mode Lovelace dashboard whose config is only
``{"strategy": {"type": "iframe", "url": <address>}}``. HA can make one a person's default dashboard
(Profile → Dashboard, which the Companion app follows), so a screen added here can be where the Companion
app opens. The address is always Mantel's own direct address + ``<screen>/home``: without direct access
(an Ingress-only App, the loopback prototype) there is nothing HA could frame, and nothing is offered.

**HA is the only record.** Mantel stores nothing: ``GET`` reads HA's dashboards and keeps those whose config
frames this Mantel's address + a screen, so one renamed, hidden or deleted in HA shows as such, and one made
by hand in HA (Settings → Dashboards → Webpage) counts too.

REST (Mantel Settings, a screen's page; Owner and Admin, CSRF like every state-changing /api/ route):

* ``GET /api/admin/ha-dashboards``: ``{state, message, base, ha_url, ha_addresses, dashboards, screens}``.
  ``state`` is ``ok``, ``direct_access_off``, ``ha_not_connected`` or ``not_ha_admin`` (with the steps to
  add it in HA by hand).
* ``PUT /api/admin/screens/<key>/ha-dashboard`` ``{on, title?, icon?, require_admin?}``: creates
  (``url_path`` ``mantel-<key without "dashboard-">``, ``-2`` when taken; never ``dashboard-*``, which HK in
  HA uses), updates, or removes every dashboard of that screen. Audited first (``ha_dashboard.add``,
  ``.update``, ``.remove`` with the url_path); no audit row, no change. It changes HA's configuration, not
  the house, so ``commands_enabled`` does not gate it.

**The kill switch.** With ``--read-only`` (``MANTEL_READ_ONLY``, the App's ``read_only``) Mantel changes nothing in
Home Assistant, and Home Assistant's dashboards are its configuration: every write here is refused
(``read_only``, 409), before its audit row and again in :meth:`HaSession.call`, the one place a write is sent from.
The reads (the list on a screen's page) still work. Rules.md rule 3; the third audit pass, SRV-12.

**Safety.** The App's HA connection is an HA administrator (the Supervisor's user), so this module has its own
short connection per request, never the hub's read-only one or the command path, and ``check_frame`` pins what
it may send: the reads it needs, ``create`` only under ``mantel-``, ``config/save`` only of an iframe strategy
at this Mantel's address + a screen, and ``update``/``delete`` only of a dashboard read in the same connection
whose config frames this Mantel. Nothing else of HA's can be changed through it.

**HK's own dashboards** (screens.py, decision 29: a screen Home Assistant draws): the same connection may also
create a dashboard at a screen's own address, save it ONLY the generated config ``{"strategy": {"type":
"custom:hk-dashboard"}}`` (``HK_CONFIG``), re-point a Webpage dashboard of ours to another screen, and update or
delete a dashboard read in the same connection whose config is exactly that generated one (``hk_ours``). A
hand-built dashboard is never touched.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web

from .. import audit
from ..network import frame_origins
from ..identity.accounts import read_json
from ..identity.guards import guard
from ..identity.guards import ident as guarded
from ..default_screens import SCREEN, screens
from ..identity.sessions import error, ok

log = logging.getLogger("mantel.ha_dashboards")

API = "/api/admin/ha-dashboards"
PUT = "/api/admin/screens/{key}/ha-dashboard"
PREFIX = "mantel-"
DEFAULT_ICON = "mdi:fireplace"
TITLE_MAX = 60
ICON = re.compile(r"^[a-z0-9_-]{1,32}:[a-z0-9_-]{1,64}$")
TIMEOUT = 15.0
HK_STRATEGY = "custom:hk-dashboard"
HK_CONFIG = {"strategy": {"type": HK_STRATEGY}}


def is_hk_config(config: Any) -> bool:
    """A dashboard HK generates from the house (``strategy: custom:hk-dashboard``, nothing else)."""
    return (isinstance(config, dict) and set(config) == {"strategy"} and isinstance(config["strategy"], dict)
            and config["strategy"].get("type") == HK_STRATEGY)

# the frames this connection may send (besides auth), and the keys each may carry
ALLOWED: dict[str, frozenset[str]] = {
    "auth/current_user": frozenset(),
    "get_config": frozenset(),
    "get_panels": frozenset(),
    "lovelace/dashboards/list": frozenset(),
    "lovelace/config": frozenset({"url_path"}),
    "lovelace/dashboards/create": frozenset({"url_path", "title", "icon", "show_in_sidebar", "require_admin"}),
    "lovelace/dashboards/update": frozenset({"dashboard_id", "title", "icon", "require_admin"}),
    "lovelace/dashboards/delete": frozenset({"dashboard_id"}),
    "lovelace/config/save": frozenset({"url_path", "config"}),
}


WRITES = frozenset({"lovelace/dashboards/create", "lovelace/dashboards/update", "lovelace/dashboards/delete",
                    "lovelace/config/save"})
READ_ONLY_WORDS = ("This Mantel was started read-only (the read_only option, MANTEL_READ_ONLY or --read-only), so it "
                   "changes nothing in Home Assistant, dashboards included.")


def read_only(app: web.Application) -> bool:
    return bool(getattr(app["cfg"], "read_only", False))


class Blocked(Exception):
    """A frame this connection may not send."""


class HaError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code, self.message = code, message


class Refused(Exception):
    """Why nothing can be done: a state and its words (the page shows them)."""

    def __init__(self, state: str, message: str, status: int = 409) -> None:
        super().__init__(state)
        self.state, self.message, self.status = state, message, status


# -- addresses ---------------------------------------------------------------------------------------
def direct_base(cfg) -> str:
    """Mantel's own address for browsers (``public_url``, with a trailing slash), or "" without direct access:
    the App's Ingress-only mode (its placeholder ``ingress.invalid``, no direct port) and the loopback prototype."""
    pub = (getattr(cfg, "public_url", "") or "").strip()
    host = urlsplit(pub).hostname or ""
    if not pub or not host or host.endswith(".invalid"):
        return ""
    if getattr(cfg, "ingress", False) and not getattr(cfg, "direct_port", 0):
        return ""
    return pub.rstrip("/") + "/"


def screen_url(base: str, screen: str) -> str:
    return f"{base}{screen}/home"


def url_path_for(screen: str, taken: set[str]) -> str:
    """``mantel-loft`` for ``dashboard-loft`` (HA's url_slug: lower case, a-z 0-9 and hyphens), ``-2`` on."""
    stem = screen[len("dashboard-"):] if screen.startswith("dashboard-") else screen
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "screen"
    path = PREFIX + slug[:50]
    n = 2
    while path in taken:
        path = f"{PREFIX}{slug[:46]}-{n}"
        n += 1
    return path


def screen_of(config: Any, base: str) -> str | None:
    """The screen a dashboard's config frames at this Mantel's address, or None (not a Webpage dashboard of
    ours). Only ``{"strategy": {"type": "iframe", "url": base + "<screen>[/...]"}}``."""
    if not base or not isinstance(config, dict) or set(config) != {"strategy"}:
        return None
    st = config["strategy"]
    if not isinstance(st, dict) or st.get("type") != "iframe" or not isinstance(st.get("url"), str):
        return None
    url = st["url"]
    if not url.startswith(base):
        return None
    seg = re.split(r"[/?#]", url[len(base):], maxsplit=1)[0]
    return seg if SCREEN.match(seg) else None


def check_frame(frame: dict, base: str, ours: set[str], created: set[str], hk: Any = None) -> None:
    """What this connection may send. ``ours``: dashboard ids read in this connection whose config frames this
    Mantel; ``created``: url_paths this connection created; ``hk``: the session's HK dashboards (see above)."""
    hk_allowed = getattr(hk, "hk_allowed", set())
    hk_ours = getattr(hk, "hk_ours", set())
    ours_paths = getattr(hk, "ours_paths", set())
    kind = frame.get("type")
    if kind not in ALLOWED:
        raise Blocked(f"refusing to send {kind!r} to Home Assistant (ha_dashboards.ALLOWED)")
    extra = set(frame) - {"id", "type"} - ALLOWED[kind]
    if extra:
        raise Blocked(f"{kind!r} may not carry {sorted(extra)}")
    if kind == "lovelace/dashboards/create":
        path = frame.get("url_path")
        if not isinstance(path, str) or not (re.fullmatch(r"mantel-[a-z0-9-]{1,60}", path) or path in hk_allowed):
            raise Blocked("a dashboard Mantel creates is named mantel-..., or is an HK screen's own")
    if kind in ("lovelace/dashboards/update", "lovelace/dashboards/delete") and frame.get("dashboard_id") not in (ours | hk_ours):
        raise Blocked("only a dashboard that frames this Mantel, or HK's generated one, may be changed")
    if kind == "lovelace/config/save":
        path, config = frame.get("url_path"), frame.get("config")
        if path in hk_allowed and path in created:
            if config != HK_CONFIG:
                raise Blocked("an HK screen's dashboard gets HK's generated config, nothing else")
            return
        if path not in created and path not in ours_paths:
            raise Blocked("only a dashboard this connection created, or one of ours read here, gets a config")
        if screen_of(config, base) is None:
            raise Blocked("a dashboard's config frames this Mantel's address and a screen, nothing else")


# -- one connection ----------------------------------------------------------------------------------
class HaSession:
    """One short WebSocket connection to HA on Mantel's own credential; every frame passes ``check_frame``."""

    def __init__(self, ws: aiohttp.ClientWebSocketResponse, base: str, read_only: bool = False) -> None:
        self.ws, self.base, self.read_only = ws, base, read_only
        self.ours: set[str] = set()
        self.created: set[str] = set()
        # HK's own dashboards (screens.py): addresses this connection may create, ids read here whose config is
        # HK's generated one, and our Webpage dashboards' url_paths read here (a re-point saves their config)
        self.hk_allowed: set[str] = set()
        self.hk_ours: set[str] = set()
        self.ours_paths: set[str] = set()
        self._next = 0

    async def call(self, kind: str, **kw) -> Any:
        self._next += 1
        frame = {"id": self._next, "type": kind, **kw}
        check_frame(frame, self.base, self.ours, self.created, self)
        if self.read_only and kind in WRITES:
            raise Refused("read_only", READ_ONLY_WORDS, 409)
        await self.ws.send_str(json.dumps(frame))
        while True:
            m = await self.ws.receive()
            if m.type != aiohttp.WSMsgType.TEXT:
                raise ConnectionError("Home Assistant closed the connection")
            data = json.loads(m.data)
            if data.get("id") == self._next and data.get("type") == "result":
                break
        if not data.get("success"):
            err = data.get("error") or {}
            raise HaError(str(err.get("code") or "error"), str(err.get("message") or ""))
        return data.get("result")


async def _open(app: web.Application, base: str, body):
    conns = app.get("connections")
    token = conns.ha_token() if conns is not None else ""
    if not token:
        raise Refused("ha_not_connected", "Mantel isn’t connected to Home Assistant (Connections → Home Assistant).", 503)
    try:
        async with asyncio.timeout(TIMEOUT):
            async with aiohttp.ClientSession() as http:
                async with http.ws_connect(app["cfg"].ws_url, max_msg_size=0) as ws:
                    if (await ws.receive_json()).get("type") != "auth_required":
                        raise ConnectionError("not Home Assistant")
                    await ws.send_json({"type": "auth", "access_token": token})
                    if (await ws.receive_json()).get("type") != "auth_ok":
                        raise ConnectionError("Home Assistant refused Mantel's credential")
                    return await body(HaSession(ws, base, read_only(app)))
    except (Refused, Blocked):
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ConnectionError, ValueError) as exc:
        log.warning("ha_dashboards: Home Assistant could not be reached (%s)", type(exc).__name__)
        raise Refused("ha_not_connected", "Mantel couldn’t reach Home Assistant just now. Check Connections → "
                      "Home Assistant, then try again.", 503) from None


def _manual(app: web.Application, base: str, who: str) -> str:
    first = next((s for s in screens(app)), None)
    example = screen_url(base, first["path"]) if first else base + "<screen>/home"
    return (f"Mantel’s connection to Home Assistant ({who}) isn’t a Home Assistant administrator, so it can’t "
            "add dashboards. Add one yourself in Home Assistant: Settings → Dashboards → Add Dashboard → Webpage, "
            f"with the screen’s address, for example {example}.")


async def _read(sess: HaSession, app: web.Application) -> dict:
    """Everything the page shows, from HA (and the ids this connection may then change)."""
    cfg = app["cfg"]
    me = await sess.call("auth/current_user")
    me = me if isinstance(me, dict) else {}
    try:
        hc = await sess.call("get_config")
    except HaError:
        hc = {}
    if app.get("frame_origins") is not None:
        app["frame_origins"].learn(hc)             # HA's own addresses may frame Mantel (frame_origins.py)
    addresses = [{"kind": k, "url": hc.get(k + "_url").rstrip("/")} for k in ("internal", "external")
                 if isinstance(hc, dict) and isinstance(hc.get(k + "_url"), str) and hc.get(k + "_url")]
    out = {"state": "ok", "message": None, "base": sess.base, "ha_user": {"name": me.get("name"), "is_admin": bool(me.get("is_admin"))},
           "ha_addresses": addresses, "ha_url": ha_url(cfg, addresses), "dashboards": [],
           "screens": [{"path": s["path"], "title": s["title"], "url": screen_url(sess.base, s["path"])} for s in screens(app)]}
    if not me.get("is_admin"):
        out.update(state="not_ha_admin", message=_manual(app, sess.base, me.get("name") or "its user"))
        return out
    items = await sess.call("lovelace/dashboards/list")
    for d in items if isinstance(items, list) else []:
        if not isinstance(d, dict) or d.get("mode") != "storage" or not isinstance(d.get("url_path"), str):
            continue
        try:
            config = await sess.call("lovelace/config", url_path=d["url_path"])
        except HaError:
            continue                                     # a dashboard with no config yet: not a Webpage one
        if is_hk_config(config):
            sess.hk_ours.add(d.get("id"))
            out.setdefault("hk_dashboards", []).append({"id": d.get("id"), "url_path": d["url_path"],
                                                        "title": d.get("title") or ""})
        screen = screen_of(config, sess.base)
        if screen is None:
            continue
        sess.ours.add(d.get("id"))
        sess.ours_paths.add(d["url_path"])
        out["dashboards"].append({"id": d.get("id"), "url_path": d["url_path"], "title": d.get("title") or "",
                                  "icon": d.get("icon") or "", "require_admin": bool(d.get("require_admin")),
                                  "show_in_sidebar": d.get("show_in_sidebar") is not False, "screen": screen,
                                  "url": config["strategy"]["url"]})
    out["taken"] = [d.get("url_path") for d in items if isinstance(d, dict)] if isinstance(items, list) else []
    seen = app.get("ha_sidebar_screens")
    if seen is not None:                 # the screens in HA's sidebar, as last read (Screens say so; linked_settings)
        seen.clear()
        seen.update({d["screen"]: d["title"] for d in out["dashboards"] if d["show_in_sidebar"]})
    return out


def ha_url(cfg, addresses: list[dict]) -> str:
    """HA's address for people: the Sign-In Address set in Mantel Settings, else HA's own external, internal."""
    if getattr(cfg, "ha_browser_url", ""):
        return cfg.ha_browser_url.rstrip("/")
    for kind in ("external", "internal"):
        got = next((a["url"] for a in addresses if a["kind"] == kind), None)
        if got:
            return got
    return "" if getattr(cfg, "ha_managed_by_app", False) else (getattr(cfg, "ha_url", "") or "").rstrip("/")


def _public(data: dict, app: web.Application | None = None) -> dict:
    out = {k: v for k, v in data.items() if k != "taken"}
    if app is not None:                  # the HA addresses that may show Mantel now (frame_origins.py)
        out["frame_ancestors"] = [a for a in frame_origins.ancestors(app) if a.startswith(("http://", "https://"))]
    return out


# -- REST ----------------------------------------------------------------------------------------------
@guard("manager", reads="admin")
async def api_list(request: web.Request) -> web.Response:
    app = request.app
    base = direct_base(app["cfg"])
    if not base:
        return ok({"state": "direct_access_off", "message": OFF, "base": "", "dashboards": [], "screens": [],
                   "ha_addresses": [], "ha_url": ""})
    try:
        data = await _open(app, base, lambda sess: _read(sess, app))
    except Refused as r:
        return ok({"state": r.state, "message": r.message, "base": base, "dashboards": [], "screens": [],
                   "ha_addresses": [], "ha_url": ""})
    except HaError as exc:
        return ok({"state": "ha_not_connected", "message": f"Home Assistant didn’t list its dashboards ({exc.code}).",
                   "base": base, "dashboards": [], "screens": [], "ha_addresses": [], "ha_url": ""})
    return ok(_public(data, app))


OFF = ("Home Assistant can show a screen only at Mantel’s own address. Turn on direct access first "
       "(the App option access: proxy or https).")


def _body(app: web.Application, key: str, body: dict) -> dict:
    if not isinstance(body.get("on"), bool):
        raise ValueError
    known = {s["path"]: s["title"] for s in screens(app)}
    if key not in known:
        raise LookupError
    out: dict = {"on": body["on"], "default_title": known[key]}
    if "title" in body:
        t = body["title"]
        if not isinstance(t, str) or not t.strip() or len(t.strip()) > TITLE_MAX:
            raise ValueError
        out["title"] = t.strip()
    if "icon" in body:
        i = body["icon"]
        if not isinstance(i, str) or not ICON.match(i.strip()):
            raise ValueError
        out["icon"] = i.strip()
    if "require_admin" in body:
        if not isinstance(body["require_admin"], bool):
            raise ValueError
        out["require_admin"] = body["require_admin"]
    if body.get("frame_origin") is not None:     # the HA address this page is shown in (an Owner trusts it with this)
        if not isinstance(body["frame_origin"], str):
            raise ValueError
        out["frame_origin"] = body["frame_origin"]
    return out


def _audited(request: web.Request, ident, action: str, detail: dict) -> dict | None:
    """The row before HA is asked; ``{"refused": 503}`` (and nothing asked) when it cannot be written."""
    try:
        audit.config(request, ident, action, detail)
    except audit.Unavailable:
        return {"refused": error(503, "audit_unavailable")}
    return None


@guard("manager", audit=("ha_dashboard.add", "ha_dashboard.update", "ha_dashboard.remove", "frame_origin.add"))
async def api_put(request: web.Request) -> web.Response:
    ident = guarded(request)
    app = request.app
    key = request.match_info["key"]
    if not SCREEN.match(key):
        return error(404, "not_found")
    if read_only(app):                                  # before the audit row: nothing is asked of Home Assistant
        return error(409, "read_only", message=READ_ONLY_WORDS)
    try:
        want = _body(app, key, await read_json(request))
    except LookupError:
        return error(404, "not_found")
    except ValueError:
        return error(400, "invalid", message=f"A title is 1 to {TITLE_MAX} characters; an icon is like mdi:fireplace.")
    base = direct_base(app["cfg"])
    if not base:
        return error(409, "direct_access_off", message=OFF)

    async def change(sess: HaSession) -> dict:
        data = await _read(sess, app)
        if data["state"] != "ok":
            raise Refused(data["state"], data["message"], 403)
        mine = [d for d in data["dashboards"] if d["screen"] == key]
        if not want["on"]:
            for d in mine:
                refused = _audited(request, ident, "ha_dashboard.remove", {"screen": key, "url_path": d["url_path"]})
                if refused is not None:
                    return refused
                await sess.call("lovelace/dashboards/delete", dashboard_id=d["id"])
                log.info("ha_dashboards: %s removed HA dashboard %s (%s)", ident.user.name or ident.user.id, d["url_path"], key)
        elif not mine:
            taken = set(data.get("taken") or [])
            try:
                taken |= set((await sess.call("get_panels") or {}).keys())
            except HaError:
                pass
            path = url_path_for(key, taken)
            title = want.get("title") or want["default_title"]
            admin = want.get("require_admin", False)
            refused = _audited(request, ident, "ha_dashboard.add", {"screen": key, "url_path": path, "title": title,
                                                                   "require_admin": admin})
            if refused is not None:
                return refused
            made = await sess.call("lovelace/dashboards/create", url_path=path, title=title,
                                   icon=want.get("icon") or DEFAULT_ICON, show_in_sidebar=True, require_admin=admin)
            sess.created.add(path)
            try:
                await sess.call("lovelace/config/save", url_path=path,
                                config={"strategy": {"type": "iframe", "url": screen_url(base, key)}})
            except (HaError, ConnectionError):
                if isinstance(made, dict) and made.get("id"):
                    sess.ours.add(made["id"])            # undo our own half-made dashboard
                    try:
                        await sess.call("lovelace/dashboards/delete", dashboard_id=made["id"])
                    except (HaError, ConnectionError):
                        pass
                raise
            log.info("ha_dashboards: %s added HA dashboard %s for %s", ident.user.name or ident.user.id, path, key)
        else:
            d = mine[0]
            changes = {k: want[k] for k in ("title", "icon", "require_admin") if k in want and want[k] != d[k]}
            if changes:
                refused = _audited(request, ident, "ha_dashboard.update", {"screen": key, "url_path": d["url_path"], **changes})
                if refused is not None:
                    return refused
                await sess.call("lovelace/dashboards/update", dashboard_id=d["id"], **changes)
        return await _read(sess, app)

    async with app["ha_dashboards_lock"]:              # one change at a time: a double tap makes one dashboard
        try:
            got = await _open(app, base, change)
        except Refused as r:
            return error(r.status, r.state, message=r.message)
        except HaError as exc:
            log.warning("ha_dashboards: Home Assistant refused (%s)", exc.code)
            return error(502, "ha_refused", message=f"Home Assistant refused it: {exc.message or exc.code}.")
    if "refused" in got:
        return got["refused"]
    approved = None
    if want["on"] and want.get("frame_origin") and ident.user.role == "owner":
        # an Owner turned it on inside HA's sidebar at this address: that address may now show Mantel (audited)
        try:
            approved, err = await frame_origins.approve(request, ident, want["frame_origin"], "show in home assistant")
        except audit.Unavailable:
            approved, err = None, True
        if err is not None:
            approved = None
    return ok({**_public(got, app), "frame_approved": approved})


def register(app: web.Application) -> None:
    app["ha_dashboards_lock"] = asyncio.Lock()
    app["ha_sidebar_screens"] = {}       # screen -> its title in HA's sidebar, as last read
    app.router.add_get(API, api_list)
    app.router.add_put(PUT, api_put)
