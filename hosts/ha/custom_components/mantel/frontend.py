"""Mantel's screens in Home Assistant's sidebar: kiosk and the way back (docs/phase9/MANTEL-LINK.md 9.6).

A Mantel screen shown in HA is a Webpage dashboard framing Mantel's own address (Mantel Settings -> the
screen -> Show in Home Assistant). Around it HA draws its header and sidebar; HK Frontend used to hide them
per screen (the screen's "Home Assistant Header & Sidebar"). Mantel Link does that now, from outside the
frame: one small script on HA's pages (frontend/mantel-link.js) listens for the screen's own messages --
"hide the header / the sidebar" and "back to Home Assistant" -- and believes them only from Mantel's own
addresses (Mantel says them in the link's hello: `screen_origins`) and only from a frame on the page it shows.
A message can hide HA's chrome around that frame or go to HA's own start page, nothing else.

  /mantel_link/mantel-link.js        the script (served from this folder; cached by its version)
  mantel/frontend/config             {origins, version}: the addresses Mantel's screens come from (any
                                     signed-in user: nothing secret)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)
URL = "/mantel_link"
SCRIPT = "mantel-link.js"
HERE = os.path.dirname(__file__)


def version() -> str:
    try:
        with open(os.path.join(HERE, "manifest.json"), encoding="utf-8") as f:
            return str(json.load(f).get("version") or "0")
    except (OSError, ValueError):
        return "0"


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/frontend/config"})
@callback
def ws_config(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    from .bridge import bridge_of
    bridge = bridge_of(hass)
    hello = bridge.link.hello if bridge is not None else {}
    origins = [o for o in (hello.get("screen_origins") or []) if isinstance(o, str) and o.startswith(("https://", "http://"))]
    connection.send_result(msg["id"], {"origins": origins, "version": hass.data.get(f"{DOMAIN}_frontend_version")})


async def async_setup_frontend(hass: HomeAssistant) -> bool:
    """The script on HA's pages, and its config. Needs HA's http and frontend (every real HA has both; the
    test harness doesn't, and then nothing is added)."""
    websocket_api.async_register_command(hass, ws_config)
    if getattr(hass, "http", None) is None or "frontend" not in hass.config.components:
        return False
    from homeassistant.components.frontend import add_extra_js_url
    from homeassistant.components.http import StaticPathConfig
    v = await hass.async_add_executor_job(version)
    hass.data[f"{DOMAIN}_frontend_version"] = v
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL, os.path.join(HERE, "frontend"), cache_headers=True)])
    add_extra_js_url(hass, f"{URL}/{SCRIPT}?v={v}")
    return True
