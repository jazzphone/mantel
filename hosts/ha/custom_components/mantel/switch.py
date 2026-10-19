"""Mantel's switches (bridge.py mirrors them; entity.py draws them): a wall
tablet's black screen and photo screensaver, Seasonal decorations. Their
action, mantel.set_black_screen, is registered here (the alias
hk_frontend.set_black_screen is services.py's)."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

# black on or off, and the brightness it comes back to, in one call (a house's
# sleep and wake scripts); the same as HK Frontend's
BLACK_SCREEN_SCHEMA = {
    vol.Optional("black"): cv.boolean,
    vol.Optional("brightness"): vol.All(vol.Coerce(int), vol.Range(min=0, max=255)),
}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    entity_platform.async_get_current_platform().async_register_entity_service(
        "set_black_screen", BLACK_SCREEN_SCHEMA, "async_set_black_screen")
    entry.runtime_data.attach("switch", async_add_entities)
