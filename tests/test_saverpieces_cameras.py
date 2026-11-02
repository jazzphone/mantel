"""The screensaver's Cameras pieces (web/hk/modules/hk-saverpieces-cameras.js; docs/phase13/GLANCE-SPEC.md, wave B): Camera (a
camera's still, rectangular and card) and Last Ring (inline and card), every one in each of its shapes with an empty house and a
small one; both declared off until placed; the still's address built as the side pane builds it (only width, height, v and _hk;
a counter that goes up); a restored, stale or unavailable camera skipped; the ONE shared refresh timer (started once for two
cameras, stopped after both are destroyed, nothing asked for while the page is hidden or the piece is); a new still put into the
<img> in place; the ring's thirty minutes, its snapshot signed with hk_notify/snap/sign, and its wake deferred and coalesced.
Run under macOS's JavaScriptCore with the renderer's own DOM shim (tests/test_saverwidgets_pieces.py) and a fake scheduler."""
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-cameras.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

# the renderer's tests' DOM shim and file (loaded by path: tests is not a package)
_spec = importlib.util.spec_from_file_location("_saverwidgets_pieces_shim", ROOT / "tests/test_saverwidgets_pieces.py")
_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_base)
SHIM, FILE = _base.SHIM, _base.FILE

# what the group's file needs of the page, before it loads: a scheduler the test turns by hand (timeouts and intervals), a clock
# (Date.now), window events, the page's visibility, Image (a picture that loads when the test says), and elements that can find
# their <img>s again (querySelectorAll on what innerHTML holds, setAttribute writing back into it)
PRE = r"""
var TQ = [], TID = 0, IV = {};
setTimeout = function (f, ms) { var id = ++TID; TQ.push({ id: id, f: f, ms: ms }); return id; };
clearTimeout = function (id) { TQ = TQ.filter(function (t) { return t.id !== id; }); };
setInterval = function (f, ms) { var id = ++TID; IV[id] = { f: f, ms: ms }; return id; };
clearInterval = function (id) { delete IV[id]; };
function flush() { var n = 0; while (TQ.length && n++ < 100) TQ.shift().f(); }
function ivs() { return Object.keys(IV).map(function (k) { return IV[k]; }); }
function tickAll() { ivs().forEach(function (i) { i.f(); }); }
var NOWMS = new Date(2026, 10, 2, 16, 2, 0).getTime();
Date.now = function () { return NOWMS; };
var LISTEN = {};
window.addEventListener = function (t, f) { (LISTEN[t] = LISTEN[t] || []).push(f); };
document.addEventListener = window.addEventListener;
function fire(t, detail) { (LISTEN[t] || []).forEach(function (f) { f({ detail: detail }); }); }
document.visibilityState = 'visible';
var IMGS = [];
function Image() { IMGS.push(this); this.naturalWidth = 0; }
function loaded(im, ok) { im.naturalWidth = ok === false ? 0 : 480; im.onload(); }
function failed(im) { im.onerror(); }
var mkEl = document.createElement;
document.createElement = function (tag) {
  var el = mkEl(tag);
  el.isConnected = true;
  el.querySelectorAll = function () {
    var out = [], re = /<img [^>]*class="cam-img"[^>]*>/g, m;
    while ((m = re.exec(el.innerHTML))) (function (t) {
      out.push({
        getAttribute: function (k) { var r = new RegExp(' ' + k + '="([^"]*)"').exec(t); return r ? r[1].replace(/&amp;/g, '&') : null; },
        setAttribute: function (k, v) {
          v = String(v).replace(/&/g, '&amp;');
          var nt = t.indexOf(' ' + k + '="') >= 0 ? t.replace(new RegExp(' ' + k + '="[^"]*"'), ' ' + k + '="' + v + '"') : t.replace('<img', '<img ' + k + '="' + v + '"');
          el.innerHTML = el.innerHTML.replace(t, nt); t = nt;
        }
      });
    })(m[0]);
    return out;
  };
  return el;
};
"""


def run(tmp_path, body, before=""):
    script = tmp_path / "t.js"
    script.write_text(f"var FILE = {json.dumps(str(FILE))};\n{SHIM}\n{PRE}\nload({json.dumps(str(GROUP))});\n{before}\n{body}\n")
    r = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{") or ln.startswith("[")]
    assert lines, r.stdout + r.stderr
    return json.loads(lines[-1])


# the house, as fakes: two cameras (and a restored, a stale, an unavailable and a picture-less one), Settings' camera order, a
# client that signs through callWS (answers held until the test gives them), and the ways to make a piece
FAKES = r"""
var GET = { 'cameras.order': ['camera.driveway', 'camera.front_door'] }, WSCALLS = [], WSPEND = [], STALE = {};
window.hkSettings = { get: function (k, d) { return GET[k] !== undefined ? GET[k] : (d === undefined ? null : d); } };
window.hkCards = { stale: function (st) { return st === STALE; } };
function camState(name, pic, extra) { var a = { friendly_name: name }; if (pic) a.entity_picture = pic; Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; }); return { state: 'idle', attributes: a }; }
function houseStates() {
  return {
    'camera.front_door': camState('Front Door', '/api/camera_proxy/camera.front_door?token=abc'),
    'camera.driveway': camState('Driveway', '/api/camera_proxy/camera.driveway?token=def')
  };
}
function client(st, noWS) {
  var c = { states: st || houseStates(), config: {} };
  if (!noWS) c.callWS = function (msg) { WSCALLS.push(msg); return { then: function (ok, bad) { WSPEND.push({ ok: ok, bad: bad }); } }; };
  return c;
}
var EMPTY = { states: {}, config: {} };
var T0 = new Date(NOWMS);
function at(min) { return new Date(NOWMS + min * 60000); }
function mk(piece, shape, opts, o) { return W.create(piece, shape, { u: 4, back: 'none', color: 'auto', h24: !!(o && o.h24), opts: opts || {} }); }
function doorbell(extra) { return Object.assign({ type: 'notification', kind: 'doorbell', camera: 'camera.front_door', snap: '', ts: NOWMS / 1000 }, extra || {}); }
function srcs(el) { return (el.innerHTML.match(/ src="[^"]*"/g) || []).map(function (s) { return s.slice(6, -1).replace(/&amp;/g, '&'); }); }
var CATALOG = { camera: ['rectangular', 'card'], ring: ['inline', 'card'] };
"""


def test_the_declarations_are_complete(tmp_path):
    out = run(tmp_path, r"""
var P = {};
Object.keys(CATALOG).forEach(function (k) {
  var d = W.PIECES[k];
  P[k] = d ? { name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off, opts: d.opts,
               defaults: d.defaults, accent: d.accent, shapes: Object.keys(d.shapes).sort() } : null;
});
var created = W.create, again = (function () { load(GROUPFILE); return W.create === created; })();
print(JSON.stringify({ P: P, again: again, listeners: (LISTEN['hk-house-event'] || []).length, core: !!W.PIECES.weather, v1: W.create('camera', { u: 4 }) }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    P = out["P"]
    assert P["camera"]["shapes"] == ["card", "rectangular"] and P["ring"]["shapes"] == ["card", "inline"]
    for k in ("camera", "ring"):
        assert P[k]["group"] == "Cameras" and P[k]["wave"] == "B" and P[k]["name"] and P[k]["source"] and P[k]["wakes"]
        assert P[k]["off"] is True and P[k]["pick"] is None, k                        # off until placed (decision 7)
        assert P[k]["facts"] == [k]
    assert P["camera"]["opts"] == {"camera": "entity:camera"} and P["camera"]["when"] is None and P["camera"]["accent"] is None
    assert P["ring"]["opts"] == {} and P["ring"]["when"] and P["ring"]["accent"] == ["#ffb340", "#b36b00"]       # Last Ring is amber
    # loaded twice: nothing is wrapped or listened for again
    assert out["again"] is True and out["listeners"] == 1 and out["core"] and out["v1"] is None


def test_every_piece_and_shape_draws_with_an_empty_house_and_a_small_one(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
fire('hk-house-event', doorbell({ snap: 'snap-1.jpg' }));
flush();
Object.keys(CATALOG).forEach(function (p) {
  CATALOG[p].forEach(function (s) {
    [['empty', EMPTY], ['house', client()], ['nows', { states: houseStates(), config: {} }]].forEach(function (h, hi) {
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
print(JSON.stringify({ results: results, errors: errors, warns: WARNS, left: ivs().length, alive: H.cameras.ENT.length }));
""", before=FAKES + "var H = W._;")
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == (2 + 2) * (9 + 1)
    assert out["left"] == 0 and out["alive"] == 0                                  # every piece let go of its place in the timer
    for r in out["results"]:
        key = (r["p"], r["s"], r["h"])
        assert "k-" + r["s"] in r["cls"] and "p-" + r["p"] in r["cls"], key
        if r["h"] == "sample":
            assert r["html"], key
            if r["p"] == "camera":
                assert "Front Door" in r["html"] and 'class="cam-ph"' in r["html"] and "<img" in r["html"]
                assert not r.get("acc")                                                # a camera has no accent: the picture is the color
            else:
                assert r["acc"] == "#ffb340"
            continue
        assert r["again"] is False, key                                            # redrawn only when the spec's JSON changes
        assert r["w"] >= 0 and r["hh"] >= 0
        if r["p"] == "camera":
            assert r["showing"] and r["html"], key                                 # always shows: a placeholder with no camera
            assert 'class="cam"' in r["html"] and 'class="cam-img"' in r["html"] and "cam-ph" in r["html"]
            if r["h"] == "empty":
                assert 'data-k=""' in r["html"] and " src=" not in r["html"] and ">Driveway<" in r["html"]    # Settings' first camera, no state: its name in words
        else:
            # the ring (a doorbell rang a moment ago) shows in a house with a clock; the name of its camera is not drawn
            assert r["showing"] and "Doorbell" in r["html"], key
    sizes = {(r["p"], r["s"]): (r["w"], r["hh"]) for r in out["results"] if r["h"] == "house"}
    assert sizes[("camera", "rectangular")] == (29 * 4, 13 * 4)
    assert sizes[("camera", "card")] == (30 * 4, 16.8 * 4)                         # (no layout under jsc: the unit size)
    assert sizes[("ring", "card")][1] == 23 * 4


def test_the_stills_address_is_the_side_panes(tmp_path):
    out = run(tmp_path, r"""
var C = W._.cameras, got = {};
got.direct = [C.stillUrl('/api/camera_proxy/camera.front_door?token=abc', 1), C.stillUrl('/proxy/stream', 7)];
var w = mk('camera', 'rectangular', { camera: 'camera.front_door' });
w.update(client(), T0);
flush();                                                       // the first still is asked for a moment after the first update
got.first = IMGS.map(function (i) { return i.src; });
loaded(IMGS[0]);
NOWMS += 10000; tickAll(); got.second = IMGS.map(function (i) { return i.src; });
loaded(IMGS[1]);
NOWMS += 10000; tickAll(); got.third = IMGS.map(function (i) { return i.src; });
// (the other camera counts on its own: the first of its asks is 1)
var d = mk('camera', 'card', { camera: 'camera.driveway' });
d.update(client(), T0); flush();
got.other = IMGS[IMGS.length - 1].src;
// a token the house rotates: the next ask is made from the state's picture NOW, not the old one
loaded(IMGS[2]);
var st = houseStates(); st['camera.front_door'].attributes.entity_picture = '/api/camera_proxy/camera.front_door?token=NEW';
NOWMS += 10000; var cl = client(st); w.update(cl, T0); d.update(cl, T0); tickAll();
got.rotated = IMGS.filter(function (i) { return /token=NEW/.test(i.src); }).map(function (i) { return i.src; });
print(JSON.stringify(got));
""", before=FAKES)
    assert out["direct"] == [
        "/api/camera_proxy/camera.front_door?token=abc&_hk=1&width=480&height=270",
        "/proxy/stream?_hk=7&width=480&height=270",
    ]
    assert out["first"] == ["/api/camera_proxy/camera.front_door?token=abc&_hk=1&width=480&height=270"]
    assert [u.split("_hk=")[1].split("&")[0] for u in out["second"]] == ["1", "2"]          # the cache-buster goes up, never repeats
    assert [u.split("_hk=")[1].split("&")[0] for u in out["third"]] == ["1", "2", "3"]
    assert out["other"] == "/api/camera_proxy/camera.driveway?token=def&_hk=1&width=480&height=270"
    assert len(out["rotated"]) == 1 and out["rotated"][0].startswith("/api/camera_proxy/camera.front_door?token=NEW&_hk=4&")
    # nothing but width, height, v and _hk after the credential (anything else is a 400 at the still route)
    for u in out["third"] + out["rotated"] + [out["other"]]:
        keys = {kv.split("=")[0] for kv in u.split("?")[1].split("&")}
        assert keys <= {"token", "_hk", "width", "height", "v"} and {"_hk", "width", "height"} <= keys, u
        assert "hk_n" not in u


def test_a_still_goes_into_the_img_in_place_and_a_failure_is_not_asked_again(tmp_path):
    out = run(tmp_path, r"""
var w = mk('camera', 'rectangular', { camera: 'camera.front_door' }), got = {};
var cl = client();
w.update(cl, T0); flush();
got.before = w.el.innerHTML;                                   // no still yet: the ground and its glyph, an <img> with no src
loaded(IMGS[0]);
got.after = srcs(w.el);                                        // in place: update() was not called
got.redrawn = w.update(cl, T0);                                // (and the spec has not changed: nothing is drawn again)
got.kept = srcs(w.el);
NOWMS += 10000; tickAll(); loaded(IMGS[1]);
got.next = srcs(w.el);
// a picture that has no size is a failure; the same address is not asked for again for a minute
NOWMS += 10000; tickAll(); loaded(IMGS[2], false);
var n = IMGS.length;
NOWMS += 10000; tickAll(); NOWMS += 10000; tickAll();
got.quiet = IMGS.length - n;
got.kept2 = srcs(w.el);
NOWMS += 61000; tickAll();
got.after_minute = IMGS.length - n;
// an error is the same
failed(IMGS[IMGS.length - 1]);
n = IMGS.length; NOWMS += 10000; tickAll();
got.quiet2 = IMGS.length - n;
// a second piece on the same camera has the still already, and asks for nothing more
var v = mk('camera', 'card', { camera: 'camera.front_door' }); v.update(cl, T0); flush();
got.card = srcs(v.el);
print(JSON.stringify(got));
""", before=FAKES)
    assert " src=" not in out["before"] and 'data-k="cam:camera.front_door"' in out["before"] and "Front Door" in out["before"]
    assert out["after"] == ["/api/camera_proxy/camera.front_door?token=abc&_hk=1&width=480&height=270"]
    assert out["redrawn"] is False and out["kept"] == out["after"]
    assert out["next"] == ["/api/camera_proxy/camera.front_door?token=abc&_hk=2&width=480&height=270"]
    assert out["quiet"] == 0 and out["kept2"] == out["next"]                       # the old frame stays; nothing hammers a failing route
    assert out["after_minute"] == 1 and out["quiet2"] == 0
    assert out["card"] == out["next"]                                              # drawn with the last still that loaded


def test_restored_stale_unavailable_and_pictureless_cameras_are_skipped(tmp_path):
    out = run(tmp_path, r"""
var st = houseStates(), got = {};
st['camera.restored'] = camState('Restored', '/api/camera_proxy/camera.restored?token=x', { restored: true });
st['camera.stale'] = camState('Stale', '/api/camera_proxy/camera.stale?token=x');
STALE = st['camera.stale'];
st['camera.down'] = camState('Down', '/api/camera_proxy/camera.down?token=x'); st['camera.down'].state = 'unavailable';
st['camera.bare'] = camState('Bare', '');
var cl = client(st);
['camera.restored', 'camera.stale', 'camera.down', 'camera.bare', 'camera.missing'].forEach(function (id) {
  var w = mk('camera', 'card', { camera: id });
  w.update(cl, T0); flush(); tickAll();
  got[id] = { imgs: IMGS.length, timers: ivs().length, srcs: srcs(w.el), html: w.el.innerHTML, showing: w.showing };
  w.destroy();
});
// the one that is fine, in the same house, is asked for
var ok = mk('camera', 'card', { camera: 'camera.front_door' }); ok.update(cl, T0); flush();
got.ok = { imgs: IMGS.length, timers: ivs().length };
// one that goes unavailable after it had a still shows none (an old frame is not now), and comes back drawn again
loaded(IMGS[0]);
st['camera.front_door'].state = 'unavailable'; ok.update(cl, T0);
got.gone = srcs(ok.el); got.gone_timers = ivs().length;
st['camera.front_door'].state = 'idle'; ok.update(cl, T0); got.back = ok.el.innerHTML;
print(JSON.stringify(got));
""", before=FAKES)
    for k in ("camera.restored", "camera.stale", "camera.down", "camera.bare", "camera.missing"):
        assert out[k]["imgs"] == 0 and out[k]["timers"] == 0 and out[k]["srcs"] == [], k
        assert out[k]["showing"] and 'class="cam-ph"' in out[k]["html"] and 'data-k=""' in out[k]["html"], k       # the dark placeholder
    assert "Restored" in out["camera.restored"]["html"] and ">Missing<" in out["camera.missing"]["html"]       # its name, or the id in words
    assert out["ok"] == {"imgs": 1, "timers": 1}
    assert out["gone"] == [] and out["gone_timers"] == 0
    assert 'data-k="cam:camera.front_door"' in out["back"] and " src=" not in out["back"]                      # (the next ask draws the new one)


def test_the_default_camera_is_the_settings_order_else_alphabetical(tmp_path):
    out = run(tmp_path, r"""
var st = houseStates(), got = {};
function name(opts, c) { var w = mk('camera', 'rectangular', opts); w.update(c || client(st), T0); var m = /data-k="cam:([^"]*)"/.exec(w.el.innerHTML); w.destroy(); return m ? m[1] : w.el.innerHTML; }
got.order = name({});                                              // the first of cameras.order the house has
got.picked = name({ camera: 'camera.front_door' });
got.bad_pick = name({ camera: 'light.kitchen' });                  // (not a camera: the default)
GET['cameras.order'] = ['camera.gone', 'camera.front_door'];
got.skips_missing = name({});
GET['cameras.order'] = [];
got.alpha = name({});
delete GET['cameras.order'];
got.nosetting = name({});
GET['cameras.order'] = ['camera.only_in_settings'];
got.none_in_house = name({}, EMPTY);
GET['cameras.order'] = [];
got.none_html = (function () { var w = mk('camera', 'card', {}); w.update(EMPTY, T0); return w.el.innerHTML; })();
print(JSON.stringify(got));
""", before=FAKES)
    assert out["order"] == "camera.driveway" and out["picked"] == "camera.front_door" and out["bad_pick"] == "camera.driveway"
    assert out["skips_missing"] == "camera.front_door" and out["alpha"] == "camera.driveway" and out["nosetting"] == "camera.driveway"
    assert ">Only In Settings<" in out["none_in_house"] and 'data-k=""' in out["none_in_house"]
    assert ">Camera<" in out["none_html"]


def test_one_timer_is_shared_started_once_and_stopped_after_the_last_is_destroyed(tmp_path):
    out = run(tmp_path, r"""
var got = {}, cl = client();
got.start = ivs().length;
var a = mk('camera', 'rectangular', { camera: 'camera.front_door' });
got.created = ivs().length;                                        // a piece that has not updated has no timer
a.update(cl, T0);
got.one = ivs().map(function (i) { return i.ms; });
var b = mk('camera', 'card', { camera: 'camera.driveway' });
b.update(cl, T0);
var c = mk('camera', 'card', { camera: 'camera.front_door' });     // a second piece on the first camera
c.update(cl, T0);
got.three = ivs().map(function (i) { return i.ms; });
a.update(cl, T0); b.update(cl, T0);
got.after_updates = ivs().length;
flush();
// one ask for each CAMERA (three pieces, two cameras), every ten seconds
var n0 = IMGS.length; IMGS.forEach(function (m) { loaded(m); }); NOWMS += 10000; tickAll(); got.asks = [n0, IMGS.length - n0];
a.destroy(); got.after_a = ivs().length;
c.destroy(); got.after_c = ivs().length;                          // b still wants the driveway
b.destroy(); got.after_all = ivs().length;
var n1 = IMGS.length; NOWMS += 10000; tickAll(); got.dead_tick = IMGS.length - n1;
// a ring (no still wanted) keeps no timer
var r = mk('ring', 'inline'); r.update(cl, T0); got.ring = ivs().length; r.destroy();
// a new one after all were gone starts it again, once
var d = mk('camera', 'card', { camera: 'camera.front_door' }); d.update(cl, T0); got.restart = ivs().length; d.destroy(); got.stop_again = ivs().length;
// a piece with nothing to want (no camera in the house) does not start it
var e = mk('camera', 'card', {}); e.update(EMPTY, T0); got.none_wanted = ivs().length; e.destroy();
// destroyed twice, updated after: harmless
d.destroy(); d.update(cl, T0); got.late = ivs().length;
print(JSON.stringify(got));
""", before=FAKES)
    assert out["start"] == 0 and out["created"] == 0
    assert out["one"] == [10000] and out["three"] == [10000] and out["after_updates"] == 1
    assert out["asks"] == [2, 2]                                                   # two cameras asked for at the first moment, again ten seconds on
    assert out["after_a"] == 1 and out["after_c"] == 1 and out["after_all"] == 0
    assert out["dead_tick"] == 0
    assert out["ring"] == 0 and out["restart"] == 1 and out["stop_again"] == 0 and out["none_wanted"] == 0 and out["late"] == 0


def test_nothing_is_asked_while_the_page_or_the_piece_is_hidden(tmp_path):
    out = run(tmp_path, r"""
var cl = client(), got = {};
var a = mk('camera', 'rectangular', { camera: 'camera.front_door' }), b = mk('camera', 'card', { camera: 'camera.driveway' });
a.update(cl, T0); b.update(cl, T0); flush(); loaded(IMGS[0]); loaded(IMGS[1]);
got.timer = ivs().length;
function asks() { var n = IMGS.length; NOWMS += 10000; tickAll(); return IMGS.length - n; }
got.visible = asks();                                              // (2: both)
loaded(IMGS[IMGS.length - 1]); loaded(IMGS[IMGS.length - 2]);
document.visibilityState = 'hidden'; got.page_hidden = asks();
document.visibilityState = 'visible';
a.el.style.display = 'none'; got.a_display = asks();               // the plan hid it (claimed or gone): only the driveway
loaded(IMGS[IMGS.length - 1]);
a.el.style.display = ''; b.el.style.visibility = 'hidden'; got.b_hidden = asks();
loaded(IMGS[IMGS.length - 1]);
b.el.style.visibility = ''; b.el.isConnected = false; got.b_detached = asks();
loaded(IMGS[IMGS.length - 1]);
b.el.isConnected = true; a.el.getClientRects = function () { return []; }; b.el.getClientRects = function () { return [1]; }; got.a_no_box = asks();
got.timer_kept = ivs().length;                                      // (hidden costs a no-op tick; the timer stops only when none is alive)
// the page coming back at the front asks at once (a moment later, coalesced)
loaded(IMGS[IMGS.length - 1]);
a.el.getClientRects = function () { return [1]; };
NOWMS += 20000; document.visibilityState = 'hidden'; fire('visibilitychange'); flush(); got.back_hidden = 0;
var n = IMGS.length; document.visibilityState = 'visible'; fire('visibilitychange'); got.queued = TQ.length; flush(); got.back = IMGS.length - n;
print(JSON.stringify(got));
""", before=FAKES)
    assert out["timer"] == 1 and out["visible"] == 2
    assert out["page_hidden"] == 0 and out["a_display"] == 1 and out["b_hidden"] == 1 and out["b_detached"] == 1 and out["a_no_box"] == 1
    assert out["timer_kept"] == 1
    assert out["queued"] == 1 and out["back"] == 2


def test_last_ring_shows_for_thirty_minutes_and_wakes_deferred(tmp_path):
    out = run(tmp_path, r"""
var got = {}, cl = client();
var inl = mk('ring', 'inline'), card = mk('ring', 'card'), inl24 = mk('ring', 'inline', {}, { h24: true });
var ws = [inl, card, inl24], calls = [0, 0, 0];
ws.forEach(function (w, i) { var u = w.update; w.update = function () { calls[i]++; return u.apply(w, arguments); }; });
ws.forEach(function (w) { w.update(cl, T0); });
got.none = ws.map(function (w) { return [w.showing, w.el.innerHTML]; });
var base = calls.slice();
// events that are not a ring are not seen
fire('hk-house-event', { type: 'notification', kind: 'motion', camera: 'camera.front_door' });
fire('hk-house-event', { type: 'person', kind: 'doorbell' });
fire('hk-house-event', null); fire('hk-house-event', {});
got.ignored = [TQ.length, calls.join()];
// a ring: nothing is drawn from inside the event; one timeout, however many rings; the pieces wake together a moment later
fire('hk-house-event', doorbell());
fire('hk-house-event', doorbell());
fire('hk-house-event', doorbell());
got.sync = [calls.join() === base.join(), TQ.length, TQ[0].ms];
flush();
got.woke = calls.map(function (c, i) { return c - base[i]; });
got.after = ws.map(function (w) { return [w.showing, w.el.innerHTML]; });
got.live = [ivs().length, WSCALLS.length];
// the thirty minutes (the minute's update ends them), a clock a minute behind, and an earlier day
got.windows = [0, 29, 29.9, 30, 31, -1, -10].map(function (m) { inl.update(cl, at(m)); return [m, inl.showing, inl.el.innerHTML.length > 0]; });
// a later ring replaces the earlier
inl.update(cl, at(0));
NOWMS += 40 * 60000;
fire('hk-house-event', doorbell({ ts: NOWMS / 1000 })); flush();
inl.update(cl, new Date(NOWMS)); got.second = [inl.showing, inl.el.innerHTML];
// no ts: the moment it was seen; an old one (a replay): also then
NOWMS += 1000; fire('hk-house-event', doorbell({ ts: undefined })); flush(); inl.update(cl, new Date(NOWMS)); got.nots = H.cameras.ring().at === NOWMS;
fire('hk-house-event', doorbell({ ts: (NOWMS - 3 * 86400000) / 1000 })); got.stale_ts = H.cameras.ring().at === NOWMS;
print(JSON.stringify(got));
""", before=FAKES + "var H = W._;")
    assert out["none"] == [[False, ""], [False, ""], [False, ""]]
    assert out["ignored"][0] == 0 and out["ignored"][1] == "1,1,1"
    assert out["sync"] == [True, 1, 0]                                             # not synchronous; one coalesced setTimeout(0)
    assert out["woke"] == [1, 1, 1]
    inline, card, inline24 = out["after"]
    assert inline[0] is True and "Doorbell 4:02 PM" in inline[1] and '<svg class="a"' in inline[1]                 # a bell, in the accent
    assert inline24[0] is True and "Doorbell 16:02" in inline24[1]
    assert card[0] is True and "Doorbell rang at 4:02 PM" in card[1] and 'class="dot a"' in card[1]
    assert out["live"] == [1, 0]                                                   # (the card wants the camera's still: one timer; nothing to sign)
    assert [(m, s) for m, s, _ in out["windows"]] == [(0, True), (29, True), (29.9, True), (30, False), (31, False), (-1, True), (-10, False)]
    assert all(drawn == shows for _, shows, drawn in out["windows"])               # a piece that does not show draws nothing
    assert out["second"][0] is True and "Doorbell 4:42 PM" in out["second"][1]
    assert out["nots"] is True and out["stale_ts"] is True


def test_the_ring_cards_snapshot_is_signed_once_with_the_notify_calls_shape(tmp_path):
    out = run(tmp_path, r"""
var got = {}, cl = client();
fire('hk-house-event', doorbell({ snap: 'snap-abc.jpg' })); flush();
var a = mk('ring', 'card'), b = mk('ring', 'card'), i = mk('ring', 'inline');
a.update(cl, T0);
got.sync = WSCALLS.length;                                          // a read does not call out: a moment later
b.update(cl, T0); i.update(cl, T0);
got.queued = TQ.length;
flush();
got.calls = JSON.parse(JSON.stringify(WSCALLS));
got.pending = [a.el.innerHTML, srcs(a.el), ivs().length, IMGS.length];           // the placeholder meanwhile, not the porch
a.update(cl, T0); b.update(cl, T0); flush();
got.still_once = WSCALLS.length;
WSPEND.shift().ok({ signed: { 'snap-abc.jpg': '/api/hk_notify/snap/snap-abc.jpg?sig=1&exp=2' } });
got.loading = IMGS.map(function (m) { return m.src; });
loaded(IMGS[0]);
got.queued2 = TQ.length;
flush();
got.done = [srcs(a.el), srcs(b.el), a.el.innerHTML.indexOf('data-k="snap:snap-abc.jpg"') >= 0, ivs().length, IMGS.length];
// the signed address is good eight minutes; after it the camera's own still takes over (the file is kept ten)
NOWMS += 8 * 60000 + 1000;
a.update(cl, new Date(NOWMS));
got.expired = [a.el.indexOf === undefined, a.el.innerHTML.indexOf('data-k="cam:camera.front_door"') >= 0, ivs().length];
print(JSON.stringify(got));
""", before=FAKES)
    assert out["sync"] == 0 and out["queued"] == 1                                 # (one timeout carries it)
    assert out["calls"] == [{"type": "hk_notify/snap/sign", "snaps": ["snap-abc.jpg"]}]
    html, srcs_, timers, imgs = out["pending"]
    assert 'data-k=""' in html and srcs_ == [] and "Doorbell rang at 4:02 PM" in html and timers == 0 and imgs == 0
    assert out["still_once"] == 1                                                   # signed once, for two cards
    assert out["loading"] == ["/api/hk_notify/snap/snap-abc.jpg?sig=1&exp=2"]      # loaded off screen before it is shown
    assert out["queued2"] == 1
    sa, sb, has_k, timers, imgs = out["done"]
    assert sa == sb == ["/api/hk_notify/snap/snap-abc.jpg?sig=1&exp=2"] and has_k and timers == 0 and imgs == 1
    assert out["expired"][1] is True and out["expired"][2] == 1


def test_the_ring_card_falls_back_to_the_cameras_still(tmp_path):
    out = run(tmp_path, r"""
var got = {};
function card(beforeFlush) {
  var c = client(), w = mk('ring', 'card');
  w.update(c, T0); flush();
  if (beforeFlush) beforeFlush();
  flush(); w.update(c, T0); flush();
  var r = { k: (/data-k="([^"]*)"/.exec(w.el.innerHTML) || [])[1], timers: ivs().length, asks: IMGS.map(function (i) { return i.src; }), calls: WSCALLS.length, w: w };
  w.destroy(); return r;
}
function reset() { IMGS.length = 0; WSCALLS.length = 0; WSPEND.length = 0; SNAPS_CLEAR(); }
function SNAPS_CLEAR() { Object.keys(W._.cameras.SNAPS).forEach(function (k) { delete W._.cameras.SNAPS[k]; }); Object.keys(W._.cameras.STILLS).forEach(function (k) { delete W._.cameras.STILLS[k]; }); }
// no snapshot at all: the camera's still from the first
fire('hk-house-event', doorbell()); flush();
var r = card(); got.nosnap = [r.k, r.timers, r.asks.length, r.calls];
// a signature that comes back empty; one that is refused; a snapshot that will not load; a client that cannot sign
reset(); fire('hk-house-event', doorbell({ snap: 's1.jpg' })); flush();
r = card(function () { WSPEND.shift().ok({}); flush(); }); got.empty = [r.k, r.asks.length];
reset(); fire('hk-house-event', doorbell({ snap: 's2.jpg' })); flush();
r = card(function () { WSPEND.shift().bad(new Error('no')); flush(); }); got.refused = [r.k, r.asks.length];
reset(); fire('hk-house-event', doorbell({ snap: 's3.jpg' })); flush();
r = card(function () { WSPEND.shift().ok({ signed: { 's3.jpg': '/signed/s3.jpg' } }); flush(); failed(IMGS[0]); flush(); }); got.unloadable = [r.k, r.asks.length, r.asks[0], r.asks[1]];
reset(); fire('hk-house-event', doorbell({ snap: 's4.jpg' })); flush();
(function () { var c = client(null, true), w = mk('ring', 'card'); w.update(c, T0); flush(); flush(); w.update(c, T0); got.nows = [/data-k="([^"]*)"/.exec(w.el.innerHTML)[1], WSCALLS.length]; w.destroy(); })();
// a snapshot too old to be there (the file is kept ten minutes): not signed at all
reset(); fire('hk-house-event', doorbell({ snap: 's5.jpg', ts: (NOWMS - 9.5 * 60000) / 1000 })); flush();
(function () { var c = client(), w = mk('ring', 'card'); w.update(c, T0); flush(); got.old = [WSCALLS.length, /data-k="([^"]*)"/.exec(w.el.innerHTML)[1]]; w.destroy(); })();
// a doorbell that names no camera: the dark placeholder and the words
reset(); fire('hk-house-event', doorbell({ camera: '', snap: '' })); flush();
(function () { var c = client(), w = mk('ring', 'card'); w.update(c, T0); flush(); got.nocam = [w.el.innerHTML, ivs().length, IMGS.length]; w.destroy(); })();
// a camera this screen cannot read (no state): the same
reset(); fire('hk-house-event', doorbell({ camera: 'camera.hidden' })); flush();
(function () { var c = client(), w = mk('ring', 'card'); w.update(c, T0); flush(); got.hidden = [/data-k="([^"]*)"/.exec(w.el.innerHTML)[1], ivs().length]; w.destroy(); })();
print(JSON.stringify(got));
""", before=FAKES)
    assert out["nosnap"] == ["cam:camera.front_door", 1, 1, 0]
    assert out["empty"] == ["cam:camera.front_door", 1] and out["refused"] == ["cam:camera.front_door", 1]
    assert out["unloadable"][0] == "cam:camera.front_door" and out["unloadable"][1:3] == [2, "/signed/s3.jpg"] and "camera_proxy" in out["unloadable"][3]
    assert out["nows"] == ["cam:camera.front_door", 0]
    assert out["old"] == [0, "cam:camera.front_door"]
    html, timers, imgs = out["nocam"]
    assert 'data-k=""' in html and "cam-ph" in html and "Doorbell rang at 4:02 PM" in html and timers == 0 and imgs == 0
    assert out["hidden"] == ["", 0]


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "requestAnimationFrame", "Mantel", "Math.random"):
        assert word not in src, word
    for word in ("colour", "centre", "grey", "favourite"):
        assert word not in src.lower(), word
    assert src.count("setInterval(") == 1 and src.count("clearInterval(") == 1                  # the ONE shared timer
    assert "requestUpdate" not in src and "hkStats" not in src
    # the stills are never a stream
    assert "stream" not in re.sub(r"//.*", "", src).lower()
    css = re.search(r"var CSS = \[(.*?)\]\.join", src, re.S).group(1)
    assert "px" not in css.replace("0 1px 4px", "")                                              # everything in --u (the label's 1px shadow only)
    assert css.count("filter") == 0 and "blur" not in css
    # spacing: every inset, padding and margin sits on the scale (.4 .8 1.2 1.6 2.4 3.2), or the card's 2 u padding
    scale = {0.4, 0.8, 1.2, 1.6, 2.4, 3.2, 2.0, 0.0}
    for prop, val in re.findall(r"(?:^|[;{'])(padding|margin|left|bottom|top|right|gap)\s*:\s*([^;}']+)", css):
        for n in re.findall(r"var\(--u\) \* ([\d.]+)", val):
            assert float(n) in scale, (prop, val)
    # a rounded corner of 2.2 u is the renderer's (rectangular and card); this group adds no radius of its own
    assert "border-radius" not in css


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
