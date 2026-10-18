"""Energy's settings, for the HK Settings page (admin only):

    hk_energy/settings/get                     -> the page
    hk_energy/settings/set {changes: {...}}    -> the page again, or the refusal
    hk_energy/device/set {key, changes}        -> one device's own settings
                                                  (name, icon, color, power,
                                                  control, hidden); a null
                                                  value goes back to Automatic
    hk_energy/sources                          -> {sources: {sensor: the sensor it counts}}, read
                                                  only (Mantel's plan reads the helpers' sources)
    hk_energy/device/section {key, section}    -> one device moved into a
                                                  section (and shown): every
                                                  other device keeps its place,
                                                  hidden ones and empty
                                                  sections too

The page is the stored options, the plan the screens draw, and every device
the page could show -- hidden ones too -- with how its power sensor was
found. Each change is checked the way the field means it and refused BY FIELD
(the message is a JSON map, field -> a sentence to show).
"""
from __future__ import annotations

import json
import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .. import ENERGY, Feature, async_update, entries
from . import plan
from .power import check as _power_check
from .const import (COLORS, CONF_BATTERIES, CONF_COST, CONF_DETAIL, CONF_DEVICES, CONF_EXTRA, CONF_FOLLOW,
                    CONF_PAGE, CONF_POWER, PERIODS, RINGS, TYPICAL, CONF_SECTIONS, CONF_TITLE, CONF_TOP, CONF_TOTAL, CONF_USAGES, OPTION_KEYS, SECTIONS, TOP_MAX,
                    USAGES_MAX)

# THE CHECKS are the shared ones (hk_core/energy/settings.py); kept under their names here
from ...hk_core.energy.settings import (  # noqa: F401,E402
    DEVICE_FIELDS, ENTITY, ICON, MSG, NAME_MAX, PATH, SLUG, _battery, _ent, _ent_or_blank, _extra, _list_of, _name,
    _page, _section, _usage, apply, apply_device, check_device, move_device)



def _entry(hass: HomeAssistant) -> Feature | None:
    return next(iter(entries(hass, ENERGY)), None)


def _ctx(hass: HomeAssistant, entry: Feature) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """(the plan worked out afresh, or None while the feature is not
    running; what it was worked out from)."""
    from . import context, current, house, prefs
    pl = current(hass, fresh=True)
    ctx = context(hass) if pl is not None else None
    if ctx is None:
        ctx = plan.collect(hass, prefs(hass), dict(entry.options), house(hass))
    return pl, ctx


def page(hass: HomeAssistant, entry: Feature) -> dict[str, Any]:
    from . import prefs
    opts = dict(entry.options)
    pl, ctx = _ctx(hass, entry)
    pl = pl or {}
    devs = plan.devices(ctx, opts)
    names = {d["key"]: d["name"] for d in devs}
    bats = plan.batteries(ctx, opts)
    secs = plan.sections(devs, bats, opts)
    p = prefs(hass) or {}
    return {
        "configured": True,
        "state": entry.state.value,
        "options": {k: opts.get(k) for k in OPTION_KEYS},
        "plan": pl,
        "devices": [{k: d[k] for k in ("key", "name", "raw", "stat", "power", "found", "section", "icon", "color",
                                        "control", "hidden", "extra", "parent", "children", "runtime")}
                    | {"parent_name": names.get(d["parent"] or "")} for d in devs],
        "batteries": bats,
        "sections": secs,
        "section_kinds": [list(s) for s in SECTIONS],
        "grid": plan.grid_of(p),
        "energy": {"grid": bool(plan.grid_of(p)), "devices": len(p.get("device_consumption") or []),
                   "url": "/config/energy"},
        "colors": list(COLORS),
    }


# ---------------------------------------------------------------- commands
def _save(hass: HomeAssistant, entry: Feature, options: dict[str, Any]) -> None:
    """Stored; the house's update listener then sends the screens the new
    plan (once -- features.async_sync does not, and neither does this)."""
    if options != dict(entry.options):
        async_update(hass, entry, options=options)
        from . import invalidate
        invalidate(hass, tell=False)


# fresh: HK Settings' common ask (hk-settings.js); every answer here is fresh
@websocket_api.websocket_command({vol.Required("type"): "hk_energy/settings/get",
                                  vol.Optional("fresh"): bool})
@websocket_api.require_admin
@callback
def ws_settings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    connection.send_result(msg["id"], page(hass, entry) if entry else {"configured": False})


# THE HELPER SOURCES (read only): which sensor each Utility Meter / Integral / Derivative sensor counts. HA's
# own plan reads them from the sensors' objects (plan.collect); Mantel cannot, and asks here once for its plan
# (Utility Meters carry no `source` attribute -- the house, 2026-10-18).
@websocket_api.websocket_command({vol.Required("type"): "hk_energy/sources"})
@websocket_api.require_admin
@callback
def ws_sources(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    from . import plan as _plan
    connection.send_result(msg["id"], {"sources": _plan.sources(hass)})


@websocket_api.websocket_command({vol.Required("type"): "hk_energy/settings/set", vol.Required("changes"): dict})
@websocket_api.require_admin
@callback
def ws_settings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Energy is not added")
        return
    options, errors = apply(dict(entry.options), dict(msg["changes"]))
    if errors:
        connection.send_error(msg["id"], "invalid_format", json.dumps(errors))
        return
    _save(hass, entry, options)
    connection.send_result(msg["id"], page(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "hk_energy/device/set", vol.Required("key"): str,
                                  vol.Required("changes"): dict})
@websocket_api.require_admin
@callback
def ws_device_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Energy is not added")
        return
    options, err = apply_device(dict(entry.options), msg["key"], dict(msg["changes"]))
    if err:
        connection.send_error(msg["id"], "invalid_format", json.dumps({k: err for k in msg["changes"]}))
        return
    _save(hass, entry, options)
    connection.send_result(msg["id"], page(hass, entry))


@websocket_api.websocket_command({vol.Required("type"): "hk_energy/device/section", vol.Required("key"): str,
                                  vol.Required("section"): str})
@websocket_api.require_admin
@callback
def ws_device_section(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Energy is not added")
        return
    opts = dict(entry.options)
    _pl, ctx = _ctx(hass, entry)
    devs = plan.devices(ctx, opts)
    bats = plan.batteries(ctx, opts)
    placed = plan.sections(devs, bats, opts)
    keys = {d["key"] for d in devs} | {b["key"] for b in bats}
    options, errors = move_device(opts, placed, keys, msg["key"], msg["section"])
    if errors:
        connection.send_error(msg["id"], "invalid_format", json.dumps(errors))
        return
    _save(hass, entry, options)
    connection.send_result(msg["id"], page(hass, entry))


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_settings_get, ws_settings_set, ws_device_set, ws_device_section, ws_sources):
        websocket_api.async_register_command(hass, cmd)
