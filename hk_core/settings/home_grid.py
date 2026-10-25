"""HOME GRID (docs/phase11/HOME-GRID.md): a screen's Home laid out on a grid of size classes, that never scrolls.

A screen's `home_style` is "generated" (Home as every screen builds it) or "grid", and its `home_grid` is the
layout: columns (6, 3 or 2) by rows (2-6), the frame the desktop editor draws it at, the top band, and the
blocks -- each a card from the Home Grid catalog, at a size that card has, at a cell, perhaps with pages that
swipe. The catalog is web/hk/cards/hk-grid-catalog.js; CATALOG here is its mirror (keys, sizes, page sources),
kept equal by a test, so a saved layout can't name a card HK doesn't have, a size it can't draw or a source it
can't page.

check() is the write's (changes.py): anything wrong is refused with a code the page words. layout() is the
read's (model.board()): a stored layout that no longer checks loses the blocks that don't, or is gone.
starter() fills a new layout from the house: concept A (Tap Weight) or C (Glance Up, Touch Down).
"""
from __future__ import annotations

import re
from typing import Any, Mapping

HOME_STYLES = ("generated", "grid")
VERSION = 1
COLS = (6, 3, 2)
ROWS = (2, 6)                      # the fewest and the most
ROWS_DEFAULT = 4
# The frame is the editor's preview viewport. Fixed 196 x 150 tile units fit
# uniformly into the real viewport, centered with spare room around them.
FRAME = (1280, 800)
FRAME_W = (320, 3840)
FRAME_H = (320, 2160)
ITEMS_MAX = 24
# VIEWS (2026-10-24, StandBy's): up to four whole layouts on one screen's grid, a swipe apart
VIEWS_MAX = 4
PAGES_MAX = 12
LIST_MAX = 24                      # the most things one option lists (a scenes block's scenes)
# \Z, not $: `$` also matches before a final newline ("light.x\n" passed .match). An entity id is at most 255
# characters, Home Assistant's own limit.
ITEM_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,19}\Z")
ENTITY_ID = re.compile(r"^(?=.{3,255}\Z)[a-z0-9_]+\.[a-z0-9_]+\Z")
AREA_ID = re.compile(r"^[a-z0-9_]{1,80}\Z")
# The tablet's own room, as an option's value: the Wall Tablets room of the tablet showing the screen. Stored
# and checked here; the cards resolve it (G3, G4).
TABLET_ROOM = "tablet_room"

# Size classes: (columns, rows)
SIZES: dict[str, tuple[int, int]] = {"S": (1, 1), "W": (2, 1), "T": (1, 2), "L": (2, 2), "XL": (3, 2), "XXL": (6, 2)}

# THE CATALOG'S MIRROR: key -> its sizes, the page sources it swipes through besides `list` (every card has
# `list`), and its options (name -> kind, OPTION_KINDS).
CATALOG: dict[str, dict[str, Any]] = {
    "accessory": {"sizes": ("S", "W"), "sources": (), "opts": {"entity": "entity", "secondary": "secondary"}},
    "accessories": {"sizes": ("W", "L", "XL", "XXL"), "sources": ("accessories",), "opts": {"accessories": "accessories", "title": "title", "surface": "surface"}},
    "scene": {"sizes": ("S", "W"), "sources": (), "opts": {"scene": "scene"}},
    "scenes": {"sizes": ("W", "L", "XL", "XXL"), "sources": ("scenes",), "opts": {"scenes": "scenes", "surface": "surface"}},
    "now_playing": {"sizes": ("W", "T", "L"), "sources": ("speakers",), "opts": {"speaker": "speaker"}},
    "thermostat": {"sizes": ("T", "L", "XL"), "sources": ("thermostats",), "opts": {"entity": "climate"}},
    "camera": {"sizes": ("W", "L", "XL"), "sources": ("cameras",),
               # follow (2026-10-24): swiping all cameras, turn to the one a selector or the latest motion picks
               "opts": {"entity": "camera", "follow": "camera_follow", "follow_select": "select"}},
    # Large and Extra Large (2026-10-24): the alarm's keypad
    "security": {"sizes": ("S", "W", "L", "XL"), "sources": (), "opts": {"entity": "alarm"}},
    "timers": {"sizes": ("S", "W"), "sources": (), "opts": {}},
    "weather": {"sizes": ("W", "T", "L", "XL"), "sources": (), "opts": {"entity": "weather", "sky": "boolean", "big": "boolean"}},
    "calendar": {"sizes": ("T", "L"), "sources": (), "opts": {"calendars": "calendars", "days": "days", "month": "boolean"}},
    "battery": {"sizes": ("S", "W"), "sources": (), "opts": {}},
    "people": {"sizes": ("W",), "sources": (), "opts": {}},
    # Large and Extra Large (2026-10-24): its controls with Clean Areas
    "vacuum": {"sizes": ("S", "W", "L", "XL"), "sources": (), "opts": {"entity": "vacuum"}},
    "clock": {"sizes": ("S", "W", "T", "L", "XL", "XXL"), "sources": (), "opts": {"clock_style": "clock_style", "bare": "boolean"}},
    "power": {"sizes": ("W", "L", "XL"), "sources": (), "opts": {}},
    "music": {"sizes": ("L", "XL"), "sources": (), "opts": {}},
    "doors": {"sizes": ("L", "XL"), "sources": (), "opts": {}},
    "live_tv": {"sizes": ("L", "XL"), "sources": (), "opts": {}},
    "water": {"sizes": ("L", "XL"), "sources": (), "opts": {}},
    # the new cards (G3)
    "room": {"sizes": ("W", "L", "XL", "XXL"), "sources": ("rooms",), "opts": {"area": "area", "surface": "surface", "accessory_display": "room_display"}},
    "scene_suggested": {"sizes": ("W", "L"), "sources": (), "opts": {"windows": "windows"}},
    # `area`: the room an action keeps to (All Lights Off in one room); the others ignore it
    "action": {"sizes": ("S",), "sources": (), "opts": {"action": "action", "area": "area"}},
    "everything": {"sizes": ("S",), "sources": (), "opts": {}},
}
SOURCES = ("list", "rooms", "cameras", "thermostats", "speakers", "scenes", "accessories")
# the sources that can open on the tablet's own room (or its speaker)
STARTS = ("rooms", "thermostats", "speakers")
# an action block's jobs, besides any scene or script
ACTIONS = ("lock_up", "lights_off", "garage")
# A suggested scene's time windows: at most this many, each {start, end, scene, label?}. Times are "HH:MM"; a
# window may run past midnight (22:00-05:00). Without windows the card uses its own (Morning, Day, Evening,
# Night), each finding its scene by name.
WINDOWS_MAX = 8
LABEL_MAX = 24
CLOCK = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]\Z")


class GridInvalid(ValueError):
    """A layout that can't be saved: `code` says why (changes.Invalid carries it to the page)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _domain(*domains: str, room: bool = False):
    def check(v: Any) -> str:
        if room and v == TABLET_ROOM:
            return v
        if not isinstance(v, str) or not ENTITY_ID.match(v) or (domains and v.split(".")[0] not in domains):
            raise GridInvalid("grid_option")
        return v
    return check


def _list(one):
    def check(v: Any) -> list[str]:
        if not isinstance(v, list) or not 0 < len(v) <= LIST_MAX:
            raise GridInvalid("grid_option")
        return list(dict.fromkeys(one(x) for x in v))
    return check


def _area(v: Any) -> str:
    if v == TABLET_ROOM or (isinstance(v, str) and AREA_ID.match(v)):
        return v
    raise GridInvalid("grid_option")


def _window(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or set(v) - {"start", "end", "scene", "label"}:
        raise GridInvalid("grid_option")
    start, end = v.get("start"), v.get("end")
    if not isinstance(start, str) or not CLOCK.match(start) or not isinstance(end, str) or not CLOCK.match(end) \
            or start == end:
        raise GridInvalid("grid_option")
    scene = v.get("scene")
    if not isinstance(scene, str) or not ENTITY_ID.match(scene) or scene.split(".")[0] not in ("scene", "script"):
        raise GridInvalid("grid_option")
    out = {"start": start, "end": end, "scene": scene}
    label = v.get("label")
    if label is not None:
        if not isinstance(label, str) or not 0 < len(label.strip()) <= LABEL_MAX:
            raise GridInvalid("grid_option")
        out["label"] = label.strip()
    return out


def _windows(v: Any) -> list[dict[str, str]]:
    if not isinstance(v, list) or not 0 < len(v) <= WINDOWS_MAX:
        raise GridInvalid("grid_option")
    return [_window(w) for w in v]


def _action(v: Any) -> str:
    if v in ACTIONS or (isinstance(v, str) and ENTITY_ID.match(v) and v.split(".")[0] in ("scene", "script")):
        return v
    raise GridInvalid("grid_option")


def _surface(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"color", "opacity", "blur"}:
        raise GridInvalid("grid_option")
    color, opacity, blur = v.get("color", "#808080"), v.get("opacity", 30), v.get("blur", "screen")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise GridInvalid("grid_option")
    if isinstance(opacity, bool) or not isinstance(opacity, int) or not 0 <= opacity <= 100:
        raise GridInvalid("grid_option")
    if blur not in ("screen", "none", "light", "medium", "heavy"):
        raise GridInvalid("grid_option")
    return {"color": color.lower(), "opacity": opacity, "blur": blur}


def _boolean(v: Any) -> bool:
    if not isinstance(v, bool):
        raise GridInvalid("grid_option")
    return v


def _title(v: Any) -> str:
    if not isinstance(v, str) or not 0 < len(v.strip()) <= 60:
        raise GridInvalid("grid_option")
    return v.strip()


def _secondary(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or set(v) - {"mode", "attribute", "unit"}:
        raise GridInvalid("grid_option")
    mode = v.get("mode")
    if mode not in ("auto", "state", "brightness", "attribute", "none"):
        raise GridInvalid("grid_option")
    out = {"mode": mode}
    if mode == "attribute":
        attribute = v.get("attribute")
        if not isinstance(attribute, str) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]{0,79}", attribute):
            raise GridInvalid("grid_option")
        out["attribute"] = attribute
        if "unit" in v:
            if not isinstance(v["unit"], str) or len(v["unit"]) > 20:
                raise GridInvalid("grid_option")
            out["unit"] = v["unit"]
    elif set(v) - {"mode"}:
        raise GridInvalid("grid_option")
    return out


def _accessories(v: Any) -> list[dict[str, Any]]:
    if not isinstance(v, list) or not 0 < len(v) <= LIST_MAX:
        raise GridInvalid("grid_option")
    out, seen = [], set()
    for entry in v:
        if not isinstance(entry, dict) or set(entry) - {"entity", "secondary"}:
            raise GridInvalid("grid_option")
        eid = _domain()(entry.get("entity"))
        if eid in seen:
            raise GridInvalid("grid_option")
        seen.add(eid)
        row = {"entity": eid}
        if "secondary" in entry:
            row["secondary"] = _secondary(entry["secondary"])
        out.append(row)
    return out


def _camera_follow(v: Any) -> str:
    if v not in ("selector", "motion"):
        raise GridInvalid("grid_option")
    return v


def _room_display(v: Any) -> str:
    if v not in ("summary", "scroll"):
        raise GridInvalid("grid_option")
    return v


# a Clock block's face (hk-grid-catalog.js CLOCK_FACES; "" is HK's own clock, stored as no option)
CLOCK_FACES = ("analog", "classic", "serif", "flip", "lcd", "neon", "nixie", "dots", "arc")


def _clock_style(v: Any) -> str:
    if v not in CLOCK_FACES:
        raise GridInvalid("grid_option")
    return v


OPTION_KINDS = {
    "room_display": _room_display,
    "clock_style": _clock_style,
    "camera_follow": _camera_follow,
    "select": _domain("input_select", "select"),
    "boolean": _boolean,
    "title": _title,
    "secondary": _secondary,
    "accessories": _accessories,
    "entity": _domain(),
    "scene": _domain("scene"),
    "scenes": _list(_domain("scene")),
    "speaker": _domain("media_player", room=True),
    "climate": _domain("climate", room=True),
    "alarm": _domain("alarm_control_panel"),
    "camera": _domain("camera"),
    "weather": _domain("weather"),
    "vacuum": _domain("vacuum"),
    "calendars": _list(_domain("calendar")),
    "days": lambda v: _whole(v, 1, 7, "grid_option"),
    "area": _area,
    "action": _action,
    "windows": _windows,
    "surface": _surface,
}


def _whole(v: Any, lo: int, hi: int, code: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise GridInvalid(code)
    return v


def _opts(card: str, v: Any) -> dict[str, Any]:
    if v is None:
        return {}
    kinds = CATALOG[card]["opts"]
    if not isinstance(v, dict) or set(v) - set(kinds):
        raise GridInvalid("grid_option")
    return {k: OPTION_KINDS[kinds[k]](x) for k, x in v.items()}


def _pages(card: str, v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"source", "start", "list"}:
        raise GridInvalid("grid_pages")
    src = v.get("source")
    if src not in SOURCES:
        raise GridInvalid("grid_pages")
    if src != "list" and src not in CATALOG[card]["sources"]:
        raise GridInvalid("grid_source")
    out: dict[str, Any] = {"source": src}
    if v.get("start") is not None:
        if v["start"] != TABLET_ROOM or src not in STARTS:
            raise GridInvalid("grid_pages")
        out["start"] = TABLET_ROOM
    if src == "list":
        pages = v.get("list")
        if not isinstance(pages, list) or not 1 <= len(pages) <= PAGES_MAX:
            raise GridInvalid("grid_pages")
        out["list"] = []
        for p in pages:
            if not isinstance(p, dict) or set(p) - {"opts"}:
                raise GridInvalid("grid_pages")
            out["list"].append({"opts": _opts(card, p.get("opts"))})
    elif "list" in v:
        raise GridInvalid("grid_pages")
    return out


# The frontend mirrors these named, bounded conditions; no templates or executable expressions.
# "time" (2026-10-24): from "HH:MM" until "HH:MM" in the house's zone, past midnight too; "alarm_disarmed": the
# alarm (the condition's, else the house's) is disarmed.
CONDITIONS = ("music_playing", "timer_running", "alarm_armed", "alarm_disarmed", "doorbell", "after_sunset",
              "entity_state", "time")
# A BLOCK'S RULES (2026-10-24, the owner: "a default card, and certain cards in the same slot when a condition is
# met"): the block's own card by default, and up to RULES_MAX rules, each its card when ALL of its conditions (up to
# ALL_MAX) hold -- the first rule that matches wins. A block's older `when` + `fallback` still reads.
RULES_MAX = 4
ALL_MAX = 3


def condition(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or set(v) - {"kind", "entity", "state", "from", "to"} or v.get("kind") not in CONDITIONS:
        raise GridInvalid("grid_condition")
    kind = v["kind"]
    out = {"kind": kind}
    if "entity" in v:
        if kind == "time":
            raise GridInvalid("grid_condition")
        out["entity"] = _domain()(v["entity"])
    if kind == "entity_state":
        if "entity" not in out or not isinstance(v.get("state"), str) or not 0 < len(v["state"]) <= 80:
            raise GridInvalid("grid_condition")
        out["state"] = v["state"]
    elif "state" in v:
        raise GridInvalid("grid_condition")
    if kind == "time":
        start, end = v.get("from"), v.get("to")
        if not (isinstance(start, str) and CLOCK.match(start) and isinstance(end, str) and CLOCK.match(end)) or start == end:
            raise GridInvalid("grid_condition")
        out["from"], out["to"] = start, end
    elif "from" in v or "to" in v:
        raise GridInvalid("grid_condition")
    return out


def conditions(v: Any) -> dict[str, list[dict[str, str]]]:
    """A rule's conditions, all of which must hold: {"all": [condition, ...]} (a single condition reads as one)."""
    if isinstance(v, dict) and "all" in v:
        if set(v) != {"all"} or not isinstance(v["all"], list) or not 0 < len(v["all"]) <= ALL_MAX:
            raise GridInvalid("grid_condition")
        return {"all": [condition(c) for c in v["all"]]}
    return {"all": [condition(v)]}


def rules(v: Any, size: str) -> list[dict[str, Any]]:
    """A block's rules: each {when, card, opts?, pages?}, its card coming in the block's size."""
    if not isinstance(v, list) or not 0 < len(v) <= RULES_MAX:
        raise GridInvalid("grid_condition")
    out = []
    for r in v:
        if not isinstance(r, dict) or "when" not in r:
            raise GridInvalid("grid_condition")
        got = variant({k: x for k, x in r.items() if k != "when"}, size)
        out.append({"when": conditions(r["when"]), **got})
    return out


def _capacity(v: Mapping[str, Any], size: str) -> None:
    if v.get("card") != "accessories":
        return
    per = {"W": 2, "L": 4, "XL": 6, "XXL": 12}[size]
    base = v.get("opts", {}).get("accessories", [])
    pages = v.get("pages", {})
    if pages.get("source") == "accessories":
        return
    sets = [p.get("opts", {}).get("accessories", base) for p in pages.get("list", [])] or [base]
    if any(len(entries) > per for entries in sets):
        raise GridInvalid("grid_option")


def variant(v: Any, size: str) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"card", "opts", "pages"}:
        raise GridInvalid("grid_fallback")
    card = v.get("card")
    if not isinstance(card, str) or card not in CATALOG or size not in CATALOG[card]["sizes"]:
        raise GridInvalid("grid_fallback")
    out = {"card": card}
    opts = _opts(card, v.get("opts"))
    if opts:
        out["opts"] = opts
    if v.get("pages") is not None:
        out["pages"] = _pages(card, v["pages"])
    _capacity(out, size)
    return out


def item(v: Any, cols: int, rows: int) -> dict[str, Any]:
    """One block, checked against a grid of `cols` x `rows` (its place, not its neighbours)."""
    if not isinstance(v, dict) or set(v) - {"id", "card", "size", "at", "opts", "pages", "when", "fallback", "rules", "bare", "view"}:
        raise GridInvalid("grid_item")
    if not isinstance(v.get("id"), str) or not ITEM_ID.match(v["id"]):
        raise GridInvalid("grid_item")
    card = v.get("card")
    if not isinstance(card, str) or card not in CATALOG:     # a list or an object is no name (and isn't hashable)
        raise GridInvalid("grid_card")
    size = v.get("size")
    if size not in CATALOG[card]["sizes"]:
        raise GridInvalid("grid_size")
    w, h = SIZES[size]
    if w > cols or h > rows:
        raise GridInvalid("grid_fit")
    at = v.get("at")
    if not isinstance(at, list) or len(at) != 2:
        raise GridInvalid("grid_place")
    c, r = (_whole(x, 0, 99, "grid_place") for x in at)
    if c + w > cols or r + h > rows:
        raise GridInvalid("grid_place")
    out = {"id": v["id"], "card": card, "size": size, "at": [c, r]}
    opts = _opts(card, v.get("opts"))
    if opts:
        out["opts"] = opts
    if v.get("pages") is not None:
        out["pages"] = _pages(card, v["pages"])
    if v.get("when") is not None:
        out["when"] = condition(v["when"])
        out["fallback"] = variant(v.get("fallback"), size)
    elif "fallback" in v:
        raise GridInvalid("grid_condition")
    if v.get("rules") is not None:
        if "when" in out:                         # one way or the other, never both
            raise GridInvalid("grid_condition")
        out["rules"] = rules(v["rules"], size)
    # VIEWS (2026-10-24): the screen's view the block is in, 0 (the first) unless it says
    if "view" in v:
        view = _whole(v["view"], 0, VIEWS_MAX - 1, "grid_item")
        if view:
            out["view"] = view
    # HIDE BOX (2026-10-24): the block's card without its plate, on the background
    if "bare" in v:
        if not isinstance(v["bare"], bool):
            raise GridInvalid("grid_option")
        if v["bare"]:
            out["bare"] = True
    _capacity(out, size)
    return out


def cells(it: Mapping[str, Any]) -> set[tuple[int, int, int]]:
    """The cells a checked block covers, in its view (blocks overlap only within one)."""
    (c, r), (w, h), view = it["at"], SIZES[it["size"]], it.get("view", 0)
    return {(view, c + x, r + y) for x in range(w) for y in range(h)}


def _frame(v: Any) -> list[int]:
    if v is None:
        return list(FRAME)
    if not isinstance(v, list) or len(v) != 2:
        raise GridInvalid("grid_frame")
    return [_whole(v[0], *FRAME_W, "grid_frame"), _whole(v[1], *FRAME_H, "grid_frame")]


NIGHT_MODES = ("off", "night", "always")


def _night(v: Any) -> dict[str, Any]:
    """NIGHT MODE (2026-10-24, StandBy's): the screen one dim red -- "night" between `from` and `to` (across
    midnight), or "always"."""
    if not isinstance(v, dict) or set(v) - {"mode", "from", "to"} or v.get("mode") not in NIGHT_MODES:
        raise GridInvalid("grid")
    out: dict[str, Any] = {"mode": v["mode"]}
    for key, default in (("from", "22:00"), ("to", "07:00")):
        t = v.get(key, default)
        if not isinstance(t, str) or not CLOCK.match(t):
            raise GridInvalid("grid")
        out[key] = t
    if out["from"] == out["to"]:
        raise GridInvalid("grid")
    return out


def _shape(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"v", "cols", "rows", "frame", "band", "header_clock", "header_weather", "scale", "boxes", "grow",
                                              "night", "views", "items"}:
        raise GridInvalid("grid")
    ver = v.get("v", VERSION)
    if type(ver) is not int or ver != VERSION:         # not True, not 1.0: == alone takes both
        raise GridInvalid("grid")
    cols = v.get("cols", COLS[0])
    if type(cols) is not int or cols not in COLS:
        raise GridInvalid("grid_cols")
    rows = _whole(v.get("rows", ROWS_DEFAULT), *ROWS, "grid_rows")
    band = v.get("band", True)
    if not isinstance(band, bool):
        raise GridInvalid("grid")
    items = v.get("items", [])
    if not isinstance(items, list):
        raise GridInvalid("grid")
    if len(items) > ITEMS_MAX:
        raise GridInvalid("grid_items")
    out = {"v": VERSION, "cols": cols, "rows": rows, "frame": _frame(v.get("frame")), "band": band,
           "items": items}
    if "scale" in v:
        out["scale"] = _whole(v["scale"], 50, 100, "grid")
    if "night" in v:
        out["night"] = _night(v["night"])
    if "views" in v:
        views = _whole(v["views"], 1, VIEWS_MAX, "grid")
        if views > 1:
            out["views"] = views
    # boxes: False -- every block without its plate (Hide Box, the screen's); grow: True -- the grid may scale past
    # its own size to fill the screen (a phone on its side)
    for key in ("header_clock", "header_weather", "boxes", "grow"):
        if key in v:
            if not isinstance(v[key], bool):
                raise GridInvalid("grid")
            out[key] = v[key]
    return out


def check(v: Any) -> dict[str, Any] | None:
    """A layout as written (None: no layout), every part checked, or GridInvalid."""
    if v is None:
        return None
    out = _shape(v)
    taken: set[tuple[int, int]] = set()
    ids: set[str] = set()
    items = []
    for raw in out["items"]:
        it = item(raw, out["cols"], out["rows"])
        if it["id"] in ids or it.get("view", 0) >= out.get("views", 1):
            raise GridInvalid("grid_item")
        here = cells(it)
        if here & taken:
            raise GridInvalid("grid_overlap")
        ids.add(it["id"])
        taken |= here
        items.append(it)
    out["items"] = items
    return out


def layout(v: Any) -> dict[str, Any] | None:
    """A layout as READ: what is stored can predate a change to the catalog. A block that no longer checks is
    left out (and one that overlaps a block before it); a grid that doesn't is no layout."""
    if v is None:
        return None
    try:
        out = _shape(v)
    except (GridInvalid, TypeError, KeyError):      # read, never raise: one stored screen never stops every feed
        return None
    taken: set[tuple[int, int]] = set()
    ids: set[str] = set()
    items = []
    for raw in out["items"]:
        try:
            it = item(raw, out["cols"], out["rows"])
        except (GridInvalid, TypeError, KeyError):
            continue
        here = cells(it)
        if it["id"] in ids or here & taken or it.get("view", 0) >= out.get("views", 1):
            continue
        ids.add(it["id"])
        taken |= here
        items.append(it)
    out["items"] = items
    return out


# ------------------------------------------------------------ the starter layouts
# A Tap Weight, C Glance Up, Touch Down, R Room Focus, M Music & Scenes, S Security & Cameras, F Family Hub,
# Q Essentials (the editor's names and descriptions: hk-grid-editor.js STARTERS)
STARTERS = ("A", "C", "R", "M", "S", "F", "Q")


def _chunks(xs: list[str], n: int) -> list[list[str]]:
    return [xs[i:i + n] for i in range(0, len(xs), n)][:PAGES_MAX]


def _scenes_block(iid: str, size: str, at: list[int], scenes: list[str]) -> dict[str, Any]:
    """A scenes block holding the house's scenes: one page of them, or pages that swipe."""
    per = {"W": 2, "L": 4, "XL": 6, "XXL": 12}[size]
    pages = _chunks(scenes[:LIST_MAX * PAGES_MAX], per)
    out: dict[str, Any] = {"id": iid, "card": "scenes", "size": size, "at": at}
    if len(pages) == 1:
        out["opts"] = {"scenes": pages[0]}
    else:
        out["pages"] = {"source": "list", "list": [{"opts": {"scenes": p}} for p in pages]}
    return out


def starter(concept: str, scenes: list[str] | None = None, rooms: list[str] | None = None,
            cameras: list[str] | None = None, climate: list[str] | None = None,
            tablet_room: str | None = None, tab_bar: bool = True) -> dict[str, Any]:
    """A 6 x 4 layout to start from, filled from the house: its scenes, rooms (area ids, in the screen's order),
    cameras and climate entities, and the room of the tablet it is for (None: no tablet yet -- the blocks open
    on their first page). A block with nothing in the house to show is left out. `tab_bar`: the screen shows its
    tab bar, which already opens the pages and the menu -- so no Everything block (an All Lights Off in its place).

    A, Tap Weight: what is tapped most is biggest -- the scene for the time of day, the tablet's room and its
    speaker across the top; scenes, cameras, the thermostat, timers and one-tap jobs below; the top band on.
    C, Glance Up, Touch Down: the glance cards (clock, weather, timers, security) along the top in place of the
    band; the room, thermostat and cameras in the middle; scenes, the speaker and one-tap jobs at the bottom,
    where a hand reaches.
    R, Room Focus: the tablet's room large, its thermostat and speaker beside it; scenes and a camera below.
    M, Music & Scenes: the speaker, the scenes and the scene for the time of day across the top; the room,
    climate and weather below.
    S, Security & Cameras: the cameras large, the alarm, who's home, Lock Up and the garage beside them; the
    room, scenes and the speaker below.
    F, Family Hub: the clock, weather and who's home along the top in place of the band; the calendar, the room
    and the speaker; scenes and one-tap jobs at the bottom.
    Q, Essentials: a calm few -- the scene for now, the room and its thermostat; scenes and the weather."""
    if concept not in STARTERS:
        raise GridInvalid("grid")
    scenes = [s for s in (scenes or []) if ENTITY_ID.match(s) and s.startswith("scene.")]
    rooms = [r for r in (rooms or []) if AREA_ID.match(r)]
    cameras = [c for c in (cameras or []) if ENTITY_ID.match(c) and c.startswith("camera.")]
    climate = [c for c in (climate or []) if ENTITY_ID.match(c) and c.startswith("climate.")]
    here = bool(tablet_room)
    p = concept.lower()
    items: list[dict[str, Any]] = []

    def add(card: str, size: str, at: list[int], **more: Any) -> None:
        items.append({"id": f"{p}{len(items) + 1}", "card": card, "size": size, "at": at, **more})

    def room(size: str, at: list[int]) -> None:
        # a new room block scrolls through all its accessories (the owner's choice, 2026-10-24)
        if rooms:
            add("room", size, at, opts={"accessory_display": "scroll"},
                pages={"source": "rooms", **({"start": TABLET_ROOM} if here else {})})

    def speaker(size: str, at: list[int]) -> None:
        add("now_playing", size, at, **({"opts": {"speaker": TABLET_ROOM}} if here else {}))

    def thermostat(at: list[int]) -> None:
        if climate:
            add("thermostat", "T", at, pages={"source": "thermostats", **({"start": TABLET_ROOM} if here else {})})

    def camera(size: str, at: list[int]) -> None:
        if cameras:
            add("camera", size, at, pages={"source": "cameras"})

    def everything(at: list[int]) -> None:
        if tab_bar:
            add("action", "S", at, opts={"action": "lights_off"})
        else:
            add("everything", "S", at)

    def scene_row(size: str, at: list[int]) -> None:
        if scenes:
            b = _scenes_block(f"{p}{len(items) + 1}", size, at, scenes)
            items.append(b)

    if concept == "A":
        if scenes:
            add("scene_suggested", "L", [0, 0])
        room("L", [2, 0])
        speaker("L", [4, 0])
        scene_row("W", [0, 2])
        camera("L", [2, 2])
        thermostat([4, 2])
        add("timers", "S", [5, 2])
        add("security", "S", [0, 3])
        everything([1, 3])
        add("action", "S", [5, 3], opts={"action": "lock_up"})
        band = True
    elif concept == "R":
        room("XL", [0, 0])
        thermostat([3, 0])
        speaker("T", [4, 0])
        add("timers", "S", [5, 0])
        add("action", "S", [5, 1], opts={"action": "lock_up"})
        scene_row("XL", [0, 2])
        camera("L", [3, 2])
        add("security", "S", [5, 2])
        everything([5, 3])
        band = True
    elif concept == "M":
        speaker("L", [0, 0])
        scene_row("L", [2, 0])
        if scenes:
            add("scene_suggested", "L", [4, 0])
        room("L", [0, 2])
        thermostat([2, 2])
        add("timers", "S", [3, 2])
        everything([3, 3])
        add("weather", "L", [4, 2])
        band = True
    elif concept == "S":
        camera("XL", [0, 0])
        add("security", "W", [3, 0])
        add("action", "S", [5, 0], opts={"action": "lock_up"})
        add("people", "W", [3, 1])
        add("action", "S", [5, 1], opts={"action": "garage"})
        room("L", [0, 2])
        scene_row("L", [2, 2])
        speaker("W", [4, 2])
        add("timers", "S", [4, 3])
        everything([5, 3])
        band = True
    elif concept == "F":
        add("clock", "W", [0, 0])
        add("weather", "W", [2, 0])
        add("people", "W", [4, 0])
        add("calendar", "L", [0, 1])
        room("L", [2, 1])
        speaker("L", [4, 1])
        scene_row("W", [0, 3])
        add("timers", "S", [2, 3])
        add("security", "S", [3, 3])
        add("action", "S", [4, 3], opts={"action": "lock_up"})
        everything([5, 3])
        band = False
    elif concept == "Q":
        if scenes:
            add("scene_suggested", "L", [0, 0])
        room("XL", [2, 0])
        thermostat([5, 0])
        scene_row("XL", [0, 2])
        add("weather", "L", [3, 2])
        add("timers", "S", [5, 2])
        everything([5, 3])
        band = True
    else:
        add("clock", "W", [0, 0])
        add("weather", "W", [2, 0])
        add("timers", "S", [4, 0])
        add("security", "S", [5, 0])
        room("XL", [0, 1])
        thermostat([3, 1])
        camera("L", [4, 1])
        scene_row("W", [0, 3])
        speaker("W", [2, 3])
        add("action", "S", [4, 3], opts={"action": "lock_up"})
        everything([5, 3])
        band = False
    out = check({"v": VERSION, "cols": 6, "rows": ROWS_DEFAULT, "frame": list(FRAME), "band": band,
                 "items": items})
    assert out is not None
    return out


def starter_request(data: Any) -> dict[str, Any]:
    """Read-only editor request. Both hosts use this bounded, checked input."""
    if not isinstance(data, dict) or set(data) - {"concept", "scenes", "rooms", "cameras", "climate", "tablet_room", "tab_bar"}:
        raise GridInvalid("grid")
    if data.get("concept") not in STARTERS or not isinstance(data.get("tab_bar", True), bool):
        raise GridInvalid("grid")
    for key, one in (("scenes", _domain("scene")), ("rooms", _area),
                     ("cameras", _domain("camera")), ("climate", _domain("climate"))):
        values = data.get(key, [])
        if not isinstance(values, list) or len(values) > 512:
            raise GridInvalid("grid_option")
        for value in values:
            one(value)
    if data.get("tablet_room") is not None:
        _area(data["tablet_room"])
    return starter(**data)
