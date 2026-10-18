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

// a Mantel URL path ('/api/session') under the prefix
export const mantelUrl = (path) => base + path;
export const wsUrl = (path) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}${path}`;

// an absolute address of this site that is not under the prefix yet
const outside = (u) => typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' &&
  u !== base && u.indexOf(base + '/') !== 0;

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
