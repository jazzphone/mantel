"""Encrypted backups of Mantel's database (and uploaded files), and a restore that checks before it swaps.

PLAN §7 "Container and host": a nightly encrypted SQLite backup to the NAS, restore tested.

**What a backup is.** One file, ``mantel-YYYYmmdd-HHMMSS.mbk`` (UTC), in the target folder. Inside, sealed
with AES-256-GCM, is a gzip-compressed tar holding

* ``mantel.db``      a consistent snapshot made with SQLite's online backup API (safe while the server
                     writes, WAL included), checked with ``PRAGMA integrity_check`` before it is packed;
* ``manifest.json``  schema version, row counts per table, when, and what else is inside;
* ``user-files/...`` the "Your files" tree (user_files.py), unless switched off;
* ``photos/...``     Mantel Photos (photos.py: originals, screen-sized copies, thumbnails), with "Your files";
* ``connections/...`` Mantel's own HA/MA credentials from the Connections page (connections.py), as the sealed
                     files they are (sealed with the at-rest key, so a restore needs that key too);
* ``connect/...``    Mantel Connect's certificate authority and listener certificate (connect_pairing.py
                     ``Pki``: ca.key, ca.crt, server.key, server.crt). The pairings themselves are rows in the
                     database, and the paired Apps hold certificates signed by this CA, so without it a
                     restored Mantel makes a new CA and every Connect App must be paired again. The private
                     keys are plain PEM files on the data volume, so here they are protected only by the
                     backup's own encryption: like everything else, they never leave this file unsealed.

**The key.** ``<secrets_dir>/backup.key`` (base64url of 32 random bytes, 0600; created on the first backup,
with a loud notice, if it is missing). It is *separate from* the at-rest key (``at_rest.key``): the backups
sit on the NAS, the at-rest key sits with the server, and neither key is derived from the other, so one
stolen place does not open the other. Per file the encryption key and a header-check key are derived from
it with HKDF-SHA256 and a random 16-byte salt, so the same key never encrypts two files under one key.
**Keep a copy of backup.key and of at_rest.key somewhere that is not this machine**: the database holds
values sealed with the at-rest key (TOTP seeds and the like), and the backups are unreadable without
backup.key.

**File layout** (all integers big-endian)::

    "MANTELBK"  8   magic
    version     1   (1)
    salt        16  HKDF salt
    nonce       8   random prefix of every chunk's nonce (a 4-byte chunk counter follows it)
    chunk       4   plaintext bytes per chunk (1 MiB)
    meta_len    2
    meta        n   JSON, readable without the key: {"format","created","created_ts","schema","files"}
    check       32  HMAC-SHA256(header-check key, everything above): a wrong key is told apart from damage
    chunks...       each: AES-GCM(plaintext chunk) + 16-byte tag; the associated data is
                    sha256(header) + chunk counter + a final-chunk flag, so a reordered, dropped, cut-off or
                    edited chunk fails to open

**Rotation.** After a good backup, files in the target that match the backup name pattern are thinned:
the newest backup of each of the last ``keep_daily`` days that have one, plus the newest of each of the
last ``keep_weekly`` ISO weeks that have one (UTC). The backup just written is always kept. Nothing else in
the folder is touched.

**Restore** (``mantel-server restore``) decrypts into a staging folder inside the destination data dir,
opens the restored database and checks it (integrity_check, foreign_key_check, schema version known to this
build, row counts as the manifest says, and that this build's migrations run on it), and only then moves it
into place. A data dir that already holds a database is refused unless ``--replace``, which moves the old
files aside (``*.before-restore-<time>``), never deletes them. ``--verify-only`` does everything except the
move: that is the "is this backup any good" test. It stages in the data dir as well (not the container's
small tmpfs /tmp), in a hidden folder it removes again.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import gzip
import hashlib
import hmac
import io
import json
import logging
import os
import re
import shutil
import sqlite3
import struct
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from aiohttp import web
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from . import atrest, db as dbmod

log = logging.getLogger("mantel.backup")

MAGIC = b"MANTELBK"
VERSION = 1
CHUNK = 1 << 20
TAG = 16
KEY_FILE = "backup.key"
NAME = re.compile(r"^mantel-(\d{8})-(\d{6})\.mbk$")
FORMAT = "mantel-backup"
MAX_META = 4096
MAX_UNPACKED = 16 << 30            # a decompression-bomb guard on restore (16 GiB)
DB_NAME = "mantel.db"
FILES_DIR = "user-files"
CONNECTIONS_DIR = "connections"     # connections.py: <data_dir>/connections, sealed files
PHOTOS_DIR = "photos"               # photos.py: <data_dir>/photos (the rows are in the database)
CONNECT_DIR = "connect"             # connect_pairing.py: <data_dir>/connect, the Connect CA (private keys)
KEYS_DIR = "keys"                   # app_crypto.KEYS_DIR: the push key and the apps' identity key
DEFAULT_TIME = "03:15"


class BackupError(Exception):
    """``code`` is stable (tests and the REST answer use it); the message is for people."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# -- the key ----------------------------------------------------------------------------------------
def load_key(path: Path, *, create: bool = False) -> tuple[bytes, bool]:
    """(key, created). Restoring never creates a key: an invented key could only fail to open anything."""
    path = Path(path).expanduser()
    if not path.exists():
        if not create:
            raise BackupError("key_missing", f"the backup key file {path} does not exist")
        return atrest.load_or_create_key(path), True
    try:
        return atrest.load_or_create_key(path), False
    except atrest.SecretKeyError as exc:
        raise BackupError("key_invalid", str(exc).replace("at-rest", "backup")) from exc


def _derive(key: bytes, salt: bytes) -> tuple[bytes, bytes]:
    def one(info: bytes) -> bytes:
        return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info).derive(key)
    return one(b"mantel-backup v1 encryption"), one(b"mantel-backup v1 header check")


# -- the sealed container ---------------------------------------------------------------------------
def _header(salt: bytes, prefix: bytes, meta: dict) -> bytes:
    body = json.dumps(meta, separators=(",", ":"), sort_keys=True).encode()
    if len(body) > MAX_META:
        raise BackupError("meta_too_big", "backup metadata is too large")
    return MAGIC + bytes([VERSION]) + salt + prefix + struct.pack(">IH", CHUNK, len(body)) + body


def _aad(header_digest: bytes, counter: int, final: bool) -> bytes:
    return header_digest + struct.pack(">I", counter) + (b"\x01" if final else b"\x00")


def _blocks(src, size: int):
    """(block, is_last) for a stream, reading one block ahead; an empty stream is one empty last block."""
    block = src.read(size)
    while True:
        nxt = src.read(size) if len(block) == size else b""
        yield block, not nxt
        if not nxt:
            return
        block = nxt


def seal_stream(src, dst, key: bytes, meta: dict) -> None:
    salt, prefix = os.urandom(16), os.urandom(8)
    enc_key, check_key = _derive(key, salt)
    head = _header(salt, prefix, meta)
    head += hmac.new(check_key, head, hashlib.sha256).digest()
    digest = hashlib.sha256(head).digest()
    dst.write(head)
    aead = AESGCM(enc_key)
    for n, (block, last) in enumerate(_blocks(src, CHUNK)):
        dst.write(aead.encrypt(prefix + struct.pack(">I", n), block, _aad(digest, n, last)))


def read_meta(path: Path) -> dict:
    """The cleartext metadata of a backup file (not authenticated until it is opened with the key)."""
    with open(path, "rb") as f:
        return _read_header(f)[0]


def _read_header(f) -> tuple[dict, bytes, bytes, bytes, bytes]:
    fixed = f.read(len(MAGIC) + 1 + 16 + 8 + 6)
    if len(fixed) < len(MAGIC) + 31 or fixed[:8] != MAGIC:
        raise BackupError("not_a_backup", "this is not a Mantel backup file")
    if fixed[8] != VERSION:
        raise BackupError("unsupported_version", f"backup format version {fixed[8]} is not understood by this build")
    salt, prefix = fixed[9:25], fixed[25:33]
    chunk, meta_len = struct.unpack(">IH", fixed[33:39])
    if chunk != CHUNK or meta_len > MAX_META:
        raise BackupError("corrupt", "the backup header is damaged")
    body = f.read(meta_len)
    check = f.read(32)
    if len(body) != meta_len or len(check) != 32:
        raise BackupError("corrupt", "the backup is cut off inside its header")
    try:
        meta = json.loads(body)
    except ValueError as exc:
        raise BackupError("corrupt", "the backup header is damaged") from exc
    return meta, fixed + body, check, salt, prefix


def open_stream(path: Path, dst, key: bytes) -> dict:
    """Decrypt ``path`` into the binary file ``dst``. Raises BackupError: wrong_key, corrupt, not_a_backup."""
    with open(path, "rb") as f:
        meta, head, check, salt, prefix = _read_header(f)
        enc_key, check_key = _derive(key, salt)
        if not hmac.compare_digest(check, hmac.new(check_key, head, hashlib.sha256).digest()):
            raise BackupError("wrong_key", "this is not the key for that backup (or its header is damaged)")
        digest = hashlib.sha256(head + check).digest()
        aead = AESGCM(enc_key)
        got_any = False
        for n, (block, last) in enumerate(_blocks(f, CHUNK + TAG)):
            got_any = True
            try:
                dst.write(aead.decrypt(prefix + struct.pack(">I", n), block, _aad(digest, n, last)))
            except InvalidTag as exc:
                raise BackupError("corrupt", "the backup is damaged or cut short: it does not open") from exc
        if not got_any:
            raise BackupError("corrupt", "the backup has no data")
    return meta


# -- the snapshot -----------------------------------------------------------------------------------
def snapshot_db(src: Path, dst: Path) -> dict:
    """Copy the live database with the online backup API into ``dst`` (a single plain file) and check it.
    Returns {"schema": N, "tables": {name: rows}}. Safe while another connection is writing."""
    src = Path(src)
    if not src.is_file():
        raise BackupError("no_database", f"there is no database at {src}")
    source = sqlite3.connect(str(src), timeout=30)
    target = sqlite3.connect(str(dst))
    try:
        source.backup(target)                      # consistent, WAL included
        target.execute("PRAGMA journal_mode = DELETE")
        problems = [r[0] for r in target.execute("PRAGMA integrity_check")]
        if problems != ["ok"]:
            raise BackupError("snapshot_failed", f"the snapshot failed its integrity check: {problems[:3]}")
        return _describe(target)
    finally:
        target.close()
        source.close()


def _describe(conn: sqlite3.Connection) -> dict:
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    counts = {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
    try:
        schema = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]
    except sqlite3.Error:
        schema = 0
    return {"schema": schema, "tables": counts}


# -- making a backup --------------------------------------------------------------------------------
def backup_name(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("mantel-%Y%m%d-%H%M%S.mbk")


def _stamp(name: str) -> datetime | None:
    m = NAME.match(name)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@dataclass(frozen=True)
class BackupInfo:
    path: Path
    created: datetime
    size: int

    def as_dict(self) -> dict:
        return {"name": self.path.name, "created": self.created.isoformat(), "size": self.size}


def list_backups(target: Path) -> list[BackupInfo]:
    """Backups in ``target``, newest first (by the time in the file name)."""
    out = []
    try:
        entries = list(Path(target).iterdir())
    except OSError:
        return []
    for p in entries:
        when = _stamp(p.name)
        if when is not None and p.is_file() and not p.is_symlink():
            out.append(BackupInfo(p, when, p.stat().st_size))
    return sorted(out, key=lambda b: b.created, reverse=True)


def _add_tree(tar: tarfile.TarFile, root: Path, arc: str) -> int:
    n = 0
    for base, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(base) / d).is_symlink())
        for name in sorted(names):
            p = Path(base) / name
            if p.is_symlink() or not p.is_file():
                continue
            tar.add(p, arcname=f"{arc}/{p.relative_to(root).as_posix()}", recursive=False)
            n += 1
    return n


def create_backup(data_dir: Path, target: Path, key: bytes, *, now: datetime | None = None,
                  include_files: bool = True, keep_daily: int = 7, keep_weekly: int = 4,
                  rotate_after: bool = True) -> Path:
    """Write one encrypted backup of ``data_dir`` into ``target`` and thin the old ones. Returns its path.
    ``target`` must already exist (a missing NAS mount must not turn into a folder on the local disk)."""
    data_dir, target = Path(data_dir).expanduser(), Path(target).expanduser()
    if not target.is_dir():
        raise BackupError("target_missing", f"the backup target {target} does not exist (is the NAS mounted?)")
    if not (data_dir / DB_NAME).is_file():
        raise BackupError("no_database", f"there is no database at {data_dir / DB_NAME}")
    now = now or datetime.now(timezone.utc)
    dest = target / backup_name(now)
    tmp = target / f".{dest.name}.tmp"
    # The plaintext snapshot and archive live in a 0700 folder on the LOCAL disk, never on the target:
    # only the sealed file touches the NAS.
    with tempfile.TemporaryDirectory(prefix=".backup-work-", dir=data_dir) as work_s:
        work = Path(work_s)
        os.chmod(work, 0o700)
        info = snapshot_db(data_dir / DB_NAME, work / DB_NAME)
        files_root = data_dir / FILES_DIR
        with_files = include_files and files_root.is_dir()
        manifest = {"format": FORMAT, "created": now.astimezone(timezone.utc).isoformat(), "created_ts": now.timestamp(),
                    "schema": info["schema"], "tables": info["tables"], "files": with_files}
        payload = work / "payload.tar.gz"
        with open(payload, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz, \
                tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
            tar.add(work / DB_NAME, arcname=DB_NAME, recursive=False)
            if with_files:
                manifest["file_count"] = _add_tree(tar, files_root, FILES_DIR)
            photos_root = data_dir / PHOTOS_DIR
            if include_files and photos_root.is_dir():
                manifest["photos"] = _add_tree(tar, photos_root, PHOTOS_DIR)
            conn_root = data_dir / CONNECTIONS_DIR
            if conn_root.is_dir():
                manifest["connections"] = _add_tree(tar, conn_root, CONNECTIONS_DIR)
            for name in (CONNECT_DIR, KEYS_DIR):
                root = data_dir / name
                if root.is_dir():
                    manifest[name] = _add_tree(tar, root, name)
            blob = json.dumps(manifest, indent=1, sort_keys=True).encode()
            member = tarfile.TarInfo("manifest.json")
            member.size, member.mtime = len(blob), int(now.timestamp())
            tar.addfile(member, io.BytesIO(blob))
        meta = {"format": FORMAT, "created": manifest["created"], "created_ts": manifest["created_ts"],
                "schema": info["schema"], "files": with_files}
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as out, open(payload, "rb") as src:
                seal_stream(src, out, key, meta)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, dest)
        except OSError as exc:
            with contextlib.suppress(OSError):
                tmp.unlink()
            raise BackupError("write_failed", f"could not write the backup to {target}: {exc}") from exc
    if rotate_after:
        rotate(target, keep_daily, keep_weekly, keep=dest)
    log.info("backup written: %s (%d bytes, schema %s)", dest, dest.stat().st_size, info["schema"])
    return dest


def rotate(target: Path, keep_daily: int, keep_weekly: int, keep: Path | None = None) -> list[Path]:
    """Delete backups not covered by the daily/weekly rule (see the module docstring). Returns what went."""
    backups = list_backups(target)
    wanted: set[Path] = {keep} if keep is not None else set()
    seen_days: list = []
    seen_weeks: list = []
    for b in backups:                                           # newest first: the first of a day/week is its newest
        day = b.created.date()
        week = tuple(b.created.isocalendar())[:2]
        if day not in seen_days and len(seen_days) < max(keep_daily, 1):
            seen_days.append(day)
            wanted.add(b.path)
        if week not in seen_weeks and len(seen_weeks) < max(keep_weekly, 0):
            seen_weeks.append(week)
            wanted.add(b.path)
    if backups:
        wanted.add(backups[0].path)                             # never delete the newest
    removed = []
    for b in backups:
        if b.path not in wanted:
            try:
                b.path.unlink()
                removed.append(b.path)
            except OSError as exc:
                log.warning("could not remove the old backup %s: %s", b.path, exc)
    return removed


# -- restoring --------------------------------------------------------------------------------------
@dataclass
class RestoreReport:
    schema: int
    created: str
    tables: dict
    files: int
    migrated: list
    replaced: list
    verified_only: bool

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _safe_member(name: str) -> str | None:
    p = Path(name)
    if p.is_absolute() or ".." in p.parts or not p.parts or "\\" in name:
        return None
    return p.as_posix()


def _unpack(payload: Path, out: Path) -> tuple[dict, int]:
    """Extract the tar by hand: only regular files and folders under the known names."""
    out.mkdir()
    total = files = 0
    manifest = None
    try:
        tar = tarfile.open(payload, mode="r:gz")
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise BackupError("corrupt", "the backup opened but its contents are not a valid archive") from exc
    with tar:
        try:
            for m in tar:
                name = _safe_member(m.name)
                trees = (FILES_DIR, CONNECTIONS_DIR, PHOTOS_DIR, CONNECT_DIR, KEYS_DIR)
                if name is None or not (name in (DB_NAME, "manifest.json") or name in trees
                                        or any(name.startswith(tree + "/") for tree in trees)):
                    raise BackupError("corrupt", f"the backup contains an unexpected entry {m.name!r}")
                if m.isdir():
                    (out / name).mkdir(parents=True, exist_ok=True)
                    continue
                if not m.isreg():
                    raise BackupError("corrupt", f"the backup contains a non-file entry {m.name!r}")
                total += m.size
                if total > MAX_UNPACKED:
                    raise BackupError("corrupt", "the backup unpacks to an implausible size")
                dest = out / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(m)
                with open(dest, "wb") as f:
                    shutil.copyfileobj(src, f)
                if name == "manifest.json":
                    manifest = json.loads(dest.read_bytes())
                elif name.startswith(FILES_DIR + "/"):
                    files += 1
        except (tarfile.TarError, EOFError, OSError, ValueError) as exc:
            if isinstance(exc, BackupError):
                raise
            raise BackupError("corrupt", f"the backup's archive is damaged: {exc}") from exc
    if manifest is None or not (out / DB_NAME).is_file():
        raise BackupError("corrupt", "the backup has no database or manifest")
    return manifest, files


def verify_database(path: Path, manifest: dict, migrations_folder: Path = dbmod.MIGRATIONS) -> list[int]:
    """Check a restored database file and bring it to this build's schema. Returns the migrations applied now.
    Raises BackupError."""
    known = {m.version: m for m in dbmod.discover(migrations_folder)}
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        try:
            bad = [r[0] for r in conn.execute("PRAGMA integrity_check")]
        except sqlite3.DatabaseError as exc:
            raise BackupError("database_invalid", f"the restored database is not readable: {exc}") from exc
        if bad != ["ok"]:
            raise BackupError("database_invalid", f"the restored database failed integrity_check: {bad[:3]}")
        broken = conn.execute("PRAGMA foreign_key_check").fetchall()
        if broken:
            raise BackupError("database_invalid", f"the restored database has {len(broken)} broken foreign keys")
        try:
            versions = [r[0] for r in conn.execute("SELECT version FROM schema_version")]
        except sqlite3.Error as exc:
            raise BackupError("database_invalid", "the restored database has no schema_version table") from exc
        if not versions:
            raise BackupError("database_invalid", "the restored database has an empty schema_version table")
        unknown = sorted(v for v in versions if v not in known)
        if unknown:
            raise BackupError("schema_too_new", f"the backup is from a newer Mantel (schema {max(unknown):04d}); "
                                                f"this build knows up to {max(known):04d}. Update Mantel first")
        have = _describe(conn)
        for table, rows in (manifest.get("tables") or {}).items():
            if have["tables"].get(table) != rows:
                raise BackupError("database_invalid", f"table {table} has {have['tables'].get(table)} rows; "
                                                      f"the manifest says {rows}")
        applied = dbmod.migrate(conn, migrations_folder)         # an older backup must come up to this build
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode = DELETE")
        return applied
    except dbmod.MigrationError as exc:
        raise BackupError("migration_failed", f"this build's migrations do not run on the backup: {exc}") from exc
    finally:
        conn.close()


def restore(backup: Path, key: bytes, data_dir: Path, *, replace: bool = False, verify_only: bool = False,
            now: datetime | None = None, migrations_folder: Path = dbmod.MIGRATIONS) -> RestoreReport:
    """Decrypt, check, and (unless ``verify_only``) move a backup into ``data_dir``.
    Refuses a data dir that already has a database unless ``replace`` (then the old files are moved aside)."""
    backup, data_dir = Path(backup).expanduser(), Path(data_dir).expanduser()
    now = now or datetime.now(timezone.utc)
    if not backup.is_file():
        raise BackupError("not_found", f"no such backup file: {backup}")
    live = data_dir / DB_NAME
    sidecars = [data_dir / (DB_NAME + s) for s in ("-wal", "-shm", "-journal")]
    if not verify_only and not replace and (live.exists() or any(s.exists() for s in sidecars)):
        raise BackupError("data_dir_not_fresh", f"{data_dir} already has a Mantel database; restore into a fresh "
                                                "folder, or pass --replace (the old files are moved aside)")
    if verify_only:
        # Staged under the data folder too, never the system's temp folder: in the container /tmp is a
        # small tmpfs (64 MB in compose.yaml), and a backup with many photos unpacks to far more than that.
        # The data volume has the room the data itself needs. Only a hidden 0700 .restore-* folder appears
        # there, removed when the check ends; the live files are not touched. A data folder that does not
        # exist is not made for a mere check: then the system's temp folder it is.
        stage_parent = data_dir if data_dir.is_dir() else None
    else:
        data_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(data_dir, 0o700)
        stage_parent = data_dir
    stage = Path(tempfile.mkdtemp(prefix=".restore-", dir=stage_parent))
    try:
        os.chmod(stage, 0o700)
        payload = stage / "payload.tar.gz"
        with open(payload, "wb") as out:
            meta = open_stream(backup, out, key)
        manifest, nfiles = _unpack(payload, stage / "unpacked")
        payload.unlink()
        if manifest.get("format") != FORMAT:
            raise BackupError("corrupt", "the backup's manifest is not a Mantel manifest")
        staged_db = stage / "unpacked" / DB_NAME
        migrated = verify_database(staged_db, manifest, migrations_folder)
        for p in staged_db.parent.glob(DB_NAME + "-*"):
            p.unlink()
        files_tree = stage / "unpacked" / FILES_DIR
        report = RestoreReport(schema=int(manifest.get("schema", 0)), created=str(meta.get("created", "")),
                               tables=manifest.get("tables", {}), files=nfiles, migrated=migrated, replaced=[],
                               verified_only=verify_only)
        if verify_only:
            return report
        # -- the swap: preconditions are settled; move the old aside, the new in --------------------
        suffix = ".before-restore-" + now.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
        moved: list[tuple[Path, Path]] = []
        try:
            conn_tree = stage / "unpacked" / CONNECTIONS_DIR
            photos_tree = stage / "unpacked" / PHOTOS_DIR
            # a backup made before the Connect CA (or the keys) was included has none: then the CA here stays
            # (it may still be the one the paired Apps know), as connections/ does
            connect_tree = stage / "unpacked" / CONNECT_DIR
            keys_tree = stage / "unpacked" / KEYS_DIR
            # a backup made without the files (--backup-no-files) holds no photos or Your Files: the live
            # ones stay, rather than leaving the restored rows pointing at files moved aside
            with_files = manifest.get("files") is True or files_tree.is_dir() or photos_tree.is_dir()
            for p in [live, *sidecars] + \
                    ([data_dir / FILES_DIR, data_dir / PHOTOS_DIR] if with_files else []) + \
                    ([data_dir / CONNECTIONS_DIR] if conn_tree.is_dir() else []) + \
                    ([data_dir / CONNECT_DIR] if connect_tree.is_dir() else []) + \
                    ([data_dir / KEYS_DIR] if keys_tree.is_dir() else []):
                if p.exists() or p.is_symlink():
                    aside = p.with_name(p.name + suffix)
                    n = 1
                    while aside.exists():
                        n += 1
                        aside = p.with_name(f"{p.name}{suffix}.{n}")
                    os.replace(p, aside)
                    moved.append((p, aside))
            os.replace(staged_db, live)
            os.chmod(live, 0o600)
            if files_tree.is_dir():
                os.replace(files_tree, data_dir / FILES_DIR)
            if photos_tree.is_dir():
                os.replace(photos_tree, data_dir / PHOTOS_DIR)
                for base, dirs, names in os.walk(data_dir / PHOTOS_DIR):
                    os.chmod(base, 0o700)
                    for n in names:
                        os.chmod(Path(base) / n, 0o600)
            if conn_tree.is_dir():
                os.replace(conn_tree, data_dir / CONNECTIONS_DIR)
                os.chmod(data_dir / CONNECTIONS_DIR, 0o700)
                for f in (data_dir / CONNECTIONS_DIR).iterdir():
                    os.chmod(f, 0o600)
            for name, tree in ((CONNECT_DIR, connect_tree), (KEYS_DIR, keys_tree)):
                if tree.is_dir():
                    os.replace(tree, data_dir / name)
                    os.chmod(data_dir / name, 0o700)          # private keys: as Pki.ensure keeps them
                    for f in (data_dir / name).iterdir():
                        if f.is_file():
                            os.chmod(f, 0o600)
        except OSError as exc:
            for original, aside in reversed(moved):                  # put the old data back
                with contextlib.suppress(OSError):
                    if original.exists():
                        original.unlink() if original.is_file() else shutil.rmtree(original)
                    os.replace(aside, original)
            raise BackupError("swap_failed", f"could not move the restored data into place: {exc}") from exc
        report.replaced = [str(a) for _, a in moved]
        return report
    finally:
        shutil.rmtree(stage, ignore_errors=True)


# -- the schedule -----------------------------------------------------------------------------------
def parse_time(text: str) -> tuple[int, int]:
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", (text or "").strip())
    if not m:
        raise ValueError(f"backup time must be HH:MM, got {text!r}")
    return int(m.group(1)), int(m.group(2))


def next_run(now: datetime, at: str) -> datetime:
    """The next wall-clock ``at`` strictly after ``now`` (in now's own time zone)."""
    h, m = parse_time(at)
    candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate <= now:
        candidate = (candidate.replace(tzinfo=None) + timedelta(days=1)).replace(tzinfo=now.tzinfo)
    return candidate


def zone(name: str):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return timezone.utc


class Backups:
    """The server's nightly job. Disabled (``enabled`` False) unless a target is configured.

    ``backup_time`` is wall-clock time in the house's time zone: ``tz`` says which, asked afresh each time.
    The server passes Home Assistant's own zone once ``get_config`` has given it (``Authz.tz``, the zone grant
    schedules use), and ``cfg.house_tz`` (--house-tz, default UTC) until then or without Home Assistant.
    Without that, a house that never set --house-tz was backed up at 03:15 UTC, the middle of the
    evening in America."""

    CATCH_UP_AFTER = 25 * 3600       # no backup newer than this at startup -> one soon
    CATCH_UP_DELAY = 60.0
    RETRY_AFTER = 3600.0
    # the wait for the nightly run is slept in steps of at most this long, each time worked out again, so
    # a zone learned (or changed) after the wait began still moves the run to the house's own backup_time
    RECHECK = 900.0

    def __init__(self, cfg, *, clock=time.time, audit=None, tz=None) -> None:
        self.cfg = cfg
        self.clock = clock
        self.audit = audit
        self.tz = tz or (lambda: cfg.house_tz)
        self.status: dict = {"last_ok": None, "last_error": None, "last_file": None, "last_attempt": None}
        self._lock: asyncio.Lock | None = None
        self.task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return self.cfg.backup_target is not None

    @property
    def key_file(self) -> Path:
        return Path(self.cfg.backup_key_file or (Path(self.cfg.secrets_dir) / KEY_FILE)).expanduser()

    def now(self) -> datetime:
        return datetime.fromtimestamp(self.clock(), tz=zone(self.tz() or self.cfg.house_tz or "UTC"))

    def list(self) -> list[BackupInfo]:
        return list_backups(self.cfg.backup_target) if self.enabled else []

    def run_blocking(self) -> Path:
        key, created = load_key(self.key_file, create=True)
        if created:
            log.warning("created a new backup key at %s: copy it somewhere that is not this machine; "
                        "without it the backups cannot be restored", self.key_file)
        return create_backup(Path(self.cfg.data_dir), Path(self.cfg.backup_target), key, now=self.now(),
                             include_files=self.cfg.backup_include_files, keep_daily=self.cfg.backup_keep_daily,
                             keep_weekly=self.cfg.backup_keep_weekly)

    async def run_once(self) -> dict:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            self.status["last_attempt"] = self.clock()
            try:
                path = await asyncio.get_running_loop().run_in_executor(None, self.run_blocking)
            except (BackupError, OSError, sqlite3.Error) as exc:
                self.status.update(last_error=str(exc), last_error_code=getattr(exc, "code", "error"))
                log.error("backup failed: %s", exc)
                self._record("backup.failed", {"error": str(exc)[:300]})
                return {"ok": False, "error": str(exc)}
            self.status.update(last_ok=self.clock(), last_error=None, last_error_code=None, last_file=path.name)
            self._record("backup.ok", {"file": path.name})
            return {"ok": True, "file": path.name}

    def _record(self, action: str, detail: dict) -> None:
        if self.audit is not None:
            try:
                self.audit({"action": action, "detail": detail, "actor": "mantel", "role": None})
            except Exception:  # noqa: BLE001 -- an audit hiccup must not hide the backup's own result
                log.exception("could not audit %s", action)

    async def run_forever(self) -> None:
        newest = next(iter(self.list()), None)
        if newest is None or self.clock() - newest.created.timestamp() > self.CATCH_UP_AFTER:
            await asyncio.sleep(self.CATCH_UP_DELAY)
            result = await self.run_once()
            if not result["ok"]:
                await asyncio.sleep(self.RETRY_AFTER)
        while True:
            while True:
                now = self.now()
                wait = (next_run(now, self.cfg.backup_time) - now).total_seconds()
                if wait <= self.RECHECK:
                    break
                await asyncio.sleep(self.RECHECK)
            await asyncio.sleep(max(wait, 1.0))
            result = await self.run_once()
            if not result["ok"]:
                await asyncio.sleep(self.RETRY_AFTER)


# -- REST + wiring ----------------------------------------------------------------------------------
def _manager(request: web.Request, *, owner_only: bool = False):
    from . import sessions
    from .accounts import require_manager
    ident = require_manager(request)
    if owner_only and ident.user.role != "owner":
        raise web.HTTPForbidden(text='{"error":"forbidden"}', content_type="application/json")
    if request.method not in sessions.SAFE_METHODS:
        sessions.check_csrf(request, ident)
    return ident


async def api_status(request: web.Request) -> web.Response:
    from .sessions import ok
    _manager(request)
    b: Backups = request.app["backups"]
    if not b.enabled:
        return ok({"enabled": False})
    return ok({"enabled": True, "target": str(b.cfg.backup_target), "time": b.cfg.backup_time,
               "keep_daily": b.cfg.backup_keep_daily, "keep_weekly": b.cfg.backup_keep_weekly,
               "key_present": b.key_file.exists(), "status": b.status, "backups": [x.as_dict() for x in b.list()]})


async def api_run(request: web.Request) -> web.Response:
    from .sessions import error, ok
    _manager(request, owner_only=True)
    b: Backups = request.app["backups"]
    if not b.enabled:
        return error(409, "backup_not_configured")
    result = await b.run_once()
    return ok(result) if result["ok"] else error(500, "backup_failed", message=result["error"])


def register(app: web.Application, hub=None) -> None:
    """Add the backup job and its REST status. Disabled unless ``cfg.backup_target`` is set."""
    cfg = app["cfg"]
    audit = app.get("audit")
    def house_zone() -> str:
        # Home Assistant's zone once read (server.house_tz -> Authz.set_tz), else --house-tz
        authz = app.get("authz")
        return getattr(authz, "tz", None) or cfg.house_tz or "UTC"

    backups = Backups(cfg, clock=lambda: app["clock"](), audit=audit.config_event if audit is not None else None,
                      tz=house_zone)
    app["backups"] = backups
    app.router.add_get("/api/backup", api_status)
    app.router.add_post("/api/backup/run", api_run)
    if not backups.enabled:
        return

    async def start(app: web.Application) -> None:
        app["backup_task"] = asyncio.create_task(backups.run_forever())

    async def stop(app: web.Application) -> None:
        task = app.get("backup_task")
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    app.on_startup.append(start)
    app.on_cleanup.append(stop)


# -- CLI --------------------------------------------------------------------------------------------
def _common(p: argparse.ArgumentParser) -> None:
    from .config import Config
    p.add_argument("--data-dir", default=str(Config.data_dir))
    p.add_argument("--secrets-dir", default=str(Config.secrets_dir))
    p.add_argument("--key-file", default=None, help=f"the backup key (default: <secrets-dir>/{KEY_FILE})")


def cli_backup(argv: list[str]) -> int:
    """``mantel-server backup --target DIR``: one backup now (what the nightly job does)."""
    p = argparse.ArgumentParser(prog="mantel-server backup", description=cli_backup.__doc__)
    _common(p)
    p.add_argument("--target", required=True, help="folder to write to (the NAS mount); must exist")
    p.add_argument("--create", action="store_true", help="create the target folder if it does not exist")
    p.add_argument("--keep-daily", type=int, default=7)
    p.add_argument("--keep-weekly", type=int, default=4)
    p.add_argument("--no-files", action="store_true", help="the database only, not the Your files tree or Mantel Photos")
    a = p.parse_args(argv)
    key_file = Path(a.key_file or Path(a.secrets_dir) / KEY_FILE)
    try:
        if a.create:
            Path(a.target).expanduser().mkdir(parents=True, exist_ok=True)
        key, created = load_key(key_file, create=True)
        if created:
            print(f"mantel-server: created a new backup key at {key_file}.\n"
                  "  COPY IT somewhere that is not this machine (and copy at_rest.key too): without it these "
                  "backups cannot be restored.", file=sys.stderr)
        path = create_backup(Path(a.data_dir), Path(a.target), key, include_files=not a.no_files,
                             keep_daily=a.keep_daily, keep_weekly=a.keep_weekly)
    except BackupError as exc:
        print(f"mantel-server: backup failed: {exc}", file=sys.stderr)
        return 1
    print(f"backup written: {path} ({path.stat().st_size} bytes)")
    return 0


def cli_restore(argv: list[str]) -> int:
    """``mantel-server restore FILE --data-dir DIR``: check a backup and put it in a (fresh) data dir."""
    p = argparse.ArgumentParser(prog="mantel-server restore", description=cli_restore.__doc__)
    p.add_argument("file", help="the .mbk backup file")
    _common(p)
    p.add_argument("--replace", action="store_true",
                   help="the data dir already has a database: move it aside (*.before-restore-<time>) first")
    p.add_argument("--verify-only", action="store_true", help="decrypt and check, change nothing")
    a = p.parse_args(argv)
    try:
        key, _ = load_key(Path(a.key_file or Path(a.secrets_dir) / KEY_FILE), create=False)
        report = restore(Path(a.file), key, Path(a.data_dir), replace=a.replace, verify_only=a.verify_only)
    except BackupError as exc:
        print(f"mantel-server: restore failed ({exc.code}): {exc}", file=sys.stderr)
        return 1
    rows = sum(report.tables.values())
    print(f"backup of {report.created}: schema {report.schema}, {len(report.tables)} tables, {rows} rows, "
          f"{report.files} uploaded files; database checks passed"
          + (f"; migrated {report.migrated} to this build" if report.migrated else ""))
    if a.verify_only:
        print("verify-only: nothing was changed")
    else:
        print(f"restored into {a.data_dir}" + (f"; the old files are at {', '.join(report.replaced)}" if report.replaced else ""))
        print("Start Mantel Server now. Sealed values (TOTP seeds) need the at_rest.key that went with this data.")
    return 0
