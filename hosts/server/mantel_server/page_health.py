"""PAGE HEALTH (2026-10-22): how a screen's page is doing, in Mantel's log, to find out why the house's wall tablets
reload every 15 or 16 minutes (each one at the same millisecond of its cycle, whatever is on screen, the page cut
off mid-download: the WebView's renderer dying, Kiosk Satellite loading its default dashboard again).

The page (web/shim/page-health.js) sends ``{type: "page_health", event, heap, limit, up, prev, prev_heap, prev_up}`` on
its socket: ``event`` ``load`` once (with how the page before it ended: ``prev`` ``clean`` when it said goodbye
(pagehide), ``died`` when it didn't, ``none`` for the first), then ``beat`` every minute. Numbers only: the JS heap
in MB (Chrome's performance.memory; null elsewhere) and minutes the page has been up. Nothing is answered or
audited; each connection is heard at most once every 50 seconds, and a frame of any other shape is ignored.

PERFORMANCE (2026-10-26): the frames also say which ``page`` this is (``home``, ``settings``), the ``reconnects`` since
it loaded, its ``registry_refreshes``, and, in one ``draw`` frame, the ``first_draw`` time in ms. Besides the log line,
each frame goes into RING: the last 24 hours of samples per tablet or person, in memory only (no database), bounded
(PER_SCREEN samples each, SCREENS screens), which GET /api/performance (performance.py) summarises for the managers."""
from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any

from .connectors import Ctx, ws_handlers

log = logging.getLogger("mantel.page_health")

EVENTS = ("load", "beat", "draw")
PREV = ("clean", "died", "none")
PAGES = ("home", "settings")
EVERY = 50.0
KEEP = 24 * 3600.0       # how long a sample is kept
PER_SCREEN = 1600        # samples a screen keeps: a beat a minute for 24 hours is 1440, and the loads and draws
SCREENS = 200            # screens kept (the one heard from longest ago goes first)


def _num(v: Any) -> float | None:
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1e6 else None


def _count(v: Any) -> int | None:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1e9 else None


class Ring:
    """The last 24 hours of what each screen's page said, per tablet or person; bounded, in memory only."""

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self.screens: dict[str, dict] = {}

    def reset(self) -> None:
        self.screens.clear()

    @staticmethod
    def _key(ctx: Ctx) -> tuple[str, str, str] | None:
        ident = getattr(ctx, "identity", None)
        device, user = getattr(ident, "device", None), getattr(ident, "user", None)
        if device is not None:
            return "tablet", f"tablet:{getattr(device, 'id', None) or device.name}", str(device.name)
        if user is not None:
            return "person", f"person:{user.id}", str(user.name or user.username or user.id)
        return None

    def add(self, ctx: Ctx, msg: dict, now: float | None = None) -> None:
        who = self._key(ctx)
        if who is None:
            return
        now = self.clock() if now is None else now
        kind, key, name = who
        e = self.screens.get(key)
        if e is None:
            if len(self.screens) >= SCREENS:
                del self.screens[min(self.screens, key=lambda k: self.screens[k]["last"])]
            e = self.screens[key] = {"kind": kind, "name": name, "last": now, "samples": deque(maxlen=PER_SCREEN)}
        e["name"], e["last"] = name, now
        up = _num(msg.get("up"))
        e["samples"].append({
            "t": now, "event": msg.get("event"), "page": msg.get("page") if msg.get("page") in PAGES else None,
            "heap": _num(msg.get("heap")), "first_draw": _count(msg.get("first_draw")),
            "reconnects": _count(msg.get("reconnects")), "refreshes": _count(msg.get("registry_refreshes")),
            "since": now if msg.get("event") == "load" else (now - up * 60 if up is not None else None)})
        self._prune(e, now)

    @staticmethod
    def _prune(e: dict, now: float) -> None:
        s = e["samples"]
        while s and s[0]["t"] < now - KEEP:
            s.popleft()

    def sample_count(self, ctx: Ctx) -> int:
        who = self._key(ctx)
        e = self.screens.get(who[1]) if who else None
        return len(e["samples"]) if e else 0

    def summary(self, now: float | None = None) -> list[dict]:
        """One row per screen heard from in the last 24 hours: its newest numbers, and its slowest start."""
        now = self.clock() if now is None else now
        rows = []
        for key in list(self.screens):
            e = self.screens[key]
            self._prune(e, now)
            s = e["samples"]
            if not s:
                del self.screens[key]
                continue

            def newest(field: str):
                return next((x[field] for x in reversed(s) if x[field] is not None), None)

            draws = [x["first_draw"] for x in s if x["first_draw"] is not None]
            rows.append({"name": e["name"], "kind": e["kind"], "page": newest("page"), "up_since": newest("since"),
                         "memory_mb": newest("heap"), "reconnects": newest("reconnects"),
                         "registry_refreshes": newest("refreshes"), "slowest_start_ms": max(draws) if draws else None,
                         "last_seen": s[-1]["t"]})
        return sorted(rows, key=lambda r: (r["kind"] != "tablet", r["name"].lower()))


RING = Ring()


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
    if msg["event"] == "draw":                  # once a connection
        if not ctx.state.get("page_health_drawn"):
            ctx.state["page_health_drawn"] = True
            RING.add(ctx, msg)
            log.info("page health: %s drew its first screen after %s ms", _who(ctx), _count(msg.get("first_draw")))
        return
    now = time.monotonic()
    last = ctx.state.get("page_health_at")
    if msg["event"] == "beat" and last is not None and now - last < EVERY:
        return
    ctx.state["page_health_at"] = now
    RING.add(ctx, msg)
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
