"""The House Timeline's pictures (docs/phase19/HOUSE-TIMELINE.md "Pictures and clips").

Snapshots only: the public Protect API has no clip export (decision 5). A camera's row gets a short **filmstrip**:

* a ring: a picture at once and another RING_OFFSETS later (the visitor steps up);
* a person, vehicle, animal or package: the first DETECTION_OFFSETS[0] after it starts (Protect fires when the object
  enters the zone, often before it is well in view), the next ones only while the detection is still going;
* frames per event is a setting (1 to 3, default 2); motion, doors and locks get none.

A picture comes from where a still does (``connectors/camera_still.py``): a direct camera's own source
(``DirectCameras.still``: Protect's snapshot, paced by the console's bucket), else Home Assistant's ``camera_proxy``
with Mantel's own credential. The notification's own snapshot of the same moment is copied instead of asking the
camera again. It is shrunk in the image worker (``image_work.shrink``: 640 px, JPEG quality 70), at most IN_FLIGHT at
a time, and kept at ``<data_dir>/timeline/<yyyy-mm>/<id>.jpg`` (folders 0700, files 0600, ``O_EXCL``), unsealed like
photos and notification snapshots (decision 13). A camera that gives nothing in SNAP_TIMEOUT_S leaves the row without.

**Budget** (decision 4): 500 MB by default; past it the oldest pictures go first and their rows stay ("Picture not
kept"). Nothing is taken while the alert center has ``disk.low`` up.

**Serving**: ``GET /api/timeline/pic/{id}`` (api.py) answers 404 alike for unknown, expired and refused.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from hk_core.notifications.const import SNAP_TIMEOUT_S

from .core import Timeline

log = logging.getLogger("mantel.timeline")

PIC_ID = re.compile(r"^[0-9a-f]{32}$")
RING_OFFSETS = (0.0, 4.0, 8.0)
DETECTION_OFFSETS = (1.5, 6.0, 12.0)
IN_FLIGHT = 2
EDGE = 640
QUALITY = 70
SHARE_S = 10.0                     # a notification snapshot this recent is the same moment
MAX_INPUT = 8 * 1024 * 1024


class Pictures:
    def __init__(self, app: Any, tl: Timeline, *, fetch: Callable[[str], Awaitable[bytes | None]] | None = None,
                 shrink: Callable[[bytes], Awaitable[bytes]] | None = None) -> None:
        self.app, self.tl = app, tl
        self.wanted: dict[str, tuple[str, str, bool, float]] = {}
        self.slot = asyncio.Semaphore(IN_FLIGHT)
        self.taken = 0
        self.failed = 0
        self.skipped = 0
        self.tasks: set[asyncio.Task] = set()
        self._fetch = fetch
        self._shrink = shrink

    # -- asking -----------------------------------------------------------------------------------------------------
    def want(self, src: str, camera: str, family: str, *, active: bool = False) -> None:
        """A camera's row was queued: its filmstrip starts once the row is written (``after_write``)."""
        if not isinstance(camera, str) or not camera.startswith("camera."):
            return
        self.wanted[src] = (camera, family, active, time.monotonic())
        if len(self.wanted) > 200:                       # a row that never got written (dropped): forgotten
            for k in list(self.wanted)[:50]:
                self.wanted.pop(k, None)

    def after_write(self, rows: list[dict]) -> None:
        for r in rows:
            w = self.wanted.pop(r.get("src"), None)
            if w is None:
                continue
            camera, family, active, t0 = w
            try:
                task = asyncio.get_running_loop().create_task(self.film(r["id"], r["src"], camera, family, active, t0))
            except RuntimeError:
                return
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

    def frames(self) -> int:
        p = self.tl.settings.get("pictures") or {}
        n = p.get("frames") if isinstance(p, dict) else None
        return n if n in (1, 2, 3) else 2

    def budget_bytes(self) -> int:
        p = self.tl.settings.get("pictures") or {}
        mb = p.get("budget_mb") if isinstance(p, dict) else None
        mb = mb if isinstance(mb, int) and not isinstance(mb, bool) and 50 <= mb <= 20000 else 500
        return mb * 1024 * 1024

    def disk_low(self) -> bool:
        alerts = self.app.get("alerts") if hasattr(self.app, "get") else None
        try:
            return bool(alerts is not None and alerts.center.is_up("disk.low"))
        except Exception:  # noqa: BLE001
            return False

    async def film(self, event_id: int, src: str, camera: str, family: str, active: bool, t0: float) -> int:
        offsets = (RING_OFFSETS if family == "doorbell" else DETECTION_OFFSETS)[:self.frames()]
        kept = 0
        for i, off in enumerate(offsets):
            wait = t0 + off - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            if i > 0 and active and self._ended(src):
                break                                    # the detection is over: its first picture is the strip
            if self.disk_low():
                self.skipped += 1
                break
            data = await self.take(camera, first=i == 0)
            if data is None:
                self.failed += 1
                continue
            try:
                self.store(event_id, camera, data)
            except Exception:  # noqa: BLE001
                log.exception("timeline: a picture couldn't be kept")
                self.failed += 1
                continue
            kept += 1
            self.taken += 1
            self.tl.publish([src])
        if kept:
            self.budget()
        return kept

    def _ended(self, src: str) -> bool:
        r = self.tl.db.execute("SELECT ended FROM timeline_events WHERE src = ?", (src,)).fetchone()
        return r is None or r[0] is not None

    # -- taking -----------------------------------------------------------------------------------------------------
    async def take(self, camera: str, first: bool = False) -> bytes | None:
        async with self.slot:
            raw = self._shared(camera) if first else None
            if raw is None:
                try:
                    raw = await asyncio.wait_for(self.fetch(camera), SNAP_TIMEOUT_S)
                except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001 -- no picture, the row stays
                    log.info("timeline: no picture from %s (%s)", camera, type(exc).__name__)
                    return None
            if not raw or len(raw) > MAX_INPUT:
                return None
            try:
                return await self.shrink(raw)
            except Exception as exc:  # noqa: BLE001
                log.info("timeline: a picture from %s couldn't be read (%s)", camera, type(exc).__name__)
                return None

    def _shared(self, camera: str) -> bytes | None:
        """The notification's own snapshot of this camera, taken a moment ago (notify_snaps.SnapStore)."""
        host = self.app.get("features") if hasattr(self.app, "get") else None
        snaps = getattr(host, "snaps", None)
        if snaps is None:
            return None
        now = snaps.clock()
        for sid, snap in list(snaps.items.items())[::-1]:
            if snap.camera == camera and now - (snap.until - snaps.ttl) <= SHARE_S:
                return snaps.read(sid)
        return None

    async def fetch(self, camera: str) -> bytes | None:
        if self._fetch is not None:
            return await self._fetch(camera)
        direct = self.app.get("cameras_direct")
        if direct is not None and direct.serves(camera) is not None:
            body, _ctype = await direct.still(camera)
            return body
        from ..connectors.camera_still import read_image
        conns = self.app.get("connections")
        token = conns.ha_token() if conns is not None else None
        cfg = self.app["cfg"]
        if not token or not getattr(cfg, "ha_url", ""):
            return None
        body, _ctype = await read_image(self.app, f"{cfg.ha_url.rstrip('/')}/api/camera_proxy/{camera}", {}, token,
                                        f"timeline picture for {camera}")
        return body

    async def shrink(self, raw: bytes) -> bytes:
        if self._shrink is not None:
            return await self._shrink(raw)
        from ..cameras import image_work, imaging
        return await imaging.run(image_work.shrink, raw, EDGE, QUALITY)

    # -- keeping ----------------------------------------------------------------------------------------------------
    def store(self, event_id: int, camera: str, data: bytes) -> str:
        pid = secrets.token_hex(16)
        at = self.tl.clock()
        path = self.tl.pic_path(pid, at)
        if path is not None:
            for folder in (path.parent.parent, path.parent):
                folder.mkdir(parents=True, exist_ok=True)
                try:
                    os.chmod(folder, 0o700)
                except OSError:
                    pass
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
        try:
            with self.tl.db:
                self.tl.db.execute("INSERT INTO timeline_pics (id, event, camera, at, size) VALUES (?,?,?,?,?)",
                                   (pid, int(event_id), camera, at, len(data)))
        except Exception:
            if path is not None:
                path.unlink(missing_ok=True)
            raise
        return pid

    def path_of(self, pid: str) -> Path | None:
        if not isinstance(pid, str) or not PIC_ID.match(pid):
            return None
        r = self.tl.db.execute("SELECT at FROM timeline_pics WHERE id = ?", (pid,)).fetchone()
        return self.tl.pic_path(pid, float(r[0])) if r is not None else None

    def read(self, pid: str) -> bytes | None:
        p = self.path_of(pid)
        if p is None:
            return None
        try:
            return p.read_bytes()
        except OSError:
            return None

    def budget(self) -> int:
        """The oldest pictures past the budget go, files first; their rows stay. How many went."""
        limit = self.budget_bytes()
        total = int(self.tl.db.execute("SELECT COALESCE(SUM(size), 0) FROM timeline_pics").fetchone()[0])
        if total <= limit:
            return 0
        gone: list[tuple[str, float]] = []
        for pid, at, size in self.tl.db.execute("SELECT id, at, size FROM timeline_pics ORDER BY at, id"):
            if total <= limit:
                break
            gone.append((pid, at))
            total -= int(size)
        self.tl.delete_files(gone)
        with self.tl.db:
            for i in range(0, len(gone), 400):
                part = [g[0] for g in gone[i:i + 400]]
                self.tl.db.execute(f"DELETE FROM timeline_pics WHERE id IN ({','.join('?' * len(part))})", part)
        log.info("timeline: %d pictures past the budget deleted", len(gone))
        return len(gone)

    def status(self) -> dict:
        r = self.tl.db.execute("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM timeline_pics").fetchone()
        return {"kept": int(r[0]), "bytes": int(r[1]), "budget_bytes": self.budget_bytes(), "taken": self.taken,
                "failed": self.failed, "skipped": self.skipped}

    async def stop(self) -> None:
        for t in list(self.tasks):
            t.cancel()
        for t in list(self.tasks):
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass


def register(app: Any, tl: Timeline) -> Pictures:
    pics = Pictures(app, tl)
    app["timeline_pictures"] = pics
    tl.after_write.append(pics.after_write)

    async def stop(_app: Any) -> None:
        await pics.stop()
    app.on_cleanup.append(stop)
    return pics
