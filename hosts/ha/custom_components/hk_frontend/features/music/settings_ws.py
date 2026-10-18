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
error's message is a JSON map, field -> a sentence to show), and stored
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

from .. import MUSIC, Feature, async_update, entries
from .const import (
    CONF_CHOOSER, CONF_GROUP, CONF_HOMES, CONF_ICON, CONF_ITEMS, CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS, CONF_MEMBERS,
    CONF_NAME, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME, DEFAULT_VOLUME, SUB_PLAYLIST, SUB_PRESET,
)
from .flows import library, playlist_errors, preset_errors, speakers_errors
from .music import MusicConfig

MSG = {
    "no_speakers": "Choose at least one speaker.",
    "group_is_room": "A sync group can’t also be a room: add it as a preset.",
    "no_name": "Give it a name.",
    "no_members": "Choose the rooms it plays in.",
    "not_a_speaker": "Every room must be one of the speakers.",
    "group_room": "Choose the sync group’s own player, not a room.",
    "no_items": "Choose at least one playlist.",
    "not_in_library": "That playlist isn’t in the Music Assistant library.",
    "volume": "Choose 0 to 100 %.",
    "homes": "A home room must be one of the speakers.",
    "on_off": "Choose on or off.",
    "not_a_player": "That isn’t a Music Assistant player.",
    "list": "That list couldn’t be read.",
    "unknown": "That setting doesn’t exist.",
    "no_item": "That preset or playlist is gone.",
    "text": "That text is too long.",
}
TEXT_MAX = 60


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
                     "members": p.members} for p in cfg.presets],
        "playlists": [{"id": p.key, "name": p.name, "icon": p.icon, "items": p.items,
                       "chooser": p.chooser, "order": p.order} for p in cfg.playlists],
        "players": [{"entity": e, "name": _name(hass, e)} for e in _players(hass, entry)],
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


def _say(codes: dict[str, str]) -> dict[str, str]:
    out = {}
    for k, v in codes.items():
        out[k] = MSG["group_room"] if (k == CONF_GROUP and v == "group_is_room") else MSG.get(v, v)
    return out


def apply(hass: HomeAssistant, entry: Feature, changes: dict[str, Any]
          ) -> tuple[dict[str, Any], dict[str, str]]:
    opts, errors = dict(entry.options), {}
    players = set(_players(hass, entry))
    for k in changes:
        if k not in (CONF_SPEAKERS, CONF_VOLUME, CONF_HOMES, CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS):
            errors[k] = MSG["unknown"]
    if CONF_SPEAKERS in changes:
        sp = changes[CONF_SPEAKERS]
        if not isinstance(sp, list) or not all(isinstance(x, str) for x in sp):
            errors[CONF_SPEAKERS] = MSG["list"]
        elif any(x not in players for x in sp):
            errors[CONF_SPEAKERS] = MSG["not_a_player"]
        elif e := speakers_errors(list(dict.fromkeys(sp)), _groups(entry)):
            errors.update(_say(e))
        else:
            opts[CONF_SPEAKERS] = list(dict.fromkeys(sp))
            # a home room that is no longer a speaker is no home room
            opts[CONF_HOMES] = {u: r for u, r in (opts.get(CONF_HOMES) or {}).items() if r in opts[CONF_SPEAKERS]}
    if CONF_VOLUME in changes:
        v = changes[CONF_VOLUME]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1:
            errors[CONF_VOLUME] = MSG["volume"]
        else:
            opts[CONF_VOLUME] = round(float(v), 2)
    if CONF_IGNORE_ANNOUNCEMENTS in changes:
        if not isinstance(changes[CONF_IGNORE_ANNOUNCEMENTS], bool):
            errors[CONF_IGNORE_ANNOUNCEMENTS] = MSG["on_off"]
        else:
            opts[CONF_IGNORE_ANNOUNCEMENTS] = changes[CONF_IGNORE_ANNOUNCEMENTS]
    if CONF_KEEP_READY in changes:
        if not isinstance(changes[CONF_KEEP_READY], bool):
            errors[CONF_KEEP_READY] = MSG["on_off"]
        else:
            opts[CONF_KEEP_READY] = changes[CONF_KEEP_READY]
    if CONF_HOMES in changes:
        h = changes[CONF_HOMES]
        rooms = opts.get(CONF_SPEAKERS) or []
        if not isinstance(h, dict):
            errors[CONF_HOMES] = MSG["list"]
        elif any(r is not None and r not in rooms for r in h.values()):
            errors[CONF_HOMES] = MSG["homes"]
        else:
            homes = dict(opts.get(CONF_HOMES) or {})
            for user, r in h.items():
                if r:
                    homes[str(user)] = r
                else:
                    homes.pop(str(user), None)
            opts[CONF_HOMES] = homes
    return opts, errors


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


def _text(v: Any) -> str:
    return str(v or "").strip()


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
    errors = _say(preset_errors(name, group, members, list(entry.options.get(CONF_SPEAKERS) or [])))
    if not errors and len(name) > TEXT_MAX:
        errors[CONF_NAME] = MSG["text"]
    if not errors and group not in _players(hass, entry):
        errors[CONF_GROUP] = MSG["not_a_player"]
    if errors:
        _refused(connection, msg["id"], errors)
        return
    data = {CONF_NAME: name, CONF_GROUP: group, CONF_MEMBERS: members}
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
    vol.Optional("order"): vol.Any(None, vol.Coerce(float)),
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
    errors = _say(playlist_errors(name, items, {i["uri"] for i in lib}))
    for k, v in ((CONF_NAME, name), (CONF_CHOOSER, chooser)):
        if not errors.get(k) and len(v) > TEXT_MAX:
            errors[k] = MSG["text"]
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
    old = dict(sub.data) if sub else {}
    order = msg.get("order")
    if order is None:
        # a new pill goes last; an edited one keeps its place
        order = old.get(CONF_ORDER) if sub else max(
            [float(s.data.get(CONF_ORDER, 0) or 0) for s in entry.subentries.values()
             if s.subentry_type == SUB_PLAYLIST] or [0]) + 10
    data: dict[str, Any] = {CONF_NAME: name, CONF_ICON: _text(msg.get("icon")) or old.get(CONF_ICON) or "mdi:playlist-music",
                            CONF_ITEMS: items, CONF_ORDER: float(order or 0)}
    if chooser:
        data[CONF_CHOOSER] = chooser
    title = f"{chooser} · {name}" if chooser else name
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
    for n, s in enumerate(subs, 1):
        if float(s.data.get(CONF_ORDER, 0) or 0) != n * 10:
            hass.config_entries.async_update_subentry(entry.house, s, data={**s.data, CONF_ORDER: float(n * 10)})
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
