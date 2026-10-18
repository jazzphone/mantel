"""The settings page's writes (settings_api.py + panel.py): only
what changed, checked the way Configure checks it, refused by field -- never
quietly turned into a default -- and stored exactly where Configure stores
it, so the two surfaces stay one source of truth."""
from __future__ import annotations

import json

from pytest_homeassistant_custom_component.common import MockUser  # noqa: F401  (harness import order)

from conftest import entry
from custom_components.hk_frontend import settings as S
from test_accessories import Conn as _Conn

DOMAIN = "hk_frontend"


class Conn(_Conn):
    """Keeps the refusal's message too (the field -> reason map)."""

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "type": "result", "success": False, "error": code,
                          "message": message})


async def _admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


# ------------------------------------------------------------ what it covers
def test_every_screen_setting_can_be_written():
    from custom_components.hk_frontend import settings as S, settings_api as A
    assert set(A.BOARD) == set(S.BOARD_DEFAULTS), set(A.BOARD) ^ set(S.BOARD_DEFAULTS)


def test_every_house_setting_a_person_can_change_can_be_written():
    """Every stored house key but the older lists the house cannot set
    (read only while Status & Chips is unsaved), the menu's pre-item lists, the
    idle/car lists derived from the screens, and the retired house-wide Parts
    switches (generated.chips ... -- each screen's own setting)."""
    from custom_components.hk_frontend import settings as S, settings_api as A
    legacy = {"security.garage", "security.locks", "security.doors", "security.windows",
              "features.thermostats", "idle.dashboards", "idle.rooms", "idle.default", "car.dashboards", "car.widths",
              *(f"menu.{k}" for k in S.DEFAULTS["menu"] if k not in ("glyph", "clock")),
              *(f"generated.{k}" for k in ("chips", "pages", "sky", "music", "rooms"))}
    dates = {f"sky.{k}" for k in S.SKY_DATES}
    stored = {f"{sec}.{k}" for sec, vals in S.DEFAULTS.items() for k in vals}
    missing = stored - legacy - dates - set(A.HOUSE)
    assert not missing, missing
    assert all(A.SKY_DATE.match(d) for d in dates)


# ------------------------------------------------------------ the house
def test_house_changes_are_checked_and_merged():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house
    opts = {"dashboard": {"look": {"glass": "clear", "frost": 30}}, "files_folder": "hk_local"}
    new, err = apply_house(opts, {"look.glass": "blur", "weather.place": "  HOME  ", "sidebar": False,
                                  "features.house_timers": ["timer.nap", "timer.nap", "timer.bed"]})
    assert err == {}
    m = S.merged(new)
    assert m["look"]["glass"] == "blur" and m["look"]["frost"] == 30, "the rest of the section kept"
    assert m["weather"]["place"] == "HOME" and new["sidebar"] is False and new["files_folder"] == "hk_local"
    assert m["features"]["house_timers"] == ["timer.nap", "timer.bed"]
    # refused by field, and nothing at all is written
    same, err = apply_house(opts, {"look.glass": "wobbly", "security.alarm": "light.kitchen",
                                   "look.frost": 140, "nope.nope": 1, "look.details": True})
    assert err == {"look.glass": "choice", "security.alarm": "entity", "look.frost": "amount",
                   "nope.nope": "unknown"}
    assert same == opts


def test_empty_means_automatic_not_an_error():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house
    new, err = apply_house({}, {"security.alarm": None, "weather.place": "", "look.photos": "",
                                "look.browse_view": "/music-browse/"})
    assert err == {}
    m = S.merged(new)
    assert m["security"]["alarm"] is None and m["weather"]["place"] is None
    assert m["look"]["photos"] == S.DEFAULTS["look"]["photos"], "empty photos folder is the default"
    assert m["look"]["browse_view"] == "music-browse"


def test_sky_dates_store_none_for_the_built_in_date():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house
    new, err = apply_house({}, {"sky.halloween_from": "09-22", "sky.christmas_from": "12-1",
                                "sky.thanksgiving_to": "Thanksgiving Day"})
    assert err == {}
    sky = S.merged(new)["sky"]
    assert sky["halloween_from"] is None and sky["christmas_from"] == "12-01" and sky["thanksgiving_to"] is None
    _, err = apply_house({}, {"sky.halloween_to": "Thanksgiving Day", "sky.spring_from": "13-40"})
    assert err == {"sky.halloween_to": "date", "sky.spring_from": "date"}
    # the hemisphere in the same change moves what "built in" is
    new, err = apply_house({}, {"sky.hemisphere": "south", "sky.spring_from": "09-22"})
    assert err == {} and S.merged(new)["sky"]["spring_from"] is None


def test_birthdays_themes_and_ordered_lists():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house
    new, err = apply_house({}, {
        "sky.birthdays": [{"name": "Alex", "month": 11, "day": 20}, {"name": "Emma", "month": 3, "day": 14}],
        "sky.themes": ["christmas", "halloween"],
        "browse.discover": ["most_played", "recently_played", "most_played"],
        "browse.hide": ["tracks", "artists"], "rooms.status": ["locks", "temperature"]})
    assert err == {}
    m = S.merged(new)
    assert [b["name"] for b in m["sky"]["birthdays"]] == ["Emma", "Alex"], "in date order"
    assert m["sky"]["themes"] == ["halloween", "christmas"], "in the house's order"
    assert m["browse"]["discover"] == ["most_played", "recently_played"], "in the order given"
    assert m["browse"]["hide"] == ["artists", "tracks"]
    assert m["rooms"]["status"] == ["locks", "temperature"], "a room's row in the house's own order"

    _, err = apply_house({}, {"sky.birthdays": [{"name": "", "month": 1, "day": 1}],
                              "browse.discover": ["stations_for_you"]})
    assert set(err) == {"sky.birthdays", "browse.discover"}


def test_saving_one_kind_retires_only_its_old_list():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house
    opts = {"dashboard": {"security": {"locks": ["lock.a"], "doors": ["binary_sensor.d"]}}}
    new, err = apply_house(opts, {"counts.locks": {"exclude": ["lock.b"], "include": []}})
    assert err == {}
    m = S.merged(new)
    assert m["counts"]["locks"] == {"exclude": ["lock.b"], "include": []}
    assert m["security"]["locks"] == [] and m["security"]["doors"] == ["binary_sensor.d"]
    assert m["counts"]["doors"] is None, "an untouched kind stays automatic"
    new, err = apply_house(new, {"counts.locks": None})
    assert err == {} and S.merged(new)["counts"]["locks"] is None


# ------------------------------------------------------------ one screen
def test_frost_tint_is_off_by_default_and_a_house_switch():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house
    m = S.merged({"dashboard": {}})
    assert m["look"]["frost_tint"] is False, "off until somebody turns it on"
    new, err = apply_house({}, {"look.frost_tint": True})
    assert err == {} and S.merged(new)["look"]["frost_tint"] is True
    _, err = apply_house({}, {"look.frost_tint": "on"})
    assert "look.frost_tint" in err
    assert S.board({"frost_tint": 1})["frost_tint"] is None, "a stored non-boolean follows All Screens"
    assert S.board({"frost_tint": False})["frost_tint"] is False


def test_screen_changes_are_checked_not_defaulted():
    from custom_components.hk_frontend.settings_api import apply_board
    data, err = apply_board({"menu": "chip"}, {"menu": "open", "dock_min": 1100, "frost": 30,
                                               "chips": ["lights", "sensor.mail"], "tab_position": "140"})
    assert err == {}
    assert data["menu"] == "open" and data["dock_min"] == 1100 and data["frost"] == 30
    assert data["chips"] == ["lights", "sensor.mail"] and data["tab_position"] == "140px"
    data, err = apply_board(data, {"frost": None, "glass": "house"})
    assert err == {} and data["frost"] is None, "None follows the house again"
    # Tint from Background: a screen's own on or off, None follows All Screens
    data, err = apply_board(data, {"frost_tint": True})
    assert err == {} and data["frost_tint"] is True
    data, err = apply_board(data, {"frost_tint": None})
    assert err == {} and data["frost_tint"] is None
    _, err = apply_board(data, {"frost_tint": "yes"})
    assert "frost_tint" in err, "only a boolean or None"
    same, err = apply_board(data, {"tab_position": "somewhere", "idle_room": "living_room",
                                   "menu": "sideways", "chips": ["spaceships"], "wallpanel_options": [1],
                                   "whatever": 1})
    assert err == {"tab_position": "tab_position", "idle_room": "unknown", "menu": "choice",
                   "chips": "choice", "wallpanel_options": "card_options", "whatever": "unknown"}, \
        "a tablet's room is the tablet's own since 1.14"
    assert same == data


def test_the_screensaver_options_and_engine_are_checked():
    from custom_components.hk_frontend.settings import board
    from custom_components.hk_frontend.settings_api import apply_board
    from custom_components.hk_frontend.settings import SAVER_DEFAULTS
    data = board({"screensaver": True})
    assert data["screensaver_options"] is None, "a new screen follows All Screens"
    got, err = apply_board(data, {"screensaver_options": dict(SAVER_DEFAULTS, each_photo=60, zoom=True)})
    assert err == {} and got["screensaver_options"]["each_photo"] == 60 and got["screensaver_options"]["zoom"] is True
    got, err = apply_board(got, {"screensaver_engine": "wallpanel"})
    assert err == {} and got["screensaver_engine"] == "wallpanel"
    same, err = apply_board(got, {"screensaver_options": {"each_photo": 1}, "screensaver_engine": "x"})
    assert err == {"screensaver_options": "saver_options", "screensaver_engine": "choice"} and same == got
    back, err = apply_board(got, {"screensaver_options": None})
    assert err == {} and back["screensaver_options"] is None, "Same as All Screens again: null is stored"


def test_the_kiosk_settings_are_checked():
    from custom_components.hk_frontend.settings import board
    from custom_components.hk_frontend.settings_api import apply_board
    got, err = apply_board(board({}), {"kiosk": True, "kiosk_header": False, "kiosk_admins": False})
    assert err == {} and got["kiosk"] and got["kiosk_header"] is False and got["kiosk_sidebar"] is True and \
        got["kiosk_admins"] is False and got["kiosk_engine"] == "hk"
    got, err = apply_board(got, {"kiosk_engine": "kiosk_mode"})
    assert err == {} and got["kiosk_engine"] == "kiosk_mode"
    same, err = apply_board(got, {"kiosk_engine": "plugin", "kiosk_sidebar": "yes"})
    assert set(err) == {"kiosk_engine", "kiosk_sidebar"} and same == got


async def test_the_commands_write_what_configure_reads(hass, frontend):
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_board_set, ws_settings_set
    conn = await _admin(hass)
    ws_settings_set(hass, conn, {"id": 1, "type": "hk_frontend/settings/set",
                                 "changes": {"look.glass": "frosted", "look.frost": 70}})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert conn.sent[-1]["success"], conn.sent[-1]
    look = S.merged(entry(hass).options)["look"]
    assert look["glass"] == "frosted" and look["frost"] == 70
    ws_settings_set(hass, conn, {"id": 2, "type": "hk_frontend/settings/set",
                                 "changes": {"look.glass": "frosted", "menu.glyph": "hamburger"}})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert conn.sent[-1]["error"] == "invalid_format"
    assert json.loads(conn.sent[-1]["message"]) == {"menu.glyph": "choice"}

    ws_board_set(hass, conn, {"id": 3, "type": "hk_frontend/board/set", "dashboard": "dashboard-hall",
                              "changes": {"menu": "open"}})
    assert conn.sent[-1]["error"] == "no_item"
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall"))
    ws_board_set(hass, conn, {"id": 4, "type": "hk_frontend/board/set", "dashboard": "dashboard-hall",
                              "changes": {"glass": "blur"}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    client = S.as_client(entry(hass))
    assert client["boards"]["dashboard-hall"]["glass"] == "blur"


async def test_only_admins_write(hass, frontend):
    import pytest
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend.panel import ws_board_set, ws_settings_set
    await hass.auth.async_create_user("Owner")          # the first user is the owner, an admin
    tablet = Conn(await hass.auth.async_create_user("kitchen"))
    with pytest.raises(Unauthorized):
        ws_board_set(hass, tablet, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "x", "changes": {}})
    with pytest.raises(Unauthorized):
        ws_settings_set(hass, tablet, {"id": 2, "type": "hk_frontend/settings/set", "changes": {}})


async def test_the_page_reads_what_it_lays_out(hass, frontend):
    from custom_components.hk_frontend.panel import ws_panel_get, ws_setup_check
    hass.states.async_set("lock.front", "locked")
    conn = await _admin(hass)
    ws_panel_get(hass, conn, {"id": 1, "type": "hk_frontend/panel/get"})
    await hass.async_block_till_done(wait_background_tasks=True)
    r = conn.sent[-1]["result"]
    for k in ("counts", "users", "integration", "thirdparty", "choices"):
        assert k in r, k
    assert r["counts"]["locks"]["auto"] == ["lock.front"] and r["counts"]["locks"]["saved"] is False
    from custom_components.hk_frontend import settings as S
    assert r["choices"]["sky_backdrops"] == list(S.SKY_BACKDROPS)
    assert r["integration"]["sidebar"] is True and "files" in r["integration"]
    ws_setup_check(hass, conn, {"id": 2, "type": "hk_frontend/setup/check"})
    await hass.async_block_till_done(wait_background_tasks=True)
    lines = conn.sent[-1]["result"]["lines"]
    assert lines and {"ok", "title", "detail"} <= set(lines[0])


# ------------------------------------------------------------ each settings page
# (what each page of settings does, through the page's own write)
async def _set(hass, changes):
    from custom_components.hk_frontend.panel import ws_settings_set
    conn = await _admin(hass)
    ws_settings_set(hass, conn, {"id": 1, "type": "hk_frontend/settings/set", "changes": changes})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


async def _screen(hass):
    from custom_components.hk_frontend import ws_settings_subscribe
    from conftest import FakeConnection
    conn = FakeConnection(None)
    ws_settings_subscribe(hass, conn, {"id": 7})
    return conn


async def test_general_what_the_house_has(hass, frontend):
    from custom_components.hk_frontend import settings as S
    r = await _set(hass, {"security.alarm": "alarm_control_panel.home", "features.temperature": "sensor.house",
                          "features.power": "sensor.power", "features.house_timers": ["timer.nap"]})
    assert r["success"], r
    m = S.merged(entry(hass).options)
    assert m["security"]["alarm"] == "alarm_control_panel.home"
    assert (m["features"]["temperature"], m["features"]["power"], m["features"]["house_timers"]) == (
        "sensor.house", "sensor.power", ["timer.nap"])


async def test_a_house_that_never_chose_an_alarm_is_offered_one(hass, frontend):
    from custom_components.hk_frontend.panel import ws_panel_get
    hass.states.async_set("alarm_control_panel.home", "disarmed")
    conn = await _admin(hass)
    ws_panel_get(hass, conn, {"id": 1, "type": "hk_frontend/panel/get"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert conn.sent[-1]["result"]["suggest"] == {"alarm": "alarm_control_panel.home"}
    await _set(hass, {"security.alarm": None})
    ws_panel_get(hass, conn, {"id": 2, "type": "hk_frontend/panel/get"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert conn.sent[-1]["result"]["suggest"] == {}, "chosen (even none): no more offers"


async def test_what_counts_offers_the_old_list_then_saving_a_kind_keeps_the_rest(hass, frontend):
    from custom_components.hk_frontend.panel import ws_panel_get
    for eid, dc in (("binary_sensor.front_door", "door"), ("binary_sensor.garage_entry", "door")):
        hass.states.async_set(eid, "off", {"device_class": dc})
    hass.config_entries.async_update_entry(entry(hass), options={"dashboard": {
        "security": {"alarm": "alarm_control_panel.home", "doors": ["binary_sensor.front_door"]},
        "features": {"temperature": "sensor.house"}}})
    await hass.async_block_till_done()
    conn = await _admin(hass)
    ws_panel_get(hass, conn, {"id": 1, "type": "hk_frontend/panel/get"})
    await hass.async_block_till_done(wait_background_tasks=True)
    doors = conn.sent[-1]["result"]["counts"]["doors"]
    assert doors["exclude"] == ["binary_sensor.garage_entry"] and doors["saved"] is False, "the old list, as a difference"
    assert doors["found"] == ["binary_sensor.front_door"]
    await _set(hass, {"counts.doors": {"exclude": doors["exclude"], "include": []}})
    d = S.merged(entry(hass).options)
    assert d["security"]["doors"] == [] and d["security"]["alarm"] == "alarm_control_panel.home"
    assert d["features"]["temperature"] == "sensor.house"


async def test_weather_and_the_radar_options(hass, frontend):
    from custom_components.hk_frontend import settings as S
    r = await _set(hass, {"weather.entity": "weather.home", "weather.place": "HOME · SPRINGFIELD",
                          "weather.gust": "sensor.gust"})
    assert r["success"]
    w = S.merged(entry(hass).options)["weather"]
    assert (w["entity"], w["place"], w["gust"], w["feels_like"], w["radar"]) == (
        "weather.home", "HOME · SPRINGFIELD", "sensor.gust", None, {})
    r = await _set(hass, {"weather.radar": ["zoom_level", 7]})
    assert r["success"] is False and json.loads(r["message"]) == {"weather.radar": "card_options"}
    await _set(hass, {"weather.radar": {"zoom_level": 7, "data_source": "RainViewer"}})
    assert S.merged(entry(hass).options)["weather"]["radar"] == {"zoom_level": 7, "data_source": "RainViewer"}
    assert "sky" not in entry(hass).options["dashboard"], "only what changed"


async def test_the_sky_how_often_and_the_themes(hass, frontend):
    from custom_components.hk_frontend import settings as S
    r = await _set(hass, {"sky.halloween_often": "every_day", "sky.spooky_often": "never",
                          "sky.space_per_month": "2", "sky.themes": [t for t in S.THEMES if t not in (
                              "thanksgiving", "storybook-magic")], "sky.decorations": False})
    assert r["success"]
    sky = S.merged(entry(hass).options)["sky"]
    assert (sky["halloween_often"], sky["spooky_often"], sky["space_per_month"]) == ("every_day", "never", "2")
    assert "thanksgiving" not in sky["themes"] and "halloween" in sky["themes"] and sky["decorations"] is False
    r = await _set(hass, {"sky.halloween_often": "hourly"})
    assert r["success"] is False
    await _set(hass, {"sky.halloween_often": None})
    assert S.merged(entry(hass).options)["sky"]["halloween_often"] is None, "back to built in"


async def test_advanced_the_clock_and_the_escape_hatches(hass, frontend):
    await _set(hass, {"clock.time": "sensor.time", "clock.date": None,
                      "features.vacuum_script": "script.clean"})
    d = S.merged(entry(hass).options)
    assert d["clock"] == {"time": "sensor.time", "date": None}, "empty: the screen's own clock"
    assert entry(hass).options["dashboard"]["clock"] == {"date": None}, \
        "stored: only what differs from the default (sensor.time is the default)"
    assert d["features"]["vacuum_script"] == "script.clean"
    assert d["features"]["alarm_bad_code"] is None and "look" not in entry(hass).options["dashboard"]


async def test_the_glass_and_its_amounts_reach_every_screen(hass, frontend):
    screen = await _screen(hass)
    look = screen.sent[-1]["event"]["look"]
    assert (look["glass"], look["frost"], look["blur"]) == ("clear", 50, 50)
    await _set(hass, {"look.glass": "blur_each", "look.blur": 80})
    look = S.merged(entry(hass).options)["look"]
    assert (look["glass"], look["blur"], look["frost"]) == ("blur_each", 80, 50)
    assert "frost" not in entry(hass).options["dashboard"]["look"], "a default is not stored: a later default reaches it"
    assert screen.sent[-1]["event"]["look"]["blur"] == 80, "screens were told"
    r = await _set(hass, {"look.glass": "sparkly"})
    assert r["success"] is False and entry(hass).options["dashboard"]["look"]["glass"] == "blur_each"
    # Pre-rendered (2026-10-10): stored like any other glass, for All Screens and a screen
    await _set(hass, {"look.glass": "blur_pre"})
    assert entry(hass).options["dashboard"]["look"]["glass"] == "blur_pre"
    assert screen.sent[-1]["event"]["look"]["glass"] == "blur_pre", "screens were told"
    # Tinted (2026-10-12), its darkness and icon circles
    await _set(hass, {"look.glass": "tinted", "look.tint": 70, "look.well": "light"})
    look = entry(hass).options["dashboard"]["look"]
    assert (look["glass"], look["tint"], look["well"]) == ("tinted", 70, "light")
    assert screen.sent[-1]["event"]["look"]["well"] == "light", "screens were told"
    assert (await _set(hass, {"look.well": "neon"}))["success"] is False
    assert (await _set(hass, {"look.tint": 101}))["success"] is False


async def test_music_categories_rows_and_the_browse_page(hass, frontend):
    screen = await _screen(hass)
    await _set(hass, {"browse.hide": ["podcasts", "audiobooks", "artists"],
                      "browse.discover": ["favourite_songs", "recent_artists", "favourite_songs"],
                      "look.browse_view": "/tunes/"})
    d = entry(hass).options["dashboard"]
    assert d["browse"]["hide"] == ["artists", "podcasts", "audiobooks"]
    assert d["browse"]["discover"] == ["favourite_songs", "recent_artists"] and d["look"]["browse_view"] == "tunes"
    sent = screen.sent[-1]["event"]["browse"]
    assert [r["title"] for r in sent["discover"]] == ["Favorite songs", "Recently played artists"], "sent as queries"
    await _set(hass, {"browse.discover": []})
    assert screen.sent[-1]["event"]["browse"]["discover"] == [], "none: no Discover section"
    r = await _set(hass, {"browse.discover": ["top_40"]})
    assert r["success"] is False


async def test_hidden_from_screens_and_the_retired_parts(hass, frontend):
    """Leave out / Also show (Accessories on the page). The house-wide Parts
    (chips, pages, sky, music, rooms) are retired: not sent, not writable,
    and dropped from storage the next time the section is written."""
    from custom_components.hk_frontend import settings as S
    hass.config_entries.async_update_entry(entry(hass), options={"dashboard": {"generated": {
        "exclude_areas": [], "chips": True, "pages": True, "sky": True, "music": True, "rooms": True}}})
    assert S.merged(entry(hass).options)["generated"] == {
        "exclude_areas": [], "exclude_devices": [], "exclude_entities": [], "include_entities": []}
    r = await _set(hass, {"generated.pages": False})
    assert r["success"] is False and json.loads(r["message"]) == {"generated.pages": "unknown"}
    await _set(hass, {"generated.exclude_areas": ["garage"], "generated.exclude_devices": ["dev1"],
                      "generated.include_entities": ["scene.movie"]})
    g = entry(hass).options["dashboard"]["generated"]
    assert g == {"exclude_areas": ["garage"], "exclude_devices": ["dev1"], "include_entities": ["scene.movie"]}, \
        "stored: what was set, not the defaults beside it"


async def test_menu_and_rooms(hass, frontend):
    from custom_components.hk_frontend.settings import as_client
    await _set(hass, {"menu.glyph": "lines", "menu.clock": False, "rooms.headings": False,
                      "rooms.status": ["motion", "temperature"], "rooms.order": ["kitchen", "office"],
                      "rooms.home": "only", "rooms.menu": "order"})
    d = entry(hass).options["dashboard"]
    assert d["menu"]["glyph"] == "lines" and d["menu"]["clock"] is False
    assert {k: d["rooms"][k] for k in ("headings", "status", "order", "home", "menu")} == {
        "headings": False, "status": ["motion", "temperature"], "order": ["kitchen", "office"], "home": "only",
        "menu": "order"}, "the status row in the order chosen"
    c = as_client(entry(hass))
    assert c["menu"]["clock"] is False and c["rooms"]["headings"] is False


async def test_a_screens_own_card_options(hass, frontend):
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend.panel import ws_board_set
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall"))
    conn = await _admin(hass)
    ws_board_set(hass, conn, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "dashboard-hall", "changes": {
        "wallpanel_options": {"idle_time": 300}, "kiosk_options": {"admin_settings": {"hide_header": False}},
        "car": True, "categories": ["security", "playmusic"]}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    d = next(iter(entry(hass).subentries.values())).data
    assert d["wallpanel_options"] == {"idle_time": 300} and d["kiosk_options"] == {"admin_settings": {"hide_header": False}}
    assert d["categories"] == ["security", "playmusic"] and d["car"] is True


def test_home_page_off_is_a_screen_of_custom_pages():
    from custom_components.hk_frontend import settings as S, settings_api as A
    assert S.board({})["home_page"] is True
    assert S.board({"home_page": False})["home_page"] is False
    data, err = A.apply_board({}, {"home_page": False})
    assert err == {} and data["home_page"] is False
    data, err = A.apply_board(data, {"home_page": "sometimes"})
    assert "home_page" in err


def test_phones_button_and_the_top_of_the_menu():
    """Phones' button style (the narrow choice's successor, 1.12) and the
    pages at the top of the menu: checked, not defaulted; "-" is "nothing at
    the top"; the retired narrow choice is refused."""
    from custom_components.hk_frontend.settings import board
    from custom_components.hk_frontend.settings_api import apply_board
    data, err = apply_board({}, {"button_phone": "chip_scroll", "menu_top": ["weather", "energy", "energy"]})
    assert err == {} and data["button_phone"] == "chip_scroll" and data["menu_top"] == ["weather", "energy"]
    data, err = apply_board(data, {"menu_top": ["-"]})
    assert err == {} and data["menu_top"] == ["-"], "nothing at the top"
    _, err = apply_board(data, {"button_phone": "tabbar", "menu_top": ["no spaces please"], "narrow": "tab"})
    assert err == {"button_phone": "choice", "menu_top": "list", "narrow": "unknown"}
    b = board({"button_phone": "hover", "menu_top": ["ok", "Not Ok!", 3]})
    assert b["button_phone"] == "chip" and b["menu_top"] == ["ok", "3"], "read defensively (a view index is a path)"
    assert board({})["button_phone"] == "chip" and board({})["menu_top"] == []


def test_the_swipe_is_saved_for_a_screen_and_for_all_screens():
    from custom_components.hk_frontend.settings_api import apply_board, apply_house
    data, err = apply_board({}, {"swipe": True, "menu": "none", "button_phone": "none"})
    assert err == {} and (data["swipe"], data["menu"], data["button_phone"]) == (True, "none", "none")
    _, err = apply_board({}, {"swipe": "sometimes"})
    assert "swipe" in err
    out, err = apply_house({}, {"menu.swipe": True, "menu.style": "none"})
    assert err == {}
    menu = out["dashboard"]["menu"]
    assert (menu["swipe"], menu["style"]) == (True, "none")


async def test_the_page_knows_which_features_the_house_has(hass, frontend):
    """Features: each one's entries -- the page lists a page for each one
    added, and offers Add for one that is not. Always installed (they are
    part of the integration)."""
    from custom_components.hk_frontend.panel import ws_panel_get
    from conftest import add_feature
    conn = await _admin(hass)
    ws_panel_get(hass, conn, {"id": 1, "type": "hk_frontend/panel/get"})
    await hass.async_block_till_done(wait_background_tasks=True)
    f = conn.sent[-1]["result"]["features"]
    assert set(f) == {"hk_music", "hk_alarm_pin", "hk_clean_areas", "hk_tv", "hk_energy", "hk_notify"}
    assert f["hk_clean_areas"] == {"name": "Clean Areas", "kind": "clean_areas", "installed": True, "entries": []}
    await add_feature(hass, "clean_areas", {})
    ws_panel_get(hass, conn, {"id": 2, "type": "hk_frontend/panel/get"})
    await hass.async_block_till_done(wait_background_tasks=True)
    ca = conn.sent[-1]["result"]["features"]["hk_clean_areas"]
    assert [e["title"] for e in ca["entries"]] == ["Clean Areas"]


async def test_a_change_made_while_the_folder_is_checked_is_kept(hass, frontend):
    """settings/set with the files folder waits on the folder check (a slow
    disk); another setting written meanwhile must survive (it was overwritten
    with its old value, and both writes answered success)."""
    import asyncio
    import time
    from unittest.mock import patch
    from conftest import entry
    from test_accessories import _admin
    from custom_components.hk_frontend import files, settings as S
    from custom_components.hk_frontend.panel import ws_settings_set
    real = files.validate_folder

    def slow(*a):
        time.sleep(0.3)
        return real(*a)
    conn = await _admin(hass)
    with patch.object(files, "validate_folder", slow):
        ws_settings_set(hass, conn, {"id": 1, "type": "hk_frontend/settings/set",
                                     "changes": {"files_folder": "hk_local", "look.frost": 30}})
        await asyncio.sleep(0.05)
        ws_settings_set(hass, conn, {"id": 2, "type": "hk_frontend/settings/set", "changes": {"look.blur": 70}})
        await asyncio.sleep(0.5)
        # both writes are background tasks (async_response): wait for them,
        # not for the sleep to outlast the slow one
        await hass.async_block_till_done(wait_background_tasks=True)
    look = S.merged(entry(hass).options)["look"]
    assert look["blur"] == 70 and look["frost"] == 30, look


async def test_a_screen_home_can_be_a_custom_page(hass, frontend):
    """A screen's Home: "" (the generated one) or a custom page's address --
    a car's own first page over the generated category pages."""
    import json
    from homeassistant.config_entries import ConfigSubentry
    from conftest import entry
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_board_set
    conn = await _admin(hass)
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Car", unique_id="dashboard-car"))
    assert S.as_client(entry(hass))["boards"]["dashboard-car"]["home_view"] == "", "the generated Home by default"
    ws_board_set(hass, conn, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                              "changes": {"home_view": "car-home"}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    assert S.as_client(entry(hass))["boards"]["dashboard-car"]["home_view"] == "car-home"
    ws_board_set(hass, conn, {"id": 2, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                              "changes": {"home_view": "Not A Path!"}})
    assert conn.sent[-1]["error"] == "invalid_format"
    assert json.loads(conn.sent[-1]["message"]) == {"home_view": "choice"}
    ws_board_set(hass, conn, {"id": 3, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                              "changes": {"home_view": ""}})
    assert S.as_client(entry(hass))["boards"]["dashboard-car"]["home_view"] == ""


async def test_a_car_screen_has_its_layout_and_scale(hass, frontend):
    """Car Browser's Car Layout (the whole Home or the car's own) and Scale
    (the layout width tesla-viewport.js zooms to: a preset or any width in
    bounds), sent to every screen as car.widths."""
    import json
    from homeassistant.config_entries import ConfigSubentry
    from conftest import entry
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_board_set
    conn = await _admin(hass)
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Car", unique_id="dashboard-car"))
    b = S.as_client(entry(hass))["boards"]["dashboard-car"]
    assert b["car_layout"] == "home" and b["car_width"] is None, "the whole Home and the default width by default"
    ws_board_set(hass, conn, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                              "changes": {"car": True, "car_layout": "car", "car_width": 1350}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    c = S.as_client(entry(hass))
    assert c["boards"]["dashboard-car"]["car_layout"] == "car" and c["boards"]["dashboard-car"]["car_width"] == 1350
    assert c["car"]["dashboards"] == ["dashboard-car"] and c["car"]["widths"] == {"dashboard-car": 1350}
    for bad, code in ((99999, "car_width"), ("wide", "car_width"), ):
        ws_board_set(hass, conn, {"id": 2, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                                  "changes": {"car_width": bad}})
        assert json.loads(conn.sent[-1]["message"]) == {"car_width": code}, conn.sent[-1]
    ws_board_set(hass, conn, {"id": 3, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                              "changes": {"car_layout": "sideways"}})
    assert json.loads(conn.sent[-1]["message"]) == {"car_layout": "choice"}
    ws_board_set(hass, conn, {"id": 4, "type": "hk_frontend/board/set", "dashboard": "dashboard-car",
                              "changes": {"car_width": None, "car": False}})
    c = S.as_client(entry(hass))
    assert c["boards"]["dashboard-car"]["car_width"] is None and c["car"]["widths"] == {}


def test_copy_settings_covers_every_screen_setting_and_round_trips():
    """Copy Settings From (hk-settings-model.js COPY_GROUPS): every screen
    setting is in a group or deliberately never copied -- a setting added
    later must choose -- and what one screen has, another accepts."""
    import os
    import re
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_board
    from conftest import COMPONENT          # the component, in either layout (repo or /config)
    src = open(os.path.join(COMPONENT, "frontend", "panels", "hk-settings-model.js")).read()
    groups = src[src.index("var COPY_GROUPS = ["):src.index("function copyDefaults")]
    keys = set(re.findall(r"'([a-z_]+)'", groups.split("];")[0])) | set(
        re.findall(r"'([a-z_]+)'", groups[groups.index("COPY_NEVER"):]))
    labels = {"menu", "home", "rooms", "Rooms", "cameras", "scenes", "favorites", "pages", "look", "behavior", "header", "idle",
              "device", "Menu", "Appearance", "Behavior", "Header", "Cameras", "Scenes", "Favorites", "Pages"}
    assert set(S.BOARD_DEFAULTS) <= keys, set(S.BOARD_DEFAULTS) - keys
    assert keys - labels - set(S.BOARD_DEFAULTS) == set(), keys - labels - set(S.BOARD_DEFAULTS)
    # a busy screen's settings, copied onto a fresh one, are all accepted
    busy = S.board({"menu": "open", "menu_custom": True, "tab_size": "xl", "chips": ["lights"], "cameras": ["camera.front"],
                    "scenes": ["scene.movie"], "favorites": ["light.lamp"], "glass": "frosted", "frost": 70,
                    "screensaver": True, "screensaver_options": {"show": "both"}})
    read = S.resolved(busy, None)
    copy = {k: read[k] for k in S.BOARD_DEFAULTS}
    copy["screensaver_options"] = None if read["screensaver_house"] else read["screensaver_options"]
    got, err = apply_board(S.board({}), copy)
    assert err == {}, err
    assert got["screensaver_options"]["show"] == "both" and got["frost"] == 70 and got["tab_size"] == "xl"
    assert "tablet_user" not in got, "a tablet's own are the tablet's (1.14): nothing of them on a screen to copy"


def test_the_calendars_and_their_colours_are_checked():
    """All Screens -> Calendar: calendar entities only, each once; a colour
    is a page pill colour, an empty one dropped."""
    from custom_components.hk_frontend.settings_api import HOUSE, Invalid
    ents, cols = HOUSE["calendar.entities"], HOUSE["calendar.colors"]
    assert ents(["calendar.home", "calendar.home", "calendar.school"]) == ["calendar.home", "calendar.school"]
    assert ents(None) == [] and ents([]) == []
    for bad in (["light.kitchen"], "calendar.home", [1]):
        try:
            ents(bad)
        except Invalid:
            continue
        raise AssertionError(bad)
    assert cols({"calendar.home": "blue", "calendar.school": ""}) == {"calendar.home": "blue"}
    for bad in ({"calendar.home": "magenta"}, {"light.x": "blue"}, ["calendar.home"]):
        try:
            cols(bad)
        except Invalid:
            continue
        raise AssertionError(bad)


def test_sky_background_house_and_screen_writes():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    stops = {"day": ["#ABCDEF"] * 4, "night": ["#010203"] * 4}
    changes = {"sky.animations": False, "sky.weather": False, "sky.decorations": False,
               "sky.gradient": "custom", "sky.gradient_custom": stops}
    new, err = apply_house({}, changes)
    assert err == {}
    sky = S.merged(new)["sky"]
    assert sky["animations"] is False and sky["weather"] is False and sky["decorations"] is False
    assert sky["gradient"] == "custom" and sky["gradient_custom"] == S.sky_stops(stops)
    for palette in S.SKY_BACKDROP_IDS:
        assert apply_house({}, {"sky.gradient": palette})[1] == {}
        assert apply_board({}, {"sky_gradient": palette})[1] == {}
    own = {"sky_animations": False, "sky_weather": True, "sky_decorations": True,
           "sky_gradient": "custom", "sky_custom": stops}
    board, err = apply_board({}, own)
    assert err == {} and S.board(board)["sky_custom"] == S.sky_stops(stops)
    board, err = apply_board(board, {key: None for key in own})
    assert err == {} and all(S.board(board)[key] is None for key in own)
    same, err = apply_house(new, {"sky.animations": None, "sky.weather": 0, "sky.gradient": "bad", "sky.gradient_custom": {}})
    assert same == new and err == {"sky.animations": "bool", "sky.weather": "bool", "sky.gradient": "choice", "sky.gradient_custom": "stops"}
    same, err = apply_board(board, {"sky_animations": 0, "sky_weather": "off", "sky_decorations": 1,
                                    "sky_gradient": "bad", "sky_custom": {"day": stops["day"]}})
    assert same == board and err == {"sky_animations": "bool", "sky_weather": "bool", "sky_decorations": "bool",
                                     "sky_gradient": "choice", "sky_custom": "stops"}


def test_the_background_live_color_or_photo():
    """Sky / Background's first choice (2026-10-13): Live Sky, a still Color
    or a Photo, for All Screens, a screen and a page."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    photo = "/api/image/serve/" + "a" * 32 + "/original"
    sky = S.merged({})["sky"]
    assert (sky["background"], sky["color"], sky["photo"], sky["page_photos"]) == ("live", "midnight", None, {})
    new, err = apply_house({}, {"sky.background": "photo", "sky.photo": photo, "sky.color": "black",
                                "sky.pages": {"lights": "photo", "climate": "ember"},
                                "sky.page_photos": {"lights": "/local/hk/porch.jpg"}})
    assert err == {}
    sky = S.merged(new)["sky"]
    assert sky["background"] == "photo" and sky["photo"] == photo and sky["color"] == "black"
    assert sky["pages"] == {"lights": "photo", "climate": "ember"} and sky["page_photos"] == {"lights": "/local/hk/porch.jpg"}
    # Live is a background, not a color; a photo must be one the sky can show
    same, err = apply_house(new, {"sky.background": "gradient", "sky.color": "live", "sky.photo": "https://example.com/a.jpg",
                                  "sky.page_photos": {"lights": "javascript:alert(1)"}})
    assert same == new and err == {"sky.background": "choice", "sky.color": "choice", "sky.photo": "photo", "sky.page_photos": "photo"}
    for bad in ("/api/image/serve/xyz/original", "/local/a b.jpg", '/hk/a".jpg', "/local/", "//evil/x.jpg"):
        assert S.sky_photo(bad) is None, bad
    # "" or None: no photo
    cleared, err = apply_house(new, {"sky.photo": "", "sky.page_photos": {"lights": None}})
    assert err == {} and S.merged(cleared)["sky"]["photo"] is None and S.merged(cleared)["sky"]["page_photos"] == {}
    # a screen's own: None follows All Screens
    board, err = apply_board({}, {"sky_background": "color", "sky_color": "plum", "sky_photo": photo,
                                  "sky_page_photos": {"energy": photo}, "sky_pages": {"energy": "photo"}})
    assert err == {}
    b = S.board(board)
    assert (b["sky_background"], b["sky_color"], b["sky_photo"]) == ("color", "plum", photo)
    assert b["sky_page_photos"] == {"energy": photo} and b["sky_pages"] == {"energy": "photo"}
    board, err = apply_board(board, {"sky_background": None, "sky_color": None, "sky_photo": None, "sky_page_photos": None})
    b = S.board(board)
    assert err == {} and b["sky_background"] is None and b["sky_color"] is None and b["sky_photo"] is None and b["sky_page_photos"] == {}
    same, err = apply_board(board, {"sky_background": "off", "sky_color": "live"})
    assert same == board and err == {"sky_background": "choice", "sky_color": "choice"}
    # stored by hand: what can't be shown reads as nothing
    assert S.board({"sky_background": 3, "sky_photo": "http://x/y.jpg", "sky_page_photos": {"lights": "nope"}})["sky_page_photos"] == {}


def test_a_photos_look():
    """Blur, Dim, Saturation and a Color Tint on the Background's photo (2026-10-13)."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    assert S.merged({})["sky"]["photo_look"] == S.PHOTO_LOOK_DEFAULTS
    new, err = apply_house({}, {"sky.photo_look": {"blur": 40, "dim": 25, "saturation": 150, "tint": "plum", "tint_amount": 30}})
    assert err == {} and S.merged(new)["sky"]["photo_look"] == {"blur": 40, "dim": 25, "saturation": 150, "tint": "plum", "tint_amount": 30}
    part, err = apply_house({}, {"sky.photo_look": {"blur": 10}})
    assert err == {} and S.merged(part)["sky"]["photo_look"] == {**S.PHOTO_LOOK_DEFAULTS, "blur": 10}
    for bad in ({"blur": 101}, {"dim": 90}, {"saturation": -1}, {"tint": "live"}, {"tint_amount": 81}, {"glow": 1}, {"blur": True}, "soft"):
        assert apply_house(new, {"sky.photo_look": bad})[1] == {"sky.photo_look": "choice"}, bad
    board, err = apply_board({}, {"sky_photo_look": {"dim": 50}})
    assert err == {} and S.board(board)["sky_photo_look"]["dim"] == 50
    board, err = apply_board(board, {"sky_photo_look": None})
    assert err == {} and S.board(board)["sky_photo_look"] is None
    # each page's own look; "" or None: its screen's
    new, err = apply_house({}, {"sky.page_looks": {"room-kitchen": {"blur": 20}, "lights": {"tint": "ember"}}})
    looks = S.merged(new)["sky"]["page_looks"]
    assert err == {} and looks["room-kitchen"]["blur"] == 20 and looks["lights"]["tint"] == "ember"
    new, err = apply_house(new, {"sky.page_looks": {"room-kitchen": None, "lights": {"tint": "ember"}}})
    assert err == {} and list(S.merged(new)["sky"]["page_looks"]) == ["lights"]
    assert apply_house(new, {"sky.page_looks": {"lights": {"dim": 99}}})[1] == {"sky.page_looks": "choice"}
    board, err = apply_board({}, {"sky_page_looks": {"room-office": {"saturation": 0}}})
    assert err == {} and S.board(board)["sky_page_looks"]["room-office"]["saturation"] == 0
    # stored by hand as nonsense: All Screens' defaults
    assert S.merged({"dashboard": {"sky": {"photo_look": {"blur": "x"}}}})["sky"]["photo_look"] == S.PHOTO_LOOK_DEFAULTS


async def test_sky_background_screen_websocket_round_trip(hass, frontend):
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_board_set
    conn = await _admin(hass)
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Sky Test", unique_id="dashboard-sky-test"))
    changes = {"sky_animations": False, "sky_weather": False, "sky_decorations": True, "sky_gradient": "fjord",
               "sky_custom": {"day": ["#123456"] * 4, "night": ["#010203"] * 4}}
    ws_board_set(hass, conn, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "dashboard-sky-test", "changes": changes})
    assert conn.sent[-1]["success"], conn.sent[-1]
    assert all(S.as_client(entry(hass))["boards"]["dashboard-sky-test"][key] == value for key, value in changes.items())
    ws_board_set(hass, conn, {"id": 2, "type": "hk_frontend/board/set", "dashboard": "dashboard-sky-test",
                              "changes": {"sky_gradient": "bad", "sky_custom": {}}})
    assert conn.sent[-1]["error"] == "invalid_format"
    assert json.loads(conn.sent[-1]["message"]) == {"sky_gradient": "choice", "sky_custom": "stops"}


def test_decoration_style_selection_and_reset():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    assert S.merged({})["sky"]["decoration_style"] == "old"
    for style in ("old", "new"):
        house, err = apply_house({}, {"sky.decoration_style": style})
        assert not err and S.merged(house)["sky"]["decoration_style"] == style
        screen, err = apply_board({}, {"sky_decoration_style": style})
        assert not err and S.board(screen)["sky_decoration_style"] == style
        reset, err = apply_board(screen, {"sky_decoration_style": None})
        assert not err and S.board(reset)["sky_decoration_style"] is None
    assert apply_house({}, {"sky.decoration_style": "broken"})[1]
    assert apply_board({}, {"sky_decoration_style": "broken"})[1]


def test_moving_things_selection_and_reset():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    assert S.merged({})["sky"]["moving"] == "behind"
    for where in ("behind", "front"):
        house, err = apply_house({}, {"sky.moving": where})
        assert not err and S.merged(house)["sky"]["moving"] == where
        screen, err = apply_board({}, {"sky_moving": where})
        assert not err and S.board(screen)["sky_moving"] == where
        reset, err = apply_board(screen, {"sky_moving": None})
        assert not err and S.board(reset)["sky_moving"] is None
    assert apply_house({}, {"sky.moving": "over"})[1]
    assert apply_board({}, {"sky_moving": "over"})[1]


def test_page_backgrounds_are_saved_for_a_screen_and_for_all_screens():
    from custom_components.hk_frontend.settings_api import apply_board, apply_house
    data, err = apply_board({}, {"sky_pages": {"energy": "live", "climate": ""}})
    assert err == {} and data["sky_pages"] == {"energy": "live"}
    _, err = apply_board({}, {"sky_pages": {"energy": "plaid"}})
    assert "sky_pages" in err
    out, err = apply_house({}, {"sky.pages": {"weather": "own", "energy": "dusk"}})
    assert err == {} and out["dashboard"]["sky"]["pages"] == {"weather": "own", "energy": "dusk"}


def test_the_tab_bar_is_saved_for_a_screen_and_for_all_screens():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_board, apply_house
    data, err = apply_board({}, {"menu": "tabbar", "menu_custom": True, "tab_bar_scroll": "hide",
                                 "tab_bar_rooms": "button", "tab_bar_glass": "frosted"})
    assert err == {}
    assert (data["menu"], data["tab_bar_scroll"], data["tab_bar_rooms"], data["tab_bar_glass"]) == \
        ("tabbar", "hide", "button", "frosted")
    data, err = apply_board(data, {"menu": "open", "menu_phone": "tabbar"})
    assert err == {} and (data["menu"], data["menu_phone"]) == ("open", "tabbar")
    _, err = apply_board(data, {"tab_bar": "always", "tab_bar_scroll": "fade", "tab_bar_rooms": "attic"})
    assert err == {"tab_bar": "unknown", "tab_bar_scroll": "choice", "tab_bar_rooms": "choice"}
    assert apply_board(data, {"tab_bar_rooms": False})[0]["tab_bar_rooms"] == "off"
    opts, err = apply_house({}, {"menu.bar_scroll": "stay", "menu.bar_glass": "tinted"})
    assert err == {}
    m = S.merged(opts)["menu"]
    assert (m["bar_scroll"], m["bar_rooms"], m["bar_glass"]) == ("stay", "more", "tinted")
    assert apply_house(opts, {"menu.narrow": "tabbar"})[1] == {"menu.narrow": "unknown"}, "retired in 1.12"
    _, err = apply_house(opts, {"menu.style": "tabbar"})
    assert err == {"menu.style": "choice"}, "All Screens' button style is a button"


def test_liveliness_house_and_screen_writes():
    """Sky Liveliness (hk-sky.js lvOf), the same at both levels (2026-10-09):
    one preset for every occasion or Custom, then each occasion's preset and
    a Custom one's knobs; a screen's own, and Calm When Nobody's Around --
    checked, refused by field, read back."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    assert S.merged({})["sky"]["liveliness_all"] == "classic"
    assert apply_house({}, {"sky.liveliness_all": "frantic"})[1] == {"sky.liveliness_all": "choice"}
    new, err = apply_house({}, {"sky.liveliness_all": "custom",
                                "sky.liveliness": {"halloween": "festive", "fall": "custom", "night": "subtle"},
                                "sky.liveliness_custom": {"fall": {"leaves": 4, "geese": 0}}})
    assert err == {}, err
    sky = S.merged(new)["sky"]
    assert sky["liveliness"] == {"halloween": "festive", "fall": "custom", "night": "subtle"}
    assert sky["liveliness_custom"] == {"fall": {"leaves": 4, "geese": 0}}
    assert S.merged({})["sky"]["liveliness"] == {} and S.merged({})["sky"]["liveliness_custom"] == {}, "Classic by default"
    for bad in ({"atlantis": "party"}, {"halloween": "wild"}, ["halloween"]):
        assert apply_house(new, {"sky.liveliness": bad})[1] == {"sky.liveliness": "choice"}, bad
    for bad in ({"fall": {"bats": 2}}, {"fall": {"leaves": 5}}, {"fall": {"leaves": True}}, {"halloween": {"geese": 1}}):
        assert apply_house(new, {"sky.liveliness_custom": bad})[1] == {"sky.liveliness_custom": "choice"}, bad
    assert S.merged(apply_house(new, {"sky.liveliness": None})[0])["sky"]["liveliness"] == {}, "None is back to Classic"
    board, err = apply_board({}, {"sky_liveliness": "custom", "sky_liveliness_occ": {"halloween": "custom", "night": "party"},
                                  "sky_liveliness_custom": {"halloween": {"bats": 0}}, "sky_calm_empty": True})
    assert err == {}, err
    b = S.board(board)
    assert (b["sky_liveliness"], b["sky_liveliness_occ"], b["sky_liveliness_custom"], b["sky_calm_empty"]) == \
        ("custom", {"halloween": "custom", "night": "party"}, {"halloween": {"bats": 0}}, True)
    assert S.board({})["sky_liveliness"] is None and S.board({})["sky_calm_empty"] is False, "Same as All Screens by default"
    assert apply_board({}, {"sky_liveliness": "festive"})[0]["sky_liveliness"] == "festive", "one preset for every occasion"
    same, err = apply_board(board, {"sky_liveliness": "lively", "sky_liveliness_occ": {"atlantis": "party"},
                                    "sky_liveliness_custom": {"flying": 2}, "sky_calm_empty": "yes"})
    assert same == board and err == {"sky_liveliness": "choice", "sky_liveliness_occ": "choice",
                                     "sky_liveliness_custom": "choice", "sky_calm_empty": "bool"}, \
        "the old Calm / Normal / Lively and Custom by kind are refused"
    assert S.board({"sky_liveliness": "calm", "sky_liveliness_custom": {"flying": 0}})["sky_liveliness"] is None and \
        S.board({"sky_liveliness_custom": {"flying": 0}})["sky_liveliness_custom"] == {}, "and read as Same as All Screens"
    board, err = apply_board(board, {"sky_liveliness": None, "sky_liveliness_occ": None, "sky_liveliness_custom": None})
    assert err == {} and S.board(board)["sky_liveliness"] is None and S.board(board)["sky_liveliness_custom"] == {}


def test_every_liveliness_occasion_is_a_theme_a_woodland_season_or_the_night():
    from custom_components.hk_frontend import settings as S
    assert set(S.LIVELY_OCCASIONS) == set(S.THEMES) | set(S.WOODLAND_SEASONS) | {"night"}
    for occ, knobs in S.LIVELY_OCCASIONS.items():
        assert all(k in S.LIVELY_KNOBS and style in ("new", "old", "both") for k, style in knobs), occ
    assert {k for v in S.LIVELY_OCCASIONS.values() for k, _s in v} == set(S.LIVELY_KNOBS), "every knob drawn somewhere"


def test_a_custom_chips_show_on_a_screen():
    """Always or When Active for each custom chip, a screen's own (2026-10-13)."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_board
    board, err = apply_board({}, {"chips_custom_show": {"mail": "always", "house-battery": "active"}})
    assert err == {} and S.board(board)["chips_custom_show"] == {"mail": "always", "house-battery": "active"}
    board, err = apply_board(board, {"chips_custom_show": {"mail": None, "house-battery": "active"}})
    assert err == {} and S.board(board)["chips_custom_show"] == {"house-battery": "active"}
    assert apply_board(board, {"chips_custom_show": {"mail": "sometimes"}})[1] == {"chips_custom_show": "choice"}
    assert apply_board(board, {"chips_custom_show": {"Bad Key": "always"}})[1] == {"chips_custom_show": "choice"}
    assert S.board({})["chips_custom_show"] == {}


# ------------------------------------------------------------ the wall tablets (1.14)
async def test_a_tablet_is_added_changed_and_removed(hass, frontend):
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_tablet_add, ws_tablet_remove, ws_tablet_set
    conn = await _admin(hass)
    ws_tablet_add(hass, conn, {"id": 1, "type": "hk_frontend/tablet/add", "tablet": {"name": ""}})
    assert json.loads(conn.sent[-1]["message"]) == {"name": "name_needed"}
    ws_tablet_add(hass, conn, {"id": 2, "type": "hk_frontend/tablet/add", "tablet": {
        "name": "Garage", "screen": "dashboard-home", "room": "garage", "app": "fully", "device": "d" * 32}})
    r = conn.sent[-1]
    assert r["success"] and r["result"]["id"] == "garage", r
    await hass.async_block_till_done(wait_background_tasks=True)
    t = S.tablets(entry(hass))["garage"]
    assert (t["app"], t["device"], t["uid"], t["idle_return"], t["idle_time"]) == ("fully", "d" * 32, "tablet_garage", True, 50)
    ws_tablet_set(hass, conn, {"id": 3, "type": "hk_frontend/tablet/set", "tablet": "garage",
                               "changes": {"idle_time": 120, "idle_return": False, "user": "garage"}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    t = S.tablets(entry(hass))["garage"]
    assert (t["idle_time"], t["idle_return"], t["user"], t["idle_time_own"]) == (120, False, "garage", 120)
    ws_tablet_set(hass, conn, {"id": 4, "type": "hk_frontend/tablet/set", "tablet": "garage",
                               "changes": {"idle_time": 45, "app": "ipad", "colour": 1}})
    assert json.loads(conn.sent[-1]["message"]) == {"idle_time": "choice", "app": "choice", "colour": "unknown"}
    ws_tablet_set(hass, conn, {"id": 5, "type": "hk_frontend/tablet/set", "tablet": "garage",
                               "changes": {"idle_time": None}})
    assert S.tablets(entry(hass))["garage"]["idle_time"] == 50, "None: All Tablets' again"
    await _set(hass, {"tablets.idle_time": 30})
    assert S.tablets(entry(hass))["garage"]["idle_time"] == 30
    assert (await _set(hass, {"tablets.idle_time": 31}))["success"] is False
    assert (await _set(hass, {"tablets.restart_times": ["24:00"]}))["success"] is False
    await _set(hass, {"tablets.restart_times": ["15:00", "0:02"], "tablets.restart": True})
    assert S.merged(entry(hass).options)["tablets"]["restart_times"] == ["00:02", "15:00"]
    ws_tablet_remove(hass, conn, {"id": 6, "type": "hk_frontend/tablet/remove", "tablet": "garage"})
    assert conn.sent[-1]["success"] and S.tablets(entry(hass)) == {}


async def test_only_admins_change_tablets_but_any_page_says_it_was_seen(hass, frontend):
    import pytest
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend import tablets
    from custom_components.hk_frontend.panel import ws_tablet_seen, ws_tablet_set
    await hass.auth.async_create_user("Owner")
    kiosk = Conn(await hass.auth.async_create_user("garage"))
    with pytest.raises(Unauthorized):
        ws_tablet_set(hass, kiosk, {"id": 1, "type": "hk_frontend/tablet/set", "tablet": "x", "changes": {}})
    ws_tablet_seen(hass, kiosk, {"id": 2, "type": "hk_frontend/tablet/seen", "screen": "dashboard-home", "app": "fully"})
    assert kiosk.sent[-1]["success"]
    got = tablets.suggestions(hass, entry(hass))
    assert [(s["key"], s["app"], s["user"], s["screen"]) for s in got] == \
        [("seen:garage:dashboard-home", "fully", "garage", "dashboard-home")]
    await _set(hass, {"tablets.dismissed": ["seen:garage:dashboard-home"]})
    assert tablets.suggestions(hass, entry(hass)) == [], "Not a Tablet: not suggested again"


def test_the_clocks_photos_and_the_mosaics_lines_are_checked():
    """2026-10-13: the photos behind the clock (sharp or soft, darkened), the
    clock's text shadow and outline, the mosaic's lines and Up To."""
    from custom_components.hk_frontend import settings as S
    o = S.saver_options({"clock_photo_soft": True, "clock_photo_dim": 50, "clock_text_shadow": 70, "clock_text_outline": 30,
                         "mosaic_line": 8, "mosaic_color": "cream", "mosaic_random": True, "mosaic_every": 15})
    assert o and (o["clock_photo_dim"], o["mosaic_line"], o["mosaic_color"], o["mosaic_every"]) == (50, 8, "cream", 15)
    d = S.saver_options({})
    assert (d["clock_photo_soft"], d["clock_photo_dim"], d["clock_text_shadow"], d["mosaic_line"], d["mosaic_random"]) == \
        (False, 35, 40, 0, False), "sharp photos by default (the user: not blurred)"
    for bad in ({"clock_photo_dim": 90}, {"mosaic_line": 25}, {"mosaic_color": "pink"}, {"mosaic_every": 0},
                {"clock_text_outline": 101}, {"mosaic_random": "yes"}):
        assert S.saver_options(bad) is None, bad


def test_home_energy_and_the_additional_screens_are_checked():
    """2026-10-14: Home Energy (a slide among the photos, or an additional
    screen), the music and the forecast as additional screens, their timer,
    and what Home Energy leaves out."""
    from custom_components.hk_frontend import settings as S
    d = S.saver_options({})
    assert (d["energy_slide"], d["extra_music"], d["extra_forecast"], d["extra_every"], d["extra_for"], d["energy_hide"]) == \
        (False, False, False, 5, 30, []), "all off by default: every 5 minutes, for 30 seconds"
    o = S.saver_options({"energy_slide": True, "extra_music": True, "extra_forecast": True, "extra_every": 15, "extra_for": 120,
                         "energy_hide": ["yday", "cost", "pace"]})
    assert o and (o["energy_slide"], o["extra_every"], o["extra_for"]) == (True, 15, 120)
    assert o["energy_hide"] == ["cost", "yday", "pace"], "kept in the parts' own order"
    for bad in ({"energy_slide": "yes"}, {"extra_every": 0}, {"extra_every": 61}, {"extra_for": 5}, {"extra_for": 301},
                {"energy_hide": "cost"}, {"energy_hide": ["cost", "nope"]}, {"extra_music": 1}):
        assert S.saver_options(bad) is None, bad


def test_the_weather_screen_is_checked():
    """2026-10-14: Weather -- a slide among the photos or an additional
    screen over the clock -- and what it leaves out."""
    from custom_components.hk_frontend import settings as S
    d = S.saver_options({})
    assert (d["weather_slide"], d["weather_hide"]) == (False, [])
    o = S.saver_options({"weather_slide": True, "weather_hide": ["days", "rain"]})
    assert o and o["weather_slide"] is True and o["weather_hide"] == ["rain", "days"], "kept in the parts' own order"
    for bad in ({"weather_slide": "yes"}, {"weather_hide": "rain"}, {"weather_hide": ["cost"]}):
        assert S.saver_options(bad) is None, bad


def test_landscapes_background_and_reset_to_defaults():
    """Sky / Background -> Landscapes (2026-10-14): which one and when it
    changes, its own look; and Reset to Defaults, which leaves the Pages."""
    import re
    from pathlib import Path
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_house, apply_board
    sky = S.merged({})["sky"]
    assert sky["landscape"] == "every:1440" and sky["landscape_look"] == S.PHOTO_LOOK_DEFAULTS
    new, err = apply_house({}, {"sky.background": "landscapes", "sky.landscape": "wake", "sky.landscape_look": {"dim": 20},
                                "sky.pages": {"lights": "landscapes"}})
    sky = S.merged(new)["sky"]
    assert err == {} and (sky["background"], sky["landscape"], sky["landscape_look"]["dim"]) == ("landscapes", "wake", 20)
    assert sky["pages"] == {"lights": "landscapes"}
    for good in ("wake", "every:15", "every:1440", "12.webp", "my-lake_2.jpg"):
        assert apply_house({}, {"sky.landscape": good})[1] == {}, good
    for bad in ("daily", "every:7", "every:", "../01.webp", "a/b.webp", "01.gif", "", None, 3):
        assert apply_house({}, {"sky.landscape": bad})[1] == {"sky.landscape": "choice"}, bad
    board, err = apply_board({}, {"sky_background": "landscapes", "sky_landscape": "every:60", "sky_landscape_look": {"blur": 10}})
    b = S.board(board)
    assert err == {} and (b["sky_background"], b["sky_landscape"], b["sky_landscape_look"]["blur"]) == ("landscapes", "every:60", 10)
    board, err = apply_board(board, {"sky_landscape": None, "sky_landscape_look": None})
    assert err == {} and S.board(board)["sky_landscape"] is None and S.board(board)["sky_landscape_look"] is None
    assert S.board({"sky_landscape": "../x.webp"})["sky_landscape"] is None, "stored by hand: what can't be shown follows"
    # RESET TO DEFAULTS: every setting on the page back, the Pages, the photo
    # and Advanced's hemisphere kept
    full, err = apply_house({}, {"sky.background": "photo", "sky.photo": "/local/hk/porch.jpg", "sky.animations": False,
                                 "sky.landscape": "wake", "sky.pages": {"lights": "landscapes"}, "sky.liveliness_all": "festive",
                                 "sky.page_looks": {"lights": {"blur": 5}}, "sky.hemisphere": "south"})
    assert err == {}
    reset, err = apply_house(full, {"sky.reset": True})
    sky = S.merged(reset)["sky"]
    assert err == {} and sky["background"] == "live" and sky["animations"] is True and sky["landscape"] == "every:1440"
    assert sky["liveliness_all"] == S.merged({})["sky"]["liveliness_all"]
    assert sky["pages"] == {"lights": "landscapes"} and sky["page_looks"]["lights"]["blur"] == 5
    assert sky["photo"] == "/local/hk/porch.jpg" and sky["hemisphere"] == "south"
    assert apply_house(full, {"sky.reset": False})[1] == {"sky.reset": "choice"}
    assert set(S.SKY_RESET) <= set(S.merged({})["sky"]) and set(S.SKY_RESET_BOARD) <= set(S.board(None))
    # a screen's reset (HK Settings, hk-settings.js skyResetGroup) clears the
    # same keys the house's does, Same as All Screens -- and never its pages
    src = (Path(S.__file__).parent / "frontend/panels/hk-settings.js").read_text()
    block = src[src.index("skyResetGroup(c, x, b) {"):]
    block = block[:block.index("\n    }\n")]
    cleared = set(re.findall(r"'(sky_[a-z_]+)'", block)) | set(re.findall(r"(sky_[a-z_]+):", block))
    assert set(S.SKY_RESET_BOARD) <= cleared, set(S.SKY_RESET_BOARD) - cleared
    assert not {"sky_pages", "sky_page_photos", "sky_page_looks"} & cleared


def test_page_header_inherits_and_can_be_overridden():
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import apply_board, apply_house
    assert S.house_menu({})["page_header"] == "current"
    options, errors = apply_house({}, {"menu.page_header": "smart"})
    assert errors == {}
    inherited = S.resolved(S.board({"menu": "open"}), options)
    assert inherited["page_header"] == "smart"
    own, errors = apply_board({}, {"menu_custom": True, "page_header": "none"})
    assert errors == {}
    assert S.resolved(own, options)["page_header"] == "none"
    own, errors = apply_board(own, {"menu_custom": False})
    assert not errors and S.resolved(own, options)["page_header"] == "smart"
    assert apply_house({}, {"menu.page_header": "bogus"})[1] == {"menu.page_header": "choice"}
    assert apply_board({}, {"page_header": "bogus"})[1] == {"page_header": "choice"}


def test_now_playing_place_is_checked():
    """Now Playing's place (2026-10-15): All Screens' style, side and bar
    positions are each one of their choices, else the default; a screen's
    np_* is its own choice or None (Same as All Screens)."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.settings_api import HOUSE, Invalid, apply_board
    assert S.DEFAULTS["now_playing"] == {"style": "bar", "side": "right", "bar": "bottom", "bar_phone": "bottom", "grace": 30}
    assert HOUSE["now_playing.grace"](60) == 60
    for bad in (45, True, "30"):
        try:
            HOUSE["now_playing.grace"](bad)
        except Invalid:
            continue
        raise AssertionError(bad)
    assert HOUSE["now_playing.style"]("pane") == "pane" and HOUSE["now_playing.bar_phone"]("top") == "top"
    for k, bad in (("now_playing.style", "drawer"), ("now_playing.side", "middle"), ("now_playing.bar", "left")):
        try:
            HOUSE[k](bad)
        except Invalid:
            continue
        raise AssertionError((k, bad))
    stored = {S.CONF_DASHBOARD: {"now_playing": {"style": "pane", "side": "sideways"}}}
    m = S.merged(stored)["now_playing"]
    assert m["style"] == "pane" and m["side"] == "right", m
    b = S.board({"np_style": "pane", "np_side": "left", "np_bar": "middle"})
    assert (b["np_style"], b["np_side"], b["np_bar"], b["np_bar_phone"]) == ("pane", "left", None, None)
    got, err = apply_board(S.board({}), {"np_style": "bar", "np_bar": "top", "np_bar_phone": None})
    assert err == {} and got["np_style"] == "bar" and got["np_bar"] == "top" and got["np_bar_phone"] is None, (got, err)
