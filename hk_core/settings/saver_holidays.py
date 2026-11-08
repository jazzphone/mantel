"""THE HOLIDAY SLIDE'S SETTINGS (phase 20, docs/phase20/HOLIDAY-SLIDE.md "Settings"; web/hk/modules/hk-saver-holiday.js).

How many days until the next holiday, in a painted scene (Christmas, Halloween, Thanksgiving, New Year's) or outdoors over
the sky's landscapes: a slide among the photos or an additional screen over a clock, as Weather and Home Energy are; off by
default (decision 3; the Holiday Whimsy Look turns it on). Its options: which holiday (Next Up, Take Turns, One Holiday),
the window of days, the holidays left out (US-only ones outside the US, as the sky's themes, until the house chooses), up
to twelve dates of your own, the effects, the painted scenes sent outdoors, and the parts of its row it leaves out.

model.py lays DEFAULTS and CHOICES over the screensaver's own (SAVER_DEFAULTS, SAVER_CHOICES); saver_designs.saver_options
checks the rest through value(). The calendar's ids are web/hk/modules/hk-holidays.js's (tests/test_holiday_settings.py
holds the two in step).
"""
from __future__ import annotations

import calendar
import re
from typing import Any

IDS = ("newyear", "valentines", "easter", "mothers", "fathers", "july4", "halloween", "thanksgiving", "christmas")
PAINTED = ("newyear", "halloween", "thanksgiving", "christmas")
US_ONLY = ("july4", "thanksgiving")
OWN_SCENES = ("spring", "summer", "fall", "winter", "party", "fireworks")
DAYS = (30, 60, 90)
OWN_MAX = 12
NAME_MAX = 40
PARTS = ("count", "next")
DEFAULTS: dict[str, Any] = {"holiday_slide": False, "holiday_pick": "next", "holiday_one": "christmas", "holiday_days": 60,
                            "holiday_off": [], "holiday_own": [], "holiday_fx": "full", "holiday_outdoors": [], "holiday_hide": []}
CHOICES = {"holiday_pick": ("next", "turns", "one"), "holiday_fx": ("full", "gentle", "off")}
KEYS = ("holiday_days", "holiday_one", "holiday_off", "holiday_outdoors", "holiday_own", "holiday_hide")
_REF = re.compile(r"(?:birthday|own):[a-z0-9]+(?:-[a-z0-9]+)*")


def place_off(country: Any) -> list[str]:
    """The holidays a house leaves off before it chooses: the US-only ones outside the US (as the sky's themes)."""
    return list(US_ONLY) if isinstance(country, str) and country and country != "US" else []


def placed(saver: Any, stored: Any, country: Any) -> Any:
    """All Screens' screensaver options with the place's holiday_off when the house has not saved one of its own
    (model.merged: `stored` is the house's stored settings)."""
    look = stored.get("look") if isinstance(stored, dict) else None
    own = look.get("saver") if isinstance(look, dict) else None
    if isinstance(saver, dict) and not (isinstance(own, dict) and "holiday_off" in own):
        return dict(saver, holiday_off=place_off(country))
    return saver


def value(key: str, val: Any) -> Any:
    """One of the slide's own options, cleaned, or None when it cannot be used. holiday_one names a holiday (a built-in
    one, a birthday or one of your own dates, as hk-holidays.js ids them); holiday_off and holiday_outdoors are lists of
    built-in ones (holiday_off also 'birthdays'), kept in the calendar's order; holiday_hide is a subset of PARTS;
    holiday_own is up to twelve dates of your own, each {name, month, day, year?, scene}."""
    if key == "holiday_days":
        return val if not isinstance(val, bool) and isinstance(val, int) and val in DAYS else None
    if key == "holiday_one":
        return val if isinstance(val, str) and (val in IDS or (len(val) <= 49 and _REF.fullmatch(val))) else None
    if key in ("holiday_off", "holiday_outdoors", "holiday_hide"):
        allowed = {"holiday_off": IDS + ("birthdays",), "holiday_outdoors": PAINTED, "holiday_hide": PARTS}[key]
        if not isinstance(val, list) or any(x not in allowed for x in val):
            return None
        return [x for x in allowed if x in val]
    if not isinstance(val, list) or len(val) > OWN_MAX:
        return None
    out = []
    for item in val:
        if not isinstance(item, dict) or not {"name", "month", "day"} <= item.keys() or not item.keys() <= {"name", "month", "day", "year", "scene"}:
            return None
        name, month, day, year, scene = item["name"], item["month"], item["day"], item.get("year"), item.get("scene", "spring")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= NAME_MAX or any(c in name for c in "<>\n\r\t"):
            return None
        if any(isinstance(n, bool) or not isinstance(n, int) for n in (month, day)) or not 1 <= month <= 12:
            return None
        if year is not None and (isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2200):
            return None
        if not 1 <= day <= calendar.monthrange(year if year is not None else 2024, month)[1] or scene not in OWN_SCENES:
            return None
        clean = {"name": name.strip(), "month": month, "day": day, "scene": scene}
        if year is not None:
            clean["year"] = year
        out.append(clean)
    return out
