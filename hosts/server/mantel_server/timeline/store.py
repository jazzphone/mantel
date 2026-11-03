"""The House Timeline's tables (migration 0033): the rows, their pictures' records, the settings, the digests.

Everything here runs on the loop, on the one connection every other table uses. A write is one short transaction
(``Rows.write``: at most a flush's worth of rows, a few milliseconds in WAL mode). Reads are index scans.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

log = logging.getLogger("mantel.timeline")

COLUMNS = ("src", "at", "ended", "family", "kind", "level", "entity", "area", "title", "search", "detail", "person",
           "actor", "actor_name", "device", "device_name", "how", "audit_id")
RETENTIONS = (7, 30, 90, 365)
FRAMES = (1, 2, 3)
BUDGETS_MB = (100, 250, 500, 1000, 2000)
SEARCH_MAX = 80
WALL_HOURS = 12.0


@dataclass
class Row:
    """One row on its way to the table. ``noise`` rows (motion bursts) are the first a full queue drops."""
    src: str
    at: float
    family: str
    kind: str
    title: str
    level: str = "info"
    entity: str | None = None
    area: str | None = None
    search: str = ""
    detail: dict = field(default_factory=dict)
    person: str | None = None
    actor: str | None = None
    actor_name: str | None = None
    device: str | None = None
    device_name: str | None = None
    how: str | None = None
    audit_id: int | None = None
    ended: float | None = None
    noise: bool = False

    def values(self) -> tuple:
        return (self.src, float(self.at), self.ended, self.family, self.kind, self.level, self.entity, self.area,
                self.title[:200], self.search[:300], json.dumps(self.detail, separators=(",", ":"), default=str),
                self.person, self.actor, self.actor_name, self.device, self.device_name, self.how, self.audit_id)


def as_dict(r: sqlite3.Row | dict) -> dict:
    d = dict(r)
    try:
        d["detail"] = json.loads(d.get("detail") or "{}")
    except ValueError:
        d["detail"] = {}
    return d


# -- settings ----------------------------------------------------------------------------------------------------------
DEFAULTS: dict[str, Any] = {
    "families": {},                     # {family: bool}; a missing family uses classify.DEFAULT_ON
    "overrides": {},                    # {entity_id: {record, family?, label?}}
    "retention_days": 30,
    "pictures": {"budget_mb": 500, "frames": 2},
    "wall": {"families": ["door", "lock", "garage", "alarm", "doorbell", "detection"], "pictures": []},
    "digest": {"at": "07:00", "from": "21:00"},
}


class Settings:
    def __init__(self, db: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock
        self._cache: dict[str, Any] = {}

    def get(self, key: str) -> Any:
        if key in self._cache:
            return self._cache[key]
        row = self.db.execute("SELECT value FROM timeline_settings WHERE key = ?", (key,)).fetchone()
        value = DEFAULTS.get(key)
        if row is not None:
            try:
                value = json.loads(row[0])
            except ValueError:
                pass
        self._cache[key] = value
        return value

    def set(self, key: str, value: Any) -> None:
        with self.db:
            self.db.execute("INSERT INTO timeline_settings (key, value, updated) VALUES (?,?,?) ON CONFLICT(key) DO "
                            "UPDATE SET value = excluded.value, updated = excluded.updated",
                            (key, json.dumps(value, separators=(",", ":")), self.clock()))
        self._cache[key] = value

    def all(self) -> dict[str, Any]:
        return {k: self.get(k) for k in DEFAULTS}


# -- the rows ----------------------------------------------------------------------------------------------------------
class Rows:
    def __init__(self, db: sqlite3.Connection) -> None:
        self.db = db

    def write(self, ops: list[tuple]) -> list[str]:
        """One transaction: ``("row", Row)`` inserted unless its src is there already, ``("upd", src, fields)``
        applied to the row with that src, in order. Returns the srcs inserted or updated (for the live feed)."""
        touched: list[str] = []
        insert = ("INSERT OR IGNORE INTO timeline_events (" + ",".join(COLUMNS) + ") VALUES ("
                  + ",".join("?" * len(COLUMNS)) + ")")
        with self.db:
            batch: list[tuple] = []
            for op in ops:
                if op[0] == "row":
                    batch.append(op[1].values())
                    touched.append(op[1].src)
                    continue
                if batch:
                    self.db.executemany(insert, batch)
                    batch = []
                _, src, fields = op
                sets, args = [], []
                for k, v in fields.items():
                    if k not in COLUMNS or k == "src":
                        continue
                    sets.append(f"{k} = ?")
                    args.append(json.dumps(v, separators=(",", ":"), default=str) if k == "detail" else v)
                if sets:
                    self.db.execute(f"UPDATE timeline_events SET {', '.join(sets)} WHERE src = ?", (*args, src))
                    touched.append(src)
            if batch:
                self.db.executemany(insert, batch)
        return list(dict.fromkeys(touched))

    def by_src(self, srcs: Iterable[str]) -> list[dict]:
        srcs = list(srcs)
        out: list[dict] = []
        for i in range(0, len(srcs), 400):
            part = srcs[i:i + 400]
            out += [as_dict(r) for r in self.db.execute(
                f"SELECT * FROM timeline_events WHERE src IN ({','.join('?' * len(part))})", part)]
        return out

    def get(self, rid: int) -> dict | None:
        r = self.db.execute("SELECT * FROM timeline_events WHERE id = ?", (rid,)).fetchone()
        return as_dict(r) if r is not None else None

    def newest_per_entity(self) -> dict[str, tuple[str | None, float]]:
        """For each entity, the state its newest row recorded and when: where catching up starts."""
        out: dict[str, tuple[str | None, float]] = {}
        for r in self.db.execute("SELECT entity, detail, MAX(at) AS at FROM timeline_events WHERE entity IS NOT NULL "
                                 "AND src LIKE 'ha:%' GROUP BY entity"):
            try:
                s = json.loads(r["detail"] or "{}").get("s")
            except ValueError:
                s = None
            out[r["entity"]] = (s, float(r["at"]))
        return out

    def count(self) -> int:
        return int(self.db.execute("SELECT COUNT(*) FROM timeline_events").fetchone()[0])

    def chunk(self, *, before: int | None, since: float | None, until: float | None, families: Iterable[str] | None,
              entity: str | None, entities: Iterable[str] | None, area: str | None, q: str | None,
              actor: str | None, size: int) -> list[dict]:
        """Newest first, by id: one chunk of candidates for the viewer's own filter."""
        where, args = [], []
        if before is not None:
            where.append("id < ?")
            args.append(int(before))
        if since is not None:
            where.append("at >= ?")
            args.append(float(since))
        if until is not None:
            where.append("at < ?")
            args.append(float(until))
        fams = list(families) if families is not None else None
        if fams is not None:
            if not fams:
                return []
            where.append(f"family IN ({','.join('?' * len(fams))})")
            args += fams
        if entity is not None:
            where.append("entity = ?")
            args.append(entity)
        if entities is not None:
            ents = list(entities)
            if not ents:
                return []
            where.append(f"entity IN ({','.join('?' * len(ents))})")
            args += ents
        if area is not None:
            where.append("area = ?")
            args.append(area)
        if actor is not None:
            where.append("actor = ?")
            args.append(actor)
        for word in (q or "").lower().split()[:8]:
            word = "".join(ch for ch in word if ch.isalnum())[:SEARCH_MAX]
            if word:
                where.append("search LIKE ? ESCAPE '\\'")
                args.append(f"%{word}%")
        sql = "SELECT * FROM timeline_events" + (" WHERE " + " AND ".join(where) if where else "")
        return [as_dict(r) for r in self.db.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, int(size)))]

    def window(self, since: float, until: float) -> list[dict]:
        """Every row in [since, until), oldest first (the digest)."""
        return [as_dict(r) for r in self.db.execute(
            "SELECT * FROM timeline_events WHERE at >= ? AND at < ? ORDER BY at, id", (since, until))]

    def before(self, entity: str, at: float) -> dict | None:
        """The newest row of an entity before ``at`` (what it was when a window started)."""
        r = self.db.execute("SELECT * FROM timeline_events WHERE entity = ? AND at < ? AND src LIKE 'ha:%' "
                            "ORDER BY at DESC LIMIT 1", (entity, at)).fetchone()
        return as_dict(r) if r is not None else None

    # -- deleting ---------------------------------------------------------------------------------------------------
    def expired_pics(self, cutoff: float) -> list[tuple[str, float]]:
        return [(r[0], r[1]) for r in self.db.execute(
            "SELECT p.id, p.at FROM timeline_pics p JOIN timeline_events e ON e.id = p.event WHERE e.at < ?", (cutoff,))]

    def delete_before(self, cutoff: float) -> int:
        with self.db:
            return self.db.execute("DELETE FROM timeline_events WHERE at < ?", (cutoff,)).rowcount

    def person_arrivals(self, user_ids: Iterable[str]) -> int:
        ids = list(user_ids)
        if not ids:
            return 0
        with self.db:
            return self.db.execute(f"DELETE FROM timeline_events WHERE family = 'arrival' AND person IN "
                                   f"({','.join('?' * len(ids))})", ids).rowcount

    def all_pics(self, before: float | None = None) -> list[tuple[str, float]]:
        if before is None:
            return [(r[0], r[1]) for r in self.db.execute("SELECT id, at FROM timeline_pics")]
        return [(r[0], r[1]) for r in self.db.execute(
            "SELECT p.id, p.at FROM timeline_pics p JOIN timeline_events e ON e.id = p.event WHERE e.at < ?", (before,))]
