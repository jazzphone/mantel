"""A Home Grid block's Custom Detail Sheet and Security's HomeView presentation (docs/phase11/HOME-GRID.md, "Custom
Detail Sheet" and "Security's HomeView sizes"): the block-level `interaction` checked on the write and read back
tolerant, the sheet's entities named and cut for a person who may not view them, Compact (3 x 1) offered to Security's
HomeView alone, and hk-grid-catalog.js's copy of the numbers kept equal. Fictional devices only."""
import copy
import json
from pathlib import Path
import subprocess

import pytest

from hk_core.settings import changes as C
from hk_core.settings import home_grid as HG
from hk_core.settings import model as M

ROOT = Path(__file__).resolve().parent.parent
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")

ALARM = "alarm_control_panel.example_house"
FRONT, BACK, ENTRY, CRAWL = "lock.example_front", "lock.example_back", "lock.example_garage_entry", "lock.example_crawl"
GARAGE = "cover.example_garage_door"


def grid(*items, **kw):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items), **kw}


def block(iid, card, size, at, **more):
    return {"id": iid, "card": card, "size": size, "at": at, **more}


def sheet(*entries, **more):
    return {"v": 1, "entries": list(entries), **more}


def entry(eid, entity, **more):
    return {"id": eid, "entity": entity, **more}


def write(g):
    return C.apply_board({}, {"home_style": "grid", "home_grid": g})


SECURITY = sheet(entry("e1", ALARM), entry("e2", FRONT, name="Front Door", secondary={"mode": "state"}),
                 entry("e3", BACK), entry("e4", ENTRY, color="teal"), entry("e5", GARAGE, tile_style="home"),
                 entry("e6", CRAWL, icon="hk:lock", color="#40C8E0"), title="Security", tile_style="centred")


# ------------------------------------------------------------ the schema
def test_a_block_without_interaction_is_as_it_was():
    g = grid(block("a1", "weather", "W", [0, 0], opts={"tap": "page"}), block("a2", "security", "L", [2, 0]))
    assert HG.check(g) == g


@pytest.mark.parametrize("card,size", [(k, v["sizes"][0]) for k, v in HG.CATALOG.items() if v["sizes"][0] != "F"])
def test_every_catalog_card_takes_a_custom_sheet(card, size):
    it = block("a1", card, size, [0, 0], interaction={"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT))})
    got = HG.check(grid(it))
    assert got["items"][0]["interaction"] == {"tap": "custom_sheet", "custom_sheet": {"v": 1, "entries": [{"id": "e1", "entity": FRONT}]}}


def test_the_security_sheet_round_trips_through_the_model():
    g = grid(block("s1", "security", "C", [0, 0], opts={"presentation": "homeview"},
                   interaction={"tap": "custom_sheet", "custom_sheet": SECURITY}))
    b, errors = write(g)
    assert errors == {}
    saved = b["home_grid"]["items"][0]["interaction"]["custom_sheet"]
    assert [e["entity"] for e in saved["entries"]] == [ALARM, FRONT, BACK, ENTRY, GARAGE, CRAWL]
    assert saved["entries"][5]["color"] == "#40c8e0", "a hex is stored lower case"
    assert M.board({"home_style": "grid", "home_grid": b["home_grid"]})["home_grid"] == b["home_grid"]


def test_an_entity_may_be_in_a_sheet_twice_with_entry_ids_of_its_own():
    two = sheet(entry("e1", FRONT), entry("e2", FRONT, secondary={"mode": "attribute", "attribute": "battery_level", "unit": "%"}))
    assert HG.custom_sheet(two)["entries"][1]["secondary"] == {"mode": "attribute", "attribute": "battery_level", "unit": "%"}
    with pytest.raises(HG.GridInvalid) as e:
        HG.custom_sheet(sheet(entry("e1", FRONT), entry("e1", BACK)))
    assert e.value.code == "grid_sheet"


def test_the_accessories_block_still_refuses_an_accessory_twice():
    with pytest.raises(HG.GridInvalid):
        HG.check(grid(block("a1", "accessories", "W", [0, 0], opts={"accessories": [{"entity": FRONT}, {"entity": FRONT}]})))


def test_a_sheet_that_is_on_needs_an_entry_and_a_draft_does_not():
    empty_on = grid(block("a1", "clock", "S", [0, 0], interaction={"tap": "custom_sheet", "custom_sheet": sheet()}))
    assert write(empty_on)[1] == {"home_grid": "grid_sheet_empty"}
    no_sheet = grid(block("a1", "clock", "S", [0, 0], interaction={"tap": "custom_sheet"}))
    assert write(no_sheet)[1] == {"home_grid": "grid_sheet_empty"}
    draft = grid(block("a1", "clock", "S", [0, 0], interaction={"tap": "default", "custom_sheet": sheet()}))
    assert write(draft)[1] == {}
    kept = grid(block("a1", "clock", "S", [0, 0], interaction={"tap": "default", "custom_sheet": SECURITY}))
    assert write(kept)[0]["home_grid"]["items"][0]["interaction"]["custom_sheet"]["entries"][0]["entity"] == ALARM


def test_a_sheet_holds_the_list_limit_and_says_so_past_it():
    full = sheet(*[entry("e%d" % i, FRONT) for i in range(HG.LIST_MAX)])
    assert len(HG.custom_sheet(full)["entries"]) == HG.LIST_MAX
    with pytest.raises(HG.GridInvalid) as e:
        HG.custom_sheet(sheet(*[entry("e%d" % i, FRONT) for i in range(HG.LIST_MAX + 1)]))
    assert e.value.code == "grid_sheet_full"


@pytest.mark.parametrize("bad", [
    {"tap": "toggle", "custom_sheet": sheet(entry("e1", FRONT))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT)), "service": "lock.unlock"},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "v": 2}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "v": True}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "css": "color:red"}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "title": "x" * 61}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "title": "  "}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "icon": "https://example.com/a.png"}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "tile_style": "tall"}},
    {"tap": "custom_sheet", "custom_sheet": {**sheet(entry("e1", FRONT)), "entries": "e1"}},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("E 1", FRONT))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", "Front Door"))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, name="a\nb"))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, color="amber"))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, color="#fff"))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, icon="<svg>"))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, tile_style="sheet"))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, secondary={"mode": "template", "value": "{{ x }}"}))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, secondary={"mode": "room", "attribute": "x"}))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, secondary={"mode": "attribute", "attribute": "a b"}))},
    {"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT, force_active=True))},
])
def test_a_bad_sheet_is_refused_on_the_write(bad):
    code = write(grid(block("a1", "clock", "S", [0, 0], interaction=bad)))[1]["home_grid"]
    assert code.startswith("grid_sheet")


def test_a_bad_sheet_costs_its_block_on_the_read_and_nothing_else():
    good = block("a1", "clock", "S", [0, 0], interaction={"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT))})
    bad = block("a2", "timers", "S", [1, 0], interaction={"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", "nope"))})
    read = M.board({"home_style": "grid", "home_grid": grid(good, bad)})["home_grid"]
    assert [i["id"] for i in read["items"]] == ["a1"]


def test_an_automatic_secondary_is_not_stored_as_if_local():
    got = HG.custom_sheet(sheet(entry("e1", FRONT, secondary={"mode": "auto"}), entry("e2", FRONT, secondary={"mode": "room"})))
    assert "secondary" not in got["entries"][0] and got["entries"][1]["secondary"] == {"mode": "room"}


# ------------------------------------------------------------ what a person may see
def test_a_sheets_entities_are_named_by_the_layout():
    g = grid(block("s1", "clock", "S", [0, 0], interaction={"tap": "default", "custom_sheet": SECURITY}))
    assert HG.entity_ids(g) == {ALARM, FRONT, BACK, ENTRY, GARAGE, CRAWL}


def test_a_hidden_entry_goes_with_its_name_icon_and_color():
    g = HG.check(grid(block("s1", "clock", "S", [0, 0], interaction={"tap": "custom_sheet", "custom_sheet": SECURITY})))
    before = copy.deepcopy(g)
    cut = HG.only_viewable(g, {ALARM, BACK, GARAGE})
    entries = cut["items"][0]["interaction"]["custom_sheet"]["entries"]
    assert [e["entity"] for e in entries] == [ALARM, BACK, GARAGE]
    dumped = json.dumps(cut)
    for hidden in (FRONT, ENTRY, CRAWL, "Front Door", "#40c8e0", '"e2"', '"e6"'):
        assert hidden not in dumped
    assert g == before, "the stored layout is untouched"
    none = HG.only_viewable(g, set())["items"][0]
    assert none["interaction"]["custom_sheet"]["entries"] == [] and none["card"] == "clock", "the block keeps its place"


def test_a_conditional_blocks_sheet_is_cut_on_either_branch():
    it = block("s1", "clock", "S", [0, 0], when={"kind": "entity_state", "entity": FRONT, "state": "unlocked"},
               fallback={"card": "timers"}, interaction={"tap": "custom_sheet", "custom_sheet": sheet(entry("e1", FRONT), entry("e2", BACK))})
    cut = HG.only_viewable(HG.check(grid(it)), {BACK})["items"][0]
    assert cut["card"] == "timers" and [e["entity"] for e in cut["interaction"]["custom_sheet"]["entries"]] == [BACK]


def test_security_members_are_named_and_cut():
    g = HG.check(grid(block("s1", "security", "XL", [0, 0], opts={"presentation": "homeview", "members": [FRONT, GARAGE, CRAWL]})))
    assert HG.entity_ids(g) == {FRONT, GARAGE, CRAWL}
    assert HG.only_viewable(g, {GARAGE})["items"][0]["opts"] == {"presentation": "homeview", "members": [GARAGE]}


# ------------------------------------------------------------ Security's HomeView sizes
@pytest.mark.parametrize("size", ["S", "W", "C", "L", "XL"])
def test_security_homeview_comes_in_its_five_sizes(size):
    g = grid(block("s1", "security", size, [0, 0], opts={"presentation": "homeview"}))
    assert HG.check(g)["items"][0]["size"] == size


def test_compact_is_three_by_one_and_security_homeviews_alone():
    assert HG.SIZES["C"] == (3, 1) and HG.span("C", 6, 4) == (3, 1)
    assert write(grid(block("s1", "security", "C", [0, 0])))[1] == {"home_grid": "grid_size"}
    assert write(grid(block("s1", "weather", "C", [0, 0])))[1] == {"home_grid": "grid_size"}
    assert write(grid(block("s1", "security", "C", [4, 0], opts={"presentation": "homeview"})))[1] == {"home_grid": "grid_place"}
    # a rule's card at Compact is Security's HomeView too
    rule = {"when": {"kind": "after_sunset"}, "card": "security"}
    assert write(grid(block("s1", "security", "C", [0, 0], opts={"presentation": "homeview"}, rules=[rule])))[1] == {"home_grid": "grid_size"}
    rule["opts"] = {"presentation": "homeview"}
    assert write(grid(block("s1", "security", "C", [0, 0], opts={"presentation": "homeview"}, rules=[rule])))[1] == {}


def test_old_security_layouts_read_as_they_were_saved():
    g = grid(block("s1", "security", "L", [0, 0]), block("s2", "security", "XL", [2, 0], opts={"entity": ALARM}),
             block("s3", "security", "S", [5, 0]), block("s4", "security", "W", [0, 2]))
    assert M.board({"home_style": "grid", "home_grid": g})["home_grid"]["items"] == g["items"]


@pytest.mark.parametrize("opts", [{"presentation": "keypad"}, {"presentation": "homeview", "members": [ALARM]},
                                  {"presentation": "homeview", "members": []}, {"presentation": "homeview", "members": "lock.x"}])
def test_security_options_are_checked(opts):
    assert write(grid(block("s1", "security", "W", [0, 0], opts=opts)))[1] == {"home_grid": "grid_option"}


def test_members_keep_their_order_and_each_once():
    got = HG.check(grid(block("s1", "security", "W", [0, 0], opts={"presentation": "homeview", "members": [GARAGE, FRONT, GARAGE]})))
    assert got["items"][0]["opts"]["members"] == [GARAGE, FRONT]


# ------------------------------------------------------------ the frontend's copy
@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_catalogs_sheet_numbers_are_the_servers(tmp_path):
    prelude = tmp_path / "prelude.js"
    prelude.write_text("var window = this; function CustomEvent() {} window.dispatchEvent = function () {};\n"
                       f"load({json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js'))});\n"
                       "var G = window.hkGridCatalog, S = G.SHEET;\n"
                       "var it = {card: 'security', opts: {presentation: 'homeview'}, interaction: {tap: 'custom_sheet', custom_sheet: {v: 1, entries: [{id: 'e1', entity: 'lock.a'}"
                           ", {id: 'e2', entity: 'lock.b', name: 'B'}]}}};\n"
                       "var cp = G.copySheet(it.interaction.custom_sheet); cp.entries[1].name = 'changed';\n"
                       "print(JSON.stringify({v: S.v, max: S.max, titleMax: S.titleMax, nameMax: S.nameMax, taps: S.taps, styles: S.styles,"
                       " secondary: S.secondary, colors: S.colors, icon: S.icon.source, entryId: S.entryId.source,"
                       " route: [G.sheetRoute(it), G.sheetRoute({card: 'accessory'}), G.sheetRoute({card: 'weather'})],"
                       " on: !!G.sheetOf(it), off: G.sheetOf({interaction: {tap: 'default', custom_sheet: {entries: []}}}),"
                       " copy: cp, source: it.interaction.custom_sheet.entries[1].name, names: Object.keys(G.NAMES).sort(),"
                       " hv: [G.config({card: 'security', size: 'S', opts: {presentation: 'homeview'}}).type,"
                       "      G.config({card: 'security', size: 'C', opts: {presentation: 'homeview', members: ['lock.a']}}),"
                       "      G.config({card: 'security', size: 'L', opts: {}}).type]}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert out["v"] == HG.SHEET_VERSION and out["max"] == HG.LIST_MAX
    assert out["titleMax"] == HG.SHEET_TITLE_MAX and out["nameMax"] == HG.SHEET_NAME_MAX
    assert out["taps"] == list(HG.INTERACTION_TAPS) and out["styles"] == list(HG.SHEET_TILE_STYLES)
    assert out["secondary"] == list(HG.ENTRY_SECONDARY) and out["colors"] == list(HG.ACCENT_NAMES)
    assert out["icon"] == HG.ICON_NAME.pattern.replace("\\Z", "$")
    assert out["entryId"] == HG.ENTRY_ID.pattern.replace("\\Z", "$")
    assert out["route"] == ["own", "primary", "surface"]
    assert out["on"] is True and out["off"] is None
    assert [e["id"] for e in out["copy"]["entries"]] == ["e1", "e2"] and out["source"] == "B", "a copy, never a link"
    assert out["names"] == sorted(HG.CATALOG)
    assert out["hv"][0] == "custom:hk-grid-security-key-card"
    assert out["hv"][1] == {"type": "custom:hk-grid-security-hv-card", "size": "C", "members": ["lock.a"]}
    assert out["hv"][2] == "custom:hk-grid-keypad-card", "an old Large Security block keeps its keypad"


def test_compact_security_saves_on_a_square_five_by_four_grid():
    # 2026-11-09, the owner, Kitchen: the editor refused to add it; the server takes the block the editor now builds
    g = grid(block("c1", "clock", "S", [0, 1]), block("s1", "security", "C", [2, 0], opts={"presentation": "homeview"}), cols=5, rows=4)
    assert HG.check(g)["items"][1]["size"] == "C"
    with pytest.raises(HG.GridInvalid):   # Compact without HomeView: refused
        HG.check(grid(block("s1", "security", "C", [2, 0]), cols=5, rows=4))
