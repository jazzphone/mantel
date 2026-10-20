"""SCRATCH HA ONLY (tools/testha, `testha.py up --zeroconf-probe`): Home Assistant's own zeroconf discovery, cut
down to one service type on loopback. It browses `_mantel._tcp.local.` on 127.0.0.1 only and hands each
announcement to Mantel Link's zeroconf step, exactly as HA's zeroconf integration would. The scratch HA does not
load HA's zeroconf integration (it would browse the home network and find the house's devices); this lets the
real announcer (mantel_server/announce.py, kept on loopback too) reach a real Home Assistant without leaving the
machine."""
from __future__ import annotations

from ipaddress import ip_address
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers import discovery_flow
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

DOMAIN = "mantel_e2e_browse"
TYPE = "_mantel._tcp.local."
_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config) -> bool:
    from zeroconf import ServiceStateChange
    from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf

    azc = AsyncZeroconf(interfaces=["127.0.0.1"])

    async def found(name: str) -> None:
        info = AsyncServiceInfo(TYPE, name)
        if not await info.async_request(azc.zeroconf, 3000):
            return
        props = {k.decode(): (v.decode() if isinstance(v, bytes) else v) for k, v in info.properties.items()}
        addrs = [ip_address(a) for a in info.parsed_addresses()] or [ip_address("127.0.0.1")]
        _LOGGER.warning("mantel_e2e_browse: found %s %s", name, props.get("url"))
        discovery_flow.async_create_flow(hass, "mantel", {"source": "zeroconf"}, ZeroconfServiceInfo(
            ip_address=addrs[0], ip_addresses=addrs, port=info.port, hostname=info.server or "mantel.local.",
            type=TYPE, name=name, properties=props))

    def changed(zeroconf, service_type, name, state_change) -> None:
        if state_change is ServiceStateChange.Added:
            hass.loop.call_soon_threadsafe(lambda: hass.async_create_task(found(name)))

    browser = AsyncServiceBrowser(azc.zeroconf, [TYPE], handlers=[changed])

    async def stop(_event) -> None:
        await browser.async_cancel()
        await azc.async_close()
    hass.bus.async_listen_once("homeassistant_stop", stop)
    return True
