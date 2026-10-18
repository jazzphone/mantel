"""Notifications' settings, for the HK Settings page (admin only):

    hk_notify/settings/get                       -> the page
    hk_notify/settings/set {changes}             -> All Screens' choices (stay,
                                                    saver, chime, dnd)
    hk_notify/item/save {item?, changes}         -> one notification made
                                                    (no item: a new one, which
                                                    needs its entity) or changed
    hk_notify/item/remove {item}
    hk_notify/test {item}                        -> sent now, as if it went off
    hk_notify/mute {key, minutes?}               -> Mute 1 Hour from a sheet
                                                    (ANY signed-in user: it
                                                    only quiets the house);
                                                    minutes 0 unmutes

Each change is checked the way the field means it and refused BY FIELD (the
message is a JSON map, field -> a code the page words, as settings_api's).
"""
from __future__ import annotations

import json
import re
import secrets
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er

from ... import settings as HS
from .. import NOTIFICATIONS, Feature, async_update, entries
from . import rules
from .const import (CONF_CHIME, CONF_DND, CONF_ITEMS, CONF_SAVER, CONF_STAY, CONF_WAKE, COOLDOWNS, GO_NONE, ITEM_FIELDS,
                    ITEMS_MAX, MESSAGE_MAX, MUTE_S, ONLY, PAGE_RE, SAVERS, STAYS, TAPS, TITLE_MAX)


POP = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
PAGE = re.compile(PAGE_RE)


def _entry(hass: HomeAssistant) -> Feature | None:
    return next(iter(entries(hass, NOTIFICATIONS)), None)


def _named(hass: HomeAssistant, ids: list[str]) -> list[dict[str, str]]:
    from . import name_of, pin_panels
    reg = er.async_get(hass)
    pins = pin_panels(hass) if any(e.startswith("alarm_control_panel.") for e in ids) else {}
    guarded = {alarm: panel for panel, alarm in pins.items()}
    out = []
    for e in ids:
        ent = reg.async_get(e)
        area = ent.area_id if ent is not None else None
        if not area and ent is not None and ent.device_id:
            dev = dr.async_get(hass).async_get(ent.device_id)
            area = dev.area_id if dev else None
        a = ar.async_get(hass).async_get_area(area) if area else None
        row = {"entity": e, "name": name_of(hass, e), "area": a.name if a else ""}
        # WHAT AN ALARM PIN PANEL IS, said where it is picked (2026-10-13): a
        # copy of an alarm with a PIN, made by HK -- and of that alarm, that
        # a tap on its notification opens the keypad
        if e in pins:
            row["note"] = name_of(hass, pins[e]) + " with a PIN · made by HK’s Alarm PIN"
        elif e in guarded:
            row["note"] = "Opens " + name_of(hass, guarded[e]) + " to disarm"
        out.append(row)
    return sorted(out, key=lambda x: (x["area"], x["name"]))


def page(hass: HomeAssistant, entry: Feature) -> dict[str, Any]:
    from . import about, candidates, mutes, name_of, options
    opts = options(entry)
    items = []
    on_now = mutes(hass)
    for it in opts[CONF_ITEMS]:
        d = about(hass, it)
        # its mutes running now: which accessory, until when (Muted until · Unmute)
        pre = "%s:" % it.get("id")
        muted = sorted(({"key": k, "entity": k[len(pre):], "name": name_of(hass, k[len(pre):]) if k[len(pre):] else "",
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
        found = candidates(hass, key)
        if not found and key not in on:
            continue
        icon, tint = rules.look(kinds[0])
        acc = _named(hass, found)
        if key == "cameras":
            # each camera: what sets it off and its live view (chosen, else
            # suggested from its own device), and whether it notifies
            # (the suggestion's kind, for the page's words: person, doorbell...)
            from . import _kind, camera_pairs, name_of
            it = next((i for i in opts[CONF_ITEMS] if i.get("id") == on.get(key)), {})
            pairs = {p["camera"]: p for p in camera_pairs(hass, it)}
            for a in acc:
                p = pairs.get(a["entity"], {})
                a.update({"trigger": p.get("trigger"), "trigger_name": name_of(hass, p["trigger"]) if p.get("trigger") else "",
                          "suggested": p.get("suggested"),
                          "suggested_kind": _kind(hass, p["suggested"]) if p.get("suggested") else None,
                          "view": p.get("view") or a["entity"], "on": bool(p.get("on"))})
        cats.append({"key": key, "label": label, "icon": icon, "tint": tint, "item": on.get(key), "accessories": acc})
    return {
        "configured": True,
        "state": entry.state.value,
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
    if not isinstance(v, str) or not HS.ENTITY_ID.match(v):
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
    if any(v.get(k) not in (None, "") and HS.hhmm(v.get(k)) is None for k in ("from", "to")):
        raise Bad("time")
    w = v.get("while") or []
    if not isinstance(w, list) or len(w) > HS.DND_MAX or not all(isinstance(x, str) and HS.ENTITY_ID.match(x) for x in w):
        raise Bad("entity")
    out = HS.notify_dnd(v)
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


def new_item(hass: HomeAssistant, entity: str, taken: set[str]) -> dict[str, Any]:
    """A notification on `entity` as it starts: what it suggests."""
    from . import describe
    d = describe(hass, entity)
    sid = _new_id(taken)
    return {"id": sid, "entity": entity, "when": d["when"], "only": "always", "cooldown": 60 if d["camera"] and
            d["kind"] in ("motion", "presence", "person", "vehicle", "animal") else 0,
            "title": "", "message": "", "important": d["important"], "wake": None, "stay": None,
            "pop": "doorbell" if d["kind"] == "doorbell" else None, "snap": bool(d["camera"]),
            "camera": d["camera"], "tap": "camera" if d["camera"] else "sheet"}


def apply_item(hass: HomeAssistant, item: dict[str, Any], changes: dict[str, Any]
               ) -> tuple[dict[str, Any], dict[str, str]]:
    """One notification with `changes` made, or the refusals. A new entity
    takes its own Goes Off When (the old one's means nothing to it)."""
    from . import about
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
    d = about(hass, out)
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


# ---------------------------------------------------------------- commands
def _save(hass: HomeAssistant, entry: Feature, options: dict[str, Any]) -> None:
    if options != dict(entry.options):
        async_update(hass, entry, options=options)


def _refuse(connection, msg_id: int, errors: dict[str, str]) -> None:
    connection.send_error(msg_id, "invalid_format", json.dumps(errors))


def _need(hass: HomeAssistant, connection, msg: dict[str, Any]) -> Feature | None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Notifications is not added")
    return entry


@websocket_api.websocket_command({vol.Required("type"): "hk_notify/settings/get", vol.Optional("fresh"): bool})
@websocket_api.require_admin
@callback
def ws_settings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    connection.send_result(msg["id"], page(hass, entry) if entry else {"configured": False})


@websocket_api.websocket_command({vol.Required("type"): "hk_notify/settings/set", vol.Required("changes"): dict})
@websocket_api.require_admin
@callback
def ws_settings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if (entry := _need(hass, connection, msg)) is None:
        return
    opts, errors = apply_house(dict(entry.options), dict(msg["changes"]))
    if errors:
        _refuse(connection, msg["id"], errors)
        return
    _save(hass, entry, opts)
    connection.send_result(msg["id"], page(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "hk_notify/item/save", vol.Optional("item"): vol.Any(None, str),
                                  vol.Required("changes"): dict})
@websocket_api.require_admin
@callback
def ws_item_save(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if (entry := _need(hass, connection, msg)) is None:
        return
    opts = dict(entry.options)
    items = [dict(i) for i in opts.get(CONF_ITEMS) or []]
    changes = dict(msg["changes"])
    iid = msg.get("item")
    if iid:
        at = next((n for n, i in enumerate(items) if i.get("id") == iid), None)
        if at is None:
            connection.send_error(msg["id"], "not_found", "No such notification")
            return
        base = items[at]
    elif changes.get("category") is not None:
        key = changes.pop("category")
        if key not in rules.CATEGORY_KEYS or any(i.get("category") == key for i in items):
            _refuse(connection, msg["id"], {"category": "choice"})
            return
        base, at = new_category(key, {str(i.get("id")) for i in items}), None
    else:
        if len(items) >= ITEMS_MAX:
            _refuse(connection, msg["id"], {"entity": "too_many"})
            return
        try:
            ent = _entity(changes.get("entity"))
        except Bad as err:
            _refuse(connection, msg["id"], {"entity": err.code})
            return
        base, at = new_item(hass, ent, {str(i.get("id")) for i in items}), None
        changes.pop("entity", None)
    out, errors = apply_item(hass, base, changes)
    if errors:
        _refuse(connection, msg["id"], errors)
        return
    if at is None:
        items.append(out)
    else:
        items[at] = out
    _save(hass, entry, {**opts, CONF_ITEMS: items})
    connection.send_result(msg["id"], {**page(hass, entry), "saved": out["id"]})


@websocket_api.websocket_command({vol.Required("type"): "hk_notify/item/remove", vol.Required("item"): str})
@websocket_api.require_admin
@callback
def ws_item_remove(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    if (entry := _need(hass, connection, msg)) is None:
        return
    opts = dict(entry.options)
    items = [i for i in opts.get(CONF_ITEMS) or [] if i.get("id") != msg["item"]]
    _save(hass, entry, {**opts, CONF_ITEMS: items})
    connection.send_result(msg["id"], page(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "hk_notify/test", vol.Required("item"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_test(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    from . import async_send
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Notifications is not added")
        return
    item = next((i for i in entry.options.get(CONF_ITEMS) or [] if i.get("id") == msg["item"]), None)
    if item is None:
        connection.send_error(msg["id"], "not_found", "No such notification")
        return
    from . import members
    eid = (members(hass, item) or [None])[0]
    if eid is None:
        connection.send_error(msg["id"], "not_found", "It has no accessory to test with")
        return
    if item.get("category") == "calendars":
        sent = await _test_calendar(hass, entry, dict(item), members(hass, item))
        connection.send_result(msg["id"], {"sent": sent["id"], "snap": False})
        return
    sent = await async_send(hass, entry, dict(item), hass.states.get(eid), test=True, eid=eid)
    connection.send_result(msg["id"], {"sent": sent["id"], "snap": bool(sent["snap"])})


async def _test_calendar(hass: HomeAssistant, entry: Feature, item: dict[str, Any], cals: list[str]) -> dict[str, Any]:
    """Calendars' test: the next timed event of the chosen calendars within a
    week, as it will look -- else a made-up one."""
    from datetime import timedelta
    from homeassistant.util import dt as dt_util
    from . import _event_time, async_deliver, async_events, build_calendar, options
    try:
        lead = max(0, int(item.get("when") or 15))
    except ValueError:
        lead = 15
    now = dt_util.utcnow()
    got = await async_events(hass, cals, now, now + timedelta(days=7))
    found = sorted(((_event_time(ev.get("start")), cal, ev) for cal, evs in got.items() for ev in evs
                    if _event_time(ev.get("start")) is not None), key=lambda x: x[0])
    if found:
        _t, cal, ev = found[0]
    else:
        start = dt_util.as_local(now + timedelta(minutes=lead))
        cal, ev = cals[0], {"summary": "Sample Event", "start": start.isoformat(),
                            "end": (start + timedelta(hours=1)).isoformat()}
    return await async_deliver(hass, build_calendar(hass, options(entry), item, cal, ev, lead, test=True))


# MUTE 1 HOUR, from a notification's sheet: any signed-in user -- a wall
# tablet's own user too -- since muting only ever makes the house quieter.
# The key is the payload's own (`mute`): an item's id and its accessory, and
# only a notification that exists can be muted.
@websocket_api.websocket_command({vol.Required("type"): "hk_notify/mute", vol.Required("key"): str,
                                  vol.Optional("minutes", default=MUTE_S // 60): vol.All(int, vol.Range(min=0, max=MUTE_S // 60))})
@callback
def ws_mute(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    from . import options, set_mute
    entry = _need(hass, connection, msg)
    if entry is None:
        return
    key = msg["key"]
    sid = key.split(":", 1)[0]
    if ":" not in key or not any(str(i.get("id")) == sid for i in options(entry)[CONF_ITEMS]):
        connection.send_error(msg["id"], "not_found", "No such notification")
        return
    connection.send_result(msg["id"], {"key": key, "until": set_mute(hass, key, msg["minutes"] * 60)})


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_settings_get, ws_settings_set, ws_item_save, ws_item_remove, ws_test, ws_mute):
        websocket_api.async_register_command(hass, cmd)
