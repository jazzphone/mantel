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
  w.setConfig({ grid: { cols: 4, rows: 9 }, cards: [] });
  ok('a grid it can\'t draw gets the defaults (6 x 4, band on)', w._root.style['--g-cols'] === '6' &&
     w._root.style.gridTemplateRows === '60px repeat(4, 150px)');
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
    BOARD = { home_style: 'grid', home_grid: null };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('Home Grid with no layout yet: Home is generated', g.views[0].type === 'custom:hk-grid-view');
  });
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' HOME GRID TESTS' : 'ALL ' + pass + ' HOME GRID TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
