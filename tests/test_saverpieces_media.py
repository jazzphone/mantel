"""The screensaver's Media and Photos glance pieces (web/hk/modules/hk-saverpieces-media.js; docs/phase13/GLANCE-SPEC.md, "Media"):
Up Next, Playing In and On This Day. Run under macOS's JavaScriptCore with the same minimal DOM as tests/test_saverwidgets_pieces.py,
the renderer loaded first and the group's file after it; timers are captured here and fired by hand, so what a read may and may
not do (ask, wake) is checked, not assumed."""
import json
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "web/hk/modules/hk-saverwidgets.js"
FILE = ROOT / "web/hk/modules/hk-saverpieces-media.js"
LAYOUT = ROOT / "web/hk/modules/hk-saverlayout.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

SHIM = r"""
var window = this;
var console = { warn: function () { WARNS.push(Array.prototype.slice.call(arguments).join(' ')); }, log: function () {}, error: function () {} };
var WARNS = [];
// timers: captured, and run by hand (fire()) -- a read may set one, and only a timer may ask or wake
var TIMERS = [];
setTimeout = function (f, ms) { TIMERS.push({ f: f, ms: ms, dead: false, ran: false }); return TIMERS.length; };
clearTimeout = function (id) { if (TIMERS[id - 1]) TIMERS[id - 1].dead = true; };
function pending() { return TIMERS.filter(function (t) { return !t.dead && !t.ran; }); }
function fire() { var n = 0; pending().forEach(function (t) { t.ran = true; t.f(); n++; }); drainMicrotasks(); return n; }
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
function at(y, m, d, h) { return new Date(y, m - 1, d, h || 12, 0, 0); }
var EMPTY = { states: {} };

// Music Assistant's queue, asked through the client's action port (hk-saver.js's sendWS)
var CALLS = [], REJECT = false, THROW = false, NONEXT = false, NAMEONLY = false;
function answer(key) {
  var r = {};
  if (NONEXT) r[key] = { current_item: { name: 'x' } };
  else if (NAMEONLY) r[key] = { next_item: { name: 'Glass Orchard' } };
  else r[key] = { next_item: { name: 'Paper Lanterns', media_item: { name: 'Paper Lanterns', artists: [{ name: 'The Fictional Trio' }] } } };
  return { response: r };
}
function house() {
  return { states: {}, config: {}, actions: { callWS: function (msg) {
    CALLS.push(msg);
    if (THROW) throw new Error('boom');
    return REJECT ? Promise.reject(new Error('not Music Assistant')) : Promise.resolve(answer(msg.service_data.entity_id));
  } } };
}
var HOUSE = house();
function music(o) {
  var m = { idle: false, key: 'media_player.kitchen', room: 'Kitchen', playing: true, title: 'Night Harbor', artist: 'The Fictional Trio', album: '', pic: '' };
  Object.keys(o || {}).forEach(function (k) { m[k] = o[k]; });
  return m;
}
function words(html) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
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


VARIANTS = r"""
function variants() {
  return [['upnext', 'inline'], ['upnext', 'rectangular'], ['playin', 'inline'], ['thisday', 'inline']];
}
"""


# ---------------------------------------------------------------- declarations

def test_the_group_registers_its_pieces_with_the_layouts_catalog(tmp_path):
    out = run(tmp_path, r"""
var P = {}, css0 = W.CSS;
load(FILE);
['upnext', 'playin', 'thisday'].forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
           accent: d.accent, shapes: Object.keys(d.shapes).sort() };
});
var once = W._.media;
load(FILE);
print(JSON.stringify({ P: P, css: W.CSS === css0, styled: document.head.children.length, again: W._.media === once,
  has: [W.has('upnext', 'inline'), W.has('upnext', 'rectangular'), W.has('upnext', 'circular'), W.has('playin', 'inline'), W.has('playin', 'rectangular'),
        W.has('thisday', 'inline'), W.has('thisday', 'circular')],
  core: [W.has('music', 'inline'), W.has('music', 'card'), W.has('title', 'inline')] }));
""", nogroup=True)
    P = out["P"]
    for k in ("upnext", "playin", "thisday"):
        assert P[k]["group"] == "Media and Photos" and P[k]["wave"] == "B" and P[k]["name"] and P[k]["facts"] == [k]
        assert P[k]["pick"] is None and P[k]["off"] is False and P[k]["opts"] == {} and P[k]["wakes"] and P[k]["source"]
        assert P[k]["when"]                                                  # all three "show when..."
        assert isinstance(P[k]["accent"], list) and len(P[k]["accent"]) == 2 and all(re.fullmatch(r"#[0-9a-f]{6}", c) for c in P[k]["accent"])
    assert P["upnext"]["shapes"] == ["inline", "rectangular"] and P["playin"]["shapes"] == ["inline"] and P["thisday"]["shapes"] == ["inline"]
    assert P["upnext"]["when"] == P["playin"]["when"] == "while music plays" and "photo" in P["thisday"]["when"]
    assert P["upnext"]["accent"] == P["playin"]["accent"] != P["thisday"]["accent"]
    assert out["has"] == [True, True, False, True, False, True, False]
    assert out["core"] == [True, True, True]                                 # (the core Music and Title pieces are untouched)
    assert out["css"] is True and out["styled"] == 0 and out["again"] is True    # no CSS of its own; loaded twice is loaded once


def test_the_catalog_in_the_layout_matches_this_file():
    layout = LAYOUT.read_text()
    assert re.search(r"upnext: \[\['inline', 'rectangular'\], \{\}, 'Up Next', \['upnext'\], 'media'\]", layout)
    assert re.search(r"playin: \[\['inline'\], \{\}, 'Playing In', \['playin'\], 'media'\]", layout)
    assert re.search(r"thisday: \[\['inline'\], \{\}, 'On This Day', \['thisday'\], 'media'\]", layout)
    src = FILE.read_text()
    assert "'Media and Photos'" in src and "hkSaverpiecesMedia" not in src
    for bad in ("backdrop-filter", "animation", "transition", "@keyframes", "setInterval", "requestAnimationFrame"):
        assert bad not in src, bad                                           # nothing animates, nothing blurs, no timer that repeats


# ---------------------------------------------------------------- drawing

def test_every_piece_and_shape_draws_empty_and_with_a_song_and_a_photo(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
variants().forEach(function (v) {
  [[EMPTY, undefined], [EMPTY, null], [EMPTY, {}], [HOUSE, { music: music(), photo: { year: 2023, date: '2023-11-02' } }],
   [HOUSE, { music: music({ idle: true }), photo: null }]].forEach(function (hc, i) {
    try {
      W._.media.reset();
      W._.media.setNext('media_player.kitchen', { title: 'Paper Lanterns', artist: 'The Fictional Trio' }, { title: 'Night Harbor', artist: 'The Fictional Trio' });
      var w = W.create(v[0], v[1], { u: 4, back: ['none', 'glass', 'tint'][i % 3], color: i % 2 ? 'accent' : 'auto', h24: !!(i % 2) });
      if (!w) { errors.push('no create ' + v[0] + '/' + v[1]); return; }
      var drew = w.update(hc[0], NOW, hc[1]), again = w.update(hc[0], NOW, hc[1]), m = w.measure();
      results.push({ p: v[0], s: v[1], i: i, drew: drew, again: again, html: w.el.innerHTML.length, showing: w.showing, live: w.live, w: m.w, h: m.h });
      w.setU(5);
      w.destroy();
    } catch (e) { errors.push(v[0] + '/' + v[1] + ': ' + e + ' ' + (e && e.stack)); }
  });
});
print(JSON.stringify({ results: results, errors: errors, warns: WARNS, pending: pending().length }));
""", before=VARIANTS)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == 4 * 5
    for r in out["results"]:
        assert r["live"] is False and r["h"] > 0 and r["w"] >= 0
        shows = r["i"] == 3                                                   # only a song, or a photo of this day
        assert r["showing"] is shows, r
        assert (r["html"] > 0) is shows, r                                    # a piece with nothing to say draws nothing
        assert r["again"] is False, r                                         # (drawn again only when its spec changes)


def test_every_sample_draws_in_the_accent(tmp_path):
    out = run(tmp_path, r"""
var got = {}, errors = [];
variants().forEach(function (v) {
  try {
    var el = W.sample(v[0], v[1], { u: 4, back: 'glass' });
    got[v[0] + '/' + v[1]] = [el.innerHTML, el.className, el.style.props['--sw-acc'], el.style.props['--sw-acc-d']];
  } catch (e) { errors.push(v[0] + '/' + v[1] + ': ' + e); }
});
print(JSON.stringify({ got: got, errors: errors, pending: pending().length }));
""", before=VARIANTS)
    assert out["errors"] == [] and out["pending"] == 0                       # (a sample asks nothing, sets no timer)
    g = out["got"]
    for key, (html, cls, acc, accd) in g.items():
        assert html and "b-glass" in cls and "k-" + key.split("/")[1] in cls and acc and accd, key
    violet = ("#b9a2ff", "#6a45c9")
    assert (g["upnext/inline"][2], g["upnext/inline"][3]) == violet == (g["playin/inline"][2], g["playin/inline"][3])
    assert (g["thisday/inline"][2], g["thisday/inline"][3]) == ("#f0cf85", "#9a6f12")
    words = lambda h: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)).strip()   # noqa: E731
    assert words(g["upnext/inline"][0]) == "Next: Paper Lanterns"
    assert words(g["upnext/rectangular"][0]) == "Up Next Paper Lanterns The Fictional Trio"
    assert words(g["playin/inline"][0]) == "Kitchen + Living Room"
    assert words(g["thisday/inline"][0]) == "3 years ago today"
    # (an inline piece: the renderer's glyph and words, the glyph in the accent; a rectangular one: its three lines, the label in the accent)
    for k in ("upnext/inline", "playin/inline", "thisday/inline"):
        assert g[k][0].startswith('<span class="il"><svg class="a" viewBox="0 0 24 24"') and g[k][0].count("<svg") == 1, k
    r = g["upnext/rectangular"][0]
    assert r.startswith('<div class="rt"><div class="l1 a">Up Next</div><div class="l2">Paper Lanterns</div><div class="l3">The Fictional Trio</div></div>')


# ---------------------------------------------------------------- On This Day

def test_this_day_wording_and_the_days_that_count(tmp_path):
    out = run(tmp_path, r"""
var M = W._.media, r = {};
function y(date, now) { return M.yearsAgo(date, now || NOW); }
r.ago = [y('2025-11-02'), y('2024-11-02'), y('2023-11-02'), y('1999-11-02'), y('2026-11-02'), y('2027-11-02')];
r.words = [M.agoWords(1), M.agoWords(2), M.agoWords(3), M.agoWords(27)];
r.not = [y('2023-11-03'), y('2023-11-01'), y('2023-10-02'), y('2023-12-02'), y('2023-02-11')];     // (a day or a month away; November 2 vs February 11)
r.bad = [y(null), y(undefined), y(''), y('garbage'), y('2023-11'), y('2023-13-02'), y('2023-02-30'), y('2023-11-31'), y('23-11-02'), y(20231102), y('2023-11-02T10:00')];
// (February 29th: on the 28th in a year without one, on the 29th in a leap year, never the 28th of a leap year)
r.leap = [y('2024-02-29', at(2027, 2, 28)), y('2024-02-29', at(2027, 2, 29)), y('2020-02-29', at(2028, 2, 29)), y('2024-02-29', at(2028, 2, 28)), y('2023-02-28', at(2027, 2, 28)),
          y('2024-02-29', at(2024, 2, 29)), y('2024-02-28', at(2025, 2, 28))];
print(JSON.stringify(r));
""")
    assert out["ago"] == [1, 2, 3, 27, None, None]
    assert out["words"] == ["A year ago today", "2 years ago today", "3 years ago today", "27 years ago today"]
    assert out["not"] == [None] * 5
    assert out["bad"] == [None] * 11
    assert out["leap"] == [3, None, 8, None, 4, None, 1]


def test_this_day_shows_over_a_photo_from_this_day_in_an_earlier_year(tmp_path):
    out = run(tmp_path, r"""
var r = {}, w = W.create('thisday', 'inline', { u: 4 });
function go(ctx, now) { w.update(EMPTY, now || NOW, ctx); return [w.showing, words(w.el.innerHTML)]; }
r.before = [w.showing, w.el.innerHTML];                                  // (a "shows when" piece starts hidden)
r.none = go(undefined); r.nophoto = go({ photo: null }); r.nodate = go({ photo: { year: 2023, date: null } }); r.yearonly = go({ photo: { year: 2023 } });
r.three = go({ photo: { year: 2023, date: '2023-11-02' } });
r.one = go({ photo: { year: 2025, date: '2025-11-02' } });
r.this_year = go({ photo: { year: 2026, date: '2026-11-02' } });
r.other_day = go({ photo: { year: 2023, date: '2023-11-03' } });
r.back = go({ photo: { year: 2023, date: '2023-11-02' } });
r.tomorrow = go({ photo: { year: 2023, date: '2023-11-02' } }, at(2026, 11, 3));          // (the minute's tick carries it across midnight)
r.garbled = go({ photo: { year: 2023, date: '2023-02-31' } });
r.after = [w.showing, w.measure().w > 0];
print(JSON.stringify(r));
""")
    assert out["before"] == [False, ""]
    for k in ("none", "nophoto", "nodate", "yearonly", "this_year", "other_day", "tomorrow", "garbled"):
        assert out[k] == [False, ""], k
    assert out["three"] == [True, "3 years ago today"] and out["back"] == [True, "3 years ago today"]
    assert out["one"] == [True, "A year ago today"]
    assert out["after"] == [False, False]                                  # (the last update was the garbled day: hidden, and no width)


# ---------------------------------------------------------------- Playing In

def test_playing_in_names_the_rooms_hkmusic_names(tmp_path):
    out = run(tmp_path, r"""
var r = {}, w = W.create('playin', 'inline', { u: 4 });
function go(ctx) { w.update(HOUSE, NOW, ctx); return [w.showing, words(w.el.innerHTML)]; }
var LABELS = [];
window.hkMusic = {
  contexts: function (client) { return [{ key: 'media_player.office', members: ['media_player.office'] }, { key: 'media_player.kitchen', members: ['media_player.kitchen', 'media_player.living_room'] }]; },
  label: function (c) { LABELS.push(c.key); return c.key === 'media_player.kitchen' ? 'Kitchen + Living Room' : 'Office'; }
};
r.group = go({ music: music() });
r.labelled = LABELS.slice();                                              // (the context ctx.music.key names, not the first)
r.other = go({ music: music({ key: 'media_player.office', room: 'Wrong' }) });
r.unknown = go({ music: music({ key: 'media_player.garage', room: 'Garage' }) });              // not among the contexts: musicOf's own room
r.paused = go({ music: music({ playing: false }) });                                           // (the core Music piece's rule: shown until it goes)
r.idle = go({ music: music({ idle: true }) });
r.silent = go({ music: music({ title: '' }) });
r.nomusic = go({ music: null }); r.noctx = go(undefined);
window.hkMusic.label = function () { return ''; };
r.emptylabel = go({ music: music() });
window.hkMusic.label = function () { throw new Error('boom'); };
r.thrown = go({ music: music() });
window.hkMusic.contexts = function () { throw new Error('boom'); };
r.thrown2 = go({ music: music({ room: 'Den' }) });
delete window.hkMusic;
r.nolib = go({ music: music({ room: 'Den' }) });
r.noroom = go({ music: music({ room: '' }) });
window.hkMusic = { contexts: function () { return [{ key: 'media_player.kitchen' }]; }, label: function () { return 'A Very Long Room Name And Another Very Long Room Name'; } };
r.long = go({ music: music() });
r.warns = WARNS;
print(JSON.stringify(r));
""")
    assert out["group"] == [True, "Kitchen + Living Room"] and out["labelled"] == ["media_player.kitchen"]
    assert out["other"] == [True, "Office"]
    assert out["unknown"] == [True, "Garage"]
    assert out["paused"] == [True, "Kitchen + Living Room"]
    for k in ("idle", "silent", "nomusic", "noctx", "noroom"):
        assert out[k] == [False, ""], k
    assert out["emptylabel"] == [True, "Kitchen"]
    assert out["thrown"] == [True, "Kitchen"] and out["thrown2"] == [True, "Den"] and out["nolib"] == [True, "Den"]
    assert out["long"][0] is True and out["long"][1].endswith("…") and len(out["long"][1]) == 36
    assert out["warns"] == []


# ---------------------------------------------------------------- Up Next

def test_up_next_is_asked_once_a_song_from_a_timer_and_never_inside_a_read(tmp_path):
    out = run(tmp_path, r"""
var r = {}, M = W._.media;
var a = W.create('upnext', 'inline', { u: 4 }), b = W.create('upnext', 'rectangular', { u: 4 }), c = W.create('upnext', 'inline', { u: 4 });
var ctx = { music: music() };
[a, b, c].forEach(function (w) { w.update(HOUSE, NOW, ctx); });
r.read = [CALLS.length, a.showing, b.showing, a.el.innerHTML, pending().map(function (t) { return t.ms; })];   // one timer, ASK_DELAY, and no call yet
[a, b, c].forEach(function (w) { w.update(HOUSE, NOW, ctx); });
r.reread = [CALLS.length, pending().length];                              // (more reads of the same song: no more timers)
fire();                                                                    // the timer asks; the answer lands
r.asked = CALLS.map(function (m) { return JSON.stringify(m); });
r.landed = [a.showing, b.showing, pending().map(function (t) { return t.ms; })];                  // (not drawn yet: only a timer wakes a piece)
r.undrawn = a.el.innerHTML;
fire();                                                                    // the wake: every upnext piece draws again
r.drawn = [a.showing, b.showing, c.showing, words(a.el.innerHTML), words(b.el.innerHTML), words(c.el.innerHTML), CALLS.length];
for (var i = 0; i < 5; i++) [a, b, c].forEach(function (w) { w.update(HOUSE, NOW, ctx); });
r.settled = [CALLS.length, pending().length];
// the song changes: asked again; the same song on another player: asked again; a song just heard comes back: remembered, not asked
var ctx2 = { music: music({ title: 'Glass Orchard' }) };
[a, b].forEach(function (w) { w.update(HOUSE, NOW, ctx2); });
r.changed = [CALLS.length, a.showing, pending().length];
fire(); fire();
r.second = [CALLS.length, a.showing, CALLS[1].service_data.entity_id];
var ctx3 = { music: music({ key: 'media_player.office', room: 'Office' }) };
a.update(HOUSE, NOW, ctx3); fire(); fire();
r.third = [CALLS.length, CALLS[2].service_data.entity_id];
a.update(HOUSE, NOW, ctx2); r.back = [CALLS.length, pending().length, a.showing];
// leaving before the timer fires: nothing is asked, and the timer is let go
var ctx4 = { music: music({ title: 'Third Song' }) };
a.update(HOUSE, NOW, ctx4); var t4 = pending().length;
a.update(HOUSE, NOW, { music: music({ title: 'Fourth Song' }) }); r.superseded = [t4, pending().length]; fire(); fire();
r.final = [CALLS.length, CALLS[CALLS.length - 1].service_data.entity_id];
a.destroy(); b.destroy(); c.destroy();
r.watchers = W._.cal.watchers.length; r.warns = WARNS;
print(JSON.stringify(r));
""")
    assert out["read"][:3] == [0, False, False] and out["read"][3] == "" and out["read"][4] == [1500]
    assert out["reread"] == [0, 1]
    assert [json.loads(m) for m in out["asked"]] == [{"type": "call_service", "domain": "music_assistant", "service": "get_queue",
                                                      "service_data": {"entity_id": "media_player.kitchen"}, "return_response": True}]
    assert out["landed"] == [False, False, [50]] and out["undrawn"] == ""
    assert out["drawn"] == [True, True, True, "Next: Paper Lanterns", "Up Next Paper Lanterns The Fictional Trio", "Next: Paper Lanterns", 1]
    assert out["settled"] == [1, 0]
    assert out["changed"][:2] == [1, False]                                 # the old song's answer is not the new song's
    assert out["second"] == [2, True, "media_player.kitchen"]
    assert out["third"] == [3, "media_player.office"]
    assert out["back"] == [3, 0, True]                                      # (kitchen's "Glass Orchard" was answered a moment ago: remembered)
    assert out["superseded"] == [1, 1] and out["final"][0] == 4          # (the third song was left before its timer: only the fourth was asked about)
    assert out["watchers"] == 0 and out["warns"] == []


def test_up_next_takes_what_the_music_slide_heard_and_asks_nothing(tmp_path):
    out = run(tmp_path, r"""
var r = {}, M = W._.media;
var w = W.create('upnext', 'inline', { u: 4 }), song = { title: 'Night Harbor', artist: 'The Fictional Trio' };
// heard BEFORE the piece reads (the slide asked first)
r.early = M.setNext('media_player.kitchen', { title: 'Paper Lanterns', artist: 'The Fictional Trio' }, song);
w.update(HOUSE, NOW, { music: music() });
r.now = [w.showing, words(w.el.innerHTML), pending().length, CALLS.length];                 // known at once, nothing to ask
// heard AFTER it read and set its timer
M.reset();
w.update(HOUSE, NOW, { music: music() });
r.waiting = [w.showing, pending().length];
M.setNext('media_player.kitchen', { title: 'Glass Orchard', artist: '' }, song);
r.woke = pending().map(function (t) { return t.ms; });
fire(); fire();
r.late = [w.showing, words(w.el.innerHTML), CALLS.length];                                    // the timer found its answer given: no call
// "no next song": a null answer hides the piece
M.setNext('media_player.kitchen', null, song);
fire();
r.none = [w.showing, w.el.innerHTML, CALLS.length];
// without the song, the one this module last saw on that player; a player it has not seen: nothing to put it on
r.nosong = M.setNext('media_player.kitchen', { title: 'Paper Lanterns', artist: 'x' });
fire(); r.nosong_drawn = [w.showing, words(w.el.innerHTML)];
r.stranger = M.setNext('media_player.garage', { title: 'Paper Lanterns', artist: 'x' });
r.badnext = [M.setNext('media_player.kitchen', { title: 5 }), M.setNext('media_player.kitchen', {}, song)];
fire(); r.badnext_drawn = w.showing;
// answers for songs that are not playing are kept a little (the slide's answer, before this one reads) and no more than four
M.reset();
for (var i = 0; i < 6; i++) M.setNext('media_player.kitchen', { title: 'Next ' + i, artist: '' }, { title: 'Song ' + i, artist: '' });
w.update(HOUSE, NOW, { music: music({ title: 'Song 0', artist: '' }) }); r.old = [w.showing, pending().length];
w.update(HOUSE, NOW, { music: music({ title: 'Song 5', artist: '' }) }); r.new = [w.showing, words(w.el.innerHTML)];
r.calls = CALLS.length; r.warns = WARNS;
print(JSON.stringify(r));
""")
    assert out["early"] is True
    assert out["now"] == [True, "Next: Paper Lanterns", 0, 0]
    assert out["waiting"] == [False, 1] and out["woke"] == [1500, 50]
    assert out["late"] == [True, "Next: Glass Orchard", 0]
    assert out["none"] == [False, "", 0]
    assert out["nosong"] is True and out["nosong_drawn"] == [True, "Next: Paper Lanterns"]
    assert out["stranger"] is False
    assert out["badnext"] == [True, True] and out["badnext_drawn"] is False
    assert out["old"] == [False, 1]                                          # (Song 0 was forgotten: asked about)
    assert out["new"] == [True, "Next: Next 5"] and out["calls"] == 0 and out["warns"] == []


def test_up_next_shows_nothing_when_there_is_no_next_song_or_no_way_to_ask(tmp_path):
    out = run(tmp_path, r"""
var r = {}, M = W._.media;
function settle(client, tweak) {
  M.reset(); CALLS.length = 0; REJECT = THROW = NONEXT = NAMEONLY = false;
  if (tweak) tweak();
  var w = W.create('upnext', 'rectangular', { u: 4 });
  w.update(client, NOW, { music: music() }); fire(); fire(); fire();
  w.update(client, NOW, { music: music() }); fire();
  var out = [w.showing, words(w.el.innerHTML), CALLS.length, pending().length];
  w.destroy();
  return out;
}
r.fine = settle(HOUSE);
r.nonext = settle(HOUSE, function () { NONEXT = true; });
r.nameonly = settle(HOUSE, function () { NAMEONLY = true; });
r.rejected = settle(HOUSE, function () { REJECT = true; });                      // (not Music Assistant: no Up Next, and no asking again for the same song)
r.thrown = settle(HOUSE, function () { THROW = true; });
r.noport = settle({ states: {}, config: {} });
r.noactions = settle({ states: {}, actions: {} });
r.noclient = settle(undefined);
print(JSON.stringify(r));
""")
    assert out["fine"] == [True, "Up Next Paper Lanterns The Fictional Trio", 1, 0]
    assert out["nonext"] == [False, "", 1, 0]
    assert out["nameonly"] == [True, "Up Next Glass Orchard", 1, 0]               # (no media item: the queue item's own name; no artist line)
    assert out["rejected"] == [False, "", 1, 0] and out["thrown"] == [False, "", 1, 0]
    assert out["noport"] == [False, "", 0, 0] and out["noactions"] == [False, "", 0, 0] and out["noclient"] == [False, "", 0, 0]


def test_up_next_gives_up_on_a_read_that_never_answers(tmp_path):
    out = run(tmp_path, r"""
var r = {}, M = W._.media, real = Date.now, t0 = real();
var stuck = { states: {}, actions: { callWS: function (msg) { CALLS.push(msg); return new Promise(function () { /* never */ }); } } };
var w = W.create('upnext', 'inline', { u: 4 });
Date.now = function () { return t0; };
w.update(stuck, NOW, { music: music() }); fire(); fire();
r.asking = [M.state().state, w.showing, CALLS.length];
Date.now = function () { return t0 + 29000; }; w.update(stuck, NOW, { music: music() }); r.waiting = M.state().state;
Date.now = function () { return t0 + 31000; }; w.update(stuck, NOW, { music: music() }); r.gave_up = [M.state().state, w.showing, CALLS.length];
w.update(stuck, NOW, { music: music() }); fire(); r.not_again = CALLS.length;
Date.now = real;
// and the page's own wake: a piece that is destroyed before the wake lands is not drawn again
var v = W.create('upnext', 'inline', { u: 4 });
M.reset(); v.update(HOUSE, NOW, { music: music() }); fire(); v.destroy(); fire();
r.destroyed = [v.el.innerHTML, WARNS];
print(JSON.stringify(r))
""")
    assert out["asking"] == ["asking", False, 1] and out["waiting"] == "asking"
    assert out["gave_up"] == ["done", False, 1] and out["not_again"] == 1
    assert out["destroyed"] == ["", []]


def test_up_next_wakes_the_pieces_after_the_read_lands_never_inside_it(tmp_path):
    """The wake is the renderer's shared watcher list, called from a timer set when an answer lands: a piece that reads never
    draws another, and however many answers land close together the pieces are woken once."""
    out = run(tmp_path, r"""
var r = {}, M = W._.media, woke = 0;
W._.cal.watchers.push(function () { woke++; });
var w = W.create('upnext', 'inline', { u: 4 });
w.update(HOUSE, NOW, { music: music() }); r.read = woke;
fire();                                                                    // asked, answered
r.answered = [woke, pending().length];
M.setNext('media_player.kitchen', { title: 'Glass Orchard', artist: '' }, { title: 'Night Harbor', artist: 'The Fictional Trio' });
M.setNext('media_player.kitchen', { title: 'Paper Lanterns', artist: '' }, { title: 'Night Harbor', artist: 'The Fictional Trio' });
r.coalesced = pending().length;
fire();
r.woke = woke;
// a watcher that throws does not stop the others
W._.cal.watchers.unshift(function () { throw new Error('gone'); });
M.setNext('media_player.kitchen', null, { title: 'Night Harbor', artist: 'The Fictional Trio' });
fire(); r.after_throw = woke; r.warns = WARNS;
print(JSON.stringify(r));
""")
    assert out["read"] == 0 and out["answered"] == [0, 1] and out["coalesced"] == 1
    assert out["woke"] == 1 and out["after_throw"] == 2 and out["warns"] == []
