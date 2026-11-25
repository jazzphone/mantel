"""Mantel's buttons (bridge.py mirrors them; entity.py draws them): Live TV's buttons for Apple's Home app, a channel
on a paired AirPlay screen, or Stop (Mantel's cameras/live_tv_buttons.py). homekit_entry.py puts them in their own
HomeKit Bridge, "Mantel Live TV"."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    entry.runtime_data.attach("button", async_add_entities)
