"""THE SCREENSAVER'S LAYOUT (docs/phase12/SCREENSAVER-EDITOR.md): one background, one big element, widgets in zones.

A screensaver's `layout` option (model.SAVER_DEFAULTS) is None -- the screensaver draws as each Show always has --
or a layout the Screensaver editor saved: the big element (the time, the temperature, the date, the month or none),
its size, place and depth, and the pieces in each zone (v2, phase 13: docs/phase13/PIECES-SPEC.md -- a piece in a
shape, the row's one size, the screen's one ink, the accents). The background is not here: it stays in the options it
has always been (show, clock_bg, the photo and forecast keys), and so do the time's face, colors and 24-hour time.

The pieces' catalog is web/hk/modules/hk-saverlayout.js; PIECES here is its mirror (pieces, shapes and options), and
ZONES and V1 its zones and the first layouts' widgets, kept equal by a test, so a saved layout can't name a piece HK
doesn't have or put one where it can't go. A v1 layout (2026-11-01) is read, and written, as v2.

check() is the write's (model.saver_options): anything wrong is refused. layout() is the read's: a stored layout
that no longer checks loses what doesn't (a widget this build doesn't know, one over a zone's room), or is gone.
"""
from __future__ import annotations

import re
from typing import Any

VERSION = 2

# Any Sensor's entities: what a wall tablet can show as a state
ANY_ENTITY = "entity:sensor,binary_sensor,input_number,number,input_boolean,switch,climate,lock,cover,device_tracker"
# World Clock's cities (IANA), its city and city2
CITIES: tuple[str, ...] = (
    "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Madrid", "Europe/Athens",
    "Europe/Istanbul", "Europe/Moscow", "Africa/Cairo", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata",
    "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
    "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles",
    "America/Denver", "America/Chicago", "America/New_York", "America/Toronto", "America/Mexico_City",
    "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "Atlantic/Reykjavik",
)
# THE PIECES (2026-11-02, phase 13: docs/phase13/PIECES-SPEC.md): one per fact, each in a few shapes, drawn by one
# renderer (web/hk/modules/hk-saverwidgets.js). [piece] -> (its shapes, its options: {key: choices, or "text" -- 1 to
# 40 characters -- or "entity:<domain>,<domain>" -- one entity of those domains}). A shape is where
# it can go: inline, a line of words; circular, one unit of the row; rectangular, two; card, a corner's; band, along
# the bottom.
PIECES: dict[str, tuple[tuple[str, ...], dict[str, tuple[str, ...]]]] = {
    "weather": (("inline", "circular", "rectangular", "card", "band"), {}),
    "readings": (("circular", "rectangular", "band"), {"reading": ("humidity", "aqi", "inside", "sunset", "wind")}),
    "date": (("inline",), {}),
    "time": (("inline", "card"), {}),
    "status": (("inline", "circular", "rectangular", "card"), {}),
    "music": (("inline", "card"), {}),
    "timers": (("circular", "card"), {}),
    "events": (("inline", "rectangular", "card"), {}),
    "energy": (("circular", "rectangular"), {"reading": ("battery", "solar")}),
    "title": (("inline",), {}),
    # THE GLANCE CATALOG (phase 1b, docs/phase13/GLANCE-SPEC.md), wave A: data the screensaver already reads
    "countdown": (("inline", "circular"), {"match": "text"}),
    "world": (("inline", "circular", "rectangular"), {"city": CITIES, "city2": CITIES}),
    "rain": (("inline", "circular", "rectangular"), {}),
    "alert": (("inline", "card"), {}),
    "uv": (("circular",), {}),
    "wind": (("circular",), {}),
    "pressure": (("circular",), {}),
    "feels": (("circular",), {}),
    "moon": (("inline", "circular"), {}),
    "sun": (("inline", "circular", "rectangular"), {}),
    # wave B: data HK reads on its other pages
    "security": (("inline", "circular"), {}),
    "doors": (("inline", "circular", "rectangular"), {"when": ("always", "open")}),
    "garage": (("inline", "circular"), {"when": ("always", "open")}),
    "climate": (("inline", "circular", "rectangular"), {}),
    "lights": (("inline", "circular"), {}),
    "vacuum": (("inline", "circular"), {}),
    "notify": (("inline", "circular", "rectangular"), {}),
    "package": (("inline", "circular"), {}),
    "who": (("inline", "circular", "rectangular"), {"person": "entity:person"}),
    "grid": (("inline", "circular"), {}),
    "ev": (("inline", "circular"), {}),
    "upnext": (("inline", "rectangular"), {}),
    "playin": (("inline",), {}),
    "thisday": (("inline",), {}),
    "camera": (("rectangular", "card"), {"camera": "entity:camera"}),
    "ring": (("inline", "card"), {}),
    # wave C: one entity picked, with a suggested default
    "alarm": (("inline", "circular"), {"entity": "entity:sensor"}),
    "trash": (("inline", "circular"), {"entity": "entity:calendar,sensor"}),
    "pollen": (("inline", "circular"), {"entity": "entity:sensor"}),
    "appliance": (("inline", "circular", "rectangular"), {"entity": "entity:sensor,binary_sensor", "entity2": "entity:sensor,binary_sensor"}),
    "leak": (("inline", "card"), {}),
    "travel": (("inline", "circular", "rectangular"), {"entity": "entity:sensor", "entity2": "entity:sensor"}),
    "price": (("inline",), {"entity": "entity:sensor,input_number,number"}),
    "sensor": (("inline", "circular", "rectangular"), {"entity": ANY_ENTITY, "entity2": ANY_ENTITY, "name": "text", "min": "text", "max": "text"}),
}
SHAPES = ("inline", "circular", "rectangular", "card", "band")
# [zone] -> (the shapes it takes, its room). The row's room is in units: a circular piece is one, a rectangular two,
# times its size. The pane down the side is the Side Pane's, with settings of its own: not a zone.
ZONES: dict[str, tuple[tuple[str, ...], int]] = {
    "line": (("inline",), 1),
    # (two lines of four units: the owner, 2026-11-01, "I should be able to put more than one")
    "row": (("circular", "rectangular"), 8),
    # (two each: today's top left holds the clock over the weather; a third would never fit beside a big time)
    "tl": (("card", "inline"), 2), "tr": (("card", "inline"), 2),
    "bl": (("card", "inline"), 2), "br": (("card", "inline"), 2),
    "bottom": (("band",), 1),
}
UNITS = {"rectangular": 2}

# THE FIRST LAYOUTS' WIDGETS (v1, 2026-11-01), each a piece in a shape now: the read takes a v1 layout as v2
V1: dict[str, tuple[str, str, dict[str, str]]] = {
    "temp": ("weather", "circular", {}), "aqi": ("readings", "circular", {"reading": "aqi"}),
    "humidity": ("readings", "circular", {"reading": "humidity"}), "inside": ("readings", "circular", {"reading": "inside"}),
    "sunset": ("readings", "circular", {"reading": "sunset"}), "battery": ("energy", "circular", {"reading": "battery"}),
    "solar": ("energy", "circular", {"reading": "solar"}), "timer": ("timers", "circular", {}),
    "locks": ("status", "circular", {}), "next_event": ("events", "rectangular", {}),
    "next_hours": ("weather", "rectangular", {}), "home_status": ("status", "rectangular", {}),
    "energy_today": ("energy", "rectangular", {}), "date": ("date", "inline", {}),
    "weather_line": ("weather", "inline", {}), "status_line": ("status", "inline", {}),
    "event_line": ("events", "inline", {}), "photo_title": ("title", "inline", {}),
    "clock_card": ("time", "card", {}), "music_card": ("music", "card", {}), "timers_card": ("timers", "card", {}),
    "weather_card": ("weather", "card", {}), "status_card": ("status", "card", {}),
    "forecast_band": ("weather", "band", {}), "readings": ("readings", "band", {}),
}

BIG_KINDS = ("time", "temp", "date", "month", "none")
BIG_SIZE = (12, 44)                     # % of the screen's shorter side
BIG_POS = ("top", "upper", "center", "lower", "ground")
BIG_ALIGN = ("left", "center", "right")
BIG_DEPTH = ("front", "behind", "planted")
BIG_DEFAULT = {"kind": "time", "size": 24, "pos": "top", "align": "center", "depth": "front"}

BACKS = ("none", "glass", "tint")
# a piece's color: the screen's ink, or the house's accent (v1's "white" is the ink now: one ink for the screen)
COLORS = ("auto", "accent")
# a piece's own size, % of its usual (2026-11-01, the owner: "Lots of options for users on size and scale"; 2026-11-02:
# "we probably should allow up to a 200% size increase"); stored only when it isn't 100 -- in the row, only when set
# on purpose: the row's pieces otherwise take ROW_SIZE's one size ("It would look weird if all them varied in sizes")
ITEM_SIZE = (60, 200)
# where the row of widgets goes: under the big element, or along the bottom of the screen (the owner: "I may want it
# all the way at the bottom and not below the clock... as that tends to be where faces are in pictures")
ROW_AT = ("under", "bottom")
# THE SCREEN'S INK (2026-11-02, the owner: "I don't want some widgets being white and some being black on the screen
# at the same time"): every piece white or black together; auto picks from the background's luminance
INKS = ("auto", "white", "black")
# SHOWN ONLY WHEN... (2026-11-02, the owner: "if I want to show an entity on the screen for example, Mail Box... it only
# shows when the Mail Has Arrived? Or if the House Battery is charging?"): any piece can carry a condition on one
# entity; while it isn't met the piece is left out and the rest close up around it
SHOW_OPS = ("is", "not", "above", "below")
ENTITY_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


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


def _opt_ok(spec: Any, v: Any) -> bool:
    """A piece's option: one of its choices, words (1 to 40 characters), or an entity of the domains it names."""
    if isinstance(spec, tuple):
        return v in spec
    if spec == "text":
        return isinstance(v, str) and 0 < len(v.strip()) and len(v) <= 40
    if isinstance(spec, str) and spec.startswith("entity:"):
        return isinstance(v, str) and bool(ENTITY_RE.match(v)) and v.split(".")[0] in spec[7:].split(",")
    return False


def _show(v: Any) -> bool:
    """A piece's condition: {entity, op, value} -- shown while the entity's state is (not) the value, or above or below
    it."""
    return isinstance(v, dict) and set(v) == {"entity", "op", "value"} and isinstance(v["entity"], str) and \
        bool(ENTITY_RE.match(v["entity"])) and v["op"] in SHOW_OPS and \
        ((isinstance(v["value"], str) and 0 < len(v["value"]) <= 64) or
         (isinstance(v["value"], (int, float)) and not isinstance(v["value"], bool)))


def _units(w: dict[str, Any], row_size: int) -> float:
    """The room a piece takes in the row: its shape's units times its size (its own, else the row's)."""
    return UNITS.get(w["shape"], 1) * w.get("size", row_size) / 100


def _widget(v: Any, strict: bool, zone: str) -> dict[str, Any] | None:
    if not isinstance(v, dict):
        if strict:
            raise LayoutInvalid()
        return None
    if "id" in v and "piece" not in v:                  # a v1 widget: its piece and shape now
        if v["id"] not in V1:
            if strict:
                raise LayoutInvalid()
            return None
        piece, shape, opts = V1[v["id"]]
        v = {k: val for k, val in v.items() if k != "id"} | {"piece": piece, "shape": shape} | ({"opts": opts} if opts else {})
        if v.get("color") == "white":
            v["color"] = "auto"
        if v.get("size") == 100:                        # (v1's usual size: the row's one size now)
            del v["size"]
    piece, shape = v.get("piece"), v.get("shape")
    if piece not in PIECES or shape not in PIECES[piece][0]:
        if strict:
            raise LayoutInvalid()
        return None
    out: dict[str, Any] = {"piece": piece, "shape": shape, "back": "none", "color": "auto"}
    for k, val in v.items():
        if k in ("piece", "shape"):
            continue
        if (k == "back" and val in BACKS) or (k == "color" and val in COLORS):
            out[k] = val
        elif k == "size" and _int(val) and ITEM_SIZE[0] <= val <= ITEM_SIZE[1]:
            if val != 100 or zone == "row":
                out[k] = val
        elif k == "show" and _show(val):
            out["show"] = {"entity": val["entity"], "op": val["op"], "value": val["value"]}
        elif k == "opts" and isinstance(val, dict):
            choices = PIECES[piece][1]
            good = {o: c for o, c in val.items() if o in choices and _opt_ok(choices[o], c)}
            if strict and len(good) != len(val):
                raise LayoutInvalid()
            if good:
                out["opts"] = good
        elif strict:
            raise LayoutInvalid()
    return out


def _zones(v: Any, strict: bool, row_size: int) -> dict[str, list[dict[str, Any]]]:
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
        used = 0.0
        for it in items:
            w = _widget(it, strict, z)
            if w is None:
                continue
            need = _units(w, row_size) if z == "row" else 1
            if w["shape"] not in takes or used + need > room + 1e-9:
                if strict:
                    raise LayoutInvalid()
                continue
            used += need
            out[z].append(w)
    return out


def _upright(v: Any, strict: bool, row_size: int) -> dict[str, Any] | None:
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
        out["zones"] = _zones(v["zones"], strict, row_size)
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
    if not isinstance(v, dict) or v.get("v") not in (1, VERSION) or isinstance(v.get("v"), bool):
        if strict:
            raise LayoutInvalid()
        return None
    keys = ("v", "big", "zones", "row_at", "upright") + (("row_size", "ink", "accents") if v["v"] == VERSION else ())
    if strict and any(k not in keys for k in v):
        raise LayoutInvalid()
    row_size = v.get("row_size", 100) if v["v"] == VERSION else 100
    if not (_int(row_size) and ITEM_SIZE[0] <= row_size <= ITEM_SIZE[1]):
        if strict:
            raise LayoutInvalid()
        row_size = 100
    ink = v.get("ink", "auto") if v["v"] == VERSION else "auto"
    if ink not in INKS:
        if strict:
            raise LayoutInvalid()
        ink = "auto"
    accents = v.get("accents", True) if v["v"] == VERSION else True
    if not isinstance(accents, bool):
        if strict:
            raise LayoutInvalid()
        accents = True
    out: dict[str, Any] = {"v": VERSION, "big": _big(v.get("big", {}), strict),
                           "zones": _zones(v.get("zones", {}), strict, row_size),
                           "row_at": _row_at(v.get("row_at", ROW_AT[0]), strict),
                           "upright": _upright(v.get("upright"), strict, row_size)}
    # (each stored only when it isn't the usual)
    if row_size != 100:
        out["row_size"] = row_size
    if ink != "auto":
        out["ink"] = ink
    if not accents:
        out["accents"] = False
    return out


def check(v: Any) -> dict[str, Any] | None:
    """The layout as it is stored, or None for none (the screensaver as each Show draws it); LayoutInvalid if it
    can't be used."""
    if v is None:
        return None
    return _layout(v, True)


def layout(v: Any) -> dict[str, Any] | None:
    """A stored layout as this build can draw it: what it doesn't know is left out; None if nothing of it is left."""
    return _layout(v, False)
