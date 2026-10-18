"""Clean Areas' settings and its live area list.

For the HK Settings page, admin only:

    hk_clean_areas/settings/get                  -> the page
    hk_clean_areas/settings/set {changes: {...}} -> the page again, or the refusal

`vacuums` (which take part; empty = every vacuum) and `areas` (which the
picker offers; empty = every area a vacuum reaches), checked the way
Configure checks them, refused BY FIELD (the message is a JSON map, field ->
a sentence to show), stored where Configure stores them.

For the area picker (hk-area-select-card), any signed-in user:

    hk_clean_areas/subscribe -> {configured, areas: [area ids]} now and on change

It changes when the settings do, and when a room map, an area or a vacuum's
own area does. Nothing here is hard-coded: the lists are Home Assistant's
vacuums, their room maps and its areas.
"""
from __future__ import annotations

import json
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send

from . import clean
from .. import CLEAN_AREAS, Feature, async_update, entries
from .const import CONF_AREAS, CONF_VACUUMS, SIGNAL_CHANGED

MSG = {
    "vacuums": "That isn’t a vacuum in this house.",
    "areas": "That isn’t an area in this house.",
    "list": "That list couldn’t be read.",
    "unknown": "That setting doesn’t exist.",
}


def _entry(hass: HomeAssistant) -> Feature | None:
    return next(iter(entries(hass, CLEAN_AREAS)), None)


def _name(hass: HomeAssistant, eid: str) -> str:
    st = hass.states.get(eid)
    if st and st.attributes.get("friendly_name"):
        return str(st.attributes["friendly_name"])
    ent = er.async_get(hass).async_get(eid)
    return (ent.name or ent.original_name or eid) if ent else eid


def _areas(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    """Every area: its name and floor (name, level), for grouping."""
    floors = fr.async_get(hass)
    out = {}
    for a in ar.async_get(hass).areas.values():
        f = floors.async_get_floor(a.floor_id) if a.floor_id else None
        out[a.id] = {"id": a.id, "name": a.name, "floor": f.name if f else None,
                     "level": f.level if f and f.level is not None else None}
    return out


def page(hass: HomeAssistant, entry: Feature) -> dict[str, Any]:
    opts = entry.options
    cov = clean.coverage(hass, opts)
    areas = _areas(hass)
    by: dict[str, list[str]] = {}
    for v in cov:
        if v["taking_part"]:
            for a in v["areas"]:
                by.setdefault(a, []).append(_name(hass, v["vacuum"]))
    reach = clean.reachable(hass, opts)
    return {
        "configured": True,
        "state": entry.state.value,
        "vacuums": [{**v, "name": _name(hass, v["vacuum"])} for v in cov],
        "chosen_vacuums": list(opts.get(CONF_VACUUMS) or []),
        # the areas a vacuum that takes part reaches, with who reaches them
        "areas": [{**areas[a], "by": by.get(a, [])} for a in reach if a in areas],
        "chosen_areas": list(opts.get(CONF_AREAS) or []),
        "offered": clean.offered(hass, opts),
        # every other area: a vacuum does not reach it (yet)
        "unreached": [areas[a] for a in areas if a not in reach],
    }


def apply(hass: HomeAssistant, options: dict[str, Any], changes: dict[str, Any]
          ) -> tuple[dict[str, Any], dict[str, str]]:
    out, errors = dict(options), {}
    vacuums = {v["vacuum"] for v in clean.coverage(hass, {})}
    areas = set(ar.async_get(hass).areas)
    for k, v in changes.items():
        if k not in (CONF_VACUUMS, CONF_AREAS):
            errors[k] = MSG["unknown"]
        elif not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            errors[k] = MSG["list"]
        elif any(x not in (vacuums if k == CONF_VACUUMS else areas) for x in v):
            errors[k] = MSG[k]
        else:
            out[k] = list(dict.fromkeys(v))
    return out, errors


@websocket_api.websocket_command({vol.Required("type"): "hk_clean_areas/settings/get"})
@websocket_api.require_admin
@callback
def ws_settings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    connection.send_result(msg["id"], page(hass, entry) if entry else {"configured": False})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_clean_areas/settings/set",
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@callback
def ws_settings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Clean Areas is not added")
        return
    options, errors = apply(hass, dict(entry.options), dict(msg["changes"]))
    if errors:
        connection.send_error(msg["id"], "invalid_format", json.dumps(errors))
        return
    if options != dict(entry.options):
        async_update(hass, entry, options=options)
        async_dispatcher_send(hass, SIGNAL_CHANGED)
    connection.send_result(msg["id"], page(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "hk_clean_areas/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """The areas the picker offers, now and whenever they change."""
    last: list[Any] = [None]

    @callback
    def push(*_: Any) -> None:
        entry = _entry(hass)
        body = {"configured": entry is not None,
                "areas": clean.offered(hass, entry.options) if entry else []}
        if body != last[0]:
            last[0] = body
            connection.send_message(websocket_api.event_message(msg["id"], body))

    @callback
    def vacuum_changed(event: Event) -> None:
        if str(event.data.get("entity_id", "")).startswith("vacuum."):
            push()

    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_CHANGED, push),
        hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, push),
        hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, push),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, vacuum_changed),
    ]

    @callback
    def stop() -> None:
        for u in unsubs:
            u()

    connection.subscriptions[msg["id"]] = stop
    connection.send_result(msg["id"])
    push()


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_settings_get, ws_settings_set, ws_subscribe):
        websocket_api.async_register_command(hass, cmd)
