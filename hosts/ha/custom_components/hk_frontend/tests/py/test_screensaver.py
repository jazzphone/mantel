"""A wall tablet's own entities (screensaver.py, switch.py, binary_sensor.py):
since 1.14 one photos switch, black switch, in-use sensor and Sleep Screen
sensor per TABLET (an item of its own, apart from the screen it runs), the old
WallPanel helper mirrored both ways while it exists, the page's touches, and
the settings feed naming the switches."""
from __future__ import annotations

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockUser, async_fire_time_changed  # noqa: F401

from homeassistant.config_entries import ConfigSubentry
from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er

from conftest import entry
from test_accessories import Conn as _Conn

DOMAIN = "hk_frontend"
SW = "switch.hall_photo_screensaver"
INUSE = "binary_sensor.hall_screen_in_use"
LEGACY = "input_boolean.wallpanel_screensaver_hall"


class Conn(_Conn):
    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "type": "result", "success": False, "error": code, "message": message})


def _screen(**data):
    d = {"screensaver": True}
    d.update(data)
    return ConfigSubentry(data=d, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall")


def _tablet(**data):
    d = {"name": "Hall", "screen": "dashboard-hall", "user": "hall", "room": "hall"}
    d.update(data)
    return ConfigSubentry(data=d, subentry_type="tablet", title=d["name"], unique_id="hall")


class _Hall:
    """The hall's screen and the tablet that runs it, added together."""

    def __init__(self, screen=None, **tablet):
        self.screen, self.tablet = _screen(**(screen or {})), _tablet(**tablet)


def _hall(screen=None, **tablet):
    return _Hall(screen, **tablet)


async def _add(hass, sub):
    subs = [sub.screen, sub.tablet] if isinstance(sub, _Hall) else [sub]
    for s in subs:
        hass.config_entries.async_add_subentry(entry(hass), s)
    await hass.async_block_till_done(wait_background_tasks=True)


async def _change(hass, sub, **data):
    new = dict(sub.data)
    new.update(data)
    hass.config_entries.async_update_subentry(entry(hass), sub, data=new)
    await hass.async_block_till_done(wait_background_tasks=True)


def _touch(hass, conn, n=1, tablet="hall", **more):
    from custom_components.hk_frontend.screensaver import ws_touch
    ws_touch(hass, conn, {"id": n, "type": "hk_frontend/screensaver/touch", "tablet": tablet, **more})
    return conn.sent[-1]


# ------------------------------------------------------------ the one timer
def test_the_in_use_window_is_starts_after_less_a_minute():
    from custom_components.hk_frontend.screensaver import window_of
    assert window_of(180) == 120 and window_of(300) == 240
    assert window_of(60) == 15 and window_of(15) == 15, "never shorter than 15 s"


# ------------------------------------------------------------ which tablets
async def test_a_tablet_gets_its_switch_and_sensor(hass, frontend):
    await _add(hass, _hall())
    sw, use = hass.states.get(SW), hass.states.get(INUSE)
    assert sw is not None and sw.state == "off" and sw.name == "Hall Photo screensaver"
    assert use is not None and use.state == "off" and use.name == "Hall Screen in use"
    assert sw.attributes["starts_after"] == 180 and sw.attributes["in_use_window"] == 120
    assert sw.attributes["tablet"] == "hall" and sw.attributes["dashboard"] == "dashboard-hall"
    assert sw.attributes["last_touch"] is None
    reg = er.async_get(hass)
    ent = reg.async_get(SW)
    sub = next(s for s in entry(hass).subentries.values() if s.unique_id == "hall")
    assert ent.config_subentry_id == sub.subentry_id, "tied to the tablet's item"
    assert ent.unique_id == f"{entry(hass).entry_id}_tablet_hall_photo_screensaver"


async def test_the_entities_go_with_the_tablet(hass, frontend):
    hall = _hall()
    await _add(hass, hall)
    assert hass.states.get(SW) is not None
    hass.config_entries.async_remove_subentry(entry(hass), hall.tablet.subentry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.states.get(SW) is None and hass.states.get(INUSE) is None
    assert er.async_get(hass).async_get(SW) is None, "not left behind as unavailable"
    await _add(hass, _tablet())
    assert hass.states.get(SW) is not None, "back with a tablet again"


async def test_a_screen_without_a_tablet_has_none(hass, frontend):
    await _add(hass, _screen())
    assert hass.states.get(SW) is None, "the screensaver runs on a tablet: no tablet, nothing to put to sleep"


async def test_starts_after_is_on_both_entities(hass, frontend):
    hall = _hall()
    await _add(hass, hall)
    await _change(hass, hall.screen, screensaver_options={"starts_after": 300})
    assert hass.states.get(SW).attributes["in_use_window"] == 240
    assert hass.states.get(INUSE).attributes["starts_after"] == 300


# ------------------------------------------------------------ the switch
async def test_the_switch_turns_on_and_off(hass, frontend):
    await _add(hass, _hall())
    await hass.services.async_call("switch", "turn_on", {"entity_id": SW}, blocking=True)
    assert hass.states.get(SW).state == "on"
    await hass.services.async_call("switch", "turn_off", {"entity_id": SW}, blocking=True)
    assert hass.states.get(SW).state == "off"


async def test_the_old_helper_is_mirrored_both_ways(hass, frontend):
    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "input_boolean", {"input_boolean": {
        "wallpanel_screensaver_hall": {"initial": True}}})
    await _add(hass, _hall())
    assert hass.states.get(SW).state == "on", "starts from the helper the house kept"
    # the house's automation turns the helper off -> the switch follows
    await hass.services.async_call("input_boolean", "turn_off", {"entity_id": LEGACY}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get(SW).state == "off"
    # the screensaver writes the switch -> the helper follows
    await hass.services.async_call("switch", "turn_on", {"entity_id": SW}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get(LEGACY).state == "on"
    await hass.services.async_call("switch", "turn_off", {"entity_id": SW}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get(LEGACY).state == "off" and hass.states.get(SW).state == "off"


async def test_with_no_old_helper_nothing_is_mirrored(hass, frontend):
    calls = []
    hass.bus.async_listen("call_service", lambda e: calls.append(e.data["domain"]))
    await _add(hass, _hall())
    await hass.services.async_call("switch", "turn_on", {"entity_id": SW}, blocking=True)
    await hass.async_block_till_done()
    assert "input_boolean" not in calls


# ------------------------------------------------------------ the page's touches
async def test_a_touch_puts_the_screen_in_use_for_its_window(hass, frontend, freezer):
    await _add(hass, _hall())
    await hass.auth.async_create_user("Owner")          # the first user is the owner, an admin
    tablet = Conn(await hass.auth.async_create_user("hall"))
    r = _touch(hass, tablet)
    assert r["success"] and r["result"] == {"window": 120}
    await hass.async_block_till_done()
    use = hass.states.get(INUSE)
    assert use.state == "on" and use.attributes["last_touch"]
    assert hass.states.get(SW).attributes["last_touch"] == use.attributes["last_touch"]
    freezer.tick(timedelta(seconds=100))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass.states.get(INUSE).state == "on", "still inside the 120 s window"
    freezer.tick(timedelta(seconds=21))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert hass.states.get(INUSE).state == "off", "off exactly when the window runs out"


async def test_only_the_tablet_or_an_admin_may_touch(hass, frontend):
    await _add(hass, _hall())
    await hass.auth.async_create_user("Owner")          # the first user is the owner, an admin
    desk = Conn(await hass.auth.async_create_user("desk"))
    r = _touch(hass, desk)
    assert r["success"] is False and r["error"] == "unauthorized"
    assert hass.states.get(INUSE).state == "off"
    admin = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    assert _touch(hass, admin, 2)["success"]
    r = _touch(hass, admin, 3, tablet="nowhere")
    assert r["success"] is False and r["error"] == "not_found"


async def test_a_page_from_before_names_its_screen(hass, frontend):
    """Files cached from before 1.14 send the screen's path: the tablet on
    that screen signed in as this user is the one."""
    await _add(hass, _hall())
    await hass.auth.async_create_user("Owner")
    tablet = Conn(await hass.auth.async_create_user("hall"))
    r = _touch(hass, tablet, tablet=None, dashboard="dashboard-hall")
    assert r["success"], r
    await hass.async_block_till_done()
    assert hass.states.get(INUSE).state == "on"


async def test_a_tablet_with_no_user_is_known_by_its_url(hass, frontend):
    """Just a Browser with no user of its own: any signed-in page that says it
    is the tablet (?hk_tablet=) may touch it."""
    await _add(hass, _hall(user=""))
    await hass.auth.async_create_user("Owner")
    shared = Conn(await hass.auth.async_create_user("family"))
    assert _touch(hass, shared)["success"]


# ------------------------------------------------------------ the settings feed
async def test_the_feed_names_each_tablets_switch(hass, frontend):
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.screensaver import manager
    await _add(hass, _hall())
    await _add(hass, ConfigSubentry(data={}, subentry_type="dashboard", title="Desk", unique_id="dashboard-desk"))
    ids = manager(hass).switch_ids()
    assert ids == {"hall": SW}
    client = S.as_client(entry(hass), switches=ids)
    t = client["tablet_items"]["hall"]
    assert t["screensaver_switch"] == SW and t["screen"] == "dashboard-hall" and t["user"] == "hall"
    assert t["idle_return"] is True and t["idle_time"] == 50, "All Tablets' Idle"
    assert client["boards"]["dashboard-hall"]["tablets"] == ["hall"]
    assert client["boards"]["dashboard-hall"]["idle_room"] == "hall", "Calm When Nobody's Around looks there"
    assert client["boards"]["dashboard-desk"]["tablets"] == []


async def test_a_renamed_switch_is_what_the_feed_names(hass, frontend):
    from custom_components.hk_frontend.screensaver import manager
    await _add(hass, _hall())
    er.async_get(hass).async_update_entity(SW, new_entity_id="switch.hall_photos")
    await hass.async_block_till_done(wait_background_tasks=True)
    assert manager(hass).switch_ids() == {"hall": "switch.hall_photos"}


async def test_a_renamed_tablet_renames_its_device(hass, frontend):
    from homeassistant.helpers import device_registry as dr
    from custom_components.hk_frontend.panel import ws_tablet_set
    hall = _hall()
    await _add(hass, hall)
    admin = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    ws_tablet_set(hass, admin, {"id": 1, "type": "hk_frontend/tablet/set", "tablet": "hall",
                                "changes": {"name": "Front Hall"}})
    assert admin.sent[-1]["success"], admin.sent[-1]
    await hass.async_block_till_done(wait_background_tasks=True)
    dev = dr.async_get(hass).async_get(er.async_get(hass).async_get(SW).device_id)
    from conftest import device_place
    assert dev.name == "Front Hall" and device_place(dev) == (entry(hass).entry_id, hall.tablet.subentry_id)
    assert hass.states.get(SW).name == "Front Hall Photo screensaver"
    assert entry(hass).subentries[hall.tablet.subentry_id].title == "Front Hall", "its item's title too"


async def test_nothing_it_does_is_reported_as_deprecated(hass, frontend, caplog):
    """HA 2027.8 turns these reports into errors: adding, renaming and
    removing a tablet's entities must not make any."""
    hall = _hall()
    await _add(hass, hall)
    await _change(hass, hall.tablet, name="Front Hall")
    hass.config_entries.async_remove_subentry(entry(hass), hall.tablet.subentry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert "Detected that custom integration 'hk_frontend'" not in caplog.text


# ------------------------------------------------------------ a new house, start to finish
async def test_a_new_house_gets_a_working_screensaver_without_making_anything(hass, frontend, monkeypatch):
    """The HACS path: add HK Frontend, add a Wall Tablet screen, turn on Photo
    Screensaver, and add the tablet that runs it (Wall Tablets -> Add Tablet)
    -- that is all. No helper, no room: the switch and In Use sensor are
    there, the screens are told the switch, and Setup Check is satisfied."""
    from types import SimpleNamespace
    from unittest.mock import patch
    from homeassistant.components import media_source
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    from custom_components.hk_frontend import settings as S, setup_check
    from custom_components.hk_frontend.panel import ws_board_set, ws_tablet_add
    from custom_components.hk_frontend.screensaver import manager
    from test_configure import _add

    # the dashboard as Lovelace has it, titled Kitchen (the harness has no Lovelace)
    hass.data[LOVELACE_DATA] = SimpleNamespace(
        dashboards={None: object(), "dashboard-kitchen": SimpleNamespace(config={"title": "Kitchen"})},
        resource_mode="storage", resources=SimpleNamespace(async_items=lambda: []))
    async def boards(_hass):
        return ["dashboard-kitchen"]
    with patch("custom_components.hk_frontend.config_flow._dashboards", boards):
        r = await _add(hass, "dashboard-kitchen", kind="wall_tablet")
    assert r["type"] == "create_entry"
    await hass.async_block_till_done(wait_background_tasks=True)
    assert manager(hass).switch_ids() == {}, "nothing yet: the screensaver is off"

    admin = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    await hass.auth.async_create_user("Kitchen Tablet")
    ws_board_set(hass, admin, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "dashboard-kitchen",
                               "changes": {"screensaver": True}})
    assert admin.sent[-1]["success"], admin.sent[-1]
    ws_tablet_add(hass, admin, {"id": 2, "type": "hk_frontend/tablet/add", "tablet": {
        "name": "Kitchen", "screen": "dashboard-kitchen", "user": "Kitchen Tablet"}})
    assert admin.sent[-1]["success"] and admin.sent[-1]["result"]["id"] == "kitchen", admin.sent[-1]
    await hass.async_block_till_done(wait_background_tasks=True)

    sw = hass.states.get("switch.kitchen_photo_screensaver")
    assert sw is not None and sw.state == "off" and sw.attributes["starts_after"] == 180
    assert hass.states.get("binary_sensor.kitchen_screen_in_use").state == "off"
    assert not hass.states.async_entity_ids("input_boolean"), "no helper was made or needed"
    t = S.as_client(entry(hass), switches=manager(hass).switch_ids())["tablet_items"]["kitchen"]
    assert t["screensaver_switch"] == "switch.kitchen_photo_screensaver" and t["room"] == ""


    async def browse(_hass, _id):
        return SimpleNamespace(children=[SimpleNamespace(media_class="image", media_content_type="image/jpeg",
                                                         can_expand=False)])
    monkeypatch.setattr(media_source, "async_browse_media", browse)
    lines = {x.title: x for x in await setup_check.async_run(hass, dict(entry(hass).options), S.boards(entry(hass)))}
    assert lines["Wall Tablets"].ok is True and "1 tablet" in lines["Wall Tablets"].detail
    assert lines["Screensaver Photos"].ok is True
    assert "WallPanel" not in lines, "nothing from HACS is asked for"


async def test_a_screen_following_all_screens_takes_its_timer_from_there(hass, frontend):
    """The one timer, for a screen whose Same as All Screens is on: Starts
    After (and so the In Use window) is All Screens'."""
    from custom_components.hk_frontend.panel import ws_settings_set
    await _add(hass, _hall({"screensaver_options": None}))
    assert hass.states.get(SW).attributes["starts_after"] == 180
    admin = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    ws_settings_set(hass, admin, {"id": 1, "type": "hk_frontend/settings/set",
                                  "changes": {"look.saver": {"starts_after": 300}}})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert admin.sent[-1]["success"], admin.sent[-1]
    sw = hass.states.get(SW)
    assert sw.attributes["starts_after"] == 300 and sw.attributes["in_use_window"] == 240


# ------------------------------------------------------------ the black screen (2026-10-09)
BLACK = "switch.hall_black_screen"


def _black(hass, conn, black, n=1, tablet="hall"):
    from custom_components.hk_frontend.screensaver import ws_black
    ws_black(hass, conn, {"id": n, "type": "hk_frontend/screensaver/black", "tablet": tablet, "black": black})
    return conn.sent[-1]


async def test_each_tablet_gets_a_black_screen_switch_naming_its_setting(hass, frontend):
    hall = _hall()
    await _add(hass, hall)
    b = hass.states.get(BLACK)
    assert b is not None and b.state == "off" and b.name == "Hall Black screen"
    assert b.attributes["black_screen"] == "kiosk", "Kiosk Satellite's black until the tablet chooses HK's"
    assert b.attributes["brightness"] is None and b.attributes["confirmed"] is False
    await _change(hass, hall.tablet, black_screen="hk")
    assert hass.states.get(BLACK).attributes["black_screen"] == "hk", "the scripts branch on it"
    hass.config_entries.async_remove_subentry(entry(hass), hall.tablet.subentry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.states.get(BLACK) is None, "goes with the tablet's other entities"


async def test_set_black_screen_carries_the_brightness_and_the_page_confirms(hass, frontend):
    await _add(hass, _hall(black_screen="hk"))
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True, "brightness": 174},
                                   blocking=True)
    b = hass.states.get(BLACK)
    assert b.state == "on" and b.attributes["brightness"] == 174 and b.attributes["confirmed"] is False
    tablet = Conn(await hass.auth.async_create_user("hall"))     # the screen's tablet user
    assert _black(hass, tablet, True)["success"]
    assert hass.states.get(BLACK).attributes["confirmed"] is True, "the page is black"
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "brightness": 40}, blocking=True)
    b = hass.states.get(BLACK)
    assert b.state == "on" and b.attributes["brightness"] == 40 and b.attributes["confirmed"] is True, \
        "a new wake brightness while black: still black, still confirmed"
    assert _black(hass, tablet, False, 2)["success"]
    assert hass.states.get(BLACK).state == "off", "a tap woke it on the tablet: the switch follows"
    await hass.services.async_call("switch", "turn_on", {"entity_id": BLACK}, blocking=True)
    assert hass.states.get(BLACK).attributes["confirmed"] is False, "every new black waits for the page again"


async def test_a_tap_wake_is_in_use_before_the_black_is_gone(hass, frontend):
    """The house's want sensor renders on the switch going off: in use must
    already be on then, or it reads "nobody here" and sleeps the tablet."""
    await _add(hass, _hall(black_screen="hk"))
    await hass.services.async_call("switch", "turn_on", {"entity_id": BLACK}, blocking=True)
    assert hass.states.get(INUSE).state == "off"
    seen = []

    @callback
    def _changed(ev):
        if ev.data["entity_id"] == BLACK and ev.data["new_state"].state == "off":
            seen.append(hass.states.get(INUSE).state)
    hass.bus.async_listen("state_changed", _changed)
    tablet = Conn(await hass.auth.async_create_user("hall"))
    assert _black(hass, tablet, False)["success"]
    assert seen == ["on"], "in use as the black went"
    assert _black(hass, tablet, False, 2)["success"]
    assert seen == ["on"], "an off switch is left alone"


async def test_only_the_screens_tablet_or_an_admin_may_say_it_is_black(hass, frontend):
    await _add(hass, _hall(black_screen="hk"))
    await hass.auth.async_create_user("Owner")
    desk = Conn(await hass.auth.async_create_user("desk"))
    await hass.services.async_call("switch", "turn_on", {"entity_id": BLACK}, blocking=True)
    r = _black(hass, desk, False)
    assert r["success"] is False and r["error"] == "unauthorized"
    assert hass.states.get(BLACK).state == "on"
    admin = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    assert _black(hass, admin, True, 2)["success"]
    r = _black(hass, admin, True, 3, tablet="nowhere")
    assert r["success"] is False and r["error"] == "not_found"


async def test_the_feed_names_each_tablets_black_switch(hass, frontend):
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.screensaver import manager
    await _add(hass, _hall())
    ids = manager(hass).black_ids()
    assert ids == {"hall": BLACK}
    client = S.as_client(entry(hass), switches=manager(hass).switch_ids(), blacks=ids)
    assert client["tablet_items"]["hall"]["black_switch"] == BLACK
    assert client["tablet_items"]["hall"]["black_screen"] == "kiosk"
    assert "black_screen" not in client["boards"]["dashboard-hall"], "the tablet's, not the screen's"


async def test_black_screen_is_kiosk_or_hk_only(hass, frontend):
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_tablet
    assert S.tablet({"black_screen": "hk"})["black_screen"] == "hk"
    assert S.tablet({"black_screen": "fully"})["black_screen"] == "kiosk", "anything else is the default"
    data, err = apply_tablet({}, {"black_screen": "hk"}, "hall")
    assert err == {} and data["black_screen"] == "hk"
    _, err = apply_tablet({}, {"black_screen": "both"}, "hall")
    assert err == {"black_screen": "choice"}


# ------------------------------------------------------------ lifted off a screen (1.14)
async def test_a_tablet_lifted_off_its_screen_keeps_its_entities(hass, base, caplog):
    """An entry from 1.13: the hall SCREEN was the tablet. Its entities were
    the screen's item's; after the migration they are the tablet's, with the
    same unique ids -- so the same entity ids and history."""
    from conftest import house_entry
    from custom_components.hk_frontend import settings as S
    from homeassistant.helpers import device_registry as dr
    old = house_entry({"subentry_type": "dashboard", "unique_id": "dashboard-hall", "title": "Hall",
                       "data": {"screensaver": True, "tablet_user": "hall", "idle_room": "hall",
                                "idle_return": True, "black_screen": "hk"}}, minor_version=13)
    old.add_to_hass(hass)
    screen = next(iter(old.subentries.values()))
    # the entities as 1.13 made them: on the screen's item and device
    reg, devs = er.async_get(hass), dr.async_get(hass)
    dev = devs.async_get_or_create(config_entry_id=old.entry_id, config_subentry_id=screen.subentry_id,
                                   identifiers={(DOMAIN, f"{old.entry_id}_dashboard-hall")}, name="Hall")
    reg.async_get_or_create("switch", DOMAIN, f"{old.entry_id}_dashboard-hall_black_screen",
                            config_entry=old, config_subentry_id=screen.subentry_id, device_id=dev.id,
                            suggested_object_id="hall_black_screen")
    assert await hass.config_entries.async_setup(old.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert old.minor_version == 16
    tabs = S.tablets(old)
    assert list(tabs) == ["hall"]
    t = tabs["hall"]
    assert (t["name"], t["screen"], t["user"], t["uid"], t["black_screen"]) == \
        ("Hall", "dashboard-hall", "hall", "dashboard-hall", "hk")
    assert "tablet_user" not in old.subentries[screen.subentry_id].data
    tsub = next(s for s in old.subentries.values() if s.subentry_type == "tablet")
    ent = reg.async_get("switch.hall_black_screen")
    assert ent is not None and ent.unique_id == f"{old.entry_id}_dashboard-hall_black_screen"
    assert ent.config_subentry_id == tsub.subentry_id, "moved to the tablet's item"
    assert hass.states.get("switch.hall_black_screen") is not None
    dev = devs.async_get(dev.id)
    assert dev.config_entries_subentries[old.entry_id] == {tsub.subentry_id}, "the device is the tablet's alone"
    assert "Detected that custom integration 'hk_frontend'" not in caplog.text, "nothing deprecated (HA 2026.10)"
