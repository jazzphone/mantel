"""hk_core.notifications against a fake House: the notification rules run once here, for every host.

The HA build runs the same code through hosts/ha's HaHouse (tests/py/test_feature_notifications.py
and test_feature_alarm_pin.py), with HA's state machine, registries and clock behind it. Nothing
here sends anything: delivery is a list the test reads.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from hk_core.house import Device, Entity, State
from hk_core.notifications import accessories as A, banner as B, calendars as C, dnd as D, migrate as M
from hk_core.notifications import rules, settings as P
from hk_core.notifications.const import DEFAULTS, OWN_PLATFORM

TZ = ZoneInfo("America/New_York")


class FakeHouse:
    def __init__(self, states=(), entities=(), devices=(), areas=None, now=None):
        self._states = {s.entity_id: s for s in states}
        self._entities = {e.entity_id: e for e in entities}
        self._devices = {d.id: d for d in devices}
        self._areas = dict(areas or {})
        self.now = now or datetime(2026, 10, 12, 12, 0, tzinfo=TZ)

    def set(self, entity_id, state, **attrs):
        self._states[entity_id] = State(entity_id, state, attrs)

    def state(self, entity_id):
        return self._states.get(entity_id)

    def states(self, domain=None):
        return [s for s in self._states.values() if domain is None or s.domain == domain]

    def entity(self, entity_id):
        return self._entities.get(entity_id)

    def entities(self, domain=None):
        return [e for e in self._entities.values() if domain is None or e.domain == domain]

    def device(self, device_id):
        return self._devices.get(device_id)

    def device_entities(self, device_id):
        return [e for e in self._entities.values() if e.device_id == device_id]

    def area_ids(self):
        return set(self._areas)

    def area_name(self, area_id):
        return self._areas.get(area_id)

    def local_time(self, when=None):
        when = when or self.now
        return (when.replace(tzinfo=TZ) if when.tzinfo is None else when).astimezone(TZ)

    async def call_service(self, *a, **kw):
        raise AssertionError("the notification rules never call a service")


def house():
    """A camera device (two channels, its person sensor), a garage door, a person, a leak
    sensor, a hidden door, a diagnostic one, a YAML door, an alarm and HK's PIN panel for it."""
    return FakeHouse(
        states=[State("binary_sensor.porch_person_detected", "off", {"friendly_name": "Porch Camera Person detected"}),
                State("camera.porch_high_resolution_channel", "idle", {"friendly_name": "Porch Camera High"}),
                State("camera.porch_low_resolution_channel", "idle", {}),
                State("cover.garage_door", "closed", {"device_class": "garage", "friendly_name": "Garage Door"}),
                State("person.anna", "home", {"friendly_name": "Anna Parker", "entity_picture": "/a.jpg"}),
                State("binary_sensor.leak", "off", {"device_class": "moisture", "friendly_name": "Sink Leak"}),
                State("binary_sensor.front_door", "off", {"device_class": "door", "friendly_name": "Front Door"}),
                State("binary_sensor.hidden_door", "off", {"device_class": "door"}),
                State("binary_sensor.door_diag", "off", {"device_class": "door"}),
                State("binary_sensor.yaml_door", "off", {"device_class": "door"}),
                State("alarm_control_panel.house", "disarmed", {"friendly_name": "House Alarm"}),
                State("alarm_control_panel.house_pin", "disarmed", {"friendly_name": "House Alarm PIN"}),
                State("calendar.family", "off", {"friendly_name": "Family"}),
                State("sun.sun", "above_horizon", {}),
                State("zone.home", "1", {})],
        entities=[Entity("binary_sensor.porch_person_detected", device_id="cam"),
                  Entity("camera.porch_high_resolution_channel", device_id="cam"),
                  Entity("camera.porch_low_resolution_channel", device_id="cam"),
                  Entity("camera.porch_off", device_id="cam", disabled=True),
                  Entity("cover.garage_door", area_id="garage"),
                  Entity("person.anna"),
                  Entity("binary_sensor.leak", area_id="kitchen"),
                  Entity("binary_sensor.front_door", device_id="door"),
                  Entity("binary_sensor.hidden_door", hidden=True),
                  Entity("binary_sensor.door_diag", entity_category="diagnostic"),
                  Entity("binary_sensor.door_unseen", original_device_class="door"),     # no state yet
                  Entity("alarm_control_panel.house"),
                  Entity("alarm_control_panel.house_pin", platform=OWN_PLATFORM),
                  Entity("camera.live_tv_channel", platform=OWN_PLATFORM),
                  Entity("calendar.family")],
        devices=[Device("cam", name="Porch Camera"), Device("door", area_id="hall", name="Door Sensor")],
        areas={"garage": "Garage", "kitchen": "Kitchen", "hall": "Hall"})


PINS = lambda: {"alarm_control_panel.house_pin": "alarm_control_panel.house"}  # noqa: E731


# ------------------------------------------------------------- what it watches
def test_an_accessory_named_after_its_device_and_its_best_camera():
    h = house()
    assert A.name_of(h, "binary_sensor.porch_person_detected") == "Porch Camera"
    assert A.name_of(h, "cover.garage_door") == "Garage Door"
    assert A.name_of(h, "light.no_state") == "No State"
    assert A.camera_for(h, "binary_sensor.porch_person_detected") == "camera.porch_high_resolution_channel"
    assert A.camera_list(h) == ["camera.porch_high_resolution_channel"]          # one per device, not HK's own
    assert A.trigger_for(h, "camera.porch_high_resolution_channel") == "binary_sensor.porch_person_detected"
    d = A.describe(h, "binary_sensor.porch_person_detected")
    assert (d["kind"], d["when"], d["camera"], d["message"]) == ("person", "on", "camera.porch_high_resolution_channel",
                                                                 "Person detected.")
    assert A.describe(h, "binary_sensor.leak")["important"] is True


def test_a_category_finds_what_the_house_shows():
    h = house()
    # not hidden, not a diagnostic; a YAML door (no registry entry) and one with no state yet
    assert A.candidates(h, "doors") == ["binary_sensor.door_unseen", "binary_sensor.front_door", "binary_sensor.yaml_door"]
    # HK's own entities are left out -- except an Alarm PIN panel, beside its alarm
    assert A.candidates(h, "alarms") == ["alarm_control_panel.house"]
    assert A.candidates(h, "alarms", PINS) == ["alarm_control_panel.house", "alarm_control_panel.house_pin"]
    # both ticked: one alarm is watched; a tap opens the keypad
    assert A.members(h, {"category": "alarms"}, PINS) == ["alarm_control_panel.house"]
    assert A.members(h, {"category": "alarms", "exclude": ["alarm_control_panel.house"]}, PINS) == \
        ["alarm_control_panel.house_pin"]
    assert A.keypad_for("alarm_control_panel.house", PINS) == "alarm_control_panel.house_pin"
    assert A.keypad_for("cover.garage_door", PINS) == "cover.garage_door"
    pairs = A.camera_pairs(h, {"category": "cameras", "exclude": []})
    assert pairs == [{"camera": "camera.porch_high_resolution_channel", "view": "camera.porch_high_resolution_channel",
                      "trigger": "binary_sensor.porch_person_detected",
                      "suggested": "binary_sensor.porch_person_detected", "on": True}]
    assert A.members(h, {"category": "cameras", "exclude": ["camera.porch_high_resolution_channel"]}) == []


# ------------------------------------------------------------- when it goes off
def test_it_goes_off_once_when_it_may():
    h = house()
    items = [{"id": "g", "entity": "cover.garage_door", "when": "open", "only": "night", "cooldown": 60}]
    watched = {"g": {"cover.garage_door"}}
    last, mute = {}, {}

    def change(old, new, now):
        h.set("cover.garage_door", new, device_class="garage")
        return B.goes_off(h, items, watched, "cover.garage_door", State("cover.garage_door", old, {}),
                          h.state("cover.garage_door"), last=last, mute=mute, now=now, epoch=1000.0)

    assert change("closed", "opening", 0) == []                    # Only When: night, and it is day
    h.set("sun.sun", "below_horizon")
    assert change("closed", "opening", 1) == items
    assert change("closed", "opening", 30) == []                   # Not Again For (1 minute)
    assert change("opening", "open", 100) == []                    # not an opening
    B.set_mute(mute, B.mute_key(items[0], "cover.garage_door"), 3600, now=900.0)
    assert change("closed", "opening", 200) == []                  # Mute 1 Hour
    assert B.mutes(mute, now=5000.0) == {} and change("closed", "opening", 300) == items   # run out
    assert B.goes_off(h, items, {}, "cover.garage_door", None, None, last=last, mute=mute) == []    # not watched


def test_only_when_and_do_not_disturb():
    h = house()
    assert B.only_ok(h, "home") and not B.only_ok(h, "away")
    h.set("zone.home", "not a number")
    assert B.only_ok(h, "away")                                    # not known: not held back
    d = {"schedule": True, "from": "22:00", "to": "07:00", "while": []}
    at = lambda hh, mm=0: datetime(2026, 10, 12, hh, mm, tzinfo=TZ).astimezone(timezone.utc)  # noqa: E731
    assert D.dnd_on(h, d, at(23)) and D.dnd_on(h, d, at(6, 59)) and not D.dnd_on(h, d, at(7))
    assert D.dnd_on(h, {**d, "from": "09:00", "to": "09:00"}, at(3))
    assert not D.dnd_on(h, None) and not D.dnd_on(h, {**d, "schedule": False}, at(23))
    h.set("timer.nap", "active")
    assert D.dnd_on(h, {**d, "schedule": False, "while": ["timer.nap"]}, at(12))
    assert D.notify_dnd({"schedule": True, "from": "6:5", "while": ["bad id", "timer.nap"]}) == \
        {"schedule": True, "from": "06:05", "to": "07:00", "while": ["timer.nap"]}


# ------------------------------------------------------------- the payload
def test_what_goes_to_the_screens():
    h = house()
    opts = B.options({"items": [], "stay": 60})
    item = {"id": "p", "entity": "binary_sensor.porch_person_detected", "snap": True, "tap": "camera",
            "camera": "camera.porch_high_resolution_channel"}
    h.set("binary_sensor.porch_person_detected", "on", friendly_name="Porch Camera Person detected")
    p = B.build(h, opts, item, h.state("binary_sensor.porch_person_detected"))
    assert (p["title"], p["message"], p["icon"]) == ("Porch Camera", "Person detected.", "hk:walk")
    assert p["camera"] == "camera.porch_high_resolution_channel" and p["tap"] == "camera" and p["stay"] == 60
    assert p["sheet"] == "camera.porch_high_resolution_channel" and p["mute"] == "p:binary_sensor.porch_person_detected"
    assert p["wake"] is False and p["dnd"] == DEFAULTS["dnd"] and p["snap"] is None
    # the Cameras category's: its own camera's snapshot, live view and name
    c = B.build(h, opts, {"id": "k", "category": "cameras", "snap": True, "tap": "camera"},
                h.state("binary_sensor.porch_person_detected"), eid="binary_sensor.porch_person_detected")
    assert (c["camera"], c["sheet"], c["title"]) == ("camera.porch_high_resolution_channel",
                                                     "camera.porch_high_resolution_channel", "Porch Camera")
    # Live Camera with no snapshot: the accessory's sheet
    assert B.build(h, opts, {**item, "snap": False}, None)["tap"] == "sheet"
    # a person's: arriving, with their picture and initials (a test reads as it will look)
    a = B.build(h, opts, {"id": "a", "entity": "person.anna", "when": "home"}, h.state("person.anna"), test=True)
    assert (a["title"], a["initials"], a["picture"]) == ("Anna arrived", "AP", "/a.jpg")
    # an alarm with a PIN panel in front of it: a tap opens the keypad
    al = B.build(h, opts, {"id": "x", "entity": "alarm_control_panel.house", "when": "triggered"}, None, test=True, pins=PINS)
    assert al["sheet"] == "alarm_control_panel.house_pin"


def test_an_automations_own():
    h = house()
    opts = B.options({})
    p = B.build_action(h, opts, {"title": "Garage open", "entity": "cover.garage_door", "wake": True, "stay": 0,
                                 "dashboards": ["/dashboard-kitchen/0", " "], "users": [" u1 ", ""]})
    assert (p["kind"], p["icon"], p["tap"], p["stay"]) == ("garage", "hk:garage", "sheet", 0)
    assert p["dashboards"] == ["dashboard-kitchen"] and p["users"] == ["u1"] and p["mute"] is None
    assert [b["id"] for b in p["buttons"]] == ["open"]
    bare = B.build_action(h, opts, {"title": "Hi", "tap": "camera"})
    assert bare["tap"] == "none" and bare["icon"] == "hk:bell" and bare["stay"] == 30
    assert B.wake_for(0) == 300 and B.wake_for(10) == 60 and B.wake_for(120) == 120


# ------------------------------------------------------------- calendars
def test_a_calendar_looks_ahead_and_sends_each_once():
    h = house()
    now = datetime(2026, 10, 12, 9, 45, 5, tzinfo=TZ).astimezone(timezone.utc)
    start = datetime(2026, 10, 12, 10, 0, tzinfo=TZ)
    evs = {"calendar.family": [
        {"summary": "Soccer", "start": start.isoformat(), "end": (start + timedelta(hours=1)).isoformat(), "location": "Park"},
        {"summary": "Later", "start": (start + timedelta(hours=3)).isoformat()},
        {"summary": "Halloween", "start": "2026-10-12", "end": "2026-10-13"}]}
    asked, sent_out = [], []

    async def events(cals, a, b):
        asked.append((list(cals), a, b))
        return {c: list(evs.get(c, [])) for c in cals}

    async def deliver(p):
        sent_out.append(p)
        return p

    items = [{"id": "c", "category": "calendars", "when": "15", "allday": "08:00", "exclude": []}]
    opts = lambda: B.options({"items": items})  # noqa: E731
    sent = {}
    got = asyncio.run(C.look_ahead(h, None, now, sent, opts=opts, events=events, deliver=deliver, mute={}))
    assert [(p["title"], p["message"]) for p in got] == [("Soccer", "In 15 minutes · 10:00 – 11:00 AM · Park")]
    assert got[0]["event"]["cal"] == "calendar.family" and got[0]["mute"] == "c:calendar.family"
    assert asked[0][0] == ["calendar.family"]
    again = asyncio.run(C.look_ahead(h, now - timedelta(seconds=60), now, sent, opts=opts, events=events,
                                     deliver=deliver, mute={}))
    assert again == [] and len(sent_out) == 1                       # once
    # all day: the morning it starts, at 8:00
    eight = datetime(2026, 10, 12, 8, 0, 5, tzinfo=TZ).astimezone(timezone.utc)
    got = asyncio.run(C.look_ahead(h, eight - timedelta(seconds=60), eight, sent, opts=opts, events=events,
                                   deliver=deliver, mute={}))
    assert [(p["title"], p["message"]) for p in got] == [("Halloween", "Today · All Day")]
    # muted: nothing
    muted = asyncio.run(C.look_ahead(h, eight - timedelta(seconds=60), eight, {}, opts=opts, events=events,
                                     deliver=deliver, mute={"c:calendar.family": 1e12}))
    assert muted == []
    # its test: the next timed event, as it will look
    p = asyncio.run(C.sample(h, items[0], ["calendar.family"], now, opts=opts, events=events))
    assert p["test"] is True and p["title"] == "Soccer"
    assert C.event_time(h, "2026-10-12") is None and C.event_time(h, "nonsense T") is None


# ------------------------------------------------------------- stored, and the page
def test_old_options_move_forward_once():
    old = {"items": [{"id": "a", "tap": "none", "wake": False}, {"id": "b", "category": "cameras", "tap": "camera",
                                                                 "wake": True}]}
    new = M.migrate(old)
    assert new["items"] == [{"id": "a", "tap": "sheet"}, {"id": "b", "category": "cameras", "tap": "camera", "wake": True}]
    assert new["taps_v"] == 2 and new["wake_v"] == 1 and M.migrate(new) is None


def test_the_settings_page_and_its_checks():
    h = house()
    it = P.new_item(h, "binary_sensor.porch_person_detected", set())
    assert (it["when"], it["snap"], it["camera"], it["cooldown"], it["tap"]) == \
        ("on", True, "camera.porch_high_resolution_channel", 60, "camera")
    g = P.new_item(h, "cover.garage_door", {it["id"]})
    out, err = P.apply_item(h, g, {"when": "on", "stay": 7, "camera": "light.x"})
    assert out is g and err == {"stay": "choice", "camera": "entity"}
    assert P.apply_item(h, g, {"when": "on"})[1] == {"when": "choice"}           # a garage door opens or closes
    ok, err = P.apply_item(h, g, {"when": "closed", "stay": 0, "tap": "page", "page": "/Room-Kitchen/"})
    assert not err and ok["page"] == "room-kitchen" and ok["stay"] == 0
    assert P.apply_item(h, g, {"tap": "page"})[1] == {"page": "required"}
    cat = P.new_category("doors", set())
    assert P.apply_item(h, cat, {"entity": "binary_sensor.x"})[1] == {"entity": "unknown"}
    assert P.apply_item(h, cat, {"allday": "08:00"})[1] == {"allday": "unknown"}
    o, err = P.apply_house(dict(DEFAULTS), {"dnd": {"schedule": True, "from": "9pm"}})
    assert err == {"dnd": "time"} and o == DEFAULTS
    o, err = P.apply_house(dict(DEFAULTS), {"stay": 60, "dnd": {"while": ["input_boolean.movie"]}})
    assert not err and o["stay"] == 60 and o["dnd"]["while"] == ["input_boolean.movie"]
    page = P.page(h, B.options({"items": [ok, cat]}), {"%s:cover.garage_door" % ok["id"]: 99.0}, "loaded", PINS)
    assert page["state"] == "loaded" and [i["kind"] for i in page["items"]] == ["garage", "door"]
    assert page["items"][0]["muted"] == [{"key": "%s:cover.garage_door" % ok["id"], "entity": "cover.garage_door",
                                          "name": "Garage Door", "until": 99.0}]
    cats = {c["key"]: c for c in page["categories"]}
    assert cats["doors"]["item"] == cat["id"]
    assert [(a["entity"], a["area"]) for a in cats["doors"]["accessories"]][0] == ("binary_sensor.door_unseen", "")
    assert ("binary_sensor.front_door", "Hall") in [(a["entity"], a["area"]) for a in cats["doors"]["accessories"]]
    alarm = {a["entity"]: a for a in cats["alarms"]["accessories"]}
    assert alarm["alarm_control_panel.house_pin"]["note"].endswith("with a PIN · made by HK’s Alarm PIN")
    assert alarm["alarm_control_panel.house"]["note"] == "Opens House Alarm PIN to disarm"
    assert cats["cameras"]["accessories"][0]["suggested_kind"] == "person"


def test_the_rules_are_the_ones_the_host_re_exports():
    # (a smoke check that the moved module is whole: the HA feature imports it unchanged)
    assert rules.fires("garage", "open", ("closed", {}), ("opening", {}))
    assert rules.category_of("leak") == "leaks"


def test_a_vacuum_starting_is_not_finished():
    """Starting, a robot reports cleaning for ~2 s, then docked while it washes its mop: no Finishes Cleaning."""
    from datetime import datetime, timedelta, timezone
    h = house()
    items = [{"id": "v", "entity": "vacuum.office_vacuum", "when": "done"}]
    watched = {"v": {"vacuum.office_vacuum"}}
    t = datetime(2026, 11, 3, 12, 30, tzinfo=timezone.utc)

    def change(old, new, held):
        return B.goes_off(h, items, watched, "vacuum.office_vacuum",
                          State("vacuum.office_vacuum", old, {}, t),
                          State("vacuum.office_vacuum", new, {}, t + timedelta(seconds=held)),
                          last={}, mute={}, now=0, epoch=1000.0)

    assert change("cleaning", "docked", 2) == []
    assert change("returning", "docked", 75) == items
