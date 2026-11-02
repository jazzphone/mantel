"""The alerts' tables (migration 0031): the channels, the log, the center's settings.

A channel's secrets (a webhook URL, a bot token, an API key, a password, Apprise URLs) are one JSON object sealed with
``atrest.SecretBox`` under ``alert-channel:<id>``, so a sealed value copied onto another row does not open. Nothing
here returns them except :meth:`Channels.secret`, which the senders call at send time; ``public`` (what the page and
the API see) carries only ``hint``, the last four characters. A restore with another at-rest key keeps the rows, and
``secret`` answers None: the page asks for the secret again (``needs_secret``).
"""
from __future__ import annotations

import json
import logging
import secrets as _secrets
import sqlite3
import time
from typing import Any, Callable

from ..atrest import SecretBox
from . import catalog

log = logging.getLogger("mantel.alerts")

LOG_DAYS = 30
COLS = ("id, kind, name, enabled, events, min_level, quiet, config, sealed, hint, created, last_ok, last_error, "
        "last_error_at, fails")


def aad(cid: str) -> str:
    return f"alert-channel:{cid}"


def hint_of(secret: Any) -> str | None:
    """The last four characters of a channel's main secret, for the page ("…a1b2")."""
    if isinstance(secret, dict):
        main = secret.get("main")
        if isinstance(main, str) and len(main) >= 8:
            return main[-4:]
    return None


def _loads(text: Any, default: Any) -> Any:
    try:
        got = json.loads(text) if isinstance(text, str) else default
    except ValueError:
        return default
    return got if isinstance(got, type(default)) else default


class Channels:
    def __init__(self, db: sqlite3.Connection, box: SecretBox, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.box = box
        self.clock = clock

    def _row(self, r: sqlite3.Row | None) -> dict | None:
        if r is None:
            return None
        d = dict(r)
        d["enabled"] = bool(d["enabled"])
        d["events"] = [e for e in _loads(d["events"], []) if isinstance(e, str)]
        d["quiet"] = _loads(d["quiet"], {})
        d["config"] = _loads(d["config"], {})
        return d

    def all(self) -> list[dict]:
        return [self._row(r) for r in self.db.execute(f"SELECT {COLS} FROM alert_channels ORDER BY created")]

    def get(self, cid: str) -> dict | None:
        return self._row(self.db.execute(f"SELECT {COLS} FROM alert_channels WHERE id = ?", (cid,)).fetchone())

    def add(self, kind: str, name: str, *, events: list[str], min_level: str, quiet: dict, config: dict,
            secret: dict | None, enabled: bool = True) -> str:
        cid = _secrets.token_hex(8)
        sealed = self.box.seal(json.dumps(secret).encode(), aad(cid)) if secret else None
        with self.db:
            self.db.execute("INSERT INTO alert_channels (id, kind, name, enabled, events, min_level, quiet, config, "
                            "sealed, hint, created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (cid, kind, name, int(enabled), json.dumps(events), min_level, json.dumps(quiet),
                             json.dumps(config), sealed, hint_of(secret), self.clock()))
        return cid

    def update(self, cid: str, *, secret: dict | None = None, **fields: Any) -> None:
        sets, args = [], []
        for k, v in fields.items():
            if k not in ("name", "enabled", "events", "min_level", "quiet", "config"):
                raise ValueError(k)
            sets.append(f"{k} = ?")
            args.append(json.dumps(v) if k in ("events", "quiet", "config") else int(v) if k == "enabled" else v)
        if secret is not None:
            sets += ["sealed = ?", "hint = ?"]
            args += [self.box.seal(json.dumps(secret).encode(), aad(cid)), hint_of(secret)]
        if not sets:
            return
        with self.db:
            self.db.execute(f"UPDATE alert_channels SET {', '.join(sets)} WHERE id = ?", (*args, cid))

    def delete(self, cid: str) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM alert_channels WHERE id = ?", (cid,)).rowcount > 0

    def secret(self, cid: str) -> dict | None:
        """The channel's secrets, opened; None when there are none or they don't open (another at-rest key)."""
        row = self.db.execute("SELECT sealed FROM alert_channels WHERE id = ?", (cid,)).fetchone()
        if row is None or row[0] is None:
            return None
        try:
            got = json.loads(self.box.open(bytes(row[0]), aad(cid)))
        except Exception:  # noqa: BLE001 -- a restore with another key: saved but unusable
            return None
        return got if isinstance(got, dict) else None

    def sent(self, cid: str) -> None:
        with self.db:
            self.db.execute("UPDATE alert_channels SET last_ok = ?, fails = 0 WHERE id = ?", (self.clock(), cid))

    def failed(self, cid: str, error: str) -> int:
        """A delivery given up on: the error (already free of secrets) and the count of them in a row."""
        with self.db:
            self.db.execute("UPDATE alert_channels SET last_error = ?, last_error_at = ?, fails = fails + 1 "
                            "WHERE id = ?", (error[:300], self.clock(), cid))
        row = self.db.execute("SELECT fails FROM alert_channels WHERE id = ?", (cid,)).fetchone()
        return int(row[0]) if row else 0

    def public(self, ch: dict) -> dict:
        """A channel as the page and the API see it: never the sealed value."""
        return {"id": ch["id"], "kind": ch["kind"], "name": ch["name"], "enabled": ch["enabled"],
                "events": ch["events"], "min_level": ch["min_level"], "quiet": ch["quiet"], "config": ch["config"],
                "hint": ch.get("hint"), "has_secret": ch.get("sealed") is not None,
                "needs_secret": ch.get("sealed") is not None and self.secret(ch["id"]) is None,
                "created": ch["created"], "last_ok": ch.get("last_ok"), "last_error": ch.get("last_error"),
                "last_error_at": ch.get("last_error_at"), "fails": ch.get("fails", 0)}


class Log:
    def __init__(self, db: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock
        self._purged = 0.0

    def add(self, at: float, kind: str, key: str, level: str, up: bool, title: str, body: str,
            sent_to: list[str]) -> int:
        with self.db:
            cur = self.db.execute("INSERT INTO alert_log (at, kind, key, level, up, title, body, sent_to) "
                                  "VALUES (?,?,?,?,?,?,?,?)", (at, kind, key, level, int(up), title, body,
                                                               json.dumps(sent_to)))
        self.maybe_purge()
        return int(cur.lastrowid)

    def sent_to(self, row_id: int, channels: list[str]) -> None:
        with self.db:
            self.db.execute("UPDATE alert_log SET sent_to = ? WHERE id = ?", (json.dumps(sorted(set(channels))), row_id))

    def add_sent(self, row_id: int, channel: str) -> None:
        row = self.db.execute("SELECT sent_to FROM alert_log WHERE id = ?", (row_id,)).fetchone()
        if row is not None:
            self.sent_to(row_id, _loads(row[0], []) + [channel])

    def recent(self, limit: int = 200, group: str | None = None, since: float | None = None) -> list[dict]:
        kinds = [k.id for k in catalog.KINDS.values() if k.group == group] if group else None
        sql, args = "SELECT id, at, kind, key, level, up, title, body, sent_to FROM alert_log", []
        where = []
        if kinds is not None:
            where.append(f"kind IN ({','.join('?' * len(kinds))})")
            args += kinds
        if since is not None:
            where.append("at >= ?")
            args.append(since)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY at DESC, id DESC LIMIT ?"
        args.append(max(1, min(int(limit), 1000)))
        out = []
        for r in self.db.execute(sql, args):
            d = dict(r)
            d["up"] = bool(d["up"])
            d["sent_to"] = _loads(d["sent_to"], [])
            k = catalog.kind(d["kind"])
            d["group"] = k.group if k else "mantel"
            out.append(d)
        return out

    def maybe_purge(self) -> None:
        now = self.clock()
        if now - self._purged < 3600:
            return
        self._purged = now
        with self.db:
            self.db.execute("DELETE FROM alert_log WHERE at < ?", (now - LOG_DAYS * 86400,))


class Settings:
    def __init__(self, db: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock

    def get(self, key: str, default: Any = None) -> Any:
        row = self.db.execute("SELECT value FROM alert_settings WHERE key = ?", (key,)).fetchone()
        if row is None:
            return default
        try:
            return json.loads(row[0])
        except ValueError:
            return default

    def set(self, key: str, value: Any) -> None:
        with self.db:
            self.db.execute("INSERT INTO alert_settings (key, value, updated) VALUES (?,?,?) ON CONFLICT(key) DO "
                            "UPDATE SET value = excluded.value, updated = excluded.updated",
                            (key, json.dumps(value), self.clock()))
