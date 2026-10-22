"""PAGE HEALTH (2026-10-22): how a screen's page is doing, in Mantel's log, to find out why the house's wall tablets
reload every 15 or 16 minutes (each one at the same millisecond of its cycle, whatever is on screen, the page cut
off mid-download: the WebView's renderer dying, Kiosk Satellite loading its default dashboard again).

The page (web/home.js) sends ``{type: "page_health", event, heap, limit, up, prev, prev_heap, prev_up}`` on its
socket: ``event`` ``load`` once (with how the page before it ended: ``prev`` ``clean`` when it said goodbye
(pagehide), ``died`` when it didn't, ``none`` for the first), then ``beat`` every minute. Numbers only: the JS heap
in MB (Chrome's performance.memory; null elsewhere) and minutes the page has been up. Nothing is answered, stored
or audited; each connection is heard at most once every 50 seconds, and a frame of any other shape is ignored."""
from __future__ import annotations

import logging
import time
from typing import Any

from .connectors import Ctx, ws_handlers

log = logging.getLogger("mantel.page_health")

EVENTS = ("load", "beat")
PREV = ("clean", "died", "none")
EVERY = 50.0


def _num(v: Any) -> float | None:
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1e6 else None


def _who(ctx: Ctx) -> str:
    ident = getattr(ctx, "identity", None)
    device, user = getattr(ident, "device", None), getattr(ident, "user", None)
    if device is not None:
        return f"tablet {device.name!r}"
    if user is not None:
        return f"{user.name or user.username or user.id!r}"
    return "nobody"


async def page_health(ctx: Ctx, msg: dict) -> None:
    if not isinstance(msg, dict) or msg.get("event") not in EVENTS:
        return
    now = time.monotonic()
    last = ctx.state.get("page_health_at")
    if msg["event"] == "beat" and last is not None and now - last < EVERY:
        return
    ctx.state["page_health_at"] = now
    heap, limit, up = _num(msg.get("heap")), _num(msg.get("limit")), _num(msg.get("up"))
    if msg["event"] == "load":
        prev = msg.get("prev") if msg.get("prev") in PREV else "none"
        log.info("page health: %s loaded (the page before it %s%s); heap %s MB of %s", _who(ctx),
                 {"clean": "closed normally", "died": "DIED without closing", "none": "unknown"}[prev],
                 f", after {_num(msg.get('prev_up'))} min at {_num(msg.get('prev_heap'))} MB" if prev == "died" else "",
                 heap, limit)
    else:
        log.info("page health: %s up %s min, heap %s MB of %s", _who(ctx), up, heap, limit)


def register(app) -> None:
    ws_handlers(app)["page_health"] = page_health
