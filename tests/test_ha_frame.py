"""A Mantel screen shown inside Home Assistant (web/shim/ha-frame.js; docs/phase9/MANTEL-LINK.md 9.6), and the Home
Assistant rows of HK's menu by where the page is (mantel-shell.js haNav; Avery, 2026-10-19: "it has to detect if
it's inside HA or not, or else the menu items don't do anything").

* A Webpage dashboard: it tells the page around it the screen's "Home Assistant Header & Sidebar" setting (and again
  when the settings change, or when Mantel Link's script asks); its menu gets a Home Assistant row that asks to go
  back. Once Mantel Link says this person's sidebar (only from the page around it, at that page's address), HK's
  Home Assistant section is that sidebar, each row asking Home Assistant's window to open the page. Until then, or
  without Mantel Link, one row opens Home Assistant's page in the top window.
* The HA App's sidebar panel (Ingress): the sidebar is read from Home Assistant's own page around it, and a page is
  opened by HA's own frame protocol.
* Opened on its own: one row opening Home Assistant's address (GET /api/me `ha_address`), none without one (a wall
  tablet).

(HK's menu running a host row's `run`, and its Home Assistant rows by haNav: hosts/ha/.../tests/test_menu.js.)"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const [, , frameJs, shellJs, mode] = process.argv;
const posted = [], opened = [], events = [], mainEvents = [];
const listeners = {};
const parent = { postMessage: (m, o) => posted.push([m, o]) };
globalThis.window = globalThis;
globalThis.parent = mode === 'alone' ? globalThis : parent;
globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };
globalThis.dispatchEvent = (e) => { events.push(e.type); (listeners[e.type] || []).forEach((f) => f(e)); };
globalThis.open = (u, t) => { opened.push([u, t]); };
globalThis.location = { pathname: '/dashboard-hall/home', ancestorOrigins: ['https://ha.example.com'],
                        origin: mode === 'ingress' ? 'https://ha.example.com' : 'https://mantel.example.com' };
globalThis.document = { querySelector: (q) => (q === 'meta[name="mantel-base"]' && mode === 'ingress'
  ? { getAttribute: () => '/api/hassio_ingress/abc' } : null), addEventListener() {} };
globalThis.history = { pushState() {}, replaceState() {} };
// Home Assistant's own page around the App's panel (the same origin)
const haMain = { dispatchEvent: (e) => mainEvents.push(e.type), shadowRoot: { querySelector: () => null } };
const haRoot = { hass: { user: { is_admin: true }, panels: { map: { title: 'map', icon: 'mdi:map' } },
                         localize: (k) => (k === 'panel.map' ? 'Map' : ''),
                         connection: { sendMessagePromise: async () => ({ value: { panelOrder: ['map'], hiddenPanels: [] } }) } },
                 shadowRoot: { querySelector: (q) => (q === 'home-assistant-main' ? haMain : null) } };
parent.document = { querySelector: (q) => (q === 'home-assistant' ? haRoot : null) };
const boards = { 'dashboard-hall': { kiosk: true, kiosk_header: true, kiosk_sidebar: false, kiosk_admins: false } };
let onChange = null;
window.hkSettings = { get: (k) => (k === 'boards' ? boards : null), onChange: (fn) => { onChange = fn; } };
let impl = null;
window.hkShell = { use(x) { impl = x; } };
const m = await import(frameJs);
await import(shellJs);
const send = (data, origin, source) => (listeners.message || []).forEach((f) => f({ data, origin, source }));
const shown = () => { const n = impl.haNav(); return n === 'own' ? 'own' : n; };
const out = { inHa: m.inHa, inIngress: m.inIngress, started: m.start() };
out.kind = window.__mantelHaFrame ? window.__mantelHaFrame.kind : null;
out.first = posted.splice(0);
window.hkMantelShell.setRole('adult');
if (mode === 'framed') {
  boards['dashboard-hall'].kiosk = false;
  if (onChange) onChange();
  out.afterChange = posted.splice(0);
  out.beforeLink = { nav: shown(), menu: impl.openHaMenu(), back: m.back(), hostMenu: window.hkMantelShell.hostMenu().map((x) => x.title),
                     posted: posted.splice(0), opened: opened.splice(0) };
  send({ type: 'mantel-link/hello' }, 'https://evil.example.com', parent);
  send({ type: 'mantel-link/hello' }, 'https://ha.example.com', {});
  out.strangers = { linked: m._.linked(), posted: posted.splice(0) };
  send({ type: 'mantel-link/hello' }, 'https://ha.example.com', parent);
  out.asked = posted.splice(0).map((p) => p[0].type);
  // Mantel Link 0.1.0 (the house, 2026-10-20): it says hello and hears mantel/back, but never the sidebar
  out.oldLink = { nav: shown(), hostMenu: window.hkMantelShell.hostMenu().map((x) => x.title) };
  window.hkMantelShell.hostMenu().find((x) => x.title === 'Home Assistant').run();
  out.oldLink.back = posted.splice(0);
  out.oldLink.opened = opened.splice(0);
  const SIDEBAR = { type: 'mantel-link/sidebar', admin: false, shown: false,
    panels: { map: { title: 'Map', icon: 'mdi:map' }, 'bad key': { title: 'x' }, logbook: { title: 'Activity', icon: 'mdi:<b onclick=x>' },
              hacs: { title: 'HACS', icon: 'hacs:hacs', require_admin: true }, empty: { title: '' } },
    prefs: { panelOrder: ['map', 7, '../x'], hiddenPanels: ['hacs'] } };
  send(SIDEBAR, 'https://evil.example.com', parent);
  out.forged = shown();
  events.length = 0;
  send(SIDEBAR, 'https://ha.example.com', parent);
  out.redraw = events.filter((t) => t === 'hk-ha-nav-changed').length;
  out.nav = shown();
  const s = impl.sidebarData();
  out.side = { user: s.user, panels: s.panels, prefs: s.prefs, shown: s.shown, title: s.localize('panel.map') };
  out.go = [impl.haNavigate('/config/dashboard'), impl.haNavigate('//evil.example.com/x'), impl.haNavigate('javascript:alert(1)')];
  out.menu = impl.openHaMenu();
  impl.showNotifications();
  window.hkMantelShell.hostMenu().find((x) => x.title === 'Home Assistant').run();
  out.asks = posted.splice(0);
  out.hostMenu = window.hkMantelShell.hostMenu().map((x) => [x.title, typeof x.run, x.href || null]);
} else if (mode === 'ingress') {
  out.nav = shown();
  await new Promise((r) => setTimeout(r, 10));
  const s = impl.sidebarData();
  out.side = { admin: s.user.is_admin, panels: Object.keys(s.panels), title: s.localize('panel.map'), prefs: s.prefs };
  out.go = [impl.haNavigate('/config/dashboard'), impl.haNavigate('//evil.example.com/x')];
  out.menu = impl.openHaMenu();
  impl.showNotifications();
  out.asks = posted.splice(0);
  out.mainEvents = mainEvents;
  out.hostMenu = window.hkMantelShell.hostMenu().map((x) => x.title);
  haRoot.hass = null;                                  // Home Assistant's page not readable: one row, to its start page
  out.unreadable = shown();
} else {
  out.nav = shown();
  window.hkMantelShell.setHaAddress('https://ha.home.example');
  out.withAddress = shown();
  window.hkMantelShell.setHaAddress('javascript:alert(1)');
  out.badAddress = shown();
  out.go = impl.haNavigate('/config/dashboard');
  out.menu = impl.openHaMenu();
  out.hostMenu = window.hkMantelShell.hostMenu().map((x) => x.title);
  out.asks = posted.splice(0);
}
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
    got = subprocess.run(["node", str(tmp_path / "t.mjs"), str(tmp_path / "ha-frame.mjs"), str(tmp_path / "shell.js"), mode],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


HA = "https://ha.example.com"


def test_in_a_webpage_dashboard_it_says_the_screen_s_setting_and_offers_the_way_back(tmp_path):
    got = run(tmp_path, "framed")
    assert got["inHa"] is True and got["inIngress"] is False and got["started"] is True and got["kind"] == "dashboard"
    assert got["first"] == [[{"source": "mantel", "type": "mantel/kiosk", "screen": "dashboard-hall", "header": True,
                              "sidebar": False, "admins": False}, HA]]
    assert got["afterChange"] == [[{"source": "mantel", "type": "mantel/kiosk", "screen": "dashboard-hall",
                                    "header": False, "sidebar": False, "admins": True}, HA]]
    assert got["asked"] == ["mantel/kiosk"], "said again when the page around it asks"
    assert got["strangers"] == {"linked": False, "posted": []}, "never for another address or another window"
    assert got["hostMenu"] == [["Home Assistant", "function", None], ["Mantel Settings", "undefined", "/settings"]]


def test_before_mantel_link_answers_no_row_that_cannot_work(tmp_path):
    # HA frames a Webpage dashboard in a sandbox without top navigation: a link to HA's window from inside did
    # nothing (Avery, 2026-10-20), so until Mantel Link says the sidebar there is no Home Assistant section
    got = run(tmp_path, "framed")["beforeLink"]
    assert got["nav"] is None
    assert got["menu"] is False
    # the way back is always Mantel Link's to do (0.1.0's hello can come before this page is up)
    assert got["hostMenu"] == ["Home Assistant", "Mantel Settings"] and got["back"] is True
    assert got["posted"] == [[{"source": "mantel", "type": "mantel/back"}, HA]] and got["opened"] == []


def test_with_mantel_link_0_1_0_only_the_way_back_through_it(tmp_path):
    got = run(tmp_path, "framed")["oldLink"]
    assert got["nav"] is None, "no sidebar from Mantel Link: no Home Assistant section"
    assert got["hostMenu"] == ["Home Assistant", "Mantel Settings"]
    assert got["back"] == [[{"source": "mantel", "type": "mantel/back"}, HA]] and got["opened"] == []


def test_with_mantel_link_the_menu_is_this_person_s_home_assistant_sidebar(tmp_path):
    got = run(tmp_path, "framed")
    assert got["forged"] is None, "a sidebar from another address is not believed"
    assert got["redraw"] == 1 and got["nav"] == "own"
    assert got["side"] == {
        "user": {"is_admin": False},
        "panels": {"map": {"title": "Map", "icon": "mdi:map", "require_admin": False},
                   "logbook": {"title": "Activity", "icon": None, "require_admin": False},
                   "hacs": {"title": "HACS", "icon": "hacs:hacs", "require_admin": True}},
        "prefs": {"panelOrder": ["map"], "hiddenPanels": ["hacs"]}, "shown": False, "title": ""}
    assert got["go"] == [True, False, False], "only a plain path of Home Assistant's"
    assert got["menu"] is True
    assert got["asks"] == [[{"source": "mantel", "type": "mantel/navigate", "path": "/config/dashboard"}, HA],
                           [{"source": "mantel", "type": "mantel/menu"}, HA],
                           [{"source": "mantel", "type": "mantel/notifications"}, HA],
                           [{"source": "mantel", "type": "mantel/back"}, HA]]


def test_under_the_app_s_sidebar_it_uses_home_assistant_s_own_page_and_protocol(tmp_path):
    got = run(tmp_path, "ingress")
    assert got["inHa"] is False and got["inIngress"] is True and got["started"] is True and got["kind"] == "ingress"
    assert got["first"] == [], "no kiosk message: Home Assistant's own frame protocol applies"
    assert got["nav"] == "own"
    assert got["side"] == {"admin": True, "panels": ["map"], "title": "Map",
                           "prefs": {"panelOrder": ["map"], "hiddenPanels": []}}
    assert got["go"] == [True, False] and got["menu"] is True
    assert got["asks"] == [[{"type": "home-assistant/navigate", "path": "/config/dashboard"}, HA],
                           [{"type": "home-assistant/toggle-menu"}, HA]]
    assert got["mainEvents"] == ["hass-show-notifications"]
    assert got["hostMenu"] == ["Mantel Settings"], "Home Assistant's sidebar is right there: no back row"
    assert got["unreadable"] == {"link": HA + "/", "top": True}


def test_opened_on_its_own_one_row_opens_home_assistant_s_address(tmp_path):
    got = run(tmp_path, "alone")
    assert got["inHa"] is False and got["inIngress"] is False and got["started"] is False and got["first"] == []
    assert got["nav"] is None, "no address (a wall tablet): no Home Assistant rows at all"
    assert got["withAddress"] == {"link": "https://ha.home.example", "top": False}
    assert got["badAddress"] is None
    assert got["go"] is False and got["menu"] is False and got["asks"] == []
    assert got["hostMenu"] == ["Mantel Settings"]
