"""Timers people set (docs/phase21/TIMER-SLIDE.md): the rules (hk_core.timers), and Mantel making them through the gateway with
a fake command connection. Home Assistant's own behavior (create, rename, restart, delete) was measured on a scratch one; the
fake here answers as it did."""
import asyncio
from datetime import datetime, timezone

import pytest

import gateway_fakes as GF
from hk_core import timers as R
from mantel_server.ha.ha_client import HaCommandError
from mantel_server.settings_store import Actor as SettingsActor

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
    assert ends == [("Pasta", False)] and h.host.rows[eid].ring_until is not None and not h.sent("timer/delete")
    ringing = h.hub.store.states[R.SENSOR]["a"]["ringing"]
    assert [r["name"] for r in ringing] == ["Pasta"] and ringing[0]["tone"] == "bell" and ringing[0]["until"] > 0
    got = await gw.command(ws, id=9, kind="service", domain="script", service="quick_timer_ring", data={"op": "stop"}, return_response=True)
    assert got["result"]["response"] == {"ok": True, "timers": [eid]}
    await h.settle()
    assert eid not in h.host.rows and h.hub.store.states[R.SENSOR]["a"]["ringing"] == []
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
    from mantel_server.features.timers import TimerStore
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
    assert h.host.rows[a].ring_until is not None and c not in h.host.rows       # Pasta rings; Rice only says when it ended
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
    assert h.host.rows["timer.quick_1"].ring_until is not None         # a quick slot rings too
    await gw.command(ws, id=9, kind="service", domain="script", service="quick_timer_ring", data={"op": "stop", "entity_id": "timer.quick_1"})
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


def settings(env, **features):
    """As Settings saves them: into the house's `features` document."""
    env.m.app["settings"].store.write([("house", "settings", {"features": features})], actor=SettingsActor(label="test"))


# ---- the ring
async def ring(gw, ws, h, *, i=1, name="Pasta", **data):
    got = await start(gw, ws, i=i, digits="15", name=name)
    eid = got["result"]["response"]["slot"]
    h.host.rows[eid].room = data.get("room", h.host.rows[eid].room)
    h.host.rows[eid].rings_in = data.get("rings_in")
    h.host.rows[eid].finishes_at = gw.m.app["clock"]() - 1
    a = h.hub.store.states[eid]["a"]
    h.put(eid, "idle", friendly_name=a.get("friendly_name"), duration="0:00:00")      # (measured: an idle helper's own is 0)
    await asyncio.sleep(0)
    return eid


def act(gw, ws, i, **data):
    return gw.command(ws, id=i, kind="service", domain="script", service="quick_timer_ring", data=data, return_response=True)


async def test_plus_one_minute_counts_again_for_a_minute(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    eid = await ring(gw, ws, h)
    got = await act(gw, ws, 9, op="more", entity_id=eid)
    assert got["result"]["response"]["ok"] is True
    assert gw.fake.frames[-1]["service"] == "start" and gw.fake.frames[-1]["service_data"] == {"entity_id": eid, "duration": "00:01:00"}
    await h.settle()
    row = h.host.rows[eid]
    assert row.ring_until is None and h.hub.store.states[R.SENSOR]["a"]["ringing"] == [] and eid not in h.host.ringers
    assert abs(row.finishes_at - (gw.m.app["clock"]() + 60)) < 2 and not h.sent("timer/delete")
    await ws.close()


async def test_restart_runs_its_own_length_again(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    eid = await ring(gw, ws, h)
    await act(gw, ws, 9, op="again", entity_id=eid)
    assert gw.fake.frames[-1]["service_data"] == {"entity_id": eid, "duration": "00:15:00"}
    # +1 Min, then it ends again: Restart is still its own length
    h.host.rows[eid].finishes_at = gw.m.app["clock"]() - 1
    h.put(eid, "idle", friendly_name="Pasta", duration="0:00:00")
    await act(gw, ws, 10, op="more", entity_id=eid)
    h.host.rows[eid].finishes_at = gw.m.app["clock"]() - 1
    h.put(eid, "idle", friendly_name="Pasta", duration="0:00:00")
    await act(gw, ws, 11, op="again", entity_id=eid)
    assert gw.fake.frames[-1]["service_data"] == {"entity_id": eid, "duration": "00:15:00"}
    await ws.close()


async def test_stop_with_no_name_stops_every_one_ringing_and_rings_once(gw):
    h = House(gw)
    ends = []
    h.host.on_end = lambda row, late: ends.append(row.name)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    a = await ring(gw, ws, h, name="Pasta")
    b = await ring(gw, ws, h, i=2, name="Oven")
    assert ends == ["Pasta", "Oven"]
    h.hub.on_change({a, b})                                            # more news of the same end doesn't ring again
    assert ends == ["Pasta", "Oven"]
    got = await act(gw, ws, 9, op="stop")
    assert sorted(got["result"]["response"]["timers"]) == [a, b] and not h.host.rows and not h.host.ringers
    got = await act(gw, ws, 10, op="stop")
    assert got["result"]["response"] == {"ok": False, "reason": "not_ringing"}
    assert (await act(gw, ws, 11, op="nonsense"))["result"]["response"]["ok"] is False
    await ws.close()


async def test_it_stops_by_itself_when_its_time_is_up(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    eid = await ring(gw, ws, h)
    h.host._quiet(eid)
    h.host.rows[eid].ring_until = gw.m.app["clock"]() - 1              # its time has come
    h.host._ensure_ringer(eid)
    await h.settle()
    await asyncio.sleep(0.01)
    await h.settle()
    assert eid not in h.host.rows and [f["timer_id"] for f in h.sent("timer/delete")] == [R.object_id(eid)]
    await ws.close()


async def test_a_ring_carries_on_after_mantel_restarts(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    eid = await ring(gw, ws, h)
    until = h.host.rows[eid].ring_until
    from mantel_server.features.timers import TimerStore
    assert TimerStore(gw.m.app["store"].db).load()[eid].ring_until == until
    await ws.close()


async def test_house_timers_and_where_it_rings_come_from_the_settings(gw):
    h = House(gw)
    settings(gw, house_timers=["timer.quick_2"], timer_tablet=False, timer_sound="chime", timer_ring_for="stop", timer_phone="porch")
    await gw.login("avery", "owner")
    ws = await gw.socket()
    h.put("timer.quick_2", "active", finishes_at=iso(gw.m.app["clock"]() + 30))
    assert "timer.quick_2" not in h.host.rows and h.hub.store.states[R.SENSOR]["s"] == "0"
    eid = await ring(gw, ws, h)
    (r,) = h.hub.store.states[R.SENSOR]["a"]["ringing"]
    assert r["tablet"] is False and r["tone"] == "chime" and r["areas"] == ["porch"]         # set by a person's phone: its setting
    assert h.host.rows[eid].ring_until - gw.m.app["clock"]() == pytest.approx(R.UNTIL_STOPPED, abs=2)
    await act(gw, ws, 9, op="stop")
    await ws.close()


def test_where_it_rings():
    assert R.area_for("office", "kitchen", "porch") == "office" and R.area_for(None, "kitchen", "porch") == "kitchen"
    assert R.area_for(None, None, "porch") == "porch" and R.area_for(None, None, "") is None
    rooms = [("media_player.kitchen", "kitchen"), ("media_player.office", "office"), ("media_player.none", None)]
    assert R.speakers_for("kitchen", [], rooms, True) == ["media_player.kitchen"]
    assert R.speakers_for("kitchen", [], rooms, False) == []
    assert R.speakers_for("kitchen", ["office"], rooms, True) == ["media_player.kitchen", "media_player.office"]
    assert R.speakers_for("kitchen", ["office"], rooms, False) == ["media_player.office"]
    assert R.speakers_for(None, [], rooms, True) == []
    assert R.speakers_for(None, ["all"], rooms, True) == [e for e, _a in rooms]


def test_a_clip_is_real_audio():
    import struct
    for tone in ("bell", "chime", "kitchen", "nonsense"):
        pcm = R.clip_pcm(tone)
        n = len(pcm) // 2
        vals = struct.unpack(f"<{n}h", pcm)
        assert n > R.CLIP_RATE * 4 and 10000 < max(abs(v) for v in vals) <= 32767
    assert R.ring_secs(30) == 30 and R.ring_secs("stop") == R.UNTIL_STOPPED and R.ring_secs(True) == 60 and R.ring_secs(None) == 60


def test_its_settings_are_checked():
    from hk_core.settings import changes as C
    H = C.HOUSE
    assert H["features.timer_sound"]("chime") == "chime" and H["features.timer_ring_for"]("stop") == "stop" and H["features.timer_ring_for"](30) == 30
    assert H["features.timer_also"](["kitchen", "all", "kitchen"]) == ["kitchen", "all"] and H["features.timer_phone"]("") == "" and H["features.timer_volume"](40) == 40
    for key, bad in (("features.timer_sound", "siren"), ("features.timer_ring_for", 45), ("features.timer_ring_for", True), ("features.timer_tablet", "yes"),
                     ("features.timer_also", "kitchen"), ("features.timer_also", ["../x"]), ("features.timer_phone", "A B"), ("features.timer_volume", 500), ("features.timer_volume", True)):
        with pytest.raises(C.Invalid):
            H[key](bad)


async def test_the_sensor_is_there_in_a_house_with_no_timers(gw):
    h = House(gw)
    h.hub.store.states.pop(R.SENSOR, None)
    h.hub.on_change({"light.kitchen"})
    assert h.hub.store.states[R.SENSOR]["s"] == "0" and h.hub.store.states[R.SENSOR]["a"]["made"] == []
    assert "script.quick_timer_ring" in h.hub.store.states


# ---- Which Timers
def test_which_timers_rules():
    ignore, include = R.rules({"house_timers": ["timer.nap", "timer.night"], "timer_ignore": ["timer.quick_2"], "timer_include": ["timer.night", "timer.fan"]})
    assert ignore == {"timer.nap", "timer.quick_2"} and include == {"timer.night", "timer.fan"}
    assert R.counts("timer.quick_1", ignore, include) and not R.counts("timer.quick_2", ignore, include)      # a quick slot, turned off
    assert R.counts("timer.night", ignore, include) and not R.counts("timer.nap", ignore, include)            # a House Timer, turned on; one not
    assert R.counts("timer.fan", ignore, include) and not R.counts("timer.other", ignore, include)            # anything, turned on; the rest off
    assert not R.counts("light.fan", ignore, {"light.fan"})


async def test_the_settings_are_read_where_settings_saves_them(gw):
    """(a real bug on 0.1.155: they were read from another document, so every setting read as its default)"""
    from hk_core.settings import model as SM
    h = House(gw)
    settings(gw, timer_sound="kitchen", timer_ring_for=30, timer_volume=25)
    got = SM.merged(gw.m.app["features"].stored().options)["features"]
    assert got["timer_sound"] == "kitchen"                             # the same document Settings' own reader takes
    o = h.host.options()
    assert o["timer_sound"] == "kitchen" and o["timer_ring_for"] == 30 and o["timer_volume"] == 25 and o["timer_tablet"] is True


def test_settings_takes_every_timer_setting_when_saved():
    """What the page sends goes through the same check it does in Settings, and comes back out of the merged settings."""
    from hk_core.settings import changes as C, model as SM
    values = {"features.timer_sound": "chime", "features.timer_ring_for": "stop", "features.timer_tablet": False, "features.timer_speaker": False,
              "features.timer_also": ["all"], "features.timer_phone": "kitchen", "features.timer_volume": 35, "features.timer_wake": False,
              "features.timer_include": ["timer.groot_timer"], "features.timer_ignore": ["timer.quick_1"]}
    options, errors = C.apply_house({"dashboard": {}}, values)
    assert not errors, errors
    got = SM.merged(options)["features"]
    assert {f"features.{k}": got[k] for k in (x.split(".")[1] for x in values)} == values


async def test_a_timer_turned_on_rings_and_is_never_deleted_and_one_turned_off_doesnt(gw):
    h = House(gw)
    settings(gw, timer_include=["timer.groot_timer"], timer_ignore=["timer.quick_1"])
    await gw.login("avery", "owner")
    ws = await gw.socket()
    clock = gw.m.app["clock"]()
    h.put("timer.groot_timer", "active", friendly_name="Groot", duration="1:00:00", finishes_at=iso(clock + 30))
    h.put("timer.quick_1", "active", finishes_at=iso(clock + 30))
    h.put("timer.kitchen_no_motion", "active", finishes_at=iso(clock + 30))
    st = h.hub.store.states[R.SENSOR]
    assert [r["name"] for r in st["a"]["running"]] == ["Groot"] and st["a"]["made"] == ["timer.groot_timer"]
    h.host.rows["timer.groot_timer"].finishes_at = clock - 1
    h.put("timer.groot_timer", "idle", friendly_name="Groot", duration="0:00:00")
    await h.settle()
    assert [r["name"] for r in h.hub.store.states[R.SENSOR]["a"]["ringing"]] == ["Groot"]
    await act(gw, ws, 9, op="again", entity_id="timer.groot_timer")
    assert gw.fake.frames[-1]["service_data"] == {"entity_id": "timer.groot_timer", "duration": "01:00:00"}    # its own length
    h.host.rows["timer.groot_timer"].finishes_at = clock - 1
    h.put("timer.groot_timer", "idle", friendly_name="Groot", duration="0:00:00")
    await act(gw, ws, 10, op="stop")
    await h.settle()
    assert not h.sent("timer/delete") and "timer.groot_timer" in h.hub.store.states           # Home Assistant's, not ours
    await ws.close()


async def test_a_tablet_may_see_and_control_a_timer_turned_on_and_no_other(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    before = await gw.command(ws, id=1, **service("timer", "cancel", "timer.groot_timer"))
    assert before["error"]["reason"] == "no_grant"
    settings(gw, timer_include=["timer.groot_timer"])
    h.put("timer.groot_timer", "active", friendly_name="Groot", finishes_at=iso(gw.m.app["clock"]() + 300))
    after = await gw.command(ws, id=2, **service("timer", "cancel", "timer.groot_timer"))
    assert "result" in after
    other = await gw.command(ws, id=3, **service("timer", "cancel", "timer.kitchen_no_motion"))
    assert other["error"]["reason"] == "no_grant"
    settings(gw)                                                       # turned off again
    h.hub.on_change({"timer.groot_timer"})
    again = await gw.command(ws, id=4, **service("timer", "cancel", "timer.groot_timer"))
    assert again["error"]["reason"] == "no_grant"
    await ws.close()


async def test_a_settings_save_reaches_the_screens_with_no_timer_changing(gw):
    h = House(gw)
    h.put("timer.groot_timer", "active", friendly_name="Groot", finishes_at=iso(gw.m.app["clock"]() + 300))
    h.host.settings_look()
    assert h.hub.store.states[R.SENSOR]["s"] == "0"
    settings(gw, timer_include=["timer.groot_timer"])
    h.host.settings_look()
    assert h.hub.store.states[R.SENSOR]["s"] == "1" and h.host.turned_on == {"timer.groot_timer"}
    h.hub.store.states[R.SENSOR]["s"] = "stale"
    h.host.settings_look()                                             # nothing new: nothing sent
    assert h.hub.store.states[R.SENSOR]["s"] == "stale"
