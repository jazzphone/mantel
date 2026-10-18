"""Live TV's "now on" and viewers sensors -- see features/live_tv -- and each
screen's Sleep Screen (sensor.<screen>_sleep_screen, sleep_engine.py).

The house's entry sets this platform up; the running features add their
entities to it, each on its own item (features/async_setup_platform)."""
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import features as F


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    await F.async_setup_platform(hass, Platform.SENSOR, async_add_entities)
    from . import screensaver
    await screensaver.async_setup_platform(hass, entry, "sensor", async_add_entities)


from .screensaver import SaverEntity  # noqa: E402

SLEEP_KEY = "sleep_screen"


class SleepScreenSensor(SaverEntity, SensorEntity):
    """sensor.<screen>_sleep_screen -- what the screen's Sleep Screen
    decides it should show (dark, photos, dashboard, hold), and why; or
    `automation` while an automation decides."""

    _attr_icon = "mdi:tablet-dashboard"

    def __init__(self, mgr: Any, path: str, title: str, uid: str | None = None) -> None:
        SaverEntity.__init__(self, mgr, path, title, SLEEP_KEY, uid)

    def _engine(self) -> Any:
        return self._mgr.engines.get(self._path)

    @property
    def native_value(self) -> str:
        eng = self._engine()
        return eng.want if eng is not None else "automation"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        base = {k: v for k, v in super().extra_state_attributes.items() if k in ("tablet", "dashboard")}
        eng = self._engine()
        return {**base, **(eng.attributes() if eng is not None else {"decided_by": "automation"})}
