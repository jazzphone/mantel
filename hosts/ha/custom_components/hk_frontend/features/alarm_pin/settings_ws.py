"""Alarm PIN's settings, for the HK Settings page.

The same things its own dialogs do, for every alarm that has a PIN:

    hk_alarm_pin/settings/get                          -> the page
    hk_alarm_pin/settings/set {entry_id, changes}      -> a new PIN (typed twice),
                                                          the arm rule, or another alarm
    hk_alarm_pin/add {alarm, pin, pin_again, arm_required}
                                                       -> a PIN for another alarm
    hk_alarm_pin/remove {entry_id}                     -> no PIN on that alarm

(The commands keep the hk_alarm_pin/ prefix: the settings page calls them
by it.)

Admin only. Checked the way Add feature and Configure check them -- the same
helpers (checks.py) -- and refused BY FIELD (the error's message is a JSON
map, field -> a sentence to show). A PIN is never sent back: the page only
learns that one is set. Adding goes through HK Frontend's own Add feature flow,
so an alarm gets a PIN exactly as it does from Devices & services.
"""
from __future__ import annotations

import json
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResultType, InvalidData
from homeassistant.helpers import entity_registry as er

from ...const import DOMAIN
from .. import (ALARM_PIN, SUBENTRY_FEATURE, Feature, async_remove, async_sync, async_update, entries,
                frontend_entry, item, unique_id)
from . import checks
from .const import ALREADY, CONF_ALARM, CONF_ARM_REQUIRED
from .pin import MIN_LENGTH, hash_pin

MSG = {
    checks.TOO_SHORT: f"Use at least {MIN_LENGTH} characters.",
    checks.MISMATCH: "The two PINs don’t match. Type the same PIN in both.",
    checks.OWN_PANEL: "That is one of Alarm PIN’s own panels. Choose the alarm it should protect.",
    checks.TAKEN: "That alarm already has a PIN.",
    "not_alarm": "That isn’t an alarm panel in this house.",
    "arm_required": "Choose on or off.",
    "unknown": "That setting doesn’t exist.",
    "no_entry": "That alarm has no PIN anymore.",
    "no_house": "Add HK Frontend first, in Settings -> Devices & services.",
}


def _entry(hass: HomeAssistant, entry_id: str) -> Feature | None:
    """An Alarm PIN -- never another feature."""
    feat = item(hass, entry_id)
    return feat if feat is not None and feat.kind == ALARM_PIN else None


def _panel(hass: HomeAssistant, entry: Feature) -> str | None:
    return er.async_get(hass).async_get_entity_id("alarm_control_panel", DOMAIN, entry.entry_id)


def _name(hass: HomeAssistant, eid: str | None) -> str | None:
    if not eid:
        return None
    st = hass.states.get(eid)
    if st and st.attributes.get("friendly_name"):
        return str(st.attributes["friendly_name"])
    ent = er.async_get(hass).async_get(eid)
    return (ent.name or ent.original_name or eid) if ent else eid


def page(hass: HomeAssistant) -> dict[str, Any]:
    pins = entries(hass, ALARM_PIN)
    ours = set(checks.ours(hass))
    taken = {e.data.get(CONF_ALARM): e.entry_id for e in pins}
    alarms = sorted({s.entity_id for s in hass.states.async_all("alarm_control_panel")} - ours)
    return {
        "configured": bool(pins),
        "min_length": MIN_LENGTH,
        "alarms": [{
            "entry_id": e.entry_id, "title": e.title, "state": e.state.value,
            "alarm": e.data.get(CONF_ALARM), "alarm_name": _name(hass, e.data.get(CONF_ALARM)),
            "panel": _panel(hass, e), "panel_name": _name(hass, _panel(hass, e)),
            "arm_required": bool(e.options.get(CONF_ARM_REQUIRED, True)),
            "pin_set": bool(e.options.get("hash")),
        } for e in pins],
        # every alarm panel that is not one of ours; `entry`: which PIN it has
        "choices": [{"entity_id": a, "name": _name(hass, a), "entry": taken.get(a)} for a in alarms],
    }


def _refused(connection, msg_id: int, errors: dict[str, str]) -> None:
    connection.send_error(msg_id, "invalid_format", json.dumps(errors))


def _alarm_error(hass: HomeAssistant, alarm: Any, entry_id: str | None) -> str | None:
    if not isinstance(alarm, str) or not alarm.startswith("alarm_control_panel."):
        return MSG["not_alarm"]
    if code := checks.alarm_error(hass, alarm, entry_id):
        return MSG[code]
    if hass.states.get(alarm) is None and er.async_get(hass).async_get(alarm) is None:
        return MSG["not_alarm"]
    return None


@websocket_api.websocket_command({vol.Required("type"): "hk_alarm_pin/settings/get"})
@websocket_api.require_admin
@callback
def ws_settings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], page(hass))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_alarm_pin/settings/set",
    vol.Required("entry_id"): str,
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        _refused(connection, msg["id"], {"entry_id": MSG["no_entry"]})
        return
    changes = dict(msg["changes"])
    errors: dict[str, str] = {}
    for k in changes:
        if k not in ("pin", "pin_again", CONF_ARM_REQUIRED, CONF_ALARM):
            errors[k] = MSG["unknown"]
    options, data = dict(entry.options), dict(entry.data)
    if CONF_ARM_REQUIRED in changes:
        if not isinstance(changes[CONF_ARM_REQUIRED], bool):
            errors[CONF_ARM_REQUIRED] = MSG["arm_required"]
        else:
            options[CONF_ARM_REQUIRED] = changes[CONF_ARM_REQUIRED]
    new_pin = ""
    if "pin" in changes or "pin_again" in changes:
        codes: dict[str, str] = {}
        new_pin = checks.new_pin({"pin": changes.get("pin"), "pin_again": changes.get("pin_again")},
                                 codes, required=True)
        errors.update({k: MSG.get(v, v) for k, v in codes.items()})
    alarm = changes.get(CONF_ALARM)
    if CONF_ALARM in changes and (err := _alarm_error(hass, alarm, entry.entry_id)):
        errors[CONF_ALARM] = err
    if errors:
        _refused(connection, msg["id"], errors)
        return
    hashed = await hass.async_add_executor_job(hash_pin, new_pin) if new_pin else None
    # READ AGAIN AFTER THE HASH (200k rounds in the executor): the copy taken
    # before it would put back anything another write changed meanwhile.
    options, data = dict(entry.options), dict(entry.data)
    if CONF_ARM_REQUIRED in changes:
        options[CONF_ARM_REQUIRED] = changes[CONF_ARM_REQUIRED]
    if hashed:
        options.update(hashed)
    update: dict[str, Any] = {}
    if CONF_ALARM in changes and alarm != data.get(CONF_ALARM):
        data[CONF_ALARM] = alarm
        update = {"unique_id": unique_id(ALARM_PIN, alarm), "title": checks.item_title(hass, alarm), "data": data}
    if update or options != dict(entry.options):
        async_update(hass, entry, options=options, **update)
    connection.send_result(msg["id"], page(hass))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_alarm_pin/add",
    vol.Required("alarm"): str,
    vol.Optional("pin", default=""): str,
    vol.Optional("pin_again", default=""): str,
    vol.Optional(CONF_ARM_REQUIRED, default=True): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_add(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Through HK Frontend's own Add feature (its feature menu, then Alarm
    PIN's form), so a PIN added here is exactly one added from Devices &
    services. A flow that does not end in an item is aborted, never left
    open."""
    if err := _alarm_error(hass, msg["alarm"], None):
        _refused(connection, msg["id"], {CONF_ALARM: err})
        return
    house = frontend_entry(hass)
    if house is None:
        _refused(connection, msg["id"], {CONF_ALARM: MSG["no_house"]})
        return
    flows = hass.config_entries.subentries
    r = await flows.async_init((house.entry_id, SUBENTRY_FEATURE), context={"source": "user"})
    if r["type"] != FlowResultType.MENU:
        if r["type"] == FlowResultType.FORM:
            flows.async_abort(r["flow_id"])
        _refused(connection, msg["id"], {CONF_ALARM: str(r.get("reason") or "unknown")})
        return
    r = await flows.async_configure(r["flow_id"], {"next_step_id": ALARM_PIN})
    try:
        r = await flows.async_configure(r["flow_id"], {
            CONF_ALARM: msg["alarm"], "pin": msg["pin"], "pin_again": msg["pin_again"],
            CONF_ARM_REQUIRED: msg[CONF_ARM_REQUIRED]})
    except InvalidData:                  # the form's own check (its alarm picker)
        flows.async_abort(r["flow_id"])
        _refused(connection, msg["id"], {CONF_ALARM: MSG["not_alarm"]})
        return
    if r["type"] == FlowResultType.CREATE_ENTRY:
        # ITS PANEL BEFORE THE ANSWER: the house's update listener starts the
        # new item (async_sync), a task of its own that is usually still
        # importing the panel's platform here. Follow the items now -- the
        # same lock, so whichever runs second finds nothing to do.
        await async_sync(hass, house)
        connection.send_result(msg["id"], page(hass))
        return
    if r["type"] == FlowResultType.FORM:
        flows.async_abort(r["flow_id"])
        _refused(connection, msg["id"], {k: MSG.get(v, v) for k, v in (r.get("errors") or {}).items()})
        return
    _refused(connection, msg["id"], {CONF_ALARM: MSG[checks.TAKEN] if r.get("reason") == ALREADY
                                      else str(r.get("reason"))})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_alarm_pin/remove",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_remove(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        _refused(connection, msg["id"], {"entry_id": MSG["no_entry"]})
        return
    async_remove(hass, entry)
    connection.send_result(msg["id"], page(hass))


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_settings_get, ws_settings_set, ws_add, ws_remove):
        websocket_api.async_register_command(hass, cmd)
