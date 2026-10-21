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
from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.components.sensor import SensorEntity
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, HK_DOMAIN

# attributes Home Assistant itself sets: never taken from Mantel's
_RESERVED = {"friendly_name", "icon", "entity_picture", "supported_features", "device_class",
             "unit_of_measurement", "assumed_state", "attribution", "restored", "state_class", "options",
             "access_token", "code_format", "code_arm_required", "frontend_stream_type", "entity_id"}
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
    """switch.<tablet>_black_screen, _photo_screensaver, the Seasonal decorations."""

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


class LinkedSensor(LinkedEntity, SensorEntity):
    """sensor.<tablet>_sleep_screen, sensor.tv_viewers, Live TV's now-on."""

    linked_platform = "sensor"

    @property
    def native_value(self) -> Any:
        return self._state

    @property
    def native_unit_of_measurement(self) -> str | None:
        return self._desc.get("unit")


class LinkedBinarySensor(LinkedEntity, BinarySensorEntity):
    """binary_sensor.<tablet>_screen_in_use."""

    linked_platform = "binary_sensor"

    @property
    def is_on(self) -> bool:
        return self._state in ("on", True)


class LinkedCamera(LinkedEntity, Camera):
    """Live TV's channels. A channel Mantel names in `features.tv` streams
    through Mantel Link's own transcode (tv.py, this machine) and its still
    is the programme's artwork (never a frame: that would take a tuner);
    otherwise the stream Mantel names, no still of its own."""

    linked_platform = "camera"

    def __init__(self, linked: Any, desc: dict[str, Any]) -> None:
        Camera.__init__(self)
        LinkedEntity.__init__(self, linked, desc)
        self._art_url: str | None = None
        self._art: bytes | None = None

    @property
    def supported_features(self) -> CameraEntityFeature:
        return CameraEntityFeature.STREAM if self._tv() or self._source() else CameraEntityFeature(0)

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
    "camera": LinkedCamera, "alarm_control_panel": LinkedAlarmPanel,
}
