// EDIT MODE (modules/hk-edit.js): arranging a page in place, for Owners and
// Admins, never at a wall tablet.
//   Phase A: who may (canEditPage), asked of the host (hkShell.atTablet --
//            Home Assistant: a Wall Tablets entry is this page; Mantel: a
//            device session, GET /api/me `at_tablet`).
//   Phase B: the shell -- which pages offer it (the surface registry), the
//            bar (Cancel, Done), the editing state on the page's grids (taps
//            eaten, plain row flow, data-hk-control, size badges), Escape,
//            the navigation guard, Done's batch with the versions read at
//            enter and the "This page changed" prompt, Cancel.
//   Phase C: room pages' groups and Home's room sections -- the drag (hold,
//            scroll, mouse, FLIP, auto-scroll), the room's whole Tile Order
//            worked out from what was dragged (hidden tiles keep their
//            places, a combined room), and Tall / Regular.
// The page is drawn by the real strategy (hk-strategy.js roomCards) into a
// small model of the DOM with a 4-column grid's layout; timers are manual.
// A fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run edit');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
location.pathname = '/dashboard-hall/room-kitchen';
var NAV = [];
globalThis.history = { pushState: function (s, t, p) { NAV.push(p); location.pathname = p; },
                       replaceState: function (s, t, p) { location.pathname = p; } };
window.innerHeight = 800;
window.scrollY = 0;
var SCROLLS = [];
window.scrollBy = function (x, y) { SCROLLS.push(y); window.scrollY += y; };

var TABLET = null;
var FEED = {
  accessories: { entities: { 'light.kitchen_hidden': { room: false } }, rooms: {}, into: { deck: 'backyard' } },
  generated: {}, boards: { 'dashboard-hall': {} }
};
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return TABLET; },
  onChange: function () {}
};

document.querySelector = function () { return null; };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/modules/hk-menu.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/modules/hk-edit.js');

var ok = H.ok, eq = H.eq, E = window.hkEdit;

// ------------------------------------------------------------- the house
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var STATES = {};
[st('light.kitchen_pendant', 'on', { friendly_name: 'Kitchen Pendant' }),
 st('light.kitchen_island', 'off', { friendly_name: 'Kitchen Island' }),
 st('light.kitchen_cans', 'off', { friendly_name: 'Kitchen Cans' }),
 st('light.kitchen_hidden', 'off', { friendly_name: 'Kitchen Hidden Light' }),
 st('switch.kitchen_coffee', 'off', { friendly_name: 'Kitchen Coffee' }),
 st('fan.kitchen_fan', 'off', { friendly_name: 'Kitchen Fan' }),
 st('light.den_lamp', 'off', { friendly_name: 'Den Lamp' }),
 st('light.den_reading', 'off', { friendly_name: 'Den Reading' }),
 st('light.backyard_flood', 'off', { friendly_name: 'Backyard Flood' }),
 st('light.deck_string', 'off', { friendly_name: 'Deck String' })
].forEach(function (s) { STATES[s.entity_id] = s; });
function who(admin) {
  var sent = [], reads = [];
  var h = {
    user: { id: 'u1', name: 'Fictional Person', is_admin: admin },
    states: STATES, floors: {}, devices: {}, themes: { themes: {} },
    areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' },
             backyard: { area_id: 'backyard', name: 'Backyard' }, deck: { area_id: 'deck', name: 'Deck' } },
    entities: { 'light.kitchen_pendant': { area_id: 'kitchen' }, 'light.kitchen_island': { area_id: 'kitchen' },
                'light.kitchen_cans': { area_id: 'kitchen' }, 'light.kitchen_hidden': { area_id: 'kitchen' },
                'switch.kitchen_coffee': { area_id: 'kitchen' }, 'fan.kitchen_fan': { area_id: 'kitchen' },
                'light.den_lamp': { area_id: 'den' }, 'light.den_reading': { area_id: 'den' },
                'light.backyard_flood': { area_id: 'backyard' }, 'light.deck_string': { area_id: 'deck' } },
    // reads (panel/get) and writes (the action port), each answered by the test
    callWS: function (m) { return new Promise(function (res, rej) { reads.push({ msg: m, res: res, rej: rej }); }); },
    actions: { callWS: function (m) { return new Promise(function (res, rej) { sent.push({ msg: m, res: res, rej: rej }); }); } }
  };
  h.sent = sent; h.reads = reads;
  return h;
}

// the small model of the DOM (tests/edit_dom.js: elements, a 4-column grid's
// layout, tiles, pointer events), shared with test_edit_pages.js
load(HK_ROOT + '/tests/edit_dom.js');

// the page, from the strategy's config, as hk-grid-card and the view build it
function build(cfg, parent) {
  if (cfg.type === 'custom:hk-grid-card' && !cfg.page_header) {
    var g = new N('hk-grid-card');
    g._config = cfg;
    g.shadowRoot = new N('#shadow');
    var root = gridRoot();
    g.shadowRoot.appendChild(root);
    g._e = root; g._kids = [];
    (cfg.cards || []).forEach(function (c) {
      var t = c.entity ? tileEl(c, !/fan\./.test(c.entity)) : new N('x-card');
      t._config = t._config || c;
      root.appendChild(t); g._kids.push(t);
    });
    parent.appendChild(g);
    return g;
  }
  var el = new N(cfg.type === 'grid' ? 'hk-stack' : 'x-card');
  el._config = cfg;
  (cfg.cards || []).forEach(function (c) { build(c, el); });
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
function grids(v) {
  var out = [];
  (function walk(n) {
    if (n.localName === 'hk-grid-card') out.push(n);
    (n.children || []).forEach(walk);
    if (n.shadowRoot) walk(n.shadowRoot);
  })(v);
  return out;
}
function groupNamed(v, name) {
  // the grid after the heading `name`
  var hit = null;
  (function walk(n) {
    var kids = n.children || [];
    kids.forEach(function (k, i) {
      if (k._config && k._config.type === 'custom:hk-heading-card' && k._config.name === name && kids[i + 1]) hit = kids[i + 1];
      walk(k);
    });
    if (n.shadowRoot) walk(n.shadowRoot);
  })(v);
  return hit;
}

// the dashboard: Home, the Kitchen's and the Backyard's pages, Weather, a Home Grid screen's Home
var house = who(true);
var KITCHEN = { title: 'Kitchen', path: 'room-kitchen', area: 'kitchen',
                cards: window.hkStrategy.roomCards(house, ['kitchen'], 'Kitchen', {}) };
var BACKYARD = { title: 'Backyard', path: 'room-backyard', area: ['backyard', 'deck'],
                 cards: window.hkStrategy.roomCards(house, ['backyard', 'deck'], 'Backyard', {}) };
function homeSection(area, name, ids0) {
  return { type: 'grid', cards: [{ type: 'custom:hk-heading-card', name: name },
    { type: 'custom:hk-grid-card', layout: {}, cards: ids0.map(function (id) {
      var t = window.hkStrategy.tileFor(house, id, id); t.hk_place = { area: area }; return t; }) }] };
}
var HOME = { title: 'Home', path: 'home', cards: [
  homeSection('kitchen', 'Kitchen', ['light.kitchen_cans', 'light.kitchen_island', 'light.kitchen_pendant', 'switch.kitchen_coffee']),
  homeSection('den', 'Den', ['light.den_lamp', 'light.den_reading'])] };
var WEATHER = { title: 'Weather', path: 'weather', cards: [{ type: 'custom:hk-weather-card' }] };
var LIGHTS = { title: 'Lights', path: 'lights', cards: [{ type: 'custom:hk-grid-card', cards: [
  { type: 'custom:hk-light-card', entity: 'light.den_lamp', hk_place: { area: 'den', group: 'Lights', page: 'lights' } }] }] };
var GRIDHOME = { title: 'Home', path: 'home', type: 'custom:hk-home-grid-view', cards: HOME.cards };
var CFG = { views: [HOME, WEATHER, LIGHTS, KITCHEN, BACKYARD] };
window.hkCards.menu.config = function () { return CFG; };
var CONFIRMS = [];
window.hkCards.confirmSheet = function (text, onOk, opts) { CONFIRMS.push({ text: text, onOk: onOk, opts: opts || {} }); return {}; };
var REBUILDS = 0;
window.hkStrategy.rebuild = function () { REBUILDS++; };
var EVENTS = [];
window.addEventListener('hk-edit', function (e) { EVENTS.push(e.detail && e.detail.active); });
function bar() { return E._.bar(); }
function buttons() { var b = bar(); return b ? E._.barButtons() : null; }
function settle() { return H.tick(8); }

H.run('EDIT', [
function () {
  H.section('who may edit a page');
  ok('the module is there', !!E && typeof E.canEditPage === 'function');
  eq('nobody signed in: no', E.canEditPage(null, {}), false);
  eq('no user: no', E.canEditPage({}, {}), false);
  eq('an Adult (not an admin): no', E.canEditPage(who(false), {}), false);
  eq('an Owner or Admin on a phone: yes', E.canEditPage(who(true), {}), true);
  TABLET = { id: 'kitchen_tablet', room: 'kitchen' };
  eq('Home Assistant: the shell says this page is a Wall Tablets entry', window.hkShell.atTablet({}), true);
  eq('...so an admin at a wall tablet: no', E.canEditPage(who(true), {}), false);
  TABLET = null;
  eq('...and away from it again: yes', E.canEditPage(who(true), {}), true);
  window.hkShell.use({ atTablet: function () { return true; } });
  eq('a host whose device session is a tablet (Mantel at_tablet): no', E.canEditPage(who(true), {}), false);
  window.hkShell.use({ atTablet: function () { throw new Error('a broken host'); } });
  eq('a host that throws: no (the servers refuse anyway)', E.canEditPage(who(true), {}), false);
  window.hkShell.use(window.hkHAShell);
  eq('the Home Assistant shell is back', E.canEditPage(who(true), {}), true);
},
function () {
  H.section('which pages have something to edit (the surface registry)');
  ok('the room tiles surface is registered', E.surfaces().indexOf('rooms') >= 0, E.surfaces());
  eq('a room page: yes', E.editable(KITCHEN), true);
  eq('Home with its room sections: yes', E.editable(HOME), true);
  eq('a combined room (the Backyard and its Deck): yes', E.editable(BACKYARD), true);
  eq('Weather: nothing to edit', E.editable(WEATHER), false);
  eq('a category page: not the room surface\'s (phase D adds its own)', E.editable(LIGHTS), false);
  eq('a Home Grid screen\'s Home: never (it has its own editor)', E.editable(GRIDHOME), false);
  eq('no view: no', E.editable(null), false);
  var seen = [];
  var spec = E.surface({ id: 'test-weather', offers: function (v) { seen.push(v.path); return v.path === 'weather'; },
                         enter: function () { return null; } });
  ok('a later phase registers its own surface', E.surfaces().indexOf('test-weather') >= 0 && spec.id === 'test-weather');
  eq('...and Weather is now offered', E.editable(WEATHER), true);
  ok('...asked of the view config', seen.indexOf('weather') >= 0);
  E.surface({ id: 'test-weather', offers: function () { return false; }, enter: function () { return null; } });
  eq('registering the same id again replaces it', [E.editable(WEATHER), E.surfaces().filter(function (x) { return x === 'test-weather'; }).length], [false, 1]);
  E._.unregister('test-weather');
  H.throws('a surface needs an id, offers and enter', function () { E.surface({ id: 'x' }); });
},
function () {
  H.section('where the page is, and the offer (the menu row, More, the sheet\'s button)');
  location.pathname = '/dashboard-hall/room-kitchen';
  var cv = E.currentView();
  eq('the current view, by its address', [cv && cv.path, cv && cv.title, cv && cv.dash], ['room-kitchen', 'Kitchen', 'dashboard-hall']);
  location.pathname = '/dashboard-hall';
  eq('no view in the address: Home', E.currentView().path, 'home');
  location.pathname = '/dashboard-hall/0';
  eq('...or index 0', E.currentView().title, 'Home');
  location.pathname = '/dashboard-hall/1';
  eq('a view by its index', E.currentView().path, 'weather');
  location.pathname = '/dashboard-hall/room-kitchen';
  eq('an admin on a room page: offered', E.offer(who(true)), true);
  eq('an Adult: not offered', E.offer(who(false)), false);
  TABLET = { id: 't' };
  eq('at a wall tablet: not offered', E.offer(who(true)), false);
  TABLET = null;
  location.pathname = '/dashboard-hall/weather';
  eq('Weather: not offered', E.offer(who(true)), false);
  eq('...but the dashboard has pages to edit (the tab bar keeps More for an editor)', E.editAny(who(true)), true);
  eq('...not for an Adult', E.editAny(who(false)), false);
  location.pathname = '/dashboard-hall/room-kitchen';
  var M = window.hkMenu._;
  ok('the menu has the shared row maker', typeof M.editItems === 'function');
  var rows = M.editItems(who(true));
  eq('the menu\'s Edit Page row on a room page', rows.map(function (r) { return [r.title, r.kind, r.icon]; }), [['Edit Page', 'edit', 'mdi:pencil']]);
  eq('...none for an Adult', M.editItems(who(false)).length, 0);
  location.pathname = '/dashboard-hall/weather';
  eq('...none on Weather', M.editItems(who(true)).length, 0);
  location.pathname = '/dashboard-hall/room-kitchen';
  ok('...and it is never "the page you are on"', !M.isHere(rows[0], location.pathname));
  var menuSrc = read(HK_ROOT + '/frontend/modules/hk-menu.js'), tabSrc = read(HK_ROOT + '/frontend/modules/hk-tabbar.js');
  ok('the side menu draws the row (build) and runs it (onList)', /editItems\(/.test(menuSrc) && /kind === 'edit'/.test(menuSrc));
  ok('...and rebuilds when Edit mode starts or ends, or the offer changes', /'hk-edit'/.test(menuSrc) && /offerKey/.test(menuSrc));
  ok('the tab bar\'s More sheet has the row (its own list, k "e") and runs it', /editItems\(/.test(tabSrc) && /k === 'e'/.test(tabSrc));
  ok('...and keeps More for an editor on every page (the bar does not change page to page)', /editAny\(/.test(tabSrc));
},
function () {
  H.section('enter: not without the right, not on a page with nothing to edit');
  var h = who(false), v = viewOf(KITCHEN);
  eq('an Adult: no', E.enter(h, { viewEl: v }), false);
  TABLET = { id: 't' };
  eq('at a wall tablet: no', E.enter(who(true), { viewEl: v }), false);
  TABLET = null;
  location.pathname = '/dashboard-hall/weather';
  eq('Weather: no', E.enter(who(true), { viewEl: viewOf(WEATHER) }), false);
  location.pathname = '/dashboard-hall/room-kitchen';
  eq('nothing is being edited', E.active(), null);
  eq('leave: nothing to leave', E.leave(), false);
},
function () {
  H.section('enter a room page: the bar, the editing state, the versions');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights'), climate = groupNamed(v, 'Climate');
  ok('the page has its Lights and Climate groups', !!lights && !!climate);
  eq('Lights A to Z as the room page draws them', ids(lights), ['light.kitchen_cans', 'light.kitchen_island', 'light.kitchen_pendant']);
  var flowWas = lights._e.style.getPropertyValue('grid-auto-flow');
  lights._e.style.setProperty('grid-auto-flow', 'dense');
  eq('enter', E.enter(h, { viewEl: v }), true);
  var s = E.active();
  ok('a session', !!s && s.path === 'room-kitchen' && s.title === 'Kitchen');
  eq('...told on the window (the menu and the tab bar rebuild)', EVENTS[EVENTS.length - 1], true);
  eq('...and no second one while it lasts', E.enter(h, { viewEl: v }), false);
  eq('the offer is gone while editing', E.offer(h), false);
  eq('the versions are read as it starts (panel/get)', h.reads.map(function (r) { return r.msg.type; }), ['hk_frontend/panel/get']);
  h.reads[0].res({ versions: { accessories: 'v1', 'board/dashboard-hall': 7 } });
  var b = bar();
  ok('the bar is up, in the dialog root', !!b && b.parentNode === document.body);
  eq('...it says what is being edited', E._.barTitle(), 'Editing Kitchen');
  var bb = buttons();
  eq('...Cancel and Done', [bb.cancel.textContent, bb.done.textContent], ['Cancel', 'Done']);
  ok('...and a place for more buttons (Rooms, phase G)', !!bb.extra);
  eq('the grids are in the editing state', [lights._e.classList.contains('hk-editing'), climate._e.classList.contains('hk-editing')], [true, true]);
  eq('...marked as a control (the pager and the menu\'s edge swipe step aside)', lights._e.hasAttribute('data-hk-control'), true);
  eq('...in plain reading order, not dense', lights._e.style.getPropertyValue('grid-auto-flow'), 'row');
  eq('...its style in the grid\'s shadow root', lights.shadowRoot.children.filter(isStyle).length, 1);
  var t = tileOf(lights, 'light.kitchen_cans');
  var badge = t.shadowRoot.children.filter(function (c) { return c.className && /hk-edit-size/.test(c.className); })[0];
  ok('every sizable pill shows a size badge', !!badge);
  eq('...Regular | Tall, the current one marked', E._.badgeText(t), 'Regular|Tall:Regular');
  var fan = tileOf(climate, 'fan.kitchen_fan');
  eq('...none where the size does not apply', fan.shadowRoot.children.filter(function (c) { return /hk-edit-size/.test(c.className || ''); }).length, 0);
  ok('...the wiggle has a phase per pill', t.style.getPropertyValue('--hk-edit-i') !== '');
  ok('the document says so too (data-hk-editing)', document.documentElement.hasAttribute('data-hk-editing'));
  ok('the strategy holds its rebuilds while editing', window.hkStrategy._busy() === true);
  // leave, as Cancel does
  bb.cancel.click();
  eq('Cancel leaves', E.active(), null);
  eq('...the bar is gone', bar(), null);
  eq('...the grids are back: dense, no control mark, no class', [lights._e.style.getPropertyValue('grid-auto-flow'), lights._e.hasAttribute('data-hk-control'),
     lights._e.classList.contains('hk-editing')], ['dense', false, false]);
  eq('...no badges, no style', [t.shadowRoot.children.length, lights.shadowRoot.children.filter(isStyle).length], [0, 0]);
  eq('...no listeners left on the grid', [lights._e.count('pointerdown'), lights._e.count('click'), lights._e.count('touchmove')], [0, 0, 0]);
  eq('...told on the window', EVENTS[EVENTS.length - 1], false);
  lights._e.style.setProperty('grid-auto-flow', flowWas || 'dense');
},
function () {
  H.section('the bar: under a tab bar at the top or the host\'s toolbar, and the page makes room under it');
  var h = who(true), v = viewOf(KITCHEN);
  // the host's toolbar (Home Assistant's dashboard header) 56 px tall, and the bar's own box
  window.hkShell.use({ toolbar: function () { return { getBoundingClientRect: function () { return { top: 0, bottom: 56, height: 56 }; } }; } });
  var proto = Object.getPrototypeOf(document.createElement('div')), had = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    return /(^| )bar( |$)/.test(this.className || '') ? { top: 66, bottom: 118, height: 52, left: 0, right: 0, width: 0 }
      : { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
  };
  v.style.setProperty('margin-top', '4px');
  try {
    eq('enter', E.enter(h, { viewEl: v }), true);
    h.reads[0].res({ versions: {} });
    var css = bar().children.filter(isStyle)[0].textContent;
    ok('the bar goes under a tab bar at the top (--hk-tabbar-below, hk-tabbar.js) or the host\'s toolbar',
       /var\(--hk-tabbar-below, -100px\) \+ 12px/.test(css) && /var\(--hk-edit-under, -100px\) \+ 10px/.test(css), css.slice(0, 400));
    eq('...the toolbar\'s bottom, measured as it mounts', bar().style.getPropertyValue('--hk-edit-under'), '56px');
    eq('the page goes down under the bar (its bottom and 12 px, less where the page starts)', v.style.getPropertyValue('margin-top'),
       'calc(4px + 130px)');
    E.cancel();
    eq('Cancel: the page back where it was', v.style.getPropertyValue('margin-top'), '4px');
  } finally {
    if (had) proto.getBoundingClientRect = had; else delete proto.getBoundingClientRect;
    window.hkShell.use(window.hkHAShell);
    v.style.removeProperty('margin-top');
  }
},
function () {
  H.section('while editing, a pill is no control: taps, holds, right-clicks and keys are eaten');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  var t = tileOf(lights, 'light.kitchen_island');
  var ev = down(lights, t, 'mouse');
  ok('a press on a pill stops at the grid (the pill never hears it)', ev.stopped > 0);
  ev = up(lights, centre(t)[0], centre(t)[1]);
  var c = lights._e.fire('click', mkEv({ path: [t, lights._e] }));
  ok('its click too, and its default', c.stopped > 0 && c.prevented > 0);
  c = lights._e.fire('contextmenu', mkEv({ path: [t, lights._e] }));
  ok('a right-click opens no sheet', c.stopped > 0 && c.prevented > 0);
  c = lights._e.fire('keydown', mkEv({ key: 'Enter', path: [t, lights._e] }));
  ok('Enter on a focused pill does nothing', c.stopped > 0 && c.prevented > 0);
  eq('...and nothing moved', ids(lights), ['light.kitchen_cans', 'light.kitchen_island', 'light.kitchen_pendant']);
  eq('nothing to save after a tap', E.active().dirty(), false);
  E.leave();
},
function () {
  H.section('a mouse drags a pill within its group: the others slide aside (FLIP)');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  var pend = tileOf(lights, 'light.kitchen_pendant'), cans = tileOf(lights, 'light.kitchen_cans');
  var p0 = centre(pend);
  down(lights, pend, 'mouse');
  move(lights, p0[0] - 3, p0[1]);
  eq('4 px: not yet', pend.classList.contains('hk-carried'), false);
  move(lights, p0[0] - 8, p0[1]);
  eq('5 px or more: picked up', pend.classList.contains('hk-carried'), true);
  ok('...the grid says it carries one (badges step back)', lights._e.classList.contains('hk-carrying'));
  var to = centre(cans);
  move(lights, to[0], to[1]);
  eq('over the first pill: it takes that place', ids(lights), ['light.kitchen_pendant', 'light.kitchen_cans', 'light.kitchen_island']);
  ok('...the pill follows the pointer', /translate/.test(pend.style.transform || ''));
  ok('...the others start from where they were (FLIP)', /translate/.test(cans.style.transform || ''));
  H.runTimers(1);
  eq('...and glide home', cans.style.transform || '', '');
  up(lights, to[0], to[1]);
  eq('let go: put down', [pend.classList.contains('hk-carried'), lights._e.classList.contains('hk-carrying')], [false, false]);
  H.runTimers(1);
  eq('...settled in its place', pend.style.transform || '', '');
  eq('now there is something to save', E.active().dirty(), true);
  E.cancel();
  eq('Cancel: the pills are back in their order', ids(lights), ['light.kitchen_cans', 'light.kitchen_island', 'light.kitchen_pendant']);
  eq('...nothing was sent', h.sent.length, 0);
},
function () {
  H.section('a finger: a short hold picks a pill up; moving first scrolls the page');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  eq('the hold is about a quarter second', E._.HOLD_MS, 250);
  var isl = tileOf(lights, 'light.kitchen_island'), p = centre(isl);
  down(lights, isl, 'touch');
  move(lights, p[0], p[1] + 30, 'touch');
  eq('moved first: the page scrolls, nothing is picked up', isl.classList.contains('hk-carried'), false);
  H.runTimers();
  eq('...and the hold no longer picks it up', isl.classList.contains('hk-carried'), false);
  up(lights, p[0], p[1] + 30, 'touch');
  down(lights, isl, 'touch');
  H.runTimers(300);
  eq('held still: picked up', isl.classList.contains('hk-carried'), true);
  var tm = { preventDefault: function () { tm.n = (tm.n || 0) + 1; } };
  lights._e.fire('touchmove', tm);
  eq('...and while it is carried the page does not scroll under it', tm.n, 1);
  // the browser taking the gesture (pointercancel): put down where it is
  lights._e.fire('pointercancel', mkEv({ clientX: p[0], clientY: p[1], pointerType: 'touch', path: [lights._e] }));
  eq('pointercancel puts it down', isl.classList.contains('hk-carried'), false);
  var tm2 = { preventDefault: function () { tm2.n = (tm2.n || 0) + 1; } };
  lights._e.fire('touchmove', tm2);
  eq('...and the page scrolls again', tm2.n, undefined);
  E.leave();
},
function () {
  H.section('carried near the top or bottom edge, the page scrolls');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  var cans = tileOf(lights, 'light.kitchen_cans'), p = centre(cans);
  down(lights, cans, 'mouse');
  move(lights, p[0] + 10, p[1]);
  SCROLLS.length = 0;
  move(lights, p[0] + 10, window.innerHeight - 10);
  H.runTimers(1);
  ok('near the bottom: scrolled down', SCROLLS.length > 0 && SCROLLS[0] > 0, SCROLLS);
  SCROLLS.length = 0;
  move(lights, p[0] + 10, 10);
  H.runTimers(1);
  ok('near the top: up', SCROLLS.length > 0 && SCROLLS[0] < 0, SCROLLS);
  SCROLLS.length = 0;
  move(lights, p[0] + 10, 400);
  H.runTimers(1);
  eq('in the middle: still', SCROLLS.length, 0);
  up(lights, p[0] + 10, 400);
  window.scrollY = 0;
  E.leave();
},
function () {
  H.section('the room\'s whole Tile Order, worked out from the groups (hidden tiles keep their places)');
  var F = E._.fillSlots;
  eq('fillSlots: the shown ones take the places they held, in their new order',
     F(['a', 'h', 'b', 'c', 'x'], ['c', 'a', 'b']), ['c', 'h', 'a', 'b', 'x']);
  eq('...nothing shown: unchanged', F(['a', 'b'], []), ['a', 'b']);
  eq('merged: a saved order keeps what the page does not list where it was',
     E._.merged(['a', 'gone', 'b'], ['b', 'a', 'new']), ['b', 'a', 'gone', 'new']);
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'v1' } });
  var pend = tileOf(lights, 'light.kitchen_pendant'), cans = tileOf(lights, 'light.kitchen_cans');
  down(lights, pend, 'mouse'); var p0 = centre(pend); move(lights, p0[0] - 9, p0[1]);
  var to = centre(cans); move(lights, to[0], to[1]); up(lights, to[0], to[1]);
  var saves = E.active().saves();
  eq('one message for the Kitchen', saves.map(function (s) { return [s.doc, s.msg.type, s.msg.area_id]; }),
     [['accessories', 'hk_frontend/accessory/order', 'kitchen']]);
  eq('...its whole list: the lights in their new order, the hidden one (not on its page) where it was, the rest after',
     saves[0].msg.entities, ['light.kitchen_pendant', 'light.kitchen_hidden', 'light.kitchen_cans', 'light.kitchen_island',
                             'switch.kitchen_coffee', 'fan.kitchen_fan']);
  E.leave();
  // a group left alone in a room with no order of its own keeps what it showed (Lights A to Z)
  FEED.accessories.rooms = {};
  var F2 = E._.roomOrders;
  ok('roomOrders is shared for later phases', typeof F2 === 'function' && typeof E.pillGroups === 'function' && typeof E.sizeSaves === 'function');
},
function () {
  H.section('a combined room: the Deck is shown in the Backyard');
  location.pathname = '/dashboard-hall/room-backyard';
  var h = who(true), v = viewOf(BACKYARD), lights = groupNamed(v, 'Lights');
  eq('the Backyard\'s page has both rooms\' lights', ids(lights), ['light.deck_string', 'light.backyard_flood']);
  // (A to Z by the name each shows: "Deck String" in the Backyard, "Flood")
  E.enter(h, { viewEl: v });
  var flood = tileOf(lights, 'light.backyard_flood'), deck = tileOf(lights, 'light.deck_string');
  var p = centre(flood); down(lights, flood, 'mouse'); move(lights, p[0] - 9, p[1]);
  var to = centre(deck); move(lights, to[0], to[1]); up(lights, to[0], to[1]);
  var saves = E.active().saves();
  eq('saved as the Backyard\'s order, the Deck\'s lights in it (the Deck is part of it)',
     saves.map(function (s) { return [s.msg.area_id, s.msg.entities]; }),
     [['backyard', ['light.backyard_flood', 'light.deck_string']]]);
  E.leave();
  // two rooms put on one page by hand (no `into`): each keeps its own list
  FEED.accessories.into = {};
  var TWO = { title: 'Outside', path: 'room-backyard', area: ['backyard', 'deck'],
              cards: window.hkStrategy.roomCards(h, ['backyard', 'deck'], 'Outside', {}) };
  CFG.views[4] = TWO;
  v = viewOf(TWO); lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  var before = ids(lights);
  var a = tileOf(lights, before[1]), b = tileOf(lights, before[0]);
  p = centre(a); down(lights, a, 'mouse'); move(lights, p[0] - 9, p[1]);
  to = centre(b); move(lights, to[0], to[1]); up(lights, to[0], to[1]);
  saves = E.active().saves();
  eq('two rooms on one page by hand: each room\'s own list, its own tile in it',
     saves.map(function (s) { return [s.msg.area_id, s.msg.entities]; }).sort(),
     [['backyard', ['light.backyard_flood']], ['deck', ['light.deck_string']]]);
  E.leave();
  FEED.accessories.into = { deck: 'backyard' };
  CFG.views[4] = BACKYARD;
  location.pathname = '/dashboard-hall/room-kitchen';
},
function () {
  H.section('Tall and Regular: the badge previews at once, and saves on Done');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  var isl = tileOf(lights, 'light.kitchen_island');
  var badge = isl.shadowRoot.children.filter(function (c) { return /hk-edit-size/.test(c.className || ''); })[0];
  var c = lights._e.fire('click', mkEv({ path: [badge, isl.shadowRoot, isl, lights._e], target: isl }));
  ok('a tap on the badge is the badge\'s, not the pill\'s', c.stopped > 0);
  eq('...the pill is Tall at once: its layout and its two rows', [isl._config.size, isl.style.getPropertyValue('grid-row')], ['tall', 'span 2']);
  eq('...the badge says so', E._.badgeText(isl), 'Regular|Tall:Tall');
  eq('...its place is kept (hk_place stays on its config)', !!(isl._config.hk_place && isl._config.hk_place.group), true);
  eq('...one size to save', E.active().saves().filter(function (s) { return s.msg.type === 'hk_frontend/accessory/set'; })
     .map(function (s) { return [s.msg.entity_id, s.msg.size]; }), [['light.kitchen_island', 'tall']]);
  lights._e.fire('click', mkEv({ path: [badge, isl, lights._e], target: isl }));
  eq('tapped again: Regular, as it was -- nothing to save', [isl._config.size, isl.style.getPropertyValue('grid-row'), E.active().dirty()], ['regular', '', false]);
  // a badge by keyboard: Enter on it
  var k = lights._e.fire('keydown', mkEv({ key: 'Enter', path: [badge, isl, lights._e] }));
  eq('Enter on the badge toggles it', [isl._config.size, k.prevented > 0], ['tall', true]);
  E.cancel();
  eq('Cancel puts its size back', [isl._config.size, isl.style.getPropertyValue('grid-row')], [undefined, '']);
},
function () {
  H.section('Done: everything at once, each with the version read at the start');
  location.pathname = '/dashboard-hall/home';
  var h = who(true), v = viewOf(HOME), kit = groupNamed(v, 'Kitchen'), den = groupNamed(v, 'Den');
  REBUILDS = 0;
  E.enter(h, { viewEl: v });
  eq('Home: editing Home', E._.barTitle(), 'Editing Home');
  var a = tileOf(kit, 'switch.kitchen_coffee'), b = tileOf(kit, 'light.kitchen_cans');
  var p = centre(a); down(kit, a, 'mouse'); move(kit, p[0] - 9, p[1]);
  var to = centre(b); move(kit, to[0], to[1]); up(kit, to[0], to[1]);
  a = tileOf(den, 'light.den_reading'); b = tileOf(den, 'light.den_lamp');
  p = centre(a); down(den, a, 'mouse'); move(den, p[0] - 9, p[1]);
  to = centre(b); move(den, to[0], to[1]); up(den, to[0], to[1]);
  var badge = tileOf(den, 'light.den_lamp').shadowRoot.children.filter(function (c) { return /hk-edit-size/.test(c.className || ''); })[0];
  den._e.fire('click', mkEv({ path: [badge, den._e] }));
  var done = E.done();
  eq('nothing is sent before the versions are in', h.sent.length, 0);
  ok('...the bar is busy', buttons().done.disabled === true);
  h.reads[0].res({ versions: { accessories: 'v1' } });
  return settle().then(function () {
    eq('the first: the Kitchen, with the version read at the start', [h.sent.length, h.sent[0].msg.area_id, h.sent[0].msg.expect_version], [1, 'kitchen', 'v1']);
    eq('...its whole list: the coffee first, the one not on Home where it was', h.sent[0].msg.entities.slice(0, 3),
       ['switch.kitchen_coffee', 'light.kitchen_hidden', 'light.kitchen_cans']);
    h.sent[0].res({ entities: [], version: 'v2' });
    return settle();
  }).then(function () {
    eq('one at a time: the next carries the version the last answer gave', [h.sent.length, h.sent[1].msg.area_id, h.sent[1].msg.expect_version], [2, 'den', 'v2']);
    h.sent[1].res({ entities: [], version: 'v3' });
    return settle();
  }).then(function () {
    eq('...then the size', [h.sent[2].msg.type, h.sent[2].msg.entity_id, h.sent[2].msg.size, h.sent[2].msg.expect_version],
       ['hk_frontend/accessory/set', 'light.den_lamp', 'tall', 'v3']);
    ok('the page is told the change is this screen\'s own (it rebuilds at once)', window.hkStrategy._built.mine > 0);
    h.sent[2].res({ version: 'v4' });
    return done;
  }).then(function (r) {
    eq('Done resolves saved', r, 'saved');
    eq('...and leaves Edit mode', E.active(), null);
    eq('...the new order stays on the page until it is rebuilt', ids(kit)[0], 'switch.kitchen_coffee');
    eq('Done with nothing changed just leaves', (function () { E.enter(h, { viewEl: v }); return E.active() !== null; })(), true);
    return E.done();
  }).then(function (r) {
    eq('...sending nothing', [r, h.sent.length, E.active()], ['nothing', 3, null]);
    location.pathname = '/dashboard-hall/room-kitchen';
  });
},
function () {
  H.section('someone else changed it meanwhile: "This page changed", Reload or Save Anyway');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  function drag() {
    var a = tileOf(lights, 'light.kitchen_pendant'), b = tileOf(lights, 'light.kitchen_cans');
    var p = centre(a); down(lights, a, 'mouse'); move(lights, p[0] - 9, p[1]);
    var to = centre(b); move(lights, to[0], to[1]); up(lights, to[0], to[1]);
  }
  E.enter(h, { viewEl: v });
  h.reads[0].res({ versions: { accessories: 'v1' } });
  drag();
  CONFIRMS.length = 0;
  var done = E.done();
  return settle().then(function () {
    h.sent[0].rej({ code: 'conflict', message: 'accessories changed meanwhile' });
    return done;
  }).then(function (r) {
    eq('Done answers "conflict"', r, 'conflict');
    eq('the prompt: the grid editor\'s, for this page', [CONFIRMS.length, CONFIRMS[0].text, CONFIRMS[0].opts.no, CONFIRMS[0].opts.yes],
       [1, 'This page changed since you started editing', 'Reload', 'Save Anyway']);
    ok('...saying what each does', /Reload/.test(CONFIRMS[0].opts.detail) && /Save Anyway/.test(CONFIRMS[0].opts.detail));
    eq('dismissed (Escape, a tap outside): still editing, nothing lost', [!!E.active(), E.active() && E.active().dirty(), buttons().done.disabled], [true, true, false]);
    // Save Anyway: sent again without the version
    CONFIRMS[0].onOk();
    return settle();
  }).then(function () {
    eq('Save Anyway: sent again, without a version', [h.sent.length, 'expect_version' in h.sent[1].msg, h.sent[1].msg.area_id], [2, false, 'kitchen']);
    h.sent[1].res({ entities: [] });
    return settle();
  }).then(function () {
    eq('...and done', E.active(), null);
    // Reload
    v = viewOf(KITCHEN); lights = groupNamed(v, 'Lights');
    h = who(true);
    E.enter(h, { viewEl: v });
    h.reads[0].res({ versions: { accessories: 'v1' } });
    drag();
    CONFIRMS.length = 0; REBUILDS = 0;
    var d2 = E.done();
    return settle().then(function () { h.sent[0].rej({ code: 'conflict' }); return d2; });
  }).then(function () {
    CONFIRMS[0].opts.onNo();
    eq('Reload: out of Edit mode, the page put back and built again from the settings', [E.active(), ids(lights)[0], REBUILDS],
       [null, 'light.kitchen_cans', 1]);
    // another error: said in the bar, still editing
    v = viewOf(KITCHEN); lights = groupNamed(v, 'Lights');
    h = who(true);
    E.enter(h, { viewEl: v });
    h.reads[0].rej({ message: 'no panel' });
    drag();
    var d3 = E.done();
    return settle().then(function () {
      eq('no versions to be had: sent without one', 'expect_version' in h.sent[0].msg, false);
      h.sent[0].rej({ code: 'unauthorized', message: 'Admins only' });
      return d3;
    });
  }).then(function (r) {
    eq('another error: said, and still editing', [r, !!E.active(), /Admins only/.test(E._.barMessage())], ['failed', true, true]);
    E.cancel();
  });
},
function () {
  H.section('Escape is Cancel; leaving the page asks first');
  var h = who(true), v = viewOf(KITCHEN), lights = groupNamed(v, 'Lights');
  E.enter(h, { viewEl: v });
  window.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: function () {}, preventDefault: function () {} });
  eq('Escape: out, nothing saved', [E.active(), h.sent.length], [null, 0]);
  // not dirty: navigating just leaves
  E.enter(h, { viewEl: v });
  NAV.length = 0;
  window.hkShell.navigate('/dashboard-hall/weather');
  eq('nothing changed: a navigation leaves Edit mode and goes', [E.active(), NAV], [null, ['/dashboard-hall/weather']]);
  location.pathname = '/dashboard-hall/room-kitchen';
  // dirty: asked
  E.enter(h, { viewEl: v });
  var a = tileOf(lights, 'light.kitchen_pendant'), b = tileOf(lights, 'light.kitchen_cans');
  var p = centre(a); down(lights, a, 'mouse'); move(lights, p[0] - 9, p[1]);
  var to = centre(b); move(lights, to[0], to[1]); up(lights, to[0], to[1]);
  NAV.length = 0; CONFIRMS.length = 0;
  window.hkShell.navigate('/dashboard-hall/weather');
  eq('with changes: asked first, and not gone yet', [CONFIRMS.length, NAV.length, !!E.active()], [1, 0, true]);
  eq('...the question', [CONFIRMS[0].text, CONFIRMS[0].opts.yes, CONFIRMS[0].opts.no], ['Discard your changes to this page?', 'Discard', 'Keep Editing']);
  var un = { preventDefault: function () { un.n = 1; }, type: 'beforeunload' };
  window.dispatchEvent(un);
  eq('closing or reloading the window asks too (beforeunload)', un.n, 1);
  CONFIRMS[0].onOk();
  eq('Discard: put back, out, and gone', [E.active(), ids(lights)[0], NAV], [null, 'light.kitchen_cans', ['/dashboard-hall/weather']]);
  var un2 = { preventDefault: function () { un2.n = 1; }, type: 'beforeunload' };
  window.dispatchEvent(un2);
  eq('...and the window no longer asks', un2.n, undefined);
  location.pathname = '/dashboard-hall/room-kitchen';
  ok('hkShell.navigate is itself again', !window.hkShell.navigate.__hkEdit);
},
function () {
  H.section('extra bar buttons (phase G\'s Rooms) and a surface\'s note');
  var h = who(true), v = viewOf(KITCHEN), ran = [];
  E.button({ id: 'test-rooms', label: 'Rooms', show: function (s) { return s.path === 'room-kitchen'; }, run: function (s) { ran.push(s.title); } });
  E.surface({ id: 'test-note', offers: function () { return false; },
              enter: function (ctx) { return { note: 'Lights keep this order on their room pages too.', saves: function () { return []; },
                                               restore: function () {}, leave: function () {} }; } });
  E.enter(h, { viewEl: v });
  var ex = buttons().extra;
  eq('the extra button is in the bar', ex.children.map(function (b) { return b.textContent; }), ['Rooms']);
  ex.children[0].click();
  eq('...and runs with the session', ran, ['Kitchen']);
  eq('a surface\'s note shows under the title', E._.barNote(), 'Lights keep this order on their room pages too.');
  E.leave();
  E._.unregister('test-note'); E._.unbutton('test-rooms');
},
function () {
  H.section('the strategy waits while editing, and is told how to rebuild');
  ok('hkStrategy.rebuild is exported (Cancel/Reload)', /rebuild:\s*refreshKeepingPlace/.test(read(HK_ROOT + '/frontend/cards/hk-strategy.js')));
  var now = Date.now;
  Date.now = function () { return now() + 60000; };       // nobody has touched the screen for a minute
  eq('not editing (and untouched a while): not busy', window.hkStrategy._busy(), false);
  E.enter(who(true), { viewEl: viewOf(KITCHEN) });
  eq('...editing: busy', window.hkStrategy._busy(), true);
  E.leave();
  Date.now = now;
}
]);
