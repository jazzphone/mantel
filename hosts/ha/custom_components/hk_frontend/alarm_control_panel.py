"""Alarm PIN's panels -- see features/alarm_pin.

The house's entry sets this platform up; the running features add their
entities to it, each on its own item (features/async_setup_platform)."""
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import features as F


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    from . import handover, linked_mode
    # what Mantel Link holds is taken back before it is added here (handover.py)
    async_add_entities = handover.guarded(hass, entry, async_add_entities)
    if linked_mode.attach(hass, entry, "alarm_control_panel", async_add_entities):
        return                      # linked to Mantel Server: Mantel's entities
    await F.async_setup_platform(hass, Platform.ALARM_CONTROL_PANEL, async_add_entities)
