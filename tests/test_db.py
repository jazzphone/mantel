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
        f.write("\n-- edited\n")
    assert db.migrate(conn, folder) == []
    assert "changed after it was applied" in caplog.text
    conn.close()
