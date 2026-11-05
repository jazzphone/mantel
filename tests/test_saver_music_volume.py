"""The screensaver's music slide and pane (web/hk/saver/hk-saver-music.js): its volume slider for a GROUP is its rooms' --
it shows their average and sets every one, in one call, as the Side Pane's, the player's and the music panel's do
(2026-11-05, the owner: the screensaver's slider moved one speaker of a group). Run under macOS's JavaScriptCore with no DOM:
the part's own functions, given the kit (K) hk-saver.js would give them."""
import json
import subprocess
from pathlib import Path

import pytest

JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "web/hk/saver/hk-saver-music.js"

pytestmark = pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")

SCRIPT = r"""
var window = this, location = { origin: 'http://mantel.test' };
var CALLS = [], T = 1000;
setTimeout = function () { return 1; }; clearTimeout = function () {};
load(FILE);
var K = { actionsNow: function () { return { callService: function (d, s, data) { CALLS.push([d, s, data]); } }; },
          clearCanvas: function () {}, clientNow: function () { return null; }, clock: { now: function () { return T; } },
          dashConf: function () { return null; }, isFlat: function () { return false; }, mmss: function () { return ''; },
          sendWS: function () { return Promise.resolve(); } };
window.hkSaverParts['hk-saver-music'](K);
window.hkMusic = { label: function (c) { return c.key; } };
function st(v) { return { state: 'playing', attributes: { volume_level: v, media_title: 'A Song' } }; }
var h = { states: { 'media_player.living': st(0.3), 'media_player.kitchen': st(0.6), 'media_player.den': st(0.5) } };
var out = {};
var g = K.musicOf({ key: 'media_player.living', members: ['media_player.living', 'media_player.kitchen'] }, h);
out.groupVol = Math.round(g.vol * 100) / 100; out.members = g.members;
var one = K.musicOf({ key: 'media_player.den', members: ['media_player.den'] }, h);
out.oneVol = one.vol;
function drag(d) {
  K.mus.drag = { view: { vt: { getBoundingClientRect: function () { return { left: 0, width: 100 }; } }, d: d, el: {} }, sent: 0, t: null };
  T += 1000; K.volFrom(70);
}
drag(g); out.groupCall = CALLS.slice(-1)[0];
K.mus.vol = null; drag(one); out.oneCall = CALLS.slice(-1)[0];
print(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    f = tmp_path_factory.mktemp("saver") / "t.js"
    f.write_text("var FILE = " + json.dumps(str(FILE)) + ";\n" + SCRIPT)
    out = subprocess.run([str(JSC), str(f)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr + out.stdout
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_a_groups_slider_shows_its_rooms_average(got):
    assert got["groupVol"] == 0.45 and got["members"] == ["media_player.living", "media_player.kitchen"]


def test_a_groups_slider_sets_every_room_in_one_call(got):
    assert got["groupCall"] == ["media_player", "volume_set",
                                {"entity_id": ["media_player.living", "media_player.kitchen"], "volume_level": 0.7}]


def test_one_rooms_slider_is_that_room(got):
    assert got["oneVol"] == 0.5
    assert got["oneCall"] == ["media_player", "volume_set", {"entity_id": "media_player.den", "volume_level": 0.7}]
