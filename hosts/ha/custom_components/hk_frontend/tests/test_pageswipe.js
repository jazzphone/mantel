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
var nb = X.neighbors(BAR, '/dashboard-hall/lights', here);
ok('the tab bar\'s tabs, left to right: Lights between Home and Climate', nb.at === 1 && nb.prev === BAR[0] && nb.next === BAR[2]);
ok('Home is first: nothing before it', X.neighbors(BAR, '/dashboard-hall/0', here).prev === null);
ok('the last tab: nothing after it (the swipe gives and comes back)', X.neighbors(BAR, '/dashboard-hall/security', here).next === null);
ok('a page not in the list -- a room -- has no page swipe', X.neighbors(BAR, '/dashboard-hall/room-kitchen', here).at === -1);
// (the list is the tab bar's tabs, then More's pages: hkTabBar.pages, test_tabbar.js -- 2026-11-06)
var MORE = BAR.concat([it('weather', 'Weather'), it('cameras', 'Cameras')]);
ok('...a page under More is in it, after the last tab: Security to Weather, Weather to Cameras (2026-11-06)',
   X.neighbors(MORE, '/dashboard-hall/security', here).next === MORE[4] && X.neighbors(MORE, '/dashboard-hall/weather', here).next === MORE[5]);
print('=== swipe right on Home (2026-11-06) ===');
var L = X.leftOfHome(MORE, 'cameras');
ok('the chosen page goes before Home, out of its own place', L.map(function (x) { return x.title; }).join() === 'Cameras,Home,Lights,Climate,Security,Weather');
ok('...so a swipe right on Home goes there, and one left from it comes back', X.neighbors(L, '/dashboard-hall/0', here).prev === MORE[5] &&
   X.neighbors(L, '/dashboard-hall/cameras', here).next === MORE[0]);
ok('none chosen, or a page not in the list (a room, one gone), or Home itself: the order as it was',
   X.leftOfHome(MORE, null) === MORE && X.leftOfHome(MORE, 'room-kitchen').map(function (x) { return x.title; }).join() === 'Home,Lights,Climate,Security,Weather,Cameras' &&
   X.leftOfHome(MORE, '0').map(function (x) { return x.title; }).join() === 'Home,Lights,Climate,Security,Weather,Cameras');
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
  return { nodeType: 1, localName: name, _pages: o.pages, scrollWidth: o.sw || 0, clientWidth: o.cw || 0, overflowX: o.ox || 'visible', overflowY: o.oy || 'visible', touchAction: o.ta || 'auto',
           hasAttribute: function (k) { return tags.indexOf(k) >= 0; },
           matches: function (sel) { return sel.split(',').some(function (s) { return tags.indexOf(s.trim()) >= 0; }); } };
}
window.getComputedStyle = function (n) { return { overflowX: n.overflowX, overflowY: n.overflowY, touchAction: n.touchAction }; };
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
ok('anything that takes a sideways drag itself: touch-action none, pan-y (the Music page\'s volume, a chart, the dial)',
   D.sideways([node('i'), node('div', { ta: 'none' }), view], view) && D.sideways([node('div', { ta: 'pan-y' }), view], view));
ok('...but not a row that fits (fitPan: pan-y pinch-zoom), nor auto, manipulation, pan-x', ['pan-y pinch-zoom', 'auto', 'manipulation', 'pan-x', 'pan-x pan-y'].every(function (t) {
  return !D.sideways([tile, node('div', { ta: t }), view], view); }));
ok('...nor pan-y on a list that scrolls up and down, nor a pager\'s own parts',
   !D.sideways([tile, node('div', { ta: 'pan-y', oy: 'auto' }), view], view) &&
   !D.sideways([tile, node('div', { ta: 'pan-y', attrs: ['data-pager-part'] }), view], view));
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
ok('...and past a fifth but flicked back, it goes back', !X.lands(-500, 1180, 1.2) && X.lands(-500, 1180, 0.2) && X.lands(-500, 1180, -1.2));
print('=== the spring ===');
var D = window.hkDrag;
var sp = D.spring(-500, -1180, -1.2);
ok('it starts where the page is, at the speed the page was going', Math.abs(sp.at(0) + 500) < 1e-9 && Math.abs(sp.speed(0) + 1.2) < 1e-9);
ok('it ends where it was going, and not moving', Math.abs(sp.at(sp.ms) + 1180) <= 0.41 && Math.abs(sp.speed(sp.ms)) <= 0.021);
ok('from rest too: no kick', Math.abs(D.spring(-500, -1180, 0).speed(0)) < 1e-9);
ok('...nor in the frame after the lift: a slow finger\'s page is still near its speed 16 ms on', Math.abs(D.spring(-500, -1180, -0.3).speed(16)) < 1.6);
ok('...and it gets there about when DUR.standard did', Math.abs(D.spring(-500, -1180, 0).at(340) + 1180) < 6);
function passes(s) { var d = s.x1 - s.x; for (var t = 0; t <= s.ms; t += 2) if ((s.at(t) - s.x1) * d > 0.01) return true; return false; }
ok('it never passes where it is going', !passes(sp) && !passes(D.spring(-1100, -1180, -6)) && !passes(D.spring(30, 0, -3)) && !passes(D.spring(-20, 0, 4)));
ok('a flick that would pass it goes faster instead, at the same speed', Math.abs(D.spring(-1100, -1180, -6).speed(0) + 6) < 1e-9 && D.spring(-1100, -1180, -6).w > 0.028);
ok('a finger going the other way carries it a little that way first', D.spring(30, 0, 0.5).at(20) > 30);
ok('as a curve: the spring itself where linear() is known', /^linear\(0,/.test(D.easing(sp, true)) && /,1\)$/.test(D.easing(sp, true)));
var bez = /cubic-bezier\(([\d.]+),([\d.]+),/.exec(D.easing(sp, false));
ok('...else a curve that leaves at the same speed', bez && Math.abs(+bez[2] / +bez[1] - (-1.2 * sp.ms / -680)) < 0.01);
ok('a flick back is measured from where it turned, not averaged with the way it came',
   X.speed([[0, 500], [40, 460], [60, 440], [80, 480], [100, 520]], 100) === 2);
ok('the flick is the last 100 ms, not the whole drag', Math.abs(X.speed([[0, 500], [400, 490], [450, 460], [500, 420]]) - (-0.7)) < 1e-9 &&
   X.speed([[0, 1]]) === 0);
// (2026-11-02, the owner: quick short flicks turned the page only sometimes)
ok('...the lift is no sample: a quick flick lifted where its last move was keeps its speed',
   Math.abs(X.speed([[0, 500], [16, 460], [32, 420], [48, 380], [64, 340]], 80) - (-2.5)) < 1e-9);
ok('...moves far apart (a busy tablet): measured from the move before the window, not nothing',
   Math.abs(X.speed([[0, 500], [180, 340]], 190) - (-160 / 180)) < 1e-9);
ok('...a finger that rested 60 ms before it lifted flicked nothing', X.speed([[0, 500], [16, 460], [32, 420]], 120) === 0 &&
   N.REST === 60);

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
// (what goes with the page -- the highlight, the Side Pane -- is once a frame)
var frames = [];
window.requestAnimationFrame = globalThis.requestAnimationFrame = function (fn) { frames.push(fn); return frames.length; };
function frame() { var f = frames; frames = []; f.forEach(function (fn) { fn(performance.now ? performance.now() : Date.now()); }); }
P.arm();
ok('the page says touch-action pan-y while the swipe is on here', page.style.getPropertyValue('touch-action') === 'pan-y pinch-zoom');

location.pathname = '/dashboard-hall/lights';
fire('pointerdown', ev(600, 400));
fire('pointermove', ev(594, 398));
ok('6 px: nothing moves yet', !page.style.transform && !P._.state().G.live);
fire('pointermove', ev(560, 395));
var G = P._.state().G;
ok('40 px sideways: the swipe begins, the page follows the finger from where it began (no jump by the 10 px it waited)',
   G && G.live && page.style.transform === 'translateX(-30.0px)', page.style.transform);
ok('...the next page comes in beside it (its title, as it is not held)', slot.children.length === 2 &&
   slot.children[1].className === 'hk-swipe-ghost' && slot.children[1].style.transform === 'translateX(1150.0px)',
   slot.children[1] && slot.children[1].style.transform);
frame();
ok('...the tab bar\'s highlight follows by the fraction, towards Climate',
   JSON.stringify(calls[calls.length - 1]) === JSON.stringify(['follow', +(30 / 1180).toFixed(3), '/dashboard-hall/climate']), calls);
fire('pointermove', ev(300, 410));
fire('pointerup', ev(300, 410));
ok('let go past a fifth: the highlight lands on Climate', JSON.stringify(calls[calls.length - 1]) === '["land","/dashboard-hall/climate"]');
ok('...and the page goes the rest of the way, from where it is, as a transition', /translateX\(-1180\.0px\)/.test(page.style.transform) &&
   /^transform \d+ms /.test(page.style.transition), page.style.transition);
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
ok('Home, swiping back: nothing before it -- a third of the travel', page.style.transform === 'translateX(26.7px)', page.style.transform);
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
// (2026-11-02, the owner: the Now Playing bar up on the Calendar, and every swipe refused)
window.hkPopup = { docked: function (h) { return h === '#media'; } };
ok('...a pop-up that covers the page, with a docked bar about: off', !starts(600, 400));
location.hash = '#media';
ok('...but the docked bar (Now Playing, the timers) covers nothing: on', starts(600, 400));
window.hkPopup = null;
ok('...a hash no pop-up says is docked: off', !starts(600, 400));
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
ok('...handed over (hk-swipe-past): the page swipe goes on from there', P._.state().G.live && page.style.transform === 'translateX(-70.0px)',
   page.style.transform);
fire('pointercancel', ev(520, 400));
run();
location.pathname = '/dashboard-hall/0';
fire('pointerdown', ev(600, 400, { composedPath: function () { return gpath; } }));
ok('...back past the first view of Home there is no page: it keeps its own give', !P.takes(-1, grid));
fire('pointercancel', ev(600, 400));

// ------------------------------------------------------------ the pages made ready
print('=== the pages either side are real, and ready before the finger comes ===');
function viewEl(name) {
  var v = document.createElement('hk-grid-view');
  v.__name = name;
  v.isConnected = true;
  v.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1180, height: 820 }; };
  v.setPointerCapture = function () {};
  return v;
}
var made = { lights: viewEl('lights'), climate: viewEl('climate'), '0': viewEl('home'), security: viewEl('security') };
made.home = made['0'];
var warmAsked = [], heldNow = [], shownCb = [], showN = 0;
var stub = {
  peek: function (seg) { return null; },
  warm: function (seg) { warmAsked.push(seg); return Promise.resolve(made[seg] ? { el: made[seg], path: seg } : null); },
  hold: function (el, on, stay) { var at = heldNow.indexOf(el); if (on && at < 0) heldNow.push(el); if (!on && at >= 0) heldNow.splice(at, 1); if (!on && !stay && el.parentNode) el.parentNode.removeChild(el); return true; },
  busy: function () {},
  onView: function (fn) { shownCb.push(fn); return function () { shownCb.splice(shownCb.indexOf(fn), 1); }; }
};
var onScreen = made.lights;
while (slot.firstChild) slot.removeChild(slot.firstChild);
slot.appendChild(onScreen);
window.hkShell.view = function () { return onScreen; };
window.hkShell.navigate = function (p) { navTo.push(p); location.pathname = p; onScreen = made[p.split('/')[2]] || onScreen; showN++; shownCb.slice().forEach(function (f) { f(onScreen, {}, {}, { path: p.split('/')[2] }); }); };
window.hkViewHost = { live: function () { return stub; } };
location.pathname = '/dashboard-hall/lights';
navTo = []; calls = [];
function path(v) { return { composedPath: function () { return [tile, v, slot]; } }; }
function drainPromises() { if (typeof drainMicrotasks === 'function') drainMicrotasks(); }
// each page's own look (hkSettings.lookAt): the Climate page Blur, the rest Bright Glass
var LOOKS = { climate: 'blur' }, segOf = function (p) { return String(p).split('/')[2] || ''; };
window.hkSettings.lookAt = function (p) {
  var mine = LOOKS[segOf(p)] || 'bright', shown = LOOKS[segOf(location.pathname)] || 'bright';
  return p && mine !== shown ? { glass: mine, vars: { '--hk-glass-plate': mine } } : null;
};
var txOf = function (el) { var m = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform || ''); return m ? +m[1] : NaN; };
P.plan();
drainPromises();
ok('it asks the host for the pages on either side, without a finger', warmAsked.join() === 'climate,0', warmAsked);
// (at rest past the window's edge, not a width away: beside a page narrower than the window -- the Side Pane -- a width
// away was on the screen, 2026-11-05)
ok('...and each waits in the slot, inert, out of sight past the window\'s edge', made.climate.parentNode === slot && made.home.parentNode === slot && made.climate.hasAttribute('inert') &&
   txOf(made.climate) >= 1180 + 48 && txOf(made.home) <= -(1180 + 48) && made.climate.style.position === 'fixed', made.climate.style.transform);
ok('...each wearing its own look where it differs from the page shown', made.climate.style.getPropertyValue('--hk-glass-plate') === 'blur' &&
   !made.home.style.getPropertyValue('--hk-glass-plate'));
ok('beside a page narrower than the window, still past its edge', P._.park({ dir: 1, left: 0, off: 820, width: 1180 }) + 820 >= 1180 + 48 &&
   P._.park({ dir: -1, left: 0, off: -1180, width: 1180 }) <= 0 && P._.park({ dir: 1, left: 0, off: 2000, width: 1180 }) === 0);
ok('...held by the host', heldNow.indexOf(made.climate) >= 0 && heldNow.indexOf(made.home) >= 0);
fire('pointerdown', ev(600, 400, path(made.lights)));
ok('a press alone costs nothing: no layers (a tap is most presses)', !made.lights.style.getPropertyValue('will-change') && !made.climate.style.getPropertyValue('will-change'));
fire('pointermove', ev(595, 400, path(made.lights)));
ok('a finger starting sideways gives what may move a layer of its own, and moves nothing', made.lights.style.getPropertyValue('will-change') === 'transform' && made.climate.style.getPropertyValue('will-change') === 'transform' && !made.lights.style.transform);
fire('pointerup', ev(595, 400, path(made.lights)));
ok('...a press that stops there gives it back', !made.lights.style.getPropertyValue('will-change') && !made.climate.style.getPropertyValue('will-change') && !P._.state().G);
fire('pointerdown', ev(600, 400, path(made.lights)));
fire('pointermove', ev(500, 400, path(made.lights)));
ok('a swipe moves the real page, no stand-in', made.climate.style.transform === 'translateX(1090.0px)' && slot.children.every(function (c) { return c.className !== 'hk-swipe-ghost'; }), made.climate.style.transform);
fire('pointermove', ev(250, 400, path(made.lights)));
fire('pointerup', ev(250, 400, path(made.lights)));
var aNow = P._.state().A;
ok('let go: a settle is under way, and it alone moves the page', aNow && !P._.state().G && /^transform \d+ms/.test(made.lights.style.transition));
ok('...the page beside it on the same curve', made.climate.style.transition === made.lights.style.transition && made.climate.style.transform === 'translateX(0.0px)');
// a finger on the moving page
window.__drawn = null;
fire('pointerdown', ev(700, 400, path(made.lights)));
var cg = P._.state().G;
ok('a finger on it mid-settle catches it: the settle is over, the finger has it', !P._.state().A && cg && cg.live && cg.caught);
ok('...nothing is left running', made.lights.style.transition === 'none' && made.climate.style.transition === 'none');
var before = navTo.length;
run();
ok('...and what that settle had queued does nothing now', navTo.length === before && !P._.state().L && P._.state().G === cg);
fire('pointerup', ev(700, 400, path(made.lights)));
ok('let go where it was caught: on to where it was going', P._.state().A && P._.state().A.to.path === '/dashboard-hall/climate');
var a2 = P._.state().A;
run();
drainPromises();
ok('it lands: the host is told once, on the page beside it', navTo.join() === '/dashboard-hall/climate', navTo);
ok('...which stays where it is in the slot, its own again', made.climate.parentNode === slot && !made.climate.hasAttribute('inert') && !made.climate.style.transform && !made.climate.style.position);
ok('...and the page it left is its neighbor now, not gone', made.lights.parentNode === slot && made.lights.hasAttribute('inert') && txOf(made.lights) <= -(1180 + 48) &&
   heldNow.indexOf(made.lights) >= 0, made.lights.style.transform);
ok('...the page it landed on wears the root\'s look, the one it left its own', !made.climate.style.getPropertyValue('--hk-glass-plate') &&
   made.lights.style.getPropertyValue('--hk-glass-plate') === 'bright', [made.climate.style.getPropertyValue('--hk-glass-plate'), made.lights.style.getPropertyValue('--hk-glass-plate')]);
ok('...the swipe is over', !P._.state().A && !P._.state().G && !P._.state().L);
run();
drainPromises();
P.plan();
drainPromises();
delete window.hkSettings.lookAt;
ok('...the page two away is let go, the next made ready', made.home.parentNode !== slot && heldNow.indexOf(made.home) < 0 && made.security.parentNode === slot, [made.home.parentNode === slot, warmAsked.join()]);
// a tab tap to the page beside it
navTo = [];
window.hkShell.navigate('/dashboard-hall/security');
ok('shown some other way, a page waiting beside it is simply the page', !made.security.hasAttribute('inert') && !made.security.style.transform && !made.security.style.position);
ok('...the others go', made.lights.parentNode !== slot || !made.lights.style.position);
// a page not ready (the host still making it): a finger on the settle heading there, well on its way, lets it land
stub.warm = function () { return new Promise(function () {}); };
var homeEl = made['0'];
window.hkShell.navigate('/dashboard-hall/0');
onScreen = homeEl;
if (homeEl.parentNode !== slot) slot.appendChild(homeEl);
run(); drainPromises();
P.plan(); drainPromises();
navTo = [];
window.hkShell.navigate = function (p) { navTo.push(p); location.pathname = p; };
fire('pointerdown', ev(700, 400, path(homeEl)));
fire('pointermove', ev(600, 400, path(homeEl)));
fire('pointermove', ev(90, 400, path(homeEl)));
fire('pointerup', ev(80, 400, path(homeEl)));
var toGhost = P._.state().A;
ok('a swipe to a page not made ready yet goes to its stand-in', toGhost && toGhost.N && !toGhost.N.real, toGhost && toGhost.N);
// (it is already more than half the way)
fire('pointerdown', ev(700, 400, path(homeEl)));
ok('...a finger then, well on its way: it lands, and is built, rather than starting over', !P._.state().A && P._.state().L && navTo.join() === '/dashboard-hall/lights' && P._.state().why === 'landing',
   [navTo, P._.state().why]);
fire('pointerup', ev(700, 400, path(homeEl)));
window.hkViewHost = null;
window.hkShell.navigate = function (p) { navTo.push(p); location.pathname = p; };
window.hkShell.view = function () { return page; };
run();

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' PAGE SWIPE TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
