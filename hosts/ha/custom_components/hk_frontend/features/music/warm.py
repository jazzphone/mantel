"""KEEP PLAYLISTS READY inside Home Assistant: Music Assistant's playlist cache, kept warm.

What a round does and why it is gentle -- the pills' playlists and the recently
played ones, streaming only, one at a time, never while the Music page is in
use, cut short when Apple Music is refusing -- is shared (hk_core/music/warm.py's
Warmer, PLAN.md §0 plan review). What stays here is Home Assistant's side:

  * the switch (HK Settings -> Music -> Keep Playlists Ready; off unless chosen),
    followed on every change of Music's options;
  * HOME ASSISTANT'S TIMER between rounds, every WARM_EVERY (or WARM_RETRY after
    one cut short), and the background task a round runs in;
  * the client: Music Assistant's, from the one Home Assistant's
    music_assistant integration already holds (entry.runtime_data.mass), as the
    queue does -- not a public Home Assistant contract, so its absence is
    reported, never raised.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from ...hk_core.music.warm import LIBRARY, Warmer, _get  # noqa: F401 -- names callers import here
from .const import CONF_KEEP_READY, WARM_FIRST, WARM_RETRY

_LOGGER = logging.getLogger(__name__)


def mass_client(hass: HomeAssistant) -> Any:
    """Music Assistant's client from Home Assistant's integration, or None."""
    for e in hass.config_entries.async_entries("music_assistant"):
        mass = getattr(getattr(e, "runtime_data", None), "mass", None)
        if mass is not None:
            return mass
    return None


class PlaylistWarmer(Warmer):
    """Runs while Music runs; works only while Keep Playlists Ready is on."""

    def __init__(self, hass: HomeAssistant, entry: Any,
                 pills: Callable[[], list[str]]) -> None:
        # `pills`: the uris the Music page's playlist pills play, in pill order
        super().__init__(pills)
        self.hass, self.entry = hass, entry
        self._task: asyncio.Task[None] | None = None
        self._timer: Callable[[], None] | None = None

    def server(self) -> Any:
        return mass_client(self.hass)

    # ------------------------------------------------------------ control
    @property
    def on(self) -> bool:
        return bool(self.entry.options.get(CONF_KEEP_READY))

    def follow(self, first: float = WARM_FIRST) -> None:
        """Start or stop to match the switch. Called at start and on every
        change of Music's options; a change that leaves it on is no restart."""
        running = self._timer is not None or self._task is not None
        if self.on and not running:
            self._later(first)
        elif not self.on and running:
            self.stop()

    def stop(self) -> None:
        if self._timer is not None:
            self._timer()
            self._timer = None
        if self._task is not None:
            self._task.cancel()
            self._task = None

    # ------------------------------------------------------------ the loop
    # HOME ASSISTANT'S TIMER BETWEEN ROUNDS, not a task asleep for hours: a
    # task exists only while a round runs.
    def _later(self, delay: float) -> None:
        self._timer = async_call_later(self.hass, delay, self._fire)

    @callback
    def _fire(self, _now: Any) -> None:
        self._timer = None
        self._task = self.hass.async_create_background_task(
            self._go(), "hk_frontend music: keep playlists ready")

    async def _go(self) -> None:
        try:
            delay = await self.round()
        except Exception:  # noqa: BLE001 -- one bad round must not end them
            _LOGGER.exception("music: keeping playlists ready failed")
            delay = WARM_RETRY
        self._task = None
        if self.on:
            self._later(delay)
