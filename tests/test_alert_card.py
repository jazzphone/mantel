"""The Alert block (web/hk/cards/hk-alert.js, `alert` in both catalogs; docs/phase11/ALERT.md): its pure part run in node --
how long in words, what the action says, how each size is composed on square and tile cells with and without a picture or an
action, the headline it makes for itself -- and how it is wired: the catalog's card, Show When choosing it in the block's own
place and the block's own card coming back when the rule stops holding (first match wins), what a saved layout keeps and
refuses, what a person who may not see the camera or the door is sent, the lazy file, the editor, the assistant's card list.
The browser half is tools/headless/alert_check.py."""
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

# THE HOUSE'S TWO ALERTS (docs/phase11/ALERT.md "Examples"), as rules on its House Status block
GARAGE = {"when": {"all": [{"kind": "entity_state", "entity": "binary_sensor.garage_door_open_too_long", "state": "on"}]},
          "card": "alert", "opts": {"title": "Garage Still Open", "since": "cover.garage_door",
                                    "camera": "camera.garage_camera_low_resolution_channel", "control": "cover.garage_door",
                                    "icon": "hk:garage-open", "color": "teal"}}
LAUNDRY = {"when": {"all": [{"kind": "entity_state", "entity": "sensor.washer_job_state", "state": "finish"}]},
           "card": "alert", "opts": {"title": "Laundry Ready", "text": "Cycle complete", "since": "sensor.washer_job_state",
                                     "camera": "camera.washer_camera", "icon": "mdi:washing-machine"}}
WATER = {"when": {"all": [{"kind": "entity_state", "entity": "input_select.water_running_monitor_status", "state": "notified"}]},
         "card": "water"}

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
(0, eval)(fs.readFileSync(process.argv[3], 'utf8'));
const L = window.hkAlert.lib, G = window.hkGridCatalog, A = JSON.parse(process.argv[4]);
const NOW = Date.parse('2026-11-10T18:00:00Z'), ago = (m) => new Date(NOW - m * 60000).toISOString();
const out = {};
out.dur = [0, 30e3, 60e3, 23 * 60e3, 65 * 60e3, 3 * 3600e3, 26 * 3600e3, 48 * 3600e3].map(L.dur);
const door = (s, m) => ({ state: s, last_changed: ago(m), attributes: { friendly_name: 'Garage Door', device_class: 'garage' } });
out.since = [
  L.since('cover.garage_door', door('open', 23), NOW), L.since('cover.garage_door', door('open', 75), NOW),
  L.since('sensor.washer_job_state', { state: 'finish', last_changed: ago(12), attributes: {} }, NOW),
  L.since('sensor.washer_job_state', { state: 'finish', last_changed: ago(0.2), attributes: {} }, NOW),
  L.since('binary_sensor.side_door', { state: 'on', last_changed: ago(4), attributes: { device_class: 'door' } }, NOW),
  L.since('lock.front', { state: 'unlocked', last_changed: ago(9), attributes: {} }, NOW),
  L.since('cover.garage_door', door('unavailable', 5), NOW), L.since('cover.garage_door', null, NOW),
  L.since('cover.garage_door', { state: 'open', last_changed: 'soon', attributes: {} }, NOW)];
out.sub = [L.subLine('Cycle complete', '12 min ago'), L.subLine('', 'Open for 23 min'), L.subLine('Cycle complete', null), L.subLine(null, null)];
out.verb = [
  L.verb('cover.garage_door', door('open', 1), { action: 'toggle' }, true), L.verb('cover.garage_door', door('closed', 1), { action: 'toggle' }, true),
  L.verb('lock.front', { state: 'unlocked', attributes: { friendly_name: 'Front Door' } }, { action: 'toggle' }, true),
  L.verb('light.porch', { state: 'on', attributes: { friendly_name: 'Porch' } }, { action: 'toggle' }, false),
  L.verb('light.porch', { state: 'off', attributes: { friendly_name: 'Porch' } }, { action: 'toggle' }, false),
  L.verb('script.dry', { state: 'off', attributes: { friendly_name: 'Start Dryer' } }, { action: 'perform-action' }, false),
  L.verb('vacuum.down', { state: 'cleaning', attributes: { friendly_name: 'Downstairs' } }, { action: 'toggle' }, true)];
out.tap = [L.tapOf({ tap_action: { action: 'more-info' }, icon_tap_action: { action: 'toggle' } }), L.tapOf({ tap_action: { action: 'navigate' } }), L.tapOf(null)];
// a block inside its inset: square cells (196, gap 13, 18 a side) and tile cells (196 x 150, gap 10, 14 a side)
const BOX = { square: { S: [160, 160], W: [369, 160], T: [160, 369], L: [369, 369], XL: [578, 369] },
              tile: { S: [168, 122], W: [374, 122], T: [168, 282], L: [374, 282], XL: [580, 282] } };
out.plan = {};
for (const shape of ['square', 'tile']) for (const size of ['S', 'W', 'T', 'L', 'XL']) for (const pic of [true, false]) for (const act of [true, false]) {
  const [iw, ih] = BOX[shape][size], p = L.plan(size, iw, ih, pic, act, shape === 'tile');
  out.plan[[shape, size, pic ? 'pic' : 'np', act ? 'act' : 'na'].join('.')] = { pic: p.pic, pill: p.pill, col: p.col, iw, ih };
}
out.camOk = [L.camOk({ state: 'idle', attributes: { entity_picture: '/api/camera_proxy/camera.g?token=1' } }), L.camOk({ state: 'unavailable', attributes: { entity_picture: 'x' } }),
             L.camOk({ state: 'idle', attributes: {} }), L.camOk(null)];
const st = { 'cover.garage_door': door('open', 3) };
out.head = [L.headlineOf({ title: 'Garage Still Open' }, st), L.headlineOf({ control: 'cover.garage_door' }, st, (s, id) => L.forWord(id, s)), L.headlineOf({}, st), L.headlineOf({ since: 'cover.nope' }, st)];
// THE CATALOG: the card it makes, the conditional block a rule makes, and which shows as the house moves
out.card = ['S', 'W', 'T', 'L', 'XL'].map((s) => G.config({ id: 'a', card: 'alert', size: s, at: [0, 0], opts: A.garage.opts }, {}));
out.table = G.table().alert;
const block = { id: 'b1', card: 'house_status', size: 'T', at: [3, 0], rules: [A.water, A.garage, A.laundry] };
out.blockCfg = G.config(block, {}).type;
const house = (water, garage, washer) => ({ 'input_select.water_running_monitor_status': { state: water }, 'binary_sensor.garage_door_open_too_long': { state: garage },
                                            'sensor.washer_job_state': { state: washer } });
out.choose = {
  quiet: G.choose(block, house('idle', 'off', 'none')), garage: G.choose(block, house('idle', 'on', 'none')),
  laundry: G.choose(block, house('idle', 'off', 'finish')), both: G.choose(block, house('idle', 'on', 'finish')),
  water: G.choose(block, house('notified', 'on', 'finish')), cleared: G.choose(block, house('idle', 'off', 'run')),
  gone: G.choose(block, {}) };
const choices = (k) => k === 'camera' ? [['camera.porch', 'Porch'], ['camera.garage_cam', 'Garage Cam']] : [['light.a', 'A'], ['cover.shade', 'Shade'], ['cover.garage_door', 'Garage Door']];
out.sample = G.alert.sample(choices, { 'cover.garage_door': { attributes: { device_class: 'garage' } } });
out.sampleNone = G.alert.sample(() => [], {});
const rows = []; const K = new Proxy({}, { get: (_, k) => (o) => { rows.push([k, o.label]); return o; } });
G.alert.rows(K, {}, () => {}, choices);
out.rows = rows;
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
    return node(SCRIPT, str(ROOT / "web/hk/cards/hk-alert.js"), str(ROOT / "web/hk/cards/hk-grid-catalog.js"),
                json.dumps({"garage": GARAGE, "laundry": LAUNDRY, "water": WATER}))


# -- the words -----------------------------------------------------------------------------------------------------
@needs_node
def test_how_long_in_words(got):
    assert got["dur"] == ["less than a minute", "less than a minute", "1 min", "23 min", "1 hr 5 min", "3 hr", "1 day 2 hr", "2 days"]


@needs_node
def test_the_line_counts_from_the_state_it_is_in(got):
    # a condition is "for" (the cover's open-state timestamp: its last_changed); a moment is "ago"; no telling is no line
    assert got["since"] == ["Open for 23 min", "Open for 1 hr 15 min", "12 min ago", "Just now", "Open for 4 min", "Unlocked for 9 min",
                            None, None, None]
    assert got["sub"] == ["Cycle complete · 12 min ago", "Open for 23 min", "Cycle complete", ""]


@needs_node
def test_the_action_says_what_you_are_there_to_do(got):
    assert got["verb"] == [["Close", "Close Garage Door"], ["Open", "Open Garage Door"], ["Lock", "Lock Front Door"],
                           ["Turn Off", "Turn Off Porch"], ["Turn On", "Turn On Porch"], ["Run", "Start Dryer"],
                           ["Details", "Downstairs"]]
    # the tile's own: its glyph's action where it has one, else its tap, else the sheet
    assert got["tap"] == [{"action": "toggle"}, {"action": "navigate"}, {"action": "more-info"}]


@needs_node
def test_a_camera_without_a_still_is_no_picture(got):
    assert got["camOk"] == [True, False, False, False]


@needs_node
def test_a_headline_of_its_own_when_given_none(got):
    assert got["head"] == ["Garage Still Open", "Garage Door Open", "Alert", "Alert"]


# -- the sizes -----------------------------------------------------------------------------------------------------
@needs_node
def test_tall_stacks_and_large_gives_the_picture_and_the_action_room(got):
    p = got["plan"]
    assert p["square.T.pic.act"]["pic"] == [160, 160] and p["square.T.pic.act"]["pill"] == 44     # stacked: a square still over the pill
    assert p["tile.T.pic.act"]["pic"] == [168, 94]                                                  # 16:9 on a tile cell's 282
    assert p["square.L.pic.act"]["pic"] == [369, 220] and p["square.L.pic.act"]["pill"] == 48     # the block's width, the pill too
    assert p["tile.L.pic.act"]["pic"] == [374, 161]
    assert p["square.XL.pic.act"]["pic"] == [358, 369] and p["square.XL.pic.act"]["col"] == 202   # the still beside the words
    assert p["square.W.pic.act"]["pic"] == [185, 160] and p["square.W.pic.act"]["col"] == 170
    assert p["square.S.pic.na"]["pic"] == [160, 160] and p["square.S.pic.act"]["pill"] == 0       # Small: the plate is the action


@needs_node
def test_every_size_fits_its_block_and_keeps_the_action_without_a_picture(got):
    head = {"T": 120, "L": 77, "L1": 49}
    for key, p in got["plan"].items():
        shape, size, pic, act = key.split(".")
        assert p["pill"] == ({"S": 0, "W": 40, "T": 44, "L": 48, "XL": 48}[size] if act == "act" else 0), key
        if pic == "np":
            assert p["pic"] is None, key                                     # no camera: the words and the action alone
            continue
        w, h = p["pic"]
        assert w <= p["iw"] and h <= p["ih"] and w > 0 and h >= 64, key
        foot = p["pill"] + 12 if p["pill"] else 0
        if size == "T":
            assert head["T"] + 12 + h + foot <= p["ih"], key
        if size == "L":
            assert head["L1" if shape == "tile" else "L"] + 12 + h + foot <= p["ih"], key
        if size in ("W", "XL"):
            assert w + (14 if size == "W" else 18) + p["col"] == p["iw"] and p["col"] >= 160, key


# -- Show When -----------------------------------------------------------------------------------------------------
@needs_node
def test_the_catalog_makes_the_alert_card_at_every_size(got):
    assert got["table"] == {"sizes": ["S", "W", "T", "L", "XL"], "sources": [],
                            "opts": {k: HG.CATALOG["alert"]["opts"][k] for k in HG.CATALOG["alert"]["opts"]}}
    assert got["card"] == [{"type": "custom:hk-grid-alert-card", "size": s, **GARAGE["opts"]} for s in ("S", "W", "T", "L", "XL")]


@needs_node
def test_first_match_wins_and_the_default_comes_back_when_the_alert_clears(got):
    assert got["blockCfg"] == "custom:hk-grid-conditional-card"
    c = got["choose"]
    assert c["quiet"] == -1 and c["cleared"] == -1 and c["gone"] == -1      # House Status, the block's own card
    assert c["garage"] == 1 and c["laundry"] == 2
    assert c["both"] == 1 and c["water"] == 0                               # the rules' order, not the newest alert


@needs_node
def test_the_editor_rows_and_the_card_lists_preview(got):
    assert [r[1] for r in got["rows"]] == ["Headline", "Supporting Text", "Time Since", "Camera Snapshot", "Action", "Color", "Glyph",
                                          "Made for Show When"]
    assert got["sample"] == {"title": "Garage Still Open", "since": "cover.garage_door", "control": "cover.garage_door", "camera": "camera.garage_cam"}
    assert got["sampleNone"] == {"title": "Garage Still Open"}


# -- the saved layout ----------------------------------------------------------------------------------------------
def grid(*items):
    return {"v": 1, "cols": 5, "rows": 4, "frame": [1280, 800], "band": True, "cell": "square", "items": list(items)}


def write(*items):
    return C.apply_board({}, {"home_style": "grid", "home_grid": grid(*items)})


@pytest.mark.parametrize("size", ["T", "L"])
def test_the_houses_rules_are_kept_in_order_at_tall_and_large(size):
    b, errors = write({"id": "b1", "card": "house_status", "size": size, "at": [3, 0], "rules": [WATER, GARAGE, LAUNDRY]})
    assert errors == {}
    rules = b["home_grid"]["items"][0]["rules"]
    assert [r["card"] for r in rules] == ["water", "alert", "alert"]
    assert rules[1]["opts"] == GARAGE["opts"] and rules[2]["opts"] == LAUNDRY["opts"]


@pytest.mark.parametrize("size", ["S", "W", "T", "L", "XL"])
def test_an_alert_is_kept_at_every_size(size):
    b, errors = write({"id": "a1", "card": "alert", "size": size, "at": [0, 0], "opts": {"title": "Laundry Ready"}})
    assert errors == {} and b["home_grid"]["items"][0]["opts"] == {"title": "Laundry Ready"}


@pytest.mark.parametrize("opts,code", [
    ({"text": "x" * 81}, "grid_option"),
    ({"text": "two\nlines"}, "grid_option"),
    ({"title": "x" * 61}, "grid_option"),
    ({"camera": "cover.garage_door"}, "grid_option"),             # a camera is a camera
    ({"control": "not an entity"}, "grid_option"),
    ({"since": "cover.garage_door ", "title": "t"}, "grid_option"),
    ({"color": "#ff0000"}, "grid_option"),                         # the named accents
    ({"icon": "https://example.test/x.png"}, "grid_option"),       # an icon by name, never a URL
    ({"tap": "page"}, "grid_option"),                              # no When Tapped: its parts open their own places
    ({"template": "{{ states('x') }}"}, "grid_option"),
])
def test_what_an_alert_refuses(opts, code):
    _, errors = write({"id": "b1", "card": "house_status", "size": "T", "at": [3, 0],
                       "rules": [{**GARAGE, "opts": {**GARAGE["opts"], **opts}}]})
    assert errors == {"home_grid": code}


@pytest.mark.parametrize("size,code", [("XXL", "grid_size"), ("C", "grid_size")])
def test_an_alert_has_the_blocks_sizes(size, code):
    _, errors = write({"id": "a1", "card": "alert", "size": size, "at": [0, 0]})
    assert errors == {"home_grid": code}


def test_a_person_who_may_not_see_the_camera_or_the_door_is_sent_neither():
    g = HG.check(grid({"id": "b1", "card": "house_status", "size": "T", "at": [3, 0], "rules": [GARAGE, LAUNDRY]}))
    assert {"cover.garage_door", "camera.garage_camera_low_resolution_channel", "camera.washer_camera",
            "sensor.washer_job_state", "binary_sensor.garage_door_open_too_long"} <= HG.entity_ids(g)
    ok = {"binary_sensor.garage_door_open_too_long", "sensor.washer_job_state", "camera.washer_camera"}
    cut = HG.only_viewable(g, ok)["items"][0]["rules"]
    # the garage's alert still says so, without the door's control, its time or its camera; the laundry's is whole
    assert cut[0]["opts"] == {"title": "Garage Still Open", "icon": "hk:garage-open", "color": "teal"}
    assert cut[1]["opts"] == LAUNDRY["opts"]


# -- how it is wired -----------------------------------------------------------------------------------------------
def test_the_block_is_wired_in_the_way_the_other_blocks_are():
    from mantel_server import hk_cards
    assert "hk-alert.js" in hk_cards.LAZY
    assert hk_cards.tags_of(ROOT / "web/hk/cards/hk-alert.js") == ("hk-grid-alert-card",)
    editor = (ROOT / "web/hk/panels/hk-grid-editor.js").read_text()
    assert "alert: 'Alert'" in editor and "'house_status', 'alert'," in editor and "card === 'alert'" in editor
    assert "alert: 'mdi:alert-circle'" in editor and "key === 'alert'" in editor
    assert set(HG.ALERT_COLORS) == set(HG.ACCENT_NAMES)


@pytest.mark.asyncio
async def test_the_assistants_card_list_offers_it_with_an_example():
    from mantel_server.mcp.tools import screens
    got = await screens.grid_cards(None, {})
    assert got["cards"]["alert"]["sizes"] == ["S", "W", "T", "L", "XL"]
    assert got["alert"]["example"]["card"] == "alert"
    b, errors = write({"id": "b1", "card": "house_status", "size": "L", "at": [3, 0], "rules": [got["alert"]["example"]]})
    assert errors == {}
