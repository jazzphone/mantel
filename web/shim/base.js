// base.js -- the page's address prefix. Imported first by home.js.
//
// As a Home Assistant App, Mantel's page is served by HA's Ingress under /api/hassio_ingress/<token>/
// (docs/phase3/HA-APP.md). Mantel Server then puts that prefix in <meta name="mantel-base"> and serves
// HK's code (and this page's own) with its absolute /hk/, /web/ and /static/mdi/ references moved under
// it and `location.pathname` read without it. What a rewrite of the files cannot see is done here, from
// the one value:
//   * Mantel's own REST calls and its WebSocket: mantelUrl('/api/...'), wsUrl('/ws');
//   * history writes: HK navigates to '/<dashboard>/<view>'; under the prefix that address is moved
//     inside it, so a reload opens Mantel again (not Home Assistant's own page);
//   * links and window.open() to an absolute address, likewise.
// On every other server there is no meta tag, the prefix is '' and nothing here changes anything.
const PREFIX = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]{1,128}$/;
const meta = document.querySelector('meta[name="mantel-base"]');
export const base = meta && PREFIX.test(meta.getAttribute('content') || '') ? meta.getAttribute('content') : '';
window.__mantelBase = base;
window.__hkBase = base;       // (the same, by a name HK's shared files may read: hk-tv.js's app icons)

// a Mantel URL path ('/api/session') under the prefix
export const mantelUrl = (path) => base + path;

// CACHE THAT LASTS (2026-10-29): an image's build (tools/build_static.py) stamps ?v=<build id> on every import of
// HK's and Mantel's own code and on the pages' script and stylesheet links, and the server lets a browser keep a
// file asked for with the build's id for a year without asking again (server.py). An import whose address is put
// together while the page runs ('/hk/sheets/' + file) cannot be stamped by the build: it goes through hkV(), which
// gives it the same ?v= this file was loaded with -- the same address as the build's own imports of that file, so
// it is fetched once and runs once. Run from a checkout (nothing stamped) it changes nothing. HK Frontend has no
// hkV: its callers use the address as it is.
const BUILD = new URL(import.meta.url).searchParams.get('v');
export const hkV = (u) => (BUILD && typeof u === 'string' && u.indexOf('?') < 0 && /\.(m?js|css)$/.test(u)
  ? u + '?v=' + BUILD : u);
window.hkV = hkV;
export const wsUrl = (path) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}${path}`;

// an absolute address of this site that is not under the prefix yet
const outside = (u) => typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' &&
  u !== base && u.indexOf(base + '/') !== 0;

// A wall tablet that is its own HA user (HA App mode, decision 21; ingress.py marks its page with
// <meta name="mantel-kiosk">): ask Home Assistant's frontend -- the App panel around this frame
// (ha-panel-app) -- for its kiosk mode, which hides HA's sidebar and the panel's header bar, so Kiosk
// Satellite shows Mantel's page full-screen. This is HA's own iframe protocol (the message
// `home-assistant/subscribe-properties` with `kioskMode: true`, HA frontend 2026.9 and later); an older HA
// ignores it. Sent to HA's own origin only (Ingress serves this frame from it). People are never marked.
export const kiosk = !!(base && document.querySelector('meta[name="mantel-kiosk"]'));
if (kiosk && window.parent && window.parent !== window) {
  try {
    window.parent.postMessage({ type: 'home-assistant/subscribe-properties', kioskMode: true }, location.origin);
  } catch (e) { /* no parent to tell (opened on its own): nothing to hide */ }
}

if (base) {
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (state, title, url) {
      return original.call(this, state, title, outside(url) ? base + url : url);
    };
  }
  const open = window.open;
  window.open = function (url, ...rest) { return open.call(window, outside(url) ? base + url : url, ...rest); };
  // a plain link to '/<dashboard>/...' (or any absolute address of the site): followed under the prefix
  document.addEventListener('click', (ev) => {
    const path = ev.composedPath ? ev.composedPath() : [];
    const a = path.find((n) => n && n.localName === 'a' && typeof n.getAttribute === 'function' && n.getAttribute('href'));
    if (a && outside(a.getAttribute('href'))) a.setAttribute('href', base + a.getAttribute('href'));
  }, true);
}
