// SWIPE BETWEEN PAGES (modules/hk-pageswipe.js, docs/phase11/HOMEVIEW-LOOK.md
// Phase 0): when it is on, the order (the tab bar's, else the side menu's,
// extended by others: the Pages screen after Home), the one list of what
// keeps its own sideways swipe (hk-drag.js sideways) and the classifier, the
// edges, the thresholds -- then the gesture itself on a stand-in page: a
// sideways drag moves the page, its neighbour comes in, the tab bar's
// highlight follows and lands, and the host is asked for the page.
// Nothing here names a real house.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run pageswipe');
load(HK_ROOT + '/tests/dom.js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
location.pathname = '/dashboard-hall/0';
location.hash = '';
window.innerWidth = 1180; window.innerHeight = 820;

load(HK_ROOT + '/frontend/modules/hk-drag.js');
var threw = null;
try { load(HK_ROOT + '/frontend/modules/hk-pageswipe.js'); } catch (e) { threw = e; }
ok('loads with no page to swipe', !threw && !!window.hkPageSwipe, String(threw));
var P = window.hkPageSwipe, X = P._, D = window.hkDrag, N = X.NUMBERS;

print('=== when it is on ===');
ok('Automatic: where a tab bar shows', X.enabled('auto', { bar: true }) && !X.enabled('auto', { bar: false }));
ok('...or where the screen has its Pages screen (no tab bar needed)', X.enabled('auto', { bar: false, pagesScreen: true }));
ok('On: everywhere, bar or not', X.enabled('on', {}) && X.enabled('on', { bar: true }));
ok('Off: nowhere, whatever else', !X.enabled('off', { bar: true, pagesScreen: true }));
ok('...and a value it does not know reads as Automatic', X.enabled('sideways', { bar: true }) && !X.enabled(undefined, {}));

print('=== the order ===');
function it(p, title) { return { path: '/dashboard-hall/' + p, paths: [p], title: title || p, kind: p === '0' ? 'home' : 'page' }; }
function here(item, path) { return item.paths.indexOf(String(path).split('/')[2] || '0') >= 0; }
var BAR = [it('0', 'Home'), it('lights', 'Lights'), it('climate', 'Climate'), it('security', 'Security')];
var nb = X.neighbours(BAR, '/dashboard-hall/lights', here);
ok('the tab bar\'s tabs, left to right: Lights between Home and Climate', nb.at === 1 && nb.prev === BAR[0] && nb.next === BAR[2]);
ok('Home is first: nothing before it', X.neighbours(BAR, '/dashboard-hall/0', here).prev === null);
ok('the last tab: nothing after it (the swipe gives and comes back)', X.neighbours(BAR, '/dashboard-hall/security', here).next === null);
ok('a page not in the bar -- a room, a page under More -- has no page swipe',
   X.neighbours(BAR, '/dashboard-hall/room-kitchen', here).at === -1 && X.neighbours(BAR, '/dashboard-hall/weather', here).at === -1);
ok('the order as given, untouched by default', X.order({ items: BAR }).map(function (x) { return x.title; }).join() === 'Home,Lights,Climate,Security');
var PAGES = it('pages', 'Pages');
var off = P.extend(function (items, ctx) {
  if (!ctx.pagesScreen) return items;
  return [items[0], PAGES].concat(items.slice(1));
});
ok('extend(): the Pages screen right after Home, when the screen has it',
   X.order({ items: BAR, pagesScreen: true }).map(function (x) { return x.title; }).join() === 'Home,Pages,Lights,Climate,Security');
ok('...with no tab bar: Home and the Pages screen', X.order({ items: [BAR[0]], pagesScreen: true, bar: false }).length === 2);
ok('...an extension that gives nothing back leaves the list as it was', (function () {
  var o2 = P.extend(function () { /* nothing */ });
  var n = X.order({ items: BAR }).length; o2(); return n === 4;
})());
ok('...one that throws is skipped', (function () {
  var o3 = P.extend(function () { throw new Error('x'); });
  var n = X.order({ items: BAR }).length; o3(); return n === 4;
})());
off();
ok('...and taken out again', X.order({ items: BAR, pagesScreen: true }).length === 4);
ok('a view\'s address on its dashboard', X.viewSeg('/dashboard-hall/lights') === 'lights' && X.viewSeg('/dashboard-hall') === '' &&
   X.viewSeg('/dashboard-hall/climate?x=1#alarm') === 'climate');

print('=== what keeps its own swipe (hk-drag.js sideways: the one list) ===');
function node(name, o) {
  o = o || {};
  var tags = [name].concat(o.cls || []).concat(o.attrs || []);
  return { nodeType: 1, localName: name, _pages: o.pages, scrollWidth: o.sw || 0, clientWidth: o.cw || 0, overflowX: o.ox || 'visible',
           matches: function (sel) { return sel.split(',').some(function (s) { return tags.indexOf(s.trim()) >= 0; }); } };
}
window.getComputedStyle = function (n) { return { overflowX: n.overflowX, touchAction: 'auto' }; };
var view = node('hk-grid-view'), tile = node('hk-tile-card');
ok('a tile: the page\'s', !D.sideways([tile, view], view));
ok('a block that swipes its pages (more than one): its own', D.sideways([tile, node('hk-pager-card', { pages: [1, 2] }), view], view));
ok('...a pager with one page is not', !D.sideways([tile, node('hk-pager-card', { pages: [1] }), view], view));
ok('a slider, the thermostat\'s ring, a vertical slider', D.sideways([node('div', { attrs: ['[role="slider"]'] }), view], view) &&
   D.sideways([node('div', { cls: ['.ring'] }), view], view) && D.sideways([node('div', { cls: ['.vs'] }), view], view));
ok('a field: input, select, textarea, contenteditable', ['input', 'select', 'textarea'].every(function (t) { return D.sideways([node(t), view], view); }) &&
   D.sideways([node('div', { attrs: ['[contenteditable="true"]'] }), view], view));
ok('anything marked data-hk-control (a light held into its dimmer)', D.sideways([node('div', { attrs: ['[data-hk-control]'] }), view], view));
ok('a row that scrolls sideways (the scenes row, a camera strip)',
   D.sideways([tile, node('div', { sw: 1400, cw: 900, ox: 'auto' }), view], view));
ok('...but not one with nothing to scroll, nor one that clips', !D.sideways([tile, node('div', { sw: 900, cw: 900, ox: 'auto' }), view], view) &&
   !D.sideways([tile, node('div', { sw: 1400, cw: 900, ox: 'hidden' }), view], view));
ok('only up to the page: what is around it is not asked', !D.sideways([tile, view, node('input')], view));
ok('the list is one string, shared', /\[data-hk-control\]/.test(D.SIDEWAYS) && /\.ring/.test(D.SIDEWAYS));

print('=== the classifier (hkDrag.classify, press()\'s own) ===');
var o = { axis: 'x', slop: N.START, ratio: N.RATIO };
ok('within 10 px: still a press', D.classify(6, 6, o) === 'press');
ok('sideways at more than 1.4 times the vertical: a swipe', D.classify(-15, 10, o) === 'drag' && D.classify(30, -21, o) === 'drag');
ok('...at 1.4 or less: the page scrolls', D.classify(14, 10, o) === 'scroll' && D.classify(2, 40, o) === 'scroll');
ok('press()\'s defaults unchanged: 8 px, 1.2 along the axis, a mouse any way',
   D.classify(5, 5, { axis: 'x' }) === 'press' && D.classify(13, 10, { axis: 'x' }) === 'drag' &&
   D.classify(0, 9, { slop: 5, free: true }) === 'drag');

print('=== edges, travel, landing ===');
ok('the numbers: 24 px edges, 10 px at 1.4, a fifth, 0.5 px/ms, a third', N.EDGE === 24 && N.START === 10 && N.RATIO === 1.4 &&
   N.TURN === 0.2 && N.FLICK === 0.5 && Math.abs(N.GIVE - 1 / 3) < 1e-9);
ok('within 24 px of either side: left alone (the side menu, Safari\'s back and forward)',
   X.atEdge(10, 1180, 0, 0) && X.atEdge(1165, 1180, 0, 0) && !X.atEdge(30, 1180, 0, 0) && !X.atEdge(1150, 1180, 0, 0));
ok('...measured from the page: the iPhone Duo\'s 84 px strip is not the page\'s', X.atEdge(466 - 84 - 10, 466, 0, 84) && !X.atEdge(466 - 84 - 30, 466, 0, 84));
ok('towards a page: all the travel; past an end, a third', X.travel(-90, true) === -90 && X.travel(-90, false) === -30);
ok('lands past a fifth of the width', X.lands(-237, 1180, 0) && !X.lands(-230, 1180, 0) && X.lands(80, 390, 0));
ok('...or on a flick over 0.5 px/ms, that way, past 30 px', X.lands(-40, 1180, -0.8) && !X.lands(-40, 1180, 0.8) &&
   !X.lands(-20, 1180, -2) && !X.lands(-40, 1180, -0.4));
ok('no travel, no landing', !X.lands(0, 1180, 5));
ok('the flick is the last 100 ms, not the whole drag', Math.abs(X.speed([[0, 500], [400, 490], [450, 460], [500, 420]]) - (-0.7)) < 1e-9 &&
   X.speed([[0, 1]]) === 0);

// ------------------------------------------------------------ the gesture
print('=== the gesture, on a stand-in page ===');
var slot = document.createElement('div');
var page = document.createElement('hk-grid-view');
slot.appendChild(page);
page.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1180, height: 820 }; };
page.setPointerCapture = function () {};
var calls = [], navTo = [], barOn = true, MODE = 'auto';
window.hkCards = { menu: { board: function () { return {}; }, tabBar: function () { return barOn; }, panel: function () { return null; } },
                   safeArea: function () { return { left: 0, right: 0, top: 0, bottom: 0 }; } };
window.hkSettings = { swipePages: function () { return MODE; } };
window.hkMenu = { _: { isHere: here } };
window.hkTabBar = { pages: function () { return { bar: barOn, items: BAR }; },
                    follow: function (k, path) { calls.push(['follow', +k.toFixed(3), path]); return true; },
                    land: function (path) { calls.push(['land', path]); } };
window.hkShell = { viewSlot: function () { return slot; }, view: function () { return page; },
                   navigate: function (p) { navTo.push(p); location.pathname = p; }, onDashboard: function () { return true; } };
function ev(x, y, o) {
  return Object.assign({ clientX: x, clientY: y, pointerId: 3, pointerType: 'touch', button: 0, isPrimary: true, timeStamp: Date.now(),
                         composedPath: function () { return [tile, page, slot]; } }, o || {});
}
function fire(t, e) { e.type = t; document.dispatchEvent(e); }
// each timer once (the shim's keep theirs until cleared)
function run() { __runTimers(); __resetTimers(); }
P.arm();
ok('the page says touch-action pan-y while the swipe is on here', page.style.getPropertyValue('touch-action') === 'pan-y pinch-zoom');

location.pathname = '/dashboard-hall/lights';
fire('pointerdown', ev(600, 400));
fire('pointermove', ev(594, 398));
ok('6 px: nothing moves yet', !page.style.transform && !P._.state().G.live);
fire('pointermove', ev(560, 395));
var G = P._.state().G;
ok('40 px sideways: the swipe begins, the page follows the finger', G && G.live && page.style.transform === 'translateX(-40.0px)', page.style.transform);
ok('...the next page comes in beside it (its title, as it is not held)', slot.children.length === 2 &&
   slot.children[1].className === 'hk-swipe-ghost' && slot.children[1].style.transform === 'translateX(1140.0px)',
   slot.children[1] && slot.children[1].style.transform);
ok('...the tab bar\'s highlight follows by the fraction, towards Climate',
   JSON.stringify(calls[calls.length - 1]) === JSON.stringify(['follow', +(40 / 1180).toFixed(3), '/dashboard-hall/climate']), calls);
fire('pointermove', ev(300, 410));
fire('pointerup', ev(300, 410));
ok('let go past a fifth: the highlight lands on Climate', JSON.stringify(calls[calls.length - 1]) === '["land","/dashboard-hall/climate"]');
ok('...and the page slides the rest of the way on the standard curve', /translateX\(-1180\.0px\)/.test(page.style.transform) &&
   /transform 340ms cubic-bezier\(\.32,\.72,0,1\)/.test(page.style.transition), page.style.transition);
run();
ok('then the page it lands on is asked for', navTo.join() === '/dashboard-hall/climate', navTo);
var shown = document.createElement('hk-grid-view');
dispatchEvent(new CustomEvent('hk-view-ready', { detail: { view: shown } }));
ok('...and once it is in, the stand-in goes and the page it left is as it was', slot.children.length === 1 &&
   !page.style.transform && !page.style.transition, [slot.children.length, page.style.transform]);

calls = []; navTo = [];
location.pathname = '/dashboard-hall/lights';
fire('pointerdown', ev(600, 400));
fire('pointermove', ev(640, 404));
fire('pointerup', ev(660, 404, { timeStamp: Date.now() + 1000 }));
ok('a short slow drag back: lands where it was', JSON.stringify(calls[calls.length - 1]) === '["land",null]' &&
   /translateX\(0\.0px\)/.test(page.style.transform));
run();
ok('...nothing asked for, the page given back', !navTo.length && !page.style.transform && slot.children.length === 1);

location.pathname = '/dashboard-hall/0';
fire('pointerdown', ev(600, 400));
fire('pointermove', ev(690, 400));
ok('Home, swiping back: nothing before it -- a third of the travel', page.style.transform === 'translateX(30.0px)', page.style.transform);
fire('pointerup', ev(900, 400));
run();
ok('...and it springs back, nothing asked for', !navTo.length && !page.style.transform);

function starts(x, y, more, path) {
  fire('pointerdown', ev(x, y, path ? { composedPath: function () { return path; } } : {}));
  fire('pointermove', ev(x - 60, y + (more || 0), path ? { composedPath: function () { return path; } } : {}));
  var g = P._.state().G, live = !!(g && g.live);
  fire('pointercancel', ev(x - 60, y));
  run();
  return live;
}
location.pathname = '/dashboard-hall/lights';
ok('a swipe from the left 24 px is left alone (the side menu\'s)', !starts(12, 400) && starts(40, 400));
ok('...and from the right 24 px (Safari\'s forward)', !starts(1170, 400));
ok('a mostly vertical drag is the page\'s scroll', !starts(600, 400, 80));
ok('a swipe on a slider stays the slider\'s', !starts(600, 400, 0, [node('div', { attrs: ['[role="slider"]'] }), page, slot]));
ok('...off the page (a sheet, the bar, HK Settings\' preview): never', !starts(600, 400, 0, [tile, slot]));
location.pathname = '/dashboard-hall/room-kitchen';
ok('on a room page: no page swipe', !starts(600, 400));
location.pathname = '/dashboard-hall/lights';
location.hash = '#alarm';
ok('with a pop-up open: off', !starts(600, 400));
location.hash = '';
window.hkEdit = { active: function () { return {}; } };
ok('in Edit mode: off', !starts(600, 400));
window.hkEdit = null;
window.hkSaver = { running: function () { return true; } };
ok('while the screensaver shows: off', !starts(600, 400));
window.hkSaver = null;
window.hkMenu.isOpen = function () { return true; };
ok('with the menu open: off', !starts(600, 400));
window.hkMenu.isOpen = function () { return false; };
barOn = false;
ok('Automatic with no tab bar: off', !starts(600, 400));
MODE = 'on';
ok('...On: the side menu\'s order', starts(600, 400));
MODE = 'off'; barOn = true;
ok('Off, with the bar: off', !starts(600, 400));
P.arm();
ok('...and the page gives its pan back', !page.style.getPropertyValue('touch-action'));
MODE = 'auto';
P.arm();

print('=== a Home Grid\'s views go first ===');
var grid = { nodeType: 1, localName: 'hk-home-grid-view', _views: function () { return 3; }, matches: function () { return false; } };
var gpath = [tile, grid, page, slot];
fire('pointerdown', ev(600, 400, { composedPath: function () { return gpath; } }));
fire('pointermove', ev(540, 400, { composedPath: function () { return gpath; } }));
ok('on a grid with views the page waits: the grid turns them', !P._.state().G.live);
ok('...past its last view it may hand over (there is a page that way)', P.takes(1, grid) && !P.takes(1, {}));
dispatchEvent(new CustomEvent('hk-swipe-past', { detail: { dir: 1, dx: -60, pointerId: 3, pointerType: 'touch' } }));
fire('pointermove', ev(520, 400, { composedPath: function () { return gpath; } }));
ok('...handed over (hk-swipe-past): the page swipe goes on from there', P._.state().G.live && page.style.transform === 'translateX(-80.0px)',
   page.style.transform);
fire('pointercancel', ev(520, 400));
run();
location.pathname = '/dashboard-hall/0';
fire('pointerdown', ev(600, 400, { composedPath: function () { return gpath; } }));
ok('...back past the first view of Home there is no page: it keeps its own give', !P.takes(-1, grid));
fire('pointercancel', ev(600, 400));

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' PAGE SWIPE TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
