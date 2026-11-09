"""Timers people set (docs/phase21/TIMER-SLIDE.md): the rules (hk_core.timers), and Mantel making them through the gateway with
a fake command connection. Home Assistant's own behavior (create, rename, restart, delete) was measured on a scratch one; the
fake here answers as it did."""
import asyncio
from datetime import datetime, timezone

import pytest

import gateway_fakes as GF
from hk_core import timers as R
from mantel_server.ha_client import HaCommandError

gw, service = GF.gw, GF.service          # (the fixture, by name)


def iso(t):
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()


# ---- the rules
def test_which_timers_count():
    assert R.counts("timer.quick_1") and R.counts("timer.hk_timer_7")
    assert not R.counts("timer.kitchen_no_motion") and not R.counts("timer.quick_x") and not R.counts("timer.hk_timer_")
    assert not R.counts("timer.quick_1_old") and not R.counts("light.quick_1")
    assert not R.counts("timer.quick_2", ["timer.quick_2"])
    assert R.is_made("timer.hk_timer_3") and not R.is_made("timer.quick_3")


@pytest.mark.parametrize("value,secs", [("00:15:00", 900), ("1:30:00", 5400), ("05:00", 300), ("90", 90), (90, 90), ("", 0), ("x", 0), (None, 0), (True, 0), ("1:2:3:4", 0)])
def test_a_duration(value, secs):
    assert R.duration_secs(value) == secs


@pytest.mark.parametrize("digits,secs", [("5", 300), ("130", 5400), ("90", 5400), ("0", 0), ("", 0), (None, 0), ("abc", 0), ("12345", 23 * 3600 + 45 * 60), (5, 300)])
def test_the_keypad_reads_as_the_helpers_script_does(digits, secs):
    assert R.digits_secs(digits) == secs


def test_a_real_end_is_told_from_a_cancel():
    assert R.judge(100.0, "active", 200.0) == "counting" and R.judge(None, "paused", 200.0) == "counting"
    assert R.judge(100.0, "idle", 100.0) == "ended"               # on time
    assert R.judge(100.0, "idle", 5000.0) == "ended"              # ended while Home Assistant was down: idle, no end time
    assert R.judge(100.0, "idle", 99.0) == "ended"                # within the margin
    assert R.judge(100.0, "idle", 50.0) == "stopped"              # Cancel, or Finish, well before its time
    assert R.judge(None, "idle", 50.0) == "stopped"               # paused, then canceled
    assert R.judge(100.0, "unavailable", 500.0) == "wait" and R.judge(100.0, None, 500.0) == "wait"     # it can't say yet
    assert not R.is_late(100.0, 100.0 + R.LATE_RING) and R.is_late(100.0, 101.0 + R.LATE_RING)


def test_the_lowest_free_number():
    assert R.next_number([]) == 1 and R.next_number(["timer.hk_timer_1", "timer.hk_timer_3", "light.x"]) == 2


def test_a_name_is_cleaned():
    assert R.clean_name("  Pasta \n sauce ") == "Pasta sauce" and R.clean_name("") == "Timer" and R.clean_name(None) == "Timer"
    assert len(R.clean_name("x" * 200)) == R.MAX_NAME and R.clean_name("a\x07b") == "ab"


def test_the_sensor_covers_every_timer_that_counts():
    states = {"timer.quick_1": {"s": "active", "a": {"finishes_at": "2026-11-09T01:00:00+00:00"}},
              "input_text.quick_timer_1_name": {"s": "Pasta", "a": {}},
              "timer.quick_2": {"s": "idle", "a": {}},
              "timer.hk_timer_4": {"s": "active", "a": {"finishes_at": "2026-11-09T00:30:00+00:00", "friendly_name": "Oven"}},
              "timer.hk_timer_5": {"s": "paused", "a": {"friendly_name": "Rice"}},
              "timer.nap_timer": {"s": "active", "a": {"finishes_at": "2026-11-09T00:10:00+00:00"}},
              "timer.quick_3": {"s": "active", "a": {"finishes_at": "2026-11-09T00:20:00+00:00"}}}
    n, a = R.sensor_attributes(states, ["timer.quick_3"])
    assert n == 2 and [r["name"] for r in a["running"]] == ["Oven", "Pasta"]
    assert a["running"][0] == {"entity_id": "timer.hk_timer_4", "name": "Oven", "finishes_at": "2026-11-09T00:30:00+00:00"}
    assert a["made"] == ["timer.hk_timer_4", "timer.hk_timer_5"]


# ---- Mantel making them
class House:
    """The fake command connection, answering as Home Assistant did, and its states landing in Mantel's store."""

    def __init__(self, gw):
        self.gw, self.hub, self.host = gw, gw.m.app["hub"], gw.m.app["timers"]
        if getattr(self.hub, "ha", None) is not None:
            self.hub.ha.ready.set()
        real = gw.fake.call

        async def call(frame, ticket):
            got = await real(frame, ticket)
            kind = frame["type"]
            if kind == "timer/create":
                oid = frame["name"].lower().replace(" ", "_")
                self.put(f"timer.{oid}", "idle", friendly_name=frame["name"])
            elif kind == "timer/update":
                eid = "timer." + frame["timer_id"]
                self.put(eid, "idle", friendly_name=frame["name"])
            elif kind == "timer/delete":
                self.gone("timer." + frame["timer_id"])
            elif frame.get("service") == "start" and frame.get("domain") == "timer":
                eid = frame["service_data"]["entity_id"]
                a = self.hub.store.states[eid]["a"]
                self.put(eid, "active", friendly_name=a.get("friendly_name"), duration=frame["service_data"]["duration"],
                         finishes_at=iso(gw.m.app["clock"]() + R.duration_secs(frame["service_data"]["duration"])))
            return got
        gw.fake.call = call

    def put(self, eid, state, **attrs):
        self.hub.store.states[eid] = {"s": state, "a": attrs, "lc": 1.0, "lu": 1.0}
        self.hub.on_change({eid})

    def gone(self, eid):
        self.hub.store.states.pop(eid, None)
        self.hub.on_change({eid})

    async def settle(self):
        for _ in range(5):
            await asyncio.sleep(0)
        if self.host.tasks:
            await asyncio.gather(*list(self.host.tasks))

    def sent(self, kind):
        return [f for f in self.gw.fake.frames if f["type"] == kind]


async def start(gw, ws, *, i=1, digits=None, duration=None, name=None):
    data = {"digits": digits} if digits is not None else {"duration": duration}
    if name:
        data["name"] = name
    return await gw.command(ws, id=i, kind="service", domain="script", service="quick_timer_create" if digits is not None else "quick_timer_start",
                            data=data, return_response=True)


async def test_a_start_makes_a_named_helper_and_runs_it(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    r = await start(gw, ws, digits="15", name="Pasta")
    assert r["result"]["response"] == {"started": True, "slot": "timer.hk_timer_1"}
    assert [f["type"] for f in gw.fake.frames] == ["timer/create", "timer/update", "call_service"]
    assert gw.fake.frames[0]["name"] == "HK Timer 1" and gw.fake.frames[0]["restore"] is True    # the id comes from this name
    assert gw.fake.frames[1]["name"] == "Pasta" and gw.fake.frames[2]["service_data"] == {"entity_id": "timer.hk_timer_1", "duration": "00:15:00"}
    assert gw.fake.frames[2]["domain"] == "timer"
    row = h.host.rows["timer.hk_timer_1"]
    assert row.made and row.name == "Pasta"
    # the sensor every card reads knows it, with no helpers installed, and the scripts are there
    st = h.hub.store.states
    assert st[R.SENSOR]["s"] == "1" and st[R.SENSOR]["a"]["running"][0]["name"] == "Pasta" and st[R.SENSOR]["a"]["made"] == ["timer.hk_timer_1"]
    assert "script.quick_timer_start" in st and "script.quick_timer_create" in st
    # audited under one row, the script's
    (audit,) = gw.audit()
    assert audit["action"] == "script.quick_timer_create" and audit["result"] == "ok"
    await ws.close()


async def test_nothing_to_time_starts_nothing_and_the_form_hears_why(gw):
    House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    r = await start(gw, ws, digits="0")
    assert r["result"]["response"] == {"started": False, "reason": "zero_duration"} and gw.fake.frames == []
    await ws.close()


async def test_numbers_are_reused_and_there_is_a_limit(gw):
    House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    got = [(await start(gw, ws, i=i + 1, duration="00:10:00"))["result"]["response"] for i in range(R.MAX_MADE + 1)]
    assert [g.get("slot") for g in got[:3]] == ["timer.hk_timer_1", "timer.hk_timer_2", "timer.hk_timer_3"]
    assert got[-1] == {"started": False, "reason": "no_free_slot"}
    await ws.close()


async def test_a_real_end_is_noticed_and_the_helper_deleted(gw):
    h = House(gw)
    ends = []
    h.host.on_end = lambda row, late: ends.append((row.name, late))
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await start(gw, ws, digits="1", name="Pasta")
    eid = "timer.hk_timer_1"
    h.host.rows[eid].finishes_at = gw.m.app["clock"]() - 1             # its time has come
    h.put(eid, "idle", friendly_name="Pasta")
    await h.settle()
    assert ends == [("Pasta", False)] and eid not in h.host.rows
    assert [f["timer_id"] for f in h.sent("timer/delete")] == ["hk_timer_1"]
    assert eid not in h.hub.store.states and h.hub.store.states[R.SENSOR]["s"] == "0"
    assert not gw.m.app["store"].db.execute("SELECT 1 FROM timers").fetchall()
    # the delete has its own row, Mantel's
    assert [r["action"] for r in gw.audit() if r["actor"] == "mantel"] == ["timer/delete"]
    await ws.close()


async def test_a_cancel_is_silent_and_the_helper_deleted(gw):
    h = House(gw)
    ends = []
    h.host.on_end = lambda row, late: ends.append(row.name)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await start(gw, ws, digits="10", name="Pasta")
    h.put("timer.hk_timer_1", "idle", friendly_name="Pasta")           # ten minutes early
    await h.settle()
    assert ends == [] and len(h.sent("timer/delete")) == 1 and "timer.hk_timer_1" not in h.host.rows
    await ws.close()


async def test_a_pause_and_more_time_follow_the_end_time(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await start(gw, ws, digits="10", name="Pasta")
    eid, now = "timer.hk_timer_1", gw.m.app["clock"]()
    h.put(eid, "paused", friendly_name="Pasta", remaining="0:05:00")
    assert h.host.rows[eid].finishes_at is None
    h.put(eid, "active", friendly_name="Pasta", finishes_at=iso(now + 900))
    assert abs(h.host.rows[eid].finishes_at - (now + 900)) < 1
    await ws.close()


async def test_across_restarts(gw):
    """Home Assistant restarted, or Mantel: the copy in the table decides. Measured: a timer that ended while Home Assistant
    was down comes back idle with no end time; one still running comes back with the same end time."""
    h = House(gw)
    ends = []
    h.host.on_end = lambda row, late: ends.append((row.name, late))
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await start(gw, ws, digits="10", name="Pasta")
    await start(gw, ws, i=2, digits="20", name="Oven")
    await start(gw, ws, i=3, digits="30", name="Rice")
    a, b, c = "timer.hk_timer_1", "timer.hk_timer_2", "timer.hk_timer_3"
    clock = gw.m.app["clock"]()
    # a Mantel that starts now reads the same rows from the table
    from mantel_server.timers import TimerStore
    assert set(TimerStore(gw.m.app["store"].db).load()) == {a, b, c}
    # while it is starting, Home Assistant can't say: nothing is decided, and nothing is lost
    h.host.rows[a].finishes_at = clock - 60
    h.put(a, "unavailable")
    h.gone(b)
    await h.settle()
    assert a in h.host.rows and b in h.host.rows and ends == [] and not h.sent("timer/delete")
    # back: Pasta ended a minute ago (it rings late); Rice ended an hour ago (too late to ring)
    h.put(a, "idle", friendly_name="Pasta")
    h.host.rows[c].finishes_at = clock - 3600
    h.put(c, "idle", friendly_name="Rice")
    await h.settle()
    assert sorted(ends) == [("Pasta", False), ("Rice", True)]
    # Oven came back running: it carries on
    h.put(b, "active", friendly_name="Oven", finishes_at=iso(clock + 1200))
    assert b in h.host.rows and abs(h.host.rows[b].finishes_at - (clock + 1200)) < 1
    await ws.close()


async def test_a_leftover_is_deleted_and_a_timer_being_made_is_not(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    h.put("timer.hk_timer_9", "idle", friendly_name="Left Behind")     # nobody is following it
    await h.settle()
    assert [f["timer_id"] for f in h.sent("timer/delete")] == ["hk_timer_9"]
    h.host.starting.add("timer.hk_timer_5")
    h.put("timer.hk_timer_5", "idle", friendly_name="HK Timer 5")
    await h.settle()
    assert len(h.sent("timer/delete")) == 1
    await ws.close()


async def test_other_timers_are_left_alone(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    await gw.command(ws, **service("light", "turn_on", "light.kitchen"))
    h.put("timer.kitchen_no_motion", "active", finishes_at=iso(gw.m.app["clock"]() + 5))
    h.put("timer.kitchen_no_motion", "idle")
    h.put("timer.quick_1", "active", finishes_at=iso(gw.m.app["clock"]() - 1))     # a quick slot is followed, never deleted
    assert "timer.quick_1" in h.host.rows and "timer.kitchen_no_motion" not in h.host.rows
    h.put("timer.quick_1", "idle")
    await h.settle()
    assert "timer.quick_1" not in h.host.rows and not h.sent("timer/delete")
    assert "timer.kitchen_no_motion" in h.hub.store.states
    await ws.close()


async def test_with_no_admin_credential_the_helpers_scripts_run_as_before(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    real = gw.fake.call

    async def refuse(frame, ticket):
        if frame["type"] == "timer/create":
            raise HaCommandError("unauthorized", "Unauthorized")
        return await real(frame, ticket)
    gw.fake.call = refuse
    r = await start(gw, ws, digits="10", name="Pasta")
    assert "result" in r and gw.fake.frames[-1]["domain"] == "script" and gw.fake.frames[-1]["service"] == "quick_timer_create"
    assert h.host.no_admin and h.host.status()["can_make"] is False
    await ws.close()


async def test_a_step_that_fails_leaves_no_timer_behind(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    real = gw.fake.call

    async def fail(frame, ticket):
        if frame["type"] == "timer/update":
            raise HaCommandError("home_assistant_error", "no")
        return await real(frame, ticket)
    gw.fake.call = fail
    r = await start(gw, ws, digits="10", name="Pasta")
    await h.settle()
    assert "error" in r and "timer.hk_timer_1" not in h.host.rows and [f["timer_id"] for f in h.sent("timer/delete")] == ["hk_timer_1"]
    await ws.close()


async def test_a_page_can_not_send_the_helper_calls_itself(gw):
    House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    r = await gw.command(ws, kind="ws", msg={"type": "timer/delete", "timer_id": "kitchen_no_motion"})
    assert r["error"]["code"] in ("not_a_write", "invalid_command") and gw.fake.frames == []
    await ws.close()


async def test_a_wall_tablet_sees_starts_and_stops_timers_and_nothing_else_of_the_kind(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    got = await start(gw, ws, digits="10", name="Pasta")
    assert got["result"]["response"]["started"] is True
    assert h.host.rows["timer.hk_timer_1"].room == "kitchen" and h.host.rows["timer.hk_timer_1"].set_by     # where it was set
    cancel = await gw.command(ws, id=5, **service("timer", "cancel", "timer.hk_timer_1"))
    assert "result" in cancel
    other = await gw.command(ws, id=6, **service("timer", "cancel", "timer.kitchen_no_motion"))
    assert other["error"]["reason"] == "no_grant"
    other = await gw.command(ws, id=7, **service("timer", "start", "timer.nap_timer"))
    assert other["error"]["reason"] == "no_grant"
    await ws.close()
