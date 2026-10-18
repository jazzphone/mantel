"""hk_core.sleep against a fake House and a fake clock: the Sleep Screen engine's decisions run
once here, for every host.

The HA build runs the same code through sleep_engine.py (tests/py/test_sleep_engine.py,
test_sleep_rules.py), with HA's trackers, timers, contexts and service calls around it. Nothing
here sends anything: the fake House refuses every service call, and Sleep only answers -- what
the screen should show, when to look again, the brightness, the display to turn off; the host
acts.
"""
from datetime import datetime, timedelta, timezone

import pytest

from hk_core.house import Device, Entity, State
from hk_core.sleep import engine as E
from hk_core.sleep import rules as R

T0 = datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc)       # noon at the house (UTC-4)
HOUSE_TZ = timezone(timedelta(hours=-4))
KIOSK = "0123456789abcdef0123456789abcdef"
K = {"screen": "light.hall_kiosk_screen", "active": "switch.hall_kiosk_screensaver_active",
     "armed": "switch.hall_kiosk_screensaver", "mode": "select.hall_kiosk_screensaver_mode",
     "app": "sensor.hall_kiosk_foreground_app", "touched": "sensor.hall_kiosk_last_interaction",
     "front": "button.hall_kiosk_bring_to_front"}
OWN = {"photos": "switch.hall_photo_screensaver", "black": "switch.hall_black_screen",
       "in_use": "binary_sensor.hall_screen_in_use"}
MOTION, LAMP, NIGHT, AWAY, BELL, SMOKE, GOODNIGHT = (
    "binary_sensor.hall_motion", "light.hall_lamp", "timer.night", "input_boolean.away", "timer.doorbell",
    "binary_sensor.smoke", "input_boolean.good_night")


class Clock:
    def __init__(self, at=T0):
        self.now = at

    def __call__(self):
        return self.now

    def tick(self, **kw):
        self.now += timedelta(**kw)
        return self.now


class FakeHouse:
    """States (with when each last changed), a registry, a time zone -- and no way to change
    anything."""

    def __init__(self, clock):
        self.clock = clock
        self._states = {}
        self._entities = {}
        self._devices = {}

    def set(self, entity_id, state, attrs=None, when=None):
        old = self._states.get(entity_id)
        changed = when or (old.last_changed if old is not None and old.state == state else self.clock())
        self._states[entity_id] = State(entity_id, state, dict(attrs or {}), changed)

    def add_device(self, device_id, name, ids, disabled=()):
        self._devices[device_id] = Device(device_id, None, name)
        for i in ids:
            self._entities[i] = Entity(i, device_id=device_id, disabled=i in disabled)

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
        return (when or self.clock()).astimezone(HOUSE_TZ)

    async def call_service(self, *a, **kw):
        raise AssertionError("the Sleep Screen's decisions never call a service")


class Screen(E.Sleep):
    """A host in miniature: the screen's own entities and its touches."""

    def __init__(self, house, clock, own=True):
        super().__init__(house, "hall", clock)
        self.own = dict(OWN) if own else {}
        self.page = None
        self.saver = None

    def _own(self):
        return self.own

    def _page_touch(self):
        return self.page

    def _saver_touch(self):
        return self.saver


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def house(clock):
    h = FakeHouse(clock)
    h.add_device(KIOSK, "Hall Kiosk", list(K.values()))
    h.set(K["screen"], "on", {"brightness": 174})
    h.set(K["active"], "off")
    h.set(K["armed"], "off")
    h.set(K["mode"], "Black")
    h.set(K["app"], "me.jxl.kiosk_satellite")
    h.set(K["touched"], "2026-01-01T00:00:00+00:00")
    for eid in OWN.values():
        h.set(eid, "off")
    h.set(MOTION, "off")
    return h


def board(**sleep):
    o = {"decided_by": "hk", "kiosk": KIOSK, "presence": [MOTION], "linger": 0}
    o.update(sleep)
    return {"sleep": o, "black_screen": "hk", "screensaver_options": {"starts_after": 180}}


def screen(house, clock, **sleep):
    s = Screen(house, clock)
    s.options(board(**sleep))
    s.seed_presence()
    return s


# ------------------------------------------------------------------ the kiosk
def test_the_kiosk_devices_and_their_parts_come_from_the_registry(house):
    house.add_device("f" * 32, "Not A Kiosk", ["light.lamp_x", "sensor.lamp_x_power"])
    assert E.kiosks(house) == [{"id": KIOSK, "name": "Hall Kiosk"}]
    assert E.kiosk_parts(house, KIOSK) == K
    assert E.kiosk_parts(house, "") == {}
    # a disabled entity is no part
    house.add_device("e" * 32, "Den Kiosk", ["sensor.den_foreground_app", "switch.den_screensaver_active",
                                             "light.den_screen"], disabled=("light.den_screen",))
    assert E.kiosk_parts(house, "e" * 32) == {"active": "switch.den_screensaver_active",
                                              "app": "sensor.den_foreground_app"}


def test_its_settings_and_what_it_follows(house, clock):
    s = Screen(house, clock)
    s.options({"sleep": None})
    assert s.o == R.sleep_options(None) and not s.acting and s.kiosk == {}
    s.options(board(lit=[LAMP], wake_for=[SMOKE]))
    assert s.acting and s.kiosk == K
    assert s.listens() == sorted({MOTION, LAMP, SMOKE, *K.values(), *OWN.values()})


# ------------------------------------------------------------------ deciding
def test_nobody_here_is_dark_and_somebody_in_the_room_is_awake(house, clock):
    s = screen(house, clock)
    assert s.decide(clock()) is None
    assert (s.want, s.reason, s.actual) == ("dark", "nobody here", "dashboard")
    assert s.action() == "sleep"
    house.set(MOTION, "on")
    s.decide(clock.tick(seconds=5))
    assert (s.want, s.reason) == ("photos", "somebody is in the room") and s.action() is None


def test_presence_lingers_and_the_next_look_is_timed_exactly(house, clock):
    house.set(MOTION, "on")
    s = screen(house, clock, linger=60)
    s.decide(clock())
    house.set(MOTION, "off")
    cleared = clock.tick(seconds=1)
    nxt = s.decide(cleared)
    assert s.want == "photos", "lingering"
    assert nxt == cleared + timedelta(seconds=60, milliseconds=200)
    s.decide(clock.tick(seconds=61))
    assert s.want == "dark"


def test_a_missing_presence_sensor_holds(house, clock):
    house.set(MOTION, "unavailable")
    s = screen(house, clock)
    s.decide(clock())
    assert s.want == "hold" and s.action() is None


def test_quiet_hours_by_the_houses_clock(house, clock):
    house.set(MOTION, "on")
    s = screen(house, clock, schedule=True, quiet_from="22:00", quiet_to="07:00")
    nxt = s.decide(clock())                      # noon at the house
    assert s.want == "photos"
    assert nxt == datetime(2026, 10, 19, 2, 0, 0, 200000, tzinfo=timezone.utc), "22:00 at the house, in UTC"
    clock.now = datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc)   # 23:00 at the house
    s.decide(clock())
    assert (s.want, s.reason) == ("dark", "quiet hours") and s.facts_now["quiet"]


def test_claims_and_holds_by_name(house, clock):
    house.set(SMOKE, "on", {"friendly_name": "Smoke"})
    house.set(BELL, "active", {"friendly_name": "Doorbell"})
    s = screen(house, clock, wake_for=[SMOKE], hold_while=[BELL], quiet_ok=[SMOKE])
    s.decide(clock())
    assert (s.want, s.reason) == ("dashboard", "Smoke is on")
    house.set(SMOKE, "off")
    s.decide(clock.tick(seconds=1))
    assert (s.want, s.reason) == ("hold", "Doorbell is on")


def test_a_touch_is_in_use_for_its_window(house, clock):
    s = screen(house, clock)
    s.page = clock()
    nxt = s.decide(clock())
    assert (s.want, s.reason) == ("dashboard", "somebody is at the tablet")
    assert nxt == s.page + timedelta(seconds=120, milliseconds=200), "Starts After less a minute"
    s.decide(clock.tick(seconds=121))
    assert s.want == "dark"


def test_the_kiosks_last_tap_counts_and_is_read_with_the_hosts_parser(house, clock):
    seen = []

    def parse(text):
        seen.append(text)
        return datetime.fromisoformat(text)
    s = Screen(house, clock)
    s.parse = parse
    s.options(board())
    house.set(K["touched"], clock().isoformat())
    s.decide(clock())
    assert s.want == "dashboard" and seen


def test_the_power_button_in_quiet_hours_is_in_use_for_a_minute(house, clock):
    clock.now = datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc)
    s = screen(house, clock, schedule=True)
    s.decide(clock())
    assert s.want == "dark"
    house.set(OWN["black"], "on", {"black_screen": "hk"})
    s.decide(clock())
    # lit by an automation: nothing
    s.display_changed(K["screen"], "off", "on", hand=False)
    s.decide(clock())
    assert s.want == "dark"
    # lit by the tablet itself
    assert E.by_hand(None, None) and not E.by_hand("parent", None) and not E.by_hand(None, "user")
    s.display_changed(K["screen"], "off", "on", hand=True)
    s.decide(clock.tick(seconds=1))
    assert s.facts_now["in_use"] and s.want == "dashboard"
    s.decide(clock.tick(seconds=E.HAND_WAKE_S))
    assert s.want == "dark"


def test_a_notification_wakes_it_to_the_photos_for_its_while(house, clock):
    clock.now = datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc)
    s = screen(house, clock, schedule=True)
    s.notify_wake("Water Leak", 30)
    nxt = s.decide(clock())
    assert (s.want, s.reason) == ("photos", "notification: Water Leak") and s.wakes_to_photos()
    assert nxt == clock() + timedelta(seconds=30, milliseconds=200)
    s.decide(clock.tick(seconds=31))
    assert s.want == "dark" and not s.wakes_to_photos()


def test_a_tap_on_the_screensavers_controls_keeps_the_photos(house, clock):
    house.set(MOTION, "on")
    house.set(OWN["photos"], "on")
    s = screen(house, clock, lit=[LAMP])
    house.set(LAMP, "off")
    s.saver = clock()
    s.page = clock() + timedelta(seconds=2)       # the same tap, by the tablet's clock
    s.decide(clock())
    assert s.facts_now["saver_use"] and (s.want, s.reason) == ("photos", "somebody is using the screensaver")


def test_a_new_tap_with_the_photos_up_waits_for_the_screensavers_report(house, clock):
    house.set(MOTION, "on")
    house.set(OWN["photos"], "on")
    s = screen(house, clock)
    s.decide(clock())
    s.page = clock.tick(seconds=1)
    nxt = s.decide(clock())
    assert s.facts_now["saver_wait"] and s.want == "photos"
    assert nxt == clock() + timedelta(seconds=E.SAVER_WAIT, milliseconds=200)
    s.decide(clock.tick(seconds=E.SAVER_WAIT))
    assert not s.facts_now["saver_wait"] and s.want == "dashboard"


def test_good_night_darkens_an_occupied_room_until_it_is_re_entered(house, clock):
    house.set(MOTION, "on")
    s = screen(house, clock, reset=[GOODNIGHT])
    house.set(GOODNIGHT, "off")
    s.decide(clock())
    assert s.want == "photos"
    house.set(GOODNIGHT, "on", {"friendly_name": "Good Night"}, when=clock.tick(seconds=10))
    s.decide(clock())
    assert (s.want, s.reason) == ("dark", "dark until the room is re-entered (Good Night)")
    house.set(MOTION, "off")
    s.decide(clock.tick(seconds=1))
    house.set(MOTION, "on")
    s.decide(clock.tick(seconds=30))
    assert s.want == "photos", "re-entered after Good Night"


def test_after_the_screensaver_with_no_presence_sensors(house, clock):
    s = screen(house, clock, presence=[], after_saver=5)
    s.decide(clock())
    assert s.want == "photos" and s.facts_now["present"] is True
    fire = T0 + timedelta(seconds=180 + 5 * 60)
    assert s.facts_now["after_saver_at"] == fire.isoformat()
    s.decide(fire)
    assert (s.want, s.reason) == ("dark", "the photos have run 5 min untouched")


def test_the_screen_is_dark_under_either_black(house, clock):
    s = screen(house, clock)
    assert s._actual() == "dashboard"
    house.set(OWN["photos"], "on")
    assert s._actual() == "photos"
    house.set(OWN["black"], "on", {"black_screen": "kiosk"})
    assert s._actual() == "photos", "a black that is the kiosk's own is read off the kiosk"
    house.set(K["active"], "on")
    assert s._actual() == "dark"


# ------------------------------------------------------------------ trust and loops
def test_a_kiosk_that_does_not_answer_is_not_acted_on(house, clock):
    s = screen(house, clock)
    assert s.trusted()
    house.set(K["touched"], "unavailable")
    assert not s.trusted()
    house.set(K["touched"], "2026-01-01T00:00:00+00:00")
    house.set(K["active"], "unknown")
    assert not s.trusted()
    s.options({"sleep": {"decided_by": "hk"}})
    assert s.trusted(), "no kiosk: nothing to distrust"


def test_another_app_in_front(house, clock):
    s = screen(house, clock)
    assert not s.app_front()
    house.set(K["app"], "com.netflix.mediaclient")
    s.decide(clock())
    assert s.app_front() and s.want == "hold" and "com.netflix.mediaclient" in s.reason


def test_a_loop_waits():
    ok, recent = E.room_to_act([], 100.0)
    assert ok and recent == []
    ok, recent = E.room_to_act([100.0 + i for i in range(E.ACTIONS_PER_MIN)], 110.0)
    assert not ok and len(recent) == E.ACTIONS_PER_MIN
    ok, recent = E.room_to_act([1.0] * E.ACTIONS_PER_MIN, 110.0)
    assert ok and recent == [], "a minute on, the old ones are forgotten"


# ------------------------------------------------------------------ brightness and the display
def test_day_and_night_brightness(house, clock):
    house.set(NIGHT, "idle")
    s = screen(house, clock, brightness="fixed", bright_day=174, bright_night=75, night_while=[NIGHT])
    assert s.target() == 174
    house.set(NIGHT, "active")
    assert s.target() == 75
    s.options(board(brightness="fixed", bright_clock=True, day_from="07:00", night_from="22:00"))
    assert s.target() == 174
    clock.now = datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc)
    assert s.target() == 75, "night by the house's clock"
    s.options(board(brightness="sensor", bright_sensor="sensor.hall_target"))
    house.set("sensor.hall_target", "120.4")
    assert s.target() == 120
    house.set("sensor.hall_target", "999")
    assert s.target() is None


def test_brightness_follows_the_target_under_hks_black_or_on_the_display(house, clock):
    house.set(NIGHT, "idle")
    s = screen(house, clock, brightness="fixed", bright_day=174, bright_night=75, night_while=[NIGHT])
    s.decide(clock())
    # awake: the display, only when the TARGET changes
    house.set(K["screen"], "on", {"brightness": 100})
    s.actual = "dashboard"
    assert s.brightness_step(None) == ("display", K["screen"], 174)
    assert s.brightness_step(None) is None, "set by hand meanwhile: left alone"
    # under HK's black: the black's level, whenever it differs
    house.set(OWN["black"], "on", {"black_screen": "hk", "brightness": 174})
    house.set(NIGHT, "active")
    assert s.brightness_step((OWN["black"], True)) == ("black", OWN["black"], 75)
    house.set(OWN["black"], "on", {"black_screen": "hk", "brightness": 75})
    assert s.brightness_step((OWN["black"], True)) is None
    s.options(board())
    assert s.brightness_step(None) is None, "left alone"


def test_display_off_in_quiet_hours_after_a_hand_lit_moment(house, clock):
    clock.now = datetime(2026, 10, 19, 3, 0, tzinfo=timezone.utc)
    s = screen(house, clock, schedule=True, dark_display="off_quiet")
    house.set(K["active"], "on")
    s.decide(clock())
    assert (s.want, s.actual) == ("dark", "dark") and s.power_off_wanted()
    assert s.quiet_display_off(clock()) == K["screen"]
    s.display_changed(K["screen"], "off", "on", hand=False)
    assert s.quiet_display_off(clock()) is None, "lit a moment ago"
    assert s.quiet_display_off(clock.tick(seconds=E.HAND_LIT_S)) == K["screen"]
    house.set(K["screen"], "off")
    assert s.quiet_display_off(clock()) is None
    s.options(board(dark_display="lowest"))
    assert not s.power_off_wanted()


def test_what_the_sensor_reports(house, clock):
    s = screen(house, clock)
    s.saver = T0
    s.decide(clock())
    a = s.attributes(("sleep", "2026-10-18T16:00:00+00:00"))
    assert a["decided_by"] == "hk" and a["reason"] == "nobody here" and a["actual"] == "dashboard"
    assert a["kiosk"] == K["screen"] and a["last_saver_touch"] == T0.isoformat()
    assert a["last_action"] == "sleep at 2026-10-18T16:00:00+00:00" and a["target_brightness"] is None
    assert s.attributes()["last_action"] is None
