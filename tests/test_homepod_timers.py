"""HomePod timers on Mantel (docs/phase28/HOMEPOD-TIMERS.md; features/homepod_timers.py): the reader read, its timers
mirrored as Home Assistant helpers, its commands through the gateway, its alarms, staleness and the alert. A fake reader and
a fake command connection: nothing reaches a real HomePod or Home Assistant. The fictional house only."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import gateway_fakes as GF
from hk_core import timers as R
from hk_core.timers import homepod as H

gw = GF.gw
KITCHEN = "Kitchen-HomePod-TileCell"


def iso(t):
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class Reader:
    """The HomePod timer reader, as its API answers."""

    def __init__(self, now):
        self.now, self.timers, self.alarms, self.broken, self.down = now, [], [], False, False
        self.posts, self.result = [], {"state": "done", "detail": "pressed"}

    def timer(self, label="Timer", left=600, paused=False, tile=KITCHEN, room="Kitchen"):
        at = self.now[0]
        t = {"label": label, "left_s": left, "paused": paused, "room": room, "homepod": "HomePod", "tile": tile, "read_at": iso(at)}
        if not paused:
            t["ends_at"] = iso(at + left)
        self.timers.append(t)
        return t

    async def get(self, path):
        if self.down:
            from mantel_server.features.homepod_timers import ReaderError
            raise ReaderError("unreachable", "ClientConnectorError")
        if path.startswith("/command"):
            return {"id": 1, **self.result}
        if path == "/timers.json":
            rows = []
            for tile in sorted({t["tile"] for t in self.timers}):
                for i, t in enumerate(t for t in self.timers if t["tile"] == tile):
                    rows.append(dict(t, index=i))
            return {"at": iso(self.now[0]), "broken": self.broken, "timers": rows}
        return {"at": iso(self.now[0]), "broken": self.broken, "alarms": [dict(a, index=i) for i, a in enumerate(self.alarms)]}

    async def post(self, path, params):
        self.posts.append((path, dict(params)))
        return {"ok": True, "command": 7}


class House:
    """The fake command connection answering timer calls as Home Assistant does, into Mantel's store."""

    def __init__(self, gw):
        self.gw, self.hub = gw, gw.m.app["hub"]
        self.hub.ha.ready.set()
        real = gw.fake.call

        async def call(frame, ticket):
            got = await real(frame, ticket)
            now, kind = gw.m.app["clock"](), frame["type"]
            if kind == "timer/create":
                self.put("timer." + frame["name"].lower().replace(" ", "_"), "idle", friendly_name=frame["name"])
            elif kind == "timer/update":
                eid = "timer." + frame["timer_id"]
                self.put(eid, (self.st(eid) or {}).get("s", "idle"), **dict((self.st(eid) or {}).get("a", {}), friendly_name=frame["name"]))
            elif kind == "timer/delete":
                self.hub.store.states.pop("timer." + frame["timer_id"], None)
            elif frame.get("domain") == "timer":
                d = frame["service_data"]
                eid, svc, a = d["entity_id"], frame["service"], dict((self.st(d["entity_id"]) or {}).get("a", {}))
                if svc == "start":
                    left = H.secs(d.get("duration") or "") or H.secs(a.get("remaining") or "") or 0
                    if d.get("duration"):
                        a["duration"] = d["duration"]
                    a.update(finishes_at=iso(now + left), remaining=H.hms(left))
                    self.put(eid, "active", **a)
                elif svc == "pause":
                    left = max(0, _end(a) - now)
                    a.pop("finishes_at", None)
                    a["remaining"] = H.hms(left)
                    self.put(eid, "paused", **a)
                elif svc == "change":
                    sign = -1 if d["duration"].startswith("-") else 1
                    a["finishes_at"] = iso(_end(a) + sign * H.secs(d["duration"].lstrip("-")))
                    self.put(eid, "active", **a)
                elif svc == "cancel":
                    self.put(eid, "idle", friendly_name=a.get("friendly_name"))
            return got
        gw.fake.call = call

    def st(self, eid):
        return self.hub.store.states.get(eid)

    def put(self, eid, state, **attrs):
        self.hub.store.states[eid] = {"s": state, "a": attrs, "lc": 1.0, "lu": 1.0}
        self.hub.on_change({eid})

    def sent(self):
        return [f["type"] if f["type"] != "call_service" else f"{f['domain']}.{f['service']}" for f in self.gw.fake.frames]


def _end(a):
    return datetime.fromisoformat(a["finishes_at"].replace("Z", "+00:00")).timestamp()


@pytest.fixture
async def hp(gw):
    host = gw.m.app["homepod_timers"]
    if host.task is not None:
        host.task.cancel()                    # the test looks itself
    reader = Reader(gw.now)
    host.get, host.post = reader.get, reader.post
    host._current = lambda: SimpleNamespace(url="http://reader.test", token="fictional-token")
    house = House(gw)
    return SimpleNamespace(gw=gw, host=host, reader=reader, house=house, states=house.hub.store.states)


async def look(hp, secs=2.0):
    hp.gw.now[0] += secs
    await hp.host.look()


def attrs(hp):
    return hp.states[R.SENSOR]["a"]


# ---- the mirror
async def test_a_siri_timer_becomes_a_home_assistant_timer(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    assert hp.house.sent() == ["timer/create", "timer/update", "timer.start"]
    create = hp.gw.fake.frames[0]
    assert create["name"] == "HK HomePod 1" and create["restore"] is True
    st = hp.states["timer.hk_homepod_1"]
    assert st["s"] == "active" and st["a"]["friendly_name"] == "Pasta" and st["a"]["duration"] == "00:09:58"     # (read 2 s ago)
    row = hp.host.known[1]
    assert (row.tile, row.label, row.room, row.total) == (KITCHEN, "Pasta", "Kitchen", 600)
    # every screen hears whose it is, on the sensor every card reads
    a = attrs(hp)
    assert a["running"][0]["entity_id"] == "timer.hk_homepod_1" and a["running"][0]["source"] == "homepod"
    assert a["running"][0]["room"] == "kitchen" and a["homepod"]["state"] == "ok"
    assert a["homepod"]["timers"]["timer.hk_homepod_1"]["controls"] == ["pause", "resume", "cancel"]
    # Mantel's own audit rows, before the calls
    assert [r["action"] for r in hp.gw.audit() if r["actor"] == "mantel"] == ["homepod.create"]
    # the next read changes nothing: no call, no row
    await look(hp)
    assert len(hp.gw.fake.frames) == 3


async def test_a_pause_and_a_resume_on_the_homepod_follow(hp):
    t = hp.reader.timer("Timer", 600)
    await look(hp)
    t.update(paused=True, left_s=590)
    t.pop("ends_at")
    await look(hp, 8)
    assert hp.states["timer.hk_homepod_1"]["s"] == "paused" and hp.house.sent()[-1] == "timer.pause"
    t.update(paused=False, left_s=590, ends_at=iso(hp.gw.now[0] + 60 + 590))
    await look(hp, 60)
    assert hp.states["timer.hk_homepod_1"]["s"] == "active" and "timer.start" in hp.house.sent()[-2:]
    assert 1 in hp.host.known and len(hp.host.known) == 1                 # the same timer all along


async def test_never_ringing_in_mantel(hp):
    ends = []
    timers = hp.gw.m.app["timers"]
    timers.on_end = lambda row, late: ends.append(row.entity_id)
    hp.reader.timer("Pasta", 5)
    await look(hp)
    hp.reader.timers.clear()                                  # the HomePod rang and the timer is gone
    hp.gw.now[0] += 5
    hp.house.put("timer.hk_homepod_1", "idle", friendly_name="Pasta")    # Home Assistant finished it
    await look(hp, 1)
    assert ends == [] and "timer.hk_homepod_1" not in timers.rows and not timers.ringers
    assert attrs(hp)["ringing"] == []
    assert hp.house.sent()[-1] == "timer/delete" and "timer.cancel" not in hp.house.sent()      # it ended: finished, not canceled
    assert hp.host.known == {} and "timer.hk_homepod_1" not in hp.states


async def test_a_timer_canceled_with_siri_is_canceled_and_deleted(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    hp.reader.timers.clear()
    await look(hp)
    assert hp.house.sent()[-2:] == ["timer.cancel", "timer/delete"] and hp.host.known == {}


async def test_an_unavailable_reader_is_never_taken_for_no_timers(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    sent = len(hp.gw.fake.frames)
    hp.reader.broken, hp.reader.timers = True, []             # it says it's broken, with an empty list
    await look(hp)
    assert hp.host.availability() == "unavailable" and attrs(hp)["homepod"]["state"] == "unavailable"
    assert 1 in hp.host.known and len(hp.gw.fake.frames) == sent and "timer.hk_homepod_1" in hp.states
    hp.reader.broken, hp.reader.down = False, True            # then silent
    await look(hp, H.STALE_AFTER - 10)
    assert hp.host.availability() == "unavailable"            # (broken since the last good answer)
    assert not hp.host.alert_due()
    await look(hp, H.ALERT_AFTER)
    assert hp.host.alert_due() and 1 in hp.host.known
    hp.reader.down = False                                    # back, with the timer still running
    hp.reader.timers = []
    hp.reader.timer("Pasta", 600 - int(hp.gw.now[0] - 1_000_002.0))
    await look(hp)
    assert hp.host.availability() == "ok" and not hp.host.alert_due() and list(hp.host.known) == [1]


async def test_silent_for_two_minutes_is_unavailable(hp):
    await look(hp)
    assert hp.host.availability() == "ok"
    hp.reader.down = True
    await look(hp, H.STALE_AFTER - 1)
    assert hp.host.availability() == "ok" and hp.host.error
    await look(hp, 2)
    assert hp.host.availability() == "unavailable"


async def test_a_helper_nobody_follows_is_deleted(hp):
    hp.house.put("timer.hk_homepod_9", "active", friendly_name="Old", finishes_at=iso(hp.gw.now[0] + 100))
    await look(hp)
    assert hp.house.sent() == ["timer/delete"] and "timer.hk_homepod_9" not in hp.states


async def test_a_restart_keeps_the_same_helpers(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    from mantel_server.features.homepod_timers import HomePodStore
    again = HomePodStore(hp.gw.m.app["store"].db).load()
    assert list(again) == [1] and again[1].label == "Pasta" and again[1].tile == KITCHEN


async def test_nothing_is_mirrored_with_commands_off(hp):
    hp.gw.m.app["gateway"].commander = None
    hp.reader.timer("Pasta", 600)
    await look(hp)
    assert hp.gw.fake.frames == [] and attrs(hp)["homepod"]["can_mirror"] is False


# ---- commands, through the gateway
async def test_pause_from_a_screen_goes_to_the_reader_audited(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    await hp.gw.login("avery", "owner")
    ws = await hp.gw.socket()
    before = len(hp.gw.fake.frames)
    r = await hp.gw.command(ws, **GF.service("timer", "pause", "timer.hk_homepod_1"))
    assert r["type"] == "command_result", r
    assert r["result"]["response"]["ok"] is True
    assert hp.reader.posts == [("/timer", {"tile": KITCHEN, "index": 0, "action": "pause", "label": "Pasta"})]
    assert len(hp.gw.fake.frames) == before              # never to Home Assistant: the helper follows the next read
    row = [x for x in hp.gw.audit() if x["action"] == "timer.pause"][0]
    assert row["decision"] == "allowed" and row["result"] == "ok"
    r = await hp.gw.command(ws, id=2, **GF.service("timer", "start", "timer.hk_homepod_1"))
    assert hp.reader.posts[-1][1]["action"] == "resume"
    r = await hp.gw.command(ws, id=3, **GF.service("timer", "cancel", "timer.hk_homepod_1"))
    assert hp.reader.posts[-1][1]["action"] == "cancel"
    await ws.close()


async def test_what_a_homepod_can_t_do_is_refused(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    await hp.gw.login("avery", "owner")
    ws = await hp.gw.socket()
    for i, cmd in enumerate([GF.service("timer", "finish", "timer.hk_homepod_1"),
                             GF.service("timer", "start", "timer.hk_homepod_1", data={"duration": "0:05:00"}),
                             GF.service("timer", "pause", None, target={"entity_id": ["timer.hk_homepod_1", "timer.quick_1"]})]):
        r = await hp.gw.command(ws, id=i + 1, **cmd)
        assert "error" in r and r["error"]["code"] == "unsupported_command", r
    assert hp.reader.posts == []
    await ws.close()


async def test_a_reader_that_is_down_refuses_the_command(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    hp.reader.broken = True
    await look(hp)
    await hp.gw.login("avery", "owner")
    ws = await hp.gw.socket()
    r = await hp.gw.command(ws, **GF.service("timer", "pause", "timer.hk_homepod_1"))
    assert "error" in r and r["error"]["message"] == "homepod_reader_unavailable" and hp.reader.posts == []
    await ws.close()


async def test_a_failed_press_is_the_screen_s_answer(hp):
    hp.reader.timer("Pasta", 600)
    await look(hp)
    hp.reader.result = {"state": "failed", "detail": "timer 1 is Rice, not Pasta"}
    await hp.gw.login("avery", "owner")
    ws = await hp.gw.socket()
    r = await hp.gw.command(ws, **GF.service("timer", "pause", "timer.hk_homepod_1"))
    assert "error" in r and r["error"]["code"] == "homepod_failed"
    assert [x["result"] for x in hp.gw.audit() if x["action"] == "timer.pause"] == ["error:homepod_failed"]
    await ws.close()


async def test_an_alarm_is_switched_and_deleted_by_its_id(hp):
    hp.reader.alarms = [{"label": "Alarm", "time": "6:30 AM", "time_24": "06:30", "enabled": True, "room": "Kitchen", "homepod": "HomePod",
                         "tile": KITCHEN}]
    await look(hp)
    (alarm,) = attrs(hp)["homepod"]["alarms"]
    assert alarm["room"] == "kitchen" and alarm["time"] == "6:30 AM" and alarm["enabled"] is True
    await hp.gw.login("avery", "owner")
    ws = await hp.gw.socket()
    r = await hp.gw.command(ws, kind="service", domain="script", service="homepod_alarm", data={"alarm": alarm["id"], "action": "off"},
                            return_response=True)
    assert r["type"] == "command_result", r
    assert hp.reader.posts == [("/alarm", {"tile": KITCHEN, "index": 0, "action": "off", "time": "6:30 AM"})]
    r = await hp.gw.command(ws, id=2, kind="service", domain="script", service="homepod_alarm", data={"alarm": "nope", "action": "off"})
    assert "error" in r and r["error"]["code"] == "not_found"
    r = await hp.gw.command(ws, id=3, kind="service", domain="script", service="homepod_alarm", data={"alarm": alarm["id"], "action": "ring"})
    assert "error" in r and r["error"]["code"] == "invalid_command"
    assert [x["action"] for x in hp.gw.audit() if x["action"] == "script.homepod_alarm"] == ["script.homepod_alarm"] * 3
    await ws.close()


async def test_a_wall_tablet_may_pause_a_homepod_timer():
    from mantel_server.identity.rbac import DEFAULT_ROLES
    notes = [g for g in DEFAULT_ROLES["wall_tablet"].grants if g.resource in ("timer.hk_homepod_*", "script.homepod_alarm")]
    assert len(notes) == 2 and all({"view", "control"} <= set(g.actions) for g in notes)


# ---- what Home Assistant gets: each HomePod's next alarm
async def test_each_homepod_s_next_alarm(hp):
    hp.reader.alarms = [{"label": "Alarm", "time": "6:30 AM", "time_24": "06:30", "enabled": True, "repeats": "Every Day", "room": "Kitchen",
                         "homepod": "HomePod", "tile": KITCHEN},
                        {"label": "Nap", "time": "3:00 PM", "time_24": "15:00", "enabled": False, "room": "Den", "homepod": "HomePod",
                         "tile": "Den-HomePod-TileCell"}]
    heard = []
    hp.host.on_alarms.append(lambda: heard.append(1))
    await look(hp)
    got = {r["tile"]: r for r in hp.host.next_alarms()}
    assert got[KITCHEN]["at"] and got[KITCHEN]["label"] == "Alarm" and got[KITCHEN]["slug"] == "kitchen_homepod"
    assert got["Den-HomePod-TileCell"]["at"] is None and heard == [1]
    await look(hp)
    assert heard == [1]                                    # nothing changed: nobody told


# ---- Settings
async def test_settings_sees_the_reader_and_the_room_matching(hp):
    hp.reader.timer("Pasta", 600, room="Kitchen")
    hp.reader.timer("Timer", 300, tile="Garage-HomePod-TileCell", room="Garage")
    await look(hp)
    st = hp.host.status()
    assert st["state"] == "ok" and [(r["home"], r["area"], r["how"]) for r in st["rooms"]] == [("Garage", None, "none"), ("Kitchen", "kitchen", "name")]
    assert {"id": "porch", "name": "Porch"} in st["areas"]


async def test_the_reader_is_a_connection_of_its_own(gw):
    from mantel_server import connections as C
    assert "homepod" in C.KINDS and C.clean_url("homepod", "http://192.0.2.10:8787/") == "http://192.0.2.10:8787"
    with pytest.raises(C.ConnectionFailed):
        C.clean_url("homepod", "ws://192.0.2.10:8787")
    await gw.login("avery", "owner")
    r = await gw.m.client.get("/api/connections")
    body = await r.json()
    assert body["connections"]["homepod"]["state"] == "not_set_up" and body["connections"]["homepod"]["label"] == "HomePod Timer Reader"
    assert gw.m.app["homepod_timers"].availability() == "off"


async def test_the_alert_is_in_the_catalog():
    from mantel_server.alerts import catalog
    k = catalog.kind("homepod.lost")
    assert k.group == "connections" and k.clears and k.hold == 0
    await asyncio.sleep(0)


def test_home_assistant_gets_a_timestamp_sensor_per_homepod():
    from mantel_server.linked import check_entity
    from mantel_server.linked.linked_house import LinkedHouse
    rows = [{"tile": KITCHEN, "homepod": "HomePod", "home_room": "Kitchen", "slug": "kitchen_homepod", "at": "2026-11-13T06:30:00-05:00",
             "label": "Alarm", "time": "6:30 AM", "repeats": "Every Day"},
            {"tile": "Den-HomePod-TileCell", "homepod": "HomePod", "home_room": "Den", "slug": "den_homepod", "at": None}]
    host = SimpleNamespace(configured=True, availability=lambda: "ok", next_alarms=lambda: rows, room_of=lambda r: r.lower())
    house = LinkedHouse({"homepod_timers": host}, SimpleNamespace())
    out = {}
    house._homepod_alarms("entry1", out)
    kitchen, kind = out["entry1_homepod_kitchen_homepod_next_alarm"]
    assert kind == ("homepod_alarm", KITCHEN) and kitchen["entity_id"] == "sensor.kitchen_homepod_next_alarm"
    assert kitchen["state"] == "2026-11-13T06:30:00-05:00" and kitchen["features"] == {"device_class": "timestamp"}
    assert kitchen["attributes"]["room"] == "kitchen" and kitchen["attributes"]["repeats"] == "Every Day"
    den = out["entry1_homepod_den_homepod_next_alarm"][0]
    assert den["state"] is None and "label" not in den["attributes"]
    check_entity(kitchen) and check_entity(den)
    host.configured = False
    none = {}
    house._homepod_alarms("entry1", none)
    assert none == {}


async def test_a_look_before_the_server_s_session_is_a_quiet_miss(hp, caplog):
    """The first look can come before the server's HTTP session exists (a restart logged a KeyError every time)."""
    host, app = hp.host, hp.gw.m.app
    host.get = host._get                       # the real reader client, with no session yet
    http = app._state.pop("http", None) if hasattr(app, "_state") else None
    try:
        with caplog.at_level("ERROR"):
            await look(hp)
        assert host.error == "Mantel is still starting" and host.availability() == "starting"
        assert not [r for r in caplog.records if r.levelname == "ERROR"]
    finally:
        if http is not None:
            app._state["http"] = http


async def test_a_ringing_homepod_timer_is_times_up_with_stop_and_its_helper_left_alone(hp):
    """2026-11-13, the house's kitchen: at 0:00 the Home app showed the timer back at its full length while the HomePod rang,
    and Mantel moved its helper to it. A ringing timer keeps its end; Time's Up says so, silent, and Stop reaches the HomePod."""
    t = hp.reader.timer("Pasta", 5)
    t["id"] = "t-1"
    await look(hp)
    sent = len(hp.gw.fake.frames)
    hp.gw.now[0] += 6
    t.update(ringing=True, left_s=0, rang_at=t["ends_at"])                    # (ends_at: its own, as the reader keeps it)
    hp.house.put("timer.hk_homepod_1", "idle", friendly_name="Pasta")        # Home Assistant finished it on time
    await look(hp, 1)
    await look(hp)
    assert len(hp.gw.fake.frames) == sent                                    # never moved, restarted or deleted while it rings
    a = attrs(hp)
    (ring,) = a["ringing"]
    assert ring["entity_id"] == "timer.hk_homepod_1" and ring["name"] == "Pasta" and ring["source"] == "homepod"
    assert ring["tablet"] is False and ring["speakers"] == [] and ring["controls"] == ["stop"] and ring["room_name"] == "Kitchen"
    assert "timer.hk_homepod_1" in a["made"] and a["homepod"]["timers"]["timer.hk_homepod_1"]["ringing"] is True
    # Stop, as Time's Up sends it: to the HomePod, by the reader's id
    await hp.gw.login("avery", "owner")
    ws = await hp.gw.socket()
    r = await hp.gw.command(ws, kind="service", domain="script", service="quick_timer_ring", data={"op": "stop"}, return_response=True)
    assert r["result"]["response"] == {"ok": True, "timers": ["timer.hk_homepod_1"]}, r
    assert hp.reader.posts[-1] == ("/timer", {"id": "t-1", "action": "stop"})
    r = await hp.gw.command(ws, id=2, kind="service", domain="script", service="quick_timer_ring", data={"op": "more", "entity_id": "timer.hk_homepod_1"},
                            return_response=True)
    assert r["result"]["response"] == {"ok": False, "reason": "homepod"}
    await ws.close()
    hp.reader.timers.clear()                                                 # it stopped: gone from the list
    await look(hp)
    assert hp.house.sent()[-1] == "timer/delete" and hp.host.known == {} and attrs(hp)["ringing"] == []
