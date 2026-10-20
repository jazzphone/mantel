"""Encrypted backups and the tested restore (backup.py): a round trip with a row in every table, WAL-safe
snapshots, wrong key / corrupted / truncated files fail clearly, rotation, the restore's gates (integrity,
schema version, fresh data dir), the CLI, the nightly job and its REST status."""
import asyncio
import os
import re
import shutil
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

# the newest schema this build migrates to: the migrations folder decides, never a literal
LATEST = max(int(p.name[:4]) for p in
             (Path(__file__).resolve().parents[1] / "hosts/server/mantel_server/migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))
from argon2 import PasswordHasher

from conftest import PASSWORD, Mantel
from mantel_server import backup as bk
from mantel_server import db as dbmod
from mantel_server.__main__ import main as cli_main
from mantel_server.backup import BackupError

UTC = timezone.utc
NOW = datetime(2026, 10, 18, 3, 15, tzinfo=UTC)
SECRET_MARKER = "marker-that-must-not-appear-in-the-backup-file"


# -- a database with a row in every table -----------------------------------------------------------
def _constraint(sql: str, col: str):
    for pat in (rf"\b{col}\s+IN\s*\(\s*(?:'([^']*)'|(-?\d+))", rf"\b{col}\s*=\s*(?:'([^']*)'|(-?\d+))",
                rf"\b{col}\s*>=\s*()(-?\d+)"):
        m = re.search(pat, sql)
        if m:
            text, num = m.group(1), m.group(2)
            return text if text is not None and text != "" else int(num)
    return None


def fill_every_table(conn: sqlite3.Connection) -> list[str]:
    """Insert one row into every table the migrations made (honouring CHECKs and foreign keys). Returns the tables."""
    tables = {r[0]: r[1] for r in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version'")}
    todo = dict(tables)
    for _ in range(len(tables) + 2):
        for name in list(todo):
            fks = {r["from"]: (r["table"], r["to"]) for r in conn.execute(f'PRAGMA foreign_key_list("{name}")')}
            if any(conn.execute(f'SELECT 1 FROM "{p}" LIMIT 1').fetchone() is None for p, _ in fks.values()):
                continue
            cols, vals = [], []
            for c in conn.execute(f'PRAGMA table_info("{name}")'):
                col, typ = c["name"], (c["type"] or "").upper()
                forced = _constraint(todo[name], col)
                if col in fks:
                    parent, pcol = fks[col]
                    value = conn.execute(f'SELECT "{pcol or "rowid"}" FROM "{parent}" LIMIT 1').fetchone()[0]
                elif forced is not None:
                    value = forced
                elif c["pk"] and typ == "INTEGER":
                    continue
                elif "INT" in typ:
                    value = 1
                elif typ in ("REAL", "FLOAT", "NUMERIC"):
                    value = 1_000_000.5
                elif "BLOB" in typ:
                    value = f"blob-{name}-{col}".encode()
                else:
                    value = f"{name}.{col}.{SECRET_MARKER}" if (name, col) == ("settings_docs", "value") else f"{name}.{col}"
                cols.append(f'"{col}"')
                vals.append(value)
            conn.execute(f'INSERT INTO "{name}" ({",".join(cols)}) VALUES ({",".join("?" * len(vals))})', vals)
            del todo[name]
    conn.commit()
    assert not todo, f"could not fill {sorted(todo)}"
    return sorted(tables)


def dump(path: Path) -> dict:
    conn = sqlite3.connect(str(path))
    try:
        names = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        return {n: [tuple(r) for r in conn.execute(f'SELECT * FROM "{n}" ORDER BY rowid')] for n in names}
    finally:
        conn.close()


def make_home(tmp_path, name="data", *, files=True, big=0) -> Path:
    data = tmp_path / name
    database = dbmod.Database(data / "mantel.db")
    fill_every_table(database.conn)
    database.close()
    if files:
        (data / "user-files" / "hk" / "fonts").mkdir(parents=True)
        (data / "user-files" / "hk" / "fonts" / "Dummy.ttf").write_bytes(b"dummy font bytes")
        (data / "user-files" / "photos").mkdir()
        (data / "user-files" / "photos" / ("a" * 32 + ".jpg")).write_bytes(b"dummy photo bytes")
        if big:
            (data / "user-files" / "photos" / ("b" * 32 + ".png")).write_bytes(os.urandom(big))
    return data


@pytest.fixture
def key():
    return os.urandom(32)


@pytest.fixture
def target(tmp_path):
    t = tmp_path / "nas"
    t.mkdir()
    return t


# -- the round trip ---------------------------------------------------------------------------------
def test_round_trip_with_a_row_in_every_table(tmp_path, key, target):
    data = make_home(tmp_path)
    before = dump(data / "mantel.db")
    assert len(before) >= 20 and all(rows for name, rows in before.items()), \
        [n for n, r in before.items() if not r]
    out = bk.create_backup(data, target, key, now=NOW)
    assert out.name == "mantel-20261018-031500.mbk" and out.stat().st_mode & 0o777 == 0o600
    raw = out.read_bytes()
    assert SECRET_MARKER.encode() not in raw and b"SQLite format" not in raw and b"Dummy" not in raw
    assert bk.read_meta(out)["schema"] == LATEST
    fresh = tmp_path / "fresh"
    report = bk.restore(out, key, fresh)
    assert report.schema == LATEST and report.files == 2 and not report.replaced and report.migrated == []
    after = dump(fresh / "mantel.db")
    assert after == before                                              # every table, every row
    conn = sqlite3.connect(str(fresh / "mantel.db"))
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()
    assert oct((fresh / "mantel.db").stat().st_mode & 0o777) == oct(0o600)
    assert (fresh / "user-files/hk/fonts/Dummy.ttf").read_bytes() == b"dummy font bytes"
    assert (fresh / "user-files/photos" / ("a" * 32 + ".jpg")).read_bytes() == b"dummy photo bytes"
    assert list(fresh.glob(".restore-*")) == [] and not list(fresh.glob("mantel.db-*"))
    reopened = dbmod.Database(fresh / "mantel.db")                       # the app can use it
    assert reopened.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    reopened.close()


def test_no_files_switch_and_a_backup_without_a_files_tree(tmp_path, key, target):
    data = make_home(tmp_path)
    out = bk.create_backup(data, target, key, now=NOW, include_files=False)
    fresh = tmp_path / "fresh"
    assert bk.restore(out, key, fresh).files == 0 and not (fresh / "user-files").exists()
    bare = make_home(tmp_path, "bare", files=False)
    out = bk.create_backup(bare, target, key, now=NOW + timedelta(days=1))
    assert bk.restore(out, key, tmp_path / "fresh2").files == 0


def test_a_snapshot_is_consistent_while_the_server_writes_in_wal_mode(tmp_path, key, target):
    data = make_home(tmp_path)
    live = dbmod.connect(data / "mantel.db")                             # the server's own kind of connection
    assert live.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    stop, errors = threading.Event(), []

    def writer():
        n = 0
        c = dbmod.connect(data / "mantel.db")
        while not stop.is_set():
            try:
                with c:
                    c.execute("INSERT INTO action_audit (timestamp, kind, decision, reason) VALUES (?, 'system', 'allowed', ?)",
                              (float(n), f"w{n}"))
                n += 1
            except sqlite3.OperationalError as exc:      # a lock timeout is not what this test is about
                errors.append(exc)
        c.close()

    t = threading.Thread(target=writer)
    t.start()
    try:
        outs = [bk.create_backup(data, target, key, now=NOW + timedelta(days=i)) for i in range(3)]
    finally:
        stop.set()
        t.join()
    live.close()
    for i, out in enumerate(outs):
        fresh = tmp_path / f"fresh{i}"
        rep = bk.restore(out, key, fresh)
        assert rep.schema == LATEST
        conn = sqlite3.connect(str(fresh / "mantel.db"))
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT COUNT(*) FROM action_audit").fetchone()[0] >= 1
        conn.close()


# -- wrong key, damage -------------------------------------------------------------------------------
def test_wrong_key_fails_clearly_and_changes_nothing(tmp_path, key, target):
    out = bk.create_backup(make_home(tmp_path), target, key, now=NOW)
    fresh = tmp_path / "fresh"
    with pytest.raises(BackupError) as exc:
        bk.restore(out, os.urandom(32), fresh)
    assert exc.value.code == "wrong_key" and "not the key" in str(exc.value)
    assert not (fresh / "mantel.db").exists() and not list(fresh.glob(".restore-*"))


@pytest.mark.parametrize("damage", ["flip_middle", "flip_last", "truncate_tail", "append", "truncate_header"])
def test_a_damaged_backup_does_not_open(tmp_path, key, target, damage):
    out = bk.create_backup(make_home(tmp_path, big=2_500_000), target, key, now=NOW)
    raw = bytearray(out.read_bytes())
    assert len(raw) > 2 * bk.CHUNK + 500                                  # several chunks
    if damage == "flip_middle":
        raw[len(raw) // 2] ^= 0x01
    elif damage == "flip_last":
        raw[-1] ^= 0x80
    elif damage == "truncate_tail":
        del raw[-100:]
    elif damage == "append":
        raw += b"\x00" * 33
    else:
        del raw[60:]
    out.write_bytes(raw)
    with pytest.raises(BackupError) as exc:
        bk.restore(out, key, tmp_path / "fresh")
    assert exc.value.code in ("corrupt", "wrong_key", "not_a_backup")
    assert not (tmp_path / "fresh" / "mantel.db").exists()


def test_dropping_or_reordering_whole_chunks_is_caught(tmp_path, key, target):
    out = bk.create_backup(make_home(tmp_path, big=3_000_000), target, key, now=NOW)
    raw = out.read_bytes()
    meta, head, check, _salt, _prefix = bk._read_header(open(out, "rb"))
    start = len(head) + len(check)
    size = bk.CHUNK + bk.TAG
    body = raw[start:]
    assert len(body) > 2 * size
    swapped = raw[:start] + body[size:2 * size] + body[:size] + body[2 * size:]
    cut = raw[:start] + body[:size] + body[2 * size:]                       # chunk 1 removed
    for blob in (swapped, cut):
        out.write_bytes(blob)
        with pytest.raises(BackupError) as exc:
            bk.restore(out, key, tmp_path / "fresh", verify_only=True)
        assert exc.value.code == "corrupt"


def test_not_a_backup_and_missing_files(tmp_path, key):
    junk = tmp_path / "junk.mbk"
    junk.write_bytes(b"hello world, this is not a backup file at all" * 3)
    with pytest.raises(BackupError) as exc:
        bk.restore(junk, key, tmp_path / "f", verify_only=True)
    assert exc.value.code == "not_a_backup"
    with pytest.raises(BackupError) as exc:
        bk.restore(tmp_path / "absent.mbk", key, tmp_path / "f")
    assert exc.value.code == "not_found"


def test_the_restore_gate_refuses_a_bad_database_and_leaves_the_data_dir_alone(tmp_path, key):
    """A well-sealed backup whose database is damaged must not be swapped in."""
    import gzip
    import io
    import json
    import tarfile
    work = tmp_path / "work"
    work.mkdir()
    (work / "mantel.db").write_bytes(b"SQLite format 3\x00" + os.urandom(4096))
    payload = work / "p.tar.gz"
    with gzip.open(payload, "wb") as gz, tarfile.open(fileobj=gz, mode="w") as tar:
        tar.add(work / "mantel.db", arcname="mantel.db")
        blob = json.dumps({"format": bk.FORMAT, "schema": 7, "tables": {}}).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size = len(blob)
        tar.addfile(info, io.BytesIO(blob))
    bad = tmp_path / "bad.mbk"
    with open(payload, "rb") as src, open(bad, "wb") as dst:
        bk.seal_stream(src, dst, key, {"format": bk.FORMAT})
    data = tmp_path / "data"
    data.mkdir()
    (data / "mantel.db").write_bytes(b"the current database")
    with pytest.raises(BackupError) as exc:
        bk.restore(bad, key, data, replace=True)
    assert exc.value.code == "database_invalid"
    assert (data / "mantel.db").read_bytes() == b"the current database"
    assert not list(data.glob(".restore-*")) and not list(data.glob("*.before-restore-*"))


def test_an_archive_with_a_traversal_or_link_is_refused(tmp_path, key):
    import gzip
    import io
    import tarfile
    for kind in ("traversal", "symlink"):
        payload = tmp_path / f"{kind}.tar.gz"
        with gzip.open(payload, "wb") as gz, tarfile.open(fileobj=gz, mode="w") as tar:
            if kind == "traversal":
                info = tarfile.TarInfo("user-files/../../evil")
                info.size = 1
                tar.addfile(info, io.BytesIO(b"x"))
            else:
                info = tarfile.TarInfo("user-files/link")
                info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
                tar.addfile(info)
        bad = tmp_path / f"{kind}.mbk"
        with open(payload, "rb") as src, open(bad, "wb") as dst:
            bk.seal_stream(src, dst, key, {"format": bk.FORMAT})
        with pytest.raises(BackupError) as exc:
            bk.restore(bad, key, tmp_path / f"d-{kind}")
        assert exc.value.code == "corrupt"
        assert not (tmp_path / "evil").exists()


# -- schema version ---------------------------------------------------------------------------------
def test_a_backup_from_a_newer_mantel_is_refused(tmp_path, key, target):
    data = make_home(tmp_path)
    conn = sqlite3.connect(str(data / "mantel.db"))
    conn.execute("INSERT INTO schema_version (version, name, checksum, applied) VALUES (99, 'future', 'x', 1.0)")
    conn.commit()
    conn.close()
    out = bk.create_backup(data, target, key, now=NOW)
    with pytest.raises(BackupError) as exc:
        bk.restore(out, key, tmp_path / "fresh")
    assert exc.value.code == "schema_too_new" and "0099" in str(exc.value)
    assert not (tmp_path / "fresh" / "mantel.db").exists()


def test_an_older_backup_is_migrated_to_this_build_before_it_is_swapped_in(tmp_path, key, target):
    old = tmp_path / "old_migrations"
    old.mkdir()
    for p in sorted(dbmod.MIGRATIONS.glob("000[1-3]_*.sql")):
        shutil.copy(p, old / p.name)
    data = tmp_path / "data"
    database = dbmod.Database(data / "mantel.db", old)
    database.conn.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES ('u1','Ann','owner','hk',1,1)")
    database.conn.commit()
    database.close()
    out = bk.create_backup(data, target, key, now=NOW)
    assert bk.read_meta(out)["schema"] == 3
    fresh = tmp_path / "fresh"
    report = bk.restore(out, key, fresh)
    assert report.schema == 3 and report.migrated == list(range(4, LATEST + 1))
    conn = sqlite3.connect(str(fresh / "mantel.db"))
    assert conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == LATEST
    assert conn.execute("SELECT name FROM users").fetchone()[0] == "Ann"
    conn.close()


# -- the data dir ------------------------------------------------------------------------------------
def test_restore_needs_a_fresh_data_dir_or_replace_and_never_deletes(tmp_path, key, target):
    data = make_home(tmp_path)
    out = bk.create_backup(data, target, key, now=NOW)
    live = tmp_path / "live"
    live.mkdir()
    (live / "mantel.db").write_bytes(b"old db")
    (live / "mantel.db-wal").write_bytes(b"stale wal that would corrupt the restored file")
    (live / "user-files").mkdir()
    (live / "user-files" / "mine.txt").write_text("keep me")
    with pytest.raises(BackupError) as exc:
        bk.restore(out, key, live)
    assert exc.value.code == "data_dir_not_fresh"
    assert (live / "mantel.db").read_bytes() == b"old db"
    # verify-only changes nothing at all
    rep = bk.restore(out, key, live, verify_only=True)
    assert rep.verified_only and (live / "mantel.db").read_bytes() == b"old db"
    # replace: the old files are moved aside, the stale WAL does not stay beside the new database
    rep = bk.restore(out, key, live, replace=True, now=NOW)
    assert len(rep.replaced) == 3
    assert not (live / "mantel.db-wal").exists()
    assert (live / "mantel.db.before-restore-20261018-031500").read_bytes() == b"old db"
    assert (live / "mantel.db-wal.before-restore-20261018-031500").exists()
    assert (live / "user-files.before-restore-20261018-031500" / "mine.txt").read_text() == "keep me"
    assert dump(live / "mantel.db") == dump(data / "mantel.db")


def test_a_missing_target_is_an_error_not_a_new_folder(tmp_path, key):
    data = make_home(tmp_path)
    with pytest.raises(BackupError) as exc:
        bk.create_backup(data, tmp_path / "unmounted" / "nas", key, now=NOW)
    assert exc.value.code == "target_missing" and "mounted" in str(exc.value)
    assert not (tmp_path / "unmounted").exists()
    with pytest.raises(BackupError) as exc:
        bk.create_backup(tmp_path / "no-data", tmp_path, key, now=NOW)
    assert exc.value.code == "no_database"


def test_the_plaintext_snapshot_never_touches_the_target(tmp_path, key, target, monkeypatch):
    data = make_home(tmp_path)
    seen = []
    real = bk.snapshot_db

    def spy(src, dst):
        seen.append(Path(dst))
        return real(src, dst)

    monkeypatch.setattr(bk, "snapshot_db", spy)
    bk.create_backup(data, target, key, now=NOW)
    assert seen and target not in seen[0].parents and data in seen[0].parents
    assert [p.name for p in target.iterdir()] == ["mantel-20261018-031500.mbk"]      # no tmp, no work folder
    assert list(data.glob(".backup-work-*")) == []


# -- keys --------------------------------------------------------------------------------------------
def test_key_files(tmp_path):
    path = tmp_path / "secrets" / "backup.key"
    with pytest.raises(BackupError) as exc:
        bk.load_key(path)                                                 # a restore never invents a key
    assert exc.value.code == "key_missing" and not path.exists()
    k1, created = bk.load_key(path, create=True)
    assert created and len(k1) == 32 and path.stat().st_mode & 0o777 == 0o600
    assert (path.parent.stat().st_mode & 0o777) == 0o700
    k2, created = bk.load_key(path, create=True)
    assert k2 == k1 and not created
    (tmp_path / "short.key").write_text("c2hvcnQ=\n")
    with pytest.raises(BackupError) as exc:
        bk.load_key(tmp_path / "short.key")
    assert exc.value.code == "key_invalid" and "backup key" in str(exc.value)
    at_rest = tmp_path / "secrets" / "at_rest.key"
    at_rest.write_text(path.read_text())
    assert bk.KEY_FILE != "at_rest.key"                                   # a separate file, never the at-rest key


# -- rotation ----------------------------------------------------------------------------------------
def test_rotation_keeps_the_last_days_and_weeks_and_nothing_else_is_touched(tmp_path, key, target):
    start = datetime(2026, 8, 1, 3, 15, tzinfo=UTC)
    names = []
    for day in range(70):                                                  # two a day for 70 days
        for hour in (3, 15):
            when = start + timedelta(days=day, hours=hour - 3)
            p = target / bk.backup_name(when)
            p.write_bytes(b"x")
            names.append((when, p))
    (target / "notes.txt").write_text("not a backup")
    (target / "mantel-20260101-000000.mbk.tmp").write_text("someone else's partial")
    (target / "subdir").mkdir()
    newest = names[-1][1]
    removed = bk.rotate(target, keep_daily=7, keep_weekly=4)
    kept = bk.list_backups(target)
    kept_days = {b.created.date() for b in kept}
    last_day = names[-1][0].date()
    assert newest.exists() and kept[0].path == newest
    for i in range(7):                                                     # the newest of each of the last 7 days
        d = last_day - timedelta(days=i)
        same_day = [b for b in kept if b.created.date() == d]
        assert same_day and same_day[0].created.hour == 15
    assert len(kept) <= 7 + 4 and len(kept) >= 8
    assert len({b.created.isocalendar()[:2] for b in kept}) >= 4           # four weeks are covered
    assert len(removed) == 140 - len(kept)
    assert (target / "notes.txt").exists() and (target / "subdir").is_dir() \
        and (target / "mantel-20260101-000000.mbk.tmp").exists()
    assert kept_days <= {last_day - timedelta(days=i) for i in range(35)}
    assert bk.rotate(target, 7, 4) == []                                   # idempotent


def test_rotation_never_drops_the_new_backup_even_if_the_clock_went_back(tmp_path, key, target):
    data = make_home(tmp_path)
    for day in range(10):
        (target / bk.backup_name(NOW + timedelta(days=day))).write_bytes(b"x")
    out = bk.create_backup(data, target, key, now=NOW - timedelta(days=400), keep_daily=2, keep_weekly=1)
    assert out.exists()
    assert len(bk.list_backups(target)) <= 4


def test_a_create_rotates_after_success_only(tmp_path, key, target):
    data = make_home(tmp_path)
    for day in range(1, 6):
        (target / bk.backup_name(NOW - timedelta(days=day))).write_bytes(b"old")
    with pytest.raises(BackupError):
        bk.create_backup(tmp_path / "nowhere", target, key, now=NOW, keep_daily=1, keep_weekly=0)
    assert len(bk.list_backups(target)) == 5                               # a failed backup deleted nothing
    bk.create_backup(data, target, key, now=NOW, keep_daily=1, keep_weekly=0)
    assert [b.path.name for b in bk.list_backups(target)] == [bk.backup_name(NOW)]


# -- the CLI -----------------------------------------------------------------------------------------
def test_cli_backup_and_restore(tmp_path, capsys, target):
    data = make_home(tmp_path)
    secrets = tmp_path / "secrets"
    assert cli_main(["backup", "--data-dir", str(data), "--secrets-dir", str(secrets), "--target", str(target)]) == 0
    err = capsys.readouterr().err
    assert "created a new backup key" in err and "COPY IT" in err
    assert (secrets / "backup.key").exists()
    files = list(target.glob("*.mbk"))
    assert len(files) == 1
    assert cli_main(["backup", "--data-dir", str(data), "--secrets-dir", str(secrets), "--target", str(target)]) == 0
    assert "created a new" not in capsys.readouterr().err
    # the newest backup: when the two land in different seconds, rotation keeps only the second of the day
    files = sorted(target.glob("*.mbk"))[-1:]
    # a test restore first: nothing changes
    fresh = tmp_path / "fresh"
    assert cli_main(["restore", str(files[0]), "--data-dir", str(fresh), "--secrets-dir", str(secrets),
                     "--verify-only"]) == 0
    assert "verify-only: nothing was changed" in capsys.readouterr().out and not fresh.exists()
    assert cli_main(["restore", str(files[0]), "--data-dir", str(fresh), "--secrets-dir", str(secrets)]) == 0
    out = capsys.readouterr().out
    assert "database checks passed" in out and dump(fresh / "mantel.db") == dump(data / "mantel.db")
    # a second restore into the same dir is refused
    assert cli_main(["restore", str(files[0]), "--data-dir", str(fresh), "--secrets-dir", str(secrets)]) == 1
    assert "data_dir_not_fresh" in capsys.readouterr().err
    # the wrong key
    other = tmp_path / "other-secrets"
    bk.load_key(other / "backup.key", create=True)
    assert cli_main(["restore", str(files[0]), "--data-dir", str(tmp_path / "f2"), "--secrets-dir", str(other)]) == 1
    assert "wrong_key" in capsys.readouterr().err
    # no key at all: it is not made up
    assert cli_main(["restore", str(files[0]), "--data-dir", str(tmp_path / "f3"),
                     "--secrets-dir", str(tmp_path / "none")]) == 1
    assert "key_missing" in capsys.readouterr().err and not (tmp_path / "none").exists()


def test_cli_backup_target_must_exist_unless_create(tmp_path, capsys):
    data = make_home(tmp_path)
    args = ["backup", "--data-dir", str(data), "--secrets-dir", str(tmp_path / "s"), "--target", str(tmp_path / "nas2")]
    assert cli_main(args) == 1 and "is the NAS mounted" in capsys.readouterr().err
    assert cli_main([*args, "--create"]) == 0


# -- the nightly job ---------------------------------------------------------------------------------
def test_next_run():
    z = timezone(timedelta(hours=-5))
    now = datetime(2026, 10, 18, 2, 0, tzinfo=z)
    assert bk.next_run(now, "03:15") == datetime(2026, 10, 18, 3, 15, tzinfo=z)
    assert bk.next_run(datetime(2026, 10, 18, 3, 15, tzinfo=z), "03:15") == datetime(2026, 10, 19, 3, 15, tzinfo=z)
    assert bk.next_run(datetime(2026, 10, 18, 23, 59, tzinfo=z), "00:05") == datetime(2026, 10, 19, 0, 5, tzinfo=z)
    for bad in ("3pm", "25:00", "03:75", ""):
        with pytest.raises(ValueError):
            bk.parse_time(bad)


def _cfg(tmp_path, target, **kw):
    from mantel_server.config import Config
    return Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", backup_target=target, port=0,
                  house_tz="America/Chicago", **kw)


async def test_the_job_is_disabled_without_a_target_and_catches_up_then_runs_nightly(tmp_path, monkeypatch, target):
    off = bk.Backups(_cfg(tmp_path, None))
    assert not off.enabled and off.list() == []
    make_home(tmp_path)
    clock = [datetime(2026, 10, 18, 12, 0, tzinfo=timezone(timedelta(hours=-5))).timestamp()]   # noon in Chicago (CDT)
    jobs = bk.Backups(_cfg(tmp_path, target), clock=lambda: clock[0])
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(round(s))
        if len(sleeps) == 1:
            return                                                         # the catch-up wait
        if len(jobs.list()) < 2:
            clock[0] += s                                                  # night comes, a step at a time
            return
        raise asyncio.CancelledError

    monkeypatch.setattr(bk.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await jobs.run_forever()
    assert sleeps[0] == 60                                                 # nothing on the NAS yet: one soon
    night = sleeps[1:-1]                                                   # the wait, in RECHECK steps
    assert sum(night) == (15 * 60 + 3 * 3600 + 12 * 3600)                  # noon -> 03:15 next day
    assert max(night) <= bk.Backups.RECHECK
    assert len(jobs.list()) == 2 and jobs.status["last_error"] is None and jobs.status["last_ok"]
    assert jobs.list()[0].created.astimezone(UTC).strftime("%H:%M") == "08:15"      # 03:15 CDT is 08:15 UTC
    # a failing target is reported, not raised
    shutil.rmtree(target)
    result = await jobs.run_once()
    assert result["ok"] is False and jobs.status["last_error_code"] == "target_missing"


def test_the_nightly_time_is_in_home_assistants_zone_once_known(tmp_path):
    """03:15 is the house's 03:15: Home Assistant's zone (Authz.tz, from get_config) once read; --house-tz
    (cfg.house_tz, default UTC) until then. It was always cfg.house_tz, so a house that never set
    --house-tz was backed up at 03:15 UTC."""
    from types import SimpleNamespace

    from aiohttp import web as aioweb

    from mantel_server.config import Config
    noon_utc = datetime(2026, 7, 1, 12, 0, tzinfo=UTC).timestamp()
    app = aioweb.Application()
    app["cfg"] = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "s", backup_target=tmp_path, port=0)
    app["clock"] = lambda: noon_utc
    bk.register(app)
    jobs = app["backups"]
    assert jobs.now().utcoffset() == timedelta(0)                          # nothing from HA yet: the UTC default
    app["authz"] = SimpleNamespace(tz="America/Los_Angeles")               # what server.house_tz sets from HA
    assert jobs.now().utcoffset() == timedelta(hours=-7)                   # PDT
    run = bk.next_run(jobs.now(), app["cfg"].backup_time)
    assert run.astimezone(UTC).strftime("%H:%M") == "10:15"                # 03:15 in the house, not in UTC
    # an unknown zone falls back to UTC rather than stopping the job
    app["authz"] = SimpleNamespace(tz="Nowhere/Atlantis")
    assert jobs.now().utcoffset() == timedelta(0)


async def test_a_zone_learned_during_the_wait_moves_the_nightly_run(tmp_path, monkeypatch, target, key):
    """The wait is worked out again every RECHECK: HA's zone arriving after it began still counts."""
    data = make_home(tmp_path)
    clock = [datetime(2026, 7, 1, 12, 0, tzinfo=UTC).timestamp()]
    bk.create_backup(data, target, key, now=datetime.fromtimestamp(clock[0], UTC) - timedelta(hours=1))
    zone_now = ["UTC"]
    jobs = bk.Backups(_cfg(tmp_path, target), clock=lambda: clock[0], tz=lambda: zone_now[0])
    runs = []

    async def fake_run_once():
        runs.append(datetime.fromtimestamp(clock[0], UTC))
        raise asyncio.CancelledError

    async def fake_sleep(s):
        clock[0] += s
        zone_now[0] = "America/New_York"                                   # HA's get_config answered

    monkeypatch.setattr(jobs, "run_once", fake_run_once)
    monkeypatch.setattr(bk.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await jobs.run_forever()
    assert runs == [datetime(2026, 7, 2, 7, 15, tzinfo=UTC)]               # 03:15 EDT, not 03:15 UTC


async def test_catch_up_is_skipped_when_a_recent_backup_exists(tmp_path, monkeypatch, target, key):
    data = make_home(tmp_path)
    now = datetime(2026, 10, 18, 12, 0, tzinfo=UTC)
    bk.create_backup(data, target, key, now=now - timedelta(hours=10))
    jobs = bk.Backups(_cfg(tmp_path, target), clock=lambda: now.timestamp())
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(round(s))
        raise asyncio.CancelledError

    monkeypatch.setattr(bk.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await jobs.run_forever()
    assert len(sleeps) == 1 and sleeps[0] > 60 and jobs.status["last_ok"] is None


# -- REST through the real app -----------------------------------------------------------------------
@pytest.fixture
async def app_with_backups(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("backup tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    nas = tmp_path / "nas"
    nas.mkdir()
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, backup_target=nas)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    bk.register(app, app["hub"])
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield Mantel(app, client, store, now, origin), nas
    store.db.close()


async def test_status_and_run_now_are_for_managers_and_run_now_for_the_owner(app_with_backups):
    m, nas = app_with_backups
    app = m.app
    app["backups"]._lock = None
    await m.user("avery", "owner")
    await m.user("alex", "admin")
    await m.user("jordan", "adult")
    r = await m.client.get("/api/backup")
    assert r.status in (401, 403)                                          # nobody signed in
    await m.sign_in("jordan")
    assert (await m.client.get("/api/backup")).status == 403
    await m.sign_in("alex")
    body = await (await m.client.get("/api/backup")).json()
    assert body["enabled"] and body["target"] == str(nas) and body["backups"] == [] and not body["key_present"]
    assert (await m.post("/api/backup/run")).status == 403                 # an Admin may look, only the Owner runs
    await m.sign_in("avery")
    assert (await m.client.post("/api/backup/run", json={})).status == 403          # no CSRF header
    r = await m.post("/api/backup/run")
    assert r.status == 200, await r.text()
    body = await (await m.client.get("/api/backup")).json()
    assert len(body["backups"]) == 1 and body["status"]["last_ok"] and body["key_present"]
    assert body["backups"][0]["name"] == body["status"]["last_file"]
    key, _ = bk.load_key(Path(app["cfg"].secrets_dir) / "backup.key")
    rep = bk.restore(nas / body["status"]["last_file"], key, nas.parent / "restored")
    assert rep.schema == LATEST and rep.tables["users"] == 3
    audit = app["store"].db.execute("SELECT action FROM action_audit WHERE action LIKE 'backup.%'").fetchall()
    assert [a["action"] for a in audit] == ["backup.ok"]


async def test_register_is_off_without_a_target(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    cfg = Config(data_dir=tmp_path / "d", secrets_dir=tmp_path / "s", port=0)
    app = build_app(cfg, "x", store=Store(cfg.data_dir / "mantel.db"), connect_ha=False)
    bk.register(app, app["hub"])
    assert not app["backups"].enabled and "backup_task" not in app
    assert not any(h.__name__ == "start" and "backup" in h.__qualname__ for h in app.on_startup)
