"""The Home block and its sheet (web/hk/cards/hk-home-block.js; docs/phase27/PLAN.md): the block's pure part run in node --
the sheet's place for a path, Wide's line, a room's reading -- and how it is wired: both catalogs' entry (a Name and
Glyphs, no When Tapped), what a saved layout keeps and refuses, the lazy file, the editors, the assistant's card list,
the generated Home it draws (hkStrategy.homeSheet) and the one hook that keeps a page change inside the sheet. The
browser half is tools/headless/home_sheet_check.py."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

import web_sources

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
const L = window.hkHomeBlock.lib, G = window.hkGridCatalog;
const say = (r) => r.text || (r.num + ' ' + r.unit);
const on = (s) => !!s.on;
const secs = [{ name: 'Security', reading: { text: '1 Unlocked' }, on: true }, { name: 'Climate', reading: { text: '71°' } },
              { name: 'Lights', reading: { num: 3, unit: 'On' }, on: true }, { name: 'Speakers', reading: { num: 1, unit: 'Playing' }, on: true }];
const pages = { security: {}, 'room-kitchen': {}, cameras: {} };
console.log(JSON.stringify({
  seg: ['/wall/security', '/wall/room-kitchen/', './cameras', '/wall/lights?x=1#y', 'weather', ''].map(L.segOf),
  wide: [L.wideLine(secs, on, say), L.wideLine(secs.slice(1, 2), on, say), L.wideLine([], on, say)],
  room: [L.roomSay('68° · 1 on', false, false), L.roomSay('All off', true, true), L.roomSay('', true, false), L.roomSay('', false, false)],
  place: [L.placeOf('security', pages), L.placeOf('weather', pages), L.placeOf('home', pages), L.placeOf(null, pages)],
  card: ['S', 'W', 'T', 'L', 'XL'].map((s) => G.config({ id: 'h', card: 'home', size: s, at: [0, 0] }, {})),
  named: G.config({ id: 'h', card: 'home', size: 'W', at: [0, 0], opts: { title: 'Linden House', glyphs: 'white' } }, {}),
  looks: ['flat', 'glass', 'frosted', 'tinted', 'solid', 'auto', 'bright'].map((look) => G.config({ id: 'h', card: 'home', size: 'S', at: [0, 0], opts: { look } }, {}).look),
  table: G.table().home
}));
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
    return node(SCRIPT, str(ROOT / "web/hk/cards/hk-home-block.js"), str(ROOT / "web/hk/cards/hk-grid-catalog.js"))


# -- the pure part -------------------------------------------------------------------------------------------------
@needs_node
def test_a_page_change_is_known_by_its_last_part(got):
    assert got["seg"] == ["security", "room-kitchen", "cameras", "lights", "weather", ""]


@needs_node
def test_wide_says_what_is_going_on_in_two_at_most(got):
    # the sections that are on or ask for a look, in the chip row's order, two at most; nothing on: "All quiet"
    assert got["wide"] == ["Security 1 Unlocked · Lights 3 On", "All quiet", "All quiet"]


@needs_node
def test_a_rooms_reading_is_the_room_blocks_line_and_what_is_open(got):
    assert got["room"] == ["68° · 1 on", "All off · Unlocked · Open", "Unlocked", ""]


@needs_node
def test_the_sheet_opens_at_a_page_it_has_else_at_home(got):
    assert got["place"] == ["security", "home", "home", "home"]


# -- the catalog and the saved layout ------------------------------------------------------------------------------
@needs_node
def test_both_catalogs_name_the_block_its_sizes_and_three_options(got):
    opts = {"title": "title", "look": "sheet_look", "glyphs": "glyph_color"}
    assert HG.CATALOG["home"] == {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": opts}
    assert got["table"]["sizes"] == ["S", "W", "T", "L", "XL"] and got["table"]["opts"] == opts
    assert got["card"] == [{"type": "custom:hk-home-block-card", "size": s} for s in ("S", "W", "T", "L", "XL")]
    assert got["named"] == {"type": "custom:hk-home-block-card", "size": "W", "title": "Linden House", "glyphs": "white"}


def grid(*items):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items)}


def write(*items):
    return C.apply_board({}, {"home_style": "grid", "home_grid": grid(*items)})


@pytest.mark.parametrize("size", ["S", "W", "T", "L", "XL"])
def test_a_home_block_is_kept_at_every_size(size):
    b, errors = write({"id": "h1", "card": "home", "size": size, "at": [0, 0], "opts": {"title": "Linden House"}})
    assert errors == {} and b["home_grid"]["items"][0]["card"] == "home"
    assert b["home_grid"]["items"][0]["opts"] == {"title": "Linden House"}


@needs_node
def test_the_sheet_wears_the_screens_look_or_a_look_of_its_own(got):
    # (2026-11-12, the owner: "letting me set the appearance would help with looks and performance"; 2026-11-13: "the main goal is
    # to make it easier on the tablet to run... Flat, Glass, Frost, Tint, or Auto"): each carried to the card, Same as Screen is no
    # key at all, the first form's Solid reads as Flat
    assert got["looks"] == ["flat", "glass", "frosted", "tinted", "flat", None, None]
    for look in ("flat", "glass", "frosted", "tinted"):
        b, errors = write({"id": "h1", "card": "home", "size": "S", "at": [0, 0], "opts": {"look": look}})
        assert errors == {} and b["home_grid"]["items"][0]["opts"] == {"look": look}
    b, errors = write({"id": "h1", "card": "home", "size": "S", "at": [0, 0], "opts": {"look": "solid"}})
    assert errors == {} and b["home_grid"]["items"][0]["opts"] == {"look": "flat"}
    for bad in ("auto", "", "bright", "blur", True, None, ["flat"]):
        _, errors = write({"id": "h1", "card": "home", "size": "S", "at": [0, 0], "opts": {"look": bad}})
        assert errors == {"home_grid": "grid_option"}, bad
    src = web_sources.read("web/hk/cards/hk-home-block.js")
    # every variable a look sets, set back inside the sheet, then the chosen look's own; its cards out of the shared blur; Flat is
    # the frame's own Flat (hkFlat, hk-detail.js) for every card in it; a Flat screen's sheet stays Flat
    assert "S.lookVars ? S.lookVars() : []" in src and "S.lookOf(look)" in src and "unglassed(cfg)" in src
    assert "hkFlat() { return this._look === 'flat' && !flatHere() ? flatTheme() : null; }" in src
    assert "lookOf: function (name)" in web_sources.read("web/hk/modules/hk-settings.js")
    assert "panel.hkFlat ? panel.hkFlat() : null" in web_sources.read("web/hk/cards/hk-detail.js")
    core = web_sources.read("web/hk/base/hk-base-card-core.js")
    assert "function flatForced(el)" in core and "var a = renderingAt(el);" in core
    assert "kind === 'sheet_look'" in web_sources.read("web/hk/grid-editor/hk-grid-editor-options.js")


@pytest.mark.parametrize("item,code", [
    ({"card": "home", "size": "XXL"}, "grid_size"),
    ({"card": "home", "size": "F"}, "grid_size"),
    ({"card": "home", "size": "L", "opts": {"tap": "page"}}, "grid_option"),        # the sheet is where it goes
    ({"card": "home", "size": "L", "pages": {"source": "rooms"}}, "grid_source"),
])
def test_what_a_home_block_refuses(item, code):
    _, errors = write({"id": "h1", "at": [0, 0], **item})
    assert errors == {"home_grid": code}


# -- how it is wired -----------------------------------------------------------------------------------------------
def test_the_block_is_wired_in_the_way_the_other_blocks_are():
    from mantel_server import hk_cards
    assert "hk-home-block.js" in hk_cards.LAZY                          # loaded when its card or its sheet is asked for
    assert hk_cards.tags_of(ROOT / "web/hk/cards/hk-home-block.js") == ("hk-detail-home", "hk-home-block-card")
    editor = web_sources.read("web/hk/panels/hk-grid-editor.js")
    assert "home: 'Home' };" in editor and "['Rooms & Lights', ['home', 'room', " in editor and "home: 'mdi:home-outline'" in editor
    assert "kind === 'title' && card === 'home'" in web_sources.read("web/hk/grid-editor/hk-grid-editor-options.js")
    # House Status's parts, one place: the Home block draws with them
    hs = web_sources.read("web/hk/cards/hk-house-status.js")
    assert "window.hkHouseStatus.parts = { Mixin: Mixin, summary: summary," in hs and "var sum = summary(m.sections, size)" in hs


def test_the_sheet_is_the_generated_home_and_a_page_change_inside_it_stays_there():
    views = web_sources.read("web/hk/strategy/hk-strategy-views.js")
    # built by views() itself, its Home the generated one, without the clock, the pop-ups or a car's Home
    assert "var all = views(client, opts, false)" in views and "home_style: 'list', home_grid: null" in views
    assert "car_layout: null, popups: false" in views and "K.homeSheet = homeSheet;" in views
    assert "row = Object.assign({}, row, { lead: false });" in views        # no menu key in a sheet
    assert "if (!v.area) return;" in views                                   # only the rooms open inside; a chip goes to its page
    assert "_openSection(sec) { return P.go(this, sec, false); }" in web_sources.read("web/hk/cards/hk-home-block.js")
    assert "homeSheet: viaClient(homeSheet)" in web_sources.read("web/hk/cards/hk-strategy.js")
    # every card's page change asks a sheet that holds pages first (hkCatchNav), across shadow roots
    core = web_sources.read("web/hk/base/hk-base-card-core.js")
    assert "for (var n = el; n; n = n.parentNode || n.host)" in core and "n.hkCatchNav(path)) return;" in core


@pytest.mark.asyncio
async def test_the_assistants_card_list_offers_it():
    from mantel_server.mcp.tools import screens
    got = await screens.grid_cards(None, {})
    assert got["cards"]["home"] == {"sizes": ["S", "W", "T", "L", "XL"], "pages_from": [], "options": {"title": "title", "look": "sheet_look", "glyphs": "glyph_color"}}
