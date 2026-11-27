"""Music AirPlayed from another device to several HomePods: one session is one thing playing, and its cover is looked up.

2026-11-20, the owner: "I started some music on my HomeView and paired all the speakers in the house. Mantel's live
music is showing what is playing but it isn't showing all the speakers like in a group ... It also isn't showing album
art."

An iPhone, a Mac or a HomeView AirPlaying to the HomePods is no Music Assistant group: Music Assistant sees each HomePod
as a player of its own, playing an outside stream (its source ``com.apple.tvairplayd``), with no members.

* ONE SESSION IS ONE THING PLAYING WHEN A SENDER PROVES IT (``session_of``, ``verified``). Music Assistant names that
  stream ``apple-device://<player>/<session>::STREAM``, and every HomePod a HomeView sends to has the same ``<session>``
  (the HomeView's eight rooms, 2026-11-20). The pages fold the rooms of one session into one group (hkMusic.contexts
  in hk-base-music.js, and the app's contexts), and Play / Pause goes to every room of it (``session_players``): an
  explicit pause to each, or play to each, never a toggle each (one already paused would start). Their rooms can't be
  changed from Mantel: the device sending decides them.
* THE SESSION IS THE SENDER'S, NEVER THE SONG'S, AND NEVER AN ID ALONE (2026-11-26, Codex's review, twice). What names
  rooms as one session is the id the sending device gave the stream, and only when ONE room of the house is that sender:
  a speaker playing its own app (``verified``: a HomeView's Music app) with that id, its receivers the rooms playing the
  same id. Not the title, the artist, the album, not pyatv's hash of them (``FALLBACK_HASH``), not the same item, and not
  an id on receivers alone: two iPhones appear in Mantel only as receivers, and two ids that match tell nothing of whether
  one device sent both. With no sender in the house, or two (two HomeViews playing one song: ``ambiguous``), no room is
  folded under the id and Play / Pause goes to the one player asked. The pages may still DRAW the same song in several
  rooms as one stream (hkMusic.streams), and the song still gives the source line ("AirPlay from ..."), the cover and
  the progress; none of them decides what a button sends to.
* MUSIC THAT ISN'T MUSIC ASSISTANT'S (``outside``, ``where_from``; 2026-11-25). A speaker playing its own app (a
  HomeView's Music app: ``app_id`` ``com.apple.sonic.music``, its own ``apple-device://`` session) or AirPlay from a
  device: Music Assistant can neither move it nor send it to other rooms (it streams only its own music), and joining
  rooms to it in Music Assistant gave silent rooms shown as playing. So no room is added to it or moved from it
  (``engine.check_transfer``; letting rooms go still works), rooms are added from the sending device's own AirPlay
  menu, and the players say where it comes from: "Music on Living Room HomeView", or "AirPlay from Living Room
  HomeView" on the rooms it sends to, or "AirPlay" from a device that is no speaker of the house (an iPhone).
  hk-base-music.js reads the same rules for the pages (``hkMusic.contexts``' ``outside`` and ``from``).
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
START_KNOWN_AFTER = 10.0      # seconds after the host read Music Assistant whole before a song seen is one that started
LIVE = ("playing", "paused")


FALLBACK_HASH = re.compile(r"^[0-9a-f]{64}$")


def stream_id(content_id: Any) -> str | None:
    """Any AirPlayed stream's id (``apple-device://<player>/<id>``), a fallback hash too: what its cover and its song
    clock are kept by. ``session_of`` is the stricter one, for which rooms are one thing playing."""
    m = SESSION.match(content_id) if isinstance(content_id, str) else None
    return m.group(1) if m else None


def session_of(content_id: Any) -> str | None:
    """The AirPlay session a speaker's stream belongs to (``media_content_id``), or None for anything else. Music
    Assistant names the stream by the sender's own id for what plays (``PguBhzzib``); with none it falls back to pyatv's
    hash of the song's title, artist, album and length -- the same for two plays of one song from two devices, so a
    64-hex hash is no session (2026-11-26, Codex's review): those rooms aren't one thing to command, though the pages
    still draw the same song in several rooms as one (hkMusic.streams)."""
    m = SESSION.match(content_id) if isinstance(content_id, str) else None
    if not m or FALLBACK_HASH.match(m.group(1)):
        return None
    return m.group(1)


def _own_app(attributes: Mapping[str, Any]) -> bool:
    """A speaker playing its own app (a HomeView's Music app), not receiving: the sender of its session."""
    app = attributes.get("app_id")
    return isinstance(app, str) and app not in ("", MA_APP, *RECEIVER_APPS)


def senders(house: House, rooms: Iterable[str], sid: str) -> list[str]:
    """The rooms that SEND session ``sid``: playing (or paused in) their own app with that id. A receiver sends nothing."""
    out = []
    for r in dict.fromkeys(rooms):
        o = house.state(r)
        if (o is not None and o.state in LIVE and session_of(o.attributes.get("media_content_id")) == sid
                and _own_app(o.attributes)):
            out.append(r)
    return out


def verified(house: House, rooms: Iterable[str], sid: str) -> bool:
    """Exactly one room of ``rooms`` sends session ``sid`` through its own app: the id is then one sender's, and the
    receivers playing it are that sender's session."""
    return len(senders(house, rooms, sid)) == 1


def ambiguous(house: House, rooms: Iterable[str], sid: str) -> bool:
    """The id is no proof of one sender: no room of ``rooms`` sends it (receivers only: two independent iPhones, say), or
    more than one does (two HomeViews playing one song). No receiver is folded under it."""
    return not verified(house, rooms, sid)


def session_players(house: House, rooms: Iterable[str], player: str) -> list[str]:
    """``player`` and the rooms playing (or paused in) the same AirPlay session as it, ``player`` first; just
    ``[player]`` when it plays no AirPlay stream, or when its session's id is no proof of one sender (``ambiguous``)."""
    st = house.state(player)
    sid = session_of(st.attributes.get("media_content_id")) if st else None
    if sid is None:
        return [player]
    rooms = list(rooms)
    if ambiguous(house, [player, *rooms], sid):
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
    return toggle(house, session_players(house, rooms, player), player)


def toggle(house: House, players: list[str], player: str) -> tuple[str, str | list[str]]:
    """``play_pause`` for ``players`` already decided (a host that checked who the person may control): the session's
    rooms, ``player`` among them. One player is the plain toggle."""
    if len(players) < 2:
        return "media_play_pause", player
    st = house.state(player)
    return ("media_pause" if st is not None and st.state == "playing" else "media_play"), list(players)


MA_APP = "music_assistant"                                   # Music Assistant's own stream
RECEIVER_APPS = ("com.apple.TVAirPlay", "com.apple.tvairplayd")   # a speaker's AirPlay receiver: it is sent to


def outside(attributes: Mapping[str, Any]) -> bool:
    """The player plays music that isn't Music Assistant's: an AirPlay session (``apple-device://``), or an app
    other than Music Assistant."""
    if session_of(attributes.get("media_content_id")) is not None:
        return True
    app = attributes.get("app_id")
    return isinstance(app, str) and app not in ("", MA_APP)


def _app_name(attributes: Mapping[str, Any]) -> str:
    """The app's name as the speaker gives it ("Music", "Safari"), else the last part of its id."""
    src = attributes.get("source")
    if isinstance(src, str) and src.strip():
        return src.strip()
    return str(attributes.get("app_id") or "").rsplit(".", 1)[-1] or "An app"


def origin(house: House, rooms: Iterable[str], player: str) -> tuple[str, str | None] | None:
    """Where ``player``'s music comes from, or None when it is Music Assistant's: (app name, ``player``) when it plays
    its own app; ("AirPlay", the speaker) when a speaker of the same AirPlay session plays its own app (it sends);
    ("AirPlay", None) when the sender is no speaker of the house (an iPhone, a Mac)."""
    st = house.state(player)
    if st is None or st.state not in LIVE or not outside(st.attributes):
        return None
    app = st.attributes.get("app_id")
    if app and app not in RECEIVER_APPS and app != MA_APP:
        return _app_name(st.attributes), player
    sid = session_of(st.attributes.get("media_content_id"))
    if sid is not None:
        for r in rooms:
            o = house.state(r)
            if (r != player and o is not None and o.state in LIVE
                    and o.attributes.get("app_id") not in (*RECEIVER_APPS, MA_APP, None, "")
                    and session_of(o.attributes.get("media_content_id")) == sid):
                return "AirPlay", r
    return "AirPlay", None


def speaker_name(house: House, entity: str, name_of: Callable[[str], str]) -> str:
    """A sending speaker by its own name ("Living Room HomeView"), not its room's: a room can have two speakers
    (2026-11-26, the owner: "It's living room homeview not homepod")."""
    st = house.state(entity)
    name = st.attributes.get("friendly_name") if st is not None else None
    return name.strip() if isinstance(name, str) and name.strip() else name_of(entity)


def where_from(house: House, rooms: Iterable[str], player: str, name_of: Callable[[str], str]) -> str | None:
    """``origin`` as the players' line: "Music on Living Room HomeView", "AirPlay from Living Room HomeView",
    "AirPlay"; None for Music Assistant's own music."""
    got = origin(house, rooms, player)
    if got is None:
        return None
    app, sender = got
    if sender is None:
        return app
    who = speaker_name(house, sender, name_of)
    return f"{app} from {who}" if sender != player else f"{app} on {who}"


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
    m = item.get("metadata")
    meta = m if isinstance(m, Mapping) else {}
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


def match(tracks: Any, title: str, artist: str, album: str | None) -> tuple[str | None, float | None]:
    """The song among search results: (its cover, its length in seconds) -- the same title (exactly, else without its
    "(...)"), by the same artist, on the same album first, the first such with a picture; (None, None) when no result
    is that song."""
    rows = [t for t in tracks if isinstance(t, Mapping)] if isinstance(tracks, list) else []
    for same in (lambda t: _norm(t.get("name")) == _norm(title), lambda t: _bare(t.get("name")) == _bare(title)):
        songs = [t for t in rows if same(t) and _by(t, artist)]
        alb = _norm(album)
        on_album = [t for t in songs if alb and _norm((t.get("album") or {}).get("name")) == alb]
        for t in on_album + songs:
            got = _image(t) or _image(t.get("album"))
            if got:
                d = t.get("duration")
                return got, float(d) if isinstance(d, (int, float)) and not isinstance(d, bool) and d > 0 else None
    return None, None


def pick(tracks: Any, title: str, artist: str, album: str | None) -> str | None:
    """``match``'s cover."""
    return match(tracks, title, artist, album)[0]


Key = tuple[str, str, str]


class StreamCovers:
    """Covers for AirPlayed songs, by (title, artist, album). ``cover`` answers from what is kept and reads nothing;
    ``due`` says a song should be looked up; ``look`` -- the host runs it in the background -- searches once and says
    whether it learned a cover, so the host builds the speakers' states again. ``search`` is the host's: a query ->
    Music Assistant's ``music/search`` answer for tracks."""

    def __init__(self, search: Callable[[str], Awaitable[Any]], clock: Callable[[], float] = time.monotonic) -> None:
        self._search, self._clock = search, clock
        self._kept: dict[Key, tuple[str | None, float | None, float]] = {}     # key -> (cover, length, expires)
        self._asking: set[Key] = set()

    @staticmethod
    def key(title: Any, artist: Any, album: Any) -> Key | None:
        t, a = _norm(title), _norm(artist)
        return (t, a, _norm(album)) if t and a else None

    def cover(self, title: Any, artist: Any, album: Any) -> str | None:
        k = self.key(title, artist, album)
        got = self._kept.get(k) if k else None
        return got[0] if got else None

    def length(self, title: Any, artist: Any, album: Any) -> float | None:
        """The found song's length in seconds (the progress bar's: the device sending gives none)."""
        k = self.key(title, artist, album)
        got = self._kept.get(k) if k else None
        return got[1] if got else None

    def due(self, title: Any, artist: Any, album: Any) -> bool:
        k = self.key(title, artist, album)
        if k is None or k in self._asking:
            return False
        got = self._kept.get(k)
        return got is None or self._clock() >= got[2]

    async def look(self, title: str, artist: str, album: str | None) -> bool:
        k = self.key(title, artist, album)
        if k is None or k in self._asking:
            return False
        self._asking.add(k)
        try:
            try:
                answer = await self._search(f"{title} {artist}")
            except Exception:  # noqa: BLE001 -- Music Assistant away: asked again after RETRY
                self._keep(k, None, None, RETRY)
                return False
            tracks = answer.get("tracks") if isinstance(answer, Mapping) else None
            url, length = match(tracks, title, artist, album)
            had = self._kept.get(k, (None, None, 0))[0]
            self._keep(k, url, length, FOUND_TTL if url else MISSING_TTL)
            return url is not None and url != had
        finally:
            self._asking.discard(k)

    def _keep(self, k: Key, url: str | None, length: float | None, ttl: float) -> None:
        self._kept.pop(k, None)
        self._kept[k] = (url, length, self._clock() + ttl)
        while len(self._kept) > KEEP:
            self._kept.pop(next(iter(self._kept)))


# -- where the song is ------------------------------------------------------------------------------------------------
class SongClock:
    """Where an AirPlayed song is, for the progress bar (2026-11-20, the owner: "the song progress bar isn't showing
    always"): the HomeView sends the HomePods the song but no length and no position -- the HomePods report position 0,
    "seeking" -- so Music Assistant has none to give. Per session: the song's start is when it was first seen playing,
    paused time left out, and a real position Music Assistant reports (``reported``: seconds, at a wall time) wins. A
    session first seen just after the host started (``known_start`` false: the song was already playing) has no
    position until its next song.

    ``see`` answers (position, at): the position at wall time ``at`` -- the same pair until the play state changes,
    so a speaker's state changes only when it should -- or None when where the song is isn't known."""

    def __init__(self) -> None:
        # session -> [song key, position, at (wall), playing, known]
        self._s: dict[str, list[Any]] = {}

    def see(self, session: str, song: Any, playing: bool, now: float, known_start: bool = True,
            reported: tuple[float, float] | None = None) -> tuple[float, float] | None:
        st = self._s.get(session)
        if st is None or st[0] != song:
            known = known_start or st is not None
            st = self._s[session] = [song, 0.0, now, playing, known]
        elif st[3] != playing:              # a pause: the position held; a play: counted from now
            st[1] = st[1] + (now - st[2] if st[3] else 0.0)
            st[2], st[3] = now, playing
        if reported is not None and reported[0] > 0:
            pos, at = reported
            here = st[1] + (at - st[2] if st[3] else 0.0)
            if not st[4] or abs(here - pos) > 3:
                st[1], st[2], st[4] = float(pos), float(at), True
        while len(self._s) > KEEP:
            self._s.pop(next(iter(self._s)))
        return (st[1], st[2]) if st[4] else None
