"""KEEP PLAYLISTS READY: Music Assistant's playlist cache, kept warm -- one round's rules.

Music Assistant does not store a streaming playlist's songs in its library. It
asks the service (Apple Music) each time and caches the answer for 3 hours,
100 songs a page. Opening a playlist past that -- or starting one, which
fetches the same songs first -- waits on the service, and the service also
rate-limits Music Assistant's shared developer key, which MA rides out by
retrying after 1, 2, 4, 8, 16 s. Measured 2026-10-14: 7-45 s to open a
playlist cold, 0.05 s warm; a pill like Christian plays six playlists as one
queue, so a cold start is six of those.

So, while the house has it on, each round asks Music Assistant to fetch the
songs again for:

  * every playlist a pill plays (the Music page's Your Playlists), and
  * the WARM_RECENT playlists played most recently in the last week,

skipping Music Assistant's own (builtin) playlists, which are local and fast.
`force_refresh` is what makes it a refresh: without it a playlist with 30
minutes left on its cache answers from the cache and is cold 30 minutes later.

GENTLE ON PURPOSE -- every rule here is about not making a person's own tap
wait behind this one:

  * one playlist at a time, WARM_GAP apart;
  * nothing new while someone is using the Music page (a browse, a search, a
    play in the last WARM_QUIET -- `used()`), since their request would queue
    behind this one at Apple;
  * a playlist refused because the service refused Music Assistant's sign-in
    (MA's LoginFailed: Apple Music's user token expired, so none of that
    account's own playlists can be read) is not counted as ready, and the
    round's note says to sign in again. The round goes on: a catalog playlist
    saved to the library needs no account and still refreshes;
  * a round ends early when Apple is refusing: a page that took WARM_SLOW_PAGE
    or more was refused at least four times in a row. One to three refusals
    are routine (the first round, 2026-10-14, stopped on three at a quiet
    moment, so three is not the line). Music Assistant's own library sync is
    the usual cause of more, and it has no "syncing" signal to ask for, so the
    refusals are the signal. The rest waits WARM_RETRY.

A failure does no harm: Music Assistant keeps what it had, and a playlist this
did not reach opens the way it would have anyway.

It talks to Music Assistant's own client (`MusicServer`: its `send_command`), never to the
house. Which client, and when rounds run (the switch, the timer between rounds, the task a
round runs in), are the host's: HA's features/music/warm.py finds the client its
music_assistant integration holds; Mantel holds its own.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any, Protocol

from .const import (
    WARM_CACHE, WARM_EVERY, WARM_FRESH, WARM_GAP, WARM_PAGE, WARM_QUIET, WARM_RECENT, WARM_RECENT_DAYS,
    WARM_RETRY, WARM_SLOW_PAGE, WARM_TIMEOUT,
)

_LOGGER = logging.getLogger(__name__)

LIBRARY = "library://playlist/"
# music_assistant_models.errors.LoginFailed.error_code (HA's client raises LoginFailed; Mantel's, MaError with it)
LOGIN_FAILED = 6
SIGN_IN_NOTE = "Music Assistant’s sign-in to your music service was refused. Sign in to it again in Music Assistant."


class MusicServer(Protocol):
    """Music Assistant's client, as far as these rules ask it."""

    async def send_command(self, command: str, **kwargs: Any) -> Any:
        """Run one of the server's commands and answer what it answers."""


class Warmer:
    """One round's rules, and what the last round found. The host decides when rounds run and
    which client they ask (`server()`)."""

    def __init__(self, pills: Callable[[], list[str]]) -> None:
        # `pills`: the uris the Music page's playlist pills play, in pill order
        self.pills = pills
        self._last_use = -math.inf
        self._fresh: dict[str, float] = {}      # item id -> when it was refreshed
        # what the settings page shows under the switch (status())
        self.last: dict[str, Any] | None = None
        # Tests replace these; nothing else touches them.
        self.clock: Callable[[], float] = time.monotonic
        self.sleep: Callable[[float], Awaitable[None]] = asyncio.sleep

    def server(self) -> MusicServer | None:
        """Music Assistant's client, or None when it is not running (the host's to find)."""
        return None

    def used(self) -> None:
        """Someone is using the Music page (a browse, a search or a play)."""
        self._last_use = self.clock()

    def status(self) -> dict[str, Any] | None:
        return self.last

    async def _quiet(self) -> None:
        """Wait until nobody has used the Music page for WARM_QUIET."""
        while (left := self._last_use + WARM_QUIET - self.clock()) > 0:
            await self.sleep(left)

    async def round(self) -> float:
        """One pass over the playlists. Answers how long until the next.

        A round after one cut short (WARM_RETRY later) picks up where it
        stopped: a playlist refreshed within WARM_FRESH is left alone, so the
        ones already done are not asked for twice. A regular round, WARM_EVERY
        later, finds every one older than that and refreshes them all."""
        mass = self.server()
        if mass is None:
            self._done([], "Music Assistant isn’t running.")
            return WARM_RETRY
        ids = await self._wanted(mass)
        todo = [i for i in ids if self.clock() - self._fresh.get(i, -math.inf) >= WARM_FRESH]
        t0 = self.clock()
        signed_out = 0
        for n, item_id in enumerate(todo):
            if n:
                await self.sleep(WARM_GAP)
            await self._quiet()
            t = self.clock()
            try:
                async with asyncio.timeout(WARM_TIMEOUT):
                    songs = await mass.send_command(
                        "music/playlists/playlist_tracks", item_id=item_id,
                        provider_instance_id_or_domain="library", force_refresh=True)
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001 -- reported, the round goes on
                if getattr(err, "error_code", None) == LOGIN_FAILED:
                    signed_out += 1
                _LOGGER.debug("music: playlist %s not refreshed: %s", item_id, err)
                continue
            self._fresh[item_id] = self.clock()
            pages = max(1, math.ceil(len(songs or []) / WARM_PAGE))
            if (self.clock() - t) / pages >= WARM_SLOW_PAGE:
                self._done(ids, "Apple Music was busy; the rest follow shortly.")
                _LOGGER.debug("music: %d of %d playlists ready; Apple is refusing, "
                              "the rest in %ds", self.last["ready"], len(ids), WARM_RETRY)
                return WARM_RETRY
        self._done(ids, SIGN_IN_NOTE if signed_out else None)
        if signed_out:
            _LOGGER.warning("music: %d playlists could not be kept ready: Music Assistant's sign-in to the "
                            "music service was refused", signed_out)
        _LOGGER.debug("music: %d of %d playlists ready (%.0fs)",
                      self.last["ready"], len(ids), self.clock() - t0)
        return WARM_EVERY

    def _done(self, ids: list[str], note: str | None) -> None:
        """READY is what Music Assistant holds now: refreshed within its
        cache's WARM_CACHE, whichever round did it."""
        now = self.clock()
        ready = sum(1 for i in ids if now - self._fresh.get(i, -math.inf) < WARM_CACHE)
        self.last = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "ready": ready, "wanted": len(ids), "note": note}

    async def _wanted(self, mass: MusicServer) -> list[str]:
        """The library ids to refresh: the pills' playlists first, in pill
        order, then the recently played ones -- streaming playlists only."""
        ids = [uri[len(LIBRARY):] for uri in self.pills() if uri.startswith(LIBRARY)]
        try:
            recent = await mass.send_command(
                "music/recently_played_items", limit=WARM_RECENT, media_types=["playlist"],
                played_after_timestamp=int(time.time()) - WARM_RECENT_DAYS * 86400)
        except Exception as err:  # noqa: BLE001 -- the pills alone are still worth it
            _LOGGER.debug("music: recently played not read: %s", err)
            recent = []
        ids += [str(_get(r, "item_id")) for r in recent or []
                if _get(r, "provider") == "library" and _get(r, "item_id") is not None]
        # MUSIC ASSISTANT'S OWN PLAYLISTS ARE LEFT ALONE: they are local, and a
        # random one would be dealt again for nothing.
        try:
            lib = await mass.send_command("music/playlists/library_items", limit=1000)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("music: library not read: %s", err)
            lib = None
        if lib is not None:
            streaming = {str(_get(p, "item_id")) for p in lib
                         if any(_get(m, "provider_domain") != "builtin"
                                for m in _get(p, "provider_mappings") or [])}
            ids = [i for i in ids if i in streaming]
        return list(dict.fromkeys(ids))


def _get(obj: Any, key: str) -> Any:
    """A field of a Music Assistant answer, a dict or a model object."""
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)
