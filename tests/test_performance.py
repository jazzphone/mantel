"""PERFORMANCE (performance.py, page_health.py): what each screen's page says about itself, kept 24 hours in memory
(bounded, no database), the hub's fan-out times and HA event rate, and GET /api/performance for Owners and Admins
(Mantel Settings -> About -> Performance). Fictional house."""
from __future__ import annotations

import asyncio
import json
import sqlite3
from types import SimpleNamespace

import pytest

from mantel_server import db as dbmod
from mantel_server import page_health as PH
from mantel_server import performance as P
from mantel_server.connectors import Ctx

HOUR, DAY = 3600.0, 86400.0


async def _send(msg):
    raise AssertionError("page_health answers nothing")


def tablet(name="Master Bathroom", id="d1"):
    return Ctx(_send, identity=SimpleNamespace(device=SimpleNamespace(name=name, id=id), user=None))


def person(name="Avery", id="u1"):
    return Ctx(_send, identity=SimpleNamespace(device=None, user=SimpleNamespace(name=name, username=name.lower(), id=id)))


@pytest.fixture(autouse=True)
def fresh():
    PH.RING.reset()
    P.STATS.reset()
    yield
    PH.RING.reset()
    P.STATS.reset()


# -- the ring -----------------------------------------------------------------------------------------------
async def test_a_page_health_frame_lands_in_the_ring_with_the_new_numbers():
    await PH.page_health(tablet(), {"type": "page_health", "event": "load", "prev": "none", "heap": 40, "limit": 4096,
                                   "first_draw": 2300, "reconnects": 0, "registry_refreshes": 0, "page": "home"})
    [row] = PH.RING.summary()
    assert row["name"] == "Master Bathroom" and row["kind"] == "tablet" and row["page"] == "home"
    assert row["memory_mb"] == 40 and row["reconnects"] == 0 and row["slowest_start_ms"] == 2300
    assert row["registry_refreshes"] == 0 and row["up_since"] is not None


async def test_a_draw_frame_is_kept_once_a_connection_and_is_not_throttled_like_a_beat():
    c = tablet()
    await PH.page_health(c, {"event": "load", "heap": 5})
    await PH.page_health(c, {"event": "draw", "first_draw": 1500, "page": "home"})       # straight after the load
    await PH.page_health(c, {"event": "draw", "first_draw": 99999, "page": "home"})      # a second is ignored
    await PH.page_health(c, {"event": "beat", "heap": 9})                                 # too soon after the load
    [row] = PH.RING.summary()
    assert row["slowest_start_ms"] == 1500 and row["memory_mb"] == 5


def test_the_slowest_start_and_the_newest_counts_are_kept_per_screen():
    c = tablet()
    for t, draw in ((0, 1800), (HOUR, 9100), (2 * HOUR, 2000)):
        PH.RING.add(c, {"event": "load", "first_draw": draw, "reconnects": 1, "heap": 50}, now=t)
    PH.RING.add(c, {"event": "beat", "up": 3, "reconnects": 4, "registry_refreshes": 7, "heap": 61}, now=2 * HOUR + 60)
    [row] = PH.RING.summary(now=2 * HOUR + 120)
    assert row["slowest_start_ms"] == 9100 and row["reconnects"] == 4 and row["registry_refreshes"] == 7
    assert row["memory_mb"] == 61


def test_the_ring_drops_what_is_older_than_24_hours():
    c = tablet()
    PH.RING.add(c, {"event": "load", "first_draw": 9000, "heap": 10}, now=0)
    PH.RING.add(c, {"event": "beat", "heap": 20}, now=DAY - 1)
    assert PH.RING.summary(now=DAY - 1)[0]["slowest_start_ms"] == 9000
    got = PH.RING.summary(now=DAY + 5)            # the load is now older than a day
    assert got[0]["slowest_start_ms"] is None and got[0]["memory_mb"] == 20
    assert PH.RING.summary(now=2 * DAY + 5) == []  # a screen with nothing left is gone


def test_the_ring_is_bounded_in_samples_and_in_screens():
    c = tablet()
    for i in range(PH.PER_SCREEN * 3):
        PH.RING.add(c, {"event": "beat", "heap": i}, now=float(i))
    assert PH.RING.sample_count(c) == PH.PER_SCREEN
    for i in range(PH.SCREENS * 2):
        PH.RING.add(tablet(f"Tablet {i}", f"d{i}"), {"event": "beat", "heap": 1}, now=1000.0 + i)
    assert len(PH.RING.summary(now=2000.0 + PH.SCREENS * 2)) == PH.SCREENS


def test_a_tablet_and_a_person_are_kept_apart_and_junk_numbers_are_dropped():
    PH.RING.add(tablet(), {"event": "load", "first_draw": "x", "reconnects": -3, "heap": True, "page": "<b>"}, now=1.0)
    PH.RING.add(person(), {"event": "load", "page": "settings", "first_draw": 800}, now=2.0)
    rows = {r["kind"]: r for r in PH.RING.summary(now=3.0)}
    assert set(rows) == {"tablet", "person"} and rows["person"]["page"] == "settings"
    assert rows["tablet"]["slowest_start_ms"] is None and rows["tablet"]["reconnects"] is None
    assert rows["tablet"]["memory_mb"] is None and rows["tablet"]["page"] is None


# -- the server's own numbers --------------------------------------------------------------------------------
def test_fan_out_percentiles_cover_the_last_hour_only():
    s = P.Stats()
    s.fanout(500.0, now=0)                              # an hour and more ago: left out
    for i in range(1, 101):
        s.fanout(float(i), now=2 * HOUR + i)
    got = s.fan_out(now=2 * HOUR + 101)
    assert got["samples"] == 100 and got["p50_ms"] == 50.0 and got["p95_ms"] == 95.0
    assert s.fan_out(now=10 * HOUR) == {"samples": 0, "p50_ms": None, "p95_ms": None}


def test_the_fan_out_ring_is_bounded():
    s = P.Stats()
    for i in range(P.FANOUT_MAX * 2):
        s.fanout(1.0, now=float(i))
    assert s.fan_out(now=float(P.FANOUT_MAX * 2))["samples"] == P.FANOUT_MAX


def test_the_ha_event_rate_is_per_minute_over_the_last_five_minutes():
    s = P.Stats()
    s.events(600, now=100.0)
    s.events(300, now=1000.0)           # the first is more than five minutes old at 1200
    assert s.event_rate(now=1200.0) == pytest.approx(60.0)       # 300 changes over 5 minutes
    assert s.event_rate(now=5000.0) == 0.0


# -- the route ------------------------------------------------------------------------------------------------
async def test_a_manager_reads_the_performance_page(mantel):
    m = mantel
    await m.user("ada", "owner")
    await m.sign_in("ada")
    PH.RING.add(tablet(), {"event": "load", "first_draw": 2100, "reconnects": 2, "heap": 77, "page": "home"})
    P.STATS.fanout(4.0)
    P.STATS.fanout(8.0)
    r = await m.get("/api/performance")
    assert r.status == 200 and r.headers["Cache-Control"] == "no-store"
    got = await r.json()
    assert set(got) == {"now", "screens", "server"}
    [row] = got["screens"]
    assert set(row) >= {"name", "kind", "page", "up_since", "memory_mb", "reconnects", "registry_refreshes",
                        "slowest_start_ms", "last_seen", "first_draw_ms", "download_bytes", "download_files", "fps",
                        "device"}
    assert row["name"] == "Master Bathroom" and row["memory_mb"] == 77 and row["reconnects"] == 2
    srv = got["server"]
    assert set(srv) == {"fan_out", "ha_events_per_min", "connected_screens", "tick", "settings_history"}
    assert srv["fan_out"]["samples"] == 2 and srv["connected_screens"] == 0 and srv["ha_events_per_min"] == 0.0
    assert srv["tick"] == {"samples": 0, "last_ms": None, "max_ms": None}


async def test_the_page_reports_the_ticks_time_and_the_settings_histories_size(mantel):
    m = mantel
    await m.user("ada", "owner")
    await m.sign_in("ada")
    P.STATS.tick(12.0)
    P.STATS.tick(3.5)
    P.STATS.tick(40.25)
    P.STATS.tick(6.0)
    srv = (await (await m.get("/api/performance")).json())["server"]
    assert srv["tick"] == {"samples": 4, "last_ms": 6.0, "max_ms": 40.25}
    rows, size = m.store.db.execute("SELECT COUNT(*), SUM(LENGTH(CAST(body AS BLOB)) + LENGTH(CAST(diff AS BLOB))) "
                                    "FROM settings_history").fetchone()
    assert srv["settings_history"]["rows"] == rows and srv["settings_history"]["bytes"] == (size or 0)


async def test_an_admin_reads_it_too(mantel):
    await mantel.user("ben", "admin")
    await mantel.sign_in("ben")
    assert (await mantel.get("/api/performance")).status == 200


@pytest.mark.parametrize("role", ["adult", "child", "guest"])
async def test_a_member_is_refused(mantel, role):
    await mantel.user("cody", role)
    await mantel.sign_in("cody")
    assert (await mantel.get("/api/performance")).status == 403


async def test_signed_out_is_refused(mantel):
    mantel.forget_cookies()
    assert (await mantel.get("/api/performance")).status in (401, 403)


async def test_a_session_at_a_wall_tablet_is_refused_even_an_owners(mantel):
    m = mantel
    await m.user("avery", "owner")
    await m.sign_in("avery")
    assert (await m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})).status == 201
    r = await m.get("/api/performance")
    assert r.status == 403 and (await r.json())["error"] == "forbidden"


def test_the_route_declares_its_guard():
    spec = P.api_performance.__guard__
    assert spec.who == "manager" and spec.device_ok is False


# -- the baseline (2026-10-29): the device, the download, the frame rate ----------------------------------------
IPAD = {"event": "load", "page": "home", "heap": 40, "platform": "iPad", "memory_gb": 4, "cores": 6, "sw": 1180, "sh": 820,
        "dpr": 2}


def test_a_tablets_device_download_and_frame_rate_come_from_its_frames():
    c = tablet()
    PH.RING.add(c, IPAD, now=1.0)
    PH.RING.add(c, {"event": "draw", "page": "home", "first_draw": 2300, "dl_bytes": 3_400_000, "dl_files": 62}, now=2.0)
    PH.RING.add(c, {"event": "fps", "page": "home", "fps": 58.46}, now=30.0)
    [row] = PH.RING.summary(now=60.0)
    assert row["device"] == {"platform": "iPad", "memory_gb": 4.0, "cores": 6, "screen_w": 1180, "screen_h": 820, "dpr": 2.0}
    assert (row["download_bytes"], row["download_files"], row["first_draw_ms"], row["fps"]) == (3_400_000, 62, 2300, 58.5)


def test_junk_in_the_new_fields_is_dropped():
    PH.RING.add(tablet(), {"event": "load", "platform": "<script>", "cores": -1}, now=1.0)
    PH.RING.add(tablet(), {"event": "fps", "fps": 5000}, now=2.0)
    PH.RING.add(tablet(), {"event": "draw", "dl_bytes": "lots", "dl_files": True}, now=3.0)
    [row] = PH.RING.summary(now=4.0)
    assert (row["device"], row["fps"], row["download_bytes"], row["download_files"]) == (None, None, None, None)


async def test_an_fps_frame_is_kept_once_in_a_while_not_every_time():
    c = tablet()
    await PH.page_health(c, {"event": "fps", "fps": 59, "page": "home"})
    await PH.page_health(c, {"event": "fps", "fps": 20, "page": "home"})         # straight after: ignored
    assert PH.RING.summary()[0]["fps"] == 59.0


@pytest.fixture
def conn(tmp_path):
    d = dbmod.Database(tmp_path / "t.db")
    yield d.conn
    d.close()


def test_migration_0026_makes_the_tablet_health_table(conn):
    assert [r[1] for r in conn.execute("PRAGMA table_info(tablet_health)")] == ["device_id", "updated", "json"]
    assert conn.execute("SELECT name FROM schema_version WHERE version=26").fetchone()[0] == "tablet_health"


def test_a_tablets_summary_is_stored_and_survives_a_restart(conn):
    PH.TABLETS.bind(conn)
    PH.RING.add(tablet(), IPAD, now=1000.0)
    PH.RING.add(tablet(), {"event": "draw", "first_draw": 2300, "dl_bytes": 3_400_000, "dl_files": 62}, now=1001.0)
    PH.RING.add(tablet(), {"event": "fps", "fps": 58.0}, now=1002.0)
    [(device_id, updated, text)] = conn.execute("SELECT * FROM tablet_health").fetchall()
    assert device_id == "d1" and updated == 1000.0               # only the first write: the rest are within 10 minutes
    assert json.loads(text)["device"]["platform"] == "iPad" and "fps" not in json.loads(text)
    # a restart: the ring is empty, the table is read again, and the next frame (a beat) shows what was kept
    PH.RING.add(tablet(), {"event": "fps", "fps": 58.0}, now=1000.0 + PH.WRITE_EVERY + 1)
    PH.RING.reset()
    PH.TABLETS.bind(conn)
    PH.RING.add(tablet(), {"event": "beat", "heap": 33}, now=5000.0)
    [row] = PH.RING.summary(now=5001.0)
    assert row["fps"] == 58.0 and row["download_bytes"] == 3_400_000 and row["device"]["cores"] == 6
    assert row["first_draw_ms"] == 2300


def test_writes_are_rare_only_changes_and_at_most_every_ten_minutes(conn):
    PH.TABLETS.bind(conn)
    writes = []
    conn.set_trace_callback(lambda q: writes.append(q) if q.startswith("INSERT INTO tablet_health") else None)
    for i, fps in enumerate((60, 59, 58, 57)):                      # four samples in 3 minutes
        PH.RING.add(tablet(), {"event": "fps", "fps": fps}, now=100.0 + i * 60)
    assert len(writes) == 1
    PH.RING.add(tablet(), {"event": "fps", "fps": 57}, now=100.0 + PH.WRITE_EVERY + 5)      # due, but the value is the same
    assert len(writes) == 2                                          # 60 -> 57 changed the stored 60
    PH.RING.add(tablet(), {"event": "fps", "fps": 57}, now=100.0 + 3 * PH.WRITE_EVERY)       # due and unchanged
    assert len(writes) == 2
    conn.set_trace_callback(None)


def test_a_person_s_browser_is_not_stored(conn):
    PH.TABLETS.bind(conn)
    PH.RING.add(person(), {"event": "fps", "fps": 30, "page": "settings"}, now=1.0)
    assert conn.execute("SELECT COUNT(*) FROM tablet_health").fetchone()[0] == 0


# -- the minute tick, and the settings history's size ------------------------------------------------------------
def test_the_ticks_last_and_longest_cover_24_hours():
    s = P.Stats()
    s.tick(900.0, now=0)                                 # more than a day ago: left out
    s.tick(10.0, now=2 * DAY)
    s.tick(25.0, now=2 * DAY + 60)
    s.tick(5.0, now=2 * DAY + 120)
    assert s.tick_times(now=2 * DAY + 130) == {"samples": 3, "last_ms": 5.0, "max_ms": 25.0}
    assert s.tick_times(now=10 * DAY) == {"samples": 0, "last_ms": None, "max_ms": None}


def test_the_tick_ring_holds_a_day_of_minutes():
    s = P.Stats()
    for i in range(P.TICK_MAX * 2):
        s.tick(1.0, now=float(i))
    assert s.tick_times(now=float(P.TICK_MAX * 2))["samples"] == P.TICK_MAX


async def test_policy_tick_times_each_round(monkeypatch):
    from mantel_server import server

    async def fake(app, hub):
        fake.n += 1
        if fake.n == 2:
            raise RuntimeError("one failed round still counts")
    fake.n = 0
    monkeypatch.setattr(server, "tick_once", fake)
    task = asyncio.create_task(server.policy_tick({}, None, every=0.001))
    for _ in range(200):
        await asyncio.sleep(0.005)
        if P.STATS.tick_times()["samples"] >= 3:
            break
    task.cancel()
    assert P.STATS.tick_times()["samples"] >= 3 and P.STATS.tick_times()["last_ms"] >= 0


def test_the_settings_history_is_counted_at_most_every_ten_minutes():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE settings_history (id INTEGER PRIMARY KEY, body TEXT, diff TEXT)")
    c.execute("INSERT INTO settings_history (body, diff) VALUES ('{\"a\":1}', '{}')")
    s = P.Stats()
    assert s.history_size(c, now=0) == {"rows": 1, "bytes": 7 + 2, "at": 0}
    c.execute("INSERT INTO settings_history (body, diff) VALUES ('\u00e9', '{}')")      # 2 bytes in UTF-8
    assert s.history_size(c, now=P.HISTORY_EVERY - 1)["rows"] == 1               # not counted again yet
    assert s.history_size(c, now=P.HISTORY_EVERY + 1) == {"rows": 2, "bytes": 9 + 4, "at": P.HISTORY_EVERY + 1}
    assert P.Stats().history_size(None, now=0) == {"rows": None, "bytes": None, "at": None}
