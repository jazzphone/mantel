"""MUSIC STOPPED AFTER A PAUSE, kept for the screens (2026-11-01).

Music Assistant stops a queue that stays paused for 30 seconds (2.10.9: player_queues/pause's ``_watch_pause``),
keeping its item and position (``resume_pos``); play on the stopped queue resumes there (``_handle_play`` ->
``resume``), and a stopped AirPlay leader keeps its group. But a stopped player reads ``idle``, which no screen
counts as music, so the paused song vanished from the Music page and its play button started the first playlist.

The host tells ``Resumes`` every speaker state it sees (HA: state_changed; Mantel: the hub's changes). A player that
goes from ``paused`` to ``idle`` within ``STOP_AFTER`` seconds was stopped by Music Assistant, not by a person, and is
RESUMABLE for ``HOLD`` seconds, until it plays, pauses again or goes off or away. The feed lists them
(``resumable``) and the screens show them as paused (hk-base.js hkMusic.active), so play (``play_pause`` on the
leader) resumes the song where it was. Nothing here sends anything.

But a person's Stop, or Stop All, within those seconds of a pause reads the same (paused, then idle), so the host
tells ``ours`` which players IT is stopping: they are forgotten, and the idle that follows within ``OURS_WINDOW``
seconds is ours, not Music Assistant's (MED-11: Stop All left the room shown as paused for four hours).
"""
from __future__ import annotations

from collections.abc import Iterable

STOP_AFTER = 45             # seconds: Music Assistant's stop comes 30 s into the pause (a margin for its checks)
HOLD = 4 * 3600             # seconds a screen keeps offering it
OURS_WINDOW = 10            # seconds after the host sent a stop in which a player's idle is the host's own


class Resumes:
    def __init__(self) -> None:
        self._paused: dict[str, float] = {}     # player -> when it paused
        self._held: dict[str, float] = {}       # player -> when Music Assistant stopped it
        self._ours: dict[str, float] = {}       # player -> when the host sent it a stop

    def state(self, entity: str, state: str | None, now: float) -> bool:
        """A player's state now; True when the resumable players changed."""
        if state == "paused":
            self._paused.setdefault(entity, now)
            return self._held.pop(entity, None) is not None
        paused = self._paused.pop(entity, None)
        if state == "idle":
            sent = self._ours.get(entity)
            if sent is not None and now - sent <= OURS_WINDOW:
                return self._held.pop(entity, None) is not None     # the host's own stop: nothing to resume
            if entity in self._held:
                return False                    # (an idle player's other changes: still resumable)
            if paused is not None and now - paused <= STOP_AFTER:
                self._held[entity] = now
                return True
            return False
        return self._held.pop(entity, None) is not None

    def ours(self, entities: Iterable[str], now: float) -> bool:
        """The host is stopping these players: forget them, and the idle that follows is not Music Assistant's;
        True when a resumable player was dropped."""
        dropped = False
        for e in entities:
            self._ours[e] = now
            self._paused.pop(e, None)
            dropped = self._held.pop(e, None) is not None or dropped
        for e, at in list(self._ours.items()):
            if now - at > OURS_WINDOW:
                del self._ours[e]
        return dropped

    def players(self, now: float) -> list[str]:
        """The resumable players, oldest gone."""
        for e, at in list(self._held.items()):
            if now - at > HOLD:
                del self._held[e]
        return sorted(self._held)

    def clear(self) -> bool:
        """Forget them all (the host lost the house's states); True when there were any."""
        had = bool(self._held)
        self._paused.clear()
        self._held.clear()
        self._ours.clear()
        return had
