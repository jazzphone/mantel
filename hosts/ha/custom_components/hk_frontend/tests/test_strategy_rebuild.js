// hk-strategy.js: WHEN a generated dashboard asks Home Assistant to build it
// again (config-refresh, after a settings change), and when it must wait.
//
// Two things found by the 2026-09-28 audit, each with a scenario here that
// fails on the code before it:
//   * a settings push that lands WHILE a build waits (on the music round
//     trip) was in the fingerprint but not in the build, so no rebuild ever
//     followed -- the build now fingerprints what it reads before reading it;
//   * a rebuild re-creates every card, so it waits while the screen is in use
//     (touched in the last 30 s, or a sheet / pop-up covering the page).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

var CUR = { boards: { 'dashboard-kitchen': { favorites: ['light.a'] } }, accessories: {}, kinds: {} };
var L = [];
window.hkSettings = {
  get: function (p, f) { var v = CUR; p.split('.').forEach(function (k) { v = v == null ? v : v[k]; }); return v == null ? f : v; },
  whenLive: function () { return Promise.resolve(true); },
  onChange: function (fn) { L.push(fn); }, weatherId: function () { return null; }
};
location.pathname = '/dashboard-kitchen/0';
// refresh() looks for <home-assistant> to send config-refresh: count the asks
var refreshes = 0, qs = document.querySelector;
document.querySelector = function (s) {
  if (s === 'home-assistant') { refreshes++; return null; }
  return qs ? qs.call(document, s) : null;
};
// the pill's table (hkCards.TILE): a page's grids are built from it
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');

var musicCb = null;
var hass = { states: { 'light.a': { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'A' } },
                       'light.b': { entity_id: 'light.b', state: 'on', attributes: { friendly_name: 'B' } } },
  entities: { 'light.a': { area_id: 'k' }, 'light.b': { area_id: 'k' } }, devices: {}, areas: { k: { name: 'K' } }, floors: {},
  themes: { themes: {} }, config: {},
  connection: { subscribeMessage: function (cb) { musicCb = cb; return Promise.resolve(function () { return Promise.resolve(); }); } } };
function favs(c) { return JSON.stringify(c.views[0].cards.filter(function (x) { return JSON.stringify(x).indexOf('"Favorites"') >= 0; })); }
function push(favorites) {
  CUR = JSON.parse(JSON.stringify(CUR));
  CUR.boards['dashboard-kitchen'].favorites = favorites;
  L.forEach(function (f) { f(CUR); });
}
function settle() { for (var i = 0; i < 4; i++) { __runTimers(); drainMicrotasks(); } }

var cfg = null;
window.hkStrategy.generate({}, hass).then(function (c) { cfg = c; }); drainMicrotasks(); musicCb({}); drainMicrotasks();
ok('a first build, with its one favorite', cfg && favs(cfg).indexOf('light.a') > 0 && favs(cfg).indexOf('light.b') < 0);

// A PUSH DURING A BUILD
__resetTimers(); refreshes = 0;
window.hkStrategy.generate({}, hass).then(function (c) { cfg = c; }); drainMicrotasks();
push(['light.a', 'light.b']);                 // lands while the build waits on music
musicCb({}); drainMicrotasks();
ok('a push during a build is not in that build', favs(cfg).indexOf('light.b') < 0);
settle();
ok('...so a rebuild follows it (it used to be lost until the next change)', refreshes === 1, refreshes);

// NOT UNDER A FINGER
var realNow = Date.now, T = realNow();
Date.now = function () { return T; };
__resetTimers(); refreshes = 0;
window.dispatchEvent({ type: 'pointerdown' });
push(['light.b']);
settle();
ok('a change while the screen was touched in the last 30 s waits', refreshes === 0, refreshes);
T += 31000;
settle();
ok('...and is applied once the screen has been left alone', refreshes === 1, refreshes);

__resetTimers(); refreshes = 0;
window.hkPopupCover = 1;
push(['light.a']);
T += 60000;
settle();
ok('a change while a sheet covers the page waits', refreshes === 0, refreshes);
window.hkPopupCover = 0;
settle();
ok('...and is applied once it closes', refreshes === 1, refreshes);

// A CHANGE MADE ON THIS SCREEN (its sheet's gear): built as soon as the sheet
// closes, though the screen was just touched
__resetTimers(); refreshes = 0;
window.hkPopupCover = 1;
window.dispatchEvent({ type: 'pointerdown' });
window.hkStrategy.ownChange();
push(['light.b']);
settle();
ok('a change made here waits for its sheet...', refreshes === 0, refreshes);
window.hkPopupCover = 0;
T += 1000;
settle();
ok('...and is built the moment it closes, not 30 s later', refreshes === 1, refreshes);
__resetTimers(); refreshes = 0;
window.dispatchEvent({ type: 'pointerdown' });
push(['light.a']);
settle();
ok('the next change from elsewhere waits as before', refreshes === 0, refreshes);
T += 31000;
settle();
ok('...until the screen is left alone', refreshes === 1, refreshes);

// WHAT THE BUILD READS, AND ONLY THAT (the 2026-10-04 review). The menu's
// look is read live by hk-base's menuState; the Climate row's left-out rooms
// and the kinds only live cards count (motion, occupancy, Smoke & CO) shape
// no page -- none of them may rebuild a screen (every sheet closed, every
// camera reconnected). A screen with no Home DOES read `menu`: no menu, no
// back button on its first page.
function pushBoard(k, v) {
  CUR = JSON.parse(JSON.stringify(CUR));
  CUR.boards['dashboard-kitchen'][k] = v;
  L.forEach(function (f) { f(CUR); });
}
function pushTop(k, v) {
  CUR = JSON.parse(JSON.stringify(CUR));
  CUR[k] = v;
  L.forEach(function (f) { f(CUR); });
}
function quiet(name, change) {
  __resetTimers(); refreshes = 0;
  change();
  T += 60000;
  settle();
  ok(name, refreshes === 0, refreshes);
}
quiet('the menu\'s highlight colour rebuilds nothing', function () { pushBoard('accent', 'blue'); });
// THE SIDE PANE: hk-sidepane.js reads it live (2026-10-30: a change to it rebuilt the whole page)
quiet('...nor the Side Pane, a screen\'s own or as read', function () {
  pushBoard('side_pane', { width: 'wide' }); pushBoard('side_pane_read', { width: 'wide', headings: false });
});
quiet('...nor Swipe from Left Edge, the button\'s glyph, the clock, or the tab sizes', function () {
  pushBoard('swipe', true); pushBoard('glyph', 'lines'); pushBoard('clock', false);
  pushBoard('tab_size', 'small'); pushBoard('tab_size_phone', 'large');
  pushBoard('menu_custom', true); pushBoard('menu_house', false);
});
// THE SCREEN'S OWN LOOK: hk-settings.js amount('tint') / tintWell() and the
// glass read them live, and no build reads one
quiet('...nor the screen\'s own glass look: style, Frosted, Blur, Tinted amount and well', function () {
  pushBoard('glass', 'tinted'); pushBoard('frost', 60); pushBoard('frost_tint', true); pushBoard('blur', 40);
  pushBoard('tint', 70); pushBoard('well', 'light');
});
quiet('a motion, occupancy or smoke sensor found rebuilds nothing', function () {
  pushTop('kinds', { motion: ['binary_sensor.m'], occupancy: ['binary_sensor.o'], smoke: ['binary_sensor.s'] });
});
quiet('the Climate row leaving a room out rebuilds nothing (no page depends on it)', function () {
  pushTop('status_rows', { climate: { exclude_areas: ['k'] } });
});
// EVERY MENU SETTING, from the server's own list (settings.py MENU_KEYS), not
// a copy: the menu, the tab bar and the Home Assistant section read them all
// live, so none may rebuild a screen. A key added there and not to the
// strategy's LIVE_KEYS fails here (the tab bar's thirteen and `ha_place` once
// rebuilt every screen -- sheets closed, cameras reconnected -- on each change).
(function () {
  var py = read(HK_ROOT + '/hk_core/settings/model.py');   // the settings model (hk_core)
  var m = /\nMENU_KEYS = \{([\s\S]*?)\}\n/.exec(py);
  var keys = m ? (m[1].match(/"([a-z_]+)":/g) || []).map(function (k) { return k.slice(1, -2); }) : [];
  ok('settings.py MENU_KEYS read (' + keys.length + ' keys)', keys.length >= 20, keys.length);
  var VALS = { tab_bar_adjust: false, tab_bar_tabs: 4, tab_bar_tabs_rail: 4, dock_min: 900, clock: false,
               swipe: true, ha_row: true };
  var loud = [];
  keys.filter(function (k) { return k !== 'menu'; }).forEach(function (k) {
    __resetTimers(); refreshes = 0;
    pushBoard(k, k in VALS ? VALS[k] : 'changed-' + k);
    T += 60000; settle();
    if (refreshes) loud.push(k);
  });
  ok('...and not one of them rebuilds a screen', loud.length === 0, loud);
  // THE SCREEN'S OWN SKY, the same way: every sky_* key of BOARD_DEFAULTS is
  // read live by the sky (the build never reads one); `sky` itself -- the live
  // sky on or off -- is the build's, so it still rebuilds
  var bd = /\nBOARD_DEFAULTS[^=]*= \{([\s\S]*?)\n\}/.exec(py);
  var skyKeys = bd ? (bd[1].match(/"(sky_[a-z_]+)":/g) || []).map(function (k) { return k.slice(1, -2); }) : [];
  ok('settings.py BOARD_DEFAULTS sky_* keys read (' + skyKeys.length + ' keys)', skyKeys.length >= 8, skyKeys);
  var loudSky = [];
  skyKeys.forEach(function (k) {
    __resetTimers(); refreshes = 0;
    pushBoard(k, k === 'sky_pages' || k === 'sky_custom' ? { x: 'changed' } : 'changed-' + k);
    T += 60000; settle();
    if (refreshes) loudSky.push(k);
  });
  ok('...and not one of them rebuilds a screen', loudSky.length === 0, loudSky);
  __resetTimers(); refreshes = 0;
  pushBoard('sky', false);
  T += 60000; settle();
  ok('...while turning the screen\'s live sky off does (the build decides it)', refreshes === 1, refreshes);
  pushBoard('sky', true); T += 60000; settle();
})();
__resetTimers(); refreshes = 0;
pushTop('kinds', { motion: ['binary_sensor.m'], occupancy: ['binary_sensor.o'], smoke: ['binary_sensor.s'],
                   lights: ['light.a'] });
T += 60000; settle();
ok('...but a kind a page is built from still does', refreshes === 1, refreshes);
__resetTimers(); refreshes = 0;
pushBoard('menu', 'off');
T += 60000; settle();
ok('a screen with Home: its menu style is live, no rebuild', refreshes === 0, refreshes);
pushBoard('home_page', false);
T += 60000; settle();
__resetTimers(); refreshes = 0;
pushBoard('menu', 'auto');
T += 60000; settle();
ok('a screen with no Home: its menu decides the first page\'s back button, so it rebuilds', refreshes === 1, refreshes);
pushBoard('home_page', true);
T += 60000; settle();
Date.now = realNow;

// ONE ROOM THAT CANNOT BE BUILT: Home Assistant would replace every view with
// one error card if generate() threw. The room is left out of Home, its page
// says so, and the rest of the dashboard is built.
var bad = { entity_id: 'light.bad', state: 'on', attributes: {} };
bad.attributes.friendly_name = 'Bad';
// read only where a room page groups its tiles (groupOf): a fault in one page's build
Object.defineProperty(bad.attributes, 'device_class', { enumerable: true, get: function () { throw new Error('boom'); } });
hass = Object.assign({}, hass, { states: Object.assign({}, hass.states, { 'light.bad': bad }),
  entities: Object.assign({}, hass.entities, { 'light.bad': { area_id: 'x' } }),
  areas: { k: { name: 'K' }, x: { name: 'X' } } });
var errors = console.error, logged = 0; console.error = function () { logged++; };
var built2 = null, threw = null;
window.hkStrategy.generate({}, hass).then(function (c) { built2 = c; }, function (e) { threw = e; });
drainMicrotasks(); if (musicCb) musicCb({}); drainMicrotasks();
console.error = errors;
ok('a room that throws does not take the dashboard down', !threw && built2 && built2.views[0].path === 'home', String(threw));
var paths = built2 ? built2.views.map(function (v) { return v.path; }) : [];
ok('...the other room is still built, on Home and as its page',
   paths.indexOf('room-k') >= 0 && JSON.stringify(built2.views[0]).indexOf('light.a') >= 0, paths);
var xp = built2 && built2.views.filter(function (v) { return v.path === 'room-x'; })[0];
ok('...its own page says it could not be built, and it was logged',
   xp && xp.cards[0].type === 'markdown' && /could not be built/.test(xp.cards[0].content) && logged >= 1, xp && xp.cards);

print(fail ? 'FAIL ' + fail + ' STRATEGY REBUILD TESTS' : 'ALL ' + pass + ' STRATEGY REBUILD TESTS PASS');
