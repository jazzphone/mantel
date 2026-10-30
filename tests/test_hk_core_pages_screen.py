"""THE PAGES SCREEN's settings (docs/phase11/HOMEVIEW-LOOK.md, Phase J): All Screens' `pages_screen`, a screen's own
fields over it, and what a save may say. A screen saved before it draws as before: off, nothing stored."""
from __future__ import annotations

import pytest

from hk_core.settings import changes as C, model as S


def test_all_screens_has_every_field_and_starts_off():
    got = S.merged(None)["pages_screen"]
    assert got == {"show": "off", "icons": "menu", "rooms": "folder", "widgets": [], "pill": "auto"}
    # stored values over the defaults; a bad one read back is its default, never an error
    opts = {"dashboard": {"pages_screen": {"show": "on", "rooms": "sideways", "widgets": [{"kind": "weather"}]}}}
    got = S.merged(opts)["pages_screen"]
    assert got["show"] == "on" and got["rooms"] == "folder"
    assert got["widgets"] == [{"kind": "weather", "size": "more", "place": "right"}]


def test_a_screen_saved_today_follows_all_screens():
    assert S.board({})["pages_screen"] is None
    assert S.board(None)["pages_screen"] is None
    assert "pages_screen" not in S.board_stored({})          # nothing new is stored for a screen that never chose
    assert S.board({"pages_screen": {}})["pages_screen"] is None
    # read back defensively: a field it doesn't know, or a bad one, is left out
    assert S.board({"pages_screen": {"pill": "off", "rooms": 3, "bogus": 1}})["pages_screen"] == {"pill": "off"}
    assert S.board({"pages_screen": "on"})["pages_screen"] is None


def test_each_field_resolves_on_its_own():
    house = {"show": "on", "rooms": "each", "widgets": [{"kind": "clock", "size": "less", "place": "left"}]}
    assert S.pages_screen_resolved(house, None) == {**S.PAGES_SCREEN_DEFAULTS, **house}
    own = {"rooms": "none", "icons": ["lights", "climate"]}
    got = S.pages_screen_resolved(house, own)
    assert got["show"] == "on" and got["rooms"] == "none" and got["icons"] == ["lights", "climate"]
    assert got["widgets"] == house["widgets"] and got["pill"] == "auto"
    assert S.pages_screen_resolved(None, None) == S.PAGES_SCREEN_DEFAULTS


def test_all_screens_saves_a_field_at_a_time():
    opts, err = C.apply_house({}, {"pages_screen.show": "on", "pages_screen.pill": "off",
                                   "pages_screen.icons": ["security", "lights"],
                                   "pages_screen.widgets": [{"kind": "weather", "size": "less", "place": "left"}]})
    assert err == {}
    got = S.merged(opts)["pages_screen"]
    assert got == {"show": "on", "icons": ["security", "lights"], "rooms": "folder",
                   "widgets": [{"kind": "weather", "size": "less", "place": "left"}], "pill": "off"}
    # only what differs from the defaults is stored
    assert opts["dashboard"]["pages_screen"] == {"show": "on", "icons": ["security", "lights"], "pill": "off",
                                                 "widgets": [{"kind": "weather", "size": "less", "place": "left"}]}
    back, err = C.apply_house(opts, {"pages_screen.icons": "menu"})
    assert err == {} and S.merged(back)["pages_screen"]["icons"] == "menu"


@pytest.mark.parametrize("path,value", [
    ("pages_screen.show", True), ("pages_screen.show", "maybe"), ("pages_screen.rooms", "attic"),
    ("pages_screen.pill", None), ("pages_screen.icons", "lights"), ("pages_screen.icons", ["lights", "lights"]),
    ("pages_screen.icons", ["Not A Page!"]), ("pages_screen.icons", ["p%d" % i for i in range(61)]),
    ("pages_screen.widgets", [{"kind": "radio"}]), ("pages_screen.widgets", [{"kind": "weather", "size": "full"}]),
    ("pages_screen.widgets", [{"kind": "weather", "place": "middle"}]),
    ("pages_screen.widgets", [{"kind": "weather"}, {"kind": "weather"}]),
    ("pages_screen.widgets", [{"kind": k} for k in S.PAGES_SCREEN_WIDGETS[:5]]),
    ("pages_screen.widgets", [{"kind": "weather", "entity": "camera.yard"}]),
    ("pages_screen.colour", "red"),
])
def test_all_screens_refuses_what_it_cannot_be(path, value):
    opts, err = C.apply_house({}, {path: value})
    assert path in err and opts == {}


def test_a_screen_saves_its_own_fields_whole():
    got, err = C.apply_board({}, {"pages_screen": {"show": "on", "rooms": "each"}})
    assert err == {} and got["pages_screen"] == {"show": "on", "rooms": "each"}
    got, err = C.apply_board(got, {"pages_screen": None})
    assert err == {} and got["pages_screen"] is None                # Reset to All Screens
    got, err = C.apply_board({}, {"pages_screen": {}})
    assert err == {} and got["pages_screen"] is None                # no field of its own: Same as All Screens
    for bad in ({"show": "yes"}, {"bogus": 1}, "on", ["show"], {"widgets": [{"kind": "x"}]}):
        got, err = C.apply_board({"pages_screen": {"pill": "on"}}, {"pages_screen": bad})
        assert err == {"pages_screen": "choice"}, bad
        assert got["pages_screen"] == {"pill": "on"}                # nothing written


def test_widgets_are_the_side_panes_sections():
    # the twelve sections of the Side Pane (Phase A2's PANE_SECTIONS); where that list exists, they are the same
    assert len(S.PAGES_SCREEN_WIDGETS) == 12 and len(set(S.PAGES_SCREEN_WIDGETS)) == 12
    pane = getattr(S, "PANE_SECTIONS", None)
    if pane is not None:
        assert tuple(pane) == S.PAGES_SCREEN_WIDGETS


def test_the_widgets_are_the_side_panes_sections():
    """The Pages screen's widgets are drawn by the Side Pane (hkSidePane.section): the same kinds, by the same names."""
    from hk_core.settings import model as M
    assert set(M.PAGES_SCREEN_WIDGETS) == set(M.PANE_SECTIONS)
