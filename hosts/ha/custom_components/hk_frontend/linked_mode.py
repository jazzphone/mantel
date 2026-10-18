"""LINKED TO MANTEL SERVER (Configure -> Linked to Mantel Server): the house has
moved to Mantel Server, and this integration keeps what Home Assistant's
automations, scripts and history depend on -- the same hk_frontend.* actions
and the same entities, with the same unique ids, so the same entity ids.

OFF BY DEFAULT. Nothing here runs until the entry's data holds a link
(CONF_MANTEL_LINK: Mantel Server's address and a Service credential). Without
one, everything this integration does is exactly what it did before.

WHEN LINKED (the entry is reloaded the moment the link is set or changed):
  * the actions automations call -- set_black_screen, show_popup, close_popup
    -- keep their names and schemas, and are FORWARDED to Mantel Server over
    one authenticated WebSocket (mantel_link.py), answered by id. A Mantel
    Server that is not connected, or does not answer in 10 s, fails the action
    with a clear error; one that refuses says why.
  * the entities are MANTEL'S: it sends each one's platform, unique id,
    suggested entity id, name and device, and pushes every state change. The
    registry keeps the entity ids a house already has (it keys by unique id),
    and each entity stays on its device and its item. A command sent to one
    (a switch turned off, the alarm panel disarmed with its PIN) is forwarded
    the same way. While the link is down they are unavailable.
  * the black screen's `confirmed` handshake holds end to end: Mantel sends a
    call's state changes BEFORE its answer, so when set_black_screen returns
    the switch already reads on (not confirmed), and `confirmed` turns true
    when the tablet's page says it went black -- what the sleep scripts wait on.
  * nothing local runs that Mantel now does: the features (Music, Live TV, ...),
    the wall tablets' Sleep Screen engines and their entities, the HK Settings
    page. /hk/ is still served.

Mantel never asks Home Assistant to do anything over the link: nothing it
sends can call a service here (the listener below only changes the mirrored
entities).

THE CREDENTIAL is a Mantel Service account's (scope `linked`). Home Assistant
keeps config entry data in .storage/core.config_entries, in plain text on
disk, as it does every integration's tokens; anyone who can read that file
(or a backup of it) can open the link. It is never logged or put in
diagnostics, and it is revoked on Mantel Server's side in one step.
"""
from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any
from urllib.parse import urlsplit

from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity, AlarmControlPanelEntityFeature, AlarmControlPanelState, CodeFormat,
)
from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.components.sensor import SensorEntity
from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import CONF_MANTEL_LINK, DOMAIN
from .mantel_link import LinkError, MantelLink, Refused, ws_url

_LOGGER = logging.getLogger(__name__)

DATA = "linked"                        # hass.data[DOMAIN][DATA]: the running Linked
# what the link forwards (and nothing else): the three actions automations use
SERVICES = ("set_black_screen", "show_popup", "close_popup")
# Mantel's refusals that are the caller's to fix (the rest are Mantel's trouble)
_VALIDATION = {"invalid", "unknown_service", "unknown_target", "unknown_entity", "unknown_command",
               "not_a_black_screen", "invalid_code", "unknown_popup"}
# attributes Home Assistant itself sets: never taken from Mantel's
_RESERVED = {"friendly_name", "icon", "entity_picture", "supported_features", "device_class",
             "unit_of_measurement", "assumed_state", "attribution", "restored", "state_class", "options",
             "access_token", "code_format", "code_arm_required", "frontend_stream_type", "entity_id"}


# ------------------------------------------------------------ the setting
def link_of(entry: ConfigEntry | None) -> dict[str, str] | None:
    """The entry's link -- {"url", "token"} -- or None (not linked: the default)."""
    raw = entry.data.get(CONF_MANTEL_LINK) if entry is not None else None
    if not isinstance(raw, Mapping):
        return None
    url, token = raw.get("url"), raw.get("token")
    if not isinstance(url, str) or not url.strip() or not isinstance(token, str) or not token.strip():
        return None
    return {"url": url.strip(), "token": token.strip()}


def configured(entry: ConfigEntry | None) -> bool:
    return link_of(entry) is not None


def check_url(address: str) -> str | None:
    """An error key for Configure's form, or None. Plain http/ws only to this
    machine: anywhere else the credential would cross the network in clear
    (Mantel Server's LAN address is TLS, PLAN §7)."""
    try:
        url = ws_url(address)
    except ValueError:
        return "mantel_url_invalid"
    parts = urlsplit(url)
    if parts.scheme == "ws" and parts.hostname not in ("127.0.0.1", "localhost", "::1"):
        return "mantel_url_insecure"
    return None


def active(hass: HomeAssistant) -> "Linked | None":
    """The running link, while the house's entry is set up linked."""
    return hass.data.get(DOMAIN, {}).get(DATA)


def attach(hass: HomeAssistant, entry: ConfigEntry, platform: str, add: Any) -> bool:
    """A platform of the house's entry: in linked mode its entities are
    Mantel's (True: the caller adds nothing of its own)."""
    linked = active(hass)
    if linked is None or linked.entry is not entry:
        return False
    linked.attach(str(platform), add)
    return True


def diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    """For Download diagnostics: whether linked and where to -- never the credential."""
    link = link_of(entry)
    linked = active(hass)
    return {"linked": link is not None, "url": link["url"] if link else None,
            "connected": bool(linked and linked.link.connected),
            "entities": len(linked.entities) if linked else 0,
            "last_error": linked.link.last_error if linked else None}


# ------------------------------------------------------------ the running link
class Linked:
    """The link and the entities it mirrors. Also the link's listener."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, *, timeout: float | None = None) -> None:
        link = link_of(entry)
        assert link is not None
        self.hass, self.entry = hass, entry
        self.link = MantelLink(async_get_clientsession(hass), link["url"], link["token"], self,
                               **({"timeout": timeout} if timeout is not None else {}))
        self.descs: dict[str, dict[str, Any]] = {}          # unique id -> Mantel's descriptor
        self.entities: dict[str, LinkedEntity] = {}         # unique id -> the entity added
        self.adders: dict[str, Any] = {}                    # platform -> async_add_entities

    @property
    def connected(self) -> bool:
        return self.link.connected

    def start(self) -> None:
        self.entry.async_create_background_task(self.hass, self.link.run(), "hk_frontend: link to Mantel Server")

    async def stop(self) -> None:
        await self.link.close()

    @callback
    def attach(self, platform: str, add: Any) -> None:
        self.adders[platform] = add
        for uid, d in list(self.descs.items()):
            if d["platform"] == platform and uid not in self.entities:
                self._add(d)

    # ---- the listener (mantel_link.Listener): Mantel's entities, nothing else
    @callback
    def on_hello(self, entities: list[dict[str, Any]]) -> None:
        seen = {d["unique_id"] for d in (self._checked(e) for e in entities) if d and self._upsert(d)}
        for uid in [u for u in self.descs if u not in seen]:
            self._drop(uid, registry=False)          # gone from Mantel's list: off the state machine only

    @callback
    def on_entity(self, entity: dict[str, Any]) -> None:
        d = self._checked(entity)
        if d:
            self._upsert(d)

    @callback
    def on_state(self, unique_id: str, state: Any, attributes: dict[str, Any], available: bool) -> None:
        d = self.descs.get(unique_id)
        if d is None:
            return
        d.update(state=state, attributes=dict(attributes), available=bool(available))
        ent = self.entities.get(unique_id)
        if ent is not None:
            ent.apply(d)

    @callback
    def on_removed(self, unique_id: str) -> None:
        self._drop(unique_id, registry=True)         # Mantel removed it (a tablet removed): as before

    @callback
    def on_connected(self, connected: bool) -> None:
        for ent in self.entities.values():
            if ent.hass is not None:
                ent.async_write_ha_state()

    @staticmethod
    def _checked(d: Any) -> dict[str, Any] | None:
        if (not isinstance(d, dict) or not isinstance(d.get("unique_id"), str) or not d["unique_id"]
                or d.get("platform") not in CLASSES):
            _LOGGER.warning("hk_frontend: ignored a linked entity Mantel Server described badly")
            return None
        eid = d.get("entity_id")
        if eid is not None and (not isinstance(eid, str) or not eid.startswith(d["platform"] + ".")):
            d = {**d, "entity_id": None}
        return {**d, "attributes": dict(d.get("attributes") or {}), "features": dict(d.get("features") or {})}

    def _upsert(self, d: dict[str, Any]) -> bool:
        uid = d["unique_id"]
        old = self.entities.get(uid)
        if old is not None and old.linked_platform != d["platform"]:
            self._drop(uid, registry=True)
            old = None
        self.descs[uid] = d
        if old is not None:
            old.apply(d)
        elif d["platform"] in self.adders:
            self._add(d)
        return True

    def _add(self, d: dict[str, Any]) -> None:
        ent = CLASSES[d["platform"]](self, d)
        self.entities[d["unique_id"]] = ent
        # an entity the house already has stays in its item (a wall tablet's)
        reg = er.async_get(self.hass)
        eid = reg.async_get_entity_id(d["platform"], DOMAIN, d["unique_id"])
        sub = reg.async_get(eid).config_subentry_id if eid else None
        if sub is not None and sub not in self.entry.subentries:
            sub = None
        self.adders[d["platform"]]([ent], config_subentry_id=sub)

    def _drop(self, uid: str, *, registry: bool) -> None:
        self.descs.pop(uid, None)
        ent = self.entities.pop(uid, None)
        if ent is None or ent.hass is None:
            return
        eid = ent.entity_id
        # kept in the registry: unavailable, as a house's entity always was
        # while its integration did not provide it; removed: gone
        self.hass.async_create_task(ent.async_remove(force_remove=registry))
        if registry and eid:
            reg = er.async_get(self.hass)
            if reg.async_get(eid):
                reg.async_remove(eid)

    # ---- forwarding
    def _fail(self, what: str, err: LinkError) -> HomeAssistantError:
        if isinstance(err, Refused):
            msg = f"Mantel Server refused {what}: {err.message}"
            return ServiceValidationError(msg) if err.code in _VALIDATION else HomeAssistantError(msg)
        return HomeAssistantError(f"{what} was not done: {err.message} (HK Frontend is linked to Mantel "
                                  f"Server at {self.link.url})")

    async def forward(self, service: str, data: Mapping[str, Any],
                      targets: list[dict[str, str]] | None = None) -> Any:
        """One hk_frontend action, as called, to Mantel Server."""
        payload: dict[str, Any] = {"service": service, "data": dict(data)}
        if targets:
            payload["targets"] = targets
        try:
            return await self.link.request("call_service", payload)
        except LinkError as err:
            raise self._fail(f"hk_frontend.{service}", err) from None

    async def command(self, ent: "LinkedEntity", command: str, code: str | None = None) -> Any:
        """A command to one mirrored entity, to Mantel Server."""
        payload = {"unique_id": ent.unique_id, "command": command, "data": {"code": code} if code is not None else {}}
        try:
            return await self.link.request("entity_command", payload)
        except LinkError as err:
            raise self._fail(f"{command} on {ent.entity_id}", err) from None


# ------------------------------------------------------------ setup
async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, platforms: list[Any]) -> bool:
    """The house's entry, linked: the link, then the platforms (each attaches)."""
    linked = Linked(hass, entry)
    hass.data.setdefault(DOMAIN, {})[DATA] = linked
    link_now = link_of(entry)

    async def updated(_hass: HomeAssistant, _entry: ConfigEntry) -> None:
        # the link set, changed or removed (Configure): start again. Nothing
        # else is followed in linked mode -- the settings are Mantel's.
        if link_of(entry) != link_now:
            hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(entry.add_update_listener(updated))
    linked.start()
    await hass.config_entries.async_forward_entry_setups(entry, platforms)
    _LOGGER.info("hk_frontend: linked to Mantel Server at %s; its entities and actions are Mantel's", linked.link.url)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry, platforms: list[Any]) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, platforms)
    linked = hass.data.get(DOMAIN, {}).get(DATA)
    if ok and linked is not None and linked.entry is entry:
        hass.data[DOMAIN].pop(DATA, None)
        await linked.stop()
    return ok


# ------------------------------------------------------------ the entities
class LinkedEntity(Entity):
    """One of Mantel's entities, as Home Assistant shows it."""

    _attr_should_poll = False
    linked_platform = ""

    def __init__(self, linked: Linked, desc: dict[str, Any]) -> None:
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
                identifiers={(DOMAIN, dev["identifier"])}, name=dev.get("name"),
                manufacturer=dev.get("manufacturer"), model=dev.get("model"), entry_type=DeviceEntryType.SERVICE)
        if desc.get("entity_id"):
            self.entity_id = desc["entity_id"]      # suggested; the registry keeps a known one

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
        """hk_frontend.set_black_screen, forwarded as called (one call per target)."""
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
    """Live TV's channels: the stream Mantel names, no still of its own."""

    linked_platform = "camera"

    def __init__(self, linked: Linked, desc: dict[str, Any]) -> None:
        Camera.__init__(self)
        LinkedEntity.__init__(self, linked, desc)

    @property
    def supported_features(self) -> CameraEntityFeature:
        return CameraEntityFeature.STREAM if self._source() else CameraEntityFeature(0)

    def _source(self) -> str | None:
        src = self._features.get("stream_source")
        return src if isinstance(src, str) and src.split("://", 1)[0] in ("http", "https", "rtsp", "rtsps") else None

    async def stream_source(self) -> str | None:
        return self._source()

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        return None


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
