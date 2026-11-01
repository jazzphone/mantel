"""Whole-home music's configuration: rooms, presets, playlists, and what a screen is handed.

Built from the feature's options (speakers, volume, each user's home room) and its items
(presets, playlists). Room names and floors come from the house (each speaker's area and that
area's floor), so there is nothing to type for them and renaming an area renames its pill.
With Music Assistant's player list (groups.py), a speaker that is a group is a pair and a
preset's rooms are its group's own. A VIRTUAL PAIR (docs/phase4/VIRTUAL-PAIRS.md) is two players
made one room here: its first player is the room, its second plays with it (``partners``).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from ..house import House, area_of
from .groups import Groups
from .const import (
    CONF_CHOOSER, CONF_GROUP, CONF_HOMES, CONF_ICON, CONF_IGNORE_ANNOUNCEMENTS, CONF_ITEMS, CONF_MEMBERS,
    CONF_NAME, CONF_ORDER, CONF_PAIRS, CONF_PLAYERS, CONF_SPEAKERS, CONF_VOLUME, DEFAULT_VOLUME, SUB_PLAYLIST,
    SUB_PRESET,
)

NO_FLOOR_LEVEL = 999        # a room with no floor (or a floor with no level) sorts last


@dataclass
class Room:
    entity: str
    name: str
    floor: str | None = None
    level: float = 0
    index: int = 0          # the order the options listed it


@dataclass
class Preset:
    key: str
    name: str
    group: str
    members: list[str]
    from_ma: bool = False       # its rooms are its group's, read from Music Assistant
    problems: list[dict[str, Any]] = field(default_factory=list)    # groups.GroupRooms.problems


@dataclass
class Playlist:
    key: str
    name: str
    icon: str
    items: list[str]
    chooser: str | None = None
    order: float = 0


class Item(NamedTuple):
    """One of the feature's items, as the host stores it (HA: a subentry)."""
    kind: str                   # SUB_PRESET or SUB_PLAYLIST
    key: str                    # its id
    title: str
    data: Mapping[str, Any]


@dataclass
class MusicConfig:
    rooms: list[Room] = field(default_factory=list)
    presets: list[Preset] = field(default_factory=list)
    playlists: list[Playlist] = field(default_factory=list)
    volume: float = DEFAULT_VOLUME
    homes: dict[str, str] = field(default_factory=dict)
    library_entry: str | None = None
    ignore_announcements: bool = True
    pairs: dict[str, list[str]] = field(default_factory=dict)     # a pair room -> its players' names
    groups: Groups | None = None
    partners: dict[str, str] = field(default_factory=dict)        # a virtual pair's room -> its second player
    pair_groups: dict[str, str] = field(default_factory=dict)     # a virtual pair's room -> MA's group of the two

    # ---- VIRTUAL PAIRS: the second player folded into its room, and back out for Music Assistant
    def room_of(self, entity: str) -> str | None:
        """The room a player is (a room's own, a virtual pair's second player's pair), else None."""
        if entity in self.room_ids:
            return entity
        return next((r for r, p in self.partners.items() if p == entity), None)

    def fold(self, entities: Iterable[str]) -> list[str]:
        """Players as rooms, in their order: a pair's second player is its room, once; any other player stays."""
        return list(dict.fromkeys(self.room_of(e) or e for e in entities))

    def players_of(self, rooms: Iterable[str]) -> list[str]:
        """Rooms as Music Assistant's players, in their order: a virtual pair is both of its players."""
        out: list[str] = []
        for r in rooms:
            out += [r] + ([self.partners[r]] if r in self.partners else [])
        return list(dict.fromkeys(out))

    def pair_preset(self, rooms: Iterable[str]) -> Preset | None:
        """A virtual pair played ALONE goes through Music Assistant's own group of its two players, when there
        is one (the owner's "Actual Group Pair"): played as a preset of one room, never listed as one."""
        rooms = list(rooms)
        if len(rooms) != 1 or rooms[0] not in self.pair_groups:
            return None
        r = rooms[0]
        return Preset(f"pair:{r}", self.name_of(r), self.pair_groups[r], [r], from_ma=True)

    def pair_of_group(self, group: str) -> str | None:
        """The virtual pair whose own Music Assistant group ``group`` is."""
        return next((r for r, g in self.pair_groups.items() if g == group), None)

    def ma_players(self) -> list[str]:
        """Every player a request's steps may send to: the commands', the pairs' second players, their groups."""
        return list(dict.fromkeys(self.players() + list(self.partners.values()) + list(self.pair_groups.values())))

    @property
    def room_ids(self) -> list[str]:
        return [r.entity for r in self.rooms]

    def name_of(self, entity: str) -> str:
        for r in self.rooms:
            if r.entity == entity:
                return r.name
        for p in self.presets:
            if p.group == entity:
                return p.name
        room = self.room_of(entity) or self.pair_of_group(entity)
        return self.name_of(room) if room and room != entity else entity

    def players(self) -> list[str]:
        """Every player a command may name: the presets' groups and the rooms."""
        return [p.group for p in self.presets] + self.room_ids

    def preset_for_rooms(self, rooms: Iterable[str]) -> Preset | None:
        want = set(rooms)
        for p in self.presets:
            if set(p.members) == want:
                return p
        return None

    def preset_for_group(self, group: str) -> Preset | None:
        return next((p for p in self.presets if p.group == group), None)

    def playlist(self, key: str | None) -> Playlist | None:
        return next((p for p in self.playlists if p.key == key), None)

    def presets_with(self, room: str) -> list[Preset]:
        return [p for p in self.presets if room in p.members]

    @classmethod
    def build(cls, house: House, options: Mapping[str, Any], items: Iterable[Item],
              library_entry: str | None = None, groups: Groups | None = None) -> MusicConfig:
        """The configuration from the feature's options and items, named and floored from the
        house. `library_entry`: where the host's library answers from (HA: Music Assistant's
        loaded config entry), or None. `groups`: Music Assistant's players (groups.Groups), or
        None when they cannot be read -- then no speaker is a pair and every preset keeps the
        rooms chosen for it."""
        opts = options
        cfg = cls(ignore_announcements=opts.get(CONF_IGNORE_ANNOUNCEMENTS, True),
                  volume=float(opts.get(CONF_VOLUME, DEFAULT_VOLUME)),
                  homes=dict(opts.get(CONF_HOMES) or {}))
        cfg.library_entry = library_entry
        rooms: list[Room] = []
        names = {}
        for p in virtual_pairs(opts):
            if p[CONF_PLAYERS][0] in (opts.get(CONF_SPEAKERS) or []):
                cfg.partners[p[CONF_PLAYERS][0]] = p[CONF_PLAYERS][1]
                if p.get(CONF_NAME):
                    names[p[CONF_PLAYERS][0]] = p[CONF_NAME]
        for i, entity in enumerate(opts.get(CONF_SPEAKERS) or []):
            if entity in cfg.partners.values():
                continue            # a pair's second player is its room's, never a room of its own
            area_id = area_of(house, house.entity(entity))
            area_name = house.area_name(area_id) if area_id else None
            state = house.state(entity)
            name = names.get(entity) or area_name or (state.attributes.get("friendly_name") if state else None) or entity
            floor = house.area_floor(area_id) if area_id else None
            rooms.append(Room(entity, name, floor.name if floor else None,
                              floor.level if floor and floor.level is not None else NO_FLOOR_LEVEL, i))
        # FLOORS IN LEVEL ORDER, rooms in the order they were picked within a
        # floor -- the pill grid reads top to bottom, downstairs first.
        rooms.sort(key=lambda r: (r.level, r.index))
        cfg.rooms = rooms
        cfg.groups = groups
        speakers = [r for r in opts.get(CONF_SPEAKERS) or [] if r not in cfg.partners.values()]
        virtual = {r: [r, p] for r, p in cfg.partners.items()}
        if groups is not None:
            for r in speakers:
                parts = groups.parts(r)
                if parts:
                    cfg.pairs[r] = [groups.name(x) for x in parts]
            for r, two in virtual.items():
                g = groups.group_of(two)
                if g is not None:
                    cfg.pair_groups[r] = g
        for item in items:
            d = item.data
            if item.kind == SUB_PRESET:
                p = Preset(item.key, d.get(CONF_NAME) or item.title, d[CONF_GROUP], list(d.get(CONF_MEMBERS) or []))
                # ITS ROOMS ARE ITS GROUP'S: Music Assistant's members, a pair's players folded
                # back into the pair -- the rooms chosen for it only while those cannot be read
                got = groups.rooms_of(p.group, speakers, virtual) if groups is not None else None
                if got is not None:
                    p.problems = got.problems
                    if got.rooms:
                        p.members, p.from_ma = got.rooms, True
                cfg.presets.append(p)
            elif item.kind == SUB_PLAYLIST:
                cfg.playlists.append(Playlist(
                    item.key, d.get(CONF_NAME) or item.title,
                    d.get(CONF_ICON) or "mdi:playlist-music",
                    list(d.get(CONF_ITEMS) or []),
                    (d.get(CONF_CHOOSER) or "").strip() or None,
                    float(d.get(CONF_ORDER, 0) or 0)))
        # WIDEST PRESET FIRST: a whole-house preset claims its rooms before a
        # one-floor one.
        cfg.presets.sort(key=lambda p: -len(p.members))
        cfg.playlists.sort(key=lambda p: (p.order, p.name))
        return cfg

    def as_client(self, user_id: str | None) -> dict[str, Any]:
        """What a screen needs, in the shape hkMusic (cards/hk-base.js) reads."""
        floors: list[dict[str, Any]] = []
        for r in self.rooms:
            label = r.floor or "Other"
            if not floors or floors[-1]["name"] != label:
                floors.append({"name": label, "entities": []})
            floors[-1]["entities"].append(r.entity)
        pills: list[dict[str, Any]] = []
        choosers: dict[str, dict[str, Any]] = {}
        for p in self.playlists:
            if p.chooser:
                c = choosers.get(p.chooser)
                if c is None:
                    c = choosers[p.chooser] = {"name": p.chooser, "icon": p.icon, "options": []}
                    pills.append(c)
                c["options"].append({"name": p.name, "key": p.key})
            else:
                pills.append({"name": p.name, "icon": p.icon, "key": p.key})
        home = self.homes.get(user_id or "")
        return {
            # Music Assistant's live config entry, for Browse's get_library --
            # read at runtime so a re-added MA cannot strand the page.
            "library_entry": self.library_entry,
            "configured": True,
            # a pair room says so (its players' names): a preset playing through
            # its group holds it even while the pair's own group player is idle
            "speakers": [{"name": p.name, "entity": p.group, "members": p.members}
                         for p in self.presets]
                        + [dict({"name": r.name, "entity": r.entity},
                                **({"pair": self.pairs[r.entity]} if r.entity in self.pairs else {}),
                                # a virtual pair's two players: the screens fold the second into the room
                                **({"parts": self.players_of([r.entity])} if r.entity in self.partners else {}))
                           for r in self.rooms],
            "floors": floors,
            "playlists": pills,
            "home": home if home in self.room_ids else None,
            "volume": self.volume,
            "ignore_announcements": self.ignore_announcements,
        }


def virtual_pairs(options: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The options' virtual pairs that can be read: {players: [first, second], name}, two different players each,
    no player in two (a later one that reuses a player is left out)."""
    out, used = [], set()
    for p in options.get(CONF_PAIRS) or []:
        two = p.get(CONF_PLAYERS) if isinstance(p, Mapping) else None
        if not isinstance(two, (list, tuple)) or len(two) != 2 or not all(isinstance(x, str) and x for x in two) \
                or two[0] == two[1] or used & set(two):
            continue
        used.update(two)
        name = p.get(CONF_NAME)
        out.append({CONF_PLAYERS: list(two), CONF_NAME: name.strip() if isinstance(name, str) else ""})
    return out
