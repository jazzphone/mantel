"""model.py's text fields (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import re
from typing import Any
from ...house import House


# ------------------------------------------------------------ text fields
# Two settings are small tables. The UI edits them as plain text, one row per
# line, because a list-of-objects selector does not exist -- and a format
# a person can read back is better than one only a form can.
_BIRTHDAY = re.compile(r"^\s*(.+?)\s+(\d{1,2})-(\d{1,2})\s*$")

_ROOM = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=\s*([a-z0-9_]+)\s*$")


def parse_birthdays(text: str) -> list[dict[str, Any]] | None:
    """'Name MM-DD' per line -> [{name, month, day}], or None if a line is bad."""
    out = []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        m = _BIRTHDAY.match(line)
        if not m:
            return None
        month, day = int(m.group(2)), int(m.group(3))
        if not (1 <= month <= 12 and 1 <= day <= 31):
            return None
        out.append({"name": m.group(1), "month": month, "day": day})
    return out


def format_birthdays(rows: list[dict[str, Any]]) -> str:
    return "\n".join(f"{b['name']} {b['month']:02d}-{b['day']:02d}" for b in rows or [])


def parse_rooms(text: str) -> dict[str, str] | None:
    """'dashboard-kitchen = kitchen' per line -> {dashboard: room}, or None."""
    out = {}
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        m = _ROOM.match(line)
        if not m:
            return None
        out[m.group(1)] = m.group(2)
    return out


def format_rooms(rooms: dict[str, str]) -> str:
    return "\n".join(f"{d} = {r}" for d, r in (rooms or {}).items())


def suggestions(house: House) -> dict[str, Any]:
    """What a house that has never saved Status & Chips probably wants: every
    lock, every door and window contact, every garage door -- a garage_door
    contact or a garage/gate COVER (the door itself is usually a cover; a
    contact named "Garage Door" is often the door INTO the garage, and its
    device_class says door, so it is offered as one). Offered as the
    form's starting point only -- nothing is saved until the form is."""
    doors, windows, garage, locks = [], [], [], []
    alarm = None
    for st in sorted(house.states(), key=lambda s: s.entity_id):
        eid, dc = st.entity_id, st.attributes.get("device_class")
        if eid.startswith("lock."):
            locks.append(eid)
        elif eid.startswith("alarm_control_panel.") and alarm is None:
            alarm = eid
        elif eid.startswith("binary_sensor.") and dc == "door":
            doors.append(eid)
        elif eid.startswith("binary_sensor.") and dc == "window":
            windows.append(eid)
        elif eid.startswith("binary_sensor.") and dc == "garage_door":
            garage.append(eid)
        elif eid.startswith("cover.") and dc in ("garage", "gate"):
            garage.append(eid)
    return {"alarm": alarm, "locks": locks, "doors": doors, "windows": windows,
            "garage": garage}
