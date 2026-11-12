"""hk_core.tablets against a fake House: the wall tablets' decisions run once here, for every host.

The HA build runs the same code through hosts/ha's HaHouse (tests/py/test_tablets.py, and Setup
Check's and the settings page's tests), with HA's registries and states behind it. Nothing here
sends anything: the fake House refuses every service call; the alerts and the restart answer
what to raise and press, and the host does it.
"""
from datetime import datetime, timedelta, timezone

import pytest

from hk_core.house import Device, Entity, State
from hk_core.tablets import alerts as A, kiosk as K, setup as SC, suggestions as SG

NOW = datetime(2026, 10, 18, 3, 0, tzinfo=timezone.utc)
DEV, FULLY_DEV, LAMP_DEV = "a" * 32, "b" * 32, "c" * 32
KS = {"battery": "sensor.loft_kiosk_battery", "charging": "binary_sensor.loft_kiosk_charging",
      "online": "binary_sensor.loft_kiosk_connectivity", "seen": "sensor.loft_kiosk_last_seen",
      "app": "sensor.loft_kiosk_foreground_app", "active": "switch.loft_kiosk_screensaver_active",
      "adaptive": "switch.loft_kiosk_adaptive_brightness", "saver_mode": "select.loft_kiosk_screensaver_mode",
      "saver_timeout": "number.loft_kiosk_screensaver_timeout", "kiosk_mode": "switch.loft_kiosk_kiosk_mode",
      "page": "sensor.loft_kiosk_current_page", "ip": "sensor.loft_kiosk_ipv4_address",
      "clear_cache": "button.loft_kiosk_clear_cache", "restart_device": "button.loft_kiosk_restart_device",
      "update": "update.loft_kiosk_update"}
GOOD = {"battery": "80", "charging": "on", "online": "on", "seen": NOW.isoformat(),
        "app": K.KS_PACKAGE, "active": "off", "adaptive": "off", "saver_mode": "Black",
        "saver_timeout": "86400", "kiosk_mode": "on", "page": "https://x/dashboard-loft/0",
        "ip": "192.0.2.7", "clear_cache": "unknown", "restart_device": "unknown", "update": "off"}


class FakeHouse:
    """States and registries -- and no way to change anything."""

    def __init__(self):
        self._states, self._entities, self._devices = {}, {}, {}

    def set(self, entity_id, state):
        self._states[entity_id] = State(entity_id, state, {})

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
        return set()

    def area_name(self, area_id):
        return None

    def area_floor(self, area_id):
        return None

    def local_time(self, when=None):
        raise AssertionError("the tablets' rules are handed the time")

    async def call_service(self, *a, **kw):
        raise AssertionError("the tablets' rules never call a service")


def kiosk(house, **states):
    """A Kiosk Satellite on the loft's tablet: its device, its entities, their states."""
    house._devices[DEV] = Device(DEV, None, "Loft Kiosk")
    for role, eid in KS.items():
        house._entities[eid] = Entity(eid, device_id=DEV, platform="kiosk_satellite")
        house.set(eid, {**GOOD, **states}[role])
    return house


def tablet(**more):
    t = {"name": "Loft", "screen": "dashboard-loft", "app": "kiosk_satellite", "device": DEV, "user": "loft"}
    t.update(more)
    return t


@pytest.fixture
def house():
    return kiosk(FakeHouse())


# ------------------------------------------------------------- its kiosk app
def test_a_kiosk_satellites_parts_are_found_by_role(house):
    p = K.parts(house, "kiosk_satellite", DEV)
    assert p["battery"] == KS["battery"] and p["restart_device"] == KS["restart_device"]
    assert "screen" not in p and "restart_app" not in p, "only what the device has"
    assert K.parts(house, "browser", DEV) == {} and K.parts(house, "kiosk_satellite", "") == {}


def test_the_shortest_enabled_entity_takes_a_role(house):
    longer = "sensor.loft_kiosk_spare_battery"
    house._entities[longer] = Entity(longer, device_id=DEV)
    assert K.parts(house, "kiosk_satellite", DEV)["battery"] == KS["battery"], "the shortest id"
    house._entities[KS["battery"]] = Entity(KS["battery"], device_id=DEV, disabled=True)
    assert K.parts(house, "kiosk_satellite", DEV)["battery"] == longer, "a disabled entity is not one"


def test_the_kiosk_apps_devices_are_found(house):
    house._devices[FULLY_DEV] = Device(FULLY_DEV, None, None)
    house._entities["sensor.hall_fully_battery"] = Entity("sensor.hall_fully_battery", device_id=FULLY_DEV,
                                                          platform="fully_kiosk")
    house._devices[LAMP_DEV] = Device(LAMP_DEV, None, "Lamp")
    house._entities["light.lamp"] = Entity("light.lamp", device_id=LAMP_DEV, platform="hue")
    got = K.devices(house)
    assert got == [{"id": FULLY_DEV, "name": FULLY_DEV, "app": "fully"},
                   {"id": DEV, "name": "Loft Kiosk", "app": "kiosk_satellite"}], "by name; an unnamed one by its id"


def test_the_screen_a_kiosk_shows_comes_from_its_page():
    screens = {"dashboard-loft"}
    assert K.screen_of_url("https://x/dashboard-loft/0", screens) == "dashboard-loft"
    assert K.screen_of_url("https://x/lovelace/0", screens) == ""
    assert K.screen_of_url(None, screens) == "" and K.screen_of_url("http://[::1", screens) == ""


def test_the_checks_say_what_to_fix(house):
    for role, v in (("adaptive", "on"), ("saver_mode", "Clock"), ("battery", "92"), ("kiosk_mode", "off"),
                    ("update", "on")):
        house.set(KS[role], v)
    got = {c["key"]: c for c in K.checks(house, tablet(), K.parts(house, "kiosk_satellite", DEV))}
    assert not got["adaptive"]["ok"] and got["adaptive"]["fix"] == ["switch", "turn_off", {"entity_id": KS["adaptive"]}]
    assert not got["saver"]["ok"] and got["saver"]["fix"][:2] == ["hk", "kiosk_saver"]
    assert "It is Clock, after 86400 s" in got["saver"]["detail"]
    assert not got["kiosk_mode"]["ok"] and got["kiosk_mode"]["fix"] == ["switch", "turn_on", {"entity_id": KS["kiosk_mode"]}]
    assert not got["update"]["ok"]
    assert not got["battery"]["ok"] and "Protect Battery" in got["battery"]["detail"]
    assert "online" not in got
    assert K.checks(house, tablet(), {}) == [], "no kiosk app: nothing to check"


def test_a_kiosk_good_as_it_is_passes_every_check(house):
    got = K.checks(house, tablet(), K.parts(house, "kiosk_satellite", DEV))
    assert [c["key"] for c in got] == ["adaptive", "saver", "kiosk_mode", "update", "battery"]
    assert all(c["ok"] for c in got)


def test_a_kiosk_not_heard_from_says_so(house):
    house.set(KS["battery"], "unavailable")
    got = {c["key"]: c for c in K.checks(house, tablet(), K.parts(house, "kiosk_satellite", DEV))}
    assert not got["online"]["ok"] and "battery" not in got, "no battery reading, no battery check"


def test_the_kiosks_screensaver_fix_is_black_after_a_day(house):
    p = K.parts(house, "kiosk_satellite", DEV)
    assert K.kiosk_saver_calls(p) == [
        ("select", "select_option", {"entity_id": KS["saver_mode"], "option": "Black"}),
        ("number", "set_value", {"entity_id": KS["saver_timeout"], "value": 86400})]
    assert K.kiosk_saver_calls({}) == []


# ------------------------------------------------------------- suggestions
def test_a_kiosk_no_tablet_uses_is_suggested_with_its_screen_and_address(house):
    got = SG.suggestions(house, {}, set(), {"dashboard-loft"}, {}, NOW)
    assert got == [{"key": f"device:{DEV}", "app": "kiosk_satellite", "device": DEV, "name": "Loft Kiosk",
                    "screen": "dashboard-loft", "ip": "192.0.2.7"}]
    assert SG.suggestions(house, {"loft": tablet()}, set(), {"dashboard-loft"}, {}, NOW) == [], "a tablet uses it"
    assert SG.suggestions(house, {}, {f"device:{DEV}"}, set(), {}, NOW) == [], "dismissed"


def test_a_browser_that_looks_like_a_tablet_is_suggested_for_a_week():
    house, apps = FakeHouse(), ("kiosk_satellite", "fully", "wallpanel", "browser")
    assert SG.seen_record("hall", "dashboard-hall", "browser", "hall", NOW, apps) is None, "a tablet already"
    assert SG.seen_record("hall", "dashboard-hall", "chrome", None, NOW, apps) is None, "no kiosk app's"
    rec = SG.seen_record("hall", "dashboard-hall", "browser", None, NOW, apps)
    seen = {rec["key"]: rec}
    got = SG.suggestions(house, {}, set(), set(), seen, NOW + timedelta(days=6))
    assert got == [{"key": "seen:hall:dashboard-hall", "app": "browser", "user": "hall",
                    "screen": "dashboard-hall", "at": NOW.isoformat()}]
    hall = tablet(name="Hall", screen="dashboard-hall", user="hall", device="")
    assert SG.suggestions(house, {"hall": hall}, set(), set(), seen, NOW) == [], "its user and screen are a tablet's"
    assert SG.suggestions(house, {}, set(), set(), seen, NOW + timedelta(days=8)) == [] and not seen, \
        "forgotten after a week"


# ------------------------------------------------------------- the alerts
def test_offline_for_ten_minutes_raises_an_alert_once_and_clears_it(house):
    al, tabs, o = A.Alerts(), {"loft": tablet()}, {"alert_offline": True}
    house.set(KS["online"], "off")
    assert al.check(house, tabs, o, NOW) == []
    assert al.check(house, tabs, o, NOW + timedelta(minutes=9)) == [] and not al.raised
    up = al.check(house, tabs, o, NOW + timedelta(minutes=11))
    assert up == [A.Alert(True, "loft", "offline", "Loft tablet is offline", up[0].message)]
    assert "10 minutes" in up[0].message and al.raised == {("loft", "offline")}
    assert al.check(house, tabs, o, NOW + timedelta(minutes=12)) == [], "once"
    house.set(KS["online"], "on")
    house.set(KS["seen"], (NOW + timedelta(minutes=12)).isoformat())
    assert al.check(house, tabs, o, NOW + timedelta(minutes=13)) == [A.Alert(False, "loft", "offline")]
    assert not al.raised and A.note_id("loft", "offline") == "hk_tablet_loft_offline"


def test_a_kiosk_last_seen_long_ago_is_offline(house):
    al, tabs, o = A.Alerts(), {"loft": tablet()}, {"alert_offline": True}
    house.set(KS["seen"], (NOW - timedelta(minutes=11)).isoformat())
    al.check(house, tabs, o, NOW)
    assert [a.kind for a in al.check(house, tabs, o, NOW + timedelta(minutes=10))] == ["offline"]


def test_the_alerts_can_be_turned_off(house):
    al, tabs = A.Alerts(), {"loft": tablet()}
    house.set(KS["charging"], "off")
    al.check(house, tabs, {"alert_charging": False}, NOW)
    assert al.check(house, tabs, {"alert_charging": False}, NOW + timedelta(minutes=11)) == []
    al.check(house, tabs, {"alert_charging": True}, NOW + timedelta(minutes=12))
    assert [a.kind for a in al.check(house, tabs, {"alert_charging": True}, NOW + timedelta(minutes=22))] == ["charging"]


def test_a_tablet_without_a_kiosk_app_raises_nothing():
    al = A.Alerts()
    assert al.check(FakeHouse(), {"hall": tablet(app="browser", device="")}, {"alert_offline": True}, NOW) == []


def test_a_restart_not_back_in_front_after_three_minutes_raises_an_alert(house):
    al, tabs, o = A.Alerts(), {"loft": tablet()}, {"alert_restart": True}
    al.restarted["loft"] = NOW
    house.set(KS["app"], "com.android.systemui")                     # the lock screen in front
    assert al.check(house, tabs, o, NOW + timedelta(minutes=2)) == [] and "loft" in al.restarted
    got = al.check(house, tabs, o, NOW + timedelta(minutes=4))
    assert [(a.up, a.kind, a.title) for a in got] == [(True, "restart", "Loft tablet didn’t come back")]
    assert "loft" not in al.restarted, "checked once"
    house.set(KS["app"], K.KS_PACKAGE)
    al.restarted["loft"] = NOW
    assert al.check(house, tabs, o, NOW + timedelta(minutes=4)) == [A.Alert(False, "loft", "restart")]
    # Mantel for Android stands in for Kiosk Satellite by the same entities: its own package in front is back too
    house.set(KS["app"], K.MANTEL_PACKAGE)
    al.restarted["loft"] = NOW
    assert not [a for a in al.check(house, tabs, o, NOW + timedelta(minutes=4)) if a.up]


def test_the_scheduled_restart_runs_at_its_times_and_presses_cache_then_restart(house):
    assert A.restart_times({"restart": True, "restart_times": ["03:00", "3:30", "bad", "25:00"]}) == [(3, 0), (3, 30)]
    assert A.restart_times({"restart": False, "restart_times": ["03:00"]}) == []
    assert A.restart_key({"restart": True, "restart_times": ["03:00"]}) != A.restart_key({"restart": False})
    tabs = {"loft": tablet(), "hall": tablet(app="browser", device="")}
    assert A.restart_plan(house, tabs) == [("loft", KS["clear_cache"], KS["restart_device"])], \
        "only a kiosk app that can restart"


# ------------------------------------------------------------- Setup Check
def test_setup_check_names_what_each_tablet_lacks(house):
    boards = {"dashboard-loft": {"screensaver": True}}
    assert SC.check_lines(house, {"loft": tablet()}, boards, {"loft"}) == [
        (True, "Wall Tablets", "1 tablet, each set up right.")]
    house.set(KS["kiosk_mode"], "off")
    bad = {"loft": tablet(user="nobody"), "den": tablet(name="Den", screen="", device="")}
    [(ok, title, detail)] = SC.check_lines(house, bad, boards, {"loft"})
    assert not ok and title == "Wall Tablets"
    assert "Loft: no Home Assistant user “nobody”" in detail and "Loft: kiosk mode on — Off" in detail
    assert "Den: no screen" in detail and "Den: its kiosk app’s device isn’t chosen" in detail


def test_setup_check_says_a_screensaver_with_no_tablet_never_shows():
    house = FakeHouse()
    [(ok, _, detail)] = SC.check_lines(house, {}, {"k": {"screensaver": True}}, set())
    assert not ok and "no wall tablet runs those screens" in detail
    assert SC.check_lines(house, {}, {"k": {"screensaver": True, "screensaver_engine": "wallpanel"}}, set()) == []
