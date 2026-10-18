"""Each screen's in-use sensor (screensaver.py): on while the screen was
touched within its window -- Starts After less a minute."""
from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from .screensaver import INUSE_KEY, SaverEntity, async_setup_platform, window_of


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await async_setup_platform(hass, entry, "binary_sensor", async_add_entities)


class ScreenInUse(SaverEntity, BinarySensorEntity):
    _attr_icon = "mdi:gesture-tap"

    def __init__(self, mgr: Any, path: str, title: str, uid: str | None = None) -> None:
        SaverEntity.__init__(self, mgr, path, title, INUSE_KEY, uid)
        self._off_later = None

    @property
    def is_on(self) -> bool:
        t = self._mgr.touch.get(self._path)
        if t is None:
            return False
        return (dt_util.utcnow() - t).total_seconds() < window_of(self._starts_after())

    def touched(self) -> None:
        # off exactly when the window runs out, not at the next poll
        if self._off_later:
            self._off_later()
        self._off_later = async_call_later(self.hass, window_of(self._starts_after()) + 0.5, self._expire)
        self.async_write_ha_state()

    @callback
    def _expire(self, _now: Any) -> None:
        self._off_later = None
        self.async_write_ha_state()

    async def async_will_remove_from_hass(self) -> None:
        if self._off_later:
            self._off_later()
            self._off_later = None
