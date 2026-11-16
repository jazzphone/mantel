"""A SCREEN'S SCREENSAVER, ROW BY ROW OVER ALL SCREENS' (phase 33, decisions 9 and 12; docs/phase33/PLAN.md).

A screen's own options are only the keys it changed: `screensaver_options` is stored as a partial mapping, and None
(or {}) follows All Screens in everything. Read, a screen's options are All Screens' with its own over them
(`merged`), so changing Starts After on one screen changes only that. A screen that had a whole set of its own
before -- the only kind there was -- keeps every key as its own, filled in as it always was (`own`), so it reads
exactly as it did. The editor's design is one group: editing it makes every DESIGN key the screen's own
(web/hk: saverPutB), the other rows one key at a time (PAGE_KEYS).

SLIDES IN MINUTES (decision 12): one How Often (`extra_every`, minutes) and one Show For (`extra_for`, seconds),
whatever the screensaver shows. Over photos a slide used to come every `forecast_every` photos and stay one photo's
time. A set written that way is carried over as it is read (`in_minutes`): the minutes it took (forecast_every x
each_photo, at the nearest choice) and a photo's time. `forecast_every` is then kept in step with the minutes (the
nearest number of photos), so a set this version writes reads the same to an older one -- and is never carried
over again. web/hk mirrors it (hk-settings-model-search.js saverInMinutes, hk-saver-helpers.js inMinutes;
test_saver_layers.py holds them equal).
"""
from __future__ import annotations

import math
from typing import Any, Mapping

from . import saver_holidays as HOLIDAYS
from . import saver_timers as TIMERS

# How Often's choices, in minutes (a carried-over set takes the nearest)
EVERY = (1, 2, 5, 10, 15, 30)

# THE PAGE'S ROWS: each is a screen's own on its own. Every other key is the editor's design, one group
PAGE_KEYS = frozenset((
    "starts_after", "each_photo", "order", "fill", "zoom", "fallback", "fade_back",
    "photo_layout", "mosaic_change", "mosaic_color", "mosaic_count", "mosaic_every", "mosaic_gap", "mosaic_line", "mosaic_random",
    "portrait_fill", "portrait_blur", "portrait_dim", "portrait_zoom", "portrait_x", "portrait_y",
    "landscape_blur", "landscape_dim", "landscape_zoom", "landscape_x", "landscape_y",
    "clock_night", "clock_night_from", "clock_night_to",
    "forecast_every", "extra_every", "extra_for", "music_first", "music_slide", "extra_music", "extra_forecast",
    "weather_slide", "weather_hide", "energy_slide", "energy_hide", "forecast_layout", "forecast_big", "forecast_planted", "band",
    "band_photos", "calendar", "calendar_days", "music_pane",
    *HOLIDAYS.DEFAULTS, *TIMERS.DEFAULTS))

# what only a whole set (before phase 33) has: a screen's own then held every key
WHOLE = ("show", "starts_after", "each_photo", "forecast_every", "extra_every")


def design_keys(defaults: Mapping[str, Any]) -> frozenset[str]:
    """The editor's design: every key that isn't one of the page's rows."""
    return frozenset(k for k in defaults if k not in PAGE_KEYS)


def is_whole(v: Any) -> bool:
    """A screen's own set from before per-key: every key its own."""
    return isinstance(v, Mapping) and all(k in v for k in WHOLE)


def _round(x: float) -> int:
    # as JavaScript's Math.round, so both sides agree on a half
    return int(math.floor(x + 0.5))


def photos_for(every: int, each_photo: int) -> int:
    """How many photos `every` minutes is, for an older version reading `forecast_every` (2-100)."""
    return min(100, max(2, _round(every * 60 / max(1, each_photo))))


def nearest(minutes: float) -> int:
    """How Often's choice nearest `minutes` (the smaller of two as near)."""
    return min(EVERY, key=lambda m: (abs(m - minutes), m))


def in_minutes(o: Mapping[str, Any]) -> dict[str, Any]:
    """A whole set with its slides in minutes: over photos, one that still counts photos takes the minutes they
    took and a photo's time to show for; forecast_every follows the minutes."""
    out = dict(o)
    if not all(k in out for k in ("forecast_every", "extra_every", "each_photo")):
        return out
    if out.get("show") in ("photos", "both") and out["forecast_every"] != photos_for(out["extra_every"], out["each_photo"]):
        out["extra_every"] = nearest(out["forecast_every"] * out["each_photo"] / 60)
        out["extra_for"] = min(300, max(10, int(out["each_photo"])))
    out["forecast_every"] = photos_for(out["extra_every"], out["each_photo"])
    return out


def own(v: Any) -> dict[str, Any] | None:
    """A screen's own options as stored, checked: the keys it set (a whole set from before: every key, its slides
    in minutes), {} for none, or None when one can't be used."""
    from .saver_designs import saver_options
    if v in (None, {}):
        return {}
    full = saver_options(v)
    if full is None or not isinstance(v, Mapping):
        return None
    if is_whole(v):
        return in_minutes(full)
    keys = set(v)
    # (the reader's own carry-overs: an older Music slide is Music Full Screen; an old wallpaper its own color)
    if "music_slide" in keys:
        keys.add("music_first")
    if "clock_wallpaper" in keys:
        keys.add("clock_wallpaper_color")
    return {k: full[k] for k in full if k in keys}


def merged(house: Mapping[str, Any], mine: Mapping[str, Any] | None) -> dict[str, Any]:
    """A screen's options as read: All Screens' with its own keys over them, forecast_every in step."""
    out = {**house, **(mine or {})}
    if mine and all(k in out for k in ("extra_every", "each_photo")):
        out["forecast_every"] = photos_for(out["extra_every"], out["each_photo"])
    return out
