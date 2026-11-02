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
    assert got["v"] == 2                                                   # a v1 layout is stored as v2
    assert got["big"] == {"kind": "time", "size": 40, "pos": "top", "align": "center", "depth": "behind"}
    assert [(w["piece"], w["shape"]) for w in got["zones"]["row"]] == [("weather", "circular"), ("events", "rectangular"), ("readings", "circular")]
    assert got["zones"]["row"][0] == {"piece": "weather", "shape": "circular", "back": "glass", "color": "auto"}
    assert got["zones"]["row"][2]["opts"] == {"reading": "aqi"}
    assert got["zones"]["tr"][0] == {"piece": "status", "shape": "card", "back": "none", "color": "auto"}   # v1's white: the ink
    assert got["upright"] == {"big": {"kind": "time", "size": 30, "pos": "top", "align": "center", "depth": "front"}}
    assert set(got["zones"]) == set(SL.ZONES)
    assert "row_size" not in got and "ink" not in got and "accents" not in got


V2 = {"v": 2, "row_size": 150, "ink": "black", "accents": False, "big": {"kind": "time"},
      "zones": {"row": [{"piece": "weather", "shape": "circular"}, {"piece": "readings", "shape": "circular", "opts": {"reading": "wind"}, "size": 200}],
                "tl": [{"piece": "time", "shape": "card", "size": 180}], "bl": [{"piece": "music", "shape": "inline", "color": "accent"}]}}


MAIL = {"entity": "binary_sensor.mailbox", "op": "is", "value": "on"}


@pytest.mark.parametrize("show,ok", [
    (MAIL, True), ({"entity": "sensor.home_battery_power", "op": "above", "value": 0}, True),
    ({"entity": "sensor.freezer", "op": "below", "value": -10.5}, True), ({"entity": "lock.front", "op": "not", "value": "locked"}, True),
    ({"entity": "mailbox", "op": "is", "value": "on"}, False), ({"entity": "binary_sensor.mailbox", "op": "equals", "value": "on"}, False),
    ({"entity": "binary_sensor.mailbox", "op": "is", "value": ""}, False), ({"entity": "binary_sensor.mailbox", "op": "is", "value": True}, False),
    ({"entity": "binary_sensor.mailbox", "op": "is"}, False), ({"entity": "binary_sensor.mailbox", "op": "is", "value": "x" * 65}, False),
])
def test_a_piece_can_show_only_when(show, ok):
    """2026-11-02, the owner: "if I want to show an entity on the screen for example, Mail Box...it only shows when the
    Mail Has Arrived? Or if the House Battery is charging?" -- a condition on one entity, on any piece."""
    lay = {"v": 2, "zones": {"tl": [{"piece": "status", "shape": "inline", "show": show}]}}
    if ok:
        assert C._saver_options({"layout": lay})["layout"]["zones"]["tl"][0]["show"] == show
    else:
        with pytest.raises(C.Invalid):
            C._saver_options({"layout": lay})


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_condition_is_met_as_the_house_is(tmp_path):
    prelude = tmp_path / "met.js"
    prelude.write_text(
        "var window = this;\n"
        f"load({json.dumps(str(ROOT / 'web/hk/modules/hk-saverlayout.js'))});\n"
        "var L = window.hkSaverLayout, st = {'binary_sensor.mailbox': {state: 'on'}, 'sensor.battery_power': {state: '1250'},\n"
        "  'sensor.gone': {state: 'unavailable'}, 'sensor.mode': {state: 'Charging'}};\n"
        "print(JSON.stringify([L.met(null, st), L.met({entity: 'binary_sensor.mailbox', op: 'is', value: 'on'}, st),\n"
        "  L.met({entity: 'binary_sensor.mailbox', op: 'not', value: 'on'}, st), L.met({entity: 'sensor.battery_power', op: 'above', value: 0}, st),\n"
        "  L.met({entity: 'sensor.battery_power', op: 'below', value: '1000'}, st), L.met({entity: 'sensor.mode', op: 'is', value: 'charging'}, st),\n"
        "  L.met({entity: 'sensor.gone', op: 'not', value: 'on'}, st), L.met({entity: 'sensor.nowhere', op: 'not', value: 'on'}, st)]));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    # (an entity the screen can't read, or one unavailable, never shows the piece: absent isn't "not")
    assert out == [True, True, False, True, False, True, False, False]


def test_a_v2_layout_one_row_size_one_ink_and_sizes_to_200():
    """2026-11-02, the owner on the mock-up: circular widgets in sync ("one common size and let the user decide if
    they want one bigger"); a little color and black or white, the same for the whole screen; up to 200%."""
    got = C._saver_options({"layout": V2})["layout"]
    assert got["row_size"] == 150 and got["ink"] == "black" and got["accents"] is False
    assert "size" not in got["zones"]["row"][0] and got["zones"]["row"][1]["size"] == 200
    assert got["zones"]["tl"][0]["size"] == 180
    assert got["zones"]["bl"][0]["color"] == "accent"
    # the row's room is in units times size: four circulars at 200% fill both lines, a fifth doesn't fit
    four = [{"piece": "weather", "shape": "circular"}] * 4
    assert SL.check({"v": 2, "row_size": 200, "zones": {"row": four}})
    with pytest.raises(SL.LayoutInvalid):
        SL.check({"v": 2, "row_size": 200, "zones": {"row": four + [{"piece": "timers", "shape": "circular"}]}})


@pytest.mark.parametrize("bad", [
    {"v": 3},                                                              # a version this build doesn't know
    {"v": True},
    {"v": 1, "extra": 1},
    {"v": 1, "ink": "black"},                                              # v2's keys only in v2
    {"v": 2, "ink": "gray"},
    {"v": 2, "row_size": 210},
    {"v": 2, "accents": "yes"},
    {"v": 1, "big": {"size": 60}},                                         # bigger than the screen allows
    {"v": 1, "big": {"size": True}},
    {"v": 1, "big": {"kind": "moon"}},
    {"v": 1, "zones": {"side": []}},                                       # the pane is the Side Pane's
    {"v": 1, "zones": {"row": [{"id": "music_card"}]}},                    # a card in the row
    {"v": 2, "zones": {"row": [{"piece": "music", "shape": "card"}]}},
    {"v": 2, "zones": {"line": [{"piece": "date", "shape": "circular"}]}}, # a shape the piece hasn't
    {"v": 2, "zones": {"row": [{"piece": "readings", "shape": "circular", "opts": {"reading": "pollen"}}]}},
    {"v": 2, "zones": {"row": [{"piece": "nope", "shape": "circular"}]}},
    {"v": 1, "zones": {"row": [{"id": "temp"}, {"id": "next_event"}, {"id": "aqi"}, {"id": "locks"},
                               {"id": "next_hours"}, {"id": "humidity"}, {"id": "sunset"}]}},              # 9 units: two lines of four
    {"v": 1, "zones": {"row": [{"id": "temp", "size": 40}]}},              # smaller than a widget goes
    {"v": 1, "zones": {"row": [{"id": "temp", "size": 100.5}]}},
    {"v": 2, "zones": {"row": [{"piece": "weather", "shape": "circular", "size": 201}]}},
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
    assert [w["piece"] for w in lay["zones"]["row"]] == ["weather", "events", "readings", "status", "weather", "readings"]   # what fits
    assert lay["row_at"] == "under"
    assert [(w["piece"], w["shape"]) for w in lay["zones"]["tl"]] == [("time", "card")]
    assert M.saver_options({"layout": {"v": 9}})["layout"] is None
    assert M.saver_options({"layout": "a layout"})["layout"] is None
    # a v2 layout's unknown ink is auto, an unknown piece is left out, an unknown option dropped
    lay2 = M.saver_options({"layout": {"v": 2, "ink": "gray", "zones": {"row": [{"piece": "from_a_newer_build", "shape": "circular"},
                            {"piece": "readings", "shape": "circular", "opts": {"reading": "pollen"}}]}}})["layout"]
    assert "ink" not in lay2 and lay2["zones"]["row"] == [{"piece": "readings", "shape": "circular", "back": "none", "color": "auto"}]


def test_every_widget_and_card_has_a_size_and_the_row_a_place():
    """2026-11-01, the owner: "Lots of options for users on size and scale... around all the elements"; the row "all
    the way at the bottom"; more than one line of widgets."""
    got = C._saver_options({"layout": {"v": 1, "row_at": "bottom", "zones": {
        "row": [{"id": "temp", "size": 120}, {"id": "aqi", "size": 100}, {"id": "next_event"}, {"id": "locks"}, {"id": "sunset"}],
        "br": [{"id": "status_card", "size": 80, "back": "glass"}]}, "upright": {"row_at": "under"}}})["layout"]
    assert got["row_at"] == "bottom" and got["upright"] == {"row_at": "under"}
    assert got["zones"]["row"][0] == {"piece": "weather", "shape": "circular", "back": "none", "color": "auto", "size": 120}
    assert "size" not in got["zones"]["row"][1]                            # 100 was v1's usual: the row's size now
    assert len(got["zones"]["row"]) == 5                                   # a second line
    assert got["zones"]["br"][0] == {"piece": "status", "shape": "card", "back": "glass", "color": "auto", "size": 80}
    assert M.saver_options({"layout": {"v": 1}})["layout"]["row_at"] == "under"


def test_all_screens_checks_the_same_way():
    assert C.HOUSE["look.saver"]({"layout": GOOD})["layout"]["big"]["size"] == 40
    with pytest.raises(C.Invalid):
        C.HOUSE["look.saver"]({"layout": {"v": 1, "big": {"pos": "sideways"}}})


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_pages_catalog_and_checks_are_the_same(tmp_path):
    """hk-saverlayout.js against saver_layout.py: the pieces, their shapes and options, the zones, the v1 map, the big
    element's choices, and the same verdict and the same reading of the same layouts."""
    cases = [GOOD, V2, {"v": 3}, {"v": 1, "zones": {"row": [{"id": "music_card"}]}}, {"v": 1, "big": {"size": 44}},
             {"v": 1, "row_at": "bottom", "zones": {"row": [{"id": "temp", "size": 160}, {"id": "aqi", "size": 59}]}},
             {"v": 1, "row_at": "bottom", "zones": {"row": [{"id": "temp", "size": 160}]}, "upright": {"row_at": "under"}},
             {"v": 1, "big": {"size": 45}}, {"v": 1, "zones": {"tl": [{"id": "date"}, {"id": "clock_card"}]}},
             {"v": 2, "row_size": 200, "zones": {"row": [{"piece": "weather", "shape": "circular"}] * 5}},
             {"v": 2, "zones": {"row": [{"piece": "readings", "shape": "circular", "opts": {"reading": "pollen"}}]}},
             {"v": 2, "ink": "white", "zones": {"bl": [{"piece": "music", "shape": "inline"}]}},
             {"v": 2, "zones": {"tl": [{"piece": "status", "shape": "inline", "show": MAIL}]}},
             {"v": 2, "zones": {"tl": [{"piece": "status", "shape": "inline", "show": {"entity": "mailbox", "op": "is", "value": "on"}}]}}]
    prelude = tmp_path / "prelude.js"
    prelude.write_text(
        "var window = this;\n"
        f"load({json.dumps(str(ROOT / 'web/hk/modules/hk-saverlayout.js'))});\n"
        "var L = window.hkSaverLayout, cases = " + json.dumps(cases) + ";\n"
        "var pieces = {}; Object.keys(L.PIECES).forEach(function (k) { pieces[k] = [L.PIECES[k][0], L.PIECES[k][1]]; });\n"
        "print(JSON.stringify({pieces: pieces, zones: L.ZONES, v1: L.V1, big: L.BIG, def: L.BIG_DEFAULT, backs: L.BACKS, colors: L.COLORS,\n"
        "  size: L.ITEM_SIZE, rowat: L.ROW_AT, inks: L.INKS, shapes: L.SHAPES,\n"
        "  verdicts: cases.map(function (c) { return L.check(c); }), clean: cases.map(function (c) { return L.clean(c); })}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert out["pieces"] == {p: [list(sh), {k: list(c) if isinstance(c, tuple) else c for k, c in o.items()}] for p, (sh, o) in SL.PIECES.items()}
    assert {z: (list(t), r) for z, (t, r) in SL.ZONES.items()} == {z: (v[0], v[1]) for z, v in out["zones"].items()}
    assert {k: [p, s] + ([o] if o else []) for k, (p, s, o) in SL.V1.items()} == out["v1"]
    assert out["big"] == {"kinds": list(SL.BIG_KINDS), "size": list(SL.BIG_SIZE), "pos": list(SL.BIG_POS),
                          "align": list(SL.BIG_ALIGN), "depth": list(SL.BIG_DEPTH)}
    assert out["size"] == list(SL.ITEM_SIZE) and out["rowat"] == list(SL.ROW_AT) and out["inks"] == list(SL.INKS)
    assert out["shapes"] == list(SL.SHAPES)
    assert out["def"] == SL.BIG_DEFAULT and out["backs"] == list(SL.BACKS) and out["colors"] == list(SL.COLORS)

    def py_verdict(c):
        try:
            SL.check(c)
            return None
        except SL.LayoutInvalid as e:
            return e.code
    assert out["verdicts"] == [py_verdict(c) for c in cases]
    assert out["clean"] == [SL.layout(c) for c in cases]


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_editors_looks_and_backgrounds(tmp_path):
    """hk-saver-editor.js (phase 13, phase 5): every Look's own pieces are a v2 layout the write takes; every background it
    offers is read back as itself (bgOf), so the picker always shows a tick where the screensaver is; and a Look tapped on a
    screen changes the Look only -- the zones, the row's size, the ink and the accents stay -- and is read back as that Look."""
    prelude = tmp_path / "prelude.js"
    prelude.write_text(
        "var window = this; var HTMLElement = function () {}; var customElements = { get: function () { return null; }, define: function () {} };\n"
        f"load({json.dumps(str(ROOT / 'web/hk/modules/hk-saverlayout.js'))});\n"
        f"load({json.dumps(str(ROOT / 'web/hk/panels/hk-saver-editor.js'))});\n"
        "var E = window.hkSaverEditor, L = window.hkSaverLayout;\n"
        "var mine = L.clean({ v: 2, big: { kind: 'time' }, row_size: 80, ink: 'black', accents: false, zones: { line: [], row: [{ piece: 'weather', shape: 'circular' }], tl: [],\n"
        "  tr: [{ piece: 'status', shape: 'inline' }], bl: [], br: [], bottom: [] }, upright: null });\n"
        "var taps = E.LOOKS.map(function (look) {\n"
        "  var o = { show: 'photos', clock_style: 'neon', clock_bg: 'gradient', layout: JSON.parse(JSON.stringify(mine)) };\n"
        "  E.applyLook(o, look, false);\n"
        "  return { id: look.id, now: E.lookOf(o), bg: E.bgOf(o), want: look.bg, zones: JSON.stringify(o.layout.zones) === JSON.stringify(mine.zones),\n"
        "           keeps: o.layout.row_size === 80 && o.layout.ink === 'black' && o.layout.accents === false, big: o.layout.big, face: o.clock_style, show: o.show };\n"
        "});\n"
        "print(JSON.stringify({looks: E.LOOKS.map(function (l) { return [l.n, E.lookLayout(l)]; }), taps: taps,\n"
        " bgs: E.BGS.map(function (b) { return [b[0], E.bgOf(b[3])]; })}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert [n for n, _ in out["looks"]] == ["Photo Frame", "Lock Screen", "Forecast", "Big Weather", "Planted", "Clock", "Glance", "Month", "Day", "Nightstand"]
    for name, lay in out["looks"]:
        assert lay["v"] == 2, name
        assert SL.check(lay) is not None, name
        assert SL.check(SL.layout(lay)) is not None, name
    assert all(a == b for a, b in out["bgs"]), out["bgs"]
    for t in out["taps"]:
        assert t["now"] == t["id"], t                      # (each Look is read back as itself)
        assert t["bg"] == t["want"], t
        assert t["zones"] and t["keeps"], t                # (the Info stays: the pieces, the row's size, the ink and the accents)
        assert t["big"]["depth"] in ("front", "behind"), t
    planted = {t["id"]: t for t in out["taps"]}["planted"]
    assert planted["face"] == "planted" and planted["show"] == "forecast"
    assert {t["id"]: t for t in out["taps"]}["bigweather"]["big"]["kind"] == "temp"
