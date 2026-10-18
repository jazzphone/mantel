"""The audit read API (GET /api/audit, Owner/Admin) and the retention window (migration 0007): rows
inside the window stay append-only; only the logged maintenance path deletes rows older than it."""
import json
import sqlite3
import time

import pytest

from gateway_fakes import gw, service  # noqa: F401 -- fixtures
from mantel_server import gateway
from mantel_server.config import parse_args
from mantel_server.server import tick_once

DAY = 86400.0


async def some_commands(gw):
    """Owner allowed, Child denied twice, Adult step-up: four rows with different actors/decisions."""
    await gw.login("cody", "child")
    ws = await gw.socket()
    await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    await gw.command(ws, id=2, **service("light", "turn_on", "light.kitchen"))
    await ws.close()
    await gw.login("jordan", "adult")
    gw.now[0] += 301
    ws = await gw.socket()
    await gw.command(ws, **service("lock", "unlock", "lock.front_door"))
    await ws.close()
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    await ws.close()


async def get(gw, query=""):
    r = await gw.m.get("/api/audit" + query)
    return r.status, await r.json()


# -- reading --------------------------------------------------------------------------------------------
async def test_owner_reads_the_audit_newest_first_with_filters_and_pages(gw):
    await some_commands(gw)
    st, body = await get(gw)
    assert st == 200 and body["ok"] and body["next"] is None and body["retention_days"] == 365.0
    rows = body["rows"]
    assert [r["id"] for r in rows] == sorted((r["id"] for r in rows), reverse=True) and len(rows) == 4
    assert rows[0]["role"] == "owner" and rows[0]["target"] == ["light.kitchen"]       # target decoded
    cody = gw.app["store"].db.execute("SELECT id FROM users WHERE username = 'cody'").fetchone()[0]
    st, body = await get(gw, f"?actor={cody}")
    assert [r["action"] for r in body["rows"]] == ["light.turn_on", "lock.unlock"]
    st, body = await get(gw, "?decision=step_up")
    assert [(r["role"], r["reason"]) for r in body["rows"]] == [("adult", "step_up_required")]
    st, body = await get(gw, "?decision=denied&kind=service")
    assert {r["role"] for r in body["rows"]} == {"child"}
    t = gw.audit()[2]["timestamp"]
    st, body = await get(gw, f"?since={t}")
    assert len(body["rows"]) == 2 and all(r["timestamp"] >= t for r in body["rows"])
    st, body = await get(gw, f"?until={t}")
    assert len(body["rows"]) == 2 and all(r["timestamp"] < t for r in body["rows"])
    # pages of two
    st, page1 = await get(gw, "?limit=2")
    assert len(page1["rows"]) == 2 and page1["next"] == page1["rows"][-1]["id"]
    st, page2 = await get(gw, f"?limit=2&before={page1['next']}")
    assert len(page2["rows"]) == 2 and page2["next"] is None
    assert {r["id"] for r in page1["rows"] + page2["rows"]} == {r["id"] for r in gw.audit()}


async def test_device_filter_names_a_tablet(gw):
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    device_id = (await r.json())["device"]["id"]
    ws = await gw.socket()
    await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    await ws.close()
    await gw.login("avery", "owner")
    st, body = await get(gw, f"?device={device_id}")
    assert st == 200 and [r["device"] for r in body["rows"]] == [device_id]


@pytest.mark.parametrize("who,role,status", [("alex", "admin", 200), ("jordan", "adult", 403),
                                             ("cody", "child", 403), ("gus", "guest", 403)])
async def test_only_owner_and_admin_may_read(gw, who, role, status):
    await gw.login(who, role)
    st, _ = await get(gw)
    assert st == status


async def test_a_tablet_and_nobody_may_not_read(gw):
    await gw.login("avery", "owner")
    await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    st, body = await get(gw)
    assert st == 403 and body == {"error": "forbidden"}
    gw.m.forget_cookies()
    r = await gw.m.get("/api/audit")
    assert r.status == 401


@pytest.mark.parametrize("query,param", [("?decision=maybe", "decision"), ("?kind=x", "kind"), ("?since=soon", "since"),
                                         ("?until=nan", "until"), ("?limit=0", "limit"), ("?limit=501", "limit"),
                                         ("?limit=x", "limit"), ("?before=x", "before"), ("?actor=", "actor"),
                                         ("?device=" + "x" * 65, "device")])
async def test_bad_queries_are_refused(gw, query, param):
    await gw.login("avery", "owner")
    st, body = await get(gw, query)
    assert st == 400 and body == {"error": "invalid_query", "param": param}


# -- retention -------------------------------------------------------------------------------------------
async def test_retention_deletes_only_rows_older_than_the_window_and_logs_it(gw):
    await some_commands(gw)                       # four rows at ~t0
    old_ids = [r["id"] for r in gw.audit()]
    gw.now[0] += 400 * DAY
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    await ws.close()
    gw.now[0] += 10 * DAY
    audit = gw.app["audit"]
    assert audit.purge(365) == 4
    rows = gw.audit()
    assert not {r["id"] for r in rows} & set(old_ids)
    kept = [r for r in rows if r["action"] == "light.turn_on"]
    assert len(kept) == 1 and kept[0]["timestamp"] > gw.now[0] - 365 * DAY
    (log_row,) = gw.app["store"].db.execute("SELECT * FROM audit_maintenance").fetchall()
    assert (log_row["action"], log_row["deleted"], log_row["retention_days"]) == ("purge", 4, 365.0)
    assert (log_row["first_id"], log_row["last_id"]) == (min(old_ids), max(old_ids))
    (system,) = [r for r in rows if r["action"] == "audit.purge"]
    assert (system["actor"], system["kind"], system["decision"], system["result"]) == ("mantel", "system", "allowed", "ok")
    assert system["reason"].startswith("retention:365d deleted:4")
    # nothing more to delete: no new log rows
    assert audit.purge(365) == 0
    assert gw.app["store"].db.execute("SELECT COUNT(*) FROM audit_maintenance").fetchone()[0] == 1
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        with gw.app["store"].db:
            gw.app["store"].db.execute("DELETE FROM audit_maintenance")


async def test_rows_inside_the_window_stay_append_only(gw):
    await some_commands(gw)
    db = gw.app["store"].db
    rid = gw.audit()[0]["id"]
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):          # no permit
        with db:
            db.execute("DELETE FROM action_audit WHERE id = ?", (rid,))
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):          # a permit, but the row is younger
        with db:
            db.execute("INSERT INTO audit_purge (id, cutoff, started) VALUES (1, ?, ?)", (gw.now[0] - DAY, gw.now[0]))
            db.execute("DELETE FROM action_audit WHERE id = ?", (rid,))
    assert db.execute("SELECT COUNT(*) FROM audit_purge").fetchone()[0] == 0   # rolled back with it
    # the result is still written once only
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        with db:
            db.execute("UPDATE action_audit SET result = 'ok' WHERE id = ?", (rid,))
    assert len(gw.audit()) == 4


async def test_nothing_younger_than_30_days_by_the_databases_clock_can_go(gw):
    db, audit = gw.app["store"].db, gw.app["audit"]
    real = time.time()
    gw.now[0] = real - 5 * DAY                    # a row written five real days ago ...
    audit.record(principal=None, kind="system", action="x", targets=[], decision="allowed", reason="test")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):          # ... even with a permit past it
        with db:
            db.execute("INSERT INTO audit_purge (id, cutoff, started) VALUES (1, ?, ?)", (real + DAY, real))
            db.execute("DELETE FROM action_audit")
    gw.now[0] = real + 400 * DAY                  # a clock gone wrong: the purge itself is refused, whole
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        audit.purge(365)
    assert len(gw.audit()) == 1 and db.execute("SELECT COUNT(*) FROM audit_maintenance").fetchone()[0] == 0


def test_the_window_is_at_least_30_days():
    with pytest.raises(ValueError):
        gateway.Audit(sqlite3.connect(":memory:")).purge(29)
    with pytest.raises(SystemExit):
        parse_args(["--audit-retention-days", "10"])
    assert parse_args([]).audit_retention_days == 365.0
    assert parse_args(["--audit-retention-days", "90"]).audit_retention_days == 90.0


async def test_the_policy_tick_applies_the_window_at_most_hourly(gw, monkeypatch):
    calls = []
    monkeypatch.setattr(gw.app["audit"], "purge", lambda days: calls.append(days) or 0)
    hub = gw.app["hub"]
    await tick_once(gw.app, hub)
    await tick_once(gw.app, hub)
    assert calls == [365.0]
    gw.now[0] += 3601
    await tick_once(gw.app, hub)
    assert calls == [365.0, 365.0]


async def test_a_failing_purge_never_stops_the_tick(gw, monkeypatch):
    def boom(days):
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(gw.app["audit"], "purge", boom)
    await tick_once(gw.app, gw.app["hub"])        # logged, not raised


async def test_the_audit_never_holds_a_pin_or_service_data(gw):
    await gw.login("jordan", "adult")
    await gw.m.client.put("/api/account/pin", json={"pin": "2580"}, headers=gw.m.headers())
    gw.now[0] += 301
    ws = await gw.socket()
    await gw.command(ws, **service("lock", "unlock", "lock.front_door", data={"code": "1357"},
                                   step_up={"method": "pin", "pin": "2580"}))
    await ws.close()
    await gw.login("avery", "owner")
    st, body = await get(gw)
    text = json.dumps(body)
    assert st == 200 and "2580" not in text and "1357" not in text
