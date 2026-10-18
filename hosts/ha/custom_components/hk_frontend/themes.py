"""THE HK KIOSK THEMES, loaded by the integration -- no configuration.yaml.

Home Assistant reads themes only from configuration.yaml (`frontend: themes:`)
and has no API for an integration to add one; even HACS's theme repositories
need that line. It was the one file edit a new house had to make, and the step
most likely to go wrong.

WHAT THIS DOES. The frontend keeps the themes it serves in one dict,
hass.data["frontend_themes"]: `frontend/get_themes` answers from it, and
`themes_updated` tells every open browser to ask again. At start this adds the
themes in theme/hk_kiosk_theme.yaml (HK Kiosk, HK Kiosk Camera) to that dict,
checked against the frontend's own THEME_SCHEMA, and fires the event.

THREE THINGS THE FRONTEND DOES THAT THIS HAS TO ALLOW FOR:
  * "Reload themes" REPLACES the dict with configuration.yaml's themes, so
    ours are gone. Every reload ends in themes_updated; this listens and adds
    back whatever is missing. Only what is missing, so its own event is not a
    loop.
  * The server's DEFAULT theme (frontend.set_theme) is checked against the
    dict when the frontend starts, before these are added, and again at every
    reload, and a name it does not find is reset to "default". The frontend's
    store still holds the choice, so it is put back.
  * A theme of the same name in configuration.yaml WINS: this only fills in
    names that are missing, so a house can load its own edited copy.

If the frontend ever keeps themes some other way, nothing is added, and the
Setup Check and the theme_missing Repairs entry (setup_check.py) say how to
load the theme from configuration.yaml instead.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

_LOGGER = logging.getLogger(__name__)

FILE = Path(__file__).parent / "theme" / "hk_kiosk_theme.yaml"
KEY = "hk_frontend_themes"                 # hass.data: the themes, as read
# The frontend's own names for its data, where it has them as constants.
_DEFAULTS = ("frontend_default_theme", "frontend_default_dark_theme")


def _read() -> dict[str, Any]:
    from homeassistant.components import frontend
    from homeassistant.util.yaml import load_yaml_dict

    schema = getattr(frontend, "THEME_SCHEMA", None)
    themes = {}
    for name, theme in load_yaml_dict(str(FILE)).items():
        themes[str(name)] = dict(schema(theme)) if schema else dict(theme)
    return themes


async def async_setup(hass: HomeAssistant) -> None:
    """Read the themes, add them, and add them back after every reload."""
    from homeassistant.components.frontend import EVENT_THEMES_UPDATED

    try:
        hass.data[KEY] = await hass.async_add_executor_job(_read)
    except (HomeAssistantError, OSError, ValueError) as err:
        _LOGGER.error("hk_frontend: could not read %s: %s", FILE.name, err)
        return

    @callback
    def _updated(_event: Event) -> None:
        hass.async_create_task(_async_add(hass), eager_start=True)

    hass.bus.async_listen(EVENT_THEMES_UPDATED, _updated)
    await _async_add(hass)


async def _async_add(hass: HomeAssistant) -> None:
    from homeassistant.components import frontend

    themes = hass.data.get(frontend.DATA_THEMES)
    ours = hass.data.get(KEY) or {}
    if not isinstance(themes, dict):
        return
    added = {name for name in ours if name not in themes}
    if not added:
        return
    for name in added:                     # before any await: a second event
        themes[name] = ours[name]          # finds nothing missing
    await _restore_defaults(hass, added)
    _LOGGER.debug("hk_frontend: themes added: %s", ", ".join(sorted(added)))
    hass.bus.async_fire(frontend.EVENT_THEMES_UPDATED)


async def _restore_defaults(hass: HomeAssistant, added: set[str]) -> None:
    """The server default (and dark default) the frontend reset because the
    theme was not there yet: its store still has the choice."""
    from homeassistant.components import frontend

    store = hass.data.get(getattr(frontend, "DATA_THEMES_STORE", "frontend_themes_store"))
    if store is None:
        return
    try:
        saved = await store.async_load()
    except (HomeAssistantError, OSError, ValueError):
        return
    if not isinstance(saved, dict):
        return
    for key in _DEFAULTS:
        if saved.get(key) in added and hass.data.get(key) in (None, "default"):
            hass.data[key] = saved[key]
