"""Restoring another Mantel's backup (the Home Assistant App's, moving to Docker or the LXC): its sealed values are
sealed again with this Mantel's own read-only keys, and First start's Restore From a Backup does it with the setup code,
before any Owner exists."""
import base64
import json
import os
from pathlib import Path

import pytest

from mantel_server import backup as bk
from mantel_server import db as dbmod
from mantel_server.backup import BackupError
from test_backup import _keys_json, _upload, app_local  # noqa: F401


def _other_mantel(tmp_path) -> tuple[Path, bytes, bytes]:
    """Another Mantel (the Home Assistant App, say) with one value of every sealed kind, and its backup."""
    import sqlite3 as sq
    other = tmp_path / "other"
    dbmod.Database(other / "data" / "mantel.db")
    okey = bk.atrest.load_or_create_key(other / "backup.key")
    oat = bk.atrest.load_or_create_key(other / "at_rest.key")
    box = bk.atrest.SecretBox(key=oat)
    db = sq.connect(other / "data" / "mantel.db")
    db.execute("INSERT INTO users (id, username, name, role, kind, created, updated) "
               "VALUES ('u1', 'casey', 'Casey', 'owner', 'hk', 1, 1)")
    db.execute("INSERT INTO totp_credentials (user_id, seed_enc, created) VALUES ('u1', ?, 1)",
               (box.seal(b"fictional-seed", "totp:u1"),))
    db.execute("INSERT INTO alarm_pins (entity, forward_to, ha_code, created, updated) "
               "VALUES ('alarm_control_panel.home', 'x', ?, 1, 1)",
               (box.seal(b"1234", "alarm_ha_code:alarm_control_panel.home"),))
    db.execute("INSERT INTO alert_channels (id, kind, name, sealed, created) VALUES ('c1', 'discord', 'Discord', ?, 1)",
               (box.seal(b'{"main": "fictional-webhook"}', "alert-channel:c1"),))
    db.execute("INSERT INTO alert_settings (key, value, updated) VALUES ('heartbeat', ?, 1)",
               (json.dumps({"sealed": base64.b64encode(box.seal(b"https://hb.example/ping", "alert-heartbeat")).decode(),
                            "every": 300}),))
    db.commit()
    db.close()
    conns = other / "data" / bk.CONNECTIONS_DIR
    conns.mkdir(mode=0o700)
    (conns / "ha.connection").write_bytes(box.seal(b'{"format": 1}', "connection:ha"))
    (other / "nas").mkdir()
    return bk.create_backup(other / "data", other / "nas", okey), okey, oat


def _opens_with(data_dir: Path, key: bytes) -> dict:
    """Every sealed value of a restored Mantel, opened with ``key``."""
    import sqlite3 as sq
    box = bk.atrest.SecretBox(key=key)
    db = sq.connect(data_dir / "mantel.db")
    try:
        hb = json.loads(db.execute("SELECT value FROM alert_settings WHERE key = 'heartbeat'").fetchone()[0])
        return {
            "totp": box.open(db.execute("SELECT seed_enc FROM totp_credentials").fetchone()[0], "totp:u1"),
            "alarm": box.open(db.execute("SELECT ha_code FROM alarm_pins").fetchone()[0],
                              "alarm_ha_code:alarm_control_panel.home"),
            "alert": box.open(db.execute("SELECT sealed FROM alert_channels").fetchone()[0], "alert-channel:c1"),
            "heartbeat": box.open(base64.b64decode(hb["sealed"]), "alert-heartbeat"),
            "connection": box.open((data_dir / bk.CONNECTIONS_DIR / "ha.connection").read_bytes(), "connection:ha"),
        }
    finally:
        db.close()


SEALED_VALUES = {"totp": b"fictional-seed", "alarm": b"1234", "alert": b'{"main": "fictional-webhook"}',
                 "heartbeat": b"https://hb.example/ping", "connection": b'{"format": 1}'}


async def test_another_mantels_backup_is_sealed_again_where_the_keys_are_read_only(app_local, tmp_path):
    """Docker and the LXC mount the keys read-only, so Restore From Another Mantel was refused there (restore.sh on
    the host instead). Now the backup's sealed values are opened with the keys file's at-rest key and sealed again
    with this Mantel's own, which stays: authenticator apps, alarm codes, alerts and connections all open."""
    m, cfg, _ = app_local
    await m.user("avery", "owner")
    await m.sign_in("avery")
    path, okey, oat = _other_mantel(tmp_path)
    keys = _keys_json(okey, oat).encode()
    secrets = Path(cfg.secrets_dir)
    own = bk.atrest.load_or_create_key(secrets / "at_rest.key")
    own_backup = bk.load_key(secrets / "backup.key", create=True)[0]
    os.chmod(secrets, 0o500)
    try:
        r = await _upload(m, path.read_bytes(), keys)
        check = await r.json()
        assert r.status == 200 and check["other_keys"] and check["reseal"], check
        assert (await m.post("/api/backup/restore")).status == 200
        done = bk.apply_pending(cfg)
        assert done["ok"] and done["resealed"] == 5, done
    finally:
        os.chmod(secrets, 0o700)
    assert _opens_with(cfg.data_dir, own) == SEALED_VALUES
    assert bk.atrest.load_or_create_key(secrets / "at_rest.key") == own, "this Mantel's own keys stay"
    assert bk.load_key(secrets / "backup.key")[0] == own_backup
    assert not list(secrets.glob("*.before-restore-*"))


def test_a_keys_file_whose_at_rest_key_does_not_open_the_backup_reseals_nothing(tmp_path):
    path, okey, _ = _other_mantel(tmp_path)
    with pytest.raises(BackupError) as bad:
        bk.restore(path, okey, tmp_path / "fresh", at_rest_key=os.urandom(32),
                   reseal_to=bk.atrest.SecretBox(key=os.urandom(32)))
    assert bad.value.code == "wrong_at_rest_key"
    assert not (tmp_path / "fresh" / "mantel.db").exists()


def test_every_place_that_seals_a_value_is_one_reseal_knows():
    """reseal() goes through SEALED_COLUMNS, SEALED_SETTINGS and the connections folder. A value sealed anywhere
    else would come through a restore with another Mantel's keys unopenable: add it there, then here."""
    root = Path(bk.__file__).parent
    sealing = sorted(str(f.relative_to(root)) for f in root.rglob("*.py")
                     if ".seal(" in f.read_text() and f.name not in ("atrest.py", "backup.py"))
    assert sealing == sorted(bk.SEALING_MODULES), sealing


# -- First start: Restore From a Backup ----------------------------------------------------------------------
def _first_start_restore(m, token, data=None, keys=None, token_first=True):
    from aiohttp import FormData
    fd = FormData()
    if token_first and token is not None:
        fd.add_field("token", token)
    if data is not None:
        fd.add_field("file", data, filename="backup.mbk", content_type="application/octet-stream")
    if keys is not None:
        fd.add_field("keys", keys, filename="mantel-keys.json", content_type="application/json")
    if not token_first and token is not None:
        fd.add_field("token", token)
    return m.client.post("/api/bootstrap/restore", data=fd)


async def test_first_start_restores_a_backup_with_the_setup_code(app_local, tmp_path):
    """The owner's first LXC install (2026-11-02): restoring the Home Assistant App's backup meant creating an
    Owner first, or a script on the host. First start offers Restore From a Backup: the setup code, the backup and
    its keys file, and Mantel restarts with the backup's people."""
    m, cfg, restarts = app_local
    acc = m.app["accounts"]
    path, okey, oat = _other_mantel(tmp_path)
    keys = _keys_json(okey, oat).encode()
    code = acc.issue_bootstrap_token()
    # the setup code comes first, and a wrong one is refused before the upload is read
    r = await _first_start_restore(m, code, path.read_bytes(), keys, token_first=False)
    assert r.status == 401 and (await r.json())["error"] == "bootstrap_token_invalid"
    r = await _first_start_restore(m, "fictional-wrong-code", path.read_bytes(), keys)
    assert r.status == 401 and not (cfg.data_dir / bk.PENDING_DIR).exists()
    # without the keys file, another Mantel's backup doesn't open: the code stays usable
    r = await _first_start_restore(m, code, path.read_bytes())
    assert r.status == 400 and (await r.json())["error"] in ("wrong_key", "key_missing")
    assert acc.bootstrap_token_valid(code)
    r = await _first_start_restore(m, code, path.read_bytes(), keys)
    body = await r.json()
    assert r.status == 200 and body["restarting"] and body["other_keys"], body
    assert restarts and not acc.bootstrap_token_valid(code), "the code is spent"
    done = bk.apply_pending(cfg)
    assert done["ok"], done
    import sqlite3 as sq
    assert [r[0] for r in sq.connect(cfg.data_dir / "mantel.db").execute("SELECT username FROM users")] == ["casey"]
    assert _opens_with(cfg.data_dir, oat) == SEALED_VALUES       # a writable secrets folder takes the backup's keys


async def test_first_start_restore_is_closed_once_there_is_an_owner(app_local, tmp_path):
    m, cfg, restarts = app_local
    code = m.app["accounts"].issue_bootstrap_token()
    await m.user("avery", "owner")
    path, okey, oat = _other_mantel(tmp_path)
    r = await _first_start_restore(m, code, path.read_bytes(), _keys_json(okey, oat).encode())
    assert r.status == 410 and not restarts and not (cfg.data_dir / bk.PENDING_DIR).exists()
