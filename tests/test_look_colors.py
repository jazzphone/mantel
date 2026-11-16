"""Phase 33 (decisions 2-6, docs/phase33/PLAN.md): Looks at All Screens, each Look's background, and one Page Color per
page -- the model changes, and that a house's settings from before read the same after them. (The dashboard's side of the
same carry-over: hk_frontend tests/test_flatcolors.js with fixtures/look_carry.json.)"""
import copy

import pytest

from hk_core.settings import changes as C
from hk_core.settings import looks as L
from hk_core.settings import model as M

SAGE, ROSE = "#7e9b83", "#c17d91"


def house(look=None, **more):
    return {M.CONF_DASHBOARD: {"look": look or {}, **more}}


# ------------------------------------------------------------ a house from before reads the same
def test_a_house_with_no_page_colors_reads_exactly_as_before():
    # (a house's own, 2026-11-15: All Screens in Blur, nothing in page_accents or flat_page_colors)
    before = {"glass": "blur", "flat_colors": {"accent": "auto", "off_tint": "auto", "pages": "accent"}}
    got = M.merged(house(copy.deepcopy(before)))["look"]
    assert got["page_accents"] == {} and got["flat_page_colors"] == {}
    assert got["flat_colors"] == before["flat_colors"] and got["glass"] == "blur" and got["look_undo"] is None


def test_a_screens_flat_colors_are_kept_as_they_were():
    b = {"flat": True, "flat_colors": {"accent": "green", "off_tint": "#ffffff", "pages": "own"}, "accent": "green"}
    got = M.board(copy.deepcopy(b))
    assert got["flat_colors"] == b["flat_colors"] and got["accent"] == "green" and got["flat_page_colors"] == {}


def test_a_pages_flat_accent_from_before_is_its_page_color():
    got = M.merged(house({"page_accents": {"climate": "red", "lights": "pink"},
                          "flat_page_colors": {"climate": {"accent": SAGE, "off_tint": "accent"}, "calendar": {"accent": ROSE},
                                               "room-kitchen": {"accent": "#123456"}, "water": {"accent": "auto"}}}))["look"]
    # the Flat color wins where both were set: the page looked that way in Flat, where it is shown first
    assert got["page_accents"] == {"climate": SAGE, "lights": "pink", "calendar": ROSE}
    # its Tiles When Off stays its own; a room (no page_accents key) and Flat's old Automatic stay where they were
    assert got["flat_page_colors"] == {"climate": {"off_tint": "accent"}, "room-kitchen": {"accent": "#123456"}, "water": {"accent": "auto"}}


def test_choosing_the_pages_colors_takes_the_old_flat_accents_out_of_the_store():
    old = house({"flat_page_colors": {"climate": {"accent": SAGE, "off_tint": "auto"}, "calendar": {"accent": ROSE},
                                      "water": {"accent": "auto"}, "room-kitchen": {"accent": "#123456"}}})
    now = M.merged(old)["look"]["page_accents"]
    opts, err = C.apply_house(old, {"look.page_accents": {**now, "climate": "blue", "water": "teal"}})
    assert err == {}
    stored = opts[M.CONF_DASHBOARD]["look"]
    # (a room's stays, and an old Automatic only goes from the page given a color now)
    assert stored["flat_page_colors"] == {"climate": {"off_tint": "auto"}, "room-kitchen": {"accent": "#123456"}}
    assert M.merged(opts)["look"]["page_accents"] == {"climate": "blue", "calendar": ROSE, "water": "teal"}
    # ...and back to its default: nothing brings the old color back
    opts, err = C.apply_house(opts, {"look.page_accents": {"water": "teal"}})
    assert err == {} and M.merged(opts)["look"]["page_accents"] == {"water": "teal"}


def test_a_screens_page_color_is_its_flat_page_colors_as_before():
    b, err = C.apply_board({}, {"flat_page_colors.climate": {"accent": "pink"}})
    assert err == {} and M.board(b)["flat_page_colors"] == {"climate": {"accent": "pink"}}
    b, err = C.apply_board(b, {"flat_page_colors.climate": {"accent": None}})
    assert err == {} and M.board(b)["flat_page_colors"] == {}


# ------------------------------------------------------------ Looks at All Screens (decision 6)
def house_look_changes(look, s):
    """What hk-settings-model-screens.js houseLookChanges sends (the same mapping), checked as the page's would be."""
    ch, was = {}, {}
    for k, v in look["settings"].items():
        if k == "side_pane":
            for g, gv in v.items():
                was[f"side_pane.{g}"], ch[f"side_pane.{g}"] = s["side_pane"].get(g), gv
            continue
        path = L.HOUSE_KEYS.get(k)
        if not path:
            assert k in L.HOUSE_SKIPPED
            continue
        sec, key = path.split(".", 1)
        was[path], ch[path] = s[sec].get(key), v
        if k == "accent":
            was[L.HOUSE_ACCENT_FLAT], ch[L.HOUSE_ACCENT_FLAT] = s["look"]["flat_colors"]["accent"], v
    was["look.saver"], ch["look.saver"] = s["look"]["saver"], {**s["look"]["saver"], **look["saver"]}
    ch["look.look_undo"] = {"look": look["id"], "was": was}
    return ch


@pytest.mark.parametrize("look", L.LOOKS, ids=L.IDS)
def test_every_look_can_be_all_screens_and_undone(look):
    opts, err = C.apply_house({}, house_look_changes(look, M.merged(None)))
    assert err == {}, err
    got = M.merged(opts)
    assert got["look"]["look_undo"]["look"] == look["id"]
    for k, v in look["settings"].items():
        if k in L.HOUSE_KEYS and k != "screensaver_options":
            sec, key = L.HOUSE_KEYS[k].split(".", 1)
            assert got[sec][key] == v, k
    # its Undo: All Screens' settings back as they were, the Undo spent
    undo = {**got["look"]["look_undo"]["was"], "look.look_undo": None}
    opts, err = C.apply_house(opts, undo)
    assert err == {}, err
    back, first = M.merged(opts), M.merged(None)
    for path in undo:
        sec, key = path.split(".", 1)
        if path != L.HOUSE_ACCENT_FLAT and path != "look.look_undo":
            assert back[sec].get(key) == first[sec].get(key), path


def test_a_house_undo_is_checked_as_its_settings_are():
    ok, err = C.apply_house({}, {"look.look_undo": {"look": "flat", "was": {"look.flat": False, "menu.accent": "orange"}}})
    assert err == {} and M.merged(ok)["look"]["look_undo"]["was"]["menu.accent"] == "orange"
    assert C.apply_house({}, {"look.look_undo": {"look": "flat", "was": {"look.frost": 5}}})[1] == {"look.look_undo": "look_undo"}
    assert C.apply_house({}, {"look.look_undo": {"look": "plaid", "was": {}}})[1] == {"look.look_undo": "look_undo"}
    assert C.apply_house({}, {"look.look_undo": {"look": "flat", "was": {"look.glass": "sparkly"}}})[1] == {"look.look_undo": "choice"}
    assert M.merged(house({"look_undo": {"look": "plaid", "was": {}}}))["look"]["look_undo"] is None


def test_a_screen_keeps_its_own_when_all_screens_takes_a_look():
    look = L.look("night")
    opts, err = C.apply_house({}, house_look_changes(look, M.merged(None)))
    assert err == {}
    b = M.board({"glass": "frosted", "accent": "green", "menu_own": ["accent"]})
    assert b["glass"] == "frosted" and b["accent"] == "green"


# ------------------------------------------------------------ each Look sets its background (the owner, 2026-11-16)
@pytest.mark.parametrize("look", L.LOOKS, ids=L.IDS)
def test_every_look_sets_the_background_its_style_shows(look):
    s = look["settings"]
    if s.get("flat"):
        # Flat keeps backgrounds of its own: Flat chooses a Color
        assert s.get("sky_flat_background") in M.FLAT_BACKGROUNDS and M.flat_color(s.get("sky_flat_color"))
    else:
        assert s.get("sky_background") in M.SKY_BACKGROUNDS
        if s["sky_background"] == "color":
            assert s.get("sky_color") in M.SKY_COLOR_IDS


def test_performance_and_flat_choose_a_color():
    assert L.look("performance")["settings"]["sky_background"] == "color"
    assert L.look("flat")["settings"]["sky_flat_background"] == "color" and L.look("flat")["settings"]["sky_flat_color"] == "stone"
