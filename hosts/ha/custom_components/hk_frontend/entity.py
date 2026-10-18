"""What every entity of this integration shares: one service device, "HK
Frontend", per entry, stable unique ids, and a state rewrite whenever the
entry's options change (their state lives in the options)."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, SIGNAL_CONFIG


class HkEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, key: str) -> None:
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)}, name="HK Frontend",
            entry_type=DeviceEntryType.SERVICE)

    async def async_added_to_hass(self) -> None:
        # The same signal the screens are re-sent their settings on (__init__).
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_CONFIG,
                                                      self._config_changed))

    @callback
    def _config_changed(self) -> None:
        self.async_write_ha_state()
