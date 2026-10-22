"""Home Grid (docs/phase11/HOME-GRID.md), slice G1: a screen's home_style and home_grid in hk_core -- read and
cleaned by board(), checked and refused by apply_board(), the starter layouts, and the catalog's mirror kept equal
to web/hk/cards/hk-grid-catalog.js."""
import json
from pathlib import Path
import subprocess

import pytest

from hk_core.settings import changes as C
from hk_core.settings import home_grid as HG
from hk_core.settings import model as M

ROOT = Path(__file__).resolve().parent.parent
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


def grid(*items, **kw):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items), **kw}


def block(iid, card, size, at, **more):
    return {"id": iid, "card": card, "size": size, "at": at, **more}


# ------------------------------------------------------------ the model
def test_a_screen_is_generated_with_no_layout_by_default():
    b = M.board(None)
    assert b["home_style"] == "generated" and b["home_grid"] is None
    assert "home_style" not in M.board_stored({}) and "home_grid" not in M.board_stored({})


def test_a_stored_layout_reads_back_checked_and_stored_whole():
    g = grid(block("a1", "room", "L", [0, 0], pages={"source": "rooms", "start": "tablet_room"}),
             block("a2", "timers", "S", [2, 0]))
    b = M.board({"home_style": "grid", "home_grid": g})
    assert b["home_style"] == "grid"
    assert b["home_grid"]["items"][0]["pages"] == {"source": "rooms", "start": "tablet_room"}
    assert M.board_stored({"home_style": "grid", "home_grid": g})["home_grid"] == b["home_grid"]


def test_reading_drops_what_no_longer_checks_and_keeps_the_rest():
    g = grid(block("a1", "room", "L", [0, 0]), block("a2", "gone_card", "S", [2, 0]),
             block("a3", "timers", "S", [1, 1]),          # over a1
             block("a4", "timers", "S", [5, 3]))
    assert [i["id"] for i in M.board({"home_grid": g})["home_grid"]["items"]] == ["a1", "a4"]
    assert M.board({"home_grid": {"cols": 5}})["home_grid"] is None
    assert M.board({"home_grid": "nonsense"})["home_grid"] is None
    assert M.board({"home_style": "masonry"})["home_style"] == "generated"


def test_a_grid_left_out_reads_as_the_defaults():
    g = M.board({"home_grid": {"items": []}})["home_grid"]
    assert g == {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": []}


# ------------------------------------------------------------ the checks
def write(g):
    return C.apply_board({}, {"home_style": "grid", "home_grid": g})


@pytest.mark.parametrize("cols", [6, 3, 2])
def test_six_three_and_two_columns(cols):
    b, errors = write(grid(block("a1", "scene", "W", [cols - 2, 0]), cols=cols))
    assert errors == {} and b["home_grid"]["cols"] == cols


@pytest.mark.parametrize("g,code", [
    (grid(cols=4), "grid_cols"),
    (grid(cols=True), "grid_cols"),
    (grid(rows=1), "grid_rows"),
    (grid(rows=7), "grid_rows"),
    (grid(frame=[100, 800]), "grid_frame"),
    (grid(frame=[1280]), "grid_frame"),
    (grid(band="yes"), "grid"),
    (grid(v=2), "grid"),
    (grid(extra=1), "grid"),
    ([], "grid"),
    (grid(*[block(f"b{i}", "timers", "S", [i % 6, i // 6]) for i in range(25)], rows=6), "grid_items"),
    (grid(block("a1", "toaster", "S", [0, 0])), "grid_card"),
    (grid(block("a1", "timers", "L", [0, 0])), "grid_size"),
    (grid(block("a1", "camera", "XL", [0, 0]), cols=2), "grid_fit"),
    (grid(block("a1", "thermostat", "T", [0, 3])), "grid_place"),
    (grid(block("a1", "camera", "L", [5, 0])), "grid_place"),
    (grid(block("a1", "camera", "L", [0, 3])), "grid_place"),
    (grid(block("a1", "camera", "L", [-1, 0])), "grid_place"),
    (grid(block("a1", "camera", "L", [0, 0]), block("a2", "timers", "S", [1, 1])), "grid_overlap"),
    (grid(block("a1", "timers", "S", [0, 0]), block("a1", "timers", "S", [1, 0])), "grid_item"),
    (grid(block("Bad Id", "timers", "S", [0, 0])), "grid_item"),
    (grid(block("a1", "timers", "S", [0, 0], colour="red")), "grid_item"),
    (grid(block("a1", "thermostat", "T", [0, 0], pages={"source": "cameras"})), "grid_source"),
    (grid(block("a1", "camera", "L", [0, 0], pages={"source": "cameras", "start": "tablet_room"})), "grid_pages"),
    (grid(block("a1", "scenes", "W", [0, 0], pages={"source": "list", "list": []})), "grid_pages"),
    (grid(block("a1", "scenes", "W", [0, 0], pages={"source": "list",
                                                     "list": [{"opts": {"scenes": ["scene.a"]}}] * 13})), "grid_pages"),
    (grid(block("a1", "scenes", "W", [0, 0], pages={"source": "sideways"})), "grid_pages"),
    (grid(block("a1", "scenes", "W", [0, 0], opts={"scenes": ["light.kitchen"]})), "grid_option"),
    (grid(block("a1", "scenes", "W", [0, 0], opts={"colour": "red"})), "grid_option"),
    (grid(block("a1", "camera", "L", [0, 0], opts={"entity": "tablet_room"})), "grid_option"),
    (grid(block("a1", "action", "S", [0, 0], opts={"action": "launch_rocket"})), "grid_option"),
])
def test_what_is_refused_and_why(g, code):
    b, errors = write(g)
    assert errors == {"home_grid": code}
    assert b["home_grid"] is None and b["home_style"] == "generated"   # nothing of the change is made


def test_the_tablets_room_is_an_options_value():
    g = grid(block("a1", "now_playing", "L", [0, 0], opts={"speaker": "tablet_room"}),
             block("a2", "room", "W", [2, 0], opts={"area": "tablet_room"}),
             block("a3", "thermostat", "T", [4, 0], pages={"source": "thermostats", "start": "tablet_room"}),
             block("a4", "action", "S", [5, 0], opts={"action": "script.goodnight"}))
    b, errors = write(g)
    assert errors == {}
    assert b["home_grid"]["items"][0]["opts"] == {"speaker": "tablet_room"}


def test_a_scenes_block_can_swipe_through_its_own_pages():
    pages = {"source": "list", "list": [{"opts": {"scenes": ["scene.dinner", "scene.movie_night"]}},
                                        {"opts": {"scenes": ["scene.good_night"]}}]}
    b, errors = write(grid(block("a4", "scenes", "W", [0, 2], pages=pages)))
    assert errors == {} and b["home_grid"]["items"][0]["pages"] == pages


def test_the_plans_example_layout_checks():
    g = grid(block("a1", "scene_suggested", "L", [0, 0]),
             block("a2", "room", "L", [2, 0], pages={"source": "rooms", "start": "tablet_room"}),
             block("a3", "now_playing", "L", [4, 0], opts={"speaker": "tablet_room"}),
             block("a4", "scenes", "W", [0, 2], pages={"source": "list", "list": [
                 {"opts": {"scenes": ["scene.dinner", "scene.movie_night"]}},
                 {"opts": {"scenes": ["scene.good_night", "scene.good_morning"]}}]}),
             block("a5", "camera", "L", [2, 2], pages={"source": "cameras"}),
             block("a6", "thermostat", "T", [4, 2], pages={"source": "thermostats"}),
             block("a7", "timers", "S", [5, 2]),
             block("a8", "action", "S", [5, 3], opts={"action": "lock_up"}))
    assert write(g)[1] == {}


def test_home_style_alone_and_taking_the_layout_away():
    b, errors = C.apply_board({}, {"home_style": "grid"})
    assert errors == {} and b["home_style"] == "grid" and b["home_grid"] is None
    assert C.apply_board({}, {"home_style": "tiles"})[1] == {"home_style": "choice"}
    b, errors = C.apply_board({"home_grid": grid()}, {"home_grid": None})
    assert errors == {} and b["home_grid"] is None


# ------------------------------------------------------------ the starter layouts
HOUSE = {"scenes": [f"scene.s{i}" for i in range(5)], "rooms": ["kitchen", "den", "porch"],
         "cameras": ["camera.front_door", "camera.yard"], "climate": ["climate.hallway"], "tablet_room": "kitchen"}


@pytest.mark.parametrize("concept", ["A", "C"])
def test_a_starter_layout_checks_and_fills_the_grid_from_the_house(concept):
    g = HG.starter(concept, **HOUSE)
    assert HG.check(g) == g
    cards = {i["card"] for i in g["items"]}
    assert {"room", "camera", "thermostat", "scenes", "now_playing", "action"} <= cards
    assert g["cols"] == 6 and g["rows"] == 4 and g["band"] is (concept == "A")
    # the scenes split into pages of the block's size (W: 2)
    scenes = next(i for i in g["items"] if i["card"] == "scenes")
    assert [p["opts"]["scenes"] for p in scenes["pages"]["list"]] == [["scene.s0", "scene.s1"],
                                                                      ["scene.s2", "scene.s3"], ["scene.s4"]]
    room = next(i for i in g["items"] if i["card"] == "room")
    assert room["pages"] == {"source": "rooms", "start": "tablet_room"}
    # every cell of concept A is used
    if concept == "A":
        assert sum(len(HG.cells(i)) for i in g["items"]) == 24


def test_a_starter_leaves_out_what_the_house_does_not_have():
    g = HG.starter("A", scenes=["scene.dinner"], rooms=[], cameras=[], climate=[], tablet_room=None)
    cards = [i["card"] for i in g["items"]]
    assert "camera" not in cards and "thermostat" not in cards and "room" not in cards
    scenes = next(i for i in g["items"] if i["card"] == "scenes")
    assert scenes["opts"] == {"scenes": ["scene.dinner"]} and "pages" not in scenes
    speaker = next(i for i in g["items"] if i["card"] == "now_playing")
    assert "opts" not in speaker                     # no tablet: no tablet's room
    assert HG.starter("C")["items"]                   # an empty house still gets a layout
    with pytest.raises(HG.GridInvalid):
        HG.starter("B")


def test_a_starter_saves_through_the_write():
    b, errors = C.apply_board({}, {"home_style": "grid", "home_grid": HG.starter("C", **HOUSE)})
    assert errors == {} and b["home_grid"]["band"] is False


# ------------------------------------------------------------ the catalog's mirror
@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_catalog_and_its_python_mirror_agree(tmp_path):
    prelude = tmp_path / "prelude.js"
    prelude.write_text("var window = this; function CustomEvent() {} window.dispatchEvent = function () {};\n"
                       f"load({json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js'))});\n"
                       "print(JSON.stringify({cards: window.hkGridCatalog.table(), sizes: window.hkGridCatalog.SIZES,"
                       " sources: window.hkGridCatalog.SOURCES, room: window.hkGridCatalog.TABLET_ROOM}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True,
                                    timeout=30).stdout)
    # (the options a card declares: test_hk_core_home_grid_cards.py)
    assert {k: {"sizes": v["sizes"], "sources": v["sources"]} for k, v in out["cards"].items()} == \
        {k: {"sizes": list(v["sizes"]), "sources": list(v["sources"])} for k, v in HG.CATALOG.items()}
    assert out["sizes"] == {k: list(v) for k, v in HG.SIZES.items()}
    assert out["sources"] == list(HG.SOURCES) and out["room"] == HG.TABLET_ROOM
    # ...and hk-base.js's size-class table is the same one
    base = (ROOT / "web/hk/cards/hk-base.js").read_text()
    assert "var HOME_GRID = { sizes: { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2] }" in base
    # every page source a card names is a source
    assert all(set(v["sources"]) <= set(HG.SOURCES) for v in HG.CATALOG.values())
