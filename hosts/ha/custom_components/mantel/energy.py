"""ONE READ FOR MANTEL'S ENERGY PLAN: which sensor each helper sensor counts.

A Utility Meter publishes no `source` attribute, and an Integral's power sensor
is kept only in the sensor's own object, so the chain meter -> Integral ->
power sensor can only be read inside Home Assistant. HK Frontend answered it
(`hk_energy/sources`); with HK Frontend gone, Mantel Link does:

  mantel/energy/sources   -> {sources: {sensor: the sensor it counts}}

Admin only (Mantel asks with its own credential), read only: it changes nothing
and calls nothing.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def source_of(comp: Any, eid: str) -> str | None:
    """The entity a helper sensor counts or integrates, from the sensor's own object (a private field)."""
    if comp is None or not eid.startswith("sensor."):
        return None
    obj = comp.get_entity(eid)
    src = getattr(obj, "_sensor_source_id", None) or getattr(obj, "_source_entity", None)
    return src if isinstance(src, str) and "." in src else None


def sources(hass: HomeAssistant) -> dict[str, str]:
    """{sensor: its source} for every sensor that has one."""
    try:
        from homeassistant.components.sensor import DATA_COMPONENT
        comp = hass.data.get(DATA_COMPONENT)
    except ImportError:          # pragma: no cover -- every supported release has it
        return {}
    out: dict[str, str] = {}
    for eid in hass.states.async_entity_ids("sensor"):
        src = source_of(comp, eid)
        if src:
            out[eid] = src
    return out


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/energy/sources"})
@websocket_api.require_admin
@callback
def ws_sources(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"sources": sources(hass)})


@callback
def async_setup_energy(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_sources)
