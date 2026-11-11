"""A restore never turns Allow Control of the House on by itself (the third audit pass, 2026-11-02, the owner): a backup
holds Mantel Settings' General, and restoring one -- another Mantel's above all -- brought control back on with nobody
asked. It is put in place off; the Owner turns it on in General, with the fresh sign-in that asks for. The helpers are
test_backup.py's."""
import json
import sqlite3

from mantel_server.storage import backup as bk
from test_backup import NOW, key, make_home, target  # noqa: F401 -- fixtures


def _control(db, value=None):
    con = sqlite3.connect(db)
    try:
        if value is not None:
            with con:
                con.execute("INSERT INTO server_settings (key, value, source, set_by, updated) VALUES ('commands_enabled', ?, "
                            "'settings', 'u1', 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(value),))
        row = con.execute("SELECT value, source FROM server_settings WHERE key = 'commands_enabled'").fetchone()
        return (json.loads(row[0]), row[1]) if row else None
    finally:
        con.close()


def test_a_restore_puts_control_of_the_house_in_place_off_and_says_so(tmp_path, key, target):
    data = make_home(tmp_path)
    _control(data / "mantel.db", True)
    out = bk.create_backup(data, target, key, now=NOW)
    checked = bk.restore(out, key, tmp_path / "fresh", verify_only=True)
    assert checked.control_was_on, "the check says the backup had it on, before anything is restored"
    report = bk.restore(out, key, tmp_path / "fresh")
    assert report.control_was_on
    assert _control(tmp_path / "fresh" / "mantel.db") == (False, "restore"), "off, and the row says a restore did it"


def test_a_backup_with_control_off_is_restored_as_it_was(tmp_path, key, target):
    data = make_home(tmp_path)
    _control(data / "mantel.db", False)
    out = bk.create_backup(data, target, key, now=NOW)
    report = bk.restore(out, key, tmp_path / "fresh")
    assert not report.control_was_on and _control(tmp_path / "fresh" / "mantel.db") == (False, "settings")
