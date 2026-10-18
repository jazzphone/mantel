"""THE DASHBOARD SETTINGS: which entities the pages read, chosen in the UI.

The header's security line, the weather band, the sky, the idle-return timer
and the car viewport name no entity in their source: they read them from
here. The settings are chosen on the HK Settings page, stored in the entry's
options under "dashboard", and handed to every screen over
`hk_frontend/settings/subscribe` (hk-settings.js), now and again whenever
anything is edited. Each is documented on its topic's page in docs/.

The MODEL is shared (hk_core/settings/model.py: the schema and its DEFAULTS,
every value's check, the older shapes lifted, each screen resolved, what a
screen is handed) and re-exported here under its names. What is Home
Assistant's stays here: the store -- the config entry, whose options and
subentries are read into the model's plain `Stored` (stored()) by the
functions that take an entry -- the house's states for the suggestions, and
the optional cards HACS installed (find_extras).
"""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .hk_core.settings import model as M
from .hk_core.settings.model import *  # noqa: F401,F403 -- shared
from .hk_core.settings.model import (  # noqa: F401 -- shared
    _BIRTHDAY, _MENU_SHOWN, _MENU_TAB, _MISSING, _MMDD, _OLD_MENU_LISTS, _ROOM, _TAB_STYLES, _flag, _menu_shown,
    _narrow, _one_of, _typed, _whole, OPTIONAL_CARDS, Item, Stored,
)
from .house import HaHouse


def stored(entry: ConfigEntry | None) -> Stored | None:
    """The entry as the model reads it: its options and its items (subentries), in order."""
    if entry is None:
        return None
    return Stored(entry.options, tuple(
        Item(sub.subentry_type, sub.unique_id, sub.data, getattr(sub, "title", ""), getattr(sub, "subentry_id", ""))
        for sub in entry.subentries.values()))


def as_client(entry: ConfigEntry | None,
              found: dict[str, list[str]] | None = None,
              accessories: dict[str, Any] | None = None,
              extras: dict[str, Any] | None = None,
              switches: dict[str, str] | None = None,
              blacks: dict[str, str] | None = None) -> dict[str, Any]:
    """What a screen is handed (model.as_client)."""
    return M.as_client(stored(entry), found, accessories, extras, switches, blacks)


def boards(entry: ConfigEntry | None) -> dict[str, dict[str, Any]]:
    """Every dashboard item's settings, by url path (model.boards)."""
    return M.boards(stored(entry))


def tablets(entry: ConfigEntry | None) -> dict[str, dict[str, Any]]:
    """Every tablet, by id, All Tablets' Idle filled in (model.tablets)."""
    return M.tablets(stored(entry))


def popups(entry: ConfigEntry | None) -> list[dict[str, Any]]:
    """Every pop-up, by name."""
    return M.popups(stored(entry))


def custom_pages(entry: ConfigEntry | None) -> list[dict[str, Any]]:
    """Every custom page, by title."""
    return M.custom_pages(stored(entry))


def custom_chips(entry: ConfigEntry | None) -> list[dict[str, Any]]:
    """Every custom chip, by name."""
    return M.custom_chips(stored(entry))


def taken_ids(entry: ConfigEntry, exclude: str | None = None) -> set[str]:
    """Every item's unique id, of EVERY type (model.taken_ids): Home Assistant
    refuses a new item whose unique id any other item of the entry has."""
    return M.taken_ids(stored(entry), exclude)


def suggestions(hass: HomeAssistant) -> dict[str, Any]:
    """What a house that has never saved Status & Chips probably wants (model.suggestions)."""
    return M.suggestions(HaHouse(hass))


def find_extras(config_dir: str) -> dict[str, str | None]:
    """Each optional card's URL, or None when it is not installed. Blocking:
    run in the executor."""
    import os
    out: dict[str, str | None] = {}
    for key, (folder, name) in OPTIONAL_CARDS.items():
        path = os.path.join(config_dir, "www", "community", folder, name)
        try:
            out[key] = f"/hacsfiles/{folder}/{name}?v={int(os.path.getmtime(path))}"
        except OSError:
            out[key] = None
    return out
