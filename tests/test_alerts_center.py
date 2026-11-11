"""Phase 14's alert center on its own clock (docs/phase14/SYSTEM-ALERTS.md "The alert center"): holds, flapping,
causes, the start grace, batching, quiet hours, delivery and retries, channel.failing, the log."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from mantel_server.alerts import catalog, center as C, sources
from mantel_server.alerts.center import Center, ChannelError
from mantel_server.alerts.store import Channels, Log, Settings
from mantel_server.storage.atrest import SecretBox
from mantel_server.storage.store import Store

MIN = 60.0


class Env:
    def __init__(self, tmp_path, *, start=1_000_000.0, fail=None):
        self.now = [start]
        self.store = Store(tmp_path / "m.db")
        db = self.store.db
        clock = lambda: self.now[0]       # noqa: E731
        self.channels = Channels(db, SecretBox(key=bytes(32)), clock)
        self.log = Log(db, clock)
        self.settings = Settings(db, clock)
        self.sent: list[tuple[str, C.Message]] = []
        self.fail = fail or {}
        self.app_sent: list[C.Message] = []
        self.center = Center(channels=self.channels, log_store=self.log, settings=self.settings, send=self.send,
                             clock=clock, house=lambda: "Maple House", link=lambda page: f"https://m.example/{page}",
                             app_sink=self.app)
        self.center.retries = (0.0, 0.0, 0.0)
        self.center.started -= 3600               # past the start grace unless a test says otherwise

    async def send(self, ch, msg):
        err = self.fail.get(ch["id"])
        if err is not None:
            raise err
        self.sent.append((ch["name"], msg))

    async def app(self, ch, msg):
        self.app_sent.append(msg)
        return 1

    def add(self, name="Discord", **kw):
        kw.setdefault("events", catalog.defaults())
        kw.setdefault("min_level", "info")
        kw.setdefault("quiet", {})
        return self.channels.add("discord", name, config={}, secret={"url": "x", "main": "x"}, **kw)

    async def run(self, seconds: float, step: float = 5.0):
        """Advance the clock, ticking as the server does, and let the sends finish."""
        end = self.now[0] + seconds
        while self.now[0] < end:
            self.now[0] = min(end, self.now[0] + step)
            await self.center.tick()
            await asyncio.sleep(0)
            await asyncio.gather(*self.center.tasks, return_exceptions=True)

    def titles(self, name="Discord"):
        return [m.title for n, m in self.sent if n == name]

    def said(self, name="Discord"):
        """Every alert a channel was told, batched or not."""
        return [it.title for n, m in self.sent if n == name for it in m.items]


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    yield e
    e.store.db.close()


# -- holds ----------------------------------------------------------------------------------------------------------
async def test_a_blip_inside_its_hold_says_nothing_and_a_long_one_says_lost_then_back(env):
    env.add()
    env.center.raise_("ha.lost")
    await env.run(4 * MIN)
    env.center.clear("ha.lost")
    await env.run(2 * MIN)
    assert env.sent == [] and env.log.recent() == []
    env.center.raise_("ha.lost")
    await env.run(5 * MIN + 30)
    assert env.titles() == ["Mantel · Home Assistant disconnected"]
    msg = env.sent[0][1]
    assert msg.level == "critical" and msg.link == "https://m.example/connections" and "Maple House" in msg.body
    assert msg.tag == "system:ha.lost:"
    env.center.clear("ha.lost")
    await env.run(30)
    assert env.titles()[-1] == "Mantel · Home Assistant is back"
    log = env.log.recent()
    assert [r["up"] for r in log] == [False, True] and all(r["sent_to"] for r in log)


async def test_holds_under_advanced_change_a_groups_hold(env):
    env.add()
    env.settings.set("holds", {"connections": 60})
    env.center.raise_("ma.lost")
    await env.run(90)
    assert env.titles() == ["Mantel · Music Assistant disconnected"]


async def test_an_event_without_a_hold_goes_at_once_and_has_no_clear(env):
    cid = env.add(events=catalog.defaults() + ["backup.ok"])
    sources.backup_result(env.center, {"ok": True, "file": "mantel-1.mbk"})
    await env.run(25)
    assert env.titles() == ["Mantel · Backup finished"]
    assert env.channels.get(cid)["last_ok"] is not None


async def test_a_clear_goes_only_where_its_raise_went(env):
    a = env.add("A")
    env.center.raise_("backup.failed", "", {"error": "disk full"})
    env.add("B")                                   # added after the raise went
    await env.run(25)
    env.center.clear("backup.failed", "", {"file": "x"})
    await env.run(25)
    assert env.titles("A") == ["Mantel · Backup failed", "Mantel · Backups work again"]
    assert env.titles("B") == [] and a


# -- flapping ---------------------------------------------------------------------------------------------------------
async def test_flapping_says_keeps_dropping_once_then_waits_for_fifteen_quiet_minutes(env):
    env.add()
    env.settings.set("holds", {"connections": 0})
    for _ in range(3):
        env.center.raise_("ma.lost")
        await env.run(30)
        env.center.clear("ma.lost")
        await env.run(30)
    assert env.titles().count("Mantel · Music Assistant disconnected") == 3
    env.center.raise_("ma.lost")
    await env.run(30)
    assert env.titles()[-1] == "Mantel · Music Assistant disconnected (keeps dropping)"
    assert "4 times in an hour" in env.sent[-1][1].body
    n = len(env.sent)
    for _ in range(3):                              # still dropping: nothing more
        env.center.clear("ma.lost")
        await env.run(60)
        env.center.raise_("ma.lost")
        await env.run(60)
    assert len(env.sent) == n
    env.center.clear("ma.lost")
    await env.run(14 * MIN)
    assert len(env.sent) == n
    await env.run(2 * MIN)
    assert env.titles()[-1] == "Mantel · Music Assistant is back"
    assert "15 minutes" in env.sent[-1][1].body


# -- causes and the start grace -----------------------------------------------------------------------------------------
async def test_tablets_dropping_with_home_assistant_say_nothing_one_cause_one_message(env):
    env.add()
    env.center.raise_("ha.lost")
    await env.run(MIN)
    env.center.raise_("tablet.offline", "kitchen", {"name": "Kitchen"})
    await env.run(10 * MIN)
    env.center.clear("ha.lost")
    await env.run(MIN)
    env.center.clear("tablet.offline", "kitchen")    # came back with HA
    await env.run(5 * MIN)
    assert env.titles() == ["Mantel · Home Assistant disconnected", "Mantel · Home Assistant is back"]


async def test_a_tablet_still_down_after_home_assistant_is_back_is_said_after_the_grace(env):
    env.add()
    env.center.raise_("ha.lost")
    env.center.raise_("tablet.offline", "kitchen", {"name": "Kitchen"})
    await env.run(6 * MIN)
    env.center.clear("ha.lost")
    await env.run(C.CAUSE_GRACE - 30)
    assert "Mantel · Kitchen tablet is offline" not in env.titles()
    await env.run(60)
    assert env.titles()[-1] == "Mantel · Kitchen tablet is offline"


async def test_connection_alerts_wait_out_the_start(env):
    env.add()
    env.center.started = env.now[0]
    env.settings.set("holds", {"connections": 0})
    env.center.raise_("ha.lost")
    await env.run(C.START_GRACE - 20)
    assert env.sent == []
    await env.run(40)
    assert env.titles() == ["Mantel · Home Assistant disconnected"]


# -- channels' choices ---------------------------------------------------------------------------------------------------
async def test_events_and_minimum_level_are_each_channels_own(env):
    env.add("Critical only", min_level="critical")
    env.add("No backups", events=[k for k in catalog.defaults() if not k.startswith("backup.")])
    env.center.raise_("backup.failed", "", {"error": "x"})
    env.center.raise_("mantel.crashed", "", {"when": "earlier", "version": "1"})
    await env.run(25)
    assert env.titles("Critical only") == ["Mantel · Backup failed"]
    assert env.titles("No backups") == ["Mantel · Mantel restarted after stopping unexpectedly"]


async def test_alerts_within_twenty_seconds_go_as_one_message(env):
    env.add()
    env.center.raise_("backup.failed", "", {"error": "x"})
    await env.run(5)
    env.center.raise_("mantel.crashed", "", {"when": "earlier", "version": "1"})
    env.center.raise_("backup.stale", "", {"when": "never"})
    await env.run(20)
    assert env.titles() == ["Mantel · 3 alerts"]
    msg = env.sent[0][1]
    assert msg.level == "critical" and msg.body.count("• ") == 3 and msg.tag == "system:batch"


async def test_the_mantel_apps_take_the_default_kinds_one_at_a_time(env):
    env.center.raise_("backup.failed", "", {"error": "x"})
    env.center.raise_("mantel.started", "", {"version": "1"})     # off by default
    await env.run(25)
    assert [m.subject for m in env.app_sent] == ["Backup failed"]
    assert env.log.recent()[0]["sent_to"] == ["app"] or "app" in env.log.recent()[-1]["sent_to"]


# -- quiet hours --------------------------------------------------------------------------------------------------------
def at_utc(h, m=0):
    return datetime(2026, 11, 3, h, m, tzinfo=timezone.utc).timestamp()


async def test_quiet_hours_hold_warnings_send_them_after_and_drop_what_cleared(tmp_path):
    env = Env(tmp_path, start=at_utc(23))
    env.add(quiet={"on": True, "from": "22:00", "to": "07:00", "critical": True})
    env.center.raise_("backup.stale", "", {"when": "never"})              # warning: waits
    env.center.raise_("mantel.crashed", "", {"when": "earlier", "version": "1"})
    env.center.raise_("backup.target", "", {"problem": "gone"})          # critical after its 10 min hold
    await env.run(11 * MIN)
    assert env.titles() == ["Mantel · The backup folder isn't usable"]   # critical goes through
    env.center.clear("backup.stale")                                       # cleared in the night: never said
    env.now[0] = at_utc(6, 59)
    await env.run(5)
    assert len(env.sent) == 1
    await env.run(2 * MIN)
    assert env.titles()[-1] == "Mantel · Mantel restarted after stopping unexpectedly"
    assert all("No backup" not in t for t in env.titles())
    env.store.db.close()


async def test_critical_through_quiet_hours_is_the_channels_switch(tmp_path):
    env = Env(tmp_path, start=at_utc(23))
    env.add(quiet={"on": True, "from": "22:00", "to": "07:00", "critical": False})
    env.center.raise_("backup.failed", "", {"error": "x"})
    await env.run(MIN)
    assert env.sent == []
    env.now[0] = at_utc(7, 1)
    await env.run(30)
    assert env.titles() == ["Mantel · Backup failed"]
    env.store.db.close()


def test_quiet_hours_wrap_midnight_and_from_equals_to_is_all_day():
    q = {"on": True, "from": "22:00", "to": "07:00"}
    t = lambda h, m=0: datetime(2026, 1, 1, h, m)     # noqa: E731
    assert C.in_quiet(q, t(23)) and C.in_quiet(q, t(3)) and not C.in_quiet(q, t(7)) and not C.in_quiet(q, t(12))
    assert C.in_quiet({"on": True, "from": "09:00", "to": "09:00"}, t(15))
    assert not C.in_quiet({"on": False, "from": "09:00", "to": "09:00"}, t(15))


# -- delivery -----------------------------------------------------------------------------------------------------------
async def test_a_failing_channel_retries_gives_up_and_after_three_tells_the_others(env):
    bad = env.add("Bad")
    env.add("Good")
    env.fail[bad] = ChannelError("Discord said 404: the webhook was deleted")
    for i in range(3):
        env.center.raise_("backup.failed", "", {"error": str(i)})
        await env.run(25)
        env.center.clear("backup.failed")
        await env.run(25)
    row = env.channels.get(bad)
    assert row["fails"] >= 3 and "404" in row["last_error"]
    assert "Alerts to Bad are failing" in env.said("Good")
    assert not any("are failing" in t for t in env.said("Bad"))
    del env.fail[bad]
    env.center.raise_("mantel.crashed", "", {"when": "x", "version": "1"})
    await env.run(25)
    assert env.channels.get(bad)["fails"] == 0
    await env.run(25)
    assert "Alerts to Bad work again" in env.said("Good")


async def test_a_slow_channel_never_holds_up_another(env):
    slow = env.add("Slow")
    env.add("Fast")
    gate = asyncio.Event()
    send = env.send

    async def slow_send(ch, msg):
        if ch["id"] == slow:
            await gate.wait()
        await send(ch, msg)
    env.center.send = slow_send
    env.center.raise_("backup.failed", "", {"error": "x"})
    for _ in range(6):
        env.now[0] += 5
        await env.center.tick()
        await asyncio.sleep(0)
    assert env.titles("Fast") == ["Mantel · Backup failed"] and env.titles("Slow") == []
    gate.set()
    await asyncio.gather(*env.center.tasks)
    assert env.titles("Slow") == ["Mantel · Backup failed"]


async def test_a_429_waits_its_retry_after(env, monkeypatch):
    cid = env.add()
    waits = []
    tries = [0]

    async def send(ch, msg):
        tries[0] += 1
        if tries[0] == 1:
            raise ChannelError("Discord said 429", retry_after=7.0)
        env.sent.append((ch["name"], msg))
    real_sleep = asyncio.sleep

    async def sleep(s):
        waits.append(s)
        await real_sleep(0)
    monkeypatch.setattr(C.asyncio, "sleep", sleep)
    env.center.send = send
    env.center.raise_("backup.failed", "", {"error": "x"})
    await env.run(25)
    assert 7.0 in waits and env.titles() == ["Mantel · Backup failed"] and env.channels.get(cid)["fails"] == 0


async def test_a_turned_off_channel_gets_nothing(env):
    cid = env.add()
    env.channels.update(cid, enabled=False)
    env.center.raise_("backup.failed", "", {"error": "x"})
    await env.run(30)
    assert env.sent == []


def test_every_kind_has_a_known_group_and_level_and_words_that_fill():
    for k in catalog.KINDS.values():
        assert k.group in catalog.GROUPS and k.level in catalog.LEVELS
        for n in k.needs:
            assert n in catalog.KINDS
        title, _ = k.words({"name": "Kitchen", "version": "1", "count": 3})
        assert "{" not in title
    assert {"backup.ok", "mantel.started"} <= {k.id for k in catalog.KINDS.values() if not k.default}


def test_the_running_marker_tells_a_crash_from_a_clean_stop(tmp_path):
    raised = []

    class Fake:
        def raise_(self, kind, key="", facts=None):
            raised.append(kind)
    sources.started(Fake(), tmp_path, "0.1.200", 100.0)
    assert raised == ["mantel.started"]
    sources.started(Fake(), tmp_path, "0.1.200", 200.0)          # no clean stop between
    assert raised[1:] == ["mantel.crashed", "mantel.started"]
    sources.stopped(tmp_path)
    sources.started(Fake(), tmp_path, "0.1.200", 300.0)
    assert raised[3:] == ["mantel.started"]
