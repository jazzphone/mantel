"""The screensaver's Time and Calendar glance pieces (web/hk/modules/hk-saverpieces-time.js; docs/phase13/GLANCE-SPEC.md, "Time and
Calendar"): Countdown, World Clock and the Calendar piece's Card shape. Run under macOS's JavaScriptCore with the same minimal DOM
as tests/test_saverwidgets_pieces.py, with the renderer loaded first and the group's file after it."""
import json
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "web/hk/modules/hk-saverwidgets.js"
FILE = ROOT / "web/hk/modules/hk-saverpieces-time.js"
LAYOUT = ROOT / "web/hk/modules/hk-saverlayout.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

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
load(RENDERER);
if (!window.NOGROUP) load(FILE);
var W = window.hkSaverWidgets;
var NOW = new Date(2026, 10, 2, 19, 42, 0);              // Monday, November 2, 7:42 PM (the house's clock)
function iso(ms) { return new Date(ms).toISOString(); }
function at(m, d, h, mi) { return new Date(2026, m - 1, d, h || 0, mi || 0, 0); }
var EMPTY = { states: {} };
var CL = { states: { 'calendar.family': { state: 'off', attributes: { friendly_name: 'Family' } } }, config: {}, subscriptions: {} };

// the calendar: all-day events (the end is the day after), timed ones, and some of today's
var CALEVS = [
  { cal: 'calendar.family', title: 'Dentist', allDay: true, start: at(11, 3), end: at(11, 4) },                       // tomorrow
  { cal: 'calendar.family', title: 'Anniversary', allDay: true, start: at(11, 7), end: at(11, 8) },                  // 5 days
  { cal: 'calendar.family', title: 'Beach Trip', allDay: true, start: at(11, 14), end: at(11, 15) },                 // 12 days
  { cal: 'calendar.family', title: 'Beach Trip Dinner', start: at(11, 13, 18), end: at(11, 13, 20) },                // timed, 11 days
  { cal: 'calendar.family', title: 'Piano Lesson', start: at(11, 5, 15, 30), end: at(11, 5, 16, 30) },               // timed: never a countdown
  { cal: 'calendar.family', title: 'Team Offsite', allDay: true, start: at(11, 2), end: at(11, 3) },                 // today, all day
  { cal: 'calendar.family', title: 'Offsite Call', start: at(11, 2, 9), end: at(11, 2, 10) }                         // today, over
];
// today's, for the card (NOW is 7:42 PM): one under way, three to come, an all-day one, one already over, and tomorrow's
var TODAY = [
  { cal: 'calendar.family', title: 'Breakfast', start: at(11, 2, 8), end: at(11, 2, 9) },
  { cal: 'calendar.family', title: 'Yoga', start: at(11, 2, 19), end: at(11, 2, 20) },
  { cal: 'calendar.family', title: 'Recycling Day', allDay: true, start: at(11, 2), end: at(11, 3) },
  { cal: 'calendar.family', title: 'Late Call', start: at(11, 2, 20, 30), end: at(11, 2, 21) },
  { cal: 'calendar.family', title: 'Reading', start: at(11, 2, 21, 15), end: at(11, 2, 22) },
  { cal: 'calendar.family', title: 'Tomorrow Standup', start: at(11, 3, 8), end: at(11, 3, 8, 30) },
  { cal: 'calendar.family', title: 'Tomorrow All Day', allDay: true, start: at(11, 3), end: at(11, 4) }
];
var LOADS = [], FAIL = false;
window.hkCalendar = { ids: function () { return ['calendar.family']; },
  load: function (client, ids, from, to) {
    LOADS.push({ from: +from, to: +to, ids: ids });
    return FAIL ? Promise.reject(new Error('no calendar')) : Promise.resolve({ evs: CALEVS, failed: 0 });
  } };
window.hkLocale = { zone: function () { return 'America/New_York'; } };
window.hkSettings = { eventColor: function () { return 'blue'; } };
window.hkCards = { PALETTE: { chart: { blue: [10, 132, 255] } } };
"""


def run(tmp_path, body, before="", nogroup=False):
    script = tmp_path / "t.js"
    script.write_text(f"var RENDERER = {json.dumps(str(RENDERER))}, FILE = {json.dumps(str(FILE))};\n"
                      f"{'var NOGROUP = true;' if nogroup else ''}\n{SHIM}\n{before}\n{body}\n")
    r = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{") or ln.startswith("[")]
    assert lines, r.stdout + r.stderr
    return json.loads(lines[-1])


def strip(html):
    return re.sub(r"<[^>]+>", " ", html).replace("  ", " ")


def text(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


VARIANTS = r"""
function variants() {
  var out = [];
  [['countdown', 'inline', {}], ['countdown', 'inline', { match: 'beach' }], ['countdown', 'circular', {}], ['countdown', 'circular', { match: 'dentist' }],
   ['world', 'inline', {}], ['world', 'inline', { city: 'Asia/Kolkata' }], ['world', 'circular', {}], ['world', 'circular', { city: 'America/Argentina/Buenos_Aires' }],
   ['world', 'rectangular', {}], ['world', 'rectangular', { city: 'America/New_York', city2: 'Australia/Sydney' }], ['world', 'rectangular', { city: 'Nope/Zone' }],
   ['events', 'card', {}]].forEach(function (v) { out.push(v); });
  return out;
}
"""


# ---------------------------------------------------------------- declarations and drawing

def test_the_group_registers_its_pieces_and_keeps_the_cores_shapes(tmp_path):
    out = run(tmp_path, r"""
var P = {};
['countdown', 'world', 'events'].forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
           defaults: d.defaults, accent: typeof d.accent === 'function' ? 'fn' : d.accent, shapes: Object.keys(d.shapes).sort() };
});
print(JSON.stringify({ P: P, has: [W.has('countdown', 'inline'), W.has('countdown', 'circular'), W.has('countdown', 'rectangular'), W.has('world', 'rectangular'),
  W.has('events', 'card'), W.has('events', 'inline'), W.has('events', 'rectangular')], css: W.CSS.indexOf('.wr{') >= 0 && W.CSS.indexOf('.er{') >= 0,
  styled: document.head.children.filter(function (c) { return c.attrs['data-hk-saverpieces-time'] !== undefined; }).length, cities: W._.time.CITIES }));
""")
    P = out["P"]
    for k in ("countdown", "world"):
        assert P[k]["group"] == "Time and Calendar" and P[k]["wave"] == "A" and P[k]["name"] and P[k]["when"] is None
        assert P[k]["pick"] is None and P[k]["off"] is False and P[k]["wakes"] and P[k]["source"]
        assert isinstance(P[k]["accent"], list) and len(P[k]["accent"]) == 2 and all(re.fullmatch(r"#[0-9a-f]{6}", c) for c in P[k]["accent"])
    assert P["countdown"]["facts"] == ["countdown"] and P["world"]["facts"] == ["world"]
    assert P["countdown"]["shapes"] == ["circular", "inline"] and P["countdown"]["opts"] == {"match": "text"}
    assert P["world"]["shapes"] == ["circular", "inline", "rectangular"]
    assert P["world"]["defaults"] == {"city": "Europe/London", "city2": "Asia/Tokyo"}
    assert P["world"]["opts"]["city"] == P["world"]["opts"]["city2"] == out["cities"]
    assert "calendar" in P["countdown"]["wakes"] and "minute" in P["world"]["wakes"]
    # (the core events piece is added to, not redefined: its own shapes, name and wakes stay)
    assert P["events"]["shapes"] == ["card", "inline", "rectangular"]
    assert P["events"]["name"] == "Calendar" and P["events"]["facts"] == ["calendar"] and "calendar" in P["events"]["wakes"]
    assert out["has"] == [True, True, False, True, True, True, True]
    # (its rules join the renderer's one sheet: no stylesheet of its own)
    assert out["css"] is True and out["styled"] == 0


def test_the_cities_match_the_layouts_catalog():
    layout = LAYOUT.read_text()
    cities = re.search(r"var CITIES = \[(.*?)\];", layout, re.S).group(1)
    layout_cities = re.findall(r"'([^']+)'", cities)
    assert len(layout_cities) == 31
    # the layout's catalog line for each piece: shapes and options as this file draws them
    assert re.search(r"countdown: \[\['inline', 'circular'\], \{ match: 'text' \}", layout)
    assert re.search(r"world: \[\['inline', 'circular', 'rectangular'\], \{ city: CITIES, city2: CITIES \}", layout)
    assert re.search(r"events: \[\['inline', 'rectangular', 'card'\]", layout)
    src = FILE.read_text()
    mine = re.search(r"var CITIES = \[(.*?)\];", src, re.S).group(1)
    assert re.findall(r"'([^']+)'", mine) == layout_cities


def test_every_piece_and_shape_draws_with_an_empty_house_and_a_small_one(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
variants().forEach(function (v) {
  [EMPTY, CL].forEach(function (h, hi) {
    [undefined, { events: TODAY }].forEach(function (c, ci) {
      try {
        var w = W.create(v[0], v[1], { u: 4, back: ['none', 'glass', 'tint'][(hi + ci) % 3], color: ci ? 'accent' : 'auto', h24: !!hi, opts: v[2] });
        if (!w) { errors.push('no create ' + v[0] + '/' + v[1]); return; }
        var drew = w.update(h, NOW, c), again = w.update(h, NOW, c), m = w.measure();
        results.push({ p: v[0], s: v[1], drew: drew, again: again, html: w.el.innerHTML.length, showing: w.showing, live: w.live, w: m.w, h: m.h });
        w.setU(5);
        w.destroy();
      } catch (e) { errors.push(v[0] + '/' + v[1] + ': ' + e + ' ' + (e && e.stack)); }
    });
  });
});
print(JSON.stringify({ n: variants().length, results: results, errors: errors, warns: WARNS, loads: LOADS.length }));
""", before=VARIANTS)
    assert out["errors"] == [] and out["warns"] == []
    assert out["n"] == 12 and len(out["results"]) == 12 * 4
    for r in out["results"]:
        assert r["drew"] is True and r["again"] is False, r             # drawn once, and again only when its spec changes
        assert r["showing"] is True and r["live"] is False and r["html"] > 0, r
        assert r["w"] >= 0 and r["h"] > 0
    assert out["loads"] >= 1                                              # the countdown asked the calendar


def test_every_sample_draws_in_the_accent(tmp_path):
    out = run(tmp_path, r"""
var got = {}, errors = [];
variants().forEach(function (v) {
  try {
    var el = W.sample(v[0], v[1], { u: 4, opts: v[2], back: 'glass' });
    got[v[0] + '/' + v[1] + '/' + JSON.stringify(v[2])] = [el.innerHTML, el.className, el.style.props['--sw-acc'], el.style.props['--sw-acc-d']];
  } catch (e) { errors.push(v[0] + '/' + v[1] + ': ' + e); }
});
print(JSON.stringify({ got: got, errors: errors }));
""", before=VARIANTS)
    assert out["errors"] == []
    for key, (html, cls, acc, accd) in out["got"].items():
        assert html and "b-glass" in cls and "k-" + key.split("/")[1] in cls, key
        assert acc and accd, key
    g = out["got"]
    coral = g["countdown/inline/{}"]
    assert text(coral[0]) == "Beach Trip in 12 days" and coral[2] == "#ff9a85" and coral[3] == "#c4482e"
    c = g["countdown/circular/{}"][0]
    assert ">12<" in c and ">DAYS<" in c
    assert g["world/inline/{}"][2] == "#9aa8ff" and text(g["world/inline/{}"][0]) == "London 3:57 PM"
    assert ">LON<" in g["world/circular/{}"][0]
    r = text(g["world/rectangular/{}"][0])
    assert r == "London 3:57 PM Tokyo Tomorrow 12:57 AM"
    card = g["events/card/{}"][0]
    assert ">Today<" in card and "Piano Lesson" in card and "Recycling Day" in card and card.count('class="er') == 3
    assert g["events/card/{}"][2] == "#ff9f0a"                            # the first event's own color


# ---------------------------------------------------------------- Countdown

def test_countdown_picks(tmp_path):
    out = run(tmp_path, r"""
var T = W._.time, r = {};
function pick(m, now) { var e = T.pickCountdown(CALEVS, now || NOW, m); return e ? [e.title, e.dayN] : null; }
r.none = pick('');                                              // the next all-day event two or more days away (tomorrow's Dentist is not)
r.beach = pick('beach');                                        // the next whose title has the words, timed or not: the dinner on the 13th
r.upper = pick('  BEACH TRIP ');
r.tomorrow = pick('dentist');                                   // tomorrow's: a match takes a day away too
r.today = pick('offsite');                                      // today's all-day event, still on
r.over = pick('offsite call');                                  // today's timed event, already over: no other
r.nomatch = pick('zzz');
r.empty = [T.pickCountdown([], NOW, ''), T.pickCountdown(null, NOW, 'x')];
r.later = pick('', at(11, 5, 8));                               // two days on, the Anniversary is two days away
r.after = pick('', at(11, 20, 8));                              // nothing all-day is left
r.timed_today_before = T.pickCountdown([{ title: 'Offsite Call', start: at(11, 2, 21), end: at(11, 2, 22) }], NOW, 'offsite') && 1;
print(JSON.stringify(r));
""")
    assert out["none"] == ["Anniversary", 5]
    assert out["beach"] == ["Beach Trip Dinner", 11]
    assert out["upper"] == ["Beach Trip Dinner", 11]
    assert out["tomorrow"] == ["Dentist", 1]
    assert out["today"] == ["Team Offsite", 0]
    assert out["over"] is None and out["nomatch"] is None and out["empty"] == [None, None]
    assert out["later"] == ["Anniversary", 2]
    assert out["after"] is None
    assert out["timed_today_before"] == 1


def test_countdown_words_and_ring(tmp_path):
    """Read the pieces straight from their declarations with the calendar's events in hand: the wording for 12, 1 and 0 days, the dash
    for none, the ring's fill (a day away nearly full, 30 days or more only the track)."""
    out = run(tmp_path, r"""
var T = W._.time, r = {};
T.cd.evs = CALEVS; T.cd.at = Date.now();                        // (the shared read, as if it had landed)
function X(match, now) { return { quiet: false, client: CL, now: now || NOW, opts: { match: match }, h24: false }; }
var IN = W.PIECES.countdown.shapes.inline, CI = W.PIECES.countdown.shapes.circular;
r.i12 = IN.read(X('beach trip dinner')); r.i12b = IN.read(X('trip', at(11, 2, 8))); r.i1 = IN.read(X('dentist')); r.i0 = IN.read(X('offsite')); r.inone = IN.read(X('zzz'));
r.c = [CI.read(X('')), CI.read(X('dentist')), CI.read(X('offsite')), CI.read(X('zzz')), CI.read(X('beach trip', at(10, 1, 8)))];
r.drawn = [CI.draw(r.c[0]), CI.draw(r.c[3]), IN.draw(r.i1), IN.draw(r.inone)];
r.long = IN.read({ quiet: false, client: CL, now: NOW, opts: { match: 'long' }, h24: false });
CALEVS.push({ cal: 'calendar.family', title: 'A Very Long Name For A Trip That Does Not End Soon', allDay: true, start: at(11, 20), end: at(11, 21) });
r.long = IN.read({ quiet: false, client: CL, now: NOW, opts: { match: 'very long' }, h24: false });
print(JSON.stringify(r));
""")
    assert out["i12"] == {"text": "Beach Trip Dinner in 11 days", "gl": 1}
    assert out["i12b"]["text"] == "Beach Trip Dinner in 11 days"
    assert out["i1"] == {"text": "Dentist tomorrow", "gl": 1}
    assert out["i0"] == {"text": "Team Offsite today", "gl": 1}
    assert out["inone"] == {"text": "—"}
    anniv, dentist, offsite, none, far = out["c"]
    assert anniv == {"main": "5", "sub": "DAYS", "frac": 0.835}
    assert dentist == {"main": "1", "sub": "DAY", "frac": 0.965}
    assert offsite == {"main": "0", "sub": "DAYS", "frac": 1}
    assert none == {"main": "—", "sub": "DAYS", "frac": None}
    assert far["main"] == "43" and far["frac"] is None                  # beyond 30 days: the track alone
    ring, dash, inline, dash_inline = out["drawn"]
    assert ">5<" in ring and ">DAYS<" in ring and 'r="43"' in ring and 'stroke-width="7.5"' in ring
    assert ">DAYS<" in dash and ">—<" in dash and dash.count("stroke-dasharray") == 1      # the track only
    assert "dot a" in inline and "Dentist tomorrow" in inline and "dot" not in dash_inline
    assert out["long"]["text"].endswith("in 18 days") and len(out["long"]["text"]) <= 28 + 1 + len("in 18 days")
    assert "…" in out["long"]["text"]


def test_countdown_reads_the_calendar_once_for_every_piece(tmp_path):
    out = run(tmp_path, r"""
var r = {}, T = W._.time;
var a = W.create('countdown', 'inline', { u: 4 }), b = W.create('countdown', 'circular', { u: 4 }), c = W.create('countdown', 'circular', { u: 4 });
a.update(CL, NOW); b.update(CL, NOW); c.update(CL, NOW);
r.before = [text0(a.el.innerHTML), LOADS.length];                // asked once; nothing yet, so a dash
function text0(h) { return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
drainMicrotasks();                                               // the read lands, THEN the pieces are woken and draw again
r.after = [text0(a.el.innerHTML), text0(b.el.innerHTML), text0(c.el.innerHTML), LOADS.length];
var from = new Date(); from.setHours(0, 0, 0, 0);
r.window = [LOADS[0].from === +from, Math.round((LOADS[0].to - LOADS[0].from) / 86400000), LOADS[0].ids];
a.update(CL, NOW); b.update(CL, NOW);
r.again = LOADS.length;                                          // kept an hour
T.cd.at = Date.now() - 3500000; a.update(CL, NOW); r.young = LOADS.length;
T.cd.at = Date.now() - 3700000; a.update(CL, NOW); b.update(CL, NOW); r.old = LOADS.length;   // an hour on: once more, for both
drainMicrotasks();
// a failed read: asked again after five minutes, not before, and what it had stays
FAIL = true; T.cd.at = Date.now() - 3700000; a.update(CL, NOW); r.failing = LOADS.length; drainMicrotasks();
a.update(CL, NOW); b.update(CL, NOW); r.soon = LOADS.length; r.kept = text0(a.el.innerHTML);
T.cd.failAt = Date.now() - 299000; a.update(CL, NOW); r.not_yet = LOADS.length;
T.cd.failAt = Date.now() - 301000; FAIL = false; a.update(CL, NOW); r.retried = LOADS.length; drainMicrotasks(); r.failAt = T.cd.failAt;
a.destroy(); b.destroy(); c.destroy();
r.watchers = W._.cal.watchers.length; r.warns = WARNS;
print(JSON.stringify(r));
""")
    assert out["before"] == ["—", 1]
    assert out["after"] == ["Anniversary in 5 days", "5 DAYS", "5 DAYS", 1]
    assert out["window"] == [True, 120, ["calendar.family"]]
    assert out["again"] == 1 and out["young"] == 1 and out["old"] == 2
    assert out["failing"] == 3
    assert out["soon"] == 3 and out["kept"] == "Anniversary in 5 days"
    assert out["not_yet"] == 3 and out["retried"] == 4 and out["failAt"] == 0
    assert out["watchers"] == 0 and out["warns"] == []


def test_countdown_asks_for_the_calendar_code_when_it_is_not_there(tmp_path):
    out = run(tmp_path, r"""
var r = {};
delete window.hkCalendar;
var asked = [];
window.hkNeed = { file: function (f) { asked.push(f); return Promise.resolve(); } };
var a = W.create('countdown', 'inline', { u: 4 }), b = W.create('countdown', 'circular', { u: 4 });
a.update(CL, NOW); b.update(CL, NOW);
r.asked = asked.slice(); r.dash = a.el.innerHTML.indexOf('—') >= 0;
// the file arrives: its landing draws the pieces, which then read
window.hkCalendar = { ids: function () { return ['calendar.family']; }, load: function () { LOADS.push(1); return Promise.resolve({ evs: CALEVS }); } };
drainMicrotasks(); drainMicrotasks();
r.loads = LOADS.length; r.after = a.el.innerHTML.indexOf('Anniversary') >= 0;
print(JSON.stringify(r));
""")
    assert out["asked"] == ["hk-calendar.js"] and out["dash"] is True and out["loads"] == 1 and out["after"] is True


# ---------------------------------------------------------------- World Clock

def test_world_clock_shows_each_zones_time_and_day(tmp_path):
    """At 2026-11-02T15:57Z, with the house in New York (10:57 AM, November 2): London 3:57 PM, Tokyo 12:57 AM the next day."""
    out = run(tmp_path, r"""
var Z = new Date('2026-11-02T15:57:00Z'), r = {};
function mk(shape, opts, h24, now) { var w = W.create('world', shape, { u: 4, h24: h24, opts: opts }); w.update(EMPTY, now || Z); return w; }
function body(w) { return w.el.innerHTML; }
r.london = body(mk('inline', {})); r.tokyo = body(mk('inline', { city: 'Asia/Tokyo' }));
r.london24 = body(mk('inline', {}, true)); r.tokyo24 = body(mk('inline', { city: 'Asia/Tokyo' }, true));
r.kolkata = body(mk('inline', { city: 'Asia/Kolkata' })); r.kolkata_rows = body(mk('rectangular', { city: 'Asia/Kolkata', city2: 'America/Sao_Paulo' }));
r.rect = body(mk('rectangular', {})); r.rect24 = body(mk('rectangular', {}, true));
r.same = body(mk('rectangular', { city: 'America/New_York', city2: 'America/Los_Angeles' }));
function direct(shape, city, city2, now) { var d = W.PIECES.world.shapes[shape], X = { now: now || Z, h24: false, opts: { city: city, city2: city2 || 'Asia/Tokyo' } }; return d.draw(d.read(X)); }
r.bad = direct('inline', 'Nope/Zone'); r.bad_rect = direct('rectangular', 'Nope/Zone');
r.bogus_opt = body(mk('inline', { city: 'Mars/Olympus' }));      // not one of the cities: the default
r.ba = body(mk('rectangular', { city: 'America/Argentina/Buenos_Aires', city2: 'Asia/Hong_Kong' }));
// yesterday: the house in Tokyo (Nov 3, 12:57 AM), Los Angeles still on Nov 2
window.hkLocale = { zone: function () { return 'Asia/Tokyo'; } };
r.yesterday = body(mk('rectangular', { city: 'America/Los_Angeles', city2: 'Asia/Tokyo' }));
// no house zone known: the clock handed in (the page's own)
window.hkLocale = { zone: function () { return null; } };
var local = new Date(2026, 10, 2, 12, 0, 0);
var own = Intl.DateTimeFormat().resolvedOptions().timeZone;   // (the process's own zone, so the answer doesn't depend on where the tests run)
r.nozone = direct('rectangular', own, own, local).replace(/<[^>]+>/g, ' ');
// a different instant
r.t = [body(mk('inline', { city: 'Australia/Sydney' }, false, new Date('2026-11-02T00:05:00Z'))), body(mk('inline', { city: 'America/Los_Angeles' }, true, new Date('2026-11-02T08:09:00Z')))];
print(JSON.stringify(r));
""")
    t = {k: text(v) if isinstance(v, str) else v for k, v in out.items()}
    assert t["london"] == "London 3:57 PM" and t["tokyo"] == "Tokyo 12:57 AM"
    assert t["london24"] == "London 15:57" and t["tokyo24"] == "Tokyo 00:57"
    assert t["kolkata"] == "Kolkata 9:27 PM"                              # the city of the id, a half-hour zone
    assert t["rect"] == "London 3:57 PM Tokyo Tomorrow 12:57 AM"
    assert t["rect24"] == "London 15:57 Tokyo Tomorrow 00:57"
    assert "wn2 a" in out["rect"] and out["rect"].count("wn2") == 1       # only Tokyo says its day
    assert out["rect"].count('class="wr"') == 2 and out["rect"].count("<small>") == 2 and "<small>" not in out["rect24"]
    assert t["kolkata_rows"] == "Kolkata 9:27 PM São Paulo 12:57 PM"
    assert t["same"] == "New York 10:57 AM Los Angeles 7:57 AM"          # the same date: no day word
    assert t["bad"] == "Zone —" and t["bad_rect"].startswith("Zone —")
    assert t["bogus_opt"] == "London 3:57 PM"
    assert t["ba"] == "Buenos Aires 12:57 PM Hong Kong 11:57 PM"
    assert t["yesterday"] == "Los Angeles Yesterday 7:57 AM Tokyo 12:57 AM"
    assert "Tomorrow" not in t["nozone"] and "Yesterday" not in t["nozone"] and t["nozone"].count("12:00 PM") == 2, t["nozone"]
    assert text(out["t"][0]) == "Sydney 11:05 AM" and text(out["t"][1]) == "Los Angeles 00:09"


def test_world_clock_dial(tmp_path):
    out = run(tmp_path, r"""
var Z = new Date('2026-11-02T15:57:00Z'), r = {};
var w = W.create('world', 'circular', { u: 4 }); w.update(EMPTY, Z); r.london = w.el.innerHTML; r.acc = [w.el.style.props['--sw-acc'], w.el.style.props['--sw-acc-d']];
var k = W.create('world', 'circular', { u: 4, opts: { city: 'Asia/Hong_Kong' } }); k.update(EMPTY, Z); r.hk = k.el.innerHTML;
var n = W.create('world', 'circular', { u: 4, opts: { city: 'America/New_York' } }); n.update(EMPTY, Z); r.ny = n.el.innerHTML;
var bd = W.PIECES.world.shapes.circular; r.bad = bd.draw(bd.read({ now: Z, h24: false, opts: { city: 'Nope/Zone' } }));
// the next minute draws it again; the same minute does not
r.same = w.update(EMPTY, new Date(+Z + 20000)); r.next = w.update(EMPTY, new Date(+Z + 60000));
// the ring's own track, so the dial is the size of every circular piece
var ring = W._.ring({ frac: 0.5, main: '5', sub: 'DAYS' }); r.ring = ring; r.m = w.measure();
print(JSON.stringify(r));
""")
    import math

    def pt(deg, length):
        a = math.radians(deg)
        return "%.2f %.2f" % (50 + length * math.sin(a), 42 - length * math.cos(a))

    d = out["london"]
    assert d.startswith('<svg viewBox="0 0 100 100"') and ">LON<" in d and 'y="72"' in d and 'font-size="14"' in d
    assert 'cx="50" cy="50" r="43"' in d and 'stroke-width="7.5"' in d and 'stroke-opacity=".3"' in d    # the ring's track, to the pixel
    assert 'cx="50" cy="50" r="43"' in out["ring"] and 'stroke-width="7.5"' in out["ring"]
    assert "L" + pt((3 + 57 / 60) * 30, 9.5) in d                          # the hour hand at 3:57
    assert "L" + pt(57 * 6, 14.2) in d                                      # the minute hand
    assert "L" + pt((10 + 57 / 60) * 30, 9.5) in out["ny"]                  # 10:57 in New York
    assert ">HKG<" in out["hk"] and "L" + pt((23 + 57 / 60) * 30, 9.5) in out["hk"]
    assert out["acc"] == ["#9aa8ff", "#4452b8"]
    assert ">ZON<" in out["bad"] and 'stroke-width="3.2"' not in out["bad"]    # a zone the browser doesn't know: the face, no hands
    assert out["same"] is False and out["next"] is True
    assert out["m"] == {"w": 52, "h": 52}                                   # 13 u square at 4 px


def test_world_clock_inline_measures_with_its_glyph(tmp_path):
    out = run(tmp_path, r"""
var r = {}, Z = new Date('2026-11-02T15:57:00Z');
['none', 'glass'].forEach(function (b) { var w = W.create('world', 'inline', { u: 10, back: b }); w.update(EMPTY, Z); r[b] = w.measure(); r['h_' + b] = w.el.innerHTML; });
print(JSON.stringify(r));
""")
    assert out["none"]["h"] == 36 and out["glass"]["h"] == 48 and out["glass"]["w"] - out["none"]["w"] == 42
    assert 'class="il"' in out["h_none"] and 'class="a"' in out["h_none"]


# ---------------------------------------------------------------- the Calendar card

def test_the_card_lists_the_rest_of_today_in_order_all_day_last(tmp_path):
    out = run(tmp_path, r"""
var r = {};
var c = W.create('events', 'card', { u: 4 });
c.update(EMPTY, NOW, { events: TODAY }); r.html = c.el.innerHTML; r.acc = c.el.style.props['--sw-acc']; r.m = c.measure();
// four is the most: Yoga (Now), 8:30, 9:15 and the all-day one; and 24-hour times
c.update(EMPTY, NOW, { events: TODAY.concat([{ cal: 'calendar.family', title: 'Night Owl', start: at(11, 2, 23), end: at(11, 2, 23, 30) }]) });
r.five = c.el.innerHTML;
var c24 = W.create('events', 'card', { u: 4, h24: true }); c24.update(EMPTY, NOW, { events: TODAY.slice(1, 4) }); r.h24 = c24.el.innerHTML;
// nothing else today: the morning is over, tomorrow's don't count
var e = W.create('events', 'card', { u: 4 }); e.update(EMPTY, NOW, { events: [TODAY[0], TODAY[5], TODAY[6]] }); r.empty = e.el.innerHTML; r.em = e.measure(); r.eacc = e.el.style.props['--sw-acc'] || null;
var n = W.create('events', 'card', { u: 4 }); n.update(EMPTY, NOW, undefined); r.none = n.el.innerHTML;
// the shared calendar read (no events handed in): the core's, two days from midnight
var s = W.create('events', 'card', { u: 4 }); s.update(CL, NOW); r.shared_before = s.el.innerHTML; drainMicrotasks(); r.shared_after = s.el.innerHTML;
r.core = W.create('events', 'inline', { u: 4 }); r.core.update(EMPTY, NOW, { events: TODAY }); r.core = r.core.el.innerHTML;
print(JSON.stringify(r));
""")
    rows = re.findall(r'<div class="er[^"]*"[^>]*><i class="dot a"></i><span class="tc">([^<]*)</span><span class="et">([^<]*)</span></div>', out["html"])
    assert rows == [("Now", "Yoga"), ("8:30 PM", "Late Call"), ("9:15 PM", "Reading"), ("All Day", "Recycling Day")]
    assert out["html"].startswith('<div class="cd ti"><div class="ct">Today</div>')
    assert "Breakfast" not in out["html"] and "Tomorrow" not in out["html"]
    assert out["html"].count('style="--sw-acc:#0a84ff;--sw-acc-d:#') == 4        # each row's dot in its calendar's color
    assert out["acc"] == "#0a84ff"
    five = re.findall(r'<span class="et">([^<]*)</span>', out["five"])
    assert five == ["Yoga", "Late Call", "Reading", "Night Owl"]                  # four at most: the all-day one is the one left out
    assert re.findall(r'<span class="tc">([^<]*)</span>', out["h24"]) == ["Now", "20:30", "All Day"] and 'er t24' in out["h24"]
    assert text(out["empty"]) == "Today Nothing else today" and 'class="er' not in out["empty"]
    assert 'class="cl"' in out["empty"] and out["eacc"] is None
    assert text(out["none"]) == "Today Nothing else today"
    # (a height for the layout before the page has measured it: the title block and a row each)
    assert out["m"]["w"] == 120 and 4 * (8.1 + 3.24 * 4) - 1 <= out["m"]["h"] <= 4 * (8.1 + 3.24 * 4) + 1
    assert out["em"]["h"] == 4 * (8.1 + 3.78)
    # the core events piece's inline shape is untouched
    assert "Yoga" in out["core"]
    assert "Nothing else today" in out["shared_before"] and "Team Offsite" in out["shared_after"] and "Offsite Call" not in out["shared_after"]


def test_the_card_uses_the_shared_calendar_read(tmp_path):
    """No events handed in: the card reads the renderer's shared calendar (today and tomorrow), once for every events piece."""
    out = run(tmp_path, r"""
var r = {};
CALEVS.length = 0; TODAY.forEach(function (e) { CALEVS.push(e); });
var s = W.create('events', 'card', { u: 4 }), i = W.create('events', 'inline', { u: 4 });
s.update(CL, NOW); i.update(CL, NOW);
r.before = [s.el.innerHTML.indexOf('Yoga'), LOADS.length];
drainMicrotasks();
r.after = [s.el.innerHTML.indexOf('Yoga') > 0, i.el.innerHTML.indexOf('Yoga') > 0, LOADS.length, Math.round((LOADS[0].to - LOADS[0].from) / 86400000)];
print(JSON.stringify(r));
""")
    assert out["before"] == [-1, 1] and out["after"] == [True, True, 1, 2]


# ---------------------------------------------------------------- the rules

def test_the_group_keeps_the_plans_rules(tmp_path):
    src = FILE.read_text()
    for word in ("backdrop-filter", "animation", "transition", "@keyframes", "setInterval", "setTimeout", "requestAnimationFrame", "Mantel"):
        assert word not in src, word
    css = run(tmp_path, "print(JSON.stringify({ css: W._.time.CSS }));")["css"]
    # every padding, margin and gap in u is on the spacing scale
    allowed = {"0", ".4", ".8", "1.2", "1.6", "2.4", "3.2"}
    seen = 0
    for decl in re.findall(r"(?:padding|margin|gap)[a-z-]*:([^;}]*)", css):
        for n in re.findall(r"var\(--u\) \* (-?[0-9.]+)", decl):
            seen += 1
            assert n in allowed, (decl, n)
    assert seen >= 5
    # the world rows leave at least 1.6 u above and below inside the 13 u rectangle: 2 rows of 4.6 u and .4 u between
    assert "height:calc(var(--u) * 4.6)" in css and 13 - (2 * 4.6 + 0.4) >= 2 * 1.6
    # a card's time column is fixed (min-width in em), so the titles share a left edge
    assert ".tc{flex:none;min-width:4.9em" in css


def test_loading_twice_changes_nothing_and_without_the_renderer_nothing_happens(tmp_path):
    out = run(tmp_path, r"""
var n = Object.keys(W.PIECES).length, shapes = Object.keys(W.PIECES.events.shapes).length, css = W.CSS.length, styles = document.head.children.length;
load(FILE);
print(JSON.stringify({ same: [n === Object.keys(W.PIECES).length, shapes === Object.keys(W.PIECES.events.shapes).length, css === W.CSS.length, styles === document.head.children.length] }));
""")
    assert out["same"] == [True, True, True, True]
    out = run(tmp_path, r"""
// the group's file with no renderer in the page: it returns, touching nothing
delete window.hkSaverWidgets;
load(FILE);
print(JSON.stringify({ none: typeof window.hkSaverWidgets }));
""", nogroup=True)
    assert out["none"] == "undefined"


def test_the_card_before_the_core_events_piece_exists_is_left_alone(tmp_path):
    out = run(tmp_path, r"""
delete window.hkSaverWidgets.PIECES.events;
delete window.hkSaverWidgets._.time;
load(FILE);
print(JSON.stringify({ events: !!W.PIECES.events, world: !!W.PIECES.world }));
""")
    assert out == {"events": False, "world": True}


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(FILE)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr


def test_the_match_option_reaches_the_piece_through_the_renderer(tmp_path):
    """Countdown's `match` is a "text" option (GLANCE-SPEC, "Options beyond choices"). The renderer's optsOf has to let a string through
    for a "text" option; until it does (it knows choices only), this checks the piece's own reading and skips the rest."""
    out = run(tmp_path, r"""
var r = {};
var a = W.create('countdown', 'inline', { u: 4, opts: { match: 'dentist' } }), b = W.create('countdown', 'circular', { u: 4, opts: { match: 'beach trip' } });
a.update(CL, NOW); b.update(CL, NOW); drainMicrotasks();
r.inline = a.el.innerHTML; r.circular = b.el.innerHTML;
var d = W.PIECES.countdown.shapes.inline; r.read = d.read({ quiet: false, client: CL, now: NOW, opts: { match: 'dentist' }, h24: false });
print(JSON.stringify(r));
""")
    assert out["read"]["text"] == "Dentist tomorrow"                       # the piece's reading with the option in hand
    if "Dentist" not in out["inline"]:
        pytest.skip("hkSaverWidgets optsOf drops a \"text\" option (it passes choices only): needs `if (choices === 'text') out[k] = typeof v === 'string' ? v.slice(0, 40) : def`")
    assert text(out["inline"]) == "Dentist tomorrow" and ">11<" in out["circular"]
