"""PLAYLIST COVERS (2026-11-01, the owner: "is it possible for the Playlist to pull the artwork of the playlists/albums
it's built with?").

A Mantel playlist holds several Music Assistant items (``Playlist.items``: library://playlist/1, an album's uri...).
Its cover is the first of them that has a picture: the item's own (a playlist's or an album's), else the album picture
of its first songs that have one. Music Assistant is asked once per item and the answer kept (``COVER_TTL``); an item
that could not be read is asked again after ``COVER_RETRY``. Nothing here blocks a screen's feed: ``images`` answers
from what is kept, and ``refresh`` -- run by the host in the background -- says whether it learned something, so the
host sends the feed again.

The host supplies the two things that are its own: ``read`` (a Music Assistant read, a function of the command and its
args) and ``image_of`` (an item as Music Assistant sends it -> the address a page can load, or None).
"""
from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping
from typing import Any

from .config import Playlist

_LOGGER = logging.getLogger(__name__)

COVER_TTL = 6 * 3600          # seconds a looked-up item's picture (or its lack of one) is trusted
COVER_RETRY = 10 * 60         # seconds before an item Music Assistant could not answer for is asked again
SONGS_LOOKED_AT = 12          # an item with no picture of its own: its first songs' album pictures
SONG_LISTS = {"playlist": "music/playlists/playlist_tracks", "album": "music/albums/album_tracks"}


class Covers:
    def __init__(self, read: Callable[..., Awaitable[Any]], image_of: Callable[[Any], str | None],
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._read, self._image_of, self._clock = read, image_of, clock
        self._kept: dict[str, tuple[str | None, float]] = {}      # item uri -> (its picture or None, when it expires)

    def images(self, playlists: Iterable[Playlist]) -> dict[str, str]:
        """playlist key -> its cover, from what is kept: the first item with a picture. Reads nothing."""
        out: dict[str, str] = {}
        for p in playlists:
            for uri in p.items:
                got = self._kept.get(uri)
                if got and got[0]:
                    out[p.key] = got[0]
                    break
        return out

    async def refresh(self, playlists: Iterable[Playlist]) -> bool:
        """Look up what the playlists' covers need and is not kept (or has expired): per playlist its items in order
        up to the first with a picture. True when a playlist's cover is not what ``images`` gave before."""
        playlists = list(playlists)
        before = self.images(playlists)
        wanted = {u for p in playlists for u in p.items}
        for uri in [u for u in self._kept if u not in wanted]:       # (a playlist that no longer holds it)
            del self._kept[uri]
        for p in playlists:
            for uri in p.items:
                got = self._kept.get(uri)
                if got is None or got[1] <= self._clock():
                    got = self._kept[uri] = await self._look(uri, got)
                if got[0]:
                    break
        return self.images(playlists) != before

    async def _look(self, uri: str, old: tuple[str | None, float] | None) -> tuple[str | None, float]:
        """An item's picture, asked of Music Assistant. An answer it could not give keeps the picture it had."""
        now = self._clock()
        try:
            item = await self._read("music/item_by_uri", uri=uri)
            if not isinstance(item, Mapping):
                raise ValueError("not an item")
            image = self._image_of(item)
            if image is None:
                image = await self._from_songs(uri, item)
        except Exception as err:  # noqa: BLE001 -- an item Music Assistant cannot answer for has no cover for now
            _LOGGER.debug("music: no cover for %s: %s", uri, type(err).__name__)
            return (old[0] if old else None), now + COVER_RETRY
        return image, now + COVER_TTL

    async def _from_songs(self, uri: str, item: Mapping[str, Any]) -> str | None:
        """The album picture (else the picture) of the first songs of a playlist or an album that have one."""
        kind = item.get("media_type") or uri.partition("://")[2].partition("/")[0]
        command = SONG_LISTS.get(str(getattr(kind, "value", kind)))
        item_id, provider = item.get("item_id"), item.get("provider")
        if command is None or item_id is None or not isinstance(provider, str):
            return None
        songs = await self._read(command, item_id=str(item_id), provider_instance_id_or_domain=provider)
        for song in list(songs or [])[:SONGS_LOOKED_AT]:
            if isinstance(song, Mapping):
                album = song.get("album")
                got = (self._image_of(album) if isinstance(album, Mapping) else None) or self._image_of(song)
                if got:
                    return got
        return None
