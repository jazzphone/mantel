"""The morning digest (docs/phase19/HOUSE-TIMELINE.md "The morning digest"). Slice 19.6 fills this in."""
from __future__ import annotations

from typing import Any


def summary(app: Any, viewer: Any, window: str, now: float) -> dict:
    from .api import find, window_of
    start, end, label = window_of(app, window, now)
    got = find(app, viewer, {"since": start, "until": end, "limit": 100}, now)
    counts: dict[str, int] = {}
    for e in got["events"]:
        counts[e["family"]] = counts.get(e["family"], 0) + 1
    return {"window": window, "label": label, "since": start, "until": end, "counts": counts, "lines": [],
            "events": got["events"][:12]}


async def send_test(app: Any) -> int:
    return 0


def register(app: Any, tl: Any) -> None:
    return None
