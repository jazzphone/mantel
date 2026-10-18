// hk-kiosk.js: HK Frontend hiding Home Assistant's header and sidebar -- who
// asks (the address, the plugin's block, hk_kiosk, the screen's settings),
// admins, and what it does to the page (an attribute and one stylesheet per
// shadow root, taken away again on a page that doesn't ask).
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');

var pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}

// ---- a small Home Assistant page (Node_: not dom.js's El, which it would replace): home-assistant > main > drawer, resolver > lovelace panel > hui-root
function Node_(tag, kids) {
  this.tagName = tag.toUpperCase(); this.attrs = {}; this.kids = kids || [];
}
Node_.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node_.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
Node_.prototype.hasAttribute = function (k) { return k in this.attrs; };
Node_.prototype.appendChild = function (c) { this.kids.push(c); return c; };
Node_.prototype.querySelectorAll = function (sel) {
  var out = [], m = /^([a-z-]+)(?:#([a-z-]+))?$/i.exec(sel);
  (function w(n) { (n.kids || []).forEach(function (c) {
    if (c.tagName === m[1].toUpperCase() && (!m[2] || c.id === m[2])) out.push(c); w(c); }); })(this);
  return out;
};
Node_.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
function shadowed(tag, inner) { var e = new Node_(tag); e.shadowRoot = new Node_('#shadow', inner || []); return e; }

var root = shadowed('hui-root');
var panel = shadowed('ha-panel-lovelace', [root]);
panel.panel = { url_path: 'dashboard-kitchen' };
panel.lovelace = { config: { views: [] } };
var resolver = new Node_('partial-panel-resolver', [panel]);
var drawer = shadowed('ha-drawer');
var main = shadowed('home-assistant-main', [drawer, resolver]);
var ha = shadowed('home-assistant', [main]);
ha.hass = { user: { is_admin: false } };
var __qs = document.querySelector;
document.querySelector = function (s) { return s === 'home-assistant' ? ha : (__qs ? __qs.call(document, s) : null); };
var __ce = document.createElement;
document.createElement = function (t) { return t === 'style' ? new Node_('style') : __ce.call(document, t); };

location.pathname = '/dashboard-kitchen/0';
location.search = '';
var BOARDS = {}, DASHBOARD = true;
window.hkSettings = { get: function (p, f) { return p === 'boards' ? BOARDS : f; },
                      lovelacePanel: function () { return DASHBOARD; }, onChange: function () { return function () {}; } };

load(DIR + 'frontend/modules/hk-kiosk.js');
var K = window.hkKiosk, _ = K._;

// ---------------------------------------------------------------- the rules
ok('a block as written: true is both, false/nothing is none',
   JSON.stringify(_.norm(true)) === '{"header":true,"sidebar":true,"admins":true}' && _.norm(false) === null &&
   _.norm(null) === null && _.norm([1]) === null);
ok('...a mapping hides what it does not turn off, and nothing when it turns both off',
   _.norm({ header: false }).sidebar === true && _.norm({ header: false }).header === false &&
   _.norm({ header: false, sidebar: false }) === null && _.norm({ admins: false }).admins === false);
ok('the screen\'s settings: only with Hide Header & Sidebar on',
   _.fromBoard({ kiosk: false, kiosk_header: true }) === null && _.fromBoard(null) === null &&
   _.fromBoard({ kiosk: true }).header === true);
ok('...and not when the Kiosk Mode plugin does it (chosen, or a 1.2 screen with its options)',
   _.fromBoard({ kiosk: true, kiosk_engine: 'kiosk_mode' }) === null &&
   _.fromBoard({ kiosk: true, kiosk_options: { hide_header: false } }) === null &&
   _.fromBoard({ kiosk: true, kiosk_engine: 'hk', kiosk_options: { a: 1 } }) !== null);
var D = function (q) { return _.decide(Object.assign({ dashboard: true, cfg: null, board: null, admin: false, off: false, forced: false }, q)); };
var ON = { kiosk: true, kiosk_header: true, kiosk_sidebar: true, kiosk_admins: true, kiosk_engine: 'hk' };
ok('an existing dashboard: its HK settings', D({ board: ON }).header === true && D({ board: ON }).source === 'settings');
ok('its YAML\'s hk_kiosk wins over its settings, either way',
   D({ cfg: { hk_kiosk: false }, board: ON }) === null &&
   D({ cfg: { hk_kiosk: { sidebar: false } } }).sidebar === false && D({ cfg: { hk_kiosk: true } }).source === 'config');
ok('a dashboard with the plugin\'s kiosk_mode block: left to the plugin',
   D({ cfg: { kiosk_mode: { hide_header: true } }, board: ON }) === null &&
   D({ cfg: { kiosk_mode: {}, hk_kiosk: true } }) === null);
ok('not a dashboard: never', D({ dashboard: false, board: ON, forced: true }) === null);
ok('?hk_kiosk=off: never; ?hk_kiosk=on (this page only): both, whatever the screen or an earlier off says',
   D({ off: true, board: ON }) === null && D({ forced: true }).header === true && D({ forced: true, cfg: { kiosk_mode: {} } }).source === 'url' &&
   D({ forced: true, off: true }).source === 'url');
ok('admins: hidden too by default, left alone when the screen says so',
   D({ admin: true, board: ON }) !== null &&
   D({ admin: true, board: Object.assign({}, ON, { kiosk_admins: false }) }) === null &&
   D({ admin: false, board: Object.assign({}, ON, { kiosk_admins: false }) }) !== null);
ok('while the config loads (null), the settings answer', D({ cfg: null, board: ON }).source === 'settings');

// ---------------------------------------------------------------- the page
function styles(el) { return el.shadowRoot.querySelectorAll('style#hk-kiosk').length; }
K.refresh();
ok('a screen that asks for nothing: no attribute, and no stylesheet put anywhere',
   !main.hasAttribute('hk-kiosk-sidebar') && !root.hasAttribute('hk-kiosk-header') &&
   styles(main) + styles(drawer) + styles(root) === 0 && K.state() === null);
BOARDS['dashboard-kitchen'] = ON;
K.refresh();
ok('a screen that asks: the attributes on, one stylesheet in each of the three shadow roots',
   main.hasAttribute('hk-kiosk-sidebar') && drawer.hasAttribute('hk-kiosk-sidebar') && root.hasAttribute('hk-kiosk-header') &&
   styles(main) === 1 && styles(drawer) === 1 && styles(root) === 1, [main.attrs, drawer.attrs, root.attrs]);
K.refresh(); K.refresh();
ok('...looked at again: still one stylesheet each', styles(main) === 1 && styles(drawer) === 1 && styles(root) === 1);
ok('the stylesheets apply only under the attributes',
   /^:host\(\[hk-kiosk-sidebar\]\)/.test(_.CSS.main) && _.CSS.root.indexOf(':host([hk-kiosk-header]) .header{display:none') === 0 &&
   _.CSS.drawer.split('}').filter(Boolean).every(function (r) { return r.indexOf(':host([hk-kiosk-sidebar])') === 0; }));
K.hold(true);
ok('hold (the menu opens Home Assistant\'s sidebar): the sidebar shows, the header stays hidden',
   !main.hasAttribute('hk-kiosk-sidebar') && !drawer.hasAttribute('hk-kiosk-sidebar') && root.hasAttribute('hk-kiosk-header') &&
   K.state().sidebar === false);
K.hold(false);
ok('...and let go: hidden again', main.hasAttribute('hk-kiosk-sidebar') && K.state().sidebar === true);
panel.lovelace = { config: { views: [], kiosk_mode: { hide_header: true } } };
K.refresh();
ok('the dashboard\'s config turns out to have kiosk_mode: everything put back',
   !main.hasAttribute('hk-kiosk-sidebar') && !root.hasAttribute('hk-kiosk-header'));
panel.lovelace = { config: { views: [], hk_kiosk: true } };
panel.panel = { url_path: 'dashboard-other' };
BOARDS['dashboard-kitchen'] = { kiosk: false };
K.refresh();
ok('another dashboard\'s config still on the page (on the way here) is not read',
   !main.hasAttribute('hk-kiosk-sidebar'));
panel.panel = { url_path: 'dashboard-kitchen' };
K.refresh();
ok('...this one\'s is', main.hasAttribute('hk-kiosk-sidebar') && K.state().source === 'config');
DASHBOARD = false;
K.refresh();
ok('off to Settings: everything put back', !main.hasAttribute('hk-kiosk-sidebar') && !root.hasAttribute('hk-kiosk-header') &&
   K.state() === null);
DASHBOARD = true;
location.search = '?hk_kiosk=off';
dispatchEvent({ type: 'location-changed' });
K.refresh();
ok('?hk_kiosk=off: nothing hidden', !main.hasAttribute('hk-kiosk-sidebar') && K.state() === null);
location.search = '';
dispatchEvent({ type: 'location-changed' });
K.refresh();
ok('...still nothing once Home Assistant drops the query (until the page reloads)', !main.hasAttribute('hk-kiosk-sidebar'));
location.search = '?hk_kiosk=on';
dispatchEvent({ type: 'location-changed' });
K.refresh();
ok('?hk_kiosk=on: both hidden, whatever the screen says', main.hasAttribute('hk-kiosk-sidebar') && root.hasAttribute('hk-kiosk-header') &&
   K.state().source === 'url');
location.search = '?hk_kiosk=off';
dispatchEvent({ type: 'location-changed' });
K.refresh();
location.search = '';
ha.hass = { user: { is_admin: true } };
panel.lovelace = { config: { views: [], hk_kiosk: { admins: false } } };
K.refresh();
ok('an admin on a screen that leaves admins alone: nothing hidden', !main.hasAttribute('hk-kiosk-sidebar') && !root.hasAttribute('hk-kiosk-header'));

// A WALL TABLET KEEPS ITS CONNECTION: signed in as a screen's Tablet User,
// Home Assistant's "Automatically close connection" is turned off, once, by
// the event its profile switch fires
ok('a screen\'s Tablet User is one', _.tabletUser({ a: { tablet_user: 'kitchen' }, b: null }, 'kitchen') &&
   !_.tabletUser({ a: { tablet_user: 'kitchen' } }, 'Mark') && !_.tabletUser(null, 'kitchen'));
var sent = [];
ha.dispatchEvent = function (e) { sent.push(e); return true; };
BOARDS = { 'dashboard-kitchen': { tablet_user: 'kitchen' } };
ha.hass = { user: { is_admin: false, name: 'Mark' } };
K.refresh();
ok('a person\'s own browser keeps Home Assistant\'s setting', sent.length === 0);
ha.hass = { user: { is_admin: false, name: 'kitchen' }, suspendWhenHidden: true };
K.refresh();
ok('the tablet\'s user: the connection is kept while the screen is dark',
   sent.length === 1 && sent[0].type === 'hass-suspend-when-hidden' && sent[0].detail.suspend === false, sent.length);
K.refresh();
ok('...once', sent.length === 1);

print(fail ? '  ' + fail + ' KIOSK TESTS FAILED (' + pass + ' passed)' : '  ALL ' + pass + ' KIOSK TESTS PASS');
if (fail) throw new Error('kiosk tests failed');
