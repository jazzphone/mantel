"""MANTEL LINK: Home Assistant's side of Mantel (domain `mantel`).

Mantel (the server: the HA App, Docker or the LXC) draws a house's screens;
Mantel Link is everything Home Assistant needs of it, and nothing of its own:

  * the link: one authenticated WebSocket to Mantel (mantel_link.py);
  * Mantel's entities in Home Assistant, under the entity ids HK Frontend gave
    them (bridge.py: the bridge, and its hand-over from HK Frontend);
  * the actions automations call, mantel.* and, as permanent aliases,
    hk_frontend.* (services.py);
  * Mantel's screens in HA's sidebar: HA's header and sidebar hidden as each
    screen says, and the way back (frontend.py);
  * the few things only code inside Home Assistant can do for Mantel, which HK
    Frontend did: the doorbell's talk-back (talk.py, talk_live.py), the
    Energy plan's helper sources (energy.py) and the Lights page's "Tonight"
    list (page_headers.py).

It replaces HK Frontend completely (decision 28, docs/phase9/MANTEL-LINK.md in
the Mantel repository). One entry: one Mantel.
"""
from __future__ import annotations

import logging

from homeassistant.config_entries import SIGNAL_CONFIG_ENTRY_CHANGED, ConfigEntry, ConfigEntryChange
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.typing import ConfigType

from .bridge import PLATFORMS, Bridge, give_back, setup_key
from .const import DOMAIN, HK_DOMAIN, NAME

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type MantelConfigEntry = ConfigEntry[Bridge]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    from .services import async_setup_services
    await async_setup_services(hass)
    # Mantel's screens in HA's sidebar: kiosk and the way back (frontend.py)
    from .frontend import async_setup_frontend
    try:
        await async_setup_frontend(hass)
    except Exception:  # noqa: BLE001 -- the link and the entities never depend on the script
        _LOGGER.exception("%s: the script for Mantel's screens in HA's sidebar could not be added", NAME)
    # the one read Mantel's Energy plan needs from inside HA (energy.py; HK Frontend's hk_energy/sources)
    from .energy import async_setup_energy
    async_setup_energy(hass)
    # the Lights page's "Tonight" list, worked out from the automations (page_headers.py; HK Frontend's)
    from .page_headers import async_setup_page_headers
    async_setup_page_headers(hass)
    # the doorbell's talk-back: a hold-to-talk clip played on a speaker (talk.py) and live talk to a UniFi
    # Protect doorbell (talk_live.py), as HK Frontend had them; Mantel's gateway asks here first
    from . import talk, talk_live
    talk_live.async_register(hass)
    if getattr(hass, "http", None) is not None:
        talk.async_register(hass)
        # Live TV's transcode (tv.py; HK Frontend's live_tv/stream.py): the channel cameras stream from it
        from . import tv
        tv.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MantelConfigEntry) -> bool:
    bridge = Bridge(hass, entry)
    entry.runtime_data = bridge
    set_up_for = setup_key(hass, entry)

    async def updated(_hass: HomeAssistant, _entry: ConfigEntry) -> None:
        # the address, the credential, the ownership or the bridge changed: start again
        if setup_key(hass, entry) != set_up_for:
            hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(entry.add_update_listener(updated))

    @callback
    def hk_changed(change: ConfigEntryChange, other: ConfigEntry) -> None:
        # HK Frontend added, removed or (un)linked: Mantel is told (it decides
        # whether the bridge can be handed over), and a Home Assistant that no
        # longer has HK Frontend has no one else to mirror Mantel's entities
        if other.domain != HK_DOMAIN:
            return
        hass.async_create_task(bridge.report(), f"{NAME}: report")
        if setup_key(hass, entry) != set_up_for:
            hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, hk_changed))

    # the Companion app's phones (phones.py): Mantel hears of new ones, and of a Dismiss tapped on one
    from homeassistant.const import EVENT_SERVICE_REGISTERED, EVENT_SERVICE_REMOVED
    from .phones import ACTION, EVENT

    @callback
    def phones_changed(event) -> None:
        if event.data.get("domain") == "notify" and str(event.data.get("service", "")).startswith("mobile_app_"):
            hass.async_create_task(bridge.report(), f"{NAME}: report")

    @callback
    def phone_action(event) -> None:
        action = event.data.get("action")
        if isinstance(action, str) and ACTION.match(action):
            hass.async_create_task(bridge.phone_action(action), f"{NAME}: phone action")

    for ev in (EVENT_SERVICE_REGISTERED, EVENT_SERVICE_REMOVED):
        entry.async_on_unload(hass.bus.async_listen(ev, phones_changed))
    entry.async_on_unload(hass.bus.async_listen(EVENT, phone_action))
    bridge.start()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _LOGGER.info("%s: linked to Mantel at %s (%s)", NAME, bridge.link.url, bridge.state)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MantelConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        await entry.runtime_data.stop()
    return ok


async def async_remove_entry(hass: HomeAssistant, entry: MantelConfigEntry) -> None:
    """Removing Mantel Link: the entities it took from HK Frontend go back to
    it (if Home Assistant still has it), before Home Assistant clears them."""
    give_back(hass, entry)
