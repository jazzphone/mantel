"""hk_core.screensaver against a fake House: a wall tablet's screensaver decisions run once here,
for every host.

The HA build runs the same code through screensaver.py, switch.py and binary_sensor.py
(tests/py/test_screensaver.py, test_sleep_engine.py), with HA's entities, registry and websocket
commands around it. Nothing here sends anything: the fake House refuses every service call; the
old helper's mirroring answers the call to make, and the host makes it.
"""
from datetime import datetime, timedelta, timezone

import pytest

from hk_core.house import State
from hk_core.screensaver import rules as R
from hk_core.screensaver.black import Black

NOW = datetime(2026, 10, 18, 3, 0, tzinfo=timezone.utc)
LEGACY = "input_boolean.wallpanel_screensaver_hall"


class FakeHouse:
    """States only -- and no way to change anything."""

    def __init__(self):
        self._states = {}

    def set(self, entity_id, state):
        self._states[entity_id] = State(entity_id, state, {})

    def state(self, entity_id):
        return self._states.get(entity_id)

    def states(self, domain=None):
        return [s for s in self._states.values() if domain is None or s.domain == domain]

    def entity(self, entity_id):
        return None

    def entities(self, domain=None):
        return []

    def device(self, device_id):
        return None

    def device_entities(self, device_id):
        return []

    def area_ids(self):
        return set()

    def area_name(self, area_id):
        return None

    def area_floor(self, area_id):
        return None

    def local_time(self, when=None):
        raise AssertionError("the screensaver's rules are handed the time")

    async def call_service(self, *a, **kw):
        raise AssertionError("the screensaver's rules never call a service")


def tablet(**more):
    t = {"name": "Hall", "screen": "dashboard-hall", "user": "hall", "room": "hall", "black_screen": "kiosk",
         "sleep": {"decided_by": "automation"}}
    t.update(more)
    return t


def screen(starts_after=180, **more):
    b = {"screensaver": True, "screensaver_options": {"starts_after": starts_after, "show": "both"}}
    b.update(more)
    return b


@pytest.fixture
def house():
    return FakeHouse()


# ------------------------------------------------------------- what a tablet reads
def test_a_tablet_reads_its_own_sleep_and_its_screens_screensaver():
    b = R.as_board(tablet(black_screen="hk"), screen(300, notify=False))
    assert b == {"sleep": {"decided_by": "automation"}, "black_screen": "hk",
                 "screensaver_options": {"starts_after": 300, "show": "both"}, "screensaver": True,
                 "dashboard": "dashboard-hall", "tablet_user": "hall", "idle_room": "hall",
                 "notify": False, "notify_dnd": None}
    assert R.as_board(tablet(), screen())["notify"] is True, "notifications on unless the screen says"


def test_each_tablet_is_wanted_with_its_screens_board_in_the_hosts_order():
    boards = {"dashboard-hall": screen(300)}
    asked = []

    def screen_board(path):
        asked.append(path)
        return boards.get(path) or screen()
    items = {"hall": "item-hall", "gone": "item-gone", "den": "item-den"}
    tabs = {"den": tablet(name="Den", screen="dashboard-den", user="den"), "hall": tablet()}
    want = R.wanted(items, tabs, screen_board)
    assert list(want) == ["hall", "den"], "the host's items' order; an item with no tablet is none"
    assert want["hall"]["sub"] == "item-hall" and want["hall"]["tablet"] is tabs["hall"]
    assert R.starts_after(want["hall"]["board"]) == 300 and R.starts_after(want["den"]["board"]) == 180
    assert asked == ["dashboard-hall", "dashboard-den"]


def test_the_tablets_on_a_screen_put_the_signed_in_users_first():
    tabs = {"a": tablet(user="kids"), "b": tablet(user="hall"), "c": tablet(screen="dashboard-den")}
    want = R.wanted({k: k for k in tabs}, tabs, lambda path: screen())
    assert R.tablets_on(want, "dashboard-hall") == ["a", "b"]
    assert R.tablets_on(want, "dashboard-hall", "hall") == ["b", "a"]
    assert R.tablets_on(want, "dashboard-hall", None) == ["a", "b"], "a user with no name matches none"
    assert R.tablets_on(want, "dashboard-nope", "hall") == []


# ------------------------------------------------------------- in use
def test_the_in_use_window_is_starts_after_less_a_minute():
    assert R.window_of(180) == 120 and R.window_of(300) == 240
    assert R.window_of(30) == 15, "never under fifteen seconds"
    assert R.window_of("90") == 30


def test_a_touch_keeps_the_screen_in_use_for_its_window():
    assert not R.in_use(None, 180, NOW), "never touched"
    assert R.in_use(NOW, 180, NOW + timedelta(seconds=119))
    assert not R.in_use(NOW, 180, NOW + timedelta(seconds=120)), "off exactly when the window runs out"
    assert R.in_use(NOW, 300, NOW + timedelta(seconds=200))


def test_every_tablet_entity_carries_its_timer_and_last_touch():
    b = R.as_board(tablet(), screen(300))
    assert R.attributes("hall", b, NOW) == {"tablet": "hall", "dashboard": "dashboard-hall",
                                            "starts_after": 300, "in_use_window": 240,
                                            "last_touch": NOW.isoformat()}
    lifted = R.as_board(tablet(screen=""), screen())
    assert R.attributes("hall", lifted, None)["dashboard"] is None
    assert R.attributes("hall", lifted, None)["last_touch"] is None


def test_only_the_tablets_own_user_or_an_admin_may_speak_for_it():
    may = R.may_speak_for
    assert may("hall", signed_in=True, admin=False, name="hall")
    assert may("hall", signed_in=True, admin=True, name="avery"), "an admin"
    assert not may("hall", signed_in=True, admin=False, name="kitchen"), "a desk opening the same screen"
    assert may("", signed_in=True, admin=False, name="anyone"), "a tablet with no user: known by its URL"
    assert not may("", signed_in=False, admin=False, name=None), "nobody signed in"


# ------------------------------------------------------------- the old helper
def test_the_old_helper_is_mirrored_only_while_the_house_has_it(house):
    assert R.legacy_helper(house, "hall") is None, "deleted: the mirror is idle"
    assert R.legacy_helper(house, "") is None and R.legacy_helper(house, None) is None
    house.set(LEGACY, "off")
    assert R.legacy_helper(house, "hall") == LEGACY
    assert R.legacy_mirror(house, LEGACY, True) == ("input_boolean", "turn_on", {"entity_id": LEGACY})
    assert R.legacy_mirror(house, LEGACY, False) is None, "it says so already"
    house.set(LEGACY, "on")
    assert R.legacy_mirror(house, LEGACY, False) == ("input_boolean", "turn_off", {"entity_id": LEGACY})
    assert R.legacy_mirror(house, None, True) is None
    assert R.legacy_mirror(house, "input_boolean.wallpanel_screensaver_gone", True) is None


def test_the_old_helpers_state_says_on_off_or_nothing():
    assert R.legacy_says("on") is True and R.legacy_says("off") is False
    assert R.legacy_says("unavailable") is None and R.legacy_says(None) is None


# ------------------------------------------------------------- its entities and engine
def test_each_tablet_has_four_entities():
    assert R.KINDS == (("switch", "switch"), ("black", "switch"), ("binary_sensor", "binary_sensor"),
                       ("sleep", "sensor"))


def test_an_engine_only_while_hk_decides_and_rebuilt_when_what_it_reads_changes():
    hk = R.as_board(tablet(sleep={"decided_by": "hk"}), screen())
    assert R.deciding(hk) and R.deciding(R.as_board(tablet(sleep={"decided_by": "shadow"}), screen()))
    assert not R.deciding(R.as_board(tablet(), screen())) and not R.deciding({})
    ids = {"switch": "switch.hall_photo_screensaver", "black": None}
    key = R.engine_key(hk, ids)
    assert key == R.engine_key(dict(hk), dict(ids)), "the same key, the same engine"
    assert key != R.engine_key(R.as_board(tablet(sleep={"decided_by": "hk"}), screen(300)), ids)
    assert key != R.engine_key(hk, {**ids, "black": "switch.hall_black_screen"}), "a renamed entity"


def test_the_feed_names_each_tablets_entities():
    have = {"hall": {"switch": "switch.hall_photo_screensaver", "black": "switch.hall_black_screen",
                     "binary_sensor": "binary_sensor.hall_screen_in_use", "sleep": None},
            "den": {"switch": None}}
    assert R.ids_of(have, "switch") == {"hall": "switch.hall_photo_screensaver"}, "an entity not yet added: none"
    assert R.ids_of(have, "black") == {"hall": "switch.hall_black_screen"}
    assert R.named(have) == {
        "hall": {"switch": "switch.hall_photo_screensaver", "in_use": "binary_sensor.hall_screen_in_use",
                 "black": "switch.hall_black_screen", "sleep": None},
        "den": {"switch": None, "in_use": None, "black": None, "sleep": None}}


# ------------------------------------------------------------- black screen
def test_the_black_screen_is_confirmed_by_the_page_until_it_changes():
    b = Black()
    assert not b.page_says(True), "not black: nothing to confirm"
    b.set(True)
    assert b.attributes({"black_screen": "hk"}) == {"black_screen": "hk", "brightness": None, "confirmed": False}
    assert b.page_says(True) and b.confirmed and not b.page_says(True), "confirmed once"
    b.set(True)
    assert b.confirmed, "the same: still confirmed"
    b.set(False)
    assert not b.confirmed and not b.attributes({})["confirmed"]
    assert b.attributes({})["black_screen"] == "kiosk", "the tablet's setting, kiosk unless hk"


def test_a_tap_wakes_the_black_screen():
    b = Black(on=True, confirmed=True)
    assert b.page_says(False) and not b.on and not b.confirmed
    assert not b.page_says(False), "already awake"


def test_the_black_screen_comes_back_from_a_restart_unconfirmed():
    b = Black()
    b.restore("on", {"brightness": 40.0, "confirmed": True})
    assert (b.on, b.brightness, b.confirmed) == (True, 40, False), "a page that reloads while black says so again"
    b.restore("off", {"brightness": "bright"})
    assert (b.on, b.brightness) == (False, None)
