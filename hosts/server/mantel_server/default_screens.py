"""The screen a person or a wall tablet opens on (migration 0014; decision 27's addendum, docs/phase8/SETTINGS.md).

``/`` and ``/home`` used to open the App option ``default_screen`` for everyone (and an enrolled tablet its HK
tablet's screen). Now, in this order:

1. at an enrolled wall tablet (a person signed in there too): the tablet's own default screen, else its HK
   tablet's (``ingress.tablet_start``), so a tablet keeps showing its room whoever is signed in;
2. anywhere else, the person's own default screen;
3. ``default_screen``.

A screen that no longer exists is passed over. **Landing only**: which screens anyone may open, and what they
see on them, stays with roles and grants (Avery, 2026-10-19).

REST (Mantel Settings: Me, People, Devices):

* ``GET /api/default-screen``: mine, the screens to choose from and the house's; ``PUT`` ``{screen|null}`` sets or
  clears mine (any person).
* ``GET /api/default-screens``: every person's and tablet's (Owner/Admin).
* ``PUT /api/users/{id}/default-screen``, ``PUT /api/devices/{id}/default-screen`` ``{screen|null}``: Owner/Admin;
  an Admin never sets an Owner's (as for roles, accounts.users_update).
"""
from __future__ import annotations

import re
from typing import Any

from aiohttp import web

from .accounts import read_json, require_manager, require_user
from .sessions import Device, Identity, error, ok

SCREEN = re.compile(r"^[A-Za-z0-9_]+-[A-Za-z0-9_-]{0,100}$")      # a board key, as server.py's screen routes take


def screens(app: web.Application) -> list[dict]:
    """The screens Mantel draws (its boards, as Mantel Settings' Screens group lists them): [{path, title}]."""
    svc = app.get("settings")
    if svc is None:
        return []
    try:
        boards = {k: d.body for k, d in svc.store.docs("board").items()}
        return [{"path": d["path"], "title": d["title"]} for d in svc.dashboards(boards) if SCREEN.match(d["path"])]
    except Exception:  # noqa: BLE001 -- no list: nobody's choice is lost, the house default still opens
        return []


def _known(app: web.Application) -> set[str]:
    return {s["path"] for s in screens(app)}


def get(app: web.Application, subject: str) -> str | None:
    row = app["store"].db.execute("SELECT screen FROM default_screens WHERE subject = ?", (subject,)).fetchone()
    return row[0] if row is not None else None


def put(app: web.Application, subject: str, screen: str | None, by: str | None) -> None:
    db = app["store"].db
    with db:
        if screen is None:
            db.execute("DELETE FROM default_screens WHERE subject = ?", (subject,))
        else:
            db.execute("INSERT INTO default_screens (subject, screen, set_by, updated) VALUES (?,?,?,?) "
                       "ON CONFLICT(subject) DO UPDATE SET screen=excluded.screen, set_by=excluded.set_by, "
                       "updated=excluded.updated", (subject, screen, by, app["clock"]()))


def all_of(app: web.Application, kind: str) -> dict[str, str]:
    rows = app["store"].db.execute("SELECT subject, screen FROM default_screens WHERE subject LIKE ?", (kind + ":%",))
    return {r[0][2:]: r[1] for r in rows}


def _tablet(app: web.Application, device: Device) -> str | None:
    from . import ingress
    start = ingress.tablet_start(app, device)            # "/<screen>/home?hk_tablet=<tid>", or None
    own = get(app, f"d:{device.id}")
    if own and own in _known(app):
        query = start.split("?", 1)[1] if start and "?" in start else ""
        return f"/{own}/home" + (f"?{query}" if query else "")
    return start


def start_for(app: web.Application, ident: Identity | None) -> str | None:
    """Where ``/`` and ``/home`` open for ``ident`` (a path under the page's prefix), or None: the house's."""
    if ident is None:
        return None
    if ident.device is not None:
        return _tablet(app, ident.device)
    if ident.user is not None:
        own = get(app, f"u:{ident.user.id}")
        if own and own in _known(app):
            return f"/{own}/home"
    return None


def _screen_of(app: web.Application, body: Any) -> str | None:
    """The body's screen: None to clear; a screen Mantel knows, else ValueError."""
    if not isinstance(body, dict) or "screen" not in body:
        raise ValueError
    screen = body["screen"]
    if screen is None or screen == "":
        return None
    if not isinstance(screen, str) or not SCREEN.match(screen) or screen not in _known(app):
        raise ValueError
    return screen


async def mine_get(request: web.Request) -> web.Response:
    ident = require_user(request)
    app = request.app
    return ok({"screen": get(app, f"u:{ident.user.id}"), "screens": screens(app), "house": app["cfg"].default_screen,
               "at_tablet": ident.device is not None})


async def mine_put(request: web.Request) -> web.Response:
    ident = require_user(request)
    try:
        screen = _screen_of(request.app, await read_json(request))
    except ValueError:
        return error(400, "invalid")
    put(request.app, f"u:{ident.user.id}", screen, ident.user.id)
    return ok({"screen": screen})


async def all_get(request: web.Request) -> web.Response:
    require_manager(request)
    app = request.app
    return ok({"users": all_of(app, "u"), "devices": all_of(app, "d"), "screens": screens(app),
               "house": app["cfg"].default_screen})


async def user_put(request: web.Request) -> web.Response:
    ident = require_manager(request)
    row = request.app["accounts"].get_user(request.match_info["id"])
    if row is None:
        return error(404, "not_found")
    if ident.user.role != "owner" and row["role"] == "owner":
        return error(403, "forbidden")                    # an Admin never manages an Owner
    try:
        screen = _screen_of(request.app, await read_json(request))
    except ValueError:
        return error(400, "invalid")
    put(request.app, f"u:{row['id']}", screen, ident.user.id)
    return ok({"screen": screen})


async def device_put(request: web.Request) -> web.Response:
    ident = require_manager(request)
    row = request.app["devices"].get(request.match_info["id"]) if "devices" in request.app else None
    if row is None:
        return error(404, "not_found")
    try:
        screen = _screen_of(request.app, await read_json(request))
    except ValueError:
        return error(400, "invalid")
    put(request.app, f"d:{row['id']}", screen, ident.user.id)
    return ok({"screen": screen})


def register(app: web.Application) -> None:
    r = app.router
    r.add_get("/api/default-screen", mine_get)
    r.add_put("/api/default-screen", mine_put)
    r.add_get("/api/default-screens", all_get)
    r.add_put("/api/users/{id}/default-screen", user_put)
    r.add_put("/api/devices/{id}/default-screen", device_put)

