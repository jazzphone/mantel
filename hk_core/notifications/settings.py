"""Notifications' HK Settings page (Features -> Notifications): what it shows, and its checks.

Each change is checked the way the field means it and refused BY FIELD: an apply_* answers the
new options (or item) and {} -- or the old ones and {field: code}, a code the page words. The
host stores what comes back and answers the page (HA: settings_ws.py's websocket commands).
"""
from __future__ import annotations

import re
import secrets
from typing import Any

from ..house import House, area_of
from . import rules
from .accessories import Pins, about, camera_pairs, candidates, describe, kind, name_of, no_pins
from .const import (CONF_CHIME, CONF_DND, CONF_ITEMS, CONF_SAVER, CONF_STAY, CONF_WAKE, COOLDOWNS, GO_NONE, ITEM_FIELDS,
                    ITEMS_MAX, MESSAGE_MAX, ONLY, PAGE_RE, SAVERS, STAYS, TAPS, TITLE_MAX)
from .dnd import DND_MAX, hhmm, notify_dnd

ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
POP = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
PAGE = re.compile(PAGE_RE)


# ------------------------------------------------------------------- the page
def named(house: House, ids: list[str], pins: Pins = no_pins) -> list[dict[str, str]]:
    """Accessories as the page lists them: name and room, by room."""
    panels = pins() if any(e.startswith("alarm_control_panel.") for e in ids) else {}
    guarded = {alarm: panel for panel, alarm in panels.items()}
    out = []
    for e in ids:
        area = area_of(house, house.entity(e))
        a = house.area_name(area) if area else None
        row = {"entity": e, "name": name_of(house, e), "area": a or ""}
        # WHAT AN ALARM PIN PANEL IS, said where it is picked (2026-10-13): a
        # copy of an alarm with a PIN, made by HK -- and of that alarm, that
        # a tap on its notification opens the keypad
        if e in panels:
            row["note"] = name_of(house, panels[e]) + " with a PIN · made by HK’s Alarm PIN"
        elif e in guarded:
            row["note"] = "Opens " + name_of(house, guarded[e]) + " to disarm"
        out.append(row)
    return sorted(out, key=lambda x: (x["area"], x["name"]))


def page(house: House, opts: dict[str, Any], on_now: dict[str, float], state: str,
         pins: Pins = no_pins) -> dict[str, Any]:
    """The page: `opts` the feature's options (banner.options), `on_now` the mutes running
    (banner.mutes), `state` the feature's own (the host's word: loaded, not_loaded...)."""
    items = []
    for it in opts[CONF_ITEMS]:
        d = about(house, it)
        # its mutes running now: which accessory, until when (Muted until · Unmute)
        pre = "%s:" % it.get("id")
        muted = sorted(({"key": k, "entity": k[len(pre):], "name": name_of(house, k[len(pre):]) if k[len(pre):] else "",
                         "until": v} for k, v in on_now.items() if k.startswith(pre)), key=lambda m: m["until"])
        items.append({**{k: it.get(k) for k in ("id",) + ITEM_FIELDS}, "kind": d["kind"], "name": d["name"],
                      "choices": d["choices"], "auto_title": d["title"], "auto_message": d["message"],
                      "icon": d["icon"], "tint": d["tint"], "suggested_camera": d["camera"],
                      "missing": d["missing"], "muted": muted})
    # THE CATEGORIES found here: those with an accessory, each with its
    # accessories (by room) and its notification when it is on
    on = {it.get("category"): it.get("id") for it in opts[CONF_ITEMS] if it.get("category")}
    cats = []
    for key, label, kinds, _start in rules.CATEGORIES:
        found = candidates(house, key, pins)
        if not found and key not in on:
            continue
        icon, tint = rules.look(kinds[0])
        acc = named(house, found, pins)
        if key == "cameras":
            # each camera: what sets it off and its live view (chosen, else
            # suggested from its own device), and whether it notifies
            # (the suggestion's kind, for the page's words: person, doorbell...)
            it = next((i for i in opts[CONF_ITEMS] if i.get("id") == on.get(key)), {})
            pairs = {p["camera"]: p for p in camera_pairs(house, it)}
            for a in acc:
                p = pairs.get(a["entity"], {})
                a.update({"trigger": p.get("trigger"), "trigger_name": name_of(house, p["trigger"]) if p.get("trigger") else "",
                          "suggested": p.get("suggested"),
                          "suggested_kind": kind(house, p["suggested"]) if p.get("suggested") else None,
                          "view": p.get("view") or a["entity"], "on": bool(p.get("on"))})
        cats.append({"key": key, "label": label, "icon": icon, "tint": tint, "item": on.get(key), "accessories": acc})
    return {
        "configured": True,
        "state": state,
        "options": {CONF_STAY: opts[CONF_STAY], CONF_SAVER: opts[CONF_SAVER], CONF_CHIME: opts[CONF_CHIME],
                    CONF_DND: opts[CONF_DND], CONF_WAKE: opts[CONF_WAKE]},
        "items": items,
        "categories": cats,
        "limits": {"stays": list(STAYS), "savers": list(SAVERS), "only": list(ONLY), "cooldowns": list(COOLDOWNS),
                   "taps": list(TAPS), "title": TITLE_MAX, "message": MESSAGE_MAX, "items": ITEMS_MAX},
    }


# ----------------------------------------------------------------- checks
class Bad(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _entity(v: Any, domains: tuple[str, ...] | None = None) -> str:
    if not isinstance(v, str) or not ENTITY_ID.match(v):
        raise Bad("entity")
    if domains and v.split(".")[0] not in domains:
        raise Bad("entity")
    return v


def _entities(v: Any) -> list[str]:
    """A category's left-out accessories."""
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > 500:
        raise Bad("list")
    return list(dict.fromkeys(_entity(x) for x in v))


def _pairs(v: Any) -> list[dict[str, str]]:
    """The Cameras category's choices: per camera, the sensor that sets it
    off (a binary sensor or an event) and the camera its live view and
    snapshot come from; a blank one is its suggestion."""
    if not isinstance(v, list) or len(v) > 200:
        raise Bad("list")
    out = []
    for p in v:
        if not isinstance(p, dict) or set(p) - {"camera", "trigger", "view"}:
            raise Bad("list")
        q = {"camera": _entity(p.get("camera"), ("camera",))}
        if p.get("trigger"):
            q["trigger"] = _entity(p["trigger"], ("binary_sensor", "event"))
        if p.get("view"):
            q["view"] = _entity(p["view"], ("camera",))
        out.append(q)
    return list({q["camera"]: q for q in out}.values())


def _text(limit: int) -> Any:
    def check(v: Any) -> str:
        if v is None:
            return ""
        if not isinstance(v, str) or len(v.strip()) > limit or "<" in v:
            raise Bad("text")
        return v.strip()
    return check


def _bool(v: Any) -> bool:
    if not isinstance(v, bool):
        raise Bad("bool")
    return v


def _in(options: tuple[Any, ...], none: bool = False) -> Any:
    def check(v: Any) -> Any:
        if none and v in (None, ""):
            return None
        if v not in options:
            raise Bad("choice")
        return v
    return check


def _stay(v: Any) -> int | None:
    if v is None:
        return None                   # as All Screens
    if isinstance(v, bool) or v not in STAYS + (0,):
        raise Bad("choice")
    return int(v)


def _pop(v: Any) -> str | None:
    """A pop-up's #hash (Not Where a Pop-up Shows), or None."""
    if v in (None, ""):
        return None
    h = str(v).strip().lstrip("#").lower() if isinstance(v, str) else ""
    if not POP.match(h):
        raise Bad("choice")
    return h


def _page(v: Any) -> str | None:
    """A page of the screen's own dashboard: a view's path (Tap Opens: A Page)."""
    if v in (None, ""):
        return None
    p = str(v).strip().strip("/").lower() if isinstance(v, str) else ""
    if not PAGE.match(p):
        raise Bad("choice")
    return p


def _go(v: Any) -> str | None:
    """Go To: None (Automatic), "none", or a page."""
    if v in (None, "", "auto"):
        return None
    return GO_NONE if v == GO_NONE else _page(v)


def _when(v: Any) -> str:
    """Goes Off When: one of the accessory's choices (apply_item checks which)."""
    if not isinstance(v, str) or not v:
        raise Bad("choice")
    return v


def _dnd(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"schedule", "from", "to", "while"}:
        raise Bad("unknown")
    if any(v.get(k) not in (None, "") and hhmm(v.get(k)) is None for k in ("from", "to")):
        raise Bad("time")
    w = v.get("while") or []
    if not isinstance(w, list) or len(w) > DND_MAX or not all(isinstance(x, str) and ENTITY_ID.match(x) for x in w):
        raise Bad("entity")
    out = notify_dnd(v)
    assert out is not None
    return out


HOUSE = {CONF_STAY: _in(STAYS), CONF_SAVER: _in(SAVERS), CONF_CHIME: _bool, CONF_DND: _dnd, CONF_WAKE: _bool}

FIELDS = {
    "entity": _entity,
    "when": _when,
    "only": _in(ONLY),
    "cooldown": _in(COOLDOWNS),
    "title": _text(TITLE_MAX),
    "message": _text(MESSAGE_MAX),
    "important": _bool,
    "wake": lambda v: None if v is None else _bool(v),       # None: as All Notifications'
    "stay": _stay,
    "pop": _pop,
    "snap": _bool,
    "camera": lambda v: None if v in (None, "") else _entity(v, ("camera",)),
    "exclude": lambda v: _entities(v),
    "pairs": lambda v: _pairs(v),
    # a Calendars category's all-day events: the morning they start (or None: not)
    "allday": lambda v: None if v in (None, "") else _in(rules.ALLDAY_TIMES)(v),
    "tap": _in(TAPS),
    "page": _page,
    "go": _go,
}


def apply_house(options: dict[str, Any], changes: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """All Screens' choices (stay, saver, chime, dnd, wake) changed, or the refusals."""
    out, errors = dict(options), {}
    for k, v in changes.items():
        try:
            if k not in HOUSE:
                raise Bad("unknown")
            out[k] = HOUSE[k](v)
        except Bad as err:
            errors[k] = err.code
    return (options, errors) if errors else (out, {})


def _new_id(taken: set[str]) -> str:
    sid = secrets.token_hex(4)
    while sid in taken:
        sid = secrets.token_hex(4)
    return sid


def new_category(key: str, taken: set[str]) -> dict[str, Any]:
    """A category's notification as it starts (rules.CATEGORIES' settings)."""
    cat = rules.category(key)
    assert cat is not None
    start = cat[3]
    return {"id": _new_id(taken), "category": key, "exclude": [], "when": start.get("when"), "only": "always",
            "cooldown": start.get("cooldown", 0), "title": "", "message": "", "important": bool(start.get("important")),
            "wake": start.get("wake"), "stay": start.get("stay"), "pop": start.get("pop"),
            "snap": bool(start.get("snap")), "camera": None, "tap": start.get("tap", "sheet"),
            **({"allday": start["allday"]} if "allday" in start else {})}


def new_item(house: House, entity: str, taken: set[str]) -> dict[str, Any]:
    """A notification on `entity` as it starts: what it suggests."""
    d = describe(house, entity)
    sid = _new_id(taken)
    return {"id": sid, "entity": entity, "when": d["when"], "only": "always", "cooldown": 60 if d["camera"] and
            d["kind"] in ("motion", "presence", "person", "vehicle", "animal") else 0,
            "title": "", "message": "", "important": d["important"], "wake": None, "stay": None,
            "pop": "doorbell" if d["kind"] == "doorbell" else None, "snap": bool(d["camera"]),
            "camera": d["camera"], "tap": "camera" if d["camera"] else "sheet"}


def apply_item(house: House, item: dict[str, Any], changes: dict[str, Any]
               ) -> tuple[dict[str, Any], dict[str, str]]:
    """One notification with `changes` made, or the refusals. A new entity
    takes its own Goes Off When (the old one's means nothing to it)."""
    out, errors = dict(item), {}
    for k, v in changes.items():
        try:
            # a category's is its own kind of notification: no accessory of its
            # own; an accessory's has no category or left-out ones
            if k not in FIELDS or (k == "entity" and item.get("category")) or (k == "exclude" and not item.get("category")) \
                    or (k == "pairs" and item.get("category") != "cameras") \
                    or (k == "allday" and item.get("category") != "calendars"):
                raise Bad("unknown")
            out[k] = FIELDS[k](v)
        except Bad as err:
            errors[k] = err.code
    if errors:
        return item, errors
    d = about(house, out)
    keys = [c[0] for c in d["choices"]]
    if "entity" in changes and changes["entity"] != item.get("entity") and "when" not in changes:
        out["when"] = d["when"]
    if out.get("when") not in keys:
        return item, {"when": "choice"}
    if out.get("snap") and not out.get("camera") and not out.get("category"):     # a category's: each one's own
        out["camera"] = d["camera"]
        if not out["camera"]:
            return item, {"camera": "entity"}
    if not out.get("snap") and out.get("tap") == "camera":
        out["tap"] = "sheet"
    if out.get("tap") == "page" and not out.get("page"):
        return item, {"page": "required"}
    return out, {}
