// HOME GRID, slice G1 (docs/phase11/HOME-GRID.md): the catalog
// (hk-grid-catalog.js), the view type hk-home-grid-view (hk-layout.js) and the
// strategy's Home Grid view (hk-strategy.js). The geometry in a real browser
// -- no page scroll, each card inside its cell -- is checked against Mantel.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run homegrid');
load(HK_ROOT + '/tests/dom.js');
(function () {
  var E = Object.getPrototypeOf(document.createElement('div'));
  if (!E.insertBefore) {
    E.insertBefore = function (c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; return c;
    };
    Object.defineProperty(E, 'childNodes', { get: function () { return this.children; } });
    Object.defineProperty(E, 'lastChild', { get: function () { return this.children[this.children.length - 1] || null; } });
  }
  if (!('firstChild' in E)) Object.defineProperty(E, 'firstChild', { get: function () { return this.children[0] || null; } });
})();
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
// the views' swipe asks the one list of what keeps its own (hk-drag.js sideways)
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

// ---- the catalog
var G = window.hkGridCatalog;
ok('the catalog is loaded', !!G && typeof G.config === 'function');
ok('the size classes are hk-base.js\'s', JSON.stringify(G.SIZES) === JSON.stringify(window.hkCards.HOME_GRID.sizes));
var ctx = { cameras: ['camera.front_door', 'camera.yard'], climate: ['climate.hallway'], rooms: ['kitchen'], weather: 'weather.home' };
var cam = G.config({ card: 'camera', size: 'L' }, ctx);
ok('a camera block defaults to the first camera and keeps its own list', cam.type === 'custom:hk-camera-mosaic-card' && cam.own_cameras === true && cam.cameras.length === 1 && cam.cameras[0].entity === 'camera.front_door');
var th = G.config({ card: 'thermostat', size: 'T' }, ctx);
ok('a thermostat block: the house\'s first thermostat, its dial', th.type === 'custom:hk-control-card' && th.entity === 'climate.hallway');
var thp = G.config({ card: 'thermostat', size: 'T', pages: { source: 'thermostats', start: 'tablet_room' } }, ctx);
ok('a block with pages is a pager of its card (G4)', thp.type === 'custom:hk-pager-card' && thp.item.card === 'thermostat' && thp.ctx === ctx);
var np = G.config({ card: 'now_playing', size: 'L', opts: { speaker: 'tablet_room' } }, ctx);
ok('the tablet\'s room is not an entity (resolved by G3/G4)', np.type === 'custom:hk-now-playing-card' && !np.entity);
var sc = G.config({ card: 'scenes', size: 'W', pages: { source: 'list', list: [{ opts: { scenes: ['scene.dinner'] } }, { opts: { scenes: ['scene.good_night'] } }] } }, ctx);
ok('a block with list pages is a pager too', sc.type === 'custom:hk-pager-card' && G.pages(sc.item, ctx)[0].card.scenes[0] === 'scene.dinner');
ok('a key the catalog lacks is a stand-in, not an error', G.config({ card: 'toaster', size: 'S' }, ctx).type === 'custom:hk-key-card');
ok('...and so is a block with nothing in the house to show', G.config({ card: 'thermostat', size: 'T' }, {}).type === 'custom:hk-key-card');

// ---- the view
var View = customElements.get('hk-home-grid-view');
ok('hk-home-grid-view is registered', !!View);
function kid(n) { var k = document.createElement('card-' + n); return k; }
var ready = [];
window.addEventListener('hk-view-ready', function (e) { ready.push(e.detail.view); });
(function () {
  var v = new View();
  var band = kid('band'), a = kid('a'), b = kid('b'), c = kid('c'), pop = kid('pop'), off = kid('off');
  v.setConfig({ grid: { cols: 6, rows: 4, band: true }, cards: [
    { hk_band: true },
    { hk_cell: { id: 'a1', size: 'L', at: [0, 0] } },
    { hk_cell: { id: 'a2', size: 'T', at: [4, 2] } },
    { hk_cell: { id: 'a3', size: 'S', at: [5, 3] } },
    { type: 'custom:hk-popup-card' },
    { hk_cell: { id: 'a9', size: 'L', at: [5, 3] } }        // past the edge: left out
  ] });
  v.isConnected = true;
  v.connectedCallback();
  v.cards = [band, a, b, c, pop, off];
  var root = v._root, kids = root.childNodes;
  ok('one slot per card that has a place: the band, three blocks, the pop-up', kids.length === 5, kids.length);
  ok('the band is first and spans the grid', kids[0].className === 'band' && kids[0].firstChild === band);
  ok('...the band keeps its height and each row uses a tall tile', root.style.gridTemplateRows === '60px repeat(4, 150px)', root.style.gridTemplateRows);
  ok('six columns', root.style['--g-cols'] === '6');
  var a1 = kids[1];
  ok('a block sits in its cell: L at the top left, under the band', a1.className === 'cell' && a1.firstChild === a &&
     a1.style.gridColumn === '1 / span 2' && a1.style.gridRow === '2 / span 2', [a1.style.gridColumn, a1.style.gridRow]);
  ok('...the cell and the card say its size', a1.attrs.size === 'L' && a.attrs.size === 'L' && a1.attrs['data-id'] === 'a1');
  ok('a T block two rows down', kids[2].style.gridColumn === '5 / span 1' && kids[2].style.gridRow === '4 / span 2');
  ok('an S block in the last cell', kids[3].style.gridColumn === '6 / span 1' && kids[3].style.gridRow === '5 / span 1');
  ok('a card that only listens takes no room', kids[4].className === 'aside' && kids[4].firstChild === pop);
  ok('a block past the edge is left out, never grows the page', walk(root).indexOf(off) < 0);
  ok('it announces once its cards are in', ready.length === 1 && ready[0] === v);
  var css = v._sr.children[0].textContent;
  ok('the screen\'s height (less a tab bar\'s room), and nothing scrolls', /:host\{[^}]*height:calc\(100dvh - var\(--g-room\)\)/.test(css) && /:host\{[^}]*overflow:hidden/.test(css));
  ok('cells preserve shared backdrop access and are size containers', !/\.cell\{[^}]*clip-path/.test(css) && /\.cell\{[^}]*overflow:visible/.test(css) && /\.cell\{[^}]*container-type:size/.test(css));

  // re-setting the same cards moves nothing
  var before = kids.slice();
  v.cards = [band, a, b, c, pop, off];
  ok('re-setting the same cards keeps every slot and card in place', root.childNodes.every(function (s, i) { return s === before[i]; }) && a1.firstChild === a);
})();
// FULL (F, 2026-10-30): the Cameras face, the view's whole grid
(function () {
  ok('the catalog says Full is the grid\'s own', JSON.stringify(G.SIZES.F) === '[0,0]' && G.span('F', 2, 4).join() === '2,4');
  [[6, 4, true], [3, 3, false], [2, 4, false]].forEach(function (t) {
    var v = new View(), f = kid('f');
    v.setConfig({ grid: { cols: t[0], rows: t[1], band: t[2] }, cards: [{ hk_band: true }, { hk_cell: { id: 'c1', size: 'F', at: [0, 0] } }] });
    v.cards = [kid('band'), f];
    var cell = v._root.childNodes.filter(function (k) { return k.className === 'cell'; })[0];
    ok('a ' + t[0] + ' x ' + t[1] + ' grid: a Full block spans all of it' + (t[2] ? ', under the band' : ''),
       !!cell && cell.style.gridColumn === '1 / span ' + t[0] && cell.style.gridRow === (t[2] ? 2 : 1) + ' / span ' + t[1],
       cell && [cell.style.gridColumn, cell.style.gridRow]);
    ok('...and tells its card how many columns and rows', cell.style['--hk-span-c'] === String(t[0]) && cell.style['--hk-span-r'] === String(t[1]) &&
       f.attrs.size === 'F', [cell.style['--hk-span-c'], cell.style['--hk-span-r']]);
  });
  var v2 = new View(), s1 = kid('s');
  v2.setConfig({ grid: { cols: 6, rows: 4, band: false }, cards: [{ hk_cell: { id: 's1', size: 'S', at: [0, 0] } }] });
  v2.cards = [s1];
  ok('...a block of its own size says nothing of the kind', v2._root.childNodes[0].style['--hk-span-c'] === undefined);
})();
(function () {
  var v = new View();
  var a = kid('a'), b = kid('b');
  v.setConfig({ grid: { cols: 3, rows: 5, band: false }, cards: [
    { hk_cell: { id: 'n1', size: 'XL', at: [0, 0] } },
    { hk_cell: { id: 'n2', size: 'W', at: [1, 4] } }
  ] });
  v.cards = [a, b];
  var root = v._root, kids = root.childNodes;
  ok('a 3-column grid with no band: rows only', root.style.gridTemplateRows === 'repeat(5, 150px)' && root.style['--g-cols'] === '3');
  ok('...XL fills its width', kids[0].style.gridColumn === '1 / span 3' && kids[0].style.gridRow === '1 / span 2');
  ok('...a W block on the last row', kids[1].style.gridColumn === '2 / span 2' && kids[1].style.gridRow === '5 / span 1');
  var w = new View();
  w.setConfig({ grid: { cols: 7, rows: 9 }, cards: [] });
  ok('a grid it can\'t draw gets the defaults (6 x 4, band on)', w._root.style['--g-cols'] === '6' &&
     w._root.style.gridTemplateRows === '60px repeat(4, 150px)');
})();

// ---- square cells and the Square screen (2026-10-30, HOMEVIEW-LOOK.md Phase A)
ok('the page and the editor read one cell table (hkCards.HOME_GRID.square, the catalog\'s CELLS)',
   JSON.stringify(window.hkCards.HOME_GRID.square) === JSON.stringify(G.CELLS.square) &&
   G.CELLS.tile.w === window.hkCards.TILE.w && G.CELLS.tile.h === window.hkCards.TILE.tall && G.CELLS.tile.gap === window.hkCards.HOME_GRID.gap);
function measured(v, w, h) {
  var gcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = function () { return { paddingLeft: '0px', paddingRight: '0px' }; };
  v.isConnected = true; v.clientWidth = w; v.clientHeight = h;
  v._root.getBoundingClientRect = function () { return { left: 0, top: 0, width: 0, height: 0 }; };
  v._measure();
  globalThis.getComputedStyle = gcs;
}
(function () {
  var v = new View(), t = kid('t'), c = kid('c'), s1 = kid('s1'), s2 = kid('s2'), lk = kid('lk'), lt = kid('lt');
  v.setConfig({ grid: { cols: 3, rows: 3, band: false, cell: 'square', screen: 'square', grow: true }, cards: [
    { hk_cell: { id: 't', size: 'L', at: [0, 0] } }, { hk_cell: { id: 'c', size: 'S', at: [2, 0], bare: true } },
    { hk_cell: { id: 's1', size: 'S', at: [2, 1], tile: 'centred' } }, { hk_cell: { id: 's2', size: 'S', at: [0, 2], tile: 'centred' } },
    { hk_cell: { id: 'lk', size: 'S', at: [1, 2], tile: 'centred' } }, { hk_cell: { id: 'lt', size: 'S', at: [2, 2] } }] });
  v.cards = [t, c, s1, s2, lk, lt];
  var root = v._root, kids = root.childNodes, R = function (i) { return kids[i].style['--hk-block-radius']; };
  ok('square cells: 196 px rows', root.style.gridTemplateRows === 'repeat(3, 196px)', root.style.gridTemplateRows);
  ok('...HomeView\'s 13 px gap, and a Square screen\'s canvas 14 px from the glass', root.style['--g-gap'] === '13px' && root.style['--g-pad'] === '14px',
     [root.style['--g-gap'], root.style['--g-pad']]);
  ok('...the view says its cells are square', v.attrs.cell === 'square');
  ok('corners: the L at the top left, its outer corner concentric with the display (72), the rest 34', R(0) === '72px 34px 34px 34px', R(0));
  ok('...the S at the top right', R(1) === '34px 72px 34px 34px', R(1));
  ok('...a block away from the screen\'s corners: HomeView\'s one radius', R(2) === '34px' && R(4) === '34px', [R(2), R(4)]);
  ok('...the bottom corners', R(3) === '34px 34px 34px 72px' && R(5) === '34px 34px 72px 34px', [R(3), R(5)]);
  ok('Centred goes on the block\'s card; Home is no attribute', s1.attrs.tile === 'centred' && lk.attrs.tile === 'centred' && lt.attrs.tile === undefined && t.attrs.tile === undefined);
  measured(v, 800, 800);
  ok('measured: 3 x 196 + 2 x 13 + 2 x 14 = 642, filling an 800 px square screen', root.style.width === '642px' && root.style.height === '642px' &&
     /^scale\(1\.246/.test(root.style.transform), [root.style.width, root.style.transform]);
  ok('...a cell 196 x 196', root.style['--hk-cell-w'] === '196px' && root.style['--hk-cell-h'] === '196px');

  var w = new View(), a = kid('a');
  w.setConfig({ grid: { cols: 6, rows: 4, band: false, cell: 'square' }, cards: [{ hk_cell: { id: 'a', size: 'L', at: [0, 0] } }] });
  w.cards = [a];
  ok('square cells on a wide tablet: the page\'s gutter, every corner 34 (no Square screen)', w._root.style['--g-pad'] === w._root.style['--g-pad'] &&
     parseFloat(w._root.style['--g-pad']) === window.hkCards.HOME_GRID.pad && w._root.childNodes[0].style['--hk-block-radius'] === '34px');
  measured(w, 1180, 736);
  ok('...6 x 4 measures 1295.4 x 877.4: 0.84 on a landscape tablet with its tab bar (the plan\'s table)', w._root.style.width === '1295.4px' &&
     /^scale\(0\.83/.test(w._root.style.transform), [w._root.style.width, w._root.style.transform]);

  // a layout saved before: nothing changes
  var x = new View(), b = kid('b');
  x.setConfig({ grid: { cols: 6, rows: 4, band: false }, cards: [{ hk_cell: { id: 'b', size: 'L', at: [0, 0] } }] });
  x.cards = [b];
  ok('tiles as before: 150 px rows, the stylesheet\'s gap, no corner of their own', x._root.style.gridTemplateRows === 'repeat(4, 150px)' &&
     x._root.style['--g-gap'] === undefined && x._root.style['--g-pad'] === undefined && x._root.childNodes[0].style['--hk-block-radius'] === undefined && x.attrs.cell === undefined);
  measured(x, 1180, 736);
  ok('...and measured as before (196 x 150, 10)', x._root.style['--hk-cell-h'] === '150px' && x._root.style.width === '1280.4px', x._root.style.width);
})();

// ---- views, and a swipe past the last one (Swipe Between Pages, HOMEVIEW-LOOK.md Phase 0)
(function () {
  var v = new View(), told = [];
  v.setConfig({ grid: { cols: 6, rows: 4, band: false, views: 3 }, cards: [] });
  v.dispatchEvent = function (e) { told.push(e); return true; };
  v.setPointerCapture = function () {};
  var cell = { nodeType: 1, localName: 'div', matches: function () { return false; } };
  function e(x, y) { return { clientX: x, clientY: y, pointerId: 5, pointerType: 'touch', button: 0, composedPath: function () { return [cell, v]; } }; }
  function fire(t, ev) { ev.type = t; (v._listeners[t] || []).forEach(function (f) { f(ev); }); }
  var takes = null;
  window.hkPageSwipe = { takes: function (dir, grid) { takes = [dir, grid === v]; return true; } };
  v._showView(0);
  fire('pointerdown', e(600, 300)); fire('pointermove', e(560, 300));
  ok('on its first view a swipe left turns the views, the page swipe not asked', !takes && v._root.classList.contains('dragging') && !told.length);
  fire('pointerup', e(300, 300));
  ok('...to the next view', v._view === 1);
  v._showView(2);
  fire('pointerdown', e(600, 300)); fire('pointermove', e(560, 300));
  ok('past the last view: the page swipe is asked, for the next page', JSON.stringify(takes) === '[1,true]');
  ok('...and handed it (hk-swipe-past, with the travel so far): the grid lets go', told.length === 1 && told[0].type === 'hk-swipe-past' &&
     told[0].detail.dir === 1 && told[0].detail.dx === -40 && told[0].detail.pointerId === 5 && !v._root.classList.contains('dragging'));
  fire('pointerup', e(300, 300));
  ok('...the views stay on the last', v._view === 2);
  takes = null; told = [];
  window.hkPageSwipe = { takes: function () { return false; } };
  fire('pointerdown', e(600, 300)); fire('pointermove', e(560, 300));
  ok('with no page that way (or the swipe off): it gives a little, as before', !told.length && v._root.classList.contains('dragging'));
  fire('pointercancel', e(560, 300));
  window.hkPageSwipe = undefined;
  v.swipeEnter(-1);
  ok('arriving back from the next page: its last view', v._view === 2);
  v.swipeEnter(1);
  ok('...arriving forward: its first', v._view === 0);
  var sl = { nodeType: 1, localName: 'div', matches: function (s) { return s.indexOf('[role="slider"]') >= 0; } };
  told = [];
  fire('pointerdown', { clientX: 600, clientY: 300, pointerId: 6, pointerType: 'touch', button: 0, composedPath: function () { return [sl, v]; } });
  fire('pointermove', { clientX: 540, clientY: 300, pointerId: 6, pointerType: 'touch', composedPath: function () { return [sl, v]; } });
  ok('a swipe on a slider (hkDrag.sideways) is the slider\'s', !v._root.classList.contains('dragging'));
})();

// ---- beside the Side Pane (2026-10-30, hk-sidepane.js): the grid filling
// the height says how wide it is, the pane takes what it leaves, and the
// grid lays itself in the page the pane narrowed -- on either side
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');
(function () {
  var gcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = function () { return { paddingLeft: '0px', paddingRight: '0px' }; };
  var v = new View();
  v.setConfig({ grid: { cols: 3, rows: 3, band: false, grow: true }, cards: [{ hk_cell: { id: 's1', size: 'L', at: [0, 0] } }] });
  v.cards = [kid('s')];
  v.isConnected = true;
  v._root.getBoundingClientRect = function () { return {}; };
  var room = 820 - 84;                                  // a 1180 x 820 tablet, the tab bar's 84 taken
  v.clientWidth = 1180; v.clientHeight = room;
  v._measure();
  var w = parseFloat(v._root.style.width), h = parseFloat(v._root.style.height), want = Math.round(w * room / h);
  ok('the grid filling the height says the width it takes', v.paneRoom(room) === want, [v.paneRoom(room), want]);
  var css = v._sr.children[0].textContent;
  ok('...and a band under the page comes off its height', /--g-room:calc\(var\(--hk-bar-room,var\(--hk-tabbar-h,0px\)\) \+ var\(--hk-pane-b,0px\)\)/.test(css));
  var X = window.hkSidePane._;
  // a square canvas (the 3 x 3 Square cells draw one): the pane takes the rest
  v._root.style.width = '668.4px'; v._root.style.height = '668.4px';
  var p = X.place(1180, 820, { width: 'standard', gridW: v.paneRoom(room) });
  ok('...beside a 3 x 3 of square cells, the pane is 444', p.kind === 'side' && p.w === 444, p);
  ['right', 'left'].forEach(function (side) {
    // the page narrowed by the pane on its side (hk-menu.js margins): the grid's box is what is left
    v.clientWidth = 1180 - p.w; v.clientHeight = room;
    v._measure();
    var left = parseFloat(v._root.style.left), sc = parseFloat(String(v._root.style.transform).replace('scale(', ''));
    ok('...the pane on the ' + side + ': the grid fills the page beside it, edge to edge', Math.abs(left) < 1 &&
       Math.abs(parseFloat(v._root.style.width) * sc - (1180 - p.w)) < 1.5, [left, sc]);
  });
  v._measure();
  globalThis.getComputedStyle = gcs;
})();

// ---- the strategy
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var S = {};
[st('light.kitchen', 'on', { friendly_name: 'Kitchen Light' }), st('camera.front_door', 'idle', {}),
 st('climate.hallway', 'heat', {}), st('weather.home', 'sunny', {}), st('scene.dinner', 'scening', {}),
 st('alarm_control_panel.house', 'disarmed', {})].forEach(function (s) { S[s.entity_id] = s; });
var hass = { states: S, areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } }, devices: {}, floors: {},
             entities: { 'light.kitchen': { area_id: 'kitchen' }, 'camera.front_door': { area_id: 'kitchen' } } };
var LAYOUT = { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [
  { id: 'a1', card: 'room', size: 'L', at: [0, 0], pages: { source: 'rooms', start: 'tablet_room' } },
  { id: 'a2', card: 'camera', size: 'L', at: [2, 0], pages: { source: 'cameras' } },
  { id: 'a3', card: 'thermostat', size: 'T', at: [4, 0] },
  { id: 'a4', card: 'action', size: 'S', at: [5, 3], opts: { action: 'lock_up' } }] };
var BOARD = {};
window.hkSettings = { get: function (p, f) { return p === 'boards' ? { '': BOARD } : f; },
                      weatherId: function () { return 'weather.home'; }, onChange: function () {} };
window.hkStrategy.generate({ music: false }, hass).then(function (cfg) {
  ok('a generated screen\'s Home is the grid view as before', cfg.views[0].type === 'custom:hk-grid-view');
  var plain = cfg.views.map(function (v) { return v.path; });
  BOARD = { home_style: 'grid', home_grid: LAYOUT };
  return window.hkStrategy.generate({ music: false }, hass).then(function (g) {
    var home = g.views[0];
    ok('Home Style Home Grid: Home is the Home Grid view', home.type === 'custom:hk-home-grid-view' && home.path === 'home' && home.title === 'Home');
    ok('...with the layout\'s grid', JSON.stringify(home.grid) === '{"cols":6,"rows":4,"band":true}', home.grid);
    ok('...the band first: the screen\'s header', home.cards[0].hk_band === true && home.cards[0].type === 'custom:hk-header-card' && home.cards[0].grid_band === true && !home.cards[0].view_layout);
    var blocks = home.cards.filter(function (c) { return c.hk_cell; });
    ok('...a card per block, with its cell', blocks.length === 4 && blocks[0].hk_cell.id === 'a1' && blocks[0].hk_cell.size === 'L' &&
       JSON.stringify(blocks[3].hk_cell.at) === '[5,3]');
    var pg0 = G.pages(blocks[0].item, blocks[0].ctx), pg1 = G.pages(blocks[1].item, blocks[1].ctx);
    ok('...from the catalog, filled from the house', blocks[0].type === 'custom:hk-pager-card' && pg0[0].card.type === 'custom:hk-grid-room-card' &&
       pg0[0].area === 'kitchen' && pg1[0].card.cameras[0].entity === 'camera.front_door' && blocks[2].entity === 'climate.hallway', blocks.map(function (b) { return b.type; }));
    ok('...and the alarm\'s pop-up still listens on Home', home.cards.some(function (c) { return c.type === 'custom:hk-popup-card' && c.hash === '#alarm'; }));
    ok('the screen\'s other pages are unchanged', JSON.stringify(g.views.map(function (v) { return v.path; })) === JSON.stringify(plain), g.views.map(function (v) { return v.path; }));
    BOARD = { home_style: 'grid', home_grid: Object.assign({}, LAYOUT, { band: false }) };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('the band off: no header on Home', !g.views[0].cards.some(function (c) { return c.hk_band; }) && g.views[0].grid.band === false);
    ok('...no block says a Tile Style while the screen has none', g.views[0].cards.filter(function (c) { return c.hk_cell; }).every(function (c) { return !('tile' in c.hk_cell); }));
    // SQUARE CELLS AND CENTRED TILES (2026-10-30): the grid's cells and screen; the screen's Tile Style on
    // each block that doesn't choose its own
    var own = LAYOUT.items.map(function (it, i) { return i === 3 ? Object.assign({}, it, { tile: 'home' }) : it; });
    BOARD = { home_style: 'grid', home_grid: Object.assign({}, LAYOUT, { cell: 'square', screen: 'square', items: own }), tile_style: 'centred' };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    var home = g.views[0], blocks = home.cards.filter(function (c) { return c.hk_cell; });
    ok('square cells and a Square screen reach the view', home.grid.cell === 'square' && home.grid.screen === 'square', home.grid);
    ok('the screen\'s Centred on each block; a block\'s own Home wins', blocks.slice(0, 3).every(function (b) { return b.hk_cell.tile === 'centred'; }) && !('tile' in blocks[3].hk_cell),
       blocks.map(function (b) { return b.hk_cell.tile; }));
    BOARD = { home_style: 'grid', home_grid: null };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('Home Grid with no layout yet: Home is generated', g.views[0].type === 'custom:hk-grid-view');
  });
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' HOME GRID TESTS' : 'ALL ' + pass + ' HOME GRID TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
