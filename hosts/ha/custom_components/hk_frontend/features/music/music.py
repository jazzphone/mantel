"""Whole-home music inside Home Assistant: the configuration from the feature, and the engine
that runs requests against HA's media players.

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

THE DECISIONS ARE SHARED (hk_core/music/, PLAN.md §0 plan review): the configuration model,
which rooms a request claims, what is in the way, who leads, what a move leaves behind, the
refusals, the volume steps -- written once there and asked of HA's house through house.py's
HaHouse. What stays here is Home Assistant's side: the media_player and music_assistant
service calls (in the caller's context), the waits on HA's state events, the locks and Stop's
cancelling, the persistent notifications and the log lines. The names below are kept
(Room, Preset, Playlist, MusicConfig, CALLER, the timings this module reads at call time, and
MusicManager's attributes), so callers and tests are unchanged.

Configuration comes from the Music feature (features/__init__.py Feature):
options (speakers, volume, each user's home room) and its items (presets,
playlists). Room names and floors
come from HA's area and floor registries, so there is nothing to type for them.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
import itertools
import logging
import time
from collections.abc import Callable, Iterable
from contextvars import ContextVar
from typing import Any

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event

from ...hk_core.music import config as C, engine as E
from ...hk_core.music.groups import Groups, signature
from ...hk_core.music.config import Item, Playlist, Preset, Room  # noqa: F401 -- names callers import here
from ...hk_core.music.engine import ACTIVE, GONE, STOPPED, SUPERSEDED  # noqa: F401
from ...house import HaHouse
from .. import Feature
from .warm import mass_client

# The context of the hk_frontend.music_* action being served: set by its
# handler (features/music/__init__.py), read by MusicManager._call, and
# carried by asyncio into every await and task of that request.
CALLER: ContextVar[Context | None] = ContextVar("hk_music_caller", default=None)
from .const import (  # noqa: E402
    JOIN_SETTLE, JOIN_TIMEOUT, NOTE_GROUP, NOTE_PARTIAL, NOTE_PLAY, NOTE_PRESET,
    NOTE_STOP, NOTE_TRANSFER, PAUSE_TIMEOUT, RELEASE_TIMEOUT, START_TIMEOUT,
    STOP_TIMEOUT, TRANSFER_TIMEOUT,
)

_LOGGER = logging.getLogger(__name__)


def _log(res: dict[str, Any], msg: str, *args: Any) -> None:
    """ONE LINE PER REQUEST: debug when it worked or stood down, info when it
    was refused or failed (the failures a person sees also raise a
    persistent_notification). Turn on debug logging for the integration to see
    every request."""
    quiet = res.get("ok") or res.get("superseded")
    _LOGGER.log(logging.DEBUG if quiet else logging.INFO, msg, *args)


# =========================================================== configuration
def _library_entry(hass: HomeAssistant) -> str | None:
    """Music Assistant's loaded config entry: where the library answers from."""
    ma = [e for e in hass.config_entries.async_entries("music_assistant")
          if e.state is ConfigEntryState.LOADED]
    return ma[0].entry_id if ma else None


def _items(entry: Feature) -> list[Item]:
    """The feature's presets and playlists (its subentries), as the shared model reads them."""
    return [Item(s.subentry_type, s.subentry_id, s.title, s.data) for s in entry.subentries.values()]


def ma_pids(hass: HomeAssistant) -> dict[str, str]:
    """{media_player entity: its Music Assistant player id}: the music_assistant entities' unique ids."""
    return {e.entity_id: e.unique_id for e in er.async_get(hass).entities.values()
            if e.platform == "music_assistant" and e.domain == "media_player"}


class MusicConfig(C.MusicConfig):
    """The shared configuration model (hk_core.music.config), read from the HA feature, with Music
    Assistant's groups (hk_core/music/groups.py) as the running engine last read them."""

    @classmethod
    def from_entry(cls, hass: HomeAssistant, entry: Feature) -> MusicConfig:
        raw = getattr(getattr(entry, "runtime_data", None), "ma_players", None)
        groups = Groups.read(raw, ma_pids(hass)) if raw is not None else None
        return cls.build(HaHouse(hass), entry.options, _items(entry), _library_entry(hass), groups)


# =========================================================== the engine
class MusicManager:
    """Runs music requests against the house. One while Music runs."""

    def __init__(self, hass: HomeAssistant, entry: Feature) -> None:
        self.hass, self.entry = hass, entry
        self.house = HaHouse(hass)
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._tlocks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._claims = E.Claims()
        self._ids = itertools.count(1)
        # THE REQUESTS IN FLIGHT and the rooms each one claimed, so Stop can
        # cancel them (see stop()). `_stopped` marks a task Stop cancelled, as
        # opposed to one Home Assistant is cancelling (a shutdown), which must
        # stay cancelled.
        self._running: dict[asyncio.Task[Any], set[str]] = {}
        self._stopped: set[asyncio.Task[Any]] = set()
        # Tests shorten the one real sleep; nothing else touches this.
        self.settle = JOIN_SETTLE
        # MUSIC ASSISTANT'S PLAYER LIST (hk_core/music/groups.py: pairs, and the presets' rooms), as
        # refresh_groups last read it; None until it could be.
        self.ma_players: list[Any] | None = None

    @property
    def config(self) -> MusicConfig:
        return MusicConfig.from_entry(self.hass, self.entry)

    async def refresh_groups(self) -> bool:
        """Music Assistant's player list, read again through the client its Home Assistant integration
        holds (warm.py's mass_client: not a public contract, so a failure keeps the last list). True when
        the groups in it changed -- the screens' configuration is then re-sent."""
        mass = mass_client(self.hass)
        if mass is None:
            return False
        try:
            raw = await mass.send_command("players/all")
        except Exception as err:  # noqa: BLE001 -- the last list stays
            _LOGGER.debug("music: Music Assistant's players could not be read: %s", err)
            return False
        if not isinstance(raw, list):
            return False
        old, self.ma_players = self.ma_players, raw
        return old is None or signature(old) != signature(raw)

    # ---------------------------------------------------------- state helpers
    def _state(self, entity: str) -> str | None:
        return E.state_of(self.house, entity)

    def _attr(self, entity: str, name: str) -> Any:
        return E.attr(self.house, entity, name)

    def _members(self, entity: str) -> list[str]:
        return E.members(self.house, entity)

    def _available(self, entity: str) -> bool:
        return E.available(self.house, entity)

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
        return self._claims.claim(rooms)

    def _superseded(self, stamps: dict[str, int]) -> bool:
        return self._claims.superseded(stamps)

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
        return E.entangled(self.house, self.config, rooms)

    def _in_the_way(self, cfg: MusicConfig, rooms: Iterable[str],
                    keep: set[str] | None = None) -> list[str]:
        return E.in_the_way(self.house, cfg, rooms, keep)

    def _split(self, cfg: MusicConfig, way: list[str],
               want: set[str]) -> list[tuple[str, list[str], list[str]]]:
        return E.split(self.house, cfg, way, want)

    def _existing(self, rooms: list[str]) -> list[str] | None:
        return E.existing(self.house, rooms)

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

        fail, pl = E.check_play(self.house, cfg, rooms, playlist)
        if fail:
            return done(fail)
        # A LINK THAT NO LONGER EXISTS IS REFUSED, NOT PLAYED (engine.gone_from_library).
        # A playlist removed from the streaming library would do exactly that
        # to its pill.
        gone = await self._missing(cfg, pl.items)
        if gone:
            self._note(NOTE_PLAY, "A playlist is missing",
                       f"{pl.name} points at {', '.join(gone)}, which is no longer in the "
                       "Music Assistant library. Edit it in Settings -> Devices & "
                       "services -> HK Frontend -> Music.")
            return done(E.gone_from_library(pl))

        fail, preset, members = E.play_rooms(self.house, cfg, rooms)
        if fail:
            return done(fail)

        stamps = self._claim(E.entangled(self.house, cfg, members))
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
            # WHO LEADS IS READ NOW, holding the rooms (engine.play_target).
            target, existing, way = E.play_target(self.house, cfg, rooms, preset, members)
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
            if E.needs_join(rooms, preset, existing):
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

        fail, preset = E.check_transfer(self.house, cfg, rooms, source)
        if fail:
            return done(fail)

        stamps = self._claim(E.transfer_rooms(self.house, cfg, rooms, source))
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
        leader, others, adding = E.move_plan(self.house, rooms, source, preset)
        if self._state(source) not in ACTIVE:
            if E.already_moved(self.house, leader, others):
                return {"ok": True, "leader": leader}      # already done
            return {"ok": False, "message": f"{cfg.name_of(source)} is not playing."}
        if not adding:
            moving = self._attr(source, "media_content_id")
            await self._call("music_assistant", "transfer_queue",
                             {"entity_id": leader, "source_player": source,
                              "auto_play": True})
            arrived = await self._wait(
                [leader], lambda: E.arrived(self.house, leader, moving), TRANSFER_TIMEOUT)
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
        # leader (engine.stale).
        stale = E.stale(self.house, cfg, rooms, leader, source)
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
        whole, targets = E.stop_plan(cfg, rooms)
        if not targets:
            return dict(E.NO_ROOMS)
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
        groups = E.stop_groups(cfg, whole)
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
        fail = E.check_player(cfg, player)
        if fail:
            return fail
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
                current = self._attr(player, "volume_level") if command != "volume_set" else None
                new = E.new_volume(command, current, level, cfg.volume)
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

        fail = E.check_browse(self.house, cfg, player)
        if fail:
            return done(fail)
        stamps = self._claim(E.browse_rooms(self.house, cfg, player))
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
        wanted = E.library_links(items)
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
        return E.missing(wanted, (resp or {}).get("items", []))

    # ---------------------------------------------------------- validation
    def _validate(self, cfg: MusicConfig, rooms: list[str]) -> dict[str, Any] | None:
        return E.validate(self.house, cfg, rooms)
