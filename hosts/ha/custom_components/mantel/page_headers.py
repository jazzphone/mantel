"""THE LIGHTS PAGE'S "TONIGHT" LIST, for Mantel: what the house's lighting
automations will do next ("6:40 PM  Front Yard lights on · sunset").

Worked out inside Home Assistant (hk_core/link/page_headers.py, shared with HK
Frontend, which ported it first): it needs each automation's own configuration
(only code inside HA, or an admin, can read it) and HA's condition helpers.
Mantel asks for it and sends it to its screens, each person seeing only the
lights they may view:

  mantel/page_headers/get   -> {lights: {schedule: [entry, ...]}}   (admin only)

Each entry: the automation, its trigger id, when (`kind` "sun" with `event`
and `offset_s`, or "time" with `at` "HH:MM" or an input_datetime `entity`),
`effect` "on"/"off", the light and switch `entities` it acts on, `area` and
`name` from the automation's alias, and `ready`: whether its conditions hold
right now (True / False; None when they cannot be judged without the trigger).
The screens work out the next time themselves. Read only: it changes nothing
and calls nothing; it never sends an automation's configuration.
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .hk_core.link import page_headers as shared
from .hk_core.link.page_headers import (HHMM_RE, SERVICE_RE, Resolver, branch_for, checker,  # noqa: F401 -- re-exported
                                        effects, label_of, offset_s, trigger_times)
from .hk_core.link.page_headers import automations_on as _automations

_LOGGER = logging.getLogger(__name__)


def plan(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The schedule's entries, conditions not yet checked (hk_core's `plan`)."""
    return shared.plan(hass, _automations(hass), "Mantel Link: the lighting schedule skipped %s")


async def schedule(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The entries, each with its conditions checked now (`ready`)."""
    out = []
    for e in plan(hass):
        run, _reads = await checker(hass, e.pop("_conditions"))
        out.append({**e, "ready": run() if run else True})
    return out


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/page_headers/get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        entries = await schedule(hass)
    except Exception:  # noqa: BLE001 -- an empty schedule, never a broken socket
        _LOGGER.exception("Mantel Link: the lighting schedule could not be worked out")
        entries = []
    connection.send_result(msg["id"], {"lights": {"schedule": entries}})


def async_setup_page_headers(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_get)
