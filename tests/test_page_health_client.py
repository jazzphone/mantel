"""PAGE HEALTH, the page's side (web/shim/page-health.js, used by web/home.js and web/shim/settings-page.js): besides
the heap and how the page before it ended, a frame says its page kind, the time to first draw, the sockets opened
again since the page loaded (hub.js counts them) and the registry refreshes (a counter later phases bump, 0 now).
The baseline (2026-10-29) adds the device on `load`, the startup download on `draw`, and an `fps` frame sampled only
while the page is visible, idle and not dark -- by HK's one sampler (web/hk/modules/hk-fps.js, 2026-10-29), whose
dashboard frame also names the screen, the style and the sky and camera settings it was drawn with (the ladder of
HK Settings' recommendations, one step at a time), kept in the browser for HK Frontend's This Device. Run in node with a recording hub and a fake clock, timers and frames."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
globalThis.window = globalThis;
const listeners = {};
globalThis.addEventListener = (n, f) => { listeners[n] = f; };
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
let tick = null;
globalThis.setInterval = (fn) => { tick = fn; return 1; };
globalThis.clearInterval = () => {};
// a clock, timers and animation frames the script drives by hand
let clock = 100000;
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
globalThis.clearTimeout = () => {};
let frame = null;
globalThis.requestAnimationFrame = (fn) => { frame = fn; return 1; };
Object.defineProperty(globalThis, 'performance', { configurable: true, value: {
  now: () => clock, memory: { usedJSHeapSize: 50 * 1048576, jsHeapSizeLimit: 4096 * 1048576 },
  getEntriesByType: (t) => (t === 'navigation' ? [{ transferSize: 9000, encodedBodySize: 9000 }]
    : [{ transferSize: 1000, encodedBodySize: 5000 }, { transferSize: 0, encodedBodySize: 2000 }, { transferSize: 0, encodedBodySize: 0 }]) } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  maxTouchPoints: 5, hardwareConcurrency: 6, deviceMemory: 4 } });
globalThis.screen = { width: 1180, height: 820 };
globalThis.devicePixelRatio = 2;
globalThis.document = { visibilityState: 'visible' };
const m = await import(process.argv[2]);
const sent = [];
const hub = { reconnects: 0, tell: (type, body) => sent.push({ type, ...body }) };
const out = {};

// a tablet opened by its IP address over plain http: not a secure context (the browser's word, and the address it used)
globalThis.isSecureContext = false;
globalThis.location = { origin: 'http://192.168.1.20:8080', pathname: '/home' };

// the dashboard: its marks are ms after its module began, which itself began at module_start ms
const health = m.pageHealth(hub, 'home', { module_start: 400, rendered: 1900 });
hub.reconnects = 3;
m.registryRefreshed(); m.registryRefreshed();
health.drawn(); health.drawn();            // told once
tick();                                    // a minute later
out.home = sent.splice(0);
listeners.pagehide();

// the settings page: its own page kind and its own "how the page before it ended"
const s = m.pageHealth(hub, 'settings');
s.drawn();
out.settings = sent.splice(0);
globalThis.isSecureContext = true;                         // the same page by its name over https, a minute later
globalThis.location = { origin: 'https://mantel.example.com', pathname: '/home' };
out.settingsBeat = (tick(), sent.splice(0));
out.keys = Object.keys(store);

// the frame rate: ~20 s after load, then hourly; waits for a calm, lit page
const fps = async (mut) => {
  // runs the next timer, then 5 s of frames at 60 per second, leaving `mut` to change the world first
  const t = timers.shift();
  if (mut) mut();
  t.fn();
  const sentBefore = sent.length;
  let at = 0;
  for (let i = 0; i < 400 && frame; i++) { const f = frame; frame = null; at += 1000 / 60; clock += 1000 / 60; f(at); }
  return { delay: t.ms, told: sent.slice(sentBefore), next: timers.map((x) => x.ms) };
};
// the dashboard's sampler is HK's (hk-fps.js, loaded by hk-loader): one, told to Mantel with its screen and style
globalThis.location = { pathname: '/dashboard-kitchen/home' };
globalThis.dispatchEvent = (e) => { if (listeners[e.type]) listeners[e.type](e); };
window.hkSettings = { glass: () => 'blur', ladderSignature: () => 'blur:a1w1r1f0c1' };
window.__hkAsleep = false;
window.hkSaver = { black: () => false, running: () => false };
timers.length = 0;
const h = m.pageHealth(hub, 'home');
out.ownTimers = timers.length;                             // the dashboard's page-health samples nothing itself
await import(process.argv[3]);
out.timer = timers.map((t) => t.ms);
sent.length = 0;
clock += 21000;                                            // 21 s since the page loaded; untouched
out.first = await fps();
out.kept = JSON.parse(store['hk-fps']);
out.next = timers.map((t) => t.ms);
// somebody touched it: waits half a minute and tries again
listeners.pointerdown();
out.touched = await fps();
clock += 6000;
// the black screen is up: no sample
window.hkSaver = { black: () => true, running: () => false };
out.dark = await fps();
// ...nor while the screensaver shows
window.hkSaver = { black: () => false, running: () => true };
out.saver = await fps();
// the dashboard cannot tell yet (no saver loaded): no sample
window.hkSaver = undefined;
out.unsure = await fps();
// a settings page has no saver and does not need one: the same sampler, its own
timers.length = 0; frame = null;
const st = m.pageHealth(hub, 'settings');
clock += 21000;
out.settingsFps = (await fps()).told;
h.stop(); st.stop(); window.hkFps.stop();
out.platforms = [m.platformOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5), m.platformOf('Macintosh', 0), m.platformOf('Macintosh', 5),
  m.platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), m.platformOf('Linux; Android 13'), m.platformOf('Windows NT 10.0'), m.platformOf('X11; Linux x86_64'), m.platformOf('')];
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("page-health-client")
    shutil.copy(ROOT / "web/shim/page-health.js", d / "page-health.mjs")
    shutil.copy(ROOT / "web/hk/modules/hk-fps.js", d / "hk-fps.mjs")
    (d / "script.mjs").write_text(SCRIPT)
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "page-health.mjs"), str(d / "hk-fps.mjs")],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def test_the_load_frame_says_what_device_it_is(got):
    load = got["home"][0]
    assert load["platform"] == "iPad"                      # iPad Safari says Macintosh; the touch points give it away
    assert (load["memory_gb"], load["cores"], load["sw"], load["sh"], load["dpr"]) == (4, 6, 1180, 820, 2)
    assert got["platforms"] == ["iPad", "Mac", "iPad", "iPhone", "Android", "Windows", "Linux", "Other"]


def test_the_load_and_beat_frames_say_whether_the_page_is_secure_and_by_what_address(got):
    load, beat = got["home"][0], next(f for f in got["home"] if f["event"] == "beat")
    for frame in (load, beat, got["settings"][0]):
        assert frame["secure"] is False and frame["origin"] == "http://192.168.1.20:8080"
    other = [f for f in got["home"] if f["event"] == "draw"][0]
    assert "secure" not in other, "only the load and the beat say it"
    [again] = got["settingsBeat"]
    assert (again["event"], again["secure"], again["origin"]) == ("beat", True, "https://mantel.example.com"), \
        "the beat says it again, so a restarted server learns it within a minute"


def test_the_draw_frame_sums_the_startup_download_with_the_encoded_size_for_cached_files(got):
    draw = next(f for f in got["home"] if f["event"] == "draw")
    assert draw["dl_files"] == 4 and draw["dl_bytes"] == 9000 + 1000 + 2000       # the document, then each file


def test_a_frame_rate_is_sampled_once_the_page_has_been_calm_for_a_while(got):
    assert got["timer"] == [20000]
    [fps] = got["first"]["told"]
    assert fps["event"] == "fps" and fps["page"] == "home" and 59 <= fps["fps"] <= 61
    assert got["next"] == [3600000], "then hourly"


def test_the_dashboard_has_one_sampler_hks_told_with_its_screen_and_style(got):
    assert got["ownTimers"] == 0, "page-health.js samples nothing itself on the dashboard"
    [fps] = got["first"]["told"]
    assert fps["screen"] == "dashboard-kitchen" and fps["style"] == "blur"
    kept = got["kept"]                                     # HK Frontend's This Device reads it back
    assert kept["screen"] == "dashboard-kitchen" and kept["style"] == "blur" and kept["fps"] == fps["fps"] and kept["at"] > 0


def test_the_sample_says_what_was_on_screen_for_the_ladder(got):
    [fps] = got["first"]["told"]
    assert fps["sig"] == "blur:a1w1r1f0c1", "the style and the sky and camera settings it was drawn with"
    assert got["kept"]["sig"] == "blur:a1w1r1f0c1", "kept in the browser too, for HK Frontend's This Device"
    assert "sig" not in got["settingsFps"][0], "the settings page's sample names no screen, so no settings"


def test_a_touched_dark_or_unsure_page_is_not_sampled_but_tried_again(got):
    for name in ("touched", "dark", "saver", "unsure"):
        assert got[name]["told"] == [], name
        assert got[name]["next"] == [30000], name              # half a minute later


def test_the_settings_page_needs_no_screensaver_to_be_sampled(got):
    assert [f["event"] for f in got["settingsFps"]] == ["fps"] and got["settingsFps"][0]["page"] == "settings"


def test_the_load_frame_names_its_page_and_counts_from_zero(got):
    load = got["home"][0]
    assert load["type"] == "page_health" and load["event"] == "load" and load["page"] == "home"
    assert load["reconnects"] == 0 and load["registry_refreshes"] == 0 and load["prev"] == "none"


def test_the_first_draw_is_told_once_from_the_start_of_the_navigation(got):
    draws = [f for f in got["home"] if f["event"] == "draw"]
    assert len(draws) == 1 and draws[0]["first_draw"] == 2300 and draws[0]["page"] == "home"
    assert draws[0]["reconnects"] == 3 and draws[0]["registry_refreshes"] == 2


def test_each_beat_carries_the_reconnects_and_the_registry_refreshes(got):
    beat = got["home"][-1]
    assert beat["event"] == "beat" and beat["reconnects"] == 3 and beat["registry_refreshes"] == 2 and beat["page"] == "home"


def test_the_settings_page_reports_as_its_own_kind(got):
    assert [f["event"] for f in got["settings"]] == ["load", "draw"]
    assert all(f["page"] == "settings" for f in got["settings"])
    assert got["settings"][0]["prev"] == "none", "the dashboard's goodbye is not the settings page's"
    assert got["settings"][1]["first_draw"] >= 0
    assert sorted(got["keys"]) == ["mantel_page_health", "mantel_page_health_settings"]


def test_the_hub_counts_each_reopened_socket_and_both_pages_send_the_health():
    hub = (ROOT / "web/shim/hub.js").read_text()
    assert re.search(r"if \(again\) \{ this\.reconnects\+\+; this\._resume\(\); \}", hub)
    home = (ROOT / "web/home.js").read_text()
    assert "pageHealth(hub, 'home', marks)" in home and "health.drawn()" in home
    assert "pageHealth(hub, 'settings')" in (ROOT / "web/shim/settings-page.js").read_text()
