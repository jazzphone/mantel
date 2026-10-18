"""Whole-home music's engine: what each request DECIDES, read from the house.

The host's engine (HA: features/music/music.py's MusicManager) runs the steps -- the service
calls, the waits on states, the per-room locks, Stop's cancelling, the notifications. Before and
between those steps it asks these rules, which only read the house (`House.state`):

  * THE NEWEST REQUEST WINS (`Claims`). Each request stamps the rooms it wants; one that finds a
    newer stamp when its turn comes stands down (`SUPERSEDED`) instead of running stale.
  * WHAT A REQUEST CLAIMS (`entangled`): the rooms it asks for and every room grouped with them.
  * WHAT IS IN THE WAY (`in_the_way`, `split`): a group holding a wanted room -- and nothing
    wider; a group that plays on in rooms not picked keeps its music there.
  * WHO LEADS (`existing`, `play_target`, `move_plan`), read once the rooms are held.
  * WHAT IS LEFT BEHIND by a move (`stale`), released last.
  * THE REFUSALS, answered before anything is sent (`validate`, `check_play`, `check_transfer`,
    `check_player`, `check_browse`, `stop_plan`).
  * THE LEVELS: the house playlist volume, and the now-playing buttons' steps (`new_volume`).

Every answer is {ok, leader} or {ok: False, message}.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from ..house import House
from .config import MusicConfig, Playlist, Preset
from .const import VOLUME_STEP

ACTIVE = ("playing", "paused")
GONE = ("unavailable", "unknown")

# The two answers a request gives when something newer took its rooms.
SUPERSEDED = {"ok": False, "superseded": True,
              "message": "A newer request for these rooms replaced this one."}
STOPPED = {"ok": False, "superseded": True, "message": "Stopped."}

LIBRARY_PLAYLIST = "library://playlist/"


# ------------------------------------------------------------- reading players
def state_of(house: House, entity: str) -> str | None:
    st = house.state(entity)
    return st.state if st else None


def attr(house: House, entity: str, name: str) -> Any:
    st = house.state(entity)
    return st.attributes.get(name) if st else None


def members(house: House, entity: str) -> list[str]:
    """Its group, leader first ([] alone; a sync group player reports none)."""
    return list(attr(house, entity, "group_members") or [])


def available(house: House, entity: str) -> bool:
    return state_of(house, entity) not in (None, *GONE)


# ------------------------------------------------------------- claiming rooms
class Claims:
    """THE NEWEST REQUEST WINS: a stamp per room, bumped by every request that claims it."""

    def __init__(self) -> None:
        self._stamp: defaultdict[str, int] = defaultdict(int)

    def claim(self, rooms: Iterable[str]) -> dict[str, int]:
        stamps = {}
        for r in set(rooms):
            self._stamp[r] += 1
            stamps[r] = self._stamp[r]
        return stamps

    def superseded(self, stamps: dict[str, int]) -> bool:
        return any(self._stamp[r] != s for r, s in stamps.items())


def entangled(house: House, cfg: MusicConfig, rooms: Iterable[str]) -> set[str]:
    """The rooms asked for, plus every room grouped with one of them."""
    out = set(rooms)
    for r in list(out):
        out.update(m for m in members(house, r) if m in cfg.room_ids)
    return out


def in_the_way(house: House, cfg: MusicConfig, rooms: Iterable[str],
               keep: set[str] | None = None) -> list[str]:
    """Rooms in a group that holds one of `rooms` -- and nothing wider.

    A group somewhere else in the house is somebody's music, not an
    obstacle. `keep` is a group that should be left standing,
    e.g. the sync group a preset is about to play through.
    """
    want = set(rooms)
    out = []
    for r in cfg.room_ids:
        gm = set(members(house, r))
        if len(gm) > 1 and gm & want and gm != keep:
            out.append(r)
    return out


def split(house: House, cfg: MusicConfig, way: list[str],
          want: set[str]) -> list[tuple[str, list[str], list[str]]]:
    """The groups among `way` that are PLAYING and hold rooms not in
    `want`: (their leader, the rooms that should keep the music, the
    whole group). A group wholly wanted, or not playing, is simply
    released."""
    out, seen = [], set()
    for r in way:
        gm = members(house, r)
        if len(gm) < 2 or gm[0] in seen:
            continue
        seen.add(gm[0])
        leader = gm[0]
        rest = [m for m in gm if m not in want and m in cfg.room_ids]
        if rest and leader in cfg.room_ids and state_of(house, leader) == "playing":
            out.append((leader, rest, list(gm)))
    return out


def existing(house: House, rooms: list[str]) -> list[str] | None:
    """The live group whose members are exactly `rooms`, leader first."""
    want = sorted(rooms)
    for r in rooms:
        gm = members(house, r)
        if len(gm) > 1 and sorted(gm) == want:
            return gm
    return None


# ------------------------------------------------------------- refusals
def validate(house: House, cfg: MusicConfig, rooms: list[str]) -> dict[str, Any] | None:
    """The rooms a request names: some, each once, each a room, each there."""
    if not rooms:
        return {"ok": False, "message": "Pick at least one speaker."}
    if len(set(rooms)) != len(rooms):
        return {"ok": False, "message": "A speaker was asked for twice."}
    unknown = [r for r in rooms if r not in cfg.room_ids]
    if unknown:
        return {"ok": False, "message": f"Not a speaker this house knows: {', '.join(unknown)}."}
    gone = [cfg.name_of(r) for r in rooms if not available(house, r)]
    if gone:
        return {"ok": False, "message": f"{', '.join(gone)} is unavailable right now."}
    return None


def unknown_player(player: str) -> dict[str, Any]:
    return {"ok": False, "message": f"{player} is not a speaker this house knows."}


def check_player(cfg: MusicConfig, player: str) -> dict[str, Any] | None:
    """A command names a preset's group or a room, nothing else."""
    return None if player in cfg.players() else unknown_player(player)


# ------------------------------------------------------------- play
def check_play(house: House, cfg: MusicConfig, rooms: list[str],
               playlist: str | None) -> tuple[dict[str, Any] | None, Playlist | None]:
    """A playlist press, before anything is asked of the library: (a refusal or None, the playlist)."""
    pl = cfg.playlist(playlist)
    fail = validate(house, cfg, rooms)
    if fail:
        return fail, pl
    if pl is None or not pl.items:
        return {"ok": False, "message": f"There is no playlist called {playlist}."}, pl
    return None, pl


def library_links(items: Iterable[str]) -> list[str]:
    """The links a library check can answer: `library://playlist/` ones, the shape every pill uses."""
    return [i for i in items if i.startswith(LIBRARY_PLAYLIST)]


def missing(wanted: Iterable[str], library: Iterable[dict[str, Any]]) -> list[str]:
    """The `wanted` links the library's playlists ({uri, ...}) no longer have."""
    have = {i.get("uri") for i in library}
    return [i for i in wanted if i not in have]


def gone_from_library(pl: Playlist) -> dict[str, Any]:
    """A LINK THAT NO LONGER EXISTS IS REFUSED, NOT PLAYED. Given a `library://playlist/...` it does
    not have, Music Assistant does not fail -- it SEARCHES for the text and plays whatever it finds
    (a podcast episode, say), and "playing" then looks like success."""
    return {"ok": False, "message": f"{pl.name} is no longer in the music library."}


def play_rooms(house: House, cfg: MusicConfig, rooms: list[str]
               ) -> tuple[dict[str, Any] | None, Preset | None, list[str]]:
    """Through a preset's sync group when the rooms are exactly a preset's, else the rooms
    themselves: (a refusal or None, the preset, the rooms that will play)."""
    preset = cfg.preset_for_rooms(rooms)
    if preset is not None:
        if not available(house, preset.group):
            return {"ok": False, "message": f"{preset.name} is unavailable right now."}, preset, preset.members
        return None, preset, preset.members
    return None, None, rooms


def play_target(house: House, cfg: MusicConfig, rooms: list[str], preset: Preset | None,
                members_: list[str]) -> tuple[str, list[str] | None, list[str]]:
    """WHO LEADS, read once the rooms are held -- not when the request arrived: a request that
    waited may find the rooms grouped under a different leader by the one before it, and
    play_media sent to a group MEMBER plays nowhere useful. (the target, the live group that is
    exactly the rooms or None, the rooms in the way)."""
    found = existing(house, rooms) if preset is None and len(rooms) > 1 else None
    if preset is not None:
        target = preset.group
    else:
        target = found[0] if found else rooms[0]
    keep = set(preset.members) if preset else None
    way = [] if found else in_the_way(house, cfg, members_, keep)
    return target, found, way


def needs_join(rooms: list[str], preset: Preset | None, found: list[str] | None) -> bool:
    """Ad-hoc rooms are joined under their leader, unless they already are that group."""
    return preset is None and len(rooms) > 1 and not found


# ------------------------------------------------------------- transfer
def check_transfer(house: House, cfg: MusicConfig, rooms: list[str],
                   source: str) -> tuple[dict[str, Any] | None, Preset | None]:
    """Move (or add to) what `source` plays: (a refusal or None, the destination preset)."""
    fail = validate(house, cfg, rooms)
    if fail:
        return fail, None
    if source not in cfg.players():
        return unknown_player(source), None
    if state_of(house, source) not in ACTIVE:
        return {"ok": False, "message": f"{cfg.name_of(source)} is not playing."}, None
    preset = cfg.preset_for_rooms(rooms)
    if preset is not None and source == preset.group:
        return {"ok": False, "message": f"The music is already on {preset.name}."}, preset
    # ALREADY THERE only when the source plays alone: the source by
    # itself, while it leads a group, is "let the others go" -- what the
    # Music page asks to free rooms for a new pick, and what Update asks
    # when rooms are unticked (2026-10-14: it was refused here, "Could
    # not free Master Bedroom +2: The music is already there.")
    alone = not [m for m in members(house, source) if m != source and m in cfg.room_ids]
    if preset is None and source in rooms and len(rooms) == 1 and alone:
        return {"ok": False, "message": "The music is already there."}, preset
    return None, preset


def transfer_rooms(house: House, cfg: MusicConfig, rooms: list[str], source: str) -> set[str]:
    """What a move claims: its rooms, the source's group, the source if a room -- entangled."""
    was = [m for m in members(house, source) if m in cfg.room_ids]
    return entangled(house, cfg, set(rooms) | set(was)
                     | ({source} if source in cfg.room_ids else set()))


def move_plan(house: House, rooms: list[str], source: str,
              preset: Preset | None) -> tuple[str, list[str], bool]:
    """THE HOUSE IS READ NOW, holding the rooms: (the leader, the rooms to join to it, whether
    this ADDS rooms to the source rather than moving its queue)."""
    if preset is not None:
        return preset.group, [], False
    adding = source in rooms
    found = existing(house, rooms)
    leader = source if adding else (found[0] if found else rooms[0])
    return leader, [r for r in rooms if r != leader], adding


def already_moved(house: House, leader: str, others: list[str]) -> bool:
    """The source stopped because the move is done (a double tap finding the first one's work)."""
    return state_of(house, leader) in ACTIVE and all(r in members(house, leader) for r in others)


def arrived(house: House, leader: str, moving: Any) -> bool:
    """THE LEADER HOLDING THE QUEUE WE MOVED, not merely playing: a room already playing
    something would pass the weaker test."""
    return state_of(house, leader) in ACTIVE and (
        moving is None or attr(house, leader, "media_content_id") == moving)


def stale(house: House, cfg: MusicConfig, rooms: list[str], leader: str, source: str) -> list[str]:
    """WHAT WAS LEFT BEHIND by a move, to release last -- and only for a ROOM destination: a
    preset's rooms belong to its sync group."""
    if leader not in cfg.room_ids:
        return []
    return [r for r in cfg.room_ids if r not in rooms and len(members(house, r)) > 1
            and (source in members(house, r) or set(members(house, r)) & set(rooms))]


# ------------------------------------------------------------- stop
NO_ROOMS = {"ok": False, "message": "None of those are rooms this house knows."}


def stop_plan(cfg: MusicConfig, rooms: list[str] | None) -> tuple[bool, list[str]]:
    """(the whole house?, the rooms to stop -- none: refused with NO_ROOMS)."""
    whole = not rooms
    return whole, cfg.room_ids if whole else [r for r in rooms if r in cfg.room_ids]


def stop_groups(cfg: MusicConfig, whole: bool) -> list[str]:
    """Stop All stops the presets' sync groups too."""
    return [p.group for p in cfg.presets] if whole else []


# ------------------------------------------------------------- levels
def new_volume(command: str, current: Any, level: float | None, house_volume: float) -> float:
    """A volume button's level: set (to `level`, else the house volume), or one step up or down
    from `current`; always 0..1, two places."""
    if command == "volume_set":
        new = float(level if level is not None else house_volume)
    else:
        cur = float(current or 0)
        new = cur + (VOLUME_STEP if command == "volume_up" else -VOLUME_STEP)
    return round(min(1.0, max(0.0, new)), 2)


# ------------------------------------------------------------- browse
def check_browse(house: House, cfg: MusicConfig, player: str) -> dict[str, Any] | None:
    """One Browse item plays on a known player that is really there (Home Assistant skips an
    unavailable entity and reports success)."""
    if player not in cfg.players():
        return unknown_player(player)
    if not available(house, player):
        return {"ok": False, "message": f"{cfg.name_of(player)} is unavailable right now."}
    return None


def browse_rooms(house: House, cfg: MusicConfig, player: str) -> set[str]:
    """What a Browse item claims: its room, or its preset's rooms -- entangled."""
    group = cfg.preset_for_group(player)
    return entangled(house, cfg, [player] if player in cfg.room_ids else (group.members if group else []))
