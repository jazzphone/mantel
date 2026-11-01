"""Screens and Home Grid: list, read, add, rename, move, remove a screen; the Home Grid catalogue, a starter, a
whole layout, one block placed or removed. Screens go through screens.py's own functions (the REST routes'), a
layout through the screen's board/set save, so hk_core checks every block (no overlap, inside the grid, a size the
card has, cols 6/5/4/3/2, rows 2-6) and a bad one comes back with its code.

An assistant's screens are Mantel's own (``where: mantel``): making one in Home Assistant, or removing Home
Assistant's, reaches Home Assistant outside the gateway, so those stay Mantel Settings' (screens.py's REST)."""
from __future__ import annotations

import copy
import re
from typing import Any

from ... import screens as SCREENS
from ..dispatch import ToolError, change, read, save, step
from . import Tool

ITEM_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,19}\Z")


async def _panel(caller) -> dict:
    return await read(caller, {"type": "hk_frontend/panel/get"})


def _where(d: dict) -> str:
    w = d.get("where")
    return (w.get("where") if isinstance(w, dict) else w) or "mantel"


async def screens_list(caller, args: dict) -> dict:
    panel = await _panel(caller)
    tablets = panel.get("tablets") or {}
    boards = panel.get("boards") or {}
    out = []
    for d in panel.get("dashboards") or []:
        b = boards.get(d["path"]) or {}
        out.append({"key": d["path"], "title": d["title"], "where": _where(d),
                    "home_style": b.get("home_style", "generated"),
                    "version": (panel.get("versions") or {}).get("board/" + d["path"], 0),
                    "tablets": sorted(k for k, t in tablets.items() if (t or {}).get("screen") == d["path"])})
    return {"screens": out, "house_default": (panel.get("settings") or {}).get("default_screen")}


async def screen_get(caller, args: dict) -> dict:
    key = args["screen"]
    panel = await _panel(caller)
    boards = panel.get("boards") or {}
    if key not in boards:
        raise ToolError("not_found", f"no screen {key!r} (screens_list names them)", {"screen": "unknown"})
    board = copy.deepcopy(boards[key])
    if not args.get("all_settings"):
        board = {k: v for k, v in board.items() if k in ("title", "where", "home_style", "home_grid", "menu",
                                                         "favorites", "rooms", "pages", "tabs", "views")} | \
            {"other_settings": sorted(k for k in board if k not in ("title", "where", "home_style", "home_grid",
                                                                    "menu", "favorites", "rooms", "pages", "tabs",
                                                                    "views"))}
    return {"key": key, "version": (panel.get("versions") or {}).get("board/" + key, 0),
            "tablets": sorted(k for k, t in (panel.get("tablets") or {}).items() if (t or {}).get("screen") == key),
            "board": board}


def _screen_error(exc: SCREENS.ScreenError) -> ToolError:
    return ToolError(exc.code, exc.message or exc.code)


async def _screens_call(caller, work):
    async def run():
        try:
            return await work()
        except SCREENS.ScreenError as exc:
            raise _screen_error(exc) from None
    return await step(run)


def _need_mantel(where: Any) -> None:
    if where not in (None, "mantel"):
        raise ToolError("forbidden", "an assistant's screens are drawn by Mantel; a screen in Home Assistant is made "
                                     "in Mantel Settings (it reaches Home Assistant)", {"where": "choice"})


async def screen_create(caller, args: dict) -> dict:
    _need_mantel(args.get("where"))
    body = {"title": args["title"], "where": "mantel"}
    if args.get("copy_from"):
        body["from"] = args["copy_from"]
    settings = dict(args.get("settings") or {})
    if args.get("home_grid") is not None:
        settings["home_grid"] = args["home_grid"]
        settings.setdefault("home_style", "grid")
    app, ident = caller.app, caller.principal
    return await change(caller, "screen_create", args,
                        lambda: _screens_call(caller, lambda: SCREENS.add(app, ident, body, changes=settings or None)))


async def screen_rename(caller, args: dict) -> dict:
    return await change(caller, "screen_rename", args, lambda: _screens_call(
        caller, lambda: SCREENS.change(caller.app, caller.principal, args["screen"], {"title": args["title"]})))


async def screen_move(caller, args: dict) -> dict:
    return await change(caller, "screen_move", args, lambda: _screens_call(
        caller, lambda: SCREENS.change(caller.app, caller.principal, args["screen"], {"where": args["where"]})))


async def screen_remove(caller, args: dict) -> dict:
    return await change(caller, "screen_remove", args, lambda: _screens_call(
        caller, lambda: SCREENS.remove(caller.app, caller.principal, args["screen"])))


# -- Home Grid -------------------------------------------------------------------------------------------------------
async def grid_cards(caller, args: dict) -> dict:
    from hk_core.settings import home_grid as HG
    return {"cols": list(HG.COLS), "rows": {"min": HG.ROWS[0], "max": HG.ROWS[1], "default": HG.ROWS_DEFAULT},
            "sizes": {k: {"cols": w, "rows": h} for k, (w, h) in HG.SIZES.items()},
            "size_notes": "F (Full) fills its whole view, at [0, 0], alone; offered for `cameras` only",
            "items_max": HG.ITEMS_MAX, "views_max": HG.VIEWS_MAX, "page_sources": list(HG.SOURCES),
            "tablet_room": HG.TABLET_ROOM,
            "cards": {k: {"sizes": list(c["sizes"]), "pages_from": list(c["sources"]), "options": dict(c["opts"])}
                      for k, c in HG.CATALOG.items()},
            "layout": {"v": HG.VERSION, "cols": "one of cols", "rows": "rows", "band": "the top band (true)",
                       "items": "[{id, card, size, at: [col, row], opts?, pages?, view?}]"},
            "starters": list(HG.STARTERS)}


async def grid_starter(caller, args: dict) -> dict:
    options = {k: args[k] for k in ("concept", "scenes", "rooms", "cameras", "climate", "tablet_room", "tab_bar")
               if k in args}
    return await read(caller, {"type": "hk_frontend/grid/starter", "options": options})


async def _stored_grid(caller, screen: str) -> tuple[dict, int]:
    got = await read(caller, {"type": "mantel/settings/get", "scope": "board", "key": screen})
    if not got.get("version"):
        raise ToolError("not_found", f"no screen {screen!r}", {"screen": "unknown"})
    grid = (got.get("body") or {}).get("home_grid")
    return (copy.deepcopy(grid) if isinstance(grid, dict) else None), int(got["version"])


def _grid_save(screen: str, grid: dict, version: int | None, style: bool = True) -> dict:
    changes: dict[str, Any] = {"home_grid": grid}
    if style:
        changes["home_style"] = "grid"
    msg = {"type": "hk_frontend/board/set", "dashboard": screen, "changes": changes}
    if version is not None:
        msg["expect_version"] = version
    return msg


async def grid_set(caller, args: dict) -> dict:
    msg = _grid_save(args["screen"], args["home_grid"], args.get("expect_version"), args.get("use_grid", True))
    return await change(caller, "grid_set", args, lambda: save(caller, msg))


async def grid_place(caller, args: dict) -> dict:
    block = dict(args["block"])
    if not isinstance(block.get("id"), str) or not ITEM_ID.match(block["id"]):
        raise ToolError("invalid_arguments", "block.id: 1-20 lowercase letters, digits, - or _", {"block.id": "invalid"})

    async def run():
        grid, version = await _stored_grid(caller, args["screen"])
        if grid is None:
            from hk_core.settings import home_grid as HG
            grid = {"v": HG.VERSION, "cols": 6, "rows": HG.ROWS_DEFAULT, "band": True, "items": []}
        items = [i for i in grid.get("items") or [] if i.get("id") != block["id"]]
        items.append(block)
        grid["items"] = items
        return await save(caller, _grid_save(args["screen"], grid, version))
    return await change(caller, "grid_place", args, run)


async def grid_remove(caller, args: dict) -> dict:
    async def run():
        grid, version = await _stored_grid(caller, args["screen"])
        items = (grid or {}).get("items") or []
        if not any(i.get("id") == args["block_id"] for i in items):
            raise ToolError("not_found", f"no block {args['block_id']!r} on {args['screen']}", {"block_id": "unknown"})
        grid["items"] = [i for i in items if i.get("id") != args["block_id"]]
        return await save(caller, _grid_save(args["screen"], grid, version, style=False))
    return await change(caller, "grid_remove", args, run)


SCREEN = {"type": "string", "maxLength": 80, "description": "the screen's address (screens_list)"}
GRID = {"type": "object", "description": "a Home Grid layout: {v: 1, cols, rows, band, items: [...]} (grid_cards)"}
BLOCK = {"type": "object", "description": "{id, card, size, at: [col, row], opts?, pages?, view?} (grid_cards)"}
TITLE = {"type": "string", "maxLength": 60, "minLength": 1}
TOOLS = [
    Tool("screens_list", "List screens",
         "Every screen: its address (key), title, who draws it (mantel / ha), Home Style (generated or grid), its "
         "version, and the wall tablets that open it.", {}, screens_list, idempotent=True),
    Tool("screen_get", "Read a screen",
         "One screen's settings as drawn, its Home Grid, the tablets on it and its version (for expect_version). "
         "`all_settings: true` gives every key.",
         {"screen": SCREEN, "all_settings": {"type": "boolean", "default": False}}, screen_get, required=("screen",)),
    Tool("screen_create", "Add a screen",
         "A new screen drawn by Mantel: a new screen's settings, or a copy of `copy_from`'s, with `settings` (board "
         "keys, settings_schema board) and a `home_grid` made at once. Its address comes from the title. Planned first.",
         {"title": TITLE, "copy_from": SCREEN, "where": {"type": "string", "enum": ["mantel"]},
          "settings": {"type": "object"}, "home_grid": GRID},
         screen_create, needs="screens", required=("title",), write=True),
    Tool("screen_rename", "Rename a screen", "A screen's title (its address stays). Planned first.",
         {"screen": SCREEN, "title": TITLE}, screen_rename, needs="screens", required=("screen", "title"), write=True),
    Tool("screen_move", "Who draws a screen",
         "mantel: Mantel draws it; ha: HK Frontend's dashboard of the same address in Home Assistant does (refused "
         "while wall tablets open it in Mantel). Planned first.",
         {"screen": SCREEN, "where": {"type": "string", "enum": ["mantel", "ha"]}}, screen_move, needs="screens",
         required=("screen", "where"), write=True),
    Tool("screen_remove", "Remove a screen",
         "Remove a screen no wall tablet opens (its history stays: settings_restore brings it back). Planned first.",
         {"screen": SCREEN}, screen_remove, needs="screens", required=("screen",), write=True, destructive=True),
    Tool("grid_cards", "Home Grid catalogue",
         "The Home Grid's cards: each card's sizes (S, W, T, L, XL, XXL, F as columns x rows), its options and the "
         "pages it can swipe through; the grid's columns and rows; the starters.", {}, grid_cards, idempotent=True),
    Tool("grid_starter", "A starter Home Grid",
         "A 6 x 4 layout to start from (concept A, C, R, M, S, F or Q), filled from the scenes, rooms (area ids), "
         "cameras and climate you give, for a tablet in `tablet_room`. It changes nothing: edit it, then grid_set.",
         {"concept": {"type": "string", "enum": ["A", "C", "R", "M", "S", "F", "Q"]},
          "scenes": {"type": "array", "items": {"type": "string"}}, "rooms": {"type": "array", "items": {"type": "string"}},
          "cameras": {"type": "array", "items": {"type": "string"}}, "climate": {"type": "array", "items": {"type": "string"}},
          "tablet_room": {"type": "string", "maxLength": 80}, "tab_bar": {"type": "boolean"}},
         grid_starter, needs="screens", required=("concept",)),
    Tool("grid_set", "Set a screen's Home Grid",
         "Write a screen's whole Home Grid layout (and make the screen use it: `use_grid`, default true). Checked "
         "block by block; a bad layout is refused with the reason (grid_overlap, grid_size, grid_place...). Planned "
         "first: the plan answer shows the layout as checked.",
         {"screen": SCREEN, "home_grid": GRID, "use_grid": {"type": "boolean", "default": True},
          "expect_version": {"type": "integer", "minimum": 0}},
         grid_set, needs="screens", required=("screen", "home_grid"), write=True),
    Tool("grid_place", "Place a Home Grid block",
         "Add one block to a screen's Home Grid, or move/resize the block with that id. Planned first.",
         {"screen": SCREEN, "block": BLOCK}, grid_place, needs="screens", required=("screen", "block"), write=True),
    Tool("grid_remove", "Remove a Home Grid block", "Take one block (by id) off a screen's Home Grid. Planned first.",
         {"screen": SCREEN, "block_id": {"type": "string", "maxLength": 20}}, grid_remove, needs="screens",
         required=("screen", "block_id"), write=True, destructive=True),
]
