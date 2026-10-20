// ha-frame.js -- a Mantel screen shown INSIDE Home Assistant, two ways:
//
// A WEBPAGE DASHBOARD that frames Mantel's own address (Show in Home Assistant; ha_dashboards.py), with Mantel Link
// in that Home Assistant (docs/phase9/MANTEL-LINK.md 9.6). Mantel Link's script there (mantel-link.js) believes
// messages only from Mantel's own addresses and only from a frame on the page it shows. This side tells it:
//   * the screen's "Home Assistant Header & Sidebar" setting (HK Settings -> the screen -> Hide Home
//     Assistant Header & Sidebar), so HA hides its own header and sidebar around the screen as HK in HA did;
//   * "back to Home Assistant", from the menu's Home Assistant row (mantel-shell.js hostMenu), which is the
//     way out when HA's sidebar is hidden (a phone has no other);
//   * from HK's Home Assistant section (the screen's Menu -> Home Assistant Section): "open this page of Home
//     Assistant's" (`mantel/navigate`), its notifications (`mantel/notifications`) and its sidebar (`mantel/menu`).
// and hears from it, only from the page around this one, the entries of this person's Home Assistant sidebar
// (`mantel-link/sidebar`), which only decide the rows HK's menu shows. Without Mantel Link (nobody answers) the
// rows are one link to Home Assistant's page, opened in the top window.
//
// THE HA APP'S SIDEBAR PANEL (Ingress, base.js): the page around this one is Home Assistant's own, on this very
// origin. Its sidebar entries are read from that page; a page of Home Assistant's is opened by HA's own frame
// protocol (`home-assistant/navigate`, `home-assistant/toggle-menu`, sent to this origin only).
//
// Opened on its own (no parent) nothing here does anything. Nothing here is a command: navigation only.
import { base } from './base.js';

function framed() {
  try { return !!window.parent && window.parent !== window; } catch (e) { return true; }
}
export const inHa = framed() && !base;
export const inIngress = framed() && !!base;

// where the message goes: the page around this one (Chrome and Safari name it); else any (the screen's
// frame-ancestors already limit who can frame it, and nothing here is a secret)
function parentOrigin() {
  try { const a = location.ancestorOrigins; return a && a.length ? a[a.length - 1] : '*'; } catch (e) { return '*'; }
}
export function post(msg) {
  if (!inHa) return false;
  try { window.parent.postMessage(Object.assign({ source: 'mantel' }, msg), parentOrigin()); return true; } catch (e) { return false; }
}

const seg = () => { try { return decodeURIComponent(String(location.pathname).split('/')[1] || ''); } catch (e) { return ''; } };

// A screen's HK settings -> what to hide in Home Assistant (hk-kiosk.js fromBoard's rule, HK's own engine
// only), or null
export function kioskOf(b) {
  if (!b || !b.kiosk) return null;
  const eng = b.kiosk_engine || (b.kiosk_options && Object.keys(b.kiosk_options).length ? 'kiosk_mode' : 'hk');
  if (eng === 'kiosk_mode') return null;
  const w = { header: b.kiosk_header !== false, sidebar: b.kiosk_sidebar !== false, admins: b.kiosk_admins !== false };
  return w.header || w.sidebar ? w : null;
}

export function tellKiosk() {
  const S = window.hkSettings;
  const boards = S && S.get ? S.get('boards', null) : null;
  const k = kioskOf(boards && boards[seg()]);
  return post({ type: 'mantel/kiosk', screen: seg(), header: !!(k && k.header), sidebar: !!(k && k.sidebar),
                admins: k ? k.admins : true });
}

// ---- Home Assistant's sidebar, as the page around this one says it
let linked = false;                 // Mantel Link has spoken (its hello or the sidebar)
let side = null;                    // { user: {is_admin}, panels, localize, prefs, shown } or null
const changed = () => { try { window.dispatchEvent(new CustomEvent('hk-ha-nav-changed')); } catch (e) { /* no window */ } };

const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const ICON = /^[a-z0-9_-]{1,32}:[a-z0-9_-]{1,64}$/;
const str = (v, n) => (typeof v === 'string' && v.length <= n ? v : '');
const keys = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === 'string' && KEY.test(k)).slice(0, 200) : []);
// Mantel Link's `mantel-link/sidebar` -> the shape HK's menu reads (hkShell.sidebarData), or null. Only plain
// keys, titles and icons are kept: they label rows, nothing more.
export function sidebarOf(d) {
  if (!d || typeof d !== 'object' || !d.panels || typeof d.panels !== 'object') return null;
  const panels = {};
  Object.keys(d.panels).slice(0, 200).forEach((k) => {
    const p = d.panels[k];
    const title = p && str(p.title, 80);
    if (!KEY.test(k) || !title) return;
    panels[k] = { title, icon: ICON.test(str(p.icon, 100)) ? p.icon : null, require_admin: !!p.require_admin };
  });
  const prefs = d.prefs && typeof d.prefs === 'object'
    ? { panelOrder: keys(d.prefs.panelOrder), hiddenPanels: keys(d.prefs.hiddenPanels) } : null;
  return { user: { is_admin: !!d.admin }, panels, localize: () => '', prefs, shown: !!d.shown };
}

// the App's panel: Home Assistant's own page around this one (the same origin), read as HK in HA read it
let ingressPrefs = null, prefsAsked = false;
function haRoot() {
  try { return window.parent.document.querySelector('home-assistant'); } catch (e) { return null; }
}
function haMain() {
  const r = haRoot();
  return (r && r.shadowRoot && r.shadowRoot.querySelector('home-assistant-main')) || null;
}
function ingressShown() {
  try {
    const m = haMain(), sr = m && m.shadowRoot;
    const d = sr && sr.querySelector('ha-drawer'), s = sr && sr.querySelector('ha-sidebar');
    if (!d || !s || d.type === 'modal') return false;
    return s.getBoundingClientRect().width > 0;
  } catch (e) { return false; }
}
function ingressSide() {
  const r = haRoot(), h = r && r.hass;
  if (!h || !h.panels || !h.user) return null;
  if (!prefsAsked && h.connection && typeof h.connection.sendMessagePromise === 'function') {
    prefsAsked = true;
    h.connection.sendMessagePromise({ type: 'frontend/get_user_data', key: 'sidebar' })
      .then((got) => { ingressPrefs = (got && got.value) || null; changed(); }, () => { /* none saved */ });
  }
  return { user: { is_admin: !!h.user.is_admin }, panels: h.panels,
           localize: typeof h.localize === 'function' ? (k) => h.localize(k) : () => '',
           prefs: ingressPrefs, shown: ingressShown() };
}

function toHa(msg) {
  try { window.parent.postMessage(msg, location.origin); return true; } catch (e) { return false; }
}
const PATH = /^\/[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_.-]{1,64}){0,4}$/;

// what HK's menu and tab bar ask through mantel-shell.js
export function sidebar() { return inIngress ? ingressSide() : side; }
export function navigate(path) {
  if (typeof path !== 'string' || !PATH.test(path)) return false;
  if (inIngress) return toHa({ type: 'home-assistant/navigate', path });
  return post({ type: 'mantel/navigate', path });
}
export function notifications() {
  if (!inIngress) return post({ type: 'mantel/notifications' });
  const m = haMain();
  try { if (m) m.dispatchEvent(new CustomEvent('hass-show-notifications', { bubbles: true, composed: true })); } catch (e) { /* gone */ }
  return !!m;
}
export function menu() {
  if (inIngress) return toHa({ type: 'home-assistant/toggle-menu' });
  return linked ? post({ type: 'mantel/menu' }) : false;
}
// Home Assistant's own page, for the one row a framed screen shows when nobody answers
export function homeUrl() {
  if (inIngress) return location.origin + '/';
  const o = parentOrigin();
  return o && o !== '*' && /^https?:\/\//.test(o) ? o + '/' : '';
}
export function back() {
  if (linked) return post({ type: 'mantel/back' });
  const u = homeUrl();
  if (!u) return false;
  try { window.open(u, '_top'); return true; } catch (e) { return false; }
}

let started = false;
export function start() {
  if (!(inHa || inIngress) || started) return false;
  started = true;
  window.__mantelHaFrame = { kind: inIngress ? 'ingress' : 'dashboard', back, sidebar, navigate, notifications, menu, homeUrl };
  changed();
  if (inIngress) return true;
  tellKiosk();
  if (window.hkSettings && window.hkSettings.onChange) window.hkSettings.onChange(tellKiosk);
  // Mantel Link's script loaded after this page: it asks, and hears it again; it says this person's sidebar
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window.parent || !d || typeof d !== 'object') return;
    const o = parentOrigin();
    if (o !== '*' && e.origin !== o) return;
    if (d.type === 'mantel-link/hello') {
      if (!linked) { linked = true; changed(); }
      tellKiosk();
    } else if (d.type === 'mantel-link/sidebar') {
      linked = true;
      side = sidebarOf(d);
      changed();
    }
  });
  return true;
}

// for tests
export const _ = { reset() { linked = false; side = null; ingressPrefs = null; prefsAsked = false; }, linked: () => linked };
