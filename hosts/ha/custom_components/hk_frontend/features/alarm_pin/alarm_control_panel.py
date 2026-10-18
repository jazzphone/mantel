"""The PIN panel: mirrors the protected alarm, and arms or disarms it only
with the right PIN."""
from __future__ import annotations

from typing import Any

from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity, AlarmControlPanelEntityFeature, AlarmControlPanelState, CodeFormat,
)
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from ...const import DOMAIN
from .. import Feature
from .const import CONF_ALARM, CONF_ARM_REQUIRED
from .pin import check_pin


async def async_setup_entry(hass: HomeAssistant, entry: Feature,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    async_add_entities([AlarmPin(entry)])


class AlarmPin(AlarmControlPanelEntity):
    _attr_has_entity_name = True
    _attr_name = None                    # the device's name: "<alarm> PIN", its item's title
    _attr_should_poll = False

    def __init__(self, entry: Feature) -> None:
        self._entry = entry
        self._target: str = entry.data[CONF_ALARM]
        self._pin = {k: entry.options.get(k) for k in ("salt", "hash", "iterations")}
        # the item's id: the feature's own, from its first version
        self._attr_unique_id = entry.entry_id
        self._attr_code_format = (CodeFormat.NUMBER if entry.options.get("numeric")
                                  else CodeFormat.TEXT)
        self._attr_code_arm_required = bool(entry.options.get(CONF_ARM_REQUIRED, True))
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)}, name=entry.title,
            entry_type=DeviceEntryType.SERVICE)

    async def async_added_to_hass(self) -> None:
        @callback
        def _changed(_event: Event[EventStateChangedData]) -> None:
            self.async_write_ha_state()

        self.async_on_remove(async_track_state_change_event(self.hass, [self._target], _changed))

    # ---- mirrored
    def _st(self):
        return self.hass.states.get(self._target)

    @property
    def available(self) -> bool:
        st = self._st()
        return st is not None and st.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)

    @property
    def alarm_state(self) -> AlarmControlPanelState | None:
        st = self._st()
        try:
            return AlarmControlPanelState(st.state) if st else None
        except ValueError:
            return None

    @property
    def supported_features(self) -> AlarmControlPanelEntityFeature:
        st = self._st()
        return AlarmControlPanelEntityFeature(
            int((st.attributes.get("supported_features") if st else 0) or 0))

    @property
    def changed_by(self) -> str | None:
        st = self._st()
        return st.attributes.get("changed_by") if st else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"protects": self._target}

    # ---- gated
    async def _forward(self, service: str, code: str | None, arming: bool) -> None:
        """Check the PIN, then call the protected alarm -- or refuse, with Home
        Assistant's own error, so every keypad can say so.

        Disarming always needs the PIN. Arming (and trigger) needs it only
        while "Require the PIN to arm" is on; with it off, no PIN arms, and a
        PIN that IS given must still be the right one."""
        needed = not arming or self._attr_code_arm_required or bool(code)
        if needed and not await self.hass.async_add_executor_job(check_pin, code, self._pin):
            raise ServiceValidationError(translation_domain=DOMAIN,
                                         translation_key="alarm_pin_invalid_code")
        st = self._st()
        if st is None or st.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="alarm_pin_unavailable",
                                     translation_placeholders={"entity": self._target})
        data: dict[str, Any] = {"entity_id": self._target}
        # The PIN goes on only to an alarm that asks for a code of its own.
        if st.attributes.get("code_format") and code:
            data["code"] = code
        await self.hass.services.async_call("alarm_control_panel", service, data,
                                            blocking=True, context=self._context)

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        await self._forward("alarm_disarm", code, arming=False)

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        await self._forward("alarm_arm_home", code, arming=True)

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        await self._forward("alarm_arm_away", code, arming=True)

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        await self._forward("alarm_arm_night", code, arming=True)

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        await self._forward("alarm_arm_vacation", code, arming=True)

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        await self._forward("alarm_arm_custom_bypass", code, arming=True)

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        await self._forward("alarm_trigger", code, arming=True)
