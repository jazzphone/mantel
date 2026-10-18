// The menu's edge tab stays level with the date line however the page is
// scrolled when the menu re-syncs (hk-base.js viewTop, hk-menu.js place).
// A sync happens on any change in the page's height, a resize or a
// navigation; the document is what scrolls, so the dashboard panel's rect
// moves with it. A sync that ignored the scroll would put the tab 400 px up
// at scrollY 400, off the screen, and leave it there after scrolling back.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
var root = HK_ROOT;
load(root + '/tests/dom.js');
El.prototype.attachShadow = function () { this.shadowRoot = new El('#shadow'); return this.shadowRoot; };
var _ap = El.prototype.appendChild;
El.prototype.appendChild = function (c) { c.isConnected = true; return _ap.call(this, c); };
El.prototype.focus = function () {};
document.documentElement = new El('html');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}

var SETTINGS = { boards: { 'dashboard-hall': { menu: 'tab' } } };
window.hkSettings = { get: function (path, fb) {
  var v = SETTINGS, p = String(path).split('.');
  for (var i = 0; i < p.length; i++) { if (v == null) break; v = v[p[i]]; }
  return v == null ? fb : v;
} };
location.pathname = '/dashboard-hall/0';
var CFG = { views: [{ title: 'Hall', path: 'hall', cards: [] }] };
// The panel is as tall as the page and sits at the top of the document: its
// viewport top is minus the document's scroll.
window.scrollY = 0;
var panel = { get lovelace() { return { config: CFG }; }, shadowRoot: null, getBoundingClientRect: function () {
  var t = -window.scrollY;
  return { left: 0, top: t, width: 1280, height: 9000, right: 1280, bottom: t + 9000 }; } };
var main = { shadowRoot: { querySelector: function (s) { return s === 'ha-panel-lovelace' ? panel : null; } } };
var haSR = document.createElement('div');
var haQS = haSR.querySelector.bind(haSR);
haSR.querySelector = function (s) { return s === 'home-assistant-main' ? main : haQS(s); };
var ha = { shadowRoot: haSR };
document.querySelector = function (s) { return s === 'home-assistant' ? ha : null; };
window.innerWidth = 1280; window.innerHeight = 800;
load(root + '/frontend/cards/hk-base.js');
load(root + '/frontend/modules/hk-menu.js');
var M = window.hkCards.menu;

ok('a wall tablet dashboard draws the edge tab', M.style() === 'tab', M.style());
ok('the page top at rest does not move with the scroll',
   (function () { window.scrollY = 0; var a = M.viewTop(); window.scrollY = 400; var b = M.viewTop(); window.scrollY = 0; return a === b; })());

M.publishDate(118);                              // the date line, 118 px below the page top
window.hkMenu.sync();
var S = window.hkMenu._.state();
function tabY() { return S.root && S.root.style.getPropertyValue('--tab-y'); }
var rest = tabY();
function tabH() { return parseFloat(S.root.style.getPropertyValue('--tab-h')); }
ok('at rest the tab is centred on the date line', parseFloat(rest) + tabH() / 2 === 118, rest + ' h ' + tabH());
ok('a tablet gets the Large tab by default', tabH() === 86 && S.root.style.getPropertyValue('--tab-w') === '36px',
   tabH() + ' ' + S.root.style.getPropertyValue('--tab-w'));
window.scrollY = 400;
window.hkMenu.sync();                            // the page's height changed while scrolled
ok('a sync while scrolled leaves the tab where it was', tabY() === rest, tabY() + ' vs ' + rest);
window.scrollY = 0;
ok('back at the top, the tab is on the date line', tabY() === rest, tabY());

// ---- THE MIXES: the chip, and the tab once it is scrolled past;
// the chip on Home, the tab elsewhere
SETTINGS.boards['dashboard-hall'].menu = 'chip_scroll';
location.pathname = '/dashboard-hall/0';
ok('chip then tab: the chip style', M.style() === 'chip', M.style());
ok('...a round button on Home and beside the back chevron', M.round('home') && M.round('page'));
ok('...and the tab only once scrolled past', M.tab() === 'scrolled', M.tab());
// a chip card: its <ha-card> at a place the test moves
var chipTop = 150;
var chipEl = { isConnected: true, getBoundingClientRect: function () {
  return { top: chipTop, bottom: chipTop + 44, width: 44, left: 16, right: 60 }; } };
var chipCard = { shadowRoot: { querySelector: function (s) { return s === '[data-hk-role="menu"]' ? chipEl : null; } } };
M.chipShown(chipCard);
window.hkMenu.sync();
function cls() { return ' ' + S.root.className + ' '; }
ok('the chip in sight: the tab waits out past the edge', cls().indexOf(' tabscroll ') >= 0 && cls().indexOf(' tabbed ') < 0, cls());
function scrollTo(y) {
  chipTop = 150 - y; window.scrollY = y;
  // a page scroll is fired at the DOCUMENT (and reaches the window after);
  // the menu listens there, capturing, to hear any scroller
  __resetTimers(); document.dispatchEvent(new Event('scroll')); __runTimersUnder(1);
}
scrollTo(400);
ok('scrolled past the chip: the tab slides in', cls().indexOf(' tabbed ') >= 0, cls());
scrollTo(180);                                   // chip 44 px tall at 150: half gone past 172
ok('...and in once half the chip is gone above the top', cls().indexOf(' tabbed ') >= 0, cls());
scrollTo(100);
ok('the chip back in sight: the tab goes', cls().indexOf(' tabbed ') < 0, cls());
window.hkMenu.sync();
ok('...and a sync keeps it gone', cls().indexOf(' tabscroll ') >= 0 && cls().indexOf(' tabbed ') < 0, cls());
scrollTo(0);
chipEl.isConnected = false;                      // the view left the page
window.hkMenu.sync();
ok('no chip on the page yet: the tab waits a moment before counting it missing', cls().indexOf(' tabbed ') < 0, cls());
chipEl.isConnected = true;

SETTINGS.boards['dashboard-hall'].menu = 'chip_home';
ok('chip on Home: the chip on Home', M.style() === 'chip' && M.tab() === 'scrolled', M.style() + ' ' + M.tab());
location.pathname = '/dashboard-hall/lights';
ok('...the tab on every other page', M.style() === 'tab' && M.tab() === 'always', M.style() + ' ' + M.tab());
ok('...no round button beside the back chevron', M.round('page') === false);
ok('...while Home, cached, keeps its chip', M.round('home') === true);
window.hkMenu.sync();
ok('...and the tab is drawn outright', cls().indexOf(' tabbed ') >= 0 && cls().indexOf(' tabscroll ') < 0, cls());
window.innerWidth = 800;
ok('no room for a tab (an iPad upright): the chip everywhere, never the tab',
   M.style() === 'chip' && M.round('page') && M.tab() === 'never', M.style() + ' ' + M.tab());
// WHERE THE TABLETS' MENU DOESN'T FIT: the screen's Phones menu, in its
// button style (button_phone)
SETTINGS.boards['dashboard-hall'].button_phone = 'chip_scroll';
ok('no room, Phones\' "chip then tab": the chip, and the tab once scrolled past',
   M.style() === 'chip' && M.round('home') && M.tab() === 'scrolled', M.style() + ' ' + M.tab());
SETTINGS.boards['dashboard-hall'].button_phone = 'tab';
ok('no room, Phones\' "edge tab": the tab, no round buttons',
   M.style() === 'tab' && M.tab() === 'always' && !M.round('home') && !M.round('page'), M.style() + ' ' + M.tab());
// an always-open menu folds into the same choice -- even wider than 1,024
SETTINGS.boards['dashboard-hall'].menu = 'open';
SETTINGS.boards['dashboard-hall'].dock_min = 1500;
window.innerWidth = 1280;
ok('an always-open menu folded (narrower than its fold width): Phones\' menu',
   M.style() === 'tab' && M.tab() === 'always', M.style() + ' ' + M.tab());
SETTINGS.boards['dashboard-hall'].button_phone = 'chip';
ok('...the chip by default', M.style() === 'chip' && M.round('page') && M.tab() === 'never', M.style() + ' ' + M.tab());
delete SETTINGS.boards['dashboard-hall'].button_phone;
delete SETTINGS.boards['dashboard-hall'].dock_min;
window.innerWidth = 1280;
SETTINGS.boards['dashboard-hall'].menu = 'chip';
ok('the plain chip never draws the tab', M.tab() === 'never' && M.round('page'));
SETTINGS.boards['dashboard-hall'].menu = 'tab';
ok('the plain tab has no round buttons', M.tab() === 'always' && !M.round('home') && !M.round('page'));

// THE TAB'S SIZE (board tab_size): the screen's choice on a tablet, and
// always the slim one on a phone, where it lies over the first column
SETTINGS.boards['dashboard-hall'].tab_size = 'standard';
window.hkMenu.sync();
ok('Standard is the slim 26 x 62 tab', tabH() === 62 && S.root.style.getPropertyValue('--tab-w') === '26px');
ok('...still centred on the date line', parseFloat(tabY()) + 31 === 118, tabY());
SETTINGS.boards['dashboard-hall'].tab_size = 'xl';
window.hkMenu.sync();
ok('Extra Large is 46 x 110, with a larger glyph', tabH() === 110 && S.root.style.getPropertyValue('--tab-ic') === '24px');
window.innerWidth = 390;
window.hkMenu.sync();
ok('a phone keeps the slim tab by default, whatever the tablet\'s size', tabH() === 62, tabH());
// ...and has three sizes of its own (tab_size_phone), apart from the tablet's
SETTINGS.boards['dashboard-hall'].tab_size_phone = 'large';
window.hkMenu.sync();
ok('a phone\'s Large is 36 x 86', tabH() === 86 && S.root.style.getPropertyValue('--tab-w') === '36px', tabH());
SETTINGS.boards['dashboard-hall'].tab_size_phone = 'xl';
window.hkMenu.sync();
ok('a phone\'s Extra Large is 46 x 110', tabH() === 110, tabH());
SETTINGS.boards['dashboard-hall'].tab_size_phone = 'huge';
window.hkMenu.sync();
ok('an unknown phone size is Standard', tabH() === 62, tabH());
SETTINGS.boards['dashboard-hall'].tab_size_phone = 'large';
window.innerWidth = 1280;
window.hkMenu.sync();
ok('the phone\'s size leaves the tablet\'s alone', tabH() === 110, tabH());
delete SETTINGS.boards['dashboard-hall'].tab_size_phone;
SETTINGS.boards['dashboard-hall'].tab_size = 'huge';
window.hkMenu.sync();
ok('an unknown size is Large', tabH() === 86, tabH());
delete SETTINGS.boards['dashboard-hall'].tab_size;

// ---- SWIPE FROM THE LEFT EDGE (board swipe), and No Button with it
var B = SETTINGS.boards['dashboard-hall'];
B.menu = 'tab';
location.pathname = '/dashboard-hall/0';
window.hkMenu.sync();
ok('the swipe is off by default: no strip', !M.swipe() && cls().indexOf(' swipe ') < 0, cls());
B.swipe = true;
window.hkMenu.sync();
ok('on: the strip is there, beside the tab', M.swipe() && cls().indexOf(' swipe ') >= 0 && cls().indexOf(' tabbed ') >= 0, cls());
ok('...as wide as a wall tablet\'s margin (2% + 4 px, at most 24)', S.root.style.getPropertyValue('--edge-w') === '24px',
   S.root.style.getPropertyValue('--edge-w'));
window.innerWidth = 390;
window.hkMenu.sync();
ok('...16 px on a phone, its margin', S.root.style.getPropertyValue('--edge-w') === '16px');
window.innerWidth = 1280;
B.menu = 'none';
ok('No Button with the swipe: no chip, no tab', M.style() === 'none' && M.tab() === 'never' &&
   !M.round('home') && !M.round('page'), M.style() + ' ' + M.tab());
window.hkMenu.sync();
ok('...nothing drawn but the strip', cls().indexOf(' tabbed ') < 0 && cls().indexOf(' tabscroll ') < 0 &&
   cls().indexOf(' fabbed ') < 0 && cls().indexOf(' swipe ') >= 0, cls());
B.swipe = false;
CFG.views[0].cards = [];
ok('No Button without the swipe is Automatic: never left with no way in', M.style() === 'tab' && M.tab() === 'always',
   M.style() + ' ' + M.tab());
B.swipe = true;
window.innerWidth = 800;
B.button_phone = 'none';
ok('no room, Phones\' No Button with the swipe: nothing', M.style() === 'none' && !M.round('page') && M.tab() === 'never', M.style());
B.swipe = false;
ok('...without it, the chip', M.style() === 'chip' && M.round('page'), M.style());
delete B.button_phone;
window.innerWidth = 1280;
B.menu = 'open';
ok('a docked menu needs no swipe', M.docked() && !M.swipe() || !M.docked(), String(M.docked()));
B.menu = 'none'; B.swipe = true;
window.hkMenu.sync();

// THE DRAG: down in the strip, right, let go
var edge = S.edge;
var clock = 1e6, realNow = Date.now;
Date.now = function () { return clock; };
// the press lands on the strip; the rest of the gesture is heard at the
// document (as the browser delivers it, captured or not)
// A FINGER: its touch events (the swipe follows those, never a pointer
// capture), each a pointer event's name here for the steps below
var TOUCH = { pointerdown: 'touchstart', pointermove: 'touchmove', pointerup: 'touchend', pointercancel: 'touchcancel' };
var held = {};
function fire(el, t, x, y, id) {
  clock += 200;                                  // a slow, deliberate drag
  var tt = TOUCH[t], f = { identifier: id || 7, clientX: x, clientY: y };
  if (tt === 'touchstart') held[f.identifier] = f;
  if (tt === 'touchend' || tt === 'touchcancel') delete held[f.identifier];
  var e = { type: tt, changedTouches: [f], touches: Object.keys(held).map(function (k) { return held[k]; }) };
  // the touch the browser also reports as a pointer: the swipe leaves it be
  var pe = { type: t, clientX: x, clientY: y, pointerId: id || 7, pointerType: 'touch', button: 0 };
  if (tt === 'touchstart') {
    document.dispatchEvent({ type: 'touchstart', changedTouches: [f], touches: e.touches });   // capture, first
    (el._listeners.pointerdown || []).forEach(function (h) { h(pe); });
    (el._listeners.touchstart || []).forEach(function (h) { h(e); });
  } else document.dispatchEvent(e);
  document.dispatchEvent(pe);
}
// a MOUSE drag: pointer events, captured
function mouse(el, t, x, y) {
  clock += 200;
  var e = { type: t, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0 };
  if (t === 'pointerdown') (el._listeners.pointerdown || []).forEach(function (h) { h(e); });
  else document.dispatchEvent(e);
}
S.panel.getBoundingClientRect = function () { return { left: 0, top: 0, width: 300, height: 800, right: 300, bottom: 800 }; };
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 9, 430);
ok('a drag that goes down is the page\'s', !S.drag);
fire(edge, 'pointerup', 9, 430);
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 66, 405);
ok('a drag right pulls the panel out under the finger', S.drag && S.drag.live &&
   S.panel.style.transform === 'translateX(-250px)' && cls().indexOf(' dragging ') >= 0, S.panel.style.transform + cls());
fire(edge, 'pointerup', 66, 405);
ok('let go short of a third (and slowly): it slides back', !window.hkMenu.isOpen() && S.panel.style.transform === '' &&
   cls().indexOf(' dragging ') < 0 && !S.drag, cls());
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 40, 402);
fire(edge, 'pointermove', 170, 410);
fire(edge, 'pointerup', 170, 410);
ok('past a third: it opens', window.hkMenu.isOpen() && cls().indexOf(' open ') >= 0 && S.panel.style.transform === '', cls());
fire(edge, 'pointerdown', 6, 400);
ok('...and the strip does nothing while it is open', !S.drag);
window.hkMenu.close(true);
B.swipe = false;
window.hkMenu.sync();
fire(edge, 'pointerdown', 6, 400);
ok('the swipe off: the strip does nothing', !S.drag);
// a finger is never captured (on the iPhone a captured touch was never let
// go), and a drag that never hears its end does not stay
B.swipe = true;
window.hkMenu.sync();
var captured = 0;
edge.setPointerCapture = function () { captured++; };
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 40, 402);
fire(edge, 'pointermove', 200, 410);
document.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 7 }], touches: [] }); delete held[7];
ok('a finger opens it on its touchend alone (no pointerup)', window.hkMenu.isOpen() && !S.drag &&
   cls().indexOf(' dragging ') < 0 && S.panel.style.transform === '', cls() + S.panel.style.transform);
ok('...and its pointer is never captured', captured === 0, captured);
window.hkMenu.close(true);
mouse(edge, 'pointerdown', 6, 400);
mouse(edge, 'pointermove', 40, 402);
mouse(edge, 'pointermove', 200, 410);
mouse(edge, 'pointerup', 200, 410);
ok('a mouse drag opens it too, captured and let go', window.hkMenu.isOpen() && captured === 1 && !S.drag, captured);
window.hkMenu.close(true);
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 40, 402);
fire(edge, 'pointermove', 200, 410);
ok('no end at all: still live', S.drag && S.drag.live);
held = {};                                       // (that finger's end was lost)
document.dispatchEvent({ type: 'touchstart', changedTouches: [{ identifier: 8, clientX: 300, clientY: 300 }],
                         touches: [{ identifier: 8 }] });   // the next tap, a new finger, on the page
ok('...the next touch settles it (open, by where it was left)', window.hkMenu.isOpen() && !S.drag, cls());
window.hkMenu.close(true);
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 40, 402);
fire(edge, 'pointermove', 60, 402);
__runTimersUnder(5000);
ok('...or, with nothing at all, it settles itself (short: back)', !S.drag && !window.hkMenu.isOpen() &&
   cls().indexOf(' dragging ') < 0 && S.panel.style.transform === '', cls());
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 40, 402);
fire(edge, 'pointermove', 200, 410);
fire(edge, 'pointercancel', 200, 410);
ok('a touchcancel settles it by where it was left', window.hkMenu.isOpen() && !S.drag, cls());
window.hkMenu.close(true);
ok('...and nothing is left listening at the document', !((document.__l || {}).pointermove || []).length &&
   !((document.__l || {}).touchend || []).length && !((document.__l || {}).touchmove || []).length);
// a flick: short, but fast
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 30, 401);
clock -= 180;                                    // 20 ms after the last move
fire(edge, 'pointermove', 80, 402);
clock -= 180;
fire(edge, 'pointerup', 80, 402);
ok('a quick flick opens it short of a third', window.hkMenu.isOpen(), cls());
window.hkMenu.close(true);

// SENSITIVITY ("it doesn't always trigger"): a flick is read over the last
// 100 ms, not the last move; a thumb's arc (about 40 degrees) counts
function at(t) { clock = t; }
var T0 = clock + 10000;
at(T0); fire(edge, 'pointerdown', 6, 400); at(T0);
at(T0 + 16); fire(edge, 'pointermove', 30, 402); at(T0 + 16);
at(T0 + 32); fire(edge, 'pointermove', 60, 404); at(T0 + 32);
at(T0 + 48); fire(edge, 'pointermove', 85, 405); at(T0 + 48);
at(T0 + 80); fire(edge, 'pointermove', 88, 405); at(T0 + 80);     // slowing before it lifts
at(T0 + 85); fire(edge, 'pointerup', 88, 405); at(T0 + 85);
ok('a quick swipe that slows before the lift is still a flick: it opens', window.hkMenu.isOpen(), cls());
window.hkMenu.close(true);
T0 += 10000;
at(T0); fire(edge, 'pointerdown', 6, 400); at(T0);
at(T0 + 40); fire(edge, 'pointermove', 50, 368); at(T0 + 40);     // 44 across, 32 up: 36 degrees
ok('a thumb\'s arc (36 degrees) is a swipe', S.drag && S.drag.live, S.drag && JSON.stringify(S.drag.trail));
at(T0 + 80); fire(edge, 'pointermove', 180, 340); at(T0 + 80);
at(T0 + 90); fire(edge, 'pointerup', 180, 340); at(T0 + 90);
ok('...and opens', window.hkMenu.isOpen(), cls());
window.hkMenu.close(true);
T0 += 10000;
at(T0); fire(edge, 'pointerdown', 6, 400); at(T0);
at(T0 + 40); fire(edge, 'pointermove', 30, 370); at(T0 + 40);     // 24 across, 30 up: 51 degrees
ok('steeper than 45 degrees is the page\'s scroll', !S.drag && !window.hkMenu.isOpen());
at(T0 + 60); fire(edge, 'pointerup', 30, 370);
T0 += 10000;
at(T0); fire(edge, 'pointerdown', 6, 400); at(T0);
at(T0 + 16); fire(edge, 'pointermove', 40, 401); at(T0 + 16);
at(T0 + 32); fire(edge, 'pointermove', 80, 402); at(T0 + 32);
at(T0 + 400); fire(edge, 'pointerup', 80, 402); at(T0 + 400);     // stood still, then lifted
ok('a finger that stopped before it lifted is no flick: short of a third, back', !window.hkMenu.isOpen() && !S.drag, cls());
T0 += 10000;
at(T0); fire(edge, 'pointerdown', 6, 400); at(T0);
at(T0 + 16); fire(edge, 'pointermove', 22, 400); at(T0 + 16);
at(T0 + 24); fire(edge, 'pointerup', 30, 400); at(T0 + 24);
ok('a tiny twitch (under 24 px of panel) is no flick, however fast', !window.hkMenu.isOpen(), cls());
clock = T0 + 10000;

// THE FOCUS GOES BACK TO THE TAB only from the keyboard: after a tap the
// tab held it, and the Home Assistant app drew its focus ring (a white stroke)
var focused = 0, blurred = 0, active = null;
S.tab.focus = function () { focused++; active = S.tab; };
S.tab.blur = function () { blurred++; active = null; };
Object.defineProperty(S.host.shadowRoot, 'activeElement', { get: function () { return active; }, configurable: true });
B.menu = 'tab';
window.hkMenu.sync();
clock += 5000;                                   // well past the last swipe
window.hkMenu.open();
active = S.tab;                                  // (a web view that focuses a tapped button)
(S.tab._listeners.click || []).forEach(function (h) { h({ detail: 1, stopPropagation: function () {} }); });
ok('a tap on the tab closes it and lets the focus go', !window.hkMenu.isOpen() && focused === 0 && blurred === 1 && !active,
   [focused, blurred]);
window.hkMenu.open();
window.hkMenu.close();
ok('closed any other way (the scrim): no focus taken', focused === 0, focused);
window.hkMenu.open();
(__winL.keydown || []).forEach(function (h) { h({ key: 'Escape', stopPropagation: function () {} }); });
ok('Escape: the focus back on the tab, where a keyboard user was', !window.hkMenu.isOpen() && focused === 1, focused);
window.hkMenu.open();
(S.tab._listeners.click || []).forEach(function (h) { h({ detail: 0, stopPropagation: function () {} }); });
ok('the tab pressed with a key: the same', !window.hkMenu.isOpen() && focused === 2, focused);
B.menu = 'none';

// HOME ASSISTANT'S HIDDEN DRAWER: the app's own Swipe Right opens it (a
// modal no one sees, the page inert under it). Closed at once where the
// sidebar is hidden; told once, when it came with the edge swipe.
if (typeof getComputedStyle === 'undefined') globalThis.getComputedStyle = function (el) { return el.style; };
if (typeof sessionStorage === 'undefined') {
  globalThis.sessionStorage = { _: {}, getItem: function (k) { return this._[k] || null; }, setItem: function (k, v) { this._[k] = String(v); } };
}
var drawer = { open: false }, sidebar = new El('ha-sidebar'), told = [], observers = [];
sidebar.style.display = 'none';
sidebar.getBoundingClientRect = function () { return { width: 0, height: 0, left: 0, top: 0 }; };
main.shadowRoot.querySelector = function (q) {
  return q === 'ha-panel-lovelace' ? panel : q === 'ha-drawer' ? drawer : q === 'ha-sidebar' ? sidebar : null;
};
ha.dispatchEvent = function (e) { if (e.type === 'hass-notification') told.push(e.detail.message); };
window.MutationObserver = function (cb) {
  this.observe = function (t) { observers.push({ t: t, cb: cb }); };
  this.disconnect = function () {};
};
window.hkMenu.sync();
function drawerOpens() { drawer.open = true; observers.forEach(function (o) { if (o.t === drawer) o.cb([]); }); }
ok('the drawer is watched', observers.some(function (o) { return o.t === drawer; }));
clock += 60000;
drawerOpens();
ok('it opens with the sidebar hidden, no swipe: closed at once, nothing said', drawer.open === false && !told.length, told);
fire(edge, 'pointerdown', 6, 400);
fire(edge, 'pointermove', 40, 402);
drawerOpens();                                   // the app's gesture, on the same swipe
fire(edge, 'pointermove', 200, 410);
fire(edge, 'pointerup', 200, 410);
ok('on the edge swipe: closed, the menu opens anyway, and the app setting is named', drawer.open === false &&
   window.hkMenu.isOpen() && told.length === 1 && /Gestures/.test(told[0]), told);
window.hkMenu.close(true);
fire(edge, 'pointerdown', 6, 400); fire(edge, 'pointermove', 200, 410); drawerOpens(); fire(edge, 'pointerup', 200, 410);
ok('...said once only', drawer.open === false && told.length === 1, told.length);
window.hkMenu.close(true);
sidebar.style.display = 'block';
sidebar.getBoundingClientRect = function () { return { width: 256, height: 800, left: 0, top: 0 }; };
drawerOpens();
ok('a sidebar that shows is Home Assistant\'s to open: left alone', drawer.open === true);
drawer.open = false;
sidebar.style.display = 'none';
sidebar.getBoundingClientRect = function () { return { width: 0, height: 0, left: 0, top: 0 }; };
Date.now = realNow;
B.menu = 'tab'; delete B.swipe;

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' MENU TAB TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
