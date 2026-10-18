"""Sleep Screen: WHEN a wall tablet sleeps and wakes -- the rules, pure.

No Home Assistant here: the settings' shape, what counts as "on", the
schedule, and `decide()`, which turns one moment's facts into what the
screen should show. engine.py (beside this) gathers the facts through the
House and decides the rest; the host acts (inside Home Assistant,
sleep_engine.py); the tests and the history replay call these directly.

The priority order is the one the house's generated tablets ran from 2026-09
(hk_house/generator/tablet_want_template.yaml; docs/TABLET-INVARIANTS.md),
each rule now a setting of the screen's Sleep Screen page:

   1 Wake for, in quiet hours too (smoke) ......... dashboard
   2 Quiet hours (the schedule, Quiet while) ...... dark -- unless in use,
                                                    another app is in front,
                                                    or a Hold while that
                                                    works in quiet hours is on
   3 Wake for ..................................... dashboard
   4 Hold while (the doorbell, the alarm) ......... hold: leave it as it is
   5 Another app is in front ...................... hold
   6 Keep awake while (Live TV) ................... dashboard
   7 Stay dark while (away) ....................... dark
   8 A presence sensor is missing ................. hold (no guess)
   9 In use (touched within the window) ........... dashboard
  10 Somebody in the room (Presence) .............. photos
  11 Nobody ....................................... dark

`photos` means "awake": a dark tablet wakes to the dashboard and the photo
screensaver comes up on its own (Starts After); an awake one is left alone.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Any, Iterable, Mapping

DECIDERS = ("automation", "hk", "shadow")     # shadow: decides, never acts
DARK_DISPLAYS = ("lowest", "off", "off_quiet")
AFTER_SAVER = (0, 5, 15, 30, 60, 120, 240)    # minutes of photos; 0 = never
LINGER = (0, 30, 60, 120, 300, 600, 900, 1800)
BRIGHTNESS_MODES = ("leave", "fixed", "sensor")
LISTS = ("presence", "lit", "quiet_while", "reset", "dark_while", "awake_while", "hold_while", "wake_for", "quiet_ok")
LIST_MAX = 40

SLEEP_DEFAULTS: dict[str, Any] = {
    # who decides: an automation (the black switch only -- the default), HK
    # Frontend (this engine), or shadow (decides and reports, never acts)
    "decided_by": "automation",
    # while dark: the lowest backlight, the display off, or off only during
    # quiet hours (a tap cannot wake a display that is off)
    "dark_display": "lowest",
    # go dark once the photos have shown this many minutes untouched
    "after_saver": 0,
    # quiet hours by the clock (local), and/or while any of quiet_while is on
    "schedule": False, "quiet_from": "22:00", "quiet_to": "07:00",
    # the screen's Kiosk Satellite (its device id; "" none)
    "kiosk": "",
    # somebody is in the room while any is on, and for `linger` s after the
    # last clears; with none, the room always counts as occupied
    "presence": [], "linger": 60,
    # passive wakes only while one of these lights is on
    "lit": [],
    "quiet_while": [],
    # sleep until re-entered: turning on darkens an occupied room; it wakes
    # again when presence rises after (Good Night)
    "reset": [],
    "dark_while": [], "awake_while": [], "hold_while": [], "wake_for": [],
    # of hold_while and wake_for, the ones that work in quiet hours too
    "quiet_ok": [],
    # brightness: leave it, or Day and Night ("fixed"): a level for each
    # (0-255, the display's scale), optionally by the clock (day_from /
    # night_from, local), and forced by Day While / Night While entities --
    # Day While first, then Night While, then the clock, else day. ("sensor":
    # follow an entity's number -- kept for a screen that chose it before.)
    "brightness": "leave", "bright_day": 174, "bright_night": 75, "night_while": [], "bright_sensor": "",
    "bright_clock": False, "day_from": "07:00", "night_from": "22:00", "day_while": [],
}

ON_STATES = ("on", "active", "triggered", "open", "opening", "detected", "playing")


def _hhmm(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    try:
        h, m = v.strip().split(":")[:2]
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    return "%02d:%02d" % (h, m) if 0 <= h < 24 and 0 <= m < 60 else None


def _entity(v: Any) -> bool:
    if not isinstance(v, str) or "." not in v or len(v) > 255:
        return False
    d, o = v.split(".", 1)
    return bool(d) and bool(o) and all(c.isalnum() or c == "_" for c in d + o) and d == d.lower() and o == o.lower()


def sleep_options(v: Any) -> dict[str, Any] | None:
    """The Sleep Screen options over the defaults, or None when `v` holds a
    value that cannot be used (the form says so)."""
    out = {k: (list(x) if isinstance(x, list) else x) for k, x in SLEEP_DEFAULTS.items()}
    if v in (None, "", {}):
        return out
    if not isinstance(v, Mapping):
        return None
    for k, val in v.items():
        if k not in SLEEP_DEFAULTS:
            return None
        if k == "decided_by":
            if val not in DECIDERS:
                return None
        elif k == "dark_display":
            if val not in DARK_DISPLAYS:
                return None
        elif k == "brightness":
            if val not in BRIGHTNESS_MODES:
                return None
        elif k in ("after_saver", "linger"):
            allowed = AFTER_SAVER if k == "after_saver" else LINGER
            if isinstance(val, bool) or val not in allowed:
                return None
        elif k in ("bright_day", "bright_night"):
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not 1 <= val <= 255:
                return None
            val = int(val)
        elif k in ("schedule", "bright_clock"):
            if not isinstance(val, bool):
                return None
        elif k in ("quiet_from", "quiet_to", "day_from", "night_from"):
            val = _hhmm(val)
            if val is None:
                return None
        elif k in ("kiosk", "bright_sensor"):
            if not isinstance(val, str) or len(val) > 255 or (k == "bright_sensor" and val and not _entity(val)):
                return None
        elif k in LISTS or k in ("night_while", "day_while"):
            if not isinstance(val, list) or len(val) > LIST_MAX or not all(_entity(x) for x in val):
                return None
            val = list(dict.fromkeys(val))
        out[k] = val
    return out


def inputs(o: Mapping[str, Any]) -> list[str]:
    """Every entity the rules read (the engine listens to each)."""
    ids: list[str] = []
    for k in LISTS + ("night_while", "day_while"):
        ids += list(o.get(k) or [])
    if o.get("brightness") == "sensor" and o.get("bright_sensor"):
        ids.append(o["bright_sensor"])
    return list(dict.fromkeys(ids))


def brightness_now(o: Mapping[str, Any], on: Iterable[str], now: time) -> tuple[int | None, str]:
    """Day and Night: the level now, and which ("day"/"night"), for the
    options `o`, the entities `on` now and the local time `now`. None while
    the brightness is left alone (or another mode)."""
    if o.get("brightness") != "fixed":
        return None, ""
    on = set(on)
    if any(i in on for i in o.get("day_while") or []):
        part = "day"
    elif any(i in on for i in o.get("night_while") or []):
        part = "night"
    elif o.get("bright_clock") and in_window(now, o.get("night_from", "22:00"), o.get("day_from", "07:00")):
        part = "night"
    else:
        part = "day"
    return int(o["bright_night"] if part == "night" else o["bright_day"]), part


def is_on(state: str | None) -> bool:
    """An entity in its "on" sense, whatever its kind: a binary sensor or a
    switch on, a timer active, an alarm triggered, a door open, media
    playing."""
    return state in ON_STATES


def missing(state: str | None) -> bool:
    return state in (None, "unknown", "unavailable")


def in_window(now: time, start: str, end: str) -> bool:
    """`now` between start and end (local HH:MM); over midnight when end is
    earlier (22:00-07:00)."""
    s, e = _hhmm(start), _hhmm(end)
    if not s or not e or s == e:
        return False
    st, en = time(*map(int, s.split(":"))), time(*map(int, e.split(":")))
    return st <= now < en if st < en else (now >= st or now < en)


def next_boundary(now: datetime, start: str, end: str) -> datetime | None:
    """The next moment the schedule starts or ends (local, `now`'s tz)."""
    out = None
    for v in (start, end):
        h = _hhmm(v)
        if not h:
            continue
        hh, mm = map(int, h.split(":"))
        t = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if t <= now:
            t += timedelta(days=1)
        out = t if out is None or t < out else out
    return out


def decide(f: Mapping[str, Any]) -> tuple[str, str]:
    """What the screen should show now, and why.

    `f`, the moment's facts (engine.Sleep.facts):
      wake_q / wake / hold_q / hold  names of the Wake for / Hold while
                                     entities on now (_q: works in quiet hours)
      quiet         quiet hours now (schedule or Quiet while)
      app_front     another app is in front (the kiosk's foreground app)
      awake / dark  a Keep awake while / Stay dark while entity is on
      present       somebody in the room (None: a presence input is missing)
      slept         that presence predates a Sleep until re-entered, or the
                    photos have run their After the Screensaver
      in_use        touched within the window (None: not known)
      saver_use     ...but on the screensaver's own controls, the photos up
                    (its music, its panel): the photos are in use, not the
                    dashboard
      lit           a lit light is on (True with none chosen)
      touched_since_dark  touched since the lit lights last changed
      prev          the last decision (for a hold on missing inputs)
      notice        a notification set to Wake the Screen, for its while
                    (its title; "" when none): up to the photos, the banner
                    over them (a screen already on its dashboard stays there)
    """
    def first(names: Iterable[str]) -> str:
        return next(iter(names), "")
    in_use, present = f.get("in_use"), f.get("present")
    inputs_missing = present is None or in_use is None
    prev = f.get("prev") if f.get("prev") in ("dark", "photos", "dashboard") else None
    if f.get("notice"):
        return "photos", "notification: %s" % f["notice"]
    if f.get("wake_q"):
        return "dashboard", "%s is on" % first(f["wake_q"])
    saver_use = bool(f.get("saver_use"))
    if f.get("quiet") and not in_use and not saver_use and not f.get("app_front") and not f.get("hold_q"):
        if inputs_missing and prev:
            return prev, "holding - an input is unavailable (quiet hours)"
        return "dark", "quiet hours"
    if f.get("wake"):
        return "dashboard", "%s is on" % first(f["wake"])
    if f.get("hold_q") or f.get("hold"):
        return "hold", "%s is on" % first(list(f.get("hold_q") or []) + list(f.get("hold") or []))
    if f.get("app_front"):
        return "hold", "another app is in front (%s)" % f.get("app_name", "")
    if f.get("awake"):
        return "dashboard", "%s is on" % first(f["awake"])
    if f.get("dark"):
        return "dark", "%s is on" % first(f["dark"])
    if inputs_missing:
        return (prev or "hold"), "holding - an input is unavailable"
    lit = f.get("lit", True)
    if in_use and (lit or f.get("touched_since_dark")):
        return "dashboard", "somebody is at the tablet"
    if saver_use and (lit or f.get("touched_since_dark")):
        return "photos", "somebody is using the screensaver"
    if present and lit and not f.get("slept"):
        return "photos", "somebody is in the room"
    if present and not lit:
        return "dark", "the room's lights are off"
    if present and f.get("slept"):
        return "dark", f.get("slept_why") or "dark until the room is re-entered"
    if in_use:
        return "dark", "the room's lights went off after it was last touched"
    return "dark", "nobody here"


def satisfied(want: str, actual: str) -> bool:
    """Nothing to do: the screen shows what it should -- or it is awake on
    the dashboard while it should show photos (the photo screensaver comes up
    by itself), or the rules say leave it."""
    return want == "hold" or want == actual or (want == "photos" and actual == "dashboard")


def action(want: str, actual: str) -> str | None:
    """sleep / wake / None."""
    if satisfied(want, actual):
        return None
    if want == "dark":
        return "sleep"
    if want == "photos":
        return "wake" if actual == "dark" else None
    return "wake"
