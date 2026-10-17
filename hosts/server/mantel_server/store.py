"""Mantel's own small database: which HA user is linked to which Mantel role, and sign-in sessions.

Lives outside git (default ~/.local/share/mantel/mantel.db, folder mode 0700). Session ids are random
and only their SHA-256 is stored, so a copy of the database cannot be replayed as a cookie.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import time
from pathlib import Path

ROLES = ("owner", "admin", "adult", "child", "guest", "wall_tablet")  # PLAN §5

SCHEMA = """
CREATE TABLE IF NOT EXISTS links (
    ha_user_id TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('owner','admin','adult','child','guest','wall_tablet')),
    name       TEXT,
    created    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash    TEXT PRIMARY KEY,
    ha_user_id TEXT NOT NULL,
    created    REAL NOT NULL,
    expires    REAL NOT NULL
);
"""


def _hash(session_id: str) -> str:
    return hashlib.sha256(session_id.encode()).hexdigest()


class Store:
    def __init__(self, path: Path) -> None:
        path = Path(path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(path.parent, 0o700)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        os.chmod(path, 0o600)

    # -- links -------------------------------------------------------------------------------
    def link(self, ha_user_id: str, role: str, name: str | None = None, now: float | None = None) -> None:
        if role not in ROLES:
            raise ValueError(f"unknown role {role!r}; roles are {', '.join(ROLES)}")
        with self.db:
            self.db.execute(
                "INSERT INTO links (ha_user_id, role, name, created) VALUES (?,?,?,?) "
                "ON CONFLICT(ha_user_id) DO UPDATE SET role=excluded.role, name=COALESCE(excluded.name, name)",
                (ha_user_id, role, name, now if now is not None else time.time()))

    def unlink(self, ha_user_id: str) -> bool:
        with self.db:
            self.db.execute("DELETE FROM sessions WHERE ha_user_id=?", (ha_user_id,))
            return self.db.execute("DELETE FROM links WHERE ha_user_id=?", (ha_user_id,)).rowcount > 0

    def get_link(self, ha_user_id: str) -> dict | None:
        row = self.db.execute("SELECT * FROM links WHERE ha_user_id=?", (ha_user_id,)).fetchone()
        return dict(row) if row else None

    def list_links(self) -> list[dict]:
        return [dict(r) for r in self.db.execute("SELECT * FROM links ORDER BY created")]

    def set_name(self, ha_user_id: str, name: str) -> None:
        with self.db:
            self.db.execute("UPDATE links SET name=? WHERE ha_user_id=?", (name, ha_user_id))

    # -- sessions ----------------------------------------------------------------------------
    def create_session(self, ha_user_id: str, ttl: float, now: float | None = None) -> str:
        now = time.time() if now is None else now
        sid = secrets.token_urlsafe(32)
        with self.db:
            self.db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
            self.db.execute("INSERT INTO sessions VALUES (?,?,?,?)", (_hash(sid), ha_user_id, now, now + ttl))
        return sid

    def get_session(self, session_id: str | None, now: float | None = None) -> dict | None:
        """The signed-in user for a cookie value, or None (unknown, expired, or no longer linked).

        The role is read from the link at every request, so unlinking or re-roling takes effect at once.
        """
        if not session_id:
            return None
        now = time.time() if now is None else now
        row = self.db.execute(
            "SELECT s.ha_user_id, s.expires, l.role, l.name FROM sessions s "
            "JOIN links l ON l.ha_user_id = s.ha_user_id WHERE s.id_hash=?", (_hash(session_id),)).fetchone()
        if row is None or row["expires"] <= now:
            return None
        return dict(row)

    def delete_session(self, session_id: str | None) -> None:
        if session_id:
            with self.db:
                self.db.execute("DELETE FROM sessions WHERE id_hash=?", (_hash(session_id),))
