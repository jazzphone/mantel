"""The screensaver's Any Sensor glance piece (web/hk/modules/hk-saverpieces-sensor.js; docs/phase13/GLANCE-SPEC.md, wave C): `sensor` in
inline, circular and rectangular; the entity the owner picks (opts.entity, opts.entity2), its name (opts.name or the friendly name), the
words for its state (a number with its unit; a binary_sensor by device_class; a lock, switch, input_boolean, device_tracker, climate,
cover and timestamp), the ring's ends (opts.min and opts.max, else by device class, else the entity's own min and max), a dash for
unknown and unavailable, the glyph, the accent by device class, and the look keeps the plan's rules (nothing animates, nothing blurs,
no timers). Run under macOS's JavaScriptCore with the renderer's own DOM shim (tests/test_saverwidgets_pieces.py)."""
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-sensor.js"

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


# the house, as fakes: states are { state, attributes }, a client carries the unit system
FAKES = r"""
var T0 = new Date(2026, 10, 2, 13, 10, 0);
function S(state, attrs) { return { state: String(state), attributes: attrs || {} }; }
function house(o, units) { return { states: o, config: { unit_system: { temperature: units || '°F' } } }; }
var EMPTY = { states: {}, config: {} };
function mk(shape, opts, back) { return W.create('sensor', shape, { u: 4, back: back || 'none', opts: opts || {}, h24: false, color: 'auto' }); }
function show(shape, opts, c) {
  var w = mk(shape, opts); w.update(c, T0);
  var r = { showing: w.showing, blank: !!w.blank, html: w.el.innerHTML, acc: w.el.style.props['--sw-acc'] || null, accd: w.el.style.props['--sw-acc-d'] || null };
  w.destroy(); return r;
}
function text(html) { return html.replace(/<[^>]*>/g, '|').split('|').filter(function (x) { return x; }); }
// inline words, joined
function inline(id, st, o, units) { var r = show('inline', Object.assign({ entity: id }, o || {}), house(st, units)); r.t = text(r.html).join(''); return r; }
function circ(id, st, o, units) { var r = show('circular', Object.assign({ entity: id }, o || {}), house(st, units)); r.t = text(r.html); r.f = fracOf(r.html); return r; }
function fracOf(html) {
  var m = (html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/g) || []).map(function (x) { var p = x.match(/"([\d.]+) ([\d.]+)"/); return +p[1] / +p[2]; });
  return m.length > 1 ? m[1] : null;
}
var CATALOG = { sensor: ['inline', 'circular', 'rectangular'] };
"""

HOUSE = r"""
var OPTS = { entity: 'sensor.pool', entity2: 'lock.front', name: '', min: '', max: '' };
var SAMPLE_HOUSE = house({
  'sensor.pool': S(78.4, { unit_of_measurement: '°F', device_class: 'temperature', friendly_name: 'Pool' }),
  'lock.front': S('locked', { friendly_name: 'Front Door' }),
  'binary_sensor.mailbox': S('on', { device_class: 'opening', friendly_name: 'Mailbox' })
});
"""


def test_the_declaration_is_complete(tmp_path):
    out = run(tmp_path, r"""
var d = W.PIECES.sensor, n = Object.keys(W.PIECES).length;
var one = { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
            defaults: d.defaults, accent: typeof d.accent, shapes: Object.keys(d.shapes).sort() };
load(GROUPFILE);
print(JSON.stringify({ d: one, double: Object.keys(W.PIECES).length === n, css: W.CSS.split('sxc').length }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    d = out["d"]
    assert d["name"] == "Any Sensor" and d["group"] == "Any Sensor" and d["wave"] == "C" and d["facts"] == ["sensor"]
    assert d["shapes"] == ["circular", "inline", "rectangular"] and d["when"] is None and d["off"] is False and d["wakes"] and d["source"]
    assert d["accent"] == "function"
    domains = "entity:sensor,binary_sensor,input_number,number,input_boolean,switch,climate,lock,cover,device_tracker"
    assert d["opts"] == {"entity": domains, "entity2": domains, "name": "text", "min": "text", "max": "text"}
    assert d["defaults"]["entity"] == "" and d["defaults"]["name"] == ""
    assert out["double"] is True                                         # loaded twice: nothing is added again
    assert out["css"] == 2                                               # the group's rules are in the renderer's sheet once (one '.sxc' rule, split in two)


def test_every_shape_draws_with_an_empty_house_a_sample_one_and_every_sample(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [['empty', EMPTY, {}], ['empty-picked', EMPTY, OPTS], ['house', SAMPLE_HOUSE, OPTS], ['house-unpicked', SAMPLE_HOUSE, {}]].forEach(function (h, hi) {
      ['none', 'glass', 'tint'].forEach(function (back, bi) {
        try {
          var w = W.create(p, s, { u: 4, back: back, color: bi === 2 ? 'accent' : 'auto', h24: hi === 2, opts: h[2] });
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
      results.push({ p: p, s: s, h: 'sample', html: el.innerHTML, acc: el.style.props['--sw-acc'] || null, cls: el.className });
    } catch (e) { errors.push('sample ' + p + '/' + s + ': ' + e); }
  });
});
print(JSON.stringify({ results: results, errors: errors, warns: WARNS }));
""", before=FAKES + HOUSE)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == 3 * (4 * 3 + 1)
    for r in out["results"]:
        key = (r["p"], r["s"], r["h"])
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"], key
        if r["h"] != "sample":
            assert r["again"] is False and r["showing"] is True and r["live"] is False and r["w"] >= 0 and r["hh"] > 0, key
        assert len(r["html"]) > 0, key
        assert "NaN" not in r["html"] and "undefined" not in r["html"] and "null" not in r["html"] and "Mantel" not in r["html"], key
        if r["h"] == "sample":
            assert r["acc"] or r["s"] == "rectangular", key              # a sample carries an accent (the rows carry their own)
        if r["h"] in ("empty", "empty-picked", "house-unpicked"):
            assert "—" in r["html"], key                                 # nothing picked or nothing read: a dash
    for r in out["results"]:
        if r["s"] == "circular":
            assert 'stroke-width="7.5"' in r["html"] and 'y="72"' in r["html"] and 'viewBox="0 0 100 100"' in r["html"] and 'r="43"' in r["html"], (r["p"], r["h"])


def test_nothing_picked_is_a_dash_with_no_suggestion(tmp_path):
    out = run(tmp_path, r"""
var r = {};
['inline', 'circular', 'rectangular'].forEach(function (s) {
  var x = show(s, {}, SAMPLE_HOUSE);
  r[s] = { t: text(x.html), blank: x.blank, acc: x.acc, svg: x.html.indexOf('<svg') >= 0 };
});
// an entity that is not one of the domains is not picked (the renderer drops it)
r.badDomain = show('inline', { entity: 'light.kitchen' }, house({ 'light.kitchen': S('on') })).html;
print(JSON.stringify(r));
""", before=FAKES + HOUSE)
    assert out["inline"]["t"] == ["—"] and out["inline"]["blank"] is True and out["inline"]["acc"] is None and out["inline"]["svg"] is False
    assert out["circular"]["t"] == ["—", "SENSOR"] and out["circular"]["acc"] is None
    assert out["rectangular"]["t"] == ["Sensor", "—"] and out["rectangular"]["acc"] is None
    assert "—" in out["badDomain"] and "Kitchen" not in out["badDomain"]


def test_inline_wording(tmp_path):
    out = run(tmp_path, r"""
var r = {};
// a number with its unit: temperature whole with a degree sign, a percent whole, else its unit after a space
r.pool = inline('sensor.pool', { 'sensor.pool': S(78.4, { unit_of_measurement: '°F', device_class: 'temperature', friendly_name: 'Pool' }) });
r.freezer = inline('sensor.freezer', { 'sensor.freezer': S(2, { unit_of_measurement: '°C', device_class: 'temperature', friendly_name: 'Freezer' }) }, {}, '°C');
r.hum = inline('sensor.h', { 'sensor.h': S(45.6, { unit_of_measurement: '%', device_class: 'humidity', friendly_name: 'Basement' }) });
r.kw = inline('sensor.k', { 'sensor.k': S(2.1, { unit_of_measurement: 'kW', device_class: 'power', friendly_name: 'Solar' }) });
r.wh = inline('sensor.w', { 'sensor.w': S(1234.56, { unit_of_measurement: 'kWh', friendly_name: 'Used' }) });
r.prec = inline('sensor.p', { 'sensor.p': S(3.14159, { unit_of_measurement: 'psi', suggested_display_precision: 2, friendly_name: 'Tank' }) });
r.small = inline('sensor.s', { 'sensor.s': S('0.05', { unit_of_measurement: 'ppm', friendly_name: 'CO2' }) });
r.ten = inline('sensor.t', { 'sensor.t': S('12.30', { unit_of_measurement: 'm', friendly_name: 'Depth' }) });
r.neg = inline('sensor.n', { 'sensor.n': S(-0.2, { unit_of_measurement: '°F', friendly_name: 'Chill' }) });
r.nounit_temp = inline('sensor.u', { 'sensor.u': S(71.2, { device_class: 'temperature', friendly_name: 'Den' }) });
r.nounit_bat = inline('sensor.b', { 'sensor.b': S(87, { device_class: 'battery', friendly_name: 'Remote' }) });
// binary sensors by device class
r.door = inline('binary_sensor.d', { 'binary_sensor.d': S('on', { device_class: 'door', friendly_name: 'Back Door' }) });
r.door_shut = inline('binary_sensor.d', { 'binary_sensor.d': S('off', { device_class: 'door', friendly_name: 'Back Door' }) });
r.mailbox = inline('binary_sensor.m', { 'binary_sensor.m': S('on', { device_class: 'opening', friendly_name: 'Mailbox' }) });
r.motion = inline('binary_sensor.mo', { 'binary_sensor.mo': S('on', { device_class: 'motion', friendly_name: 'Hall' }) });
r.motion_clear = inline('binary_sensor.mo', { 'binary_sensor.mo': S('off', { device_class: 'motion', friendly_name: 'Hall' }) });
r.wet = inline('binary_sensor.w', { 'binary_sensor.w': S('on', { device_class: 'moisture', friendly_name: 'Sump' }) });
r.plain_bin = inline('binary_sensor.x', { 'binary_sensor.x': S('on', { friendly_name: 'Thing' }) });
r.plain_bin_off = inline('binary_sensor.x', { 'binary_sensor.x': S('off', { friendly_name: 'Thing' }) });
r.lowbat = inline('binary_sensor.l', { 'binary_sensor.l': S('on', { device_class: 'battery', friendly_name: 'Sensor' }) });
r.bin_lock = inline('binary_sensor.bl', { 'binary_sensor.bl': S('on', { device_class: 'lock', friendly_name: 'Gate' }) });
// locks, switches, input_booleans, trackers
r.lock = inline('lock.front', { 'lock.front': S('locked', { friendly_name: 'Front Door' }) });
r.unlocked = inline('lock.front', { 'lock.front': S('unlocked', { friendly_name: 'Front Door' }) });
r.jammed = inline('lock.front', { 'lock.front': S('jammed', { friendly_name: 'Front Door' }) });
r.ib = inline('input_boolean.guest', { 'input_boolean.guest': S('on', { friendly_name: 'Guest Mode' }) });
r.ib_off = inline('input_boolean.guest', { 'input_boolean.guest': S('off', { friendly_name: 'Guest Mode' }) });
r.sw = inline('switch.fan', { 'switch.fan': S('on', { friendly_name: 'Attic Fan' }) });
r.home = inline('device_tracker.phone', { 'device_tracker.phone': S('home', { friendly_name: 'Phone' }) });
r.away = inline('device_tracker.phone', { 'device_tracker.phone': S('not_home', { friendly_name: 'Phone' }) });
r.zone = inline('device_tracker.phone', { 'device_tracker.phone': S('school_pickup', { friendly_name: 'Phone' }) });
// climate: the current temperature; cover: open, closed, or its position part way
r.climate = inline('climate.up', { 'climate.up': S('heat', { current_temperature: 68.4, friendly_name: 'Upstairs' }) });
r.climate_c = inline('climate.up', { 'climate.up': S('cool', { current_temperature: 21.5, friendly_name: 'Upstairs' }) }, {}, '°C');
r.climate_nocur = inline('climate.up', { 'climate.up': S('off', { friendly_name: 'Upstairs' }) });
r.garage = inline('cover.g', { 'cover.g': S('open', { device_class: 'garage', friendly_name: 'Garage' }) });
r.garage_pos = inline('cover.g', { 'cover.g': S('open', { device_class: 'garage', current_position: 100, friendly_name: 'Garage' }) });
r.blind = inline('cover.b', { 'cover.b': S('open', { current_position: 45, friendly_name: 'Blind' }) });
r.blind_shut = inline('cover.b', { 'cover.b': S('closed', { current_position: 0, friendly_name: 'Blind' }) });
// words from a sensor, title-cased; a timestamp as a time
r.words = inline('sensor.m', { 'sensor.m': S('partly_cloudy', { friendly_name: 'Sky' }) });
r.alarm = inline('sensor.a', { 'sensor.a': S(new Date(2026, 10, 2, 18, 30).toISOString(), { device_class: 'timestamp', friendly_name: 'Alarm' }) });
r.alarm_tomorrow = inline('sensor.a', { 'sensor.a': S(new Date(2026, 10, 3, 6, 30).toISOString(), { device_class: 'timestamp', friendly_name: 'Alarm' }) });
// a custom name beats the friendly name; no friendly name: the id's words
r.named = inline('sensor.pool', { 'sensor.pool': S(78, { unit_of_measurement: '°F', friendly_name: 'Pool Water Temperature' }) }, { name: 'Pool' });
r.idname = inline('sensor.hot_tub_temp', { 'sensor.hot_tub_temp': S(101, { unit_of_measurement: '°F' }) });
r.longname = inline('sensor.l', { 'sensor.l': S(5, { unit_of_measurement: 'x', friendly_name: 'A Very Long Friendly Name For A Sensor' }) });
print(JSON.stringify(r));
""", before=FAKES)
    want = {
        "pool": "Pool 78°", "freezer": "Freezer 2°", "hum": "Basement 46%", "kw": "Solar 2.1 kW", "wh": "Used 1,235 kWh", "prec": "Tank 3.14 psi",
        "small": "CO2 0.05 ppm", "ten": "Depth 12.3 m", "neg": "Chill 0°", "nounit_temp": "Den 71°", "nounit_bat": "Remote 87%",
        "door": "Back Door Open", "door_shut": "Back Door Closed", "mailbox": "Mailbox Open", "motion": "Hall Detected", "motion_clear": "Hall Clear",
        "wet": "Sump Wet", "plain_bin": "Thing On", "plain_bin_off": "Thing Off", "lowbat": "Sensor Low", "bin_lock": "Gate Unlocked",
        "lock": "Front Door Locked", "unlocked": "Front Door Unlocked", "jammed": "Front Door Jammed",
        "ib": "Guest Mode On", "ib_off": "Guest Mode Off", "sw": "Attic Fan On", "home": "Phone Home", "away": "Phone Away", "zone": "Phone School Pickup",
        "climate": "Upstairs 68°", "climate_c": "Upstairs 22°", "climate_nocur": "Upstairs Off",
        "garage": "Garage Open", "garage_pos": "Garage Open", "blind": "Blind 45%", "blind_shut": "Blind Closed",
        "words": "Sky Partly Cloudy", "alarm": "Alarm 6:30 PM", "alarm_tomorrow": "Alarm Tue 6:30 AM",
        "named": "Pool 78°", "idname": "Hot Tub Temp 101°",
    }
    for k, v in want.items():
        assert out[k]["t"] == v, (k, out[k]["t"])
        assert out[k]["blank"] is False, k
    assert out["longname"]["t"] == "A Very Long Friendly… 5 x"                              # the name is cut at 22, no space before the ellipsis


def test_the_glyph_follows_the_icon_then_the_class_then_the_domain(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var K = W._.sensor.glyphKey;
function key(id, attrs, state) { var X = { st: {}, client: { config: {} } }; X.st[id] = S(state || '1', attrs); return K(W._.sensor.info(X, id, '')); }
r.icon_thermo = key('sensor.a', { icon: 'mdi:thermometer-lines' });
r.icon_drop = key('sensor.a', { icon: 'mdi:water-percent' });
r.icon_mail = key('binary_sensor.a', { icon: 'mdi:mailbox-open-outline' }, 'on');
r.icon_garage = key('cover.a', { icon: 'mdi:garage-open' }, 'open');
r.icon_door = key('binary_sensor.a', { icon: 'mdi:door-open' }, 'on');
r.icon_window = key('binary_sensor.a', { icon: 'mdi:window-closed' }, 'off');
r.icon_motion = key('binary_sensor.a', { icon: 'mdi:motion-sensor' }, 'on');
r.icon_walk = key('binary_sensor.a', { icon: 'mdi:walk' }, 'on');
r.icon_bolt = key('sensor.a', { icon: 'mdi:flash' });
r.icon_battery = key('sensor.a', { icon: 'mdi:battery-60' });
r.icon_lock = key('sensor.a', { icon: 'mdi:lock-outline' });
r.icon_block = key('sensor.a', { icon: 'mdi:block-helper' });             // "lock" inside "block" is not the lock's word
r.icon_unknown = key('sensor.a', { icon: 'mdi:rocket-launch' });
r.icon_beats_class = key('sensor.a', { icon: 'mdi:mailbox', device_class: 'temperature' });
r.cls_temp = key('sensor.a', { device_class: 'temperature' });
r.cls_hum = key('sensor.a', { device_class: 'humidity' });
r.cls_bat = key('sensor.a', { device_class: 'battery' });
r.cls_power = key('sensor.a', { device_class: 'power' });
r.cls_door = key('binary_sensor.a', { device_class: 'door' }, 'off');
r.cls_window = key('binary_sensor.a', { device_class: 'window' }, 'off');
r.cls_garage = key('binary_sensor.a', { device_class: 'garage_door' }, 'off');
r.cls_motion = key('binary_sensor.a', { device_class: 'motion' }, 'off');
r.cls_occ = key('binary_sensor.a', { device_class: 'occupancy' }, 'off');
r.dom_lock = key('lock.a', {}, 'locked');
r.dom_climate = key('climate.a', {}, 'heat');
r.dom_cover = key('cover.a', {}, 'open');
r.dom_switch = key('switch.a', {}, 'on');
r.dom_plain = key('sensor.a', {});
r.deg_unit = key('sensor.a', { unit_of_measurement: '°C' });
r.constructor = key('sensor.a', { device_class: 'constructor' });
// the drawn glyphs: one svg each, a dot for none, and the lock's shackle lifts when it is not shut
function html(id, attrs, state) { var c = {}; c[id] = S(state, attrs); return show('inline', { entity: id }, house(c)).html; }
r.svg = {
  thermo: html('sensor.a', { device_class: 'temperature' }, '70'), lock_shut: html('lock.a', {}, 'locked'), lock_open: html('lock.a', {}, 'unlocked'),
  dot: html('sensor.a', {}, '70'), mail: html('binary_sensor.a', { icon: 'mdi:mailbox' }, 'on')
};
print(JSON.stringify(r));
""", before=FAKES)
    want = {
        "icon_thermo": "thermo", "icon_drop": "drop", "icon_mail": "mail", "icon_garage": "garage", "icon_door": "door", "icon_window": "window",
        "icon_motion": "motion", "icon_walk": "motion", "icon_bolt": "bolt", "icon_battery": "battery", "icon_lock": "lock", "icon_block": "dot",
        "icon_unknown": "dot", "icon_beats_class": "mail", "cls_temp": "thermo", "cls_hum": "drop", "cls_bat": "battery", "cls_power": "bolt",
        "cls_door": "door", "cls_window": "window", "cls_garage": "garage", "cls_motion": "motion", "cls_occ": "motion", "dom_lock": "lock",
        "dom_climate": "thermo", "dom_cover": "window", "dom_switch": "dot", "dom_plain": "dot", "deg_unit": "thermo", "constructor": "dot",
    }
    for k, v in want.items():
        assert out[k] == v, (k, out[k])
    svg = out["svg"]
    for k in ("thermo", "lock_shut", "lock_open", "mail"):
        assert svg[k].count("<svg") == 1 and 'class="a"' in svg[k] and 'viewBox="0 0 24 24"' in svg[k], k
    assert '<i class="dot a"></i>' in svg["dot"] and "<svg" not in svg["dot"]
    assert "M8 10V7a4 4 0 0 1 8 0v3" in svg["lock_shut"] and "M8 10V7a4 4 0 0 1 7.6-1.7" in svg["lock_open"]


def test_circular_ring_between_min_and_max(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function ring(c) { return { t: c.t, f: fracOf(c.html), html: c.html }; }
var T = function (v, attrs) { return Object.assign({ unit_of_measurement: '°F', device_class: 'temperature', friendly_name: 'Pool' }, attrs || {}); };
// the ends from opts.min and opts.max
r.opts = ring(circ('sensor.p', { 'sensor.p': S(60, T()) }, { min: '40', max: '80' }));
r.opts_ws = ring(circ('sensor.p', { 'sensor.p': S(60, T()) }, { min: ' 40 ', max: ' 80' }));
r.opts_clamp_hi = ring(circ('sensor.p', { 'sensor.p': S(95, T()) }, { min: '40', max: '80' }));
r.opts_clamp_lo = ring(circ('sensor.p', { 'sensor.p': S(20, T()) }, { min: '40', max: '80' }));
r.opts_neg = ring(circ('sensor.p', { 'sensor.p': S(0, T({ unit_of_measurement: '°C' })) }, { min: '-20', max: '20' }, '°C'));
// min alone, max alone: the other end is the default
r.min_only = ring(circ('sensor.p', { 'sensor.p': S(66, T()) }, { min: '32' }));
r.max_only = ring(circ('sensor.p', { 'sensor.p': S(66, T()) }, { max: '132' }));
// words that are not numbers, or a range that is not one: the defaults
r.bad_words = ring(circ('sensor.p', { 'sensor.p': S(66, T()) }, { min: 'cold', max: 'hot' }));
r.inverted = ring(circ('sensor.p', { 'sensor.p': S(66, T()) }, { min: '90', max: '10' }));
r.equal = ring(circ('sensor.p', { 'sensor.p': S(66, T()) }, { min: '50', max: '50' }));
// the device class's defaults: a temperature 32-100 F or 0-40 C, a humidity or battery 0-100, anything else 0-100
r.temp_f = ring(circ('sensor.p', { 'sensor.p': S(66, T()) }));
r.temp_c = ring(circ('sensor.p', { 'sensor.p': S(20, T({ unit_of_measurement: '°C' })) }, {}, '°C'));
r.temp_nounit_c = ring(circ('sensor.p', { 'sensor.p': S(10, { device_class: 'temperature', friendly_name: 'Pool' }) }, {}, '°C'));
r.hum = ring(circ('sensor.h', { 'sensor.h': S(45, { unit_of_measurement: '%', device_class: 'humidity', friendly_name: 'Basement' }) }));
r.bat = ring(circ('sensor.b', { 'sensor.b': S(80, { device_class: 'battery', friendly_name: 'Remote' }) }));
r.other = ring(circ('sensor.o', { 'sensor.o': S(25, { unit_of_measurement: 'ppm', friendly_name: 'Radon' }) }));
// input_number and number: their own min and max (opts still win)
r.in_num = ring(circ('input_number.t', { 'input_number.t': S(15, { min: 10, max: 30, unit_of_measurement: 'min', friendly_name: 'Timer' }) }));
r.num_opts = ring(circ('number.t', { 'number.t': S(15, { min: 10, max: 30, friendly_name: 'Level' }) }, { min: '0', max: '60' }));
r.in_num_bad = ring(circ('input_number.t', { 'input_number.t': S(50, { min: 30, max: 30, friendly_name: 'Level' }) }));
// a thermostat: its own min_temp and max_temp, its current temperature
r.climate = ring(circ('climate.up', { 'climate.up': S('heat', { current_temperature: 70, min_temp: 50, max_temp: 90, friendly_name: 'Upstairs' }) }));
r.climate_nolimits = ring(circ('climate.up', { 'climate.up': S('heat', { current_temperature: 66, friendly_name: 'Upstairs' }) }));
// a cover part way: its position
r.blind = ring(circ('cover.b', { 'cover.b': S('open', { current_position: 25, friendly_name: 'Blind' }) }));
print(JSON.stringify(r));
""", before=FAKES)
    near = lambda k, f: out[k]["f"] == pytest.approx(f, abs=0.005)
    near("opts", 0.5); near("opts_ws", 0.5); near("opts_clamp_hi", 1.0); near("opts_clamp_lo", 0.0); near("opts_neg", 0.5)
    near("min_only", 34 / 68); near("max_only", 34 / 100)
    near("bad_words", 34 / 68); near("inverted", 34 / 68); near("equal", 34 / 68)
    near("temp_f", 34 / 68); near("temp_c", 0.5); near("temp_nounit_c", 0.25)
    near("hum", 0.45); near("bat", 0.8); near("other", 0.25)
    near("in_num", 0.25); near("num_opts", 0.25); near("in_num_bad", 0.5)
    near("climate", 0.5); near("climate_nolimits", 34 / 68); near("blind", 0.25)
    # the figure and the name under it
    assert out["opts"]["t"] == ["60°", "POOL"] and out["temp_c"]["t"] == ["20°", "POOL"] and out["hum"]["t"] == ["45%", "BASEMENT"]
    assert out["bat"]["t"] == ["80%", "REMOTE"] and out["climate"]["t"] == ["70°", "UPSTAIRS"] and out["blind"]["t"] == ["25%", "BLIND"]
    assert out["opts_neg"]["t"][0] == "0°"
    for k in ("opts", "temp_f", "hum"):
        assert out[k]["html"].count("rotate(-90") == 2 and "rotate(135" not in out[k]["html"], k       # a whole ring (the track and the arc)


def test_circular_figure_unit_and_name(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function c(id, st, o) { return circ(id, st, o).t; }
// the unit stays with the figure when they are short, else it goes under it, in place of the name
r.w = c('sensor.a', { 'sensor.a': S(230, { unit_of_measurement: 'W', friendly_name: 'Dryer' }) });
r.v = c('sensor.a', { 'sensor.a': S(5, { unit_of_measurement: 'V', friendly_name: 'Dryer' }) });
r.kw = c('sensor.a', { 'sensor.a': S(7.2, { unit_of_measurement: 'kW', friendly_name: 'Charger' }) });
r.kwh = c('sensor.a', { 'sensor.a': S(1234.5, { unit_of_measurement: 'kWh', friendly_name: 'Charger' }) });
r.ppm = c('sensor.a', { 'sensor.a': S(412, { unit_of_measurement: 'ppm', friendly_name: 'CO2' }) });
r.nounit = c('sensor.a', { 'sensor.a': S(7, { friendly_name: 'Count' }) });
// the name: 8 letters at most, in capitals; whole words while they fit; a custom name too
r.n_short = c('sensor.a', { 'sensor.a': S(70, { unit_of_measurement: '°F', friendly_name: 'Den' }) });
r.n_words = c('sensor.a', { 'sensor.a': S(70, { unit_of_measurement: '°F', friendly_name: 'Pool Temperature' }) });
r.n_two = c('sensor.a', { 'sensor.a': S(70, { unit_of_measurement: '°F', friendly_name: 'Pool Spa Heater' }) });
r.n_one_long = c('sensor.a', { 'sensor.a': S(70, { unit_of_measurement: '°F', friendly_name: 'Conservatory' }) });
r.n_custom = c('sensor.a', { 'sensor.a': S(70, { unit_of_measurement: '°F', friendly_name: 'Conservatory' }) }, { name: 'Sunroom' });
r.n_custom_long = c('sensor.a', { 'sensor.a': S(70, { unit_of_measurement: '°F', friendly_name: 'Den' }) }, { name: 'Freezer in the garage' });
// words: the state word as the figure, the ring's track alone
r.lock = circ('lock.f', { 'lock.f': S('locked', { friendly_name: 'Front Door' }) });
r.door = circ('binary_sensor.d', { 'binary_sensor.d': S('on', { device_class: 'door', friendly_name: 'Garage Door' }) });
r.motion = circ('binary_sensor.d', { 'binary_sensor.d': S('off', { device_class: 'motion', friendly_name: 'Hall' }) });
r.unlocked = circ('lock.f', { 'lock.f': S('unlocked', { friendly_name: 'Front Door' }) });
r.long_state = circ('sensor.m', { 'sensor.m': S('partly_cloudy_and_windy', { friendly_name: 'Sky' }) });
r.track = circ('lock.f', { 'lock.f': S('locked', { friendly_name: 'Front Door' }) }).html.match(/stroke-dasharray/g).length;
print(JSON.stringify(r));
""", before=FAKES)
    assert out["w"] == ["230W", "DRYER"] and out["v"] == ["5V", "DRYER"]
    assert out["kw"] == ["7.2", "kW"] and out["kwh"] == ["1,235", "kWh"] and out["ppm"] == ["412", "ppm"]
    assert out["nounit"] == ["7", "COUNT"]
    assert out["n_short"] == ["70°", "DEN"] and out["n_words"] == ["70°", "POOL"] and out["n_two"] == ["70°", "POOL SPA"]
    assert out["n_one_long"] == ["70°", "CONSERV…"] and out["n_custom"] == ["70°", "SUNROOM"] and out["n_custom_long"] == ["70°", "FREEZER"]
    assert out["lock"]["t"] == ["Locked", "FRONT"] and out["door"]["t"] == ["Open", "GARAGE"] and out["motion"]["t"] == ["Clear", "HALL"]
    assert out["unlocked"]["t"] == ["Unlocked", "FRONT"]
    assert len(out["long_state"]["t"][0]) <= 9 and out["long_state"]["t"][0].endswith("…")
    assert out["lock"]["f"] is None and out["door"]["f"] is None                  # words: the track alone
    assert out["track"] == 1


def test_rectangular_shows_two_sensors(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var ST = {
  'sensor.pool': S(78.4, { unit_of_measurement: '°F', device_class: 'temperature', friendly_name: 'Pool' }),
  'lock.front': S('locked', { friendly_name: 'Front Door' }),
  'sensor.kw': S(2.1, { unit_of_measurement: 'kW', device_class: 'power', friendly_name: 'Solar' }),
  'sensor.bat': S(15, { unit_of_measurement: '%', device_class: 'battery', friendly_name: 'Remote' })
};
function rows(o, st) {
  var x = show('rectangular', o, house(st || ST));
  var re = /<div class="sxr"><div class="sxn">(.*?)<\/div><div class="sxv a"([^>]*)>(.*?)<\/div><\/div>/g, out = [], m;
  while ((m = re.exec(x.html))) out.push({ n: m[1], style: m[2], v: m[3] });
  return { rows: out, acc: x.acc, html: x.html };
}
r.two = rows({ entity: 'sensor.pool', entity2: 'lock.front' });
r.units = rows({ entity: 'sensor.kw', entity2: 'sensor.bat' });
r.named = rows({ entity: 'sensor.pool', entity2: 'lock.front', name: 'Spa' });
r.one = rows({ entity: 'lock.front' });
r.only2 = rows({ entity2: 'lock.front' });
r.down = rows({ entity: 'sensor.pool', entity2: 'sensor.gone' });
r.none = rows({});
print(JSON.stringify(r));
""", before=FAKES)
    two = out["two"]["rows"]
    assert [x["n"] for x in two] == ["Pool", "Front Door"] and [x["v"] for x in two] == ["78°", "Locked"]
    assert "--sw-acc" in two[0]["style"] and "--sw-acc" in two[1]["style"] and two[0]["style"] != two[1]["style"]     # each row its own color
    assert out["two"]["acc"] is None                                       # (the rows carry it, not the piece)
    units = out["units"]["rows"]
    assert units[0]["v"] == "2.1<small>kW</small>" and units[1]["v"] == "15%"                # a unit after the figure is small; a % or ° hugs it
    assert [x["n"] for x in out["named"]["rows"]] == ["Spa", "Front Door"]                  # the name is the first row's
    assert len(out["one"]["rows"]) == 1 and out["one"]["rows"][0]["n"] == "Front Door"
    assert len(out["only2"]["rows"]) == 1 and out["only2"]["rows"][0]["n"] == "Front Door"
    assert [x["v"] for x in out["down"]["rows"]] == ["78°", "—"] and out["down"]["rows"][1]["n"] == "Gone"
    assert out["none"]["rows"][0]["v"] == "—" and len(out["none"]["rows"]) == 1
    for k in ("two", "units", "one"):
        assert 'class="sxc"' in out[k]["html"] and 'class="a"' not in out[k]["html"]


def test_unknown_and_unavailable_are_a_dash(tmp_path):
    out = run(tmp_path, r"""
var r = {};
['unavailable', 'unknown', ''].forEach(function (state) {
  var st = { 'sensor.p': S(state, { unit_of_measurement: '°F', device_class: 'temperature', friendly_name: 'Pool' }) };
  var i = inline('sensor.p', st), c = circ('sensor.p', st), x = show('rectangular', { entity: 'sensor.p', entity2: 'sensor.p' }, house(st));
  r[state || 'empty'] = { i: i.t, iacc: i.acc, c: c.t, f: fracOf(c.html), cacc: c.acc, x: text(x.html), blank: i.blank };
});
// a binary sensor and a lock the same
var b = { 'binary_sensor.d': S('unavailable', { device_class: 'door', friendly_name: 'Door' }), 'lock.f': S('unknown', { friendly_name: 'Front' }) };
r.door = inline('binary_sensor.d', b); r.lockc = circ('lock.f', b);
// an entity the house does not have: its name from its id, a dash
r.missing = inline('sensor.back_porch', {});
r.missing_c = circ('sensor.back_porch', {});
// no word like "Unavailable" or "Unknown" is ever drawn
r.words = JSON.stringify([r.unavailable, r.unknown, r.door, r.lockc]);
print(JSON.stringify(r));
""", before=FAKES)
    for k in ("unavailable", "unknown", "empty"):
        assert out[k]["i"] == "Pool —" and out[k]["iacc"] is None and out[k]["blank"] is False, k
        assert out[k]["c"] == ["—", "POOL"] and out[k]["f"] is None and out[k]["cacc"] is None, k
        assert out[k]["x"] == ["Pool", "—", "Pool", "—"], k
    assert out["door"]["t"] == "Door —" and out["lockc"]["t"] == ["—", "FRONT"]
    assert out["missing"]["t"] == "Back Porch —" and out["missing_c"]["t"] == ["—", "BACK"]
    assert "navailable" not in out["words"] and "nknown" not in out["words"]


def test_the_accent_follows_the_device_class(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var GREEN = '#5fd38a', AMBER = '#ffb340', RED = '#ff6b5e';
function acc(id, state, attrs, units) {
  var c = {}; c[id] = S(state, attrs);
  var i = show('inline', { entity: id }, house(c, units)), k = show('circular', { entity: id }, house(c, units));
  return { i: i.acc, id: i.accd, c: k.acc };
}
var temp = function (v, u) { return acc('sensor.t', v, { device_class: 'temperature', unit_of_measurement: u || '°F' }, u || '°F'); };
r.cold = temp(15); r.cool = temp(40); r.mild = temp(62); r.warm = temp(80); r.hot = temp(98);
r.cold_c = temp(-9.4, '°C'); r.hot_c = temp(37, '°C');                         // 15 F and 98.6 F
r.deg_only = acc('sensor.t', 90, { unit_of_measurement: '°F' });             // a degree unit with no class is a temperature too
r.climate = acc('climate.t', 'heat', { current_temperature: 80 });
r.bat100 = acc('sensor.b', 100, { device_class: 'battery' }); r.bat60 = acc('sensor.b', 60, { device_class: 'battery' });
r.bat35 = acc('sensor.b', 35, { device_class: 'battery' }); r.bat15 = acc('sensor.b', 15, { device_class: 'battery' }); r.bat5 = acc('sensor.b', 5, { device_class: 'battery' });
r.power = acc('sensor.p', 450, { device_class: 'power', unit_of_measurement: 'W' });
r.energy = acc('sensor.e', 12, { device_class: 'energy', unit_of_measurement: 'kWh' });
r.door_open = acc('binary_sensor.d', 'on', { device_class: 'door' }); r.door_shut = acc('binary_sensor.d', 'off', { device_class: 'door' });
r.garage_open = acc('binary_sensor.g', 'on', { device_class: 'garage_door' }); r.window_shut = acc('binary_sensor.w', 'off', { device_class: 'window' });
r.opening_open = acc('binary_sensor.m', 'on', { device_class: 'opening' });
r.lock_locked = acc('lock.l', 'locked', {}); r.lock_unlocked = acc('lock.l', 'unlocked', {}); r.lock_jammed = acc('lock.l', 'jammed', {});
r.cover_open = acc('cover.g', 'open', { device_class: 'garage' }); r.cover_closed = acc('cover.g', 'closed', { device_class: 'garage' });
r.blind_open = acc('cover.b', 'open', {});
r.bin_lock_on = acc('binary_sensor.l', 'on', { device_class: 'lock' }); r.bin_lock_off = acc('binary_sensor.l', 'off', { device_class: 'lock' });
r.smoke_on = acc('binary_sensor.s', 'on', { device_class: 'smoke' }); r.smoke_off = acc('binary_sensor.s', 'off', { device_class: 'smoke' });
r.wet_on = acc('binary_sensor.w', 'on', { device_class: 'moisture' });
r.lowbat_on = acc('binary_sensor.b', 'on', { device_class: 'battery' }); r.lowbat_off = acc('binary_sensor.b', 'off', { device_class: 'battery' });
// anything else: the ink (no accent)
r.motion = acc('binary_sensor.m', 'on', { device_class: 'motion' });
r.plain = acc('sensor.x', 12, { unit_of_measurement: 'ppm' });
r.hum = acc('sensor.h', 40, { device_class: 'humidity', unit_of_measurement: '%' });
r.sw = acc('switch.s', 'on', {});
r.words = acc('sensor.w', 'sunny', {});
r.gone = acc('lock.l', 'unavailable', {});
r.tc15 = W._.tempAcc(15); r.tc80 = W._.tempAcc(80); r.tc98 = W._.tempAcc(98); r.tc99 = W._.tempAcc(99);
print(JSON.stringify(r));
""", before=FAKES)
    G, A, R = "#5fd38a", "#ffb340", "#ff6b5e"
    for k in ("cold", "cool", "mild", "warm", "hot"):
        assert out[k]["i"] and out[k]["i"] == out[k]["c"], k                 # the glyph and the ring share it
    assert out["cold"]["i"] != out["mild"]["i"] != out["hot"]["i"] and out["cold"]["i"] != out["hot"]["i"]
    assert out["cold"]["i"] == out["tc15"][0] and out["cold"]["id"] == out["tc15"][1]       # the renderer's own tempAcc, by degrees F
    assert out["warm"]["i"] == out["tc80"][0] and out["hot"]["i"] == out["tc98"][0]
    assert out["cold_c"]["i"] == out["tc15"][0] and out["hot_c"]["i"] == out["tc99"][0]      # -9.4 C is 15 F; 37 C is 98.6 F (99)
    assert out["deg_only"]["i"] and out["climate"]["i"] and out["climate"]["i"] == out["warm"]["i"]
    assert out["bat100"]["i"] == G and out["bat60"]["i"] != G and out["bat60"]["i"] not in (A, R)
    assert out["bat35"]["i"] not in (G, R) and out["bat15"]["i"] != G and out["bat5"]["i"] == R
    assert len({out[k]["i"] for k in ("bat100", "bat60", "bat35", "bat15", "bat5")}) == 5            # a ramp, not a switch
    assert out["power"]["i"] == A and out["energy"]["i"] == A
    for k in ("door_shut", "window_shut", "lock_locked", "cover_closed", "bin_lock_off", "lowbat_off"):
        assert out[k]["i"] == G and out[k]["c"] == G, k
    for k in ("door_open", "garage_open", "opening_open", "lock_unlocked", "cover_open", "bin_lock_on"):
        assert out[k]["i"] == A and out[k]["c"] == A, k
    assert out["lock_jammed"]["i"] == R and out["smoke_on"]["i"] == R and out["wet_on"]["i"] == R and out["lowbat_on"]["i"] == R
    for k in ("smoke_off", "motion", "plain", "hum", "sw", "words", "gone", "blind_open"):
        assert out[k]["i"] is None and out[k]["c"] is None, k


def test_a_bad_house_does_not_throw(tmp_path):
    out = run(tmp_path, r"""
var res = [], errors = [];
var houses = [
  { states: { 'sensor.p': null, 'lock.l': 5, 'climate.c': { state: 'heat', attributes: null }, 'cover.v': { state: 'open', attributes: { current_position: 'x' } } } },
  { states: undefined }, null, {}, { states: { 'sensor.p': { state: undefined, attributes: { unit_of_measurement: 7, device_class: {}, icon: 5 } } } },
  { states: { 'sensor.p': { state: 'NaN', attributes: { unit_of_measurement: '°F' } }, 'climate.c': { state: 'heat', attributes: { current_temperature: 'warm', min_temp: 'x' } } } },
  { states: { 'sensor.p': { state: '1e400', attributes: { suggested_display_precision: 99 } } }, config: { unit_system: 3 } }
];
var optsList = [{}, { entity: 'sensor.p', entity2: 'lock.l', min: 'a', max: 5 }, { entity: 'climate.c', entity2: 'cover.v', name: '   ' }, { entity: 'sensor.p', min: 7, max: {} }];
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    houses.forEach(function (c, i) {
      optsList.forEach(function (o, j) {
        try { var w = mk(s, o); w.update(c, T0); res.push(w.el.innerHTML.length); w.measure(); w.destroy(); }
        catch (e) { errors.push(s + '/' + i + '/' + j + ': ' + e); }
      });
    });
  });
});
print(JSON.stringify({ res: res.length, errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))     # (the header says what it does not use)
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "setInterval", "requestAnimationFrame", "setTimeout", "Mantel"):
        assert word not in code, word
    # American English, and nothing that wakes a read: no summary, no waker, no timer
    for word in ("colour", "centre", "grey", "favourite"):
        assert word not in src.lower(), word
    assert "requestUpdate" not in code and "hkStats" not in code and "hkEnergy" not in code and "waker" not in code
    # the only CSS is the rectangular rows', through the renderer's one sheet, on the spacing scale (.4 .8 1.2 1.6 2.4 3.2) or a size
    assert "addCss" in code
    import re
    css = re.search(r"var CSS = \[(.*?)\]\.join", src, re.S).group(1)
    for n in re.findall(r"var\(--u\) \* ([\d.]+)", css):
        assert n in {".4", "1.2", "1.6", "2.2", "2.8", "4.6"}, n


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
