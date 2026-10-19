"""A Mantel screen shown inside Home Assistant (web/shim/ha-frame.js; docs/phase9/MANTEL-LINK.md 9.6): it tells the
page around it the screen's "Home Assistant Header & Sidebar" setting (and again when the settings change, or when
Mantel Link's script asks), and its menu gets a Home Assistant row that asks to go back. Opened on its own, or under
the HA App's sidebar (Ingress: HA's own frame protocol), it says nothing. (HK's menu running a host row's `run`:
hosts/ha/.../tests/test_menu.js.)"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const [, , frameJs, baseJs, shellJs, mode] = process.argv;
const posted = [];
const listeners = {};
const parent = { postMessage: (m, o) => posted.push([m, o]) };
globalThis.window = globalThis;
globalThis.parent = mode === 'alone' ? globalThis : parent;
globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
globalThis.location = { pathname: '/dashboard-hall/home', ancestorOrigins: ['https://ha.example.com'] };
globalThis.document = { querySelector: (q) => (q === 'meta[name="mantel-base"]' && mode === 'ingress'
  ? { getAttribute: () => '/api/hassio_ingress/abc' } : null), addEventListener() {} };
globalThis.history = { pushState() {}, replaceState() {} };
const boards = { 'dashboard-hall': { kiosk: true, kiosk_header: true, kiosk_sidebar: false, kiosk_admins: false } };
let onChange = null;
window.hkSettings = { get: (k) => (k === 'boards' ? boards : null), onChange: (fn) => { onChange = fn; } };
window.hkShell = { use() {} };
const m = await import(frameJs);
await import(shellJs);
const out = { inHa: m.inHa, started: m.start() };
out.first = posted.slice();
boards['dashboard-hall'].kiosk = false;
if (onChange) onChange();
out.afterChange = posted.slice(out.first.length);
(listeners.message || []).forEach((f) => f({ source: parent, data: { type: 'mantel-link/hello' } }));
(listeners.message || []).forEach((f) => f({ source: {}, data: { type: 'mantel-link/hello' } }));
out.asked = posted.length - out.first.length - out.afterChange.length;
window.hkMantelShell.setRole('adult');
const menu = window.hkMantelShell.hostMenu();
out.menu = menu.map((x) => [x.title, typeof x.run, x.href || null]);
const home = menu.find((x) => x.title === 'Home Assistant');
if (home) { home.run(); out.back = posted[posted.length - 1]; }
process.stdout.write(JSON.stringify(out));
"""


def run(tmp_path, mode):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    web = ROOT / "web/shim"
    (tmp_path / "base.mjs").write_text((web / "base.js").read_text())
    (tmp_path / "ha-frame.mjs").write_text((web / "ha-frame.js").read_text().replace("'./base.js'", "'./base.mjs'"))
    (tmp_path / "shell.js").write_text((web / "mantel-shell.js").read_text())
    (tmp_path / "t.mjs").write_text(SCRIPT)
    got = subprocess.run(["node", str(tmp_path / "t.mjs"), str(tmp_path / "ha-frame.mjs"), str(tmp_path / "base.mjs"),
                          str(tmp_path / "shell.js"), mode], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


def test_in_home_assistant_it_says_the_screen_s_setting_and_offers_the_way_back(tmp_path):
    got = run(tmp_path, "framed")
    assert got["inHa"] is True and got["started"] is True
    assert got["first"] == [[{"source": "mantel", "type": "mantel/kiosk", "screen": "dashboard-hall", "header": True,
                              "sidebar": False, "admins": False}, "https://ha.example.com"]]
    assert got["afterChange"] == [[{"source": "mantel", "type": "mantel/kiosk", "screen": "dashboard-hall",
                                    "header": False, "sidebar": False, "admins": True}, "https://ha.example.com"]]
    assert got["asked"] == 1, "said again when the page around it asks; never for anyone else"
    assert got["menu"] == [["Home Assistant", "function", None], ["Mantel Settings", "undefined", "/settings"]]
    assert got["back"] == [{"source": "mantel", "type": "mantel/back"}, "https://ha.example.com"]


def test_alone_or_under_the_app_s_sidebar_it_says_nothing(tmp_path):
    for mode in ("alone", "ingress"):
        got = run(tmp_path, mode)
        assert got["inHa"] is False and got["started"] is False and got["first"] == [], mode
        assert [m[0] for m in got["menu"]] == ["Mantel Settings"], mode
