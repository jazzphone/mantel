"""Download diagnostics: how the link stands, never a credential."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .bridge import Bridge, hk_report, wire_owners
from .const import CONF_OWNERS, CONF_URL


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    bridge = getattr(entry, "runtime_data", None)
    if isinstance(bridge, Bridge):
        return bridge.diagnostics()
    return {"url": entry.data.get(CONF_URL), "connected": False, "state": "not set up",
            "owners": wire_owners(entry.data.get(CONF_OWNERS)), "hk_frontend": hk_report(hass)}
