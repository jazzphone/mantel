"""The screensaver's Home glance pieces (web/hk/modules/hk-saverpieces-home.js; docs/phase13/GLANCE-SPEC.md, wave B, "Home"): security,
doors, garage, climate, lights, vacuum, notify and package, every one in each of its shapes, with an empty house and a small one; what
each reads (the alarm panel, the header's lists, the thermostats, the lights, the vacuum's device sensors, the house's notifications as
they arrive); when a "shows when" piece shows; the accents; that an unreadable state is a dash and never "closed" or "off"; the
notification store, its reset and its deferred wake; and the look keeps the plan's rules (nothing animates, nothing blurs, one
spacing scale). Run under macOS's JavaScriptCore with the renderer's own DOM shim (tests/test_saverwidgets_pieces.py)."""
import importlib.util
import json
import math
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-home.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

# the renderer's tests' DOM shim and file (loaded by path: tests is not a package)
_spec = importlib.util.spec_from_file_location("_saverwidgets_pieces_shim", ROOT / "tests/test_saverwidgets_pieces.py")
_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_base)
SHIM, FILE = _base.SHIM, _base.FILE

# (before the group loads: its store listens for the window event from load, and schedules its wake with setTimeout; the clock is ours)
PRE = r"""
var TIMERS = [];
function setTimeout(f, ms) { TIMERS.push({ f: f, ms: ms }); return TIMERS.length; }
var LISTENERS = {};
window.addEventListener = function (name, f) { (LISTENERS[name] = LISTENERS[name] || []).push(f); };
function fire(detail) { (LISTENERS['hk-house-event'] || []).forEach(function (f) { f({ detail: detail }); }); }
var CLOCK = +new Date(2026, 10, 2, 19, 42, 0);
Date.now = function () { return CLOCK; };
"""


def run(tmp_path, body, before="", pre=PRE):
    script = tmp_path / "t.js"
    script.write_text(f"var FILE = {json.dumps(str(FILE))};\n{SHIM}\n{pre}\nload({json.dumps(str(GROUP))});\n{before}\n{body}\n")
    r = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{") or ln.startswith("[")]
    assert lines, r.stdout + r.stderr
    return json.loads(lines[-1])


# the house, as fakes: the header's lists, Settings' get, and a small house of states and registry rows (base() builds it afresh)
FAKES = r"""
var T0 = new Date(2026, 10, 2, 19, 42, 0);
var ST = {}, ENTS = {}, GET = {}, LISTS = null;
function ent(id, state, attrs) { ST[id] = { state: state, attributes: attrs || {} }; }
function base() {
  ST = {}; ENTS = {}; GET = {};
  LISTS = { alarm: 'alarm_control_panel.home', doors: ['binary_sensor.front_door', 'binary_sensor.back_door'], windows: ['binary_sensor.office_window'],
            garage: ['cover.garage'], locks: [] };
  ent('alarm_control_panel.home', 'armed_away', { friendly_name: 'Home Alarm' });
  ent('binary_sensor.front_door', 'off', { friendly_name: 'Front Door' });
  ent('binary_sensor.back_door', 'off', { friendly_name: 'Back Door' });
  ent('binary_sensor.office_window', 'off', { friendly_name: 'Office Window' });
  ent('cover.garage', 'closed', { friendly_name: 'Garage Door' });
  ent('climate.upstairs', 'heat', { friendly_name: 'Upstairs', current_temperature: 68, temperature: 70, hvac_action: 'heating', min_temp: 50, max_temp: 90 });
  ent('climate.downstairs', 'cool', { friendly_name: 'Downstairs', current_temperature: 71, temperature: 72, hvac_action: 'idle', min_temp: 50, max_temp: 90 });
  ['kitchen', 'hall', 'porch'].forEach(function (k) { ent('light.' + k, 'on', { friendly_name: k }); });
  ['den', 'attic'].forEach(function (k) { ent('light.' + k, 'off', { friendly_name: k }); });
  ent('light.shed', 'unavailable', {});
  ent('vacuum.rosie', 'docked', { friendly_name: 'Rosie' });
  ent('sensor.rosie_battery', '78', { device_class: 'battery' });
  ent('sensor.rosie_current_room', 'Kitchen');
  ent('sensor.rosie_vacuum_error', 'no_error');
  ent('sensor.other_battery', '5', { device_class: 'battery' });
  ['vacuum.rosie', 'sensor.rosie_battery', 'sensor.rosie_current_room', 'sensor.rosie_vacuum_error'].forEach(function (k) { ENTS[k] = { device_id: 'd1' }; });
  ENTS['sensor.other_battery'] = { device_id: 'd2' };
}
base();
window.hkSettings = { get: function (k, d) { return GET[k] !== undefined ? GET[k] : (d === undefined ? null : d); } };
window.hkHeader = { lists: function () { return LISTS; } };
function client() { return { states: ST, entities: ENTS, config: { unit_system: { temperature: '°F' } } }; }
function mk(piece, shape, o) { return W.create(piece, shape, { u: 4, back: 'none', opts: (o && o.opts) || {}, h24: !!(o && o.h24), color: 'auto' }); }
function show(piece, shape, o, now) {
  var w = mk(piece, shape, o); w.update(client(), now || T0);
  var r = { showing: w.showing, html: w.el.innerHTML, acc: w.el.style.props['--sw-acc'], accd: w.el.style.props['--sw-acc-d'] };
  w.destroy(); return r;
}
function html(piece, shape, o, now) { return show(piece, shape, o, now).html; }
var CATALOG = { security: ['circular', 'inline'], doors: ['circular', 'inline', 'rectangular'], garage: ['circular', 'inline'],
                climate: ['circular', 'inline', 'rectangular'], lights: ['circular', 'inline'], vacuum: ['circular', 'inline'],
                notify: ['circular', 'inline', 'rectangular'], package: ['circular', 'inline'] };
function note(title, o) { var n = { type: 'notification', id: 'n' + Math.random(), kind: 'people', title: title, message: '', ts: 1 }; for (var k in (o || {})) n[k] = o[k]; fire(n); return n; }
"""

GREEN, AMBER, RED, ORANGE = "#5fd38a", "#ffb340", "#ff6b5e", "#ffa24d"
SLATE, BLUE, TEAL, BULB = "#a9bdd6", "#7cc8ff", "#6fd6cf", "#ffd84d"


def arc(frac, gauge=False):
    return f"{2 * math.pi * 43 * (0.75 if gauge else 1) * frac:.2f}"


def test_the_declarations_are_complete(tmp_path):
    out = run(tmp_path, r"""
var P = {};
Object.keys(CATALOG).forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = d ? { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
               accent: typeof d.accent, shapes: Object.keys(d.shapes).sort() } : null;
});
var n = Object.keys(W.PIECES).length;
load(GROUPFILE);
print(JSON.stringify({ P: P, core: !!W.PIECES.weather, same: Object.keys(W.PIECES).length === n, home: typeof W._.home.reset, listeners: LISTENERS['hk-house-event'].length }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    P = out["P"]
    shapes = {"security": ["circular", "inline"], "doors": ["circular", "inline", "rectangular"], "garage": ["circular", "inline"],
              "climate": ["circular", "inline", "rectangular"], "lights": ["circular", "inline"], "vacuum": ["circular", "inline"],
              "notify": ["circular", "inline", "rectangular"], "package": ["circular", "inline"]}
    for k, want in shapes.items():
        assert P[k] is not None, k
        assert P[k]["shapes"] == want, k
        assert P[k]["group"] == "Home" and P[k]["wave"] == "B" and P[k]["name"] and P[k]["wakes"] and P[k]["source"]
        assert P[k]["facts"] == [k] and P[k]["pick"] is None and P[k]["off"] is False
        assert P[k]["accent"] in ("object", "function")
    assert P["doors"]["opts"] == {"when": ["always", "open"]} and P["garage"]["opts"] == {"when": ["always", "open"]}
    assert all(P[k]["opts"] == {} for k in P if k not in ("doors", "garage"))
    assert P["vacuum"]["when"] == "while it cleans" and P["notify"]["when"] and P["package"]["when"]
    assert all(P[k]["when"] is None for k in ("security", "doors", "garage", "climate", "lights"))
    # the notification pieces listen for the wake the renderer hands its shared watchers
    assert "calendar" in P["notify"]["wakes"] and "calendar" in P["package"]["wakes"]
    assert out["core"] and out["same"] and out["home"] == "function"          # loaded twice: nothing is added again
    assert out["listeners"] == 1                                              # ...and the event is heard once


def test_every_piece_and_shape_draws_with_an_empty_house_a_sample_one_and_every_sample(tmp_path):
    out = run(tmp_path, r"""
ST['vacuum.rosie'].state = 'cleaning';
var EMPTY = { states: {}, config: {} };
var results = [], errors = [];
function pass(label) {
  Object.keys(CATALOG).forEach(function (p) {
    CATALOG[p].forEach(function (s) {
      [['empty', EMPTY], ['house', client()]].forEach(function (h, hi) {
        ['none', 'glass', 'tint'].forEach(function (back, bi) {
          try {
            var w = W.create(p, s, { u: 4, back: back, color: bi === 2 ? 'accent' : 'auto', h24: hi === 1, opts: {} });
            if (!w) { errors.push('no create ' + p + '/' + s); return; }
            var drew = w.update(h[1], T0), again = w.update(h[1], T0), m = w.measure();
            results.push({ p: p, s: s, h: h[0], pass: label, drew: drew, again: again, html: w.el.innerHTML, showing: w.showing, live: w.live, w: m.w, hh: m.h, cls: w.el.className });
            w.setU(5);
            w.destroy();
          } catch (e) { errors.push(p + '/' + s + ': ' + e + ' ' + (e && e.stack)); }
        });
      });
      try {
        var el = W.sample(p, s, { u: 4, back: 'glass' });
        results.push({ p: p, s: s, h: 'sample', pass: label, html: el.innerHTML, acc: el.style.props['--sw-acc'], cls: el.className });
      } catch (e) { errors.push('sample ' + p + '/' + s + ': ' + e); }
    });
  });
}
pass('quiet');
note('Front Door'); note('Package delivered', { kind: 'package' });
pass('events');
print(JSON.stringify({ results: results, errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == (2 + 3 + 2 + 3 + 2 + 2 + 3 + 2) * 7 * 2
    only_when = ("vacuum", "notify", "package")
    for r in out["results"]:
        key = (r["p"], r["s"], r["h"], r["pass"])
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"], key
        if r["h"] != "sample":
            assert r["again"] is False, key                                  # drawn again only when the spec changes
            assert r["live"] is False and r["w"] >= 0 and r["hh"] > 0, key
        if r["h"] == "empty":
            # an empty house: the always-pieces draw dashes, the "shows when" ones hide. (Notifications are the store's, not the house's)
            if r["p"] in ("notify", "package"):
                assert r["showing"] is (r["pass"] == "events"), key
            else:
                assert r["showing"] is (r["p"] not in only_when), key
        if r["h"] == "house":
            assert r["showing"] is (r["p"] not in ("notify", "package") or r["pass"] == "events"), key
        if r["h"] == "sample" or r["showing"]:
            assert len(r["html"]) > 0, key
            assert "NaN" not in r["html"] and "undefined" not in r["html"] and "null" not in r["html"], key
            assert "Mantel" not in r["html"], key
        else:
            assert r["html"] == "", key                                      # not showing: nothing drawn
        if r["h"] == "sample":
            assert r["acc"], key                                             # every piece carries an accent
    # every circle is the renderer's: the track 7.5 wide, radius 43, the label on the baseline 72
    for r in out["results"]:
        if r["s"] == "circular" and r["h"] in ("sample", "house") and r["html"]:
            assert 'stroke-width="7.5"' in r["html"] and 'y="72"' in r["html"] and 'viewBox="0 0 100 100"' in r["html"], (r["p"], r["h"])
            assert 'r="43"' in r["html"], (r["p"], r["h"])


def test_security_states_and_accents(tmp_path):
    out = run(tmp_path, r"""
var r = {};
['armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'arming', 'disarmed', 'disarming', 'pending', 'triggered'].forEach(function (s) {
  ST['alarm_control_panel.home'].state = s;
  var i = show('security', 'inline'), c = show('security', 'circular');
  r[s] = [i.html, c.html, i.acc, i.accd, c.acc];
});
['unavailable', 'unknown', 'bogus'].forEach(function (s) {
  ST['alarm_control_panel.home'].state = s;
  r[s] = [html('security', 'inline'), html('security', 'circular'), show('security', 'inline').acc];
});
// the panel Status & Chips doesn't name: the first alarm panel in the house; a named one that can't be read is a dash, not that one
base(); LISTS.alarm = null; ST['alarm_control_panel.home'].state = 'disarmed';
r.fallback = html('security', 'inline');
base(); LISTS.alarm = 'alarm_control_panel.gone'; r.gone = [html('security', 'inline'), html('security', 'circular')];
base(); delete ST['alarm_control_panel.home']; LISTS.alarm = null; r.none = [html('security', 'inline'), html('security', 'circular')];
base(); var hdr = window.hkHeader; window.hkHeader = undefined; r.noheader = html('security', 'inline');
window.hkHeader = hdr;
print(JSON.stringify(r));
""", before=FAKES)
    words = {"armed_home": ("Armed Home", "HOME"), "armed_away": ("Armed Away", "AWAY"), "armed_night": ("Armed Night", "NIGHT"),
             "armed_vacation": ("Armed Vacation", "VACATION"), "arming": ("Arming", "ARMING"), "disarmed": ("Disarmed", "DISARMED"),
             "disarming": ("Disarming", "DISARM"), "pending": ("Pending", "PENDING"), "triggered": ("Triggered", "ALARM")}
    color = {"armed_home": GREEN, "armed_away": GREEN, "armed_night": GREEN, "armed_vacation": GREEN, "arming": GREEN, "disarmed": SLATE,
             "disarming": SLATE, "pending": RED, "triggered": RED}
    for s, (text, word) in words.items():
        inline, circ, acc, accd, cacc = out[s]
        assert f"<span>{text}</span>" in inline and 'class="a"' in inline and "<svg" in inline, s      # the shield, then the words
        assert f">{word}<" in circ and 'y="72"' in circ and "A43" not in circ and 'stroke-width="7.5"' in circ and "<g " in circ, s
        assert acc == color[s] == cacc, s
    assert out["armed_away"][3] == "#1f8a4c" and out["triggered"][3] == "#c4261a"                  # black ink's pair
    # the shield: a check when armed, a dash when disarmed, an exclamation when it is going off
    assert "M12 2.8v2.2" in out["armed_away"][1] and "M4 4.5l16 16" in out["disarmed"][1] and 'fill-opacity=".45"' in out["triggered"][1]   # the siren light (2026-11-09)
    assert "M8.5 12.2" not in out["disarmed"][1] and "M12 8.2" not in out["armed_away"][1]
    # the glyph in the circle: centered (50 - 12 x 1.5), its top at 24, over the label's baseline
    assert 'transform="translate(32 21) scale(1.5)"' in out["armed_away"][1]
    for k in ("unavailable", "unknown", "bogus"):
        assert ">—<" in out[k][0] and "Armed" not in out[k][0] and "Disarmed" not in out[k][0] and ">—<" in out[k][1] and out[k][2] is None, k
    assert "Disarmed" in out["fallback"]
    for k in ("gone", "none"):
        assert ">—<" in out[k][0] and ">—<" in out[k][1], k
    assert "Armed Away" in out["noheader"]                                                      # (no header: the first alarm panel)


def test_doors_count_names_and_when_open(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all(o) { return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('doors', s, o); return [x.showing, x.html, x.acc, x.accd]; }); }
r.closed = all();
ST['binary_sensor.back_door'].state = 'on';
r.one = all();
ST['binary_sensor.office_window'].state = 'on';
r.two = all();
ST['binary_sensor.front_door'].state = 'on';
r.three = all();
r.two_24 = html('doors', 'inline', { h24: true });
// "when open": hidden while all shut, shown (as always) while something is
r.open_when = all({ opts: { when: 'open' } });
ST['binary_sensor.front_door'].state = 'off'; ST['binary_sensor.back_door'].state = 'off'; ST['binary_sensor.office_window'].state = 'off';
r.shut_when = all({ opts: { when: 'open' } });
r.bogus_when = all({ opts: { when: 'sometimes' } });
// an unreadable sensor is not a shut one: nothing open and one dead -> a dash (and a "when open" piece hides); something open -> the count
ST['binary_sensor.office_window'].state = 'unavailable';
r.dead = all(); r.dead_when = all({ opts: { when: 'open' } });
ST['binary_sensor.back_door'].state = 'on';
r.dead_open = all();
r.dead_open_when = all({ opts: { when: 'open' } });
// none readable at all (the role can't read them), or the header's lists missing
base(); delete ST['binary_sensor.front_door']; delete ST['binary_sensor.back_door']; delete ST['binary_sensor.office_window'];
r.absent = all(); r.absent_when = all({ opts: { when: 'open' } });
base(); LISTS.doors = []; LISTS.windows = []; r.nolists = all();
base(); window.hkHeader = undefined; r.noheader = all();
print(JSON.stringify(r));
""", before=FAKES)
    c = out["closed"]
    assert all(x[0] for x in c)
    assert "All closed" in c[0][1] and ">0<" in c[1][1] and ">OPEN<" in c[1][1] and "All closed" in c[2][1] and "Open" in c[2][1]
    assert c[0][2] == GREEN and c[1][2] == GREEN and c[2][2] == GREEN
    one = out["one"]
    assert "1 open" in one[0][1] and ">1<" in one[1][1] and ">OPEN<" in one[1][1] and one[0][2] == AMBER and one[1][2] == AMBER
    assert "Back Door" in one[2][1] and 'class="l3"' not in one[2][1] and one[2][3] == "#b36b00"
    assert arc(round(1 / 3 * 200) / 200) in one[1][1]                                      # the ring: a third of the three sensors
    two = out["two"]
    assert "2 open" in two[0][1] and ">2<" in two[1][1] and arc(round(2 / 3 * 200) / 200) in two[1][1]
    assert re.search(r'class="l1">Open</div><div class="l2"><i class="dot a"></i>Back Door</div><div class="l3">Office Window</div>', two[2][1])
    three = out["three"]
    assert "3 open" in three[0][1] and ">3<" in three[1][1] and "Front Door" in three[2][1] and "Back Door" in three[2][1] and "Office Window" not in three[2][1]
    assert re.search(r'class="l2"><i class="dot a"></i>Front Door</div><div class="l3">Back Door \+1</div>', three[2][1])
    assert "3 open" in out["two_24"]
    assert all(x[0] for x in out["open_when"]) and "2 open" not in out["open_when"][0][1] and "3 open" in out["open_when"][0][1]
    for x in out["shut_when"]:
        assert x[:2] == [False, ""]
    assert all(x[0] for x in out["bogus_when"]) and "All closed" in out["bogus_when"][0][1] and ">0<" in out["bogus_when"][1][1]       # an unknown choice is "always"
    d = out["dead"]
    assert all(x[0] for x in d) and ">—<" in d[0][1] and ">—<" in d[1][1] and "—" in d[2][1] and "All closed" not in d[0][1] + d[2][1] and d[0][2] is None
    assert all(x[:2] == [False, ""] for x in out["dead_when"])
    assert "1 open" in out["dead_open"][0][1] and ">1<" in out["dead_open"][1][1] and "Back Door" in out["dead_open"][2][1]
    assert all(x[0] for x in out["dead_open_when"])
    for k in ("absent", "nolists", "noheader"):
        assert ">—<" in out[k][0][1] and ">—<" in out[k][1][1] and "All closed" not in out[k][0][1] + out[k][2][1] and "closed" not in out[k][1][1].lower(), k
    assert all(x[:2] == [False, ""] for x in out["absent_when"])


def test_garage_open_closed_moving_and_unreadable(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(o) { return ['inline', 'circular'].map(function (s) { var x = show('garage', s, o); return [x.showing, x.html, x.acc]; }); }
r.closed = both();
['open', 'opening', 'closing', 'on'].forEach(function (s) { ST['cover.garage'].state = s; r[s] = both(); });
ST['cover.garage'].state = 'open'; r.open_when = both({ opts: { when: 'open' } });
ST['cover.garage'].state = 'closed'; r.closed_when = both({ opts: { when: 'open' } });
ST['cover.garage'].state = 'off'; r.off = both();                                  // (a binary_sensor: 'off' is shut)
// two doors
LISTS.garage = ['cover.garage', 'cover.garage2']; ent('cover.garage2', 'open', {});
ST['cover.garage'].state = 'closed'; r.two = both();
ST['cover.garage2'].state = 'closed'; r.both_shut = both();
// unreadable: a dash, never "closed"; "when open" hides
ST['cover.garage2'].state = 'unavailable'; r.half_dead = both(); r.half_dead_when = both({ opts: { when: 'open' } });
ST['cover.garage'].state = 'unavailable'; r.dead = both(); r.dead_when = both({ opts: { when: 'open' } });
base(); delete ST['cover.garage']; r.absent = both(); r.absent_when = both({ opts: { when: 'open' } });
base(); LISTS.garage = []; r.nolist = both();
base(); window.hkHeader = undefined; r.noheader = both();
print(JSON.stringify(r));
""", before=FAKES)
    c = out["closed"]
    assert "Garage closed" in c[0][1] and ">CLOSED<" in c[1][1] and c[0][2] == GREEN and c[1][2] == GREEN
    o = out["open"]
    assert "Garage open" in o[0][1] and ">OPEN<" in o[1][1] and o[0][2] == AMBER and o[1][2] == AMBER
    # the door drawn shut has three slats, drawn open just the top one
    shut_path, open_path = "M7 12.5h10M7 15.5h10M7 18.5h10", "M7 12.5h10"
    assert shut_path in c[1][1] and shut_path in c[0][1] and shut_path not in o[1][1] and shut_path not in o[0][1]
    assert f'<path d="{open_path}"/>' in o[1][1] and f'<path d="{open_path}"/>' in o[0][1]
    assert "Garage opening" in out["opening"][0][1] and "Garage closing" in out["closing"][0][1] and out["opening"][0][2] == AMBER
    assert ">OPEN<" in out["opening"][1][1] and ">OPEN<" in out["on"][1][1] and "Garage open" in out["on"][0][1]
    assert "Garage open" in out["open_when"][0][1] and out["open_when"][0][0] is True
    assert out["closed_when"][0][:2] == [False, ""] and out["closed_when"][1][:2] == [False, ""]
    assert "Garage closed" in out["off"][0][1]
    assert "1 garage doors open" not in out["two"][0][1] and "Garage open" in out["two"][0][1]
    assert "Garage closed" in out["both_shut"][0][1]
    hd = out["half_dead"]
    assert "Garage closed" not in hd[0][1] and ">—<" in hd[0][1] and ">—<" in hd[1][1] and hd[0][2] is None
    assert out["half_dead_when"][0][:2] == [False, ""]
    for k in ("dead", "absent", "nolist", "noheader"):
        assert ">—<" in out[k][0][1] and ">—<" in out[k][1][1] and "closed" not in (out[k][0][1] + out[k][1][1]).lower(), k
    assert out["dead_when"][0][:2] == [False, ""] and out["absent_when"][1][:2] == [False, ""]


def test_garage_counts_more_than_one_open(tmp_path):
    out = run(tmp_path, r"""
LISTS.garage = ['cover.garage', 'cover.garage2']; ent('cover.garage2', 'open', {}); ST['cover.garage'].state = 'open';
print(JSON.stringify({ i: html('garage', 'inline'), c: html('garage', 'circular') }));
""", before=FAKES)
    assert "2 garage doors open" in out["i"] and ">OPEN<" in out["c"]


def test_climate_heating_cooling_idle_and_two_zones(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all() { return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('climate', s); return [x.showing, x.html, x.acc, x.accd]; }); }
GET['features.thermostats'] = ['climate.upstairs', 'climate.downstairs'];       // (Settings' order: the first is the one the figure follows)
r.heat = all();
// cooling: the second zone at work, the first idle
ST['climate.upstairs'].attributes.hvac_action = 'idle'; ST['climate.downstairs'].attributes.hvac_action = 'cooling';
r.cool = all();
// both idle: inside the first one's temperature
ST['climate.downstairs'].attributes.hvac_action = 'idle'; r.idle = all();
ST['climate.upstairs'].attributes.hvac_action = undefined; ST['climate.upstairs'].state = 'off'; r.off = all();
// only the settings' chosen thermostat
base(); GET['features.thermostats'] = ['climate.downstairs']; r.chosen = all();
// a heat-cool thermostat sets a range: heating toward the low end, cooling toward the high
base(); ST['climate.upstairs'].attributes = { friendly_name: 'Upstairs', current_temperature: 66, target_temp_low: 68, target_temp_high: 75, hvac_action: 'heating' };
r.range_heat = html('climate', 'inline');
ST['climate.upstairs'].attributes.hvac_action = 'cooling'; r.range_cool = html('climate', 'inline');
// no target: heating, and the circle says INSIDE
ST['climate.upstairs'].attributes = { friendly_name: 'Upstairs', current_temperature: 66, hvac_action: 'heating' };
r.notarget = [html('climate', 'inline'), html('climate', 'circular')];
// no reading, no action: a dash
ST['climate.upstairs'].attributes = { friendly_name: 'Upstairs' }; delete ST['climate.downstairs'];
r.noreading = all();
// unavailable thermostats don't count; one that answers does
base(); ST['climate.upstairs'].state = 'unavailable'; r.one_dead = all();
ST['climate.downstairs'].state = 'unknown'; r.all_dead = all();
base(); delete ST['climate.upstairs']; delete ST['climate.downstairs']; r.absent = all();
// one zone: the three lines
base(); delete ST['climate.downstairs']; r.single = html('climate', 'rectangular');
// Celsius: the scale of the gauge is 7 to 35 where the thermostat says none
base(); ST['climate.upstairs'].attributes = { friendly_name: 'Upstairs', current_temperature: 21, temperature: 22, hvac_action: 'heating' };
var wc = mk('climate', 'circular'); wc.update({ states: ST, entities: ENTS, config: { unit_system: { temperature: '°C' } } }, T0); r.celsius = wc.el.innerHTML;
print(JSON.stringify(r));
""", before=FAKES)
    h = out["heat"]
    assert "Heating to 70°" in h[0][1] and h[0][2] == ORANGE and h[1][2] == ORANGE and h[2][2] == ORANGE and h[0][3] == "#c25e00"
    assert ">68°<" in h[1][1] and "→ 70°" in h[1][1] and arc(round(18 / 40 * 200) / 200, True) in h[1][1]            # the range is the thermostat's own, 50 to 90
    # the target is a notch across the track at half the sweep: straight up
    assert re.search(r'<line class="a" x1="50\.00" y1="14\.40" x2="50\.00" y2="1\.80"', h[1][1])
    assert 'class="hm-rows"' in h[2][1] and h[2][1].count('class="hm-row"') == 2
    assert re.search(r'hm-n">Upstairs</div><div class="hm-v">68° → 70°</div>.*hm-n">Downstairs</div><div class="hm-v">71° → 72°</div>', h[2][1])
    assert 'style="--sw-acc:#ffa24d' in h[2][1]                                              # the working zone's dot, its own color
    cl = out["cool"]
    assert "Cooling to 72°" in cl[0][1] and cl[0][2] == BLUE and ">71°<" in cl[1][1] and "→ 72°" in cl[1][1]
    assert re.search(r'hm-n">Downstairs</div>.*hm-n">Upstairs</div>', cl[2][1])             # the zone at work first
    i = out["idle"]
    assert "Inside 68°" in i[0][1] and i[0][2] is None and i[1][2] is None and ">68°<" in i[1][1] and "→ 70°" in i[1][1]
    assert "Inside 68°" in out["off"][0][1]                                                   # (a thermostat that is off still has a room temperature)
    ch = out["chosen"]
    assert "Inside 71°" in ch[0][1] and ch[2][1].count("hm-row") == 0 and 'class="l3">Idle<' in ch[2][1] and "Downstairs" in ch[2][1]
    assert "Heating to 68°" in out["range_heat"] and "Cooling to 75°" in out["range_cool"]
    assert "Heating" in out["notarget"][0] and " to " not in out["notarget"][0] and ">INSIDE<" in out["notarget"][1] and "<line" not in out["notarget"][1]
    for x in out["noreading"]:
        assert x[0] is True
    assert ">—<" in out["noreading"][0][1] and ">—<" in out["noreading"][1][1] and "Climate" in out["noreading"][2][1] and "—" in out["noreading"][2][1]
    assert "Inside 71°" in out["one_dead"][0][1] and ">71°<" in out["one_dead"][1][1]
    for k in ("all_dead", "absent"):
        assert ">—<" in out[k][0][1] and ">—<" in out[k][1][1] and "Inside" not in out[k][0][1] and out[k][0][2] is None, k
    assert "Upstairs" in out["single"] and "68° → 70°" in out["single"] and ">Heating<" in out["single"] and "hm-row" not in out["single"]
    assert arc(round((21 - 7) / 28 * 200) / 200, True) in out["celsius"]


def test_lights_fraction_and_words(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all() { return ['inline', 'circular'].map(function (s) { var x = show('lights', s); return [x.showing, x.html, x.acc, x.accd]; }); }
r.three = all();                                        // 3 on of 5 readable (one unavailable)
ST['light.kitchen'].state = 'off'; ST['light.hall'].state = 'off'; r.one = all();
ST['light.porch'].state = 'off'; r.none = all();
['kitchen', 'hall', 'porch', 'den', 'attic'].forEach(function (k) { ST['light.' + k].state = 'on'; }); r.six_of = all();
// Settings' chosen lights: ghosts (the role can't read them) don't count
base(); GET.kinds = { lights: ['light.kitchen', 'light.den', 'light.ghost'] }; GET['kinds.lights'] = ['light.kitchen', 'light.den', 'light.ghost']; r.chosen = all();
// hidden lights and groups out of the scan
base(); ENTS['light.hall'] = { hidden: true }; ENTS['light.porch'] = { entity_category: 'config' }; ST['light.den'].attributes.entity_id = ['light.kitchen', 'light.hall']; r.scan = all();
// nothing readable
base(); Object.keys(ST).forEach(function (k) { if (k.indexOf('light.') === 0) ST[k].state = 'unavailable'; }); r.dead = all();
base(); Object.keys(ST).forEach(function (k) { if (k.indexOf('light.') === 0) delete ST[k]; }); r.absent = all();
print(JSON.stringify(r));
""", before=FAKES)
    t = out["three"]
    assert "3 lights on" in t[0][1] and ">3<" in t[1][1] and ">LIGHTS<" in t[1][1] and t[0][2] == BULB and t[1][2] == BULB and t[0][3] == "#b08600"
    assert arc(round(3 / 5 * 200) / 200) in t[1][1] and 'fill-opacity=".9"' in t[0][1]            # the bulb lit
    assert "1 light on" in out["one"][0][1] and arc(round(1 / 5 * 200) / 200) in out["one"][1][1] and "lights on" not in out["one"][0][1]
    n = out["none"]
    assert "All lights off" in n[0][1] and ">0<" in n[1][1] and 'stroke-dasharray="0.00 ' in n[1][1] and 'fill-opacity=".9"' not in n[0][1]
    assert "5 lights on" in out["six_of"][0][1] and arc(1.0) in out["six_of"][1][1]
    assert "1 light on" in out["chosen"][0][1] and arc(0.5) in out["chosen"][1][1]
    assert "1 light on" in out["scan"][0][1] and arc(0.5) in out["scan"][1][1]                 # (kitchen of kitchen and attic: hidden, helper and group lights out)
    for k in ("dead", "absent"):
        assert ">—<" in out[k][0][1] and ">—<" in out[k][1][1] and "off" not in out[k][0][1] and out[k][0][2] is None, k


def test_vacuum_shows_only_while_it_works(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both() { return ['inline', 'circular'].map(function (s) { var x = show('vacuum', s); return [x.showing, x.html, x.acc, x.accd]; }); }
['docked', 'idle', 'paused', 'unavailable', 'unknown'].forEach(function (s) { ST['vacuum.rosie'].state = s; r[s] = both(); });
ST['vacuum.rosie'].state = 'cleaning'; r.cleaning = both();
ST['vacuum.rosie'].state = 'returning'; r.returning = both();
ST['vacuum.rosie'].state = 'error'; r.error = both();
// a robot that reports a fault while it cleans is stuck, whatever its state says
ST['vacuum.rosie'].state = 'cleaning'; ST['sensor.rosie_vacuum_error'].state = 'Main brush jammed'; r.fault = both();
ST['sensor.rosie_vacuum_error'].state = 'no_error';
// no room: just "Vacuuming"; a room of "none" is no room; a long one is cut; "the" isn't said twice
ST['sensor.rosie_current_room'].state = 'unknown'; r.noroom = html('vacuum', 'inline');
ST['sensor.rosie_current_room'].state = 'None'; r.noneroom = html('vacuum', 'inline');
ST['sensor.rosie_current_room'].state = 'The Living Room'; r.the = html('vacuum', 'inline');
ST['sensor.rosie_current_room'].state = 'Master Bedroom Walk-in Closet Annex'; r.long = html('vacuum', 'inline');
ST['sensor.rosie_current_room'].state = 'Kitchen';
// the battery is the sensor on the vacuum's own device (not another device's), else the vacuum's attribute
ST['sensor.rosie_battery'].state = 'unavailable'; r.nobat = both();
ST['vacuum.rosie'].attributes.battery_level = 41; r.attrbat = html('vacuum', 'circular');
ST['sensor.rosie_battery'].state = '78'; delete ST['vacuum.rosie'].attributes.battery_level;
// two robots: stuck outranks cleaning outranks returning
ent('vacuum.max', 'returning', {}); ENTS['vacuum.max'] = { device_id: 'd9' }; r.two = both();
ST['vacuum.rosie'].state = 'returning'; ST['vacuum.max'].state = 'cleaning'; r.two2 = html('vacuum', 'inline');
ST['vacuum.max'].state = 'error'; r.two3 = html('vacuum', 'inline');
// no registry: the sensors named for the vacuum
base(); ST['vacuum.rosie'].state = 'cleaning'; ENTS = {};
r.noreg = both();
// nothing in the house, or only the vacuum itself
base(); ST['vacuum.rosie'].state = 'cleaning'; ENTS = {}; delete ST['sensor.rosie_battery']; delete ST['sensor.rosie_current_room']; delete ST['sensor.rosie_vacuum_error'];
r.bare = both();
base(); delete ST['vacuum.rosie']; r.absent = both();
print(JSON.stringify(r));
""", before=FAKES)
    for k in ("docked", "idle", "paused", "unavailable", "unknown"):
        assert all(x[:2] == [False, ""] for x in out[k]), k
    c = out["cleaning"]
    assert c[0][0] and "Vacuuming the Kitchen" in c[0][1] and c[0][2] == TEAL and c[1][2] == TEAL
    assert ">78%<" in c[1][1] and ">CLEAN<" in c[1][1] and arc(0.78) in c[1][1]
    r_ = out["returning"]
    assert "Returning to dock" in r_[0][1] and ">78%<" in r_[1][1] and ">RETURN<" in r_[1][1] and r_[0][2] == TEAL
    e = out["error"]
    assert e[0][0] and "Vacuum stuck" in e[0][1] and ">STUCK<" in e[1][1] and e[0][2] == RED and e[1][2] == RED and e[0][3] == "#c4261a"
    f = out["fault"]
    assert "Vacuum stuck" in f[0][1] and f[0][2] == RED
    assert ">Vacuuming<" in out["noroom"].replace("<span>", ">").replace("</span>", "<") and "the" not in out["noroom"].split("<span>")[-1]
    assert "<span>Vacuuming</span>" in out["noneroom"]
    assert "Vacuuming the Living Room" in out["the"] and "the The" not in out["the"]
    assert "Vacuuming the Master Bedroom Walk…" in out["long"]
    assert ">—<" in out["nobat"][1][1] and "Vacuuming the Kitchen" in out["nobat"][0][1]
    assert ">41%<" in out["attrbat"]
    assert "Vacuuming the Kitchen" in out["two"][0][1] and "Returning" not in out["two"][0][1]       # cleaning outranks returning
    assert "<span>Vacuuming</span>" in out["two2"]                                                 # (the one cleaning now has no room sensor)
    assert "Vacuum stuck" in out["two3"]
    nr = out["noreg"]
    assert nr[0][0] and "Vacuuming the Kitchen" in nr[0][1] and ">78%<" in nr[1][1]
    b = out["bare"]
    assert b[0][0] and "<span>Vacuuming</span>" in b[0][1] and ">—<" in b[1][1]
    assert all(x[:2] == [False, ""] for x in out["absent"])


def test_vacuum_two_robots_rank_by_what_they_do(tmp_path):
    out = run(tmp_path, r"""
ent('vacuum.max', 'cleaning', {}); ENTS['vacuum.max'] = { device_id: 'd9' };
var r = {};
ST['vacuum.rosie'].state = 'returning'; r.a = html('vacuum', 'inline');
ST['vacuum.rosie'].state = 'docked'; r.b = html('vacuum', 'inline');
ST['vacuum.rosie'].state = 'error'; r.c = html('vacuum', 'inline');
print(JSON.stringify(r));
""", before=FAKES)
    assert "Vacuuming</span>" in out["a"] and "Returning" not in out["a"]                # cleaning outranks returning (the second robot has no room sensor)
    assert "Vacuuming</span>" in out["b"]
    assert "Vacuum stuck" in out["c"]


def test_notifications_arrive_into_the_store_and_the_pieces_draw_them(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all() { return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('notify', s); return [x.showing, x.html, x.acc, x.accd]; }); }
r.none = all();
r.before = W._.home.count();
CLOCK += 0; note('Front Door', { message: 'Someone is at the door' });
CLOCK += 600000; note('Dryer finished');
r.two = all();
r.two_24 = html('notify', 'rectangular', { h24: true });
CLOCK += 600000; note('Garage door left open', { message: 'Open for 30 minutes' });
r.three = all();
r.count = W._.home.count(); r.notes = W._.home.notes().map(function (n) { return n.title; });
// what isn't a notification, and what repeats
fire({ type: 'notification_dismiss', id: 'x' }); fire({ type: 'doorbell', title: 'Ring' }); fire(null); fire({});
var dup = { type: 'notification', id: 'same', kind: 'people', title: 'Same', message: '' }; fire(dup); fire(dup);
r.after = W._.home.count();
// a title that is empty falls back to the message, then to a word
note('', { message: 'Only a message' }); r.msg = html('notify', 'inline');
note('', {}); r.blank = html('notify', 'inline');
// the last ten only; the count is all that arrived
for (var i = 0; i < 14; i++) note('Bulk ' + i);
r.kept = W._.home.notes().length; r.total = W._.home.count(); r.latest = W._.home.notes()[0].title;
r.big = html('notify', 'circular');
for (i = 0; i < 90; i++) note('More ' + i);
r.huge = html('notify', 'circular');
print(JSON.stringify(r));
""", before=FAKES)
    for x in out["none"]:
        assert x[:2] == [False, ""]
    assert out["before"] == 0
    two = out["two"]
    assert all(x[0] for x in two)
    assert "Dryer finished" in two[0][1] and "Front Door" not in two[0][1] and two[0][2] == BLUE and "<svg" in two[0][1]      # the latest
    assert ">2<" in two[1][1] and ">NEW<" in two[1][1] and 'y="72"' in two[1][1] and 'stroke-dasharray="' in two[1][1]
    rows = re.findall(r'<div class="hm-row"><i class="dot a"></i><div class="hm-n">([^<]*)</div><div class="hm-v">([^<]*)</div></div>', two[2][1])
    assert rows == [("Dryer finished", "7:52 PM"), ("Front Door", "7:42 PM")]                                                   # the latest two, newest first, with when
    assert ">19:52<" in out["two_24"] and ">19:42<" in out["two_24"]
    three = out["three"]
    assert "Garage door left open" in three[0][1] and ">3<" in three[1][1]
    rows = re.findall(r'hm-n">([^<]*)</div>', three[2][1])
    assert rows == ["Garage door left open", "Dryer finished"]
    assert out["count"] == 3 and out["notes"] == ["Garage door left open", "Dryer finished", "Front Door"]
    assert out["after"] == 4                                                                                                     # Same once; the rest ignored
    assert "Only a message" in out["msg"] and "Notification" in out["blank"]
    assert out["kept"] == 10 and out["total"] == 4 + 2 + 14 and out["latest"] == "Bulk 13" and ">20<" in out["big"]
    assert ">99+<" in out["huge"]


def test_one_notification_draws_its_three_lines(tmp_path):
    out = run(tmp_path, r"""
note('Front Door', { message: 'Someone is at the door' });
var a = html('notify', 'rectangular');
fire({ type: 'notification', id: 'z', kind: 'people', title: '', message: 'Just words' });
W._.home.reset(); note('Alone');
print(JSON.stringify({ a: a, b: html('notify', 'rectangular') }));
""", before=FAKES)
    assert re.search(r'class="l1">New · 7:42 PM</div><div class="l2"><i class="dot a"></i>Front Door</div><div class="l3">Someone is at the door</div>', out["a"])
    assert 'class="l1">New · 7:42 PM</div><div class="l2"><i class="dot a"></i>Alone</div>' in out["b"] and 'class="l3"' not in out["b"]


def test_reset_clears_the_store_and_the_wake_is_deferred_and_coalesced(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var w = mk('notify', 'inline'), p = mk('package', 'inline'), cal = mk('events', 'inline');
w.update(client(), T0); p.update(client(), T0);
r.start = [w.showing, p.showing, TIMERS.length];                     // reads schedule nothing
w.update(client(), T0); w.update(client(), T0);
r.after_reads = TIMERS.length;
// three events in a row: ONE timer, and nothing drawn yet
note('One'); note('Two'); note('Package at the door', { kind: 'package' });
r.after_events = TIMERS.length; r.timer_ms = TIMERS[0].ms;
r.not_yet = [w.showing, p.showing, w.el.innerHTML];
// the wake runs the shared watchers (inside no read): both pieces draw
TIMERS[0].f();
r.woken = [w.showing, p.showing, w.el.innerHTML.indexOf('Package at the door') >= 0, p.el.innerHTML.indexOf('Package at the door') >= 0];
r.timers_after_wake = TIMERS.length;
// another event after the wake: a new timer
note('Three'); r.again = TIMERS.length; TIMERS[1].f();
r.three = w.el.innerHTML.indexOf('Three') >= 0;
// reset: the notifications go (and the piece hides on the wake); the package at the door stays
W._.home.reset();
r.reset = [W._.home.count(), W._.home.notes().length, W._.home.since() === CLOCK, W._.home.packageAt() !== null];
r.timers_reset = TIMERS.length; TIMERS[2].f();
r.hidden = [w.showing, w.el.innerHTML, p.showing, p.el.innerHTML.indexOf('Package') >= 0];
// reset twice before the wake fires: one timer
W._.home.reset(); W._.home.reset(); r.coalesced = TIMERS.length;
w.destroy(); p.destroy(); cal.destroy();
r.watchers = W._.cal.watchers.length;
print(JSON.stringify(r));
""", before=FAKES)
    assert out["start"] == [False, False, 0] and out["after_reads"] == 0
    assert out["after_events"] == 1 and 0 <= out["timer_ms"] <= 250
    assert out["not_yet"] == [False, False, ""]
    assert out["woken"] == [True, True, True, True]                      # (the package is a notification too: the latest title)
    assert out["timers_after_wake"] == 1
    assert out["again"] == 2 and out["three"] is True
    assert out["reset"] == [0, 0, True, True]
    assert out["timers_reset"] == 3
    assert out["hidden"][:3] == [False, "", True] and out["hidden"][3] is True
    assert out["coalesced"] == 4
    assert out["watchers"] == 0


def test_package_shows_for_four_hours_after_one(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(now) { return ['inline', 'circular'].map(function (s) { var x = show('package', s, null, now); return [x.showing, x.html, x.acc]; }); }
r.none = both();
note('Someone at the door');                                              // not a package
r.other = both();
note('Delivered', { kind: 'package' });                                   // at 7:42 PM
r.now = both();
r.t3h59 = both(new Date(+T0 + 4 * 3600000 - 60000));
r.t4h = both(new Date(+T0 + 4 * 3600000));
r.t5h = both(new Date(+T0 + 5 * 3600000));
// a second package restarts the clock
CLOCK += 3 * 3600000; note('Another', { kind: 'package' });
r.restarted = both(new Date(+T0 + 6 * 3600000));
// the notification piece counts it as well
r.notes = W._.home.count();
print(JSON.stringify(r));
""", before=FAKES)
    for k in ("none", "other"):
        assert all(x[:2] == [False, ""] for x in out[k]), k
    n = out["now"]
    assert all(x[0] for x in n) and "Package at the door" in n[0][1] and ">PACKAGE<" in n[1][1] and 'y="72"' in n[1][1] and n[0][2] == n[1][2] == AMBER
    assert "M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" in n[1][1] and "<g " in n[1][1]            # the box
    assert all(x[0] for x in out["t3h59"])
    assert all(x[:2] == [False, ""] for x in out["t4h"]) and all(x[:2] == [False, ""] for x in out["t5h"])
    assert all(x[0] for x in out["restarted"])                                                    # 3 h after the second one
    assert out["notes"] == 3


def test_a_missing_house_does_not_throw(tmp_path):
    out = run(tmp_path, r"""
window.hkSettings = undefined; window.hkHeader = undefined;
var res = [], errors = [];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [null, { states: ST }, { states: { 'alarm_control_panel.x': { state: 7, attributes: null }, 'climate.x': { state: 'heat', attributes: { current_temperature: 'bad', temperature: {} } },
                                      'light.x': null, 'vacuum.x': { state: 'cleaning', attributes: null }, 'cover.x': 5 }, entities: { 'vacuum.x': {} } }].forEach(function (c) {
      try { var w = mk(p, s); w.update(c, T0); res.push(w.el.innerHTML.length); w.destroy(); }
      catch (e) { errors.push(p + '/' + s + ': ' + e); }
    });
  });
});
// events of any shape
[undefined, null, 0, 'x', { type: 'notification' }, { type: 'notification', title: { a: 1 }, message: 5, kind: null }].forEach(function (d) { try { fire(d); } catch (e) { errors.push('fire ' + e); } });
print(JSON.stringify({ res: res.length, errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == [] and out["res"] == 19 * 3


def test_without_a_window_event_bus_it_still_loads(tmp_path):
    # (a page with no addEventListener on `window`: the pieces still define, the store is just never fed)
    out = run(tmp_path, r"""
print(JSON.stringify({ has: !!W.PIECES.notify, n: W._.home.count(), shown: show('notify', 'inline').showing }));
""", before=FAKES, pre="function setTimeout() { return 1; }\nvar CLOCK = 0;")
    assert out == {"has": True, "n": 0, "shown": False}


def test_forecast_free_pieces_do_not_watch_anything(tmp_path):
    out = run(tmp_path, r"""
var calls = [];
window.hkWxForecast = { watch: function () { calls.push('watch'); return { data: function () { return []; }, ensure: function () {}, release: function () {} }; } };
window.hkWxReadings = { read: function () { calls.push('read'); return null; } };
Object.keys(CATALOG).forEach(function (p) { CATALOG[p].forEach(function (s) { var w = mk(p, s); w.update(client(), T0); w.destroy(); }); });
print(JSON.stringify({ calls: calls }));
""", before=FAKES)
    assert out["calls"] == []


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "setInterval", "requestAnimationFrame", "Mantel", "hkStats", "requestUpdate"):
        assert word not in src, word
    # one timer, and it is the coalesced wake
    assert src.count("setTimeout(") == 1
    # American English
    for word in ("colour", "centre", "grey", "favourite"):
        assert word not in src.lower(), word
    # the group's own rules sit on the spacing scale (.4 .8 1.2 1.6 2.4 3.2) for every gap, margin and padding
    css = re.search(r"var CSS = \[(.*?)\]\.join", src, re.S).group(1)
    spacing = re.findall(r"(?:gap|margin[a-z-]*|padding[a-z-]*):[^;}']*", css)
    assert spacing
    for decl in spacing:
        for n in re.findall(r"calc\(var\(--u\) \* ([\d.]+)\)", decl):
            assert n in (".4", ".8", "1.2", "1.6", "2.4", "3.2"), decl
    # two rows of 4.6 u and .4 u between them leave 1.7 u of the piece's 13 u above and below (not under the 1.6 u of breathing room)
    assert "height:calc(var(--u) * 4.6)" in css and "gap:calc(var(--u) * .4)" in css and (13 - 2 * 4.6 - 0.4) / 2 >= 1.6
    # a glyph over a circle's label: 24 units scaled 1.5, centered on 50 (32 + 12 x 1.5), its top at 24 (21 + 2 x 1.5)
    assert "translate(32 21) scale(1.5)" in src


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
