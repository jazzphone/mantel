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
import json
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
    "screenshot": None, "rotation": "rotation",
    # AIRPLAY (phase 30, docs/phase30/PLAN.md): the app's receiver on or off (off on every tablet until switched on), and
    # what it offers -- a mirror, a video's link, sound -- each a switch (the owner, 2026-11-13: "all three")
    "airplay": "bool", "airplay_mirroring": "bool", "airplay_video": "bool", "airplay_audio": "bool",
    # THE TABLET'S OWN OPTIONS (the owner, 2026-11-13: "keep tablet awake and such should be options ... on by default";
    # adaptive brightness; the tablet's scaling; wireless debugging; "copy settings between tablets"): the app's
    # Options.kt and PageScale.kt. `settings` is several of them at once, from another tablet (COPYABLE).
    "keep_awake": "bool", "keep_screen_on": "bool", "adaptive_brightness": "bool", "scale": "scale",
    "wireless_debugging": "bool", "settings": "settings",
    # HOW THE TABLET DRAWS (the owner, 2026-11-14: "having the app able to turn on OpenGL is worth us implementing ... it
    # would also be great if we could change resolution"): the app's Graphics.kt, through its own adb (SelfAdb.kt), which
    # is paired once with the port and six-digit code Android shows under Wireless debugging -> Pair device with pairing code
    "renderer": "renderer", "render_size": "render_size", "adb_pair": "adb_pair",
}
# the page's size on the tablet, percent of Mantel's own (PageScale.CHOICES)
SCALES = (80, 90, 100, 110, 125, 150)
# what Copy Settings From carries from one tablet's app to another's: never the screen, the brightness, the curtain, the
# menu PIN (the app never says it) or wireless debugging -- each tablet's own
COPYABLE = ("kiosk_mode", "rotation", "keep_awake", "keep_screen_on", "adaptive_brightness", "scale",
            "airplay", "airplay_mirroring", "airplay_video", "airplay_audio")
# SCREEN ROTATION (2026-11-13, the owner: Android 16 ignores an app's own landscape on a tablet, and the Loft came back
# from an update sideways): the app sets Android's rotation, 0/90/180/270 as Android counts them from the tablet's natural
# way up, or leaves it to Android (auto). It needs Android's "Modify system settings" for the app, given at the tablet.
ROTATIONS = ("auto", "0", "90", "180", "270")
# the renderer (Android's default, or OpenGL) and the screen's resolution, percent of the panel's own (Graphics.kt)
RENDERERS = ("default", "opengl")
RENDER_SIZES = (100, 83, 67)
PAIR_CODE = re.compile(r"\d{6}")
SHOT_MAX = 900_000          # bytes of JPEG: the app sends 960 px wide at quality 70 (about 100 KB)
STATUS_KEYS = {"version": str, "version_code": int, "screen": bool, "brightness": float, "curtain": bool,
               "battery": float, "charging": bool, "kiosk_mode": bool, "owner": bool, "admin": bool,
               "esphome_port": int, "menu_pin": bool, "page": str, "ip": str, "model": str, "update": str,
               "rotation": str, "rotation_allowed": bool,
               "airplay": bool, "airplay_mirroring": bool, "airplay_video": bool, "airplay_audio": bool,
               "airplay_state": str, "airplay_name": str,
               # the sky drawn by the app (phase 29): off, ready (the tablet's setting on) or playing
               "sky": str,
               # the tablet's own options (Options.kt, PageScale.kt), and whether Android lets the app set them
               "keep_awake": bool, "keep_screen_on": bool, "scale": int, "adaptive_brightness": bool,
               "adaptive_brightness_allowed": bool, "wireless_debugging": bool, "wireless_debugging_allowed": bool,
               "adb_port": int,
               # how the tablet draws (Graphics.kt): as chosen, what Android has now, and whether the app's adb is paired
               "renderer": str, "renderer_now": str, "render_size": int, "adb_paired": bool,
               # the app's last install of an update (Updater.kt): installing, waiting (for a tap) or failed: Android's
               # reason, and the version it was for (android.py's rollout reads both)
               "install": str, "install_for": int}
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
    if kind == "rotation":
        return (command, value) if isinstance(value, str) and value in ROTATIONS else None
    if kind == "scale":
        return (command, value) if isinstance(value, int) and not isinstance(value, bool) and value in SCALES else None
    if kind == "renderer":
        return (command, value) if isinstance(value, str) and value in RENDERERS else None
    if kind == "render_size":
        return (command, value) if isinstance(value, int) and not isinstance(value, bool) and value in RENDER_SIZES else None
    if kind == "adb_pair":
        port, code = (value.get("port"), value.get("code")) if isinstance(value, dict) else (None, None)
        good = (isinstance(port, int) and not isinstance(port, bool) and 0 < port < 65536 and isinstance(code, str)
                and PAIR_CODE.fullmatch(code) and set(value) == {"port", "code"})
        return (command, {"port": port, "code": code}) if good else None
    if kind == "settings":
        if not isinstance(value, dict) or not value or any(k not in COPYABLE for k in value):
            return None
        each = {k: checked(k, v) for k, v in value.items()}
        return (command, {k: got[1] for k, got in each.items() if got}) if all(each.values()) else None
    return None


# ALL TABLETS AND EACH ITS OWN (the owner, 2026-11-14: "Global or 'Fleet' management where tablets have the same
# settings ... also able to adjust the settings independently"): the options HK's settings want for a tablet's app --
# All Tablets' (`tablets.app`) with the tablet's own (`app_options`) over them (hk_core tablet_rules.app_wanted) -- sent
# to the app when what it says differs; the same command again only after FOLLOW_AGAIN (an app that can't take one, a
# renderer before its adb is paired, isn't asked every status).
FOLLOW_AGAIN = 600.0
# what goes in one `settings` command (the app's own COPYABLE, its rotation aside: each tablet's own)
FOLLOWED_IN_SETTINGS = ("kiosk_mode", "keep_awake", "keep_screen_on", "adaptive_brightness", "scale",
                        "airplay", "airplay_mirroring", "airplay_video", "airplay_audio")


def to_send(wanted: dict, status: dict) -> list[tuple[str, Any]]:
    """The commands that bring an app to `wanted`: one `settings` for those it takes together, the renderer and the
    resolution each their own and only with its adb paired. An option its status doesn't say (an app from before it,
    adaptive brightness it can't read) is left alone."""
    diff = {k: v for k, v in wanted.items() if k in status and status[k] != v}
    out: list[tuple[str, Any]] = []
    together = {k: v for k, v in diff.items() if k in FOLLOWED_IN_SETTINGS}
    if together:
        out.append(("settings", together))
    for k in ("renderer", "render_size"):
        if k in diff and status.get("adb_paired") is True:
            out.append((k, diff[k]))
    return out


class TabletApps:
    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self.status: dict[str, dict] = {}                   # device id -> {status, at}
        self.waiting: dict[str, asyncio.Future] = {}        # nonce -> the answer
        self.shots: dict[str, tuple[bytes, float]] = {}     # device id -> its latest picture (JPEG), when
        self.followed: dict[tuple[str, str, str], float] = {}   # (device, command, its value) -> when last sent
        self.listeners: list = []                           # async fn(device id, status): an update's rollout (android.py)

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


def wanted_for(app: web.Application, room: str | None) -> dict | None:
    """What HK's settings want for the app of a device in `room`: its HK tablet's (a device speaks for the tablets in
    its room: devices.tablets_in), All Tablets' with that tablet's own over them. None when it is no tablet's."""
    service = app.get("settings")
    if service is None or not room:
        return None
    from hk_core.settings import model as SM
    from ..settings_store.importing import stored_of
    mine = [t for t in SM.tablets(stored_of(service.store)).values() if t.get("room") == room]
    if not mine:
        return None
    house = (service.house_settings().get("tablets") or {}).get("app")
    return SM.app_wanted(house, mine[0].get("app_options") if len(mine) == 1 else None)


async def follow(app: web.Application, device_id: str, status: dict, room: str | None) -> int:
    """The app on `device_id` (in `room`) brought to what HK's settings want (to_send); how many commands went."""
    if not status or not _commands_on(app):
        return 0
    try:
        wanted = wanted_for(app, room)
    except Exception:  # noqa: BLE001 -- a status is never refused for this
        log.exception("tablet app: its wanted options")
        return 0
    if not wanted:
        return 0
    st = apps_of(app)
    now = st.clock()
    sent = 0
    for command, value in to_send(wanted, status):
        key = (device_id, command, json.dumps(value, sort_keys=True))
        if now - st.followed.get(key, -FOLLOW_AGAIN) < FOLLOW_AGAIN:
            continue
        st.followed[key] = now
        for s in sessions_of(app, device_id):
            # (no answer waited for: the app's next status says what it took)
            await s.send({"type": "tablet_app", "event": "command", "nonce": secrets.token_urlsafe(12),
                          "command": command, "value": value}, count=False)
        log.info("tablet app %s: %s %s, as HK's settings want", device_id, command, value)
        sent += 1
    return sent


def handler(app: web.Application):
    async def tablet_app(ctx: Ctx, msg: dict) -> None:
        device = _device_of(ctx)
        if device is None or not isinstance(msg, dict):
            return                                          # only a wall tablet's own page speaks for its app
        st = apps_of(app)
        if msg.get("event") == "status":
            st.heard(device.id, _clean(msg.get("status")))
            await follow(app, device.id, st.status[device.id]["status"], getattr(device, "room", None))
            await _tell(st, device.id)
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
                await _tell(st, device.id)
    return tablet_app


async def _tell(st: TabletApps, device_id: str) -> None:
    for fn in list(st.listeners):
        try:
            await fn(device_id, st.status[device_id]["status"])
        except Exception:  # noqa: BLE001 -- a status is never refused for a listener
            log.exception("tablet app: a status listener")


async def ask(app: web.Application, device_id: str, command: str, value: Any = None, wait: float = ANSWER_WAIT) -> dict | None:
    """Send one of COMMANDS to the tablet's app and wait for its answer ({ok, status, message}); None when its page isn't
    connected or it didn't answer in time. For Mantel's own steps (an update's rollout): the caller audits."""
    pages = sessions_of(app, device_id)
    if not pages:
        return None
    st = apps_of(app)
    nonce = secrets.token_urlsafe(12)
    fut = asyncio.get_running_loop().create_future()
    st.waiting[nonce] = fut
    try:
        for s in pages:
            await s.send({"type": "tablet_app", "event": "command", "nonce": nonce, "command": command, "value": value},
                         count=False)
        try:
            return await asyncio.wait_for(asyncio.shield(fut), wait)
        except TimeoutError:
            return None
    finally:
        st.waiting.pop(nonce, None)


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
                                                        **({"value": value} if command not in ("menu_pin", "adb_pair") else
                                                           {"value": "given"} if command == "adb_pair" else
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
