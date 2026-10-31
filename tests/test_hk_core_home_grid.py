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
    assert M.board({"home_grid": {"cols": 7}})["home_grid"] is None
    assert M.board({"home_grid": "nonsense"})["home_grid"] is None
    assert M.board({"home_style": "masonry"})["home_style"] == "generated"


def test_a_grid_left_out_reads_as_the_defaults():
    g = M.board({"home_grid": {"items": []}})["home_grid"]
    assert g == {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": []}


# ------------------------------------------------------------ the checks
def write(g):
    return C.apply_board({}, {"home_style": "grid", "home_grid": g})


@pytest.mark.parametrize("cols", [6, 5, 4, 3, 2])
def test_six_to_two_columns(cols):
    b, errors = write(grid(block("a1", "scene", "W", [cols - 2, 0]), cols=cols))
    assert errors == {} and b["home_grid"]["cols"] == cols


@pytest.mark.parametrize("g,code", [
    (grid(cols=7), "grid_cols"),
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
    # When Tapped is Automatic, Page, Detail Sheet or Nothing -- and only on a block with something to open
    (grid(block("a1", "weather", "L", [0, 0], opts={"tap": "popup"})), "grid_option"),
    (grid(block("a1", "weather", "L", [0, 0], opts={"tap": True})), "grid_option"),
    (grid(block("a1", "scene", "S", [0, 0], opts={"scene": "scene.good_night", "tap": "page"})), "grid_option"),
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


@pytest.mark.parametrize("tap", ["auto", "page", "sheet", "none"])
def test_when_tapped_is_kept_on_every_block_that_has_something_to_open(tap):
    opening = [k for k, c in HG.CATALOG.items() if c["opts"].get("tap") == "tap_target"]
    assert {"weather", "calendar", "todo", "battery", "power", "water", "energy_rings", "on_now", "people", "room"} <= set(opening)
    assert not {"accessory", "scene", "action", "everything", "camera"} & set(opening)
    for key in opening:
        size = HG.CATALOG[key]["sizes"][0]
        b, errors = write(grid(block("a1", key, size, [0, 0], opts={"tap": tap})))
        assert errors == {}, (key, errors)
        assert b["home_grid"]["items"][0]["opts"] == {"tap": tap}


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


@pytest.mark.parametrize("concept", HG.STARTERS)
def test_every_starter_fills_the_whole_grid_and_saves(concept):
    """Every starter, in a house with all it asks for, uses all 24 cells and passes the write's check."""
    g = HG.starter(concept, **HOUSE)
    assert HG.check(g) == g and sum(len(HG.cells(i)) for i in g["items"]) == 24
    assert C.apply_board({}, {"home_style": "grid", "home_grid": g})[1] == {}
    # an empty house still gets a layout
    assert HG.check(HG.starter(concept)) is not None


def test_a_starter_saves_through_the_write():
    b, errors = C.apply_board({}, {"home_style": "grid", "home_grid": HG.starter("C", **HOUSE)})
    assert errors == {} and b["home_grid"]["band"] is False


# ------------------------------------------------------------ the Cameras face and Full (2026-10-30)
@pytest.mark.parametrize("cols,rows", [(6, 4), (3, 3), (2, 4), (3, 6)])
def test_a_full_block_is_the_whole_view_and_alone_in_it(cols, rows):
    g = grid(block("c1", "cameras", "F", [0, 0], opts={"refresh": 15}), cols=cols, rows=rows)
    assert HG.check(g) == g
    assert HG.cells(g["items"][0], cols, rows) == {(0, c, r) for c in range(cols) for r in range(rows)}
    assert HG.span("F", cols, rows) == (cols, rows) and HG.span("XL", cols, rows) == (3, 2)


def test_a_full_block_shares_its_screen_only_with_other_views():
    g = grid(block("c1", "cameras", "F", [0, 0]), block("a1", "timers", "S", [0, 0], view=1), views=2)
    assert HG.check(g) == g
    assert [i["id"] for i in M.board({"home_grid": grid(block("c1", "cameras", "F", [0, 0]),
                                                        block("a1", "timers", "S", [5, 3]))})["home_grid"]["items"]] == ["c1"]


@pytest.mark.parametrize("g,code", [
    (grid(block("c1", "cameras", "F", [1, 0])), "grid_place"),
    (grid(block("c1", "cameras", "F", [0, 1])), "grid_place"),
    (grid(block("a1", "timers", "S", [5, 3]), block("c1", "cameras", "F", [0, 0])), "grid_overlap"),
    (grid(block("c1", "cameras", "F", [0, 0]), block("a1", "timers", "S", [5, 3])), "grid_overlap"),
    (grid(block("c1", "camera", "F", [0, 0])), "grid_size"),
    (grid(block("c1", "clock", "F", [0, 0])), "grid_size"),
    (grid(block("c1", "cameras", "L", [0, 0])), "grid_size"),
    (grid(block("c1", "cameras", "XL", [0, 0]), cols=2), "grid_fit"),
    (grid(block("c1", "cameras", "XL", [0, 0], opts={"refresh": 4})), "grid_option"),
    (grid(block("c1", "cameras", "XL", [0, 0], opts={"refresh": 61})), "grid_option"),
    (grid(block("c1", "cameras", "XL", [0, 0], opts={"refresh": True})), "grid_option"),
    (grid(block("c1", "cameras", "XL", [0, 0], opts={"cameras": ["light.porch"]})), "grid_option"),
    (grid(block("c1", "cameras", "XL", [0, 0], opts={"cameras": []})), "grid_option"),
    (grid(block("c1", "cameras", "F", [0, 0], pages={"source": "cameras"})), "grid_source"),
])
def test_what_a_cameras_face_refuses(g, code):
    assert write(g)[1] == {"home_grid": code}


def test_a_cameras_face_names_its_cameras_or_shows_them_all():
    g = grid(block("c1", "cameras", "XXL", [0, 0], opts={"cameras": ["camera.front_door", "camera.garden",
                                                                      "camera.front_door"], "refresh": 5}),
             block("c2", "cameras", "XL", [0, 2]))
    b, errors = write(g)
    assert errors == {}
    assert b["home_grid"]["items"][0]["opts"] == {"cameras": ["camera.front_door", "camera.garden"], "refresh": 5}
    assert "opts" not in b["home_grid"]["items"][1], "none named: every camera, in Cameras' order"


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
    assert "var HOME_GRID = { sizes: { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2], XXL: [6, 2], F: [0, 0] }" in base
    # every page source a card names is a source
    assert all(set(v["sources"]) <= set(HG.SOURCES) for v in HG.CATALOG.values())


@pytest.mark.parametrize('kind', HG.CONDITIONS)
def test_conditional_block_roundtrip_with_same_sized_fallback(kind):
    when = {'kind': kind}
    if kind == 'entity_state':
        when.update(entity='media_player.den', state='playing')
    if kind == 'time':
        when.update({'from': '06:00', 'to': '09:00'})
    g = grid(block('music', 'now_playing', 'L', [0, 0], when=when,
                   fallback={'card': 'weather', 'opts': {'entity': 'weather.home'}}))
    assert HG.check(g) == g
    assert M.board_stored({'home_grid': g})['home_grid'] == g


@pytest.mark.parametrize('patch', [
    {'when': {'kind': 'template'}, 'fallback': {'card': 'clock'}},
    {'when': {'kind': 'entity_state'}, 'fallback': {'card': 'clock'}},
    {'when': {'kind': 'entity_state', 'entity': 'bad', 'state': 'on'}, 'fallback': {'card': 'clock'}},
    {'when': {'kind': 'entity_state', 'entity': 'light.lamp', 'state': ''}, 'fallback': {'card': 'clock'}},
    {'when': {'kind': 'music_playing', 'state': 'anything'}, 'fallback': {'card': 'clock'}},
    {'when': {'kind': 'music_playing'}},
    {'when': {'kind': 'music_playing'}, 'fallback': {'card': 'thermostat'}},  # no W
    {'when': {'kind': 'music_playing'}, 'fallback': {'card': 'clock', 'when': {'kind': 'doorbell'}}},
    {'when': {'kind': 'music_playing'}, 'fallback': {'card': 'clock', 'at': [2, 0]}},
    {'fallback': {'card': 'clock'}},
])
def test_conditional_blocks_refuse_missing_or_unsafe_fallbacks(patch):
    with pytest.raises(HG.GridInvalid):
        HG.check(grid(block('music', 'now_playing', 'W', [0, 0], **patch)))


@pytest.mark.skipif(not JSC.exists(), reason='JavaScriptCore unavailable')
def test_condition_catalog_and_runtime_states(tmp_path):
    script = tmp_path / 'conditions.js'
    script.write_text('var window = globalThis; load(' + json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js')) + ''');
var G = hkGridCatalog;
function check(value, message) { if (!value) throw new Error(message); }
var states = { 'media_player.den': {state:'playing'}, 'timer.tea': {state:'paused'},
  'alarm_control_panel.home': {state:'armed_home'}, 'sun.sun': {state:'below_horizon'} };
for (var kind of G.CONDITIONS) {
 if (kind === 'entity_state' || kind === 'doorbell' || kind === 'time' || kind === 'alarm_disarmed') continue;
 check(G.matches({kind:kind}, states, false), kind + ' active');
 check(!G.matches({kind:kind}, {}, false), kind + ' missing is false');
}
check(G.matches({kind:'entity_state',entity:'media_player.den',state:'playing'}, states), 'exact entity state');
check(!G.matches({kind:'entity_state',entity:'media_player.missing',state:'playing'}, states), 'missing entity');
check(G.matches({kind:'doorbell'}, {}, true), 'doorbell event');
check(!G.matches({kind:'doorbell'}, {}, false), 'doorbell expires');
check(G.matches({kind:'timer_running'}, {'sensor.running_quick_timers':{state:'1'}}), 'quick timer sensor');
check(!G.matches({kind:'timer_running',entity:'timer.tea'}, {'sensor.running_quick_timers':{state:'1'}}), 'explicit timer only');
var cfg = G.config({card:'clock',size:'W',when:{kind:'music_playing'},fallback:{card:'weather'}}, {});
check(cfg.type === 'custom:hk-grid-conditional-card', 'conditional wraps the entire block');
// the new conditions
check(G.matches({kind:'alarm_disarmed'}, {'alarm_control_panel.home':{state:'disarmed'}}) && !G.matches({kind:'alarm_disarmed'}, states), 'alarm disarmed');
check(G.matches({kind:'time',from:'06:00',to:'09:00'}, {}, false, null, 7*60) && !G.matches({kind:'time',from:'06:00',to:'09:00'}, {}, false, null, 9*60), 'a morning window');
check(G.matches({kind:'time',from:'22:00',to:'05:00'}, {}, false, null, 1*60) && !G.matches({kind:'time',from:'22:00',to:'05:00'}, {}, false, null, 12*60), 'a window past midnight');
check(G.matches({all:[{kind:'time',from:'06:00',to:'09:00'},{kind:'alarm_armed'}]}, states, false, null, 7*60), 'all of them');
check(!G.matches({all:[{kind:'time',from:'06:00',to:'09:00'},{kind:'alarm_armed'}]}, states, false, null, 10*60), '...not when one fails');
// rules: the default, then the first rule that holds
var block = {id:'b1',card:'calendar',size:'L',at:[0,0],rules:[{when:{all:[{kind:'music_playing'}]},card:'now_playing'},
  {when:{all:[{kind:'time',from:'06:00',to:'09:00'},{kind:'alarm_armed'}]},card:'security'}]};
check(G.choose(block, {}, false, null, 12*60) === -1, 'nothing holds: the default');
check(G.choose(block, {'alarm_control_panel.home':{state:'armed_home'}}, false, null, 7*60) === 1, 'the morning rule');
check(G.choose(block, states, false, null, 7*60) === 0, 'the first rule that holds wins');
check(G.config(block, {}).type === 'custom:hk-grid-conditional-card', 'rules wrap the block');
var old = G.rulesOf({id:'b2',card:'clock',size:'W',at:[0,0],when:{kind:'music_playing'},fallback:{card:'weather'}});
check(old.base.card === 'weather' && old.base.size === 'W' && old.rules.length === 1 && old.rules[0].card === 'clock', 'an older when + fallback reads as rules');
print(JSON.stringify(G.CONDITIONS));
''')
    run = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, check=True)
    assert json.loads(run.stdout) == list(HG.CONDITIONS)


def test_rules_check_and_refuse():
    rules = [{"when": {"all": [{"kind": "music_playing"}]}, "card": "now_playing"},
             {"when": {"all": [{"kind": "time", "from": "06:00", "to": "09:00"}, {"kind": "alarm_armed"}]}, "card": "now_playing"},
             {"when": {"kind": "after_sunset"}, "card": "weather", "opts": {"entity": "weather.home"}}]
    g = grid(block("cal", "calendar", "L", [0, 0], rules=rules))
    out = HG.check(g)
    assert out["items"][0]["rules"][2]["when"] == {"all": [{"kind": "after_sunset"}]}      # one condition reads as all
    assert M.board_stored({"home_grid": out})["home_grid"] == out
    bad = [
        rules * 2,                                                                         # more than four
        [{"when": {"all": [{"kind": "music_playing"}] * 4}, "card": "now_playing"}],       # more than three conditions
        [{"when": {"kind": "music_playing"}, "card": "timers"}],                           # timers don't come in L
        [{"when": {"kind": "time", "from": "09:00", "to": "09:00"}, "card": "now_playing"}],
        [{"when": {"kind": "time", "from": "9:00", "to": "10:00"}, "card": "now_playing"}],
        [{"when": {"kind": "time", "entity": "sun.sun", "from": "06:00", "to": "09:00"}, "card": "now_playing"}],
        [{"card": "now_playing"}],                                                         # no condition
        [],
    ]
    for r in bad:
        with pytest.raises(HG.GridInvalid):
            HG.check(grid(block("cal", "calendar", "L", [0, 0], rules=r)))
    with pytest.raises(HG.GridInvalid):                                                   # never both ways
        HG.check(grid(block("cal", "calendar", "L", [0, 0], rules=rules[:1], when={"kind": "music_playing"},
                            fallback={"card": "now_playing"})))


def test_fixed_grid_scale_and_full_width_groups():
    for scale in (50, 80, 100):
        out = HG.check({"cols": 6, "rows": 2, "scale": scale, "items": [{"id": "rooms", "card": "room", "size": "XXL", "at": [0, 0]}]})
        assert out["scale"] == scale and out["items"][0]["size"] == "XXL"
    for scale in (True, 49, 101, "80", 75.5):
        with pytest.raises(HG.GridInvalid):
            HG.check({"scale": scale})


def test_calendar_days():
    for n in (1, 2, 7):
        assert HG.check(grid(block("cal", "calendar", "L", [0, 0], opts={"days": n})))["items"][0]["opts"] == {"days": n}
    for bad in (0, 8, 2.5, "3", True):
        with pytest.raises(HG.GridInvalid):
            HG.check(grid(block("cal", "calendar", "L", [0, 0], opts={"days": bad})))


def test_hide_box_and_fill():
    out = HG.check({**grid(block("w", "weather", "L", [0, 0], bare=True), block("c", "clock", "S", [2, 0], bare=False)),
                    "boxes": False, "grow": True})
    assert out["boxes"] is False and out["grow"] is True
    assert out["items"][0]["bare"] is True and "bare" not in out["items"][1]          # off is no option at all
    for bad in ({"bare": "yes"}, {"bare": 1}):
        with pytest.raises(HG.GridInvalid):
            HG.check(grid(block("w", "weather", "L", [0, 0], **bad)))
    for key in ("boxes", "grow"):
        with pytest.raises(HG.GridInvalid):
            HG.check({**grid(), key: "no"})


def test_night_mode():
    out = HG.check({**grid(), "night": {"mode": "night", "from": "21:30", "to": "06:45"}})
    assert out["night"] == {"mode": "night", "from": "21:30", "to": "06:45"}
    assert HG.check({**grid(), "night": {"mode": "always"}})["night"] == {"mode": "always", "from": "22:00", "to": "07:00"}
    for bad in ({"mode": "dim"}, {"mode": "night", "from": "9:00"}, {"mode": "night", "from": "07:00", "to": "07:00"},
                {"mode": "night", "extra": 1}, "always"):
        with pytest.raises(HG.GridInvalid):
            HG.check({**grid(), "night": bad})


def test_views():
    two = {**grid(block("a", "clock", "L", [0, 0]), block("b", "weather", "L", [0, 0], view=1)), "views": 2}
    out = HG.check(two)
    assert out["views"] == 2 and "view" not in out["items"][0] and out["items"][1]["view"] == 1     # the same cells, two views
    assert "views" not in HG.check({**grid(), "views": 1})
    with pytest.raises(HG.GridInvalid):                                                              # past the screen's views
        HG.check({**grid(block("b", "weather", "L", [0, 0], view=1))})
    with pytest.raises(HG.GridInvalid):                                                              # overlap in one view
        HG.check({**grid(block("a", "clock", "L", [0, 0], view=1), block("b", "weather", "L", [1, 1], view=1)), "views": 2})
    for bad in (0, 5, "2", True):
        with pytest.raises(HG.GridInvalid):
            HG.check({**grid(), "views": bad})
    assert len(HG.layout({**two, "views": 1})["items"]) == 1                                         # read: the stray block left out


# ------------------------------------------------------------ the audit's second pass (SET-1, 3..6)
@pytest.mark.parametrize("bad", [[], {}, ["room"]])
def test_a_card_that_is_not_a_name_is_refused_not_a_crash(bad):
    """SET-1 (audit, second pass): a list or an object as a block's card raised TypeError (`card not in CATALOG`
    hashes it) instead of GridInvalid: the page got "failed" on a save, and a stored one (the import, a restore)
    escaped board() on every read."""
    with pytest.raises(HG.GridInvalid):
        HG.check(grid(block("a1", bad, "S", [0, 0])))
    _, errors = C.apply_board({}, {"home_grid": grid(block("a1", bad, "S", [0, 0]))})
    assert errors == {"home_grid": "grid_card"}
    assert M.board({"home_grid": grid(block("a1", bad, "S", [0, 0]))})["home_grid"] is not None   # read: left out


def test_an_unrelated_save_keeps_the_grid_it_could_not_read():
    """SET-3 (audit, second pass): board() reads the grid the tolerant way, and apply_board stored board()'s
    answer, so a menu change deleted for good a block or option this build doesn't know (a newer build's)."""
    future = grid(block("a1", "timers", "S", [0, 0]),
                  block("a2", "weather", "W", [2, 0], opts={"entity": "weather.home", "from_a_newer_build": True}))
    out, errors = C.apply_board({"home_style": "grid", "home_grid": future}, {"menu": "tabbar"})
    assert errors == {} and [i["id"] for i in out["home_grid"]["items"]] == ["a1", "a2"]
    out, _ = C.apply_board({"home_style": "grid", "home_grid": {**future, "a_new_top_level_key": 1}}, {"menu": "tabbar"})
    assert out["home_grid"] is not None
    out, _ = C.apply_board({"home_style": "grid", "home_grid": future}, {"home_grid": grid(block("b1", "timers", "S", [0, 0]))})
    assert [i["id"] for i in out["home_grid"]["items"]] == ["b1"]          # a grid save still replaces it


@pytest.mark.parametrize("make", [
    lambda: grid(block("a1\n", "timers", "S", [0, 0])),
    lambda: grid(block("a1", "accessory", "S", [0, 0], opts={"entity": "light.x\n"})),
    lambda: grid(block("a1", "room", "L", [0, 0], opts={"area": "kitchen\n"})),
    lambda: grid(night={"mode": "night", "from": "22:00\n", "to": "07:00"}),
    lambda: grid(block("a1", "scene_suggested", "L", [0, 0],
                       opts={"windows": [{"start": "05:00\n", "end": "10:00", "scene": "scene.morning"}]})),
])
def test_a_trailing_newline_is_not_an_id(make):
    """SET-4 (audit, second pass): the patterns ended in `$`, which also matches before a final newline."""
    with pytest.raises(HG.GridInvalid):
        HG.check(make())


def test_cols_and_version_are_whole_numbers():
    """SET-5 (audit, second pass): `cols not in COLS` is an equality test, so 6.0 and `v: true` passed."""
    for bad in ({"cols": 6.0}, {"cols": 3.0}, {"v": True}, {"v": 1.0}):
        with pytest.raises(HG.GridInvalid):
            HG.check({"items": [], **bad})


def test_an_entity_id_has_a_length_limit():
    """SET-6 (audit, second pass): entity ids had no length limit (Home Assistant's is 255)."""
    with pytest.raises(HG.GridInvalid):
        HG.check(grid(block("a1", "accessory", "S", [0, 0], opts={"entity": "light." + "a" * 300})))
    assert HG.check(grid(block("a1", "accessory", "S", [0, 0], opts={"entity": "light." + "a" * 200})))


# ------------------------------------------------------------ square cells, the Square screen (2026-10-30, HOMEVIEW-LOOK.md A)
def test_square_cells_are_an_option_and_tile_is_no_key():
    out = HG.check({**grid(block("t", "thermostat", "L", [0, 0])), "cell": "square"})
    assert out["cell"] == "square" and out["items"][0]["at"] == [0, 0]
    assert "cell" not in HG.check({**grid(), "cell": "tile"})                   # the default stores nothing
    assert "cell" not in HG.check(grid()) and "screen" not in HG.check(grid())  # a layout saved before reads as it did
    for bad in ("round", True, 1, None):
        with pytest.raises(HG.GridInvalid):
            HG.check({**grid(), "cell": bad})
    # a stored grid with a cell shape a newer HK wrote is no layout, never a crash
    assert HG.layout({**grid(), "cell": "hexagon"}) is None


def test_the_square_screen():
    sq = {"v": 1, "cols": 3, "rows": 3, "frame": [800, 800], "band": False, "cell": "square", "screen": "square", "grow": True,
          "items": [block("t", "thermostat", "L", [0, 0], opts={"style": "big"}),
                    block("c", "clock", "S", [2, 0], opts={"clock_style": "numbers"}, bare=True)]}
    out = HG.check(sq)
    assert (out["cols"], out["rows"], out["cell"], out["screen"], out["grow"]) == (3, 3, "square", "square", True)
    b, errors = C.apply_board({}, {"home_style": "grid", "home_grid": sq})
    assert errors == {} and M.board(b)["home_grid"] == out
    for bad in ("round", "square ", True):
        with pytest.raises(HG.GridInvalid):
            HG.check({**sq, "screen": bad})


def test_a_blocks_tile_style():
    out = HG.check(grid(block("a", "accessory", "S", [0, 0], opts={"entity": "light.porch"}, tile="centred"),
                        block("s", "scene", "S", [1, 0], opts={"scene": "scene.dinner"}, tile="home"),
                        block("x", "action", "S", [2, 0])))
    assert [i.get("tile") for i in out["items"]] == ["centred", "home", None]    # absent: Same as Screen
    for bad in ("centered", "", True):
        with pytest.raises(HG.GridInvalid):
            HG.check(grid(block("a", "accessory", "S", [0, 0], tile=bad)))
    assert HG.TILE_STYLES == ("home", "centred") and M.TILE_STYLES == ("auto", "home", "centred")


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_cells_faces_and_styles_are_the_mirrors(tmp_path):
    prelude = tmp_path / "prelude.js"
    prelude.write_text("var window = this; function CustomEvent() {} window.dispatchEvent = function () {};\n"
                       f"load({json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js'))});\n"
                       "var G = window.hkGridCatalog;\n"
                       "print(JSON.stringify({cells: G.CELLS, faces: G.CLOCK_FACES, styles: G.THERMOSTAT_STYLES}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True,
                                    timeout=30).stdout)
    assert sorted(out["cells"]) == sorted(HG.CELLS)
    assert out["cells"]["square"] == {"w": 196, "h": 196, "gap": 13, "edge": 14} and out["cells"]["tile"] == {"w": 196, "h": 150, "gap": 10}
    assert [f[0] for f in out["faces"] if f[0]] == list(HG.CLOCK_FACES)          # "" is HK's own, stored as no option
    assert [s[0] for s in out["styles"]] == list(HG.THERMOSTAT_STYLES)
    # ...and hk-base.js's square cell is the same
    base = (ROOT / "web/hk/cards/hk-base.js").read_text()
    assert "HOME_GRID.square = { w: TILE.w, h: 196, gap: 13, edge: 14 };" in base
