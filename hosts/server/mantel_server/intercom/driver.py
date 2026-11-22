"""THE BROADCAST DRIVER (docs/phase17/INTERCOM.md "Concurrency", "Automatic fallback"): what happens once a person
has pressed Send (or started talking in Live) and the rooms are decided.

1. The ``intercom.play`` audit row is written FIRST (the rooms that will actually play, what was skipped and why).
   If it can't be written, nothing plays (``audit_unavailable``).
2. One one-time link is minted for the broadcast's spool (links.py), on the house's stream base.
3. ``IntercomRun`` -- the Music Assistant client's gate for this broadcast alone -- is minted, open while it plays:
   it allows ``players/cmd/play_announcement``, only on the plan's players, only with ``player_id``, ``url``,
   ``pre_announce`` and ``volume_level``, and only that link's URL; and joining and parting the plan's own temporary
   groups. A closed run still lets a group it formed part.
4. One ``asyncio.gather`` of the calls, one per player, all with the same URL (Music Assistant renders and fetches it
   once for every room), each with its own volume and a per-call timeout of the mode's limit + 90 s (the call
   returns only once the clip has played).
   Rooms in step (``in_step``; docs/phase17/INTERCOM-SYNC.md part B): each of the plan's temporary groups is joined,
   checked (Music Assistant must report exactly those members, so no room outside it can hear), announced to once
   through its leader, and parted. A group that doesn't come together, a dead leader or a failed start means one call
   per room, on a new link: a message is never lost to the group step.
   Rooms at different volumes (``_Tuning``): Music Assistant gives a group one announcement volume (every member is set
   to it, and put back afterward to what it found), so the group is announced at its quietest room's and every other
   speaker is first set to its own room's, then set back to it the moment Music Assistant has set the group's -- a cold
   start takes seconds, so that lands before the first sound, and a late one only leaves a room quieter. Each speaker's
   own volume is put back after the message.
5. Live (17.5): each room is watched for the five failure signals; when the talker finishes, the rooms that failed
   get the WHOLE spool as a Message on a new link. Live's groups are the host's (``_live_calls``, with this file's
   join and ``settle``): a group that doesn't come together means one live call per room on the same link, since
   nothing has read it yet.

Nothing of the audio is logged; the row says who, which rooms and how long, never what.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping

from hk_core.intercom import rooms as R

log = logging.getLogger("mantel.intercom")

ANNOUNCE = "players/cmd/play_announcement"
ANNOUNCE_ARGS = frozenset({"player_id", "url", "pre_announce", "volume_level"})
JOIN = "players/cmd/group_many"
# (not ungroup_many: it goes by each member's synced_to, which lags, and on the house left 7 of 9 in the group; 2026-11-05)
PART = "players/cmd/set_members"
VOLUME = "players/cmd/volume_set"
# Music Assistant's announce_volume_min / _max defaults: it holds an announcement's level inside them
ANNOUNCE_MIN, ANNOUNCE_MAX = 15, 75
CALL_GRACE = 90.0              # the per-call timeout beyond the mode's limit
CLAIM_WAIT = 8.0                # Live: MA must fetch the link within this of the call (signal 1)
PLAYING_WAIT = 10.0             # Live: the room's player must be playing within this (signal 3)
GROUP_WAIT = 4.0                # a temporary group must come together (or part) within this
GROUP_POLL = 0.1
START_WAIT = 14.0               # its leader must be playing within this (Music Assistant waits 10 s itself)
START_POLL = 0.25
STILL_GROUPED = "still_grouped"  # a speaker that couldn't be confirmed on its own after a group failed: not called
SETTLE_WAIT = 20.0              # a stopped announcement must answer within this (about 8 s after its stream ends)


class IntercomRun:
    """One broadcast, as the Music Assistant client's gate (the gateway) sees it. Minted only by the driver, after
    the intercom.play row; open while it plays."""

    def __init__(self, principal: Any, audit_id: int, players: Iterable[str], urls: Iterable[str],
                 groups: Mapping[str, Iterable[str]] | None = None,
                 lent: Mapping[str, Iterable[str]] | None = None) -> None:
        self.principal, self.audit_id = principal, audit_id
        self.players = frozenset(players)
        self.urls = set(urls)
        self.groups = {leader: frozenset(members) for leader, members in (groups or {}).items()}  # the plan's sync sets
        self.formed: set[str] = set()     # leaders of groups not parted yet: their part goes through even after close
        self.lent = {leader: frozenset(members) for leader, members in (lent or {}).items()}   # groups left from music
        self.tuned: set[str] = set()      # speakers whose volume a group's tuning changed: put back even after close
        self.open = audit_id > 0
        self.sent: list[str] = []

    def add_url(self, url: str) -> None:
        """The fallback's second link (Live: the whole spool, as a Message, to the rooms that failed)."""
        self.urls.add(url)

    def add_groups(self, groups: Mapping[str, Iterable[str]]) -> None:
        """The fallback's temporary groups (Live: the rooms that hear the Message at the end)."""
        self.groups.update({leader: frozenset(members) for leader, members in groups.items()})

    def allow(self, command: str, args: Mapping[str, Any]) -> bool:
        if command == JOIN:
            # exactly one of the plan's own temporary groups, whole; or a borrowed group's speakers going back to it
            # (even after close: that's how it ends), never any other
            kids = args.get("child_player_ids")
            if not (set(args) == {"target_player", "child_player_ids"} and isinstance(kids, list) and bool(kids)
                    and all(isinstance(k, str) for k in kids) and isinstance(args["target_player"], str)):
                return False
            target = args["target_player"]
            return ((self.open and self.groups.get(target) == frozenset(kids))
                    or (target in self.lent and frozenset(kids) <= self.lent[target]))
        if command == PART and (self.open or args.get("target_player") in self.formed):
            # the members of one of those groups leaving its leader, and no other speaker
            kids = args.get("player_ids_to_remove")
            if not (set(args) == {"target_player", "player_ids_to_remove"} and isinstance(kids, list) and bool(kids)
                    and all(isinstance(k, str) for k in kids) and isinstance(args["target_player"], str)):
                return False
            target = args["target_player"]
            return frozenset(kids) <= self.groups.get(target, frozenset()) | self.lent.get(target, frozenset())
        if command == VOLUME:
            # a speaker of one of the plan's temporary groups, set to its room's volume (or back to its own)
            pid, vol = args.get("player_id"), args.get("volume_level")
            if set(args) != {"player_id", "volume_level"} or isinstance(vol, bool) or not isinstance(vol, int) \
                    or not 0 <= vol <= 100:
                return False
            grouped = {*self.groups, *(m for ms in self.groups.values() for m in ms)}
            return (self.open and pid in grouped) or pid in self.tuned
        if not self.open or command != ANNOUNCE or set(args) - ANNOUNCE_ARGS:
            return False
        if args.get("player_id") not in self.players or args.get("url") not in self.urls:
            return False
        if not isinstance(args.get("pre_announce", False), bool):
            return False
        vol = args.get("volume_level")
        if vol is not None and (isinstance(vol, bool) or not isinstance(vol, int) or not 0 <= vol <= 100):
            return False
        self.sent.append(args["player_id"])
        return True

    def close(self) -> None:
        self.open = False


@dataclass
class RoomResult:
    room: str
    name: str
    player: str
    ok: bool = False
    error: str | None = None
    live: bool = False
    fell_back: bool = False


@dataclass
class Outcome:
    results: list[RoomResult] = field(default_factory=list)
    lag_ms: int | None = None

    @property
    def failed(self) -> list[str]:
        """Rooms with no player that played (a room of several players fails only when all of them did)."""
        by_room: dict[str, list[RoomResult]] = {}
        for r in self.results:
            by_room.setdefault(r.room, []).append(r)
        return [rs[0].name for rs in by_room.values() if not any(x.ok for x in rs)]

    @property
    def rooms_ok(self) -> int:
        return len({r.room for r in self.results if r.ok})


def error_code(exc: BaseException) -> str:
    from ..connectors.ma import CommandRefused, MaError, MaUnavailable
    if isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    if isinstance(exc, MaUnavailable):
        return "music_assistant_unavailable"
    if isinstance(exc, CommandRefused):
        return "refused"
    if isinstance(exc, MaError):
        return f"ma_{exc.error_code}"
    return type(exc).__name__.lower()[:40]


async def announce(ma: Any, run: IntercomRun, calls: list[Any], pids: Mapping[str, str], url: str, *,
                   chime: bool, timeout: float, names: Callable[[str], str],
                   done: Callable[[Any, bool], None] | None = None) -> list[RoomResult]:
    """Every call at once, all with the same URL; one result per call. Never raises for a room's failure. ``done(call,
    ok)``: that room has finished (the music players show it again)."""
    async def one(call: Any) -> RoomResult:
        res = RoomResult(call.room, names(call.room), call.player, live=bool(getattr(call, "live", False)))
        args: dict[str, Any] = {"player_id": pids[call.player], "url": url, "pre_announce": bool(chime)}
        if call.volume is not None:
            args["volume_level"] = int(call.volume)
        try:
            await ma.command(run, ANNOUNCE, timeout=timeout, **args)
            res.ok = True
        except Exception as exc:  # noqa: BLE001 -- each room's own result
            res.error = error_code(exc)
            log.info("intercom: %s did not play (%s)", res.name, res.error)
        if done is not None:
            done(call, res.ok)
        return res
    return list(await asyncio.gather(*(one(c) for c in calls)))


async def broadcast(ma: Any, run: IntercomRun, plan: Any, pids: Mapping[str, str], url: str, *,
                    new_url: Callable[[], str], chime: bool, timeout: float, names: Callable[[str], str],
                    done: Callable[[Any, bool], None] | None = None) -> list[RoomResult]:
    """A Message: the plan's temporary groups, and one call for each other room, all at once. Every room's result, in the
    plan's order; never raises for a room's failure."""
    parts = [announce(ma, run, plan.solo, pids, url, chime=chime, timeout=timeout, names=names, done=done)]
    parts += [in_step(ma, run, one, pids, url, new_url=new_url, chime=chime, timeout=timeout, names=names, done=done)
              for one in plan.sync]
    got = [r for part in await asyncio.gather(*parts) for r in part]
    order = {c.player: i for i, c in enumerate(plan.calls)}
    return sorted(got, key=lambda r: order.get(r.player, 0))


def _view(raw: Any) -> dict[str, Mapping[str, Any]]:
    return {p["player_id"]: p for p in raw if isinstance(p, Mapping) and "player_id" in p} if isinstance(
        raw, (list, tuple)) else {}


def _together(raw: Any, leader: str, members: Iterable[str]) -> bool:
    """The leader's list is exactly this group, the list Music Assistant plays from, and nobody else follows it. The
    members' own ``synced_to`` doesn't count: it's a derived field Music Assistant refreshes on a 2 s debounce, one member
    a time (2026-11-05, measured: the list in 10 ms, the fourth member's field after 8 s)."""
    view = _view(raw)
    want = {leader, *members}
    return (set((view.get(leader) or {}).get("group_members") or ()) == want
            and not any(p.get("synced_to") == leader for pid, p in view.items() if pid not in want))


def _apart(raw: Any, leader: str, members: Iterable[str]) -> bool:
    """Every one of them on its own again."""
    view = _view(raw)
    return all(not (view.get(p) or {}).get("synced_to") and len((view.get(p) or {}).get("group_members") or ()) <= 1
               for p in (leader, *members))


async def _until(ma: Any, wanted: Callable[[Any], bool], wait: float) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait
    while True:
        if wanted(await ma.players()):
            return True
        if loop.time() >= deadline:
            return False
        await asyncio.sleep(GROUP_POLL)


async def _join(ma: Any, run: IntercomRun, leader: str, members: list[str]) -> str | None:
    """The group, checked. None when it's together; else why not."""
    try:
        view = _view(await ma.players())
        if not all(R.groupable(view.get(p)) for p in (leader, *members)):
            return "changed"                      # a room started playing, or left the network, since the plan
        run.formed.add(leader)
        await ma.command(run, JOIN, timeout=GROUP_WAIT, target_player=leader, child_player_ids=members)
        return None if await _until(ma, lambda raw: _together(raw, leader, members), GROUP_WAIT) else "not_together"
    except Exception as exc:  # noqa: BLE001 -- any failure here only means one call per room
        return error_code(exc)


async def _part(ma: Any, run: IntercomRun, leader: str, members: list[str]) -> bool:
    """Every speaker back on its own, confirmed (False: not); twice before it's worth a warning. Never raises. No join
    was sent, nothing to undo."""
    if leader not in run.formed:
        return True
    for _ in range(2):
        try:
            await ma.command(run, PART, timeout=GROUP_WAIT, target_player=leader, player_ids_to_remove=members)
            if await _until(ma, lambda raw: _apart(raw, leader, members), GROUP_WAIT):
                run.formed.discard(leader)
                return True
        except Exception as exc:  # noqa: BLE001
            log.warning("intercom: a temporary group did not part (%s)", error_code(exc))
    log.warning("intercom: a temporary group could not be parted; its speakers may still be grouped")
    return False


async def borrow(ma: Any, run: IntercomRun, loose: Iterable[Any]) -> set[str]:
    """The groups left from music the plan borrows (rooms.leftovers), each taken apart and checked. Returns the leaders
    whose group is NOT apart now: their own calls must not be made (they'd play on the whole group). Never raises."""
    async def one(g: Any) -> str | None:
        try:
            view = _view(await ma.players())
            if (set((view.get(g.leader) or {}).get("group_members") or ()) != {g.leader, *g.members}
                    or not all(R._lendable(view.get(x), x, g.leader) for x in [g.leader, *g.members])):
                return g.leader                   # it changed since the plan: leave it, and its leader, alone
        except Exception:  # noqa: BLE001
            return g.leader
        run.formed.add(g.leader)
        return None if await _part(ma, run, g.leader, list(g.members)) else g.leader
    return {x for x in await asyncio.gather(*map(one, loose)) if x}


async def give_back(ma: Any, run: IntercomRun, loose: Iterable[Any]) -> None:
    """Every borrowed group's speakers back with their leader, in their order: each one still idle and on its own (one
    that started playing, or joined another group, meanwhile is left where it is). Never raises."""
    for g in loose:
        try:
            view = _view(await ma.players())
            lead = view.get(g.leader) or {}
            back = [m for m in g.members if R._lendable(view.get(m), m, m) and _apart(view, m, ())]
            if back and lead.get("available") is True and not lead.get("synced_to"):
                await ma.command(run, JOIN, timeout=GROUP_WAIT, target_player=g.leader, child_player_ids=back)
                if not await _until(ma, lambda raw: set(back) <= set((_view(raw).get(g.leader) or {}).get(
                        "group_members") or ()), GROUP_WAIT):
                    log.warning("intercom: a group left from music didn't come back together")
        except Exception as exc:  # noqa: BLE001
            log.warning("intercom: a group left from music couldn't be put back (%s)", error_code(exc))
        finally:
            run.lent.pop(g.leader, None)


async def on_their_own(ma: Any, calls: list[Any], pids: Mapping[str, str]) -> tuple[list[Any], list[Any]]:
    """After a group that failed: (the calls that are safe to make, those whose speaker is still in a group). An announcement
    to a speaker that still leads somebody plays on them too, so it isn't sent; unreadable counts as not safe."""
    try:
        raw = await ma.players()
    except Exception:  # noqa: BLE001
        return [], list(calls)
    safe = [c for c in calls if _apart(raw, pids[c.player], ())]
    return safe, [c for c in calls if c not in safe]


async def settle(ma: Any, run: IntercomRun, leader: str, members: list[str], call: asyncio.Task | None = None) -> bool:
    """A group whose Live announcement has ended or been stopped goes back. Music Assistant holds a part until the
    announcement is over, about 8 s after its stream ends (2026-11-05), so its answer comes first. Never raises."""
    if call is not None:
        if not call.done():
            await asyncio.wait({call}, timeout=SETTLE_WAIT)
            call.cancel()
        await asyncio.gather(call, return_exceptions=True)
    return await _part(ma, run, leader, members)


async def _say_once(ma: Any, run: IntercomRun, leader: str, url: str, chime: bool, volume: int | None,
                    timeout: float) -> tuple[bool, str | None, bool]:
    """The one announcement, watched: (it played, why not, its leader was heard playing). Music Assistant's call can
    answer "played" for a stream that never started, so a leader that isn't playing in START_WAIT is a failed start."""
    args: dict[str, Any] = {"player_id": leader, "url": url, "pre_announce": bool(chime)}
    if volume is not None:
        args["volume_level"] = int(volume)
    loop = asyncio.get_running_loop()
    started = loop.time()
    task = loop.create_task(ma.command(run, ANNOUNCE, timeout=timeout, **args))
    heard = False
    try:
        while True:
            finished, _ = await asyncio.wait({task}, timeout=START_POLL)
            if not heard:
                try:
                    p = _view(await ma.players()).get(leader) or {}
                    heard = (p.get("playback_state") or p.get("state")) == "playing"
                except Exception:  # noqa: BLE001 -- a read that failed says nothing yet
                    pass
            if finished:
                break
            if not heard and loop.time() - started > START_WAIT:
                return False, "not_playing", False
        try:
            task.result()
            return True, None, True
        except Exception as exc:  # noqa: BLE001
            return False, error_code(exc), heard
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


def _level(volume: int) -> int:
    """The level Music Assistant announces at for ``volume``."""
    return min(max(int(volume), ANNOUNCE_MIN), ANNOUNCE_MAX)


def _volumes(raw: Any) -> dict[str, int | None]:
    return {pid: p.get("volume_level") for pid, p in _view(raw).items()}


class _Tuning:
    """A group's rooms at volumes of their own (the module's notes, 4). ``want``: {speaker: its room's level}, for every
    speaker whose room isn't at the group's announcement level. Never raises; whatever fails leaves a room at the
    group's level, never louder."""

    def __init__(self, ma: Any, run: IntercomRun, want: Mapping[str, int]) -> None:
        self.ma, self.run, self.want = ma, run, dict(want)
        self.before: dict[str, int] = {}      # speakers this set, and the volume each had
        self.ready: dict[str, int] = {}       # speakers at their room's level, as Music Assistant reads it back

    async def _set(self, pid: str, level: int) -> bool:
        self.run.tuned.add(pid)
        try:
            await self.ma.command(self.run, VOLUME, timeout=GROUP_WAIT, player_id=pid, volume_level=int(level))
            return True
        except Exception as exc:  # noqa: BLE001 -- the room plays at the group's level
            log.info("intercom: a speaker's volume could not be set (%s)", error_code(exc))
            return False

    async def prepare(self) -> None:
        """Every speaker at its room's level before the announcement, read back (Music Assistant puts back afterward the
        level it finds when it sets the group's)."""
        if not self.want:
            return
        try:
            now = _volumes(await self.ma.players())
            for pid, level in self.want.items():
                had = now.get(pid)
                if not isinstance(had, int):
                    continue                      # a speaker without a volume to read can't be put back
                if had != level and await self._set(pid, level):
                    self.before[pid] = had
                if had == level or pid in self.before:
                    self.ready[pid] = level
            await _until(self.ma, lambda raw: all(_volumes(raw).get(p) == v for p, v in self.ready.items()), GROUP_WAIT)
            now = _volumes(await self.ma.players())
            self.ready = {p: v for p, v in self.ready.items() if now.get(p) == v}
        except Exception as exc:  # noqa: BLE001
            log.info("intercom: the rooms' own volumes could not be read (%s)", error_code(exc))
            self.ready = {}

    async def hold(self) -> None:
        """Each speaker back at its room's level as soon as Music Assistant has set the group's. Runs until every one is,
        or it's canceled (the announcement has played)."""
        left = dict(self.ready)
        while left:
            try:
                now = _volumes(await self.ma.players())
            except Exception:  # noqa: BLE001 -- a read that failed says nothing yet
                now = {}
            for pid, level in list(left.items()):
                if now.get(pid) not in (None, level):
                    left.pop(pid)
                    await self._set(pid, level)
            await asyncio.sleep(GROUP_POLL)

    async def restore(self) -> None:
        """Every speaker this set back to its own volume, once Music Assistant has put back its own change. One somebody
        has changed meanwhile is left as it is."""
        if not self.before:
            return
        try:
            await _until(self.ma, lambda raw: all(_volumes(raw).get(p) == self.want[p] for p in self.before), GROUP_WAIT)
            now = _volumes(await self.ma.players())
        except Exception:  # noqa: BLE001
            now = {}
        for pid, had in self.before.items():
            if now.get(pid) == self.want[pid]:
                await self._set(pid, had)
            else:
                log.info("intercom: a speaker's volume changed during the message; left as it is")
        self.before.clear()


async def in_step(ma: Any, run: IntercomRun, sync: Any, pids: Mapping[str, str], url: str, *,
                  new_url: Callable[[], str], chime: bool, timeout: float, names: Callable[[str], str],
                  done: Callable[[Any, bool], None] | None = None) -> list[RoomResult]:
    """One temporary group: join, one announcement to its leader, part. A failure before any sound is one call per room
    on a new link; nothing is ever played to a group that isn't exactly the plan's."""
    leader, members = pids[sync.leader.player], [pids[c.player] for c in sync.members]
    why: str | None
    heard = False
    results = [RoomResult(c.room, names(c.room), c.player) for c in sync.calls]
    parted = False
    levels = [c.volume for c in sync.calls if c.volume is not None]
    volume = min(levels) if levels else sync.leader.volume       # the quietest room's: a late tuning errs quiet
    tuning = _Tuning(ma, run, {pids[c.player]: _level(c.volume) for c in sync.calls if c.volume is not None
                               and volume is not None and _level(c.volume) != _level(volume)})
    try:
        why = await _join(ma, run, leader, members)
        if why is None:
            try:
                await tuning.prepare()
                holding = asyncio.get_running_loop().create_task(tuning.hold())
                try:
                    ok, why, heard = await _say_once(ma, run, leader, url, chime, volume, timeout)
                finally:
                    holding.cancel()
                    await asyncio.gather(holding, return_exceptions=True)
            finally:
                await asyncio.shield(tuning.restore())
            if ok:
                await _part(ma, run, leader, members)
                parted = True
                for r, c in zip(results, sync.calls):
                    r.ok = True
                    if done is not None:
                        done(c, True)
                return results
        await _part(ma, run, leader, members)
        parted = True
    finally:
        if not parted:          # cancelled: the speakers still go back
            await asyncio.shield(_part(ma, run, leader, members))
    if heard:
        # it failed partway: the rooms heard some of it, together. Saying it again would be a second message.
        log.info("intercom: a group's message stopped partway (%s)", why)
        for r, c in zip(results, sync.calls):
            r.error = why or "failed"
            if done is not None:
                done(c, False)
        return results
    log.info("intercom: a group of %d fell back to one call per room (%s)", len(sync.calls), why)
    safe, grouped = await on_their_own(ma, sync.calls, pids)
    results = await announce(ma, run, safe, pids, new_url(), chime=chime, timeout=timeout, names=names, done=done)
    for c in grouped:
        results.append(RoomResult(c.room, names(c.room), c.player, error=STILL_GROUPED))
        if done is not None:
            done(c, False)
    try:
        if not _apart(await ma.players(), leader, members):       # the part above waited behind a stuck announcement
            await _part(ma, run, leader, members)
    except Exception:  # noqa: BLE001 -- the message has been sent either way
        log.warning("intercom: could not check that a temporary group parted")
    return results


def result_of(outcome: Outcome, skipped: int, *, fallback: bool = False) -> str:
    """The audit result of a broadcast that was sent."""
    if not outcome.rooms_ok:
        errs = sorted({r.error or "failed" for r in outcome.results})
        return "error:" + (errs[0] if errs else "nothing_played")
    if fallback:
        return "ok:fallback"
    if outcome.failed or skipped:
        return f"ok:partial:{len(outcome.failed) + skipped}"
    return "ok"


def reason_of(plan: Any, *, override: bool, mode: str) -> str:
    """The intercom.play row's reason: how many rooms play, and every room left out with why (never content)."""
    parts = [f"mode:{mode}", f"rooms:{len(plan.playing)}"]
    skipped = [f"{r['room']}={r['why']}" for r in plan.skipped]
    if skipped:
        parts.append("skipped:" + ",".join(skipped))
    if override:
        parts.append("send_anyway")
    return " ".join(parts)[:900]


def now() -> float:
    return time.monotonic()
