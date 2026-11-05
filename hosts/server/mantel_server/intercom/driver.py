"""THE BROADCAST DRIVER (docs/phase17/INTERCOM.md "Concurrency", "Automatic fallback"): what happens once a person
has pressed Send (or started talking in Live) and the rooms are decided.

1. The ``intercom.play`` audit row is written FIRST (the rooms that will actually play, what was skipped and why).
   If it can't be written, nothing plays (``audit_unavailable``).
2. One one-time link is minted for the broadcast's spool (links.py), on the house's stream base.
3. ``IntercomRun`` -- the Music Assistant client's gate for this broadcast alone -- is minted, open while it plays:
   it allows only ``players/cmd/play_announcement``, only on the plan's players, only with ``player_id``, ``url``,
   ``pre_announce`` and ``volume_level``, and only that link's URL.
4. One ``asyncio.gather`` of the calls, one per player, all with the same URL (Music Assistant renders and fetches it
   once for every room), each with its own volume and a per-call timeout of the mode's limit + 90 s (the call
   returns only once the clip has played).
5. Live (17.5): each room is watched for the five failure signals; when the talker finishes, the rooms that failed
   get the WHOLE spool as a Message on a new link.

Nothing of the audio is logged; the row says who, which rooms and how long, never what.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping

log = logging.getLogger("mantel.intercom")

ANNOUNCE = "players/cmd/play_announcement"
ANNOUNCE_ARGS = frozenset({"player_id", "url", "pre_announce", "volume_level"})
CALL_GRACE = 90.0               # the per-call timeout beyond the mode's limit
CLAIM_WAIT = 8.0                # Live: MA must fetch the link within this of the call (signal 1)
PLAYING_WAIT = 10.0             # Live: the room's player must be playing within this (signal 3)


class IntercomRun:
    """One broadcast, as the Music Assistant client's gate (the gateway) sees it. Minted only by the driver, after
    the intercom.play row; open while it plays."""

    def __init__(self, principal: Any, audit_id: int, players: Iterable[str], urls: Iterable[str]) -> None:
        self.principal, self.audit_id = principal, audit_id
        self.players = frozenset(players)
        self.urls = set(urls)
        self.open = audit_id > 0
        self.sent: list[str] = []

    def add_url(self, url: str) -> None:
        """The fallback's second link (Live: the whole spool, as a Message, to the rooms that failed)."""
        self.urls.add(url)

    def allow(self, command: str, args: Mapping[str, Any]) -> bool:
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
