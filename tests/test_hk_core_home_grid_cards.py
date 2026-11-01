"""Home Grid (docs/phase11/HOME-GRID.md), slice G3: the new cards' options in hk_core -- a suggested scene's time
windows, an action's room, the starter layouts' Everything block (only where the screen has no tab bar) -- and the
options the catalog's cards declare, kept equal to the mirror's."""
import json
from pathlib import Path
import subprocess

import pytest

from hk_core.settings import changes as C
from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parent.parent
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


def grid(*items):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items)}


def write(*items):
    return C.apply_board({}, {"home_style": "grid", "home_grid": grid(*items)})


MORNING = {"start": "05:00", "end": "10:00", "scene": "scene.good_morning", "label": " Morning "}
NIGHT = {"start": "22:00", "end": "05:00", "scene": "script.bedtime"}


# ------------------------------------------------------------ scene_suggested
def test_a_suggested_scene_keeps_its_windows():
    b, errors = write({"id": "s1", "card": "scene_suggested", "size": "L", "at": [0, 0],
                       "opts": {"windows": [MORNING, NIGHT]}})
    assert errors == {}
    assert b["home_grid"]["items"][0]["opts"]["windows"] == [
        {"start": "05:00", "end": "10:00", "scene": "scene.good_morning", "label": "Morning"},
        {"start": "22:00", "end": "05:00", "scene": "script.bedtime"}]


def test_a_suggested_scene_without_windows_uses_its_own():
    b, errors = write({"id": "s1", "card": "scene_suggested", "size": "W", "at": [0, 0]})
    assert errors == {} and "opts" not in b["home_grid"]["items"][0]


@pytest.mark.parametrize("windows", [
    [],                                                              # none at all: leave the option out
    [MORNING] * (HG.WINDOWS_MAX + 1),
    "05:00-10:00",
    [{**MORNING, "start": "5:00"}],
    [{**MORNING, "end": "24:00"}],
    [{**MORNING, "end": "05:00"}],                                   # no length
    [{**MORNING, "scene": "light.kitchen"}],
    [{**MORNING, "scene": "scene.Good Morning"}],
    [{**MORNING, "label": ""}],
    [{**MORNING, "label": "x" * (HG.LABEL_MAX + 1)}],
    [{**MORNING, "colour": "red"}],
])
def test_a_window_that_does_not_check_is_refused(windows):
    _, errors = write({"id": "s1", "card": "scene_suggested", "size": "W", "at": [0, 0], "opts": {"windows": windows}})
    assert errors == {"home_grid": "grid_option"}


# ------------------------------------------------------------ action
@pytest.mark.parametrize("opts", [{"action": "lock_up"}, {"action": "lights_off", "area": "tablet_room"},
                                  {"action": "lights_off", "area": "kitchen"}, {"action": "garage"},
                                  {"action": "scene.movie_night"}, {"action": "script.feed_the_cat"}])
def test_an_action_block(opts):
    b, errors = write({"id": "a1", "card": "action", "size": "S", "at": [5, 3], "opts": opts})
    assert errors == {} and b["home_grid"]["items"][0]["opts"] == opts


@pytest.mark.parametrize("opts", [{"action": "unlock_all"}, {"action": "light.kitchen"},
                                  {"action": "lights_off", "area": "Kitchen"}, {"action": "lock_up", "room": "den"}])
def test_an_action_that_is_not_one_is_refused(opts):
    _, errors = write({"id": "a1", "card": "action", "size": "S", "at": [5, 3], "opts": opts})
    assert errors == {"home_grid": "grid_option"}


@pytest.mark.parametrize("size", ["W", "L"])
def test_an_action_is_small_only(size):
    _, errors = write({"id": "a1", "card": "action", "size": size, "at": [0, 0]})
    assert errors == {"home_grid": "grid_size"}


@pytest.mark.parametrize("size", ["W", "L", "XL"])
def test_everything_comes_in_more_sizes(size):
    # (2026-10-31) Wide, Large and Extra Large: the app icons themselves
    _, errors = write({"id": "a1", "card": "everything", "size": size, "at": [0, 0]})
    assert errors == {}


# ------------------------------------------------------------ the starters and the tab bar
HOUSE = {"scenes": [f"scene.s{i}" for i in range(5)], "rooms": ["kitchen", "den"],
         "cameras": ["camera.front_door"], "climate": ["climate.hallway"], "tablet_room": "kitchen"}


@pytest.mark.parametrize("concept", ["A", "C"])
def test_a_starter_has_everything_only_without_a_tab_bar(concept):
    with_bar = HG.starter(concept, **HOUSE)
    without = HG.starter(concept, **HOUSE, tab_bar=False)
    assert "everything" not in {i["card"] for i in with_bar["items"]}
    assert "everything" in {i["card"] for i in without["items"]}
    # the bar's screen gets an All Lights Off in its place: the same cells
    assert HG.check(with_bar) == with_bar and HG.check(without) == without
    assert [i["at"] for i in with_bar["items"]] == [i["at"] for i in without["items"]]
    assert {"action": "lights_off"} in [i.get("opts") for i in with_bar["items"] if i["card"] == "action"]


# ------------------------------------------------------------ the catalog's options
@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_options_a_catalog_card_declares_are_the_mirrors(tmp_path):
    prelude = tmp_path / "prelude.js"
    prelude.write_text("var window = this; function CustomEvent() {} window.dispatchEvent = function () {};\n"
                       f"load({json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js'))});\n"
                       "print(JSON.stringify(window.hkGridCatalog.table()));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True,
                                    timeout=30).stdout)
    declared = {k: v["opts"] for k, v in out.items() if "opts" in v}
    assert {"room", "scene_suggested", "action", "everything"} <= set(declared)
    for key, opts in declared.items():
        assert opts == HG.CATALOG[key]["opts"], key


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_clock_faces_a_block_offers_are_the_mirrors(tmp_path):
    """The Clock block's faces (hk-grid-catalog.js CLOCK_FACES, "" HK's own) are home_grid.py's, and each is one of
    the screensaver's faces; the HomeView-style faces among them (HOMEVIEW-LOOK.md, Phase I)."""
    from hk_core.settings import model as M
    prelude = tmp_path / "prelude.js"
    prelude.write_text("var window = this; function CustomEvent() {} window.dispatchEvent = function () {};\n"
                       f"load({json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js'))});\n"
                       "print(JSON.stringify(window.hkGridCatalog.CLOCK_FACES));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True,
                                    timeout=30).stdout)
    assert [f[0] for f in out] == [""] + list(HG.CLOCK_FACES)
    assert set(HG.CLOCK_FACES) <= set(M.SAVER_CLOCK_STYLES)
    assert {"liquid", "giant", "scattered"} <= set(HG.CLOCK_FACES)
    for face in ("liquid", "giant", "scattered"):
        _, errors = write({"id": "c", "card": "clock", "size": "S", "at": [0, 0], "opts": {"clock_style": face}})
        assert errors == {}, face


@pytest.mark.parametrize('card', ['room', 'scenes'])
def test_group_background_is_checked_and_roundtrips(card):
    appearance = {'color': '#345678', 'opacity': 42, 'blur': 'medium'}
    b, errors = write({'id': 'group', 'card': card, 'size': 'W', 'at': [0, 0], 'opts': {'surface': appearance}})
    assert errors == {}
    assert b['home_grid']['items'][0]['opts']['surface'] == appearance


@pytest.mark.parametrize('appearance', [
    {'color': 'red'}, {'color': '#fff'}, {'opacity': -1}, {'opacity': 101},
    {'opacity': True}, {'opacity': 5.5}, {'blur': 'url(unsafe)'}, {'extra': 1}, 'transparent',
])
def test_group_background_refuses_unbounded_values(appearance):
    _, errors = write({'id': 'group', 'card': 'room', 'size': 'W', 'at': [0, 0], 'opts': {'surface': appearance}})
    assert errors == {'home_grid': 'grid_option'}


@pytest.mark.parametrize('enabled', [True, False])
def test_weather_sky_option_roundtrips(enabled):
    board, errors = write({'id': 'weather', 'card': 'weather', 'size': 'L', 'at': [0, 0], 'opts': {'sky': enabled}})
    assert not errors
    assert board['home_grid']['items'][0]['opts']['sky'] is enabled


@pytest.mark.parametrize('value', ['true', 1, None, {}])
def test_weather_sky_refuses_non_boolean(value):
    _, errors = write({'id': 'weather', 'card': 'weather', 'size': 'L', 'at': [0, 0], 'opts': {'sky': value}})
    assert errors == {'home_grid': 'grid_option'}


def test_the_bands_parts_each_have_a_place_and_an_order():
    # (2026-11-01, the owner: the time on the left, the chips in the middle, the weather on the right)
    parts = [{'k': 'clock', 'at': 'left'}, {'k': 'chips', 'at': 'center'}, {'k': 'weather', 'at': 'right'}]
    assert HG.check({'items': [], 'header': parts})['header'] == parts
    assert HG.check({'items': [], 'header': []})['header'] == [], "every part off"
    for bad in ([{'k': 'clock', 'at': 'left'}, {'k': 'clock', 'at': 'right'}], [{'k': 'moon', 'at': 'left'}],
                [{'k': 'clock', 'at': 'middle'}], [{'k': 'clock'}], {'k': 'clock', 'at': 'left'},
                [{'k': 'clock', 'at': 'left', 'x': 1}]):
        with pytest.raises(HG.GridInvalid):
            HG.check({'items': [], 'header': bad})


def test_header_clock_and_weather_are_independent_and_checked():
    grid = HG.check({'items': [], 'header_clock': False, 'header_weather': True})
    assert HG.check(grid) == grid
    assert grid['header_clock'] is False and grid['header_weather'] is True
    with pytest.raises(HG.GridInvalid):
        HG.check({'items': [], 'header_clock': 'false'})


@pytest.mark.parametrize("size,per", [("W", 2), ("L", 4), ("XL", 6), ("XXL", 12)])
def test_accessory_collection_checks_paging_and_caption(size, per):
    entries = [{"entity": f"sensor.reading_{i}", "secondary": {"mode": "attribute", "attribute": "battery_level", "unit": "%"}} for i in range(per + 1)]
    row = {"id": "group", "card": "accessories", "size": size, "at": [0, 0], "opts": {"title": "My Accessories", "accessories": entries}}
    _, errors = write(row)
    assert errors == {"home_grid": "grid_option"}  # never silently discard overflow
    saved, errors = write({**row, "pages": {"source": "accessories"}})
    assert errors == {} and saved["home_grid"]["items"][0]["opts"]["accessories"] == entries
    saved, errors = write({**row, "opts": {"title": "My Accessories"}, "pages": {"source": "list", "list": [
        {"opts": {"accessories": entries[:per]}}, {"opts": {"accessories": entries[per:]}}]}})
    assert errors == {}


@pytest.mark.parametrize("secondary", [{"mode": "bad"}, {"mode": "attribute"}, {"mode": "attribute", "attribute": "x.y"},
    {"mode": "state", "unit": "%"}, {"mode": "attribute", "attribute": "level", "unit": "x" * 21}])
def test_invalid_caption_options_are_refused(secondary):
    _, errors = write({"id": "one", "card": "accessory", "size": "S", "at": [0, 0], "opts": {"entity": "sensor.a", "secondary": secondary}})
    assert errors == {"home_grid": "grid_option"}


def test_duplicate_collection_entries_are_refused():
    _, errors = write({"id": "group", "card": "accessories", "size": "L", "at": [0, 0],
                       "opts": {"accessories": [{"entity": "light.a"}, {"entity": "light.a"}]}})
    assert errors == {"home_grid": "grid_option"}


@pytest.mark.parametrize("mode", ["summary", "scroll"])
def test_room_accessory_display_is_saved_for_each_page(mode):
    _, errors = write({"id": "room", "card": "room", "size": "L", "at": [0, 0],
                       "opts": {"area": "kitchen", "accessory_display": mode},
                       "pages": {"source": "list", "list": [{"opts": {"area": "den", "accessory_display": mode}}]}})
    assert errors == {}


def test_invalid_room_accessory_display_is_refused():
    _, errors = write({"id": "room", "card": "room", "size": "L", "at": [0, 0], "opts": {"accessory_display": "everything"}})
    assert errors == {"home_grid": "grid_option"}


# ------------------------------------------------------------ Big Number, Analog Numbers (2026-10-30, HOMEVIEW-LOOK.md C, F)
@pytest.mark.parametrize("size", ["T", "L"])
@pytest.mark.parametrize("style", ["dial", "big"])
def test_a_thermostats_style(size, style):
    b, errors = write({"id": "t", "card": "thermostat", "size": size, "at": [0, 0], "opts": {"entity": "climate.hall", "style": style}})
    assert errors == {} and b["home_grid"]["items"][0]["opts"]["style"] == style


@pytest.mark.parametrize("style", ["number", "Big", True, None])
def test_a_thermostat_style_that_is_not_one_is_refused(style):
    _, errors = write({"id": "t", "card": "thermostat", "size": "L", "at": [0, 0], "opts": {"style": style}})
    assert errors == {"home_grid": "grid_option"}


def test_every_thermostat_page_takes_the_blocks_style():
    b, errors = write({"id": "t", "card": "thermostat", "size": "L", "at": [0, 0], "opts": {"style": "big"},
                       "pages": {"source": "thermostats", "start": "tablet_room"}})
    assert errors == {} and b["home_grid"]["items"][0]["opts"] == {"style": "big"}


def test_the_analog_numbers_clock():
    b, errors = write({"id": "c", "card": "clock", "size": "S", "at": [0, 0], "opts": {"clock_style": "numbers"}, "bare": True})
    assert errors == {} and b["home_grid"]["items"][0] == {"id": "c", "card": "clock", "size": "S", "at": [0, 0],
                                                          "opts": {"clock_style": "numbers"}, "bare": True}


def test_half_height_holds_twice_the_accessories():
    # (2026-10-31) Half: the shorter button, two rows in each of Full's
    many = [{"entity": f"light.l{i}"} for i in range(4)]
    _, errors = write({"id": "a1", "card": "accessories", "size": "W", "at": [0, 0], "opts": {"accessories": many}})
    assert errors == {"home_grid": "grid_option"}
    _, errors = write({"id": "a1", "card": "accessories", "size": "W", "at": [0, 0], "opts": {"accessories": many, "height": "half"}})
    assert errors == {}


@pytest.mark.parametrize("name", ["auto", "show", "hide"])
def test_a_camera_blocks_name_is_automatic_shown_or_hidden(name):
    # (2026-10-31, the owner: the camera's name in the corner, an option per block)
    b, errors = write({"id": "c", "card": "camera", "size": "L", "at": [0, 0], "opts": {"name": name}})
    assert errors == {} and b["home_grid"]["items"][0]["opts"] == {"name": name}


@pytest.mark.parametrize("name", ["off", True, None, "Show"])
def test_a_camera_name_that_is_not_one_is_refused(name):
    _, errors = write({"id": "c", "card": "camera", "size": "L", "at": [0, 0], "opts": {"name": name}})
    assert errors == {"home_grid": "grid_option"}
