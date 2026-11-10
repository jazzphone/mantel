"""A vacuum's water tank that ran dry, held until someone clears it (2026-11-09, the owner), the rules with no host in them.

THE PROBLEM: a Roborock on Matter reports `water_tank_empty` for under a second (measured 2026-11-08: 08:39:48.41 to 08:39:49.32), then
carries on cleaning and never says it again. A screen that was asleep, or looking at something else, never sees it. Mantel Server
is always connected, so it catches the one report and latches it: {since, words}, one per vacuum, until someone presses Clear or
Clear After hours have passed. The owner: "Mantel just catches the water tank empty appear, notates it on the card, with an option to
clear it, and if not, it will clear it at the 24 hour mark... I'd rather not create anything crazy on the HA side."

The words are found the way the frontend finds them (web/hk/modules/hk-vacuum-art.js WATER), on the vacuum itself and on any sensor of
its device named *operational_error or *_error (not the dock's), so every vacuum works with no setup.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

SENSOR = "sensor.vacuum_water_tanks"      # Mantel's own: its attribute `tanks` is {vacuum: {since, words}}, for every screen
CLEAR = "vacuum_water_clear"              # script.vacuum_water_clear {vacuum}: the Clear key, through the gateway
WATER = re.compile(r"water_tank|clean_water|dirty_water|water_box|mop_(cleaning_)?pad|mop_missing|water_shortage|no_water", re.I)
ERROR_SENSOR = re.compile(r"operational_error|_error$")
OK = ("no_error", "none", "ok", "unknown", "unavailable", "")
ATTRS = ("error", "status", "error_code", "last_error")     # where an integration puts a vacuum's own error
CLEAR_AFTER = (0, 12, 24, 48)                               # hours; 0 is Until Cleared
DEFAULTS = {"water_tank": True, "water_clear": 24}


def tidy(value: Any) -> str:
    """'Water tank empty' and water_tank_empty are the same words."""
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def words(value: Any) -> str:
    text = tidy(value).replace("_", " ")
    return text[:1].upper() + text[1:]


def water_words(value: Any) -> str | None:
    """The words of a water-tank report, or None when the value is not one."""
    key = tidy(value)
    if key in OK or not WATER.search(key):
        return None
    return words(key)


def own_words(state: Mapping[str, Any] | None) -> str | None:
    """The water-tank report in the vacuum's own state or attributes (`error`, `status`), if it has one."""
    if not state:
        return None
    attrs = state.get("a") or {}
    for v in [state.get("s")] + [attrs.get(k) for k in ATTRS]:
        got = water_words(v) if isinstance(v, (str, int)) and not isinstance(v, bool) else None
        if got:
            return got
    return None


def error_sensor_of(vacuum: str, device: str | None, entries: Mapping[str, Mapping[str, Any]], states: Mapping[str, Any]) -> list[str]:
    """The sensors on the vacuum's device that carry its errors: operational_error or *_error, never the dock's."""
    if not device:
        return []
    return sorted(k for k, e in entries.items() if e.get("device_id") == device and k.startswith("sensor.") and k != vacuum
                  and ERROR_SENSOR.search(k) and "dock" not in k)


def settings(headers: Mapping[str, Any] | None) -> tuple[bool, int]:
    """(Water Tank Reminder on, Clear After in hours; 0 is until cleared), from settings.headers.vacuums as saved."""
    v = (headers or {}).get("vacuums")
    h: Mapping[str, Any] = v if isinstance(v, dict) else {}
    on = h.get("water_tank", DEFAULTS["water_tank"])
    hours = h.get("water_clear", DEFAULTS["water_clear"])
    return (on is not False, hours if isinstance(hours, int) and not isinstance(hours, bool) and hours in CLEAR_AFTER else DEFAULTS["water_clear"])


def expired(since: float, hours: int, now: float) -> bool:
    return hours > 0 and now - since >= hours * 3600.0
