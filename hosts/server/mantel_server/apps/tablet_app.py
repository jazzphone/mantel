"""Mantel for Android, managed from Mantel Settings on the home network (docs/phase26/ANDROID-APP.md "Managing a tablet").

The app's page is already connected to Mantel (the hub's socket, as the enrolled wall tablet), so Mantel reaches the app
through it: no port on the tablet, no password of its own.

* **Status.** The page asks the app (``window.mantelNative.status()``) and sends ``{type: "tablet_app", event: "status",
  status: {...}}`` when it loads and every minute: the app's version, the screen and brightness, the curtain, battery,
  its kiosk mode and ESPHome port, the menu PIN set or not (never the PIN). Kept in memory per enrolled device, newest
  only; a restart learns it again within a minute. Only a wall tablet's own session is heard.
* **Commands.** ``POST /api/devices/{id}/app`` {command, value?} (an Owner or Admin, the home network only, audited
  ``device.app_command`` before it is sent) is handed to that tablet's open page(s) as ``{type: "tablet_app", event:
  "command", nonce, command, value}``; the page has the app do it and answers ``{event: "done", nonce, ok, status}``.
  The list is closed (COMMANDS) and each value checked here. Like a Kiosk Satellite tablet's Reload (tablet_links.py),
  these are house commands: refused while house commands are off.
* ``GET /api/devices/{id}/app``: the latest status, whether the tablet's page is connected now, and the commands.
* **A picture of the glass** (the owner, 2026-11-12: "a preview of what's on the tablet"): the ``screenshot`` command has
  the app copy its window (960 px wide, JPEG); it rides back on the answer and is kept in memory, newest only, for
  ``GET /api/devices/{id}/app/screenshot``. Taken only when asked, audited like any command, never stored.
"""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
import time
from typing import Any

from aiohttp import web

from ..connectors import Ctx, ws_handlers
from ..identity.accounts import read_json
from ..identity.guards import guard
from ..identity.guards import ident as guarded
from ..identity.sessions import error, ok
from ..storage import audit

log = logging.getLogger("mantel.tablet_app")

# command -> what its value must be (None: no value)
COMMANDS: dict[str, str | None] = {
    "screen": "bool", "brightness": "fraction", "curtain": "bool", "kiosk_mode": "bool",
    "reload": None, "clear_cache": None, "restart": None, "check_update": None, "menu_pin": "pin",
    "screenshot": None,
}
SHOT_MAX = 900_000          # bytes of JPEG: the app sends 960 px wide at quality 70 (about 100 KB)
STATUS_KEYS = {"version": str, "version_code": int, "screen": bool, "brightness": float, "curtain": bool,
               "battery": float, "charging": bool, "kiosk_mode": bool, "owner": bool, "admin": bool,
               "esphome_port": int, "menu_pin": bool, "page": str, "ip": str, "model": str, "update": str}
ANSWER_WAIT = 8.0
STALE = 180.0              # a status older than this is "not heard from"
PIN = re.compile(r"\d{0,12}")


def _clean(status: Any) -> dict:
    out: dict = {}
    if not isinstance(status, dict):
        return out
    for k, kind in STATUS_KEYS.items():
        v = status.get(k)
        if v is None:
            continue
        if kind is float and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = round(float(v), 3)
        elif kind is int and isinstance(v, int) and not isinstance(v, bool):
            out[k] = v
        elif kind is bool and isinstance(v, bool):
            out[k] = v
        elif kind is str and isinstance(v, str):
            out[k] = v[:300]
    return out


def _jpeg(b64: Any) -> bytes | None:
    """The app's picture: base64 of a JPEG, no bigger than SHOT_MAX; anything else is None."""
    import base64
    import binascii
    if not isinstance(b64, str) or not b64 or len(b64) > SHOT_MAX * 4 // 3 + 4:
        return None
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return None
    return raw if raw[:3] == b"\xff\xd8\xff" and len(raw) <= SHOT_MAX else None


def checked(command: Any, value: Any) -> tuple[str, Any] | None:
    """The command and its value as the app is sent them, or None when either is not one of COMMANDS'."""
    if not isinstance(command, str) or command not in COMMANDS:
        return None
    kind = COMMANDS[command]
    if kind is None:
        return (command, None) if value is None else None
    if kind == "bool":
        return (command, value) if isinstance(value, bool) else None
    if kind == "fraction":
        ok_ = isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1
        return (command, round(float(value), 3)) if ok_ else None
    if kind == "pin":
        return (command, value) if isinstance(value, str) and PIN.fullmatch(value) else None
    return None


class TabletApps:
    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self.status: dict[str, dict] = {}                   # device id -> {status, at}
        self.waiting: dict[str, asyncio.Future] = {}        # nonce -> the answer
        self.shots: dict[str, tuple[bytes, float]] = {}     # device id -> its latest picture (JPEG), when

    def heard(self, device_id: str, status: dict) -> None:
        self.status[device_id] = {"status": status, "at": self.clock()}


def apps_of(app: web.Application) -> TabletApps:
    if "tablet_apps" not in app:
        app["tablet_apps"] = TabletApps(app.get("clock") or time.time)
    return app["tablet_apps"]


def _device_of(ctx: Ctx):
    ident = getattr(ctx, "identity", None)
    return getattr(ident, "device", None)


def sessions_of(app: web.Application, device_id: str) -> list:
    hub = app.get("hub")
    return [s for s in (getattr(hub, "sessions", None) or ())
            if getattr(getattr(s, "principal", None), "device", None) is not None
            and s.principal.device.id == device_id and not getattr(s, "gone", False)]


def handler(app: web.Application):
    async def tablet_app(ctx: Ctx, msg: dict) -> None:
        device = _device_of(ctx)
        if device is None or not isinstance(msg, dict):
            return                                          # only a wall tablet's own page speaks for its app
        st = apps_of(app)
        if msg.get("event") == "status":
            st.heard(device.id, _clean(msg.get("status")))
        elif msg.get("event") == "done":
            fut = st.waiting.get(str(msg.get("nonce", "")))
            if fut is None:
                return                                  # an answer nobody asked for (a picture especially): dropped
            shot = _jpeg(msg.get("image"))
            if shot is not None:
                st.shots[device.id] = (shot, st.clock())
            if not fut.done():
                fut.set_result({"ok": bool(msg.get("ok")), "status": _clean(msg.get("status")),
                                "message": str(msg.get("message") or "")[:200], "image": shot is not None})
            if isinstance(msg.get("status"), dict):
                st.heard(device.id, _clean(msg.get("status")))
    return tablet_app


def _device_row(request: web.Request):
    did = request.match_info["id"]
    row = request.app["store"].db.execute("SELECT id, name, room, revoked FROM devices WHERE id = ?", (did,)).fetchone()
    return row if row is not None and row["revoked"] is None else None


def _commands_on(app: web.Application) -> bool:
    """House commands on: the gateway has its commander (as it checks for a Kiosk Satellite tablet's Reload)."""
    gw = app.get("gateway")
    return gw is not None and getattr(gw, "commander", None) is not None


@guard("manager", door="lan", reads="admin")
async def get_app(request: web.Request) -> web.Response:
    row = _device_row(request)
    if row is None:
        return error(404, "not_found")
    st = apps_of(request.app)
    got = st.status.get(row["id"])
    now = st.clock()
    return ok({"device": {"id": row["id"], "name": row["name"]},
               "connected": bool(sessions_of(request.app, row["id"])),
               "status": got["status"] if got else None,
               "heard": got["at"] if got else None,
               "fresh": bool(got and now - got["at"] < STALE),
               "commands": sorted(COMMANDS), "commands_on": _commands_on(request.app)})


@guard("manager", door="lan", audit="device.app_command", reads="none",
       why="answers whether the tablet's app did it, and its status: the app's own, nothing of the house")
async def post_app(request: web.Request) -> web.Response:
    ident = guarded(request)
    row = _device_row(request)
    if row is None:
        return error(404, "not_found")
    body = await read_json(request)
    got = checked(body.get("command"), body.get("value"))
    if got is None:
        return error(400, "invalid_command", message="That isn’t one of the app’s commands.", commands=sorted(COMMANDS))
    command, value = got
    if not _commands_on(request.app):
        return error(503, "commands_disabled", message="Commands are off on this Mantel, so nothing was sent to the tablet.")
    pages = sessions_of(request.app, row["id"])
    if not pages:
        return error(409, "not_connected", message=f"{row['name']}’s app isn’t connected to Mantel right now.")
    audit.config(request, ident, "device.app_command", {"device": row["id"], "name": row["name"], "command": command,
                                                        **({"value": value} if command != "menu_pin" else
                                                           {"value": "set" if value else "none"})})
    st = apps_of(request.app)
    nonce = secrets.token_urlsafe(12)
    fut = asyncio.get_running_loop().create_future()
    st.waiting[nonce] = fut
    try:
        for s in pages:
            await s.send({"type": "tablet_app", "event": "command", "nonce": nonce, "command": command, "value": value},
                         count=False)
        try:
            answer = await asyncio.wait_for(asyncio.shield(fut), ANSWER_WAIT)
        except TimeoutError:
            # (a restart or a reload answers from the next page, if at all: sent is all that is known)
            return ok({"sent": len(pages), "answered": False})
    finally:
        st.waiting.pop(nonce, None)
    log.info("tablet %s's app: %s %s", row["name"], command, "done" if answer["ok"] else "refused")
    if not answer["ok"]:
        return error(502, "app_refused", message=answer["message"] or "The app didn’t do it.")
    out = {"sent": len(pages), "answered": True, "status": answer["status"]}
    if command == "screenshot" and answer.get("image"):
        out["image"] = f"/api/devices/{row['id']}/app/screenshot?at={int(st.shots[row['id']][1])}"
    return ok(out)


@guard("manager", door="lan", reads="admin")
async def get_screenshot(request: web.Request) -> web.Response:
    """The tablet's latest picture (POST .../app {command: screenshot} takes one), in memory only."""
    row = _device_row(request)
    got = apps_of(request.app).shots.get(row["id"]) if row is not None else None
    if got is None:
        return error(404, "not_found")
    return web.Response(body=got[0], content_type="image/jpeg", headers={"Cache-Control": "no-store"})


def register(app: web.Application) -> None:
    apps_of(app)
    ws_handlers(app)["tablet_app"] = handler(app)
    app.router.add_get("/api/devices/{id}/app", get_app)
    app.router.add_post("/api/devices/{id}/app", post_app)
    app.router.add_get("/api/devices/{id}/app/screenshot", get_screenshot)
