"""DO NOT DISTURB: its shape (All Screens' and a screen's own) and when it is on.

The screens apply the same rule in the browser (hk-notify.js dndOn); the house applies it here
when it decides which screens a notification wakes. `hhmm` and `notify_dnd` are also the HA
host's settings checks (settings.py re-exports them), so a screen's DND and All Screens' are
read the one way.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from ..house import House

DND_MAX = 10
_ENTITY_ID = re.compile(r"[a-z0-9_]+\.[a-z0-9_]+")
# what counts as "on" for an entity listed under While (a timer while it runs)
ON_STATES = ("on", "active", "home", "open", "playing")


def hhmm(v: Any) -> str | None:
    """A time of day as "HH:MM", or None."""
    if not isinstance(v, str):
        return None
    try:
        h, m = (int(x) for x in v.strip().split(":")[:2])
    except ValueError:
        return None
    return "%02d:%02d" % (h, m) if 0 <= h < 24 and 0 <= m < 60 else None


def notify_dnd(v: Any) -> dict[str, Any] | None:
    """Do Not Disturb for notifications: {"schedule": bool, "from": "HH:MM",
    "to": "HH:MM", "while": [entity ids]} -- on during the hours (they may wrap
    midnight; from == to is all day) when `schedule`, and while any entity
    listed is on (an input_boolean, a switch; a timer while it runs). None
    when `v` is not one; a screen's None follows All Screens."""
    if not isinstance(v, dict):
        return None
    ids = [x for x in (v.get("while") or []) if isinstance(x, str) and _ENTITY_ID.fullmatch(x)]
    return {"schedule": v.get("schedule") is True, "from": hhmm(v.get("from")) or "22:00",
            "to": hhmm(v.get("to")) or "07:00", "while": list(dict.fromkeys(ids))[:DND_MAX]}


def dnd_on(house: House, dnd: dict[str, Any] | None, now: datetime | None = None) -> bool:
    """Do Not Disturb on now (hk-notify.js dndOn, the same rule): in its
    hours when scheduled (they may run past midnight; from == to is all
    day), or while an entity listed is on (a timer while it runs)."""
    if not dnd:
        return False
    if dnd.get("schedule"):
        local = house.local_time(now)
        n = local.hour * 60 + local.minute
        try:
            a, b = (int(str(x).split(":")[0]) * 60 + int(str(x).split(":")[1]) for x in (dnd.get("from"), dnd.get("to")))
        except (ValueError, IndexError):
            a = b = None
        if a is not None and b is not None and (a == b or (a <= n < b if a < b else (n >= a or n < b))):
            return True
    for eid in dnd.get("while") or []:
        st = house.state(eid)
        if st is not None and st.state in ON_STATES:
            return True
    return False
