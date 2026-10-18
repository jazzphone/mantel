"""WHAT A NOTIFICATION MEANS, without a host (hk_core; tested on its own):

    kind_of(domain, device_class, object_id)   the accessory's kind
    choices(kind)                    its Goes Off When choices [(key, label)]
    fires(kind, when, old, new)      did this change set it off
    words(kind, when, name, new)     the automatic title and message
    look(kind, new)                  its icon and tint
    buttons(kind, new, camera)       the buttons the opened banner shows

A state here is (state, attributes) or None. A change from or to
unavailable / unknown never sets one off -- that is Home Assistant starting or
a device dropping out, not something happening -- except an event entity's
first event (unknown is its state until it has had one).
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

State = tuple[str, Mapping[str, Any]] | None

GONE = ("unavailable", "unknown", "")

# binary sensors, by what they sense: (kind, on words, off words)
_BIN = {
    "motion": "motion", "moving": "motion", "occupancy": "presence", "presence": "presence",
    "door": "door", "garage_door": "door", "opening": "door", "window": "window",
    "moisture": "leak", "smoke": "smoke", "gas": "smoke", "carbon_monoxide": "co", "safety": "alarm",
    "problem": "problem", "tamper": "problem", "vibration": "vibration", "sound": "sound",
}
# what a camera's detection sensor names itself (UniFi Protect: "... Person detected")
_SEEN = (("person", "person"), ("vehicle", "vehicle"), ("animal", "animal"), ("package", "package"),
         ("doorbell", "doorbell"), ("face", "person"), ("license_plate", "vehicle"))

# WHAT A CAMERA SEES: their sheet is the camera's, live (a person at the door,
# the doorbell, a package) -- every other accessory's is its own
CAMERA_KINDS = ("person", "vehicle", "animal", "package", "doorbell")

_CHOICES: dict[str, list[tuple[str, str]]] = {
    "motion": [("on", "Detects Motion"), ("off", "Stops Detecting")],
    "presence": [("on", "Detects Someone"), ("off", "Stops Detecting")],
    "person": [("on", "Detects a Person"), ("off", "Stops Detecting")],
    "vehicle": [("on", "Detects a Vehicle"), ("off", "Stops Detecting")],
    "animal": [("on", "Detects an Animal"), ("off", "Stops Detecting")],
    "package": [("on", "Detects a Package"), ("off", "Stops Detecting")],
    "doorbell": [("on", "Rings")],
    "door": [("on", "Opens"), ("off", "Closes"), ("any", "Either")],
    "window": [("on", "Opens"), ("off", "Closes"), ("any", "Either")],
    "leak": [("on", "Detects Water"), ("off", "Dries")],
    "smoke": [("on", "Detects Smoke"), ("off", "Clears")],
    "co": [("on", "Detects CO"), ("off", "Clears")],
    "alarm": [("on", "Goes Off"), ("off", "Clears")],
    "problem": [("on", "Reports a Problem"), ("off", "Clears")],
    "vibration": [("on", "Detects Vibration"), ("off", "Stops")],
    "sound": [("on", "Detects Sound"), ("off", "Stops")],
    "binary": [("on", "Turns On"), ("off", "Turns Off"), ("any", "Either")],
    "people": [("home", "Arrives Home"), ("not_home", "Leaves Home"), ("any", "Either")],
    "lock": [("unlocked", "Unlocks"), ("locked", "Locks"), ("jammed", "Jams"), ("any", "Any Change")],
    "garage": [("open", "Opens"), ("closed", "Closes"), ("any", "Either")],
    "cover": [("open", "Opens"), ("closed", "Closes"), ("any", "Either")],
    "alarm_panel": [("triggered", "Is Triggered"), ("armed", "Is Armed"), ("disarmed", "Is Disarmed"),
                    ("any", "Any Change")],
    "event": [("any", "Goes Off")],
    "switch": [("on", "Turns On"), ("off", "Turns Off"), ("any", "Either")],
    # (a timer's state goes active -> idle whether it finishes or is cancelled)
    "timer": [("finished", "Ends"), ("active", "Starts")],
    "vacuum": [("done", "Finishes Cleaning"), ("error", "Needs Help"), ("cleaning", "Starts Cleaning")],
    "state": [("any", "Changes")],
    # a camera's: whatever its trigger detects
    "camera": [("on", "Detects Activity")],
    # a calendar's: an event coming up -- how long before it starts (minutes)
    "calendar": [("0", "At the Start"), ("5", "5 Minutes Before"), ("10", "10 Minutes Before"),
                 ("15", "15 Minutes Before"), ("30", "30 Minutes Before"), ("60", "1 Hour Before")],
}

# (icon, tint) by kind -- tints are HK's palette (Home app colors)
BLUE, ORANGE, RED, GREEN, TEAL, BROWN, GRAY, YELLOW = (
    "#0a84ff", "#ff9f0a", "#ff3b30", "#34c759", "#30b0c7", "#a2845e", "#8e8e93", "#ffcc00")
_LOOK = {
    "motion": ("hk:motion-sensor", BLUE), "presence": ("hk:motion-sensor", BLUE), "person": ("hk:walk", BLUE),
    "vehicle": ("hk:car", BLUE), "animal": ("hk:paw", BLUE), "package": ("hk:package-variant", BROWN),
    "doorbell": ("hk:doorbell-video", ORANGE), "door": ("hk:door-open", ORANGE),
    "window": ("hk:window-open-variant", ORANGE), "leak": ("hk:water-alert", RED),
    "smoke": ("hk:smoke-detector", RED), "co": ("hk:molecule-co", RED), "alarm": ("hk:shield-alert", RED),
    "problem": ("hk:alert-circle", RED), "vibration": ("hk:alert-circle", ORANGE), "sound": ("hk:volume-high", BLUE),
    "binary": ("hk:toggle-switch", GRAY), "people": ("hk:location-enter", GREEN), "lock": ("hk:lock-open-variant", ORANGE),
    "garage": ("hk:garage-open", ORANGE), "cover": ("hk:roller-shade", ORANGE), "alarm_panel": ("hk:shield-home", RED),
    "event": ("hk:bell", BLUE), "switch": ("hk:power-plug", YELLOW), "timer": ("hk:timer-sand", ORANGE),
    "vacuum": ("hk:robot-vacuum", TEAL), "camera": ("hk:camera", BLUE), "calendar": ("mdi:calendar", RED),
    "state": ("hk:bell", GRAY),
}
# an Important notification by default: what you'd want to see whatever the hour
IMPORTANT = ("leak", "smoke", "co", "alarm", "alarm_panel")


def kind_of(domain: str, device_class: str | None, object_id: str = "") -> str:
    """The accessory's kind: what its choices, words and icon are."""
    dc = (device_class or "").lower()
    oid = (object_id or "").lower()
    if domain == "binary_sensor":
        for word, kind in _SEEN:
            if oid.endswith(word + "_detected") or (word == "doorbell" and oid.endswith(word)):
                return kind
        return _BIN.get(dc, "binary")
    if domain == "event":
        if dc == "doorbell" or "doorbell" in oid:
            return "doorbell"
        for word, kind in _SEEN:
            if word in oid:
                return kind
        return "event"
    if domain == "person":
        return "people"
    if domain == "lock":
        return "lock"
    if domain == "cover":
        return "garage" if dc in ("garage", "gate") else "cover"
    if domain == "alarm_control_panel":
        return "alarm_panel"
    if domain in ("switch", "input_boolean", "light", "fan"):
        return "switch"
    if domain == "timer":
        return "timer"
    if domain == "vacuum":
        return "vacuum"
    if domain == "camera":
        return "camera"
    if domain == "calendar":
        return "calendar"
    return "state"


def choices(kind: str) -> list[tuple[str, str]]:
    return list(_CHOICES.get(kind) or _CHOICES["state"])


def default_when(kind: str) -> str:
    return choices(kind)[0][0]


def _s(st: State) -> str:
    return st[0] if st else ""


def fires(kind: str, when: str, old: State, new: State, event: bool = False) -> bool:
    """Whether the change old -> new sets off a notification that goes off
    `when`. `event`: an event entity, whose state is the time of its last
    event -- any new time is one, but not the one restored at a start (no old
    state) or after the device was unavailable."""
    o, n = _s(old), _s(new)
    if new is None or n in GONE:
        return False
    if event:
        return old is not None and o != "unavailable" and n != o
    if old is None or o in GONE or o == n:
        return False
    if kind == "people":
        if when == "home":
            return n == "home"
        if when == "not_home":
            return o == "home"
        return (o == "home") != (n == "home")
    if kind in ("garage", "cover"):
        opening = n in ("open", "opening") and o in ("closed", "closing")
        closed = n == "closed"
        return opening if when == "open" else closed if when == "closed" else (opening or closed)
    if kind == "lock":
        unlocked = ("unlocked", "open")          # some locks go open -> unlocked: one Unlocks
        if when == "any":
            return n in ("locked", "jammed") or (n in unlocked and o not in unlocked)
        if when == "unlocked":
            return n in unlocked and o not in unlocked
        return n == when
    if kind == "alarm_panel":
        if when == "armed":
            return n.startswith("armed_") and not o.startswith("armed_")
        return n == when if when != "any" else True
    if kind == "vacuum":
        if when == "done":            # back on its dock from a run (cleaning, returning, paused)
            return n == "docked" and o in ("cleaning", "returning", "paused")
        if when == "error":
            return n == "error"
        return n == "cleaning" and o not in ("cleaning", "paused", "returning")
    if kind == "timer":
        if when == "finished":
            return o == "active" and n == "idle"
        return n == "active" and o != "paused"
    if when == "any":
        return True
    return n == when


def _first(name: str) -> str:
    return (name or "").strip().split(" ")[0] or name


def words(kind: str, when: str, name: str, new: State, fired_on: str | None = None) -> tuple[str, str]:
    """(title, message) when nobody typed their own. `fired_on` is the state
    that set it off (an Either knows which way it went)."""
    n = fired_on if fired_on is not None else _s(new)
    if kind == "people":
        first = _first(name)
        if n == "home":
            return "%s arrived" % first, "%s is home." % first
        return "%s left" % first, "%s left home." % first
    msg = {
        "motion": ("Motion detected.", "Motion stopped."),
        "presence": ("Someone is there.", "Nobody is there now."),
        "person": ("Person detected.", "Nobody is there now."),
        "vehicle": ("Vehicle detected.", "The vehicle is gone."),
        "animal": ("Animal detected.", "The animal is gone."),
        "package": ("A package was delivered.", "The package is gone."),
        "doorbell": ("Someone rang the doorbell.", ""),
        "door": ("Opened.", "Closed."), "window": ("Opened.", "Closed."),
        "leak": ("Water detected.", "It’s dry again."),
        "smoke": ("Smoke detected.", "The smoke has cleared."),
        "co": ("Carbon monoxide detected.", "The carbon monoxide has cleared."),
        "alarm": ("Went off.", "Cleared."), "problem": ("Reports a problem.", "The problem has cleared."),
        "vibration": ("Vibration detected.", "Stopped."), "sound": ("Sound detected.", "Quiet again."),
        "binary": ("Turned on.", "Turned off."), "switch": ("Turned on.", "Turned off."),
        "event": ("Went off.", ""),
    }
    if kind == "camera":
        return name, "Activity detected."
    if kind in msg:
        on = n != "off"
        return name, msg[kind][0 if on else 1] or msg[kind][0]
    if kind == "lock":
        return name, {"locked": "Locked.", "unlocked": "Unlocked.", "open": "Unlocked.", "jammed": "Jammed.",
                      "locking": "Locking.", "unlocking": "Unlocking."}.get(n, "Changed.")
    if kind in ("garage", "cover"):
        return name, "Opened." if n in ("open", "opening") else "Closed." if n == "closed" else "Changed."
    if kind == "alarm_panel":
        return name, {"triggered": "The alarm is going off.", "disarmed": "Disarmed."}.get(
            n, "Armed." if n.startswith("armed_") else "Changed.")
    if kind == "timer":
        return name, "Ended." if n == "idle" else "Started."
    if kind == "vacuum":
        return name, {"docked": "Finished cleaning.", "error": "Needs help.", "cleaning": "Started cleaning."}.get(n, "Changed.")
    return name, "Changed to %s." % n if n else "Changed."


def look(kind: str, new: State = None) -> tuple[str, str]:
    """(icon, tint)."""
    icon, tint = _LOOK.get(kind, _LOOK["state"])
    n = _s(new)
    if kind == "lock" and n == "locked":
        icon = "hk:lock"
    if kind == "garage" and n == "closed":
        icon = "hk:garage"
    if kind == "door" and n == "off":
        icon = "hk:door-closed-lock"
    return icon, tint


def buttons(kind: str, new: State, camera: str | None) -> list[dict[str, str]]:
    """The opened banner's buttons: what the accessory can do about it now,
    and the camera. Each is {id, label, icon}; `id` is what the screen does
    (hk-notify.js): close / open / lock / camera."""
    out: list[dict[str, str]] = []
    n = _s(new)
    if kind in ("garage", "cover") and n in ("open", "opening"):
        out.append({"id": "close", "label": "Close", "icon": "hk:garage" if kind == "garage" else "hk:roller-shade"})
    if kind in ("garage", "cover") and n == "closed":
        out.append({"id": "open", "label": "Open", "icon": "hk:garage-open" if kind == "garage" else "hk:roller-shade"})
    if kind == "lock" and n in ("unlocked", "open", "jammed"):
        out.append({"id": "lock", "label": "Lock", "icon": "hk:lock"})
    if camera:
        out.append({"id": "camera", "label": "Open Camera", "icon": "hk:camera"})
    return out


# CATEGORIES: the accessories of one kind, found by themselves (and those
# added later), notified alike -- one setting for all of them, each banner
# its own accessory's. (key, label, kinds, its icon and tint, its starting
# settings: what new_item gives a category)
CATEGORIES: list[tuple[str, str, tuple[str, ...], dict[str, Any]]] = [
    ("doors", "Doors", ("door",), {"when": "on"}),
    ("windows", "Windows", ("window",), {"when": "on"}),
    ("locks", "Locks", ("lock",), {"when": "unlocked"}),
    ("garage", "Garage Doors", ("garage",), {"when": "open"}),
    ("leaks", "Leaks", ("leak",), {"when": "on", "important": True, "wake": True, "stay": 0}),
    ("smoke", "Smoke & CO", ("smoke", "co"), {"when": "on", "important": True, "wake": True, "stay": 0}),
    ("people", "People Arriving & Leaving", ("people",), {"when": "home"}),
    # CAMERAS: each camera with the sensor that sets it off (its own device's
    # person or motion detection, suggested; any binary sensor or event you
    # pick) and the camera its snapshot and live view come from
    ("cameras", "Cameras", ("camera",), {"when": "on", "snap": True, "cooldown": 300, "tap": "camera"}),
    ("packages", "Packages", ("package",), {"when": "on", "snap": True, "cooldown": 900, "tap": "camera"}),
    ("doorbells", "Doorbells", ("doorbell",), {"when": "on", "snap": True, "pop": "doorbell", "tap": "camera"}),
    ("vacuums", "Vacuums", ("vacuum",), {"when": "done"}),
    # CALENDARS: an event coming up, the chosen time before it starts (the
    # house looks ahead every minute -- hk_core/notifications/calendars.py)
    ("calendars", "Calendars", ("calendar",), {"when": "15", "tap": "sheet", "allday": "08:00"}),
    ("alarms", "Alarm", ("alarm_panel",), {"when": "triggered", "important": True, "wake": True, "stay": 0}),
]
CATEGORY_KEYS = tuple(c[0] for c in CATEGORIES)


def category(key: str) -> tuple[str, str, tuple[str, ...], dict[str, Any]] | None:
    return next((c for c in CATEGORIES if c[0] == key), None)


def category_of(kind: str) -> str | None:
    """The category an accessory of this kind falls in, or None."""
    return next((c[0] for c in CATEGORIES if kind in c[2]), None)


def _clock(t: Any) -> str:
    return t.strftime("%-I:%M %p")


def calendar_words(summary: str, start: Any, end: Any, lead: int, location: str = "") -> tuple[str, str]:
    """An event coming up, as its banner says it: (its name, "In 15 minutes
    · 10:30 – 11:00 AM · the place"). `start`/`end` local datetimes."""
    when = "Starting now" if lead <= 0 else ("In 1 hour" if lead == 60 else "In %d minutes" % lead)
    span = _clock(start)
    if end is not None and end > start:
        a, b = _clock(start), _clock(end)
        # one AM/PM when both share it: "10:30 – 11:00 AM"
        span = (a[:-3] + " – " + b) if a[-2:] == b[-2:] and end.date() == start.date() else (a + " – " + b)
    parts = [when, span] + ([location.strip()] if location and location.strip() else [])
    return (summary or "Event").strip(), " · ".join(parts)


# All-Day Events: the morning they start, at one of these (or Off)
ALLDAY_TIMES = ("06:00", "07:00", "08:00", "09:00", "10:00")


def allday_words(summary: str, location: str = "") -> tuple[str, str]:
    """An all-day event, the morning it starts: (its name, "Today · All Day
    · the place")."""
    parts = ["Today", "All Day"] + ([location.strip()] if location and location.strip() else [])
    return (summary or "Event").strip(), " · ".join(parts)
