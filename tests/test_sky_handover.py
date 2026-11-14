"""The sky drawn by the tablet app (phase 29, docs/phase29/PLAN.md): the hand-over part of hk-sky
(web/hk/sky-parts/hk-sky-handover.js), the shells' sky player (hkShell.skyPlayer) and the tablet's own setting
(Sky Drawn by the App, hk_core's tablet_rules.py `app_sky`).

What counts as busy is decided from the keyframes themselves (busyAnim): checked here against the shapes hk-sky's
scenes move by -- bats and flybys, rain and snow decks, a flipbook -- and the calm ones it leaves to the page: clouds
inching across, a candle's flicker, a wallpaper's slow loop. Run in node, as the browser runs them; the hand-over itself
(the bake, the frost picture, a sheet over it) is tools/headless/app_sky_check.py's."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from hk_core.settings import changes as C
from hk_core.settings import model as S

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def run_node(script: str) -> dict:
    if not NODE:
        pytest.skip("node is not installed")
    out = subprocess.run([NODE, "-e", script, str(ROOT)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


# ------------------------------------------------------------------ the setting (hk_core)
def test_app_sky_is_off_by_default_and_only_a_bool():
    assert S.TABLET_DEFAULTS["app_sky"] is False
    assert S.tablet({}, "loft")["app_sky"] is False
    assert S.tablet({"app_sky": "yes"}, "loft")["app_sky"] is False
    assert S.tablet({"app_sky": 1}, "loft")["app_sky"] is False
    assert S.tablet({"app": "android_app", "app_sky": True}, "loft")["app_sky"] is True


def test_only_mantel_for_android_draws_the_sky():
    on = S.tablet({"app": "android_app", "app_sky": True}, "loft")
    assert S.sky_by_app(on) is True
    # the switch is kept through a change of Kiosk App, and means nothing under another
    for app in ("kiosk_satellite", "fully", "wallpanel", "browser"):
        other = S.tablet({"app": app, "app_sky": True}, "loft")
        assert other["app_sky"] is True and S.sky_by_app(other) is False
    assert S.sky_by_app(S.tablet({"app": "android_app"}, "loft")) is False
    assert S.sky_by_app(None) is False


def test_the_tablet_page_saves_it():
    data, errors = C.apply_tablet({"app": "android_app"}, {"app_sky": True}, "loft")
    assert not errors and data["app_sky"] is True
    data, errors = C.apply_tablet(data, {"app_sky": False}, "loft")
    assert not errors and data["app_sky"] is False
    _, errors = C.apply_tablet({"app": "android_app"}, {"app_sky": "on"}, "loft")
    assert errors == {"app_sky": "bool"}


def test_stored_only_when_on():
    from hk_core.settings.model.stored_rules import tablet_stored
    assert "app_sky" not in tablet_stored({"app": "android_app", "app_sky": False}, "loft")
    assert tablet_stored({"app": "android_app", "app_sky": True}, "loft")["app_sky"] is True


def test_the_page_is_told_the_decision():
    """Both feeds send the decision (sky_by_app), not the raw switch: a Fully tablet with the switch left on is off."""
    class Sub:
        def __init__(self, uid, data):
            self.unique_id, self.data, self.subentry_type = uid, data, S.SUBENTRY_TABLET

    class Stored:
        options = {}
        def of(self, kind):
            return [Sub("loft", {"app": "android_app", "app_sky": True}), Sub("hall", {"app": "fully", "app_sky": True}),
                    Sub("den", {"app": "android_app"})] if kind == S.SUBENTRY_TABLET else []
    tablets = S.tablets(Stored())
    assert {k: S.sky_by_app(t) for k, t in tablets.items()} == {"loft": True, "hall": False, "den": False}
    from hk_core.settings.model import saver_rules
    src = Path(saver_rules.__file__).read_text()
    assert '"app_sky": sky_by_app(t)' in src
    svc = (ROOT / "hosts/server/mantel_server/settings_store/service.py").read_text()
    assert '"app_sky": SM.sky_by_app(t)' in svc


# ------------------------------------------------------------------ the shells' player
SHELLS = r"""
const fs = require('fs'), root = process.argv[1];
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.document = { body: {}, getElementById: () => null };
eval(fs.readFileSync(root + '/web/client/hk-host-shell.js', 'utf8'));
const out = { facade: hkShell.skyPlayer() };
eval(fs.readFileSync(root + '/web/shim/mantel-shell.js', 'utf8'));
out.none = hkShell.skyPlayer();
globalThis.mantelNative = { platform: 'ios', sky: () => true };
out.ios = hkShell.skyPlayer();
globalThis.mantelNative = { platform: 'android', status: () => '{}' };
out.oldApp = hkShell.skyPlayer();
const sent = [];
globalThis.mantelNative = { platform: 'android', sky: (op, data) => { sent.push([op, data]); return op === 'begin'; } };
const P = hkShell.skyPlayer();
out.same = P === hkShell.skyPlayer();
Promise.all([P.send('begin'), P.send('hold', { on: true }), P.send('stop')]).then((r) => {
  out.answers = r; out.sent = sent;
  console.log(JSON.stringify(out));
});
"""


def test_the_shells_sky_player():
    out = run_node(SHELLS)
    assert out["facade"] is None                      # the contract's default: none (Home Assistant's facade too)
    assert out["none"] is None and out["ios"] is None and out["oldApp"] is None
    assert out["same"] is True
    assert out["answers"] == [True, False, False]
    assert out["sent"] == [["begin", None], ["hold", {"on": True}], ["stop", None]]


def test_home_assistants_shell_offers_none():
    src = (ROOT / "hosts/ha/frontend/hk-ha-shell.js").read_text()
    assert "HA.skyPlayer = function () { return null; };" in src
    assert "skyPlayer(): HkSkyPlayer | null;" in (ROOT / "tools/typecheck/types/hk-shell.d.ts").read_text()


# ------------------------------------------------------------------ busy, from the keyframes
PART = r"""
const fs = require('fs'), root = process.argv[1];
globalThis.window = globalThis;
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push(ms); return timers.length; };
globalThis.setInterval = () => 0;
let styled = 0;
globalThis.document = { head: { appendChild: () => { styled++; } }, readyState: 'complete',
                        createElement: () => ({ setAttribute() {}, style: {} }) };
eval(fs.readFileSync(root + '/web/hk/sky-parts/hk-sky-handover.js', 'utf8'));
window.hkSkyParts['hk-sky-handover']({ ST: {} });
const H = window.hkSkyHandover;
// an animation as animOf reads it: px translations (a % is resolved against the box before this)
const t = (x, y) => [['t', x, y]];
const A = (o) => Object.assign({ dur: 1000, delay: 0, iter: -1, dir: 'normal', fill: 'none', rate: 1, ease: 'linear',
                                 o: null, t: null }, o);
const k = (list) => list.map(([at, v, e]) => ({ at: at, v: v, e: e || 'linear' }));
const cases = {
  // a bat crossing the screen: 1400 px in 7 s
  bat: A({ dur: 7000, t: k([[0, t(-200, 300)], [1, t(1200, 260)]]) }),
  // the witch's flight, a slow part then a quick one
  witch: A({ dur: 30000, t: k([[0, t(0, 0)], [0.8, t(400, 0)], [1, t(1800, -100)]]) }),
  // a flipbook: a bat's wings in steps()
  wings: A({ dur: 400, ease: 'steps(4)', t: null, o: null }),
  wingsKf: A({ dur: 400, o: k([[0, 1, 'steps(2, end)'], [1, 1]]) }),
  // a rain deck: a screen's height every 0.6 s
  rain: A({ dur: 600, t: k([[0, t(0, -820)], [1, t(0, 0)]]) }),
  // a snow deck: slower than BUSY_SPEED, but falling for good
  snow: A({ dur: 24000, t: k([[0, t(0, -820)], [1, t(-60, 0)]]) }),
  // a realistic cloud crossing once: 1600 px in 140 s
  cloud: A({ dur: 140000, iter: 1, fill: 'both', t: k([[0, t(-400, 0)], [1, t(1200, 0)]]) }),
  // the fog's wisp, back and forth
  wisp: A({ dur: 60000, dir: 'alternate', t: k([[0, t(-80, 0)], [1, t(80, 10)]]) }),
  // a candle's flicker and a twinkle: opacity only
  candle: A({ dur: 300, dir: 'alternate', o: k([[0, 0.8], [1, 1]]) }),
  // a wallpaper's slow loop, drifting down a little as it goes across
  wall: A({ dur: 90000, t: k([[0, t(0, 0)], [1, t(-1280, 30)]]) }),
  // a leaf falling from the canopy
  leaf: A({ dur: 9000, t: k([[0, t(0, -40)], [0.5, t(60, 300)], [1, t(-20, 700)]]) }),
  nothing: A({ dur: 0, t: k([[0, t(0, 0)], [1, t(5000, 0)]]) }),
};
const out = { verdicts: {}, speed: H.BUSY_SPEED, styled: styled };
for (const name in cases) out.verdicts[name] = H._busyAnim(cases[name]);
out.scene = H._busyOf([{ anims: [cases.cloud, cases.candle] }, { anims: [cases.bat] }]);
out.calmScene = H._busyOf([{ anims: [cases.cloud, cases.wisp] }, { anims: [cases.candle] }]);
out.ops = H._ops('translate3d(-50%, 10px, 0px) scaleY(0.5)', 200, 100);
// THE GUARD: what the app's player can play (transform and opacity), by each animation's keyframes as Chromium gives them
const anim = (name, kfs) => ({ animationName: name, effect: { getKeyframes: () => kfs } });
const meta = { offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto' };
out.guard = {
  moves: H._unplayable([anim('hk-drift', [Object.assign({ transform: 'none' }, meta), Object.assign({ transform: 'translate3d(-40px, 0px, 0px)' }, meta)])]),
  fades: H._unplayable([anim('hk-bolt', [Object.assign({ opacity: '0' }, meta), Object.assign({ opacity: '0.9' }, meta)])]),
  number: H._unplayable([anim('hk-wall-p', [Object.assign({}, meta), Object.assign({}, meta)])]),
  translate: H._unplayable([anim('slide', [Object.assign({ translate: '10px' }, meta), Object.assign({ translate: '50px' }, meta)])]),
  color: H._unplayable([anim('hk-drift', [Object.assign({ transform: 'none' }, meta)]), anim('glow', [Object.assign({ backgroundColor: 'red', opacity: '1' }, meta)])]),
};
out.status = H.status();
console.log(JSON.stringify(out));
"""


def test_busy_is_read_from_the_keyframes():
    out = run_node(PART)
    assert out["speed"] == 100
    assert out["verdicts"] == {
        "bat": "fast", "witch": "fast", "wings": "flipbook", "wingsKf": "flipbook", "rain": "fast", "snow": "falling",
        "cloud": "", "wisp": "", "candle": "", "wall": "", "leaf": "falling", "nothing": "",
    }
    assert out["scene"] == "fast" and out["calmScene"] == ""
    assert out["ops"] == [["t", -100, 10], ["s", 1, 0.5]]


def test_nothing_runs_without_a_player():
    """Home Assistant's host (no hkShell, or its facade's none): the part never starts -- no style, no hand-over."""
    out = run_node(PART)
    assert out["styled"] == 0
    assert out["status"]["state"] == "off" and out["status"]["playing"] is False and out["status"]["bakes"] == 0


def test_the_part_is_one_of_the_skys():
    sky = (ROOT / "web/hk/modules/hk-sky.js").read_text()
    assert "'hk-sky-handover.js'" in sky
    manifest = json.loads((ROOT / "tools/split_manifests/sky.json").read_text())
    assert manifest["parts"][-1]["name"] == "hk-sky-handover"


def test_the_guard_keeps_what_the_app_cannot_play():
    """The app's player plays transform and opacity (SkyScene.kt). A drawn wallpaper's number (--hk-wp: Chromium names no
    property for a custom property's keyframes), `translate` or a color would be drawn frozen or wrong: the page keeps
    that sky."""
    g = run_node(PART)["guard"]
    assert g["moves"] == "" and g["fades"] == ""
    assert g["number"] == "hk-wall-p"
    assert g["translate"] == "slide (translate)"
    assert g["color"] == "glow (backgroundColor)"


def test_every_sky_on_a_tablet_with_the_setting_on():
    """All in (2026-11-13): still skies too, the glass the frost picture either way, a wallpaper by its transform."""
    src = (ROOT / "web/hk/sky-parts/hk-sky-handover.js").read_text()
    assert "var STILL = true;" in src
    assert "frostGlass(true);" in src and "frostGlass(false);" in src
    assert "if (ST.wpv && !ST.appSky) el.setAttribute('data-wpv', '')" in (ROOT / "web/hk/sky-parts/hk-sky-static.js").read_text()
