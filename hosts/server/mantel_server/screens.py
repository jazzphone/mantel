"""Mantel's screens: add one, say where it is drawn, split one, remove one (decision 29, docs/phase9/TWO-PRODUCTS.md
"one place per screen").

A screen is a board document (settings scope ``board``, key = its address). Its ``where`` says who draws it:
``mantel`` (Mantel serves it) or ``ha`` (HK Frontend's dashboard of the same address in Home Assistant draws it,
with these settings, through a linked HK Frontend's mirror). Each screen is drawn in one place.

REST (Mantel Settings; Owner and Admin, CSRF like every state-changing /api/ route; each change audited first):

* ``POST /api/screens`` ``{title, where, from?}``: a new screen, its settings copied from ``from`` or a new
  screen's. ``where: ha`` also makes its dashboard in Home Assistant (HK's generated one, ``custom:hk-dashboard``),
  through ha_dashboards' pinned connection.
* ``PUT /api/screens/{key}`` ``{where}`` or ``{title}``: who draws it, or its name. ``{"remove_ha": true}``: remove
  Home Assistant's generated dashboard at the same address (a Mantel screen that Home Assistant also had).
* ``POST /api/screens/{key}/split`` ``{title}``: a screen both draw becomes two. Mantel's copy gets a new address
  (from ``title``) and keeps everything that pointed at Mantel's screen: the wall tablets on it, Default Screens,
  photo albums, per-screen accessory names, pop-ups' screens, and the Webpage dashboards that frame it in Home
  Assistant (re-pointed and renamed); the old address is Home Assistant's, with the same settings, and Mantel
  answers it with a redirect to the new one (``house/screen_moves``).
* ``DELETE /api/screens/{key}``: a screen no wall tablet uses, removed from Mantel (its history kept).
"""
from __future__ import annotations

import copy
import logging
import re
from typing import Any

from aiohttp import web

from . import connections as C
from . import ha_dashboards as HD
from .accounts import read_json, require_manager
from .sessions import error, ok
from .settings_store import Actor, actor_of

log = logging.getLogger("mantel.screens")

WHERE = ("mantel", "ha")
TITLE_MAX = 60
MOVES = "screen_moves"                # house document: {old address: new address}
KEY = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")


def slug(title: str) -> str:
    """An address from a name: ``Home-Mantel`` -> ``home-mantel``; one word gets ``screen-`` (Home Assistant
    wants a hyphen in a dashboard's address)."""
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "screen"
    return s if "-" in s else f"screen-{s}"


def free_key(store: Any, title: str, taken: set[str] = frozenset()) -> str:
    base, n = slug(title), 2
    key = base
    while store.get("board", key) is not None or key in taken:
        key = f"{base[:56]}-{n}"
        n += 1
    return key


def moves(store: Any) -> dict[str, str]:
    got = store.body("house", MOVES).get("moves") if store.get("house", MOVES) else None
    return dict(got) if isinstance(got, dict) else {}


def moved_to(app: web.Application, key: str) -> str | None:
    """Where a screen's old address goes now (a split screen), or None."""
    svc = app.get("settings")
    if svc is None:
        return None
    try:
        return moves(svc.store).get(key)
    except Exception:  # noqa: BLE001 -- no redirect: the page opens as before
        return None


def where_of(app: web.Application, key: str) -> str | None:
    svc = app.get("settings")
    if svc is None:
        return None
    d = svc.store.get("board", key)
    return None if d is None else ("ha" if (d.body or {}).get("where") == "ha" else "mantel")


def _title(body: Any) -> str:
    t = body.get("title") if isinstance(body, dict) else None
    if not isinstance(t, str) or not t.strip() or len(t.strip()) > TITLE_MAX:
        raise ValueError(f"A name is 1 to {TITLE_MAX} characters.")
    return t.strip()


def _audit(request: web.Request, ident: Any, action: str, detail: dict) -> web.Response | None:
    return C._audit(request, ident, action, detail)


async def _with_ha(app: web.Application, work):
    """One pinned connection to Home Assistant (ha_dashboards), with its dashboards read first."""
    base = HD.direct_base(app["cfg"])

    async def body(sess: HD.HaSession):
        data = await HD._read(sess, app)
        if data["state"] != "ok":
            raise HD.Refused(data["state"], data["message"], 403)
        return await work(sess, data)

    async with app["ha_dashboards_lock"]:
        return await HD._open(app, base, body)


async def _make_ha_dashboard(app: web.Application, key: str, title: str) -> None:
    async def work(sess: HD.HaSession, data: dict) -> None:
        if key in set(data.get("taken") or []):
            if any(d["url_path"] == key for d in data.get("hk_dashboards") or []):
                return                                    # HK's generated dashboard is there already
            raise HD.Refused("taken", f"Home Assistant already has a dashboard at /{key} that isn't HK's.", 409)
        sess.hk_allowed.add(key)
        await sess.call("lovelace/dashboards/create", url_path=key, title=title, icon="mdi:home-assistant",
                        show_in_sidebar=True, require_admin=False)
        sess.created.add(key)
        await sess.call("lovelace/config/save", url_path=key, config=HD.HK_CONFIG)
    await _with_ha(app, work)


def _ha_failed(exc: Exception) -> web.Response:
    if isinstance(exc, HD.Refused):
        return error(exc.status, exc.state, message=exc.message)
    if isinstance(exc, HD.HaError):
        return error(502, "ha_refused", message=f"Home Assistant refused it: {exc.message or exc.code}.")
    raise exc


# -- REST -----------------------------------------------------------------------------------------------
async def api_add(request: web.Request) -> web.Response:
    ident = require_manager(request)
    app = request.app
    svc = app["settings"]
    body = await read_json(request)
    try:
        title = _title(body)
    except ValueError as exc:
        return error(400, "invalid", message=str(exc))
    where = body.get("where", "mantel")
    src = body.get("from")
    if where not in WHERE or (src is not None and (not isinstance(src, str) or svc.store.get("board", src) is None)):
        return error(400, "invalid", message="where: mantel or ha; from: an existing screen")
    key = free_key(svc.store, title)
    if src is not None:
        board = copy.deepcopy(svc.store.body("board", src))
    else:
        from hk_core.settings import model as SM
        board = SM.new_board("personal", {"dashboard": svc.house_settings()})
    board.update(where=where, title=title)
    refused = _audit(request, ident, "screen.add", {"screen": key, "title": title, "where": where, "from": src})
    if refused is not None:
        return refused
    if where == "ha":
        try:
            await _make_ha_dashboard(app, key, title)
        except (HD.Refused, HD.HaError) as exc:
            return _ha_failed(exc)
    svc.store.write([("board", key, board)], actor=actor_of(ident), message="mantel/screen/add")
    svc.publish()
    log.info("screens: %s added %s (%s)", ident.user.name or ident.user.id, key, where)
    return ok({"key": key, "title": title, "where": where})


async def api_put(request: web.Request) -> web.Response:
    ident = require_manager(request)
    app, key = request.app, request.match_info["key"]
    svc = app["settings"]
    cur = svc.store.get("board", key) if KEY.match(key) else None
    if cur is None:
        return error(404, "not_found")
    body = await read_json(request)
    board = copy.deepcopy(cur.body)
    if set(body) == {"where"} and body["where"] in WHERE:
        if body["where"] == "ha" and _tablets_on(svc, key):
            return error(409, "tablets", message="Wall tablets open this screen in Mantel. Move them to another "
                                                 "screen first, or split it instead.")
        board["where"] = body["where"]
        action = "screen.where"
    elif set(body) == {"title"}:
        try:
            board["title"] = _title(body)
        except ValueError as exc:
            return error(400, "invalid", message=str(exc))
        action = "screen.title"
    elif body == {"remove_ha": True}:
        refused = _audit(request, ident, "screen.remove_ha", {"screen": key})
        if refused is not None:
            return refused

        async def work(sess: HD.HaSession, data: dict) -> int:
            gone = 0
            for d in data.get("hk_dashboards") or []:
                if d["url_path"] == key:
                    await sess.call("lovelace/dashboards/delete", dashboard_id=d["id"])
                    gone += 1
            return gone
        try:
            gone = await _with_ha(app, work)
        except (HD.Refused, HD.HaError) as exc:
            return _ha_failed(exc)
        if not gone:
            return error(404, "no_ha_dashboard", message="Home Assistant has no generated HK dashboard at this "
                                                         "address (a hand-built one is never removed from here).")
        _forget_reported(app, key)
        svc.publish()
        return ok({"key": key, "removed": gone})
    else:
        return error(400, "invalid", message='{"where": "mantel"|"ha"}, {"title"}, or {"remove_ha": true}')
    refused = _audit(request, ident, action, {"screen": key, **body})
    if refused is not None:
        return refused
    svc.store.write([("board", key, board)], actor=actor_of(ident), message="mantel/" + action.replace(".", "/"),
                    expect={("board", key): cur.version})
    svc.publish()
    return ok({"key": key, "where": board.get("where", "mantel"), "title": board.get("title", "")})


def _forget_reported(app: web.Application, key: str) -> None:
    """HK Frontend reports its dashboards when its link connects; one Mantel just removed is gone from that list
    now, so Screens stops marking the address as shared without waiting for the next connect."""
    lk = app.get("linked")
    for c in (lk.registry.clients if lk is not None else ()):
        boards = c.report.get("hk_dashboards")
        if isinstance(boards, list):
            c.report["hk_dashboards"] = [b for b in boards if b.get("path") != key]


def _tablets_on(svc: Any, key: str) -> list[str]:
    return [t for t, d in svc.store.docs("tablet").items() if (d.body or {}).get("screen") == key]


async def api_split(request: web.Request) -> web.Response:
    ident = require_manager(request)
    app, old = request.app, request.match_info["key"]
    svc, db = app["settings"], app["store"].db
    cur = svc.store.get("board", old) if KEY.match(old) else None
    if cur is None:
        return error(404, "not_found")
    try:
        title = _title(await read_json(request))
    except ValueError as exc:
        return error(400, "invalid", message=str(exc))
    new = free_key(svc.store, title)
    refused = _audit(request, ident, "screen.split", {"screen": old, "to": new, "title": title})
    if refused is not None:
        return refused
    actor = actor_of(ident)
    mine = copy.deepcopy(cur.body)
    mine.update(where="mantel", title=title)
    theirs = copy.deepcopy(cur.body)
    theirs["where"] = "ha"
    changes: list[tuple[str, str, dict]] = [("board", new, mine), ("board", old, theirs)]
    # the wall tablets on it are Mantel's: they move with Mantel's screen
    for tid, d in svc.store.docs("tablet").items():
        if (d.body or {}).get("screen") == old:
            changes.append(("tablet", tid, {**d.body, "screen": new}))
    # pop-ups shown on it: on both
    pops = svc.store.body("house", "popups")
    items = [dict(p) for p in pops.get("items") or []]
    if any(old in (p.get("dashboards") or []) for p in items):
        for p in items:
            if old in (p.get("dashboards") or []):
                p["dashboards"] = list(p["dashboards"]) + [new]
        changes.append(("house", "popups", {**pops, "items": items}))
    # accessories' per-screen names: Mantel's copy gets the same
    acc = copy.deepcopy(svc.store.body("house", "accessories") or {})
    touched = False
    for v in (acc.get("entities") or {}).values():
        if isinstance(v, dict) and isinstance(v.get("names"), dict) and old in v["names"]:
            v["names"][new] = v["names"][old]
            touched = True
    if touched:
        changes.append(("house", "accessories", acc))
    mv = moves(svc.store)
    mv[old] = new
    changes.append(("house", MOVES, {"moves": mv}))
    svc.store.write(changes, actor=actor, message="mantel/screen/split")
    # Default Screens and photo albums: tables of their own
    with db:
        db.execute("UPDATE default_screens SET screen=? WHERE screen=?", (new, old))
        try:
            db.execute("UPDATE photo_screens SET screen=? WHERE screen=?", (new, old))
        except Exception:  # noqa: BLE001 -- a Mantel without Photos
            pass
    svc.publish()
    framed = await _repoint_frames(app, old, new, title)
    log.info("screens: %s split %s: Mantel's is now %s", ident.user.name or ident.user.id, old, new)
    return ok({"key": new, "title": title, "old": old, "frames": framed})


async def _repoint_frames(app: web.Application, old: str, new: str, title: str) -> Any:
    """The Webpage dashboards that frame Mantel's old address: pointed at the new one, and renamed."""
    base = HD.direct_base(app["cfg"])
    if not base:
        return {"state": "direct_access_off"}

    async def work(sess: HD.HaSession, data: dict) -> list[str]:
        done = []
        for d in data["dashboards"]:
            if d["screen"] == old:
                await sess.call("lovelace/config/save", url_path=d["url_path"],
                                config={"strategy": {"type": "iframe", "url": HD.screen_url(base, new)}})
                await sess.call("lovelace/dashboards/update", dashboard_id=d["id"], title=title)
                done.append(d["url_path"])
        return done
    try:
        return await _with_ha(app, work)
    except (HD.Refused, HD.HaError) as exc:
        log.warning("screens: the framed dashboards of %s were not re-pointed (%s)", old, type(exc).__name__)
        return {"state": getattr(exc, "state", "ha_refused"), "message": getattr(exc, "message", "")}


async def api_delete(request: web.Request) -> web.Response:
    ident = require_manager(request)
    app, key = request.app, request.match_info["key"]
    svc = app["settings"]
    if not KEY.match(key) or svc.store.get("board", key) is None:
        return error(404, "not_found")
    if _tablets_on(svc, key):
        return error(409, "tablets", message="Wall tablets open this screen. Move them to another screen first.")
    refused = _audit(request, ident, "screen.remove", {"screen": key})
    if refused is not None:
        return refused
    svc.store.remove("board", key, actor=actor_of(ident), message="mantel/screen/remove")
    svc.publish()
    return ok({"key": key, "removed": True})


def register(app: web.Application) -> None:
    app.router.add_post("/api/screens", api_add)
    app.router.add_put("/api/screens/{key}", api_put)
    app.router.add_post("/api/screens/{key}/split", api_split)
    app.router.add_delete("/api/screens/{key}", api_delete)


__all__ = ["register", "moved_to", "where_of", "slug", "Actor"]
