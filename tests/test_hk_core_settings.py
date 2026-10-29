"""hk_core.settings with no host at all: the settings model, the settings page's writes and
Status & Chips' kinds run once here, for every host.

The HA build runs the same code through settings.py (which reads the config entry into a
`Stored`), settings_api.py and kinds.py (tests/py/test_settings.py, test_settings_api.py and the
feature suites). Here what is saved is a plain dict, as Mantel's store will keep it: nothing is
read from a config entry, and the only house is a fake one that refuses every service call.
"""
import json

import pytest

from hk_core.house import State
from hk_core.settings import changes as C
from hk_core.settings import kinds as K
from hk_core.settings import model as M
from hk_core.sleep import rules as SR

KIOSK = "0123456789abcdef0123456789abcdef"


def saved():
    """A house's settings as a store would hand them over."""
    return {
        "options": {"sidebar": False, "dashboard": {"tablets": {"idle_time": 120}, "look": {"glass": "frosted"}}},
        "items": [
            {"type": "dashboard", "unique_id": "dashboard-hall", "data": {"menu": "open"}, "title": "Hall", "id": "s1"},
            {"type": "dashboard", "unique_id": "dashboard-den", "data": {}, "title": "Den", "id": "s2"},
            {"type": "tablet", "unique_id": "hall", "data": {"name": "Hall", "screen": "dashboard-hall", "room": "hall",
                                                            "app": "kiosk_satellite", "device": KIOSK,
                                                            "sleep": {"decided_by": "hk"}}, "id": "t1"},
            {"type": "tablet", "unique_id": "spare", "data": {"name": "Spare", "screen": "dashboard-hall",
                                                             "idle_time": 30, "idle_return": False}, "id": "t2"},
            {"type": "popup", "unique_id": "cams", "data": {"kind": "camera", "name": "Cameras"}, "id": "p1"},
            {"type": "popup", "unique_id": "alarm", "data": {"kind": "alarm", "name": "Alarm"}, "id": "p2"},
            {"type": "page", "unique_id": "garden", "data": {"title": "Garden"}, "id": "g1"},
            {"type": "chip", "unique_id": "mail", "data": {"name": "Mail"}, "id": "c1"},
            {"type": "dashboard", "unique_id": None, "data": {"menu": "off"}, "id": "x"},   # no key: not read
        ],
    }


@pytest.fixture
def st():
    return M.Stored.from_dict(saved())


class FakeHouse:
    def __init__(self, states):
        self._states = {s.entity_id: s for s in states}

    def state(self, entity_id):
        return self._states.get(entity_id)

    def states(self, domain=None):
        return [s for s in self._states.values() if domain is None or s.domain == domain]

    async def call_service(self, *a, **kw):
        raise AssertionError("the settings never call a service")


# ------------------------------------------------------------------ what is saved
def test_what_is_saved_is_a_plain_dict_a_store_gets_and_puts(st):
    d = st.to_dict()
    assert json.loads(json.dumps(d)) == d, "plain data, nothing a store cannot keep"
    assert M.Stored.from_dict(d) == st
    assert M.Stored.from_dict(None) == M.Stored() and M.Stored.from_dict({}).items == ()
    assert [i.unique_id for i in st.of(M.SUBENTRY_DASHBOARD)] == ["dashboard-hall", "dashboard-den"]
    # to_dict hands out copies: changing what came out changes nothing saved
    d["options"]["dashboard"]["look"]["glass"] = "clear"
    d["items"][0]["data"]["menu"] = "off"
    assert st.options["dashboard"]["look"]["glass"] == "frosted" and st.items[0].data["menu"] == "open"


def test_each_screen_resolved_with_the_tablets_that_run_it(st):
    b = M.boards(st)
    assert list(b) == ["dashboard-hall", "dashboard-den"]
    assert b["dashboard-hall"]["menu"] == "open" and b["dashboard-hall"]["tablets"] == ["hall", "spare"]
    assert b["dashboard-hall"]["idle_room"] == "hall"
    assert b["dashboard-den"]["tablets"] == [] and b["dashboard-den"]["idle_room"] == ""
    assert b["dashboard-den"] == {**M.resolved(M.board({}), None, M.merged(st.options)["look"]["saver"],
                                               M.merged(st.options)["rooms"], M.merged(st.options)["menu"],
                                               M.merged(st.options)["cameras"]["order"]),
                                  "tablets": [], "idle_room": ""}
    assert M.boards(None) == {}


def test_each_tablet_with_all_tablets_filling_in(st):
    t = M.tablets(st)
    assert list(t) == ["hall", "spare"]
    hall, spare = t["hall"], t["spare"]
    assert (hall["idle_time"], hall["idle_time_own"], hall["idle_return"], hall["idle_return_own"]) == (120, None, True, None)
    assert (spare["idle_time"], spare["idle_time_own"], spare["idle_return"]) == (30, 30, False)
    assert hall["uid"] == "tablet_hall" and hall["sleep"]["kiosk"] == KIOSK, "Sleep Screen's kiosk follows the tablet's"
    assert hall["sleep"] == {**SR.sleep_options({"decided_by": "hk"}), "kiosk": KIOSK}
    assert spare["sleep"]["kiosk"] == "", "not a Kiosk Satellite"
    assert M.tablets(None) == {}


def test_what_a_screen_is_handed(st):
    c = M.as_client(st, found={"locks": ["lock.front"], "thermostats": ["climate.hall"]},
                    switches={"hall": "switch.hall_photo_screensaver"})
    assert c["configured"] is True and "counts" not in c
    assert list(c["boards"]) == ["dashboard-hall", "dashboard-den"]
    assert c["tablet_items"]["hall"]["screensaver_switch"] == "switch.hall_photo_screensaver"
    assert c["tablet_items"]["spare"]["black_switch"] is None
    assert [p["hash"] for p in c["popups"]] == ["alarm", "cams"], "by name"
    assert [p["path"] for p in c["custom_pages"]] == ["garden"] and [x["key"] for x in c["custom_chips"]] == ["mail"]
    assert c["kinds"]["locks"] == ["lock.front"]
    assert c["security"]["locks"] == ["lock.front"] and c["features"]["thermostats"] == ["climate.hall"], \
        "the older lists are the same answer"
    assert c["accessories"] == {"entities": {}, "rooms": {}, "into": {}, "pages": {}} and c["extras"] == {}
    none = M.as_client(None)
    assert none["configured"] is False and none["boards"] == {} and none["tablet_items"] == {}


def test_every_items_key_is_taken_whatever_its_type(st):
    assert M.taken_ids(st) == {"dashboard-hall", "dashboard-den", "hall", "spare", "cams", "alarm", "garden", "mail"}
    assert "hall" not in M.taken_ids(st, exclude="hall")


def test_the_suggestions_read_the_house():
    house = FakeHouse([
        State("lock.front", "locked"), State("alarm_control_panel.home", "disarmed"),
        State("alarm_control_panel.shed", "disarmed"),
        State("binary_sensor.back_door", "off", {"device_class": "door"}),
        State("binary_sensor.kitchen_window", "off", {"device_class": "window"}),
        State("binary_sensor.garage_contact", "off", {"device_class": "garage_door"}),
        State("cover.garage", "closed", {"device_class": "garage"}), State("cover.blind", "open", {"device_class": "blind"}),
    ])
    assert M.suggestions(house) == {"alarm": "alarm_control_panel.home", "locks": ["lock.front"],
                                    "doors": ["binary_sensor.back_door"], "windows": ["binary_sensor.kitchen_window"],
                                    "garage": ["binary_sensor.garage_contact", "cover.garage"]}


# ------------------------------------------------------------------ schema, checks, migrations
def test_the_defaults_and_their_checks():
    m = M.merged(None)
    assert m["counts"] == K.blank() and set(K.blank()) == set(K.KINDS)
    assert m["look"]["saver"] == M.SAVER_DEFAULTS
    assert M.board({"screensaver_options": {"bogus": 1}})["screensaver_options"] == M.SAVER_DEFAULTS
    assert M.tablet(None, "living_room")["name"] == "Living Room"
    assert M.parse_mmdd("2-8") == "02-08" and M.parse_mmdd("13-01") is False and M.parse_mmdd("") is None
    assert M.sky_date("christmas", "from", "12-07", "north") is None, "the built-in date: None, so it can move"
    assert M.sky_date("spring", "from", "09-22", "south") is None and M.sky_date("spring", "from", "09-22", "north") == "09-22"
    assert M.hhmm is not None and M.notify_dnd is not None, "Do Not Disturb's shape, shared with the notifications"


def test_older_shapes_are_lifted():
    lifted = M.status_lifted({"dashboard": {"climate": {"status": ["temperature"]}}})
    assert lifted == {"dashboard": {"status_rows": {"climate": {"status": ["temperature"], "exclude_areas": []}}}}
    assert M.status_lifted({"dashboard": {}}) is None, "unchanged: None"
    assert M.radar_lifted({"dashboard": {}}, installed=False) is None, "no card: a new house's radar stays off"
    moved = M.radar_lifted({"dashboard": {"weather": {"radar": {}}}}, installed=True)
    assert moved["dashboard"]["weather"]["radar_native"] == M.radar_from_legacy({}, True)
    assert M.radar_lifted(moved, installed=True) is None, "already moved"


def test_kinds_saved_shape():
    assert K.clean({"exclude": ["a.b", 3, "x"], "include": "light.x"}) == {"exclude": ["a.b"], "include": []}
    assert K.clean("nope") is None
    assert K.LEGACY["thermostats"] == ("features", "thermostats")


# ------------------------------------------------------------------ the settings page's writes
def test_a_house_change_is_checked_and_nothing_is_half_saved():
    opts = {"dashboard": {"look": {"glass": "frosted"}}}
    new, err = C.apply_house(opts, {"look.glass": "blur", "sidebar": True})
    assert err == {} and new["sidebar"] is True and new["dashboard"]["look"]["glass"] == "blur"
    same, err = C.apply_house(opts, {"look.glass": "blur", "look.frost": "lots"})
    assert err == {"look.frost": "amount"} and same == opts, "one refusal: nothing is made"
    assert C.apply_house({}, {"nope.nope": 1})[1] == {"nope.nope": "unknown"}


def test_a_hosts_own_options_beside_dashboard():
    # HK as Home Assistant's own sidebar panel is Home Assistant's option: unknown here...
    assert C.apply_house({}, {"hk_panel": None})[1] == {"hk_panel": "unknown"}

    def panel(v):
        if v not in (None, False):
            raise C.Invalid("hk_panel")
        return v
    # ...and checked by the host's own check when it hands one in
    new, err = C.apply_house({}, {"hk_panel": False}, {**C.TOP, "hk_panel": panel})
    assert err == {} and new["hk_panel"] is False
    assert C.apply_house({}, {"hk_panel": 3}, {**C.TOP, "hk_panel": panel})[1] == {"hk_panel": "hk_panel"}


def test_a_counted_kind_empties_its_older_list():
    opts = {"dashboard": {"security": {"locks": ["lock.old"]}}}
    new, err = C.apply_house(opts, {"counts.locks": {"exclude": [], "include": ["lock.front"]}})
    assert err == {} and new["dashboard"]["counts"]["locks"] == {"exclude": [], "include": ["lock.front"]}
    assert M.merged(new)["security"]["locks"] == []


def test_a_screens_and_a_tablets_changes():
    b, err = C.apply_board({}, {"menu": "open"})
    assert err == {} and b == M.board({"menu": "open"})
    assert C.apply_board({"menu": "open"}, {"bogus": 1}) == (M.board({"menu": "open"}), {"bogus": "unknown"})
    t, err = C.apply_tablet({}, {"sleep": {"decided_by": "hk", "linger": 120}}, "hall")
    assert err == {} and t["sleep"]["decided_by"] == "hk" and t["sleep"]["linger"] == 120
    assert C.apply_tablet({}, {"sleep": {"decided_by": "nobody"}}, "hall")[1] == {"sleep": "sleep"}


def test_a_new_screen_starts_from_its_preset_and_all_screens_menu():
    """new_board: what Add Screen's Shown On starts a screen with (HA's dashboard flow), and what Mantel gives a house
    with no screens (settings_store.seed_home_screen): the preset over the defaults, pages empty (generated)."""
    phone = M.new_board("personal", None)
    assert phone["menu"] == "auto" and phone["time_weather"] == "page" and phone["pages"] == [] and phone["home_page"] is True
    assert phone == M.preset_menu(M.board(M.SCREEN_PRESETS["personal"]), M.SCREEN_PRESETS["personal"], None)
    assert M.new_board("nonsense", None) == M.board({})
    # the preset's menu settings All Screens' differs on start as its own, one at a time (menu_own)
    assert M.new_board("wall_tablet", {})["menu_own"] == ["time_weather"]
    assert M.new_board("wall_tablet", {"dashboard": {"menu": {"time_weather_at": "menu"}}})["menu_own"] == []


def test_the_menu_follows_all_screens_one_setting_at_a_time():
    """Phase 3 (entry 1.17): menu_own lists a screen's own menu settings; the rest are All Screens', each on its
    own. menu_per_setting moves a menu_custom screen over: what equals All Screens' follows again."""
    opts = {"dashboard": {"menu": {"accent": "blue", "tab_size": "xl", "bar_pos": "top", "style": "chip"}}}
    b = M.resolved(M.board({"menu": "tab", "menu_own": ["tab_size"], "tab_size": "standard", "accent": "red"}), opts)
    assert (b["tab_size"], b["accent"], b["tab_bar_pos"], b["menu"]) == ("standard", "blue", "top", "chip")
    assert b["menu_house"] is False and b["menu_own"] == ["tab_size"]
    own_style = M.resolved(M.board({"menu": "tab", "menu_own": ["menu"]}), opts)
    assert own_style["menu"] == "tab" and own_style["accent"] == "blue", "a button's style of its own, the rest followed"
    assert M.resolved(M.board({"menu": "tabbar"}), opts)["menu"] == "tabbar", "the tab bar is always the screen's own"
    # a screen not moved yet (menu_custom) owns them all, as before
    legacy = M.resolved(M.board({"menu": "tab", "menu_custom": True, "accent": "red"}), opts)
    assert (legacy["menu"], legacy["accent"], legacy["tab_size"], legacy["menu_house"]) == ("tab", "red", "large", False)
    items = {
        "same": {"menu": "chip", "menu_custom": True, "accent": "blue", "tab_size": "xl", "tab_bar_pos": "top"},
        "differs": {"menu": "tab", "menu_custom": True, "accent": "red", "tab_size": "xl", "tab_bar_pos": "top",
                    "pages": ["weather"]},
        "follows": {"menu": "open", "menu_custom": False, "accent": "green", "dock_min": 900},
        "moved": {"menu": "chip", "menu_own": ["accent"], "accent": "pink", "tab_size": "standard"},
    }
    got = M.menu_per_setting(opts, items)
    assert got["same"] == {"menu": "chip"}, "every value equal to All Screens': it follows again"
    assert got["differs"] == {"menu": "tab", "accent": "red", "pages": ["weather"], "menu_own": ["menu", "accent"]}
    assert got["follows"] == {"menu": "open"}, "a follower's baked-in menu values go; its menu stays its own"
    assert got["moved"] == {"menu": "chip", "menu_own": ["accent"], "accent": "pink"}, "already moved: as it is"
    # nothing any screen shows changes
    for p, d in items.items():
        before, after = M.resolved(M.board(d), opts), M.resolved(M.board(got[p]), opts)
        for k in M.MENU_KEYS:
            assert before[k] == after[k], (p, k)
    assert M.menu_per_setting(opts, got) == got, "a second run changes nothing"
    # an older page's switch is read as all or none
    from hk_core.settings import changes as C
    own, err = C.apply_board({}, {"menu_custom": True, "page_header": "none"})
    assert not err and own["menu_own"] == list(M.MENU_KEYS) and "menu_custom" not in own
    assert C.apply_board(own, {"menu_custom": False})[0]["menu_own"] == []
    assert C.apply_board({}, {"menu_own": ["bogus"]})[1] == {"menu_own": "choice"}
