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
def test_an_action_and_everything_are_small_only(size):
    for card in ("action", "everything"):
        _, errors = write({"id": "a1", "card": card, "size": size, "at": [0, 0]})
        assert errors == {"home_grid": "grid_size"}


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
