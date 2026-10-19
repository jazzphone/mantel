"""MANTEL LINK'S ACTIONS: mantel.* and, while Home Assistant has no HK Frontend
running, the same actions under HK Frontend's names (hk_frontend.*), so a
house's automations and scripts keep working unchanged after HK Frontend is
removed (decision M2: permanent aliases; docs/phase9/MANTEL-LINK.md).

Every one is forwarded to Mantel as called (bridge.Bridge.forward), with the
same schema HK Frontend had; Mantel checks it all again and answers.

  set_black_screen   an entity action on Mantel's switches (switch.py; the
                     alias here finds the switches the call targets)
  show_popup         a pop-up on Mantel's screens (all, or `dashboards` /
  close_popup        `users` named)
  notify             a banner on Mantel's screens; answers {id, snap}

THE ALIASES. Registered only for a name HK Frontend does not have right now:
if HK Frontend (still installed) sets up later, its own registration replaces
the alias, and Mantel Link notices. HK Frontend's last release itself sends
`hk_frontend.set_black_screen` for Mantel Link's switches to
`mantel.set_black_screen`, so a sleep script never has a gap.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import SIGNAL_CONFIG_ENTRY_CHANGED, ConfigEntryChange
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, EVENT_SERVICE_REGISTERED, EVENT_SERVICE_REMOVED
from homeassistant.core import CoreState, Event, HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, service as ha_service
from homeassistant.util.json import load_json_object
from homeassistant.util.yaml import load_yaml_dict
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .bridge import bridge_of, hk_entries
from .const import DOMAIN, HK_DOMAIN, NAME
from .switch import BLACK_SCREEN_SCHEMA

_LOGGER = logging.getLogger(__name__)
DATA_ALIASES = f"{DOMAIN}_aliases"

# ---- the schemas, as HK Frontend's (hk_frontend/__init__.py, features/notifications)
POPUP_SCHEMA = vol.Schema({
    vol.Required("popup"): cv.string,
    vol.Optional("dashboards"): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional("users"): vol.All(cv.ensure_list, [cv.string]),
})
TITLE_MAX, MESSAGE_MAX, STAY_MAX = 40, 120, 3600          # hk_core/notifications/const.py
_ICON = re.compile(r"^(hk|mdi):[a-z0-9-]+$")
_PAGE = r"^[a-z0-9][a-z0-9_-]{0,63}$"
TAPS = ("sheet", "camera", "page", "none")
NOTIFY_SCHEMA = vol.Schema({
    vol.Required("title"): vol.All(cv.string, vol.Strip, vol.Length(min=1, max=TITLE_MAX)),
    vol.Optional("message", default=""): vol.All(cv.string, vol.Strip, vol.Length(max=MESSAGE_MAX)),
    vol.Optional("important", default=False): cv.boolean,
    vol.Optional("wake", default=False): cv.boolean,
    vol.Optional("stay"): vol.All(vol.Coerce(int), vol.Range(min=0, max=STAY_MAX)),
    vol.Optional("icon"): vol.All(cv.string, vol.Match(_ICON)),
    vol.Optional("entity"): cv.entity_id,
    vol.Optional("camera"): cv.entity_domain("camera"),
    vol.Optional("tap"): vol.In(TAPS),
    vol.Optional("page"): vol.All(cv.string, vol.Strip, vol.Lower, vol.Match(_PAGE)),
    vol.Optional("dashboards", default=list): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional("users", default=list): vol.All(cv.ensure_list, [cv.string]),
})


def _bridge(hass: HomeAssistant, name: str):
    bridge = bridge_of(hass)
    if bridge is None:
        raise ServiceValidationError(f"{name}: {NAME} isn't set up (Settings, Devices & Services)")
    return bridge


def _forwarder(hass: HomeAssistant, domain: str, service: str):
    name = f"{domain}.{service}"

    async def handle(call: ServiceCall) -> ServiceResponse:
        result = await _bridge(hass, name).forward(service, call.data, name=name)
        if call.return_response:
            return result if isinstance(result, dict) else {"result": result}
        return None
    return handle


def _black_screen_alias(hass: HomeAssistant):
    """hk_frontend.set_black_screen without HK Frontend: the switches the call
    targets that are Mantel Link's, each forwarded as mantel.set_black_screen is."""
    name = f"{HK_DOMAIN}.set_black_screen"

    async def handle(call: ServiceCall) -> None:
        bridge = _bridge(hass, name)
        wanted = await ha_service.async_extract_entity_ids(call)
        ents = [e for e in list(bridge.entities.values())
                if e.linked_platform == "switch" and e.entity_id in wanted]
        missing = sorted(wanted - {e.entity_id for e in ents})
        if missing:
            _LOGGER.warning("%s: %s is not one of %s's switches: %s", name, ", ".join(missing), NAME,
                            "skipped, as Home Assistant skips an entity action's unknown targets")
        data = {k: call.data[k] for k in ("black", "brightness") if k in call.data}
        await asyncio.gather(*(e.async_set_black_screen(**data) for e in ents))
    return handle


def _register(hass: HomeAssistant, domain: str, service: str) -> None:
    if service == "notify":
        hass.services.async_register(domain, service, _forwarder(hass, domain, service), NOTIFY_SCHEMA,
                                     supports_response=SupportsResponse.OPTIONAL)
    elif service in ("show_popup", "close_popup"):
        hass.services.async_register(domain, service, _forwarder(hass, domain, service), POPUP_SCHEMA)
    elif service == "set_black_screen" and domain == HK_DOMAIN:
        hass.services.async_register(domain, service, _black_screen_alias(hass),
                                     cv.make_entity_service_schema(BLACK_SCREEN_SCHEMA))


# the mantel.* domain actions (set_black_screen is the switch platform's)
OWN = ("show_popup", "close_popup", "notify")
# the hk_frontend.* names Mantel Link answers while HK Frontend does not
ALIASES = ("set_black_screen", "show_popup", "close_popup", "notify")


def _descriptions() -> dict[str, dict[str, Any]]:
    """The aliases' descriptions for Home Assistant's action editor: this
    integration's services.yaml fields with its English names (an alias's
    domain, hk_frontend, has no files of Mantel Link's to read them from)."""
    import os
    here = os.path.dirname(__file__)
    fields = load_yaml_dict(os.path.join(here, "services.yaml"))
    words = load_json_object(os.path.join(here, "translations", "en.json")).get("services", {})
    out: dict[str, dict[str, Any]] = {}
    for name, spec in fields.items():
        w = words.get(name, {}) if isinstance(words, dict) else {}
        f = {k: {**(v or {}), **(w.get("fields", {}).get(k, {}))} for k, v in (spec.get("fields") or {}).items()}
        out[name] = {"name": w.get("name", name), "description": w.get("description", ""), "fields": f,
                     **({"target": spec["target"]} if spec.get("target") else {})}
    return out


class Aliases:
    """HK Frontend's action names, answered by Mantel Link while HK Frontend
    does not answer them itself."""

    def __init__(self, hass: HomeAssistant, descriptions: dict[str, dict[str, Any]] | None = None) -> None:
        self.hass = hass
        self.ours: set[str] = set()
        self._registering = False
        self.descriptions = descriptions or {}

    def hk_running(self) -> bool:
        from homeassistant.config_entries import ConfigEntryState
        return any(e.state is ConfigEntryState.LOADED for e in hk_entries(self.hass))

    @callback
    def check(self, *_: Any) -> None:
        if self.hk_running():
            return
        for service in ALIASES:
            if service in self.ours or self.hass.services.has_service(HK_DOMAIN, service):
                continue
            self._registering = True
            try:
                _register(self.hass, HK_DOMAIN, service)
            finally:
                self._registering = False
            self.ours.add(service)
            if service in self.descriptions:
                ha_service.async_set_service_schema(self.hass, HK_DOMAIN, service, self.descriptions[service])
            _LOGGER.info("%s: %s.%s answered by %s (HK Frontend isn't running)", NAME, HK_DOMAIN, service, NAME)

    @callback
    def registered(self, event: Event) -> None:
        if event.data.get("domain") == HK_DOMAIN and not self._registering:
            # HK Frontend set up and registered its own: it answers that name now
            self.ours.discard(event.data.get("service"))

    @callback
    def removed(self, event: Event) -> None:
        if event.data.get("domain") == HK_DOMAIN:
            self.ours.discard(event.data.get("service"))
            self.hass.loop.call_soon(self.check)

    @callback
    def entry_changed(self, change: ConfigEntryChange, entry: Any) -> None:
        if entry.domain == HK_DOMAIN:
            self.hass.loop.call_soon(self.check)


async def async_setup_services(hass: HomeAssistant) -> None:
    """mantel.* now; the hk_frontend.* aliases once Home Assistant has started
    (HK Frontend, if there, has registered its own by then), and whenever HK
    Frontend comes or goes."""
    for service in OWN:
        _register(hass, DOMAIN, service)
    try:
        descriptions = await hass.async_add_executor_job(_descriptions)
    except Exception:  # noqa: BLE001 -- only the action editor's text
        _LOGGER.exception("%s: could not read the actions' descriptions", NAME)
        descriptions = {}
    aliases = hass.data[DATA_ALIASES] = Aliases(hass, descriptions)
    hass.bus.async_listen(EVENT_SERVICE_REGISTERED, aliases.registered)
    hass.bus.async_listen(EVENT_SERVICE_REMOVED, aliases.removed)
    async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, aliases.entry_changed)
    if hass.state is CoreState.running:
        aliases.check()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, aliases.check)
