"""Mantel's entities, as Home Assistant shows them (bridge.py mirrors them).

The same classes HK Frontend's linked mode had (hk_frontend/linked_mode.py),
so an entity looks and behaves the same after the bridge hand-over: state,
attributes, commands. Devices are Mantel's ("Mantel", the model Mantel says).
"""
from __future__ import annotations

from typing import Any

from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity, AlarmControlPanelEntityFeature, AlarmControlPanelState, CodeFormat,
)
from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.components.media_player import (
    MediaPlayerDeviceClass, MediaPlayerEntity, MediaPlayerEntityFeature, MediaPlayerState,
)
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from .const import DOMAIN, HK_DOMAIN
from .hk_core.link.linked_reserved import _RESERVED  # shared with HK Frontend

MANUFACTURER = "Mantel"


def device_name(name: Any) -> Any:
    """A device's name as Mantel says it; the house's own device ("HK Frontend"
    in HK Frontend) is Mantel's here."""
    return MANUFACTURER if name == "HK Frontend" else name


def suggested(entity_id: Any) -> str | None:
    """The entity id Mantel suggests, used only the first time (the registry
    keeps a known one). HK Frontend's own prefix becomes Mantel Link's for an
    entity that never existed in HK Frontend."""
    if not isinstance(entity_id, str) or "." not in entity_id:
        return None
    domain, obj = entity_id.split(".", 1)
    if obj.startswith(HK_DOMAIN + "_"):
        obj = DOMAIN + obj[len(HK_DOMAIN):]
    return f"{domain}.{obj}"


class LinkedEntity(Entity):
    """One of Mantel's entities, as Home Assistant shows it."""

    _attr_should_poll = False
    linked_platform = ""

    def __init__(self, linked: Any, desc: dict[str, Any]) -> None:
        self._linked, self._desc = linked, desc
        self._attr_unique_id = desc["unique_id"]
        self._attr_has_entity_name = bool(desc.get("has_entity_name", True))
        if desc.get("translation_key"):
            self._attr_translation_key = desc["translation_key"]
            if desc.get("name") is not None:
                self._attr_name = desc["name"]
        else:
            self._attr_name = desc.get("name")
        self._attr_icon = desc.get("icon")
        dev = desc.get("device")
        if isinstance(dev, dict) and isinstance(dev.get("identifier"), str) and dev["identifier"]:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, dev["identifier"])}, name=device_name(dev.get("name")),
                manufacturer=MANUFACTURER, model=dev.get("model"), entry_type=DeviceEntryType.SERVICE)
        if suggested(desc.get("entity_id")):
            self.entity_id = suggested(desc["entity_id"])   # suggested; the registry keeps a known one

    @property
    def available(self) -> bool:
        return self._linked.connected and bool(self._desc.get("available", True))

    @property
    def _state(self) -> Any:
        return self._desc.get("state")

    @property
    def _features(self) -> dict[str, Any]:
        return self._desc.get("features") or {}

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {k: v for k, v in (self._desc.get("attributes") or {}).items() if k not in _RESERVED}

    @callback
    def apply(self, desc: dict[str, Any]) -> None:
        self._desc = desc
        if self.hass is not None and self.entity_id:
            self.async_write_ha_state()


class LinkedSwitch(LinkedEntity, SwitchEntity):
    """switch.<tablet>_black_screen, _photo_screensaver and the Seasonal decorations."""

    linked_platform = "switch"

    @property
    def is_on(self) -> bool:
        return self._state in ("on", True)

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._linked.command(self, "turn_on")

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._linked.command(self, "turn_off")

    async def async_set_black_screen(self, black: bool | None = None, brightness: int | None = None) -> None:
        """mantel.set_black_screen (or the alias hk_frontend.set_black_screen),
        forwarded as called (one call per target)."""
        data: dict[str, Any] = {}
        if black is not None:
            data["black"] = bool(black)
        if brightness is not None:
            data["brightness"] = int(brightness)
        await self._linked.forward("set_black_screen", data,
                                   [{"entity_id": self.entity_id, "unique_id": self.unique_id}])


TV_FEATURES = (MediaPlayerEntityFeature.TURN_ON | MediaPlayerEntityFeature.TURN_OFF
               | MediaPlayerEntityFeature.SELECT_SOURCE | MediaPlayerEntityFeature.PLAY | MediaPlayerEntityFeature.PAUSE
               | MediaPlayerEntityFeature.STOP | MediaPlayerEntityFeature.NEXT_TRACK
               | MediaPlayerEntityFeature.PREVIOUS_TRACK)


class LinkedTv(LinkedEntity, MediaPlayerEntity):
    """Live TV's TV a paired AirPlay screen, for Apple's Home app ("Den HomeView Live TV"; Mantel's
    cameras/live_tv_buttons.py): its inputs are the channels Mantel names (``features.sources``), its state and input
    what Mantel says plays there. Every command goes to Mantel, which plays or stops the screen's show; next and previous
    are channel up and down (the Remote's arrows, homekit_tvs.py). Volume up and down, while Mantel says the screen has a
    speaker (``features.volume``), are that speaker's: the HomeView's own volume, set by Mantel's music (the iPhone's
    buttons in the Remote). The state changes only when Mantel says so, never on the tap alone. HomeKit shows it as a TV
    in an entry of its own (homekit_tvs.py)."""

    linked_platform = "media_player"

    @property
    def supported_features(self) -> MediaPlayerEntityFeature:
        return TV_FEATURES | (MediaPlayerEntityFeature.VOLUME_STEP if self._features.get("volume") else 0)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        hk = getattr(self._linked, "homekit_tv", None)
        if hk is not None and self._features.get("live_tv_home"):
            hk.changed()                    # in the registry now: its HomeKit entry can be made

    @property
    def device_class(self) -> MediaPlayerDeviceClass | None:
        return MediaPlayerDeviceClass.TV if self._features.get("device_class") == "tv" else None

    @property
    def state(self) -> MediaPlayerState:
        return MediaPlayerState.PLAYING if self._state == "playing" else MediaPlayerState.OFF

    @property
    def source_list(self) -> list[str]:
        return [s for s in self._features.get("sources") or [] if isinstance(s, str)]

    @property
    def source(self) -> str | None:
        got = (self._desc.get("attributes") or {}).get("source")
        return got if isinstance(got, str) else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {k: v for k, v in super().extra_state_attributes.items() if k != "source"}

    async def _send(self, command: str, **data: Any) -> None:
        await self._linked.command(self, command, data=data)

    async def async_turn_on(self) -> None:
        await self._send("turn_on")

    async def async_turn_off(self) -> None:
        await self._send("turn_off")

    async def async_toggle(self) -> None:
        await self._send("toggle")

    async def async_select_source(self, source: str) -> None:
        await self._send("select_source", source=source)

    async def async_media_play(self) -> None:
        await self._send("media_play")

    async def async_media_pause(self) -> None:
        await self._send("media_pause")

    async def async_media_play_pause(self) -> None:
        await self._send("media_play_pause")

    async def async_media_stop(self) -> None:
        await self._send("media_stop")

    async def async_media_next_track(self) -> None:
        await self._send("media_next_track")

    async def async_media_previous_track(self) -> None:
        await self._send("media_previous_track")

    async def async_volume_up(self) -> None:
        await self._send("volume_up")

    async def async_volume_down(self) -> None:
        await self._send("volume_down")


class LinkedSensor(LinkedEntity, SensorEntity):
    """sensor.<tablet>_sleep_screen, sensor.tv_viewers, Live TV's now-on."""

    linked_platform = "sensor"

    @property
    def device_class(self) -> SensorDeviceClass | None:
        """`features.device_class` (2026-11-12): `timestamp` for a HomePod's next alarm (Mantel's phase 28), whose state
        is an ISO time; anything else, none. (In `features`, which every linked side already carries as it is.)"""
        return SensorDeviceClass.TIMESTAMP if self._features.get("device_class") == "timestamp" else None

    @property
    def native_value(self) -> Any:
        if self.device_class is SensorDeviceClass.TIMESTAMP:
            return dt_util.parse_datetime(self._state) if isinstance(self._state, str) else None
        return self._state

    @property
    def native_unit_of_measurement(self) -> str | None:
        return self._desc.get("unit")


class LinkedBinarySensor(LinkedEntity, BinarySensorEntity):
    """binary_sensor.<tablet>_screen_in_use; the Apple TVs' motion sensor (phase 31)."""

    linked_platform = "binary_sensor"

    @property
    def device_class(self) -> BinarySensorDeviceClass | None:
        """`features.device_class` (phase 31): `motion` for the sensor HomeKit links to the Apple TVs' camera."""
        try:
            return BinarySensorDeviceClass(self._features.get("device_class"))
        except ValueError:
            return None

    @property
    def is_on(self) -> bool:
        return self._state in ("on", True)


class LinkedCamera(LinkedEntity, Camera):
    """Live TV's channels. A channel Mantel names in `features.tv` streams
    through Mantel Link's own transcode (tv.py, this machine) and its still
    is the programme's artwork (never a frame: that would take a tuner);
    otherwise the stream Mantel names, no still of its own. A camera with
    `features.still` (phase 31: the Apple TVs' camera) is a picture Mantel
    draws, asked for over the link and kept until its `still` attribute (a
    version) changes."""

    linked_platform = "camera"

    def __init__(self, linked: Any, desc: dict[str, Any]) -> None:
        Camera.__init__(self)
        LinkedEntity.__init__(self, linked, desc)
        self._art_url: str | None = None
        self._art: bytes | None = None
        self._picked: tuple[Any, ...] | None = None
        self._repicking: Any = None
        self._still_version: Any = None
        self._still_bytes: bytes | None = None

    @property
    def supported_features(self) -> CameraEntityFeature:
        return CameraEntityFeature.STREAM if self._tv() or self._source() else CameraEntityFeature(0)

    @callback
    def async_write_ha_state(self) -> None:
        # Home Assistant picks a camera's player (go2rtc's WebRTC, else HLS) when the camera is
        # added and when its STREAM support changes -- in tasks that can race, the stale one
        # finishing last. Live TV's channels were left with "no WebRTC" after the link to Mantel came
        # back, and HK's player failed: pick again, once it has settled, whenever the camera comes
        # back or its stream changes.
        super().async_write_ha_state()
        tv = self._tv()
        key = (self.available, tv and tv["source"], self._source())
        if key != self._picked:
            self._picked = key
            if self.available:
                self._repick()

    @callback
    def _repick(self) -> None:
        """The player picked again, two seconds on (after Home Assistant's own picks)."""
        if self._repicking is not None:
            self._repicking()

        @callback
        def again(_now: Any) -> None:
            self._repicking = None
            self.hass.async_create_task(self.async_refresh_providers())
        self._repicking = async_call_later(self.hass, 2, again)

    async def async_will_remove_from_hass(self) -> None:
        if self._repicking is not None:
            self._repicking()
            self._repicking = None
        await super().async_will_remove_from_hass()

    def _tv(self) -> dict[str, Any] | None:
        from .tv import channel_of
        return channel_of(self._features)

    def _source(self) -> str | None:
        src = self._features.get("stream_source")
        return src if isinstance(src, str) and src.split("://", 1)[0] in ("http", "https", "rtsp", "rtsps") else None

    async def stream_source(self) -> str | None:
        tv = self._tv()
        if tv is not None:
            from .tv import stream_url
            return stream_url(self.hass, tv["channel"])
        return self._source()

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        if self._features.get("still"):
            return await self._still()
        tv = self._tv()
        url = tv["image"] if tv else None
        if not url:
            return None
        if url != self._art_url:
            from homeassistant.helpers.aiohttp_client import async_get_clientsession
            try:
                async with async_get_clientsession(self.hass).get(url, timeout=10) as r:
                    if r.status != 200 or not (r.content_type or "").startswith("image/"):
                        return None
                    body = await r.content.read(4_000_000)
                self._art, self._art_url = body, url
            except Exception:  # noqa: BLE001 -- no artwork: no picture
                return None
        return self._art

    async def _still(self) -> bytes | None:
        """Mantel's picture: asked for again only when its version changed (HomeKit asks on every alert)."""
        want = (self._desc.get("attributes") or {}).get("still")
        if self._still_bytes is None or want != self._still_version:
            got = await self._linked.camera_image(self.unique_id)
            if got is None:
                return None                       # no picture rather than the last alert's under this one
            self._still_version, self._still_bytes = got
        return self._still_bytes



class LinkedAlarmPanel(LinkedEntity, AlarmControlPanelEntity):
    """Alarm PIN's panel: Mantel checks the PIN and arms or disarms."""

    linked_platform = "alarm_control_panel"

    @property
    def alarm_state(self) -> AlarmControlPanelState | None:
        try:
            return AlarmControlPanelState(self._state) if self._state else None
        except ValueError:
            return None

    @property
    def supported_features(self) -> AlarmControlPanelEntityFeature:
        try:
            return AlarmControlPanelEntityFeature(int(self._features.get("supported_features") or 0))
        except (TypeError, ValueError):
            return AlarmControlPanelEntityFeature(0)

    @property
    def code_format(self) -> CodeFormat | None:
        try:
            return CodeFormat(self._features["code_format"]) if self._features.get("code_format") else None
        except ValueError:
            return CodeFormat.TEXT

    @property
    def code_arm_required(self) -> bool:
        return bool(self._features.get("code_arm_required", True))

    @property
    def changed_by(self) -> str | None:
        v = (self._desc.get("attributes") or {}).get("changed_by")
        return v if isinstance(v, str) else None

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_disarm", code)

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_home", code)

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_away", code)

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_night", code)

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_vacation", code)

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_custom_bypass", code)

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_trigger", code)


CLASSES: dict[str, type[LinkedEntity]] = {
    "switch": LinkedSwitch, "sensor": LinkedSensor, "binary_sensor": LinkedBinarySensor,
    "camera": LinkedCamera, "alarm_control_panel": LinkedAlarmPanel, "media_player": LinkedTv,
}
