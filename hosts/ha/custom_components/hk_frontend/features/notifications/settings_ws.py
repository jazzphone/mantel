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
message is a JSON map, field -> a code the page words, as settings_api's). The page and
the checks are the shared rules' (hk_core/notifications/settings.py); the commands, who may
send them, and the stored options are HA's, here.
"""
from __future__ import annotations

import json
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from ...hk_core.notifications import calendars as C, settings as core
from ...hk_core.notifications.settings import (  # noqa: F401 -- the checks, kept under their names here
    FIELDS, HOUSE, PAGE, POP, Bad, _bool, _dnd, _entities, _entity, _go, _in, _new_id, _page, _pairs, _pop, _stay, _text,
    _when, apply_house, new_category)
from ...house import HaHouse
from .. import NOTIFICATIONS, Feature, async_update, entries
from . import rules
from .const import CONF_ITEMS, ITEMS_MAX, MUTE_S


def _entry(hass: HomeAssistant) -> Feature | None:
    return next(iter(entries(hass, NOTIFICATIONS)), None)


# THE PAGE AND ITS CHECKS are the shared rules' (hk_core/notifications/settings.py), asked of
# HA's house; these keep the names the commands and tests use.
def _named(hass: HomeAssistant, ids: list[str]) -> list[dict[str, str]]:
    from . import _pins
    return core.named(HaHouse(hass), ids, _pins(hass))


def page(hass: HomeAssistant, entry: Feature) -> dict[str, Any]:
    from . import _pins, mutes, options
    return core.page(HaHouse(hass), options(entry), mutes(hass), entry.state.value, _pins(hass))


def new_item(hass: HomeAssistant, entity: str, taken: set[str]) -> dict[str, Any]:
    """A notification on `entity` as it starts: what it suggests."""
    return core.new_item(HaHouse(hass), entity, taken)


def apply_item(hass: HomeAssistant, item: dict[str, Any], changes: dict[str, Any]
               ) -> tuple[dict[str, Any], dict[str, str]]:
    """One notification with `changes` made, or the refusals."""
    return core.apply_item(HaHouse(hass), item, changes)


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
    week, as it will look -- else a made-up one (hk_core calendars.sample)."""
    from homeassistant.util import dt as dt_util
    from . import _pins, async_deliver, async_events, options
    p = await C.sample(HaHouse(hass), item, cals, dt_util.utcnow(), opts=lambda: options(entry),
                       events=lambda c, start, end: async_events(hass, c, start, end), pins=_pins(hass))
    return await async_deliver(hass, p)


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
