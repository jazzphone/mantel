"""SCRATCH HA ONLY (tools/testha, `testha.py up --phone-probe`): a stand-in for a phone with the Home Assistant
Companion app. It registers `notify.mobile_app_e2e_phone`, as the mobile_app integration does for a real phone,
and records each notification it gets as an event (`mantel_e2e_phone_notified`, the call's data) instead of
sending it anywhere. Mantel Link's phone relay (docs/phase9/MANTEL-LINK.md 9.7) is checked against it."""
from __future__ import annotations

from homeassistant.core import HomeAssistant, ServiceCall

DOMAIN = "mantel_e2e_phone"
SERVICE = "mobile_app_e2e_phone"


async def async_setup(hass: HomeAssistant, config) -> bool:
    async def notify(call: ServiceCall) -> None:
        hass.bus.async_fire("mantel_e2e_phone_notified", dict(call.data))
    hass.services.async_register("notify", SERVICE, notify)
    return True
