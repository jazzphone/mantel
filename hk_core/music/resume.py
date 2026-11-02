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
"""
from __future__ import annotations

STOP_AFTER = 45             # seconds: Music Assistant's stop comes 30 s into the pause (a margin for its checks)
HOLD = 4 * 3600             # seconds a screen keeps offering it


class Resumes:
    def __init__(self) -> None:
        self._paused: dict[str, float] = {}     # player -> when it paused
        self._held: dict[str, float] = {}       # player -> when Music Assistant stopped it

    def state(self, entity: str, state: str | None, now: float) -> bool:
        """A player's state now; True when the resumable players changed."""
        if state == "paused":
            self._paused.setdefault(entity, now)
            return self._held.pop(entity, None) is not None
        paused = self._paused.pop(entity, None)
        if state == "idle":
            if entity in self._held:
                return False                    # (an idle player's other changes: still resumable)
            if paused is not None and now - paused <= STOP_AFTER:
                self._held[entity] = now
                return True
            return False
        return self._held.pop(entity, None) is not None

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
        return had
