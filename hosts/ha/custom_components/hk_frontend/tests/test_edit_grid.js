// EDIT MODE ON A HOME GRID (modules/hk-edit-grid.js, 2026-10-31): a Home
// Grid screen's Home arranged on the dashboard, as the generated pages are.
//   the rules     a new size where it is, else the nearest place with
//                 nothing moved, else none (and why); a block removed; a
//                 block added in the first space of the view shown, the
//                 editor's variant, never past 24; Done's one board/set
//                 {home_grid}, nothing when it is as it was
//   placing       a card with no free space for it, placed by hand: the others make
//                 room when they can, else the blocks it covers are removed (dimmed
//                 and named in the bar while it is held), one change for Cancel
//   the cards     the band, then the strategy's own card per block, then
//                 the cards that only listen; a block's element kept while
//                 its card is the same
//   the surface   Edit offered on a Home Grid's Home (and only by the
//                 surfaces that say `grid`), the sheet's line for it
//   a session     on the real hk-home-grid-view: the covers, a block moved
//                 by the arrow keys (the blocks it lands on make room),
//                 removed, resized, Done's change with the screen's version,
//                 Cancel puts the view's own config and elements back
// The Home Grid editor's rules are its own (hk-grid-editor.js, test_gridroom
// and test_grideditor). A fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run edit_grid');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
(function () {
  var E0 = Object.getPrototypeOf(document.createElement('div'));
  if (!E0.insertBefore) {
    E0.insertBefore = function (c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; return c;
    };
    if (!('childNodes' in E0)) Object.defineProperty(E0, 'childNodes', { get: function () { return this.children; } });
    if (!('lastChild' in E0)) Object.defineProperty(E0, 'lastChild', { get: function () { return this.children[this.children.length - 1] || null; } });
  }
  if (!('firstChild' in E0)) Object.defineProperty(E0, 'firstChild', { get: function () { return this.children[0] || null; } });
  if (!E0.removeEventListener) E0.removeEventListener = function (t, f) { this._listeners[t] = (this._listeners[t] || []).filter(function (x) { return x !== f; }); };
  if (!E0.focus) E0.focus = function () {};
  if (!E0.getBoundingClientRect) E0.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
})();
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
location.pathname = '/dashboard-den/home';
globalThis.history = { pushState: function (s, t, p) { location.pathname = p; }, replaceState: function (s, t, p) { location.pathname = p; } };
window.innerHeight = 820;
window.scrollY = 0;

var LAYOUT = { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: false, items: [
  { id: 'clock', card: 'clock', size: 'L', at: [0, 0] },
  { id: 'weather', card: 'weather', size: 'W', at: [2, 0] },
  { id: 'cam', card: 'camera', size: 'L', at: [4, 0] },
  { id: 'np', card: 'now_playing', size: 'W', at: [2, 1] },
  { id: 'lock', card: 'action', size: 'S', at: [0, 2], opts: { action: 'lock_up' } },
  { id: 'timers', card: 'timers', size: 'S', at: [1, 2] },
  { id: 'thermo', card: 'thermostat', size: 'T', at: [2, 2] }] };
var BOARD = { home_style: 'grid', home_grid: JSON.parse(JSON.stringify(LAYOUT)) };
var FEED = { accessories: { entities: {}, rooms: {} }, generated: {}, boards: { 'dashboard-den': BOARD } };
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return null; },
  onChange: function () {}
};
document.querySelector = function () { return null; };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-grid-editor.js');
load(HK_ROOT + '/frontend/modules/hk-edit.js');
load(HK_ROOT + '/frontend/modules/hk-edit-grid.js');

var ok = H.ok, eq = H.eq, E = window.hkEdit, EG = window.hkEditGrid, X = window.hkGridEditor, R = EG._;
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function at(g, id) { var it = g && g.items.filter(function (x) { return x.id === id; })[0]; return it ? it.at.join(',') + ' ' + it.size : null; }

// the house as the strategy hands the view it, and the screen's view
var CTX = { cameras: ['camera.porch'], climate: ['climate.den'], rooms: ['den'], weather: 'weather.home' };
var LISTEN = { type: 'custom:hk-popup-card', popup: 'doorbell' };
function viewCfg(layout) {
  var v = window.hkStrategy.homeGridView(layout, { title: 'Home', path: 'home' }, null, [LISTEN], CTX, 'auto');
  return v;
}
var CFG0 = viewCfg(LAYOUT);
window.hkCards.menu.config = function () { return { views: [CFG0, { title: 'Lights', path: 'lights', cards: [] }] }; };
var MADE = [];
window.hkCards.createCard = function (cfg) { var el = document.createElement('x-card'); el._config = cfg; MADE.push(el); return el; };
var View = customElements.get('hk-home-grid-view');
var VIEW = null;
window.hkShell.use({ atTablet: function () { return false; }, view: function () { return VIEW; }, dialogRoot: function () { return null; } });

function who(admin) {
  var sent = [], reads = [];
  return { user: { id: 'u1', name: 'Fictional Person', is_admin: admin }, states: {}, areas: {}, entities: {}, devices: {}, floors: {},
           themes: { themes: {} }, sent: sent, reads: reads,
           callWS: function (m) { return new Promise(function (res, rej) { reads.push({ msg: m, res: res, rej: rej }); }); },
           actions: { callWS: function (m) { return new Promise(function (res, rej) { sent.push({ msg: m, res: res, rej: rej }); }); } } };
}
globalThis.getComputedStyle = function () { return { paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px' }; };
function drawn() {
  var v = new View();
  v.setConfig(CFG0);
  v.isConnected = true; v.clientWidth = 1180; v.clientHeight = 820;
  v.cards = CFG0.cards.map(function (c) { var el = document.createElement('x-card'); el._config = c; return el; });
  return v;
}
function cells(v) { return v._root.childNodes.filter(function (k) { return k.className.split(' ').indexOf('cell') >= 0; }); }
function cellOf(v, id) { return cells(v).filter(function (k) { return k.attrs['data-id'] === id; })[0]; }
function coverOf(v, id) { var c = cellOf(v, id); return c && c.children.filter(function (k) { return k.className === 'hk-ge'; })[0]; }
function btnOf(v, id, act) { var cv = coverOf(v, id); return cv && cv.children.filter(function (k) { return k.attrs && k.attrs['data-ge-act'] === act; })[0]; }
function ev(o) {
  var e = Object.assign({ button: 0, pointerId: 1, pointerType: 'mouse', stopped: 0, prevented: 0 }, o);
  e.stopPropagation = function () { e.stopped++; };
  e.preventDefault = function () { e.prevented++; };
  e.composedPath = function () { return o.path || []; };
  return e;
}
function fire(el, type, e) { e.type = type; (el._listeners[type] || []).slice().forEach(function (f) { f(e); }); return e; }

H.run('EDIT GRID', [
function () {
  H.section('a new size: where it is, else the nearest place, else none');
  var g = copy(LAYOUT);
  eq('the layout is valid', X.valid(g), true);
  eq('the same size: the layout as it is', R.resized(X, g, 'lock', 'S'), g);
  eq('Timers Wide: the cell beside it is free? no (the thermostat): the nearest place', at(R.resized(X, g, 'timers', 'W'), 'timers'), '0,3 W');
  eq('...and nothing else moved', JSON.stringify(R.resized(X, g, 'timers', 'W').items.filter(function (it) { return it.id !== 'timers'; })),
     JSON.stringify(g.items.filter(function (it) { return it.id !== 'timers'; })));
  eq('the clock Extra Large: no room with nothing moved', R.resized(X, g, 'clock', 'XL') === null, false);
  var full = copy(g);
  full.items.push({ id: 'f1', card: 'clock', size: 'L', at: [3, 2] }, { id: 'f2', card: 'clock', size: 'W', at: [0, 3] },
                  { id: 'f3', card: 'clock', size: 'S', at: [5, 2] }, { id: 'f4', card: 'clock', size: 'S', at: [5, 3] });
  eq('a full grid is valid', X.valid(full), true);
  eq('...a block made larger where there is no room: none', R.resized(X, full, 'lock', 'W'), null);
  var sz = R.sizesOf(X, full, 'clock').map(function (o) { return o.size + ':' + (o.on ? 'on' : o.ok ? 'ok' : o.why); }).join(' ');
  eq('its sizes, each with whether it fits now (and why not)', sz, 'S:ok W:ok T:ok L:on XL:No room XXL:No room');
  var two = copy(g); two.cols = 2; two.rows = 5; two.items = [{ id: 'c', card: 'clock', size: 'S', at: [0, 0] }];
  eq('...only the sizes the grid holds (a 2-column grid: no Extra Large)', R.sizesOf(X, two, 'c').map(function (o) { return o.size; }), ['S', 'W', 'T', 'L']);
  var acc = copy(g); acc.items.push({ id: 'acc', card: 'accessories', size: 'XL', at: [3, 2], pages: { source: 'list', list: [{ opts: { accessories: [1, 2, 3, 4, 5].map(function (n) { return { entity: 'light.l' + n }; }) } }] } });
  ok('a size its pages can\'t take says why (the editor\'s words)', /holds 4 accessories/.test(R.sizesOf(X, acc, 'acc').filter(function (o) { return o.size === 'L'; })[0].why));
},
function () {
  H.section('removed, added, and what Done sends');
  var g = copy(LAYOUT);
  eq('removed: the block is gone, the rest as they were', R.removed(g, 'np').items.map(function (it) { return it.id; }), ['clock', 'weather', 'cam', 'lock', 'timers', 'thermo']);
  var a = R.added(X, g, 'scenes', 'W', 0);
  eq('added: in the first space that fits, a new id', a.items[a.items.length - 1], { id: 'b1', card: 'scenes', size: 'W', at: [3, 2] });
  var r = R.added(X, g, 'room', 'L', 0);
  eq('...a room\'s accessories scroll, as the editor adds it', r.items[r.items.length - 1].opts, { accessory_display: 'scroll' });
  eq('...an accessory group\'s pages are automatic', R.added(X, g, 'accessories', 'W', 0).items.slice(-1)[0].pages, { source: 'accessories' });
  var vw = copy(g); vw.views = 2;
  var a2 = R.added(X, vw, 'clock', 'L', 1);
  eq('...in the view shown', [a2.items.slice(-1)[0].view, a2.items.slice(-1)[0].at], [1, [0, 0]]);
  eq('...none where there is no room', R.added(X, g, 'cameras', 'XXL', 0), null);
  var many = copy(g); many.rows = 6; many.items = [];
  for (var i = 0; i < 24; i++) many.items.push({ id: 'c' + i, card: 'clock', size: 'S', at: [i % 6, Math.floor(i / 6)] });
  eq('...none past 24 blocks', R.added(X, many, 'clock', 'S', 0), null);
  ok('Add never offers the two cards that are nothing until a thing is chosen', R.NEEDS_A_CHOICE.join() === 'accessory,scene');
  eq('Done: nothing when the layout is as it was', R.savesOf(LAYOUT, copy(LAYOUT), 'dashboard-den'), []);
  var s = R.savesOf(LAYOUT, R.removed(g, 'np'), 'dashboard-den');
  eq('...else one board/set of the whole layout, as the editor\'s Save, with the screen\'s document',
     [s.length, s[0].doc, s[0].msg.type, s[0].msg.dashboard, Object.keys(s[0].msg.changes)], [1, 'board/dashboard-den', 'hk_frontend/board/set', 'dashboard-den', ['home_grid']]);
  eq('...the layout itself', s[0].msg.changes.home_grid.items.length, 6);
},
function () {
  H.section('the view\'s cards for a layout');
  var band = { type: 'custom:hk-header-card', hk_band: true };
  var cfg = Object.assign({}, CFG0, { cards: [band].concat(CFG0.cards) });
  var out = R.cardsFor(cfg, R.removed(copy(LAYOUT), 'np'), 'auto');
  eq('the band first, a card per block, then the cards that only listen', out.map(function (c) { return c.hk_band ? 'band' : c.hk_cell ? c.hk_cell.id : c.type; }),
     ['band', 'clock', 'weather', 'cam', 'lock', 'timers', 'thermo', 'custom:hk-popup-card']);
  eq('...each block\'s card the strategy\'s own', JSON.stringify(out[3]), JSON.stringify(CFG0.cards[2]));
  eq('a move changes only the cell: the same card', R.keyOf(Object.assign({}, CFG0.cards[0], { hk_cell: { id: 'clock', at: [1, 1] } })), R.keyOf(CFG0.cards[0]));
  var big = R.cardsFor(CFG0, R.resized(X, copy(LAYOUT), 'thermo', 'L'), 'auto').filter(function (c) { return c.hk_cell && c.hk_cell.id === 'thermo'; })[0];
  eq('a size the card draws by its cell alone (the thermostat Large): the same card', R.keyOf(big), R.keyOf(CFG0.cards[6]));
  var tall = R.cardsFor(CFG0, R.resized(X, copy(LAYOUT), 'np', 'S'), 'auto').filter(function (c) { return c.hk_cell && c.hk_cell.id === 'np'; })[0];
  ok('a size that changes the card (Now Playing Small: no progress): another card', R.keyOf(tall) !== R.keyOf(CFG0.cards[3]));
},
function () {
  H.section('the surface: a Home Grid\'s Home is offered Edit');
  ok('registered, for a Home Grid', E.surfaces().indexOf('home-grid') >= 0);
  eq('a Home Grid\'s Home: editable', E.editable(CFG0), true);
  eq('an Owner on it: offered', E.offer(who(true)), true);
  eq('...not an Adult', E.offer(who(false)), false);
  eq('the sheet\'s line says what Edit does here', E.hint(), R.HINT);
  location.pathname = '/dashboard-den/lights';
  eq('...another page keeps the tiles\' line', E.hint(), 'Drag the tiles on this page into place, and make them Tall or Regular.');
  location.pathname = '/dashboard-den/home';
  var src = read(HK_ROOT + '/frontend/modules/hk-loader.js');
  ok('hk-loader.js loads it, after hk-edit.js', /'hk-edit\.js'[\s\S]*'hk-edit-grid\.js'/.test(src));
  ok('the detail sheet\'s Edit This Page says the surface\'s line', /hkEdit\.hint/.test(read(HK_ROOT + '/frontend/cards/hk-detail.js')));
  var mine = read(HK_ROOT + '/frontend/modules/hk-edit-grid.js');
  ok('its imports go through the build\'s version', /global\.hkV \? global\.hkV\(url\) : url/.test(mine));
  ok('...and it never names a host', !/mantel/i.test(mine) && !/\bhass\b/.test(mine));
},
function () {
  H.section('a session on the real view');
  VIEW = drawn();
  var h = who(true), els0 = VIEW._cards.slice(), cfg0 = VIEW._config;
  eq('enter', E.enter(h, { viewEl: VIEW }), true);
  var s = E.active(), part = EG.active();
  ok('a session with the grid\'s part', !!s && !!part && s.parts.indexOf(part) >= 0);
  h.reads[0].res({ versions: { 'board/dashboard-den': 'v7' } });
  eq('the grid is in the editing state', VIEW._root.className.split(' ').indexOf('hk-ge-on') >= 0, true);
  ok('...its look in the view\'s shadow root', VIEW._sr.children.some(function (c) { return /hk-ge-wiggle/.test(c.textContent || ''); }));
  eq('every block has its cover', cells(VIEW).map(function (c) { return !!coverOf(VIEW, c.attrs['data-id']); }), [true, true, true, true, true, true, true]);
  ok('...a minus on each', !!btnOf(VIEW, 'clock', 'remove') && btnOf(VIEW, 'clock', 'remove').attrs['aria-label'] === 'Remove Clock');
  ok('...a size where the card has more than one', !!btnOf(VIEW, 'clock', 'size') && !btnOf(VIEW, 'timers', 'size') === false);
  eq('...an action has Small and Wide, so it has one too (2026-11-07)', !!btnOf(VIEW, 'lock', 'size'), true);
  eq('nothing to save yet', s.saves(), []);
  eq('the bar has Add', s.parts.some(function (p) { return (p.buttons || []).some(function (b) { return b.label === 'Add'; }); }), true);

  // the arrow keys: the clock a cell right -- onto the weather and the music, which make room
  var cover = coverOf(VIEW, 'clock');
  var k = fire(VIEW._root, 'keydown', ev({ key: 'ArrowRight', path: [cover, cellOf(VIEW, 'clock'), VIEW._root] }));
  ok('an arrow key is Edit mode\'s', k.stopped > 0 && k.prevented > 0);
  eq('the clock moved a cell', at(part.grid, 'clock'), '1,0 L');
  eq('...the blocks it landed on made room, as the Home Grid editor makes it (each to the nearest free place)', [at(part.grid, 'weather'), at(part.grid, 'np')], ['3,2 W', '0,3 W']);
  eq('...the layout still valid', X.valid(part.grid), true);
  eq('...the view shows it: the clock\'s cell', cellOf(VIEW, 'clock').style.gridColumn, '2 / span 2');
  eq('...its element kept (only its cell changed)', cellOf(VIEW, 'clock').firstChild, els0[0]);
  eq('...nothing made', MADE.length, 0);

  // a click on a block's card is eaten; the minus removes it
  var c = fire(VIEW._root, 'click', ev({ path: [cellOf(VIEW, 'timers').firstChild, cellOf(VIEW, 'timers'), VIEW._root] }));
  ok('a tap on a block never reaches its card', c.stopped > 0 && c.prevented > 0);
  fire(VIEW._root, 'click', ev({ path: [btnOf(VIEW, 'timers', 'remove'), coverOf(VIEW, 'timers'), cellOf(VIEW, 'timers'), VIEW._root] }));
  eq('the minus: Timers removed', at(part.grid, 'timers'), null);
  eq('...from the view', !!cellOf(VIEW, 'timers'), false);
  eq('...the bar says so', E._.barMessage(), 'Timers removed. Cancel puts it back.');

  // a size: Now Playing Small -- another card (no progress card), made once
  var next = R.resized(X, part.grid, 'np', 'S');
  ok('Now Playing can be Small', !!next);
  part.commit(next);
  eq('...the view shows a new element for it', MADE.length, 1);
  eq('...in its cell', cellOf(VIEW, 'np').firstChild, MADE[0]);
  eq('...its size badge says so', cellOf(VIEW, 'np').attrs.size, 'S');
  part.commit(R.resized(X, part.grid, 'np', 'W'));
  eq('...and back to Wide: its own element again, nothing more made', [cellOf(VIEW, 'np').firstChild === els0[3], MADE.length], [true, 1]);

  // Escape while a sheet is open is the sheet's (not Cancel)
  part.sheet = { host: null };
  (globalThis.__winL.keydown || []).forEach(function (f) { f(ev({ key: 'Escape' })); });
  ok('Escape closed the sheet and Edit mode is still on', !part.sheet && E.active() === s);

  // Done: one board/set with the screen's version
  var p = E.done();
  return H.tick(4).then(function () {
    eq('Done sends the layout', h.sent.length, 1);
    var m = h.sent[0].msg;
    eq('...board/set {home_grid} with the version read at Edit', [m.type, m.dashboard, m.expect_version, Object.keys(m.changes)],
       ['hk_frontend/board/set', 'dashboard-den', 'v7', ['home_grid']]);
    eq('...the layout as arranged', [at(m.changes.home_grid, 'clock'), at(m.changes.home_grid, 'timers')], ['1,0 L', null]);
    eq('...Now Playing Wide again', at(m.changes.home_grid, 'np').split(' ')[1], 'W');
    eq('...valid as the editor checks it', X.valid(m.changes.home_grid), true);
    h.sent[0].res({ version: 'v8' });
    return p;
  }).then(function (r) {
    eq('saved', r, 'saved');
    eq('Edit mode is over', E.active(), null);
    eq('the covers are gone', cells(VIEW).some(function (c) { return !!coverOf(VIEW, c.attrs['data-id']); }), false);
    eq('...and the editing state', VIEW._root.className.split(' ').indexOf('hk-ge-on') >= 0, false);
    eq('the page stays as arranged until the screen is built again', cellOf(VIEW, 'clock').style.gridColumn, '2 / span 2');
    void cfg0;
  });
},
function () {
  H.section('Cancel puts the view back as it was drawn');
  VIEW = drawn();
  var h = who(true), els0 = VIEW._cards.slice(), cfg0 = VIEW._config;
  eq('enter', E.enter(h, { viewEl: VIEW }), true);
  var part = EG.active();
  part.remove('cam');
  part.commit(R.added(X, part.grid, 'clock', 'S', 0));
  ok('two changes shown', !cellOf(VIEW, 'cam') && cells(VIEW).length === 7);
  ok('...dirty', E.active().dirty());
  E.cancel();
  eq('Edit mode is over', E.active(), null);
  eq('the view\'s own config again', VIEW._config, cfg0);
  eq('...its own elements', VIEW._cards.every(function (el, i) { return el === els0[i]; }), true);
  eq('...the camera back in its cell', cellOf(VIEW, 'cam').style.gridColumn, '5 / span 2');
  eq('...nothing sent', h.sent.length, 0);
},
function () {
  H.section('a card with no free space is placed by hand, replacing the blocks it covers');
  var full = copy(LAYOUT);
  full.items.push({ id: 'f1', card: 'clock', size: 'L', at: [3, 2] }, { id: 'f2', card: 'clock', size: 'W', at: [0, 3] },
                  { id: 'f3', card: 'clock', size: 'S', at: [5, 2] }, { id: 'f4', card: 'clock', size: 'S', at: [5, 3] });
  BOARD.home_grid = full;
  var cfgF = viewCfg(full);
  var v = new View();
  v.setConfig(cfgF);
  v.isConnected = true; v.clientWidth = 1180; v.clientHeight = 820;
  v.cards = cfgF.cards.map(function (c) { var el = document.createElement('x-card'); el._config = c; return el; });
  // (the cells' box on the screen: the stub page has no layout)
  v.cellBox = function () { return { left: 0, top: 0, width: 1180, height: 800, gap: 10, scale: 1, cols: 6, rows: 4, view: 0 }; };
  VIEW = v;
  var h = who(true);
  eq('enter', E.enter(h, { viewEl: v }), true);
  var part = EG.active(), els0 = v._cards.slice();
  eq('the grid is full: Add has no free space for a Large Camera', R.added(X, part.grid, 'camera', 'L', 0), null);
  eq('placing starts, and the bar says what to do', [part.placeStart('camera', 'L', 0), /^Drag the new Large Camera over the grid/.test(E._.barMessage())], [true, true]);
  eq('...the outline is made, not shown yet', [v._root.childNodes.filter(function (k) { return k.className.indexOf('hk-ge-target') >= 0; }).length, part.placing.target.style.display], [1, 'none']);
  eq('...the badges are out of the way, as while a block is carried', v._root.className.split(' ').indexOf('hk-ge-carrying') >= 0, true);
  // a mouse over the grid, no button down: the outline follows it; Action, Timers and a Wide Clock lie under a Large card at column 1, row 3
  (globalThis.__winL.pointermove || []).forEach(function (f) { f(ev({ clientX: 100, clientY: 600 })); });
  eq('held over them: the outline is at their cells and red', [part.placing.at, part.placing.target.classList.contains('replace'), part.placing.target.style.display], [[0, 2], true, '']);
  eq('...those blocks are dimmed', cells(v).filter(function (c) { return c.className.indexOf('hk-ge-going') >= 0; }).map(function (c) { return c.attrs['data-id']; }).sort(), ['f2', 'lock', 'timers']);
  eq('...the bar names them, and says Cancel brings them back', E._.barMessage(), 'The Large Camera replaces Action, Timers and Clock here. Cancel puts them back.');
  eq('...nothing is changed yet', [at(part.grid, 'lock'), part.grid.items.length, part.dirty()], ['0,2 S', 11, false]);
  (globalThis.__winL.pointermove || []).forEach(function (f) { f(ev({ clientX: 1000, clientY: 100 })); });
  eq('moved over blocks that are free (the camera\'s own cells: Large over a Large): its own blocks go there', part.placing.plan.removed.map(function (it) { return it.id; }), ['cam']);
  (globalThis.__winL.pointermove || []).forEach(function (f) { f(ev({ clientX: 1000, clientY: 790 })); });
  eq('...off the bottom of the grid\'s box, the outline lands on its last row', part.placing.at, [4, 2]);
  (globalThis.__winL.pointermove || []).forEach(function (f) { f(ev({ clientX: 500, clientY: 1400 })); });
  eq('...off the grid: no outline, nothing dimmed, the first line again', [part.placing.at, part.placing.target.style.display,
     cells(v).filter(function (c) { return c.className.indexOf('hk-ge-going') >= 0; }).length, /^Drag the new/.test(E._.barMessage())], [null, 'none', 0, true]);
  // Escape gives up: nothing changed, every block as it was
  part.placeAt(100, 600);
  eq('Escape while held: Edit mode is still on, the card not placed', [part.escape(), part.placing, part.grid.items.length, cells(v).length, E.active() !== null, E._.barMessage()], [true, null, 11, 11, true, 'Cancelled.']);
  eq('...no block dimmed, the outline gone, the badges back', [cells(v).filter(function (c) { return c.className.indexOf('hk-ge-going') >= 0; }).length,
     v._root.childNodes.filter(function (k) { return k.className.indexOf('hk-ge-target') >= 0; }).length, v._root.className.split(' ').indexOf('hk-ge-carrying') >= 0], [0, 0, false]);
  // a finger: down on the grid, over the blocks, up there -- the card drops
  part.placeStart('camera', 'L', 0);
  fire(v._root, 'pointerdown', ev({ clientX: 100, clientY: 600, pointerType: 'touch' }));
  eq('a finger down on the grid aims at once', part.placing.at, [0, 2]);
  var up = ev({ clientX: 100, clientY: 600, pointerType: 'touch' });
  (globalThis.__winL.pointerup || []).forEach(function (f) { f(up); });
  eq('...lifted there: Action, Timers and Clock are replaced by the Camera, Large, at those cells', [part.placing, at(part.grid, 'lock'), at(part.grid, 'timers'), at(part.grid, 'f2'), at(part.grid, 'b1')],
     [null, null, null, null, '0,2 L']);
  eq('...the rest as they were, and the layout valid', [at(part.grid, 'clock'), at(part.grid, 'thermo'), at(part.grid, 'f1'), X.valid(part.grid), part.grid.items.length], ['0,0 L', '2,2 T', '3,2 L', true, 9]);
  eq('...the page shows it: the three cells gone, the new one made', [!!cellOf(v, 'lock'), !!cellOf(v, 'timers'), !!cellOf(v, 'f2'), !!cellOf(v, 'b1')], [false, false, false, true]);
  eq('...the others\' elements are kept', cellOf(v, 'clock').firstChild, els0[0]);
  eq('...nothing dimmed, the bar says what went', [cells(v).filter(function (c) { return c.className.indexOf('hk-ge-going') >= 0; }).length,
     E._.barMessage()], [0, 'Action, Timers and Clock were replaced by Camera. Cancel puts them back.']);
  eq('...one change: dirty, and Cancel puts the page back as it was', [E.active().dirty(), (E.cancel(), E.active()), v._config === cfgF, !!cellOf(v, 'lock'), !!cellOf(v, 'b1')], [true, null, true, true, false]);

  // the arrow keys and Enter, and a finger lifted off the grid
  VIEW = v;
  eq('enter again', E.enter(who(true), { viewEl: v }), true);
  part = EG.active();
  part.placeStart('cameras', 'XXL', 0);
  var key = function (k) { return fire(v._root, 'keydown', ev({ key: k, path: [] })); };
  (globalThis.__winL.keydown || []).forEach(function (f) { f(ev({ key: 'ArrowDown', path: [] })); });
  eq('an arrow key, first: the outline in the middle of the grid (a Full Width card spans every column)', part.placing.at, [0, 1]);
  eq('...a Full Width card there covers the two rows it takes: the Weather, the Music, the Camera and more go', part.placing.plan.removed.length >= 4, true);
  (globalThis.__winL.keydown || []).forEach(function (f) { f(ev({ key: 'ArrowUp', path: [] })); });
  eq('...Up, and it is at the top', part.placing.at, [0, 0]);
  eq('...a button\'s own Enter is not the drop', ((globalThis.__winL.keydown || []).forEach(function (f) { f(ev({ key: 'Enter', path: [{ localName: 'button' }] })); }), !!part.placing), true);
  fire(v._root, 'pointerdown', ev({ clientX: 500, clientY: 1400, pointerType: 'touch' }));
  var off = ev({ clientX: 500, clientY: 1400, pointerType: 'touch' });
  (globalThis.__winL.pointerup || []).forEach(function (f) { f(off); });
  eq('a finger lifted off the grid gives up: nothing placed, everything as it was', [part.placing, part.grid.items.length, E._.barMessage()], [null, 11, 'Cancelled.']);
  part.placeStart('cameras', 'XXL', 0);
  (globalThis.__winL.keydown || []).forEach(function (f) { f(ev({ key: 'ArrowDown', path: [] })); });
  (globalThis.__winL.keydown || []).forEach(function (f) { f(ev({ key: 'Enter', path: [] })); });
  eq('Enter drops it where the outline is: the Full Width card replaces what it covers', [part.placing, part.grid.items.slice(-1)[0].card, part.grid.items.slice(-1)[0].size, X.valid(part.grid)], [null, 'cameras', 'XXL', true]);
  E.cancel();
  BOARD.home_grid = copy(LAYOUT);
  key = null;
},
function () {
  H.section('placed over blocks that can move: they make room and none is removed');
  VIEW = drawn();
  VIEW.cellBox = function () { return { left: 0, top: 0, width: 1180, height: 800, gap: 10, scale: 1, cols: 6, rows: 4, view: 0 }; };
  eq('enter', E.enter(who(true), { viewEl: VIEW }), true);
  var part = EG.active();
  part.placeStart('camera', 'L', 0);
  part.placeAt(100, 600);
  eq('a Large card onto two small tiles, with free cells elsewhere: nothing to remove', [part.placing.plan.removed.length, part.placing.plan.moved.sort(), part.placing.target.classList.contains('replace')], [0, ['lock', 'timers'], false]);
  eq('...the bar says the others make room', E._.barMessage(), 'The Large Camera goes here; the others make room.');
  eq('...no block dimmed', cells(VIEW).filter(function (c) { return c.className.indexOf('hk-ge-going') >= 0; }).length, 0);
  eq('...those two slid aside in the view (their cells, not the draft)', [cellOf(VIEW, 'lock').style.gridColumn !== '1 / span 1', at(part.grid, 'lock')], [true, '0,2 S']);
  part.placeAt(500, 1400);
  eq('...off the grid: they are back', [cellOf(VIEW, 'lock').style.gridColumn, cellOf(VIEW, 'lock').style.gridRow], ['1 / span 1', '3 / span 1']);
  part.placeAt(100, 600);
  part.placeDrop();
  eq('dropped: the Camera is there, the two tiles moved, none lost', [at(part.grid, 'b1'), part.grid.items.length, X.valid(part.grid), at(part.grid, 'lock') !== '0,2 S'], ['0,2 L', 8, true, true]);
  eq('...the bar says it was added', E._.barMessage(), 'Camera added.');
  E.cancel();
},
function () {
  H.section('a view that is not what the settings say: no Edit');
  VIEW = drawn();
  BOARD.home_grid = R.removed(copy(LAYOUT), 'np');
  eq('the settings changed under the page: Edit does not begin', E.enter(who(true), { viewEl: VIEW }), false);
  BOARD.home_grid = copy(LAYOUT);
  eq('...as it was: it does', E.enter(who(true), { viewEl: VIEW }), true);
  E.cancel();
}
]);
