"""A restore checks that this Mantel's at-rest key opens what the backup holds sealed with its own (authenticator-app
seeds, the alarm's own code, saved connections): a wrong key is refused before anything is replaced, not found later
as a 500 at every second-factor sign-in. The helpers are test_backup.py's."""
import base64
import os
import sqlite3
from pathlib import Path

import pytest

from mantel_server import backup as bk
from mantel_server.__main__ import main as cli_main
from mantel_server.backup import BackupError
from test_backup import LATEST, NOW, _keys_json, _upload, app_local, key, make_home, target  # noqa: F401 -- fixtures


# -- the at-rest key must open what the backup holds sealed (DEP-11, audit third pass) ---------------------
def test_a_restore_refuses_an_at_rest_key_that_does_not_open_the_sealed_values(tmp_path, key, target):
    """A restore beside another at_rest.key "passed" every database check, and then every authenticator-app user
    got a 500 at the second factor. The key is tried on one sealed value of each kind before anything changes."""
    right = os.urandom(32)
    data = make_home(tmp_path, at_rest=right)
    out = bk.create_backup(data, target, key, now=NOW)
    fresh = tmp_path / "fresh"
    for wrong in (os.urandom(32), "no-such-key-file"):
        at_rest = wrong if isinstance(wrong, bytes) else tmp_path / wrong
        for verify_only in (True, False):
            with pytest.raises(BackupError) as e:
                bk.restore(out, key, fresh, verify_only=verify_only, at_rest_key=at_rest)
            assert e.value.code == "wrong_at_rest_key" and "at_rest.key" in str(e.value)
        assert not fresh.exists() or not list(fresh.iterdir())          # nothing was put in place
    # a key file, as the server reads it, and the key itself both pass
    keyfile = tmp_path / "at_rest.key"
    keyfile.write_text(base64.urlsafe_b64encode(right).decode() + "\n")
    assert bk.restore(out, key, fresh, verify_only=True, at_rest_key=keyfile).verified_only
    assert bk.restore(out, key, fresh, at_rest_key=right).schema == LATEST
    # not asked: as before
    assert bk.restore(out, key, tmp_path / "unchecked", at_rest_key=None).schema == LATEST


def test_only_a_saved_connection_is_enough_to_refuse_the_wrong_key(tmp_path, key, target):
    data = make_home(tmp_path, at_rest=os.urandom(32))
    conn = sqlite3.connect(str(data / "mantel.db"))
    conn.execute("DELETE FROM totp_credentials")
    conn.execute("DELETE FROM alarm_pins")
    conn.commit()
    conn.close()
    out = bk.create_backup(data, target, key, now=NOW)
    with pytest.raises(BackupError) as e:
        bk.restore(out, key, tmp_path / "fresh", verify_only=True, at_rest_key=os.urandom(32))
    assert e.value.code == "wrong_at_rest_key" and "saved connections" in str(e.value)


def test_cli_restore_refuses_the_wrong_at_rest_key_unless_told_to_skip_the_check(tmp_path, capsys, target):
    secrets = tmp_path / "secrets"
    home_key = bk.atrest.load_or_create_key(secrets / "at_rest.key")
    data = make_home(tmp_path, at_rest=os.urandom(32))                # sealed by some other Mantel
    assert cli_main(["backup", "--data-dir", str(data), "--secrets-dir", str(secrets), "--target", str(target)]) == 0
    capsys.readouterr()
    backup = sorted(target.glob("*.mbk"))[-1]
    fresh = tmp_path / "fresh"
    assert cli_main(["restore", str(backup), "--data-dir", str(fresh), "--secrets-dir", str(secrets), "--verify-only"]) == 1
    err = capsys.readouterr().err
    assert "wrong_at_rest_key" in err and "another at_rest.key" in err and not fresh.exists()
    assert cli_main(["restore", str(backup), "--data-dir", str(fresh), "--secrets-dir", str(secrets), "--verify-only",
                     "--skip-at-rest-check"]) == 0
    assert home_key                                                      # (its own key never opened these values)


async def test_the_upload_refuses_a_backup_its_at_rest_key_cannot_open(app_local, tmp_path):
    m, cfg, _ = app_local
    await m.user("avery", "owner")
    await m.sign_in("avery")
    own_backup_key = bk.load_key(Path(cfg.secrets_dir) / "backup.key", create=True)[0]
    # made with this Mantel's backup key but another Mantel's at-rest key (only backup.key was carried over)
    home = make_home(tmp_path, "elsewhere", at_rest=os.urandom(32))
    (tmp_path / "nas").mkdir()
    path = bk.create_backup(home, tmp_path / "nas", own_backup_key)
    r = await _upload(m, path.read_bytes())                             # this Mantel has no at-rest key file at all
    body = await r.json()
    assert r.status == 400 and body["error"] == "wrong_at_rest_key" and "at_rest.key" in body["message"], body
    bk.atrest.load_or_create_key(Path(cfg.secrets_dir) / "at_rest.key")   # ... and now one that is not theirs
    r = await _upload(m, path.read_bytes())
    assert r.status == 400 and (await r.json())["error"] == "wrong_at_rest_key"
    assert (await (await m.client.get("/api/backup")).json())["pending"] is None
    # with the keys file of the Mantel that made it, it is accepted
    oat = os.urandom(32)
    home2 = make_home(tmp_path, "elsewhere2", at_rest=oat)
    path2 = bk.create_backup(home2, tmp_path / "nas", own_backup_key, now=NOW)
    keys = _keys_json(own_backup_key, oat).encode()
    assert (await _upload(m, path2.read_bytes(), keys)).status == 200
    # a keys file with the wrong at-rest key is refused the same way
    assert (await _upload(m, path2.read_bytes(), _keys_json(own_backup_key, os.urandom(32)).encode())).status == 400


async def test_a_key_that_cannot_be_written_after_the_data_is_in_place_is_not_reported_as_unchanged(
        app_local, tmp_path, monkeypatch, caplog):
    """apply_pending logged "Mantel starts with its data as it was" when the at-rest key write failed after the
    data had been replaced. Now: the key is staged before anything changes; if the last step fails anyway, the
    answer says the data IS in place and what to do about the key."""
    m, cfg, _ = app_local
    await m.user("avery", "owner")
    await m.sign_in("avery")
    okey = bk.atrest.load_or_create_key(tmp_path / "other" / "backup.key")
    oat = bk.atrest.load_or_create_key(tmp_path / "other" / "at_rest.key")
    home = make_home(tmp_path, "elsewhere", at_rest=oat)
    (tmp_path / "nas").mkdir()
    path = bk.create_backup(home, tmp_path / "nas", okey)
    assert (await _upload(m, path.read_bytes(), _keys_json(okey, oat).encode())).status == 200
    assert (await m.post("/api/backup/restore")).status == 200
    real = os.replace
    ar = Path(cfg.secrets_dir) / "at_rest.key"

    def failing(src, dst, *a, **k):
        if Path(dst) == ar:
            raise OSError(30, "Read-only file system")
        return real(src, dst, *a, **k)

    monkeypatch.setattr(bk.os, "replace", failing)
    with caplog.at_level("ERROR", logger="mantel.backup"):
        done = bk.apply_pending(cfg)
    assert not done["ok"] and "data is in place" in done["error"] and "at-rest key could not be written" in done["error"]
    assert done["replaced"], "where the replaced data went is still told"
    assert "as it was" not in caplog.text and "at-rest key could not be written" in caplog.text
    assert not list(Path(cfg.secrets_dir).glob("at_rest.key.restoring"))
