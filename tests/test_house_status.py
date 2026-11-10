"""House Status (web/hk/cards/hk-house-status.js, hk-chip.js hkChip.status; docs/phase11/HOUSE-STATUS.md): the block's
pure layout run in node -- how many sections each size holds on square and tile cells, "+N more" never losing one, no
section under a finger's 44 px, when the sheet is wide -- and how the block is wired: both catalogs' entry (no options:
it is the screen's Status Chips), what a saved layout keeps and refuses, the lazy file, the editors, the assistant's
card list. The status model and the taps are HK Frontend's suite (tests/test_housestatus.js, test_blocks_taps.js);
the browser half is tools/headless/house_status_check.py."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from hk_core.settings import changes as C
from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
needs_node = pytest.mark.skipif(not Path(NODE).exists(), reason="no node")

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
(0, eval)(fs.readFileSync(process.argv[3], 'utf8'));
const L = window.hkHouseStatus.lib, G = window.hkGridCatalog;
// a block inside its inset: square cells (196, gap 13, 18 a side) and tile cells (196 x 150, gap 10, 14 a side)
const SQ = { S: [160, 160], W: [369, 160], T: [160, 369], L: [369, 369], XL: [578, 369] };
const TI = { S: [168, 122], W: [374, 122], T: [168, 282], L: [374, 282], XL: [580, 282] };
const out = { square: {}, tile: {}, sweep: [], wide: {}, mode: {}, card: {} };
for (const [name, box] of [['square', SQ], ['tile', TI]]) {
  for (const size of ['W', 'T', 'L', 'XL']) {
    out[name][size] = [0, 1, 3, 4, 6, 8, 11, 20].map((n) => { const x = L.plan(size, box[size][0], box[size][1], n, { words: true });
      return [n, x.cols, x.vis, x.shown, x.more, x.rowH, x.sentence]; });
    for (let n = 0; n <= 24; n++) {
      const x = L.plan(size, box[size][0], box[size][1], n, { words: true }), [iw, ih] = box[size];
      const used = (n ? x.vis : 0) * x.rowH + (size === 'W' || size === 'XL' ? 0 : L.LABEL + L.headH({ words: true }) + 8 + (x.sentence ? 21 : 0));
      out.sweep.push({ size, n, whole: x.shown + x.more === n, tall: x.rowH >= L.TAP, fits: used <= ih });
    }
  }
}
out.wide = { tablet: L.wantWide(1180, 820, 6, 0), one: L.wantWide(1180, 820, 1, 0), upright: L.wantWide(820, 1180, 6, 0),
             phone: L.wantWide(390, 844, 6, 0), short: L.wantWide(900, 500, 6, 0), car: L.wantWide(1280, 720, 6, 0),
             docked: L.wantWide(1180, 820, 6, 360) };
out.mode = [L.sheetMode(772, 6), L.sheetMode(548, 6), L.sheetMode(412, 11), L.sheetMode(772, 1), L.sheetMode(548, 2)];
out.card = ['S', 'W', 'T', 'L', 'XL'].map((s) => G.config({ id: 'h', card: 'house_status', size: s, at: [0, 0] }, {}));
out.table = G.table().house_status;
console.log(JSON.stringify(out));
"""


def node(script: str, *args: str) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as f:
        f.write(script)
        path = f.name
    try:
        done = subprocess.run([NODE, path, *args], capture_output=True, text=True, timeout=60, env={"TZ": "UTC", "PATH": "/usr/bin:/bin"})
    finally:
        Path(path).unlink(missing_ok=True)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def got() -> dict:
    return node(SCRIPT, str(ROOT / "web/hk/cards/hk-house-status.js"), str(ROOT / "web/hk/cards/hk-grid-catalog.js"))


# -- the layout ----------------------------------------------------------------------------------------------------
# ROUND TWO (2026-11-08): a headline over the sections as lines, each at its size's height (NOTHING STRETCHES), the
# language On Now shares; 2026-11-09 (the owner: "the touch areas ... seem small. If everything doesn't fit, maybe have a vertical scroll"): every
# line 56 px, all of them in the list, which scrolls: [n, cols, lines showing at rest, shown (all), more (0), row height, a sentence under the headline]
@needs_node
def test_each_size_holds_what_the_design_says_on_square_cells(got):
    sq = {size: {row[0]: row[1:] for row in rows} for size, rows in got["square"].items()}
    assert sq["W"][6] == [1, 2, 6, 0, 56, False]            # the headline in a third, two lines at rest beside it, six in all
    assert sq["T"][8] == [1, 4, 8, 0, 56, False]            # the headline over four lines at rest, eight in all
    assert sq["L"][6] == [1, 4, 6, 0, 56, True]             # the headline and its sentence over four lines of 56
    assert sq["XL"][8] == [1, 6, 8, 0, 56, True]            # a headline column beside six lines at rest
    assert sq["XL"][0][2:4] == [0, 0]


@needs_node
def test_tile_cells_keep_a_fingers_height_by_saying_less(got):
    ti = {size: {row[0]: row[1:] for row in rows} for size, rows in got["tile"].items()}
    assert ti["W"][6] == [1, 2, 6, 0, 56, False]
    assert ti["T"][6] == [1, 3, 6, 0, 56, False]
    assert ti["L"][6] == [1, 3, 6, 0, 56, True]
    assert ti["XL"][6] == [1, 5, 6, 0, 56, True]


@needs_node
def test_nothing_is_cut_and_none_is_under_a_finger(got):
    assert got["sweep"] and all(s["whole"] and s["fits"] for s in got["sweep"]), [s for s in got["sweep"] if not (s["whole"] and s["fits"])]
    assert all(s["tall"] for s in got["sweep"]), [s for s in got["sweep"] if not s["tall"]]


@needs_node
def test_the_sheet_is_wide_only_where_two_columns_of_panels_fit(got):
    assert got["wide"] == {"tablet": True, "one": False, "upright": False, "phone": False, "short": False, "car": True, "docked": False}
    assert got["mode"] == ["panels", "rows2", "rows", "rows", "rows"]


# -- the catalog and the saved layout ------------------------------------------------------------------------------
@needs_node
def test_both_catalogs_name_the_block_its_sizes_and_no_options(got):
    assert HG.CATALOG["house_status"] == {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {}}
    assert got["table"]["sizes"] == ["S", "W", "T", "L", "XL"] and got["table"]["opts"] == {}
    assert got["card"] == [{"type": "custom:hk-house-status-card", "size": s} for s in ("S", "W", "T", "L", "XL")]


def grid(*items):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items)}


def write(*items):
    return C.apply_board({}, {"home_style": "grid", "home_grid": grid(*items)})


@pytest.mark.parametrize("size", ["S", "W", "T", "L", "XL"])
def test_a_house_status_block_is_kept_at_every_size(size):
    b, errors = write({"id": "h1", "card": "house_status", "size": size, "at": [0, 0]})
    assert errors == {} and b["home_grid"]["items"][0]["card"] == "house_status"


@pytest.mark.parametrize("item,code", [
    ({"card": "house_status", "size": "XXL"}, "grid_size"),
    ({"card": "house_status", "size": "F"}, "grid_size"),
    ({"card": "house_status", "size": "L", "opts": {"tap": "page"}}, "grid_option"),      # each section opens its own place
    ({"card": "house_status", "size": "L", "opts": {"chips": ["lights"]}}, "grid_option"),  # the screen's Status Chips say which
    ({"card": "house_status", "size": "L", "pages": {"source": "rooms"}}, "grid_source"),
])
def test_what_a_house_status_block_refuses(item, code):
    _, errors = write({"id": "h1", "at": [0, 0], **item})
    assert errors == {"home_grid": code}


def test_a_screen_without_the_block_is_unchanged():
    b, errors = write({"id": "w1", "card": "weather", "size": "L", "at": [0, 0]})
    assert errors == {} and [i["card"] for i in b["home_grid"]["items"]] == ["weather"]


# -- how it is wired -----------------------------------------------------------------------------------------------
def test_the_block_is_wired_in_the_way_the_other_blocks_are():
    from mantel_server import hk_cards
    assert "hk-house-status.js" in hk_cards.LAZY                        # loaded when its card is asked for
    assert hk_cards.tags_of(ROOT / "web/hk/cards/hk-house-status.js") == ("hk-house-status-card", "hk-house-status-sheet")
    editor = (ROOT / "web/hk/panels/hk-grid-editor.js").read_text()
    assert "house_status: 'House Status'" in editor and "['Info', ['house_status', " in editor
    assert "house_status: 'mdi:home'" in editor and "card === 'house_status' && !o.page" in editor
    detail = (ROOT / "web/hk/cards/hk-detail.js").read_text()
    assert "opts.panel ? 'panel'" in detail and "var tag = opts.panel ? opts.panel.tag : PANELS[kind];" in detail
    chip = (ROOT / "web/hk/cards/hk-chip.js").read_text()
    # the chip row's switch is the row's: House Status reads the chips with it forced on
    assert "Object.assign({}, b || {}, { chips_row: true })" in chip


@pytest.mark.asyncio
async def test_the_assistants_card_list_offers_it():
    from mantel_server.mcp.tools import screens
    got = await screens.grid_cards(None, {})
    assert got["cards"]["house_status"] == {"sizes": ["S", "W", "T", "L", "XL"], "pages_from": [], "options": {}}
