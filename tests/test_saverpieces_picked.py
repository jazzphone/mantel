"""The screensaver's picked-entity glance pieces (web/hk/modules/hk-saverpieces-picked.js; docs/phase13/GLANCE-SPEC.md, wave C): alarm,
trash, pollen, appliance, leak, travel and price, every one in each of its shapes, with an empty house, a small one and the library's
samples; the suggested default each piece falls back to (a pure function the editor's picker shares); what each reads and when it
shows (an alarm within a day, trash the day before and the day of, an appliance while it runs and for an hour after, a leak only
while tripped -- unknown is not tripped); the wording; the accents; that an unreadable state is a dash for the always-on pieces and
hides the conditional ones; and the look keeps the plan's rules (nothing animates, nothing blurs, one spacing scale). Run under macOS's
JavaScriptCore with the renderer's own DOM shim (tests/test_saverwidgets_pieces.py)."""
import importlib.util
import json
import math
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-picked.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

# the renderer's tests' DOM shim and file (loaded by path: tests is not a package)
_spec = importlib.util.spec_from_file_location("_saverwidgets_pieces_shim", ROOT / "tests/test_saverwidgets_pieces.py")
_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_base)
SHIM, FILE = _base.SHIM, _base.FILE

# (before the group loads: the clock is ours -- Monday, November 2, 7:42 PM -- and so is the calendar's code)
PRE = r"""
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


def text(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


# the house, as fakes: a small one with every picked piece's entities in it (base() builds it afresh -- a new states object each time)
FAKES = r"""
var T0 = new Date(2026, 10, 2, 19, 42, 0);
function at(m, d, h, mi) { return new Date(2026, m - 1, d, h || 0, mi || 0, 0); }
function isoAt(m, d, h, mi) { return at(m, d, h, mi).toISOString(); }
var ST = {}, ENTS = {}, GET = {};
function ent(id, state, attrs, lc) { ST[id] = { state: state, attributes: attrs || {}, last_changed: lc || isoAt(11, 1, 8, 0) }; }
function base() {
  ST = {}; ENTS = {}; GET = {};
  // the phone: next alarm 6:30 AM tomorrow (and a look-alike that is no timestamp)
  ent('sensor.pixel_next_alarm', isoAt(11, 3, 6, 30), { device_class: 'timestamp', friendly_name: 'Pixel Next Alarm' });
  ent('sensor.a_next_alarm', 'None', { friendly_name: 'Old Next Alarm' });
  // trash: calendars and sensors; a battery with "bin" in a name (robin) and a household of other things
  ent('calendar.family', 'off', { friendly_name: 'Family' });
  ent('calendar.trash_pickup', 'off', { friendly_name: 'Trash Pickup' });
  ent('sensor.next_bin_day', '2026-11-03', { friendly_name: 'Next Bin Day' });
  ent('sensor.robin_battery', '88', { device_class: 'battery', friendly_name: 'Robin Battery' });
  // pollen
  ent('sensor.grass_pollen', 'Low', { friendly_name: 'Grass Pollen' });
  ent('sensor.pollen_overall_index', '4', { friendly_name: 'Pollen Overall Index' });
  // appliances: a washer's two sensors, a dryer's, a dishwasher's, and something else that has "remaining" in it
  ent('sensor.washer_remaining_program_time', '24', { device_class: 'duration', unit_of_measurement: 'min', friendly_name: 'Washer Remaining Program Time' });
  ent('sensor.washer_program_finish_time', isoAt(11, 2, 20, 6), { device_class: 'timestamp', friendly_name: 'Washer Program Finish Time' });
  ent('sensor.dryer_completion_time', isoAt(11, 2, 19, 30), { device_class: 'timestamp', friendly_name: 'Dryer Completion Time' });
  ent('sensor.dishwasher_remaining_time', '0', { device_class: 'duration', unit_of_measurement: 'min', friendly_name: 'Dishwasher Remaining Time' });
  ent('sensor.printer_ink_remaining', '40', { unit_of_measurement: '%', friendly_name: 'Printer Ink Remaining' });
  // leaks and smoke
  ent('binary_sensor.laundry_leak_sensor', 'off', { device_class: 'moisture', friendly_name: 'Laundry Leak Sensor' });
  ent('binary_sensor.kitchen_leak_sensor', 'unknown', { device_class: 'moisture', friendly_name: 'Kitchen Leak Sensor' });
  ent('binary_sensor.hall_smoke_detector', 'off', { device_class: 'smoke', friendly_name: 'Hall Smoke Detector' });
  ent('binary_sensor.garage_co_detector', 'off', { device_class: 'carbon_monoxide', friendly_name: 'Garage CO Detector' });
  ent('binary_sensor.front_door', 'off', { device_class: 'door', friendly_name: 'Front Door' });
  GET = { kinds: { leaks: ['binary_sensor.laundry_leak_sensor', 'binary_sensor.kitchen_leak_sensor'], smoke: ['binary_sensor.hall_smoke_detector', 'binary_sensor.garage_co_detector'] } };
  // travel (Google's: durations as words; Waze's: minutes)
  ent('sensor.work_travel_time', '24', { unit_of_measurement: 'min', device_class: 'duration', friendly_name: 'Work Travel Time', duration: '22 mins',
        duration_in_traffic: '24 mins', origin: 'Home', destination: 'Office', distance: '9 mi' });
  ent('sensor.school_travel_time', '11', { unit_of_measurement: 'min', friendly_name: 'School Travel Time', duration: 11, origin: 'Home', destination: 'School' });
  // price
  ent('sensor.electricity_price', '0.31', { unit_of_measurement: 'USD/kWh', friendly_name: 'Electricity Price', tier: 'peak', next_change: isoAt(11, 2, 21, 0), device_class: 'monetary' });
  ent('sensor.gas_rate', '1.2', { unit_of_measurement: 'm³', friendly_name: 'Gas Rate' });
}
base();
// (Settings' get walks dotted paths: 'kinds.leaks' is the leaks of 'kinds')
window.hkSettings = { get: function (k, d) {
  if (GET[k] !== undefined) return GET[k];
  var v = GET;
  k.split('.').forEach(function (p) { v = v && typeof v === 'object' ? v[p] : undefined; });
  return v !== undefined ? v : (d === undefined ? null : d);
} };
function text(h) { return String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function client() { return { states: ST, entities: ENTS, config: { unit_system: { temperature: '°F' }, currency: 'USD' } }; }
function mk(piece, shape, o) { return W.create(piece, shape, { u: 4, back: 'none', opts: (o && o.opts) || {}, h24: !!(o && o.h24), color: 'auto' }); }
function show(piece, shape, o, now) {
  var w = mk(piece, shape, o); w.update(client(), now || T0);
  var r = { showing: w.showing, html: w.el.innerHTML, acc: w.el.style.props['--sw-acc'], accd: w.el.style.props['--sw-acc-d'], blank: w.blank };
  w.destroy(); return r;
}
function html(piece, shape, o, now) { return show(piece, shape, o, now).html; }
var P = W._.picked;
var CATALOG = { alarm: ['circular', 'inline'], trash: ['circular', 'inline'], pollen: ['circular', 'inline'], appliance: ['circular', 'inline', 'rectangular'],
                leak: ['card', 'inline'], travel: ['circular', 'inline', 'rectangular'], price: ['inline'] };
"""

GREEN, AMBER, RED, YELLOW, ORANGE = "#5fd38a", "#ffb340", "#ff6b5e", "#ffd166", "#ffa24d"
INDIGO, TEAL, BLUE = "#9aa8ff", "#6fd6cf", "#7cc8ff"


def arc(frac, gauge=False):
    return f"{2 * math.pi * 43 * (0.75 if gauge else 1) * frac:.2f}"


def test_the_declarations_are_complete(tmp_path):
    out = run(tmp_path, r"""
var P_ = {};
Object.keys(CATALOG).forEach(function (k) {
  var d = W.PIECES[k];
  P_[k] = d ? { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
                defaults: d.defaults, accent: typeof d.accent, shapes: Object.keys(d.shapes).sort() } : null;
});
var n = Object.keys(W.PIECES).length, css = W.CSS.length;
load(GROUPFILE);
print(JSON.stringify({ P: P_, core: !!W.PIECES.weather, same: Object.keys(W.PIECES).length === n && W.CSS.length === css, picked: typeof W._.picked.suggest.alarm,
                       css: W.CSS.indexOf('.pk-rows') >= 0 }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    P = out["P"]
    shapes = {"alarm": ["circular", "inline"], "trash": ["circular", "inline"], "pollen": ["circular", "inline"], "appliance": ["circular", "inline", "rectangular"],
              "leak": ["card", "inline"], "travel": ["circular", "inline", "rectangular"], "price": ["inline"]}
    groups = {"alarm": "Time and Calendar", "trash": "Time and Calendar", "pollen": "Weather and Sky", "appliance": "Home", "leak": "Home",
              "travel": "People and Travel", "price": "Energy"}
    ent1 = {"entity": "entity:sensor"}
    opts = {"alarm": ent1, "trash": {"entity": "entity:calendar,sensor"}, "pollen": ent1, "leak": {},
            "appliance": {"entity": "entity:sensor,binary_sensor", "entity2": "entity:sensor,binary_sensor"},
            "travel": {"entity": "entity:sensor", "entity2": "entity:sensor"}, "price": {"entity": "entity:sensor,input_number,number"}}
    for k, want in shapes.items():
        assert P[k] is not None, k
        assert P[k]["shapes"] == want, k
        assert P[k]["group"] == groups[k] and P[k]["wave"] == "C" and P[k]["name"] and P[k]["wakes"] and P[k]["source"], k
        assert P[k]["facts"] == [k] and P[k]["off"] is False, k
        assert P[k]["accent"] in ("object", "function"), k
        assert P[k]["opts"] == opts[k], k                                  # the same picks the layout's catalog declares
        assert all(P[k]["defaults"][o] == "" for o in opts[k]), k          # '' is "the suggested default"
        assert (P[k]["pick"] is None) == (k == "leak"), k                  # what it needs picked (a leak picks nothing)
    # the "shows when" pieces say when; the always-on ones do not
    assert all(P[k]["when"] for k in ("alarm", "trash", "appliance", "leak"))
    assert all(P[k]["when"] is None for k in ("pollen", "travel", "price"))
    assert "calendar" in P["trash"]["wakes"]                               # (the calendar's answer draws it)
    assert out["core"] and out["same"] and out["picked"] == "function" and out["css"]      # loaded twice: nothing is added again


def test_every_piece_and_shape_draws_with_an_empty_house_a_sample_one_and_every_sample(tmp_path):
    out = run(tmp_path, r"""
ST['sensor.washer_remaining_program_time'].state = '24';
// a house in which everything conditional is true: the trash is out tomorrow (a date sensor, the only trash thing), the dryer is done, a leak is on
delete ST['calendar.trash_pickup'];
GET.kinds.leaks.push('binary_sensor.basement_leak');
ent('binary_sensor.basement_leak', 'on', { device_class: 'moisture', friendly_name: 'Basement Water Sensor' }, isoAt(11, 2, 19, 30));
var EMPTY = { states: {}, config: {} };
var results = [], errors = [];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [['empty', EMPTY], ['house', client()]].forEach(function (h, hi) {
      ['none', 'glass', 'tint'].forEach(function (back, bi) {
        try {
          var w = W.create(p, s, { u: 4, back: back, color: bi === 2 ? 'accent' : 'auto', h24: hi === 1, opts: {} });
          if (!w) { errors.push('no create ' + p + '/' + s); return; }
          var drew = w.update(h[1], T0), again = w.update(h[1], T0), m = w.measure();
          results.push({ p: p, s: s, h: h[0], drew: drew, again: again, html: w.el.innerHTML, showing: w.showing, blank: w.blank, live: w.live, w: m.w, hh: m.h, cls: w.el.className });
          w.setU(5);
          w.destroy();
        } catch (e) { errors.push(p + '/' + s + ': ' + e + ' ' + (e && e.stack)); }
      });
    });
    try {
      var el = W.sample(p, s, { u: 4, back: 'glass' });
      results.push({ p: p, s: s, h: 'sample', html: el.innerHTML, acc: el.style.props['--sw-acc'], accd: el.style.props['--sw-acc-d'], cls: el.className });
    } catch (e) { errors.push('sample ' + p + '/' + s + ': ' + e); }
  });
});
print(JSON.stringify({ results: results, errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == (2 + 2 + 2 + 3 + 2 + 3 + 1) * 7
    always = ("pollen", "travel", "price")
    for r in out["results"]:
        key = (r["p"], r["s"], r["h"])
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"], key
        if r["h"] != "sample":
            assert r["again"] is False, key                                  # drawn again only when the spec changes
            assert r["live"] is False and r["w"] >= 0 and r["hh"] > 0, key
        if r["h"] == "empty":
            # an empty house: the always-on pieces draw dashes (an inline one is blank, which the screensaver leaves out), the others hide
            assert r["showing"] is (r["p"] in always), key
            if r["p"] in always and r["s"] == "inline":
                assert r["blank"] is True, key
        if r["h"] == "house":
            # the small house: an alarm 11 hours off, the date sensor says tomorrow, a dryer done, a leak on, everything else readable
            assert r["showing"] is True, key
            assert r["blank"] is not True, key
        if r["h"] == "sample" or r["showing"]:
            assert len(r["html"]) > 0, key
            assert "NaN" not in r["html"] and "undefined" not in r["html"] and "null" not in r["html"], key
            assert "Mantel" not in r["html"], key
        else:
            assert r["html"] == "", key                                      # not showing: nothing drawn
        if r["h"] == "sample":
            assert r["acc"] and r["accd"], key                               # every piece carries an accent (light ink and black ink)
    # every circle is the renderer's: the track 7.5 wide, radius 43, the label on the baseline 72
    for r in out["results"]:
        if r["s"] == "circular" and r["h"] in ("sample", "house") and r["html"]:
            assert 'stroke-width="7.5"' in r["html"] and 'y="72"' in r["html"] and 'viewBox="0 0 100 100"' in r["html"], (r["p"], r["h"])
            assert 'r="43"' in r["html"], (r["p"], r["h"])


def test_each_suggestion_picks_the_right_default_from_a_mixed_house(tmp_path):
    out = run(tmp_path, r"""
var S = P.suggest, r = {};
Object.keys(S).forEach(function (k) { r[k] = [S[k](ST), S[k](ST, 'entity2'), S[k].all(ST)]; });
// pure: the states in, an id out; nothing in them changes; nothing at all gives ''
r.nothing = Object.keys(S).map(function (k) { return [S[k]({}), S[k](), S[k](null), S[k].all(undefined).length]; });
// a house with things in the way
base();
ent('sensor.a_next_alarm', isoAt(11, 3, 5, 0), { friendly_name: 'No Class Next Alarm' });                // no device class: after the timestamp one
ent('sensor.next_alarm_battery', '50', { device_class: 'battery' });
r.alarm2 = S.alarm(ST);
// the plan's price entity comes first, a sensor named for it with a currency next; a rate without a currency is no price
base();
GET.energy = { total: { price: 'input_number.grid_price' } };
ent('input_number.grid_price', '0.12', { unit_of_measurement: '$/kWh' });
r.price_plan = S.price.all(ST);
GET.energy = { total: { price: 'input_number.gone' } };
r.price_plan_missing = S.price.all(ST);
GET.energy = { total: { price: 0.2 } };
r.price_plan_number = S.price.all(ST);
// a trash calendar beats a trash sensor; a battery with "bin" in "robin" is neither
base(); delete ST['calendar.trash_pickup']; r.trash_no_cal = S.trash.all(ST);
base(); ent('calendar.waste_collection', 'off', {}); ent('sensor.recycling_day', 'x', { friendly_name: 'Recycling' }); r.trash_more = S.trash.all(ST);
// waze: attributes (a duration with an origin) or a name; the strong match first
base(); ent('sensor.aaa_commute', '30', { unit_of_measurement: 'min' }); r.travel2 = S.travel.all(ST);
// the sensor that is named for it but is not a time/price... are left out
print(JSON.stringify(r));
""", before=FAKES)
    assert out["alarm"][0] == "sensor.pixel_next_alarm" and out["alarm"][2] == ["sensor.pixel_next_alarm", "sensor.a_next_alarm"]
    assert out["alarm2"] == "sensor.pixel_next_alarm"
    # the first calendar, then the sensors; the robin's battery is no bin
    assert out["trash"][2] == ["calendar.trash_pickup", "sensor.next_bin_day"] and out["trash"][0] == "calendar.trash_pickup" and out["trash"][1] == "sensor.next_bin_day"
    assert out["trash_no_cal"] == ["sensor.next_bin_day"]
    assert out["trash_more"] == ["calendar.trash_pickup", "calendar.waste_collection", "sensor.next_bin_day", "sensor.recycling_day"]
    # an overall or index sensor first
    assert out["pollen"][2] == ["sensor.pollen_overall_index", "sensor.grass_pollen"] and out["pollen"][0] == "sensor.pollen_overall_index"
    # one sensor per machine: the washer's first (the dryer's, the dishwasher's), not the washer's two
    assert out["appliance"][2] == ["sensor.dishwasher_remaining_time", "sensor.dryer_completion_time", "sensor.washer_program_finish_time"] or \
        len(out["appliance"][2]) == 3
    machines = [re.sub(r"sensor\.|_.*", "", x) for x in out["appliance"][2]]
    assert sorted(machines) == ["dishwasher", "dryer", "washer"]
    assert "sensor.printer_ink_remaining" not in out["appliance"][2]         # (not a timestamp or a duration)
    assert out["appliance"][0] == out["appliance"][2][0] and out["appliance"][1] == out["appliance"][2][1]
    assert out["travel"][2] == ["sensor.school_travel_time", "sensor.work_travel_time"] and out["travel"][1] == "sensor.work_travel_time"
    assert out["travel2"] == ["sensor.school_travel_time", "sensor.work_travel_time", "sensor.aaa_commute"]
    assert out["price"][2] == ["sensor.electricity_price"]                   # (the gas rate has no currency)
    assert out["price"][1] == ""                                             # (there is no second)
    assert out["price_plan"] == ["input_number.grid_price", "sensor.electricity_price"]
    assert out["price_plan_missing"] == ["sensor.electricity_price"] == out["price_plan_number"]
    assert out["pollen"][1] == "sensor.grass_pollen"
    for row in out["nothing"]:
        assert row == ["", "", "", 0]


def test_a_pick_wins_over_the_suggestion_and_the_second_one_is_never_the_first(tmp_path):
    out = run(tmp_path, r"""
var r = {};
// alarm: picking another sensor reads that one
ent('sensor.tablet_next_alarm', isoAt(11, 2, 22, 0), { device_class: 'timestamp' });
r.alarm_default = html('alarm', 'inline'); r.alarm_pick = html('alarm', 'inline', { opts: { entity: 'sensor.tablet_next_alarm' } });
r.alarm_bad = html('alarm', 'inline', { opts: { entity: 'light.kitchen' } });              // (not a sensor: the renderer's optsOf says '' -> the default)
r.alarm_gone = show('alarm', 'inline', { opts: { entity: 'sensor.no_such_alarm' } });       // a pick that is not in the house: nothing to show
// appliances: two machines by default (the dishwasher out of the house, it sits at 0); one picked and the other suggested; both picked; the same one twice is one
delete ST['sensor.dishwasher_remaining_time'];
r.two = html('appliance', 'rectangular');
r.pick1 = html('appliance', 'rectangular', { opts: { entity: 'sensor.dryer_completion_time' } });
r.pick2 = html('appliance', 'rectangular', { opts: { entity: 'sensor.dryer_completion_time', entity2: 'sensor.washer_remaining_program_time' } });
r.same = html('appliance', 'rectangular', { opts: { entity: 'sensor.washer_remaining_program_time', entity2: 'sensor.washer_remaining_program_time' } });
print(JSON.stringify(r));
""", before=FAKES)
    assert "Alarm 6:30 AM" in text(out["alarm_default"]) and "Alarm 10:00 PM" in text(out["alarm_pick"]) and "Alarm 6:30 AM" in text(out["alarm_bad"])
    assert out["alarm_gone"]["showing"] is False and out["alarm_gone"]["html"] == ""
    # (the dishwasher sits at 0 and was never seen running: not shown)
    assert text(out["two"]).count("Washer") == 1 and "Dryer" in text(out["two"]) and "Dishwasher" not in text(out["two"])
    assert "pk-rows" in out["two"]
    assert "Dryer" in text(out["pick1"]) and "Washer" in text(out["pick1"])
    assert re.findall(r'<div class="pk-n">([^<]*)</div><div class="pk-v">([^<]*)</div>', out["pick2"]) == [("Washer", "24 min left"), ("Dryer", "Done")]      # (at work first)
    assert "pk-rows" not in out["same"] and 'class="l1">Washer' in out["same"]               # one machine: the three lines


def test_phone_alarm_shows_within_a_day(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(o, now) { return ['inline', 'circular'].map(function (s) { var x = show('alarm', s, o, now); return [x.showing, x.html, x.acc, x.accd]; }); }
r.set = both();                                                             // 6:30 AM, 10 h 48 min ahead
r.set24 = both({ h24: true });
ST['sensor.pixel_next_alarm'].state = isoAt(11, 2, 19, 42 + 1);              // a minute ahead
r.soon = both();
ST['sensor.pixel_next_alarm'].state = isoAt(11, 3, 19, 42);                  // exactly 24 hours
r.day = both();
ST['sensor.pixel_next_alarm'].state = isoAt(11, 3, 19, 43);                  // a minute more than a day
r.over = both();
ST['sensor.pixel_next_alarm'].state = isoAt(11, 2, 19, 10);                  // gone off a half hour ago
r.past = both();
ST['sensor.pixel_next_alarm'].state = isoAt(11, 3, 7, 0);
r.ten_oh_five = both();
ST['sensor.pixel_next_alarm'].state = isoAt(11, 3, 10, 5);
r.later = both();
['unavailable', 'unknown', 'None', '', '5', 'tomorrow', '2026-11-03'].forEach(function (v) { ST['sensor.pixel_next_alarm'].state = v; r['bad_' + v] = both(); });
print(JSON.stringify(r));
""", before=FAKES)
    s = out["set"]
    assert all(x[0] for x in s)
    assert text(s[0][1]) == "Alarm 6:30 AM" and "<svg" in s[0][1] and 'class="a"' in s[0][1] and "M10 20.7a2 2 0 0 0 4 0" in s[0][1]      # the bell
    assert text(s[1][1]) == "6:30 ALARM" and 'y="72"' in s[1][1]
    assert s[0][2] == s[1][2] == INDIGO and s[0][3] == "#4452b8"
    assert text(out["set24"][0][1]) == "Alarm 06:30" and text(out["set24"][1][1]) == "06:30 ALARM"
    # the ring fills as it nears: 10.8 hours of the 24 gone... 13.2 left -> .45 full (10:48 ahead = 1 - 10.8/24)
    assert arc(round((1 - 10.8 / 24) * 200) / 200) in s[1][1]
    assert all(x[0] for x in out["soon"]) and text(out["soon"][0][1]) == "Alarm 7:43 PM" and arc(round((1 - 1 / 1440) * 200) / 200) in out["soon"][1][1]
    assert all(x[0] for x in out["day"]) and text(out["day"][0][1]) == "Alarm 7:42 PM"
    for k in ("over", "past", "bad_unavailable", "bad_unknown", "bad_None", "bad_", "bad_5", "bad_tomorrow", "bad_2026-11-03"):
        assert all(x[:2] == [False, ""] for x in out[k]), k
    assert text(out["ten_oh_five"][0][1]) == "Alarm 7:00 AM" and text(out["later"][0][1]) == "Alarm 10:05 AM"      # (the minutes always, 7:00 and not 7)
    assert text(out["later"][1][1]) == "10:05 ALARM"


def test_trash_day_with_a_calendar(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var EVS = [];
var LOADS = [];
window.hkCalendar = { ids: function () { return ['calendar.family', 'calendar.trash_pickup']; },
  load: function (client, ids, from, to) { LOADS.push({ ids: ids, from: +from, to: +to });
    return Promise.resolve({ evs: EVS.filter(function (e) { return ids.indexOf(e.cal) >= 0; }), failed: 0 }); } };
function allDay(title, m, d, cal) { return { cal: cal || 'calendar.trash_pickup', title: title, allDay: true, start: at(m, d), end: at(m, d + 1) }; }
function timed(title, m, d, h1, h2, cal) { return { cal: cal || 'calendar.trash_pickup', title: title, start: at(m, d, h1), end: at(m, d, h2) }; }
function view(o, now) {
  var out = {};
  ['inline', 'circular'].forEach(function (s) {
    var w = mk('trash', s, o); w.update(client(), now || T0); drainMicrotasks(); drainMicrotasks();
    out[s] = [w.showing, w.el.innerHTML, w.el.style.props['--sw-acc']]; w.destroy();
  });
  return out;
}
// (the renderer's own shared read is forgotten too: it keeps the last events for five minutes)
function fresh(evs, o, now) { EVS = evs; P.TR.by = {}; W._.cal.evs = null; W._.cal.at = 0; W._.cal.busy = 0; LOADS.length = 0; return view(o, now); }
// tomorrow, today (an all-day one, and a timed one still to come), neither, and one that is over
r.tomorrow = fresh([allDay('Trash Pickup', 11, 3)]);
r.today = fresh([allDay('Trash Pickup', 11, 2)]);
r.today_timed = fresh([timed('Garbage truck', 11, 2, 21, 22)]);
r.today_over = fresh([timed('Garbage truck', 11, 2, 6, 7)]);
r.neither = fresh([allDay('Trash Pickup', 11, 4)]);
r.yesterday = fresh([allDay('Trash Pickup', 11, 1)]);
// recycling says so; the nearer one wins (today before tomorrow)
r.recycling = fresh([allDay('Recycling Pickup', 11, 3)]);
r.both = fresh([allDay('Trash', 11, 3), allDay('Recycling', 11, 2)]);
// a dedicated trash calendar counts every event of it; another calendar's events count only with the words; other calendars' trash is not this one's
r.dedicated = fresh([allDay('Pickup', 11, 3)]);
r.other_words = fresh([allDay('Take out the trash', 11, 3, 'calendar.family')], { opts: { entity: 'calendar.family' } });
r.other_nowords = fresh([allDay('Dentist', 11, 3, 'calendar.family')], { opts: { entity: 'calendar.family' } });
r.not_mine = fresh([allDay('Trash Pickup', 11, 3, 'calendar.family')]);
// the words: bin(s) as a word, garbage, waste
['Green bins out', 'Garbage day', 'Waste collection', 'Binge watching', 'Robin visits'].forEach(function (t, i) { r['w' + i] = fresh([allDay(t, 11, 3, 'calendar.family')], { opts: { entity: 'calendar.family' } }).inline; });
print(JSON.stringify(r));
""", before=FAKES)
    for k, word, tmrw in (("tomorrow", "Trash tomorrow", True), ("today", "Trash today", False), ("today_timed", "Trash today", False),
                          ("recycling", "Recycling tomorrow", True), ("dedicated", "Trash tomorrow", True), ("other_words", "Trash tomorrow", True)):
        i, c = out[k]["inline"], out[k]["circular"]
        assert i[0] and c[0], k
        assert text(i[1]) == word, k
        assert text(c[1]) == ("TMRW" if tmrw else "TODAY"), k
        assert i[2] == c[2] == GREEN, k
        assert "M9 7V4.5h6V7" in i[1] and "M9 7V4.5h6V7" in c[1] and "<g " in c[1] and 'y="72"' in c[1], k            # the bin, over the label
    for k in ("today_over", "neither", "yesterday", "other_nowords", "not_mine"):
        assert out[k]["inline"][:2] == [False, ""] and out[k]["circular"][:2] == [False, ""], k
    assert text(out["both"]["inline"][1]) == "Recycling today"
    for i, shows in enumerate((True, True, True, False, False)):
        assert (out[f"w{i}"][0] is True) == shows, i


def test_trash_calendar_is_read_once_hourly_and_shared(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var EVS = [{ cal: 'calendar.trash_pickup', title: 'Trash Pickup', allDay: true, start: at(11, 3), end: at(11, 4) }];
var LOADS = [], FAIL = false, asked = [];
window.hkCalendar = { ids: function () { return ['calendar.family', 'calendar.trash_pickup']; },
  load: function (client, ids, from, to) { LOADS.push({ ids: ids, from: +from, to: +to });
    return FAIL ? Promise.reject(new Error('no calendar')) : Promise.resolve({ evs: EVS, failed: 0 }); } };
// (the renderer's shared read asks for every calendar for two days; this group's own is one calendar for three)
function own() { return LOADS.filter(function (l) { return l.ids.length === 1 && l.ids[0] === 'calendar.trash_pickup'; }); }
var a = mk('trash', 'inline'), b = mk('trash', 'circular');
a.update(client(), T0); b.update(client(), T0);
r.before = [a.showing, b.showing];                                           // (nothing yet: the read is in flight)
r.loads_before = LOADS.map(function (l) { return [l.ids, (l.to - l.from) / 86400000, new Date(l.from).getHours()]; });
r.shared_before = LOADS.filter(function (l) { return l.ids.length === 2; }).length;
// (a read never wakes a read: the pieces were not drawn again from inside it)
drainMicrotasks();                                                           // the read lands, THEN the shared watchers draw the pieces
r.after = [a.showing, b.showing, a.el.innerHTML.indexOf('Trash tomorrow') >= 0, b.el.innerHTML.indexOf('TMRW') >= 0];
r.loads_after = own().length;
// kept an hour
a.update(client(), T0); b.update(client(), T0); r.again = own().length;
CLOCK += 3599000; a.update(client(), T0); r.t59 = own().length;
CLOCK += 2000; a.update(client(), T0); r.t60 = own().length; drainMicrotasks();
// a failed read is asked again after five minutes, not at once
FAIL = true; CLOCK += 3700000; a.update(client(), T0); drainMicrotasks(); r.failing = own().length;
a.update(client(), T0); r.fail_soon = own().length;
CLOCK += 200000; a.update(client(), T0); r.fail_200 = own().length;
CLOCK += 120000; FAIL = false; a.update(client(), T0); r.retried = own().length; drainMicrotasks();
r.shows = a.showing;
// a picked sensor reads no calendar; a different calendar is a read of its own
var n = LOADS.length, s = mk('trash', 'inline', { opts: { entity: 'sensor.next_bin_day' } }); s.update(client(), T0); r.sensor_loads = LOADS.length - n;
r.shared_before_ok = r.shared_before <= 1;
var o = mk('trash', 'inline', { opts: { entity: 'calendar.family' } }); o.update(client(), T0); r.other_ids = LOADS[LOADS.length - 1].ids;
a.destroy(); b.destroy(); s.destroy(); o.destroy();
r.watchers = W._.cal.watchers.length;
print(JSON.stringify(r));
""", before=FAKES)
    assert out["before"] == [False, False]
    own = [x for x in out["loads_before"] if x[0] == ["calendar.trash_pickup"]]
    assert own == [[["calendar.trash_pickup"], 3, 0]]                       # one read for both pieces: the picked calendar, three days from midnight
    assert out["after"] == [True, True, True, True]
    assert out["loads_after"] == 1 and out["again"] == 1 and out["t59"] == 1 and out["t60"] == 2        # kept an hour, then asked again
    assert out["failing"] == 3 and out["fail_soon"] == 3 and out["fail_200"] == 3 and out["retried"] == 4          # (a failed read: five minutes, not at once)
    assert out["shows"] is True
    assert out["sensor_loads"] == 0 and out["other_ids"] == ["calendar.family"] and out["shared_before_ok"]
    assert out["watchers"] == 0


def test_trash_day_asks_for_the_calendar_code_and_does_not_read_when_it_is_missing(tmp_path):
    out = run(tmp_path, r"""
var r = {}, asked = [];
window.hkNeed = { file: function (f) { asked.push(f); return Promise.resolve(); } };
var a = mk('trash', 'inline'), b = mk('trash', 'circular');
a.update(client(), T0); b.update(client(), T0); a.update(client(), T0);
drainMicrotasks();
r.asked = asked.length; r.showing = [a.showing, b.showing];
// the code arrives (Mantel loads its card files on first use): the next update reads, and the answer draws the pieces
window.hkCalendar = { ids: function () { return ['calendar.trash_pickup']; }, load: function () { return Promise.resolve({ evs: [{ cal: 'calendar.trash_pickup', title: 'Trash', allDay: true, start: at(11, 2), end: at(11, 3) }] }); } };
a.update(client(), T0, { events: [] }); drainMicrotasks();
r.after = [a.showing, a.el.innerHTML.indexOf('Trash today') >= 0];
a.destroy(); b.destroy();
print(JSON.stringify(r));
""", before=FAKES)
    assert out["asked"] >= 1 and out["showing"] == [False, False] and out["after"] == [True, True]


def test_trash_day_with_a_sensor(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(state, name, attrs, lc) {
  base(); ent('sensor.next_bin_day', state, Object.assign({ friendly_name: name || 'Next Bin Day' }, attrs || {}));
  var o = { opts: { entity: 'sensor.next_bin_day' } };
  return ['inline', 'circular'].map(function (s) { var x = show('trash', s, o); return [x.showing, x.html]; });
}
r.date_tomorrow = both('2026-11-03'); r.date_today = both('2026-11-02'); r.date_later = both('2026-11-09'); r.date_past = both('2026-11-01');
r.ts_tomorrow = both(isoAt(11, 3, 7, 0)); r.ts_today = both(isoAt(11, 2, 23, 0)); r.ts_later = both(isoAt(11, 5, 7, 0));
r.num0 = both('0'); r.num1 = both('1'); r.num2 = both('2'); r.num_neg = both('-1');
r.w_today = both('Today'); r.w_tomorrow = both('Tomorrow'); r.w_in2 = both('in 2 days'); r.w_in1 = both('Recycling in 1 day');
r.attr = both('soon', 'Next Bin Day', { days: 1 });
r.recycling_name = both('2026-11-03', 'Recycling Day'); r.recycling_attr = both('2026-11-03', 'Next Bin Day', { type: 'Recycling' }); r.recycling_state = both('Recycling tomorrow', 'Pickup');
['unavailable', 'unknown', '', 'garbage in', 'soon'].forEach(function (v) { r['bad_' + v] = both(v); });
// the picked sensor is not in the house
base(); r.gone = show('trash', 'inline', { opts: { entity: 'sensor.nothing' } });
// with nothing picked, the suggestion: the calendar (nothing to read in this house: nothing shows) -- without calendars, the sensor
base(); r.default_with_calendar = show('trash', 'inline');
base(); delete ST['calendar.trash_pickup']; r.default_sensor = show('trash', 'inline');
print(JSON.stringify(r));
""", before=FAKES)
    for k, word, tmrw in (("date_tomorrow", "Trash tomorrow", 1), ("date_today", "Trash today", 0), ("ts_tomorrow", "Trash tomorrow", 1), ("ts_today", "Trash today", 0),
                          ("num0", "Trash today", 0), ("num1", "Trash tomorrow", 1), ("w_today", "Trash today", 0), ("w_tomorrow", "Trash tomorrow", 1),
                          ("w_in1", "Recycling tomorrow", 1), ("attr", "Trash tomorrow", 1), ("recycling_name", "Recycling tomorrow", 1),
                          ("recycling_attr", "Recycling tomorrow", 1), ("recycling_state", "Recycling tomorrow", 1)):
        assert out[k][0][0] and out[k][1][0], k
        assert text(out[k][0][1]) == word, k
        assert text(out[k][1][1]) == ("TMRW" if tmrw else "TODAY"), k
    for k in ("date_later", "date_past", "ts_later", "num2", "num_neg", "w_in2", "bad_unavailable", "bad_unknown", "bad_", "bad_garbage in", "bad_soon"):
        assert out[k][0] == [False, ""] and out[k][1] == [False, ""], k
    assert out["gone"]["showing"] is False
    assert out["default_with_calendar"]["showing"] is False                          # (the calendar is the default and has no events)
    assert out["default_sensor"]["showing"] is True and "Trash tomorrow" in text(out["default_sensor"]["html"])


def test_pollen_levels(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(state, attrs, id) {
  base(); ent('sensor.grass_pollen', state, Object.assign({ friendly_name: 'Grass Pollen' }, attrs || {}));
  var o = { opts: { entity: 'sensor.grass_pollen' } };
  return ['inline', 'circular'].map(function (s) { var x = show('pollen', s, o); return [x.showing, x.html, x.acc, x.accd]; });
}
['None', 'Low', 'Very Low', 'Moderate', 'Medium', 'High', 'Very High', 'very_high', 'Extreme', 'low'].forEach(function (v) { r['w_' + v] = both(v); });
// a category/risk attribute outranks a number
r.attr_cat = both('3', { category: 'High' }); r.attr_risk = both('12', { risk: 'Moderate' }); r.attr_none = both('0', { category: 'None' });
// an index of 0 to 5 (Google, Tomorrow.io) and 0 to 12 (Pollen.com)
['0', '1', '2', '3', '4', '5'].forEach(function (v) { r['i_' + v] = both(v); });
['5.5', '7.2', '8', '9.6', '11.2', '12'].forEach(function (v) { r['x_' + v] = both(v); });
// counts per cubic meter
[['0', 0], ['12', 1], ['45', 2], ['150', 3], ['600', 4]].forEach(function (p) { r['c_' + p[0]] = both(p[0], { unit_of_measurement: 'grains/m³' }); });
['unavailable', 'unknown', '', 'n/a'].forEach(function (v) { r['bad_' + v] = both(v); });
// nothing picked: the suggestion (the overall index here, 4: High); no pollen sensor in the house: a dash
base(); r.default_ = [show('pollen', 'inline'), show('pollen', 'circular')];
base(); delete ST['sensor.grass_pollen']; delete ST['sensor.pollen_overall_index']; r.absent = [show('pollen', 'inline'), show('pollen', 'circular')];
print(JSON.stringify(r));
""", before=FAKES)
    L = ["None", "Low", "Moderate", "High", "Very High"]
    SH = ["None", "Low", "Mod", "High", "V High"]
    ACCS = [GREEN, GREEN, YELLOW, ORANGE, RED]

    def check(row, lvl, key):
        inline, circ = row
        assert inline[0] and circ[0], key
        assert text(inline[1]) == f"Pollen {L[lvl]}", key
        assert text(circ[1]) == f"{SH[lvl]} POLLEN", key
        assert inline[2] == circ[2] == ACCS[lvl], key
        assert "M5 19C5 10 10 5 19 5" in inline[1] and 'class="a"' in inline[1], key                  # the leaf
        assert ('stroke-dasharray="' + arc(lvl / 4, True) + " ") in circ[1] if lvl else True, key      # a gauge a quarter a step; None the track alone
        if not lvl:
            assert circ[1].count("<circle") == 1, key
    for v, lvl in (("None", 0), ("Low", 1), ("Very Low", 1), ("Moderate", 2), ("Medium", 2), ("High", 3), ("Very High", 4), ("very_high", 4), ("Extreme", 4), ("low", 1)):
        check(out["w_" + v], lvl, v)
    check(out["attr_cat"], 3, "cat"); check(out["attr_risk"], 2, "risk"); check(out["attr_none"], 0, "none")
    for v, lvl in (("0", 0), ("1", 1), ("2", 1), ("3", 2), ("4", 3), ("5", 4)):
        check(out["i_" + v], lvl, "i" + v)
    for v, lvl in (("5.5", 2), ("7.2", 2), ("8", 3), ("9.6", 3), ("11.2", 4), ("12", 4)):
        check(out["x_" + v], lvl, "x" + v)
    for v, lvl in (("0", 0), ("12", 1), ("45", 2), ("150", 3), ("600", 4)):
        check(out["c_" + v], lvl, "c" + v)
    for k in ("bad_unavailable", "bad_unknown", "bad_", "bad_n/a"):
        i, c = out[k]
        assert i[0] and c[0] and text(i[1]) == "—" and text(c[1]) == "— POLLEN" and i[2] is None, k          # a dash, not "None"
    assert "Pollen High" in text(out["default_"][0]["html"])
    assert text(out["absent"][0]["html"]) == "—" and out["absent"][0]["blank"] is True and text(out["absent"][1]["html"]) == "— POLLEN"


def test_appliances_running_done_and_an_hour_after(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all(o, now) { return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('appliance', s, o, now); return [x.showing, x.html, x.acc]; }); }
var W_ = { opts: { entity: 'sensor.washer_program_finish_time' } }, D_ = { opts: { entity: 'sensor.dryer_completion_time' } }, R_ = { opts: { entity: 'sensor.washer_remaining_program_time' } };
// a completion time ahead: running (24 min left at 7:42 and a finish at 8:06); the same behind us: done
r.run = all(W_);
r.run_late = all(W_, new Date(+T0 + 23 * 60000));                    // a minute to go
r.run_seconds = all(W_, new Date(+T0 + 23 * 60000 + 30000));         // 30 seconds: 1 min, never 0
r.earlier = all(W_, new Date(+T0 - 12 * 60000));                     // twelve minutes earlier: 36 min
r.done = all(W_, new Date(+T0 + 25 * 60000));                       // 19 min ago... finished at 8:06, now 8:07
r.done_dryer = all(D_);                                             // finished at 7:30, 12 minutes ago
r.done_59 = all(D_, new Date(+at(11, 2, 19, 30) + 59 * 60000));
r.done_60 = all(D_, new Date(+at(11, 2, 19, 30) + 60 * 60000));
r.done_90 = all(D_, new Date(+at(11, 2, 19, 30) + 90 * 60000));
// a remaining duration (minutes), in hours, in seconds, at 0
r.dur = all(R_);
ST['sensor.washer_remaining_program_time'].state = '65'; r.dur65 = all(R_);
ST['sensor.washer_remaining_program_time'].state = '120'; r.dur120 = all(R_);
ST['sensor.washer_remaining_program_time'].state = '2'; ST['sensor.washer_remaining_program_time'].attributes.unit_of_measurement = 'h'; r.dur_h = all(R_);
ST['sensor.washer_remaining_program_time'].state = '90'; ST['sensor.washer_remaining_program_time'].attributes.unit_of_measurement = 's'; r.dur_s = all(R_);
// (the machine ran a moment ago in this test, and the page saw it: that is its own test below. Here it was never seen running)
Object.keys(P.MEM).forEach(function (k) { delete P.MEM[k]; });
ST['sensor.washer_remaining_program_time'].state = '0'; ST['sensor.washer_remaining_program_time'].attributes.unit_of_measurement = 'min'; r.dur0 = all(R_);
// unavailable is not a stop; unknown is an idle machine
ST['sensor.washer_remaining_program_time'].state = 'unavailable'; r.dur_unavail = all(R_);
print(JSON.stringify(r));
""", before=FAKES)
    r = out["run"]
    assert all(x[0] for x in r) and r[0][2] == r[1][2] == r[2][2] == TEAL
    assert text(r[0][1]) == "Washer 24 min left" and "<svg" in r[0][1] and "rect" in r[0][1]
    assert text(r[1][1]) == "24m WASHER" and 'y="72"' in r[1][1]
    assert re.search(r'class="l1">Washer</div><div class="l2"><i class="dot a"></i>24 min left</div><div class="l3">Done at 8:06 PM</div>', r[2][1]), r[2][1]
    assert text(out["run_late"][0][1]) == "Washer 1 min left" and text(out["run_seconds"][0][1]) == "Washer 1 min left"
    assert text(out["earlier"][0][1]) == "Washer 36 min left"
    d = out["done"]
    assert text(d[0][1]) == "Washer done" and text(d[1][1]) == "Done WASHER" and d[0][2] == d[1][2] == d[2][2] == AMBER
    assert re.search(r'class="l1">Washer</div><div class="l2"><i class="dot a"></i>Done</div><div class="l3">Finished 8:06 PM</div>', d[2][1]), d[2][1]
    assert arc(1) in d[1][1]                                                                   # the ring full
    assert text(out["done_dryer"][0][1]) == "Dryer done"
    assert all(x[0] for x in out["done_59"]) and all(x[:2] == [False, ""] for x in out["done_60"]) and all(x[:2] == [False, ""] for x in out["done_90"])
    assert text(out["dur"][0][1]) == "Washer 24 min left" and "Done at 8:06 PM" in text(out["dur"][2][1])
    assert text(out["dur65"][0][1]) == "Washer 1 hr 5 min left" and text(out["dur65"][1][1]) == "1h05 WASHER"
    assert text(out["dur120"][0][1]) == "Washer 2 hr left" and text(out["dur120"][1][1]) == "2h00 WASHER"
    assert text(out["dur_h"][0][1]) == "Washer 2 hr left"
    assert text(out["dur_s"][0][1]) == "Washer 2 min left"                                      # (90 seconds: two minutes, rounded up)
    assert all(x[:2] == [False, ""] for x in out["dur0"])                                      # at 0 and never seen running: not shown
    assert all(x[:2] == [False, ""] for x in out["dur_unavail"])


def test_appliance_states_and_what_it_remembers(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function forget() { Object.keys(P.MEM).forEach(function (k) { delete P.MEM[k]; }); }
function one(id, o, now, shape) { var x = show('appliance', shape || 'inline', { opts: { entity: id } }, now); return [x.showing, text(x.html)]; }
// a binary sensor: on is running; off is idle -- and done only when we saw it running and then not, for an hour
ent('binary_sensor.washer_running', 'off', { friendly_name: 'Washer Running' });
r.b_idle = one('binary_sensor.washer_running');
ST['binary_sensor.washer_running'].state = 'on'; r.b_on = one('binary_sensor.washer_running'); r.b_on_c = one('binary_sensor.washer_running', 0, T0, 'circular'); r.b_on_r = one('binary_sensor.washer_running', 0, T0, 'rectangular');
ST['binary_sensor.washer_running'].state = 'off';
var t1 = new Date(+T0 + 600000);
r.b_off = one('binary_sensor.washer_running', 0, t1);
r.b_off_30 = one('binary_sensor.washer_running', 0, new Date(+t1 + 30 * 60000));
r.b_off_59 = one('binary_sensor.washer_running', 0, new Date(+t1 + 59 * 60000));
r.b_off_61 = one('binary_sensor.washer_running', 0, new Date(+t1 + 61 * 60000));
// a duration that reaches 0 while we watch is done; it was never seen running at first
ST['sensor.washer_remaining_program_time'].state = '3'; r.d_run = one('sensor.washer_remaining_program_time');
ST['sensor.washer_remaining_program_time'].state = '0'; r.d_done = one('sensor.washer_remaining_program_time', 0, new Date(+T0 + 180000));
ST['sensor.washer_remaining_program_time'].state = 'unknown'; r.d_unknown = one('sensor.washer_remaining_program_time', 0, new Date(+T0 + 240000));
r.d_gone = one('sensor.washer_remaining_program_time', 0, new Date(+T0 + 180000 + 61 * 60000));
// operation-state sensors (Home Connect's, SmartThings'), the finished word with and without a last_changed
['run', 'Running', 'in_progress', 'delayedstart', 'paused', 'on', 'washing', 'drying'].forEach(function (v) { forget(); ent('sensor.dryer_operation_state', v, { friendly_name: 'Dryer Operation State' }); r['o_' + v] = one('sensor.dryer_operation_state'); });
['inactive', 'ready', 'off', 'idle', 'standby', 'error', 'abc'].forEach(function (v) { forget(); ent('sensor.dryer_operation_state', v, { friendly_name: 'Dryer Operation State' }); r['o_' + v] = one('sensor.dryer_operation_state'); });
forget();
ent('sensor.dryer_operation_state', 'finished', { friendly_name: 'Dryer Operation State' }, isoAt(11, 2, 19, 20));
r.o_finished = one('sensor.dryer_operation_state');
ent('sensor.dryer_operation_state', 'finished', { friendly_name: 'Dryer Operation State' }, isoAt(11, 2, 17, 0));
r.o_finished_old = one('sensor.dryer_operation_state');
ent('sensor.dryer_operation_state', 'Cycle Complete', { friendly_name: 'Dryer Operation State' }, isoAt(11, 2, 19, 41));
r.o_complete = one('sensor.dryer_operation_state');
ent('sensor.dryer_operation_state', 'run', { friendly_name: 'Dryer Operation State' }); r.o_circ = one('sensor.dryer_operation_state', 0, T0, 'circular'); r.o_rect = one('sensor.dryer_operation_state', 0, T0, 'rectangular');
print(JSON.stringify(r));
""", before=FAKES)
    assert out["b_idle"] == [False, ""]
    assert out["b_on"] == [True, "Washer running"]
    assert out["b_on_c"][1] == "Run WASHER" and out["b_on_r"][1] == "Washer Running Running"       # (the name has "running" in it; the word it adds is for the state)
    assert out["b_off"] == [True, "Washer done"]
    assert out["b_off_30"][0] and out["b_off_59"][0] and out["b_off_61"] == [False, ""]
    assert out["d_run"] == [True, "Washer 3 min left"] and out["d_done"] == [True, "Washer done"] and out["d_unknown"] == [True, "Washer done"]
    assert out["d_gone"] == [False, ""]
    for v in ("run", "Running", "in_progress", "delayedstart", "paused", "on", "washing", "drying"):
        assert out["o_" + v] == [True, "Dryer running"], v
    for v in ("inactive", "ready", "off", "idle", "standby", "error", "abc"):
        assert out["o_" + v] == [False, ""], v
    assert out["o_finished"] == [True, "Dryer done"]
    assert out["o_finished_old"] == [False, ""]
    assert out["o_complete"] == [True, "Dryer done"]
    assert out["o_circ"][1] == "Run DRYER" and out["o_rect"][0]


def test_two_appliances_in_the_rectangular_shape_and_the_names(tmp_path):
    out = run(tmp_path, r"""
var r = {};
delete ST['sensor.dishwasher_remaining_time'];
r.two = show('appliance', 'rectangular');                                    // the washer (24 min, finishing 8:06) and the dryer (done 12 min ago)
ST['sensor.dryer_completion_time'].state = isoAt(11, 2, 20, 30);              // the dryer at work too: 48 min
r.both_running = show('appliance', 'rectangular');
ST['sensor.dryer_completion_time'].state = isoAt(11, 2, 19, 30);
// the three machines' names
ent('sensor.kitchen_dishwasher_remaining', '41', { device_class: 'duration', unit_of_measurement: 'min', friendly_name: 'Kitchen Dishwasher Remaining Time' });
ent('sensor.washing_machine_eta', '10', { device_class: 'duration', unit_of_measurement: 'min', friendly_name: 'Washing Machine ETA' });
ent('sensor.oven_remaining_time', '30', { device_class: 'duration', unit_of_measurement: 'min', friendly_name: 'Big Oven Remaining Time' });
ent('sensor.pressure_cooker_finish', '5', { device_class: 'duration', unit_of_measurement: 'min', friendly_name: 'A Very Long Pressure Cooker Name Remaining' });
ent('sensor.nameless_remaining', '5', { device_class: 'duration', unit_of_measurement: 'min' });
function name(id, shape) { var x = show('appliance', shape || 'inline', { opts: { entity: id } }); return text(x.html); }
r.n_dish = [name('sensor.kitchen_dishwasher_remaining'), name('sensor.kitchen_dishwasher_remaining', 'circular')];
r.n_wash = name('sensor.washing_machine_eta');
r.n_oven = [name('sensor.oven_remaining_time'), name('sensor.oven_remaining_time', 'circular')];
r.n_long = [name('sensor.pressure_cooker_finish'), name('sensor.pressure_cooker_finish', 'circular')];
r.n_nameless = name('sensor.nameless_remaining');
print(JSON.stringify(r));
""", before=FAKES)
    two = out["two"]["html"]
    assert two.count('class="pk-row"') == 2 and two.index("Washer") < two.index("Dryer")           # at work first, then done
    rows = re.findall(r'<div class="pk-row"([^>]*)><i class="dot a"></i><div class="pk-n">([^<]*)</div><div class="pk-v">([^<]*)</div></div>', two)
    assert [(r[1], r[2]) for r in rows] == [("Washer", "24 min left"), ("Dryer", "Done")]
    assert TEAL in rows[0][0] and AMBER in rows[1][0] and out["two"]["acc"] == TEAL                  # a dot of each machine's own color
    rows = re.findall(r'<div class="pk-n">([^<]*)</div><div class="pk-v">([^<]*)</div>', out["both_running"]["html"])
    assert rows == [("Washer", "24 min left"), ("Dryer", "48 min left")]
    assert out["n_dish"] == ["Dishwasher 41 min left", "41m DISH"] and out["n_wash"] == "Washer 10 min left"
    assert out["n_oven"][0] == "Big Oven 30 min left" and out["n_oven"][1] == "30m BIG"
    assert out["n_long"][0].startswith("A Very Long P") and out["n_long"][0].endswith("5 min left") and out["n_long"][1] == "5m A"
    assert out["n_nameless"] == "Nameless 5 min left"


def test_leak_and_smoke_only_while_tripped_and_unknown_is_not_tripped(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function both(o, now) { return ['inline', 'card'].map(function (s) { var x = show('leak', s, o, now); return [x.showing, x.html, x.acc, x.accd]; }); }
r.quiet = both();                                                           // (the kitchen's sensor says unknown)
ST['binary_sensor.kitchen_leak_sensor'].state = 'unavailable'; r.unavailable = both();
ST['binary_sensor.kitchen_leak_sensor'].state = 'unknown'; ST['binary_sensor.laundry_leak_sensor'].state = 'unknown'; r.all_unknown = both();
// tripped: water at the laundry, 12 minutes ago
ST['binary_sensor.laundry_leak_sensor'].state = 'on'; ST['binary_sensor.laundry_leak_sensor'].last_changed = isoAt(11, 2, 19, 30);
r.water = both();
r.water_ago = ['inline', 'card'].map(function (s) { return html('leak', s, null, new Date(+T0 + 48 * 60000)); });
r.water_hr = html('leak', 'card', null, new Date(+T0 + 3 * 3600000));
r.water_days = html('leak', 'card', null, new Date(+T0 + 50 * 3600000));
r.water_day = html('leak', 'card', null, new Date(+T0 + 25 * 3600000));
r.water_now = html('leak', 'card', null, new Date(+at(11, 2, 19, 30) + 20000));
// smoke in the hall, CO in the garage; smoke outranks water; two tripped: "+1"
ST['binary_sensor.hall_smoke_detector'].state = 'on'; ST['binary_sensor.hall_smoke_detector'].last_changed = isoAt(11, 2, 19, 40);
r.smoke = both();
ST['binary_sensor.hall_smoke_detector'].state = 'off'; ST['binary_sensor.garage_co_detector'].state = 'on';
r.co = both();
ST['binary_sensor.garage_co_detector'].state = 'off';
// not in Settings' lists: not read (the owner's Status & Chips decides)
GET.kinds.leaks = []; r.unlisted = both();
GET.kinds.leaks = ['binary_sensor.laundry_leak_sensor'];
// a sensor with no last change: no "ago"; a name with nothing but the words for what it senses
ST['binary_sensor.laundry_leak_sensor'].last_changed = undefined; r.no_time = ['inline', 'card'].map(function (s) { return html('leak', s); });
ST['binary_sensor.laundry_leak_sensor'].attributes.friendly_name = 'Water Leak Sensor 1'; r.no_where = ['inline', 'card'].map(function (s) { return html('leak', s); });
ST['binary_sensor.laundry_leak_sensor'].attributes.friendly_name = 'The Cellar Leak Sensor'; r.the = html('leak', 'inline');
// no Status & Chips kinds at all: the binary sensors of those device classes (hidden ones and groups left out)
base(); GET = {}; ST['binary_sensor.laundry_leak_sensor'].state = 'on'; ST['binary_sensor.hall_smoke_detector'].state = 'on';
r.fallback = html('leak', 'inline');
ENTS['binary_sensor.hall_smoke_detector'] = { hidden: true }; r.fallback_hidden = html('leak', 'inline');
ENTS['binary_sensor.hall_smoke_detector'] = { entity_category: 'diagnostic' }; r.fallback_diag = html('leak', 'inline');
// the kinds object empty: also the device classes
base(); GET = { kinds: {} }; ST['binary_sensor.laundry_leak_sensor'].state = 'on'; r.empty_kinds = html('leak', 'inline');
// no leak sensor at all
base(); GET = {}; ['laundry_leak_sensor', 'kitchen_leak_sensor', 'hall_smoke_detector', 'garage_co_detector'].forEach(function (k) { delete ST['binary_sensor.' + k]; }); r.none = both();
print(JSON.stringify(r));
""", before=FAKES)
    for k in ("quiet", "unavailable", "all_unknown", "unlisted", "none"):
        assert all(x[:2] == [False, ""] for x in out[k]), k
    w = out["water"]
    assert all(x[0] for x in w) and w[0][2] == w[1][2] == RED and w[0][3] == "#c4261a"
    assert text(w[0][1]) == "Water at the Laundry" and "M12 3.2c3.6 4.3 6 7.2 6 10.3" in w[0][1]            # the drop
    card = w[1][1]
    assert card.startswith('<div class="cd ti"><div class="pk-h"><div class="ct">Water leak</div><svg')
    assert re.search(r'</svg></div><div class="cl">Laundry</div><div class="s2">12 min ago</div></div>$', card), card       # title row, where, how long ago
    assert text(out["water_ago"][0]) == "Water at the Laundry" and "60 min ago" not in out["water_ago"][1] and "1 hr ago" in out["water_ago"][1]
    assert "3 hr ago" in out["water_hr"] and "2 days ago" in out["water_days"] and "1 day ago" in out["water_day"] and "Just now" in out["water_now"]
    s = out["smoke"]
    assert text(s[0][1]) == "Smoke in the Hall +1" and "M12 3.5l9.2 16H2.8z" in s[0][1] and ">Smoke detected<" in s[1][1] and ">Hall<" in s[1][1]    # smoke first; +1 for the water
    assert '<div class="s2">2 min ago · +1 more</div>' in s[1][1]
    c = out["co"]
    assert text(c[0][1]) == "CO in the Garage +1" and ">CO detected<" in c[1][1]
    assert "s2" not in out["no_time"][1] and text(out["no_time"][0]) == "Water at the Laundry"
    assert text(out["no_where"][0]) == "Water leak" and ">Water Leak Sensor 1<" in out["no_where"][1]
    assert text(out["the"]) == "Water at the Cellar"
    assert text(out["fallback"]) == "Smoke in the Hall +1"
    assert text(out["fallback_hidden"]) == "Water at the Laundry" and text(out["fallback_diag"]) == "Water at the Laundry"
    assert text(out["empty_kinds"]) == "Water at the Laundry"


def test_travel_time(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function all(o) { return ['inline', 'circular', 'rectangular'].map(function (s) { var x = show('travel', s, o); return [x.showing, x.html, x.acc, x.accd]; }); }
var WORK = { opts: { entity: 'sensor.work_travel_time', entity2: 'sensor.school_travel_time' } }, ONE = { opts: { entity: 'sensor.work_travel_time', entity2: 'sensor.work_travel_time' } };
r.work = all(ONE);
r.two = all(WORK);
r.default_ = all();
// slow: 25% over the usual (the state against duration): 22 -> 28 is 1.27
ST['sensor.work_travel_time'].state = '28'; ST['sensor.work_travel_time'].attributes.duration_in_traffic = '28 mins';
r.slow = all(WORK);
ST['sensor.work_travel_time'].state = '27'; ST['sensor.work_travel_time'].attributes.duration_in_traffic = '27 mins'; r.not_yet = all(ONE);          // 1.227: no
// no traffic number: nothing to compare against
delete ST['sensor.work_travel_time'].attributes.duration_in_traffic; ST['sensor.work_travel_time'].state = '40'; r.no_traffic = all(ONE);
// an hour and more; hours as the unit; seconds
ST['sensor.work_travel_time'].state = '75'; r.long = all(ONE);
ST['sensor.work_travel_time'].state = '2'; ST['sensor.work_travel_time'].attributes.unit_of_measurement = 'h'; r.hours = all(ONE);
ST['sensor.work_travel_time'].attributes.unit_of_measurement = 's'; ST['sensor.work_travel_time'].state = '1500'; r.secs = all(ONE);
// a state that is no number: the attributes' durations
ST['sensor.work_travel_time'].state = 'unavailable'; r.unavail = all(ONE);
ST['sensor.work_travel_time'].state = 'unknown'; ST['sensor.work_travel_time'].attributes.duration_in_traffic = '31 mins'; r.fallback = all(ONE);
// names
// none: a dash everywhere
base(); delete ST['sensor.work_travel_time']; delete ST['sensor.school_travel_time']; r.absent = all();
print(JSON.stringify(r));
""", before=FAKES)
    w = out["work"]
    assert all(x[0] for x in w) and w[0][2] == w[1][2] == w[2][2] == BLUE and w[0][3] == "#1f78b8"
    assert text(w[0][1]) == "Work 24 min" and "M12 21s7-6.2 7-11.5" in w[0][1]                    # the pin
    assert text(w[1][1]) == "24 MIN" and arc(round(24 / 60 * 200) / 200) in w[1][1]
    assert re.search(r'class="l1">Work</div><div class="l2"><i class="dot a"></i>24 min</div><div class="l3">Usual traffic</div>', w[2][1]), w[2][1]
    t = out["two"]
    assert re.findall(r'<div class="pk-n">([^<]*)</div><div class="pk-v">([^<]*)</div>', t[2][1]) == [("Work", "24 min"), ("School", "11 min")]
    # nothing picked: the suggestions, School and Work (alphabetical), the first on the single-line shapes
    assert text(out["default_"][0][1]) == "School 11 min" and text(out["default_"][1][1]) == "11 MIN"
    assert re.findall(r'<div class="pk-n">([^<]*)</div><div class="pk-v">([^<]*)</div>', out["default_"][2][1]) == [("School", "11 min"), ("Work", "24 min")]
    s = out["slow"]
    assert all(x[2] == AMBER for x in s) and text(s[0][1]) == "Work 28 min" and ">Work<" in s[2][1]
    assert re.search(r'<div class="pk-row" style="[^"]*--sw-acc:#ffb340[^"]*"><i class="dot a"></i><div class="pk-n">Work</div>', s[2][1])
    assert re.search(r'<div class="pk-row" style="[^"]*--sw-acc:#7cc8ff[^"]*"><i class="dot a"></i><div class="pk-n">School</div>', s[2][1])      # (School stays blue)
    assert out["not_yet"][0][2] == BLUE                                                                # 27 over 22 is 1.23: not yet 25%
    assert "Usual traffic" not in out["no_traffic"][2][1] and 'class="l3"' not in out["no_traffic"][2][1] and out["no_traffic"][0][2] == BLUE
    lg = out["long"]
    assert text(lg[0][1]) == "Work 1 hr 15 min" and text(lg[1][1]) == "75 MIN" and arc(1) in lg[1][1]
    assert text(out["hours"][0][1]) == "Work 2 hr" and text(out["secs"][0][1]) == "Work 25 min"
    assert text(out["unavail"][0][1]) == "Work 22 min" and text(out["fallback"][0][1]) == "Work 31 min"       # (the traffic's, else the usual)
    ab = out["absent"]
    assert text(ab[0][1]) == "—" and text(ab[1][1]) == "— MIN" and re.search(r'class="l1">Travel</div><div class="l2">—</div>', ab[2][1])
    assert all(x[0] for x in ab)


def test_travel_names_and_slow_note(tmp_path):
    out = run(tmp_path, r"""
var r = {};
ent('sensor.waze_a', '8', { friendly_name: 'Waze Travel Time' }); ent('sensor.waze_b', '9', { friendly_name: 'Commute' }); ent('sensor.waze_c', '10', { friendly_name: 'Mom’s House Drive Time' });
ent('sensor.waze_d', '12', { friendly_name: 'Pickup Travel Duration' }); ent('sensor.waze_e', '13', {}); ent('sensor.waze_f', '14', { friendly_name: 'Google Maps Commute to Work' });
function nm(id) { return text(html('travel', 'inline', { opts: { entity: id } })); }
r.names = ['sensor.waze_a', 'sensor.waze_b', 'sensor.waze_c', 'sensor.waze_d', 'sensor.waze_e', 'sensor.waze_f'].map(nm);
ST['sensor.work_travel_time'].attributes.duration_in_traffic = '32 mins'; ST['sensor.work_travel_time'].state = '32';
r.note = show('travel', 'rectangular', { opts: { entity: 'sensor.work_travel_time', entity2: 'sensor.work_travel_time' } }).html;
print(JSON.stringify(r))
""", before=FAKES)
    assert out["names"] == ["Drive 8 min", "Drive 9 min", "Mom’s House 10 min", "Pickup 12 min", "Drive 13 min", "Maps to Work 14 min"]
    assert re.search(r'class="l1">Work</div><div class="l2"><i class="dot a"></i>32 min</div><div class="l3">10 min slower than usual</div>', out["note"]), out["note"]


def test_price(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function one(o, now) { var x = show('price', 'inline', o, now); return [x.showing, x.html, x.acc, x.accd, x.blank]; }
var E = { opts: { entity: 'sensor.electricity_price' } };
r.peak = one(E); r.peak24 = one({ opts: E.opts, h24: true }); r.default_ = one();
function with_(state, attrs) { base(); ent('sensor.electricity_price', state, Object.assign({ unit_of_measurement: 'USD/kWh', friendly_name: 'Electricity Price' }, attrs || {})); return one(E); }
r.offpeak = with_('0.09', { tier: 'off_peak', next_change: isoAt(11, 3, 7, 0) });
r.offpeak_cap = with_('0.09', { tier: 'Off-Peak', next_change: isoAt(11, 2, 22, 30) });
r.mid = with_('0.18', { period: 'mid-peak', next_change: isoAt(11, 2, 20, 0) });
r.shoulder = with_('0.18', { period: 'shoulder', next_change: isoAt(11, 5, 6, 0) });
r.high = with_('0.45', { price_level: 'high' });
r.tier_no_price = with_('n/a', { tier: 'peak', next_change: isoAt(11, 2, 21, 0) });
r.plain = with_('0.31'); r.plain_up = with_('0.2750'); r.plain_three = with_('0.095'); r.plain_big = with_('1.5'); r.plain_int = with_('2');
r.next_only = with_('0.31', { next_change: isoAt(11, 2, 21, 0) });
r.next_past = with_('0.31', { tier: 'peak', next_change: isoAt(11, 2, 18, 0) });
r.next_clock = with_('0.31', { tier: 'peak', next_change: '21:00' });
r.next_clock_past = with_('0.31', { tier: 'peak', next_change: '07:00' });
r.state_tier = with_('Peak', { next_change: isoAt(11, 2, 21, 0) }); r.state_tier2 = with_('off_peak');
r.eur = with_('0.28', { unit_of_measurement: 'EUR/kWh' }); r.gbp = with_('0.3', { unit_of_measurement: '£/kWh' }); r.cents = with_('9.54', { unit_of_measurement: '¢/kWh' });
r.cents2 = with_('12', { unit_of_measurement: 'cents/kWh' }); r.nounit = with_('0.31', { unit_of_measurement: undefined }); r.kwh_only = with_('0.31', { unit_of_measurement: 'kWh' });
r.mwh = with_('55', { unit_of_measurement: 'EUR/MWh' });
['unavailable', 'unknown', '', 'soon'].forEach(function (v) { r['bad_' + v] = with_(v); });
// the Energy plan's entity (an input_number) when nothing is picked
base(); GET.energy = { total: { price: 'input_number.grid_price' } }; ent('input_number.grid_price', '0.12', { unit_of_measurement: '$/kWh' });
r.plan = one();
base(); delete ST['sensor.electricity_price']; r.absent = one();
print(JSON.stringify(r));
""", before=FAKES)
    def words(k):
        return text(out[k][1])
    assert words("peak") == "Peak until 9 PM" and out["peak"][2] == AMBER and out["peak"][3] == "#b36b00" and "M13 2.8L5.5 13.4h5.3" in out["peak"][1]   # the bolt
    assert words("peak24") == "Peak until 21:00" and words("default_") == "Peak until 9 PM"
    assert words("offpeak") == "Off-peak until tomorrow 7 AM" and out["offpeak"][2] == GREEN
    assert words("offpeak_cap") == "Off-peak until 10:30 PM"
    assert words("mid") == "Mid-peak until 8 PM" and out["mid"][2] == YELLOW
    assert words("shoulder") == "Shoulder until Thu 6 AM"
    assert words("high") == "High · $0.45/kWh" and out["high"][2] == AMBER
    assert words("tier_no_price") == "Peak until 9 PM"
    assert words("plain") == "$0.31/kWh" and out["plain"][2] == YELLOW
    assert words("plain_up") == "$0.275/kWh" and words("plain_three") == "$0.095/kWh" and words("plain_big") == "$1.50/kWh" and words("plain_int") == "$2.00/kWh"
    assert words("next_only") == "$0.31/kWh until 9 PM"
    assert words("next_past") == "Peak · $0.31/kWh"
    assert words("next_clock") == "Peak until 9 PM" and words("next_clock_past") == "Peak until tomorrow 7 AM"
    assert words("state_tier") == "Peak until 9 PM" and words("state_tier2") == "Off-peak"
    assert words("eur") == "€0.28/kWh" and words("gbp") == "£0.30/kWh" and words("cents") == "9.5¢/kWh" and words("cents2") == "12¢/kWh"
    assert words("nounit") == "$0.31/kWh" and words("kwh_only") == "$0.31/kWh" and words("mwh") == "€55.00/MWh"
    for k in ("bad_unavailable", "bad_unknown", "bad_", "bad_soon", "absent"):
        assert out[k][0] and text(out[k][1]) == "—" and out[k][4] is True and out[k][2] == YELLOW, k
    assert words("plan") == "$0.12/kWh"


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "setInterval", "setTimeout", "requestAnimationFrame", "Mantel", "hkStats", "requestUpdate"):
        assert word not in src, word
    # American English
    for word in ("colour", "centre", "grey", "favourite", "litre"):
        assert word not in src.lower(), word
    # the group's own rules sit on the spacing scale (.4 .8 1.2 1.6 2.4 3.2) for every gap, margin and padding
    css = re.search(r"var CSS = \[(.*?)\]\.join", src, re.S).group(1)
    spacing = re.findall(r"(?:gap|margin[a-z-]*|padding[a-z-]*):[^;}']*", css)
    assert spacing
    for decl in spacing:
        for n in re.findall(r"calc\(var\(--u\) \* ([\d.]+)\)", decl):
            # (a card's title sits .6 u over its first line: the renderer's own exception, kept here for the title row)
            assert n in (".4", ".8", "1.2", "1.6", "2.4", "3.2") or (n == ".6" and decl.startswith("margin-top")), decl
    # two rows of 4.6 u and .4 u between them leave 1.7 u of the piece's 13 u above and below them (not under the 1.6 u of breathing room)
    assert "height:calc(var(--u) * 4.6)" in css and "gap:calc(var(--u) * .4)" in css and (13 - 2 * 4.6 - 0.4) / 2 >= 1.6
    # the card's title row: a glyph under the title's own line (2 u x 1.35 = 2.7 u), and .6 u from the title to the first line
    assert "width:calc(var(--u) * 2.4);height:calc(var(--u) * 2.4)" in css and 2.4 <= 2 * 1.35
    assert ".hksw .pk-h + div{margin-top:calc(var(--u) * .6)}" in css
    # a glyph over a circle's label: 24 units scaled 1.5, centered on 50 (32 + 12 x 1.5), its top at 24 (21 + 2 x 1.5)
    assert "translate(32 21) scale(1.5)" in src
    # a read never wakes a read: the one place that wakes pieces is after a read lands, through the renderer's shared watchers
    assert src.count("wakeAll()") >= 2 and "r.busy = 0; r.evs" in src
    # nothing is spelled out for the user that should not be: no emoji, no "TODO"
    assert "TODO" not in src


def test_a_missing_house_does_not_throw(tmp_path):
    out = run(tmp_path, r"""
window.hkSettings = undefined; window.hkCalendar = undefined;
var res = [], errors = [];
var junk = { states: { 'sensor.pixel_next_alarm': { state: 7, attributes: null }, 'sensor.x_pollen': null, 'calendar.trash': 5, 'sensor.work_travel_time': { state: {}, attributes: { duration: {}, unit_of_measurement: [] } },
                       'binary_sensor.l': { state: 'on', attributes: { device_class: 'moisture', friendly_name: 12 }, last_changed: {} }, 'sensor.price_x': { state: '1', attributes: { tier: {}, next_change: [], unit_of_measurement: 5 } },
                       'sensor.washer_finish': { state: 'run', attributes: null }, 'sensor.dryer_time': { state: '5', attributes: { device_class: 'duration', unit_of_measurement: {} } } }, entities: null, config: null };
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [null, { states: ST }, junk, { states: {} }].forEach(function (c) {
      ['', 'sensor.pixel_next_alarm', 'calendar.trash', 'sensor.x_pollen', 'sensor.dryer_time'].forEach(function (id) {
        try { var w = mk(p, s, { opts: { entity: id, entity2: id } }); w.update(c, T0); w.measure(); w.destroy(); }
        catch (e) { errors.push(p + '/' + s + ': ' + e); }
      });
    });
  });
});
var S = P.suggest;
Object.keys(S).forEach(function (k) { try { S[k](junk.states); S[k].all(junk.states); } catch (e) { errors.push('suggest ' + k + ': ' + e); } });
// the pieces of ids that are not strings, and the helpers on junk
[undefined, null, 5, {}, 'x', 'a.b', [], 'sensor.'].forEach(function (v) { try { P.sensorDays({ state: v }, T0); P.wordLevel(v); P.minutesOf(v); P.tierOf(v); } catch (e) { errors.push('helper ' + v + ': ' + e); } });
print(JSON.stringify({ errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []


def test_without_a_renderer_nothing_happens(tmp_path):
    script = tmp_path / "t.js"
    script.write_text(f"var window = this;\nload({json.dumps(str(GROUP))});\nprint(JSON.stringify({{ loaded: !!window.hkSaverPiecesPicked }}));\n")
    r = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads(r.stdout.strip().splitlines()[-1]) == {"loaded": False}


def test_the_pieces_watch_no_forecast_and_the_group_is_listed_in_the_layouts_catalog(tmp_path):
    out = run(tmp_path, r"""
var calls = [];
window.hkWxForecast = { watch: function () { calls.push('watch'); return { data: function () { return []; }, ensure: function () {}, release: function () {} }; } };
window.hkWxReadings = { read: function () { calls.push('read'); return null; } };
Object.keys(CATALOG).forEach(function (p) { CATALOG[p].forEach(function (s) { var w = mk(p, s); w.update(client(), T0); w.destroy(); }); });
print(JSON.stringify({ calls: calls }));
""", before=FAKES)
    assert out["calls"] == []
    layout = (ROOT / "web/hk/modules/hk-saverlayout.js").read_text()
    for piece in ("alarm", "trash", "pollen", "appliance", "leak", "travel", "price"):
        assert re.search(rf"\b{piece}: \[\[.*?'picked'\]", layout), piece


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
