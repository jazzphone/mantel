"""Notification snapshots on Mantel (docs/phase4/MANTEL-FEATURES.md "Phase 4 ports").

When a notification names a camera (an item's Snapshot, a Cameras category's own camera), Home
Assistant's hk_frontend takes that camera's picture the moment it goes off (snaps.py), keeps it ten
minutes and serves it to the screens, so every screen shows the same moment. Mantel does the same with
its own pieces, and no HA token ever reaches a page:

* **Taken** by Mantel through its own HA credential: ``GET <ha>/api/camera_proxy/<camera>`` (the call
  ``connectors/camera_still.py`` makes for a still), at most SNAP_TIMEOUT_S, at most MAX_BYTES, an image
  answer only. A camera that gives nothing in time: the notification goes without (``snap`` None), as HA's.
* **Kept** in Mantel's data folder (``<data_dir>/notify-snaps``, folder 0700, files 0600): the picture and
  a small record (camera, type, until). Kept SNAP_TTL_S, at most SNAP_MAX (the oldest go first), the
  same retention as HA's; what has run out is deleted at the next put, on the features' tick and at
  start. Without a data folder (tests) they are kept in memory only.
* **Referenced** by the events feed: the notification's ``snap`` is the picture's id (32 hex characters,
  random, unguessable), as HA's payload carries its own id.
* **Signed for a page** with HK's own read, ``hk_notify/snap/sign {snaps: [id]}`` (``read_routes``):
  ``{signed: {id: "/api/notify/snap/<id>"}}``, only for a picture of a camera the person may see as a
  still (``Authz.may_still``: ``view`` the camera, camera live view allowed,
  the door's camera rules). The page's adapter puts its own prefix in front (HA App mode).
* **Served** at ``GET /api/notify/snap/<id>`` to a signed-in person, decided again with the same rule.
  Unknown, run out and refused all answer 404 (one answer, nothing to probe).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from aiohttp import web

from hk_core.notifications.const import SNAP_MAX, SNAP_TIMEOUT_S, SNAP_TTL_S

log = logging.getLogger("mantel.notify_snaps")

PATH = "/api/notify/snap/{snap_id}"
SIGN_READ = "hk_notify/snap/sign"
SNAP_ID = re.compile(r"^[0-9a-f]{32}$")
CAMERA_ID = re.compile(r"^camera\.[a-z0-9_]+$")
IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
ALIASES = {"image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg"}     # what some cameras (HA's demo) answer
MAX_BYTES = 8 * 1024 * 1024
FOLDER = "notify-snaps"


def path_of(sid: str) -> str:
    return PATH.replace("{snap_id}", sid)


@dataclass(frozen=True)
class Snap:
    camera: str
    ctype: str
    until: float          # epoch s
    size: int


class SnapStore:
    """id -> the picture and its record, on disk (``folder``) or in memory (``folder`` None)."""

    def __init__(self, folder: Path | None = None, *, ttl: float = SNAP_TTL_S, most: int = SNAP_MAX,
                 clock: Callable[[], float] = time.time) -> None:
        self.folder = Path(folder).expanduser() if folder is not None else None
        self.ttl, self.most, self.clock = float(ttl), int(most), clock
        self.items: dict[str, Snap] = {}
        self._mem: dict[str, bytes] = {}
        self.taken = 0
        self.failed = 0
        if self.folder is not None:
            self._load()

    # -- disk ---------------------------------------------------------------------------------------
    def _files(self, sid: str) -> tuple[Path, Path]:
        assert self.folder is not None and SNAP_ID.match(sid)
        return self.folder / f"{sid}.img", self.folder / f"{sid}.json"

    def _ensure(self) -> None:
        assert self.folder is not None
        self.folder.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.folder, 0o700)
        except OSError:
            pass

    def _load(self) -> None:
        """What a restart finds: every record still current; the rest (and any stray file) deleted."""
        if self.folder is None or not self.folder.is_dir():
            return
        now = self.clock()
        for rec in self.folder.glob("*.json"):
            sid = rec.stem
            try:
                meta = json.loads(rec.read_text())
                img = self.folder / f"{sid}.img"
                snap = Snap(str(meta["camera"]), str(meta["ctype"]), float(meta["until"]), img.stat().st_size)
                if not SNAP_ID.match(sid) or not CAMERA_ID.match(snap.camera) or snap.ctype not in IMAGE_TYPES:
                    raise ValueError(sid)
            except Exception:  # noqa: BLE001 -- unreadable: gone
                self._delete(sid)
                continue
            if snap.until <= now:
                self._delete(sid)
            else:
                self.items[sid] = snap
        for img in self.folder.glob("*.img"):
            if img.stem not in self.items:
                self._delete(img.stem)
        self.prune()

    def _delete(self, sid: str) -> None:
        self._mem.pop(sid, None)
        if self.folder is None:
            return
        for p in (self.folder / f"{sid}.img", self.folder / f"{sid}.json"):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                log.warning("could not delete a notification snapshot file")

    # -- the store ---------------------------------------------------------------------------------
    def prune(self) -> int:
        """Forget what has run out, and the oldest past SNAP_MAX. How many went."""
        now = self.clock()
        gone = [k for k, v in self.items.items() if v.until <= now]
        for k in gone:
            del self.items[k]
            self._delete(k)
        while len(self.items) > self.most:
            k = min(self.items, key=lambda x: self.items[x].until)
            del self.items[k]
            self._delete(k)
            gone.append(k)
        return len(gone)

    def put(self, body: bytes, ctype: str, camera: str) -> str:
        if ctype not in IMAGE_TYPES or not CAMERA_ID.match(camera) or not body or len(body) > MAX_BYTES:
            raise ValueError("not a camera picture")
        sid = secrets.token_hex(16)
        snap = Snap(camera, ctype, self.clock() + self.ttl, len(body))
        if self.folder is None:
            self._mem[sid] = bytes(body)
        else:
            self._ensure()
            img, rec = self._files(sid)
            for p, data in ((img, bytes(body)), (rec, json.dumps({"camera": camera, "ctype": ctype,
                                                                  "until": snap.until}).encode())):
                fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
        self.items[sid] = snap
        self.taken += 1
        self.prune()
        return sid

    def meta(self, sid: Any) -> Snap | None:
        if not isinstance(sid, str) or not SNAP_ID.match(sid):
            return None
        snap = self.items.get(sid)
        if snap is None or snap.until <= self.clock():
            return None
        return snap

    def read(self, sid: str) -> bytes | None:
        if self.meta(sid) is None:
            return None
        if self.folder is None:
            return self._mem.get(sid)
        try:
            return self._files(sid)[0].read_bytes()
        except OSError:
            return None

    def status(self) -> dict[str, Any]:
        return {"kept": len(self.items), "taken": self.taken, "failed": self.failed, "ttl_s": self.ttl,
                "most": self.most, "on_disk": self.folder is not None}


async def take_from_ha(app: web.Application, ha_url: str, token: str, camera: str,
                       timeout: float = SNAP_TIMEOUT_S) -> tuple[bytes, str] | None:
    """The camera's picture now, through Mantel's own HA credential (never logged, never sent on).
    None when the camera gives no image in time."""
    import aiohttp
    if not CAMERA_ID.match(camera):
        return None
    http = app.get("http")
    own = http is None
    if own:
        http = aiohttp.ClientSession()
    try:
        async with http.get(f"{ha_url.rstrip('/')}/api/camera_proxy/{camera}",
                            headers={"Authorization": f"Bearer {token}"},
                            timeout=aiohttp.ClientTimeout(total=timeout), allow_redirects=False) as r:
            ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            ctype = ALIASES.get(ctype, ctype)
            if r.status != 200 or ctype not in IMAGE_TYPES:
                log.info("notification snapshot from %s: HA answered %s", camera, r.status)
                return None
            if r.content_length is not None and r.content_length > MAX_BYTES:
                return None
            data = bytearray()
            async for chunk in r.content.iter_chunked(64 * 1024):
                data += chunk
                if len(data) > MAX_BYTES:
                    return None
            return (bytes(data), ctype) if data else None
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        log.info("notification snapshot from %s: %s", camera, type(exc).__name__)
        return None
    finally:
        if own:
            await http.close()


def _may_still(app: web.Application, principal: Any, camera: str) -> bool:
    authz = app.get("authz")
    if authz is None:
        return False
    try:
        return authz.may_still(principal, camera) is True
    except Exception:  # noqa: BLE001 -- a failing rule refuses
        log.exception("may_still failed; refusing a notification snapshot")
        return False


def register(app: web.Application, store: SnapStore) -> None:
    """``GET /api/notify/snap/<id>`` and the ``hk_notify/snap/sign`` read (``app["read_routes"]``)."""
    from .connectors import Ctx, Route, read_routes
    from .readproxy import ReadBlocked

    async def serve(request: web.Request) -> web.Response:
        sid = request.match_info["snap_id"]
        snap = store.meta(sid)
        nothing = web.json_response({"error": "not_found"}, status=404, headers={"Cache-Control": "no-store"})
        if snap is None or set(request.query) - {"v"}:
            return nothing
        authz = request.app.get("authz")
        if authz is None or not _may_still(request.app, authz.principal(request), snap.camera):
            return nothing
        body = store.read(sid)
        if body is None:
            return nothing
        left = max(0, int(snap.until - store.clock()))
        return web.Response(body=body, content_type=snap.ctype,
                            headers={"Cache-Control": f"private, max-age={left}", "X-Content-Type-Options": "nosniff"})

    async def sign(ctx: Ctx, msg: dict) -> dict:
        if set(msg) - {"type", "id", "snaps"}:
            raise ReadBlocked(f"{SIGN_READ} carries snaps only")
        asked = msg.get("snaps")
        if not isinstance(asked, list) or len(asked) > SNAP_MAX or not all(isinstance(s, str) for s in asked):
            raise ReadBlocked(f"{SIGN_READ}: snaps is a list of ids")
        out = {}
        for sid in dict.fromkeys(asked):
            snap = store.meta(sid)
            if snap is not None and _may_still(app, ctx.identity, snap.camera):
                out[sid] = path_of(sid)
        return {"signed": out}

    read_routes(app)[SIGN_READ] = Route(request=sign)
    app.router.add_get(PATH, serve)
