"""HK'S SETTINGS HANDED BACK (decision 29 in Mantel's docs/phase9/TWO-PRODUCTS.md).

While HK Frontend is linked and Mantel runs the house, HK's settings are
Mantel's: linked_mode.py keeps the last ones Mantel sent (its mirror, in the
Store hk_frontend.mantel_settings, marked `owned`) and the dashboards draw
with them. When that ends -- the house moved back to Home Assistant, or the
link removed -- the entry is set up as HK Frontend's own again, and this takes
the last mirror into it ONCE, so nothing changed in Mantel is lost:

  * the house's sections (options "dashboard"), each as stored (only what
    differs from its default); Browse Music's Discover rows go back to keys;
  * every screen (its `dashboard` item), as read less what is worked out from
    the rest (the *_house flags, its tablets, its idle room);
  * every tablet's settings the feed carries (name, screen, room, user, app,
    idle, black screen), over what its item already holds;
  * pop-ups, custom pages and custom chips, each by its id;
  * the accessories (the Store hk_frontend.accessories).

An item Mantel no longer has is left as it is (nothing is deleted here). The
mirror is then marked not owned, so a later setup takes nothing again.
"""
from __future__ import annotations

from collections.abc import Mapping
import logging
from types import MappingProxyType
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import settings as S
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# what a screen's feed carries that is worked out, not stored (Mantel's settings_store _READ_ONLY_BOARD)
READ_ONLY_BOARD = ("screensaver_house", "rooms_house", "cameras_house", "menu_house", "tablets", "idle_room")
TABLET_FIELDS = ("name", "screen", "room", "user", "app", "idle_return", "idle_time", "black_screen")


def _subs(entry: ConfigEntry, kind: str) -> dict[str, Any]:
    return {s.unique_id: s for s in entry.subentries.values() if s.subentry_type == kind and s.unique_id}


def _put(hass: HomeAssistant, entry: ConfigEntry, kind: str, uid: str, data: dict[str, Any], title: str) -> None:
    sub = _subs(entry, kind).get(uid)
    if sub is None:
        hass.config_entries.async_add_subentry(entry, ConfigSubentry(
            data=MappingProxyType(data), subentry_type=kind, title=title or uid, unique_id=uid))
    elif dict(sub.data) != data:
        hass.config_entries.async_update_subentry(entry, sub, data=data)


def house_options(options: Mapping[str, Any], payload: Mapping[str, Any]) -> dict[str, Any]:
    """The entry's options with the payload's house sections as stored."""
    defaults = S.merged(None)
    dash = dict((options or {}).get(S.CONF_DASHBOARD) or {})
    for section in defaults:
        values = payload.get(section)
        if not isinstance(values, Mapping):
            continue
        values = dict(values)
        disc = values.get("discover") if section == "browse" else None
        if isinstance(disc, list) and all(isinstance(r, Mapping) for r in disc):
            values["discover"] = [r["key"] for r in disc if isinstance(r.get("key"), str)]
        dash[section] = S.house_stored(section, values)
    return {**dict(options or {}), S.CONF_DASHBOARD: dash}


def adopt(hass: HomeAssistant, entry: ConfigEntry, payload: Mapping[str, Any]) -> None:
    """Take Mantel's last settings into the entry (see above)."""
    hass.config_entries.async_update_entry(entry, options=house_options(entry.options, payload))
    for path, b in (payload.get("boards") or {}).items():
        if isinstance(path, str) and isinstance(b, Mapping):
            data = S.board_stored({k: v for k, v in b.items() if k not in READ_ONLY_BOARD})
            _put(hass, entry, S.SUBENTRY_DASHBOARD, path, data, str(b.get("title") or path))
    tablets = _subs(entry, S.SUBENTRY_TABLET)
    for tid, t in (payload.get("tablet_items") or {}).items():
        if isinstance(tid, str) and isinstance(t, Mapping):
            old = dict(tablets[tid].data) if tid in tablets else {"uid": f"tablet_{tid}"}
            data = S.tablet_stored({**old, **{k: t[k] for k in TABLET_FIELDS if k in t}}, tid)
            _put(hass, entry, S.SUBENTRY_TABLET, tid, data, str(t.get("name") or tid))
    for kind, key, name, items in ((S.SUBENTRY_POPUP, "hash", "name", payload.get("popups")),
                                   (S.SUBENTRY_PAGE, "path", "title", payload.get("custom_pages")),
                                   (S.SUBENTRY_CHIP, "key", "name", payload.get("custom_chips"))):
        for item in items or []:
            if isinstance(item, Mapping) and isinstance(item.get(key), str) and item[key]:
                data = {k: v for k, v in item.items() if k not in (key, "item", "used_on")}
                _put(hass, entry, kind, item[key], data, str(item.get(name) or item[key]))
    acc = payload.get("accessories")
    from . import accessories
    store = hass.data.get(DOMAIN, {}).get(accessories.DATA)
    if isinstance(acc, Mapping) and store is not None:
        store.data = accessories.clean(dict(acc))
        store._changed()


async def adopt_if_handed_back(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """At the entry's own setup (the settings are HK Frontend's): Mantel's last
    settings taken in, once, if they were Mantel's until now. True if taken."""
    from . import linked_mode
    store: Store = linked_mode.mirror_store(hass)
    try:
        got = await store.async_load()
    except Exception:  # noqa: BLE001 -- nothing to take
        _LOGGER.exception("hk_frontend: Mantel's last settings could not be read")
        return False
    if not isinstance(got, Mapping) or got.get("owned") is not True or not isinstance(got.get("payload"), Mapping):
        return False
    try:
        adopt(hass, entry, got["payload"])
    except Exception:  # noqa: BLE001 -- the entry keeps its own; the mirror stays for another try
        _LOGGER.exception("hk_frontend: Mantel's last settings could not be taken in; HK Frontend keeps its own")
        return False
    await store.async_save({**got, "owned": False})
    _LOGGER.warning("hk_frontend: HK's settings are this integration's again; Mantel's last ones (version %s) "
                    "were taken in", got.get("version"))
    return True
