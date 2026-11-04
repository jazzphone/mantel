"""Keep in View in the screensaver (web/hk/modules/hk-saver.js, shared with HK Frontend): the pure helpers that
crop and zoom a photo around its faces or a point set by hand, and the Mosaic choosing layouts that fit the photos'
shapes. hk-saver.js is loaded in node with the few window objects it touches at load time; only its pure helpers
(``hkSaver._``) are called. A photo without a focus must be laid out exactly as before (HK Frontend never has one).
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

import web_sources

ROOT = Path(__file__).resolve().parents[1]
SAVER = ROOT / "web/hk/modules/hk-saver.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

LOADER = r"""
const { readFileSync } = require('node:fs');
const noop = () => {};
const el = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : el()),
                                              apply: () => el() });
globalThis.window = globalThis;
globalThis.document = { addEventListener: noop, removeEventListener: noop, querySelector: () => null,
                        querySelectorAll: () => [], createElement: () => el(), body: el(), documentElement: el(),
                        visibilityState: 'visible', readyState: 'complete' };
globalThis.location = { pathname: '/', search: '', hash: '' };
globalThis.addEventListener = noop; globalThis.removeEventListener = noop;
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.HTMLElement = class {};
globalThis.hkHostClient = { entry: noop };
globalThis.hkShell = new Proxy({}, { get: () => () => null });
globalThis.customElements = { get: () => null, define: noop, whenDefined: () => Promise.resolve() };
// (the shell registers its parts' work once they have run: they are evaluated first, as the browser's import() would)
for (const part of JSON.parse(process.argv[2])) (0, eval)(readFileSync(part, 'utf8'));
(0, eval)(readFileSync(process.argv[1], 'utf8'));
const U = window.hkSaver._;
const out = {};
"""


def run(body: str) -> dict:
    got = subprocess.run(["node", "-e", LOADER + body + "\nconsole.log(JSON.stringify(out)); process.exit(0);",
                          str(SAVER), json.dumps([str(p) for p in web_sources.parts(SAVER)])], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout.strip().splitlines()[-1])


def near(a, b, tol=1e-6):
    return abs(a - b) <= tol


def test_face_window_centres_on_the_faces_and_clamps_at_the_edges():
    out = run("""
      // a 4000 x 3000 landscape photo in a 400 x 800 tall cell: a quarter of its width shows
      out.mid = U.faceWindow({ faces: [[0.45, 0.4, 0.1, 0.1]] }, 4000, 3000, 400, 800, 1);
      out.left = U.faceWindow({ faces: [[0.0, 0.4, 0.05, 0.1]] }, 4000, 3000, 400, 800, 1);
      out.right = U.faceWindow({ faces: [[0.93, 0.4, 0.06, 0.1]] }, 4000, 3000, 400, 800, 1);
      out.none = U.faceWindow({ id: 'a' }, 4000, 3000, 400, 800, 1);
      out.junk = U.faceWindow({ faces: [[2, 0, 1, 1]], focus: ['x', 1] }, 4000, 3000, 400, 800, 1);
      out.rect = U.coverRect(4000, 3000, 400, 800, out.mid.fx, out.mid.fy, 1);
    """)
    mid = out["mid"]
    assert near(mid["cx"], 0.5) and near(mid["fx"], 0.5)
    # the crop's middle is the face's middle
    r = out["rect"]
    assert near((r["sx"] + r["sw"] / 2) / 4000, 0.5, 1e-3)
    assert out["left"]["fx"] == 0 and out["right"]["fx"] == 1
    assert out["none"] is None and out["junk"] is None


def test_all_faces_when_they_fit_else_the_largest_ones():
    out = run("""
      // two faces near each other: both fit a quarter-width window
      out.both = U.faceWindow({ faces: [[0.40, 0.4, 0.06, 0.1], [0.50, 0.4, 0.06, 0.1]] }, 4000, 3000, 400, 800, 1);
      // far apart: the larger one is kept whole, the small one far away dropped
      out.apart = U.faceWindow({ faces: [[0.05, 0.4, 0.05, 0.08], [0.80, 0.3, 0.1, 0.15]] }, 4000, 3000, 400, 800, 1);
      // a group of three: the largest and the one beside it fit, the far one doesn't
      out.group = U.faceWindow({ faces: [[0.10, 0.4, 0.05, 0.08], [0.60, 0.4, 0.08, 0.12], [0.70, 0.4, 0.07, 0.11]] },
                               4000, 3000, 400, 800, 1);
    """)
    assert 0.40 < out["both"]["cx"] < 0.56
    assert near(out["apart"]["cx"], 0.85, 0.01)
    assert 0.64 < out["group"]["cx"] < 0.74


def test_a_point_set_by_hand_wins_and_a_zoom_shrinks_the_window():
    out = run("""
      out.hand = U.faceWindow({ focus: [0.2, 0.7], faces: [[0.8, 0.1, 0.1, 0.1]] }, 4000, 3000, 400, 800, 1);
      // two faces that fit at 100% but not at 200%: the zoom keeps the largest
      var two = { faces: [[0.40, 0.4, 0.06, 0.1], [0.52, 0.4, 0.05, 0.08]] };
      out.z1 = U.faceWindow(two, 4000, 3000, 400, 800, 1);
      out.z2 = U.faceWindow(two, 4000, 3000, 400, 800, 2);
      out.origin = U.faceOrigin(0.5, 0.5, 4000, 3000, 1600, 1000, 'cover', 0.5, 0.5);
      out.originContain = U.faceOrigin(0.25, 0.5, 3000, 4000, 1600, 1000, 'contain', 0.5, 0.5);
    """)
    assert near(out["hand"]["cx"], 0.2) and near(out["hand"]["cy"], 0.7)
    assert out["z1"]["cx"] > out["z2"]["cx"] - 1 and near(out["z2"]["cx"], 0.43, 0.01)
    assert near(out["origin"]["ox"], 0.5) and near(out["origin"]["oy"], 0.5)
    # a portrait shown whole on a wide screen: 750 px wide, centred -> a quarter of it is 425 + 187.5 px in
    assert near(out["originContain"]["ox"], (425 + 187.5) / 1600, 1e-3)


def test_a_zoomed_whole_portrait_stays_centered_and_never_shows_its_edge():
    """The owner, 2026-11-03: "Sometimes, portraits photos aren't in the center of the screen" -- a whole portrait zoomed
    in grew from its faces, so one with its faces to a side sat off center."""
    out = run("""
      // a 3:4 portrait whole on 1600 x 1000 (750 x 1000, from 425), its faces at a quarter across, near the top
      out.fits = U.faceOrigin(0.25, 0.2, 3000, 4000, 1600, 1000, 'contain', 0.5, 0.5, 1.4);
      // ...at 200 %: 1500 wide still fits across; 2000 tall runs past: toward the faces, its top never inside the frame
      out.tall = U.faceOrigin(0.25, 0.05, 3000, 4000, 1600, 1000, 'contain', 0.5, 0.5, 2);
      out.none = U.faceOrigin(0.25, 0.2, 3000, 4000, 1600, 1000, 'contain', 0.5, 0.5, 1);
    """)
    assert near(out["fits"]["ox"], 0.5, 1e-3), "across, it fits: from its own middle"
    assert out["fits"]["oy"] < 0.5, "down, 1400 tall runs past 1000: toward the faces"
    # zoomed 2x about oy: its top at oy*1000*(1-2) <= 0 and its foot at oy*1000 + (1000 - oy*1000)*2 >= 1000
    oy = out["tall"]["oy"] * 1000
    assert oy * (1 - 2) <= 0.5 and oy + (1000 - oy) * 2 >= 999.5
    assert near(out["none"]["ox"], (425 + 187.5) / 1600, 1e-3), "no zoom: as before"


def test_clean_focus_drops_what_isnt_sound():
    out = run("""
      out.ok = U.cleanFocus({ focus: [0.1, 0.9], faces: [[0.1, 0.1, 0.2, 0.2, 0.98]] });
      out.bad = U.cleanFocus({ focus: [1.5, 0], faces: [[0.9, 0.1, 0.2, 0.2], ['a', 0, 0.1, 0.1], [0, 0, 0, 0.1], 'x'] });
      out.many = U.cleanFocus({ faces: Array.from({ length: 30 }, () => [0.1, 0.1, 0.1, 0.1]) }).faces.length;
      out.nothing = U.cleanFocus(null);
      out.nan = U.cleanFocus({ focus: [NaN, 0.5] });
    """)
    assert out["ok"] == {"focus": [0.1, 0.9], "faces": [[0.1, 0.1, 0.2, 0.2]]}
    assert out["bad"] == {} and out["nothing"] == {} and out["nan"] == {}
    assert out["many"] == 12


def test_the_mosaic_prefers_layouts_that_fit_the_photos_and_never_repeats():
    out = run("""
      var tallOf = (p) => p.cells.filter((c) => c.tall).length;
      // three photos, all portraits, on a 1600 x 1000 screen: the three columns (three tall cells)
      out.allPortrait = [0, 0.3, 0.6, 0.99].map((r) => tallOf(U.mosaicPlan(3, 1600, 1000, () => r, -1, 3)));
      // ...and with that layout shown last, the next best instead (never the same twice)
      var three = U.mosaicPlan(3, 1600, 1000, () => 0, -1, 3).idx;
      out.again = U.mosaicPlan(3, 1600, 1000, () => 0, three, 3).idx !== three;
      // no portraits: the fewest tall cells
      out.noPortrait = [0, 0.5, 0.99].map((r) => tallOf(U.mosaicPlan(3, 1600, 1000, () => r, -1, 0)));
      out.minTall = Math.min.apply(null, U.MOSAICS[3].map((_, i) => tallOf({ cells: U.MOSAICS[3][i].map((c) => ({ tall: c[3] * 1000 > c[2] * 1600 })) })));
      var seq = [0.1, 0.1, 0.7, 0.7], k = 0, rnd = () => seq[k++ % seq.length], last = -1, repeats = 0;
      for (var i = 0; i < 40; i++) { var p = U.mosaicPlan(4, 1600, 1000, rnd, last, 1); if (p.idx === last) repeats++; last = p.idx; }
      out.repeats = repeats;
    """)
    assert out["allPortrait"] == [3, 3, 3, 3]
    assert out["again"] is True
    assert all(t == out["minTall"] for t in out["noPortrait"])
    assert out["repeats"] == 0


def test_without_a_focus_everything_is_as_before():
    out = run("""
      // the old pick: rnd's index, bumped past the last one
      out.plans = [[0, -1], [0.3, -1], [0.6, -1], [0.3, 1], [0.99, 3]].map(([r, last]) => U.mosaicPlan(3, 1600, 1000, () => r, last).idx);
      out.layout = U.layoutOf({ x: 'left', y: 'top', zoom: 150 });
      out.window = U.faceWindow({ id: 'x', title: 't', url: '/p.jpg' }, 4000, 3000, 400, 800, 1);
      out.fresh = U.cleanFocus({ id: 'x', url: '/p.jpg' });
    """)
    assert out["plans"] == [0, 1, 2, 2, 0]
    assert out["layout"]["pos"] == "0% 0%" and out["layout"]["zoom"] == "1.5"
    assert out["window"] is None and out["fresh"] == {}


def test_the_photo_layer_takes_its_zoom_origin_from_the_focus_with_the_old_one_as_fallback():
    src = web_sources.read(SAVER)
    assert "transform-origin:var(--org,var(--pos,50% 50%))" in src
    # the host's list passes a sound focus through, and only that
    assert "fc = cleanFocus(p)" in src
