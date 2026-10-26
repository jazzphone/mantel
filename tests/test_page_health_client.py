"""PAGE HEALTH, the page's side (web/shim/page-health.js, used by web/home.js and web/shim/settings-page.js): besides
the heap and how the page before it ended, a frame says its page kind, the time to first draw, the sockets opened
again since the page loaded (hub.js counts them) and the registry refreshes (a counter later phases bump, 0 now).
Run in node with a recording hub."""
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
const m = await import(process.argv[2]);
const sent = [];
const hub = { reconnects: 0, tell: (type, body) => sent.push({ type, ...body }) };
const out = {};

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
out.keys = Object.keys(store);
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("page-health-client")
    shutil.copy(ROOT / "web/shim/page-health.js", d / "page-health.mjs")
    (d / "script.mjs").write_text(SCRIPT)
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "page-health.mjs")], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


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
