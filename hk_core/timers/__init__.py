"""Timers people set (phase 21, docs/phase21/TIMER-SLIDE.md), the rules with no host in them.

Which timers count, how a duration is read, and above all WHETHER A TIMER REALLY ENDED. Home Assistant runs the countdown;
a host keeps a copy of each timer's end time, because across a restart of either it may never see the timer go from active
to idle, and a timer that ended while Home Assistant was down comes back idle with no end time at all (measured on a scratch
Home Assistant, 2026-11-08). Comparing that copy with the state is the only test that survives both. Cancel and Finish stay
silent: the state goes idle before the end time.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

QUICK = re.compile(r"^timer\.quick_(\d+)$")
MADE = re.compile(r"^timer\.hk_timer_(\d+)$")
SENSOR = "sensor.running_quick_timers"
SCRIPTS = {"quick_timer_start": "start", "quick_timer_create": "create"}
MARGIN = 2.0            # seconds: an end this close to its time is an end (a press of Finish in the last moment is one too)
LATE_RING = 600.0       # seconds: ended longer ago than this (the host was down), it says so instead of ringing
MAX_MADE = 12           # timers a host may make at once
MAX_NAME = 40
GONE_AFTER = 600.0      # seconds: a made timer missing this long (Home Assistant is up) is taken as deleted


def is_made(entity_id: str) -> bool:
    return bool(MADE.match(entity_id))


def counts(entity_id: str, ignore: Iterable[str] = ()) -> bool:
    """A timer someone set: a quick slot or one a host made, and not on the House Timers list (Night, Nap and the rest).
    Never the rest of the house's timers, which are mostly automations' plumbing."""
    return bool(QUICK.match(entity_id) or MADE.match(entity_id)) and entity_id not in ignore


def object_id(entity_id: str) -> str:
    """What timer/update and timer/delete call it: a helper's id is its entity id's object id."""
    return entity_id.split(".", 1)[1]


def next_number(taken: Iterable[str]) -> int:
    """The lowest free number of a made timer."""
    used = {int(m.group(1)) for m in (MADE.match(e) for e in taken) if m}
    n = 1
    while n in used:
        n += 1
    return n


def clean_name(name: Any) -> str:
    text = " ".join(str(name).split()) if isinstance(name, str) else ""
    return "".join(c for c in text if c.isprintable())[:MAX_NAME].strip() or "Timer"


def duration_secs(value: Any) -> int:
    """HH:MM:SS (or MM:SS, or seconds), as the Start buttons send it. 0 when it can't be read."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return 0
    parts = str(value).strip().split(":")
    if not parts or len(parts) > 3 or not all(p.isdigit() for p in parts):
        return 0
    total = 0
    for p in parts:
        total = total * 60 + int(p)
    return total


def digits_secs(value: Any) -> int:
    """The keypad, as helpers/quick_timers.yaml reads it: up to four digits, right-aligned into HHMM. 5 is five minutes,
    130 an hour and a half, 90 ninety minutes."""
    text = str(value if not isinstance(value, bool) and value is not None else "").strip()[-4:]
    if not text.isdigit():
        return 0
    padded = text.zfill(4)
    return int(padded[:2]) * 3600 + int(padded[2:]) * 60


def hms(secs: int) -> str:
    return f"{secs // 3600:02d}:{secs // 60 % 60:02d}:{secs % 60:02d}"


def when(value: Any) -> float | None:
    """An ISO time as epoch seconds, or None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def judge(deadline: float | None, state: str | None, now: float) -> str:
    """'counting' (active or paused), 'wait' (Home Assistant can't say: it is starting, or the timer isn't there yet),
    'ended' (idle at or past its time) or 'stopped' (idle before it: Cancel, Finish, or a slot that was never running)."""
    if state in ("active", "paused"):
        return "counting"
    if state != "idle":
        return "wait"
    return "ended" if deadline is not None and deadline <= now + MARGIN else "stopped"


def is_late(deadline: float, now: float) -> bool:
    """Ended too long ago to ring for: the host was down. It says when it ended instead."""
    return now - deadline > LATE_RING


def name_of(states: Mapping[str, Mapping[str, Any]], entity_id: str) -> str:
    """A quick slot's name is in its helper; a made timer's is its own."""
    m = QUICK.match(entity_id)
    if m:
        slot = states.get(f"input_text.quick_timer_{m.group(1)}_name")
        given = slot.get("s") if slot else None
        if given not in (None, "", "unknown", "unavailable"):
            return str(given)
        return "Timer"
    st = states.get(entity_id) or {}
    return str((st.get("a") or {}).get("friendly_name") or "Timer")


def sensor_attributes(states: Mapping[str, Mapping[str, Any]], ignore: Iterable[str] = ()) -> tuple[int, dict[str, Any]]:
    """(how many are running, the attributes of sensor.running_quick_timers) over every timer that counts, with the same
    `running` rows the helpers' own sensor gives, soonest first, and `made`: the made timers running or paused, so a card
    can list them without walking every state."""
    ignored = set(ignore)
    rows, made = [], []
    for eid, st in states.items():
        if not eid.startswith("timer.") or not counts(eid, ignored):
            continue
        s = st.get("s")
        if is_made(eid) and s in ("active", "paused"):
            made.append(eid)
        if s == "active":
            rows.append({"entity_id": eid, "name": name_of(states, eid), "finishes_at": (st.get("a") or {}).get("finishes_at")})
    rows.sort(key=lambda r: (r["finishes_at"] or "", r["entity_id"]))
    return len(rows), {"friendly_name": "Running Quick Timers", "icon": "mdi:timer-outline", "state_class": "measurement",
                       "running": rows, "made": sorted(made)}
