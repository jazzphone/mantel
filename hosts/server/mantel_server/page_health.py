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
(PER_SCREEN samples each, SCREENS screens), which GET /api/performance (performance.py) summarises for the managers.

BASELINE (2026-10-29, docs/development/Performance-baseline.md): the ``load`` frame also says what device this is
(``platform``, ``memory_gb``, ``cores``, ``sw``, ``sh``, ``dpr``), the ``draw`` frame how much the page had downloaded
by its first screen (``dl_bytes``, ``dl_files``), and a new ``fps`` frame (about 20 seconds after load, then hourly)
the frame rate over 5 idle seconds. A tablet's latest device, frame rate, download and first draw are also kept in the
``tablet_health`` table (migration 0026, TABLETS below) so they outlive a restart: written when a value changes, at
most every 10 minutes per tablet."""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from collections import deque
from typing import Any

from .connectors import Ctx, ws_handlers

log = logging.getLogger("mantel.page_health")

EVENTS = ("load", "beat", "draw", "fps")
PREV = ("clean", "died", "none")
PAGES = ("home", "settings")
PLATFORMS = ("iPad", "iPhone", "Android", "Mac", "Windows", "Linux", "Other")
EVERY = 50.0
KEEP = 24 * 3600.0       # how long a sample is kept
PER_SCREEN = 1600        # samples a screen keeps: a beat a minute for 24 hours is 1440, and the loads and draws
SCREENS = 200            # screens kept (the one heard from longest ago goes first)
WRITE_EVERY = 600.0      # a tablet's stored summary is written at most this often


def _num(v: Any) -> float | None:
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1e6 else None


def _count(v: Any) -> int | None:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1e9 else None


def _fps(v: Any) -> float | None:
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1000 else None


def _device(msg: dict) -> dict | None:
    """What a ``load`` frame says the device is; None when it says nothing usable."""
    platform = msg.get("platform")
    if platform not in PLATFORMS:
        return None
    return {"platform": platform, "memory_gb": _num(msg.get("memory_gb")), "cores": _count(msg.get("cores")),
            "screen_w": _count(msg.get("sw")), "screen_h": _count(msg.get("sh")), "dpr": _num(msg.get("dpr"))}


class TabletHealth:
    """Each tablet's latest device, frame rate, download and first draw, in the ``tablet_health`` table (migration
    0026) so Mantel still has them after a restart. Unbound (no connection: a test, or before ``register``) it is
    memory only. The table is written when a value changed, and then at most every WRITE_EVERY seconds per tablet."""

    def __init__(self) -> None:
        self.conn: sqlite3.Connection | None = None
        self.latest: dict[str, dict] = {}
        self._saved: dict[str, tuple[float, str]] = {}      # device id -> (when written, what)

    def reset(self) -> None:
        self.conn = None
        self.latest.clear()
        self._saved.clear()

    def bind(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.latest.clear()
        self._saved.clear()
        for row in conn.execute("SELECT device_id, updated, json FROM tablet_health"):
            try:
                self.latest[row[0]] = json.loads(row[2])
                self._saved[row[0]] = (float(row[1]), row[2])
            except ValueError:
                continue

    def get(self, device_id: str) -> dict:
        return self.latest.get(device_id) or {}

    def note(self, device_id: str, name: str, now: float, **fields: Any) -> None:
        """Fold what a frame said (the fields it did not say are left as they were) and write it if due."""
        cur = self.latest.setdefault(device_id, {})
        cur["name"] = name
        for k, v in fields.items():
            if v is not None:
                cur[k] = v
        if self.conn is None:
            return
        text = json.dumps(cur, sort_keys=True, separators=(",", ":"))
        at, was = self._saved.get(device_id, (None, None))
        if text == was or (at is not None and now - at < WRITE_EVERY):
            return
        try:
            with self.conn:
                self.conn.execute("INSERT INTO tablet_health (device_id, updated, json) VALUES (?,?,?) "
                                  "ON CONFLICT(device_id) DO UPDATE SET updated=excluded.updated, json=excluded.json",
                                  (device_id, now, text))
            self._saved[device_id] = (now, text)
        except sqlite3.Error:
            log.exception("page health: could not keep %s's summary", name)


TABLETS = TabletHealth()


class Ring:
    """The last 24 hours of what each screen's page said, per tablet or person; bounded, in memory only."""

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self.screens: dict[str, dict] = {}

    def reset(self) -> None:
        self.screens.clear()
        TABLETS.reset()

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
        s = {"t": now, "event": msg.get("event"), "page": msg.get("page") if msg.get("page") in PAGES else None,
             "heap": _num(msg.get("heap")), "first_draw": _count(msg.get("first_draw")),
             "reconnects": _count(msg.get("reconnects")), "refreshes": _count(msg.get("registry_refreshes")),
             "since": now if msg.get("event") == "load" else (now - up * 60 if up is not None else None),
             "fps": _fps(msg.get("fps")) if msg.get("event") == "fps" else None,
             "dl_bytes": _count(msg.get("dl_bytes")), "dl_files": _count(msg.get("dl_files")),
             "device": _device(msg) if msg.get("event") == "load" else None}
        e["samples"].append(s)
        self._prune(e, now)
        if kind == "tablet" and msg.get("page") in (None, "home") and any(
                s[f] is not None for f in ("fps", "dl_bytes", "device", "first_draw")):
            TABLETS.note(key.split(":", 1)[1], name, now, device=s["device"], fps=s["fps"], first_draw_ms=s["first_draw"],
                         download_bytes=s["dl_bytes"], download_files=s["dl_files"])

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
            kept = TABLETS.get(key.split(":", 1)[1]) if e["kind"] == "tablet" else {}      # what a restart has not lost

            def newest_or_kept(field: str, name: str):
                v = newest(field)
                return v if v is not None else kept.get(name)

            rows.append({"name": e["name"], "kind": e["kind"], "page": newest("page"), "up_since": newest("since"),
                         "memory_mb": newest("heap"), "reconnects": newest("reconnects"),
                         "registry_refreshes": newest("refreshes"), "slowest_start_ms": max(draws) if draws else None,
                         "first_draw_ms": newest_or_kept("first_draw", "first_draw_ms"),
                         "download_bytes": newest_or_kept("dl_bytes", "download_bytes"),
                         "download_files": newest_or_kept("dl_files", "download_files"),
                         "fps": newest_or_kept("fps", "fps"), "device": newest_or_kept("device", "device"),
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
            log.info("page health: %s drew its first screen after %s ms, %s bytes in %s files", _who(ctx),
                     _count(msg.get("first_draw")), _count(msg.get("dl_bytes")), _count(msg.get("dl_files")))
        return
    now = time.monotonic()
    if msg["event"] == "fps":                   # about once an hour; not more than one in 50 seconds
        if now - ctx.state.get("page_health_fps_at", -EVERY) >= EVERY:
            ctx.state["page_health_fps_at"] = now
            RING.add(ctx, msg)
            log.info("page health: %s drew %s frames a second", _who(ctx), _fps(msg.get("fps")))
        return
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
    store = app.get("store")
    if store is not None:
        TABLETS.bind(store.db)           # the tablets' latest summaries, from before the restart
    ws_handlers(app)["page_health"] = page_health
