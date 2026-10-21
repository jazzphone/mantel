"""Mantel's SQLite database: one connection, numbered migrations.

The file lives outside git (default ~/.local/share/mantel/mantel.db). Its folder is 0700 and the
file 0600; SQLite gives the -wal and -shm files the main file's mode. WAL journal, foreign keys on.

Migrations are SQL files in ``mantel_server/migrations`` named ``NNNN_name.sql`` (four digits, then a
lowercase name). Each slice adds its own file (P3.1 ``0001_core``, P3.2 ``0002_rbac``, P3.5
``0003_settings``, …). The runner applies every file whose number is not yet recorded in
``schema_version``, in number order, each inside its own transaction together with its
``schema_version`` row, so a failed migration leaves nothing behind. Files must not contain their
own BEGIN/COMMIT. A file whose text changed after it was applied is logged, never re-run: fix
forward with a new number.
"""
from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("mantel.db")

MIGRATIONS = Path(__file__).with_name("migrations")
_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

SCHEMA_VERSION = """
CREATE TABLE IF NOT EXISTS schema_version (
    version  INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied  REAL NOT NULL
);
"""


class MigrationError(Exception):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path

    @property
    def sql(self) -> str:
        return self.path.read_text()

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.path.read_bytes()).hexdigest()


def discover(folder: Path = MIGRATIONS) -> list[Migration]:
    """All migration files in number order. Duplicate numbers or stray names are an error."""
    found: dict[int, Migration] = {}
    for p in sorted(Path(folder).iterdir()):
        if p.suffix != ".sql":
            continue
        m = _NAME.match(p.name)
        if not m:
            raise MigrationError(f"migration file {p.name!r} must be named NNNN_name.sql")
        version = int(m.group(1))
        if version in found:
            raise MigrationError(f"two migrations share number {version:04d}: {found[version].path.name}, {p.name}")
        found[version] = Migration(version, m.group(2), p)
    return [found[v] for v in sorted(found)]


def connect(path: Path) -> sqlite3.Connection:
    """Open (creating if needed) the database with Mantel's file modes and pragmas."""
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    if not path.exists():
        os.close(os.open(path, os.O_WRONLY | os.O_CREAT, 0o600))  # born 0600, never briefly wider
    os.chmod(path, 0o600)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    _wal(conn)
    return conn


WAL_TRIES = 50                 # x 0.02-0.2 s: about 5 s, as long as busy_timeout waits for anything else


def _wal(conn: sqlite3.Connection) -> None:
    """Switch to WAL. Switching needs the file to itself, and SQLite answers "database is locked" at once rather
    than through busy_timeout while another process is opening the same new database (the server and a `mantel …`
    command starting together; tests/test_db.py): try again for a few seconds, then give up as before."""
    delay = 0.02
    for attempt in range(WAL_TRIES):
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            return
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc) or attempt == WAL_TRIES - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.5, 0.2)


def applied(conn: sqlite3.Connection) -> dict[int, sqlite3.Row]:
    conn.executescript(SCHEMA_VERSION)
    return {r["version"]: r for r in conn.execute("SELECT * FROM schema_version")}


def schema_version(conn: sqlite3.Connection) -> int:
    """The highest applied migration number (0 for a new or pre-migrations database)."""
    return max(applied(conn), default=0)


def migrate(conn: sqlite3.Connection, folder: Path = MIGRATIONS, clock=time.time) -> list[int]:
    """Apply pending migrations; returns the numbers applied now. A database a newer Mantel has migrated is
    refused (``schema_too_new``), as a restore refuses its backup: this build does not know those tables, and
    running on them (an update rolled back after its migrations committed) could fail or write wrongly."""
    done = applied(conn)
    found = discover(folder)
    newer = sorted(set(done) - {m.version for m in found})
    if newer:
        raise MigrationError(f"schema_too_new: this database has migrations this Mantel doesn't know "
                             f"({', '.join(f'{v:04d}' for v in newer)}); run the Mantel that made them, or restore "
                             f"the backup made before the update")
    ran = []
    for m in found:
        if m.version in done:
            if done[m.version]["checksum"] != m.checksum:
                log.warning("migration %04d_%s changed after it was applied; it is not re-run", m.version, m.name)
            continue
        script = (f"BEGIN IMMEDIATE;\n{m.sql}\n;\n"
                  f"INSERT INTO schema_version (version, name, checksum, applied) "
                  f"VALUES ({m.version:d}, '{m.name}', '{m.checksum}', {float(clock())!r});\nCOMMIT;")
        try:
            conn.executescript(script)
        except sqlite3.Error as exc:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise MigrationError(f"migration {m.version:04d}_{m.name} failed: {exc}") from exc
        log.info("applied migration %04d_%s", m.version, m.name)
        ran.append(m.version)
    if ran:
        problems = conn.execute("PRAGMA foreign_key_check").fetchall()
        if problems:
            raise MigrationError(f"foreign key check failed after migrating: {[tuple(p) for p in problems][:5]}")
    return ran


@contextlib.contextmanager
def migration_lock(path: Path):
    """One process migrates at a time (``<db>.lock``, flock): the server starting after an update while a
    ``mantel …`` command opens the database both saw the same versions pending, and the second crashed
    re-running the first's migrations. The second now waits and finds nothing left to do."""
    try:
        import fcntl
    except ImportError:                       # not POSIX: no other Mantel process opens the file at once
        yield
        return
    fd = os.open(f"{path}.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)                          # (closing releases the lock)


class Database:
    """The connection plus its migrations. Every module shares the one connection (``.conn``)."""

    def __init__(self, path: Path, folder: Path = MIGRATIONS) -> None:
        self.path = Path(path).expanduser()
        self.conn = connect(self.path)
        with migration_lock(self.path):
            migrate(self.conn, folder)

    def close(self) -> None:
        self.conn.close()
