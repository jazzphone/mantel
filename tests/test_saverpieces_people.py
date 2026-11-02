"""The screensaver's People piece (web/hk/modules/hk-saverpieces-people.js; docs/phase13/GLANCE-SPEC.md, wave B): who, in each
of its shapes, with an empty house and a small one; what it reads (person.*: home, not_home or a zone, friendly_name,
entity_picture); the person picked (opts.person), the picture and the initial; the accents; that it is off until placed; and the
look keeps the plan's rules (nothing animates, nothing blurs, no timers, nothing waking a read). Run under macOS's
JavaScriptCore with the renderer's own DOM shim (tests/test_saverwidgets_pieces.py)."""
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
GROUP = ROOT / "web/hk/modules/hk-saverpieces-people.js"

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


# the house, as fakes: persons (state, friendly_name, entity_picture)
FAKES = r"""
var T0 = new Date(2026, 10, 2, 13, 10, 0);
function person(id, state, name, pic) {
  var a = {};
  if (name !== null) a.friendly_name = name;
  if (pic) a.entity_picture = pic;
  return { state: state, attributes: a };
}
function house(o) { var st = {}; Object.keys(o).forEach(function (k) { st[k] = o[k]; }); return { states: st, config: {} }; }
var EMPTY = { states: {}, config: {} };
var BOTH = house({ 'person.emma': person('person.emma', 'home', 'Emma Larsen'), 'person.mark': person('person.mark', 'home', 'Mark Larsen') });
function mk(shape, opts, back) { return W.create('who', shape, { u: 4, back: back || 'none', opts: opts || {}, h24: false, color: 'auto' }); }
function show(shape, c, opts) {
  var w = mk(shape, opts); w.update(c, T0);
  var r = { showing: w.showing, html: w.el.innerHTML, acc: w.el.style.props['--sw-acc'] || null, accd: w.el.style.props['--sw-acc-d'] || null };
  w.destroy(); return r;
}
function text(html) { return html.replace(/<[^>]*>/g, '|').split('|').filter(function (x) { return x; }); }
"""

HOUSE = r"""
var SAMPLE_HOUSE = house({
  'person.emma': person('person.emma', 'home', 'Emma Larsen'),
  'person.jo': person('person.jo', 'Work', 'Jo Larsen'),
  'person.mark': person('person.mark', 'not_home', 'Mark Larsen', '/api/image/serve/abc/512x512')
});
"""


def test_the_declaration_is_complete_and_off_until_placed(tmp_path):
    out = run(tmp_path, r"""
var d = W.PIECES.who;
print(JSON.stringify({ name: d.name, group: d.group, wave: d.wave, facts: d.facts, source: d.source, when: d.when, wakes: d.wakes, pick: d.pick, off: d.off,
  opts: d.opts, accent: typeof d.accent, shapes: Object.keys(d.shapes).sort(), core: !!W.PIECES.weather,
  double: (function () { load(GROUPFILE); return Object.keys(W.PIECES).length; })(), n: Object.keys(W.PIECES).length }));
""", before=FAKES + f"var GROUPFILE = {json.dumps(str(GROUP))};")
    assert out["shapes"] == ["circular", "inline", "rectangular"]
    assert out["name"] == "Who’s Home" and out["group"] == "People" and out["wave"] == "B" and out["source"] and out["wakes"]
    assert out["facts"] == ["people"] and out["when"] is None and out["pick"] is None
    assert out["off"] is True                                            # decision 7: off until placed
    assert out["opts"] == {"person": "entity:person"}
    assert out["accent"] == "function" and out["core"]
    assert out["double"] == out["n"]                                     # loaded twice: nothing is added again


def test_every_shape_draws_with_an_empty_house_and_a_sample_one(tmp_path):
    out = run(tmp_path, r"""
var results = [], errors = [];
['inline', 'circular', 'rectangular'].forEach(function (s) {
  [['empty', EMPTY], ['house', SAMPLE_HOUSE]].forEach(function (h, hi) {
    ['none', 'glass', 'tint'].forEach(function (back, bi) {
      try {
        var w = W.create('who', s, { u: 4, back: back, color: bi === 2 ? 'accent' : 'auto', h24: hi === 1, opts: {} });
        if (!w) { errors.push('no create ' + s); return; }
        var drew = w.update(h[1], T0), again = w.update(h[1], T0), m = w.measure();
        results.push({ s: s, h: h[0], drew: drew, again: again, html: w.el.innerHTML, showing: w.showing, live: w.live, w: m.w, hh: m.h, cls: w.el.className });
        w.setU(5);
        w.destroy();
      } catch (e) { errors.push(s + ': ' + e + ' ' + (e && e.stack)); }
    });
  });
  try {
    var el = W.sample('who', s, { u: 4, back: 'glass' });
    results.push({ s: s, h: 'sample', html: el.innerHTML, acc: el.style.props['--sw-acc'], cls: el.className });
    var el2 = W.sample('who', s, { u: 4, opts: { person: 'person.emma' } });
    results.push({ s: s, h: 'sample', html: el2.innerHTML, acc: el2.style.props['--sw-acc'], cls: el2.className });
  } catch (e) { errors.push('sample ' + s + ': ' + e); }
});
print(JSON.stringify({ results: results, errors: errors, warns: WARNS }));
""", before=FAKES + HOUSE)
    assert out["errors"] == [] and out["warns"] == []
    assert len(out["results"]) == 3 * (2 * 3 + 2)
    for r in out["results"]:
        key = (r["s"], r["h"])
        assert "k-" + r["s"] in r["cls"] and "p-who" in r["cls"], key
        if r["h"] != "sample":
            assert r["again"] is False and r["showing"] is True and r["live"] is False and r["w"] >= 0 and r["hh"] > 0, key
        assert len(r["html"]) > 0, key
        assert "NaN" not in r["html"] and "undefined" not in r["html"] and "null" not in r["html"] and "Mantel" not in r["html"], key
        if r["h"] == "sample":
            assert r["acc"], key                                         # a sample carries an accent
    # an empty house is dashes, never "nobody home"
    for r in out["results"]:
        if r["h"] == "empty":
            assert "—" in r["html"] and "Nobody" not in r["html"] and "AWAY" not in r["html"], r["s"]
    # a circle is the renderer's: the track 7.5 wide, radius 43, the label on the baseline 72
    for r in out["results"]:
        if r["s"] == "circular":
            assert 'stroke-width="7.5"' in r["html"] and 'y="72"' in r["html"] and 'viewBox="0 0 100 100"' in r["html"] and 'r="43"' in r["html"], r["h"]


def test_inline_says_who_is_home(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function inline(st) { var x = show('inline', st); return [text(x.html).join(''), x.acc, x.accd, x.html.indexOf('<svg') >= 0]; }
r.all = inline(BOTH);
r.one = inline(house({ 'person.emma': person('person.emma', 'home', 'Emma Larsen') }));
r.some = inline(house({ 'person.emma': person('person.emma', 'home', 'Emma Larsen'), 'person.mark': person('person.mark', 'not_home', 'Mark Larsen') }));
r.two = inline(house({ 'person.emma': person('person.emma', 'home', 'Emma Larsen'), 'person.jo': person('person.jo', 'home', 'Jo'), 'person.mark': person('person.mark', 'not_home', 'Mark') }));
r.three = inline(house({ 'person.a': person('person.a', 'home', 'Ann'), 'person.b': person('person.b', 'home', 'Bo'), 'person.c': person('person.c', 'home', 'Cy'), 'person.d': person('person.d', 'not_home', 'Di') }));
r.four = inline(house({ 'person.a': person('person.a', 'home', 'Ann'), 'person.b': person('person.b', 'home', 'Bo'), 'person.c': person('person.c', 'home', 'Cy'),
                        'person.d': person('person.d', 'home', 'Di'), 'person.e': person('person.e', 'home', 'Ed'), 'person.f': person('person.f', 'not_home', 'Flo') }));
r.none = inline(house({ 'person.emma': person('person.emma', 'not_home', 'Emma'), 'person.mark': person('person.mark', 'not_home', 'Mark') }));
r.zones = inline(house({ 'person.emma': person('person.emma', 'Work', 'Emma'), 'person.mark': person('person.mark', 'School', 'Mark') }));
r.unknown_all = inline(house({ 'person.emma': person('person.emma', 'unavailable', 'Emma'), 'person.mark': person('person.mark', 'unknown', 'Mark') }));
r.unknown_some_home = inline(house({ 'person.emma': person('person.emma', 'home', 'Emma'), 'person.mark': person('person.mark', 'unavailable', 'Mark') }));
r.unknown_none_home = inline(house({ 'person.emma': person('person.emma', 'not_home', 'Emma'), 'person.mark': person('person.mark', 'unavailable', 'Mark') }));
r.noname = inline(house({ 'person.sam_jones': person('person.sam_jones', 'home', null) }));
r.empty = inline(EMPTY);
r.lower = inline(house({ 'person.zed': person('person.zed', 'home', 'zed the great') }));
print(JSON.stringify(r));
""", before=FAKES)
    A = "’"
    green, gray = "#5fd38a", "#aeb4bd"
    assert out["all"][0] == f"Everyone{A}s home" and out["all"][1] == green and out["all"][3]
    assert out["one"][0] == f"Emma{A}s home"
    assert out["some"][0] == "Emma home" and out["some"][1] == green
    assert out["two"][0] == "Emma and Jo home"
    assert out["three"][0] == "Ann, Bo and Cy home"
    assert out["four"][0] == "Ann, Bo and 3 more home"
    assert out["none"][0] == "Nobody home" and out["none"][1] == gray and out["none"][2] == "#6a7079"
    assert out["zones"][0] == "Nobody home" and out["zones"][1] == gray                # in a zone is away from home
    # an unknown or unavailable state is no answer: never "Nobody home", never "Everyone's home"
    assert out["unknown_all"][0] == "—" and out["unknown_all"][1] is None and out["unknown_all"][3] is False
    assert out["unknown_some_home"][0] == "Emma home"
    assert out["unknown_none_home"][0] == "—"
    assert out["noname"][0] == f"Sam{A}s home"                                          # the id's words when there is no friendly_name
    assert out["lower"][0] == f"zed{A}s home"                                           # the first word of friendly_name, as it is
    assert out["empty"][0] == "—" and out["empty"][1] is None


def test_circular_is_one_person_with_an_initial_or_a_picture(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function circ(st, opts) { var x = show('circular', st, opts); return { t: text(x.html), acc: x.acc, html: x.html }; }
// the default: the first person.* alphabetically (by entity id)
r.def = circ(SAMPLE_HOUSE);
r.emma = circ(SAMPLE_HOUSE, { person: 'person.emma' });
r.jo = circ(SAMPLE_HOUSE, { person: 'person.jo' });
r.mark = circ(SAMPLE_HOUSE, { person: 'person.mark' });
r.missing = circ(SAMPLE_HOUSE, { person: 'person.nobody' });
r.badopt = circ(SAMPLE_HOUSE, { person: 'light.kitchen' });
r.unknown = circ(house({ 'person.emma': person('person.emma', 'unavailable', 'Emma') }));
r.none = circ(EMPTY);
r.empty_opt = circ(EMPTY, { person: 'person.emma' });
r.longzone = circ(house({ 'person.emma': person('person.emma', "Grandma's House", 'Emma') }));
r.underscore = circ(house({ 'person.emma': person('person.emma', 'not_home', 'Emma') }));
r.badpic = ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example/x.png', 'https://pics.example/e.jpg', '/local/e.png'].map(function (p) {
  return circ(house({ 'person.emma': person('person.emma', 'home', 'Emma', p) })).html.indexOf('<image') >= 0;
});
r.quote = circ(house({ 'person.emma': person('person.emma', 'home', 'Emma', '/a.png?x="1"&y=<2>') })).html;
r.pic2 = ['person.mark', 'person.emma'].map(function (id) { return circ(SAMPLE_HOUSE, { person: id }).html.indexOf('<image') >= 0; });
// two persons with pictures, the second element drawn with another house after the first: no stale picture
var w = mk('circular', { person: 'person.mark' }); w.update(SAMPLE_HOUSE, T0); var withPic = w.el.innerHTML.indexOf('<image') >= 0;
w.update(house({ 'person.mark': person('person.mark', 'home', 'Mark') }), T0); var after = w.el.innerHTML.indexOf('<image') >= 0; w.destroy();
r.stale = [withPic, after];
print(JSON.stringify(r));
""", before=FAKES + HOUSE)
    green, gray = "#5fd38a", "#aeb4bd"
    # the default is Emma (person.emma < person.jo < person.mark): her initial, HOME, green, a full ring
    assert out["def"]["t"] == ["E", "HOME"] and out["def"]["acc"] == green
    assert out["emma"]["t"] == ["E", "HOME"] and out["emma"]["acc"] == green
    assert out["def"]["html"].count("stroke-dasharray") == 2 and "<image" not in out["def"]["html"]
    # the ring is full while home; its track alone while away
    full = re.findall(r'stroke-dasharray="([\d.]+) ([\d.]+)"', out["emma"]["html"])
    assert len(full) == 2 and float(full[1][0]) == pytest.approx(2 * 3.141592653589793 * 43, abs=0.01)
    away = re.findall(r'stroke-dasharray="([\d.]+) ([\d.]+)"', out["mark"]["html"])
    assert len(away) == 1                                                 # the track alone
    # Jo is in the Work zone: the zone's name on the label, gray (away from home)
    assert out["jo"]["t"] == ["J", "WORK"] and out["jo"]["acc"] == gray
    # Mark is away and has a picture: a round image (clipped), dimmed, his initial behind it for a picture that does not load
    assert out["mark"]["t"] == ["M", "AWAY"] and out["mark"]["acc"] == gray
    m = out["mark"]["html"]
    assert '<image href="/api/image/serve/abc/512x512"' in m and 'clip-path="url(#hkswwho)"' in m and 'opacity=".55"' in m
    assert '<clipPath id="hkswwho"><circle cx="50" cy="42" r="17"/></clipPath>' in m
    assert 'width="34" height="34"' in m and 'preserveAspectRatio="xMidYMid slice"' in m
    assert out["pic2"] == [True, False]
    assert out["stale"] == [True, False]
    # a person picked who the house does not have is missing, not away; not an entity of the domain is the default
    assert out["missing"]["t"] == ["—", "HOME"] and out["missing"]["acc"] is None
    assert out["badopt"]["t"] == ["E", "HOME"]
    assert out["unknown"]["t"] == ["E", "—"] and out["unknown"]["acc"] is None
    assert out["none"]["t"] == ["—", "HOME"] and out["empty_opt"]["t"] == ["—", "HOME"]
    assert out["longzone"]["t"] == ["E", "GRANDMA…"]                   # a short label
    assert out["underscore"]["t"] == ["E", "AWAY"]
    # only a path on the house or an http(s) address is a picture; the markup is escaped
    assert out["badpic"] == [False, False, False, True, True]
    assert 'href="/a.png?x=&quot;1&quot;&amp;y=&lt;2&gt;"' in out["quote"]


def test_rectangular_says_home_then_who_is_home_then_who_is_away(tmp_path):
    out = run(tmp_path, r"""
var r = {};
function rect(st, opts) { var x = show('rectangular', st, opts); return { t: text(x.html), acc: x.acc, dot: x.html.indexOf('class="dot a"') >= 0 }; }
r.sample = rect(SAMPLE_HOUSE);
r.all = rect(BOTH);
r.one_home = rect(house({ 'person.emma': person('person.emma', 'home', 'Emma') }));
r.none = rect(house({ 'person.emma': person('person.emma', 'not_home', 'Emma'), 'person.mark': person('person.mark', 'not_home', 'Mark') }));
r.two_away = rect(house({ 'person.a': person('person.a', 'home', 'Ann'), 'person.b': person('person.b', 'not_home', 'Bo'), 'person.c': person('person.c', 'not_home', 'Cy') }));
r.zone = rect(house({ 'person.a': person('person.a', 'home', 'Ann'), 'person.b': person('person.b', 'work', 'Bo') }));
r.unknown = rect(house({ 'person.a': person('person.a', 'unavailable', 'Ann') }));
r.unknown_home = rect(house({ 'person.a': person('person.a', 'home', 'Ann'), 'person.b': person('person.b', 'unknown', 'Bo') }));
r.empty = rect(EMPTY);
print(JSON.stringify(r));
""", before=FAKES + HOUSE)
    green, gray = "#5fd38a", "#aeb4bd"
    # Emma is home, Jo is at Work, Mark is away: the label, who is home (bold), who is away under it
    assert out["sample"]["t"] == ["HOME", "Emma", "Jo and Mark away"] and out["sample"]["acc"] == green and out["sample"]["dot"]
    assert out["all"]["t"] == ["HOME", "Emma and Mark", "No one away"] and out["all"]["acc"] == green
    assert out["one_home"]["t"] == ["HOME", "Emma", "No one away"]
    assert out["none"]["t"] == ["HOME", "Nobody", "Emma and Mark away"] and out["none"]["acc"] == gray
    assert out["two_away"]["t"] == ["HOME", "Ann", "Bo and Cy away"]
    assert out["zone"]["t"] == ["HOME", "Ann", "Bo at Work"]
    assert out["unknown"]["t"] == ["HOME", "—"] and out["unknown"]["acc"] is None and out["unknown"]["dot"] is False
    assert out["unknown_home"]["t"] == ["HOME", "Ann"] and out["unknown_home"]["acc"] == green
    assert out["empty"]["t"] == ["HOME", "—"]


def test_the_accent_follows_home_and_away(tmp_path):
    out = run(tmp_path, r"""
var r = {};
['inline', 'circular', 'rectangular'].forEach(function (s) {
  r[s] = { home: show(s, BOTH).acc, away: show(s, house({ 'person.emma': person('person.emma', 'not_home', 'Emma') })).acc, none: show(s, EMPTY).acc };
});
var d = W.PIECES.who.accent;
r.pairs = [d({ st: 'home' }), d({ st: 'away' }), d({ st: null })];
print(JSON.stringify(r))
""", before=FAKES)
    for s in ("inline", "circular", "rectangular"):
        assert out[s] == {"home": "#5fd38a", "away": "#aeb4bd", "none": None}, s
    assert out["pairs"][0] == ["#5fd38a", "#1f8a4c"] and out["pairs"][1] == ["#aeb4bd", "#6a7079"] and out["pairs"][2] is None


def test_people_with_no_states_or_a_bad_house_do_not_throw(tmp_path):
    out = run(tmp_path, r"""
var res = [], errors = [];
var bad = [
  { states: { 'person.a': { state: null, attributes: null }, 'person.b': null, 'person.c': {}, 'person.d': { state: 'home', attributes: { friendly_name: 7, entity_picture: 3 } } } },
  { states: undefined }, null, {}
];
['inline', 'circular', 'rectangular'].forEach(function (s) {
  bad.forEach(function (c, i) {
    try { var w = mk(s); w.update(c, T0); res.push(w.el.innerHTML.length); w.destroy(); }
    catch (e) { errors.push(s + '/' + i + ': ' + e); }
  });
});
print(JSON.stringify({ res: res, errors: errors, warns: WARNS }));
""", before=FAKES)
    assert out["errors"] == [] and out["warns"] == []


def test_the_look_keeps_the_plans_rules():
    src = GROUP.read_text()
    for word in ("backdrop-filter", "animation", "transition", "keyframes", "setInterval", "requestAnimationFrame", "setTimeout", "Mantel"):
        assert word not in src, word
    # American English, and nothing that wakes a read
    for word in ("colour", "centre", "grey", "favourite"):
        assert word not in src.lower(), word
    assert "requestUpdate" not in src and "hkStats" not in src
    # the piece adds no CSS of its own: it draws with the renderer's classes and the ring's box
    assert "addCss" not in src
    # the picture sits clear of the ring's track (radius 43, stroke 7.5) and of the label baseline (72)
    assert 'cx="50" cy="42" r="17"' in src


def test_the_file_is_valid_javascript():
    node = subprocess.run(["node", "--check", str(GROUP)], capture_output=True, text=True)
    if node.returncode == 127 or "No such file" in node.stderr:
        pytest.skip("node is not installed")
    assert node.returncode == 0, node.stderr
