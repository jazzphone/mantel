"""Bounded saved screensavers; snapshots contain ordinary saver options only."""
from __future__ import annotations

import calendar
import json
import re
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

FACES = ("solar", "prism", "world", "hotel", "terminal", "atelier", "meridian", "markets", "brief", "modular")
CHOICES = {
    "solar_dial": ("rays", "edge", "minimal"),
    "prism_style": ("glass", "outline", "solid"),
    "world_view": ("globe", "horizon", "close"),
    "texture": ("linen", "paper", "dark"),
    "watch_shape": ("round", "cushion", "rectangle"),
    "metal": ("steel", "gold", "rose"),
    "board": ("dark", "light", "amber"),
}


def clock_options(value):
    if not isinstance(value, dict) or len(value) > 16:
        return None
    out = {}
    for key, val in value.items():
        if key in CHOICES:
            if val not in CHOICES[key]:
                return None
        elif key == "rotation":
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not -180 <= val <= 180:
                return None
        elif key == "cities":
            if not isinstance(val, list) or not 1 <= len(val) <= 6:
                return None
            for city in val:
                if not isinstance(city, dict) or set(city) != {"name", "zone"}:
                    return None
                if not isinstance(city["name"], str) or not 1 <= len(city["name"].strip()) <= 40:
                    return None
                try:
                    ZoneInfo(city["zone"])
                except (ZoneInfoNotFoundError, ValueError, TypeError):
                    return None
        elif key in ("market_entities", "news_entity"):
            vals = val if key == "market_entities" else [val]
            if not isinstance(vals, list) or len(vals) > 6 or any(
                not isinstance(e, str) or not re.fullmatch(r"(?:sensor|input_number|number)\.[a-z0-9_]+", e)
                for e in vals
            ):
                return None
        else:
            return None
        out[key] = val
    return out


def designs(value, read):
    if not isinstance(value, list) or len(value) > 12:
        return None
    try:
        if len(json.dumps(value, allow_nan=False)) > 262144:
            return None
    except (TypeError, ValueError):
        return None
    out, ids, defaults = [], set(), read({})
    for item in value:
        if not isinstance(item, dict) or set(item) != {"id", "name", "options"}:
            return None
        ident, name, options = item["id"], item["name"], item["options"]
        if not isinstance(ident, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", ident) or ident in ids:
            return None
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
            return None
        if not isinstance(options, dict) or {"designs", "active_design"} & options.keys():
            return None
        cleaned = read(options)
        if cleaned is None:
            return None
        # Keep snapshots compact, but normalize the same keys the ordinary reader does.
        out.append({"id": ident, "name": name.strip(), "options": {k: v for k, v in cleaned.items()
            if k not in ("designs", "active_design") and (k in options or v != defaults[k])}})
        ids.add(ident)
    return out


_HOLIDAY_REF = re.compile(r"(?:birthday|own):[a-z0-9]+(?:-[a-z0-9]+)*")


def holiday_value(key: str, val: Any) -> Any:
    """One of the Holiday slide's own options, cleaned, or None when it cannot be used (phase 20,
    docs/phase20/HOLIDAY-SLIDE.md "Settings"; hk-holidays.js reads them). holiday_one names a holiday (a built-in one,
    a birthday or one of your own dates, as hk-holidays.js ids them); holiday_off and holiday_outdoors are lists of
    built-in ones (holiday_off also 'birthdays'), kept in the calendar's order; holiday_own is up to twelve dates of
    your own, each {name, month, day, year?, scene}."""
    from . import model as M
    if key == "holiday_days":
        return val if not isinstance(val, bool) and isinstance(val, int) and val in M.HOLIDAY_DAYS else None
    if key == "holiday_one":
        ok = isinstance(val, str) and (val in M.HOLIDAY_IDS or (len(val) <= 49 and _HOLIDAY_REF.fullmatch(val)))
        return val if ok else None
    if key in ("holiday_off", "holiday_outdoors"):
        allowed = M.HOLIDAY_IDS + ("birthdays",) if key == "holiday_off" else M.HOLIDAY_PAINTED
        if not isinstance(val, list) or any(x not in allowed for x in val):
            return None
        return [x for x in allowed if x in val]
    if not isinstance(val, list) or len(val) > M.HOLIDAY_OWN_MAX:
        return None
    out = []
    for item in val:
        if not isinstance(item, dict) or not {"name", "month", "day"} <= item.keys() or not item.keys() <= {"name", "month", "day", "year", "scene"}:
            return None
        name, month, day, year, scene = item["name"], item["month"], item["day"], item.get("year"), item.get("scene", "spring")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= M.HOLIDAY_NAME_MAX or any(c in name for c in "<>\n\r\t"):
            return None
        if any(isinstance(n, bool) or not isinstance(n, int) for n in (month, day)) or not 1 <= month <= 12:
            return None
        if year is not None and (isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2200):
            return None
        if not 1 <= day <= calendar.monthrange(year if year is not None else 2024, month)[1] or scene not in M.HOLIDAY_OWN_SCENES:
            return None
        clean = {"name": name.strip(), "month": month, "day": day, "scene": scene}
        if year is not None:
            clean["year"] = year
        out.append(clean)
    return out


def saver_options(v: Any, legacy: Any = None) -> dict[str, Any] | None:
    """The screensaver's options over the defaults, or None when `v` is not a
    mapping or holds a value that cannot be used (the form says so). With no
    options of its own yet, a screen's old WallPanel choices carry over:
    idle_time, display_time, media_order, image_fit_landscape and
    image_animation_ken_burns are the ones its page ever set."""
    from . import model as M
    from . import saver_layout as SLAY
    out = dict(M.SAVER_DEFAULTS)
    if v in (None, "", {}):
        w = legacy if isinstance(legacy, dict) else {}
        v = {}
        for src, dst in (("idle_time", "starts_after"), ("display_time", "each_photo")):
            if isinstance(w.get(src), (int, float)) and not isinstance(w.get(src), bool):
                v[dst] = w[src]
        if w.get("media_order") in M.SAVER_ORDERS:
            v["order"] = w["media_order"]
        if w.get("image_fit_landscape") in ("cover", "contain"):
            v["fill"] = w["image_fit_landscape"] == "cover"
        if isinstance(w.get("image_animation_ken_burns"), bool):
            v["zoom"] = w["image_animation_ken_burns"]
        # an out-of-range old value is clamped rather than refused: it was
        # accepted once, and the screen must keep working
        for k, (lo, hi) in (("starts_after", M.SAVER_STARTS), ("each_photo", M.SAVER_EACH)):
            if k in v:
                v[k] = int(min(max(v[k], lo), hi))
    if not isinstance(v, dict):
        return None
    for k, val in v.items():
        if k not in M.SAVER_DEFAULTS:
            return None
        if k in M.SAVER_INTS:
            lo, hi = M.SAVER_INTS[k]
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not lo <= val <= hi:
                return None
            out[k] = int(val)
        elif k in ("order", "show"):
            if val not in (M.SAVER_ORDERS if k == "order" else M.SAVER_SHOWS):
                return None
            out[k] = val
        elif k in ("clock_night_from", "clock_night_to"):
            m = re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", val) if isinstance(val, str) else None
            if not m:
                return None
            out[k] = val
        elif k == "clock_colors":
            if not isinstance(val, dict) or any(s not in M.SAVER_CLOCK_STYLES or not isinstance(c, str) or not re.match(r"^[a-z]{1,16}$", c)
                                                for s, c in val.items()):
                return None
            out[k] = dict(val)
        elif k == "clock_wallpaper_color":
            if M.wallpaper_color(val) is None:
                return None
            out[k] = M.wallpaper_color(val)
        elif k == "designs":
            got = designs(val, saver_options)
            if got is None:
                return None
            out[k] = got
        elif k == "active_design":
            if not isinstance(val, str) or (val and not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", val)):
                return None
            out[k] = val
        elif k == "clock_options":
            got = clock_options(val)
            if got is None:
                return None
            out[k] = got
        elif k == "layout":
            out[k] = SLAY.layout(val) if val is not None else None
        elif k in ("holiday_days", "holiday_one", "holiday_off", "holiday_outdoors", "holiday_own"):
            got = holiday_value(k, val)
            if got is None:
                return None
            out[k] = got
        elif k in ("energy_hide", "weather_hide", "corner_hide", "music_hide", "holiday_hide"):
            parts = {"energy_hide": M.SAVER_ENERGY_PARTS, "weather_hide": M.SAVER_WEATHER_PARTS, "corner_hide": M.SAVER_CORNER_PARTS,
                     "music_hide": M.SAVER_MUSIC_PARTS, "holiday_hide": M.SAVER_HOLIDAY_PARTS}[k]
            if not isinstance(val, list) or any(x not in parts for x in val):
                return None
            out[k] = [x for x in parts if x in val]
        elif k in M.SAVER_CHOICES:
            if val not in M.SAVER_CHOICES[k]:
                return None
            out[k] = val
        elif k.split("_", 1)[-1] in M.SAVER_RANGES and k.startswith(("portrait_", "landscape_")):
            lo, hi = M.SAVER_RANGES[k.split("_", 1)[1]]
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not lo <= val <= hi:
                return None
            out[k] = int(val)
        elif k.split("_", 1)[-1] in M.SAVER_FOCUS and k.startswith(("portrait_", "landscape_")):
            if val not in M.SAVER_FOCUS[k.split("_", 1)[1]]:
                return None
            out[k] = val
        else:
            if not isinstance(val, bool):
                return None
            out[k] = val
    if out["active_design"] and not any(d["id"] == out["active_design"] for d in out["designs"]):
        return None
    # ONE KEY FOR MUSIC FULL SCREEN (2026-11-02, phase 13: "One home per option"): the editor's Music Full Screen
    # (music_first) and Settings' Music slide (music_slide) are one choice -- what plays takes the screen while it plays
    if out["music_slide"]:
        out["music_first"], out["music_slide"] = True, False
    # an old Wallpaper behind the clock ("petals_violet", 2026-10-31): its art in its own preset (item 45)
    if out["clock_wallpaper"] in M.WALLPAPER_LEGACY:
        out["clock_wallpaper"], out["clock_wallpaper_color"] = M.WALLPAPER_LEGACY[out["clock_wallpaper"]]
    return out
