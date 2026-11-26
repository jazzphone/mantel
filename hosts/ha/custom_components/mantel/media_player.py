"""Mantel's media players (bridge.py mirrors them; entity.py draws them): Live TV's TV a paired AirPlay screen, for
Apple's Home app (Mantel's cameras/live_tv_buttons.py)."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    entry.runtime_data.attach("media_player", async_add_entities)
