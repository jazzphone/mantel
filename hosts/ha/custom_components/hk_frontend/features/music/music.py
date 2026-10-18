"""Whole-home music: the configuration model and the request engine.

The engine plays a playlist (grouping the chosen speakers, or through a
preset's sync group), moves what is playing, stops, and runs the now-playing
buttons, with the measured timings in const.py. How it runs them:

  * PER-ROOM LOCKS. Each request locks exactly the rooms it touches, so two
    screens can work in different rooms at once, and overlapping requests (a
    Move and a regroup, say) go one at a time.
  * THE NEWEST REQUEST WINS. Each request stamps the rooms it wants; one that
    finds a newer stamp when its turn comes answers `superseded` and does
    nothing, instead of running a stale request after the one that replaced it.
  * WAITS ARE EVENTS. Every wait listens for the state change it needs (see
    _wait) instead of re-rendering a template. The one sleep left is
    JOIN_SETTLE, and const.py says why it cannot be an event.
  * EVERY REQUEST ANSWERS. {ok, leader} or {ok: False, message}, returned to
    the caller.
  * ONE LOG LINE per request, with who, what, where and how long (debug when
    it worked, info when it was refused or failed).
  * STOP CANCELS what is running for its rooms; the cancelled request answers
    "stopped".

Configuration comes from the Music feature (features/__init__.py Feature):
options (speakers, volume, each user's home room) and its items (presets,
playlists). Room names and floors
come from HA's area and floor registries, so there is nothing to type for them.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import itertools
import logging
import time
from collections.abc import Callable, Iterable
from contextvars import ContextVar
from typing import Any

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers.event import async_track_state_change_event

from .. import Feature

# The context of the hk_frontend.music_* action being served: set by its
# handler (features/music/__init__.py), read by MusicManager._call, and
# carried by asyncio into every await and task of that request.
CALLER: ContextVar[Context | None] = ContextVar("hk_music_caller", default=None)
from .const import (
    CONF_CHOOSER, CONF_GROUP, CONF_HOMES, CONF_ICON, CONF_ITEMS, CONF_MEMBERS, CONF_IGNORE_ANNOUNCEMENTS,
    CONF_NAME, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME, DEFAULT_VOLUME,
    JOIN_SETTLE, JOIN_TIMEOUT, NOTE_GROUP, NOTE_PARTIAL, NOTE_PLAY, NOTE_PRESET,
    NOTE_STOP, NOTE_TRANSFER, PAUSE_TIMEOUT, RELEASE_TIMEOUT, START_TIMEOUT,
    STOP_TIMEOUT, SUB_PLAYLIST, SUB_PRESET, TRANSFER_TIMEOUT, VOLUME_STEP,
)

_LOGGER = logging.getLogger(__name__)

ACTIVE = ("playing", "paused")
GONE = (STATE_UNAVAILABLE, STATE_UNKNOWN)

# The two answers a request gives when something newer took its rooms.
SUPERSEDED = {"ok": False, "superseded": True,
              "message": "A newer request for these rooms replaced this one."}
STOPPED = {"ok": False, "superseded": True, "message": "Stopped."}


def _log(res: dict[str, Any], msg: str, *args: Any) -> None:
    """ONE LINE PER REQUEST: debug when it worked or stood down, info when it
    was refused or failed (the failures a person sees also raise a
    persistent_notification). Turn on debug logging for the integration to see
    every request."""
    quiet = res.get("ok") or res.get("superseded")
    _LOGGER.log(logging.DEBUG if quiet else logging.INFO, msg, *args)


# =========================================================== configuration
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
    def from_entry(cls, hass: HomeAssistant, entry: Feature) -> MusicConfig:
        opts = entry.options
        cfg = cls(ignore_announcements=opts.get(CONF_IGNORE_ANNOUNCEMENTS, True),
                  volume=float(opts.get(CONF_VOLUME, DEFAULT_VOLUME)),
                  homes=dict(opts.get(CONF_HOMES) or {}))
        ma = [e for e in hass.config_entries.async_entries("music_assistant")
              if e.state is ConfigEntryState.LOADED]
        cfg.library_entry = ma[0].entry_id if ma else None
        ents, devs = er.async_get(hass), dr.async_get(hass)
        areas, floors = ar.async_get(hass), fr.async_get(hass)
        rooms: list[Room] = []
        for i, entity in enumerate(opts.get(CONF_SPEAKERS) or []):
            area = None
            reg = ents.async_get(entity)
            if reg:
                area_id = reg.area_id or (
                    (devs.async_get(reg.device_id).area_id)
                    if reg.device_id and devs.async_get(reg.device_id) else None)
                area = areas.async_get_area(area_id) if area_id else None
            state = hass.states.get(entity)
            name = (area.name if area else None) or (
                state.attributes.get("friendly_name") if state else None) or entity
            floor = floors.async_get_floor(area.floor_id) if area and area.floor_id else None
            rooms.append(Room(entity, name, floor.name if floor else None,
                              floor.level if floor and floor.level is not None else 999, i))
        # FLOORS IN LEVEL ORDER, rooms in the order they were picked within a
        # floor -- the pill grid reads top to bottom, downstairs first.
        rooms.sort(key=lambda r: (r.level, r.index))
        cfg.rooms = rooms
        for sub in entry.subentries.values():
            d = sub.data
            if sub.subentry_type == SUB_PRESET:
                cfg.presets.append(Preset(sub.subentry_id, d.get(CONF_NAME) or sub.title,
                                          d[CONF_GROUP], list(d.get(CONF_MEMBERS) or [])))
            elif sub.subentry_type == SUB_PLAYLIST:
                cfg.playlists.append(Playlist(
                    sub.subentry_id, d.get(CONF_NAME) or sub.title,
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


# =========================================================== the engine
class MusicManager:
    """Runs music requests against the house. One while Music runs."""

    def __init__(self, hass: HomeAssistant, entry: Feature) -> None:
        self.hass, self.entry = hass, entry
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._tlocks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._stamp: defaultdict[str, int] = defaultdict(int)
        self._ids = itertools.count(1)
        # THE REQUESTS IN FLIGHT and the rooms each one claimed, so Stop can
        # cancel them (see stop()). `_stopped` marks a task Stop cancelled, as
        # opposed to one Home Assistant is cancelling (a shutdown), which must
        # stay cancelled.
        self._running: dict[asyncio.Task[Any], set[str]] = {}
        self._stopped: set[asyncio.Task[Any]] = set()
        # Tests shorten the one real sleep; nothing else touches this.
        self.settle = JOIN_SETTLE

    @property
    def config(self) -> MusicConfig:
        return MusicConfig.from_entry(self.hass, self.entry)

    # ---------------------------------------------------------- state helpers
    def _state(self, entity: str) -> str | None:
        st = self.hass.states.get(entity)
        return st.state if st else None

    def _attr(self, entity: str, name: str) -> Any:
        st = self.hass.states.get(entity)
        return st.attributes.get(name) if st else None

    def _members(self, entity: str) -> list[str]:
        return list(self._attr(entity, "group_members") or [])

    def _available(self, entity: str) -> bool:
        return self._state(entity) not in (None, *GONE)

    async def _call(self, domain: str, service: str, data: dict[str, Any]) -> bool:
        """A service call that reports instead of raising.

        Every step that may fail without ending the request goes through
        this, so a failure is a logged False rather than a dead run. It runs
        in the context of the action that asked (CALLER), so the logbook says
        who started the music.
        """
        try:
            await self.hass.services.async_call(domain, service, data, blocking=True,
                                                context=CALLER.get())
        except Exception as err:  # noqa: BLE001 -- any failure is a result here
            _LOGGER.warning("music: %s.%s %s failed: %s", domain, service, data, err)
            return False
        return True

    async def _wait(self, entities: Iterable[str], pred: Callable[[], bool],
                    timeout: float) -> bool:
        """Wait for `pred` to become true, woken by the entities' own changes."""
        if pred():
            return True
        done = asyncio.get_running_loop().create_future()

        @callback
        def _changed(_event: Event) -> None:
            if not done.done() and pred():
                done.set_result(True)

        unsub = async_track_state_change_event(self.hass, list(set(entities)), _changed)
        try:
            async with asyncio.timeout(timeout):
                await done
            return True
        except TimeoutError:
            return pred()
        finally:
            unsub()

    def _note(self, note_id: str, title: str, message: str) -> None:
        persistent_notification.async_create(self.hass, message, title, note_id)

    def _clear(self, *note_ids: str) -> None:
        for n in note_ids:
            persistent_notification.async_dismiss(self.hass, n)

    # ---------------------------------------------------------- claiming rooms
    def _claim(self, rooms: Iterable[str]) -> dict[str, int]:
        stamps = {}
        for r in set(rooms):
            self._stamp[r] += 1
            stamps[r] = self._stamp[r]
        return stamps

    def _superseded(self, stamps: dict[str, int]) -> bool:
        return any(self._stamp[r] != s for r, s in stamps.items())

    @asynccontextmanager
    async def _request(self, rooms: Iterable[str]):
        """Register the running request against its rooms, for Stop."""
        task = asyncio.current_task()
        if task is not None:
            self._running[task] = set(rooms)
        try:
            yield
        finally:
            if task is not None:
                self._running.pop(task, None)

    def _was_stopped(self) -> bool:
        """True -- and the cancellation withdrawn -- when Stop cancelled the
        current task. Called from `except CancelledError`; anything else (Home
        Assistant shutting down) is re-raised by the caller."""
        task = asyncio.current_task()
        if task is None or task not in self._stopped:
            return False
        self._stopped.discard(task)
        task.uncancel()
        return True

    @asynccontextmanager
    async def _hold(self, rooms: Iterable[str]):
        """Lock these rooms, always in the same order, so two requests that
        overlap can never each hold what the other is waiting for."""
        held: list[asyncio.Lock] = []
        try:
            for r in sorted(set(rooms)):
                lock = self._locks[r]
                await lock.acquire()
                held.append(lock)
            yield
        finally:
            for lock in reversed(held):
                lock.release()

    def _entangled(self, rooms: Iterable[str]) -> set[str]:
        """The rooms asked for, plus every room grouped with one of them."""
        out = set(rooms)
        for r in list(out):
            out.update(m for m in self._members(r) if m in self.config.room_ids)
        return out

    def _in_the_way(self, cfg: MusicConfig, rooms: Iterable[str],
                    keep: set[str] | None = None) -> list[str]:
        """Rooms in a group that holds one of `rooms` -- and nothing wider.

        A group somewhere else in the house is somebody's music, not an
        obstacle. `keep` is a group that should be left standing,
        e.g. the sync group a preset is about to play through.
        """
        want = set(rooms)
        out = []
        for r in cfg.room_ids:
            gm = set(self._members(r))
            if len(gm) > 1 and gm & want and gm != keep:
                out.append(r)
        return out

    def _split(self, cfg: MusicConfig, way: list[str],
               want: set[str]) -> list[tuple[str, list[str], list[str]]]:
        """The groups among `way` that are PLAYING and hold rooms not in
        `want`: (their leader, the rooms that should keep the music, the
        whole group). A group wholly wanted, or not playing, is simply
        released."""
        out, seen = [], set()
        for r in way:
            gm = self._members(r)
            if len(gm) < 2 or gm[0] in seen:
                continue
            seen.add(gm[0])
            leader = gm[0]
            rest = [m for m in gm if m not in want and m in cfg.room_ids]
            if rest and leader in cfg.room_ids and self._state(leader) == "playing":
                out.append((leader, rest, list(gm)))
        return out

    def _existing(self, rooms: list[str]) -> list[str] | None:
        """The live group whose members are exactly `rooms`, leader first."""
        want = sorted(rooms)
        for r in rooms:
            gm = self._members(r)
            if len(gm) > 1 and sorted(gm) == want:
                return gm
        return None

    # ---------------------------------------------------------- building blocks
    async def _release(self, rooms: list[str]) -> bool:
        """Take these rooms out of their groups. The pause is part of it: a
        player that is still streaming will not be re-grouped (measured)."""
        playing = [r for r in rooms if self._state(r) == "playing"]
        if playing:
            await self._call("media_player", "media_pause", {"entity_id": playing})
            await self._wait(rooms, lambda: all(self._state(r) != "playing" for r in rooms),
                             PAUSE_TIMEOUT)
        await self._call("media_player", "unjoin", {"entity_id": rooms})
        return await self._wait(rooms, lambda: all(len(self._members(r)) <= 1 for r in rooms),
                                RELEASE_TIMEOUT)

    async def _join(self, leader: str, rooms: list[str]) -> bool:
        """Join `rooms` under `leader` and CHECK it is exactly that group.

        media_player.join reports success while silently dropping a member it
        could not take (measured), so the answer is read back. One
        retry, because the settle is a measured minimum, not a guarantee.
        """
        others = [r for r in rooms if r != leader]
        want = sorted(rooms)
        exact = lambda: sorted(self._members(leader)) == want  # noqa: E731
        for attempt in (1, 2):
            await asyncio.sleep(self.settle)
            await self._call("media_player", "join",
                             {"entity_id": leader, "group_members": others})
            if await self._wait(rooms, exact, JOIN_TIMEOUT):
                return True
            _LOGGER.warning("music: join %s <- %s attempt %d gave %s",
                            leader, others, attempt, self._members(leader))
            await self._call("media_player", "unjoin", {"entity_id": rooms})
        return False

    # ---------------------------------------------------------- requests
    async def play(self, rooms: list[str], playlist: str | None,
                   user: str | None = None) -> dict[str, Any]:
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        rooms = list(rooms or [])
        pl = cfg.playlist(playlist)

        def done(res: dict[str, Any]) -> dict[str, Any]:
            _log(res, "music #%d play %s rooms=%s by %s -> %s (%.1fs)", rid,
                 pl.name if pl else playlist, rooms, user or "-", res, time.monotonic() - t0)
            return res

        fail = self._validate(cfg, rooms)
        if fail:
            return done(fail)
        if pl is None or not pl.items:
            return done({"ok": False, "message": f"There is no playlist called {playlist}."})
        # A LINK THAT NO LONGER EXISTS IS REFUSED, NOT PLAYED. Given a
        # `library://playlist/...` it does not have, Music Assistant does
        # not fail -- it SEARCHES for the text and plays whatever it finds (a
        # podcast episode, say), and "playing" then looks like success. A
        # playlist removed from the streaming library would do exactly that
        # to its pill.
        gone = await self._missing(cfg, pl.items)
        if gone:
            self._note(NOTE_PLAY, "A playlist is missing",
                       f"{pl.name} points at {', '.join(gone)}, which is no longer in the "
                       "Music Assistant library. Edit it in Settings -> Devices & "
                       "services -> HK Frontend -> Music.")
            return done({"ok": False,
                         "message": f"{pl.name} is no longer in the music library."})

        preset = cfg.preset_for_rooms(rooms)
        if preset is not None:
            if not self._available(preset.group):
                return done({"ok": False, "message": f"{preset.name} is unavailable right now."})
            members = preset.members
        else:
            members = rooms

        stamps = self._claim(self._entangled(members))
        try:
            async with self._request(stamps):
                return done(await self._play(cfg, pl, rooms, preset, members, stamps))
        except asyncio.CancelledError:
            if self._was_stopped():
                return done(dict(STOPPED))
            raise

    async def _play(self, cfg: MusicConfig, pl: Playlist, rooms: list[str],
                    preset: Preset | None, members: list[str],
                    stamps: dict[str, int]) -> dict[str, Any]:
        async with self._hold(stamps):
            if self._superseded(stamps):
                return dict(SUPERSEDED)
            # WHO LEADS IS READ NOW, holding the rooms -- not when the request
            # arrived. A request that waited for the lock may find the rooms
            # grouped under a different leader by the one before it, and
            # play_media sent to a group MEMBER plays nowhere useful.
            existing = self._existing(rooms) if preset is None and len(rooms) > 1 else None
            if preset is not None:
                target = preset.group
            else:
                target = existing[0] if existing else rooms[0]
            keep = set(preset.members) if preset else None
            way = [] if existing else self._in_the_way(cfg, members, keep)
            # A GROUP THAT PLAYS ON IN ROOMS NOT PICKED keeps its music there:
            # only the picked rooms are let go (_move -- the music moves off
            # them first when its leader is one), and the rest of the group
            # is never paused (2026-10-14: a new playlist on Master Bedroom,
            # Guest and Office stopped the Living Room it was grouped with)
            split = self._split(cfg, way, set(members))
            for leader, rest, _gm in split:
                moved = await self._move(cfg, rest, leader, cfg.preset_for_rooms(rest))
                if not moved.get("ok"):
                    note = NOTE_PRESET if preset else NOTE_GROUP
                    self._note(note, "Speakers did not release",
                               f"The music in {', '.join(cfg.name_of(r) for r in rest)} could not "
                               "keep playing without the requested speakers. No new music was "
                               "started. Try again.")
                    return {"ok": False, "message": "The speakers did not release."}
            if split:
                done = {m for _l, _r, gm in split for m in gm}
                way = [r for r in way if r not in done]
                if not way and preset is not None:
                    await asyncio.sleep(self.settle)       # (the settle below)
            if way:
                if not await self._release(way):
                    note = NOTE_PRESET if preset else NOTE_GROUP
                    self._note(note, "Speakers did not release",
                               "The previous group did not release the requested speakers. "
                               "No new music was started. Try again.")
                    return {"ok": False, "message": "The speakers did not release."}
                if preset is not None:
                    # THE SETTLE: MA reports group_members [] before a
                    # released player is free, and the sync group about to
                    # play regroups these very rooms (the ad-hoc path
                    # settles inside _join). Measured, and
                    # only a margin: MA offers no "free now" signal to wait
                    # on, so every room is CHECKED once the group plays.
                    await asyncio.sleep(self.settle)
            if preset is None and len(rooms) > 1 and not existing:
                if not await self._join(target, rooms):
                    missing = [cfg.name_of(r) for r in rooms if r not in self._members(target)]
                    self._note(NOTE_GROUP, "Speakers did not group",
                               f"{', '.join(missing) or 'Some rooms'} did not join "
                               f"{cfg.name_of(target)}. Nothing is playing -- the group was "
                               "broken up rather than left wrong. Try again, or pick one room.")
                    return {"ok": False, "message": "The speakers did not group."}
            self._clear(NOTE_GROUP, NOTE_PRESET)
            # THE HOUSE PLAYLIST VOLUME, on the ROOMS -- a sync group SCALES its
            # members instead of leveling them (measured).
            await self._call("media_player", "volume_set",
                             {"entity_id": members, "volume_level": cfg.volume})
            await self._call("media_player", "shuffle_set",
                             {"entity_id": target, "shuffle": True})
            if self._superseded(stamps):
                return dict(SUPERSEDED)

        # OUTSIDE THE LOCK: Music Assistant takes ~12s to load a playlist, and
        # holding the rooms for that long would make a change of mind wait for
        # the music it is replacing. A newer request may now proceed; its own
        # play_media replaces this queue, and this one then reports quietly.
        await self._call("music_assistant", "play_media",
                         {"entity_id": target, "media_id": pl.items, "enqueue": "replace"})
        started = await self._wait([target], lambda: self._state(target) == "playing",
                                   START_TIMEOUT)
        if self._superseded(stamps):
            return {"ok": True, "leader": target, "superseded": True}
        if not started:
            self._note(NOTE_PLAY, "The playlist did not start",
                       f"{pl.name} did not start on {cfg.name_of(target)} -- it is "
                       f"{self._state(target)}. Try again, or pick another speaker.")
            return {"ok": False, "message": f"{pl.name} did not start."}
        self._clear(NOTE_PLAY)
        await self._call("media_player", "shuffle_set", {"entity_id": target, "shuffle": True})
        if preset is not None:
            # EVERY ROOM OF THE PRESET, CHECKED -- not assumed from the settle.
            # A sync group reports playing as soon as ANY member does; its rooms
            # follow within about a second (in the recorder's history, every
            # member turns to playing in the same second as its group).
            # A room that does not is one Music Assistant never freed, which
            # is exactly what the settle guards against and cannot promise.
            # Reported, not retried: the music is already playing everywhere
            # else, and replaying the group would restart it.
            members = preset.members
            if not await self._wait(members, lambda: all(
                    self._state(m) == "playing" for m in members), JOIN_TIMEOUT):
                if self._superseded(stamps):
                    return {"ok": True, "leader": target, "superseded": True}
                names = ", ".join(cfg.name_of(m) for m in members
                                  if self._state(m) != "playing")
                self._note(NOTE_PRESET, "Some speakers did not join",
                           f"{names} did not join {preset.name}. The music is playing in "
                           "the other rooms; play the preset again to bring them in.")
                return {"ok": True, "leader": target, "message": f"{names} did not join."}
        return {"ok": True, "leader": target}

    async def transfer(self, rooms: list[str], source: str,
                       user: str | None = None) -> dict[str, Any]:
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        rooms = list(rooms or [])

        def done(res: dict[str, Any]) -> dict[str, Any]:
            _log(res, "music #%d transfer %s -> %s by %s -> %s (%.1fs)", rid,
                 source, rooms, user or "-", res, time.monotonic() - t0)
            return res

        fail = self._validate(cfg, rooms)
        if fail:
            return done(fail)
        if source not in cfg.players():
            return done({"ok": False, "message": f"{source} is not a speaker this house knows."})
        if self._state(source) not in ACTIVE:
            return done({"ok": False, "message": f"{cfg.name_of(source)} is not playing."})
        preset = cfg.preset_for_rooms(rooms)
        if preset is not None and source == preset.group:
            return done({"ok": False, "message": f"The music is already on {preset.name}."})
        # ALREADY THERE only when the source plays alone: the source by
        # itself, while it leads a group, is "let the others go" -- what the
        # Music page asks to free rooms for a new pick, and what Update asks
        # when rooms are unticked (2026-10-14: it was refused here, "Could
        # not free Master Bedroom +2: The music is already there.")
        alone = not [m for m in self._members(source) if m != source and m in cfg.room_ids]
        if preset is None and source in rooms and len(rooms) == 1 and alone:
            return done({"ok": False, "message": "The music is already there."})

        was = [m for m in self._members(source) if m in cfg.room_ids]
        stamps = self._claim(self._entangled(set(rooms) | set(was)
                                             | ({source} if source in cfg.room_ids else set())))
        try:
            async with self._request(stamps):
                return done(await self._transfer(cfg, rooms, source, preset, stamps))
        except asyncio.CancelledError:
            if self._was_stopped():
                return done(dict(STOPPED))
            raise

    async def _transfer(self, cfg: MusicConfig, rooms: list[str], source: str,
                        preset: Preset | None, stamps: dict[str, int]) -> dict[str, Any]:
        async with self._hold(stamps):
            if self._superseded(stamps):
                return dict(SUPERSEDED)
            return await self._move(cfg, rooms, source, preset)

    async def _move(self, cfg: MusicConfig, rooms: list[str], source: str,
                    preset: Preset | None) -> dict[str, Any]:
        """The music on `source` onto exactly `rooms` -- the caller holds the
        rooms. Transfer's work, and play's when it frees picked rooms from a
        group that plays on in the rooms not picked."""
        # THE HOUSE IS READ NOW, holding the rooms: a request that waited
        # for the lock (a double tap) finds the first one's work done.
        if preset is not None:
            leader, others, adding = preset.group, [], False
        else:
            adding = source in rooms
            existing = self._existing(rooms)
            leader = source if adding else (existing[0] if existing else rooms[0])
            others = [r for r in rooms if r != leader]
        if self._state(source) not in ACTIVE:
            if self._state(leader) in ACTIVE and all(
                    r in self._members(leader) for r in others):
                return {"ok": True, "leader": leader}      # already done
            return {"ok": False, "message": f"{cfg.name_of(source)} is not playing."}
        if not adding:
            moving = self._attr(source, "media_content_id")
            await self._call("music_assistant", "transfer_queue",
                             {"entity_id": leader, "source_player": source,
                              "auto_play": True})
            # THE LEADER HOLDING THE QUEUE WE MOVED, not merely playing: a
            # room already playing something would pass the weaker test.
            arrived = await self._wait(
                [leader], lambda: self._state(leader) in ACTIVE and (
                    moving is None or self._attr(leader, "media_content_id") == moving),
                TRANSFER_TIMEOUT)
            if not arrived:
                self._note(NOTE_TRANSFER, "Music did not move",
                           f"The queue from {cfg.name_of(source)} could not be confirmed "
                           f"on {cfg.name_of(leader)}. Nothing else was changed.")
                return {"ok": False, "message": "The music did not move."}
        self._clear(NOTE_TRANSFER)
        message = None
        if others:
            await self._call("media_player", "join",
                             {"entity_id": leader, "group_members": others})
            await self._wait(rooms, lambda: all(r in self._members(leader) for r in others),
                             JOIN_TIMEOUT)
            missing = [r for r in others if r not in self._members(leader)]
            if missing:
                # NOT an unjoin-and-give-up: the music is ALREADY on the
                # leader, and tearing that down would be the worse outcome.
                names = ", ".join(cfg.name_of(r) for r in missing)
                message = f"{names} did not join."
                self._note(NOTE_PARTIAL, "Some speakers did not join",
                           f"{names} did not join {cfg.name_of(leader)}. The music moved "
                           "and is playing there; try adding the others again.")
            else:
                self._clear(NOTE_PARTIAL)
        # RELEASE WHAT WAS LEFT BEHIND -- last, once the music is safe on the
        # leader, and only for a ROOM destination: a preset's rooms belong
        # to its sync group.
        if leader in cfg.room_ids:
            stale = [r for r in cfg.room_ids if r not in rooms and len(self._members(r)) > 1
                     and (source in self._members(r)
                          or set(self._members(r)) & set(rooms))]
            if stale:
                await self._call("media_player", "unjoin", {"entity_id": stale})
                await self._wait(stale, lambda: all(len(self._members(r)) <= 1 for r in stale),
                                 RELEASE_TIMEOUT)
                await self._call("media_player", "media_pause", {"entity_id": stale})
        res: dict[str, Any] = {"ok": True, "leader": leader}
        if message:
            res["message"] = message
        return res

    async def stop(self, rooms: list[str] | None = None,
                   user: str | None = None) -> dict[str, Any]:
        """Stop and ungroup. No lock is waited for: Stop must not queue behind
        the thing it is stopping. Stamping the rooms is what makes any request
        still waiting for them stand down."""
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        whole = not rooms
        targets = cfg.room_ids if whole else [r for r in rooms if r in cfg.room_ids]
        if not targets:
            return {"ok": False, "message": "None of those are rooms this house knows."}
        self._claim(targets)
        # CANCEL WHAT IS STILL RUNNING for these rooms. Stamping alone only
        # stops a request at its next check, so a Move already inside its lock would
        # carry on and join rooms after this has ungrouped them. Each one
        # answers "stopped" (see _was_stopped); a Music Assistant command it
        # had already sent cannot be recalled, which is why the checks below
        # still run.
        mine = asyncio.current_task()
        doomed = [t for t, held in self._running.items()
                  if t is not mine and not t.done() and (whole or held & set(targets))]
        for t in doomed:
            self._stopped.add(t)
            t.cancel()
        if doomed:
            await asyncio.wait(doomed, timeout=STOP_TIMEOUT)
        groups = [p.group for p in cfg.presets] if whole else []
        if groups:
            await self._call("media_player", "media_stop", {"entity_id": groups})
        await self._call("media_player", "media_stop", {"entity_id": targets})
        quiet = lambda: all(self._state(e) != "playing" for e in targets + groups)  # noqa: E731
        await self._wait(targets + groups, quiet, STOP_TIMEOUT)
        await self._call("media_player", "unjoin", {"entity_id": targets})
        res: dict[str, Any] = {"ok": True}
        if whole:
            if await self._wait(targets + groups, quiet, STOP_TIMEOUT):
                self._clear(NOTE_STOP)
            else:
                still = [cfg.name_of(e) for e in targets + groups if self._state(e) == "playing"]
                self._note(NOTE_STOP, "Some music is still playing",
                           f"Stop All did not quiet {', '.join(still)}. Try Stop All again.")
                res = {"ok": False, "message": f"{', '.join(still)} did not stop."}
        _log(res, "music #%d stop %s by %s -> %s (%.1fs)", rid,
             "everything" if whole else targets, user or "-", res, time.monotonic() - t0)
        return res

    async def transport(self, player: str, command: str,
                        level: float | None = None) -> dict[str, Any]:
        """The now-playing buttons. One lock per player, so four quick volume
        taps are four steps."""
        cfg = self.config
        if player not in cfg.players():
            return {"ok": False, "message": f"{player} is not a speaker this house knows."}
        async with self._tlocks[player]:
            if command == "play_pause":
                ok = await self._call("media_player", "media_play_pause", {"entity_id": player})
            elif command == "next":
                ok = await self._call("media_player", "media_next_track", {"entity_id": player})
            elif command == "previous":
                ok = await self._call("media_player", "media_previous_track",
                                      {"entity_id": player})
            elif command == "stop":
                ok = await self._call("media_player", "media_stop", {"entity_id": player})
            elif command in ("volume_up", "volume_down", "volume_set"):
                if command == "volume_set":
                    new = float(level if level is not None else cfg.volume)
                else:
                    cur = float(self._attr(player, "volume_level") or 0)
                    new = cur + (VOLUME_STEP if command == "volume_up" else -VOLUME_STEP)
                new = round(min(1.0, max(0.0, new)), 2)
                ok = await self._call("media_player", "volume_set",
                                      {"entity_id": player, "volume_level": new})
            else:
                return {"ok": False, "message": f"Unknown command {command}."}
        return {"ok": ok} if ok else {"ok": False, "message": f"{cfg.name_of(player)} did not respond."}

    async def play_media(self, player: str, content_id: str, content_type: str,
                         user: str | None = None) -> dict[str, Any]:
        """One item from the Music page's Browse, on the player the screen is showing.

        Not a playlist press: no grouping, no house volume -- Browse plays to
        whatever the page is pointed at. What it adds is the check that the
        player is really there (Home Assistant skips an unavailable entity
        and reports success) and an answer that says
        whether playback actually started.
        """
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config

        def done(res: dict[str, Any]) -> dict[str, Any]:
            _log(res, "music #%d browse %s on %s by %s -> %s (%.1fs)", rid,
                 content_id, player, user or "-", res, time.monotonic() - t0)
            return res

        if player not in cfg.players():
            return done({"ok": False, "message": f"{player} is not a speaker this house knows."})
        if not self._available(player):
            return done({"ok": False,
                         "message": f"{cfg.name_of(player)} is unavailable right now."})
        group = cfg.preset_for_group(player)
        stamps = self._claim(self._entangled(
            [player] if player in cfg.room_ids else (group.members if group else [])))
        try:
            async with self._request(stamps):
                ok = await self._call("media_player", "play_media",
                                      {"entity_id": player, "media_content_id": content_id,
                                       "media_content_type": content_type})
                if not ok:
                    return done({"ok": False, "message": "Music Assistant could not play that."})
                started = await self._wait([player], lambda: self._state(player) == "playing",
                                           START_TIMEOUT)
        except asyncio.CancelledError:
            if self._was_stopped():
                return done(dict(STOPPED))
            raise
        if self._superseded(stamps):
            return done({"ok": True, "leader": player, "superseded": True})
        if not started:
            return done({"ok": False, "message": f"It did not start on {cfg.name_of(player)}."})
        return done({"ok": True, "leader": player})

    async def _missing(self, cfg: MusicConfig, items: list[str]) -> list[str]:
        """The library playlists among `items` that the library no longer has.

        Only `library://playlist/` links are checked -- that is the shape every
        playlist pill uses, and the only one a library query can answer. If the
        library cannot be asked (MA restarting), nothing is refused: the check
        exists to catch a dead link, not to block music on a slow server.
        """
        wanted = [i for i in items if i.startswith("library://playlist/")]
        if not wanted or not cfg.library_entry:
            return []
        try:
            resp = await self.hass.services.async_call(
                "music_assistant", "get_library",
                {"config_entry_id": cfg.library_entry, "media_type": "playlist",
                 "limit": 1000}, blocking=True, return_response=True)
        except Exception as err:  # noqa: BLE001 -- see the docstring
            _LOGGER.warning("music: could not check the library: %s", err)
            return []
        have = {i.get("uri") for i in (resp or {}).get("items", [])}
        return [i for i in wanted if i not in have]

    # ---------------------------------------------------------- validation
    def _validate(self, cfg: MusicConfig, rooms: list[str]) -> dict[str, Any] | None:
        if not rooms:
            return {"ok": False, "message": "Pick at least one speaker."}
        if len(set(rooms)) != len(rooms):
            return {"ok": False, "message": "A speaker was asked for twice."}
        unknown = [r for r in rooms if r not in cfg.room_ids]
        if unknown:
            return {"ok": False, "message": f"Not a speaker this house knows: {', '.join(unknown)}."}
        gone = [cfg.name_of(r) for r in rooms if not self._available(r)]
        if gone:
            return {"ok": False, "message": f"{', '.join(gone)} is unavailable right now."}
        return None
