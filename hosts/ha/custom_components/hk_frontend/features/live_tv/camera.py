"""One camera per channel: the live picture (stream.py) and a still that is
the current programme's artwork, which the player shows while tuning."""
from __future__ import annotations

import logging

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import channels_of, slug
from .const import DATA
from .guide import now_next
from .stream import URL

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    coord = hass.data[DATA]["coordinator"]
    async_add_entities([ChannelCamera(coord, entry, c) for c in channels_of(entry)])


class ChannelCamera(CoordinatorEntity, Camera):
    _attr_supported_features = CameraEntityFeature.STREAM
    _attr_should_poll = False

    def __init__(self, coord, entry, channel: dict) -> None:
        CoordinatorEntity.__init__(self, coord)
        Camera.__init__(self)
        self._number = channel["number"]
        self._attr_name = f"TV {channel['name']}"
        self._attr_unique_id = f"{entry.entry_id}_{self._number}_camera"
        self.entity_id = f"camera.tv_{slug(channel['name'])}"
        self._art_url = None
        self._art = None

    async def stream_source(self) -> str:
        # this Home Assistant's own port and scheme (the stream view answers
        # only this machine): 8123 and http unless it is set up otherwise
        api = self.hass.config.api
        port = api.port if api else 8123
        scheme = "https" if api and api.use_ssl else "http"
        return f"{scheme}://127.0.0.1:{port}{URL}/{self._number}"

    @property
    def extra_state_attributes(self):
        return {"channel": self._number}

    async def async_camera_image(self, width=None, height=None):
        """The programme's artwork (or the channel logo). Never a frame:
        grabbing one would take a tuner for every thumbnail."""
        g = (self.coordinator.data or {}).get(self._number) or {}
        cur, _ = now_next(g.get("programmes", []))
        url = (cur or {}).get("image") or g.get("logo")
        if not url:
            return None
        if url != self._art_url:
            try:
                async with async_get_clientsession(self.hass).get(url, timeout=10) as r:
                    if r.status != 200:
                        return None
                    self._art, self._art_url = await r.read(), url
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("artwork %s: %s", url, err)
                return None
        return self._art
