"""The screensaver's Weather and Sky pieces (web/hk/modules/hk-saverpieces-weather.js; docs/phase13/GLANCE-SPEC.md, wave A):
rain, alert, uv, wind, pressure, feels, moon and sun, every one in each of its shapes, with an empty house and a small one;
what each reads (the hourly forecast, the NWS alerts sensor, hkSettings.nowRead, the weather entity, the moon, the sun); when
a "shows when" piece shows; the accents; and the look keeps the plan's rules (nothing animates, nothing blurs, one spacing
scale in the bars). Run under macOS's JavaScriptCore with the renderer's own DOM shim (tests/test_saverwidgets_pieces.py)."""
import importlib.util
import json
import math
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-weather.js"

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


# the house, as fakes: the weather entity, the sun, the NWS alerts sensor, hkSettings (get, nowRead, moon, weatherId), the
# weather readings and the hourly forecast watcher (the renderer's X.wx() and X.hourly() go through them)
FAKES = r"""
var T0 = new Date(2026, 10, 2, 13, 10, 0);                        // 1:10 PM
function L(d, h, m) { return new Date(2026, 10, d, h, m || 0, 0); }
function hr(h, pop, cond, press) {
  var o = { datetime: L(2, h).toISOString(), condition: cond || 'cloudy' };
  if (pop !== null && pop !== undefined) o.precipitation_probability = pop;
  if (press !== null && press !== undefined) o.pressure = press;
  return o;
}
function hours(pops, cond) { return pops.map(function (p, i) { return hr(14 + i, p, p >= 40 ? (cond || 'rainy') : 'cloudy'); }); }
var calls = [], released = [], HOURLY = [], DAILY = [];
var WSTATE = 'cloudy', WATTR = { temperature: 64, pressure: 30.12, pressure_unit: 'inHg', wind_speed_unit: 'mph' }, WINDU = 'mph';
var NR = { uv: 6, wind: 12, gust: 21, feels_like: 61 }, MOONP = 0.37, ALERTS = null, SUN = null, GET = { 'weather.alerts': 'sensor.nws_alerts' };
window.hkSettings = {
  get: function (k, d) { return GET[k] !== undefined ? GET[k] : (d === undefined ? null : d); },
  nowRead: function (st, key) { return NR[key] === undefined ? null : NR[key]; },
  moon: function () { return MOONP; },
  weatherId: function (st) { return Object.keys(st).filter(function (k) { return k.indexOf('weather.') === 0; })[0] || null; }
};
window.hkWxReadings = { read: function (c) {
  return c && c.states && c.states['weather.home'] ? { entity: 'weather.home', temp: 64, unit: 'F', cond: WSTATE, hi: 72, lo: 55, windUnit: WINDU } : null;
} };
window.hkWxForecast = { watch: function (subs, kind, entity, cb) {
  calls.push(kind + '|' + entity);
  return { data: function () { return kind === 'hourly' ? HOURLY : DAILY; }, ensure: function () {}, release: function () { released.push(kind); } };
} };
function client(subs) {
  var st = { 'weather.home': { state: WSTATE, attributes: WATTR } };
  if (SUN) st['sun.sun'] = SUN;
  if (ALERTS) st['sensor.nws_alerts'] = ALERTS;
  return { states: st, config: { unit_system: { temperature: '°F' } }, subscriptions: subs === false ? undefined : {} };
}
var EMPTY = { states: {}, config: {} };
function sun(state, rise, set) { return { state: state, attributes: { next_rising: rise.toISOString(), next_setting: set.toISOString() } }; }
function alertRow(event, sev, ends, head) { var a = { Event: event, Severity: sev, Headline: head || '' }; if (ends) a.Ends = ends.toISOString(); return a; }
function alerts(rows) { return { state: String(rows.length), attributes: { Alerts: rows } }; }
function mk(piece, shape, o) { return W.create(piece, shape, { u: 4, back: 'none', opts: {}, h24: !!(o && o.h24), color: 'auto' }); }
function show(piece, shape, c, now, o) { var w = mk(piece, shape, o); w.update(c || client(), now || T0); var r = { showing: w.showing, html: w.el.innerHTML, acc: w.el.style.props['--sw-acc'], accd: w.el.style.props['--sw-acc-d'] }; w.destroy(); return r; }
var CATALOG = { rain: ['circular', 'inline', 'rectangular'], alert: ['card', 'inline'], uv: ['circular'], wind: ['circular'], pressure: ['circular'],
                feels: ['circular'], moon: ['circular', 'inline'], sun: ['circular', 'inline', 'rectangular'] };
"""


def test_the_declarations_are_complete(tmp_path):
    out = run(tmp_path, r"""
var P = {};
Object.keys(CATALOG).forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = d ? { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
               accent: typeof d.accent, shapes: Object.keys(d.shapes).sort() } : null;
});
print(JSON.stringify({ P: P, core: !!W.PIECES.weather, double: (function () { load(GROUPFILE); return Object.keys(W.PIECES).length; })(), n: Object.keys(W.PIECES).length }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    P = out["P"]
    shapes = {"rain": ["circular", "inline", "rectangular"], "alert": ["card", "inline"], "uv": ["circular"], "wind": ["circular"],
              "pressure": ["circular"], "feels": ["circular"], "moon": ["circular", "inline"], "sun": ["circular", "inline", "rectangular"]}
    for k, want in shapes.items():
        assert P[k] is not None, k
        assert P[k]["shapes"] == want, k
        assert P[k]["group"] == "Weather and Sky" and P[k]["wave"] == "A" and P[k]["name"] and P[k]["wakes"] and P[k]["source"]
        assert P[k]["facts"] == [k] and P[k]["pick"] is None and P[k]["off"] is False and P[k]["opts"] == {}
        assert P[k]["accent"] in ("object", "function")
    assert P["rain"]["when"] == "when rain is coming" and P["alert"]["when"] == "while one is active"
    assert all(P[k]["when"] is None for k in P if k not in ("rain", "alert"))
    assert out["core"] and out["double"] == out["n"]                         # loaded twice: nothing is added again


def test_every_piece_and_shape_draws_with_an_empty_house_and_a_sample_one(tmp_path):
    out = run(tmp_path, r"""
SUN = sun('above_horizon', L(3, 6, 51), L(2, 17, 12));
WSTATE = 'rainy'; HOURLY = hours([70, 60, 50, 30, 20, 10, 10, 10]);
ALERTS = alerts([alertRow('Wind Advisory', 'Moderate', L(2, 18), 'Wind Advisory issued November 2 at 12:30PM CST until November 2 at 6:00PM CST by NWS Chicago IL')]);
var results = [], errors = [];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [['empty', EMPTY], ['house', client()]].forEach(function (h, hi) {
      ['none', 'glass', 'tint'].forEach(function (back, bi) {
        try {
          var w = W.create(p, s, { u: 4, back: back, color: bi === 2 ? 'accent' : 'auto', h24: hi === 1, opts: {} });
          if (!w) { errors.push('no create ' + p + '/' + s); return; }
          var drew = w.update(h[1], T0), again = w.update(h[1], T0), m = w.measure();
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
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == (3 + 2 + 1 + 1 + 1 + 1 + 2 + 3) * 7
    for r in out["results"]:
        key = (r["p"], r["s"], r["h"])
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"], key
        if r["h"] != "sample":
            assert r["again"] is False, key                                  # drawn again only when the spec changes
            assert r["live"] is False and r["w"] >= 0 and r["hh"] > 0, key
        # a piece that always shows draws something in an empty house too (dashes); rain and alert hide
        if r["h"] == "empty":
            assert r["showing"] is (r["p"] not in ("rain", "alert")), key
        if r["h"] == "house":
            assert r["showing"] is True, key
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
        if r["s"] == "circular" and r["h"] in ("sample", "house"):
            assert 'stroke-width="7.5"' in r["html"] and 'y="72"' in r["html"] and "viewBox=\"0 0 100 100\"" in r["html"], (r["p"], r["h"])
            assert 'r="43"' in r["html"] or "A43 43" in r["html"], r["p"]


def test_rain_shows_only_when_rain_is_coming(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all(c) {
  return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('rain', s, c || client(), T0); return [x.showing, x.html]; });
}
HOURLY = hours([10, 10, 20, 30, 30, 10, 0, 0, 0, 0, 0, 0]);
r.dry = all();
HOURLY = hours([10, 20, 60, 50, 30, 10, 0, 0, 0, 0, 0, 0]);               // 60% at 4 PM... the hours start at 2 PM
r.at4 = all();
HOURLY = [hr(14, 10), hr(15, 60), hr(16, 50), hr(17, 20), hr(18, 10), hr(19, 0), hr(20, 0), hr(21, 0), hr(22, 0)];
r.at3 = all();
r.at3_24 = show('rain', 'inline', client(), T0, { h24: true }).html;
WSTATE = 'rainy';
HOURLY = [hr(14, 70, 'rainy'), hr(15, 60, 'rainy'), hr(16, 20), hr(17, 10)];
r.until = all();
HOURLY = [hr(14, 90, 'rainy'), hr(15, 80, 'rainy'), hr(16, 70, 'rainy'), hr(17, 60, 'rainy'), hr(18, 60, 'rainy'), hr(19, 60, 'rainy'), hr(20, 60, 'rainy'), hr(21, 60, 'rainy'),
          hr(22, 60, 'rainy'), hr(23, 60, 'rainy'), hr(24, 60, 'rainy')];
r.goes = show('rain', 'inline').html;
HOURLY = [];
r.nofc = all();
WSTATE = 'cloudy';
HOURLY = [hr(14, 10), hr(15, 10), hr(16, 10), hr(17, 10), hr(18, 10), hr(19, 10), hr(20, 10), hr(21, 80, 'snowy'), hr(22, 70, 'snowy')];
r.snow = all();
HOURLY = [hr(14, 10), hr(15, null, 'rainy'), hr(16, 20)];
r.nopop = all();
HOURLY = [hr(14, 10), hr(24, 60), hr(25, 70)];                             // midnight tonight: tomorrow, 10 h 50 min away
r.midnight = show('rain', 'inline').html;
HOURLY = [hr(14, 10), hr(26, 90, 'rainy')];                                // 2 AM: past the 12 hours
r.late = all();
HOURLY = [hr(14, 10), hr(15, 45), hr(16, 10)];                             // 45%, a cloudy condition: likely by chance alone
r.chance = show('rain', 'circular').html;
HOURLY = [hr(14, 39), hr(15, 39)];
r.below = all();
print(JSON.stringify(r));
""", before=FAKES)
    for s in out["dry"]:
        assert s == [False, ""]
    assert "Rain at 4 PM" in out["at4"][0][1] and "60%" in out["at4"][1][1] and "RAIN" in out["at4"][1][1]
    assert all(s[0] for s in out["at3"])
    assert "Rain at 3 PM" in out["at3"][0][1] and ">60%<" in out["at3"][1][1] and ">RAIN<" in out["at3"][1][1]
    assert 'class="a"' in out["at3"][0][1]                                    # the glyph carries the accent
    assert "Rain at 15:00" in out["at3_24"]
    assert "Rain until 4 PM" in out["until"][0][1] and all(s[0] for s in out["until"])
    assert "Rain continues" in out["goes"]
    assert "Rain now" in out["nofc"][0][1] and out["nofc"][0][0] is True       # falling now, no forecast: still shown
    assert "Snow at 9 PM" in out["snow"][0][1] and ">SNOW<" in out["snow"][1][1] and ">80%<" in out["snow"][1][1]
    assert "Rain at 3 PM" in out["nopop"][0][1] and ">100%<" in out["nopop"][1][1]
    assert "Rain tomorrow at 12 AM" in out["midnight"]
    assert all(s == [False, ""] for s in out["late"])
    assert ">45%<" in out["chance"]
    assert all(s == [False, ""] for s in out["below"])                        # 39% is not likely


def test_rain_rectangular_is_eight_bars_on_a_baseline(tmp_path):
    out = run(tmp_path, r"""
HOURLY = [hr(14, 10), hr(15, 60), hr(16, 50), hr(17, 20), hr(18, 0), hr(19, 30), hr(20, 70), hr(21, 40), hr(22, 90), hr(23, 90)];
var a = show('rain', 'rectangular');
var b = show('rain', 'rectangular', client(), T0, { h24: true });
HOURLY = [hr(14, 10), hr(15, 60)];
var c = show('rain', 'rectangular');
print(JSON.stringify({ a: a.html, b: b.html, c: c.html, acc: a.acc, sample: W.sample('rain', 'rectangular').innerHTML }));
""", before=FAKES)
    for html in (out["a"], out["sample"]):
        rects = re.findall(r'<rect class="a" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="4" fill="currentColor"( opacity="\.45")?/>', html)
        assert len(rects) >= 7
        xs = [int(r[0]) for r in rects]
        assert {int(r[2]) for r in rects} == {24}                              # equal widths
        assert all((b - a) % 32 == 0 and b > a for a, b in zip(xs, xs[1:])) and all((x - 1) % 32 == 0 for x in xs)   # one pitch: equal gaps (8 = .8 u)
        assert all(int(r[1]) + int(r[3]) == 64 for r in rects)                 # every bar stands on the baseline
        assert re.search(r'<path d="M1 65H249"', html)                         # the baseline
        assert 'font-size="20"' in html
    # the first and last hour under the bars, on the bars' edges; the likely hours solid, the rest faded
    a = out["a"]
    assert '<text x="1" y="90" font-size="20" font-weight="600" opacity=".8">2 PM</text>' in a
    assert '<text x="249" y="90" text-anchor="end" font-size="20" font-weight="600" opacity=".8">9 PM</text>' in a
    assert ">70%<" in a and ">RAIN<" in a                                      # the highest of the eight (the 90s after them are not shown)
    rects = re.findall(r'<rect class="a" x="(\d+)" y="\d+" width="24" height="(\d+)" rx="4" fill="currentColor"( opacity="\.45")?/>', a)
    assert [bool(r[2]) for r in rects] == [True, False, False, True, True, False, False]       # 10 20 30 faded (the 0 has no bar); 60 50 70 40 solid
    assert [int(r[1]) for r in rects][1] == round(0.6 * 36)                    # 60% of the bars' 3.6 u
    assert "14:00" in out["b"] and "21:00" in out["b"]
    assert "2 PM" in out["c"] and "9 PM" in out["c"]                           # one hour of forecast: the labels still span eight
    assert out["acc"] == "#82c3ff"


def test_alert_shows_only_while_one_is_active(tmp_path):
    out = run(tmp_path, r"""
var r = {}, head = 'Wind Advisory issued November 2 at 12:30PM CST until November 2 at 6:00PM CST by NWS Chicago IL';
function both() { return ['inline', 'card'].map(function (s) { var x = show('alert', s, client(), T0); return [x.showing, x.html, x.acc]; }); }
r.none = both();                                                            // no sensor
ALERTS = alerts([]); r.empty = both();
ALERTS = alerts([alertRow('Flood Watch', 'Severe', L(2, 12), 'Flood Watch')]); r.ended = both();      // ended at noon
ALERTS = { state: 'unavailable', attributes: {} }; r.unavailable = both();
ALERTS = { state: '0', attributes: { Alerts: [] } }; r.zero = both();
var row = alertRow('Wind Advisory', 'Moderate', L(2, 18), head);
ALERTS = alerts([alertRow('Flood Watch', 'Severe', L(2, 12), 'Flood Watch'), row]);
r.active = both();
r.active_24 = show('alert', 'inline', client(), T0, { h24: true }).html;
// the most severe first; each severity's accent
ALERTS = alerts([row, alertRow('Tornado Warning', 'Extreme', L(2, 14, 30), 'Tornado Warning')]); r.extreme = both();
r.sev = {};
['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown', ''].forEach(function (s) {
  ALERTS = alerts([alertRow('X Alert', s, L(2, 18), '')]);
  var x = show('alert', 'inline'); r.sev[s || 'blank'] = [x.acc, x.accd];
  var y = show('alert', 'card'); r.sev[(s || 'blank') + '_card'] = y.acc;
});
// no end: no "until"; the headline that only repeats the event is left out; a long one is two lines
ALERTS = alerts([{ Event: 'Special Statement', Severity: 'Minor', Headline: 'Special Statement' }]); r.noend = both();
ALERTS = alerts([{ Event: 'Heat Advisory', Severity: 'Moderate', Expires: L(3, 9).toISOString(), Headline: head + ' ' + head }]); r.expires = both();
// a sensor that counts but lists none
ALERTS = { state: '2', attributes: {} }; r.count = both();
GET['weather.alerts'] = null; ALERTS = alerts([row]); r.unset = both();
print(JSON.stringify(r));
""", before=FAKES)
    for k in ("none", "empty", "ended", "unavailable", "zero", "unset"):
        assert out[k][0][:2] == [False, ""] and out[k][1][:2] == [False, ""], k
    a = out["active"]
    assert a[0][0] is True and "Wind Advisory until 6 PM" in a[0][1] and "Flood" not in a[0][1]
    assert a[1][0] is True and "Wind Advisory" in a[1][1] and "Until 6 PM" in a[1][1] and "font-weight:700" in a[1][1]
    assert a[1][1].count('class="s2"') == 3                                    # until, then the headline in two lines
    lines = re.findall(r'<div class="s2"[^>]*>([^<]*)</div>', a[1][1])
    assert len(lines) == 3 and all(len(x) <= 34 for x in lines[1:]) and lines[2].endswith("…")
    assert "until 18:00" in out["active_24"]
    assert "Tornado Warning until 2:30 PM" in out["extreme"][0][1] and "Wind Advisory" not in out["extreme"][0][1]
    assert out["sev"]["Extreme"] == ["#ff6b5e", "#c4261a"] and out["sev"]["Severe"] == ["#ffa24d", "#c25e00"]
    assert out["sev"]["Moderate"] == ["#ffd166", "#8a5d00"] and out["sev"]["Minor"] == ["#8ad8c0", "#2f8f7e"]
    assert out["sev"]["Unknown"] == out["sev"]["blank"] == ["#ffb340", "#b36b00"]
    assert out["sev"]["Extreme_card"] == "#ff6b5e" and out["sev"]["Minor_card"] == "#8ad8c0"
    assert "Special Statement" in out["noend"][0][1] and "until" not in out["noend"][0][1] and "Active alert" in out["noend"][1][1]
    assert out["noend"][1][1].count('class="s2"') == 1
    assert "Heat Advisory until tomorrow 9 AM" in out["expires"][0][1]
    assert out["expires"][1][1].count('class="s2"') == 3
    assert "Weather Alert" in out["count"][0][1] and out["count"][0][0] is True


def test_uv_colors_follow_the_who_scale(tmp_path):
    out = run(tmp_path, r"""
var r = {};
[0, 2, 2.4, 3, 5, 6, 7, 8, 10, 11, 13.2].forEach(function (v) {
  NR.uv = v; var x = show('uv', 'circular'); r[v] = [x.acc, x.accd, x.html];
});
NR.uv = null; var n = show('uv', 'circular'); r.none = [n.acc, n.html];
NR.uv = 6;
r.nohs = (function () { var keep = window.hkSettings; window.hkSettings = null; var x = show('uv', 'circular'); window.hkSettings = keep; return x.html; })();
print(JSON.stringify(r));
""", before=FAKES)
    green, yellow, orange, red, violet = "#5fd38a", "#ffd166", "#ffa24d", "#ff6b5e", "#c58bff"
    want = {"0": green, "2": green, "2.4": green, "3": yellow, "5": yellow, "6": orange, "7": orange, "8": red, "10": red, "11": violet, "13.2": violet}
    for k, color in want.items():
        assert out[k][0] == color, (k, out[k][0])
    assert out["11"][2].count(">11+<") == 1 and out["13.2"][2].count(">11+<") == 1 and ">6<" in out["6"][2] and ">UV<" in out["6"][2]
    assert out["0"][1] == "#1f8a4c" and out["11"][1] == "#7a35c4"              # black ink's pair
    # the gauge: 6 of 11 -> 54.5%, drawn to the nearest 200th (the arc is a three-quarter circle)
    frac = round(6 / 11 * 200) / 200
    assert f"{2 * math.pi * 43 * 0.75 * frac:.2f}" in out["6"][2]
    assert out["none"][0] is None and ">—<" in out["none"][1] and ">UV<" in out["none"][1]
    assert ">—<" in out["nohs"]


def test_wind_pressure_and_feels_read_what_the_house_says(tmp_path):
    out = run(tmp_path, r"""
var r = {};
r.wind = show('wind', 'circular');
NR.gust = null; r.wind_nogust = show('wind', 'circular').html;
NR.gust = 21; WINDU = 'km/h'; NR.wind = 30; r.wind_kmh = show('wind', 'circular').html;
NR.wind = null; r.wind_none = show('wind', 'circular').html;
NR.wind = 12; WINDU = 'mph';
// pressure: inHg, its arrow from the hourly forecast three hours on (13:10 -> 16:00 is the closest)
HOURLY = [hr(13, 0, 'cloudy', 30.10), hr(14, 0, 'cloudy', 30.12), hr(15, 0, 'cloudy', 30.15), hr(16, 0, 'cloudy', 30.16), hr(17, 0, 'cloudy', 30.20)];
r.p_up = show('pressure', 'circular');
HOURLY = [hr(13, 0, 'cloudy', 30.10), hr(14, 0, 'cloudy', 30.07), hr(15, 0, 'cloudy', 30.05), hr(16, 0, 'cloudy', 30.06), hr(17, 0, 'cloudy', 30.00)];
r.p_down = show('pressure', 'circular').html;
HOURLY = [hr(13, 0, 'cloudy', 30.10), hr(14, 0, 'cloudy', 30.11), hr(15, 0, 'cloudy', 30.12), hr(16, 0, 'cloudy', 30.12), hr(17, 0, 'cloudy', 30.13)];
r.p_hold = show('pressure', 'circular').html;
HOURLY = [hr(13, 0, 'cloudy'), hr(14, 0), hr(15, 0), hr(16, 0)];
r.p_unknown = show('pressure', 'circular').html;
HOURLY = [];
r.p_none = show('pressure', 'circular').html;
WATTR = { pressure: 1013.4, pressure_unit: 'hPa' };
HOURLY = [hr(13, 0, 'cloudy', 1013), hr(14, 0, 'cloudy', 1013), hr(15, 0, 'cloudy', 1014), hr(16, 0, 'cloudy', 1014.2), hr(17, 0, 'cloudy', 1015)];
r.p_hpa = show('pressure', 'circular').html;
HOURLY = [hr(13, 0, 'cloudy', 1013), hr(16, 0, 'cloudy', 1011.5)];
r.p_hpa_down = show('pressure', 'circular').html;
HOURLY = [hr(13, 0, 'cloudy', 1013), hr(16, 0, 'cloudy', 1013.8)];
r.p_hpa_hold = show('pressure', 'circular').html;
HOURLY = [];
WATTR = { temperature: 64 };
r.p_missing = show('pressure', 'circular').html;
WATTR = { pressure: 30.9, pressure_unit: 'inHg' };
r.p_hi = show('pressure', 'circular').html;
WATTR = { pressure: 28.0, pressure_unit: 'inHg' };
r.p_lo = show('pressure', 'circular').html;
// feels like: over today's range (55 to 72), by temperature
r.f = show('feels', 'circular');
NR.feels_like = 0; r.f_cold = show('feels', 'circular');
NR.feels_like = 95; r.f_hot = show('feels', 'circular');
NR.feels_like = null; r.f_none = show('feels', 'circular');
r.tempAcc61 = W._.tempAcc(61); r.tempAcc0 = W._.tempAcc(0); r.tempAcc95 = W._.tempAcc(95);
r.watch = calls.slice();
print(JSON.stringify(r));
""", before=FAKES)
    arc = lambda frac: f"{2 * math.pi * 43 * 0.75 * frac:.2f}"
    w = out["wind"]
    assert ">12<" in w["html"] and ">G 21<" in w["html"] and w["acc"] == "#8ad8c0"
    assert arc(round(12 / 40 * 200) / 200) in w["html"]                         # a gauge to 40 mph
    assert ">MPH<" in out["wind_nogust"] and "G 21" not in out["wind_nogust"]
    assert ">30<" in out["wind_kmh"] and arc(0.5) in out["wind_kmh"]            # to 60 km/h
    assert ">—<" in out["wind_none"] and ">G 21<" in out["wind_none"]
    up = out["p_up"]
    assert ">30.12<" in up["html"] and ">inHg<" in up["html"] and "M50 91V81" in up["html"] and up["acc"] == "#9db4d6"
    assert arc(round((30.12 - 28.5) / 2.5 * 200) / 200) in up["html"]
    assert "M50 81v10" in out["p_down"] and "M50 91V81" not in out["p_down"]
    for k in ("p_hold", "p_unknown", "p_none", "p_hpa_hold", "p_missing"):
        assert "M50 91V81" not in out[k] and "M50 81v10" not in out[k], k
    assert ">1013<" in out["p_hpa"] and ">hPa<" in out["p_hpa"] and "M50 91V81" in out["p_hpa"]
    assert "M50 81v10" in out["p_hpa_down"]
    assert ">—<" in out["p_missing"]
    assert arc(1.0) in out["p_hi"] or arc(round((30.9 - 28.5) / 2.5 * 200) / 200) in out["p_hi"]
    assert ">28.00<" in out["p_lo"] and 'stroke-dasharray="0.00 ' in out["p_lo"]            # below the gauge: empty
    f = out["f"]
    assert ">61°<" in f["html"] and ">FEELS<" in f["html"]
    assert arc(round((61 - 55) / 17 * 200) / 200) in f["html"]
    assert f["acc"] == out["tempAcc61"][0] and f["accd"] == out["tempAcc61"][1]
    assert out["f_cold"]["acc"] == out["tempAcc0"][0] and out["f_hot"]["acc"] == out["tempAcc95"][0]
    assert ">—<" in out["f_none"]["html"] and out["f_none"].get("acc") is None
    assert sorted(set(out["watch"])) == ["daily|weather.home", "hourly|weather.home"]


def test_moon_names_and_illumination(tmp_path):
    out = run(tmp_path, r"""
var r = {};
[0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.99, 1].forEach(function (p) {
  MOONP = p;
  var i = show('moon', 'inline'), c = show('moon', 'circular');
  r[p] = [i.html, c.html, c.acc];
});
MOONP = 0.37;
r.nomoon = (function () { var keep = window.hkSettings.moon; window.hkSettings.moon = undefined; var i = show('moon', 'inline'), c = show('moon', 'circular'); window.hkSettings.moon = keep; return [i.html, c.html]; })();
r.nohs = (function () { var keep = window.hkSettings; window.hkSettings = null; var i = show('moon', 'inline'); window.hkSettings = keep; return i.html; })();
print(JSON.stringify(r));
""", before=FAKES)
    names = {"0": "New Moon", "0.1": "Waxing Crescent", "0.25": "First Quarter", "0.4": "Waxing Gibbous", "0.5": "Full Moon", "0.6": "Waning Gibbous",
             "0.75": "Last Quarter", "0.9": "Waning Crescent", "0.99": "New Moon", "1": "New Moon"}
    pct = {"0": 0, "0.1": 10, "0.25": 50, "0.4": 90, "0.5": 100, "0.6": 90, "0.75": 50, "0.9": 10, "0.99": 0, "1": 0}
    for k, name in names.items():
        inline, circ, acc = out[k]
        assert f"<span>{name}</span>" in inline, (k, inline)
        assert f">{pct[k]}%<" in circ and 'y="72"' in circ and acc == "#f3dfa2", k
        assert 'stroke-width="7.5"' in circ and 'r="43"' in circ                 # the ring's track, the moon inside it
    # the lit path: none at the new moon, a whole disc at the full, a half-disc on the right waxing and on the left waning
    assert 'd="M' not in out["0"][1] and 'd="M50.00 24.00A18.00 18.00 0 0 1 50.00 60.00A0.00 18.00 0 0 0 50.00 24.00Z"' in out["0.25"][1]
    assert 'A18.00 18.00 0 0 0 50.00 60.00A18.00 18.00 0 0 0 50.00 24.00Z' in out["0.5"][1]
    assert re.search(r'A18\.00 18\.00 0 0 0 50\.00 60\.00A0\.00 18\.00 0 0 [01] 50\.00 24\.00Z', out["0.75"][1])      # (a quarter's terminator is a straight line)
    assert out["nomoon"][0].count(">—<") == 1 and ">—<" in out["nomoon"][1] and "Moon" not in out["nomoon"][1]
    assert ">—<" in out["nohs"]


def test_sun_inline_picks_the_next_event_and_the_arc_follows_the_day(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all(now, o) { return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('sun', s, client(), now, o); return [x.html, x.acc]; }); }
// by day: the sun is up, sunset is today, the next sunrise tomorrow
SUN = sun('above_horizon', L(3, 6, 51), L(2, 17, 12));
r.day = all(T0);
r.day_24 = all(T0, { h24: true });
r.morning = all(L(2, 9, 0));
r.dusk = all(L(2, 17, 0));
// after dark: both coming events are tomorrow's; the sunrise is the next
SUN = sun('below_horizon', L(3, 6, 51), L(3, 17, 11));
r.night = all(L(2, 19, 42));
// before dawn: sunrise is today
SUN = sun('below_horizon', L(2, 6, 51), L(2, 17, 12));
r.dawn = all(L(2, 5, 0));
// nothing from the sun
SUN = null;
r.none = all(T0);
SUN = { state: 'above_horizon', attributes: {} }; r.bare = all(T0);
print(JSON.stringify(r));
""", before=FAKES)
    day = out["day"]
    assert "Sunset 5:12 PM" in day[0][0] and day[0][1] == "#ffb340" and 'class="a"' in day[0][0]
    assert ">5:12<" in day[1][0] and ">SUNSET<" in day[1][0] and 'stroke-width="7.5"' in day[1][0] and 'y="72"' in day[1][0]
    # 6:51 to 5:12 is 10 h 21 m; at 1:10 PM, 6 h 19 m of it has passed: 61% (to the nearest 200th)
    frac = round((6 * 60 + 19) / (10 * 60 + 21) * 200) / 200
    ang = math.pi * frac
    dot = f'<circle class="a" cx="{50 - 43 * math.cos(ang):.2f}" cy="{50 - 43 * math.sin(ang):.2f}" r="6.5" fill="currentColor"/>'
    assert dot in day[1][0]
    assert "M7 50A43 43 0 0 1 93 50" in day[1][0] and f"M7 50A43 43 0 0 1 {50 - 43 * math.cos(ang):.2f} {50 - 43 * math.sin(ang):.2f}" in day[1][0]
    assert "DAYLIGHT" in day[2][0] and "10h 21m" in day[2][0] and "Up 6:51 · Down 5:12" in day[2][0]
    assert "Sunset 17:12" in out["day_24"][0][0] and ">17:12<" in out["day_24"][1][0] and "Up 06:51 · Down 17:12" in out["day_24"][2][0]
    # at 9 AM the sun is on the left of the arc, at 5 PM nearly down on the right; neither rests (the faded dot is the night's)
    cx = lambda html: float(re.search(r'<circle class="a" cx="([\d.]+)" cy="[\d.]+" r="6.5" fill="currentColor"/>', html).group(1))
    assert cx(out["morning"][1][0]) < 50 < cx(out["dusk"][1][0]) and cx(out["dusk"][1][0]) > 85
    assert 'opacity=".55"' not in out["morning"][1][0] + out["dusk"][1][0]
    n = out["night"]
    assert "Sunrise 6:51 AM" in n[0][0] and ">6:51<" in n[1][0] and ">SUNRISE<" in n[1][0]
    assert '<circle class="a" cx="93" cy="50" r="6.5" fill="currentColor" opacity=".55"/>' in n[1][0]    # at night it rests at the end
    assert "10h 20m" in n[2][0] and "Up 6:51 · Down 5:11" in n[2][0]
    assert "Sunrise 6:51 AM" in out["dawn"][0][0] and 'opacity=".55"' in out["dawn"][1][0]
    for k in ("none", "bare"):
        assert ">—<" in out[k][0][0] or "—" in out[k][0][0]
        assert ">—<" in out[k][1][0] and "r=\"6.5\"" not in out[k][1][0]
        assert "—" in out[k][2][0]


def test_forecast_watchers_are_shared_and_let_go_of(tmp_path):
    out = run(tmp_path, r"""
var ws = [mk('rain', 'inline'), mk('rain', 'circular'), mk('rain', 'rectangular'), mk('pressure', 'circular'), mk('feels', 'circular'), mk('uv', 'circular'), mk('wind', 'circular'),
          mk('moon', 'inline'), mk('sun', 'inline'), mk('alert', 'inline')];
ws.forEach(function (w) { w.update(client(), T0); w.update(client(), T0); });
var seen = calls.slice();
ws.forEach(function (w) { w.destroy(); });
var none = mk('rain', 'inline'); var before = calls.length; none.update(client(false), T0);
print(JSON.stringify({ seen: seen.sort(), released: released.slice().sort(), after_unwatched: calls.length - before, warns: WARNS }));
""", before=FAKES)
    # one hourly watch for each of the four that ask (three rain shapes, pressure), one daily (feels), none for the rest; all let go of
    assert out["seen"] == ["daily|weather.home"] + ["hourly|weather.home"] * 4
    assert out["released"] == ["daily"] + ["hourly"] * 4
    assert out["after_unwatched"] == 0 and out["warns"] == []


def test_a_missing_house_does_not_throw(tmp_path):
    out = run(tmp_path, r"""
window.hkSettings = undefined; window.hkWxReadings = undefined; window.hkWxForecast = undefined;
var res = [], errors = [];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    try { var w = mk(p, s); w.update({ states: { 'weather.home': { state: 'rainy', attributes: { pressure: 'bad' } }, 'sensor.nws_alerts': { state: 'x', attributes: { Alerts: [null, 3, {}] } } } }, T0); res.push(w.el.innerHTML.length); w.destroy(); }
    catch (e) { errors.push(p + '/' + s + ': ' + e); }
  });
});
print(JSON.stringify({ res: res, errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "setInterval", "requestAnimationFrame", "setTimeout", "Mantel"):
        assert word not in src, word
    # American English, and no wakes from a read
    for word in ("colour", "centre", "grey", "favourite"):
        assert word not in src.lower(), word
    assert "requestUpdate" not in src and "hkStats" not in src
    # the bars' geometry sits on the spacing scale (.8 u gaps, 2.4 u bars, 1.6 u and more from the piece's edge)
    assert "var P = 24, G = 8, H = 36, BASE = 64" in src


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
