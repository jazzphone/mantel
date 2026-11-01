"""THE SIDE PANE (docs/phase11/HOMEVIEW-LOOK.md "Phase A2"): its settings in hk_core, for every host.

All Screens' `side_pane` and a screen's sparse own one, each group resolving on its own; the checks the
settings page's writes pass (changes.py); the caps (eight sections, one Full); and the once-only move of the
screensaver's pane and Now Playing's Show As: Side Pane into it (side_pane_lifted), in Home Assistant's
entry migration and at Mantel's start-up. A FICTIONAL house: nothing here reaches one."""
from __future__ import annotations

import copy

import pytest

from hk_core.settings import changes as C
from hk_core.settings import model as M

DEF = M.SIDE_PANE_DEFAULTS


# ------------------------------------------------------------------------------------------------ the shape
def test_all_screens_has_the_defaults_until_one_is_chosen():
    sp = M.merged(None)["side_pane"]
    assert sp == DEF
    assert sp["side"] == "right" and sp["width"] == "standard" and sp["doorbell"] is True
    assert sp["dashboard"]["show"] == "off" and sp["saver"]["show"] == "off", "everything is an option: off"
    assert [s["kind"] for s in sp["dashboard"]["sections"]] == ["weather", "calendar", "now_playing"]
    assert sp["dashboard"]["sections"][2] == {"kind": "now_playing", "when": "active"}
    assert [(s["kind"], s.get("size", "more")) for s in sp["saver"]["sections"]] == \
        [("clock", "tiny"), ("calendar", "more"), ("now_playing", "less")]


def test_the_twelve_sections_four_sizes_and_widths():
    assert len(M.PANE_SECTIONS) == 12 and "todo" in M.PANE_SECTIONS and "notifications" in M.PANE_SECTIONS
    assert M.PANE_SIZES == ("tiny", "less", "more", "full")
    assert M.PANE_WIDTHS == {"narrow": 360, "standard": 400, "wide": 480}
    assert M.PANE_MAX == 8


def test_a_section_drops_what_absent_means_and_keeps_its_own_options():
    assert M.pane_section({"kind": "weather", "size": "more", "when": "always"}) == {"kind": "weather"}
    assert M.pane_section({"kind": "calendar", "size": "full", "days": 3}) == {"kind": "calendar", "size": "full", "days": 3}
    assert M.pane_section({"kind": "todo", "entity": "todo.groceries", "completed": True}) == \
        {"kind": "todo", "entity": "todo.groceries", "completed": True}
    assert M.pane_section({"kind": "camera", "entity": "camera.front_door", "when": "active"}) == \
        {"kind": "camera", "entity": "camera.front_door", "when": "active"}
    assert M.pane_section({"kind": "toaster"}) is None
    # tolerant: a key it can't use is left out; strict: refused
    assert M.pane_section({"kind": "camera", "entity": "light.lamp"}) == {"kind": "camera"}
    assert M.pane_section({"kind": "camera", "entity": "light.lamp"}, strict=True) is None
    assert M.pane_section({"kind": "weather", "days": 3}, strict=True) is None, "days is the calendar's alone"
    assert M.pane_section({"kind": "calendar", "days": 9}, strict=True) is None
    assert M.pane_section({"kind": "calendar", "days": True}, strict=True) is None


def test_the_caps_eight_sections_one_full_none_twice():
    nine = [{"kind": k} for k in M.PANE_SECTIONS[:9]]
    assert M.pane_sections(nine, strict=True) is None
    assert len(M.pane_sections(nine)) == 8, "read tolerantly, cut at eight"
    two_full = [{"kind": "clock", "size": "full"}, {"kind": "weather", "size": "full"}]
    assert M.pane_sections(two_full, strict=True) is None
    assert M.pane_sections(two_full) == [{"kind": "clock", "size": "full"}, {"kind": "weather"}], "the second is More"
    assert M.pane_sections([{"kind": "weather"}, {"kind": "weather"}], strict=True) is None
    two_lists = [{"kind": "todo", "entity": "todo.a"}, {"kind": "todo", "entity": "todo.b"}]
    assert M.pane_sections(two_lists, strict=True) == two_lists, "two lists are two sections"


def test_a_group_is_whole():
    assert M.pane_group("dashboard", {"show": "home", "sections": []}, strict=True) == {"show": "home", "sections": []}
    assert M.pane_group("dashboard", {"show": "home"}, strict=True) is None
    assert M.pane_group("dashboard", {"show": "own", "sections": []}, strict=True) is None, "own is the screensaver's"
    assert M.pane_group("saver", {"show": "same", "sections": []}, strict=True) == {"show": "same", "sections": []}
    assert M.pane_group("dashboard", {"show": "home"})["sections"] == DEF["dashboard"]["sections"], "tolerant: filled in"
    assert M.pane_group("side", "middle") is None and M.pane_group("width", "wide") == "wide"
    assert M.pane_group("doorbell", 1) is None and M.pane_group("doorbell", False) is False
    # (Dim a percentage, 0-60: a slider; its first hours' words read as theirs)
    assert M.pane_group("dim", 35) == 35 and M.pane_group("dim", 0) == 0 and M.pane_group("dim", "medium") == 30
    for bad in (61, -5, 12.5, True, "pitch", None):
        assert M.pane_group("dim", bad) is None, bad
    assert DEF["dim"] == 0 and M.PANE_DIM_MAX == 60


# ------------------------------------------------------------------------------------------- the resolution
def test_each_group_resolves_on_its_own_screen_then_all_screens():
    house = copy.deepcopy(DEF)
    house["side"] = "left"
    house["dashboard"] = {"show": "home", "sections": [{"kind": "clock"}]}
    own = {"width": "wide", "saver": {"show": "same", "sections": []}}
    r = M.pane_resolved(house, own)
    assert r["side"] == "left" and r["dashboard"]["show"] == "home", "All Screens'"
    assert r["width"] == "wide" and r["saver"]["show"] == "same", "the screen's own"
    assert r["own"] == ["width", "saver"]
    assert M.pane_resolved(house, None)["own"] == []


def test_a_screen_as_read_carries_the_pane_resolved_and_keeps_its_own_as_stored():
    opts = {"dashboard": {"side_pane": {"side": "left", "dashboard": {"show": "all", "sections": [{"kind": "timers"}]}}}}
    b = M.board({"side_pane": {"doorbell": False}})
    r = M.resolved(b, opts)
    assert r["side_pane"] == {"doorbell": False}, "what is stored stays the screen's own"
    assert r["side_pane_read"]["side"] == "left" and r["side_pane_read"]["doorbell"] is False
    assert r["side_pane_read"]["dashboard"]["sections"] == [{"kind": "timers"}]
    assert r["side_pane_read"]["own"] == ["doorbell"]
    stored = M.Stored(opts, (M.Item(M.SUBENTRY_DASHBOARD, "dashboard-den", {}),))
    assert M.boards(stored)["dashboard-den"]["side_pane_read"]["side"] == "left", "every screen is handed it"


def test_a_screen_s_own_pane_is_sparse_and_none_when_it_sets_nothing():
    assert M.board({})["side_pane"] is None
    assert M.board({"side_pane": {}})["side_pane"] is None
    assert M.board({"side_pane": {"side": "sideways", "width": "narrow"}})["side_pane"] == {"width": "narrow"}
    assert M.board_stored({"side_pane": None}) == {}, "Same as All Screens is not stored"


# --------------------------------------------------------------------------------------------- the writes
def test_all_screens_writes_one_group_at_a_time():
    opts, err = C.apply_house({}, {"side_pane.dashboard": {"show": "home", "sections": [{"kind": "weather", "size": "tiny"}]},
                                   "side_pane.side": "left"})
    assert not err
    assert opts["dashboard"]["side_pane"] == {"side": "left", "dashboard": {"show": "home",
                                                                          "sections": [{"kind": "weather", "size": "tiny"}]}}
    opts2, err = C.apply_house(opts, {"side_pane.side": "right"})
    assert not err and "side" not in opts2["dashboard"]["side_pane"], "only what differs from the default is stored"
    opts3, err = C.apply_house({}, {"side_pane.dim": 40})
    assert not err and opts3["dashboard"]["side_pane"] == {"dim": 40}
    for path, value in (("side_pane.width", "huge"), ("side_pane.dim", "dark"), ("side_pane.dim", 90), ("side_pane.doorbell", "yes"), ("side_pane.saver", {"show": "own"}),
                        ("side_pane.dashboard", {"show": "home", "sections": [{"kind": "x"}]}),
                        ("side_pane.dashboard", {"show": "home", "sections": [{"kind": k} for k in M.PANE_SECTIONS[:9]]}),
                        ("side_pane.colour", "red")):
        _, err = C.apply_house({}, {path: value})
        assert path in err, (path, value)


def test_a_screen_writes_its_own_groups_or_goes_back_to_all_screens():
    b, err = C.apply_board({}, {"side_pane": {"side": "left", "dashboard": {"show": "all", "sections": []}}})
    assert not err and b["side_pane"] == {"side": "left", "dashboard": {"show": "all", "sections": []}}
    b2, err = C.apply_board(M.board_stored(b), {"side_pane": None})
    assert not err and b2["side_pane"] is None and "side_pane" not in M.board_stored(b2)
    _, err = C.apply_board({}, {"side_pane": {"dashboard": {"show": "home"}}})
    assert err == {"side_pane": "side_pane"}
    _, err = C.apply_board({}, {"side_pane": {"elsewhere": 1}})
    assert err == {"side_pane": "side_pane"}


# ------------------------------------------------------------------------------------------- the migration
def lift(house=None, **screens):
    return M.side_pane_lifted({"dashboard": house or {}}, screens)


def test_a_house_with_neither_pane_is_left_alone():
    opts, items = lift({"look": {"glass": "blur"}}, den={"menu": "open"})
    assert opts is None and items == {"den": {"menu": "open"}}


def test_the_screensaver_s_calendar_becomes_its_own_sections_with_its_days():
    opts, _ = lift({"look": {"saver": {"calendar": True, "calendar_days": 4}}})
    sp = opts["dashboard"]["side_pane"]
    assert sp == {"saver": {"show": "own", "sections": [{"kind": "calendar", "days": 4}]}}
    assert M.merged(opts)["side_pane"]["dashboard"]["show"] == "off", "the dashboard as it was"


def test_the_screensaver_s_music_becomes_now_playing_when_there_s_something():
    opts, _ = lift({"look": {"saver": {"music_pane": True}}})
    assert opts["dashboard"]["side_pane"]["saver"] == {"show": "own", "sections": [{"kind": "now_playing", "when": "active"}]}
    opts, _ = lift({"look": {"saver": {"calendar": True, "music_pane": True}}})
    assert [s["kind"] for s in opts["dashboard"]["side_pane"]["saver"]["sections"]] == ["calendar", "now_playing"], \
        "the calendar above the music, as the pane had them"


def test_now_playing_s_pane_becomes_the_dashboard_s_on_every_page_on_its_side():
    opts, _ = lift({"now_playing": {"style": "pane", "side": "left"}})
    sp = opts["dashboard"]["side_pane"]
    assert sp == {"side": "left", "dashboard": {"show": "all", "sections": [{"kind": "now_playing", "when": "active"}]}}
    opts, _ = lift({"now_playing": {"style": "bar", "side": "left"}})
    assert opts is None, "a Pane Side the bar never used moves nothing"


def test_a_screen_that_differs_gets_those_groups_and_one_that_matches_follows():
    house = {"look": {"saver": {"calendar": True}}, "now_playing": {"style": "pane"}}
    opts, items = lift(house, same={}, bar={"np_style": "bar"}, left={"np_side": "left"},
                       quiet={"screensaver_options": {"calendar": False}},
                       music={"screensaver_options": {"music_pane": True}})
    assert "side_pane" not in items["same"], "the same as All Screens: follows"
    assert items["bar"]["side_pane"]["dashboard"]["show"] == "off", "its own Now Playing: the bar"
    assert items["left"]["side_pane"] == {"side": "left"}
    assert items["quiet"]["side_pane"] == {"saver": {"show": "off", "sections": DEF["saver"]["sections"]}}
    assert items["music"]["side_pane"]["saver"]["sections"] == [{"kind": "now_playing", "when": "active"}]
    assert items["bar"]["np_style"] == "bar", "the older keys stay, for one release"
    r = M.resolved(M.board(items["left"]), opts)["side_pane_read"]
    assert r["side"] == "left" and r["dashboard"]["show"] == "all" and r["saver"]["sections"][0]["kind"] == "calendar"


def test_a_screen_with_the_music_s_pane_on_the_left_keeps_the_screensaver_s_on_the_right():
    opts, items = lift({"look": {"saver": {"calendar": True}}, "now_playing": {"style": "pane", "side": "left"}},
                       bar={"np_style": "bar"})
    assert opts["dashboard"]["side_pane"]["side"] == "left"
    assert items["bar"]["side_pane"]["side"] == "right", "only the screensaver's pane, and that was on the right"


def test_moved_once():
    house = {"look": {"saver": {"calendar": True}}}
    opts, items = lift(house, den={"np_style": "pane"})
    again_opts, again = M.side_pane_lifted(opts, items)
    assert again_opts is None and again == items, "a house and screens already moved are left alone"


def test_clear_sets_the_older_keys_back():
    opts, items = M.side_pane_lifted(
        {"dashboard": {"look": {"saver": {"calendar": True, "calendar_days": 3, "each_photo": 20}},
                       "now_playing": {"style": "pane", "side": "left", "grace": 60}}},
        {"den": {"np_style": "bar", "np_side": "left", "screensaver_options": {"music_pane": True, "zoom": True}}},
        clear=True)
    d = opts["dashboard"]
    assert d["look"]["saver"] == {"each_photo": 20} and d["now_playing"] == {"grace": 60}
    assert items["den"]["screensaver_options"] == {"zoom": True} and "np_style" not in items["den"]
    assert d["side_pane"]["saver"]["sections"][0] == {"kind": "calendar", "days": 3}
    again_opts, again = M.side_pane_lifted(opts, items, clear=True)
    assert again_opts is None and again == items


# ------------------------------------------------------------------------------------- Mantel's start-up move
@pytest.fixture
def store(tmp_path):
    from mantel_server import settings_store as S
    from mantel_server.db import Database
    d = Database(tmp_path / "data" / "mantel.db")
    yield S.SettingsStore(d.conn, lambda: 1_000_000.0)
    d.close()


def test_mantel_moves_the_panes_once_at_start_up(store):
    from mantel_server import settings_store as S
    store.write([("house", "settings", {"look": {"saver": {"calendar": True}}, "now_playing": {"style": "pane"}}),
                 ("board", "dashboard-den", {"np_style": "bar", "menu": "open"}),
                 ("board", "dashboard-hall", {"menu": "open"})], actor=S.Actor(label="t"))
    assert S.side_panes_lifted(store) is True
    house = store.body("house", "settings")
    assert house["side_pane"]["saver"]["show"] == "own" and house["side_pane"]["dashboard"]["show"] == "all"
    assert "now_playing" not in house and "calendar" not in house.get("look", {}).get("saver", {})
    assert store.body("board", "dashboard-den")["side_pane"]["dashboard"]["show"] == "off"
    assert store.body("board", "dashboard-hall") == {"menu": "open"}, "left alone"
    assert store.history("house", "settings")[0]["message"] == S.SIDE_PANES
    assert S.side_panes_lifted(store) is False, "a second start finds nothing to move"


def test_mantel_with_nothing_to_move_writes_nothing(store):
    from mantel_server import settings_store as S
    assert S.side_panes_lifted(store) is False
    store.write([("board", "dashboard-hall", {"menu": "open"})], actor=S.Actor(label="t"))
    assert S.side_panes_lifted(store) is False


def test_a_screen_read_back_from_its_resolved_form_keeps_following():
    """HA's panel/get and the feed hand a screen AS READ; Mantel's import and HA's mirror store it back. The
    resolved pane (side_pane_read) is never stored: a screen that followed All Screens still does."""
    from mantel_server import settings_store as S
    opts = {"dashboard": {"side_pane": {"side": "left"}}}
    r = M.resolved(M.board({}), opts)
    assert "side_pane" not in M.board_stored(S.as_stored("board", r))


def test_section_headings_on_by_default_and_a_screen_can_turn_them_off():
    # (2026-10-30) a small title over each section but the Clock and the Weather
    from hk_core.settings import changes as C
    from hk_core.settings import model as M
    assert M.SIDE_PANE_DEFAULTS["headings"] is True and "headings" in M.PANE_GROUPS
    b, err = C.apply_board({}, {"side_pane": {"headings": False}})
    assert err == {} and M.board(b)["side_pane"] == {"headings": False}
    assert C.apply_board({}, {"side_pane": {"headings": "yes"}})[1] != {}


def test_a_section_sits_at_the_top_or_the_foot_and_says_what_a_tap_does():
    # (2026-10-30) Top and Automatic are what absent means; Bottom, Its Page, Its Sheet and Nothing are kept
    assert M.pane_section({"kind": "now_playing", "place": "bottom", "tap": "sheet"}) == {"kind": "now_playing", "place": "bottom", "tap": "sheet"}
    assert M.pane_section({"kind": "weather", "place": "top", "tap": "auto"}) == {"kind": "weather"}
    assert M.pane_section({"kind": "weather", "place": "middle"}, strict=True) is None
    assert M.pane_section({"kind": "weather", "tap": "dance"}, strict=True) is None


def test_the_clock_s_look_is_today_s_until_chosen():
    # (2026-10-31, item 43) each first value is what absent means; AM/PM is on unless set off, the colon off unless set on
    assert M.pane_section({"kind": "clock", "face": "digital", "align": "left", "scale": "medium", "weight": "semibold",
                           "ampm": True, "colon": False, "date": "full", "line": "auto"}) == {"kind": "clock"}
    look = {"kind": "clock", "size": "less", "face": "stacked", "align": "right", "scale": "large", "weight": "bold",
            "ampm": False, "colon": True, "date": "short", "line": "sunset"}
    assert M.pane_section(look) == look and M.pane_section(look, strict=True) == look
    assert M.pane_section({"kind": "clock", "line": "weather"}) == {"kind": "clock", "line": "weather"}
    assert M.pane_section({"kind": "clock", "date": "off"}) == {"kind": "clock", "date": "off"}
    # ...a value it can't use is left out (read) or refused (a form), and only the clock has them
    for bad in ({"face": "roman"}, {"align": "middle"}, {"scale": "huge"}, {"weight": "black"}, {"date": "long"},
                {"line": "moon"}, {"ampm": "yes"}, {"colon": 1}):
        assert M.pane_section({"kind": "clock", **bad}) == {"kind": "clock"}
        assert M.pane_section({"kind": "clock", **bad}, strict=True) is None
    assert M.pane_section({"kind": "weather", "face": "stacked"}) == {"kind": "weather"}
    assert M.pane_section({"kind": "weather", "face": "stacked"}, strict=True) is None


def test_the_clock_s_look_is_saved_whole_with_its_group():
    got = M.side_pane({"dashboard": {"show": "home", "sections": [{"kind": "clock", "align": "right", "weight": "light"}]}}, strict=True)
    assert got["dashboard"]["sections"] == [{"kind": "clock", "align": "right", "weight": "light"}]
    b, err = C.apply_board({}, {"side_pane": {"dashboard": {"show": "home", "sections": [{"kind": "clock", "face": "analog", "ampm": False}]}}})
    assert err == {} and M.board(b)["side_pane"]["dashboard"]["sections"] == [{"kind": "clock", "face": "analog", "ampm": False}]
    assert C.apply_board({}, {"side_pane": {"dashboard": {"show": "home", "sections": [{"kind": "clock", "face": "roman"}]}}})[1] != {}


def test_now_playing_has_two_taps_of_its_own():
    # (2026-10-31, item 44) open the panel in place, or flip to the controls; no other section has them
    for tap in ("panel", "flip"):
        assert M.pane_section({"kind": "now_playing", "tap": tap}, strict=True) == {"kind": "now_playing", "tap": tap}
        assert M.pane_section({"kind": "weather", "tap": tap}) == {"kind": "weather"}
        assert M.pane_section({"kind": "weather", "tap": tap}, strict=True) is None
    assert M.pane_section({"kind": "now_playing", "tap": "auto"}) == {"kind": "now_playing"}
    assert M.pane_section({"kind": "now_playing", "tap": "dance"}, strict=True) is None


def test_now_playing_s_album_art_background_is_on_unless_set_off():
    # (2026-10-31, item 41) stored only when off, as a bool; only Now Playing has it
    assert M.pane_section({"kind": "now_playing", "art": True}) == {"kind": "now_playing"}
    assert M.pane_section({"kind": "now_playing", "art": False}) == {"kind": "now_playing", "art": False}
    assert M.pane_section({"kind": "now_playing", "art": "no"}) == {"kind": "now_playing"}
    assert M.pane_section({"kind": "now_playing", "art": "no"}, strict=True) is None
    assert M.pane_section({"kind": "weather", "art": False}) == {"kind": "weather"}
    b, err = C.apply_board({}, {"side_pane": {"dashboard": {"show": "home", "sections": [{"kind": "now_playing", "art": False}]}}})
    assert err == {} and M.board(b)["side_pane"]["dashboard"]["sections"] == [{"kind": "now_playing", "art": False}]


def test_the_camera_s_name_is_hide_unless_chosen():
    # (2026-10-31, the owner's item 42: the name the Home Grid's camera block can show, Hide in the pane by default)
    assert M.pane_section({"kind": "camera", "name": "hide"}) == {"kind": "camera"}
    assert M.pane_section({"kind": "camera", "name": "show"}) == {"kind": "camera", "name": "show"}
    assert M.pane_section({"kind": "camera", "name": "auto"}) == {"kind": "camera", "name": "auto"}
    assert M.pane_section({"kind": "camera", "name": "loud"}) == {"kind": "camera"}
    assert M.pane_section({"kind": "camera", "name": "loud"}, strict=True) is None
