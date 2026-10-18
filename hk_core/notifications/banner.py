"""WHAT GOES TO THE SCREENS, and when.

    goes_off(...)        the notifications a state change sets off: Goes Off When (rules.fires),
                         Only When, Mute 1 Hour, Not Again For
    build(...)           a notification's payload (the snapshot's id is added once taken)
    build_action(...)    an automation's own (the host's notify action), the same payload
    mutes / set_mute     Mute 1 Hour, kept by the host in a plain dict (key -> until, epoch s)

Every screen gets the same payload and decides for itself whether to show it (hk-notify.js).
The host takes the snapshot, sends the payload and wakes the screens.
"""
from __future__ import annotations

import time
import uuid
from collections.abc import Mapping
from typing import Any

from ..house import House, State
from . import rules
from .accessories import Pins, camera_for, camera_pairs, describe, keypad_for, kind, members, name_of, no_pins
from .const import (CONF_CHIME, CONF_DND, CONF_ITEMS, CONF_SAVER, CONF_STAY, CONF_WAKE, DEFAULTS, MUTE_S, WAKE_MAX_S,
                    WAKE_MIN_S)


def options(raw: Mapping[str, Any]) -> dict[str, Any]:
    """The feature's options, every key there (DEFAULTS)."""
    o = dict(raw)
    return {**DEFAULTS, **{k: v for k, v in o.items() if k in DEFAULTS}, CONF_ITEMS: list(o.get(CONF_ITEMS) or [])}


# ------------------------------------------------------------- Mute 1 Hour
def mute_key(item: dict[str, Any], eid: str | None) -> str | None:
    """What Mute 1 Hour mutes: the notification, and for a category (or a
    calendar's events) the accessory that went off -- None for an
    automation's own (no item)."""
    sid = item.get("id")
    return "%s:%s" % (sid, eid or item.get("entity") or "") if sid else None


def mutes(store: dict[str, float], now: float | None = None) -> dict[str, float]:
    """The mutes still running (key -> until), the ones run out forgotten."""
    now = time.time() if now is None else now
    for k in [k for k, v in store.items() if v <= now]:
        del store[k]
    return dict(store)


def muted(store: dict[str, float], key: str | None, now: float | None = None) -> bool:
    return bool(key) and key in mutes(store, now)


def set_mute(store: dict[str, float], key: str, seconds: int = MUTE_S, now: float | None = None) -> float | None:
    """Mute `key` for `seconds` (0: unmute). Until when, or None."""
    now = time.time() if now is None else now
    if seconds <= 0:
        store.pop(key, None)
        return None
    store[key] = now + seconds
    return store[key]


# ------------------------------------------------------------- Only When
def only_ok(house: House, only: str) -> bool:
    """Only When: always, while someone is home, while nobody is, at night."""
    if only in ("home", "away"):
        z = house.state("zone.home")
        try:
            n = int(float(z.state)) if z is not None else None
        except ValueError:
            n = None
        if n is None:
            return True               # not known: not held back
        return n > 0 if only == "home" else n == 0
    if only == "night":
        sun = house.state("sun.sun")
        return sun is None or sun.state == "below_horizon"
    return True


def _pair(st: State | None) -> rules.State:
    return (st.state, dict(st.attributes)) if st is not None else None


def goes_off(house: House, items: list[dict[str, Any]], watched: Mapping[str, Any], eid: str,
             old: State | None, new: State | None, *, last: dict[str, float], mute: dict[str, float],
             now: float | None = None, epoch: float | None = None) -> list[dict[str, Any]]:
    """The notifications the change old -> new of `eid` sets off, in their order. `watched`:
    item id -> what it watches (members). `last` (key -> when it last went off, on the
    monotonic `now`) is Not Again For's, kept per accessory and recorded here; `mute` is Mute
    1 Hour's store (`epoch`: now, in epoch seconds)."""
    o, n = _pair(old), _pair(new)
    now = time.monotonic() if now is None else now
    out = []
    for item in items:
        if eid not in watched.get(str(item.get("id")), ()):
            continue
        k = kind(house, eid)
        when = item.get("when") or rules.default_when(k)
        if not rules.fires(k, when, o, n, event=eid.startswith("event.")):
            continue
        if not only_ok(house, item.get("only") or "always"):
            continue
        # Mute 1 Hour: that accessory of that notification, quiet
        if muted(mute, mute_key(item, eid), epoch):
            continue
        # Not Again For: per accessory (a category's doors each their own)
        key = "%s:%s" % (item.get("id"), eid)
        cool = int(item.get("cooldown") or 0)
        if cool and now - last.get(key, -1e9) < cool:
            continue
        last[key] = now
        out.append(item)
    return out


# ------------------------------------------------------------- the payload
def initials(name: str) -> str:
    parts = [p for p in name.replace("-", " ").split() if p[:1].isalpha()]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


def build(house: House, opts: dict[str, Any], item: dict[str, Any], new: State | None,
          test: bool = False, eid: str | None = None, pins: Pins = no_pins) -> dict[str, Any]:
    """What goes to the screens (the snapshot's id is added once taken). A
    category's: `eid` is the accessory that went off -- its name, its
    camera unless the category names one."""
    eid = eid or item.get("entity") or (members(house, item, pins) or [""])[0]
    d = describe(house, eid)
    k = d["kind"]
    view = None
    if item.get("category") == "cameras":
        # its own camera's: the snapshot, the live view, the name
        p = next((x for x in camera_pairs(house, item) if x["trigger"] == eid), None)
        view = p["view"] if p else None
        if view:
            d = {**d, "name": name_of(house, p["camera"])}
    st = _pair(new)
    # (a test reads as if it just went off: its Goes Off When, not the state now)
    fired = (item.get("when") or d["when"]) if test or new is None else new.state
    title, message = rules.words(k, item.get("when") or d["when"], d["name"], st, fired_on=fired)
    icon, tint = rules.look(k, st)
    icon = str((new.attributes.get("icon") if new is not None else None) or icon) if k != "people" else icon
    if not str(icon).startswith(("hk:", "mdi:")):
        icon = rules.look(k, st)[0]
    camera = (view or item.get("camera") or (camera_for(house, eid) if item.get("category") else None)) \
        if item.get("snap") else None
    if view and not item.get("snap"):
        camera = None
    stay = item.get("stay")
    stay = int(opts[CONF_STAY] if stay is None else stay)
    important = bool(item.get("important"))
    tap = item.get("tap") or "sheet"
    if tap == "camera" and not camera:
        tap = "sheet"                 # Live Camera with no camera: the accessory's sheet
    if tap == "page" and not item.get("page"):
        tap = "sheet"
    return {
        "type": "notification", "id": uuid.uuid4().hex, "item": item.get("id"), "entity": eid, "kind": k,
        "title": (item.get("title") or "").strip() or title,
        "message": (item.get("message") or "").strip() or message,
        "icon": icon, "tint": tint,
        "picture": (new.attributes.get("entity_picture") if new is not None and k == "people" else None),
        "initials": initials(d["name"]) if k == "people" else None,
        # Wakes the Screen: its own, else All Notifications' (Do Not Disturb
        # still wins for one that isn't Important: the host, each screen)
        "important": important,
        "wake": item.get("wake") if isinstance(item.get("wake"), bool) else bool(opts.get(CONF_WAKE)),
        "stay": stay, "saver": opts[CONF_SAVER], "chime": bool(opts[CONF_CHIME]), "dnd": opts[CONF_DND],
        "pop": item.get("pop") or None, "camera": camera, "snap": None,
        "tap": tap, "page": item.get("page") if tap == "page" else None,
        # ITS SHEET: the accessory's own -- for what a camera sees, the
        # camera's live (its view, else the snapshot's camera)
        "sheet": (view or (camera_for(house, eid) if k in rules.CAMERA_KINDS else None)
                  or (camera if k in rules.CAMERA_KINDS else None) or keypad_for(eid, pins)),
        # Go To on its sheet: None automatic (the screen works it out), "none", or a page
        "go": item.get("go") or None,
        "mute": mute_key(item, eid), "event": None,
        "buttons": rules.buttons(k, st, camera), "test": test, "ts": time.time(),
        "dashboards": [], "users": [],
    }


# THE ACTION: an automation's own banner -- its words, to all screens or some
# (dashboards, users), with a snapshot if it names a camera. The same payload
# as an item's, so each screen decides the same way. (Its fields; the host
# checks them -- HA: NOTIFY_SCHEMA.)
ATTR_TITLE, ATTR_MESSAGE, ATTR_IMPORTANT, ATTR_WAKE, ATTR_STAY = "title", "message", "important", "wake", "stay"
ATTR_ICON, ATTR_ENTITY, ATTR_CAMERA, ATTR_TAP, ATTR_PAGE, ATTR_DASHBOARDS, ATTR_USERS = (
    "icon", "entity", "camera", "tap", "page", "dashboards", "users")


def build_action(house: House, opts: dict[str, Any], data: dict[str, Any], pins: Pins = no_pins) -> dict[str, Any]:
    """What goes to the screens for the action: an item's payload, its words
    the automation's. Wakes the Screen as an item's: Do Not Disturb holds it
    back unless it is Important. An accessory named: its icon, its sheet, its
    buttons. Tap Opens, unless given: the camera, else the accessory's sheet,
    else nothing."""
    eid = data.get(ATTR_ENTITY)
    st = house.state(eid) if eid else None
    s = _pair(st)
    k = kind(house, eid) if eid else "event"
    icon, tint = rules.look(k, s)
    camera = data.get(ATTR_CAMERA)
    page = data.get(ATTR_PAGE)
    tap = data.get(ATTR_TAP) or ("page" if page else "camera" if camera else "sheet" if eid else "none")
    if tap == "page" and not page:
        tap = "camera" if camera else "sheet" if eid else "none"
    if tap == "camera" and not camera:
        tap = "sheet" if eid else "none"
    if tap == "sheet" and not eid:
        tap = "none"
    wake = bool(data.get(ATTR_WAKE))
    important = bool(data.get(ATTR_IMPORTANT))
    stay = data.get(ATTR_STAY)
    return {
        "type": "notification", "id": uuid.uuid4().hex, "item": None, "entity": eid, "kind": k,
        "title": data[ATTR_TITLE], "message": data.get(ATTR_MESSAGE) or "",
        "icon": data.get(ATTR_ICON) or icon, "tint": tint,
        "picture": st.attributes.get("entity_picture") if st is not None and k == "people" else None,
        "initials": initials(name_of(house, eid)) if eid and k == "people" else None,
        "important": important, "wake": wake,
        "stay": int(opts[CONF_STAY] if stay is None else stay),
        "saver": opts[CONF_SAVER], "chime": bool(opts[CONF_CHIME]), "dnd": opts[CONF_DND],
        "pop": None, "camera": camera, "snap": None, "tap": tap, "sheet": keypad_for(eid, pins),
        # a page named: its Go To too; an automation's own has no Mute
        "page": page if tap == "page" else None, "go": page or None, "mute": None, "event": None,
        "buttons": rules.buttons(k, s, camera) if eid else rules.buttons("event", None, camera),
        "test": False, "ts": time.time(),
        # (a dashboard as its url path: the screen compares its first segment)
        "dashboards": [p for p in (str(d).strip().strip("/").split("/")[0] for d in data.get(ATTR_DASHBOARDS) or []) if p],
        "users": [str(u).strip() for u in data.get(ATTR_USERS) or [] if str(u).strip()],
    }


def wake_for(stay: int) -> int:
    """How long a screen woken for a notification stays awake: as long as the
    banner stays, within WAKE_MIN_S..WAKE_MAX_S (Until Dismissed: WAKE_MAX_S)."""
    return WAKE_MAX_S if stay <= 0 else max(WAKE_MIN_S, min(WAKE_MAX_S, stay))
