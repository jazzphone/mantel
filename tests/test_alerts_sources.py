"""Phase 14's sources (docs/phase14/SYSTEM-ALERTS.md, the catalog): what the watch raises and clears, the events it is
told (backups, sign-ins, config rows, push results), and UniFi Protect's connection and certificate (14.8)."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace as NS

import pytest

from mantel_server.alerts import sources


@pytest.fixture(autouse=True)
def roomy_disk(monkeypatch):
    """This machine's own disk never decides a test: plenty free unless a test says otherwise."""
    monkeypatch.setattr(sources.shutil, "disk_usage", lambda p: NS(total=100 << 30, free=50 << 30))


class FakeCenter:
    def __init__(self, started=0.0):
        self.up: dict[tuple[str, str], dict] = {}
        self.events: list[tuple[str, str, dict]] = []
        self.started = started

    def raise_(self, kind, key="", facts=None):
        self.up[(kind, key)] = facts or {}
        self.events.append((kind, key, facts or {}))

    def clear(self, kind, key="", facts=None):
        self.up.pop((kind, key), None)

    def kinds(self):
        return {k for k, _ in self.up}


def connected(on: bool):
    ev = asyncio.Event()
    if on:
        ev.set()
    return ev


def app_with(tmp_path, **kw):
    app = {"cfg": NS(data_dir=tmp_path), "hub": NS(ha=NS(connected=connected(True))), "ha_task": object(),
           "connections": NS(ha_token=lambda: "t")}
    app.update(kw)
    return app


def test_home_assistant_and_music_assistant(tmp_path):
    c = FakeCenter()
    app = app_with(tmp_path, ma=NS(connected=connected(False)))
    w = sources.Watch(app, c, clock=lambda: 1000.0)
    w.look()
    assert c.kinds() == {"ma.lost"}
    app["hub"].ha.connected.clear()
    w.look()
    assert {"ha.lost", "ma.lost"} <= c.kinds()
    app["connections"] = NS(ha_token=lambda: "")       # not set up yet: nothing to say
    w.look()
    assert "ha.lost" not in c.kinds()
    assert (tmp_path / sources.RUNNING).exists()        # the marker's heartbeat


def test_mantel_link_only_once_paired_and_only_while_home_assistant_is_up(tmp_path):
    c = FakeCenter()
    link = NS(domain="mantel", ws=NS(closed=False))
    app = app_with(tmp_path, linked=NS(registry=NS(clients=[link])))
    w = sources.Watch(app, c)
    w.look()
    assert "link.lost" not in c.kinds()
    link.ws.closed = True
    w.look()
    assert "link.lost" in c.kinds()
    app["hub"].ha.connected.clear()                     # HA's own alert says it; the link's would repeat it
    w.look()
    assert "link.lost" not in c.kinds()
    fresh = sources.Watch(app_with(tmp_path, linked=NS(registry=NS(clients=[]))), FakeCenter())
    fresh.look()                                         # never paired: no Mantel Link to miss
    assert "link.lost" not in fresh.center.kinds()


def test_disk_low_names_the_folder_and_clears(tmp_path, monkeypatch):
    c = FakeCenter()
    w = sources.Watch(app_with(tmp_path), c)
    monkeypatch.setattr(sources.shutil, "disk_usage", lambda p: NS(total=100 << 30, free=2 << 30))
    w.look()
    assert ("disk.low", "the data folder") in c.up and c.up[("disk.low", "the data folder")]["percent"] == "2"
    monkeypatch.setattr(sources.shutil, "disk_usage", lambda p: NS(total=100 << 30, free=50 << 30))
    w.look()
    assert "disk.low" not in c.kinds()


def test_a_credential_expiring_within_fourteen_days(tmp_path):
    c = FakeCenter()
    now = 1_000_000.0
    conns = NS(ha_token=lambda: "t", expiring=lambda: [("ma", "Music Assistant", now + 10 * 86400),
                                                       ("ha", "Home Assistant", None)])
    sources.Watch(app_with(tmp_path, connections=conns), c, clock=lambda: now).look()
    assert c.kinds() == {"token.expiring"} and ("token.expiring", "ma") in c.up


def test_backups_stale_and_a_missing_folder(tmp_path):
    c = FakeCenter(started=0.0)
    gone = tmp_path / "nas"
    b = NS(enabled=True, folder=gone, status={"last_ok": None}, list=lambda: [])
    now = 3 * 86400.0
    w = sources.Watch(app_with(tmp_path, backups=b), c, clock=lambda: now)
    w.look()
    assert {"backup.target", "backup.stale"} <= c.kinds()
    assert str(tmp_path) not in c.up[("backup.target", "")]["problem"]       # the folder by name, not its path
    gone.mkdir()
    b.status["last_ok"] = now - 3600
    w.look()
    assert not {"backup.target", "backup.stale"} & c.kinds()


def test_a_backups_result_and_its_error_without_the_folders_path(tmp_path):
    c = FakeCenter()
    sources.backup_result(c, {"ok": False, "error": f"could not write the backup to {tmp_path}/nas: full"},
                          tmp_path / "nas")
    assert str(tmp_path) not in c.up[("backup.failed", "")]["error"]
    sources.backup_result(c, {"ok": True, "file": "mantel-1.mbk"}, tmp_path)
    assert ("backup.failed", "") not in c.up and c.events[-1][0] == "backup.ok"


def test_protect_lost_and_a_changed_certificate(tmp_path):
    c = FakeCenter()
    st = {"runs": True, "set": True, "unreadable": False, "events": {"connected": False}, "error_kind": None}
    w = sources.Watch(app_with(tmp_path, protect=NS(status=lambda: st)), c)
    w.look()
    assert "protect.lost" in c.kinds() and "protect.cert" not in c.kinds()
    st["error_kind"] = "certificate_changed"
    w.look()
    assert c.kinds() >= {"protect.cert"} and "protect.lost" not in c.kinds()    # one cause, one message
    st.update(error_kind=None, events={"connected": True})
    w.look()
    assert not {"protect.lost", "protect.cert"} & c.kinds()
    st["set"] = False                                     # not set up: nothing
    w.look()
    assert not c.kinds() & {"protect.lost", "protect.cert"}


def test_ten_failed_sign_ins_in_ten_minutes_said_once(tmp_path):
    c = FakeCenter()
    now = [0.0]
    s = sources.SignInWatch(c, clock=lambda: now[0])
    for _ in range(9):
        s.failed()
        now[0] += 30
    assert c.events == []
    s.failed()
    s.failed()
    assert [e[0] for e in c.events] == ["signin.failures"]


def test_config_rows_name_what_changed_never_the_detail():
    c = FakeCenter()
    sources.config_changed(c, {"action": "connection.ha.saved", "actor": "u1",
                               "detail": {"url": "http://192.168.1.2:8123"}}, lambda uid: "Avery")
    sources.config_changed(c, {"action": "alerts.channel.tested", "actor": "u1"})
    assert c.events == [("config.changed", "connection.ha.saved",
                         {"what": "the Home Assistant connection", "who": "Avery"})]


def test_push_failing_after_five_refusals_and_clears_on_the_next_one_that_goes():
    c = FakeCenter()
    p = sources.PushWatch(c)
    for _ in range(4):
        p.counts({"failed": 1})
    p.counts({"unreachable": 3})                         # an outage says nothing about the targets
    assert c.events == []
    p.counts({"failed": 1})
    assert "push.failing" in c.kinds()
    p.counts({"ok": 1})
    assert "push.failing" not in c.kinds()
