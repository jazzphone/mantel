"""THE SCREENSAVER'S LAYOUT (docs/phase12/SCREENSAVER-EDITOR.md): one background, one big element, widgets in zones.

A screensaver's `layout` option (model.SAVER_DEFAULTS) is None -- the screensaver draws as each Show always has --
or a layout the Screensaver editor saved: the big element (the time, the temperature, the date, the month or none),
its size, place and depth, and the widgets in each zone. The background is not here: it stays in the options it has
always been (show, clock_bg, the photo and forecast keys), and so do the time's face, colors and 24-hour time.

The widget catalog is web/hk/modules/hk-saverlayout.js; CATALOG here is its mirror (ids and kinds), and ZONES its
zones, kept equal by a test, so a saved layout can't name a widget HK doesn't have or put one where it can't go.

check() is the write's (model.saver_options): anything wrong is refused. layout() is the read's: a stored layout
that no longer checks loses what doesn't (a widget this build doesn't know, one over a zone's room), or is gone.
"""
from __future__ import annotations

from typing import Any

VERSION = 1

# [id] -> kind. circular: one unit of the row under the big element; rectangular: two; inline: a line of text;
# card: a corner's; band: along the bottom
CATALOG: dict[str, str] = {
    "temp": "circular", "aqi": "circular", "humidity": "circular", "inside": "circular", "battery": "circular",
    "solar": "circular", "timer": "circular", "locks": "circular", "sunset": "circular",
    "next_event": "rectangular", "next_hours": "rectangular", "home_status": "rectangular", "energy_today": "rectangular",
    "date": "inline", "weather_line": "inline", "status_line": "inline", "event_line": "inline", "photo_title": "inline",
    "clock_card": "card", "music_card": "card", "timers_card": "card", "weather_card": "card", "status_card": "card",
    "forecast_band": "band", "readings": "band",
}
# [zone] -> (the kinds it takes, its room). The row's room is in units: a circular widget is one, a rectangular two.
# The pane down the side is the Side Pane's, with settings of its own: not a zone.
ZONES: dict[str, tuple[tuple[str, ...], int]] = {
    "line": (("inline",), 1),
    # (two lines of four units: the owner, 2026-11-01, "I should be able to put more than one")
    "row": (("circular", "rectangular"), 8),
    # (two each: today's top left holds the clock over the weather; a third would never fit beside a big time)
    "tl": (("card", "inline"), 2), "tr": (("card", "inline"), 2),
    "bl": (("card",), 2), "br": (("card",), 2),
    "bottom": (("band",), 1),
}
UNITS = {"rectangular": 2}

BIG_KINDS = ("time", "temp", "date", "month", "none")
BIG_SIZE = (12, 44)                     # % of the screen's shorter side
BIG_POS = ("top", "upper", "center", "lower", "ground")
BIG_ALIGN = ("left", "center", "right")
BIG_DEPTH = ("front", "behind", "planted")
BIG_DEFAULT = {"kind": "time", "size": 24, "pos": "top", "align": "center", "depth": "front"}

BACKS = ("none", "glass", "tint")
COLORS = ("auto", "white", "accent")
# a widget's or a card's own size, % of its usual (2026-11-01, the owner: "Lots of options for users on size and
# scale... around all the elements"); stored only when it isn't 100
ITEM_SIZE = (60, 160)
# where the row of widgets goes: under the big element, or along the bottom of the screen (the owner: "I may want it
# all the way at the bottom and not below the clock... as that tends to be where faces are in pictures")
ROW_AT = ("under", "bottom")


class LayoutInvalid(ValueError):
    """A layout refused on write; `code` is what the page words."""

    def __init__(self, code: str = "saver_layout") -> None:
        super().__init__(code)
        self.code = code


def _int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _big(v: Any, strict: bool) -> dict[str, Any]:
    out = dict(BIG_DEFAULT)
    if not isinstance(v, dict):
        if strict:
            raise LayoutInvalid()
        return out
    for k, val in v.items():
        ok = (k == "kind" and val in BIG_KINDS) or (k == "pos" and val in BIG_POS) or \
             (k == "align" and val in BIG_ALIGN) or (k == "depth" and val in BIG_DEPTH) or \
             (k == "size" and _int(val) and BIG_SIZE[0] <= val <= BIG_SIZE[1])
        if ok:
            out[k] = val
        elif strict:
            raise LayoutInvalid()
    return out


def _widget(v: Any, strict: bool) -> dict[str, Any] | None:
    if not isinstance(v, dict) or v.get("id") not in CATALOG:
        if strict:
            raise LayoutInvalid()
        return None
    out: dict[str, Any] = {"id": v["id"], "back": "none", "color": "auto"}
    for k, val in v.items():
        if k == "id":
            continue
        if (k == "back" and val in BACKS) or (k == "color" and val in COLORS):
            out[k] = val
        elif k == "size" and _int(val) and ITEM_SIZE[0] <= val <= ITEM_SIZE[1]:
            if val != 100:
                out[k] = val
        elif strict:
            raise LayoutInvalid()
    return out


def _zones(v: Any, strict: bool) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {z: [] for z in ZONES}
    if not isinstance(v, dict):
        if strict:
            raise LayoutInvalid()
        return out
    for z, items in v.items():
        if z not in ZONES or not isinstance(items, list):
            if strict:
                raise LayoutInvalid()
            continue
        takes, room = ZONES[z]
        used = 0
        for it in items:
            w = _widget(it, strict)
            if w is None:
                continue
            kind = CATALOG[w["id"]]
            need = UNITS.get(kind, 1)
            if kind not in takes or used + need > room:
                if strict:
                    raise LayoutInvalid()
                continue
            used += need
            out[z].append(w)
    return out


def _upright(v: Any, strict: bool) -> dict[str, Any] | None:
    if v is None:
        return None
    if not isinstance(v, dict) or any(k not in ("big", "zones", "row_at") for k in v):
        if strict:
            raise LayoutInvalid()
        return None
    out: dict[str, Any] = {}
    if "big" in v:
        out["big"] = _big(v["big"], strict)
    if "zones" in v:
        out["zones"] = _zones(v["zones"], strict)
    if "row_at" in v:
        out["row_at"] = _row_at(v["row_at"], strict)
    return out


def _row_at(v: Any, strict: bool) -> str:
    if v in ROW_AT:
        return v
    if strict:
        raise LayoutInvalid()
    return ROW_AT[0]


def _layout(v: Any, strict: bool) -> dict[str, Any] | None:
    if not isinstance(v, dict) or v.get("v") != VERSION or isinstance(v.get("v"), bool):
        if strict:
            raise LayoutInvalid()
        return None
    if strict and any(k not in ("v", "big", "zones", "row_at", "upright") for k in v):
        raise LayoutInvalid()
    return {"v": VERSION, "big": _big(v.get("big", {}), strict), "zones": _zones(v.get("zones", {}), strict),
            "row_at": _row_at(v.get("row_at", ROW_AT[0]), strict), "upright": _upright(v.get("upright"), strict)}


def check(v: Any) -> dict[str, Any] | None:
    """The layout as it is stored, or None for none (the screensaver as each Show draws it); LayoutInvalid if it
    can't be used."""
    if v is None:
        return None
    return _layout(v, True)


def layout(v: Any) -> dict[str, Any] | None:
    """A stored layout as this build can draw it: what it doesn't know is left out; None if nothing of it is left."""
    return _layout(v, False)
