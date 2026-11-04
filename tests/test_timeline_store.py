"""The House Timeline's tables (migration 0033, timeline/store.py): the schema on a fresh database, one row per `src`,
the pruner that deletes picture files before rows (and the cascade that follows), the picture budget that keeps the
rows, the settings and their defaults, and a search that looks at the search words only. A bare Timeline on a temp
database; no server."""
from __future__ import annotations

import json
import os
import sqlite3
from types import SimpleNamespace

import pytest

from mantel_server import db as D
from mantel_server.registry import Registry
from mantel_server.state import StateStore
from mantel_server.store import Store
from mantel_server.timeline import store as TS
from mantel_server.timeline.core import Timeline
from mantel_server.timeline.pictures import Pictures
from mantel_server.timeline.store import DEFAULTS, Row, Settings

T0 = 1_800_000_000.0


class Env:
    def __init__(self, tmp_path):
        self.now = [T0]
        self.store = Store(tmp_path / "m.db")
        self.db = self.store.db
        self.hub = SimpleNamespace(store=StateStore(), registry=Registry(), taps=[], ha=None)
        self.app = {"cfg": None}
        self.tl = Timeline(self.app, self.hub, self.db, clock=lambda: self.now[0], folder=tmp_path / "timeline")
        self.pics = Pictures(self.app, self.tl)
        self.app["timeline_pictures"] = self.pics

    def row(self, src, at=None, **kw):
        kw.setdefault("family", "door")
        kw.setdefault("kind", "opened")
        kw.setdefault("title", "Back Door opened")
        kw.setdefault("entity", "binary_sensor.back_door")
        self.tl.push(Row(src=src, at=T0 if at is None else at, **kw))
        self.tl.flush()
        return self.db.execute("SELECT id FROM timeline_events WHERE src = ?", (src,)).fetchone()[0]

    def pic(self, event_id, at, size=3, data=b"jpg", camera="camera.driveway", pid=None):
        """A picture record and its file, as Pictures.store makes them."""
        pid = pid or os.urandom(16).hex()
        path = self.tl.pic_path(pid, at)
        if data is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        with self.db:
            self.db.execute("INSERT INTO timeline_pics (id, event, camera, at, size) VALUES (?,?,?,?,?)",
                            (pid, event_id, camera, at, size))
        return pid, path

    def count(self, table="timeline_events"):
        return self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    yield e
    e.db.close()


# -- the migration -----------------------------------------------------------------------------------------------------
def test_the_migration_applies_on_a_fresh_database(tmp_path):
    store = Store(tmp_path / "fresh" / "m.db")
    try:
        conn = store.db
        names = {(r["type"], r["name"]) for r in conn.execute("SELECT type, name FROM sqlite_master")}
        for table in ("timeline_events", "timeline_pics", "timeline_settings", "timeline_digests"):
            assert ("table", table) in names
        for index in ("timeline_at", "timeline_family_at", "timeline_entity_at", "timeline_person_at",
                      "timeline_actor_at", "timeline_pics_event", "timeline_pics_at"):
            assert ("index", index) in names
        assert ("trigger", "timeline_forget_person") in names
        assert conn.execute("SELECT name FROM schema_version WHERE version = 33").fetchone()[0] == "timeline"
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(timeline_events)")]
        assert cols == ["id", "src", "at", "ended", "family", "kind", "level", "entity", "area", "title", "search",
                        "detail", "person", "actor", "actor_name", "device", "device_name", "how", "audit_id"]
        assert set(TS.COLUMNS) == set(cols) - {"id"}
        # the partial indexes are partial (a row with no person is not in the person index)
        sql = {r["name"]: r["sql"] for r in conn.execute("SELECT name, sql FROM sqlite_master WHERE type = 'index'")}
        assert "WHERE person IS NOT NULL" in sql["timeline_person_at"]
        assert "WHERE actor IS NOT NULL" in sql["timeline_actor_at"]
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        # the timeline is no evidence: no append-only triggers (the audit is)
        triggers = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
        assert not [t for t in triggers if t.startswith("timeline") and t != "timeline_forget_person"]
        assert D.schema_version(conn) >= 33
    finally:
        store.db.close()


def test_the_migration_runs_once_and_a_reopened_database_keeps_its_rows(tmp_path):
    path = tmp_path / "m.db"
    store = Store(path)
    with store.db:
        store.db.execute("INSERT INTO timeline_events (src, at, family, kind, title) VALUES ('a', 1, 'door', 'opened', 'x')")
    store.db.close()
    store = Store(path)
    try:
        assert store.db.execute("SELECT COUNT(*) FROM timeline_events").fetchone()[0] == 1
        assert store.db.execute("SELECT COUNT(*) FROM schema_version WHERE version = 33").fetchone()[0] == 1
    finally:
        store.db.close()


def test_src_is_unique_and_the_trigger_forgets_a_removed_person(env):
    with env.db:
        env.db.execute("INSERT INTO timeline_events (src, at, family, kind, title) VALUES ('a', 1, 'door', 'opened', 'x')")
    with pytest.raises(sqlite3.IntegrityError):
        with env.db:
            env.db.execute("INSERT INTO timeline_events (src, at, family, kind, title) VALUES ('a', 2, 'door', 'closed', 'y')")
    with env.db:
        for uid, name in (("u1", "Emma"), ("u2", "Mark")):
            env.db.execute("INSERT INTO users (id, username, name, role, kind, created, updated) "
                           "VALUES (?,?,?,'adult','hk',0,0)", (uid, name.lower(), name))
    env.row("arr1", family="arrival", kind="arrived", title="Emma arrived home", entity="person.emma", person="u1")
    env.row("arr2", family="arrival", kind="arrived", title="Mark arrived home", entity="person.mark", person="u2")
    env.row("lock1", family="lock", kind="unlocked", title="Back Door unlocked", entity="lock.back_door",
            actor="u1", actor_name="Emma", device="d1", device_name="Hallway tablet", how="tablet", audit_id=4)
    with env.db:
        env.db.execute("DELETE FROM users WHERE id = 'u1'")
    rows = {r["src"]: dict(r) for r in env.db.execute("SELECT * FROM timeline_events")}
    assert set(rows) == {"a", "arr2", "lock1"}                           # Emma's arrival went
    assert rows["lock1"]["actor"] is None and rows["lock1"]["actor_name"] == "A former member"
    assert rows["lock1"]["device_name"] is None and rows["lock1"]["audit_id"] == 4   # the device goes too (it can carry a name)
    assert rows["arr2"]["person"] == "u2"


# -- one row per src ---------------------------------------------------------------------------------------------------
def test_a_src_is_written_once_and_a_second_write_changes_nothing(env):
    env.row("ha:lock.back_door:1", title="Back Door locked", kind="locked", family="lock")
    env.tl.push(Row(src="ha:lock.back_door:1", at=T0 + 5, family="lock", kind="unlocked", title="Back Door unlocked"))
    env.tl.push(Row(src="ha:lock.back_door:2", at=T0 + 6, family="lock", kind="unlocked", title="Back Door unlocked"))
    written = env.tl.flush()
    assert env.count() == 2
    first = env.db.execute("SELECT * FROM timeline_events WHERE src = 'ha:lock.back_door:1'").fetchone()
    assert (first["title"], first["kind"], first["at"]) == ("Back Door locked", "locked", T0)    # the first stays
    assert {r["src"] for r in written} == {"ha:lock.back_door:1", "ha:lock.back_door:2"}


def test_a_later_update_of_a_row_sets_its_end_and_merges_its_detail(env):
    env.row("pt:e1:person", family="detection", kind="person", entity="camera.driveway", title="Person at Driveway Cam",
            detail={"source": "protect"})
    env.tl.update("pt:e1:person", {"ended": T0 + 30, "detail": {"count": 2}})
    env.tl.update("pt:nothing:person", {"ended": T0})                    # no such row: nothing happens
    env.tl.flush()
    r = TS.as_dict(env.db.execute("SELECT * FROM timeline_events").fetchone())
    assert r["ended"] == T0 + 30 and r["detail"] == {"source": "protect", "count": 2} and env.count() == 1
    # fields that aren't columns, and the src itself, are never written
    env.tl.rows.write([("upd", "pt:e1:person", {"src": "other", "nope": 1, "title": "Person at Drive"})])
    r = TS.as_dict(env.db.execute("SELECT * FROM timeline_events").fetchone())
    assert r["src"] == "pt:e1:person" and r["title"] == "Person at Drive"


def test_a_row_is_stored_with_its_limits(env):
    env.tl.push(Row(src="x", at=T0, family="door", kind="opened", title="T" * 400, search="s" * 900,
                    detail={"n": 1}))
    env.tl.flush()
    r = env.db.execute("SELECT * FROM timeline_events").fetchone()
    assert len(r["title"]) == 200 and len(r["search"]) == 300 and json.loads(r["detail"]) == {"n": 1}
    assert r["level"] == "info"


# -- search matches `search` only --------------------------------------------------------------------------------------
def test_search_looks_at_the_search_words_and_nothing_else(env):
    env.row("lock", family="lock", kind="unlocked", title="Back Door unlocked", search="back door unlocked hallway",
            actor="u1", actor_name="Emma", device_name="Emma's iPad")
    env.row("arr", family="arrival", kind="arrived", title="Emma arrived home", search="arrived home", person="u1",
            entity="person.emma")

    def find(q):
        return [r["src"] for r in env.tl.rows.chunk(before=None, since=None, until=None, families=None, entity=None,
                                                    entities=None, area=None, q=q, actor=None, size=50)]
    assert find("emma") == [] and find("EMMA") == [] and find("ipad") == [] and find("emma arrived") == []
    assert find("back") == ["lock"] and find("hallway") == ["lock"] and find("arrived home") == ["arr"]
    assert find("back unlocked") == ["lock"] and find("back arrived") == []
    assert sorted(find(None)) == ["arr", "lock"] and sorted(find("")) == ["arr", "lock"]
    # punctuation and wildcards in a word are dropped, never passed to LIKE
    assert find("back%") == ["lock"] and sorted(find("%_")) == ["arr", "lock"]      # no word left: no filter
    assert find("ba_k") == [] and find("ba%k") == []


def test_chunks_are_newest_first_and_filtered_in_the_query(env):
    ids = [env.row(f"r{i}", at=T0 + i, family="door" if i % 2 else "lock", entity=f"x.e{i % 3}", area="hall" if i < 3 else "drive",
                   actor="u1" if i == 4 else None) for i in range(8)]

    def srcs(**kw):
        base = dict(before=None, since=None, until=None, families=None, entity=None, entities=None, area=None, q=None,
                    actor=None, size=50)
        return [r["src"] for r in env.tl.rows.chunk(**{**base, **kw})]
    assert srcs() == [f"r{i}" for i in range(7, -1, -1)]
    assert srcs(size=3) == ["r7", "r6", "r5"] and srcs(before=ids[5]) == ["r4", "r3", "r2", "r1", "r0"]
    assert srcs(families=["lock"]) == ["r6", "r4", "r2", "r0"] and srcs(families=[]) == []
    assert srcs(entity="x.e1") == ["r7", "r4", "r1"] and srcs(entities=["x.e0", "x.e2"]) == ["r6", "r5", "r3", "r2", "r0"]
    assert srcs(entities=[]) == []
    assert srcs(area="hall") == ["r2", "r1", "r0"] and srcs(actor="u1") == ["r4"]
    assert srcs(since=T0 + 2, until=T0 + 5) == ["r4", "r3", "r2"]


# -- retention and the pruner ------------------------------------------------------------------------------------------
def test_the_pruner_deletes_picture_files_before_rows_and_the_cascade_follows(env, monkeypatch):
    old = env.row("old", at=T0 - 40 * 86400)
    new = env.row("new", at=T0 - 86400)
    _, old_a = env.pic(old, T0 - 40 * 86400)
    _, old_b = env.pic(old, T0 - 40 * 86400 + 5)
    keep_id, keep_path = env.pic(new, T0 - 86400)
    order = []
    real_delete_files, real_delete_before = env.tl.delete_files, env.tl.rows.delete_before

    def files(pics):
        order.append(("files", [p.exists() for p in (old_a, old_b)]))
        return real_delete_files(pics)

    def rows(cutoff):
        order.append(("rows", [p.exists() for p in (old_a, old_b)]))
        return real_delete_before(cutoff)
    monkeypatch.setattr(env.tl, "delete_files", files)
    monkeypatch.setattr(env.tl.rows, "delete_before", rows)
    assert env.tl.prune() == 1
    assert order == [("files", [True, True]), ("rows", [False, False])]          # the files were gone when the rows went
    assert not old_a.exists() and not old_b.exists() and keep_path.exists()
    assert [r[0] for r in env.db.execute("SELECT id FROM timeline_pics")] == [keep_id]    # the cascade
    assert [r[0] for r in env.db.execute("SELECT src FROM timeline_events")] == ["new"]


def test_retention_follows_the_setting_and_an_unknown_value_is_thirty_days(env):
    env.row("d10", at=T0 - 10 * 86400)
    env.row("d40", at=T0 - 40 * 86400)
    env.row("d100", at=T0 - 100 * 86400)
    env.tl.settings.set("retention_days", 7)
    assert env.tl.prune() == 3
    env.row("d10b", at=T0 - 10 * 86400)
    env.row("d40b", at=T0 - 40 * 86400)
    env.tl.settings.set("retention_days", 90)
    assert env.tl.prune() == 0
    env.tl.settings.set("retention_days", 13)                            # not one of the choices: 30 days
    assert env.tl.prune() == 1
    assert [r[0] for r in env.db.execute("SELECT src FROM timeline_events")] == ["d10b"]


def test_a_missing_file_does_not_stop_the_pruner(env):
    old = env.row("old", at=T0 - 40 * 86400)
    env.pic(old, T0 - 40 * 86400, data=None)                             # the file is gone already
    assert env.tl.prune() == 1 and env.count("timeline_pics") == 0


def test_clearing_deletes_rows_and_pictures_and_what_was_still_queued(env):
    a = env.row("a", at=T0 - 100)
    _, path = env.pic(a, T0 - 100)
    env.tl.push(Row(src="queued", at=T0, family="door", kind="closed", title="Back Door closed"))
    assert env.tl.clear() == 2
    assert not path.exists() and env.count() == 0 and env.count("timeline_pics") == 0


# -- the picture budget ------------------------------------------------------------------------------------------------
MB = 1024 * 1024


def test_the_budget_deletes_the_oldest_pictures_and_keeps_their_rows(env):
    env.tl.settings.set("pictures", {"budget_mb": 50, "frames": 2})
    ev = [env.row(f"e{i}", at=T0 - 1000 + i) for i in range(4)]
    made = [env.pic(ev[i], T0 - 1000 + i, size=30 * MB, data=b"x" * (i + 1)) for i in range(4)]      # 120 MB
    assert env.pics.budget_bytes() == 50 * MB
    assert env.pics.budget() == 3                                        # 120 -> 90 -> 60 -> 30
    assert [p.exists() for _, p in made] == [False, False, False, True]
    assert [r[0] for r in env.db.execute("SELECT id FROM timeline_pics")] == [made[3][0]]
    assert env.count() == 4                                              # every row stays
    assert env.pics.budget() == 0                                        # under budget: nothing more
    st = env.pics.status()
    assert st["kept"] == 1 and st["bytes"] == 30 * MB and st["budget_bytes"] == 50 * MB


def test_the_budget_follows_the_setting_and_a_wild_value_is_500_mb(env):
    for value in (None, "big", 7, 10**9, True, 0):
        env.tl.settings.set("pictures", {"budget_mb": value, "frames": 2})
        assert env.pics.budget_bytes() == 500 * MB, value
    env.tl.settings.set("pictures", {"budget_mb": 1000, "frames": 2})
    assert env.pics.budget_bytes() == 1000 * MB
    env.tl.settings.set("pictures", "nonsense")
    assert env.pics.budget_bytes() == 500 * MB and env.pics.frames() == 2


def test_the_pruner_runs_the_budget_too(env):
    env.tl.settings.set("pictures", {"budget_mb": 50, "frames": 2})
    e = env.row("e", at=T0 - 10)
    a, pa = env.pic(e, T0 - 20, size=40 * MB)
    b, pb = env.pic(e, T0 - 10, size=40 * MB)
    env.tl.prune()
    assert not pa.exists() and pb.exists() and [r[0] for r in env.db.execute("SELECT id FROM timeline_pics")] == [b]


# -- settings ----------------------------------------------------------------------------------------------------------
def test_settings_default_and_round_trip(env):
    s = Settings(env.db, clock=lambda: T0)
    assert s.get("retention_days") == 30 and s.get("families") == {} and s.get("overrides") == {}
    assert s.get("pictures") == {"budget_mb": 500, "frames": 2}
    assert s.get("wall") == {"families": ["door", "lock", "garage", "alarm", "doorbell", "detection"], "pictures": []}
    assert s.get("digest") == {"at": "07:00", "from": "21:00"}
    assert s.get("never_heard_of_it") is None
    assert set(s.all()) == set(DEFAULTS) and s.all()["retention_days"] == 30
    s.set("retention_days", 90)
    s.set("families", {"window": True})
    s.set("overrides", {"binary_sensor.loft": {"record": True, "label": "Loft Hatch"}})
    s.set("wall", {"families": ["door"], "pictures": ["tablet-1"]})
    again = Settings(env.db)                                              # another instance reads what was saved
    assert again.get("retention_days") == 90 and again.get("families") == {"window": True}
    assert again.get("overrides") == {"binary_sensor.loft": {"record": True, "label": "Loft Hatch"}}
    assert again.get("wall") == {"families": ["door"], "pictures": ["tablet-1"]}
    assert again.get("digest") == {"at": "07:00", "from": "21:00"}        # untouched keys keep their default
    row = env.db.execute("SELECT value, updated FROM timeline_settings WHERE key = 'retention_days'").fetchone()
    assert (row["value"], row["updated"]) == ("90", T0)
    # a second write replaces the first (one row per key)
    s.set("retention_days", 7)
    assert env.count("timeline_settings") == 4 and Settings(env.db).get("retention_days") == 7


def test_a_damaged_setting_reads_as_its_default(env):
    with env.db:
        env.db.execute("INSERT INTO timeline_settings (key, value, updated) VALUES ('retention_days', '{oops', 0)")
    assert Settings(env.db).get("retention_days") == 30


def test_the_default_families_and_the_rest_of_what_is_on(env):
    from hk_core.timeline import classify as C
    assert not env.tl.on("window") and all(env.tl.on(f) for f in C.FAMILIES if f != "window")
    env.tl.settings.set("families", {"window": True, "garage": False})
    assert env.tl.on("window") and not env.tl.on("garage") and env.tl.on("lock")
    env.tl.settings.set("families", {"garage": "yes"})                   # not a switch: the family's default
    assert env.tl.on("garage")


# -- the rows' other helpers -------------------------------------------------------------------------------------------
def test_person_arrivals_and_the_window_and_what_an_entity_last_was(env):
    env.row("a1", at=T0 - 30, family="arrival", kind="arrived", title="x", entity="person.p", person="u1")
    env.row("a2", at=T0 - 20, family="arrival", kind="left", title="x", entity="person.p", person="u2")
    env.row("ha:lock.b:1", at=T0 - 10, family="lock", kind="locked", title="Back Door locked", entity="lock.b",
            person="u1", detail={"s": "locked"})
    assert env.tl.rows.person_arrivals(["u1"]) == 1 and env.tl.rows.person_arrivals([]) == 0
    assert [r["src"] for r in env.tl.rows.window(T0 - 25, T0)] == ["a2", "ha:lock.b:1"]
    assert env.tl.rows.newest_per_entity() == {"lock.b": ("locked", T0 - 10)}
    assert env.tl.rows.before("lock.b", T0)["src"] == "ha:lock.b:1" and env.tl.rows.before("lock.b", T0 - 10) is None
    assert env.tl.rows.get(10**6) is None
