"""The screensaver's pieces (web/hk/modules/hk-saverwidgets.js; docs/phase13/PIECES-SPEC.md, "The renderer"): every piece
in every shape creates, reads an empty house and a small one, and draws; the library's samples draw; the old widget ids
still work; a "shows when" piece says when it shows; and the look keeps the plan's rules (nothing animates, nothing
blurs). Run under macOS's JavaScriptCore with a minimal DOM written here."""
import json
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "web/hk/modules/hk-saverwidgets.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

# a document with just enough of an element: what hk-saverwidgets.js touches, and no layout (offsetWidth 0)
SHIM = r"""
var window = this;
var console = { warn: function () { WARNS.push(Array.prototype.slice.call(arguments).join(' ')); }, log: function () {}, error: function () {} };
var WARNS = [];
function setTimeout(f) { return 1; }
function clearTimeout() {}
function makeEl(tag) {
  var props = {};
  var el = {
    tagName: tag, className: '', innerHTML: '', textContent: '', attrs: {}, children: [], parentNode: null,
    firstElementChild: null, offsetWidth: 0, offsetHeight: 0,
    style: { props: props, setProperty: function (k, v) { props[k] = v; }, removeProperty: function (k) { delete props[k]; } },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild: function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  };
  return el;
}
var document = { createElement: makeEl, head: makeEl('head'), body: makeEl('body') };
load(FILE);
var W = window.hkSaverWidgets;
var NOW = new Date(2026, 10, 2, 19, 42, 0);
var NOTE = '';
function iso(ms) { return new Date(ms).toISOString(); }
"""


def run(tmp_path, body, before=""):
    script = tmp_path / "t.js"
    script.write_text(f"var FILE = {json.dumps(str(FILE))};\n{SHIM}\n{before}\n{body}\n")
    r = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{") or ln.startswith("[")]
    assert lines, r.stdout + r.stderr
    return json.loads(lines[-1])


# a small house: the sun, a timer running, a lock open, a weather entity (hkWxReadings does not exist under jsc, so the
# weather pieces draw dashes -- and must not throw)
SMALL_HOUSE = r"""
var HOUSE = { states: {
  'sun.sun': { state: 'above_horizon', attributes: { next_setting: iso(+NOW + 3600000), next_rising: iso(+NOW + 40000000) } },
  'sensor.running_quick_timers': { state: '1', attributes: { running: [{ name: 'Pasta', finishes_at: iso(+NOW + 252000), total: 600 }] } },
  'lock.front': { state: 'unlocked', attributes: {} },
  'weather.home': { state: 'cloudy', attributes: { temperature: 64, temperature_unit: '°F', humidity: 58 } }
}, config: { unit_system: { temperature: '°F' } } };
var EMPTY = { states: {} };
"""

CTX = r"""
var CTX = { title: 'Lake Weekend · 2024', events: [{ title: 'Piano Lesson', start: iso(+NOW + 3600000), end: iso(+NOW + 7200000), cal: 'calendar.family' },
                                                  { title: 'Dinner', start: iso(+NOW + 10800000), end: iso(+NOW + 14400000), cal: 'calendar.family' }],
            music: { idle: false, playing: true, title: 'Night Harbor', artist: 'The Fictional Trio', room: 'Kitchen', pic: '/art/1.jpg' },
            face: { font: '"Playfair Display", serif' } };
"""

# every piece and shape with each of its choices (the readings' and the energy's circles, the readings' pair)
VARIANTS = r"""
function variants() {
  var out = [];
  Object.keys(W.PIECES).forEach(function (p) {
    var d = W.PIECES[p];
    Object.keys(d.shapes).forEach(function (s) {
      var opts = [{}];
      if (p === 'readings' && s === 'circular') opts = d.opts.reading.map(function (r) { return { reading: r }; });
      if (p === 'energy' && s === 'circular') opts = d.opts.reading.map(function (r) { return { reading: r }; });
      if (p === 'readings' && s === 'rectangular') opts = [{}, { readings: ['wind', 'sunset'] }, { readings: ['inside', 'bogus'] }];
      opts.forEach(function (o) { out.push([p, s, o]); });
    });
  });
  return out;
}
"""


def test_every_piece_and_shape_creates_and_draws(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
variants().forEach(function (v) {
  [EMPTY, HOUSE].forEach(function (h, hi) {
    [undefined, CTX].forEach(function (c, ci) {
      try {
        var w = W.create(v[0], v[1], { u: 4, back: ['none', 'glass', 'tint'][(hi + ci) % 3], color: ci ? 'accent' : 'auto', h24: !!hi, opts: v[2] });
        if (!w) { errors.push('no create ' + v[0] + '/' + v[1]); return; }
        var drew = w.update(h, NOW, c);
        var again = w.update(h, NOW, c);                    // the same house at the same minute: nothing is written again
        var m = w.measure();
        results.push({ p: v[0], s: v[1], kind: w.kind, piece: w.piece, shape: w.shape, drew: drew, again: again, html: w.el.innerHTML.length,
                       showing: w.showing, live: w.live, w: m.w, h: m.h, cls: w.el.className });
        w.setU(5);
        w.destroy();
      } catch (e) { errors.push(v[0] + '/' + v[1] + ': ' + e + ' ' + (e && e.stack)); }
    });
  });
});
print(JSON.stringify({ n: variants().length, results: results, errors: errors, warns: WARNS }));
""", before=SMALL_HOUSE + CTX + VARIANTS)
    assert out["errors"] == [] and out["warns"] == []
    assert out["n"] >= 25
    for r in out["results"]:
        assert r["kind"] == r["shape"] and r["piece"] == r["p"] and r["shape"] == r["s"]
        assert r["again"] is False, r                        # redraw only when the spec's JSON changes
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"]
        assert r["h"] >= 0 and r["w"] >= 0
    # a piece that always shows draws something with an empty house too (dashes): only the "shows when" ones may be empty
    for r in out["results"]:
        if r["showing"]:
            assert r["html"] > 0, r


def test_the_declarations_are_complete(tmp_path):
    out = run(tmp_path, r"""
var P = {};
Object.keys(W.PIECES).forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
           accent: typeof d.accent, shapes: Object.keys(d.shapes) };
});
print(JSON.stringify({ P: P, shapes: W.SHAPES }));
""")
    P = out["P"]
    assert set(P) == {"weather", "readings", "date", "time", "status", "music", "timers", "events", "energy", "title"}
    want = {
        "weather": {"inline", "circular", "rectangular", "card", "band"},
        "readings": {"circular", "rectangular", "band"},
        "date": {"inline"}, "time": {"inline", "card"}, "status": {"inline", "circular", "rectangular", "card"},
        "music": {"inline", "card"}, "timers": {"circular", "card"}, "events": {"inline", "rectangular"},
        "energy": {"circular", "rectangular"}, "title": {"inline"},
    }
    for k, shapes in want.items():
        assert set(P[k]["shapes"]) == shapes, k
        assert P[k]["wave"] == "now" and P[k]["facts"] and P[k]["name"] and P[k]["group"] and P[k]["wakes"]
        assert P[k]["pick"] is None and P[k]["off"] is False
    assert P["music"]["when"] == "while music plays" and P["timers"]["when"]
    assert all(P[k]["when"] is None for k in P if k not in ("music", "timers"))
    assert P["readings"]["opts"]["reading"] == ["humidity", "aqi", "inside", "sunset", "wind"]
    assert P["energy"]["opts"]["reading"] == ["battery", "solar"]


def test_every_sample_draws_with_no_house(tmp_path):
    out = run(tmp_path, r"""
var errors = [], got = [];
variants().forEach(function (v) {
  try {
    var el = W.sample(v[0], v[1], { u: 4, opts: v[2], back: 'glass' });
    got.push([v[0], v[1], el.innerHTML.length, el.className, !!el.style.props['--sw-acc']]);
  } catch (e) { errors.push(v[0] + '/' + v[1] + ': ' + e); }
});
var texts = {
  weather_inline: W.sample('weather', 'inline').innerHTML, weather_card: W.sample('weather', 'card').innerHTML, weather_band: W.sample('weather', 'band').innerHTML,
  music_card: W.sample('music', 'card').innerHTML, music_inline: W.sample('music', 'inline').innerHTML, timers_circ: W.sample('timers', 'circular').innerHTML,
  timers_card: W.sample('timers', 'card').innerHTML, events_rect: W.sample('events', 'rectangular').innerHTML, battery: W.sample('energy', 'circular').innerHTML,
  date: W.sample('date', 'inline').innerHTML, status_card: W.sample('status', 'card').innerHTML, readings_band: W.sample('readings', 'band').innerHTML
};
print(JSON.stringify({ errors: errors, got: got, texts: texts, none: W.sample('weather', 'nope') }));
""", before=VARIANTS)
    assert out["errors"] == [] and out["none"] is None
    for p, s, n, cls, acc in out["got"]:
        assert n > 0 and "k-" + s in cls and "b-glass" in cls, (p, s)
        # (the pieces with an accent of their own set it on the element; the pair and the row set one on each reading, the rest have none)
        if (p, s) in (("weather", "circular"), ("weather", "card"), ("timers", "circular"), ("timers", "card"), ("energy", "circular"),
                      ("status", "card"), ("status", "circular"), ("readings", "circular"), ("events", "rectangular"), ("events", "inline")):
            assert acc, (p, s)
        if p in ("date", "title", "time", "music"):
            assert not acc, (p, s)
    t = out["texts"]
    assert "64°" in t["weather_inline"] and "Cloudy" in t["weather_inline"]
    assert "H 72°" in t["weather_card"] and "L 55°" in t["weather_card"]
    assert t["weather_band"].count('class="fc"') + t["weather_band"].count('class="fc dy"') == 10                       # six hours and four days
    assert "Night Harbor" in t["music_card"] and "The Fictional Trio" in t["music_card"] and "<img" not in t["music_card"]
    assert "Night Harbor" in t["music_inline"]
    assert "4:12" in t["timers_circ"] and "Pasta" in t["timers_card"]
    assert "Piano Lesson" in t["events_rect"] and "3:30 PM" in t["events_rect"]
    assert "84%" in t["battery"]
    assert "Monday, November 2" in t["date"]
    assert "Secured" in t["status_card"] and "Armed Away" in t["status_card"]
    assert "Sunset" in t["readings_band"] and "AQI" in t["readings_band"]


def test_the_v1_ids_still_create(tmp_path):
    out = run(tmp_path, r"""
var res = {}, errors = [];
W.IDS.forEach(function (id) {
  try {
    var w = W.create(id, { u: 4, back: 'glass', color: 'white', h24: false });
    var drew = w.update(HOUSE, NOW, CTX);
    res[id] = [w.id, w.piece, w.shape, w.kind, W.kind(id), W.has(id), w.el.className, w.el.innerHTML.length];
  } catch (e) { errors.push(id + ': ' + e); }
});
var cards = {};
['clock_card', 'music_card', 'timers_card', 'weather_card', 'status_card', 'forecast_band'].forEach(function (id) {
  var w = W.create(id, { u: 4 }); cards[id] = w ? [w.piece, w.shape] : null;
});
print(JSON.stringify({ res: res, errors: errors, ids: W.IDS, cards: cards, nope: W.create('nope', { u: 4 }), has: [W.has('weather', 'card'), W.has('weather', 'nope'), W.has('nope', 'inline'), W.has('nope')] }));
""", before=SMALL_HOUSE + CTX)
    assert out["errors"] == []
    want = {
        "temp": ("weather", "circular"), "aqi": ("readings", "circular"), "humidity": ("readings", "circular"), "inside": ("readings", "circular"),
        "sunset": ("readings", "circular"), "battery": ("energy", "circular"), "solar": ("energy", "circular"), "timer": ("timers", "circular"),
        "locks": ("status", "circular"), "next_event": ("events", "rectangular"), "next_hours": ("weather", "rectangular"),
        "home_status": ("status", "rectangular"), "energy_today": ("energy", "rectangular"), "date": ("date", "inline"),
        "weather_line": ("weather", "inline"), "status_line": ("status", "inline"), "event_line": ("events", "inline"),
        "photo_title": ("title", "inline"), "readings": ("readings", "band"),
    }
    assert set(out["ids"]) == set(want)
    for id_, (piece, shape) in want.items():
        got = out["res"][id_]
        assert got[:5] == [id_, piece, shape, shape, shape] and got[5] is True and "c-auto" in got[6] and got[7] > 0, (id_, got)
    assert out["cards"] == {"clock_card": ["time", "card"], "music_card": ["music", "card"], "timers_card": ["timers", "card"],
                            "weather_card": ["weather", "card"], "status_card": ["status", "card"], "forecast_band": ["weather", "band"]}
    assert out["nope"] is None and out["has"] == [True, False, False, False]


def test_a_shows_when_piece_says_when_it_shows(tmp_path):
    out = run(tmp_path, r"""
var r = {};
['inline', 'card'].forEach(function (s) {
  var m = W.create('music', s, { u: 4 });
  r['before_' + s] = m.showing;
  m.update(EMPTY, NOW, undefined); r['none_' + s] = [m.showing, m.el.innerHTML];
  m.update(EMPTY, NOW, { music: null }); r['null_' + s] = m.showing;
  m.update(EMPTY, NOW, { music: { idle: true, key: 'media_player.kitchen', room: 'Kitchen' } }); r['idle_' + s] = m.showing;
  m.update(EMPTY, NOW, { music: { idle: false, title: '', artist: 'x' } }); r['notitle_' + s] = m.showing;
  m.update(EMPTY, NOW, CTX); r['with_' + s] = [m.showing, m.el.innerHTML];
  m.update(EMPTY, NOW, undefined); r['gone_' + s] = [m.showing, m.el.innerHTML];
});
var t = W.create('timers', 'circular', { u: 4 });
t.update(EMPTY, NOW); r.t_none = [t.showing, t.live];
t.update(HOUSE, NOW); r.t_run = [t.showing, t.live, t.el.innerHTML.indexOf('4:12') >= 0];
var tc = W.create('timers', 'card', { u: 4 });
tc.update(EMPTY, NOW); r.tc_none = [tc.showing, tc.live];
tc.update(HOUSE, NOW); r.tc_run = [tc.showing, tc.live, tc.el.innerHTML.indexOf('Pasta') >= 0];
var always = W.create('weather', 'inline', { u: 4 }); always.update(EMPTY, NOW); r.always = always.showing;
print(JSON.stringify(r));
""", before=SMALL_HOUSE + CTX)
    for s in ("inline", "card"):
        assert out["none_" + s][0] is False and out["none_" + s][1] == ""
        assert out["null_" + s] is False and out["idle_" + s] is False and out["notitle_" + s] is False
        assert out["with_" + s][0] is True and "Night Harbor" in out["with_" + s][1]
        assert out["gone_" + s] == [False, ""]
    assert 'src="/art/1.jpg"' in out["with_card"][1] and "Kitchen" in out["with_card"][1]
    assert out["before_inline"] is False
    assert out["t_none"] == [False, False] and out["t_run"] == [True, True, True]
    assert out["tc_none"] == [False, False] and out["tc_run"] == [True, True, True]
    assert out["always"] is True


FAKES = r"""
var calls = [], released = [], WXV = { entity: 'weather.home', temp: 64, unit: 'F', cond: 'cloudy', says: 'Cloudy', hi: 72, lo: 55, sunset: new Date(2026, 10, 2, 17, 12),
  wind: 8, windUnit: 'mph', humidity: 58, aqi: 42, place: 'Home' };
var HOURLY = [], DAILY = [];
for (var i = 1; i <= 8; i++) HOURLY.push({ datetime: iso(+NOW + i * 3600000), condition: i > 3 ? 'rainy' : 'partlycloudy', temperature: 64 - i });
for (var d = 0; d <= 5; d++) { var dt = new Date(2026, 10, 2 + d); DAILY.push({ datetime: dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2) + 'T00:00:00-05:00', condition: 'sunny', temperature: 70 + d, templow: 50 + d }); }
window.hkWxReadings = { read: function () { return WXV; } };
window.hkWxForecast = { watch: function (subs, kind, entity, cb) {
  calls.push(kind + '|' + entity);
  return { data: function () { return kind === 'hourly' ? HOURLY : DAILY; }, ensure: function () {}, release: function () { released.push(kind); } };
} };
window.hkHeader = { status: function () { return { secured: false, items: ['Front Door', 'Garage Door', 'Back Door'], alarmRaw: 'armed_home' }; },
                    lists: function () { return { locks: ['lock.front'] }; }, nightAt: function () { return false; } };
var CL = { states: { 'sun.sun': { state: 'above_horizon', attributes: { next_setting: iso(+NOW + 3600000), next_rising: iso(+NOW + 40000000) } },
                     'lock.front': { state: 'unlocked', attributes: {} } }, config: { unit_system: { temperature: '°F' } }, subscriptions: {} };
"""


def test_pieces_read_the_weather_and_the_house(tmp_path):
    """With the weather's readings and forecasts in (fakes for hkWxReadings, hkWxForecast and hkHeader): the figures, the band's
    six hours and four days from the two forecasts, one watcher per kind let go of on destroy, and the accents."""
    out = run(tmp_path, r"""
var r = {};
var band = W.create('weather', 'band', { u: 4 }); band.update(CL, NOW);
r.band = band.el.innerHTML; r.band_calls = calls.slice(); r.band_acc = band.el.style.props['--sw-acc'];
band.update(CL, NOW); r.band_calls_after = calls.length;
band.destroy(); r.released = released.slice();
var circ = W.create('weather', 'circular', { u: 4 }); circ.update(CL, NOW); r.circ = circ.el.innerHTML; r.circ_calls = calls.slice(r.band_calls.length);
var card = W.create('weather', 'card', { u: 4 }); card.update(CL, NOW); r.card = card.el.innerHTML;
var line = W.create('weather', 'inline', { u: 4 }); line.update(CL, NOW); r.line = line.el.innerHTML; r.line_w = line.measure().w;
var rect = W.create('weather', 'rectangular', { u: 4 }); rect.update(CL, NOW); r.rect = rect.el.innerHTML;
var hum = W.create('readings', 'circular', { u: 4, opts: { reading: 'aqi' } }); hum.update(CL, NOW); r.aqi = hum.el.innerHTML; r.aqi_acc = hum.el.style.props['--sw-acc'];
var wind = W.create('readings', 'circular', { u: 4, opts: { reading: 'wind' } }); wind.update(CL, NOW); r.wind = wind.el.innerHTML;
var pair = W.create('readings', 'rectangular', { u: 4 }); pair.update(CL, NOW); r.pair = pair.el.innerHTML;
var rb = W.create('readings', 'band', { u: 4 }); rb.update(CL, NOW); r.rb = rb.el.innerHTML; r.rb_w = rb.measure().w;
var sc = W.create('status', 'card', { u: 4 }); sc.update(CL, NOW); r.sc = sc.el.innerHTML; r.sc_acc = sc.el.style.props['--sw-acc'];
var si = W.create('status', 'inline', { u: 4 }); si.update(CL, NOW); r.si = si.el.innerHTML;
var lk = W.create('status', 'circular', { u: 4 }); lk.update(CL, NOW); r.lk = lk.el.innerHTML; r.lk_acc = lk.el.style.props['--sw-acc'];
var tf = W.create('time', 'card', { u: 4, h24: false }); tf.update(CL, NOW, CTX); r.tcard = tf.el.innerHTML;
var ti = W.create('time', 'inline', { u: 4, h24: true }); ti.update(CL, NOW, undefined); r.tinl = ti.el.innerHTML;
var ev = W.create('events', 'rectangular', { u: 4 }); ev.update(CL, NOW, CTX); r.ev = ev.el.innerHTML;
r.warns = WARNS;
print(JSON.stringify(r));
""", before=SMALL_HOUSE + CTX + FAKES)
    assert out["warns"] == []
    assert out["band"].count('class="fc"') + out["band"].count('class="fc dy"') == 10
    assert "64°" in out["band"] and "Cloudy" in out["band"] and "8 PM" in out["band"] and "Tue" in out["band"] and "Fri" in out["band"]
    assert "Mon" not in out["band"]                                         # today is the Today block, not a day
    assert sorted(out["band_calls"]) == ["daily|weather.home", "hourly|weather.home"]
    assert out["band_calls_after"] == 2                                     # watched once each
    assert sorted(out["released"]) == ["daily", "hourly"]
    assert out["band_acc"] and out["band_acc"].startswith("#")
    assert out["circ_calls"] == ["daily|weather.home"]
    assert "64°" in out["circ"] and ">72<" in out["circ"] and ">55<" in out["circ"]
    assert "H 72°" in out["card"] and "L 55°" in out["card"] and "Cloudy" in out["card"] and 'class="g"' in out["card"]
    assert "64° Cloudy" in out["line"] and out["line_w"] > 0
    assert "Now" in out["rect"] and "8 PM" in out["rect"] and "9 PM" in out["rect"]
    assert ">42<" in out["aqi"] and out["aqi_acc"] == "#5fd38a"             # good air: green
    assert ">8<" in out["wind"] and "MPH" in out["wind"]
    assert "Humidity" in out["pair"] and "58%" in out["pair"] and "AQI" in out["pair"] and "--sw-acc" in out["pair"]
    assert "Sunset" in out["rb"] and "8 mph" in out["rb"] and out["rb_w"] > 0
    assert "Armed Home" in out["sc"] and "Front Door" in out["sc"] and "Garage Door" in out["sc"] and "Back Door" not in out["sc"]
    assert out["sc_acc"] == "#ffb340"                                       # something open: amber
    assert "Front Door" in out["si"] and "dot a" in out["si"]
    assert "1 Unlocked" in out["lk"] and out["lk_acc"] == "#ffb340"
    assert "7:42" in out["tcard"] and "Monday, November 2" in out["tcard"] and "Playfair Display" in out["tcard"]
    assert "19:42" in out["tinl"] and "font-family" not in out["tinl"]
    assert "Piano Lesson" in out["ev"] and "Dinner" in out["ev"]


def test_define_adds_a_piece_after_load(tmp_path):
    out = run(tmp_path, r"""
var before = W.has('uv', 'circular');
var bad = W.define('x', { shapes: {} });
var d = W.define('uv', { name: 'UV', group: 'Weather and Sky', facts: ['uv'], source: 'hkWxReadings', wakes: ['house'], opts: {}, accent: ['#ffd166', '#c98a00'],
  shapes: { circular: { read: function (X) { return { main: '3' }; }, draw: function (s) { return W._.ring({ main: s.main, sub: 'UV' }); }, sample: { main: '3' } } } });
var w = W.create('uv', 'circular', { u: 4 }); w.update(EMPTY, NOW);
print(JSON.stringify({ before: before, bad: bad, after: W.has('uv', 'circular'), wave: d.wave, html: w.el.innerHTML.indexOf('>UV<') >= 0, acc: w.el.style.props['--sw-acc'],
                       samp: W.sample('uv', 'circular').innerHTML.length > 0, listed: Object.keys(W.PIECES).indexOf('uv') >= 0 }));
""", before=SMALL_HOUSE)
    assert out == {"before": False, "bad": None, "after": True, "wave": "now", "html": True, "acc": "#ffd166", "samp": True, "listed": True}


def test_an_inline_piece_with_a_backdrop_is_a_pill(tmp_path):
    """The owner, 2026-11-02, on the "Piano Lesson" pill: "needs more spacing / buffer around the text": 4.8 u tall with a backdrop
    (1.2 u over and under the words, 2.4 u at each end, 1.8 u on the glyph's side), 3.6 u without; a card is as tall as it draws."""
    out = run(tmp_path, r"""
var r = {};
['none', 'glass', 'tint'].forEach(function (b) {
  var w = W.create('events', 'inline', { u: 10, back: b }); w.update(HOUSE, NOW, CTX); r['ev_' + b] = w.measure();
  var d = W.create('date', 'inline', { u: 10, back: b }); d.update(HOUSE, NOW, CTX); r['date_' + b] = d.measure();
});
var c = W.create('weather', 'card', { u: 10 }); c.update(HOUSE, NOW); r.card = c.measure();
var st = W.create('status', 'card', { u: 10 }); st.update(HOUSE, NOW); r.status = st.measure();
print(JSON.stringify(r));
""", before=SMALL_HOUSE + CTX)
    assert out["ev_none"]["h"] == 36 and out["date_none"]["h"] == 36
    assert out["ev_glass"]["h"] == 48 and out["ev_tint"]["h"] == 48 and out["date_glass"]["h"] == 48
    # (the padded width: 4.2 u around a row with a glyph, 4.8 u around words alone)
    assert out["ev_glass"]["w"] - out["ev_none"]["w"] == 42 and out["date_glass"]["w"] - out["date_none"]["w"] == 48
    assert out["card"]["w"] == 300 and out["card"]["h"] > 150 and out["status"]["w"] == 300


def test_the_spacing_scale_and_tabular_figures(tmp_path):
    import re
    css = run(tmp_path, "print(JSON.stringify({ css: W.CSS }));")["css"]
    # every padding, margin and gap in u is on the scale (2 and 2.2 the cards', .6 a title's and the glyph side's)
    allowed = {"0", ".4", ".8", "1.2", "1.6", "2", "2.2", "2.4", "3.2", ".6", "-.6"}
    seen = 0
    for decl in re.findall(r"(?:padding|margin|gap)[a-z-]*:([^;}]*)", css):
        for n in re.findall(r"var\(--u\) \* (-?[0-9.]+)", decl):
            seen += 1
            assert n in allowed, (decl, n)
    assert seen > 10
    assert "font-variant-numeric:tabular-nums" in css and "proportional-nums" not in css
    assert "padding:calc(var(--u) * 2);border-radius:calc(var(--u) * 2.2)" in css       # a card


def test_the_look_keeps_the_plans_rules(tmp_path):
    out = run(tmp_path, "print(JSON.stringify({ css: W.CSS }));")
    css = out["css"]
    for word in ("backdrop-filter", "animation", "transition", "@keyframes"):
        assert word not in css, word
    # the ink and the accents (PIECES-SPEC, "Ink and accents")
    assert "var(--sw-ink)" in css and "var(--lay-ink,var(--tint,#fff))" in css and "var(--hk-accent,#ffb38a)" in css
    assert "[data-acc]" in css and "var(--sw-acc)" in css and "var(--sw-acc-d)" in css and "[data-ink=black]" in css
    assert "rgba(255,255,255,.5)" in css                                    # black ink's Glass
    source = FILE.read_text()
    assert "setInterval" not in source and "requestAnimationFrame" not in source
    assert "Mantel" not in css


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(FILE)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
