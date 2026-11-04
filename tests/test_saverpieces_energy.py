"""The screensaver's Energy glance pieces (web/hk/modules/hk-saverpieces-energy.js; docs/phase13/GLANCE-SPEC.md, wave B): grid and
ev, each in every shape, with an empty house and a small one; what each reads (the Power page's plan, hkSettings.get('energy').power:
grid and grid_export read as hk-energy.js's pw(), its signs and units; cars[] with carsCharging() mirrored); import, export, idle
and down; the gauge's scale; charging or not, the car shown; a dash with no plan or no data; the accents; and the look keeps the
plan's rules (nothing animates, nothing blurs, no timers, nothing waking a read). Run under macOS's JavaScriptCore with the
renderer's own DOM shim (tests/test_saverwidgets_pieces.py)."""
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-energy.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

# the renderer's tests' DOM shim and file (loaded by path: tests is not a package)
_spec = importlib.util.spec_from_file_location("_saverwidgets_pieces_shim", ROOT / "tests/test_saverwidgets_pieces.py")
_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_base)
SHIM, FILE = _base.SHIM, _base.FILE


def run(tmp_path, body, before=""):
    script = tmp_path / "t.js"
    script.write_text(f"var FILE = {json.dumps(str(FILE))};\n{SHIM}\nload({json.dumps(str(GROUP))});\n{before}\n{body}\n")
    r = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{") or ln.startswith("[")]
    assert lines, r.stdout + r.stderr
    return json.loads(lines[-1])


# the house, as fakes: hkSettings (the Energy plan), hkChart.power (hk-charts.js, unit-aware), and a client with the sensors
FAKES = r"""
var T0 = new Date(2026, 10, 2, 13, 10, 0);
var PLAN = null;
window.hkSettings = { get: function (k, d) { return k === 'energy' ? (PLAN === undefined ? d : PLAN) : (d === undefined ? null : d); } };
window.hkChart = { power: function (states, id, opts) {
  opts = opts || {};
  var s = states && states[id], v = Number(s && s.state);
  if (!isFinite(v)) return opts.fallback === undefined ? '--' : opts.fallback;
  var u = String((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
  var w = u === 'kw' ? v * 1000 : (u === 'mw' ? v * 1e6 : v);
  return opts.watts ? w : w + ' W';
} };
function pwr(v, unit) { return { state: String(v), attributes: { unit_of_measurement: unit || 'W' } }; }
function plan(o) {
  var p = { grid: 'sensor.grid', grid_export: null, grid_status: null, home: 'sensor.home', cars: [], chargers: [], sections: [] };
  Object.keys(o || {}).forEach(function (k) { p[k] = o[k]; });
  return { power: p };
}
var CAR = { name: 'Model Y', level: 'sensor.y_level', power: 'sensor.y_power', home: 'device_tracker.y', plugged: 'binary_sensor.y_cable' };
function house(o) { return { states: o, config: {} }; }
var EMPTY = { states: {}, config: {} };
function mk(piece, shape, back) { return W.create(piece, shape, { u: 4, back: back || 'none', opts: {}, h24: false, color: 'auto' }); }
function show(piece, shape, c) {
  var w = mk(piece, shape); w.update(c, T0);
  var r = { showing: w.showing, html: w.el.innerHTML, acc: w.el.style.props['--sw-acc'] || null, accd: w.el.style.props['--sw-acc-d'] || null };
  w.destroy(); return r;
}
function text(html) { return html.replace(/<[^>]*>/g, '|').split('|').filter(function (x) { return x; }); }
function grid(sensors, p) { PLAN = plan(p); return house(sensors); }
var CATALOG = { grid: ['circular', 'inline'], ev: ['circular', 'inline'] };
"""

HOUSE = r"""
PLAN = plan({ grid_export: 'sensor.export', grid_status: 'binary_sensor.grid_up', cars: [CAR], chargers: ['sensor.wall'] });
var SAMPLE_HOUSE = house({ 'sensor.grid': pwr(0), 'sensor.export': pwr(2100), 'binary_sensor.grid_up': { state: 'on', attributes: {} },
  'sensor.y_level': { state: '80', attributes: {} }, 'sensor.y_power': pwr(0), 'sensor.wall': pwr(7.2, 'kW'), 'device_tracker.y': { state: 'home', attributes: {} },
  'binary_sensor.y_cable': { state: 'on', attributes: {} } });
"""


def test_the_declarations_are_complete(tmp_path):
    out = run(tmp_path, r"""
var P = {};
Object.keys(CATALOG).forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = d ? { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
               accent: typeof d.accent, shapes: Object.keys(d.shapes).sort() } : null;
});
print(JSON.stringify({ P: P, core: !!W.PIECES.energy, double: (function () { load(GROUPFILE); return Object.keys(W.PIECES).length; })(), n: Object.keys(W.PIECES).length }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    for k in ("grid", "ev"):
        p = out["P"][k]
        assert p is not None, k
        assert p["shapes"] == ["circular", "inline"], k
        assert p["group"] == "Energy" and p["wave"] == "B" and p["name"] and p["wakes"] and p["source"], k
        assert p["facts"] == [k] and p["when"] is None and p["pick"] is None and p["opts"] == {} and p["accent"] == "function", k
        assert p["off"] is False                                         # only the people pieces are off until placed
    assert out["P"]["grid"]["name"] == "Grid" and out["P"]["ev"]["name"] == "EV"
    assert out["core"] and out["double"] == out["n"]                     # loaded twice: nothing is added again


def test_every_shape_draws_with_an_empty_house_and_a_sample_one(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [['empty', EMPTY], ['house', SAMPLE_HOUSE], ['noplan', null]].forEach(function (h, hi) {
      ['none', 'glass', 'tint'].forEach(function (back, bi) {
        try {
          var keep = PLAN; if (h[0] === 'noplan') PLAN = null;
          var w = W.create(p, s, { u: 4, back: back, color: bi === 2 ? 'accent' : 'auto', h24: hi === 1, opts: {} });
          if (!w) { errors.push('no create ' + p + '/' + s); return; }
          var c = h[1] || EMPTY, drew = w.update(c, T0), again = w.update(c, T0), m = w.measure();
          PLAN = keep;
          results.push({ p: p, s: s, h: h[0], drew: drew, again: again, html: w.el.innerHTML, showing: w.showing, live: w.live, w: m.w, hh: m.h, cls: w.el.className });
          w.setU(5);
          w.destroy();
        } catch (e) { errors.push(p + '/' + s + ': ' + e + ' ' + (e && e.stack)); }
      });
    });
    try {
      var el = W.sample(p, s, { u: 4, back: 'glass' });
      results.push({ p: p, s: s, h: 'sample', html: el.innerHTML, acc: el.style.props['--sw-acc'], cls: el.className });
    } catch (e) { errors.push('sample ' + p + '/' + s + ': ' + e); }
  });
});
print(JSON.stringify({ results: results, errors: errors, warns: WARNS }));
""", before=FAKES + HOUSE)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == 4 * (3 * 3 + 1)
    for r in out["results"]:
        key = (r["p"], r["s"], r["h"])
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"], key
        if r["h"] != "sample":
            assert r["again"] is False and r["showing"] is True and r["live"] is False and r["w"] >= 0 and r["hh"] > 0, key
        assert len(r["html"]) > 0, key
        assert "NaN" not in r["html"] and "undefined" not in r["html"] and "null" not in r["html"] and "Mantel" not in r["html"], key
        if r["h"] == "sample":
            assert r["acc"], key                                         # a sample carries an accent
        if r["h"] in ("empty", "noplan"):
            assert "—" in r["html"], key                                 # no plan or no data: a dash
    for r in out["results"]:
        if r["s"] == "circular":
            assert 'stroke-width="7.5"' in r["html"] and 'y="72"' in r["html"] and 'viewBox="0 0 100 100"' in r["html"] and 'r="43"' in r["html"], (r["p"], r["h"])


def test_grid_exports_imports_or_idles(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(c) {
  var i = show('grid', 'inline', c), k = show('grid', 'circular', c);
  return { inline: text(i.html).join(''), circ: text(k.html), acc: i.acc, cacc: k.acc, html: k.html };
}
// a signed grid sensor: negative is export, positive import (hk-energy.js: imp = max(0, g), exp = -g when g < 0)
r.signed_export = both(grid({ 'sensor.grid': pwr(-2100) }));
r.signed_import = both(grid({ 'sensor.grid': pwr(800) }));
// two sensors: the export one is export
r.two_export = both(grid({ 'sensor.grid': pwr(0), 'sensor.export': pwr(3200) }, { grid_export: 'sensor.export' }));
r.two_import = both(grid({ 'sensor.grid': pwr(1500), 'sensor.export': pwr(0) }, { grid_export: 'sensor.export' }));
// one panel reports kW and another W: each by its own unit
r.kw = both(grid({ 'sensor.grid': pwr(-2.1, 'kW') }));
r.kw_import = both(grid({ 'sensor.grid': pwr(0.8, 'kW') }));
r.big = both(grid({ 'sensor.grid': pwr(-12.43, 'kW') }));
// idle: under 50 W (what a 0.0 kW would round from)
r.idle = both(grid({ 'sensor.grid': pwr(20) }));
r.zero = both(grid({ 'sensor.grid': pwr(0) }));
r.edge_49 = both(grid({ 'sensor.grid': pwr(49) }));
r.edge_50 = both(grid({ 'sensor.grid': pwr(50) }));
r.edge_x50 = both(grid({ 'sensor.grid': pwr(-50) }));
// the grid down (grid_status reading off); no reading, unknown or unavailable is no answer
r.down = both(grid({ 'sensor.grid': pwr(0), 'binary_sensor.up': { state: 'off', attributes: {} } }, { grid_status: 'binary_sensor.up' }));
r.up = both(grid({ 'sensor.grid': pwr(-900), 'binary_sensor.up': { state: 'on', attributes: {} } }, { grid_status: 'binary_sensor.up' }));
r.status_unknown = both(grid({ 'sensor.grid': pwr(-900), 'binary_sensor.up': { state: 'unknown', attributes: {} } }, { grid_status: 'binary_sensor.up' }));
r.status_missing = both(grid({ 'sensor.grid': pwr(-900) }, { grid_status: 'binary_sensor.up' }));
// no data: a dash, never "Grid idle"
r.unavailable = both(grid({ 'sensor.grid': { state: 'unavailable', attributes: {} } }));
r.no_sensor = both(grid({}));
r.no_grid_id = both(grid({ 'sensor.grid': pwr(500) }, { grid: null }));
PLAN = null; r.no_plan = both(house({ 'sensor.grid': pwr(500) }));
PLAN = { power: null }; r.no_power = both(house({ 'sensor.grid': pwr(500) }));
PLAN = 'bad'; r.bad_plan = both(house({ 'sensor.grid': pwr(500) }));
PLAN = undefined; r.undef = both(house({}));
// export wins over a small import when both sensors read
r.both = both(grid({ 'sensor.grid': pwr(300), 'sensor.export': pwr(2000) }, { grid_export: 'sensor.export' }));
print(JSON.stringify(r));
""", before=FAKES)
    green, amber, red = "#5fd38a", "#ffb340", "#ff6b5e"
    assert out["signed_export"]["inline"] == "Exporting 2.1 kW" and out["signed_export"]["acc"] == green
    assert out["signed_export"]["circ"] == ["2.1", "EXPORT"] and out["signed_export"]["cacc"] == green
    assert out["signed_import"]["inline"] == "Importing 0.8 kW" and out["signed_import"]["acc"] == amber
    assert out["signed_import"]["circ"] == ["0.8", "IMPORT"] and out["signed_import"]["cacc"] == amber
    assert out["two_export"]["inline"] == "Exporting 3.2 kW" and out["two_export"]["circ"] == ["3.2", "EXPORT"]
    assert out["two_import"]["inline"] == "Importing 1.5 kW" and out["two_import"]["circ"] == ["1.5", "IMPORT"]
    assert out["kw"]["inline"] == "Exporting 2.1 kW" and out["kw_import"]["inline"] == "Importing 0.8 kW"
    assert out["big"]["circ"] == ["12.4", "EXPORT"] and out["big"]["inline"] == "Exporting 12.4 kW"
    assert out["both"]["inline"] == "Exporting 2.0 kW"
    for k in ("idle", "zero", "edge_49"):
        assert out[k]["inline"] == "Grid idle" and out[k]["circ"] == ["0", "IDLE"] and out[k]["acc"] is None, k
    assert out["edge_50"]["inline"] == "Importing 0.1 kW" and out["edge_x50"]["inline"] == "Exporting 0.1 kW"
    assert out["down"]["inline"] == "Grid down" and out["down"]["circ"] == ["—", "DOWN"] and out["down"]["acc"] == red
    assert out["up"]["inline"] == "Exporting 0.9 kW"
    assert out["status_unknown"]["inline"] == "Exporting 0.9 kW" and out["status_missing"]["inline"] == "Exporting 0.9 kW"
    for k in ("unavailable", "no_sensor", "no_grid_id", "no_plan", "no_power", "bad_plan", "undef"):
        assert out[k]["inline"] == "—" and out[k]["circ"] == ["—", "GRID"] and out[k]["acc"] is None and out[k]["cacc"] is None, k


def test_grid_gauge_scale_is_5_kw_then_10_then_20(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function frac(kw) {
  var html = show('grid', 'circular', grid({ 'sensor.grid': pwr(-kw, 'kW') })).html;
  var m = html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/g) || [];
  var nums = m.map(function (x) { var p = x.match(/"([\d.]+) ([\d.]+)"/); return +p[1] / +p[2]; });
  return nums.length > 1 ? nums[1] / 0.75 : null;
}
r.f = [1, 2.5, 5, 6, 8, 10, 12, 15].map(function (k) { return [k, frac(k)]; });
r.idle = show('grid', 'circular', grid({ 'sensor.grid': pwr(0) })).html.match(/stroke-dasharray/g).length;
print(JSON.stringify(r));
""", before=FAKES)
    want = {1: 0.2, 2.5: 0.5, 5: 1.0, 6: 0.6, 8: 0.8, 10: 1.0, 12: 0.6, 15: 0.75}
    for kw, f in out["f"]:
        assert f == pytest.approx(want[kw], abs=0.005), kw
    assert out["idle"] == 1                                              # idle: the track alone, no arc


def test_ev_shows_the_charge_and_whether_it_is_charging(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(c) {
  var i = show('ev', 'inline', c), k = show('ev', 'circular', c);
  return { inline: text(i.html).join(''), circ: text(k.html), acc: i.acc, cacc: k.acc, html: k.html, glyph: i.html.indexOf('<svg') >= 0 };
}
var YL = { state: '80', attributes: {} }, HOME = { state: 'home', attributes: {} }, AWAY = { state: 'not_home', attributes: {} }, ON = { state: 'on', attributes: {} }, OFF = { state: 'off', attributes: {} };
function ev(sensors, p, car) {
  PLAN = plan(Object.assign({ cars: [Object.assign({}, CAR, car || {})] }, p || {}));
  return house(sensors);
}
// not charging: plugged in or not, nothing flowing
r.idle = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0), 'device_tracker.y': HOME, 'binary_sensor.y_cable': OFF }));
// the car's own reading says charging (no wall charger in the plan)
r.own = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(7.2, 'kW'), 'device_tracker.y': HOME, 'binary_sensor.y_cable': ON }));
// a wall charger's live watts, the car plugged in at home
r.wall = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0), 'sensor.wall': pwr(7200), 'device_tracker.y': HOME, 'binary_sensor.y_cable': ON }, { chargers: ['sensor.wall'] }));
// the wall charger idle: not charging
r.wall_idle = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0), 'sensor.wall': pwr(2), 'device_tracker.y': HOME, 'binary_sensor.y_cable': ON }, { chargers: ['sensor.wall'] }));
// a charger found in the Energy plan's devices (as hk-strategy.js powerView does)
r.found = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0), 'sensor.wc': pwr(6500), 'device_tracker.y': HOME, 'binary_sensor.y_cable': ON }, { chargers: [],
  sections: [{ items: [{ name: 'Wall Connector', power: 'sensor.wc' }] }] }));
// the car's own charger setting (its Wall Connector)
r.own_charger = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0), 'sensor.wc': pwr(5000), 'device_tracker.y': HOME }, {}, { charger: 'sensor.wc' }));
// the car's state entity says charging (a wall charger is live)
r.state = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0), 'sensor.wall': pwr(3000), 'sensor.y_state': { state: 'Charging', attributes: {} }, 'device_tracker.y': HOME },
  { chargers: ['sensor.wall'] }, { state: 'sensor.y_state' }));
// away from home, the car's own reading is a charger somewhere else: not the house's
r.away = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(7000), 'device_tracker.y': AWAY, 'binary_sensor.y_cable': ON }));
// a location that is unavailable is no answer: still home
r.loc_unavailable = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(7000), 'device_tracker.y': { state: 'unavailable', attributes: {} } }));
// no name: "Car"
r.noname = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0) }, {}, { name: '' }));
r.longname = both(ev({ 'sensor.y_level': YL, 'sensor.y_power': pwr(0) }, {}, { name: 'Mustang Mach-E Premium Extended' }));
// the level: 100 and 0 and out-of-range
r.full = both(ev({ 'sensor.y_level': { state: '100', attributes: {} }, 'sensor.y_power': pwr(0) }));
r.empty = both(ev({ 'sensor.y_level': { state: '0', attributes: {} }, 'sensor.y_power': pwr(0) }));
r.over = both(ev({ 'sensor.y_level': { state: '104', attributes: {} }, 'sensor.y_power': pwr(0) }));
r.round = both(ev({ 'sensor.y_level': { state: '79.6', attributes: {} }, 'sensor.y_power': pwr(0) }));
// no reading of the level: a dash (the car's name stays under it)
r.unavailable = both(ev({ 'sensor.y_level': { state: 'unavailable', attributes: {} }, 'sensor.y_power': pwr(0) }));
r.missing = both(ev({}));
// two cars: the one charging is shown, else the first with a charge
PLAN = plan({ cars: [{ name: 'Bolt', level: 'sensor.b_level', power: 'sensor.b_power' }, { name: 'Model Y', level: 'sensor.y_level', power: 'sensor.y_power' }] });
r.two_idle = both(house({ 'sensor.b_level': { state: '40', attributes: {} }, 'sensor.y_level': YL, 'sensor.b_power': pwr(0), 'sensor.y_power': pwr(0) }));
r.two_y = both(house({ 'sensor.b_level': { state: '40', attributes: {} }, 'sensor.y_level': YL, 'sensor.b_power': pwr(0), 'sensor.y_power': pwr(7000) }));
r.two_b = both(house({ 'sensor.b_level': { state: '40', attributes: {} }, 'sensor.y_level': YL, 'sensor.b_power': pwr(6000), 'sensor.y_power': pwr(0) }));
r.two_first_unread = both(house({ 'sensor.y_level': YL, 'sensor.b_power': pwr(0), 'sensor.y_power': pwr(0) }));
// a plan with no car, or none with a level, or no plan at all: a dash
PLAN = plan({ cars: [] }); r.nocars = both(house({}));
PLAN = plan({ cars: [{ name: 'X' }, null, 3] }); r.nolevel = both(house({}));
PLAN = null; r.noplan = both(house({ 'sensor.y_level': YL }));
print(JSON.stringify(r));
""", before=FAKES)
    green, blue = "#5fd38a", "#64b5ff"
    assert out["idle"]["inline"] == "Model Y 80%" and out["idle"]["circ"] == ["80%", "MODEL Y"] and out["idle"]["acc"] == green and out["idle"]["glyph"]
    for k in ("own", "wall", "found", "own_charger", "state", "loc_unavailable"):
        assert out[k]["inline"] == "Model Y 80%, charging", k
        assert out[k]["circ"] == ["80%", "CHARGING"], k
        assert out[k]["acc"] == blue and out[k]["cacc"] == blue, k
    for k in ("wall_idle", "away"):
        assert out[k]["inline"] == "Model Y 80%" and out[k]["circ"] == ["80%", "MODEL Y"] and out[k]["acc"] == green, k
    assert out["noname"]["inline"] == "Car 80%" and out["noname"]["circ"] == ["80%", "CAR"]
    assert out["longname"]["inline"] == "Mustang Mach-E… 80%"                  # the inline name is cut at 16
    assert len(out["longname"]["circ"][1]) <= 8 and out["longname"]["circ"][1].endswith("…")
    assert out["full"]["circ"][0] == "100%" and out["empty"]["circ"][0] == "0%" and out["over"]["circ"][0] == "100%" and out["round"]["circ"][0] == "80%"
    assert out["unavailable"]["inline"] == "—" and out["unavailable"]["circ"] == ["—", "MODEL Y"] and out["unavailable"]["acc"] is None
    assert out["missing"]["inline"] == "—" and out["missing"]["circ"] == ["—", "MODEL Y"]
    assert out["two_idle"]["inline"] == "Bolt 40%"
    assert out["two_y"]["inline"] == "Model Y 80%, charging" and out["two_b"]["inline"] == "Bolt 40%, charging"
    assert out["two_first_unread"]["inline"] == "Model Y 80%"
    for k in ("nocars", "nolevel", "noplan"):
        assert out[k]["inline"] == "—" and out[k]["circ"] == ["—", "CAR"] and out[k]["acc"] is None and out[k]["glyph"] is False, k


def test_the_ring_fills_to_the_charge(tmp_path):
    out = run(tmp_path, r"""
PLAN = plan({ cars: [CAR] });
var html = show('ev', 'circular', house({ 'sensor.y_level': { state: '80', attributes: {} }, 'sensor.y_power': pwr(0) })).html;
var m = (html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/g) || []).map(function (x) { var p = x.match(/"([\d.]+) ([\d.]+)"/); return +p[1] / +p[2]; });
print(JSON.stringify({ n: m.length, frac: m[1], gauge: html.indexOf('rotate(135') >= 0 }));
""", before=FAKES)
    assert out["n"] == 2 and out["frac"] == pytest.approx(0.8, abs=0.005) and out["gauge"] is False      # a whole ring, as the battery's


def test_a_bad_plan_or_house_does_not_throw(tmp_path):
    out = run(tmp_path, r"""
var res = [], errors = [];
var plans = [null, undefined, {}, { power: 5 }, { power: { grid: 7, cars: 'x', chargers: 'y', sections: 3 } },
             { power: { grid: 'sensor.grid', cars: [null, { level: 'sensor.l', home: 4, power: {}, charger: 3 }], chargers: [null, 3], sections: [null, { items: [null, { power: 3 }] }] } }];
var houses = [{ states: { 'sensor.grid': { state: 'x', attributes: null }, 'sensor.l': null } }, { states: undefined }, null, {}];
window.hkChart = undefined;
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    plans.forEach(function (pl, i) {
      houses.forEach(function (c, j) {
        try { PLAN = pl; var w = mk(p, s); w.update(c, T0); res.push(w.el.innerHTML.length); w.destroy(); }
        catch (e) { errors.push(p + '/' + s + '/' + i + '/' + j + ': ' + e); }
      });
    });
  });
});
// (no hkChart: watts read from the state and its unit)
PLAN = plan({ grid: 'sensor.grid' });
var t = text(show('grid', 'inline', house({ 'sensor.grid': { state: '-2.1', attributes: { unit_of_measurement: 'kW' } } })).html).join('');
window.hkSettings = undefined;
var t2 = text(show('grid', 'inline', house({ 'sensor.grid': pwr(500) })).html).join('');
print(JSON.stringify({ res: res.length, errors: errors, warns: WARNS, t: t, t2: t2 }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []
    assert out["t"] == "Exporting 2.1 kW" and out["t2"] == "—"


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))     # (the header says what it does not use)
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "setInterval", "requestAnimationFrame", "setTimeout", "Mantel"):
        assert word not in code, word
    # American English, and nothing that wakes a read: no summary, no waker, no timer
    for word in ("colour", "centre", "grey", "favourite"):
        assert word not in src.lower(), word
    assert "requestUpdate" not in code and "hkStats" not in code and "hkEnergy" not in code and "waker" not in code
    # the piece adds no CSS of its own
    assert "addCss" not in code
    # the Home Power card's own reading of watts (hk-energy.js pw()) and of the grid and the cars
    assert "{ watts: true, fallback: null }" in src
    assert "exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0" in src


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
