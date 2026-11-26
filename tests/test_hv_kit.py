"""An Apple HomeView's apps (docs/phase36/PLAN.md): the kit's pure part and how the pages are wired.

The kit (web/hk/cards/hk-hv.js) has a part with no card base, `window.hkHV.lib`, run here in node: harvest() reading a
page's accessories from the cards the strategy built, the state words, the glyph a tile config draws. And the wiring:
every page the strategy hands to a HomeView card is a card some HomeView file registers, and every HomeView file waits
to be asked for (mantel_server/hk_cards.py LAZY), so a wall tablet never loads one.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
KIT = ROOT / "web/hk/cards/hk-hv.js"

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
(0, eval)(fs.readFileSync(process.argv[1], 'utf8'));
const L = window.hkHV.lib, out = {};
const tile = (id, extra) => Object.assign({ type: 'custom:hk-tile-card', entity: id }, extra || {});
const section = (name, tiles) => ({ type: 'grid', cards: [{ type: 'custom:hk-heading-card', name }, { type: 'custom:hk-grid-card', cards: tiles }] });
// a Lights page as the strategy builds it: the title bar (its heading has a height: not a room), the status row, two rooms
const src = [
  { type: 'custom:hk-grid-card', page_header: true, cards: [{ type: 'custom:hk-back-card' }, { type: 'custom:hk-heading-card', name: 'Lights', height: '44px' }] },
  { type: 'custom:hk-page-status-card', page: 'lights' },
  section('Kitchen', [tile('light.pendants', { name: 'Pendants', hk_place: { area: 'kitchen' } }), tile('light.island')]),
  section('Office', [tile('light.desk'), tile('light.pendants')]),
  { type: 'custom:hk-grid-card', card: { type: 'custom:hk-thermostat-card', entity: 'climate.downstairs' } }
];
const h = L.harvest(src);
out.groups = h.groups.map(g => [g.name, g.ids]);
out.first = [h.byId['light.pendants'].group, h.byId['light.pendants'].area, h.byId['light.pendants'].cfg.name];
out.thermostat = L.cardOf(h, 'hk-thermostat-card').entity;
out.cardsOf = L.cardsOf(h, 'hk-page-status-card').length;
out.empty = L.harvest(undefined).tiles.length;
const st = (id, s, a) => ({ entity_id: id, state: s, attributes: a || {} });
out.words = [
  L.word(st('light.a', 'on', { brightness: 128 })), L.word(st('light.a', 'on')), L.word(st('light.a', 'off')),
  L.word(st('lock.a', 'unlocked')), L.word(st('cover.a', 'open', { current_position: 40 })), L.word(st('cover.a', 'open', { current_position: 100 })),
  L.word(st('binary_sensor.a', 'on', { device_class: 'moisture' })), L.word(st('binary_sensor.a', 'off', { device_class: 'window' })),
  L.word(st('fan.a', 'on', { percentage: 33 })), L.word(st('vacuum.a', 'returning')), L.word(st('light.a', 'unavailable')), L.word(null)];
const now = Date.parse('2026-11-26T18:00:00Z');
out.ago = ['2026-11-26T17:59:40Z', '2026-11-26T17:56:00Z', '2026-11-26T16:00:00Z', '2026-11-24T18:00:00Z', 'x'].map(t => L.ago(t, now));
out.icons = [L.iconOf({ icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open-variant' } }, st('lock.a', 'unlocked')),
             L.iconOf({ icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open-variant' } }, st('lock.a', 'locked')),
             L.iconOf({ entity: 'fan.a' }, st('fan.a', 'on')), L.iconOf({}, st('light.a', 'on', { icon: 'mdi:lamp' }))];
out.colors = [L.colorName({ icon_color: 'Purple' }, null), L.colorName({}, st('light.a', 'on')), L.colorName({}, st('sensor.a', '1'))];
out.isOn = ['on', 'open', 'unlocked', 'off', 'locked', 'closed'].map(s => L.isOn(st('x.a', s)));
out.P = L.P(15);
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def lib():
    if not Path(NODE).exists():
        pytest.skip("no node")
    run = subprocess.run([NODE, "-e", SCRIPT, str(KIT)], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def test_harvest_reads_rooms_in_order_and_skips_the_title(lib):
    # the title bar's heading (it has a height) is no room; an accessory under two rooms is the first one's
    assert lib["groups"] == [["Kitchen", ["light.pendants", "light.island"]], ["Office", ["light.desk"]]]
    assert lib["first"] == ["Kitchen", "kitchen", "Pendants"]
    assert lib["thermostat"] == "climate.downstairs"         # a card held as `card`, not `cards`
    assert lib["cardsOf"] == 1
    assert lib["empty"] == 0


def test_state_words_are_the_home_apps(lib):
    assert lib["words"] == ["50%", "On", "Off", "Unlocked", "40% Open", "Open", "Leak", "Closed", "33%", "Returning",
                            "No Response", "Not Found"]
    assert lib["ago"] == ["now", "4m", "2h", "2d", ""]
    assert lib["isOn"] == [True, True, True, False, False, False]


def test_a_tile_configs_glyph_and_color(lib):
    assert lib["icons"] == ["hk:lock-open-variant", "hk:lock", "hk:fan", "mdi:lamp"]
    assert lib["colors"] == ["purple", "yellow", "gray"]
    assert lib["P"] == "calc(15 * var(--pt))"


def test_every_page_the_strategy_hands_over_is_registered_and_lazy():
    views = (ROOT / "web/hk/strategy/hk-strategy-views.js").read_text()
    block = views[views.index("var HV_TAG = {"):]
    block = block[:block.index("};")]
    tags = set(re.findall(r":\s*'([a-z]+)'", block)) | {"power"}
    files = sorted((ROOT / "web/hk/cards").glob("hk-hv*.js"))
    registered = set()
    for f in files:
        registered |= set(re.findall(r"register\('hk-hv-([a-z]+)-card'", f.read_text()))
    assert tags <= registered, sorted(tags - registered)
    import sys
    sys.path.insert(0, str(ROOT / "hosts/server"))
    from mantel_server import hk_cards
    assert {f.name for f in files} <= hk_cards.LAZY
    for f in files:
        assert hk_cards.tags_of(f), f.name                    # a lazy file names its elements, or it would load at the start


def test_homeview_pages_is_a_screens_own_option_off_by_default():
    # a screen's HomeView Pages (the owner, 2026-11-26: "an option to enable these 'HomeView' pages on a Dashboard/Screen so
    # that way you can see them on a desktop computer"): off unless set, and written as a plain true / false
    from hk_core.settings import changes
    from hk_core.settings.model import dashboard_rules
    assert dashboard_rules.board({})["homeview_pages"] is False
    assert dashboard_rules.board({"homeview_pages": True})["homeview_pages"] is True
    assert dashboard_rules.board({"homeview_pages": "yes"})["homeview_pages"] is False
    assert changes.BOARD["homeview_pages"](True) is True
    views = (ROOT / "web/hk/strategy/hk-strategy-views.js").read_text()
    assert "b.homeview_pages === true" in views


def test_the_kit_floats_a_switch_without_changing_the_pages_height_and_frames_it_elsewhere():
    kit = KIT.read_text()
    # the float is a sticky layer of no height (a page that barely scrolls must not bounce), shown by an observer
    assert ".flt{position:sticky;top:var(--hv-float);height:0;" in kit
    assert "new IntersectionObserver" in kit
    # a HomeView is the screen's width; anywhere else the HomeView's 544, centered
    assert ":host{--hvw:min(100vw, 544px)" in kit and ":host([hvdev]){--hvw:100vw" in kit
    shim = (ROOT / "web/shim/homeview.js").read_text()
    assert "'touch-action', 'pan-y'" in shim and "'overflow-x', 'clip'" in shim
