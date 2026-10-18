"""A WALL TABLET'S SCREENSAVER: what it reads, when the screen is in use, and who may say so.

Each tablet (entry 1.14: a tablet's own, no longer a screen's) has a photos switch (on while
its photos show), a black screen switch, an in-use sensor (on while the screen was touched
within its window: Starts After less a minute) and its Sleep Screen. The rules here are about
those; the host makes and keeps the entities.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import datetime
import json
from typing import Any

from ..house import House

SWITCH_KEY = "photo_screensaver"
BLACK_KEY = "black_screen"
INUSE_KEY = "screen_in_use"
MARGIN = 60                    # s: the window is Starts After less this
MIN_WINDOW = 15

# A tablet's entities: (kind, platform). The kinds are how the host keys them per tablet, and
# what Sleep Screen reads: the photos switch, the black screen switch, the in-use sensor and
# the Sleep Screen sensor.
KINDS: tuple[tuple[str, str], ...] = (("switch", "switch"), ("black", "switch"),
                                      ("binary_sensor", "binary_sensor"), ("sleep", "sensor"))
# Sleep Screen decided by HK Frontend (or watched in shadow): the tablet gets an engine
DECIDING = ("hk", "shadow")
ANYONE = object()              # tablets_on: not sorted by who is signed in


def window_of(starts_after: int) -> int:
    """The in-use window for a Starts After: a minute less, so the photos can
    only come up after the screen has stopped counting as in use (the house's
    reconciler and the screensaver can never disagree about who goes first)."""
    return max(MIN_WINDOW, int(starts_after) - MARGIN)


def starts_after(board: Mapping[str, Any]) -> int:
    """A tablet's Starts After (s), from its board (as_board)."""
    return int(board["screensaver_options"]["starts_after"])


def in_use(touch: datetime | None, starts_after_s: int, now: datetime) -> bool:
    """Whether the screen is in use: touched within its window. Only a person can touch the
    page; no command to the tablet's browser can fake it."""
    if touch is None:
        return False
    return (now - touch).total_seconds() < window_of(starts_after_s)


def as_board(t: Mapping[str, Any], b: Mapping[str, Any]) -> dict[str, Any]:
    """What Sleep Screen and the entities read, in the shape they always
    read it: the tablet's Sleep Screen and Black Screen, its screen's
    screensaver options (Starts After), the screen's path and the tablet's
    user and room. `t`: the tablet's settings; `b`: its screen's, resolved."""
    return {"sleep": t["sleep"], "black_screen": t["black_screen"],
            "screensaver_options": b["screensaver_options"], "screensaver": b["screensaver"],
            "dashboard": t["screen"], "tablet_user": t["user"], "idle_room": t["room"],
            "notify": b.get("notify", True), "notify_dnd": b.get("notify_dnd")}


def wanted(items: Mapping[str, Any], tabs: Mapping[str, Mapping[str, Any]],
           screen_board: Callable[[str], Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """The tablets, each with what its entities and Sleep Screen read: `{tablet id: {"sub": its
    item, "tablet": its settings, "board": as_board}}`. `items`: {tablet id: the host's item for
    it}, in the host's order; `tabs`: every tablet's settings; `screen_board(path)`: the
    resolved settings of the screen a tablet runs (a missing screen's: the defaults)."""
    out: dict[str, dict[str, Any]] = {}
    for tid, sub in items.items():
        if tid not in tabs:
            continue
        t = tabs[tid]
        out[tid] = {"sub": sub, "tablet": t, "board": as_board(t, screen_board(t["screen"]))}
    return out


def tablets_on(want: Mapping[str, Mapping[str, Any]], path: str, user: Any = ANYONE) -> list[str]:
    """The tablets running screen `path` -- those signed in as `user` (a user's name; None: a
    user without one) first, when given."""
    mine = [tid for tid, w in want.items() if w["tablet"]["screen"] == path]
    if user is not ANYONE:
        mine.sort(key=lambda tid: want[tid]["board"]["tablet_user"] != user)
    return mine


def may_speak_for(owner: str, *, signed_in: bool, admin: bool, name: str | None) -> bool:
    """Whether a page may speak for a tablet (a touch, its black): only the tablet's own user,
    an admin, or anyone for a tablet with no user (Just a Browser, known by its URL) -- a desk
    opening the same screen is not the tablet."""
    return bool(signed_in and (admin or not owner or name == owner))


def attributes(tid: str, board: Mapping[str, Any], touch: datetime | None) -> dict[str, Any]:
    """The attributes every tablet entity carries: its tablet and screen, Starts After, the
    in-use window and the last touch."""
    sa = starts_after(board)
    return {"tablet": tid, "dashboard": board.get("dashboard") or None,
            "starts_after": sa, "in_use_window": window_of(sa),
            "last_touch": touch.isoformat() if touch else None}


def legacy_helper(house: House, room: str | None) -> str | None:
    """The 1.2 docs' helper for a tablet's room (input_boolean.wallpanel_screensaver_<room>),
    while the house has it: the photos switch mirrors it both ways, so the house's automations
    keep working and it moves to the switch in its own time. None once it is deleted."""
    eid = f"input_boolean.wallpanel_screensaver_{room}" if room else None
    return eid if eid and house.state(eid) is not None else None


def legacy_says(state: str | None) -> bool | None:
    """What the old helper's new state says the photos are: on, off, or nothing (unknown)."""
    return state == "on" if state in ("on", "off") else None


def legacy_mirror(house: House, legacy: str | None, on: bool) -> tuple[str, str, dict[str, Any]] | None:
    """The photos switch turned on or off: the call that brings the old helper along, or None
    (no helper, or it says so already). (domain, service, data)."""
    st = house.state(legacy) if legacy else None
    if st is None or (st.state == "on") == on:
        return None
    return ("input_boolean", "turn_on" if on else "turn_off", {"entity_id": legacy})


def deciding(board: Mapping[str, Any]) -> bool:
    """Whether HK Frontend decides when the tablet sleeps (or watches in shadow)."""
    return (board.get("sleep") or {}).get("decided_by") in DECIDING


def engine_key(board: Mapping[str, Any], ids: Mapping[str, str | None]) -> str:
    """What a tablet's Sleep Screen engine is built from (its board's sleep, black screen and
    screensaver options, and its entities' ids): the same key, the same engine."""
    return json.dumps([board.get("sleep"), board.get("black_screen"), board.get("screensaver_options"), ids],
                      sort_keys=True, default=str)


def ids_of(have: Mapping[str, Mapping[str, str | None]], kind: str) -> dict[str, str]:
    """{tablet: entity id} of each tablet's entity of one kind that has an id."""
    out: dict[str, str] = {}
    for tid, ids in have.items():
        eid = ids.get(kind)
        if eid:
            out[tid] = eid
    return out


def named(have: Mapping[str, Mapping[str, str | None]]) -> dict[str, dict[str, str | None]]:
    """{tablet: {"switch", "in_use", "black", "sleep": entity id or None}}, for the settings
    page, which names them on the tablet's page."""
    return {tid: {"switch": ids.get("switch"), "in_use": ids.get("binary_sensor"),
                  "black": ids.get("black"), "sleep": ids.get("sleep")} for tid, ids in have.items()}
