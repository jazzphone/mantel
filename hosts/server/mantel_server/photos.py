"""MANTEL PHOTOS: the house's own photo library for the screensavers (docs/phase4/PHOTOS.md).

HK's screensaver shows the photos of a Home Assistant media folder (``look.photos``, ``media-source://…``). Mantel
keeps its own library beside that, so a home can put its photos in Mantel and choose them per screen:

* **Albums.** A named set of photos; every photo is in exactly one. A screen's screensaver shows an album when
  its source is ``mantel-photos://<album id>`` -- the house's Screensaver Photos may say that, and each screen may
  choose its own album (``photo_screens``; Mantel Settings, the screen's page). Nothing changes in HK Frontend
  inside Home Assistant: the source and the screen choice exist only in Mantel.
* **Storage.** ``<data_dir>/photos/{originals,screen,thumbs}/<id>.<ext>``, 0700 folders, 0600 files. Every
  picture is decoded and re-encoded on the way in: JPEG, PNG, WebP and HEIC/HEIF (iPhone photos) are accepted by
  their bytes, the orientation is applied, every bit of metadata (EXIF, GPS location, XMP) is dropped, wide-gamut
  colour goes to sRGB, and three files are written -- the original (full size up to 8192 px on the long side,
  JPEG), the screen-sized one the screensavers show (2560 px, JPEG) and a thumbnail (480 px, WebP).
  A fourth, ``mid`` (1280 px, JPEG), is made the first time a screen asks for it (2026-10-29): the screensaver
  of a wall tablet asks for the size closest to its screen, so a 1280 px tablet no longer decodes 2560 px photos.
  It sits in ``mid/`` beside the others, is not in the quota, and goes with the photo.
* **Limits.** One upload at most ``file_mb`` (default 40 MB) and 64 megapixels; all photos together at most
  ``quota_mb`` (default 4 GB). Both are an Owner's to change.
* **Duplicates.** The SHA-256 of the bytes as they came in: the same picture again in the same album is skipped.
* **Who.** An Owner or Admin manages the library (albums, uploads, delete, move, a screen's album; CSRF on every
  change; every change audited as a ``config`` row). Only an Owner changes the limits and imports from Home
  Assistant. The screensavers read an album's list and its screen-sized photos and thumbnails as anyone who may
  use ``feature:media`` (a signed-in person or a wall tablet); the originals are for managers only.
* **Import from Home Assistant.** An Owner copies the pictures under one of HA's media folders
  (``media-source://media_source/…``) into an album. Mantel walks the folder with ``media_source/browse_media``,
  asks ``media_source/resolve_media`` for each picture (a server-only read) and reads it from HA Core with HA's
  own short-lived signature, through Mantel's own connection. One import at a time, in the background, with its
  progress; nothing in Home Assistant is ever written or deleted.
* **Backups.** The folder goes into Mantel's encrypted backups (backup.py) with "Your files", and with ``/data``
  into Home Assistant's backups of the App.
* **Keep in View** (faces.py; migration 0024). Where a photo's faces are is found once -- on upload, from the
  screen-sized copy, and for photos stored before by the backfill (``FaceBackfill``: one photo at a time, newest
  first, paused while an import runs). Only boxes are stored, never who anyone is. A manager may set a photo's focus
  by hand (``PUT /api/photos/<id>/focus``) or put it back to automatic. The screensavers read the faces and the
  hand-set point with an album (``api_show``) and crop and zoom around them; a photo without either is cropped as
  it always was.
* **Time Behind** (cutout.py; migration 0027). Each photo's subject is cut out once -- on upload, right after its
  faces, and for photos stored before by ``CutoutBackfill`` (as the faces' backfill) -- and the photo is marked
  usable only where the cut-out works. A usable photo's mask (``masks/<id>.png``) is counted in the quota and goes
  into backups with the rest; ``api_show`` hands a screensaver the mask and where the time goes, and an album can
  be set to show only the photos that qualify. Without the model, nothing changes. And for Photo Titles, the year a
  photo was taken (its EXIF's, read before the EXIF is dropped) is kept.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import math
import logging
import os
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import unquote, urlsplit

from aiohttp import web

from . import audit, imaging
from . import cutout as cutter
from . import faces as face_finder
# the picture work itself (image_work.py) runs in imaging.py's worker process; these names stay photos.py's
from .image_work import (MID_EDGE, ORIGINAL_EDGE, PIXELS_MAX, SCREEN_EDGE, THUMB_EDGE, PhotoError, Processed,  # noqa: F401
                         make_variant, process, sniff)
from .imaging import IMAGE_JOBS, image_slot, run as run_image_job  # noqa: F401
from .guards import guard
from .guards import ident as guarded

log = logging.getLogger("mantel.photos")
Before = Callable[[dict], None] | None    # a change's audit row, written once it is accepted and before it is made

SCHEME = "mantel-photos://"
HA_SOURCE = "media-source://media_source/"
PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
ALBUM_ID = re.compile(r"^[0-9a-f]{16}$")
SCREEN = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$")
NAME_MAX = 60
FILE_NAME_MAX = 120
# folder, file extension, content type -- per size
SIZES = {"original": ("originals", ".jpg", "image/jpeg"),
         "screen": ("screen", ".jpg", "image/jpeg"),
         "mid": ("mid", ".jpg", "image/jpeg"),                  # made on first ask (PhotoLibrary.mid_path)
         "thumb": ("thumbs", ".webp", "image/webp"),
         "mask": ("masks", ".png", "image/png")}                # Time Behind's cut-out, a usable photo's only
LIMITS = {"quota_mb": (100, 1_048_576, 4096), "file_mb": (1, 200, 40)}      # (lowest, highest, default)
ALBUM_MAX = 200
ALBUM_PHOTOS_MAX = 20_000
BATCH_MAX = 2000
IMPORT_MAX = 5000
IMPORT_DEPTH = 4
IMPORT_ERRORS_KEPT = 30
MANAGERS = ("owner", "admin")
# the screen-sized photos and thumbnails never change under one id (a photo is never edited, only added or
# removed), so a browser keeps them; the lists are asked again each time
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}
NO_STORE = {"Cache-Control": "no-store"}
# the 1280 px copy is made when a screen first asks (2026-10-29): at most this many at once, each waited for at most
# MID_WAIT seconds -- after that, or with all the places taken, the 2560 px photo is sent for this one request
MID_JOBS_MAX = 3
MID_WAIT = 4.0
# what is sent while the copy is made: not immutable, since the same address will answer with the smaller file
MID_PENDING = {"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"}


def clean_name(raw: object, limit: int = NAME_MAX, *, what: str = "album") -> str:
    """A name for people: NFKC, printable, spaces collapsed, 1..limit characters."""
    if not isinstance(raw, str):
        raise PhotoError("name_required", f"The {what} needs a name.")
    name = " ".join("".join(ch for ch in unicodedata.normalize("NFKC", raw) if ch.isprintable()).split())
    if not name:
        raise PhotoError("name_required", f"The {what} needs a name.")
    if len(name) > limit:
        raise PhotoError("name_too_long", f"Names are at most {limit} characters.")
    return name


def file_label(raw: object) -> str:
    """The file name a photo came with, kept for people only: the last path part, printable, at most 120."""
    if not isinstance(raw, str):
        return ""
    name = unicodedata.normalize("NFKC", raw).replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(ch for ch in name if ch.isprintable()).strip()[:FILE_NAME_MAX]


def album_of(source: object) -> str | None:
    """``mantel-photos://<album id>`` -> the album id, else None."""
    if isinstance(source, str) and source.startswith(SCHEME) and ALBUM_ID.match(source[len(SCHEME):]):
        return source[len(SCHEME):]
    return None


# -- the library ------------------------------------------------------------------------------------------
def _write(dest: Path, data: bytes) -> None:
    tmp = dest.with_name(f".{dest.name}.{secrets.token_hex(4)}.tmp")
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, dest)
    finally:
        with contextlib.suppress(OSError):
            tmp.unlink()


class PhotoLibrary:
    """The rows (``db``, used on the event loop only) and the files (``root``; written in a worker thread)."""

    def __init__(self, root: Path, db, clock: Callable[[], float] = time.time) -> None:
        self.root = Path(root).expanduser()
        self.db = db
        self.clock = clock
        self.lock = asyncio.Lock()                  # a quota check and the write it allows are one step
        self._mids: dict[str, asyncio.Task] = {}    # the 1280 px copies being made, by photo id (mid_path)

    # -- folders and files ------------------------------------------------------------------------
    def ensure(self) -> None:
        for d in (self.root, *(self.root / f for f, _, _ in SIZES.values())):
            d.mkdir(parents=True, exist_ok=True)
            with contextlib.suppress(OSError):
                os.chmod(d, 0o700)

    def path(self, photo_id: str, size: str) -> Path | None:
        if size not in SIZES or not PHOTO_ID.match(photo_id or ""):
            return None
        folder, ext, _ = SIZES[size]
        p = self.root / folder / f"{photo_id}{ext}"
        return p if p.is_file() and not p.is_symlink() else None

    def _make_mid(self, photo_id: str, src: Path) -> Path | None:
        """The 1280 px copy of a photo's screen-sized file, written beside the others (in a thread)."""
        dest = self.root / SIZES["mid"][0] / f"{photo_id}{SIZES['mid'][1]}"
        self.ensure()
        data = make_variant(src, MID_EDGE)
        _write(dest, data)
        if not src.is_file():                       # the photo was deleted while the copy was made: no orphan
            with contextlib.suppress(OSError):
                dest.unlink()
            return None
        return dest

    async def mid_path(self, photo_id: str) -> Path | None:
        """The 1280 px copy of a photo, made on the first ask and kept (immutable like the other sizes). None: not
        there yet -- the caller sends the screen-sized file meanwhile. It is made in a THREAD (a resize of the 2560 px
        file: a few tens of ms), never in the image worker, so an upload that takes a minute cannot hold a tablet's
        next photo; several tablets asking for the same photo share one job, and a cancelled request does not stop it."""
        have = self.path(photo_id, "mid")
        if have is not None:
            return have
        src = self.path(photo_id, "screen")
        if src is None:
            return None
        job = self._mids.get(photo_id)
        if job is None:
            if len(self._mids) >= MID_JOBS_MAX:
                return None

            async def make() -> Path | None:
                try:
                    return await asyncio.to_thread(self._make_mid, photo_id, src)
                except Exception as exc:  # noqa: BLE001 -- no copy: the screen size is sent, and asked again next time
                    log.warning("couldn't make the 1280 px copy of photo %s: %s: %s", photo_id[:8], type(exc).__name__, exc)
                    return None

            job = self._mids[photo_id] = asyncio.ensure_future(make())
            job.add_done_callback(lambda t, pid=photo_id: self._mids.get(pid) is t and self._mids.pop(pid, None))
        try:
            return await asyncio.wait_for(asyncio.shield(job), MID_WAIT)
        except asyncio.TimeoutError:
            return None

    def _write_files(self, photo_id: str, got: Processed) -> None:
        self.ensure()
        for size, data in (("original", got.original), ("screen", got.screen), ("thumb", got.thumb), ("mask", got.mask)):
            if data is None:
                continue
            folder, ext, _ = SIZES[size]
            _write(self.root / folder / f"{photo_id}{ext}", data)

    def _write_mask(self, photo_id: str, data: bytes | None) -> None:
        """A photo's cut-out written (or, None, taken away)."""
        self.ensure()
        folder, ext, _ = SIZES["mask"]
        dest = self.root / folder / f"{photo_id}{ext}"
        if data is None:
            with contextlib.suppress(OSError):
                dest.unlink()
            return
        _write(dest, data)

    def _remove_files(self, photo_id: str) -> None:
        for folder, ext, _ in SIZES.values():
            with contextlib.suppress(OSError):
                (self.root / folder / f"{photo_id}{ext}").unlink()

    # -- settings ---------------------------------------------------------------------------------
    def limits(self) -> dict:
        out = {k: d for k, (_, _, d) in LIMITS.items()}
        for row in self.db.execute("SELECT key, value FROM photo_settings"):
            lo, hi, _ = LIMITS.get(row["key"], (None, None, None))
            with contextlib.suppress(TypeError, ValueError):
                if lo is not None and lo <= int(row["value"]) <= hi:
                    out[row["key"]] = int(row["value"])
        return out

    def set_limits(self, changes: dict, before: Before = None) -> dict:
        if not isinstance(changes, dict) or not changes or set(changes) - set(LIMITS):
            raise PhotoError("bad_limits", "Send quota_mb and/or file_mb.")
        for k, v in changes.items():
            lo, hi, _ = LIMITS[k]
            if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
                raise PhotoError("bad_limits", f"{k} must be a whole number from {lo} to {hi}.")
        if before is not None:
            was = self.limits()
            before({"before": was, "after": {**was, **changes}})
        now = self.clock()
        with self.db:
            for k, v in changes.items():
                self.db.execute("INSERT INTO photo_settings (key, value, updated) VALUES (?,?,?) "
                                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
                                (k, str(v), now))
        return self.limits()

    def usage(self) -> int:
        return int(self.db.execute("SELECT COALESCE(SUM(bytes), 0) FROM photos").fetchone()[0])

    def count(self) -> int:
        return int(self.db.execute("SELECT COUNT(*) FROM photos").fetchone()[0])

    # -- albums -----------------------------------------------------------------------------------
    def albums(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT a.id, a.name, a.position, a.created, a.updated, COUNT(p.id) AS count, "
            "COALESCE(SUM(p.bytes), 0) AS bytes, a.depth_only, COALESCE(SUM(p.cutout_ok = 1), 0) AS depth, "
            "(SELECT id FROM photos q WHERE q.album_id = a.id ORDER BY q.created DESC, q.id LIMIT 1) AS cover "
            "FROM photo_albums a LEFT JOIN photos p ON p.album_id = a.id GROUP BY a.id ORDER BY a.position, a.created")
        return [dict(r, depth_only=bool(r["depth_only"])) for r in rows]

    def album(self, album_id: object) -> dict:
        row = None
        if isinstance(album_id, str) and ALBUM_ID.match(album_id):
            row = self.db.execute("SELECT id, name FROM photo_albums WHERE id=?", (album_id,)).fetchone()
        if row is None:
            raise PhotoError("album_not_found", "That album no longer exists.", 404)
        return dict(row)

    def set_album_options(self, album_id: str, body: object, before: Before = None) -> dict:
        """An album's options: ``{depth_only: bool}`` -- Only Photos That Qualify (for Time Behind)."""
        album = self.album(album_id)
        if not isinstance(body, dict) or set(body) != {"depth_only"} or not isinstance(body["depth_only"], bool):
            raise PhotoError("bad_options", "Send {depth_only: true or false}.")
        if before is not None:
            before({"id": album["id"], "depth_only": body["depth_only"]})
        with self.db:
            self.db.execute("UPDATE photo_albums SET depth_only=?, updated=? WHERE id=?",
                            (int(body["depth_only"]), self.clock(), album["id"]))
        return {"id": album["id"], "depth_only": body["depth_only"]}

    def _name_free(self, name: str, but: str | None = None) -> None:
        for row in self.db.execute("SELECT id, name FROM photo_albums"):
            if row["id"] != but and row["name"].casefold() == name.casefold():
                raise PhotoError("name_taken", "There is already an album with that name.", 409)

    def create_album(self, name: object, before: Before = None) -> dict:
        name = clean_name(name)
        self._name_free(name)
        if self.db.execute("SELECT COUNT(*) FROM photo_albums").fetchone()[0] >= ALBUM_MAX:
            raise PhotoError("too_many_albums", f"At most {ALBUM_MAX} albums.", 409)
        aid, now = secrets.token_hex(8), self.clock()
        if before is not None:
            before({"id": aid, "name": name})
        pos = self.db.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM photo_albums").fetchone()[0]
        with self.db:
            self.db.execute("INSERT INTO photo_albums (id, name, position, created, updated) VALUES (?,?,?,?,?)",
                            (aid, name, pos, now, now))
        return {"id": aid, "name": name}

    def rename_album(self, album_id: str, name: object, before: Before = None) -> dict:
        old = self.album(album_id)
        name = clean_name(name)
        self._name_free(name, but=old["id"])
        if before is not None:
            before({"id": old["id"], "name": name, "was": old["name"]})
        with self.db:
            self.db.execute("UPDATE photo_albums SET name=?, updated=? WHERE id=?", (name, self.clock(), old["id"]))
        return {"id": old["id"], "name": name, "was": old["name"]}

    async def delete_album(self, album_id: str, before: Before = None) -> dict:
        album = self.album(album_id)
        async with self.lock:
            ids = [r["id"] for r in self.db.execute("SELECT id FROM photos WHERE album_id=?", (album["id"],))]
            screens = [r["screen"] for r in self.db.execute("SELECT screen FROM photo_screens WHERE album_id=?",
                                                            (album["id"],))]
            if before is not None:
                before({"id": album["id"], "name": album["name"], "photos": len(ids), "screens": screens})
            with self.db:
                self.db.execute("DELETE FROM photos WHERE album_id=?", (album["id"],))
                self.db.execute("DELETE FROM photo_screens WHERE album_id=?", (album["id"],))
                self.db.execute("DELETE FROM photo_albums WHERE id=?", (album["id"],))
            await asyncio.to_thread(lambda: [self._remove_files(i) for i in ids])
        return {"id": album["id"], "name": album["name"], "photos": len(ids), "screens": screens}

    # -- photos -----------------------------------------------------------------------------------
    _COLS = "id, album_id, name, width, height, bytes, source, created"

    def photos(self, album_id: str) -> list[dict]:
        album = self.album(album_id)
        return [with_cutout(with_focus(dict(r))) for r in self.db.execute(
            f"SELECT {self._COLS}, faces, focus_x, focus_y, cutout_at, cutout_ok, cutout_conf, cutout_by FROM photos "
            "WHERE album_id=? ORDER BY created DESC, id", (album["id"],))]

    def photo(self, photo_id: str) -> dict | None:
        row = self.db.execute(f"SELECT {self._COLS} FROM photos WHERE id=?", (photo_id,)).fetchone() \
            if PHOTO_ID.match(photo_id or "") else None
        return dict(row) if row else None

    def find(self, album_id: str, sha: str) -> dict | None:
        row = self.db.execute(f"SELECT {self._COLS} FROM photos WHERE album_id=? AND sha256=?", (album_id, sha)).fetchone()
        return dict(row) if row else None

    async def add(self, album_id: str, data: bytes, name: object = "", *, source: str = "upload",
                  user: str | None = None, before: Before = None) -> tuple[dict, bool]:
        """Store one picture in an album: (the photo, False), or (the photo already there, True) for a duplicate.
        ``before(detail)`` once it fits, before its files are written (not for a duplicate: nothing changes)."""
        album = self.album(album_id)
        lim = self.limits()
        if len(data) > lim["file_mb"] << 20:
            raise PhotoError("too_large", f"That file is bigger than the {lim['file_mb']} MB limit.", 413)
        sha = hashlib.sha256(data).hexdigest()
        same = self.find(album["id"], sha)
        if same is not None:
            return same, True
        if self.db.execute("SELECT COUNT(*) FROM photos WHERE album_id=?", (album["id"],)).fetchone()[0] >= ALBUM_PHOTOS_MAX:
            raise PhotoError("album_full", f"An album holds at most {ALBUM_PHOTOS_MAX:,} photos.", 409)
        try:
            got = await imaging.run(process, data)             # in the image worker, one picture at a time
        except imaging.WorkerLost as exc:                       # it died on this one (out of memory, a decoder crash)
            raise PhotoError("photo_invalid", "That picture couldn’t be read.", 415) from exc
        async with self.lock:
            same = self.find(album["id"], sha)                  # the same picture, sent twice at once
            if same is not None:
                return same, True
            self.album(album["id"])                             # still there (not deleted meanwhile)
            if self.usage() + got.size > lim["quota_mb"] << 20:
                raise PhotoError("quota_exceeded", "Mantel Photos is full. Delete some photos, or an Owner can "
                                                   "raise the limit.", 413)
            pid = secrets.token_hex(16)
            row = {"id": pid, "album_id": album["id"], "name": file_label(name), "width": got.width,
                   "height": got.height, "bytes": got.size, "source": source, "created": self.clock()}
            if before is not None:
                before({"album": album["id"], "id": pid, "name": row["name"], "bytes": got.size})
            write = None
            try:
                # the files and the row together: a write that fails partway (a full disk) took its files with
                # it no more, and left pictures no row counts toward the quota and nothing ever deletes
                try:
                    write = asyncio.ensure_future(asyncio.to_thread(self._write_files, pid, got))
                    await asyncio.shield(write)                 # a cancel must not stop waiting for the thread
                except OSError as exc:
                    log.warning("could not store a photo: %s", exc)
                    raise PhotoError("storage_failed", "Mantel couldn't store the photo (is the disk full?).", 507) from exc
                checked = got.faces is not None
                cut = got.cutout if isinstance(got.cutout, dict) else None
                ok = bool(cut and cut.get("ok") and got.mask)
                with self.db:
                    self.db.execute("INSERT INTO photos (id, album_id, sha256, name, width, height, bytes, source, "
                                    "created, created_by, faces, faces_at, faces_by, cutout_at, cutout_by, cutout_ok, "
                                    "cutout_conf, depth_box, taken) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                    (pid, album["id"], sha, row["name"], got.width, got.height, got.size, source,
                                     row["created"], user, json.dumps(got.faces) if checked else None,
                                     self.clock() if checked else None, face_finder.NAME if checked else None,
                                     self.clock() if cut else None, cut.get("by") if cut else None,
                                     int(ok) if cut else None, cut.get("conf") if cut else None,
                                     json.dumps(cut["box"]) if ok else None, got.taken))
            except BaseException:
                # A thread can't be cancelled: when this add is (an Owner stopped an import, Mantel is stopping), the
                # writer is still putting files down. Take them away only once it has finished, or what it writes
                # after is on disk in no row, counted by no quota, deleted by nothing.
                while write is not None and not write.done():
                    with contextlib.suppress(asyncio.CancelledError):
                        await asyncio.wait({write})
                if write is not None and not write.cancelled():
                    write.exception()                           # retrieved: its error was handled or is moot
                await asyncio.to_thread(self._remove_files, pid)
                raise
        return row, False

    @staticmethod
    def _ids(ids: object) -> list[str]:
        if not isinstance(ids, list) or not ids or len(ids) > BATCH_MAX or \
                not all(isinstance(i, str) and PHOTO_ID.match(i) for i in ids):
            raise PhotoError("bad_ids", f"Send 1 to {BATCH_MAX} photo ids.")
        return list(dict.fromkeys(ids))

    async def delete(self, ids: object, before: Before = None) -> list[str]:
        ids = self._ids(ids)
        async with self.lock:
            marks = ",".join("?" * len(ids))
            found = [r["id"] for r in self.db.execute(f"SELECT id FROM photos WHERE id IN ({marks})", ids)]
            if found and before is not None:
                before({"ids": found, "count": len(found)})
            with self.db:
                self.db.execute(f"DELETE FROM photos WHERE id IN ({marks})", ids)
            await asyncio.to_thread(lambda: [self._remove_files(i) for i in found])
        return found

    async def move(self, ids: object, album_id: str, before: Before = None) -> tuple[list[str], list[str]]:
        """(moved, skipped): a photo already in the target album (the same picture) stays where it is."""
        ids = self._ids(ids)
        target = self.album(album_id)
        moved, skipped, seen = [], [], set()
        async with self.lock:
            for pid in ids:                     # worked out first (one picture once per album), then written
                row = self.db.execute("SELECT album_id, sha256 FROM photos WHERE id=?", (pid,)).fetchone()
                if row is None or row["album_id"] == target["id"]:
                    continue
                if row["sha256"] in seen or self.find(target["id"], row["sha256"]) is not None:
                    skipped.append(pid)
                    continue
                seen.add(row["sha256"])
                moved.append(pid)
            if moved and before is not None:
                before({"ids": moved, "album": target["id"], "count": len(moved)})
            with self.db:
                for pid in moved:
                    self.db.execute("UPDATE photos SET album_id=? WHERE id=?", (target["id"], pid))
        return moved, skipped

    # -- focus ------------------------------------------------------------------------------------
    def set_faces(self, photo_id: str, found: list) -> None:
        with self.db:
            self.db.execute("UPDATE photos SET faces=?, faces_at=?, faces_by=? WHERE id=?",
                            (json.dumps(found), self.clock(), face_finder.NAME, photo_id))

    def face_counts(self) -> dict:
        """``{photos, checked, with_faces, left, last}`` from the rows (``last``: when the latest was checked)."""
        r = self.db.execute("SELECT COUNT(*) AS photos, COUNT(faces_at) AS checked, MAX(faces_at) AS last, "
                            "SUM(faces_at IS NOT NULL AND faces IS NOT NULL AND faces != '[]') AS with_faces "
                            "FROM photos").fetchone()
        photos, checked = int(r["photos"]), int(r["checked"])
        return {"photos": photos, "checked": checked, "with_faces": int(r["with_faces"] or 0),
                "left": photos - checked, "last": r["last"]}

    def unchecked(self, skip: Iterable[str] = ()) -> str | None:
        """The newest photo whose faces haven't been looked for (but those in ``skip``), or None."""
        skip = list(skip)
        row = self.db.execute(f"SELECT id FROM photos WHERE faces_at IS NULL AND id NOT IN ({','.join('?' * len(skip))}) "
                              "ORDER BY created DESC LIMIT 1", skip).fetchone()
        return row["id"] if row else None

    # -- Time Behind: the cut-outs ---------------------------------------------------------------------------
    def uncut(self, skip: Iterable[str] = (), faces_known: bool = True) -> tuple[str, list | None] | None:
        """The newest photo not cut out yet (but those in ``skip``) and its faces -- with ``faces_known``, only among
        those whose faces have been looked for, so the time goes behind a head -- or None."""
        skip = list(skip)
        row = self.db.execute("SELECT id, faces FROM photos WHERE cutout_at IS NULL" +
                              (" AND faces_at IS NOT NULL" if faces_known else "") +
                              f" AND id NOT IN ({','.join('?' * len(skip))}) ORDER BY created DESC LIMIT 1", skip).fetchone()
        return (row["id"], stored_faces(row["faces"])) if row else None

    def cutout_counts(self) -> dict:
        """``{photos, checked, usable, left, last}`` from the rows (``last``: when the latest was checked)."""
        r = self.db.execute("SELECT COUNT(*) AS photos, COUNT(cutout_at) AS checked, MAX(cutout_at) AS last, "
                            "SUM(cutout_ok = 1) AS usable FROM photos").fetchone()
        photos, checked = int(r["photos"]), int(r["checked"])
        return {"photos": photos, "checked": checked, "usable": int(r["usable"] or 0), "left": photos - checked,
                "last": r["last"]}

    async def store_cutout(self, photo_id: str, got: dict) -> bool:
        """A photo's cut-out stored (the backfill): its row, and a usable one's mask -- counted in the quota; when it
        doesn't fit, the photo is marked checked and not usable. False when it isn't usable (or is gone)."""
        mask = got.get("mask") if got.get("ok") else None
        box = got.get("box") if mask else None
        async with self.lock:
            row = self.db.execute("SELECT id FROM photos WHERE id=?", (photo_id,)).fetchone()
            if row is None:                                     # deleted meanwhile
                return False
            had = self.path(photo_id, "mask")
            was = had.stat().st_size if had is not None else 0
            if mask and self.usage() - was + len(mask) > self.limits()["quota_mb"] << 20:
                log.info("no room for photo %s's cut-out: Mantel Photos is full", photo_id[:8])
                mask = box = None
            await asyncio.to_thread(self._write_mask, photo_id, mask)
            with self.db:
                self.db.execute("UPDATE photos SET cutout_at=?, cutout_by=?, cutout_ok=?, cutout_conf=?, depth_box=?, "
                                "bytes=bytes-?+? WHERE id=?",
                                (self.clock(), got.get("by") or cutter.NAME, int(bool(mask)), got.get("conf"),
                                 json.dumps(box) if mask else None, was, len(mask or b""), photo_id))
        return bool(mask)

    def set_focus(self, photo_id: str, body: object, before: Before = None) -> dict:
        """``{x, y}`` (fractions 0..1) sets the focus by hand; ``{auto: true}`` puts it back to automatic."""
        row = self.db.execute("SELECT id, album_id FROM photos WHERE id=?", (photo_id,)).fetchone() \
            if PHOTO_ID.match(photo_id or "") else None
        if row is None:
            raise PhotoError("photo_not_found", "That photo no longer exists.", 404)
        if not isinstance(body, dict):
            raise PhotoError("bad_focus", "Send {x, y} from 0 to 1, or {auto: true}.")
        if body.get("auto") is True and set(body) == {"auto"}:
            x = y = None
        else:
            x, y = body.get("x"), body.get("y")
            if set(body) != {"x", "y"} or not all(
                    isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= 1
                    for v in (x, y)):
                raise PhotoError("bad_focus", "Send {x, y} from 0 to 1, or {auto: true}.")
            x, y = round(float(x), 4), round(float(y), 4)
        if before is not None:
            before({"id": row["id"], "album": row["album_id"], **({"auto": True} if x is None else {"x": x, "y": y})})
        with self.db:
            self.db.execute("UPDATE photos SET focus_x=?, focus_y=? WHERE id=?", (x, y, row["id"]))
        got = self.db.execute("SELECT faces, focus_x, focus_y FROM photos WHERE id=?", (row["id"],)).fetchone()
        return {"id": row["id"], "album": row["album_id"], **with_focus(dict(got))}

    # -- screens ----------------------------------------------------------------------------------
    def screens(self) -> dict[str, str]:
        return {r["screen"]: r["album_id"] for r in self.db.execute("SELECT screen, album_id FROM photo_screens")}

    def set_screen(self, screen: str, album_id: object, before: Before = None) -> str | None:
        if not SCREEN.match(screen or ""):
            raise PhotoError("bad_screen", "That is not a screen's address.")
        album = self.album(album_id) if album_id not in (None, "") else None
        if before is not None:
            before({"screen": screen, "album": album["id"] if album is not None else None})
        with self.db:
            if album is None:
                self.db.execute("DELETE FROM photo_screens WHERE screen=?", (screen,))
                return None
            self.db.execute("INSERT INTO photo_screens (screen, album_id, updated) VALUES (?,?,?) "
                            "ON CONFLICT(screen) DO UPDATE SET album_id=excluded.album_id, updated=excluded.updated",
                            (screen, album["id"], self.clock()))
        return album["id"]


def stored_faces(raw: object) -> list | None:
    """The ``faces`` column -> its list (None: not checked yet; a damaged value counts as no faces)."""
    if raw is None:
        return None
    try:
        got = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [f for f in got if isinstance(f, list) and len(f) >= 4] if isinstance(got, list) else []


def stored_box(raw: object) -> list | None:
    """The ``depth_box`` column -> [x, y, w, h] (fractions, inside the photo), or None (a damaged value too)."""
    try:
        got = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        return None
    if not isinstance(got, list) or len(got) != 4 or not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in got):
        return None
    x, y, w, h = (float(v) for v in got)
    if not (0 <= x and 0 <= y and w > 0 and h > 0 and x + w <= 1.0001 and y + h <= 1.0001):
        return None
    return [round(v, 4) for v in (x, y, w, h)]


def with_cutout(row: dict) -> dict:
    """A row with ``cutout_at/_ok/_conf/_by`` -> ``cutout``: None (not checked yet) or ``{ok, conf, by}``."""
    at, ok, conf, by = (row.pop(k, None) for k in ("cutout_at", "cutout_ok", "cutout_conf", "cutout_by"))
    row["cutout"] = None if at is None else {"ok": bool(ok), "conf": conf, "by": by}
    return row


def with_focus(row: dict) -> dict:
    """A row with ``faces``/``focus_x``/``focus_y`` -> ``faces`` (list or None) and ``focus {x, y, by}``:
    ``hand`` (set by hand), ``faces`` (the centre of the kept faces), ``none`` (checked, no faces) or ``pending``."""
    found = stored_faces(row.pop("faces", None))
    fx, fy = row.pop("focus_x", None), row.pop("focus_y", None)
    row["faces"] = found
    if fx is not None and fy is not None:
        row["focus"] = {"x": fx, "y": fy, "by": "hand"}
    elif found:
        x1 = min(f[0] for f in found)
        y1 = min(f[1] for f in found)
        x2 = max(f[0] + f[2] for f in found)
        y2 = max(f[1] + f[3] for f in found)
        row["focus"] = {"x": round((x1 + x2) / 2, 4), "y": round((y1 + y2) / 2, 4), "by": "faces"}
    else:
        row["focus"] = {"x": None, "y": None, "by": "none" if found is not None else "pending"}
    return row


class FaceBackfill:
    """Looks for faces in the photos stored before (or while no detector was here): ``app["photos_faces"]``.

    It starts a minute after the server does, then takes one photo at a time, newest first: the image worker reads
    its screen-sized file and looks (``imaging.look``, in the same one-at-a-time slot as the uploads), and the row is
    written here, with a short rest between photos. It waits while an import
    runs and stops when nothing is left; its state is the rows (``faces_at IS NULL``), so a restart carries on. A
    file that can't be read is stored as no faces, so it isn't tried again for ever; a photo the DETECTOR fails on stays
    unchecked (skipped for this run), and a few failures in a row stop the run (logged once). Nothing runs without a
    detector.

    CutoutBackfill (Time Behind) is the same walk with its own steps: the hooks below (``_available`` .. ``_said``)."""

    START = 60.0
    REST = 0.5
    IMPORT_WAIT = 5.0
    FAILURES_MAX = 3                # detector failures in a row (not unreadable files) that stop a run

    def __init__(self, app: web.Application, *, start: float | None = None, rest: float | None = None) -> None:
        self.app = app
        self.start_after = self.START if start is None else start
        self.rest = self.REST if rest is None else rest
        self.task: asyncio.Task | None = None
        self.checked = 0
        self.with_faces = 0
        self.started: float | None = None        # the app's clock: when this run began looking
        self.finished: float | None = None       # ... and found nothing left

    # -- its steps (CutoutBackfill has its own) ---------------------------------------------------------
    def _available(self) -> bool:
        return imaging.faces_available()

    def _counts(self) -> dict:
        return self.app["photos"].face_counts()

    async def _ready(self) -> str | None:
        return await imaging.faces_ready()

    def _next(self, skip: set) -> tuple | None:
        """(photo id, what its look needs) -- or None: nothing left; ``()``: wait (something must happen first)."""
        pid = self.app["photos"].unchecked(skip=skip)
        return None if pid is None else (pid, None)

    async def _look(self, pid: str, extra):
        return await imaging.look(self.app["photos"].path(pid, "screen"))

    async def _store(self, pid: str, found) -> None:
        lib: PhotoLibrary = self.app["photos"]
        if lib.photo(pid) is not None:                  # not deleted meanwhile
            lib.set_faces(pid, found)
            self.checked += 1
            self.with_faces += bool(found)

    def _said(self, seconds: float) -> None:
        log.info("checked %d photos for faces in %.0fs (%d with faces)", self.checked, seconds, self.with_faces)

    def start(self) -> asyncio.Task | None:
        if self.task is not None and not self.task.done():
            return self.task
        if not self._available():
            return None
        self.task = asyncio.get_running_loop().create_task(self.run())
        return self.task

    def cancel(self) -> None:
        if self.task is not None and not self.task.done():
            self.task.cancel()

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def status(self) -> dict:
        """What ``GET /api/photos/faces`` says, counted from the rows. ``state``: ``unavailable`` (no detector on
        this platform), ``done`` (every photo checked), ``waiting`` (for an import to finish), ``running``, or
        ``stopped`` (photos left and nothing looking: a detector that wouldn't start, or a photo added since
        whose own look failed; the next start picks them up)."""
        n = self._counts()
        last = n.pop("last")
        imp = self.app.get("photos_import")
        if not self._available():
            state = "unavailable"
        elif not n["left"]:
            state = "done"
        elif not self.running:
            state = "stopped"
        elif imp is not None and imp.running:
            state = "waiting"
        else:
            state = "running"
        return dict(n, state=state, started=self.started,
                    finished=(self.finished or last) if state == "done" and n["photos"] else None)

    WHAT = "face backfill"
    MODEL = "detector"

    async def run(self) -> None:
        await asyncio.sleep(self.start_after)
        began, ready = time.monotonic(), False
        failed: set[str] = set()                                # photos the detector failed on, left for another run
        in_a_row = 0
        self.started, self.finished = self.app["clock"](), None
        try:
            while True:
                imp = self.app.get("photos_import")
                if imp is not None and imp.running:
                    await asyncio.sleep(self.IMPORT_WAIT)
                    continue
                nxt = self._next(failed)
                if nxt is None:
                    self.finished = self.app["clock"]()
                    break
                if not nxt:                                     # waiting on something else (the faces)
                    await asyncio.sleep(self.IMPORT_WAIT)
                    continue
                pid, extra = nxt
                if not ready:
                    why = await self._ready()
                    if why is not None:
                        log.warning("the %s can't start: %s", self.WHAT, why)
                        return
                    ready = True
                try:
                    found = await self._look(pid, extra)
                except imaging.WorkerLost:                      # the worker died on it: as a detector failure
                    found = None
                if found is None:                               # the detector failed: the row stays unchecked
                    failed.add(pid)
                    in_a_row += 1
                    if in_a_row >= self.FAILURES_MAX:
                        log.warning("the %s stops: the %s failed on %d photos in a row; it tries again when Mantel "
                                    "restarts", self.WHAT, self.MODEL, in_a_row)
                        return
                    await asyncio.sleep(self.rest)
                    continue
                in_a_row = 0
                await self._store(pid, found)
                await asyncio.sleep(self.rest)
        finally:
            if self.checked:
                self._said(time.monotonic() - began)


class CutoutBackfill(FaceBackfill):
    """Cuts out the photos stored before (or while no model was here), for Time Behind: ``app["photos_cutouts"]``.

    FaceBackfill's walk -- a minute after the server starts, one photo at a time, newest first, resting between,
    waiting while an import runs, carrying on after a restart (the rows: ``cutout_at IS NULL``), stopping after a few
    model failures in a row -- with the cut-out's steps: the worker cuts out the screen-sized file
    (``imaging.cut_look``), handed the faces already found, so a photo waits for its faces while the face backfill
    still looks; the row and a usable photo's mask are written here (``store_cutout``, within the quota). Nothing
    runs without the model."""

    WHAT = "cut-out backfill"
    MODEL = "cut-out model"

    def __init__(self, app: web.Application, *, start: float | None = None, rest: float | None = None) -> None:
        super().__init__(app, start=start, rest=rest)
        self.usable = 0

    def _available(self) -> bool:
        return imaging.cutouts_available()

    def _counts(self) -> dict:
        return self.app["photos"].cutout_counts()

    async def _ready(self) -> str | None:
        return await imaging.cutouts_ready()

    def _next(self, skip: set) -> tuple | None:
        lib: PhotoLibrary = self.app["photos"]
        got = lib.uncut(skip, faces_known=True)
        if got is None and imaging.faces_available():
            faces_bf = self.app.get("photos_faces")
            if faces_bf is not None and faces_bf.running and lib.unchecked() is not None:
                return ()                                       # the faces first: the time goes behind a head
        if got is None:
            got = lib.uncut(skip, faces_known=False)
        return got

    async def _look(self, pid: str, extra):
        return await imaging.cut_look(self.app["photos"].path(pid, "screen"), extra)

    async def _store(self, pid: str, found) -> None:
        if self.app["photos"].photo(pid) is None:              # deleted meanwhile
            return
        self.usable += await self.app["photos"].store_cutout(pid, found)
        self.checked += 1

    def _said(self, seconds: float) -> None:
        log.info("cut out %d photos in %.0fs (%d usable for Time Behind)", self.checked, seconds, self.usable)


# -- importing from Home Assistant ------------------------------------------------------------------------
def is_image(item: dict) -> bool:
    ctype = item.get("media_content_type")
    return item.get("media_class") == "image" or (isinstance(ctype, str) and ctype.lower().startswith("image/"))


def signed_media_path(url: object) -> str | None:
    """HA's resolved address -> its path and query (HA's signature) under ``/media/``, or None. Never a host."""
    if not isinstance(url, str) or len(url) > 4096:
        return None
    u = urlsplit(url)
    if u.scheme or u.netloc or u.fragment or not u.path.startswith("/media/") or "\\" in u.path:
        return None
    if any(ord(c) < 32 for c in url) or any(seg in ("", ".", "..") for seg in unquote(u.path).split("/")[1:]):
        return None
    return u.path + (f"?{u.query}" if u.query else "")


@dataclass
class ImportJob:
    source: str
    album: str
    album_name: str
    actor: str
    started: float
    state: str = "listing"           # listing -> copying -> done | failed | cancelled
    found: int = 0
    done: int = 0
    imported: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list = field(default_factory=list)
    finished: float | None = None
    message: str = ""

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}

    def error(self, name: str, why: str) -> None:
        self.failed += 1
        if len(self.errors) < IMPORT_ERRORS_KEPT:
            self.errors.append({"name": name[:120], "why": why[:200]})


class Importer:
    """One import at a time (``app["photos_import"]``)."""

    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.job: ImportJob | None = None
        self.task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def _proxy(self):
        hub = self.app.get("hub")
        proxy = hub.readproxy if hub is not None else None
        if proxy is None:
            raise PhotoError("ha_unavailable", "Mantel isn’t connected to Home Assistant.", 503)
        return proxy

    def start(self, source: object, album_id: str, ident, before: Before = None) -> ImportJob:
        if self.running:
            raise PhotoError("import_running", "An import is already running.", 409)
        if not isinstance(source, str) or not source.startswith(HA_SOURCE) or len(source) > 1000 or \
                any(ord(c) < 32 for c in source):
            raise PhotoError("bad_source", f"Give a Home Assistant media folder ({HA_SOURCE}…).")
        album = self.app["photos"].album(album_id)
        self._proxy()
        if before is not None:
            before({"source": source, "album": album["id"]})
        self.job = ImportJob(source=source, album=album["id"], album_name=album["name"], actor=ident.user.id,
                             started=self.app["photos"].clock())
        self.task = asyncio.get_running_loop().create_task(self._run(self.job, ident))
        return self.job

    def cancel(self) -> bool:
        if not self.running:
            return False
        self.task.cancel()
        return True

    async def _walk(self, job: ImportJob, cid: str, depth: int, out: list) -> None:
        res = await self._proxy().request({"type": "media_source/browse_media", "media_content_id": cid})
        subs = []
        for k in (res or {}).get("children") or [] if isinstance(res, dict) else []:
            if len(out) >= IMPORT_MAX:
                return
            if not isinstance(k, dict) or not isinstance(k.get("media_content_id"), str):
                continue
            if not k["media_content_id"].startswith(HA_SOURCE):
                continue                                            # only HA's media folders, never another source
            if k.get("can_expand"):
                if depth < IMPORT_DEPTH:
                    subs.append(k["media_content_id"])
            elif is_image(k):
                out.append((k["media_content_id"], str(k.get("title") or "")))
                job.found = len(out)
        for s in subs:
            await self._walk(job, s, depth + 1, out)

    async def fetch(self, cid: str, cap: int) -> bytes:
        """One picture's bytes from Home Assistant: resolved by Mantel (HA's signed path), read from HA Core."""
        res = await self._proxy().request({"type": "media_source/resolve_media", "media_content_id": cid},
                                          server_read=True)
        mime = res.get("mime_type") if isinstance(res, dict) else None
        path = signed_media_path(res.get("url") if isinstance(res, dict) else None)
        if path is None or not isinstance(mime, str) or not mime.lower().startswith("image/"):
            raise PhotoError("not_a_photo", "Home Assistant didn’t give a picture for it.")
        # HA Core itself (media_photos.core_url: under the App, ha_url is the Supervisor's proxy, which only passes
        # /api/…); HA's signature in the query is the credential (no token is sent)
        from .connectors.media_photos import core_url
        base = core_url(self.app["cfg"])
        http = self.app.get("http")
        if http is None:
            raise PhotoError("ha_unavailable", "Mantel isn’t connected to Home Assistant.", 503)
        async with http.get(base + path, allow_redirects=False, timeout=60) as r:
            if r.status != 200:
                raise PhotoError("ha_refused", f"Home Assistant answered {r.status}.")
            if r.content_length is not None and r.content_length > cap:
                raise PhotoError("too_large", f"It is bigger than the {cap >> 20} MB limit.", 413)
            buf = bytearray()
            async for chunk in r.content.iter_chunked(1 << 16):
                buf += chunk
                if len(buf) > cap:
                    raise PhotoError("too_large", f"It is bigger than the {cap >> 20} MB limit.", 413)
        return bytes(buf)

    async def _run(self, job: ImportJob, ident) -> None:
        lib: PhotoLibrary = self.app["photos"]
        try:
            items: list[tuple[str, str]] = []
            await self._walk(job, job.source, 0, items)
            job.state = "copying"
            for cid, title in items:
                name = title or unquote(cid.rsplit("/", 1)[-1])
                try:
                    data = await self.fetch(cid, lib.limits()["file_mb"] << 20)
                    _, dup = await lib.add(job.album, data, name, source="ha", user=job.actor)
                    if dup:
                        job.skipped += 1
                    else:
                        job.imported += 1
                except PhotoError as exc:
                    if exc.code in ("quota_exceeded", "album_not_found", "album_full"):
                        job.error(name, str(exc))
                        job.state, job.message = "failed", str(exc)
                        break
                    job.error(name, str(exc))
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 -- one picture's trouble is that picture's
                    job.error(name, f"{type(exc).__name__}: {exc}"[:200])
                job.done += 1
            if job.state != "failed":
                job.state = "done"
        except asyncio.CancelledError:
            job.state, job.message = "cancelled", "Stopped."
        except PhotoError as exc:
            job.state, job.message = "failed", str(exc)
        except Exception as exc:  # noqa: BLE001 -- the folder couldn't be read
            job.state = "failed"
            job.message = ("Home Assistant couldn’t list that folder: " + str(exc))[:300]
        finally:
            job.finished = lib.clock()
            _report(self.app, ident, "photos.import.finish", {
                "source": job.source, "album": job.album, "state": job.state, "found": job.found,
                "imported": job.imported, "skipped": job.skipped, "failed": job.failed})


# -- REST --------------------------------------------------------------------------------------------------
def _json(status: int, **body) -> web.Response:
    return web.json_response(body, status=status, headers=NO_STORE)


def _fail(exc: PhotoError) -> web.Response:
    return _json(exc.status, error=exc.code, message=str(exc))


def may_view(request: web.Request) -> bool:
    """A manager, or anyone (person or wall tablet) who may use ``feature:media`` -- as the HA folder's photos."""
    from . import sessions
    ident = sessions.identity(request)
    if ident.user is not None and ident.device is None and ident.user.role in MANAGERS:
        return True
    authz = request.app.get("authz")
    if authz is None:
        return False
    principal = authz.principal(request)
    return principal is not None and "feature:media" in (authz.may_read(principal, "view", ["feature:media"]) or [])


def _report(app: web.Application, ident, action: str, detail: dict) -> None:
    """An import's result, when it ends: a report, not a change (its start was audited first), so a failure is
    logged and nothing more."""
    try:
        audit.config(None, ident, action, detail, app=app)
    except audit.Unavailable:
        pass                                    # (audit.config logged it)


def _first(request: web.Request, ident, action: str) -> Callable[[dict], None]:
    """The ``before`` a change is handed: its audit row, written first (503 and no change without it)."""
    return lambda detail: audit.config(request, ident, action, detail)


async def _body(request: web.Request) -> dict:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise PhotoError("bad_json", "Send a JSON object.")
    if not isinstance(body, dict):
        raise PhotoError("bad_json", "Send a JSON object.")
    return body


def _lib(request: web.Request) -> PhotoLibrary:
    return request.app["photos"]


def backup_info(app: web.Application) -> dict:
    cfg = app["cfg"]
    return {"mantel": bool(getattr(cfg, "backup_include_files", True)),
            "nightly": getattr(cfg, "backup_target", None) is not None,
            "home_assistant": bool(getattr(cfg, "ha_managed_by_app", False))}


# Mantel Photos is managed by an Owner or Admin, never at a wall tablet; an Owner sets its limits and imports.
@guard("manager")
async def api_overview(request: web.Request) -> web.Response:
    ident = guarded(request)
    lib = _lib(request)
    imp: Importer = request.app["photos_import"]
    return _json(200, ok=True, albums=lib.albums(), usage=lib.usage(), photos=lib.count(), limits=lib.limits(),
                 screens=lib.screens(), backup=backup_info(request.app), owner=ident.user.role == "owner",
                 importing=imp.job.as_dict() if imp.job is not None else None,
                 faces=request.app["photos_faces"].status(), cutouts=request.app["photos_cutouts"].status())


@guard("manager", audit="photos.album.create")
async def api_album_create(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        album = _lib(request).create_album((await _body(request)).get("name"),
                                           before=_first(request, ident, "photos.album.create"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(201, ok=True, album=album)


@guard("manager", audit="photos.album.rename")
async def api_album_rename(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        got = _lib(request).rename_album(request.match_info["album"], (await _body(request)).get("name"),
                                         before=_first(request, ident, "photos.album.rename"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, album={"id": got["id"], "name": got["name"]})


@guard("manager", audit="photos.album.delete")
async def api_album_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        got = await _lib(request).delete_album(request.match_info["album"],
                                               before=_first(request, ident, "photos.album.delete"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, **got)


@guard("manager", audit="photos.album.options")
async def api_album_options(request: web.Request) -> web.Response:
    """An album's options: Only Photos That Qualify (for Time Behind)."""
    ident = guarded(request)
    try:
        got = _lib(request).set_album_options(request.match_info["album"], await _body(request),
                                              before=_first(request, ident, "photos.album.options"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, album=got)


@guard("manager")
async def api_album_photos(request: web.Request) -> web.Response:
    try:
        lib = _lib(request)
        album = lib.album(request.match_info["album"])
        return _json(200, ok=True, album=album, photos=lib.photos(album["id"]))
    except PhotoError as exc:
        return _fail(exc)


@guard("manager", audit="photos.focus")
async def api_focus(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        got = _lib(request).set_focus(request.match_info["photo"], await _body(request),
                                      before=_first(request, ident, "photos.focus"))
    except PhotoError as exc:
        return _fail(exc)
    f = got["focus"]
    return _json(200, ok=True, id=got["id"], faces=got["faces"], focus=f)


@guard("manager", audit="photos.upload")
async def api_upload(request: web.Request) -> web.Response:
    ident = guarded(request)
    from .user_files import FileError, read_upload
    lib = _lib(request)
    try:
        album = lib.album(request.match_info["album"])
        cap = lib.limits()["file_mb"] << 20
        try:
            data, filename, _ = await read_upload(request, cap)
        except FileError as exc:
            raise PhotoError(exc.code, str(exc), exc.status) from exc
        photo, dup = await lib.add(album["id"], data, filename or "", user=ident.user.id,
                                   before=_first(request, ident, "photos.upload"))
    except PhotoError as exc:
        return _fail(exc)
    if dup:
        return _json(200, ok=True, duplicate=True, photo=photo)
    return _json(201, ok=True, duplicate=False, photo=photo, usage=lib.usage())


@guard("manager", audit="photos.delete")
async def api_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        gone = await _lib(request).delete((await _body(request)).get("ids"), before=_first(request, ident, "photos.delete"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, deleted=gone)


@guard("manager", audit="photos.move")
async def api_move(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        body = await _body(request)
        moved, skipped = await _lib(request).move(body.get("ids"), body.get("album"),
                                                  before=_first(request, ident, "photos.move"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, moved=moved, skipped=skipped)


@guard("owner", audit="photos.limits")
async def api_limits(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        after = _lib(request).set_limits(await _body(request), before=_first(request, ident, "photos.limits"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, limits=after)


@guard("manager", audit="photos.screen")
async def api_set_screen(request: web.Request) -> web.Response:
    ident = guarded(request)
    screen = request.match_info["screen"]
    try:
        album = _lib(request).set_screen(screen, (await _body(request)).get("album"),
                                         before=_first(request, ident, "photos.screen"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(200, ok=True, screen=screen, album=album)


@guard("owner", audit="photos.import.start")
async def api_import_start(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        body = await _body(request)
        job = request.app["photos_import"].start(body.get("source"), body.get("album"), ident,
                                                 before=_first(request, ident, "photos.import.start"))
    except PhotoError as exc:
        return _fail(exc)
    return _json(202, ok=True, importing=job.as_dict())


@guard("manager")
async def api_import_status(request: web.Request) -> web.Response:
    job = request.app["photos_import"].job
    return _json(200, ok=True, importing=job.as_dict() if job is not None else None)


@guard("manager")
async def api_faces(request: web.Request) -> web.Response:
    """Keep in View's look through the library: how far it has got (Mantel Settings → Photos polls it)."""
    return _json(200, ok=True, faces=request.app["photos_faces"].status())


@guard("manager")
async def api_cutouts(request: web.Request) -> web.Response:
    """Time Behind's cut-outs through the library: how far they have got, and why there are none when the model
    can't run here (Mantel Settings → Photos)."""
    status = request.app["photos_cutouts"].status()
    if status["state"] == "unavailable":
        status["why"] = cutter.why_not()
    return _json(200, ok=True, cutouts=status)


@guard("owner", audit="photos.import.cancel")
async def api_import_cancel(request: web.Request) -> web.Response:
    ident = guarded(request)
    imp: Importer = request.app["photos_import"]
    if not imp.running:
        return _json(409, error="not_running", message="No import is running.")
    audit.config(request, ident, "photos.import.cancel", {})
    imp.cancel()
    return _json(200, ok=True)


# -- what the screensavers read ------------------------------------------------------------------------------
def _nothing() -> web.Response:
    return web.json_response({"error": "not_found"}, status=404, headers=NO_STORE)


# what the screensavers read: any session that may use feature:media (the roles decide, may_view)
@guard("signed_in")
async def api_screens(request: web.Request) -> web.Response:
    """Which screens show an album (the page's host asks once and after a change)."""
    if not may_view(request):
        return _nothing()
    return web.json_response({"screens": _lib(request).screens()}, headers={"Cache-Control": "no-cache"})


@guard("signed_in")
async def api_show(request: web.Request) -> web.Response:
    """An album as a screensaver shows it: its screen-sized photos' addresses (without the page's prefix)."""
    if not may_view(request):
        return _nothing()
    lib = _lib(request)
    try:
        album = lib.album(request.match_info["album"])
    except PhotoError:
        return _nothing()
    only = bool(lib.db.execute("SELECT depth_only FROM photo_albums WHERE id=?", (album["id"],)).fetchone()[0])
    rows = lib.db.execute("SELECT id, name, width, height, faces, focus_x, focus_y, cutout_at, cutout_ok, depth_box, "
                          "taken FROM photos WHERE album_id=?" + (" AND cutout_ok = 1" if only else "") +
                          " ORDER BY created, id", (album["id"],))
    out = []
    for r in rows:
        item = {"id": r["id"], "title": r["name"], "w": r["width"], "h": r["height"],
                "url": f"/api/photos/{r['id']}/screen"}
        if r["focus_x"] is not None and r["focus_y"] is not None:
            item["focus"] = [r["focus_x"], r["focus_y"]]            # set by hand: the screens centre on it
        found = stored_faces(r["faces"])
        if found:
            item["faces"] = [[round(float(v), 4) for v in f[:4]] for f in found]
        # TIME BEHIND: a usable photo's cut-out and where the time goes (the address changes with a new cut-out)
        box = stored_box(r["depth_box"]) if r["cutout_ok"] else None
        if box is not None:
            item["depth"] = {"mask": f"/api/photos/{r['id']}/mask?v={int(r['cutout_at'] or 0)}", "box": box}
        if isinstance(r["taken"], int):
            item["year"] = r["taken"]                               # Photo Titles: the year it was taken
        out.append(item)
    return web.json_response({"album": album, "photos": out}, headers={"Cache-Control": "no-cache"})


@guard("signed_in")          # an original for a manager only; the screen sizes for whoever may view (below)
async def serve(request: web.Request) -> web.StreamResponse:
    size, pid = request.match_info["size"], request.match_info["photo"]
    if size == "original":
        from . import sessions
        ident = sessions.identity(request)
        allowed = ident.user is not None and ident.device is None and ident.user.role in MANAGERS
    else:
        allowed = may_view(request)
    headers = IMMUTABLE
    if allowed and size == "mid":
        path = await _lib(request).mid_path(pid)
        if path is None:                            # being made (or no place free to make it): the 2560 px photo now
            path, headers = _lib(request).path(pid, "screen"), MID_PENDING
    else:
        path = _lib(request).path(pid, size) if allowed else None
    if path is None:
        return _nothing()
    resp = web.FileResponse(path, headers=headers)
    resp.content_type = SIZES[size][2]
    return resp


def register(app: web.Application, hub=None) -> None:
    """The library (``app["photos"]``), its import (``app["photos_import"]``), the faces backfill
    (``app["photos_faces"]``), the cut-outs' (``app["photos_cutouts"]``) and the routes."""
    cfg = app["cfg"]
    lib = PhotoLibrary(Path(cfg.data_dir).expanduser() / "photos", app["store"].db, lambda: app["clock"]())
    app["photos"] = lib
    app["photos_import"] = Importer(app)
    r = app.router
    r.add_get("/api/photos", api_overview)
    r.add_post("/api/photos/albums", api_album_create)
    r.add_patch(r"/api/photos/albums/{album:[0-9a-f]{16}}", api_album_rename)
    r.add_delete(r"/api/photos/albums/{album:[0-9a-f]{16}}", api_album_delete)
    r.add_get(r"/api/photos/albums/{album:[0-9a-f]{16}}/photos", api_album_photos)
    r.add_post(r"/api/photos/albums/{album:[0-9a-f]{16}}/upload", api_upload)
    r.add_get(r"/api/photos/albums/{album:[0-9a-f]{16}}/show", api_show)
    r.add_put(r"/api/photos/albums/{album:[0-9a-f]{16}}/options", api_album_options)
    r.add_post("/api/photos/delete", api_delete)
    r.add_post("/api/photos/move", api_move)
    r.add_put("/api/photos/limits", api_limits)
    r.add_get("/api/photos/screens", api_screens)
    r.add_put(r"/api/photos/screens/{screen}", api_set_screen)
    r.add_get("/api/photos/import", api_import_status)
    r.add_post("/api/photos/import", api_import_start)
    r.add_delete("/api/photos/import", api_import_cancel)
    r.add_get("/api/photos/faces", api_faces)
    r.add_get("/api/photos/cutouts", api_cutouts)
    r.add_put(r"/api/photos/{photo:[0-9a-f]{32}}/focus", api_focus)
    r.add_get(r"/api/photos/{photo:[0-9a-f]{32}}/{size:original|screen|mid|thumb|mask}", serve)
    app["photos_faces"] = FaceBackfill(app)
    app["photos_cutouts"] = CutoutBackfill(app)

    async def begin(_app: web.Application) -> None:
        _app["photos_faces"].start()
        _app["photos_cutouts"].start()

    async def stop(_app: web.Application) -> None:
        _app["photos_import"].cancel()
        _app["photos_faces"].cancel()
        _app["photos_cutouts"].cancel()

    app.on_startup.append(begin)
    app.on_cleanup.append(stop)
