"""Notifications, a feature of HK Frontend: what sets one off (rules.py), the
HK Settings page's checks (settings_ws.py), the house watching the chosen
accessories and sending each notification once -- the snapshot taken first,
Not Again For kept, Only When honored -- the screens woken for an Important
one, and the screens' own settings (settings.py notify, notify_saver,
notify_dnd)."""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from conftest import add_feature, entry as house_entry, feature_entries

from custom_components.hk_frontend import rename, settings as S, settings_api as A, sleep_rules as R
from custom_components.hk_frontend.const import SIGNAL_POPUP
from custom_components.hk_frontend.features.notifications import rules, snaps as SN
from custom_components.hk_frontend.features.notifications.const import DEFAULTS


# ------------------------------------------------------------------ rules
def test_kinds_from_what_the_accessory_is():
    assert rules.kind_of("binary_sensor", "motion") == "motion"
    assert rules.kind_of("binary_sensor", None, "front_door_camera_person_detected") == "person"
    assert rules.kind_of("binary_sensor", "occupancy", "front_door_camera_doorbell") == "doorbell"
    assert rules.kind_of("binary_sensor", "moisture") == "leak"
    assert rules.kind_of("binary_sensor", "garage_door") == "door"
    assert rules.kind_of("event", "doorbell", "front_door_camera_doorbell") == "doorbell"
    assert rules.kind_of("event", None, "front_door_camera_package") == "package"
    assert rules.kind_of("person", None) == "people"
    assert rules.kind_of("cover", "garage") == "garage"
    assert rules.kind_of("cover", "shade") == "cover"
    assert rules.kind_of("lock", None) == "lock"
    assert rules.kind_of("input_boolean", None) == "switch"
    assert rules.kind_of("sensor", "temperature") == "state"
    assert [c[0] for c in rules.choices("people")] == ["home", "not_home", "any"]


def st(s, **a):
    return (s, a)


def test_what_sets_one_off():
    f = rules.fires
    assert f("motion", "on", st("off"), st("on"))
    assert not f("motion", "on", st("on"), st("off"))
    assert f("motion", "off", st("on"), st("off"))
    # a start, a device dropping out and coming back: never
    assert not f("motion", "on", None, st("on"))
    assert not f("motion", "on", st("unavailable"), st("on"))
    assert not f("motion", "on", st("unknown"), st("on"))
    assert not f("motion", "on", st("off"), st("unavailable"))
    assert f("door", "any", st("off"), st("on")) and f("door", "any", st("on"), st("off"))
    # a person: arriving, leaving (another zone is still away)
    assert f("people", "home", st("not_home"), st("home"))
    assert f("people", "not_home", st("home"), st("Work"))
    assert not f("people", "not_home", st("Work"), st("not_home"))
    assert not f("people", "home", st("unknown"), st("home"))
    # a garage door: opening is when it opens, once
    assert f("garage", "open", st("closed"), st("opening"))
    assert not f("garage", "open", st("opening"), st("open"))
    assert f("garage", "closed", st("closing"), st("closed"))
    assert f("lock", "unlocked", st("locked"), st("unlocked"))
    assert f("lock", "unlocked", st("locked"), st("open"))
    assert not f("lock", "unlocked", st("unlocked"), st("locked"))
    assert not f("lock", "unlocked", st("open"), st("unlocked")), "open -> unlocked is one Unlocks"
    assert not f("lock", "any", st("open"), st("unlocked"))
    assert f("lock", "jammed", st("locking"), st("jammed"))
    # an event entity: a new time is an event; a restore or a return is not
    assert f("doorbell", "on", st("2026-10-11T20:00:00"), st("2026-10-11T20:05:00"), event=True)
    assert f("doorbell", "on", st("unknown"), st("2026-10-11T20:05:00"), event=True)
    assert not f("doorbell", "on", None, st("2026-10-11T20:05:00"), event=True)
    assert not f("doorbell", "on", st("unavailable"), st("2026-10-11T20:05:00"), event=True)
    assert f("timer", "finished", st("active"), st("idle"))
    assert not f("timer", "finished", st("paused"), st("idle"))
    assert f("alarm_panel", "armed", st("disarmed"), st("armed_away"))
    assert not f("alarm_panel", "armed", st("armed_home"), st("armed_away"))


def test_its_words_and_buttons():
    assert rules.words("people", "home", "Anna Parker", st("home")) == ("Anna arrived", "Anna is home.")
    assert rules.words("people", "any", "Anna Parker", st("not_home")) == ("Anna left", "Anna left home.")
    assert rules.words("door", "any", "Pantry Door", st("off")) == ("Pantry Door", "Closed.")
    assert rules.words("garage", "open", "Garage Door", st("opening")) == ("Garage Door", "Opened.")
    assert rules.words("lock", "unlocked", "Front Door", st("unlocked"))[1] == "Unlocked."
    assert [b["id"] for b in rules.buttons("garage", st("open"), "camera.garage")] == ["close", "camera"]
    assert [b["id"] for b in rules.buttons("lock", st("unlocked"), None)] == ["lock"]
    assert rules.buttons("motion", st("on"), None) == []
    assert rules.look("garage", st("closed"))[0] == "hk:garage"


def test_snapshots_expire_and_the_oldest_go_first():
    s = SN.Snaps()
    a = s.put(b"a", "image/jpeg", now=0)
    assert s.get(a, now=1) == (b"a", "image/jpeg")
    assert s.get(a, now=10_000) is None
    ids = [s.put(b"x", "image/jpeg", now=i) for i in range(40)]
    assert len(s.items) <= 30 and ids[-1] in s.items and ids[0] not in s.items


# -------------------------------------------------------- screen settings
def test_a_screens_own_settings():
    b = S.board({})
    assert b["notify"] is True and b["notify_saver"] is None and b["notify_dnd"] is None
    b = S.board({"notify": False, "notify_saver": "off",
                 "notify_dnd": {"schedule": True, "from": "21:30", "to": "6:15", "while": ["input_boolean.quiet", "bad id"]}})
    assert b["notify"] is False and b["notify_saver"] == "off"
    assert b["notify_dnd"] == {"schedule": True, "from": "21:30", "to": "06:15", "while": ["input_boolean.quiet"]}
    assert S.board({"notify_saver": "loud"})["notify_saver"] is None
    out, err = A.apply_board({}, {"notify_dnd": {"schedule": True, "from": "25:00"}})
    assert err == {"notify_dnd": "time"}
    out, err = A.apply_board({}, {"notify_dnd": {"while": ["timer.nap"]}, "notify_saver": None})
    assert not err and out["notify_dnd"]["while"] == ["timer.nap"] and out["notify_saver"] is None
    out, err = A.apply_board({}, {"notify_dnd": None})
    assert not err and out["notify_dnd"] is None


def test_a_notification_wakes_the_screen_even_in_quiet_hours():
    facts = {"quiet": True, "present": True, "in_use": False, "lit": True, "notice": "Water Leak"}
    assert R.decide(facts) == ("photos", "notification: Water Leak")       # up to its screensaver
    assert R.decide({**facts, "notice": ""})[0] == "dark"


def test_a_rename_follows_into_a_screens_own_do_not_disturb():
    data = {"notify_dnd": {"schedule": False, "from": "22:00", "to": "07:00", "while": ["input_boolean.old", "timer.x"]}}
    out, paths = rename.rewrite_fields(data, rename.BOARD_KEYS, "input_boolean.old", "input_boolean.new")
    assert paths == ["notify_dnd"] and out["notify_dnd"]["while"] == ["input_boolean.new", "timer.x"]
    assert data["notify_dnd"]["while"][0] == "input_boolean.old"       # the stored copy untouched


def test_a_rename_follows_into_the_notifications():
    stored = {"kind": "notifications", "data": {}, "options": {
        "items": [{"id": "a", "entity": "binary_sensor.old", "camera": "camera.c", "title": "binary_sensor.old?"}],
        "dnd": {"schedule": False, "while": ["input_boolean.old"]}}}
    from custom_components.hk_frontend.features import notifications
    out, paths = rename.rewrite_feature(stored, notifications.RENAME, "binary_sensor.old", "binary_sensor.new")
    assert out["options"]["items"][0]["entity"] == "binary_sensor.new"
    assert out["options"]["items"][0]["title"] == "binary_sensor.old?"     # only an exact value
    assert paths == ["items"]
    out, _ = rename.rewrite_feature(stored, notifications.RENAME, "input_boolean.old", "input_boolean.new")
    assert out["options"]["dnd"]["while"] == ["input_boolean.new"]


def test_a_rename_follows_into_the_cameras_pairs():
    pairs = [{"camera": "camera.porch", "trigger": "binary_sensor.porch_person", "view": "camera.porch"},
             {"camera": "camera.yard", "trigger": "binary_sensor.yard_motion", "view": "camera.porch"}]
    stored = {"kind": "notifications", "data": {}, "options": {
        "items": [{"id": "c", "category": "cameras", "exclude": ["camera.yard"], "pairs": pairs}]}}
    from custom_components.hk_frontend.features import notifications
    out, paths = rename.rewrite_feature(stored, notifications.RENAME, "camera.porch", "camera.front")
    item = out["options"]["items"][0]
    assert paths == ["items"]
    assert item["pairs"][0] == {"camera": "camera.front", "trigger": "binary_sensor.porch_person", "view": "camera.front"}
    assert item["pairs"][1]["view"] == "camera.front" and item["pairs"][1]["camera"] == "camera.yard"
    out, _ = rename.rewrite_feature(stored, notifications.RENAME, "binary_sensor.yard_motion", "binary_sensor.yard_person")
    assert out["options"]["items"][0]["pairs"][1]["trigger"] == "binary_sensor.yard_person"
    out, _ = rename.rewrite_feature(stored, notifications.RENAME, "camera.yard", "camera.garden")
    assert out["options"]["items"][0]["exclude"] == ["camera.garden"]
    assert out["options"]["items"][0]["pairs"][1]["camera"] == "camera.garden"
    assert stored["options"]["items"][0]["pairs"][0]["camera"] == "camera.porch"   # the stored copy untouched
    # nothing of its: untouched
    assert rename.rewrite_feature(stored, notifications.RENAME, "camera.other", "camera.new")[1] == []


# ---------------------------------------------------------------- the house
class Conn:
    def __init__(self, user):
        self.user, self.sent = user, []

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "success": False, "error": code, "message": message})


async def _call(hass, conn, handler, **msg):
    handler(hass, conn, {"id": len(conn.sent) + 1, "type": "x", **msg})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


@pytest.fixture
async def notify(hass: HomeAssistant, frontend):
    """Notifications added, a camera with its own person sensor (one device),
    a garage door, a person, the doorbell."""
    r = await add_feature(hass, "notifications", {})
    assert r["type"] == "create_entry", r
    ent = house_entry(hass)
    dev = dr.async_get(hass).async_get_or_create(config_entry_id=ent.entry_id, identifiers={("x", "cam")},
                                                 name="Front Door Camera")
    reg = er.async_get(hass)
    for domain, oid in (("camera", "front_door_camera_low_resolution_channel"),
                        ("camera", "front_door_camera_high_resolution_channel"),
                        ("binary_sensor", "front_door_camera_person_detected")):
        reg.async_get_or_create(domain, "x", oid, suggested_object_id=oid, device_id=dev.id)
    hass.states.async_set("binary_sensor.front_door_camera_person_detected", "off",
                          {"friendly_name": "Front Door Camera Person detected"})
    hass.states.async_set("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"})
    hass.states.async_set("person.anna", "home", {"friendly_name": "Anna Parker"})
    hass.states.async_set("event.front_door_camera_doorbell", "unknown",
                          {"device_class": "doorbell", "friendly_name": "Front Door Camera Doorbell"})
    hass.states.async_set("binary_sensor.leak", "off", {"device_class": "moisture", "friendly_name": "Sink Leak"})
    await hass.async_block_till_done()
    return feature_entries(hass, "notifications")[0]


@pytest.fixture
async def admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


def _sent(hass):
    # an HA callback runs in the loop as the signal goes out; a plain function
    # would be an executor job, and could land after blocking=True returns
    got = []

    @callback
    def _got(payload):
        got.append(payload)
    async_dispatcher_connect(hass, SIGNAL_POPUP, _got)
    return got


async def test_added_once_with_nothing_to_ask(hass, notify):
    assert dict(notify.options) == {**DEFAULTS, "items": [], "taps_v": 2, "wake_v": 1}     # a new one needs nothing moved
    flows = hass.config_entries.subentries
    r = await flows.async_init((house_entry(hass).entry_id, "feature"), context={"source": "user"})
    assert "notifications" not in r["menu_options"]        # one per house
    flows.async_abort(r["flow_id"])


async def test_a_new_one_starts_from_what_the_accessory_suggests(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.front_door_camera_person_detected"})
    assert r["success"], r
    it = r["result"]["items"][0]
    assert it["kind"] == "person" and it["name"] == "Front Door Camera" and it["when"] == "on"
    assert it["snap"] is True and it["camera"] == "camera.front_door_camera_high_resolution_channel"
    assert it["cooldown"] == 60 and it["tap"] == "camera" and it["auto_message"] == "Person detected."
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "event.front_door_camera_doorbell"})
    assert r["result"]["items"][1]["pop"] == "doorbell"
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.leak"})
    assert r["result"]["items"][2]["important"] is True


async def test_its_checks_refuse_by_field(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "cover.garage_door"})
    iid = r["result"]["saved"]
    bad = await _call(hass, admin, W.ws_item_save, item=iid, changes={"when": "on", "stay": 7, "camera": "light.x"})
    assert not bad["success"] and json.loads(bad["message"]) == {"stay": "choice", "camera": "entity"}
    bad = await _call(hass, admin, W.ws_item_save, item=iid, changes={"when": "on"})
    assert json.loads(bad["message"]) == {"when": "choice"}       # a garage door opens or closes
    ok = await _call(hass, admin, W.ws_item_save, item=iid, changes={"when": "closed", "stay": 0, "wake": True})
    it = ok["result"]["items"][0]
    assert it["when"] == "closed" and it["stay"] == 0 and it["wake"] is True    # any one can wake the screen (2026-10-12)
    # Live Camera with the snapshot off: the accessory's sheet
    r2 = await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.front_door_camera_person_detected"})
    cam = r2["result"]["saved"]
    off = await _call(hass, admin, W.ws_item_save, item=cam, changes={"snap": False})
    assert [i for i in off["result"]["items"] if i["id"] == cam][0]["tap"] == "sheet"
    await _call(hass, admin, W.ws_item_remove, item=cam)
    bad = await _call(hass, admin, W.ws_settings_set, changes={"dnd": {"schedule": True, "from": "9pm"}})
    assert json.loads(bad["message"]) == {"dnd": "time"}
    ok = await _call(hass, admin, W.ws_settings_set, changes={"stay": 60, "saver": "all",
                                                             "dnd": {"schedule": True, "from": "22:30", "to": "06:00",
                                                                     "while": ["input_boolean.movie"]}})
    o = ok["result"]["options"]
    assert o["stay"] == 60 and o["saver"] == "all" and o["dnd"]["while"] == ["input_boolean.movie"]
    gone = await _call(hass, admin, W.ws_item_remove, item=iid)
    assert gone["result"]["items"] == []


async def test_a_wall_tablet_cannot_change_them(hass, notify):
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    await hass.auth.async_create_user("Owner")      # the first user owns the house
    tablet = Conn(await hass.auth.async_create_user("Kitchen"))
    with pytest.raises(Unauthorized):
        W.ws_item_save(hass, tablet, {"id": 1, "type": "x", "changes": {"entity": "cover.garage_door"}})


async def test_it_goes_off_once_with_its_snapshot(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    from homeassistant.components.camera import Image
    await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.front_door_camera_person_detected"})
    got = _sent(hass)
    with patch("homeassistant.components.camera.async_get_image", return_value=Image("image/jpeg", b"jpeg")) as take:
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "on",
                              {"friendly_name": "Front Door Camera Person detected"})
        await hass.async_block_till_done(wait_background_tasks=True)
        # Not Again For (1 minute): off and on again sends nothing
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "off")
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "on")
        await hass.async_block_till_done(wait_background_tasks=True)
    assert len(got) == 1 and take.call_count == 1
    p = got[0]
    assert p["type"] == "notification" and p["title"] == "Front Door Camera" and p["message"] == "Person detected."
    assert p["icon"] == "hk:walk" and p["camera"] == "camera.front_door_camera_high_resolution_channel"
    assert p["snap"] and p["stay"] == 30 and p["saver"] == "important" and p["tap"] == "camera"
    from custom_components.hk_frontend.features.notifications import _data
    assert _data(hass)["snaps"].get(p["snap"]) == (b"jpeg", "image/jpeg")


async def test_a_camera_that_gives_nothing_sends_it_without(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.front_door_camera_person_detected"})
    got = _sent(hass)
    with patch("homeassistant.components.camera.async_get_image", side_effect=Exception("offline")):
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "on")
        await hass.async_block_till_done(wait_background_tasks=True)
    assert len(got) == 1 and got[0]["snap"] is None


async def test_only_when_and_a_typed_title(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "cover.garage_door"})
    iid = r["result"]["saved"]
    await _call(hass, admin, W.ws_item_save, item=iid, changes={"only": "night", "title": "Garage", "snap": False,
                                                                "message": "Somebody opened it."})
    got = _sent(hass)
    hass.states.async_set("sun.sun", "above_horizon")
    hass.states.async_set("cover.garage_door", "opening", {"device_class": "garage", "friendly_name": "Garage Door"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert got == []
    hass.states.async_set("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"})
    hass.states.async_set("sun.sun", "below_horizon")
    hass.states.async_set("cover.garage_door", "opening", {"device_class": "garage", "friendly_name": "Garage Door"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(got) == 1
    assert got[0]["title"] == "Garage" and got[0]["message"] == "Somebody opened it."
    assert [b["id"] for b in got[0]["buttons"]] == ["close"]


async def test_an_important_one_wakes_the_screens_that_allow_it(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.leak"})
    iid = r["result"]["saved"]
    await _call(hass, admin, W.ws_item_save, item=iid, changes={"wake": True, "stay": 0})

    class Eng:
        def __init__(self, acting):
            self.acting, self.woken = acting, []

        def notify_wake(self, title, secs):
            self.woken.append((title, secs))

    engs = {"dashboard-kitchen": Eng(True), "dashboard-car": Eng(True), "dashboard-hall": Eng(False)}
    mgr = type("M", (), {"engines": engs,
                         "board": lambda self, p: {"notify": p != "dashboard-car"}})()
    got = _sent(hass)
    with patch("custom_components.hk_frontend.screensaver.manager", return_value=mgr):
        hass.states.async_set("binary_sensor.leak", "on", {"device_class": "moisture", "friendly_name": "Sink Leak"})
        await hass.async_block_till_done(wait_background_tasks=True)
    assert got[0]["important"] and got[0]["wake"] and got[0]["stay"] == 0
    assert engs["dashboard-kitchen"].woken == [("Sink Leak", 300)]
    assert engs["dashboard-car"].woken == [] and engs["dashboard-hall"].woken == []


async def test_a_test_sends_it_now(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "person.anna"})
    iid = r["result"]["saved"]
    got = _sent(hass)
    W.ws_test(hass, admin, {"id": 99, "type": "x", "item": iid})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(got) == 1 and got[0]["test"] is True
    assert got[0]["title"] == "Anna arrived" and got[0]["initials"] == "AP"


# ------------------------------------------------------------- categories
def test_a_vacuum_finishing():
    f = rules.fires
    assert f("vacuum", "done", st("returning"), st("docked"))
    assert f("vacuum", "done", st("cleaning"), st("docked"))
    assert not f("vacuum", "done", st("idle"), st("docked"))
    assert f("vacuum", "error", st("cleaning"), st("error"))
    assert f("vacuum", "cleaning", st("docked"), st("cleaning")) and not f("vacuum", "cleaning", st("paused"), st("cleaning"))
    assert rules.words("vacuum", "done", "Office Vacuum", st("docked")) == ("Office Vacuum", "Finished cleaning.")
    assert rules.category_of("vacuum") == "vacuums" and rules.category_of("camera") == "cameras" and rules.category_of("person") is None


async def test_a_category_finds_its_accessories(hass, notify):
    from custom_components.hk_frontend.features.notifications import candidates
    reg = er.async_get(hass)
    reg.async_get_or_create("binary_sensor", "x", "car_door", suggested_object_id="car_door",
                            original_device_class="door", hidden_by=er.RegistryEntryHider.USER)
    hass.states.async_set("binary_sensor.car_door", "off", {"device_class": "door"})
    hass.states.async_set("binary_sensor.back_door", "off", {"device_class": "door", "friendly_name": "Back Door"})
    hass.states.async_set("binary_sensor.window_a", "off", {"device_class": "window"})
    assert candidates(hass, "doors") == ["binary_sensor.back_door"]          # hidden: not
    assert candidates(hass, "windows") == ["binary_sensor.window_a"]
    # a camera's channels are one camera: its best is its live view
    assert candidates(hass, "cameras") == ["camera.front_door_camera_high_resolution_channel"]
    assert candidates(hass, "garage") == ["cover.garage_door"]
    assert candidates(hass, "nope") == []


async def test_a_category_on_notifies_each_with_its_own_camera(hass, notify, admin):
    from homeassistant.components.camera import Image
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    hass.states.async_set("binary_sensor.back_door", "off", {"device_class": "door", "friendly_name": "Back Door"})
    hass.states.async_set("binary_sensor.closet", "off", {"device_class": "door", "friendly_name": "Closet Door"})
    page = await _call(hass, admin, W.ws_settings_get)
    cats = {c["key"]: c for c in page["result"]["categories"]}
    assert set(cats) >= {"doors", "cameras", "garage", "people", "leaks", "doorbells"} and "windows" not in cats
    assert [a["name"] for a in cats["doors"]["accessories"]] == ["Back Door", "Closet Door"]
    r = await _call(hass, admin, W.ws_item_save, changes={"category": "doors"})
    assert r["success"], r
    doors = r["result"]["saved"]
    again = await _call(hass, admin, W.ws_item_save, changes={"category": "doors"})
    assert json.loads(again["message"]) == {"category": "choice"}             # one each
    bad = await _call(hass, admin, W.ws_item_save, item=doors, changes={"entity": "binary_sensor.closet"})
    assert json.loads(bad["message"]) == {"entity": "unknown"}
    await _call(hass, admin, W.ws_item_save, item=doors, changes={"exclude": ["binary_sensor.closet"]})
    r = await _call(hass, admin, W.ws_item_save, changes={"category": "cameras"})
    it = [i for i in r["result"]["items"] if i["category"] == "cameras"][0]
    cam = [c for c in r["result"]["categories"] if c["key"] == "cameras"][0]["accessories"][0]
    assert cam["entity"] == "camera.front_door_camera_high_resolution_channel" and cam["on"] is True
    assert cam["trigger"] == "binary_sensor.front_door_camera_person_detected" and cam["trigger_name"] == "Front Door Camera"
    assert cam["suggested_kind"] == "person"                    # the page's words: "its own person detection"
    assert it["snap"] is True and it["camera"] is None and it["cooldown"] == 300 and it["auto_title"] == "Each one’s name"
    got = _sent(hass)
    with patch("homeassistant.components.camera.async_get_image", return_value=Image("image/jpeg", b"j")) as take:
        hass.states.async_set("binary_sensor.back_door", "on", {"device_class": "door", "friendly_name": "Back Door"})
        hass.states.async_set("binary_sensor.closet", "on", {"device_class": "door", "friendly_name": "Closet Door"})
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "on",
                              {"friendly_name": "Front Door Camera Person detected"})
        await hass.async_block_till_done(wait_background_tasks=True)
    assert [(p["title"], p["message"]) for p in got] == [("Back Door", "Opened."), ("Front Door Camera", "Person detected.")]
    assert got[0]["snap"] is None and got[1]["camera"] == "camera.front_door_camera_high_resolution_channel"
    assert take.call_count == 1
    # a door added later is found (the registry's change, once after it)
    hass.states.async_set("binary_sensor.side_door", "off", {"device_class": "door", "friendly_name": "Side Door"})
    er.async_get(hass).async_get_or_create("binary_sensor", "x", "side", suggested_object_id="side_door")
    await hass.async_block_till_done()
    from custom_components.hk_frontend.features import notifications as NF
    await notify.runtime_data._refresh()
    hass.states.async_set("binary_sensor.side_door", "on", {"device_class": "door", "friendly_name": "Side Door"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert got[-1]["title"] == "Side Door"
    # its test: one of its accessories
    W.ws_test(hass, admin, {"id": 77, "type": "x", "item": doors})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert got[-1]["test"] is True and got[-1]["entity"] in ("binary_sensor.back_door", "binary_sensor.side_door")
    # Not Again For is each accessory's own
    seen = [i for i in (await _call(hass, admin, W.ws_settings_get))["result"]["items"] if i["category"] == "cameras"][0]
    assert seen["cooldown"] == 300
    off = await _call(hass, admin, W.ws_item_remove, item=doors)
    assert all(i["category"] != "doors" for i in off["result"]["items"])
    assert any(c["key"] == "doors" and c["item"] is None for c in off["result"]["categories"])


async def test_a_camera_with_the_trigger_and_live_view_chosen(hass, notify, admin):
    from homeassistant.components.camera import Image
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"category": "cameras"})
    cid = r["result"]["saved"]
    hass.states.async_set("binary_sensor.porch_motion", "off", {"device_class": "motion", "friendly_name": "Porch Motion"})
    bad = await _call(hass, admin, W.ws_item_save, item=cid, changes={"pairs": [{"camera": "camera.front_door_camera_high_resolution_channel",
                                                                                   "trigger": "light.porch"}]})
    assert json.loads(bad["message"]) == {"pairs": "entity"}
    ok = await _call(hass, admin, W.ws_item_save, item=cid, changes={"pairs": [{"camera": "camera.front_door_camera_high_resolution_channel",
                                                                                  "trigger": "binary_sensor.porch_motion",
                                                                                  "view": "camera.front_door_camera_low_resolution_channel"}]})
    cam = [c for c in ok["result"]["categories"] if c["key"] == "cameras"][0]["accessories"][0]
    assert cam["trigger"] == "binary_sensor.porch_motion" and cam["view"] == "camera.front_door_camera_low_resolution_channel"
    got = _sent(hass)
    with patch("homeassistant.components.camera.async_get_image", return_value=Image("image/jpeg", b"j")):
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "on")     # not its trigger now
        hass.states.async_set("binary_sensor.porch_motion", "on", {"device_class": "motion", "friendly_name": "Porch Motion"})
        await hass.async_block_till_done(wait_background_tasks=True)
    assert [(p["title"], p["message"], p["camera"]) for p in got] == [
        ("Front Door Camera", "Motion detected.", "camera.front_door_camera_low_resolution_channel")]
    # left out: nothing
    await _call(hass, admin, W.ws_item_save, item=cid, changes={"exclude": ["camera.front_door_camera_high_resolution_channel"]})
    hass.states.async_set("binary_sensor.porch_motion", "off")
    hass.states.async_set("binary_sensor.porch_motion", "on")
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(got) == 1
    # pairs only on a Cameras category
    r2 = await _call(hass, admin, W.ws_item_save, changes={"category": "doors"})
    bad = await _call(hass, admin, W.ws_item_save, item=r2["result"]["saved"], changes={"pairs": []})
    assert json.loads(bad["message"]) == {"pairs": "unknown"}


# ------------------------------------------------------------- the action
async def test_the_action_sends_an_automations_own(hass, notify):
    """hk_frontend.notify: the same payload, channel and snapshot as an
    item's, to the screens and people it names."""
    from homeassistant.components.camera import Image
    from custom_components.hk_frontend.const import DOMAIN
    got = _sent(hass)
    with patch("homeassistant.components.camera.async_get_image", return_value=Image("image/jpeg", b"j")) as take:
        res = await hass.services.async_call(DOMAIN, "notify", {
            "title": "  Laundry ", "message": "The washer is done.", "icon": "mdi:washing-machine",
            "camera": "camera.front_door_camera_high_resolution_channel",
            "dashboards": ["/dashboard-kitchen/0", "dashboard-hall"], "users": "u1"},
            blocking=True, return_response=True)
    assert len(got) == 1 and take.call_count == 1
    p = got[0]
    assert res == {"id": p["id"], "snap": True}
    assert p["type"] == "notification" and p["item"] is None and p["test"] is False
    assert (p["title"], p["message"], p["icon"]) == ("Laundry", "The washer is done.", "mdi:washing-machine")
    assert p["dashboards"] == ["dashboard-kitchen", "dashboard-hall"] and p["users"] == ["u1"]
    assert p["camera"] == "camera.front_door_camera_high_resolution_channel" and p["snap"] and p["tap"] == "camera"
    assert [b["id"] for b in p["buttons"]] == ["camera"]
    # All Screens' own: Stays On Screen, the screensaver, the chime, Do Not Disturb
    assert p["stay"] == 30 and p["saver"] == "important" and p["chime"] is True and p["dnd"] == DEFAULTS["dnd"]
    assert p["important"] is False and p["wake"] is False


async def test_the_action_on_an_accessory_and_one_that_wakes(hass, notify):
    from custom_components.hk_frontend.const import DOMAIN
    hass.states.async_set("cover.garage_door", "open", {"device_class": "garage", "friendly_name": "Garage Door"})
    got = _sent(hass)
    woken = []
    with patch("custom_components.hk_frontend.features.notifications.wake_screens",
               side_effect=lambda h, t, s, imp=True, dnd=None: woken.append((t, s, imp)) or []):
        await hass.services.async_call(DOMAIN, "notify", {"title": "Garage open", "entity": "cover.garage_door",
                                                          "wake": True, "stay": 0}, blocking=True)
    p = got[0]
    assert p["dashboards"] == [] and p["users"] == []                  # every screen, anyone
    assert p["entity"] == "cover.garage_door" and p["kind"] == "garage" and p["icon"] == "hk:garage-open"
    assert [b["id"] for b in p["buttons"]] == ["close"] and p["tap"] == "sheet" and p["camera"] is None
    assert p["important"] is False and p["wake"] is True and p["stay"] == 0      # waking no longer makes it Important
    assert woken == [("Garage open", 300, False)]
    # nothing to open: a tap does nothing
    await hass.services.async_call(DOMAIN, "notify", {"title": "Hi", "tap": "camera"}, blocking=True)
    assert got[-1]["tap"] == "none" and got[-1]["icon"] == "hk:bell" and got[-1]["message"] == ""


async def test_the_action_checks_what_it_is_given(hass, notify):
    import voluptuous as vol
    from custom_components.hk_frontend.const import DOMAIN
    got = _sent(hass)
    for bad in ({}, {"title": ""}, {"title": "x" * 41}, {"title": "a", "message": "m" * 121},
                {"title": "a", "icon": "washing-machine"}, {"title": "a", "camera": "light.porch"},
                {"title": "a", "stay": -1}, {"title": "a", "stay": 3601}, {"title": "a", "tap": "web"}, {"title": "a", "page": "Not A Path!"},
                {"title": "a", "entity": "not an id"}, {"title": "a", "extra": 1}):
        with pytest.raises(vol.Invalid):
            await hass.services.async_call(DOMAIN, "notify", bad, blocking=True)
    assert got == []


async def test_the_action_needs_notifications_added(hass, frontend):
    from homeassistant.exceptions import ServiceValidationError
    from custom_components.hk_frontend.const import DOMAIN
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "notify", {"title": "Hi"}, blocking=True)


async def test_wakes_the_screen_for_all_and_dnd_wins(hass, notify, admin):
    """All Notifications' Wakes the Screen, a notification's own over it, and
    Do Not Disturb holding back one that isn't Important (a screen's own DND
    first, else All Screens')."""
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "cover.garage_door"})
    gid = r["result"]["saved"]
    assert [i for i in r["result"]["items"] if i["id"] == gid][0]["wake"] is None       # follows All Notifications
    await _call(hass, admin, W.ws_item_save, item=gid, changes={"snap": False})
    r = await _call(hass, admin, W.ws_settings_set, changes={"wake": True})
    assert r["result"]["options"]["wake"] is True

    class Eng:
        def __init__(self):
            self.acting, self.woken = True, []

        def notify_wake(self, title, secs):
            self.woken.append(title)

    engs = {"dashboard-kitchen": Eng(), "dashboard-bedroom": Eng()}
    boards = {"dashboard-kitchen": {}, "dashboard-bedroom": {"notify_dnd": {"schedule": False, "while": ["input_boolean.nap"]}}}
    mgr = type("M", (), {"engines": engs, "board": lambda self, p: boards[p]})()
    hass.states.async_set("input_boolean.nap", "on")
    got = _sent(hass)
    with patch("custom_components.hk_frontend.screensaver.manager", return_value=mgr):
        hass.states.async_set("cover.garage_door", "opening", {"device_class": "garage", "friendly_name": "Garage Door"})
        await hass.async_block_till_done(wait_background_tasks=True)
        assert got[-1]["wake"] is True and got[-1]["important"] is False
        assert engs["dashboard-kitchen"].woken == ["Garage Door"] and engs["dashboard-bedroom"].woken == []   # its nap
        # its own Off over All Notifications' On
        await _call(hass, admin, W.ws_item_save, item=gid, changes={"wake": False})
        hass.states.async_set("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"})
        hass.states.async_set("cover.garage_door", "opening", {"device_class": "garage", "friendly_name": "Garage Door"})
        await hass.async_block_till_done(wait_background_tasks=True)
        assert got[-1]["wake"] is False and engs["dashboard-kitchen"].woken == ["Garage Door"]
        # Important: through Do Not Disturb
        await _call(hass, admin, W.ws_item_save, item=gid, changes={"wake": None, "important": True})
        hass.states.async_set("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"})
        hass.states.async_set("cover.garage_door", "opening", {"device_class": "garage", "friendly_name": "Garage Door"})
        await hass.async_block_till_done(wait_background_tasks=True)
        assert engs["dashboard-bedroom"].woken == ["Garage Door"]


def test_do_not_disturb_the_same_rule_as_the_screens(hass):
    from datetime import datetime
    from custom_components.hk_frontend.features.notifications import dnd_on
    from homeassistant.util import dt as dt_util
    at = lambda h, m=0: dt_util.as_utc(datetime(2026, 10, 12, h, m, tzinfo=dt_util.get_default_time_zone()))  # noqa: E731
    d = {"schedule": True, "from": "22:00", "to": "07:00", "while": []}
    assert dnd_on(hass, d, at(23)) and dnd_on(hass, d, at(6, 59)) and not dnd_on(hass, d, at(7))
    assert dnd_on(hass, {**d, "from": "09:00", "to": "09:00"}, at(3))           # all day
    assert not dnd_on(hass, None) and not dnd_on(hass, {**d, "schedule": False}, at(23))
    hass.states.async_set("timer.night_timer", "active")
    assert dnd_on(hass, {**d, "schedule": False, "while": ["timer.night_timer"]}, at(12))


# ---------------------------------------------------------------- calendars
def test_an_events_words():
    from datetime import datetime
    assert rules.calendar_words("Dentist", datetime(2026, 10, 12, 10, 30), datetime(2026, 10, 12, 11, 0), 15, "Main St") == \
        ("Dentist", "In 15 minutes · 10:30 – 11:00 AM · Main St")
    assert rules.calendar_words("Lunch", datetime(2026, 10, 12, 11, 30), datetime(2026, 10, 12, 13, 0), 0) == \
        ("Lunch", "Starting now · 11:30 AM – 1:00 PM")
    assert rules.calendar_words("Call", datetime(2026, 10, 12, 9, 0), None, 60) == ("Call", "In 1 hour · 9:00 AM")
    assert [c[0] for c in rules.choices("calendar")] == ["0", "5", "10", "15", "30", "60"]


async def test_a_calendar_event_coming_up(hass, notify, admin):
    from datetime import timedelta
    from homeassistant.core import SupportsResponse
    from homeassistant.util import dt as dt_util
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    now = dt_util.now().replace(second=0, microsecond=0)
    start = now + timedelta(minutes=15)
    events = {
        "calendar.family": [{"summary": "Soccer", "start": start.isoformat(), "end": (start + timedelta(hours=1)).isoformat(),
                             "location": "City Park"},
                            {"summary": "Halloween", "start": start.date().isoformat(), "end": start.date().isoformat()}],
        "calendar.work": [{"summary": "Standup", "start": start.isoformat(), "end": (start + timedelta(minutes=15)).isoformat()}],
    }
    asked = []

    async def get_events(call):
        asked.append(sorted(call.data["entity_id"]))
        a, b = dt_util.parse_datetime(call.data["start_date_time"]), dt_util.parse_datetime(call.data["end_date_time"])
        # (an all-day event, a date: always in the answer, as a real calendar's is that day)
        return {e: {"events": [ev for ev in events.get(e, []) if "T" not in ev["start"]
                               or a <= dt_util.parse_datetime(ev["start"]) <= b]}
                for e in call.data["entity_id"]}
    hass.services.async_register("calendar", "get_events", get_events, supports_response=SupportsResponse.ONLY)
    for e in ("calendar.family", "calendar.work"):
        hass.states.async_set(e, "off", {"friendly_name": e.split(".")[1].title()})
    r = await _call(hass, admin, W.ws_item_save, changes={"category": "calendars"})
    cid = r["result"]["saved"]
    it = [i for i in r["result"]["items"] if i["id"] == cid][0]
    assert it["when"] == "15" and it["auto_title"] == "The event’s name"
    assert {a["entity"] for a in [c for c in r["result"]["categories"] if c["key"] == "calendars"][0]["accessories"]} \
        == {"calendar.family", "calendar.work"}
    await _call(hass, admin, W.ws_item_save, item=cid, changes={"exclude": ["calendar.work"]})
    got = _sent(hass)
    w = notify.runtime_data.calendars
    sent = await w._tick(dt_util.as_utc(now) + timedelta(seconds=5))     # start - 15 min has just passed
    await hass.async_block_till_done()
    assert asked[-1] == ["calendar.family"]                                 # Work left out
    assert [(p["title"], p["message"]) for p in got] == [("Soccer", "In 15 minutes · %s · City Park" % rules.calendar_words(
        "", start, start + timedelta(hours=1), 15)[1].split(" · ")[1])]
    assert got[0]["icon"] == "mdi:calendar" and got[0]["tap"] == "sheet" and len(sent) == 1
    # the event rides along, so a tap opens it (HK's event sheet), and its
    # Mute is that calendar's
    assert got[0]["event"]["cal"] == "calendar.family" and got[0]["event"]["summary"] == "Soccer"
    assert got[0]["mute"].endswith(":calendar.family")
    again = await w._tick(dt_util.as_utc(now) + timedelta(seconds=65))      # once
    assert again == [] and len(got) == 1
    # its test: the next event, as it will look
    W.ws_test(hass, admin, {"id": 90, "type": "x", "item": cid})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert got[-1]["test"] is True and got[-1]["title"] == "Soccer"


async def test_an_all_day_event_the_morning_it_starts(hass, notify, admin):
    from datetime import timedelta
    from homeassistant.core import SupportsResponse
    from homeassistant.util import dt as dt_util
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    eight = dt_util.now().replace(hour=8, minute=0, second=0, microsecond=0)
    today, tomorrow = eight.date().isoformat(), (eight.date() + timedelta(days=1)).isoformat()
    events = {"calendar.family": [{"summary": "Grandma's Birthday", "start": today, "end": tomorrow},
                                  {"summary": "Vacation", "start": (eight.date() - timedelta(days=1)).isoformat(), "end": tomorrow},
                                  {"summary": "Soccer", "start": (eight + timedelta(hours=9)).isoformat(),
                                   "end": (eight + timedelta(hours=10)).isoformat()}]}

    async def get_events(call):
        return {e: {"events": list(events.get(e, []))} for e in call.data["entity_id"]}
    hass.services.async_register("calendar", "get_events", get_events, supports_response=SupportsResponse.ONLY)
    hass.states.async_set("calendar.family", "off", {"friendly_name": "Family"})
    r = await _call(hass, admin, W.ws_item_save, changes={"category": "calendars"})
    cid = r["result"]["saved"]
    assert [i for i in r["result"]["items"] if i["id"] == cid][0]["allday"] == "08:00"
    bad = await _call(hass, admin, W.ws_item_save, item=cid, changes={"allday": "08:15"})
    assert json.loads(bad["message"]) == {"allday": "choice"}
    got = _sent(hass)
    w = notify.runtime_data.calendars
    await w._tick(dt_util.as_utc(eight) - timedelta(seconds=55))               # 7:59
    assert got == []
    await w._tick(dt_util.as_utc(eight) + timedelta(seconds=5))                # 8:00 has just passed
    await hass.async_block_till_done()
    assert [(p["title"], p["message"]) for p in got] == [("Grandma's Birthday", "Today · All Day")]   # not the one begun yesterday
    await w._tick(dt_util.as_utc(eight) + timedelta(seconds=65))
    assert len(got) == 1                                                        # once
    # Off: none
    await _call(hass, admin, W.ws_item_save, item=cid, changes={"allday": None})
    w._sent.clear()
    w._last = dt_util.as_utc(eight) - timedelta(seconds=55)
    await w._tick(dt_util.as_utc(eight) + timedelta(seconds=5))
    assert len(got) == 1
    # and only on a Calendars category
    r2 = await _call(hass, admin, W.ws_item_save, changes={"category": "doors"})
    bad = await _call(hass, admin, W.ws_item_save, item=r2["result"]["saved"], changes={"allday": "08:00"})
    assert json.loads(bad["message"]) == {"allday": "unknown"}


# ------------------------------------------------- a tap opens its sheet (2026-10-12)
async def test_the_sheet_a_tap_opens_and_its_mute(hass, notify, admin):
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    from homeassistant.components.camera import Image
    r = await _call(hass, admin, W.ws_item_save, changes={"entity": "cover.garage_door"})
    gid = r["result"]["saved"]
    await _call(hass, admin, W.ws_item_save, changes={"entity": "binary_sensor.front_door_camera_person_detected"})
    got = _sent(hass)
    with patch("homeassistant.components.camera.async_get_image", return_value=Image("image/jpeg", b"jpeg")):
        hass.states.async_set("cover.garage_door", "open", {"device_class": "garage", "friendly_name": "Garage Door"})
        hass.states.async_set("binary_sensor.front_door_camera_person_detected", "on",
                              {"friendly_name": "Front Door Camera Person detected"})
        await hass.async_block_till_done(wait_background_tasks=True)
    garage = [p for p in got if p["entity"] == "cover.garage_door"][0]
    person = [p for p in got if p["entity"] != "cover.garage_door"][0]
    # its sheet: the garage door's own; a person at the door: the camera's, live
    assert garage["tap"] == "sheet" and garage["sheet"] == "cover.garage_door" and garage["go"] is None
    assert person["sheet"] == "camera.front_door_camera_high_resolution_channel"
    # Mute 1 Hour: that notification's accessory, by its key
    assert garage["mute"] == "%s:cover.garage_door" % gid
    tablet = Conn(await hass.auth.async_create_user("Kitchen"))        # anyone signed in may mute
    m = await _call(hass, tablet, W.ws_mute, key=garage["mute"], minutes=60)
    assert m["success"] and m["result"]["until"] > 0
    page = (await _call(hass, admin, W.ws_settings_get))["result"]
    muted = [i for i in page["items"] if i["id"] == gid][0]["muted"]
    assert [x["entity"] for x in muted] == ["cover.garage_door"] and muted[0]["name"] == "Garage Door"
    got.clear()
    hass.states.async_set("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"})
    hass.states.async_set("cover.garage_door", "open", {"device_class": "garage", "friendly_name": "Garage Door"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert got == []                                                     # muted: nothing
    # ...an hour on, it goes off again
    from custom_components.hk_frontend.features.notifications import muted as is_muted
    import time as _t
    assert is_muted(hass, garage["mute"]) and not is_muted(hass, garage["mute"], now=_t.time() + 3601)
    # unmuted by hand (HK Settings' Unmute): it goes off
    assert (await _call(hass, tablet, W.ws_mute, key=garage["mute"], minutes=0))["result"]["until"] is None
    hass.states.async_set("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"})
    hass.states.async_set("cover.garage_door", "open", {"device_class": "garage", "friendly_name": "Garage Door"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(got) == 1
    # only a notification that exists can be muted
    bad = await _call(hass, tablet, W.ws_mute, key="nope:cover.garage_door")
    assert not bad["success"] and bad["error"] == "not_found"


async def test_tap_opens_a_page_and_go_to(hass, notify, admin):
    from custom_components.hk_frontend.features import notifications as N
    from custom_components.hk_frontend.features.notifications import settings_ws as W
    iid = (await _call(hass, admin, W.ws_item_save, changes={"entity": "cover.garage_door"}))["result"]["saved"]
    bad = await _call(hass, admin, W.ws_item_save, item=iid, changes={"tap": "page"})
    assert json.loads(bad["message"]) == {"page": "required"}
    bad = await _call(hass, admin, W.ws_item_save, item=iid, changes={"tap": "page", "page": "Kitchen Page!"})
    assert json.loads(bad["message"]) == {"page": "choice"}
    ok = await _call(hass, admin, W.ws_item_save, item=iid, changes={"tap": "page", "page": "/room-kitchen/"})
    it = [i for i in ok["result"]["items"] if i["id"] == iid][0]
    assert it["tap"] == "page" and it["page"] == "room-kitchen"
    p = N.build(hass, N.options(notify), {**it}, None, test=True)
    assert p["tap"] == "page" and p["page"] == "room-kitchen"
    # Go To: Automatic (None), None, or a page
    ok = await _call(hass, admin, W.ws_item_save, item=iid, changes={"tap": "sheet", "go": "none"})
    assert [i for i in ok["result"]["items"] if i["id"] == iid][0]["go"] == "none"
    ok = await _call(hass, admin, W.ws_item_save, item=iid, changes={"go": "auto"})
    assert [i for i in ok["result"]["items"] if i["id"] == iid][0]["go"] is None
    # the action: tap page -- a page named opens it, and is its Go To
    a = N.build_action(hass, N.options(notify), {"title": "Dinner's ready", "page": "room-kitchen"})
    assert a["tap"] == "page" and a["page"] == "room-kitchen" and a["go"] == "room-kitchen" and a["mute"] is None


def test_tap_opens_moves_to_its_new_meaning():
    from custom_components.hk_frontend.features.notifications import migrate_taps
    old = {"stay": 30, "items": [
        {"id": "a", "category": "garage", "tap": "camera"},       # its snapshot opened the camera -> its sheet
        {"id": "b", "entity": "binary_sensor.washer", "tap": "none"},
        {"id": "c", "category": "calendars", "tap": "none"},
        {"id": "d", "category": "cameras", "tap": "camera"},      # what a camera sees: still the camera
        {"id": "e", "category": "doors", "tap": "sheet"}]}
    new = migrate_taps(old)
    assert [i["tap"] for i in new["items"]] == ["sheet", "sheet", "sheet", "camera", "sheet"]
    assert new["taps_v"] == 2 and new["stay"] == 30
    assert migrate_taps(new) is None                                # once


async def test_wake_false_from_1_7_0_follows_all_notifications(hass, notify):
    # 1.7.0 saved wake False on every notification: after the migration it
    # follows All Notifications' Wakes the Screen; a True was chosen and stays
    from custom_components.hk_frontend.features import notifications as N
    old = {"stay": 30, "taps_v": 2, "items": [
        {"id": "a", "entity": "cover.garage_door", "wake": False},
        {"id": "b", "entity": "cover.garage_door", "wake": True},
        {"id": "c", "entity": "cover.garage_door"}]}
    new = N.migrate_wake(old)
    assert "wake" not in new["items"][0] and new["items"][1]["wake"] is True and "wake" not in new["items"][2]
    assert new["wake_v"] == 1 and new["stay"] == 30 and new["taps_v"] == 2
    assert old["items"][0]["wake"] is False                         # the stored options untouched
    assert N.migrate_wake(new) is None                              # once
    for house in (True, False):
        opts = {**N.options(notify), "wake": house}
        a, b = (N.build(hass, opts, {**new["items"][i]}, None, test=True) for i in (0, 1))
        assert a["wake"] is house and b["wake"] is True
