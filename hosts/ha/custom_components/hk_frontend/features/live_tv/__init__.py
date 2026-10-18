"""LIVE TV: an HDHomeRun's channels, live on the screens.

An HDHomeRun CONNECT sends MPEG-2 video and AC-3 audio, which no browser can
play, and it cannot transcode. So each channel is a camera entity whose
stream is a transcode WE run (stream.py: ffmpeg -> H.264/AAC MPEG-TS on
localhost), relayed to WebRTC by Home Assistant's own go2rtc -- the same path
every camera takes, so the dashboards' camera card plays it with sound.

  * channels are the feature's OPTIONS, picked from the tuner's own lineup,
    so they can be added and removed without editing anything;
  * an XMLTV guide (optional) fills each channel's "now playing" sensor;
  * screens say when they are watching (ws hk_tv/watching), and
    sensor.tv_viewers names them, so a wall tablet can stay awake.

Home Assistant's go2rtc cannot transcode this source itself (`#raw` is
refused, `#video=h264` never produces a track). One 720p transcode takes
~0.8 of one core on a 4-core VM; the first frame arrives ~6 s after the
offer; ffmpeg exits and the tuner frees ~5 s after the last viewer leaves.

One per house. The stream's path, the websocket commands (hk_tv/...)
and hass.data's key use the hk_tv prefix: the screens and the channel
cameras call them by it.
"""
from __future__ import annotations

import time
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import SubentryFlowResult
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ...const import DOMAIN
from .. import LIVE_TV, TITLES, Feature, entries, item_data, unique_id
from . import channels, settings_ws
from .const import (CONF_CHANNELS, CONF_GUIDE_URL, CONF_HOST, CONF_QUALITY, DATA,
                    DEFAULT_QUALITY, SIGNAL_VIEWERS, VIEWER_TTL_S)
from .coordinator import GuideCoordinator

PLATFORMS = [Platform.CAMERA, Platform.SENSOR]
# a change -- its gear, or the settings page -- restarts it: the channels are
# entities, and the tuner and quality are read when a stream starts
RELOAD = True


def channels_of(entry: Feature) -> list[dict]:
    return list(entry.options.get(CONF_CHANNELS, []))


def entity_ids(hass: HomeAssistant, entry: Feature, number: str) -> dict:
    """The channel's entity ids, from the registry (by unique id) -- right
    from the first state write, whichever platform loaded first."""
    from homeassistant.helpers import entity_registry as er
    reg = er.async_get(hass)
    return {"camera": reg.async_get_entity_id("camera", DOMAIN, f"{entry.entry_id}_{number}_camera"),
            "now": reg.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_{number}_now")}


@callback
def prune_channels(hass: HomeAssistant, entry: Feature) -> list[str]:
    """A channel taken off the list takes its camera and "now playing"
    sensor with it: left behind, they would be unavailable entities, and the
    settings page's Channels list makes them easy to collect. The viewers
    sensor is the feature's own and always stays."""
    from homeassistant.helpers import entity_registry as er
    reg = er.async_get(hass)
    keep = {c["number"] for c in channels_of(entry)}
    prefix = f"{entry.entry_id}_"
    gone = []
    for ent in er.async_entries_for_config_entry(reg, entry.config_entry_id):
        uid = ent.unique_id or ""
        if ent.config_subentry_id != entry.entry_id:
            continue
        if not uid.startswith(prefix) or not uid.endswith(("_camera", "_now")):
            continue
        if uid[len(prefix):].rsplit("_", 1)[0] not in keep:
            reg.async_remove(ent.entity_id)
            gone.append(ent.entity_id)
    return gone


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_") or "channel"


class Viewers:
    """Who is watching: {user_id: {"name", "channel", "at"}}, heartbeat-expired."""

    def __init__(self) -> None:
        self._v: dict[str, dict] = {}

    def set(self, user_id: str, name: str, channel: str | None, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        before = self.snapshot(now)
        if channel:
            self._v[user_id] = {"name": name, "channel": channel, "at": now}
        else:
            self._v.pop(user_id, None)
        return self.snapshot(now) != before

    def prune(self, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        gone = [k for k, v in self._v.items() if now - v["at"] > VIEWER_TTL_S]
        for k in gone:
            del self._v[k]
        return bool(gone)

    def snapshot(self, now: float | None = None) -> list[tuple[str, str]]:
        now = time.monotonic() if now is None else now
        return sorted((v["name"], v["channel"]) for v in self._v.values()
                      if now - v["at"] <= VIEWER_TTL_S)


def _data(hass: HomeAssistant) -> dict[str, Any]:
    """hass.data's share: the viewers always; the feature, its guide, the
    tuner and the quality while it runs."""
    data = hass.data.setdefault(DATA, {})
    data.setdefault("viewers", Viewers())
    return data


async def async_setup(hass: HomeAssistant) -> None:
    _data(hass)
    from .stream import TvStreamView
    hass.http.register_view(TvStreamView(hass))
    websocket_api.async_register_command(hass, ws_channels)
    websocket_api.async_register_command(hass, ws_watching)
    # the HK Settings page (settings_ws.py)
    settings_ws.async_register(hass)


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    data = _data(hass)
    prune_channels(hass, entry)
    numbers = {c["number"] for c in channels_of(entry)}
    # no config entry of its own to hang the guide's refresh on: it is shut
    # down when the feature stops
    coord = GuideCoordinator(hass, entry.data.get(CONF_GUIDE_URL) or None, numbers, None)
    # THE FIRST GUIDE IN THE BACKGROUND. Awaited here, it held up the whole
    # HK Frontend entry -- the features after Live TV (Alarm PIN's panel), the
    # Seasonal switch -- for as long as the download took: up to 60 s, then a
    # 5 MB parse, or on every Live TV restart (any change, even a channel's
    # name). The channels and their entities work without it ("Live" until it
    # arrives: they read coordinator.data or {}), and they update when it lands.
    task = hass.async_create_background_task(coord.async_refresh(), "hk_frontend: Live TV guide")
    entry.async_on_unload(task.cancel)
    data["entry"] = entry
    data["coordinator"] = coord
    data["host"] = entry.data[CONF_HOST]
    data["quality"] = entry.options.get(CONF_QUALITY, DEFAULT_QUALITY)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: Feature) -> bool:
    coord = hass.data.get(DATA, {}).get("coordinator")
    if coord is not None:
        await coord.async_shutdown()
    for k in ("entry", "coordinator"):
        hass.data.get(DATA, {}).pop(k, None)
    return True


@websocket_api.websocket_command({vol.Required("type"): "hk_tv/channels"})
@callback
def ws_channels(hass, connection, msg):
    """What a guide card draws: the channels, in order, with their entities."""
    entry = hass.data.get(DATA, {}).get("entry")
    if entry is None:
        connection.send_result(msg["id"], {"configured": False, "channels": []})
        return
    out = []
    for c in channels_of(entry):
        ids = entity_ids(hass, entry, c["number"])
        out.append({"number": c["number"], "name": c["name"],
                    "camera": ids.get("camera"), "now": ids.get("now")})
    connection.send_result(msg["id"], {"configured": True, "channels": out})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_tv/watching",
    vol.Optional("channel"): vol.Any(None, str),
})
@callback
def ws_watching(hass, connection, msg):
    """A screen is watching `channel` (heartbeat, every ~60 s), or stopped (null)."""
    user = connection.user
    viewers: Viewers = _data(hass)["viewers"]
    if viewers.set(user.id, user.name or user.id, msg.get("channel")):
        async_dispatcher_send(hass, SIGNAL_VIEWERS)
    connection.send_result(msg["id"], {"viewers": [n for n, _ in viewers.snapshot()]})


def _tuner_schema(user_input: dict[str, Any] | None) -> vol.Schema:
    return vol.Schema({
        vol.Required(CONF_HOST, default=(user_input or {}).get(CONF_HOST, "")): str,
        vol.Optional(CONF_GUIDE_URL, default=(user_input or {}).get(CONF_GUIDE_URL, "")): str,
    })


class AddSteps:
    """Add feature -> Live TV: the tuner (and a guide), then which channels.
    The channel list lives in the feature's OPTIONS, so its gear is where
    channels are added and removed; nothing about a house's channels is
    written anywhere else (the guide card reads them from here)."""

    # between the two steps: the tuner's data, its lineup and the networks
    _live_tv: dict[str, Any] | None = None

    async def async_step_live_tv(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if entries(self.hass, LIVE_TV):
            return self.async_abort(reason="already_configured")
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            guide = (user_input.get(CONF_GUIDE_URL) or "").strip()
            try:
                lineup, networks = await channels.async_catalogue(self.hass, host, guide)
            except Exception:  # noqa: BLE001
                errors[CONF_HOST] = "live_tv_cannot_connect"
            else:
                if not lineup:
                    errors[CONF_HOST] = "live_tv_no_channels"
                elif guide and not networks:
                    errors[CONF_GUIDE_URL] = "live_tv_guide_failed"
                else:
                    self._live_tv = {"data": {CONF_HOST: host, CONF_GUIDE_URL: guide},
                                     "lineup": lineup, "networks": networks}
                    return await self.async_step_live_tv_channels()
        return self.async_show_form(step_id="live_tv", errors=errors, data_schema=_tuner_schema(user_input))

    async def async_step_live_tv_channels(self, user_input: dict[str, Any] | None = None
                                          ) -> SubentryFlowResult:
        got = self._live_tv or {}
        lineup, networks = got.get("lineup") or [], got.get("networks") or {}
        if user_input is not None and user_input.get(CONF_CHANNELS):
            chans = channels.build_channels(user_input[CONF_CHANNELS], lineup, networks)
            return self.async_create_entry(
                title=TITLES[LIVE_TV], unique_id=unique_id(LIVE_TV),
                data=item_data(LIVE_TV, got.get("data"), {
                    CONF_CHANNELS: chans, CONF_QUALITY: user_input.get(CONF_QUALITY, DEFAULT_QUALITY)}))
        return self.async_show_form(
            step_id="live_tv_channels",
            errors={"base": "live_tv_pick_one"} if user_input is not None else {},
            data_schema=vol.Schema({
                vol.Required(CONF_CHANNELS): channels.channel_selector(lineup, networks),
                vol.Required(CONF_QUALITY, default=DEFAULT_QUALITY): channels.QUALITY_SELECTOR,
            }))


class ReconfigureSteps:
    """Its gear: add or remove channels, change the quality or the guide."""

    async def async_step_live_tv_options(self, user_input: dict[str, Any] | None = None
                                         ) -> SubentryFlowResult:
        entry = self._feature
        errors: dict[str, str] = {}
        try:
            lineup, networks = await channels.async_catalogue(
                self.hass, entry.data[CONF_HOST], entry.data.get(CONF_GUIDE_URL))
        except Exception:  # noqa: BLE001
            return self.async_abort(reason="live_tv_cannot_connect")
        current = entry.options.get(CONF_CHANNELS, [])
        if user_input is not None:
            if not user_input.get(CONF_CHANNELS):
                errors["base"] = "live_tv_pick_one"
            else:
                guide = (user_input.get(CONF_GUIDE_URL) or "").strip()
                return self.async_save_feature(data={**entry.data, CONF_GUIDE_URL: guide}, options={
                    **entry.options,
                    CONF_CHANNELS: channels.build_channels(user_input[CONF_CHANNELS], lineup, networks, current),
                    CONF_QUALITY: user_input.get(CONF_QUALITY, DEFAULT_QUALITY)})
        return self.async_show_form(
            step_id="live_tv_options", errors=errors,
            data_schema=vol.Schema({
                vol.Required(CONF_CHANNELS, default=[c["number"] for c in current]):
                    channels.channel_selector(lineup, networks),
                vol.Required(CONF_QUALITY, default=entry.options.get(CONF_QUALITY, DEFAULT_QUALITY)):
                    channels.QUALITY_SELECTOR,
                vol.Optional(CONF_GUIDE_URL, default=entry.data.get(CONF_GUIDE_URL, "")): str,
            }))
