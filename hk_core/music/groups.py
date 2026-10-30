"""SPEAKERS MADE OF SEVERAL PLAYERS, and the presets' rooms, as Music Assistant has them.

A stereo pair (2026-10-30: the Office's two HomePods, each panned left or right by its own DSP) is a
Music Assistant sync group of two players, picked as ONE speaker. Music Assistant cannot put a group
inside another group, so a preset's group holds the pair's two players themselves -- and Home
Assistant shows neither: they are hidden from it, and a sync group's player reports no members there.
So both are read from Music Assistant's own player list (``players/all``, the host's client):

  * a speaker whose player is a group is a PAIR: one room, its players its PARTS;
  * a preset's rooms are its group's members, a pair's parts folded back into the pair. A group
    holding only some of a pair's parts, or a player that is no speaker, is a PROBLEM the settings
    page says (``problem_text``).

With no player list (Music Assistant not reachable yet) there is no Groups: the presets keep the
rooms chosen for them, and no speaker is a pair.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

@dataclass(frozen=True)
class MaPlayer:
    player_id: str
    name: str
    group: bool                 # a Music Assistant group player (its type is "group")
    members: tuple[str, ...]    # a group's players, by id


def read_players(raw: Any) -> dict[str, MaPlayer]:
    """Music Assistant's ``players/all`` answer -> {player id: MaPlayer}. Anything unreadable is skipped."""
    out: dict[str, MaPlayer] = {}
    for p in raw if isinstance(raw, (list, tuple)) else []:
        if not isinstance(p, Mapping) or not isinstance(p.get("player_id"), str):
            continue
        pid = p["player_id"]
        members = p.get("group_members") or p.get("group_childs") or []
        out[pid] = MaPlayer(pid, str(p.get("display_name") or p.get("name") or pid), p.get("type") == "group",
                            tuple(m for m in members if isinstance(m, str)) if isinstance(members, list) else ())
    return out


@dataclass
class GroupRooms:
    """A group's rooms, in the speakers' order, and what is wrong with it ({code, ...} each)."""
    rooms: list[str] = field(default_factory=list)
    problems: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Groups:
    """What Music Assistant says about the house's speakers. ``pids``: {media_player entity: its Music
    Assistant player id} (HA's music_assistant entities' unique ids)."""
    players: dict[str, MaPlayer]
    pids: dict[str, str]

    @classmethod
    def read(cls, raw: Any, pids: Mapping[str, str]) -> Groups | None:
        """None when there is no player list to read."""
        if not isinstance(raw, (list, tuple)):
            return None
        return cls(read_players(raw), dict(pids))

    def player(self, entity: str) -> MaPlayer | None:
        pid = self.pids.get(entity)
        return self.players.get(pid) if pid else None

    def name(self, pid: str) -> str:
        p = self.players.get(pid)
        return p.name if p else pid

    def parts(self, entity: str) -> list[str] | None:
        """A speaker that is a group: its players' ids (None: one player)."""
        p = self.player(entity)
        return list(p.members) if p is not None and p.group and len(p.members) > 1 else None

    def is_group(self, entity: str) -> bool:
        p = self.player(entity)
        return p is not None and p.group

    def rooms_of(self, group: str, rooms: Iterable[str]) -> GroupRooms | None:
        """The rooms Music Assistant's group ``group`` (an entity) plays in, from the speakers ``rooms`` in
        their order; None when it is not a group Music Assistant knows."""
        g = self.player(group)
        if g is None or not g.group:
            return None
        have, claimed, out = set(g.members), set(), GroupRooms()
        for r in rooms:
            parts = self.parts(r)
            if parts:
                inside = [x for x in parts if x in have]
                claimed.update(inside)
                if len(inside) == len(parts):
                    out.rooms.append(r)
                elif inside:
                    out.problems.append({"code": "part", "room": r,
                                         "in": [self.name(x) for x in inside],
                                         "out": [self.name(x) for x in parts if x not in have]})
            elif self.pids.get(r) in have:
                out.rooms.append(r)
                claimed.add(self.pids[r])
        for m in g.members:
            if m not in claimed:
                out.problems.append({"code": "not_a_speaker", "player": self.name(m)})
        return out


def kind(parts: list[str]) -> str:
    """What a speaker made of ``parts`` is called: a stereo pair (two), else a speaker group."""
    return "stereo pair" if len(parts) == 2 else "speaker group"


def problem_text(p: Mapping[str, Any], room_name: str | None = None) -> str:
    """A group's problem, in words (the settings page's)."""
    if p.get("code") == "part":
        return (f"{' and '.join(p['in'])} is in this group without {' and '.join(p['out'])}, "
                f"so {room_name or p.get('room')} isn’t one of its rooms. Put both in it in Music Assistant.")
    if p.get("code") == "not_a_speaker":
        return f"{p.get('player')} is in this group but isn’t one of Music’s speakers, so no screen shows it."
    return str(p.get("code"))


def signature(raw: Any) -> tuple:
    """What of a player list the configuration reads (names, kinds, members): a host re-sends the
    screens' configuration only when this changes, not on every song."""
    return tuple(sorted((p.player_id, p.name, p.group, p.members) for p in read_players(raw).values())) \
        if isinstance(raw, (list, tuple)) else ()
