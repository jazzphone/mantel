"""P3.1 data layer: the connection, the migrations runner, and the upgrade from the Phase 0 schema."""
import hashlib
import os
import shutil
import sqlite3
import stat

import pytest

from mantel_server import db
from mantel_server.store import Store

PHASE0_SCHEMA = """
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
CREATE TABLE IF NOT EXISTS command_audit (
    id INTEGER PRIMARY KEY,
    timestamp REAL NOT NULL,
    actor TEXT,
    role TEXT,
    device TEXT NOT NULL CHECK (device = 'unknown'),
    action TEXT,
    target TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
    reason TEXT NOT NULL,
    dry_run INTEGER NOT NULL CHECK (dry_run = 1),
    source_ip TEXT
);
CREATE TRIGGER IF NOT EXISTS command_audit_no_update BEFORE UPDATE ON command_audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS command_audit_no_delete BEFORE DELETE ON command_audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
"""


def tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_fresh_database_modes_pragmas_and_version(tmp_path):
    path = tmp_path / "state" / "mantel.db"
    store = Store(path)
    try:
        assert stat.S_IMODE(os.stat(path.parent).st_mode) == 0o700
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
        assert store.db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert store.db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert db.schema_version(store.db) >= 1
        row = store.db.execute("SELECT * FROM schema_version WHERE version = 1").fetchone()
        assert row["name"] == "core" and len(row["checksum"]) == 64
        assert {"users", "ha_links", "sessions", "access_tokens", "refresh_tokens", "devices", "passkeys",
                "totp_credentials", "webauthn_challenges", "bootstrap_tokens", "command_audit"} <= tables(store.db)
        assert not {"links", "legacy_sessions"} & tables(store.db)
        store.db.execute("INSERT INTO command_audit (timestamp, device, decision, reason, dry_run) "
                         "VALUES (1, 'unknown', 'denied', 'x', 1)")
        store.db.commit()
        wal = path.with_name(path.name + "-wal")
        if wal.exists():
            assert stat.S_IMODE(os.stat(wal).st_mode) == 0o600
    finally:
        store.db.close()
    reopened = Store(path)  # a second open applies nothing and keeps the data
    try:
        assert reopened.db.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == len(db.discover())
        assert reopened.db.execute("SELECT COUNT(*) FROM command_audit").fetchone()[0] == 1
    finally:
        reopened.db.close()


def test_upgrade_from_phase0_keeps_links_sessions_and_audit(tmp_path):
    path = tmp_path / "mantel.db"
    old = sqlite3.connect(path)
    old.executescript(PHASE0_SCHEMA)
    cookie = "phase0-cookie-value"
    old.execute("INSERT INTO links VALUES ('ha-owner', 'owner', 'Fictional Owner', 100.0)")
    old.execute("INSERT INTO links VALUES ('ha-child', 'child', NULL, 101.0)")
    old.execute("INSERT INTO sessions VALUES (?, 'ha-owner', 200.0, 5000.0)", (hashlib.sha256(cookie.encode()).hexdigest(),))
    old.execute("INSERT INTO sessions VALUES ('deadbeef', 'ha-gone', 200.0, 5000.0)")  # unlinked: dropped
    old.execute("INSERT INTO command_audit (timestamp, actor, role, device, action, target, decision, reason, dry_run, "
                "source_ip) VALUES (300.0, 'ha-owner', 'owner', 'unknown', 'light.turn_on', 'light.proof2_demo', "
                "'allowed', 'granted', 1, '127.0.0.1')")
    old.commit()
    old.close()

    store = Store(path)
    try:
        assert db.schema_version(store.db) >= 1
        links = {r["ha_user_id"]: r for r in store.list_links()}
        assert set(links) == {"ha-owner", "ha-child"}
        assert links["ha-owner"]["role"] == "owner" and links["ha-owner"]["name"] == "Fictional Owner"
        assert links["ha-child"]["created"] == 101.0
        users = store.db.execute("SELECT kind, role FROM users ORDER BY created").fetchall()
        assert [(u["kind"], u["role"]) for u in users] == [("ha_linked", "owner"), ("ha_linked", "child")]
        # the Phase 0 cookie still signs in until it expires, through the new access-token table
        s = store.get_session(cookie, now=1000.0)
        assert s["ha_user_id"] == "ha-owner" and s["role"] == "owner" and s["expires"] == 5000.0
        assert store.get_session(cookie, now=5001.0) is None
        assert store.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
        assert store.db.execute("SELECT method, door FROM sessions").fetchone()[:] == ("legacy", "lan")
        audit = store.db.execute("SELECT * FROM command_audit").fetchall()
        assert len(audit) == 1 and audit[0]["decision"] == "allowed" and audit[0]["actor"] == "ha-owner"
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            with store.db:
                store.db.execute("DELETE FROM command_audit")
        assert store.db.execute("PRAGMA foreign_key_check").fetchall() == []
        # Phase 0 API keeps working on the migrated data
        store.link("ha-child", "adult")
        assert store.get_link("ha-child")["role"] == "adult"
        assert store.unlink("ha-owner") and store.get_session(cookie, now=1000.0) is None
    finally:
        store.db.close()


def test_runner_slots_in_later_migrations_in_number_order_even_if_merged_late(tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()
    shutil.copy(db.MIGRATIONS / "0001_core.sql", folder)
    (folder / "0003_settings.sql").write_text("CREATE TABLE settings_demo (k TEXT PRIMARY KEY, v TEXT);")
    conn = db.connect(tmp_path / "m.db")
    assert db.migrate(conn, folder) == [1, 3]
    # P3.2's file lands after P3.5's was applied: it still runs, once
    (folder / "0002_rbac.sql").write_text("CREATE TABLE grants_demo (id INTEGER PRIMARY KEY, user_id TEXT "
                                          "REFERENCES users(id) ON DELETE CASCADE);")
    assert db.migrate(conn, folder) == [2]
    assert db.migrate(conn, folder) == []
    assert db.schema_version(conn) == 3
    assert {"settings_demo", "grants_demo"} <= tables(conn)
    conn.close()


def test_failed_migration_leaves_nothing_behind(tmp_path):
    folder = tmp_path / "migrations"
    folder.mkdir()
    shutil.copy(db.MIGRATIONS / "0001_core.sql", folder)
    (folder / "0002_broken.sql").write_text("CREATE TABLE half_done (x INTEGER);\nINSERT INTO no_such_table VALUES (1);")
    conn = db.connect(tmp_path / "m.db")
    with pytest.raises(db.MigrationError, match="0002_broken"):
        db.migrate(conn, folder)
    assert "half_done" not in tables(conn) and "users" in tables(conn)
    assert sorted(db.applied(conn)) == [1]
    conn.close()


def test_bad_migration_names_and_duplicates_are_refused(tmp_path):
    folder = tmp_path / "m"
    folder.mkdir()
    (folder / "0001_a.sql").write_text("SELECT 1;")
    (folder / "0001_b.sql").write_text("SELECT 1;")
    with pytest.raises(db.MigrationError, match="share number"):
        db.discover(folder)
    (folder / "0001_b.sql").unlink()
    (folder / "2_Bad-Name.sql").write_text("SELECT 1;")
    with pytest.raises(db.MigrationError, match="NNNN_name"):
        db.discover(folder)


def test_changed_applied_migration_is_logged_not_rerun(tmp_path, caplog):
    folder = tmp_path / "migrations"
    folder.mkdir()
    shutil.copy(db.MIGRATIONS / "0001_core.sql", folder)
    conn = db.connect(tmp_path / "m.db")
    db.migrate(conn, folder)
    with open(folder / "0001_core.sql", "a") as f:
        f.write("\nCREATE TABLE edited_later (id INTEGER);\n")    # SQL, not a comment (a comment is not a change)
    assert db.migrate(conn, folder) == []
    assert "changed after it was applied" in caplog.text and "table edited_later is missing" in caplog.text
    conn.close()


def test_a_database_a_newer_mantel_migrated_is_refused(tmp_path):
    """migrate() skipped applied versions it didn't know, so a rolled-back update ran the old code on the new
    schema with no warning. It is refused, as a restore refuses a newer backup."""
    folder = tmp_path / "migrations"
    shutil.copytree(db.MIGRATIONS, folder)
    newest = max(m.version for m in db.discover(folder))
    (folder / f"{newest + 1:04d}_later.sql").write_text("CREATE TABLE later_thing (x INTEGER);")
    db.Database(tmp_path / "m.db", folder).close()
    with pytest.raises(db.MigrationError, match="schema_too_new"):
        db.Database(tmp_path / "m.db")


def test_processes_opening_a_new_database_at_once_all_succeed(tmp_path):
    """Two processes migrating at once both saw the same versions pending; the second crashed re-running the
    first's (the server after an update, while a `mantel …` command ran). One migrates; the others wait."""
    import subprocess
    import sys
    from pathlib import Path
    target = tmp_path / "mantel.db"
    code = f"from mantel_server import db; db.Database({str(target)!r}).close(); print('ok')"
    root = Path(__file__).resolve().parents[1]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(root / "hosts/server"), str(root)])}
    procs = [subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, env=env) for _ in range(4)]
    outs = [p.communicate(timeout=60) for p in procs]
    assert [o.strip() for o, _ in outs] == ["ok"] * 4, [e[-300:] for _, e in outs]
    conn = sqlite3.connect(target)
    versions = [r[0] for r in conn.execute("SELECT version FROM schema_version ORDER BY version")]
    conn.close()
    assert versions == sorted(set(versions)) and versions[-1] == max(m.version for m in db.discover(db.MIGRATIONS))


# -- migration checksums (audit, second pass) ---------------------------------------------------------------
def _warnings(caplog):
    return [r.getMessage() for r in caplog.records if "changed after it was applied" in r.getMessage()]


def test_a_comment_only_edit_to_an_applied_migration_is_not_warned_about(tmp_path, caplog):
    """DEP-3 (audit, second pass): the checksum covered the raw file, so rewording a comment of an applied
    migration (0015 and 0017 after release) warned on every start for ever. It now covers the SQL without comments
    or whitespace; a real change to the SQL still warns."""
    import logging
    folder = tmp_path / "m"
    folder.mkdir()
    (folder / "0001_a.sql").write_text("-- old words\nCREATE TABLE t (id INTEGER, note TEXT DEFAULT 'a -- b');\n")
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.migrate(conn, folder)
    (folder / "0001_a.sql").write_text("-- new words /* and more */\n\nCREATE  TABLE t (id INTEGER,\n  note TEXT DEFAULT 'a -- b');\n")
    with caplog.at_level(logging.WARNING, logger="mantel.db"):
        db.migrate(conn, folder)
        assert _warnings(caplog) == []
        (folder / "0001_a.sql").write_text("-- new words\nCREATE TABLE t (id INTEGER, note TEXT DEFAULT 'a -- c');\n")
        db.migrate(conn, folder)
    assert len(_warnings(caplog)) == 1                          # a string literal is SQL, not a comment


def _house_like(tmp_path):
    """A migrated database whose stored checksums are all unknown (as the house's are after the history rewrite)."""
    conn = sqlite3.connect(tmp_path / "h.db")
    conn.row_factory = sqlite3.Row
    db.migrate(conn)
    conn.execute("UPDATE schema_version SET checksum = 'from-before-the-rewrite'")
    conn.commit()
    return conn


def _data(conn):
    return {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY 1")]
            for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").fetchall()
            if t != "schema_version"}


def test_unknown_checksums_with_the_same_schema_are_quiet_and_refreshed(tmp_path, caplog):
    """The house's stored checksums predate a rewrite of old migration files; the schema is identical, so no
    warning, the checksums are refreshed, and the next start does no comparison."""
    import logging
    conn = _house_like(tmp_path)
    before = _data(conn)
    with caplog.at_level(logging.WARNING, logger="mantel.db"):
        assert db.migrate(conn) == []
    assert _warnings(caplog) == [] and caplog.records == []
    stored = {r["version"]: r["checksum"] for r in conn.execute("SELECT version, checksum FROM schema_version")}
    assert stored == {m.version: m.checksum for m in db.discover()}
    assert _data(conn) == before
    calls = []
    real = db._structure
    db._structure = lambda c: calls.append(c) or real(c)
    try:
        db.migrate(conn)
    finally:
        db._structure = real
    assert calls == []                                          # nothing differs now: no comparison


def test_a_real_schema_difference_warns_and_names_the_objects(tmp_path, caplog):
    import logging
    conn = _house_like(tmp_path)
    conn.execute("ALTER TABLE users ADD COLUMN by_hand TEXT")
    index = "passkeys_user"
    conn.execute(f"DROP INDEX {index}")
    conn.commit()
    before = _data(conn)
    with caplog.at_level(logging.WARNING, logger="mantel.db"):
        db.migrate(conn)
    text = " ".join(r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)
    assert "table users differs" in text and f"index {index} is missing" in text
    assert {r["checksum"] for r in conn.execute("SELECT checksum FROM schema_version")} == {"from-before-the-rewrite"}
    assert _data(conn) == before


