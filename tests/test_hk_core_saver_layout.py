"""The screensaver's layout (hk_core/settings/saver_layout.py; docs/phase12/SCREENSAVER-EDITOR.md): the write takes only a
layout that checks whole, the read keeps what it can of one, and the page's catalog is the same as this one."""
import json
import subprocess
from pathlib import Path

import pytest

from hk_core.settings import changes as C
from hk_core.settings import model as M
from hk_core.settings import saver_layout as SL

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]

GOOD = {"v": 1, "big": {"kind": "time", "size": 40, "pos": "top", "align": "center", "depth": "behind"},
        "zones": {"line": [{"id": "date"}], "row": [{"id": "temp", "back": "glass"}, {"id": "next_event"}, {"id": "aqi"}],
                  "tl": [{"id": "weather_card"}], "tr": [{"id": "status_card", "color": "white"}],
                  "bl": [{"id": "music_card"}], "br": [{"id": "timers_card"}], "bottom": [{"id": "readings"}]},
        "upright": {"big": {"size": 30}}}


def test_no_layout_draws_as_each_show_always_has():
    assert M.SAVER_DEFAULTS["layout"] is None
    assert M.saver_options({})["layout"] is None
    assert C._saver_options({"show": "photos"})["layout"] is None


def test_a_layout_that_checks_is_stored_whole():
    got = C._saver_options({"layout": GOOD})["layout"]
    assert got["big"] == {"kind": "time", "size": 40, "pos": "top", "align": "center", "depth": "behind"}
    assert [w["id"] for w in got["zones"]["row"]] == ["temp", "next_event", "aqi"]
    assert got["zones"]["row"][0] == {"id": "temp", "back": "glass", "color": "auto"}
    assert got["upright"] == {"big": {"kind": "time", "size": 30, "pos": "top", "align": "center", "depth": "front"}}
    assert set(got["zones"]) == set(SL.ZONES)


@pytest.mark.parametrize("bad", [
    {"v": 2},                                                              # a version this build doesn't know
    {"v": True},
    {"v": 1, "extra": 1},
    {"v": 1, "big": {"size": 60}},                                         # bigger than the screen allows
    {"v": 1, "big": {"size": True}},
    {"v": 1, "big": {"kind": "moon"}},
    {"v": 1, "zones": {"side": []}},                                       # the pane is the Side Pane's
    {"v": 1, "zones": {"row": [{"id": "music_card"}]}},                    # a card in the row
    {"v": 1, "zones": {"row": [{"id": "temp"}, {"id": "next_event"}, {"id": "aqi"}, {"id": "locks"},
                               {"id": "next_hours"}, {"id": "humidity"}, {"id": "sunset"}]}},              # 9 units: two lines of four
    {"v": 1, "zones": {"row": [{"id": "temp", "size": 40}]}},              # smaller than a widget goes
    {"v": 1, "zones": {"row": [{"id": "temp", "size": 100.5}]}},
    {"v": 1, "row_at": "middle"},
    {"v": 1, "upright": {"row_at": "top"}},
    {"v": 1, "zones": {"tl": [{"id": "clock_card"}, {"id": "weather_card"}, {"id": "status_card"}]}},     # 3 in a corner
    {"v": 1, "zones": {"line": [{"id": "nope"}]}},
    {"v": 1, "zones": {"line": [{"id": "date", "back": "frosted"}]}},
    {"v": 1, "upright": {"zones": {}, "look": 1}},
])
def test_the_write_refuses_a_layout_that_does_not_check(bad):
    with pytest.raises(C.Invalid) as e:
        C._saver_options({"layout": bad})
    assert str(e.value) == "saver_layout"


def test_the_read_keeps_what_it_can_and_never_costs_the_other_options():
    stored = {"show": "clock", "clock_style": "neon",
              "layout": {"v": 1, "big": {"kind": "time", "size": 99}, "row_at": "sideways",
                         "zones": {"row": [{"id": "temp"}, {"id": "next_event"}, {"id": "aqi"}, {"id": "locks"},
                                           {"id": "next_hours"}, {"id": "humidity"}, {"id": "sunset"}],
                                   "tl": [{"id": "from_a_newer_build"}, {"id": "clock_card"}], "side": []}}}
    got = M.saver_options(stored)
    assert got["show"] == "clock" and got["clock_style"] == "neon"
    lay = got["layout"]
    assert lay["big"]["size"] == SL.BIG_DEFAULT["size"]                    # the bad value is the default
    assert [w["id"] for w in lay["zones"]["row"]] == ["temp", "next_event", "aqi", "locks", "next_hours", "humidity"]   # what fits
    assert lay["row_at"] == "under"
    assert [w["id"] for w in lay["zones"]["tl"]] == ["clock_card"]
    assert M.saver_options({"layout": {"v": 9}})["layout"] is None
    assert M.saver_options({"layout": "a layout"})["layout"] is None


def test_every_widget_and_card_has_a_size_and_the_row_a_place():
    """2026-11-01, the owner: "Lots of options for users on size and scale... around all the elements"; the row "all
    the way at the bottom"; more than one line of widgets."""
    got = C._saver_options({"layout": {"v": 1, "row_at": "bottom", "zones": {
        "row": [{"id": "temp", "size": 120}, {"id": "aqi", "size": 100}, {"id": "next_event"}, {"id": "locks"}, {"id": "sunset"}],
        "br": [{"id": "status_card", "size": 80, "back": "glass"}]}, "upright": {"row_at": "under"}}})["layout"]
    assert got["row_at"] == "bottom" and got["upright"] == {"row_at": "under"}
    assert got["zones"]["row"][0] == {"id": "temp", "back": "none", "color": "auto", "size": 120}
    assert "size" not in got["zones"]["row"][1]                            # 100 is a widget's usual: not stored
    assert len(got["zones"]["row"]) == 5                                   # a second line
    assert got["zones"]["br"][0] == {"id": "status_card", "back": "glass", "color": "auto", "size": 80}
    assert M.saver_options({"layout": {"v": 1}})["layout"]["row_at"] == "under"


def test_all_screens_checks_the_same_way():
    assert C.HOUSE["look.saver"]({"layout": GOOD})["layout"]["big"]["size"] == 40
    with pytest.raises(C.Invalid):
        C.HOUSE["look.saver"]({"layout": {"v": 1, "big": {"pos": "sideways"}}})


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_pages_catalog_and_checks_are_the_same(tmp_path):
    """hk-saverlayout.js against saver_layout.py: the widgets and their kinds, the zones, the big element's choices,
    and the same verdict on the same layouts."""
    cases = [GOOD, {"v": 2}, {"v": 1, "zones": {"row": [{"id": "music_card"}]}}, {"v": 1, "big": {"size": 44}},
             {"v": 1, "row_at": "bottom", "zones": {"row": [{"id": "temp", "size": 160}, {"id": "aqi", "size": 59}]}},
             {"v": 1, "row_at": "bottom", "zones": {"row": [{"id": "temp", "size": 160}]}, "upright": {"row_at": "under"}},
             {"v": 1, "big": {"size": 45}}, {"v": 1, "zones": {"tl": [{"id": "date"}, {"id": "clock_card"}]}}]
    prelude = tmp_path / "prelude.js"
    prelude.write_text(
        "var window = this;\n"
        f"load({json.dumps(str(ROOT / 'web/hk/modules/hk-saverlayout.js'))});\n"
        "var L = window.hkSaverLayout, cases = " + json.dumps(cases) + ";\n"
        "var kinds = {}; Object.keys(L.CATALOG).forEach(function (k) { kinds[k] = L.CATALOG[k][0]; });\n"
        "print(JSON.stringify({kinds: kinds, zones: L.ZONES, big: L.BIG, def: L.BIG_DEFAULT, backs: L.BACKS, colors: L.COLORS, size: L.ITEM_SIZE, rowat: L.ROW_AT,\n"
        "  verdicts: cases.map(function (c) { return L.check(c); }), clean: L.clean(cases[0])}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert out["kinds"] == SL.CATALOG
    assert {z: (list(t), r) for z, (t, r) in SL.ZONES.items()} == {z: (v[0], v[1]) for z, v in out["zones"].items()}
    assert out["big"] == {"kinds": list(SL.BIG_KINDS), "size": list(SL.BIG_SIZE), "pos": list(SL.BIG_POS),
                          "align": list(SL.BIG_ALIGN), "depth": list(SL.BIG_DEPTH)}
    assert out["size"] == list(SL.ITEM_SIZE) and out["rowat"] == list(SL.ROW_AT)
    assert out["def"] == SL.BIG_DEFAULT and out["backs"] == list(SL.BACKS) and out["colors"] == list(SL.COLORS)

    def py_verdict(c):
        try:
            SL.check(c)
            return None
        except SL.LayoutInvalid as e:
            return e.code
    assert out["verdicts"] == [py_verdict(c) for c in cases]
    assert out["clean"] == SL.layout(GOOD)


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_editors_starters_and_backgrounds(tmp_path):
    """hk-saver-editor.js: every starter's layout is one the write takes, and every background it offers is read back
    as itself (bgOf), so the picker always shows a tick where the screensaver is."""
    prelude = tmp_path / "prelude.js"
    prelude.write_text(
        "var window = this; var HTMLElement = function () {}; var customElements = { get: function () { return null; }, define: function () {} };\n"
        f"load({json.dumps(str(ROOT / 'web/hk/modules/hk-saverlayout.js'))});\n"
        f"load({json.dumps(str(ROOT / 'web/hk/panels/hk-saver-editor.js'))});\n"
        "var E = window.hkSaverEditor, L = window.hkSaverLayout;\n"
        "print(JSON.stringify({starters: E.STARTERS.map(function (s) { return [s[0], s[3] || L.layoutFrom(s[2])]; }),"
        " bgs: E.BGS.map(function (b) { return [b[0], E.bgOf(b[3])]; })}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert len(out["starters"]) >= 9
    for name, lay in out["starters"]:
        assert SL.check(lay) is not None, name
    assert all(a == b for a, b in out["bgs"]), out["bgs"]
