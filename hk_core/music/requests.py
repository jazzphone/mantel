"""A music request that outlasted its link, and how it ended (2026-11-26).

A music request from a Home Assistant screen goes to Mantel Server over the link, which answers within a budget (8 s,
under Home Assistant's own 10). A slow one -- 18 speakers starting right after Music Assistant restarted -- is answered
``{ok, pending, request}`` and runs on to its end in the background (``Linked._music``). The screen that asked must not
read that as "it played": it shows "Starting..." / "Moving..." until the real outcome arrives, then the failure with its
message, or that a newer request took over.

The outcome travels on the feed the page already follows (``hk_music/subscribe``, its ``requests``), keyed by the
``request`` id the pending answer carried:

    {"ok": true}                          it played / moved / stopped
    {"ok": false, "message": "..."}       it did not, and why
    {"ok": true, "superseded": true}      a newer request for those rooms took over: show nothing of this one

A page that asked tells its own newer requests apart (hkMusic's claims, hk-base-music.js); the engine says the same of
another screen's (``superseded``).
"""
from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable, Collection, Mapping
from typing import Any

KEEP_S = 600.0        # an outcome is kept this long, for a page that was away (a reconnect asks the feed again)
KEEP_N = 40           # ...and at most this many
MESSAGE_MAX = 200


def outcome_of(result: Any = None, error: BaseException | None = None) -> dict[str, Any]:
    """The outcome of a finished request, in the few fields a page reads: ``result`` is the engine's answer
    (``{ok, leader?, message?, superseded?}``), ``error`` what was raised instead."""
    if error is not None:
        text = getattr(error, "message", None) or str(error) or "The music request failed."
        return {"ok": False, "message": str(text)[:MESSAGE_MAX]}
    if not isinstance(result, Mapping):
        return {"ok": True}
    out: dict[str, Any] = {"ok": result.get("ok") is not False}
    if isinstance(result.get("message"), str) and result["message"]:
        out["message"] = result["message"][:MESSAGE_MAX]
    if result.get("superseded") is True:
        out["superseded"] = True
    if isinstance(result.get("leader"), str):
        out["leader"] = result["leader"]
    return out


class Outcomes:
    """The outcomes of the requests answered "still going", by their ids, newest last."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._rows: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()

    def note(self, request: str, outcome: Mapping[str, Any]) -> None:
        self._rows.pop(request, None)
        self._rows[request] = (self._clock(), dict(outcome))
        while len(self._rows) > KEEP_N:
            self._rows.popitem(last=False)

    def view(self, visible: Collection[str]) -> dict[str, dict[str, Any]]:
        """What a person's feed carries: the kept outcomes, a ``leader`` only when it is a speaker they may see."""
        now = self._clock()
        for k in [k for k, (at, _) in self._rows.items() if now - at > KEEP_S]:
            del self._rows[k]
        out: dict[str, dict[str, Any]] = {}
        for k, (_, o) in self._rows.items():
            out[k] = {f: v for f, v in o.items() if f != "leader" or v in visible}
        return out
