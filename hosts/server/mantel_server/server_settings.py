"""Mantel's own settings that used to be start-up options, now in Mantel Settings (the same on the HA App, Docker
and LXC; docs/phase3/HA-APP.md 0.1.52).

The rule: a start-up option is only what Mantel needs to start, or what could lock you out of Mantel Settings if it
were set wrong from inside (the listeners, Mantel's own address, the proxies and networks it believes, HTTPS
certificates, Cloudflare Access, the log level). Everything else lives here:

=====================  ==========================================  =================================================
key                    where in Mantel Settings                    applied
=====================  ==========================================  =================================================
``commands_enabled``   General → Allow Control of the House        the command gateway built or removed at once
``default_screen``     General → House Default Screen              read at each use (default_screens.house)
``session_hours``      General → Sign-Ins from Away Last           new sign-ins from away (sessions.ttl["tunnel"])
``ha_door_rules``      Connections → Home Assistant                read at each use (authz, ingress)
``ha_sign_in_url``     Connections → Home Assistant                "Sign in with Home Assistant" and its frame origin
=====================  ==========================================  =================================================

Each is copied ONCE from the option it replaced (``source: start-up``), the first time this Mantel starts with
this table; from then on the stored value wins and the option is not read again. Turning control on needs an
Owner and a fresh sign-in factor wherever they are; the others an Owner, with a fresh factor away from home (as a
connection: connections.edit_rule). Every change is audited before it is made.

**The kill switch** stays a start-up option: ``read_only`` (the App), ``MANTEL_READ_ONLY`` (Docker), ``--read-only``.
With it, the house is read-only whatever is stored here, and Settings says why.

Two old options move into what Settings already had: ``ha_frame_origins`` into the approved frame origins
(frame_origins.py, Connections → HTTPS and Your Proxy), and the App's Music Assistant address and token into
Mantel's own saved connection (connections.py). Each once (a ``moved:`` row).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from aiohttp import web

from .storage import audit
from .identity.guards import guard
from .identity.guards import ident as guarded

log = logging.getLogger("mantel.server_settings")

API = "/api/admin/server-settings"
DOOR_RULES = ("trusted", "lan", "tunnel")
SCREEN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
HOURS = (1.0, 720.0)
# key -> the Config attribute it was read from (and is applied to)
KEYS = {"commands_enabled": "commands_enabled", "default_screen": "default_screen", "session_hours": "session_hours",
        "ha_door_rules": "ha_door_rules", "ha_sign_in_url": "ha_browser_url"}
GENERAL = ("commands_enabled", "default_screen", "session_hours")


class Invalid(ValueError):
    pass


def clean(key: str, value: Any) -> Any:
    """The value to store for ``key``, or Invalid (with words for the page)."""
    if key == "commands_enabled":
        if not isinstance(value, bool):
            raise Invalid("on or off")
        return value
    if key == "default_screen":
        if value is None or value == "":
            return ""
        if not isinstance(value, str) or not SCREEN.match(value):
            raise Invalid("a screen's address, like dashboard-kitchen")
        return value
    if key == "session_hours":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not HOURS[0] <= float(value) <= HOURS[1]:
            raise Invalid(f"hours, from {HOURS[0]:g} to {HOURS[1]:g}")
        return float(value)
    if key == "ha_door_rules":
        if value not in DOOR_RULES:
            raise Invalid("trusted, lan or tunnel")
        return value
    if key == "ha_sign_in_url":
        from .network.frame_origins import origin_of
        if value is None or value == "":
            return ""
        got = origin_of(value)
        if got is None:
            raise Invalid("Home Assistant's address as browsers know it, like https://ha.example.com")
        return got
    raise Invalid("not a setting")


class ServerSettings:
    """``app["server_settings"]``: the stored values, applied to ``cfg`` (and to what holds a copy) as they change."""

    def __init__(self, app: web.Application, cfg) -> None:
        self.app = app
        self.db = app["store"].db
        self.cfg = cfg
        self.seeded: list[str] = []
        self.wanted_commands = False          # what is stored (the kill switch may hold it off)
        self.appliers: dict[str, Callable[[Any], Any]] = {}

    # -- the table ----------------------------------------------------------------------------------------
    def row(self, key: str):
        return self.db.execute("SELECT * FROM server_settings WHERE key = ?", (key,)).fetchone()

    def _put(self, key: str, value: Any, source: str, by: str | None, now: float) -> None:
        with self.db:
            self.db.execute("INSERT INTO server_settings (key, value, source, set_by, updated) VALUES (?,?,?,?,?) "
                            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, "
                            "set_by = excluded.set_by, updated = excluded.updated",
                            (key, json.dumps(value), source, by, now))

    def get(self, key: str) -> Any:
        r = self.row(key)
        return json.loads(r["value"]) if r is not None else None

    def moved(self, what: str) -> bool:
        return self.row("moved:" + what) is not None

    def mark_moved(self, what: str, detail: Any, now: float) -> None:
        self._put("moved:" + what, detail, "start-up", None, now)

    # -- start-up: copy each option once, then the stored values win -----------------------------------------
    def load(self, now: float) -> list[str]:
        """Copy each missing setting from its start-up option; apply every stored one to cfg. Returns the keys
        copied now from an option someone had set (``seeded``, said in the log; the rows say ``start-up``)."""
        seeded = []
        for key, attr in KEYS.items():
            if self.row(key) is None:
                raw = getattr(self.cfg, attr, None)
                try:
                    value = clean(key, raw if raw is not None else "")
                except Invalid:
                    log.warning("server settings: the start-up option for %s (%r) is not valid here; using the default",
                                key, raw)
                    value = clean(key, default(key))
                self._put(key, value, "start-up", None, now)
                if value != clean(key, default(key)):        # an option someone set: said in the audit log
                    seeded.append(key)
        for key in KEYS:
            self._to_cfg(key, self.get(key))
        if seeded:
            log.info("server settings: copied from the start-up options, once: %s (Mantel Settings has them now)",
                     ", ".join(seeded))
        self.seeded = seeded
        return seeded

    def _to_cfg(self, key: str, value: Any) -> None:
        cfg = self.cfg
        if key == "commands_enabled":
            self.wanted_commands = bool(value)
            cfg.commands_enabled = bool(value) and not getattr(cfg, "read_only", False)
        else:
            setattr(cfg, KEYS[key], value)

    # -- a change from Settings ------------------------------------------------------------------------------
    async def set(self, key: str, value: Any, by: str | None, now: float) -> Any:
        value = clean(key, value)
        self._put(key, value, "settings", by, now)
        self._to_cfg(key, value)
        fn = self.appliers.get(key)
        if fn is not None:
            got = fn(value)
            if hasattr(got, "__await__"):
                await got
        return value

    # -- what the page shows ---------------------------------------------------------------------------------
    def describe(self) -> dict:
        out = {}
        for key in KEYS:
            r = self.row(key)
            out[key] = {"value": json.loads(r["value"]) if r else None, "source": r["source"] if r else None,
                        "updated": r["updated"] if r else None}
        return out


def default(key: str) -> Any:
    """The value with no start-up option set (Config's own default)."""
    from .config import Config
    got = getattr(Config, KEYS[key])
    return got if got is not None else ""


def load(app: web.Application, cfg, now: float) -> ServerSettings:
    """In build_app, right after the store opens: before anything reads these from cfg."""
    ss = ServerSettings(app, cfg)
    ss.load(now)
    app["server_settings"] = ss
    return ss


# -- the sign-in address -----------------------------------------------------------------------------------
def sign_in_address(app: web.Application) -> str:
    """Where "Sign in with Home Assistant" sends a browser: the address set in Mantel Settings, else Home
    Assistant's own External URL, else its Internal URL (HA → Settings → System → Network). '' when none."""
    cfg = app.get("cfg")
    set_here = getattr(cfg, "ha_browser_url", "") or ""
    if set_here:
        return set_here.rstrip("/")
    fo = app.get("frame_origins")
    known = fo.ha_by_kind if fo is not None else {}
    return known.get("external_url") or known.get("internal_url") or ""


def sign_in_described(app: web.Application) -> dict:
    cfg = app.get("cfg")
    if getattr(cfg, "ha_browser_url", ""):
        return {"address": cfg.ha_browser_url, "from": "settings"}
    fo = app.get("frame_origins")
    known = fo.ha_by_kind if fo is not None else {}
    if known.get("external_url"):
        return {"address": known["external_url"], "from": "ha_external"}
    if known.get("internal_url"):
        return {"address": known["internal_url"], "from": "ha_internal"}
    return {"address": "", "from": None}


# -- one-time moves into other stores ------------------------------------------------------------------------
def move_frame_origins(app: web.Application, now: float) -> list[str]:
    """The old ``ha_frame_origins`` option into the approved frame origins (Mantel Settings), once."""
    ss: ServerSettings = app["server_settings"]
    if ss.moved("frame_origins"):
        return []
    from .network import frame_origins as F
    from .settings_store import Actor
    fo = app.get("frame_origins")
    wanted = [o for o in (F.origin_of(x) for x in getattr(app["cfg"], "ha_frame_origins", ()) or ()) if o]
    added = []
    if fo is not None and wanted:
        have = list(fo.approved())
        added = [o for o in wanted if o not in have]
        if added:
            app["settings"].store.write([("house", F.DOC, {"origins": [*have, *added][:F.MAX_APPROVED]})],
                                        actor=Actor(label="start-up options"), message="frame origins from ha_frame_origins")
            log.info("server settings: moved ha_frame_origins into Mantel Settings' approved addresses: %s",
                     ", ".join(added))
    ss.mark_moved("frame_origins", added, now)
    return added


def move_ma(app: web.Application, now: float) -> bool:
    """Music Assistant's address and token from the start-up options into Mantel's own saved connection, once
    (Connections → Music Assistant has it then, as if it had been set up there)."""
    ss: ServerSettings = app["server_settings"]
    if ss.moved("ma"):
        return False
    from . import connections as C
    conns: C.Connections = app["connections"]
    cur = conns.current("ma")
    moved = False
    if cur is not None and cur.source == "install":
        rec = C.Record(kind="ma", url=cur.url, token=cur.token, method="token", since=now, by=None,
                       by_name="Start-up options")
        try:
            conns.files.save(rec)
            conns.own["ma"] = rec
            moved = True
            log.info("server settings: moved Music Assistant's address and token into Mantel's own connection")
        except Exception as exc:  # noqa: BLE001 -- not moved: the start-up option keeps working, try next start
            log.error("server settings: could not move Music Assistant's connection (%s)", type(exc).__name__)
            return False
    ss.mark_moved("ma", moved, now)
    return moved


# -- REST ----------------------------------------------------------------------------------------------------
def _payload(request: web.Request, ident) -> dict:
    from . import connections as C
    from . import default_screens
    app = request.app
    ss: ServerSettings = app["server_settings"]
    cfg = app["cfg"]
    rule = C.edit_rule(request, ident)
    return {"settings": ss.describe(), "read_only_forced": bool(getattr(cfg, "read_only", False)),
            "commands_on": bool(cfg.commands_enabled), "sign_in": sign_in_described(app),
            "screens": default_screens.screens(app), "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh",
            "door": ident.door}


@guard("manager", reads="admin")
async def api_get(request: web.Request) -> web.Response:
    ident = guarded(request)
    return web.json_response(_payload(request, ident), headers={"Cache-Control": "no-store"})


WORDS = {"commands_enabled": "Allow Control of the House", "default_screen": "House Default Screen",
         "session_hours": "Sign-Ins from Away Last", "ha_door_rules": "Home Assistant Door Rules",
         "ha_sign_in_url": "Sign-In Address"}


@guard("owner", fresh="away", audit="server_setting.<key>")
async def api_put(request: web.Request) -> web.Response:
    from .identity.accounts import STEP_UP_WINDOW, read_json
    from .identity.sessions import error
    ident = guarded(request)                           # an Owner; a fresh factor away from home (and below)
    body = await read_json(request)
    key, value = body.get("key"), body.get("value")
    if key not in KEYS:
        return error(400, "invalid", message="No such setting.")
    ss: ServerSettings = request.app["server_settings"]
    cfg = request.app["cfg"]
    now = request.app["clock"]()
    try:
        value = clean(key, value)
    except Invalid as exc:
        return error(400, "invalid", message=f"{WORDS[key]}: {exc}.")
    if key == "commands_enabled" and value:
        if getattr(cfg, "read_only", False):
            return error(409, "read_only_forced", message="This Mantel was started read-only (the read_only option, "
                         "MANTEL_READ_ONLY or --read-only), so control can't be turned on here.")
        if not ident.fresh_within(STEP_UP_WINDOW, now):  # wherever they are: the house's commands, from now on
            return error(403, "step_up_required")
    if key == "default_screen" and value:
        from . import default_screens
        if value not in {s["path"] for s in default_screens.screens(request.app)}:
            return error(400, "invalid", message="House Default Screen: that is not one of Mantel's screens.")
    old = ss.get(key)
    if old == value:
        return web.json_response(_payload(request, ident))
    audit.config(request, ident, f"server_setting.{key}", {"from": old, "to": value})
    await ss.set(key, value, ident.user.id, now)
    log.warning("server settings: %s set to %r by %s", key, value, ident.user.name or ident.user.id)
    return web.json_response(_payload(request, ident))


def register(app: web.Application) -> None:
    """After wire (the audit, the sessions, the gateway's parts) and frame_origins/connections."""
    ss: ServerSettings = app["server_settings"]
    now = app["clock"]()

    def hours(v):
        mgr = app.get("sessions")
        if mgr is not None:
            mgr.ttl["tunnel"] = float(v) * 3600
    ss.appliers["session_hours"] = hours
    if app.get("apply_commands") is not None:
        ss.appliers["commands_enabled"] = lambda v: app["apply_commands"](bool(v) and not getattr(app["cfg"], "read_only", False))
    move_frame_origins(app, now)
    move_ma(app, now)
    app.router.add_get(API, api_get)
    app.router.add_put(API, api_put)
