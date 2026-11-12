"""``SettingsStore``: documents ``(scope, key) -> JSON object`` in SQLite, every change a new version with its history row."""
from __future__ import annotations

import copy
import json
import sqlite3
import time
from typing import Callable, Iterable, Mapping

from .. import dry_run
from .docs import Actor, Doc, HISTORY_LIMIT, MAX_DOC, SCOPES, SettingsError, _empty, _stored, diff

# ---------------------------------------------------------------------------------------- store
class SettingsStore:
    """The documents and their history over the shared sqlite connection (db.py)."""

    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.conn = conn
        self.clock = clock

    @staticmethod
    def _doc(row: sqlite3.Row) -> Doc:
        return Doc(row["scope"], row["key"], row["version"], json.loads(row["body"]), row["updated"], row["updated_by"])

    def get(self, scope: str, key: str) -> Doc | None:
        row = self.conn.execute("SELECT * FROM settings_docs WHERE scope=? AND key=?", (scope, key)).fetchone()
        return self._doc(row) if row else None

    def version(self, scope: str, key: str) -> int | None:
        """A document's version now (None: no such document) -- one cheap read, for a reader that keeps its parsed body."""
        row = self.conn.execute("SELECT version FROM settings_docs WHERE scope=? AND key=?", (scope, key)).fetchone()
        return int(row["version"]) if row else None

    def body(self, scope: str, key: str) -> dict:
        d = self.get(scope, key)
        return copy.deepcopy(d.body) if d else {}

    def docs(self, scope: str) -> dict[str, Doc]:
        rows = self.conn.execute("SELECT * FROM settings_docs WHERE scope=? ORDER BY key", (scope,)).fetchall()
        return {r["key"]: self._doc(r) for r in rows}

    def empty(self) -> bool:
        return self.conn.execute("SELECT 1 FROM settings_docs LIMIT 1").fetchone() is None

    def _write_one(self, scope: str, key: str, body: dict, *, actor: Actor, action: str, message: str | None,
                   source: str | None, now: float, expect_version: int | None = None) -> Doc | None:
        if scope not in SCOPES:
            raise SettingsError("invalid", f"unknown scope {scope!r}")
        if not isinstance(body, dict):
            raise SettingsError("invalid", "a settings document is a JSON object")
        text = _stored(body)                      # key order kept (a card's YAML reads back as written)
        if len(text.encode()) > MAX_DOC:
            raise SettingsError("too_big", f"{scope}/{key} would be larger than {MAX_DOC} bytes")
        cur = self.get(scope, key)
        if expect_version is not None and (cur.version if cur else 0) != expect_version:
            raise SettingsError("conflict", f"{scope}/{key} changed meanwhile (now version {cur.version if cur else 0})")
        old = cur.body if cur else {}
        d = diff(old, body)
        if cur is not None and _empty(d):
            return None                                        # nothing changed: no new version
        version = (cur.version if cur else self._last_version(scope, key)) + 1
        self.conn.execute(
            "INSERT INTO settings_history (scope, key, version, body, diff, action, message, actor, actor_role, device,"
            " source, created, via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (scope, key, version, text, _stored(d), action, message, actor.id, actor.role, actor.device_id, source, now,
             actor.via))
        self.conn.execute(
            "INSERT INTO settings_docs (scope, key, version, body, updated, updated_by) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(scope, key) DO UPDATE SET version=excluded.version, body=excluded.body, "
            "updated=excluded.updated, updated_by=excluded.updated_by",
            (scope, key, version, text, now, actor.id))
        return Doc(scope, key, version, json.loads(text), now, actor.id)

    def _last_version(self, scope: str, key: str) -> int:
        """The last version a document had, also when it was removed (its history stays; a new one goes on)."""
        row = self.conn.execute("SELECT MAX(version) AS v FROM settings_history WHERE scope=? AND key=?",
                                (scope, key)).fetchone()
        return int(row["v"] or 0) if row is not None else 0

    def remove(self, scope: str, key: str, *, actor: Actor, message: str | None = None) -> bool:
        """Remove a document (a tablet taken off Wall Tablets). Its history stays, with a last version saying it
        was removed (an empty body; the message says why: the history's actions are set, restore and import), so
        ``restore`` can bring any earlier version back."""
        cur = self.get(scope, key)
        if cur is None:
            return False
        if dry_run.active():
            dry_run.raise_planned([{"scope": scope, "key": key, "version": cur.version, "next": cur.version + 1,
                                    "diff": diff(cur.body, {}), "removed": True}])
        with self.conn:
            self._remove_one(cur, actor=actor, message=message, now=float(self.clock()))
        return True

    def _remove_one(self, cur: Doc, *, actor: Actor, message: str | None, now: float) -> None:
        """remove()'s two statements, inside the caller's transaction."""
        self.conn.execute(
            "INSERT INTO settings_history (scope, key, version, body, diff, action, message, actor, actor_role,"
            " device, source, created, via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (cur.scope, cur.key, cur.version + 1, "{}", _stored(diff(cur.body, {})), "set", message or "removed",
             actor.id, actor.role, actor.device_id, None, now, actor.via))
        self.conn.execute("DELETE FROM settings_docs WHERE scope=? AND key=?", (cur.scope, cur.key))

    def write(self, changes: Iterable[tuple[str, str, dict]], *, actor: Actor, action: str = "set",
              message: str | None = None, source: str | None = None,
              expect: Mapping[tuple[str, str], int] | None = None) -> list[Doc]:
        """Write several documents in ONE transaction (all or nothing). Returns the new versions of the
        documents that actually changed (an unchanged body makes no version)."""
        now = float(self.clock())
        out: list[Doc] = []
        if dry_run.active():
            self._plan(list(changes), expect)
        with self.conn:
            for scope, key, body in changes:
                got = self._write_one(scope, key, body, actor=actor, action=action, message=message, source=source,
                                      now=now, expect_version=(expect or {}).get((scope, key)))
                if got is not None:
                    out.append(got)
        return out

    def _plan(self, changes: list[tuple[str, str, dict]], expect: Mapping[tuple[str, str], int] | None) -> None:
        """write() inside a plan (dry_run.py): the same checks as _write_one, nothing written, Planned raised."""
        docs, seen = [], {}
        for scope, key, body in changes:
            if scope not in SCOPES:
                raise SettingsError("invalid", f"unknown scope {scope!r}")
            if not isinstance(body, dict):
                raise SettingsError("invalid", "a settings document is a JSON object")
            if len(_stored(body).encode()) > MAX_DOC:
                raise SettingsError("too_big", f"{scope}/{key} would be larger than {MAX_DOC} bytes")
            cur = self.get(scope, key)
            version = cur.version if cur else 0
            wanted = (expect or {}).get((scope, key))
            if wanted is not None and version != wanted:
                raise SettingsError("conflict", f"{scope}/{key} changed meanwhile (now version {version})")
            old = seen.get((scope, key), cur.body if cur else {})
            d = diff(old, json.loads(_stored(body)))
            seen[(scope, key)] = body
            if cur is not None and _empty(d):
                continue
            docs.append({"scope": scope, "key": key, "version": version,
                         "next": (version if cur else self._last_version(scope, key)) + 1, "diff": d, "removed": False})
        dry_run.raise_planned(docs)

    def history(self, scope: str, key: str, limit: int = 50, bodies: bool = False) -> list[dict]:
        limit = max(1, min(int(limit), HISTORY_LIMIT))
        rows = self.conn.execute("SELECT h.*, u.name AS actor_name FROM settings_history h LEFT JOIN users u ON u.id=h.actor "
                                 "WHERE h.scope=? AND h.key=? ORDER BY h.version DESC LIMIT ?",
                                 (scope, key, limit)).fetchall()
        out = []
        for r in rows:
            item = {"version": r["version"], "action": r["action"], "message": r["message"], "actor": r["actor"],
                    "actor_role": r["actor_role"], "actor_name": r["actor_name"], "device": r["device"], "source": r["source"], "created": r["created"],
                    "diff": json.loads(r["diff"]), "via": r["via"] if "via" in r.keys() else None}
            if bodies:
                item["body"] = json.loads(r["body"])
            out.append(item)
        return out

    def version_body(self, scope: str, key: str, version: int) -> dict | None:
        row = self.conn.execute("SELECT body FROM settings_history WHERE scope=? AND key=? AND version=?",
                                (scope, key, int(version))).fetchone()
        return json.loads(row["body"]) if row else None

    def restore(self, scope: str, key: str, version: int, *, actor: Actor, message: str | None = None,
                normalise: Callable[[dict], dict] | None = None) -> Doc | None:
        """A NEW version whose body is ``version``'s (``normalise``d: an older form written as today's). None if
        the document already is that body."""
        body = self.version_body(scope, key, version)
        if body is None:
            raise SettingsError("no_version", f"{scope}/{key} has no version {version}")
        if normalise is not None:
            body = normalise(body)
        got = self.write([(scope, key, body)], actor=actor, action="restore", message=message, source=f"v{int(version)}")
        return got[0] if got else None

    # -- the one-time import -----------------------------------------------------------------
    def import_record(self) -> dict | None:
        row = self.conn.execute("SELECT * FROM settings_import WHERE id=1").fetchone()
        if row is None:
            return None
        return {"source": row["source"], "read": row["read"], "checksum": row["checksum"],
                "written": json.loads(row["written"]), "skipped": json.loads(row["skipped"]),
                "actor": row["actor"], "created": row["created"]}

    def user_exists(self, user_id: str) -> bool:
        try:
            return self.conn.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone() is not None
        except sqlite3.OperationalError:          # a bare connection without P3.1's users table (tests)
            return True
