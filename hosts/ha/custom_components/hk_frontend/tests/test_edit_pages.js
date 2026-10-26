// EDIT MODE ON THE CATEGORY PAGES, THE FAVORITES AND THE SCENES ROWS
// (modules/hk-edit-pages.js; the shell and the room surface are
// test_edit.js's):
//   Phase D: Lights, Climate and Water list room by room, and a drag there
//            changes that room's Tile Order (accessory/order) -- on its room
//            page too, as the bar says; Security and Vacuums keep a page
//            order of their own (accessory/page_order); Doors & Windows has
//            none, so it offers no Edit.
//   Phase E: Home's Favorites (board/set {favorites}), Home's scenes row
//            with its page pills (board/set {scenes, scenes_pages}) and a
//            room page's scenes row (accessory/room_scenes). The rows drag
//            sideways and never scroll themselves while editing.
// What is not on show (a favorite whose entity is gone, a saved order's
// missing lock) keeps its place in the list saved. The pages are built by
// the real strategy (hkStrategy.generate) into the small model of the DOM
// (tests/edit_dom.js); timers are manual. A fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run edit_pages');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
location.pathname = '/dashboard-hall/lights';
globalThis.history = { pushState: function (s, t, p) { location.pathname = p; }, replaceState: function (s, t, p) { location.pathname = p; } };
window.innerHeight = 800;
window.scrollY = 0;
window.scrollBy = function (x, y) { window.scrollY += y; };

var BOARD = {
  favorites: ['light.den_lamp', 'light.gone_fav', 'light.kitchen_pendant', 'lock.front'],
  scenes: ['scene.night', 'page:security', 'scene.morning', 'scene.missing', 'page:water'],
  scenes_pages: ['security', 'lights']
};
var FEED = {
  accessories: { entities: {}, rooms: { kitchen: ['light.kitchen_island', 'light.kitchen_gone', 'light.kitchen_pendant'] },
                 pages: { security: ['lock.back', 'lock.gone', 'lock.front'] },
                 scenes: { kitchen: ['scene.dinner', 'scene.gone', 'scene.morning'] } },
  generated: {}, boards: { 'dashboard-hall': BOARD }
};
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return null; },
  weatherId: function () { return 'weather.home'; },
  onChange: function () {}
};
document.querySelector = function () { return null; };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/modules/hk-menu.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/modules/hk-edit.js');
load(HK_ROOT + '/frontend/modules/hk-edit-pages.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/tests/edit_dom.js');

var ok = H.ok, eq = H.eq, E = window.hkEdit, P = window.hkEditPages;
window.hkCards.menu.board = function () { return Object.assign({}, BOARD); };

// ------------------------------------------------------------- the house
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var STATES = {}, AREA = {};
[['light.kitchen_pendant', 'on', 'Kitchen Pendant', 'kitchen'], ['light.kitchen_island', 'off', 'Kitchen Island', 'kitchen'],
 ['light.kitchen_cans', 'off', 'Kitchen Cans', 'kitchen'], ['light.den_lamp', 'off', 'Den Lamp', 'den'],
 ['light.den_reading', 'off', 'Den Reading', 'den'], ['fan.den_fan', 'off', 'Den Fan', 'den'],
 ['binary_sensor.kitchen_leak', 'off', 'Kitchen Leak', 'kitchen', { device_class: 'moisture' }],
 ['binary_sensor.den_leak', 'off', 'Den Leak', 'den', { device_class: 'moisture' }],
 ['binary_sensor.front_door', 'off', 'Front Door Sensor', 'hall', { device_class: 'door' }],
 ['binary_sensor.back_door', 'off', 'Back Door Sensor', 'kitchen', { device_class: 'door' }],
 ['lock.front', 'locked', 'Front Door', 'hall'], ['lock.back', 'locked', 'Back Door', 'kitchen'],
 ['cover.garage', 'closed', 'Garage Door', 'garage', { device_class: 'garage' }],
 ['vacuum.upstairs', 'docked', 'Upstairs', 'hall'], ['vacuum.downstairs', 'docked', 'Downstairs', 'kitchen'],
 ['scene.morning', 'unknown', 'Morning', null], ['scene.night', 'unknown', 'Night', null],
 ['scene.dinner', 'unknown', 'Dinner', 'kitchen'], ['scene.movie', 'unknown', 'Movie', 'den'],
 ['alarm_control_panel.house', 'disarmed', 'House Alarm', 'hall'],
 ['weather.home', 'sunny', 'Home', null], ['sun.sun', 'above_horizon', 'Sun', null]
].forEach(function (r) {
  STATES[r[0]] = st(r[0], r[1], Object.assign({ friendly_name: r[2] }, r[4] || {}));
  if (r[3]) AREA[r[0]] = { area_id: r[3] };
});
function who(admin) {
  var sent = [], reads = [];
  var h = {
    user: { id: 'u1', name: 'Fictional Person', is_admin: admin },
    states: STATES, floors: {}, devices: {}, themes: { themes: {} }, entities: AREA,
    areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' },
             hall: { area_id: 'hall', name: 'Hall' }, garage: { area_id: 'garage', name: 'Garage' } },
    callWS: function (m) { return new Promise(function (res, rej) { reads.push({ msg: m, res: res, rej: rej }); }); },
    actions: { callWS: function (m) { return new Promise(function (res, rej) { sent.push({ msg: m, res: res, rej: rej }); }); } }
  };
  h.sent = sent; h.reads = reads;
  return h;
}
var house = who(true);

// ------------------------------------------------ the page, drawn
// A scenes row: hk-scenes-card > its grid > hk-row-card, whose shadow root
// holds the .row scroller of pills -- laid out side by side, 160 wide and
// 12 apart, scrolled by scrollLeft.
function rowEl() {
  var row = new N('div');
  row.className = 'row';
  row.scrollLeft = 0; row.scrollWidth = 0; row.clientWidth = 500;
  row.layout = function (child) {
    var i = row.children.indexOf(child);
    var r = { left: 20 + i * 172 - row.scrollLeft, top: 300, width: 160, height: 64 };
    r.right = r.left + r.width; r.bottom = r.top + r.height;
    return r;
  };
  row.getBoundingClientRect = function () { return { left: 20, top: 286, width: 500, height: 92, right: 520, bottom: 378 }; };
  // as the browser runs them: the capturing listeners, then -- unless one
  // stopped it -- the others
  row.fire = function (t, ev) {
    ev.type = t;
    var mine = row.on.filter(function (l) { return l.t === t; }), n = ev.stopped;
    mine.filter(function (l) { return l.cap; }).forEach(function (l) { l.f(ev); });
    if (ev.stopped === n) mine.filter(function (l) { return !l.cap; }).forEach(function (l) { l.f(ev); });
    return ev;
  };
  return row;
}
function scenesEl(cfg, parent) {
  var card = new N('hk-scenes-card');
  card._cfgIn = cfg;
  var plan = window.hkChip.scenes.plan(cfg, cfg.room ? {} : window.hkCards.menu.board(), house, false);
  parent.appendChild(card);
  if (!plan.config) return card;
  var stack = new N('hk-stack');
  card.appendChild(stack);
  var gridCfg = plan.config.cards[1], rowCfg = gridCfg.cards[0];
  var g = new N('hk-grid-card'); g._config = gridCfg; g.shadowRoot = new N('#shadow');
  var root = gridRoot(); g.shadowRoot.appendChild(root); g._e = root; g._kids = [];
  stack.appendChild(g);
  var rc = new N('hk-row-card');
  rc._config = rowCfg; rc.shadowRoot = new N('#shadow'); rc._root = rc.shadowRoot; rc._children = [];
  var row = rowEl();
  rc.shadowRoot.appendChild(row);
  rowCfg.cards.forEach(function (c) {
    var p = new N('hk-scene-card');
    p._config = c; p.shadowRoot = new N('#shadow');
    row.appendChild(p); rc._children.push(p);
  });
  // the row's own mouse drag-scroll (hk-row.js): a bubbling pointerdown on the row
  rc.dragged = 0;
  row.addEventListener('pointerdown', function () { rc.dragged++; });
  root.appendChild(rc); g._kids.push(rc);
  return card;
}
function build(cfg, parent) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (cfg.type === 'custom:hk-scenes-card') return scenesEl(cfg, parent);
  if (cfg.type === 'custom:hk-grid-card' && !cfg.page_header) {
    var g = new N('hk-grid-card');
    g._config = cfg;
    g.shadowRoot = new N('#shadow');
    var root = gridRoot();
    g.shadowRoot.appendChild(root);
    g._e = root; g._kids = [];
    (cfg.cards || []).forEach(function (c) {
      var t;
      if (c.type === 'custom:hk-grid-card') { t = build(c, root); g._kids.push(t); return; }
      t = c.entity ? tileEl(c, /hk-tile-card|hk-light-card/.test(c.type)) : new N('x-card');
      t._config = t._config || c;
      root.appendChild(t); g._kids.push(t);
    });
    parent.appendChild(g);
    return g;
  }
  var el = new N(cfg.type === 'grid' ? 'hk-stack' : 'x-card');
  el._config = cfg;
  (cfg.cards || []).forEach(function (c) { build(c, el); });
  if (cfg.card) build(cfg.card, el);
  parent.appendChild(el);
  return el;
}
function viewOf(cfg) {
  var v = new N('hk-grid-view');
  v._config = cfg;
  v.shadowRoot = new N('#shadow');
  (cfg.cards || []).forEach(function (c) { build(c, v.shadowRoot); });
  return v;
}
function allGrids(v) {
  var out = [];
  (function walk(n) {
    if (n.localName === 'hk-grid-card') out.push(n);
    (n.children || []).forEach(walk);
    if (n.shadowRoot) walk(n.shadowRoot);
  })(v);
  return out;
}
// the grid whose pills include `id`
function gridWith(v, id) {
  return allGrids(v).filter(function (g) { return g._e.children.some(function (c) { return c._config && c._config.entity === id; }); })[0] || null;
}
function rowOf(v, room) {
  var hit = null;
  (function walk(n) {
    if (n.localName === 'hk-scenes-card' && !!(n._cfgIn && n._cfgIn.room) === !!room) {
      (function find(m) { if (m.localName === 'hk-row-card') hit = hit || m; (m.children || []).forEach(find); if (m.shadowRoot) find(m.shadowRoot); })(n);
    }
    (n.children || []).forEach(walk);
    if (n.shadowRoot) walk(n.shadowRoot);
  })(v);
  return hit;
}
function scroller(rc) { return rc.shadowRoot.children.filter(function (c) { return /\brow\b/.test(c.className || ''); })[0]; }
function pillKey(p) { var c = p._config; return c.entity || (c.tap_action && c.tap_action.navigation_path) || '?'; }
function rowKeys(rc) { return scroller(rc).children.filter(function (c) { return c._config; }).map(pillKey); }
function pill(rc, key) { return scroller(rc).children.filter(function (c) { return c._config && pillKey(c) === key; })[0]; }
function rdown(rc, p, kind) {
  var row = scroller(rc), r = p.getBoundingClientRect();
  return row.fire('pointerdown', mkEv({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: kind || 'mouse',
                                         target: p, path: [p.shadowRoot, p, row, rc.shadowRoot, rc] }));
}
function rmove(rc, x, kind) { return scroller(rc).fire('pointermove', mkEv({ clientX: x, clientY: 330, pointerType: kind || 'mouse', path: [scroller(rc)] })); }
function rup(rc, x, kind) { return scroller(rc).fire('pointerup', mkEv({ clientX: x, clientY: 330, pointerType: kind || 'mouse', path: [scroller(rc)] })); }
function cx(p) { var r = p.getBoundingClientRect(); return r.left + r.width / 2; }
// drag pill `a` onto pill `b` in a grid, with a mouse
function dragOnto(g, a, b) {
  var p = centre(a); down(g, a, 'mouse'); move(g, p[0] - 9, p[1]);
  var to = centre(b); move(g, to[0], to[1]); up(g, to[0], to[1]);
}
function settle() { return H.tick(8); }
var CONFIRMS = [];
window.hkCards.confirmSheet = function (text, onOk, opts) { CONFIRMS.push({ text: text, onOk: onOk, opts: opts || {} }); return {}; };
window.hkStrategy.rebuild = function () {};

var V = {}, CFG = null;
H.run('EDIT PAGES', [
function () {
  return window.hkStrategy.generate({ music: false, popups: false }, house).then(function (m) {
    CFG = m;
    m.views.forEach(function (x) { V[x.path || 'home'] = x; });
    window.hkCards.menu.config = function () { return CFG; };
    // a room page with its own scenes row (the Kitchen's: its own list)
    V.kitchen = { title: 'Kitchen', path: 'room-kitchen', area: 'kitchen',
                  cards: window.hkStrategy.roomCards(house, ['kitchen'], 'Kitchen', {}) };
    CFG.views.push(V.kitchen);
    ok('the house has its pages', ['lights', 'climate', 'water', 'security', 'vacuums', 'weather'].every(function (k) { return !!V[k]; }),
       Object.keys(V));
    // a house with no alarm has a Doors & Windows page (with one, Security has them)
    var quiet = Object.assign({}, house, { states: Object.assign({}, STATES) });
    delete quiet.states['alarm_control_panel.house'];
    return window.hkStrategy.generate({ music: false, popups: false }, quiet);
  }).then(function (m2) {
    m2.views.forEach(function (x) { if (x.path === 'doors-windows') V['doors-windows'] = x; });
  });
},
function () {
  H.section('which pages offer Edit');
  ok('the module is there, after hk-edit.js', !!P && E.surfaces().indexOf('rooms') === 0);
  ok('...its surfaces registered', ['category-rooms', 'page-order', 'favorites', 'scenes-row'].every(function (id) { return E.surfaces().indexOf(id) >= 0; }),
     E.surfaces());
  var home = CFG.views[0];
  eq('Lights: yes', E.editable(V.lights), true);
  eq('Climate: yes', E.editable(V.climate), true);
  eq('Water: yes', E.editable(V.water), true);
  eq('Security: yes', E.editable(V.security), true);
  eq('Vacuums: yes', E.editable(V.vacuums), true);
  var dw = V['doors-windows'];
  ok('the house has a Doors & Windows page', !!dw);
  eq('Doors & Windows: no (its order is Status & Chips\')', E.editable(dw), false);
  eq('Weather: no', E.editable(V.weather), false);
  eq('Home: yes (its room sections, Favorites, scenes)', E.editable(home), true);
  eq('...the Favorites alone are enough', P._.offers.favorites({ cards: [{ type: 'custom:hk-favorite-card', entity: 'light.den_lamp', hk_place: { fav: true } }] }), true);
  eq('...a scenes row alone', P._.offers.scenes({ cards: [{ type: 'grid', cards: [{ type: 'custom:hk-scenes-card' }] }] }), true);
  eq('a room page\'s scenes row: yes', P._.offers.scenes({ cards: [{ type: 'custom:hk-scenes-card', room: true, scenes: ['scene.dinner'] }] }), true);
  eq('...an empty one: no', P._.offers.scenes({ cards: [{ type: 'custom:hk-scenes-card', room: true, scenes: [] }] }), false);
},
function () {
  H.section('Lights: a room\'s section saves that room\'s Tile Order, there and on its room page');
  location.pathname = '/dashboard-hall/lights';
  var h = who(true), v = viewOf(V.lights), kit = gridWith(v, 'light.kitchen_pendant');
  ok('the Kitchen\'s section', !!kit, ids(kit));
  var before = ids(kit);
  eq('enter', E.enter(h, { viewEl: v }), true);
  h.reads[0].res({ versions: { accessories: 'a1', 'board/dashboard-hall': 'b1' } });
  eq('the bar says the order is shared', E._.barNote(), 'Lights keep this order on their room pages too.');
  ok('...the pills are editing, with size badges', kit._e.classList.contains('hk-editing') &&
     E._.badgeText(tileOf(kit, 'light.kitchen_cans')) === 'Regular|Tall:Regular');
  var c = kit._e.fire('click', mkEv({ path: [tileOf(kit, 'light.kitchen_cans'), kit._e] }));
  ok('a tap on a pill is eaten', c.stopped > 0 && c.prevented > 0);
  dragOnto(kit, tileOf(kit, before[before.length - 1]), tileOf(kit, before[0]));
  var now = ids(kit);
  ok('the pill moved', now[0] === before[before.length - 1], now);
  var saves = E.active().saves();
  eq('one save: the Kitchen\'s order', saves.map(function (s) { return [s.doc, s.msg.type, s.msg.area_id]; }),
     [['accessories', 'hk_frontend/accessory/order', 'kitchen']]);
  var list = saves[0].msg.entities;
  eq('...the shown lights in their new order, in the places they held', list.filter(function (x) { return now.indexOf(x) >= 0; }), now);
  ok('...the saved order\'s missing one keeps its place after the one it followed',
     list.indexOf('light.kitchen_gone') === list.indexOf(list.filter(function (x) { return now.indexOf(x) >= 0; })[0]) + 1, list);
  ok('...and the room\'s others are in it (its whole list)', list.indexOf('binary_sensor.kitchen_leak') >= 0 || list.indexOf('lock.back') >= 0, list);
  var done = E.done();
  return settle().then(function () {
    eq('Done sends it with the accessories version', [h.sent[0].msg.type, h.sent[0].msg.expect_version], ['hk_frontend/accessory/order', 'a1']);
    h.sent[0].res({ entities: [], version: 'a2' });
    return done;
  }).then(function (r) { eq('saved', r, 'saved'); });
},
function () {
  H.section('Climate and Water say so too');
  location.pathname = '/dashboard-hall/climate';
  var h = who(true);
  var cv = viewOf(V.climate);
  E.enter(h, { viewEl: cv });
  ok('Climate\'s note', /keep this order on their room pages too/.test(E._.barNote()), E._.barNote());
  E.leave();
  location.pathname = '/dashboard-hall/water';
  E.enter(h, { viewEl: viewOf(V.water) });
  ok('Water\'s note', /keep this order on their room pages too/.test(E._.barNote()), E._.barNote());
  E.leave();
},
function () {
  H.section('Security: its own page order, a missing lock in its place; no size badge');
  location.pathname = '/dashboard-hall/security';
  var h = who(true), v = viewOf(V.security), g = gridWith(v, 'lock.front');
  eq('the page\'s order: the saved one, then the rest', ids(g), ['lock.back', 'lock.front', 'cover.garage']);
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'a1' } });
  eq('no size badge (the page ignores size)', tileOf(g, 'lock.front').shadowRoot.children.length, 0);
  eq('no note', E._.barNote(), '');
  dragOnto(g, tileOf(g, 'cover.garage'), tileOf(g, 'lock.back'));
  eq('dragged', ids(g), ['cover.garage', 'lock.back', 'lock.front']);
  var saves = E.active().saves();
  eq('accessory/page_order for security, its whole list, the missing lock in its place',
     saves.map(function (s) { return [s.doc, s.msg.type, s.msg.page, s.msg.entities]; }),
     [['accessories', 'hk_frontend/accessory/page_order', 'security', ['cover.garage', 'lock.gone', 'lock.back', 'lock.front']]]);
  E.cancel();
  eq('Cancel puts it back', ids(g), ['lock.back', 'lock.front', 'cover.garage']);
},
function () {
  H.section('Vacuums: the cards (each in a grid of its own) drag too');
  location.pathname = '/dashboard-hall/vacuums';
  var h = who(true), v = viewOf(V.vacuums);
  var stack = allGrids(v).filter(function (g) { return g._kids.length > 1 && g._kids.every(function (k) { return k.localName === 'hk-grid-card'; }); })[0];
  ok('the vacuums\' column', !!stack);
  var vids = function () { return stack._e.children.map(function (k) { return k._config.cards[0].entity; }); };
  eq('A to Z', vids(), ['vacuum.downstairs', 'vacuum.upstairs']);
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'a1' } });
  ok('they wiggle', stack._e.classList.contains('hk-editing') && stack._e.children.every(function (k) { return k.hasAttribute('data-hk-edit'); }));
  eq('...with no size badge', stack._e.children.map(function (k) { return k.shadowRoot.children.filter(function (c) { return /hk-edit-size/.test(c.className || ''); }).length; }), [0, 0]);
  var a = stack._e.children[1], b = stack._e.children[0];
  var p = centre(a);
  stack._e.fire('pointerdown', mkEv({ clientX: p[0], clientY: p[1], pointerType: 'mouse', target: a, path: [a._kids[0], a._e, a.shadowRoot, a, stack._e] }));
  move(stack, p[0], p[1] - 9);
  var to = centre(b); move(stack, to[0], to[1]); up(stack, to[0], to[1]);
  eq('moved', vids(), ['vacuum.upstairs', 'vacuum.downstairs']);
  eq('saved as the Vacuums page order', E.active().saves().map(function (s) { return [s.msg.type, s.msg.page, s.msg.entities]; }),
     [['hk_frontend/accessory/page_order', 'vacuums', ['vacuum.upstairs', 'vacuum.downstairs']]]);
  E.cancel();
},
function () {
  H.section('Home\'s Favorites: board/set {favorites}, the screen\'s version; no size badge');
  location.pathname = '/dashboard-hall';
  var h = who(true), v = viewOf(CFG.views[0]), g = gridWith(v, 'lock.front');
  ok('the Favorites grid', !!g && g._e.children.every(function (c) { return c._config.hk_place && c._config.hk_place.fav; }));
  eq('the favorites shown (the gone one is not)', ids(g), ['light.den_lamp', 'light.kitchen_pendant', 'lock.front']);
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'a1', 'board/dashboard-hall': 'b7' } });
  eq('no size badge (a favorite is always one height)', g._e.children.map(function (t) { return t.shadowRoot.children.length; }), [0, 0, 0]);
  var c = g._e.fire('click', mkEv({ path: [tileOf(g, 'lock.front'), g._e] }));
  ok('a tap does not unlock it', c.stopped > 0 && c.prevented > 0);
  dragOnto(g, tileOf(g, 'lock.front'), tileOf(g, 'light.den_lamp'));
  eq('dragged', ids(g), ['lock.front', 'light.den_lamp', 'light.kitchen_pendant']);
  var saves = E.active().saves();
  eq('one board/set for this screen, the gone favorite kept in its place',
     saves.map(function (s) { return [s.doc, s.msg.type, s.msg.dashboard, s.msg.changes]; }),
     [['board/dashboard-hall', 'hk_frontend/board/set', 'dashboard-hall',
       { favorites: ['lock.front', 'light.gone_fav', 'light.den_lamp', 'light.kitchen_pendant'] }]]);
  CONFIRMS.length = 0;
  var done = E.done();
  return settle().then(function () {
    eq('sent with the screen\'s version', h.sent[0].msg.expect_version, 'b7');
    h.sent[0].rej({ code: 'conflict', message: 'board/dashboard-hall changed meanwhile' });
    return done;
  }).then(function (r) {
    eq('a conflict on the screen: "This page changed"', [r, CONFIRMS.length && CONFIRMS[0].text], ['conflict', 'This page changed since you started editing']);
    CONFIRMS[0].onOk();
    return settle();
  }).then(function () {
    eq('Save Anyway: again, without the version', [h.sent.length, 'expect_version' in h.sent[1].msg, h.sent[1].msg.changes.favorites[0]], [2, false, 'lock.front']);
    h.sent[1].res({ version: 'b8' });
    return settle();
  }).then(function () { eq('done', E.active(), null); });
},
function () {
  H.section('Home\'s scenes row: drags sideways, with its page pills; never scrolls itself while editing');
  location.pathname = '/dashboard-hall';
  var h = who(true), v = viewOf(CFG.views[0]), rc = rowOf(v, false);
  ok('the row is drawn', !!rc);
  eq('the row: the screen\'s order, page pills placed, the one not placed after',
     rowKeys(rc), ['scene.night', './security', 'scene.morning', './lights']);
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'a1', 'board/dashboard-hall': 'b9' } });
  var row = scroller(rc);
  ok('the row is editing and a control (the pager steps aside)', row.classList.contains('hk-editing') && row.hasAttribute('data-hk-control'));
  ok('...its pills wiggle', row.children.every(function (p) { return p.hasAttribute('data-hk-edit'); }));
  eq('...with no size badge', row.children.map(function (p) { return p.shadowRoot.children.length; }), [0, 0, 0, 0]);
  rc.dragged = 0;
  var night = pill(rc, 'scene.night');
  var d = rdown(rc, night, 'mouse');
  ok('a press is the edit\'s, not the row\'s drag-scroll', d.stopped > 0 && rc.dragged === 0);
  rup(rc, cx(night));
  var c = row.fire('click', mkEv({ path: [night, row] }));
  ok('a tap does not run the scene', c.stopped > 0 && c.prevented > 0);
  eq('nothing to save yet', E.active().dirty(), false);
  // the morning scene carried to the front
  var morning = pill(rc, 'scene.morning'), x0 = cx(morning);
  rdown(rc, morning, 'mouse');
  rmove(rc, x0 - 8);
  ok('picked up', morning.classList.contains('hk-carried'));
  rmove(rc, cx(night) - 30);
  ok('...the others slide aside', /translateX\(172px\)/.test(night.style.transform || '') && /translateX\(172px\)/.test(pill(rc, './security').style.transform || ''),
     night.style.transform);
  rup(rc, cx(night) - 30);
  eq('dropped at the front', rowKeys(rc), ['scene.morning', 'scene.night', './security', './lights']);
  H.runTimers(1);
  var saves = E.active().saves();
  eq('saved as board/set {scenes, scenes_pages}: hidden ones (a missing scene, a page pill not on) in their places',
     saves.map(function (s) { return [s.doc, s.msg.type, s.msg.dashboard, s.msg.changes]; }),
     [['board/dashboard-hall', 'hk_frontend/board/set', 'dashboard-hall',
       { scenes: ['scene.morning', 'scene.night', 'page:security', 'scene.missing', 'page:lights'], scenes_pages: ['security', 'lights'] }]]);
  eq('...built as HK Settings builds it (hk-settings-model.js scenesSave)', saves[0].msg.changes,
     window.hkSettingsModel.scenesSave(saves[0].msg.changes.scenes));
  E.cancel();
  eq('Cancel puts the row back', rowKeys(rc), ['scene.night', './security', 'scene.morning', './lights']);
  ok('...and it is a row again', !row.classList.contains('hk-editing') && !row.hasAttribute('data-hk-control') && row.count('pointerdown') === 1);
  rdown(rc, night, 'mouse');
  eq('...that drag-scrolls again', rc.dragged, 1);
},
function () {
  H.section('carried near the row\'s end, the row scrolls');
  var h = who(true), v = viewOf(CFG.views[0]), rc = rowOf(v, false), row = scroller(rc);
  E.enter(h, { viewEl: v });
  var night = pill(rc, 'scene.night');
  rdown(rc, night, 'mouse'); rmove(rc, cx(night) + 9);
  rmove(rc, 515);
  H.runTimers(1);
  ok('near the right end: scrolled right', row.scrollLeft > 0, row.scrollLeft);
  var was = row.scrollLeft;
  rmove(rc, 25);
  H.runTimers(1);
  ok('near the left end: back', row.scrollLeft < was, row.scrollLeft);
  rup(rc, 25);
  H.runTimers(1);
  E.cancel();
  row.scrollLeft = 0;
},
function () {
  H.section('a finger: a hold picks a scene up; a swipe scrolls the row');
  var h = who(true), v = viewOf(CFG.views[0]), rc = rowOf(v, false);
  E.enter(h, { viewEl: v });
  var night = pill(rc, 'scene.night'), x = cx(night);
  rdown(rc, night, 'touch');
  rmove(rc, x + 40, 'touch');
  H.runTimers();
  eq('moved first: the row scrolls, nothing picked up', night.classList.contains('hk-carried'), false);
  rup(rc, x + 40, 'touch');
  rdown(rc, night, 'touch');
  H.runTimers(300);
  ok('held: picked up', night.classList.contains('hk-carried'));
  var tm = { preventDefault: function () { tm.n = 1; } };
  scroller(rc).fire('touchmove', tm);
  eq('...and the row does not scroll under it', tm.n, 1);
  rup(rc, x, 'touch');
  E.cancel();
},
function () {
  H.section('a room page\'s scenes row: accessory/room_scenes');
  location.pathname = '/dashboard-hall/room-kitchen';
  var h = who(true), v = viewOf(V.kitchen), rc = rowOf(v, true);
  ok('the Kitchen\'s row', !!rc);
  eq('its own list, the missing one not shown', rowKeys(rc), ['scene.dinner', 'scene.morning']);
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'a3' } });
  var dinner = pill(rc, 'scene.dinner'), morning = pill(rc, 'scene.morning');
  rdown(rc, morning, 'mouse'); rmove(rc, cx(morning) - 8); rmove(rc, cx(dinner) - 20); rup(rc, cx(dinner) - 20);
  eq('dragged', rowKeys(rc), ['scene.morning', 'scene.dinner']);
  var saves = E.active().saves().filter(function (s) { return s.msg.type === 'hk_frontend/accessory/room_scenes'; });
  eq('room_scenes for the Kitchen, the missing one in its place', saves.map(function (s) { return [s.doc, s.msg.area_id, s.msg.entities]; }),
     [['accessories', 'kitchen', ['scene.morning', 'scene.gone', 'scene.dinner']]]);
  var done = E.done();
  return settle().then(function () {
    eq('sent with the accessories version', [h.sent[0].msg.type, h.sent[0].msg.expect_version], ['hk_frontend/accessory/room_scenes', 'a3']);
    h.sent[0].res({ scenes: [], version: 'a4' });
    return done;
  }).then(function (r) { eq('saved', r, 'saved'); });
},
function () {
  H.section('the loader brings it in after hk-edit.js; the word for the host is never used');
  var src = read(HK_ROOT + '/frontend/modules/hk-loader.js');
  ok('in MODULES after hk-edit.js', /'hk-edit\.js',\s*'hk-edit-pages\.js'/.test(src) || src.indexOf("'hk-edit-pages.js'") > src.indexOf("'hk-edit.js'"));
  var mine = read(HK_ROOT + '/frontend/modules/hk-edit-pages.js');
  ok('rule 1', !/\bh[a]ss\b/.test(mine));
}
]);
