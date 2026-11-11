"""Phase 4 ports on Mantel (docs/phase4/MANTEL-FEATURES.md): notification snapshots (taken through Mantel's
own HA credential, kept with retention, served by Mantel with RBAC), the calendars' look-ahead, the tablets'
alerts and scheduled restart (each press a gateway command), and the photo screensaver in screen_report.
A FICTIONAL house and fakes only; house commands are off except where a FakeCommander stands in."""
import asyncio
import os
import re
import stat
from datetime import datetime, timedelta, timezone

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

import gateway_fakes as GF
from mantel_server import features as F
from mantel_server import feature_watch as W
from mantel_server.cameras import notify_snaps as NS
from mantel_server.settings_store import Actor
from test_features import (KIOSK, TABLET, DOOR, AREAS, DEVICES, ENTITIES, change, events, make_env,  # noqa: F401
                           next_event, until)

CAMERA = "camera.doorbell"
JPEG = b"\xff\xd8\xff\xe0fictional-jpeg"
SNAP_ITEM = {"id": "n_door", "entity": DOOR, "when": "on", "title": "", "message": "", "snap": True, "camera": CAMERA}
SNAP_ID = re.compile(r"^[0-9a-f]{32}$")


class Taker:
    def __init__(self, body=JPEG, ctype="image/jpeg"):
        self.body, self.ctype, self.asked = body, ctype, []

    async def __call__(self, camera):
        self.asked.append(camera)
        return (self.body, self.ctype) if self.body else None


# ---------------------------------------------------------------------------------------- snapshots
def test_the_snapshot_store_keeps_them_on_disk_with_retention(tmp_path):
    clock = [1000.0]
    folder = tmp_path / "data" / NS.FOLDER
    st = NS.SnapStore(folder, ttl=600, most=2, clock=lambda: clock[0])
    a = st.put(JPEG, "image/jpeg", CAMERA)
    clock[0] += 1
    b = st.put(b"png", "image/png", "camera.porch")
    clock[0] += 1
    c = st.put(JPEG, "image/jpeg", CAMERA)
    assert SNAP_ID.match(a) and set(st.items) == {b, c}, "at most SNAP_MAX: the oldest went"
    assert not (folder / f"{a}.img").exists() and (folder / f"{c}.img").read_bytes() == JPEG
    assert stat.S_IMODE(os.stat(folder).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(folder / f"{c}.img").st_mode) == 0o600
    assert st.read(c) == JPEG and st.meta(c).camera == CAMERA and st.meta("../etc") is None
    # a restart finds the current ones; what ran out meanwhile is deleted
    clock[0] = 1000 + 601.5
    again = NS.SnapStore(folder, ttl=600, most=2, clock=lambda: clock[0])
    assert set(again.items) == {c} and not (folder / f"{b}.img").exists()
    clock[0] += 10
    assert again.read(c) is None and again.prune() == 1 and not list(folder.iterdir())
    for bad in ((b"x", "text/html", CAMERA), (b"x", "image/jpeg", "light.kitchen"), (b"", "image/jpeg", CAMERA)):
        with pytest.raises(ValueError):
            st.put(*bad)


async def test_a_snapshot_is_taken_through_mantels_own_credential():
    seen = []

    async def proxy(request):
        seen.append((request.path, request.headers.get("Authorization")))
        if request.match_info["camera"] == "camera.broken":
            return web.Response(text="<html>no</html>", content_type="text/html")
        if request.match_info["camera"] == "camera.legacy":
            return web.Response(body=JPEG, content_type="image/jpg")         # HA's demo camera says this
        return web.Response(body=JPEG, content_type="image/jpeg")
    ha = web.Application()
    ha.router.add_get("/api/camera_proxy/{camera}", proxy)
    async with TestServer(ha) as server:
        url = str(server.make_url("")).rstrip("/")
        got = await NS.take_from_ha({}, url, "fictional-mantel-token", CAMERA)
        assert got == (JPEG, "image/jpeg")
        assert await NS.take_from_ha({}, url, "fictional-mantel-token", "camera.broken") is None
        assert await NS.take_from_ha({}, url, "fictional-mantel-token", "../api/states") is None
        assert await NS.take_from_ha({}, url, "fictional-mantel-token", "camera.legacy") == (JPEG, "image/jpeg")
    assert seen == [("/api/camera_proxy/camera.doorbell", "Bearer fictional-mantel-token"),
                    ("/api/camera_proxy/camera.broken", "Bearer fictional-mantel-token"),
                    ("/api/camera_proxy/camera.legacy", "Bearer fictional-mantel-token")]


async def test_a_notification_carries_its_snapshot_served_by_mantel_with_rbac(make_env):
    taker = Taker()
    env = await make_env(settings={"notifications": {"enabled": True, "items": [SNAP_ITEM]}},
                         hooks={"take_snapshot": taker})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    change(env.app, DOOR, "on")
    ev = await next_event(ws)
    assert ev["type"] == "notification" and ev["camera"] == CAMERA and SNAP_ID.match(ev["snap"])
    assert taker.asked == [CAMERA]
    sid = ev["snap"]
    assert (env.app["cfg"].data_dir / NS.FOLDER / f"{sid}.img").read_bytes() == JPEG, "kept in Mantel's data"
    # HK's sign read: Mantel's own route, never HA's (and nothing for an id that isn't one)
    await ws.send_json({"type": "read", "id": 2, "msg": {"type": "hk_notify/snap/sign", "snaps": [sid, "nope"]}})
    assert (await GF.recv(ws))["result"] == {"signed": {sid: f"/api/notify/snap/{sid}"}}
    r = await env.m.get(f"/api/notify/snap/{sid}")
    assert r.status == 200 and await r.read() == JPEG and r.headers["Content-Type"] == "image/jpeg"
    assert r.headers["Cache-Control"].startswith("private") and r.headers["X-Content-Type-Options"] == "nosniff"
    assert (await env.m.get(f"/api/notify/snap/{sid}?x=1")).status == 404
    await ws.send_json({"type": "read", "id": 3, "msg": {"type": "hk_notify/snap/sign", "snaps": [sid], "x": 1}})
    assert (await GF.recv(ws))["error"]["code"] == "not_allowed"
    await ws.close()
    # a Child may not see the camera: nothing signed, and the route answers as for no picture at all
    await env.login("child1", "child")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 4, "msg": {"type": "hk_notify/snap/sign", "snaps": [sid]}})
    assert (await GF.recv(ws))["result"] == {"signed": {}}
    assert (await env.m.get(f"/api/notify/snap/{sid}")).status == 404
    await ws.close()
    env.m.forget_cookies()
    assert (await env.m.get(f"/api/notify/snap/{sid}")).status == 401
    st = env.host.status()
    assert st["snapshots"]["kept"] == 1 and st["notifications"]["delivered"][-1]["snap"] == sid
    assert env.audit() == [], "a snapshot is not a house command"


async def test_a_camera_that_gives_nothing_sends_the_notification_without_one(make_env):
    env = await make_env(settings={"notifications": {"enabled": True, "items": [SNAP_ITEM]}},
                         hooks={"take_snapshot": Taker(body=None)})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    change(env.app, DOOR, "on")
    ev = await next_event(ws)
    assert ev["snap"] is None and ev["camera"] == CAMERA
    assert env.host.snaps.failed == 1
    await ws.close()


def test_snapshots_need_mantels_credential_or_nothing_is_taken():
    host = F.FeatureHost.__new__(F.FeatureHost)
    host.hooks = F.FeatureHooks()
    assert not host.can_snap()
    from mantel_server.connectors import Hooks
    assert F.FeatureHooks.coerce(Hooks(ha_token=lambda: "t")).ha_token() == "t", "the connectors' credential hook"


# ---------------------------------------------------------------------------------------- calendars
CAL = "calendar.family"
NOW = datetime(2026, 10, 18, 14, 0, tzinfo=timezone.utc)


class CalendarProxy:
    def __init__(self, events):
        self.events, self.asked = events, []

    async def get_calendar_events(self, entity_id, start, end):
        self.asked.append((entity_id, start, end))
        return self.events

    async def close(self):
        pass


def test_rest_events_become_get_events_shape():
    assert W.as_get_events({"summary": "Dentist", "start": {"dateTime": "2026-10-18T14:15:00+00:00"},
                            "end": {"dateTime": "2026-10-18T15:00:00+00:00"}, "location": "Main St", "uid": "u1",
                            "rrule": "x"}) == {
        "summary": "Dentist", "start": "2026-10-18T14:15:00+00:00", "end": "2026-10-18T15:00:00+00:00",
        "location": "Main St", "description": "", "uid": "u1"}
    assert W.as_get_events({"summary": "Holiday", "start": {"date": "2026-10-18"}, "end": {"date": "2026-10-19"}})["start"] == "2026-10-18"
    assert W.as_get_events({"summary": "x"}) is None and W.as_get_events("x") is None


async def test_the_calendars_look_ahead_sends_each_event_once(make_env):
    from hk_core.notifications import settings as NSet
    item = {**NSet.new_category("calendars", set()), "id": "n_cal"}
    clock = [NOW]
    env = await make_env(settings={"notifications": {"enabled": True, "items": [item]}},
                         hooks={"now": lambda: clock[0]})
    hub = env.app["hub"]
    hub.store.apply_event({"a": {CAL: {"s": "off", "a": {"friendly_name": "Family"}, "lc": 1.0}}})
    start = (NOW + timedelta(minutes=15)).isoformat()
    hub.readproxy = proxy = CalendarProxy([{"summary": "Dentist", "start": {"dateTime": start},
                                            "end": {"dateTime": (NOW + timedelta(minutes=75)).isoformat()},
                                            "location": "Main St"}])
    assert env.host.calendars.wanted()
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    sent = await env.host.calendars.look()
    assert len(sent) == 1
    ev = await next_event(ws)
    assert ev["kind"] == "calendar" and ev["entity"] == CAL and ev["event"]["summary"] == "Dentist"
    assert "Dentist" in ev["title"] + ev["message"]
    assert proxy.asked and proxy.asked[0][0] == CAL, "the calendar's REST read, by Mantel itself"
    clock[0] = NOW + timedelta(minutes=1)
    assert await env.host.calendars.look() == [], "each event once"
    assert env.host.status()["calendars"]["looks"] == 2 and env.audit() == []
    await ws.close()


async def test_no_calendars_no_look(make_env):
    env = await make_env(settings={"notifications": {"enabled": True, "items": []}})
    env.app["hub"].readproxy = proxy = CalendarProxy([])
    assert not env.host.calendars.wanted() and await env.host.calendars.look() == [] and proxy.asked == []


# ------------------------------------------------------------------------------------------ tablets
ONLINE, BATTERY = "binary_sensor.hall_kiosk_connectivity", "sensor.hall_kiosk_battery"
CLEAR, RESTART = "button.hall_kiosk_clear_cache", "button.hall_kiosk_restart_device"


def kiosk_extras(app, online="on"):
    hub = app["hub"]
    extra = [{"entity_id": e, "device_id": KIOSK, "platform": "kiosk_satellite"} for e in (ONLINE, BATTERY, CLEAR, RESTART)]
    hub.registry.load(AREAS, DEVICES, ENTITIES + extra)
    hub.store.apply_event({"a": {ONLINE: {"s": online, "a": {}, "lc": 1.0}, BATTERY: {"s": "80", "a": {}, "lc": 1.0},
                                 CLEAR: {"s": "unknown", "a": {}, "lc": 1.0},
                                 RESTART: {"s": "unknown", "a": {}, "lc": 1.0}}})


async def test_a_tablet_offline_for_ten_minutes_raises_an_important_banner(make_env):
    clock = [NOW]
    env = await make_env(settings={"tablets": {"enabled": True}}, hooks={"now": lambda: clock[0]})
    kiosk_extras(env.app, online="off")
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    assert env.host.tablet_watch.check() == [], "not yet: ten minutes first"
    clock[0] = NOW + timedelta(minutes=11)
    got = env.host.tablet_watch.check()
    assert [(a.up, a.tablet, a.kind) for a in got] == [(True, "hall", "offline")]
    ev = await next_event(ws)
    assert ev["type"] == "notification" and ev["important"] is True and ev["title"] == "Hall tablet is offline"
    assert env.host.status()["tablets"]["up"][0]["kind"] == "offline"
    env.app["hub"].store.apply_event({"c": {ONLINE: {"+": {"s": "on"}}}})
    clock[0] += timedelta(minutes=1)
    assert [(a.up, a.kind) for a in env.host.tablet_watch.check()] == [(False, "offline")]
    assert env.host.status()["tablets"]["up"] == [] and env.audit() == []
    await ws.close()


async def test_the_tablets_piece_is_off_by_default(make_env):
    env = await make_env()
    kiosk_extras(env.app, online="off")
    assert env.host.tablet_watch.check(NOW + timedelta(hours=1)) == [] and env.host.tablet_watch.grants() == set()
    assert not env.host.tablet_watch.due(NOW)


async def test_the_scheduled_restart_with_commands_off_is_audited_not_sent(make_env):
    clock = [datetime(2026, 10, 18, 3, 0, 5, tzinfo=timezone.utc)]
    env = await make_env(settings={"tablets": {"enabled": True}}, hooks={"now": lambda: clock[0]})
    env.app["settings"].store.write([("house", "settings", {"tablets": {"restart": True, "restart_times": ["03:00"]}})],
                                    actor=Actor(label="test"))
    kiosk_extras(env.app)
    assert env.host.tablet_watch.grants() == {CLEAR, RESTART}
    assert {CLEAR, RESTART} <= env.host.acting_entities(), "the Service actor's grants: exactly the planned buttons"
    assert env.host.tablet_watch.due()
    assert not env.host.tablet_watch.due(), "once a minute"
    await env.host.tablet_watch._task
    rec = env.host.tablet_watch.restarts[-1]
    assert rec["as"] == "service" and rec["presses"] == [{"button": CLEAR, "outcome": "would"},
                                                        {"button": RESTART, "outcome": "would"}]
    rows = env.audit(actor=F.FEATURE_ACTOR)
    assert [(r["action"], r["decision"], r["reason"], r["result"]) for r in rows] == \
        [("button.press", "denied", "commands_disabled", "not_sent")] * 2
    assert env.app["commander"] is None
    clock[0] = datetime(2026, 10, 18, 4, 0, tzinfo=timezone.utc)
    assert not env.host.tablet_watch.due(), "not one of its times"


async def test_restart_all_now_runs_as_the_person_through_the_gateway(make_env, monkeypatch):
    monkeypatch.setattr(W.TabletWatch, "CLEAR_WAIT", 0)
    env = await make_env(commands=True, settings={"tablets": {"enabled": True}})
    kiosk_extras(env.app)
    await env.login("owner1", "owner")
    ws = await env.socket()
    await ws.send_json({"type": "tablets_restart", "id": 1})
    got = await GF.recv(ws)
    assert got["type"] == "tablets_restart_result" and got["result"]["restarted"] == ["hall"]
    assert env.fake.sent == ["button.press", "button.press"]
    assert [f["service_data"]["entity_id"] for f in env.fake.frames] == [CLEAR, RESTART]
    rows = env.audit(action="button.press")
    assert all(r["role"] == "owner" and r["actor"] != F.FEATURE_ACTOR and r["decision"] == "allowed" for r in rows)
    await ws.send_json({"type": "tablets_restart", "id": 2, "tablet": "x"})
    assert (await GF.recv(ws))["error"]["code"] == "invalid"
    await ws.close()
    await env.login("adult1", "adult")
    ws = await env.socket()
    await ws.send_json({"type": "tablets_restart", "id": 3})
    assert (await GF.recv(ws))["error"]["code"] == "forbidden", "HA: admin only"
    await ws.close()
    assert len(env.fake.sent) == 2


async def test_restart_all_now_with_the_piece_off(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "tablets_restart", "id": 1})
    assert (await GF.recv(ws))["error"]["code"] == "not_set_up"
    await ws.close()


# ------------------------------------------------------------------------------- the photo screensaver
async def test_screen_report_carries_the_photo_screensaver(make_env):
    env = await make_env(settings={"linked": {"enabled": True, "entry_id": "e2e0entry0id"}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    await ws.send_json({"type": "screen_report", "id": 2, "tablet": "hall", "photos": True})
    frames, m = [], None
    while m is None or not frames:                     # the answer and the frame, in whichever order
        got = await GF.recv(ws)
        if got.get("type") == "screen_result":
            m = got
        else:
            frames.append(got["event"])
    assert m["result"] == {"changed": True} and env.host.screens["hall"].photos is True
    assert frames == [{"type": "screen", "tablet": "hall", "photos": True, "dashboards": [], "users": []}]
    own = env.host.own_ids("hall")["photos"]
    assert env.host.own_house.state(own).state == "on", "what the Sleep Screen reads"
    await ws.send_json({"type": "screen_report", "id": 3, "tablet": "hall", "photos": True})
    assert (await GF.recv(ws))["result"] == {"changed": False}
    await ws.send_json({"type": "screen_report", "id": 4, "tablet": "hall", "photos": "yes"})
    assert (await GF.recv(ws))["error"]["code"] == "invalid"
    assert env.audit() == []
    await ws.close()
