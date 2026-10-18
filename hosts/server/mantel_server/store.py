"""Phase 0's store API, now a thin layer over the P3.1 database (``db.py``, migration 0001_core).

Lives outside git (default ~/.local/share/mantel/mantel.db, folder mode 0700). What Phase 0 called a
*link* (an HA user with a role) is now an HA-linked Mantel user plus its ``ha_links`` row; what it
called a *session* is a session whose id is an access token. Only SHA-256 hashes of tokens are
stored, so a copy of the database cannot be replayed as a cookie. The dry-run ``command_audit``
table (proof 2) is unchanged and append-only.
"""
from __future__ import annotations

import secrets
import time
from pathlib import Path

from .db import Database
from .sessions import SessionManager, token_hash

ROLES = ("owner", "admin", "adult", "child", "guest", "wall_tablet")  # PLAN §5

_hash = token_hash  # Phase 0 name


class Store:
    def __init__(self, path: Path) -> None:
        self.database = Database(path)
        self.db = self.database.conn
        self.sessions = SessionManager(self.db, time.time)

    def audit_command(self, *, timestamp, actor, role, action, target, decision, reason, source_ip) -> int:
        """Commit a minimal decision record; a failure must propagate to the caller."""
        with self.db:
            row = self.db.execute(
                "INSERT INTO command_audit "
                "(timestamp, actor, role, device, action, target, decision, reason, dry_run, source_ip) "
                "VALUES (?, ?, ?, 'unknown', ?, ?, ?, ?, 1, ?)",
                (timestamp, actor, role, action, target, decision, reason, source_ip))
        return row.lastrowid

    # -- links (HA accounts linked to Mantel users) -------------------------------------------------
    def link(self, ha_user_id: str, role: str, name: str | None = None, now: float | None = None) -> str:
        """Link an HA user to a role: re-roles the linked user, or creates one. Returns the user id."""
        if role not in ROLES:
            raise ValueError(f"unknown role {role!r}; roles are {', '.join(ROLES)}")
        now = time.time() if now is None else now
        with self.db:
            row = self.db.execute("SELECT user_id FROM ha_links WHERE ha_user_id=?", (ha_user_id,)).fetchone()
            if row:
                self.db.execute("UPDATE users SET role=?, name=COALESCE(?, name), updated=? WHERE id=?",
                                (role, name, now, row["user_id"]))
                return row["user_id"]
            user_id = secrets.token_hex(16)
            self.db.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES (?,?,?,?,?,?)",
                            (user_id, name, role, "ha_linked", now, now))
            self.db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES (?,?,?)",
                            (ha_user_id, user_id, now))
        return user_id

    def link_user(self, ha_user_id: str, user_id: str, now: float | None = None) -> None:
        """Link an HA account to an existing (HK) user."""
        now = time.time() if now is None else now
        with self.db:
            self.db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES (?,?,?)",
                            (ha_user_id, user_id, now))

    def unlink(self, ha_user_id: str) -> bool:
        """Remove the link and end the user's sessions. A user that only existed for the link goes too."""
        with self.db:
            row = self.db.execute("SELECT u.id, u.kind FROM ha_links h JOIN users u ON u.id = h.user_id "
                                  "WHERE h.ha_user_id=?", (ha_user_id,)).fetchone()
            if row is None:
                return False
            self.db.execute("DELETE FROM ha_links WHERE ha_user_id=?", (ha_user_id,))
            self.db.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
            if row["kind"] == "ha_linked":
                self.db.execute("DELETE FROM users WHERE id=?", (row["id"],))
        return True

    _LINK = ("SELECT h.ha_user_id, u.role, u.name, h.created, u.id AS user_id, u.disabled "
             "FROM ha_links h JOIN users u ON u.id = h.user_id ")

    def get_link(self, ha_user_id: str) -> dict | None:
        row = self.db.execute(self._LINK + "WHERE h.ha_user_id=?", (ha_user_id,)).fetchone()
        return dict(row) if row else None

    def list_links(self) -> list[dict]:
        return [dict(r) for r in self.db.execute(self._LINK + "ORDER BY h.created")]

    def set_name(self, ha_user_id: str, name: str) -> None:
        with self.db:
            self.db.execute("UPDATE users SET name=? WHERE id=(SELECT user_id FROM ha_links WHERE ha_user_id=?)",
                            (name, ha_user_id))

    # -- sessions (fixed-length access tokens, as Phase 0 issued) ----------------------------------
    def create_session(self, ha_user_id: str, ttl: float, now: float | None = None) -> str:
        """A LAN session for a linked HA user whose cookie value lasts ``ttl`` seconds (no refresh)."""
        link = self.get_link(ha_user_id)
        if link is None:
            raise ValueError(f"HA user {ha_user_id!r} is not linked")
        issued = self.sessions.create(link["user_id"], "lan", "legacy", now=now, ttl=ttl, refresh=False, fresh=False)
        return issued.access

    def get_session(self, session_id: str | None, now: float | None = None) -> dict | None:
        """The signed-in user for a cookie value, or None (unknown, expired, revoked, disabled or unlinked).

        The role is read from the user at every request, so unlinking or re-roling takes effect at once.
        """
        row = self.sessions.from_access(session_id, now)
        if row is None:
            return None
        expires = self.db.execute("SELECT MAX(expires) FROM access_tokens WHERE hash=?",
                                  (token_hash(session_id),)).fetchone()[0]
        return {"ha_user_id": row["ha_user_id"], "user_id": row["user_id"], "role": row["user_role"],
                "name": row["user_name"], "expires": min(expires, row["expires"])}

    def delete_session(self, session_id: str | None) -> None:
        row = self.sessions.from_access(session_id)
        if row is not None:
            self.sessions.revoke(row["id"], "logout")
