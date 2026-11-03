"""The House Timeline for assistants (docs/phase19/HOUSE-TIMELINE.md "MCP"): read scope, run as the caller's own
principal, so an assistant sees exactly what that person sees in the Timeline (no names for a wall tablet's
principal, no System or Refused rows for an Adult, nothing of a person who keeps their arrivals private). Never
pictures: rows only. "Who unlocked the back door at 2 AM?" is ``family: lock, q: back door, since, until``."""
from __future__ import annotations

from ..dispatch import ToolError
from . import Tool

FAMILIES = ["doors", "locks", "garage", "alarm", "people", "doorbell", "cameras", "safety", "system",
            "door", "window", "lock", "arrival", "detection", "motion", "refused"]


def _viewer(caller):
    from ...timeline.api import Viewer
    if caller.app.get("timeline") is None:
        raise ToolError("unavailable", "the Timeline is not ready")
    v = Viewer(caller.app, caller.principal)
    if not v.feature():
        raise ToolError("forbidden", "the Timeline isn't one of this person's pages")
    return v


def _plain(e: dict) -> dict:
    """A row for an assistant: its words, never a picture or its address."""
    keep = ("id", "at", "ended", "family", "kind", "level", "title", "entity", "area_name", "late", "count", "zone")
    out = {k: e[k] for k in keep if e.get(k) is not None}
    if e.get("who"):
        out["who"] = {k: v for k, v in e["who"].items() if v not in (None, False)}
    if e.get("pics"):
        out["pictures"] = len(e["pics"])
    return out


async def timeline_find(caller, args: dict) -> dict:
    from ...timeline.api import BadQuery, find
    v = _viewer(caller)
    q = {k: args[k] for k in ("family", "q", "since", "until", "area", "camera", "actor", "before", "limit")
         if args.get(k) not in (None, "")}
    if isinstance(q.get("family"), list):
        q["family"] = ",".join(q["family"])
    try:
        got = find(caller.app, v, q, caller.app["clock"]())
    except BadQuery as exc:
        raise ToolError(exc.code, {"forbidden": "names aren't this person's to see",
                                   "search_unavailable": "a wall tablet's limited view has no search"}
                        .get(exc.code, "that filter isn't valid")) from None
    return {"events": [_plain(e) for e in got["events"]], "next_before": got["next_before"],
            "limited": got["limited"]}


async def timeline_digest(caller, args: dict) -> dict:
    from ...timeline import digest
    v = _viewer(caller)
    got = digest.summary(caller.app, v, args.get("window") or "overnight", caller.app["clock"]())
    return {k: got.get(k) for k in ("window", "label", "since", "until", "title", "lines", "quiet", "counts")}


TOOLS = [
    Tool("timeline_find", "Find in the House Timeline",
         "What happened at the house, newest first, as this person may see it in the Timeline: doors, locks, the "
         "garage, the alarm, arrivals, the doorbell, camera detections, safety, and for Owners and Admins Mantel's "
         "own alerts and refused commands. Filter by `family` (doors, locks, garage, alarm, people, doorbell, "
         "cameras, safety, system), words (`q`, e.g. \"back door\"), a time window (`since`/`until`, epoch "
         "seconds), `area`, `camera` (a camera entity), `actor` (a person's id, when names are theirs to see). "
         "Page with `before` (the `next_before` of the last answer). No pictures.",
         {"family": {"type": "string", "maxLength": 120},
          "q": {"type": "string", "maxLength": 200},
          "since": {"type": "number"}, "until": {"type": "number"},
          "area": {"type": "string", "maxLength": 64}, "camera": {"type": "string", "maxLength": 255},
          "actor": {"type": "string", "maxLength": 64},
          "before": {"type": "integer", "minimum": 1},
          "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}},
         timeline_find),
    Tool("timeline_digest", "House Timeline summary",
         "The morning digest's words for a window (`overnight`, the default: from the digest's start to its time; "
         "`today`; `24h`), as this person's own version: what was locked all night, the garage, package deliveries, "
         "detections, the alarm.",
         {"window": {"type": "string", "enum": ["overnight", "today", "24h"], "default": "overnight"}},
         timeline_digest),
]
