"""Music's settings, for the HK Settings page.

What Configure and the + Add Preset / + Add Playlist dialogs set, one change
at a time:

    hk_music/settings/get                      -> the page
    hk_music/settings/set {changes}            -> speakers (in order), volume (0..1),
                                                  homes ({user id: speaker or null}),
                                                  keep_ready (true/false)
    hk_music/settings/library                  -> the library's playlists [{uri, name}]
    hk_music/preset/save {item?, name, group, members}   (item: the preset's id; none adds one)
    hk_music/playlist/save {item?, name, icon, items, chooser, order}
    hk_music/playlists/order {ids}             -> the pills' order
    hk_music/item/remove {item}                -> a preset or a playlist gone

Admin only. Checked by the same helpers as those dialogs (flows.py's
speakers_errors / preset_errors / playlist_errors), refused BY FIELD (the
error's message is a JSON map, field -> a sentence to show) -- the checks, the
words and each save's shape are shared (hk_core/music/settings.py); who may
ask, what the choices are and where it is kept are Home Assistant's -- and stored
where they store it: the entry's options, and its preset and playlist
subentries. The screens hear every change at once (the entry's update
listener tells them). Nothing here is hard-coded: the choices are Music
Assistant's players and library, and Home Assistant's users.

The commands keep their hk_music/ names: the settings page speaks them, and
the feature is found by them.
"""
from __future__ import annotations

import json
from types import MappingProxyType
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigSubentry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ...hk_core.music import settings as S
from ...hk_core.music.settings import MSG, TEXT_MAX  # noqa: F401 -- names callers read here
from .. import MUSIC, Feature, async_update, entries
from .const import (
    CONF_GROUP, CONF_HOMES, CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME,
    DEFAULT_VOLUME, SIGNAL_CONFIG, SUB_PLAYLIST, SUB_PRESET,
)
from .flows import library, playlist_errors, preset_errors, speakers_errors  # noqa: F401
from .music import MusicConfig


def _entry(hass: HomeAssistant) -> Feature | None:
    """The house's Music entry (one per house), loaded or not."""
    return next(iter(entries(hass, MUSIC)), None)


def _name(hass: HomeAssistant, eid: str) -> str:
    st = hass.states.get(eid)
    if st and st.attributes.get("friendly_name"):
        return str(st.attributes["friendly_name"])
    ent = er.async_get(hass).async_get(eid)
    return (ent.name or ent.original_name or eid) if ent else eid


def _groups(entry: Feature) -> list[str]:
    return [str(s.data[CONF_GROUP]) for s in entry.subentries.values()
            if s.subentry_type == SUB_PRESET and s.data.get(CONF_GROUP)]


def _players(hass: HomeAssistant, entry: Feature) -> list[str]:
    """Music Assistant's players, and whatever is already chosen."""
    reg = er.async_get(hass)
    ma = {e.entity_id for e in reg.entities.values()
          if e.platform == "music_assistant" and e.domain == "media_player" and not e.disabled_by}
    chosen = set(entry.options.get(CONF_SPEAKERS) or []) | set(_groups(entry))
    return sorted(ma | chosen, key=lambda x: _name(hass, x).casefold())


async def _users(hass: HomeAssistant) -> list[dict[str, str]]:
    users = [u for u in await hass.auth.async_get_users() if u.is_active and not u.system_generated]
    return sorted(({"id": u.id, "name": u.name or u.id} for u in users), key=lambda u: u["name"].casefold())


async def page(hass: HomeAssistant) -> dict[str, Any]:
    entry = _entry(hass)
    if entry is None:
        return {"configured": False}
    mgr = getattr(entry, "runtime_data", None)
    if mgr is not None and hasattr(mgr, "refresh_groups") and await mgr.refresh_groups():
        async_dispatcher_send(hass, SIGNAL_CONFIG)      # Music Assistant's groups, read fresh for the page
    cfg = MusicConfig.from_entry(hass, entry)
    floor = {r.entity: r.floor for r in cfg.rooms}
    room = {r.entity: r.name for r in cfg.rooms}
    return {
        "configured": True,
        "state": entry.state.value,
        # in the order Configure lists them (screens group them by floor)
        "speakers": [{"entity": e, "name": room.get(e) or _name(hass, e), "floor": floor.get(e),
                      "player": _name(hass, e)} for e in (entry.options.get(CONF_SPEAKERS) or [])],
        "volume": float(entry.options.get(CONF_VOLUME, DEFAULT_VOLUME)),
        "homes": dict(entry.options.get(CONF_HOMES) or {}),
        "users": await _users(hass),
        "presets": [{"id": p.key, "name": p.name, "group": p.group, "group_name": _name(hass, p.group),
                     "members": p.members, **S.preset_extra(cfg, p)} for p in cfg.presets],
        "playlists": [{"id": p.key, "name": p.name, "icon": p.icon, "items": p.items,
                       "chooser": p.chooser, "order": p.order} for p in cfg.playlists],
        "players": [{"entity": e, "name": _name(hass, e)} for e in _players(hass, entry)],
        # Music Assistant's groups: the pairs among the speakers, each group's rooms and problems
        **S.groups_page(cfg, _players(hass, entry)),
        "library_ready": cfg.library_entry is not None,
        "ignore_announcements": entry.options.get(CONF_IGNORE_ANNOUNCEMENTS, True),
        "keep_ready": bool(entry.options.get(CONF_KEEP_READY)),
        # the last round, or None: {at, ready, wanted, note}
        "keep_ready_last": _warmer_status(entry),
    }


def _warmer_status(entry: Feature) -> dict[str, Any] | None:
    warmer = getattr(getattr(entry, "runtime_data", None), "warmer", None)
    return warmer.status() if warmer is not None else None


def _refused(connection, msg_id: int, errors: dict[str, str]) -> None:
    connection.send_error(msg_id, "invalid_format", json.dumps(errors))


_say = S.say


def apply(hass: HomeAssistant, entry: Feature, changes: dict[str, Any]
          ) -> tuple[dict[str, Any], dict[str, str]]:
    """The options after `changes`, and the refusals by field (hk_core.music.settings.apply)."""
    return S.apply(entry.options, changes, set(_players(hass, entry)), _groups(entry))


@websocket_api.websocket_command({vol.Required("type"): "hk_music/settings/get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], await page(hass))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_music/settings/set",
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Music is not added")
        return
    opts, errors = apply(hass, entry, dict(msg["changes"]))
    if errors:
        _refused(connection, msg["id"], errors)
        return
    if opts != dict(entry.options):
        async_update(hass, entry, options=opts)
    connection.send_result(msg["id"], await page(hass))


@websocket_api.websocket_command({vol.Required("type"): "hk_music/settings/library"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_library(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"items": await library(hass)})


def _sub(entry: Feature, sid: str | None, kind: str) -> ConfigSubentry | None:
    s = entry.subentries.get(sid) if sid else None
    return s if s is not None and s.subentry_type == kind else None


_text = S.text


@websocket_api.websocket_command({
    vol.Required("type"): "hk_music/preset/save",
    vol.Optional("item"): vol.Any(None, str),
    vol.Required("name"): str,
    vol.Required("group"): str,
    vol.Required("members"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_preset_save(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Music is not added")
        return
    sub = _sub(entry, msg.get("item"), SUB_PRESET)
    if msg.get("item") and sub is None:
        _refused(connection, msg["id"], {"item": MSG["no_item"]})
        return
    name, group, members = _text(msg["name"]), msg["group"], list(dict.fromkeys(msg["members"]))
    errors = S.check_preset(name, group, members, list(entry.options.get(CONF_SPEAKERS) or []),
                            lambda: _players(hass, entry))
    if errors:
        _refused(connection, msg["id"], errors)
        return
    data = S.preset_data(name, group, members)
    if sub is None:
        hass.config_entries.async_add_subentry(entry.house, ConfigSubentry(
            data=MappingProxyType(data), subentry_type=SUB_PRESET, title=name, unique_id=None))
    else:
        hass.config_entries.async_update_subentry(entry.house, sub, title=name, data=data)
    connection.send_result(msg["id"], await page(hass))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_music/playlist/save",
    vol.Optional("item"): vol.Any(None, str),
    vol.Required("name"): str,
    vol.Optional("icon"): vol.Any(None, str),
    vol.Required("items"): [str],
    vol.Optional("chooser"): vol.Any(None, str),
    # a finite number: "nan" or "inf" coerce to floats that sort unpredictably and are stored as null
    vol.Optional("order"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=-1e6, max=1e6))),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_playlist_save(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Music is not added")
        return
    sub = _sub(entry, msg.get("item"), SUB_PLAYLIST)
    if msg.get("item") and sub is None:
        _refused(connection, msg["id"], {"item": MSG["no_item"]})
        return
    name, chooser = _text(msg["name"]), _text(msg.get("chooser"))
    items = [i for i in dict.fromkeys(msg["items"]) if i]
    lib = await library(hass)
    errors = S.check_playlist(name, chooser, items, {i["uri"] for i in lib})
    if errors:
        _refused(connection, msg["id"], errors)
        return
    # LOOKED UP AGAIN after the library read (Music Assistant, seconds when
    # cold): a playlist removed meanwhile is said to be gone, not written to
    # (Home Assistant raised UnknownSubEntry, and the page heard nothing).
    if msg.get("item"):
        sub = _sub(entry, msg.get("item"), SUB_PLAYLIST)
        if sub is None:
            _refused(connection, msg["id"], {"item": MSG["no_item"]})
            return
    # a new pill goes last; an edited one keeps its place
    title, data = S.playlist_save(
        name, chooser, items, msg.get("icon"), msg.get("order"), sub.data if sub else None,
        [float(s.data.get(CONF_ORDER, 0) or 0) for s in entry.subentries.values()
         if s.subentry_type == SUB_PLAYLIST])
    if sub is None:
        hass.config_entries.async_add_subentry(entry.house, ConfigSubentry(
            data=MappingProxyType(data), subentry_type=SUB_PLAYLIST, title=title, unique_id=None))
    else:
        hass.config_entries.async_update_subentry(entry.house, sub, title=title, data=data)
    connection.send_result(msg["id"], await page(hass))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_music/playlists/order",
    vol.Required("ids"): [str],
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_playlists_order(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """The pills' order: each playlist's `order` becomes its place x 10."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Music is not added")
        return
    subs = [_sub(entry, i, SUB_PLAYLIST) for i in msg["ids"]]
    if any(s is None for s in subs):
        _refused(connection, msg["id"], {"ids": MSG["no_item"]})
        return
    for i, order in S.reorder([s.data.get(CONF_ORDER, 0) for s in subs]):
        s = subs[i]
        hass.config_entries.async_update_subentry(entry.house, s, data={**s.data, CONF_ORDER: order})
    connection.send_result(msg["id"], await page(hass))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_music/item/remove",
    vol.Required("item"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_item_remove(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    sub = entry.subentries.get(msg["item"]) if entry else None
    if sub is None or sub.subentry_type not in (SUB_PRESET, SUB_PLAYLIST):
        _refused(connection, msg["id"], {"item": MSG["no_item"]})
        return
    hass.config_entries.async_remove_subentry(entry.house, sub.subentry_id)
    connection.send_result(msg["id"], await page(hass))


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_settings_get, ws_settings_set, ws_library, ws_preset_save, ws_playlist_save,
                ws_playlists_order, ws_item_remove):
        websocket_api.async_register_command(hass, cmd)
