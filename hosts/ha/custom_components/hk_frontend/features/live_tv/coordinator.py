"""The guide, refreshed every GUIDE_REFRESH_MIN minutes, and the lineup."""
from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import GUIDE_REFRESH_MIN
from .guide import parse_xmltv

_LOGGER = logging.getLogger(__name__)
MAX_GUIDE = 60_000_000


async def async_lineup(hass: HomeAssistant, host: str) -> list[dict]:
    """The HDHomeRun's channels: [{"number", "name", "hd"}]."""
    async with async_get_clientsession(hass).get(
            f"http://{host}/lineup.json", timeout=10) as r:
        r.raise_for_status()
        data = await r.json(content_type=None)
    return [{"number": c.get("GuideNumber"), "name": c.get("GuideName") or "",
             "hd": bool(c.get("HD"))} for c in data if c.get("GuideNumber")]


async def async_fetch_guide(hass: HomeAssistant, url: str, timeout: int = 60) -> bytes:
    """The whole file. Setup asks with a short timeout, so an unreachable guide
    is reported while the form is still open rather than after a minute."""
    async with async_get_clientsession(hass).get(url, timeout=timeout) as r:
        r.raise_for_status()
        data = bytearray()
        async for chunk in r.content.iter_chunked(262144):
            data += chunk
            if len(data) > MAX_GUIDE:
                raise UpdateFailed("guide file too large")
    return bytes(data)


class GuideCoordinator(DataUpdateCoordinator):
    """data = {number: {"logo", "network", "programmes": [...]}}"""

    def __init__(self, hass: HomeAssistant, url: str | None, numbers: set[str],
                 entry: None = None) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name="Live TV guide",
                         update_interval=timedelta(minutes=GUIDE_REFRESH_MIN))
        self.url = url
        self.numbers = numbers

    async def _async_update_data(self) -> dict:
        if not self.url:
            return {}
        try:
            raw = await async_fetch_guide(self.hass, self.url)
        except UpdateFailed:
            raise
        except Exception as err:  # noqa: BLE001
            raise UpdateFailed(f"guide: {err}") from err
        return await self.hass.async_add_executor_job(parse_xmltv, raw, set(self.numbers))
