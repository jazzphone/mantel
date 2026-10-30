// The tab bar (modules/hk-tabbar.js): how many tabs fit a width and what
// goes in More, the state it moves through while the page scrolls, and its
// material. Nothing here names a real house.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
var root = HK_ROOT;
load(root + '/tests/dom.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}

var SETTINGS = {};
window.hkSettings = { get: function (path, fb) {
  var v = SETTINGS, p = String(path).split('.');
  for (var i = 0; i < p.length; i++) { if (v == null) break; v = v[p[i]]; }
  return v == null ? fb : v;
} };
location.pathname = '/dashboard-hall/0';
document.querySelector = function () { return null; };
window.innerWidth = 402;

load(root + '/frontend/cards/hk-base.js');
load(root + '/frontend/modules/hk-menu.js');
var threw = null;
try { load(root + '/frontend/modules/hk-tabbar.js'); } catch (e) { threw = e; }
ok('loads beside the menu without a page to draw on', !threw && !!window.hkTabBar, String(threw));
var T = window.hkTabBar._, fit = T.fit, parts = T.parts, step = T.scrollStep;

print('=== the fit ===');
// a generated phone screen: Home and eight categories, three pages at the top
var f = fit(9, 3, 402, true);
ok('a 402 px iPhone with a Rooms button: Home, two categories and More',
   f.shown === 3 && f.more === true, JSON.stringify(f));
ok('...the pill fills what is left beside the Rooms button', f.width === 402 - 2 * T.SIZES.GUTTER - (T.barH(402) + T.SIZES.GAP), String(f.width));
ok('without the Rooms button there is room for one more tab', fit(9, 3, 402, false).shown === 4);
ok('a 320 px phone still gets Home, one more and More', fit(9, 3, 320, true).shown === 2);
// Tabs in Bar on Phones (2026-10-27): pages besides Home and More, 3 unless chosen, 4 at most
ok('a phone choosing two pages: Home, two and More', fit(9, 3, 402, false, false, 6, 'medium', true, 2).shown === 3);
ok('...four: Home, four and More (six in all, the most a 402 px iPhone holds)', fit(9, 3, 402, false, false, 6, 'medium', true, 4).shown === 5);
ok('...four on a 390 px iPhone too (tabs 2 px narrower)', fit(9, 3, 390, false, false, 6, 'medium', true, 4).shown === 5);
ok('...but three on it keep the usual width', fit(9, 3, 390, false, false, 6, 'medium', true, 3).shown === 4);
ok('...never more than four, whatever is asked', fit(9, 3, 402, false, false, 8, 'medium', true, 8).shown === 5);
ok('...and a narrow phone still shows only what fits', fit(9, 3, 320, false, false, 6, 'medium', true, 4).shown < 5);
ok('an iPad upright (820): seven tabs and More -- never more than eight in all',
   fit(9, 3, 820, true).shown === 7 && fit(9, 3, 820, true).more);
ok('a wall tablet (1280): the same eight', fit(9, 3, 1280, true).shown === 7);
var few = fit(3, 0, 1280, true);
ok('everything fits and nothing is at the top: no More', few.shown === 3 && few.more === false, JSON.stringify(few));
var g72 = 72 / 15;
ok('...and the pill is only as wide as its tabs (96 px each, a tablet\'s 4.8 px apart, plus its padding)',
   few.width === Math.round(3 * 96 + 2 * g72 + 2 * g72), String(few.width));
ok('the pages at the top always bring More, even with room to spare', fit(3, 1, 1280, true).more === true);
var fm = fit(9, 3, 402, false, true);
ok('the rooms In More: a 402 px phone has Home, three categories and More -- five, as Apple Music has',
   fm.shown === 4 && fm.more === true && fm.plate === true, JSON.stringify(fm));
ok('...an iPad held upright is not a phone: up to eight', fit(9, 3, 820, false, true).shown === 7);
ok('...and the rooms alone bring More, even when every page fits', fit(3, 0, 1280, false, true).more === true &&
   fit(3, 0, 1280, false, false).more === false);
var rm = T.roomsMode;
ok('the Rooms setting: In More by default; a boolean from the first form read as In More / Off',
   rm(undefined) === 'more' && rm(true) === 'more' && rm(false) === 'off' && rm('off') === 'off' && rm('button') === 'button');
ok('tabs too narrow for the highlight\'s capsule (a 300 px phone with a Rooms button) are tinted instead',
   fit(9, 3, 300, true).plate === false && fit(9, 3, 1280, true).plate === true);
ok('a screen with only Home: one tab', fit(1, 0, 402, true).shown === 1 && !fit(1, 0, 402, true).more);

var MODEL = {
  home: { title: 'Home', path: '/d/0', kind: 'home', paths: ['0'] },
  top: [{ title: 'Weather', path: '/d/weather', kind: 'top', paths: ['weather'] }],
  categories: ['Lights', 'Climate', 'Security', 'Music', 'Timers'].map(function (t) {
    return { title: t, path: '/d/' + t.toLowerCase(), kind: 'category', paths: [t.toLowerCase()] };
  }),
  rooms: [{ title: 'Den', path: '/d/den', kind: 'room', paths: ['den'] }]
};
var titles = function (xs) { return xs.map(function (x) { return x.title; }).join(','); };
var p = parts(MODEL, fit(6, 1, 402, true));
ok('the tabs: Home, then the categories in the menu\'s order', titles(p.tabs) === 'Home,Lights,Climate', titles(p.tabs));
ok('More: the pages at the top first, then the categories that did not fit',
   titles(p.more) === 'Weather,Security,Music,Timers', titles(p.more));
ok('the rooms are the menu\'s rooms', titles(p.rooms) === 'Den');
ok('no More: nothing listed in it', parts(MODEL, { shown: 6, more: false }).more.length === 0);

print('=== position ===');
ok('a phone keeps a rail\'s bar at the bottom; a tablet has the rail', T.position('left', 390) === 'bottom' &&
   T.position('right', 1280) === 'right' && T.position('top', 390) === 'top' && T.position('sideways', 1280) === 'bottom');
ok('a phone held sideways has the rail it asks for (wide enough beside it), upright the bottom',
   T.position('left', 844, true) === 'left' && T.position('right', 667, true) === 'right' && T.position('left', 390, true) === 'bottom');
var rf = T.railFit(9, 3, 800, true);
ok('an 800 px tablet\'s rail holds Home, six more and More -- eight, as the bottom bar', rf.shown === 7 && rf.more, JSON.stringify(rf));
ok('...a short window fewer', T.railFit(9, 3, 500, true).shown === 5);

print('=== tabs in bar / rail ===');
ok('Tabs in Bar counts pages: 6 -- a tablet shows Home, six pages and More', fit(9, 3, 1280, false, true, 6).shown === 7 &&
   fit(9, 3, 1280, false, true, 6).more);
ok('...8 pages: ten tabs', fit(12, 3, 1280, false, true, 8).shown === 9);
ok('...a phone never more than 3 pages, a lower setting still counts', fit(9, 3, 402, false, true, 8).shown === 4 &&
   fit(9, 3, 402, false, true, 2).shown === 3);
ok('...unset is 6 pages', fit(9, 3, 1280, true).shown === 7);
var r6 = T.railFit(9, 3, 800, true, 6);
// the rail's gaps at a 72 px rail: its ends 12, its tabs 7.2 apart (10 and 6 at 60)
ok('Tabs in Rail 6: Home, six pages and More, the rail hugging them (8 x 66 + 7 x 7.2 + 24 = 602 px)',
   r6.shown === 7 && r6.more && Math.round(r6.height) === 602, JSON.stringify(r6));
ok('...8 pages fit an 800 px tablet\'s rail (10 tabs, 749 px)', Math.round(T.railFit(12, 3, 800, true, 8).height) === 749);
ok('...a short window holds fewer than asked', T.railFit(9, 3, 500, true, 8).shown === 5);

ok('the bar is 60 px on a phone, 72 on a tablet -- the rail\'s width too', T.barH(390) === 60 && T.barH(1280) === 72 &&
   T.railFit(9, 3, 800, true).width === 72);
print('=== Tab Bar Size ===');
ok('Small, Medium, Large: a phone 52 / 60 / 68, a tablet 64 / 72 / 80',
   [T.barH(390, 'small'), T.barH(390, 'medium'), T.barH(390, 'large'), T.barH(390)].join() === '52,60,68,60' &&
   [T.barH(1280, 'small'), T.barH(1280, 'medium'), T.barH(1280, 'large'), T.barH(1280, 'huge')].join() === '64,72,80,72');
ok('...the rail as thick as the tablet\'s bar at every size',
   ['small', 'medium', 'large'].every(function (z) { return T.railFit(9, 3, 800, true, 6, z).width === T.barH(1280, z); }));
var rs = T.railFit(9, 3, 800, true, 6, 'small'), rm = T.railFit(9, 3, 800, true, 6), rl = T.railFit(9, 3, 800, true, 6, 'large');
ok('...its tabs 58 / 66 / 74 tall and its gaps with them: the rail hugs them, the same pages at each size',
   rs.shown === rm.shown && rl.shown === rm.shown && Math.round(rs.height) === 530 && Math.round(rm.height) === 602 && Math.round(rl.height) === 675,
   [rs.height, rm.height, rl.height].join());
// THE GAPS GROW WITH THE BAR (2026-10-09): thickness / 15 -- a phone's
// Medium bar keeps Apple Music's 4 px; every other size in proportion
var G = T.gapsOf;
ok('a 60 px phone bar keeps today\'s gaps: 4 from the edge, 4 between tabs, the highlight 5 into them; a rail 10 and 6',
   G(60).pad === 4 && G(60).tab === 4 && G(60).widen === 5 && G(60).railPad === 10 && G(60).railGap === 6);
ok('...a tablet\'s 72 px bar 4.8, its 64 and 80 px 4.3 and 5.3; a phone\'s 52 and 68 px 3.5 and 4.5',
   Math.abs(G(72).pad - 4.8) < 1e-9 && Math.abs(G(64).pad - 4.267) < 1e-3 && Math.abs(G(80).pad - 5.333) < 1e-3 &&
   Math.abs(G(52).pad - 3.467) < 1e-3 && Math.abs(G(68).pad - 4.533) < 1e-3);
ok('...every gap in the same proportion to the bar, at every size', [52, 60, 64, 68, 72, 80].every(function (t) {
  var g = G(t); return Math.abs(g.pad / t - 4 / 60) < 1e-9 && Math.abs(g.railGap / g.pad - 1.5) < 1e-9 && Math.abs(g.widen / g.tab - 1.25) < 1e-9; }));
ok('...a short window: Large fits fewer down the rail, Small more',
   T.railFit(12, 3, 600, true, 8, 'large').shown < T.railFit(12, 3, 600, true, 8).shown &&
   T.railFit(12, 3, 600, true, 8, 'small').shown > T.railFit(12, 3, 600, true, 8).shown);
ok('a phone keeps Home, three pages and More at every size',
   ['small', 'medium', 'large'].every(function (z) { return fit(9, 3, 402, false, true, 6, z).shown === 4; }));
ok('...the Rooms button as thick as the bar', fit(9, 3, 402, true, true, 6, 'large').width ===
   402 - 2 * T.SIZES.GUTTER - (T.barH(402, 'large') + T.SIZES.GAP));
var bs = fit(9, 3, 1280, false, true, 6, 'small'), bm = fit(9, 3, 1280, false, true, 6), bl = fit(9, 3, 1280, false, true, 6, 'large');
ok('a tablet\'s bar: the same 6 pages, its tabs narrower or wider with the size',
   bs.shown === 7 && bm.shown === 7 && bl.shown === 7 && bs.width < bm.width && bm.width < bl.width, [bs.width, bm.width, bl.width].join());

print('=== scrolling ===');
function run(setting, moves, max) {
  var st = { mode: 'full' }, y = 0;
  moves.forEach(function (dy) { y += dy; st = step(st, dy, y, max === undefined ? 4000 : max, setting); });
  return st.mode;
}
ok('shrink: scrolling down folds it into the small button', run('shrink', [10, 10, 10]) === 'small');
ok('...a nudge (under 28 px) does not', run('shrink', [10, 10]) === 'full');
ok('...any scroll up of 12 px brings it back, anywhere on the page', run('shrink', [200, 300, -6, -6]) === 'full');
ok('...6 px up is not yet a scroll up', run('shrink', [200, 300, -6]) === 'small');
ok('...a reversal starts the count again', run('shrink', [200, -8, 8, -8]) === 'small');
ok('hide: scrolling down slides it away', run('hide', [40]) === 'gone');
ok('...and up brings it back', run('hide', [400, -20]) === 'full');
ok('stay: never moves', run('stay', [400, 400, 400]) === 'full');
ok('the end of the page brings it back', run('shrink', [3000, 996], 4000) === 'full');
ok('the top of the page (an iPhone\'s rubber band past it) brings it back', run('shrink', [300, -296]) === 'full' &&
   step({ mode: 'small' }, -10, -30, 4000, 'shrink').mode === 'full');
ok('a page too short to scroll never folds it', run('shrink', [20, 20], 40) === 'full');

function runRest(moves, start) {
  var st = { mode: start || 'small' }, y = 0;
  moves.forEach(function (dy) { y += dy; st = step(st, dy, y, 4000, 'shrink', 'small'); });
  return st.mode;
}
ok('Start Small: scrolling up, or reaching the top, does not open it', runRest([300, -290]) === 'small' && runRest([-10]) === 'small');
ok('...opened by a tap, scrolling down folds it again', runRest([200, 20, 20], 'full') === 'small');
ok('...and the end of the page leaves it as it is', runRest([3996], 'small') === 'small');

var rr = T.room;
ok('Adjust Content: a rail that shrinks or hides eases the page aside; the top slides it; the bottom and Stay keep room',
   rr('left', 'shrink', true) === 'scale' && rr('right', 'hide', true) === 'scale' && rr('top', 'shrink', true) === 'shift' &&
   rr('bottom', 'hide', true) === 'pad' && rr('right', 'stay', true) === 'pad' && rr('top', 'stay', true) === 'pad');
ok('...off, a rail floats over the page', ['left', 'right'].every(function (p) {
   return rr(p, 'shrink', false) === 'none' && rr(p, 'stay', false) === 'none'; }));
ok('...but a bar along the bottom or the top still leaves room at the page\'s end, so the last row scrolls clear of it',
   ['top', 'bottom'].every(function (p) { return rr(p, 'shrink', false) === 'pad' && rr(p, 'hide', false) === 'pad' && rr(p, 'stay', false) === 'pad'; }));

var so = T.scrollOf;
ok('While Scrolling on Phones: Phones\' own under 640 px (Shrink unless chosen), never the tablets\'',
   so({ tab_bar_scroll: 'shrink', tab_bar_scroll_phone: 'hide' }, 390) === 'hide' &&
   so({ tab_bar_scroll: 'shrink', tab_bar_scroll_phone: 'hide' }, 1280) === 'shrink' &&
   so({ tab_bar_scroll: 'stay' }, 390) === 'shrink' && so({}, 390) === 'shrink');

print('=== the material ===');
var mat = T.material;
ok('the screen\'s look: frosted stays frosted', mat('house', 'frosted') === 'frosted');
ok('...and Tinted stays Tinted: no blur on a bar that is always up', mat('house', 'tinted') === 'tinted');
ok('...every other look is one blur (the chips blur themselves on Clear)',
   mat('house', 'clear') === 'blur' && mat('house', 'blur_each') === 'blur' && mat('house', null) === 'blur');
ok('its own choice wins', mat('tinted', 'blur') === 'tinted' && mat('frosted', 'blur') === 'frosted' &&
   mat('blur', 'frosted') === 'blur');
ok('...Tinted as the server stores it (`tinted`), and by its old name (`clear`)',
   mat('tinted', 'blur_pre') === 'tinted' && mat('clear', 'frosted') === 'tinted');

print('=== where it shows: the menu\'s other form (hkCards.menu.tabBar) ===');
var C = window.hkCards, M = C.menu;
function at(w, board) {
  window.innerWidth = w;
  SETTINGS.boards = { 'dashboard-hall': board };
  return { bar: M.tabBar(), menu: M.on(), docked: M.docked(), style: M.style() };
}
var t = at(1440, { menu: 'tabbar' });
ok('Menu: Tab Bar -- the bar at every width, and no side menu', t.bar && !t.menu && t.style === null &&
   at(402, { menu: 'tabbar' }).bar, JSON.stringify(t));
t = at(1440, { menu: 'open', menu_phone: 'tabbar' });
ok('Always Open with the tab bar on Phones: the menu docked on a computer, no bar', !t.bar && t.docked && t.style === 'docked',
   JSON.stringify(t));
t = at(900, { menu: 'open', menu_phone: 'tabbar' });
ok('...folded (under Keep Open Down To): Phones\' menu, the bar, and no side menu at all', t.bar && !t.menu && !t.docked && t.style === null,
   JSON.stringify(t));
t = at(1280, { menu: 'auto', menu_phone: 'tabbar' });
ok('A button with the tab bar on Phones: the button from 1,024 px', !t.bar && t.menu, JSON.stringify(t));
t = at(820, { menu: 'auto', menu_phone: 'tabbar' });
ok('...under 1,024 px (no room for the edge tab): Phones\' bar instead of the button', t.bar && !t.menu && t.style === null, JSON.stringify(t));
ok('no swipe and no clock tap where the bar is', (function () {
  at(820, { menu: 'auto', menu_phone: 'tabbar', swipe: true, clock: true });
  return !M.swipe() && !M.clock();
})());
ok('Off on both: neither', (function () { var x = at(402, { menu: 'off', menu_phone: 'off' }); return !x.bar && !x.menu; })());
ok('a button on Phones: never the bar', !at(402, { menu: 'auto', menu_phone: 'button' }).bar);
SETTINGS.boards = { 'dashboard-other': { menu: 'tabbar' } };
ok('a dashboard with no item of its own: no tab bar', M.tabBar() === false);


print('=== by device: Phones have their own menu (2026-10-08) ===');
function dev(w, scr, board) {
  window.innerWidth = w;
  window.screen = scr ? { width: scr[0], height: scr[1] } : undefined;
  SETTINGS.boards = { 'dashboard-hall': board };
  return { phone: M.phone(), bar: M.tabBar(), menu: M.on(), docked: M.docked(), style: M.style(), tab: M.tab() };
}
ok('a phone: a window under 640 px', dev(402, null, { menu: 'open' }).phone && !dev(820, null, { menu: 'open' }).phone);
ok('...or a phone held sideways (its screen 390 x 844, the window 844 wide)', dev(844, [390, 844], { menu: 'open' }).phone);
ok('...but an iPad mini, a 1024 x 600 tablet and a wall tablet are tablets either way up',
   !dev(1133, [744, 1133], {}).phone && !dev(1024, [1024, 600], {}).phone && !dev(800, [800, 1280], {}).phone &&
   !dev(1280, [1280, 800], {}).phone);
ok('...and a short desktop window is not a phone (its screen is the desktop\'s)', !dev(1440, [1728, 1117], {}).phone);
var t2 = dev(1440, [1728, 1117], { menu: 'open', menu_phone: 'tabbar' });
ok('Always Open on tablets, the tab bar on phones: docked on a computer', t2.docked && !t2.bar, JSON.stringify(t2));
t2 = dev(402, [402, 874], { menu: 'open', menu_phone: 'tabbar' });
ok('...the bar on a phone, no side menu', t2.bar && !t2.menu && t2.style === null, JSON.stringify(t2));
t2 = dev(820, [820, 1180], { menu: 'open', menu_phone: 'tabbar' });
ok('...and an upright iPad, where Always Open doesn\'t fit, shows Phones\' bar (not a phone: a tablet\'s fit)',
   t2.bar && !t2.menu && !t2.phone && M.phoneForm() && M.compact(), JSON.stringify(t2));
t2 = dev(1180, [1180, 820], { menu: 'open', menu_phone: 'tabbar' });
ok('...held sideways, with room: the menu docked again', t2.docked && !t2.bar && !M.phoneForm(), JSON.stringify(t2));
t2 = dev(874, [402, 874], { menu: 'open', menu_phone: 'tabbar' });
ok('...a phone held sideways keeps the phone\'s bar', t2.bar && !t2.menu, JSON.stringify(t2));
t2 = dev(402, [402, 874], { menu: 'tabbar', menu_phone: 'button', button_phone: 'tab' });
ok('Tab Bar on tablets, a button on phones: the edge tab on a phone', !t2.bar && t2.menu && t2.style === 'tab' && t2.tab === 'always',
   JSON.stringify(t2));
ok('...and the bar on a tablet', dev(1280, [1280, 800], { menu: 'tabbar', menu_phone: 'button' }).bar);
t2 = dev(402, [402, 874], { menu: 'auto', menu_phone: 'off' });
ok('Off on phones only: nothing on a phone, the button on a tablet', !t2.bar && !t2.menu &&
   dev(1280, [1280, 800], { menu: 'auto', menu_phone: 'off' }).menu, JSON.stringify(t2));
t2 = dev(402, [402, 874], { menu: 'off', menu_phone: 'button' });
ok('...and a menu on phones only', t2.menu && !dev(1280, [1280, 800], { menu: 'off', menu_phone: 'button' }).menu);
ok('Phones\' button style is its own; the tab bar is no button style',
   dev(402, null, { menu: 'auto', button_phone: 'chip_scroll' }).tab === 'scrolled' &&
   dev(402, null, { menu: 'auto', button_phone: 'tab' }).style === 'tab' &&
   dev(402, null, { menu: 'open', menu_phone: 'button', button_phone: 'tabbar' }).style === 'chip');
ok('No Button on phones needs the swipe', dev(402, null, { menu: 'auto', menu_phone: 'button', button_phone: 'none' }).style === 'chip' &&
   dev(402, null, { menu: 'auto', menu_phone: 'button', button_phone: 'none', swipe: true }).style === 'none');

// WHERE THE TABLETS' MENU DOESN'T FIT IT IS PHONES', on every kind; with
// room it never is -- whatever Phones has
var KINDS = ['off', 'auto', 'chip', 'chip_scroll', 'chip_home', 'tab', 'none', 'open', 'tabbar'];
var PHONES = [['off', 'chip'], ['button', 'tab'], ['button', 'chip_scroll'], ['tabbar', 'chip']];
var bad = [];
KINDS.forEach(function (m) { PHONES.forEach(function (ph) {
  var b = { menu: m, menu_phone: ph[0], button_phone: ph[1], swipe: true };
  var phone = dev(402, [402, 874], b), wide = dev(1440, [1728, 1117], b), wall = dev(1280, [1280, 800], b);
  var upright = dev(820, [820, 1180], b);
  var pbar = ph[0] === 'tabbar', pon = ph[0] === 'button';
  if (phone.bar !== pbar || phone.menu !== pon) bad.push('phone ' + JSON.stringify(b));
  var tabletBar = m === 'tabbar', tabletOn = m !== 'off' && m !== 'tabbar';
  [wide, wall].forEach(function (x) { if (x.bar !== tabletBar || x.menu !== tabletOn) bad.push('room ' + JSON.stringify(b)); });
  // an upright iPad: an always-open menu (Keep Open Down To 1,000) and a button
  // (under 1,024) don't fit -- Phones' menu, Off meaning the chip
  var fits = m === 'off' || m === 'tabbar';
  var ubar = fits ? tabletBar : pbar, uon = fits ? tabletOn : !pbar;
  if (upright.bar !== ubar || upright.menu !== uon) bad.push('upright ' + JSON.stringify(b) + ' ' + JSON.stringify(upright));
}); });
ok('every kind x Phones: a phone shows Phones\', a tablet with room its own, an upright iPad Phones\' where its own doesn\'t fit',
   !bad.length, bad.slice(0, 3).join(' | '));

print('=== by device: More and the scroll ===');
window.screen = { width: 402, height: 874 }; window.innerWidth = 874;
ok('More\'s rooms: Phones\' own (also held sideways; In More unless chosen), never the tablets\'',
   T.roomsOf({ tab_bar_rooms: 'more', tab_bar_rooms_phone: 'off' }) === 'off' &&
   T.roomsOf({ tab_bar_rooms: 'button' }) === 'more' &&
   T.roomsOf({ tab_bar_rooms: 'more', tab_bar_rooms_phone: 'button' }, 1280) === 'more');
ok('More\'s style: a phone\'s own (List unless chosen), the tablets\' otherwise',
   T.moreOf({ tab_bar_more: 'icons' }) === 'list' && T.moreOf({ tab_bar_more_phone: 'icons' }) === 'icons' &&
   T.moreOf({ tab_bar_more: 'list' }, 1280) === 'list' && T.moreOf({}, 1280) === 'icons');
ok('While Scrolling: a sideways phone uses the phone\'s', so({ tab_bar_scroll: 'shrink', tab_bar_scroll_phone: 'stay' }) === 'stay');
window.screen = undefined;

// A RAIL IS DRAWN AT THE THICKNESS ITS FIT IS WORKED OUT FROM (2026-10-25): a
// phone held sideways drew it at a phone's 60 while railFit counted a
// tablet's 72, so its tabs fell short of it, 43 px of rail above Home and below More
var tbSrc = readFile(HK_ROOT + '/frontend/modules/hk-tabbar.js');
ok('a rail\'s --bh is railW, a bar\'s barH (a rail in the side strip its own width)',
   /setProperty\('--bh', \(S\.strip \? S\.strip\.width : railed \? railW\(size\) : barH\(undefined, size\)\) \+ 'px'\)/.test(tbSrc) &&
   /railFit[\s\S]{0,200}gapsOf\(railW\(size\)\)/.test(tbSrc));

// THE SIDE STRIP (2026-10-30, the iPhone Duo): a side safe area of 60 px or
// more on one side only; the rail stands on the strip's foot and never
// reaches into the reserve above it, where the system's items are
print('=== the side strip ===');
var SS = T.SIZES, side = T.stripSide, sfit = T.stripFit;
ok('a strip: 60 px or more on one side only -- the Duo\'s 84 at its right', side(0, 84) === 'right' && side(84, 0) === 'left' &&
   side(0, 60) === 'right' && side(0, 59) === null && side(0, 0) === null);
ok('...a phone turned (its Dynamic Island\'s 59-62 px at both sides) has none', side(62, 62) === null && side(59, 59) === null &&
   side(47, 62) === null);
ok('...nonsense reads as none', side('x', undefined) === null && side(-90, NaN) === null);
// the Duo folded: its outer display, 466 x 678 pt, the strip 84 at its right
var OUTER = { inset: 84, width: 466, height: 678, bottom: 0 };
var so = sfit(6, 1, OUTER, true, 5);
ok('the Duo folded: Home, three pages and More -- the five a phone\'s bar shows', so && so.shown === 4 && so.more, JSON.stringify(so));
ok('...a rail 72 wide, 6 in from each side of the strip, its tabs 60 tall', so.width === 72 && so.x === 6 && so.tab === 60);
ok('...standing on the strip\'s foot (16 px over it)', so.foot === SS.STRIP_FOOT && Math.abs(so.top + so.height + so.foot - 678) < 1e-9);
ok('...and never into the top 45 % of a strip held upright, where its system items are',
   so.top >= 678 * SS.STRIP_RESERVE.portrait && so.reserve === Math.ceil(678 * 0.45), so.top + ' / ' + so.reserve);
// the Duo open, held sideways: the inner display, about 1000 x 703, the strip 84 at its right
var INNER = { inset: 84, width: 1000, height: 703, bottom: 20 };
var si = sfit(9, 3, INNER, true, 8);
ok('the Duo open sideways: more fit (the top 35 % kept), not all eight -- the rest in More',
   si && si.shown === 5 && si.more && si.top >= 703 * SS.STRIP_RESERVE.landscape, JSON.stringify(si));
ok('...never more than the bar would show', sfit(9, 3, INNER, true, 4).shown === 3 && sfit(2, 0, INNER, false, 8).shown === 2 &&
   !sfit(2, 0, INNER, false, 8).more);
ok('...a strip held upright keeps more of its top than one held sideways',
   sfit(9, 3, { inset: 84, width: 703, height: 1000 }, true, 8).top > 1000 * 0.45 &&
   sfit(9, 3, { inset: 84, width: 1000, height: 703 }, true, 8).top < 703 * 0.45);
ok('what doesn\'t fit goes to More: a shorter strip, fewer tabs', sfit(9, 3, { inset: 84, width: 466, height: 520 }, true, 8).shown <
   sfit(9, 3, OUTER, true, 8).shown);
ok('...too short for Home and More: no rail (the bar where it was)', sfit(9, 3, { inset: 84, width: 466, height: 200 }, true, 8) === null);
ok('...a screen with only Home needs one tab', !!sfit(1, 0, { inset: 84, width: 466, height: 240 }, false, 8) &&
   sfit(1, 0, { inset: 84, width: 466, height: 240 }, false, 8).shown === 1);
ok('too narrow a strip for a rail: none', sfit(9, 3, { inset: 50, width: 466, height: 678 }, true, 8) === null);
ok('a wider strip: the rail no wider than Tab Bar Size\'s', sfit(9, 3, { inset: 120, width: 466, height: 678 }, true, 5).width === T.railW() &&
   sfit(9, 3, { inset: 120, width: 466, height: 678 }, true, 5, 'small').width === T.railW('small'));
ok('the home indicator\'s safe area lifts it (less 12, as the bar\'s lift)', sfit(6, 1, { inset: 84, width: 466, height: 678, bottom: 34 }, true, 5).foot === 22);
ok('...and the docked now-playing bar: it stands 10 px over it', sfit(6, 1, { inset: 84, width: 466, height: 678, dock: 96 }, true, 5).foot === 106);
var tall = sfit(12, 3, { inset: 84, width: 466, height: 900, bottom: 34 }, true, 10);
ok('every fit keeps the reserve, every size', ['small', 'medium', 'large'].every(function (z) {
  return [OUTER, INNER, { inset: 84, width: 466, height: 900, bottom: 34 }].every(function (st) {
    var f = sfit(12, 3, st, true, 10, z);
    return !f || f.top >= Math.ceil(st.height * (st.width > st.height ? 0.35 : 0.45)) - 1e-9;
  });
}) && tall.shown >= 4);
ok('the strip in the page\'s own code: Use the Side Strip off, no strip', /tab_bar_strip === false\) return null/.test(tbSrc) &&
   /stripSide\(sa\.left, sa\.right\)/.test(tbSrc));

// SWIPE BETWEEN PAGES (2026-10-30, hk-pageswipe.js): the order is the bar's
// tabs as it shows them, and the highlight is drawn between two tabs by the
// swipe's fraction, along a bar or down a rail, then lands on the spring
print('=== swipe between pages: the follow and the order ===');
var bw = T.between, ofs = T.offsetsOf;
var homeTab = { x: 4, y: 3, w: 96, h: 54, pos: 'bottom' }, lightsTab = { x: 104, y: 3, w: 80, h: 54, pos: 'bottom' };
var half = bw(homeTab, lightsTab, 0.5);
ok('halfway: the box halfway along, its width between the two', half.x === 54 && half.w === 88 && half.h === 54 && half.pos === 'bottom',
   JSON.stringify(half));
ok('...none of the way is the tab itself; all of it the next; past either end held',
   JSON.stringify(bw(homeTab, lightsTab, 0)) === JSON.stringify(homeTab) && bw(homeTab, lightsTab, 1).x === 104 &&
   bw(homeTab, lightsTab, 1.6).x === 104 && bw(homeTab, lightsTab, -1).x === 4);
var o1 = ofs(half, homeTab);
ok('the offsets slide() reads, from the tab the highlight is drawn on', o1.hx === 50 && o1.hy === 0 && Math.abs(o1.sx - 88 / 96) < 1e-9 && o1.sy === 1,
   JSON.stringify(o1));
var railA = { x: 5, y: 40, w: 62, h: 60, pos: 'left' }, railB = { x: 5, y: 110, w: 62, h: 60, pos: 'left' };
var rq = bw(railA, railB, 0.25);
ok('down a rail (the side strip\'s too): it moves down, not along', rq.x === 5 && rq.y === 57.5 && ofs(rq, railA).hy === 17.5 &&
   ofs(rq, railA).hx === 0);
ok('the page swipe reads the bar\'s own tabs, in order -- More is not a page -- and the menu\'s Home and Categories with no bar',
   /function swipePages\(\) \{\s*if \(S\.on\) return \{ bar: true, items: S\.tabs\.slice\(\) \};/.test(tbSrc) &&
   /\[m\.home\]\.concat\(m\.categories\)/.test(tbSrc) && /window\.hkTabBar\.pages = swipePages/.test(tbSrc));
ok('follow() is not drawn folded, too tight, or with Reduce Motion (it jumps as it lands)',
   /function follow\(k, path\) \{\s*if \(!S\.on \|\| S\.mode !== 'full' \|\| S\.tight \|\| calm\(\)\) return false;/.test(tbSrc));
ok('...it holds the highlight where it is, so the landing starts there', /S\.hereBox = box;/.test(tbSrc) && /classList\.add\('slide-from'\)/.test(tbSrc));
ok('land(): the page it lands on before the address is, on the spring at .42 s', /var path = S\.landing \|\| location\.pathname/.test(tbSrc) &&
   /:host\(\[data-landing\]\) \.tab\.here::before\{transition-duration:\.42s\}/.test(tbSrc) && /S\.landing = null;/.test(tbSrc));

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' TAB BAR TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
