"""Live TV's settings, for the HK Settings page.

The same settings Configure asks for -- the channels (picked from the tuner's
own lineup), the picture quality, the guide -- plus the two Configure does
not offer: a channel's NAME (a station called "WXXX-DT" can be "NBC" on the
guide card) and the tuner's ADDRESS (a tuner that moved on the network). One
change at a time, each checked the way Configure checks it, refused BY FIELD
(the error's message is a JSON map, field -> a sentence to show), and stored
exactly where Configure stores it: the entry's options (channels, quality)
and data (host, guide). Saving reloads the entry, as Configure does.

    hk_tv/settings/get                    -> the page
    hk_tv/settings/set {changes: {...}}   -> the page again, or the refusal

(The commands keep the hk_tv/ prefix: the settings page calls them by it.)
Admin only. Nothing here is hard-coded: the choices are the tuner's.
"""
from __future__ import annotations

import json
import time
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .. import LIVE_TV, Feature, async_update, entries
from . import channels
from .const import CONF_CHANNELS, CONF_GUIDE_URL, CONF_HOST, CONF_QUALITY, DATA, DEFAULT_QUALITY

QUALITIES = ("720", "1080")
NAME_MAX = 40
CATALOGUE_TTL = 600          # s: the lineup and the guide's networks, kept between visits

# What a person reads under a refused field.
MSG = {
    "cannot_connect": "The tuner didn’t answer at that address.",
    "no_channels": "That tuner has no channels.",
    "guide_failed": "That guide couldn’t be read.",
    "guide_url": "Enter an address starting with http:// or https://, or leave it empty.",
    "pick_one": "Choose at least one channel.",
    "not_a_channel": "That isn’t a channel this tuner has.",
    "name": "Give it a name (up to 40 characters).",
    "name_taken": "Another channel has that name.",
    "quality": "Choose 720p or 1080p.",
    "host": "Enter the tuner’s address.",
    "unknown": "That setting doesn’t exist.",
}


def _entry(hass: HomeAssistant) -> Feature | None:
    return next(iter(entries(hass, LIVE_TV)), None)


async def _catalogue(hass: HomeAssistant, host: str, guide_url: str | None,
                     fresh: bool = False) -> tuple[list[dict], dict[str, str]]:
    """(lineup, networks), kept for CATALOGUE_TTL per (host, guide): reading
    the guide takes seconds, and the page is opened and saved in bursts."""
    store = hass.data.setdefault(DATA, {}).setdefault("catalogue", {})
    key = (host, guide_url or "")
    hit = store.get(key)
    if hit and not fresh and time.monotonic() - hit[0] < CATALOGUE_TTL:
        return hit[1], hit[2]
    lineup, networks = await channels.async_catalogue(hass, host, guide_url)
    store[key] = (time.monotonic(), lineup, networks)
    return lineup, networks


def _page(entry: Feature, lineup: list[dict] | None, networks: dict[str, str],
          error: str | None) -> dict[str, Any]:
    return {
        "configured": True,
        "state": entry.state.value,
        "title": entry.title,
        "host": entry.data.get(CONF_HOST, ""),
        "guide_url": entry.data.get(CONF_GUIDE_URL, "") or "",
        "quality": entry.options.get(CONF_QUALITY, DEFAULT_QUALITY),
        "channels": [{"number": c["number"], "name": c["name"]}
                     for c in entry.options.get(CONF_CHANNELS, [])],
        # the tuner's channels, each with its station and (from the guide) network
        "lineup": None if lineup is None else [
            {"number": c["number"], "station": c.get("name") or c["number"],
             "network": networks.get(c["number"])} for c in lineup],
        "lineup_error": error,
    }


async def _read(hass: HomeAssistant, entry: Feature, fresh: bool = False) -> dict[str, Any]:
    try:
        lineup, networks = await _catalogue(hass, entry.data[CONF_HOST],
                                            entry.data.get(CONF_GUIDE_URL), fresh)
    except Exception:  # noqa: BLE001 -- the page still shows what is saved
        return _page(entry, None, {}, MSG["cannot_connect"])
    return _page(entry, lineup, networks, None)


async def apply(hass: HomeAssistant, entry: Feature, changes: dict[str, Any]
                ) -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    """(data, options, errors) after `changes`. Pure but for reading the
    tuner and the guide when the address, the guide or the channels change."""
    data, options = dict(entry.data), dict(entry.options)
    errors: dict[str, str] = {}
    for k in changes:
        if k not in ("host", "guide_url", "channels", "names", "quality"):
            errors[k] = MSG["unknown"]
    if errors:
        return data, options, errors

    if "quality" in changes:
        if str(changes["quality"]) not in QUALITIES:
            errors["quality"] = MSG["quality"]
        else:
            options[CONF_QUALITY] = str(changes["quality"])

    host = data.get(CONF_HOST, "")
    if "host" in changes:
        host = str(changes["host"] or "").strip()
        if not host:
            errors["host"] = MSG["host"]
    guide = data.get(CONF_GUIDE_URL, "") or ""
    if "guide_url" in changes:
        guide = str(changes["guide_url"] or "").strip()
        if guide and not guide.lower().startswith(("http://", "https://")):
            errors["guide_url"] = MSG["guide_url"]
    if errors:
        return data, options, errors

    lineup: list[dict] = []
    networks: dict[str, str] = {}
    needs = any(k in changes for k in ("host", "guide_url", "channels"))
    if needs:
        # a new address or guide is read NOW, as setup reads it: saved, a
        # wrong one would only show as a screen with no channels
        try:
            lineup, networks = await _catalogue(hass, host, guide,
                                                fresh="host" in changes or "guide_url" in changes)
        except Exception:  # noqa: BLE001
            errors["host" if "host" in changes else "channels"] = MSG["cannot_connect"]
            return data, options, errors
        if not lineup:
            errors["host" if "host" in changes else "channels"] = MSG["no_channels"]
            return data, options, errors
        if "guide_url" in changes and guide and not networks:
            errors["guide_url"] = MSG["guide_failed"]
            return data, options, errors
    # READ AGAIN AFTER THE ONE SLOW STEP (the tuner and the guide, seconds on a
    # cold cache): built from the copy taken before it, a change another write
    # saved meanwhile went back to its old value. The quality checked above is
    # laid on the fresh copy.
    data, options = dict(entry.data), dict(entry.options)
    if "quality" in changes:
        options[CONF_QUALITY] = str(changes["quality"])
    data[CONF_HOST], data[CONF_GUIDE_URL] = host, guide

    # copies: a rename must not edit the saved options in place (the change
    # would then compare equal and never be written)
    current = [dict(c) for c in options.get(CONF_CHANNELS, [])]
    if "channels" in changes:
        nums = changes["channels"]
        if not isinstance(nums, list) or not all(isinstance(n, str) for n in nums):
            errors["channels"] = MSG["not_a_channel"]
        elif not nums:
            errors["channels"] = MSG["pick_one"]
        else:
            have = {c["number"] for c in lineup} | {c["number"] for c in current}
            if any(n not in have for n in nums):
                errors["channels"] = MSG["not_a_channel"]
            else:
                current = channels.build_channels(list(dict.fromkeys(nums)), lineup, networks, current)
    if "names" in changes and not errors:
        names = changes["names"]
        if not isinstance(names, dict):
            errors["names"] = MSG["name"]
        else:
            by_num = {c["number"]: c for c in current}
            for num, name in names.items():
                name = str(name or "").strip()
                if num not in by_num:
                    errors["names"] = MSG["not_a_channel"]
                    break
                if not name or len(name) > NAME_MAX:
                    errors["names"] = MSG["name"]
                    break
                if any(c["name"].casefold() == name.casefold() for c in current if c["number"] != num):
                    errors["names"] = MSG["name_taken"]
                    break
                by_num[num]["name"] = name
    if not errors:
        options[CONF_CHANNELS] = current
    return data, options, errors


def _refused(connection, msg_id: int, errors: dict[str, str]) -> None:
    connection.send_error(msg_id, "invalid_format", json.dumps(errors))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_tv/settings/get",
    vol.Optional("fresh", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_result(msg["id"], {"configured": False})
        return
    connection.send_result(msg["id"], await _read(hass, entry, msg.get("fresh", False)))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_tv/settings/set",
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "Live TV is not added.")
        return
    data, options, errors = await apply(hass, entry, dict(msg["changes"]))
    if errors:
        _refused(connection, msg["id"], errors)
        return
    if data != dict(entry.data) or options != dict(entry.options):
        async_update(hass, entry, data=data, options=options)
    connection.send_result(msg["id"], await _read(hass, entry))


def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_settings_get, ws_settings_set):
        websocket_api.async_register_command(hass, cmd)
