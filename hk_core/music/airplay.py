"""Music AirPlayed from another device to several HomePods: one session is one thing playing, and its cover is looked up.

2026-11-20, the owner: "I started some music on my HomeView and paired all the speakers in the house. Mantel's live
music is showing what is playing but it isn't showing all the speakers like in a group ... It also isn't showing album
art."

An iPhone, a Mac or a HomeView AirPlaying to the HomePods is no Music Assistant group: Music Assistant sees each HomePod
as a player of its own, playing an outside stream (its source ``com.apple.tvairplayd``), with no members.

* ONE SESSION IS ONE THING PLAYING (``session_of``). Music Assistant names that stream
  ``apple-device://<player>/<session>::STREAM``, and every HomePod in one AirPlay session has the same ``<session>``
  (the HomeView's eight rooms, 2026-11-20). The pages fold the rooms of one session into one group (hkMusic.contexts
  in hk-base-music.js, and the app's contexts), and Play / Pause goes to every room of it (``session_players``): an
  explicit pause to each, or play to each, never a toggle each (one already paused would start). Their rooms can't be
  changed from Mantel: the device sending decides them.
* ITS COVER (``StreamCovers``). Music Assistant asks each HomePod for the artwork, and a HomePod AirPlayed to by a
  HomeView has none ("Artwork not present in response", MA's log), so Music Assistant's picture of it is an address
  that answers 404. The song is looked up in Music Assistant's search instead (Apple Music, ~0.3 s), once per song:
  the same title by the same artist, on the same album when one is found (``pick``), else that song on another of its
  albums. A song not found has no cover, as before.
"""
from __future__ import annotations

import re
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping
from typing import Any

from ..house import House

SESSION = re.compile(r"^apple-device://[^/]+/(.+?)(?:::STREAM)?$")
FOUND_TTL = 24 * 3600         # seconds a found cover is kept
MISSING_TTL = 3600            # ...a song with none found is asked about again after this
RETRY = 120                   # ...a search that failed (Music Assistant away)
KEEP = 400                    # songs remembered at most (the oldest go first)
SEARCH_LIMIT = 10
LIVE = ("playing", "paused")


def session_of(content_id: Any) -> str | None:
    """The AirPlay session a speaker's stream belongs to (``media_content_id``), or None for anything else."""
    m = SESSION.match(content_id) if isinstance(content_id, str) else None
    return m.group(1) if m else None


def session_players(house: House, rooms: Iterable[str], player: str) -> list[str]:
    """``player`` and the rooms playing (or paused in) the same AirPlay session as it, ``player`` first; just
    ``[player]`` when it plays no AirPlay stream."""
    st = house.state(player)
    sid = session_of(st.attributes.get("media_content_id")) if st else None
    if sid is None:
        return [player]
    out = [player]
    for r in rooms:
        o = house.state(r)
        if r not in out and o is not None and o.state in LIVE and session_of(o.attributes.get("media_content_id")) == sid:
            out.append(r)
    return out


def play_pause(house: House, rooms: Iterable[str], player: str) -> tuple[str, str | list[str]]:
    """The now-playing Play / Pause as one ``media_player`` call (service, entity_id): ``media_play_pause`` on the
    player, or for an AirPlay session, pause while ``player`` plays, else play, on every room of it."""
    players = session_players(house, rooms, player)
    if len(players) == 1:
        return "media_play_pause", player
    st = house.state(player)
    return ("media_pause" if st is not None and st.state == "playing" else "media_play"), players


# -- the cover --------------------------------------------------------------------------------------------------------
def _norm(s: Any) -> str:
    return " ".join(str(s or "").casefold().replace("’", "'").split())


def _bare(s: Any) -> str:
    """A title without its trailing "(...)" / "[...]" / " - ..." (Remastered, feat., Live): the second pass."""
    t = _norm(s)
    t = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]\s*$", "", t)
    return re.sub(r"\s+-\s+.*$", "", t).strip()


def _image(item: Any) -> str | None:
    """An item's picture address on the internet (its metadata's first thumb, else its own image)."""
    if not isinstance(item, Mapping):
        return None
    meta = item.get("metadata") if isinstance(item.get("metadata"), Mapping) else {}
    for img in list(meta.get("images") or []) + [item.get("image")]:
        path = img.get("path") if isinstance(img, Mapping) else img
        kind = img.get("type", "thumb") if isinstance(img, Mapping) else "thumb"
        if kind == "thumb" and isinstance(path, str) and path.startswith(("https://", "http://")):
            return path
    return None


def _by(track: Mapping[str, Any], artist: str) -> bool:
    names = [_norm(a.get("name")) for a in track.get("artists") or [] if isinstance(a, Mapping)]
    names = [n for n in names if n]
    want = _norm(artist)
    return bool(names and want) and (want in names or names[0] in want)


def pick(tracks: Any, title: str, artist: str, album: str | None) -> str | None:
    """The cover of the song among search results: the same title (exactly, else without its "(...)"), by the same
    artist, on the same album first; None when no result is that song."""
    rows = [t for t in tracks if isinstance(t, Mapping)] if isinstance(tracks, list) else []
    for same in (lambda t: _norm(t.get("name")) == _norm(title), lambda t: _bare(t.get("name")) == _bare(title)):
        songs = [t for t in rows if same(t) and _by(t, artist)]
        alb = _norm(album)
        on_album = [t for t in songs if alb and _norm((t.get("album") or {}).get("name")) == alb]
        for t in on_album + songs:
            got = _image(t) or _image(t.get("album"))
            if got:
                return got
    return None


Key = tuple[str, str, str]


class StreamCovers:
    """Covers for AirPlayed songs, by (title, artist, album). ``cover`` answers from what is kept and reads nothing;
    ``due`` says a song should be looked up; ``look`` -- the host runs it in the background -- searches once and says
    whether it learned a cover, so the host builds the speakers' states again. ``search`` is the host's: a query ->
    Music Assistant's ``music/search`` answer for tracks."""

    def __init__(self, search: Callable[[str], Awaitable[Any]], clock: Callable[[], float] = time.monotonic) -> None:
        self._search, self._clock = search, clock
        self._kept: dict[Key, tuple[str | None, float]] = {}
        self._asking: set[Key] = set()

    @staticmethod
    def key(title: Any, artist: Any, album: Any) -> Key | None:
        t, a = _norm(title), _norm(artist)
        return (t, a, _norm(album)) if t and a else None

    def cover(self, title: Any, artist: Any, album: Any) -> str | None:
        k = self.key(title, artist, album)
        got = self._kept.get(k) if k else None
        return got[0] if got else None

    def due(self, title: Any, artist: Any, album: Any) -> bool:
        k = self.key(title, artist, album)
        if k is None or k in self._asking:
            return False
        got = self._kept.get(k)
        return got is None or self._clock() >= got[1]

    async def look(self, title: str, artist: str, album: str | None) -> bool:
        k = self.key(title, artist, album)
        if k is None or k in self._asking:
            return False
        self._asking.add(k)
        try:
            try:
                answer = await self._search(f"{title} {artist}")
            except Exception:  # noqa: BLE001 -- Music Assistant away: asked again after RETRY
                self._keep(k, None, RETRY)
                return False
            tracks = answer.get("tracks") if isinstance(answer, Mapping) else None
            url = pick(tracks, title, artist, album)
            had = self._kept.get(k, (None, 0))[0]
            self._keep(k, url, FOUND_TTL if url else MISSING_TTL)
            return url is not None and url != had
        finally:
            self._asking.discard(k)

    def _keep(self, k: Key, url: str | None, ttl: float) -> None:
        self._kept.pop(k, None)
        self._kept[k] = (url, self._clock() + ttl)
        while len(self._kept) > KEEP:
            self._kept.pop(next(iter(self._kept)))
