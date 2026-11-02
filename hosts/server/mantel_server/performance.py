"""PERFORMANCE (2026-10-26): what Mantel Settings -> About -> Performance shows the people who manage the house.

``GET /api/performance`` (an Owner or Admin, never a session at a wall tablet) answers ``{now, screens, server}``:

``screens``
    one row per tablet or person whose page told Mantel how it is doing in the last 24 hours (page_health.RING): when
    the page has been up since, its JS heap (MB, if the browser reports it), the sockets it had to open again, the
    registry refreshes, and its slowest start (time to first draw, ms), ``page`` being ``home`` or ``settings``; and,
    from the baseline (2026-10-29): ``first_draw_ms`` (the newest), ``download_bytes`` and ``download_files`` (what the
    page had fetched by its first screen), ``fps`` (over 5 idle seconds) and ``device`` (platform, memory, cores,
    screen); a tablet's last four also survive a restart (page_health.TABLETS);
``server``
    ``fan_out``: how long the hub took to build and send each screen's diff (``view.flush`` and the send), p50 and p95
    over the last hour; ``ha_events_per_min``: the house's state changes, over the last five minutes;
    ``connected_screens``: the sockets with a subscription now; ``tick``: how long the minute policy tick took
    (``last_ms`` and ``max_ms`` over the last 24 hours, ``samples``); ``settings_history``: its ``rows`` and ``bytes``
    (body and diff), worked out at most every 10 minutes, with ``at`` saying when.

``GET /api/performance/tablets`` (2026-10-29; the same people) answers ``{tablets}``: each enrolled wall tablet's
``name``, the ``screens`` it shows (where its frame rate was drawn, then where it opens), its latest ``fps`` with
``fps_screen``, ``fps_style``, ``fps_sig`` (the style and the sky and camera settings it was drawn with, a short
word; null from a sample taken before the ladder) and ``fps_at``, and its ``platform``, ``memory_gb`` and ``cores``:
what HK Settings recommends a lighter look from (a screen's Appearance; mantel-settings.js ``tabletHealth``). Each
row also says (2026-11-02) whether the tablet's page is a ``secure`` context (true, false, or null before it has said),
for the note HK Settings' camera pop-ups show where talking at the door needs HTTPS (page_health.py SECURE CONTEXT).

Numbers only, in memory only, nothing audited (a read)."""
from __future__ import annotations

import logging
import math
import time
from collections import deque
from typing import Any

from aiohttp import web

from . import page_health
from .guards import guard

log = logging.getLogger("mantel.performance")

PATH = "/api/performance"
TABLETS_PATH = "/api/performance/tablets"
FANOUT_MAX = 2000        # fan-out samples kept (an hour of a busy house is fewer)
FANOUT_KEEP = 3600.0     # p50 and p95 cover this long
EVENT_WINDOW = 300.0     # the HA event rate covers this long
TICK_MAX = 1500          # policy ticks kept: one a minute for 24 hours is 1440
TICK_KEEP = 86400.0      # the tick's last and max cover this long
HISTORY_EVERY = 600.0    # the settings history's size is counted at most this often


def _percentile(sorted_ms: list[float], p: float) -> float:
    """Nearest rank: the smallest sample that at least p percent of them are not above."""
    return sorted_ms[max(0, math.ceil(p / 100 * len(sorted_ms)) - 1)]


class Stats:
    """The server's own numbers: bounded, in memory."""

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self._fan: deque[tuple[float, float]] = deque(maxlen=FANOUT_MAX)
        self._ev: deque[list[float]] = deque(maxlen=int(EVENT_WINDOW) + 8)     # [second, changes]
        self._tick: deque[tuple[float, float]] = deque(maxlen=TICK_MAX)
        self._history: tuple[float, dict] | None = None

    def reset(self) -> None:
        self._fan.clear()
        self._ev.clear()
        self._tick.clear()
        self._history = None

    def fanout(self, ms: float, now: float | None = None) -> None:
        self._fan.append((self.clock() if now is None else now, float(ms)))

    def fan_out(self, now: float | None = None) -> dict[str, Any]:
        now = self.clock() if now is None else now
        ms = sorted(v for t, v in self._fan if t >= now - FANOUT_KEEP)
        if not ms:
            return {"samples": 0, "p50_ms": None, "p95_ms": None}
        return {"samples": len(ms), "p50_ms": round(_percentile(ms, 50), 2), "p95_ms": round(_percentile(ms, 95), 2)}

    def tick(self, ms: float, now: float | None = None) -> None:
        """The minute policy tick (server.policy_tick) took ``ms``."""
        self._tick.append((self.clock() if now is None else now, float(ms)))

    def tick_times(self, now: float | None = None) -> dict[str, Any]:
        now = self.clock() if now is None else now
        ms = [v for t, v in self._tick if t >= now - TICK_KEEP]
        if not ms:
            return {"samples": 0, "last_ms": None, "max_ms": None}
        return {"samples": len(ms), "last_ms": round(ms[-1], 2), "max_ms": round(max(ms), 2)}

    def history_size(self, conn, now: float | None = None) -> dict[str, Any]:
        """Rows and bytes (body and diff) of settings_history, counted at most every HISTORY_EVERY seconds."""
        now = self.clock() if now is None else now
        if self._history is not None and now - self._history[0] < HISTORY_EVERY:
            return self._history[1]
        if conn is None:
            return {"rows": None, "bytes": None, "at": None}
        row = conn.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(body AS BLOB)) + LENGTH(CAST(diff AS BLOB))), 0) "
                           "FROM settings_history").fetchone()
        got = {"rows": int(row[0]), "bytes": int(row[1]), "at": now}
        self._history = (now, got)
        return got

    def events(self, n: int, now: float | None = None) -> None:
        """``n`` state changes came from Home Assistant."""
        if n <= 0:
            return
        sec = float(int(self.clock() if now is None else now))
        if self._ev and self._ev[-1][0] == sec:
            self._ev[-1][1] += n
        else:
            self._ev.append([sec, float(n)])

    def event_rate(self, now: float | None = None) -> float:
        now = self.clock() if now is None else now
        total = sum(n for sec, n in self._ev if sec >= now - EVENT_WINDOW)
        return round(total / (EVENT_WINDOW / 60), 1)


STATS = Stats()


@guard("manager")
async def api_performance(request: web.Request) -> web.Response:
    hub = request.app.get("hub")
    now = time.time()
    screens = sum(1 for s in getattr(hub, "sessions", ()) if getattr(s, "subscribed", False))
    return web.json_response({
        "now": now,
        "screens": page_health.RING.summary(now),
        "server": {"fan_out": STATS.fan_out(now), "ha_events_per_min": STATS.event_rate(now), "connected_screens": screens,
                   "tick": STATS.tick_times(now), "settings_history": STATS.history_size(getattr(request.app.get("store"), "db", None), now)},
    }, headers={"Cache-Control": "no-store"})


def log_summary(app) -> None:
    """One line for the log: the minute tick's last and longest time, and the settings history's size."""
    tick = STATS.tick_times()
    hist = STATS.history_size(getattr(app.get("store"), "db", None))
    mb = None if hist.get("bytes") is None else round(hist["bytes"] / 1e6, 1)
    log.info("performance: minute tick %s ms (longest %s ms in 24 h); settings history %s versions, %s MB",
             tick["last_ms"], tick["max_ms"], hist.get("rows"), mb)


def tablets(app: web.Application) -> list[dict]:
    """Each enrolled wall tablet's latest frame rate and device (page_health.TABLETS, which outlives a restart): the
    screens it shows (the one its frame rate was drawn on, then the one it opens on) and the style it was drawn with.
    A revoked or forgotten tablet is left out."""
    from . import default_screens
    from .sessions import Device
    mgr = app.get("devices")
    out = []
    secure = {r["id"]: r["secure"] for r in page_health.RING.secure_reports()}
    for device_id, kept in sorted(page_health.TABLETS.latest.items()):
        row = mgr.get(device_id) if mgr is not None else None
        if row is None or row["revoked"] is not None:
            continue
        try:
            start = default_screens.tablet_screen(app, Device(row["id"], row["name"], row["role"], row["room"]))
        except Exception:  # noqa: BLE001 -- no settings to read: the screen its frame rate names still is
            start = None
        dev = kept.get("device") or {}
        out.append({"name": row["name"], "screens": list(dict.fromkeys(s for s in (kept.get("fps_screen"), start) if s)),
                    "fps": kept.get("fps"), "fps_screen": kept.get("fps_screen") or None,
                    "fps_style": kept.get("fps_style") or None, "fps_sig": kept.get("fps_sig") or None, "fps_at": kept.get("fps_at"),
                    "platform": dev.get("platform"), "memory_gb": dev.get("memory_gb"), "cores": dev.get("cores"),
                    "secure": secure.get(device_id)})
    return out


@guard("manager")
async def api_tablets(request: web.Request) -> web.Response:
    return web.json_response({"tablets": tablets(request.app)}, headers={"Cache-Control": "no-store"})


def register(app: web.Application) -> None:
    app.router.add_get(PATH, api_performance)
    app.router.add_get(TABLETS_PATH, api_tablets)
