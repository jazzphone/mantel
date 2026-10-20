"""Mantel Link's script on HA's pages (frontend/mantel-link.js; slice 9.6), in node with a stand-in for HA's page:
a framed screen from one of Mantel's addresses hides HA's header and sidebar as it says, and puts them back on
leaving; a message from another address, or from a frame not on the page, or from the page itself, does nothing;
`admins: false` leaves an admin's; "back" goes to HA's start page and nowhere else."""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

from conftest import COMPONENT

SCRIPT = r"""
const listeners = {};
class El {
  constructor(name, kids, shadow) { this.localName = name; this.children = kids || []; this.attrs = {};
    this.shadowRoot = shadow ? { children: shadow, styles: [], querySelector: (q) => find(shadow, q),
      appendChild(s) { this.styles.push(s); } } : null;
    if (this.shadowRoot) this.shadowRoot.querySelector = (q) => (q === 'style#mantel-kiosk' ? (this.shadowRoot.styles[0] || null) : find(shadow, q)); }
  hasAttribute(a) { return a in this.attrs; } setAttribute(a, v) { this.attrs[a] = v; } removeAttribute(a) { delete this.attrs[a]; }
  getAttribute(a) { return this.attrs[a] === undefined ? null : this.attrs[a]; }
  querySelector(q) { return find(this.children, q); }
}
function find(list, q) { for (const k of list) { if (k.localName === q) return k; const d = find(k.children || [], q); if (d) return d; } return null; }
const mantelWin = { posted: [], postMessage(m, o) { this.posted.push([m, o]); } };
const otherWin = { postMessage() {} };
const frame = new El('iframe'); frame.contentWindow = mantelWin; frame.attrs.src = 'https://mantel.example.com/dashboard-hall/home';
const card = new El('hui-iframe-card', [], [frame]);
const huiRoot = new El('hui-root', [], [new El('div'), card]);
const panel = new El('ha-panel-lovelace', [], [huiRoot]);
const drawer = new El('ha-drawer', [], [new El('div')]);
const main = new El('home-assistant-main', [], [drawer, new El('partial-panel-resolver', [panel])]);
const ha = new El('home-assistant', [], [main]);
ha.hass = { user: { is_admin: JSON.parse(process.argv[2]) }, connection: { sendMessagePromise: async () => ({ origins: ['https://mantel.example.com'] }) } };
globalThis.window = globalThis;
globalThis.document = { querySelector: (q) => (q === 'home-assistant' ? ha : null), createElement: (t) => ({ localName: t, id: '' }) };
globalThis.location = { pathname: '/mantel-hall', href: 'https://ha.example.com/mantel-hall' };
const pushed = [];
globalThis.history = { pushState: (s, t, u) => { pushed.push(u); location.pathname = u; } };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
const fired = [];
globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
globalThis.dispatchEvent = (e) => { fired.push(e.type); (listeners[e.type] || []).forEach((f) => f(e)); };
globalThis.setInterval = () => 0;
await import(process.argv[3]);
await new Promise((r) => setTimeout(r, 20));
const send = (data, origin, source) => (listeners.message || []).forEach((f) => f({ data, origin, source }));
const state = () => ({ sidebar: 'mantel-kiosk-sidebar' in main.attrs, drawer: 'mantel-kiosk-sidebar' in drawer.attrs,
                       header: 'mantel-kiosk-header' in huiRoot.attrs });
const out = {};
out.hello = mantelWin.posted.map(([m, o]) => [m.type, o]);
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: true }, 'https://evil.example.com', mantelWin);
out.otherOrigin = state();
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: true }, 'https://mantel.example.com', otherWin);
out.notOnThePage = state();
send({ type: 'mantel/kiosk', header: true, sidebar: true }, 'https://mantel.example.com', mantelWin);
out.notMantels = state();
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: false, admins: true }, 'https://mantel.example.com', mantelWin);
out.headerOnly = state();
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: false }, 'https://mantel.example.com', mantelWin);
out.adminsFalse = state();
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: true }, 'https://mantel.example.com', mantelWin);
out.both = state();
out.styled = [main.shadowRoot.styles.length, drawer.shadowRoot.styles.length, huiRoot.shadowRoot.styles.length];
location.pathname = '/lovelace/0';                       // another dashboard: everything back
window.__mantelLink._.apply();
out.elsewhere = state();
location.pathname = '/mantel-hall';
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: true }, 'https://mantel.example.com', mantelWin);
send({ source: 'mantel', type: 'mantel/back', to: '/config' }, 'https://mantel.example.com', mantelWin);
out.back = { pushed, fired, after: state() };
process.stdout.write(JSON.stringify(out));
"""


def run(tmp_path, admin):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    (tmp_path / "t.mjs").write_text(SCRIPT)
    got = subprocess.run(["node", str(tmp_path / "t.mjs"), json.dumps(admin),
                          os.path.join(COMPONENT, "frontend", "mantel-link.js")],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


NONE = {"sidebar": False, "drawer": False, "header": False}
ALL = {"sidebar": True, "drawer": True, "header": True}


def test_a_mantel_screen_hides_ha_s_chrome_as_it_says(tmp_path):
    got = run(tmp_path, False)
    assert got["hello"] == [["mantel-link/hello", "https://mantel.example.com"]], "asks Mantel's frame only"
    assert got["otherOrigin"] == NONE and got["notOnThePage"] == NONE and got["notMantels"] == NONE
    assert got["headerOnly"] == {"sidebar": False, "drawer": False, "header": True}
    assert got["adminsFalse"] == ALL, "not an admin: admins: false changes nothing for them"
    assert got["both"] == ALL and got["styled"] == [1, 1, 1]
    assert got["elsewhere"] == NONE, "leaving the screen puts HA's header and sidebar back"
    assert got["back"]["pushed"] == ["/"] and "location-changed" in got["back"]["fired"]
    assert got["back"]["after"] == NONE


def test_an_admin_keeps_them_when_the_screen_says_so(tmp_path):
    got = run(tmp_path, True)
    assert got["adminsFalse"] == NONE and got["both"] == ALL


# The screen's Home Assistant section (HK's menu inside HA): Mantel Link says this person's sidebar to the frame that
# spoke, at its own address only; opens one of HA's own pages (a panel this person has), HA's notification drawer,
# and HA's sidebar for HK's Show Menu (HA's own drawer toggle, or the docked sidebar back), lifting the screen's
# hiding only while that is open.
NAV = r"""
const listeners = {};
class El {
  constructor(name, kids, shadow) { this.localName = name; this.children = kids || []; this.attrs = {}; this.fired = []; this.on = {};
    this.shadowRoot = shadow ? { children: shadow, styles: [], appendChild(s) { this.styles.push(s); } } : null;
    if (this.shadowRoot) this.shadowRoot.querySelector = (q) => (q === 'style#mantel-kiosk' ? (this.shadowRoot.styles[0] || null) : find(shadow, q)); }
  hasAttribute(a) { return a in this.attrs; } setAttribute(a, v) { this.attrs[a] = v; } removeAttribute(a) { delete this.attrs[a]; }
  getAttribute(a) { return this.attrs[a] === undefined ? null : this.attrs[a]; }
  querySelector(q) { return find(this.children, q); }
  dispatchEvent(e) { this.fired.push(e.type + (e.detail && e.detail.open ? ':open' : '')); (this.on[e.type] || []).slice().forEach((f) => f(e)); }
  addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
  removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { width: this.width || 0 }; }
}
function find(list, q) { for (const k of list) { if (k.localName === q) return k; const d = find(k.children || [], q); if (d) return d; } return null; }
const mantelWin = { posted: [], postMessage(m, o) { this.posted.push([m, o]); } };
const frame = new El('iframe'); frame.contentWindow = mantelWin; frame.attrs.src = 'https://mantel.example.com/dashboard-hall/home';
const huiRoot = new El('hui-root', [], [new El('hui-iframe-card', [], [frame])]);
const panel = new El('ha-panel-lovelace', [], [huiRoot]);
const drawer = new El('ha-drawer', [], [new El('div')]); drawer.type = '';
const sidebar = new El('ha-sidebar'); sidebar.width = 256;
const main = new El('home-assistant-main', [], [drawer, sidebar, new El('partial-panel-resolver', [panel])]);
const ha = new El('home-assistant', [], [main]);
const asked = [];
ha.hass = { user: { is_admin: false },
  panels: { lovelace: { title: null }, map: { title: 'map', icon: 'mdi:map' }, config: { title: 'config', icon: 'mdi:cog', require_admin: true },
            profile: { title: null }, 'dashboard-hall': { title: 'Hall', icon: 'mdi:home' } },
  localize: (k) => ({ 'panel.map': 'Map', 'panel.config': 'Settings' }[k] || ''),
  connection: { sendMessagePromise: async (m) => { asked.push(m.type);
    return m.type === 'frontend/get_user_data' ? { value: { panelOrder: ['dashboard-hall'], hiddenPanels: ['map'] } }
                                               : { origins: ['https://mantel.example.com'] }; } } };
globalThis.window = globalThis;
globalThis.document = { querySelector: (q) => (q === 'home-assistant' ? ha : null), createElement: (t) => ({ localName: t, id: '' }) };
globalThis.location = { pathname: '/mantel-hall', href: 'https://ha.example.com/mantel-hall' };
const pushed = [];
globalThis.history = { pushState: (s, t, u) => { pushed.push(u); location.pathname = u; } };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
globalThis.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
globalThis.dispatchEvent = (e) => { (listeners[e.type] || []).forEach((f) => f(e)); };
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
globalThis.requestAnimationFrame = (f) => f();
globalThis.getComputedStyle = () => ({ display: 'flex' });
await import(process.argv[2]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(20);
const send = (data, origin, source) => (listeners.message || []).forEach((f) => f({ data, origin, source }));
const out = {};
mantelWin.posted.length = 0;
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: true }, 'https://mantel.example.com', mantelWin);
await wait(120);
out.told = mantelWin.posted.filter(([m]) => m.type === 'mantel-link/sidebar');
out.asked = asked.slice();
for (const p of ['/config/dashboard', '/profile/general', '/nowhere', '//evil.example.com/x', 'https://evil.example.com/', '/map?x=1', '/../config'])
  send({ source: 'mantel', type: 'mantel/navigate', path: p }, 'https://mantel.example.com', mantelWin);
send({ source: 'mantel', type: 'mantel/navigate', path: '/map' }, 'https://evil.example.com', mantelWin);
out.pushed = pushed.splice(0);
location.pathname = '/mantel-hall';
send({ source: 'mantel', type: 'mantel/kiosk', header: true, sidebar: true, admins: true }, 'https://mantel.example.com', mantelWin);
send({ source: 'mantel', type: 'mantel/notifications' }, 'https://mantel.example.com', mantelWin);
out.drawerEvents = main.fired.slice();
out.hiddenBefore = 'mantel-kiosk-sidebar' in main.attrs;
const look = () => ({ type: drawer.type, hidden: 'mantel-kiosk-sidebar' in main.attrs, header: 'mantel-kiosk-header' in huiRoot.attrs,
                     asked: main.fired.filter((t) => t.startsWith('hass-toggle-menu')), lifted: !!window.__mantelLink._.lift() });
main.fired.length = 0;
// a wide window: HA's docked sidebar comes back as it is, and goes again on Show Menu's second tap; HA is asked nothing
send({ source: 'mantel', type: 'mantel/menu' }, 'https://mantel.example.com', mantelWin);
out.wide = look();
send({ source: 'mantel', type: 'mantel/menu' }, 'https://mantel.example.com', mantelWin);
out.wideAgain = look();
// HA draws its sidebar as a drawer (a phone): HA is asked to open it; our hiding is off until HA says it closed
drawer.type = 'modal';
send({ source: 'mantel', type: 'mantel/menu' }, 'https://mantel.example.com', mantelWin);
out.drawer = look();
drawer.dispatchEvent(new CustomEvent('hass-drawer-closed'));
out.closed = look();
send({ source: 'mantel', type: 'mantel/menu' }, 'https://mantel.example.com', mantelWin);
dispatchEvent(new CustomEvent('location-changed'));      // a page chosen in HA's drawer: all as it was
out.after = look();
process.stdout.write(JSON.stringify(out));
"""


def test_the_screen_s_home_assistant_section(tmp_path):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    (tmp_path / "n.mjs").write_text(NAV)
    got = subprocess.run(["node", str(tmp_path / "n.mjs"), os.path.join(COMPONENT, "frontend", "mantel-link.js")],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    out = json.loads(got.stdout)
    assert len(out["told"]) == 1
    msg, origin = out["told"][0]
    assert origin == "https://mantel.example.com", "said to Mantel's frame at its own address only"
    assert msg["panels"] == {"map": {"title": "Map", "icon": "mdi:map", "require_admin": False},
                             "config": {"title": "Settings", "icon": "mdi:cog", "require_admin": True},
                             "dashboard-hall": {"title": "Hall", "icon": "mdi:home", "require_admin": False}}
    assert msg["admin"] is False and msg["shown"] is False, "HA's sidebar is hidden around this screen"
    assert msg["prefs"] == {"panelOrder": ["dashboard-hall"], "hiddenPanels": ["map"]}
    assert "frontend/get_user_data" in out["asked"]
    assert out["pushed"] == ["/config/dashboard", "/profile/general"], "only a plain path to a panel this person has"
    assert out["drawerEvents"] == ["hass-show-notifications"]
    assert out["hiddenBefore"] is True
    assert out["wide"] == {"type": "", "hidden": False, "header": True, "asked": [], "lifted": True}, \
        "beside the page: the docked sidebar back, HA's own drawer left alone"
    assert out["wideAgain"] == {"type": "", "hidden": True, "header": True, "asked": [], "lifted": False}
    assert out["drawer"] == {"type": "modal", "hidden": False, "header": True, "asked": ["hass-toggle-menu:open"],
                             "lifted": True}, "HA opens its own drawer (what its menu button sends)"
    assert out["closed"]["hidden"] is True and out["closed"]["lifted"] is False, "HA closed it: the screen's hiding is back"
    assert out["after"]["lifted"] is False
