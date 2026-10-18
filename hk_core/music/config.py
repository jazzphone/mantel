"""Whole-home music's configuration: rooms, presets, playlists, and what a screen is handed.

Built from the feature's options (speakers, volume, each user's home room) and its items
(presets, playlists). Room names and floors come from the house (each speaker's area and that
area's floor), so there is nothing to type for them and renaming an area renames its pill.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from ..house import House, area_of
from .const import (
    CONF_CHOOSER, CONF_GROUP, CONF_HOMES, CONF_ICON, CONF_IGNORE_ANNOUNCEMENTS, CONF_ITEMS, CONF_MEMBERS,
    CONF_NAME, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME, DEFAULT_VOLUME, SUB_PLAYLIST, SUB_PRESET,
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
        return entity

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

    @classmethod
    def build(cls, house: House, options: Mapping[str, Any], items: Iterable[Item],
              library_entry: str | None = None) -> MusicConfig:
        """The configuration from the feature's options and items, named and floored from the
        house. `library_entry`: where the host's library answers from (HA: Music Assistant's
        loaded config entry), or None."""
        opts = options
        cfg = cls(ignore_announcements=opts.get(CONF_IGNORE_ANNOUNCEMENTS, True),
                  volume=float(opts.get(CONF_VOLUME, DEFAULT_VOLUME)),
                  homes=dict(opts.get(CONF_HOMES) or {}))
        cfg.library_entry = library_entry
        rooms: list[Room] = []
        for i, entity in enumerate(opts.get(CONF_SPEAKERS) or []):
            area_id = area_of(house, house.entity(entity))
            area_name = house.area_name(area_id) if area_id else None
            state = house.state(entity)
            name = area_name or (state.attributes.get("friendly_name") if state else None) or entity
            floor = house.area_floor(area_id) if area_id else None
            rooms.append(Room(entity, name, floor.name if floor else None,
                              floor.level if floor and floor.level is not None else NO_FLOOR_LEVEL, i))
        # FLOORS IN LEVEL ORDER, rooms in the order they were picked within a
        # floor -- the pill grid reads top to bottom, downstairs first.
        rooms.sort(key=lambda r: (r.level, r.index))
        cfg.rooms = rooms
        for item in items:
            d = item.data
            if item.kind == SUB_PRESET:
                cfg.presets.append(Preset(item.key, d.get(CONF_NAME) or item.title,
                                          d[CONF_GROUP], list(d.get(CONF_MEMBERS) or [])))
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
            "speakers": [{"name": p.name, "entity": p.group, "members": p.members}
                         for p in self.presets]
                        + [{"name": r.name, "entity": r.entity} for r in self.rooms],
            "floors": floors,
            "playlists": pills,
            "home": home if home in self.room_ids else None,
            "volume": self.volume,
            "ignore_announcements": self.ignore_announcements,
        }
