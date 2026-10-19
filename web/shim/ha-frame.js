// ha-frame.js -- a Mantel screen shown INSIDE Home Assistant: a Webpage dashboard that frames Mantel's own
// address (Show in Home Assistant; ha_dashboards.py), with Mantel Link in that Home Assistant
// (docs/phase9/MANTEL-LINK.md 9.6). Mantel Link's script there (mantel-link.js) believes messages only from
// Mantel's own addresses and only from a frame on the page it shows. This side tells it two things:
//   * the screen's "Home Assistant Header & Sidebar" setting (HK Settings -> the screen -> Hide Home
//     Assistant Header & Sidebar), so HA hides its own header and sidebar around the screen as HK in HA did;
//   * "back to Home Assistant", from the menu's Home Assistant row (mantel-shell.js hostMenu), which is the
//     way out when HA's sidebar is hidden (a phone has no other).
// Under the HA App's sidebar (Ingress, base.js) Home Assistant's own frame protocol applies instead, and
// opened on its own (no parent) nothing here does anything.
import { base } from './base.js';

function framed() {
  try { return !!window.parent && window.parent !== window; } catch (e) { return true; }
}
export const inHa = framed() && !base;

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
export function back() { return post({ type: 'mantel/back' }); }

let started = false;
export function start() {
  if (!inHa || started) return false;
  started = true;
  window.__mantelHaFrame = { back };
  tellKiosk();
  if (window.hkSettings && window.hkSettings.onChange) window.hkSettings.onChange(tellKiosk);
  // Mantel Link's script loaded after this page: it asks, and hears it again
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data && e.data.type === 'mantel-link/hello') tellKiosk();
  });
  return true;
}
