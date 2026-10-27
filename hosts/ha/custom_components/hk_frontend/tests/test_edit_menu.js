// EDIT MODE'S MENU, TAB BAR AND ROOM ORDER (modules/hk-edit-menu.js, plan
// phase G): in Edit mode the side menu, the tab bar and its More sheet
// arrange the SAME lists -- the screen's page order (`pages`), what is at the
// top of the menu (`menu_top`), what is under Categories (`categories`) and
// the room order (`room_order`, `menu_rooms`) -- shown at once in all three
// (the menu's board, previewed) and saved on Done in one board/set (or, for
// a screen whose Rooms are All Screens', the room order in settings/set with
// the house settings' version, versions["house"]).
// A fictional house; nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run edit_menu');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
location.pathname = '/dashboard-hall/room-kitchen';
globalThis.history = { pushState: function (s, t, p) { location.pathname = p; }, replaceState: function (s, t, p) { location.pathname = p; } };
window.innerHeight = 800;

var BOARD = {};
var FEED = { accessories: { entities: {}, rooms: {} }, generated: {}, boards: { 'dashboard-hall': BOARD } };
function setBoard(b) { BOARD = b; FEED.boards = { 'dashboard-hall': b }; window.hkSettings.version++; }
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
load(HK_ROOT + '/frontend/modules/hk-menu.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/modules/hk-edit.js');
load(HK_ROOT + '/frontend/modules/hk-edit-menu.js');

var ok = H.ok, eq = H.eq, E = window.hkEdit, EM = window.hkEditMenu, X = EM && EM._;

// ---- a generated screen's views (hk-strategy.js: its pages in page order,
// Weather and Cameras at the top of the menu, Browse Music only another
// address of Music, a custom page, the rooms -- one of them two areas)
var VIEWS = [
  { title: 'Home', path: 'home', cards: [{ type: 'custom:hk-grid-card', cards: [{ type: 'custom:hk-light-card', entity: 'light.k', hk_place: { area: 'kitchen' } }] }] },
  { title: 'Weather', path: 'weather', menu: 'top', icon: 'mdi:weather-partly-cloudy' },
  { title: 'Cameras', path: 'cameras', menu: 'top', icon: 'mdi:camera' },
  { title: 'Security', path: 'security', icon: 'mdi:lock' },
  { title: 'Climate', path: 'climate', icon: 'mdi:thermostat' },
  { title: 'Lights', path: 'lights', icon: 'mdi:lightbulb' },
  { title: 'Timers', path: 'timers', icon: 'mdi:timer' },
  { title: 'Music', path: 'playmusic', icon: 'mdi:speaker' },
  { title: 'Music', path: 'music-browse', menu_follows: 'playmusic', menu: false },
  { title: 'Garden', path: 'garden', icon: 'mdi:flower' },
  { title: 'Kitchen', path: 'room-kitchen', area: 'kitchen', cards: [{ type: 'custom:hk-light-card', entity: 'light.k', hk_place: { area: 'kitchen', group: 'Lights' } }] },
  { title: 'Den', path: 'room-den', area: 'den' },
  { title: 'Yard', path: 'room-yard', area: ['yard', 'deck'] },
  { title: 'Attic', path: 'room-attic', area: 'attic' }
];
var CFG = { views: VIEWS };
var AREAS = { kitchen: { name: 'Kitchen', icon: 'mdi:silverware-fork-knife' }, den: { name: 'Den' },
              yard: { name: 'Yard', icon: 'mdi:pine-tree' }, deck: { name: 'Deck' }, attic: { name: 'Attic' } };
window.hkCards.menu.config = function () { return CFG; };
window.hkCards.menu.dash = function () { return 'dashboard-hall'; };
var CTX = { cfg: CFG, areas: AREAS, dash: 'dashboard-hall', user: 'u1' };
var B0 = { custom_pages: ['garden'], pages: [], menu_top: [], categories: [], room_order: [], menu_rooms: 'az',
           home_rooms: 'as_is', page_rooms: 'floor', rooms_custom: false };
function b(o) { return Object.assign({}, B0, o || {}); }
function names(list) { return list.map(function (it) { return it.title; }).join(','); }
function menuOf(bb) { var m = X.modelOf(CTX, bb); return { top: names(m.top), cats: names(m.categories), rooms: names(m.rooms) }; }
function after(bb, patch) { return menuOf(Object.assign({}, bb, patch || {})); }

function who(admin) {
  var sent = [], reads = [];
  var h = { user: { id: 'u1', name: 'Fictional Person', is_admin: admin }, states: {}, areas: AREAS, entities: {},
            floors: {}, devices: {}, themes: { themes: {} },
            callWS: function (m) { return new Promise(function (res, rej) { reads.push({ msg: m, res: res, rej: rej }); }); },
            actions: { callWS: function (m) { return new Promise(function (res, rej) { sent.push({ msg: m, res: res, rej: rej }); }); } } };
  h.sent = sent; h.reads = reads;
  return h;
}
var CONFIRMS = [];
window.hkCards.confirmSheet = function (text, onOk, opts) { CONFIRMS.push({ text: text, onOk: onOk, opts: opts || {} }); return {}; };
window.hkStrategy = { rebuild: function () {}, ownChange: function () {} };
function viewEl() { return new El('div'); }

H.run('EDIT MENU', [
function () {
  H.section('the module');
  ok('hkEditMenu is there', !!EM && !!X);
  ok('it is a surface of Edit mode (registered once hkEdit is there)', E.surfaces().indexOf('menu') >= 0, E.surfaces());
  eq('...that makes no page editable by itself (the menu is on every page)', E.editable(VIEWS[3]), false);
  var loader = read(HK_ROOT + '/frontend/modules/hk-loader.js');
  ok('hk-loader.js loads it, after hk-edit.js', /'hk-edit\.js'[\s\S]*'hk-edit-menu\.js'/.test(loader));
},
function () {
  H.section('the page order as kinds: a page\'s key, the whole list written down');
  eq('a kind by its view path', [X.keyOf('live-tv', b()), X.keyOf('playmusic', b()), X.keyOf('doors-windows', b())], ['live_tv', 'music', 'doors_windows']);
  eq('a custom page by its address', X.keyOf('garden', b()), 'garden');
  eq('a room page or an unknown view: none (it is not in the page order)', [X.keyOf('room-den', b()), X.keyOf('mystery', b())], [null, null]);
  eq('Browse Music is never a page of its own', X.keyOf('music-browse', b()), null);
  eq('no order chosen: every kind in the generated order, the custom pages before the rooms',
     X.fullPages(b()), ['weather', 'calendar', 'cameras', 'live_tv', 'security', 'doors_windows', 'climate', 'lights', 'timers',
                        'vacuums', 'music', 'water', 'energy', 'power', 'garden', 'rooms']);
  eq('an order chosen: as it is (an older `browse` dropped), a custom page it lacks before the rooms',
     X.fullPages(b({ pages: ['lights', 'browse', 'weather', 'rooms'] })), ['lights', 'weather', 'garden', 'rooms']);
  eq('fillSlots: the pages moved take the slots they held, the rest stay put',
     X.fillSlots(['a', 'b', 'c', 'd', 'e'], ['d', 'b']), ['a', 'd', 'c', 'b', 'e']);
},
function () {
  H.section('the menu sorts its top pages by the page order (so a drag there can be saved)');
  eq('the screen as it is', menuOf(b()), { top: 'Weather,Cameras', cats: 'Security,Climate,Lights,Timers,Music,Garden', rooms: 'Attic,Den,Kitchen,Yard' });
  eq('a page order with Cameras first: Cameras above Weather',
     menuOf(b({ pages: ['cameras', 'weather', 'security', 'climate', 'lights', 'timers', 'music', 'garden', 'rooms'] })).top, 'Cameras,Weather');
},
function () {
  H.section('a drag within Categories: the page order, nothing else');
  var p = X.menuMove(CTX, b(), 'timers', 'categories', 0);
  eq('Timers to the top of Categories: only `pages` changes', Object.keys(p), ['pages']);
  eq('...and the menu shows it', after(b(), p).cats, 'Timers,Security,Climate,Lights,Music,Garden');
  eq('...the top as it was', after(b(), p).top, 'Weather,Cameras');
  eq('...the pages not in the menu keep their places', p.pages.slice(0, 4), ['weather', 'calendar', 'cameras', 'live_tv']);
  eq('nothing moved: nothing to save', X.menuMove(CTX, b(), 'security', 'categories', 0), {});
},
function () {
  H.section('Top ⇄ Categories');
  var p = X.menuMove(CTX, b(), 'cameras', 'categories', 1);
  eq('Cameras down among the categories, second: the top is written down', p.menu_top, ['weather']);
  eq('...Categories stays automatic (every page is listed anyway)', 'categories' in p, false);
  eq('...in its place', after(b(), p), { top: 'Weather', cats: 'Security,Cameras,Climate,Lights,Timers,Music,Garden', rooms: 'Attic,Den,Kitchen,Yard' });
  var q = X.menuMove(CTX, b(), 'lights', 'top', 0);
  eq('Lights up to the top, first', after(b(), q), { top: 'Lights,Weather,Cameras', cats: 'Security,Climate,Timers,Music,Garden', rooms: 'Attic,Den,Kitchen,Yard' });
  eq('...the top as a list of its own', q.menu_top.slice().sort(), ['cameras', 'lights', 'weather']);
  var all = X.menuMove(CTX, b({ menu_top: [] }), 'weather', 'categories', 0);
  var both = X.menuMove(CTX, Object.assign(b(), all), 'cameras', 'categories', 0);
  eq('the last page off the top: nothing at the top ("-", not the views\' own)', Object.assign({}, all, both).menu_top, ['-']);
  var cb = b({ categories: ['security', 'lights'] });
  eq('chosen categories: as chosen', menuOf(cb).cats, 'Security,Lights');
  var r = X.menuMove(CTX, cb, 'weather', 'categories', 1);
  eq('...Weather in among them, so it joins the chosen list', [r.categories && r.categories.join(','), after(cb, r).cats], ['security,weather,lights', 'Security,Weather,Lights']);
},
function () {
  H.section('hide and show (the `categories` choice)');
  var p = X.hide(CTX, b(), 'timers');
  eq('Timers hidden while Categories is automatic: the list is written down first, less Timers',
     p.categories, ['security', 'climate', 'lights', 'playmusic', 'garden']);
  eq('...so nothing else changes', after(b(), p), { top: 'Weather,Cameras', cats: 'Security,Climate,Lights,Music,Garden', rooms: 'Attic,Den,Kitchen,Yard' });
  var hb = Object.assign(b(), p);
  eq('...and it is listed as not in the menu', X.hiddenOf(CTX, hb).map(function (it) { return it.path; }), ['timers']);
  eq('nothing hidden: nothing listed (Browse Music is Music\'s, not a page)', X.hiddenOf(CTX, b()).length, 0);
  var s = X.unhide(CTX, hb, 'timers');
  eq('shown again: back in its place in the page order', after(hb, s).cats, 'Security,Climate,Lights,Timers,Music,Garden');
  eq('...without moving a page', 'pages' in s, false);
  var t = X.hide(CTX, b(), 'weather');
  eq('a top page hidden: off the top, and not down in Categories either', after(b(), t), { top: 'Cameras', cats: 'Security,Climate,Lights,Timers,Music,Garden', rooms: 'Attic,Den,Kitchen,Yard' });
  var one = b({ categories: ['lights'] });
  eq('the last category cannot be hidden (an empty list is automatic: every page)', X.hide(CTX, one, 'lights'), null);
},
function () {
  H.section('the tab bar: Home and the first categories that fit; More holds the top, the rest and the rooms');
  // four category tabs fit (V = 4): Security, Climate, Lights, Timers; More: Weather, Cameras, Music, Garden
  var V = 4;
  var p = X.tabMove(CTX, b(), 'lights', 0);
  eq('a tab dragged along the bar: the page order', after(b(), p).cats, 'Lights,Security,Climate,Timers,Music,Garden');
  var q = X.toMore(CTX, b(), 'climate', V);
  eq('a tab dropped on More: first past the fit, the first in More comes forward',
     after(b(), q).cats, 'Security,Lights,Timers,Music,Climate,Garden');
  eq('...the bar\'s tabs then', X.lists(X.modelOf(CTX, Object.assign(b(), q))).cats.slice(0, V), ['security', 'lights', 'timers', 'playmusic']);
  var few = b({ categories: ['security', 'climate', 'lights'] });
  var r = X.toMore(CTX, few, 'climate', V);
  eq('...with nothing past the fit: More\'s top pages take it', after(few, r), { top: 'Weather,Cameras,Climate', cats: 'Security,Lights', rooms: 'Attic,Den,Kitchen,Yard' });
  var f = X.forward(CTX, b(), 'garden', 1, V);
  eq('a page in More dragged onto the bar: in at that place, the last tab out to More',
     X.lists(X.modelOf(CTX, Object.assign(b(), f))).cats.slice(0, V), ['security', 'garden', 'climate', 'lights']);
  var g = X.forward(CTX, b(), 'weather', 0, V);
  eq('...a top page too: it leaves the top', after(b(), g), { top: 'Cameras', cats: 'Weather,Security,Climate,Lights,Timers,Music,Garden', rooms: 'Attic,Den,Kitchen,Yard' });
  eq('...dropped past the last tab: the last place on the bar, not More', X.lists(X.modelOf(CTX, Object.assign(b(), X.forward(CTX, b(), 'playmusic', 9, V)))).cats.slice(0, V),
     ['security', 'climate', 'lights', 'playmusic']);
  // More's pages: Weather, Cameras | Music, Garden
  var m1 = X.moreMove(CTX, b(), 'garden', 2, V);
  eq('More\'s grid: Garden before Music', after(b(), m1).cats, 'Security,Climate,Lights,Timers,Garden,Music');
  var m2 = X.moreMove(CTX, b(), 'playmusic', 0, V);
  eq('...Music among the top pages: it goes to the top', after(b(), m2).top, 'Music,Weather,Cameras');
  var m3 = X.moreMove(CTX, b(), 'weather', 3, V);
  eq('...Weather dropped on the last cell: down into Categories, last', after(b(), m3), { top: 'Cameras', cats: 'Security,Climate,Lights,Timers,Music,Garden,Weather', rooms: 'Attic,Den,Kitchen,Yard' });
  var m4 = X.moreMove(CTX, b(), 'weather', 2, V);
  eq('...on Garden\'s cell: before it (the place it is dropped on is its new place)', after(b(), m4).cats, 'Security,Climate,Lights,Timers,Music,Weather,Garden');
},
function () {
  H.section('the Room Order sheet');
  var rs = new X.RoomSheet(CTX, b());
  eq('every room on this screen, as the menu has them now (A to Z)', names(rs.list()), 'Attic,Den,Kitchen,Yard');
  rs.move(3, 0);
  eq('a drag: Yard first', names(rs.list()), 'Yard,Attic,Den,Kitchen');
  rs.down(0);
  eq('Move Down', names(rs.list()), 'Attic,Yard,Den,Kitchen');
  rs.up(3);
  eq('Move Up', names(rs.list()), 'Attic,Yard,Kitchen,Den');
  rs.up(0); rs.down(3);
  eq('...not past either end', names(rs.list()), 'Attic,Yard,Kitchen,Den');
  var p = rs.patch();
  eq('saved as areas, a combined room by its areas in turn, the menu switched to the room order',
     p, { room_order: ['attic', 'yard', 'deck', 'kitchen', 'den'], menu_rooms: 'order' });
  eq('...and the menu shows it', after(b(), p).rooms, 'Attic,Yard,Kitchen,Den');
  rs.az();
  eq('A to Z puts it back', names(rs.list()), 'Attic,Den,Kitchen,Yard');
  eq('...which still fixes the order (A to Z, from now on in the room order)', rs.patch().menu_rooms, 'order');
  var fresh = new X.RoomSheet(CTX, b());
  eq('opened and closed: nothing to save', fresh.patch(), {});
  // a combined room placed by its first area; a house order with other screens' rooms in it
  var hb = b({ room_order: ['deck', 'pantry', 'kitchen', 'yard', 'den'], menu_rooms: 'order' });
  var rh = new X.RoomSheet(CTX, hb);
  eq('a saved order: the sheet starts from it (the combined room where its first-listed area is)', names(rh.list()), 'Yard,Kitchen,Den,Attic');
  rh.move(1, 0);
  eq('...another screen\'s room (the pantry) keeps its slot; this screen\'s rooms take theirs',
     rh.patch().room_order, ['kitchen', 'pantry', 'yard', 'deck', 'den', 'attic']);
  eq('...the menu already in the room order: not sent again', 'menu_rooms' in rh.patch(), false);
  var ab = b({ room_order: ['kitchen', 'den'], menu_rooms: 'az' });
  eq('a room order Home uses while the menu is A to Z: the sheet shows the room order (the rest as the menu would: the dashboard\'s order)',
     names(new X.RoomSheet(CTX, ab).list()), 'Kitchen,Den,Yard,Attic');
  var only = b({ room_order: ['den', 'kitchen'], home_rooms: 'only', menu_rooms: 'order' });
  var ro = new X.RoomSheet(CTX, only);
  eq('Home showing only some rooms: those are the order', names(ro.list()), 'Den,Kitchen');
  eq('...the others listed apart, not on Home', names(ro.others()), 'Yard,Attic');
  ro.move(1, 0);
  eq('...and only they are saved (the others stay off Home)', ro.patch().room_order, ['kitchen', 'den']);
},
function () {
  H.section('where the room order applies: the note');
  var n0 = X.noteOf(b());
  ok('the menu and the tab bar always', /menu/.test(n0) && /tab bar/.test(n0), n0);
  ok('Home lists its rooms its own way: said so', /Home/.test(n0) && !/Home’s room sections/.test(n0), n0);
  ok('All Screens\' rooms: every screen that follows them', /All Screens/.test(n0), n0);
  var n1 = X.noteOf(b({ home_rooms: 'order', page_rooms: 'order', rooms_custom: true }));
  ok('Home in the room order: Home’s room sections', /Home’s room sections/.test(n1), n1);
  ok('Rooms on Pages in the room order: Lights, Climate, Water', /Lights, Climate/.test(n1), n1);
  ok('a screen of its own: this screen only', /this screen/.test(n1) && !/All Screens/.test(n1), n1);
  ok('"only": Home too', /Home’s room sections/.test(X.noteOf(b({ home_rooms: 'only' }))));
},
function () {
  H.section('the save: one board/set with the keys that changed');
  var base = b();
  eq('nothing changed: nothing', X.savesOf(base, {}, 'dashboard-hall'), []);
  eq('a value set back as it was: nothing', X.savesOf(base, { pages: [] }, 'dashboard-hall'), []);
  var sv = X.savesOf(base, { pages: ['lights', 'rooms'], menu_top: ['weather'], categories: ['lights'] }, 'dashboard-hall');
  eq('pages, the top and Categories: one board/set on the screen\'s document', sv.map(function (s) { return [s.doc, s.msg.type, s.msg.dashboard]; }),
     [['board/dashboard-hall', 'hk_frontend/board/set', 'dashboard-hall']]);
  eq('...with just those keys', sv[0].msg.changes, { pages: ['lights', 'rooms'], menu_top: ['weather'], categories: ['lights'] });
  var own = X.savesOf(b({ rooms_custom: true }), { pages: ['lights', 'rooms'], room_order: ['den', 'kitchen'], menu_rooms: 'order' }, 'dashboard-hall');
  eq('a screen with Rooms of its own: the room order in the SAME board/set, the menu in the room order',
     own.map(function (s) { return [s.doc, s.msg.changes]; }), [['board/dashboard-hall', { pages: ['lights', 'rooms'], room_order: ['den', 'kitchen'], menu_rooms: 'order' }]]);
  var house = X.savesOf(base, { pages: ['lights', 'rooms'], room_order: ['den', 'kitchen'], menu_rooms: 'order' }, 'dashboard-hall');
  eq('a screen following All Screens\' Rooms: the page order on the screen, the room order on All Screens',
     house.map(function (s) { return [s.doc, s.msg.type, s.msg.changes]; }),
     [['board/dashboard-hall', 'hk_frontend/board/set', { pages: ['lights', 'rooms'] }],
      ['house', 'hk_frontend/settings/set', { 'rooms.order': ['den', 'kitchen'], 'rooms.menu': 'order' }]]);
},
function () {
  H.section('in Edit mode: the preview in the menu\'s board, Done, Cancel');
  setBoard(b());
  location.pathname = '/dashboard-hall/room-kitchen';
  var h = who(true);
  eq('enter Edit on a room page', E.enter(h, { viewEl: viewEl() }), true);
  ok('the menu part is in the session', EM.on());
  ok('the bar has a Rooms button', E._.barButtons().extra.children.some(function (x) { return x.textContent === 'Rooms'; }));
  var evts = 0;
  window.addEventListener('hk-edit', function () { evts++; });
  eq('a drag in the menu', EM.menuMove('timers', 'categories', 0), true);
  var mb = window.hkCards.menu.board();
  eq('...is in the board the menu, the tab bar and Home read: at once', mb.pages && mb.pages.indexOf('timers') < mb.pages.indexOf('security'), true);
  ok('...and they are told to draw again', evts > 0);
  EM.roomsApply([2, 0, 1, 3]);
  eq('the Room Order sheet closed with Kitchen first: the menu\'s rooms at once', names(EM.model().rooms), 'Kitchen,Attic,Den,Yard');
  eq('...the menu switched to the room order (preview)', window.hkCards.menu.board().menu_rooms, 'order');
  ok('the session is dirty', E.active().dirty());
  h.reads[0].res({ versions: { 'board/dashboard-hall': 7, accessories: 'v1', house: 'h1' } });
  return H.tick(6).then(function () {
    var done = E.done();
    return H.tick(6).then(function () {
      eq('Done: the screen\'s board/set first, with its version', [h.sent[0].msg.type, h.sent[0].msg.expect_version, Object.keys(h.sent[0].msg.changes)],
         ['hk_frontend/board/set', 7, ['pages']]);
      h.sent[0].res({ version: 8 });
      return H.tick(6);
    }).then(function () {
      eq('...then All Screens\' room order, with the house settings\' version', [h.sent[1].msg.type, h.sent[1].msg.expect_version, h.sent[1].msg.changes],
         ['hk_frontend/settings/set', 'h1', { 'rooms.order': ['kitchen', 'attic', 'den', 'yard', 'deck'], 'rooms.menu': 'order' }]);
      h.sent[1].res({ settings: {}, version: 'h2' });
      return done;
    }).then(function (r) {
      eq('saved', r, 'saved');
      eq('out of Edit mode', [E.active(), EM.on()], [null, false]);
      eq('the saved order stays shown until the feed brings it', window.hkCards.menu.board().menu_rooms, 'order');
      setBoard(b({ pages: window.hkCards.menu.board().pages, room_order: ['kitchen', 'attic', 'den', 'yard', 'deck'], menu_rooms: 'order' }));
      eq('...and then it is the feed\'s', names(EM.model().rooms), 'Kitchen,Attic,Den,Yard');
    });
  });
},
function () {
  H.section('Cancel puts the menu back; a conflict is the screen\'s document\'s');
  setBoard(b({ rooms_custom: true }));
  var h = who(true);
  E.enter(h, { viewEl: viewEl() });
  EM.hide('climate');
  eq('Climate hidden (preview)', names(EM.model().categories).indexOf('Climate'), -1);
  E.cancel();
  eq('Cancel: back', names(EM.model().categories), 'Security,Climate,Lights,Timers,Music,Garden');
  eq('...and the board too', window.hkCards.menu.board().categories, []);
  E.enter(h, { viewEl: viewEl() });
  h.reads[h.reads.length - 1].res({ versions: { 'board/dashboard-hall': 3 } });
  EM.roomsApply([1, 0, 2, 3]);
  var sv = E.active().saves();
  eq('Rooms of its own: one board/set, room order and menu_rooms', sv.map(function (s) { return [s.doc, s.msg.changes]; }),
     [['board/dashboard-hall', { room_order: ['den', 'attic', 'kitchen', 'yard', 'deck'], menu_rooms: 'order' }]]);
  var n = h.sent.length;
  var done = E.done();
  return H.tick(8).then(function () {
    eq('sent with the version read as Edit began', h.sent[n].msg.expect_version, 3);
    var err = new Error('changed'); err.code = 'conflict';
    h.sent[n].rej(err);
    return done;
  }).then(function (r) {
    eq('someone else changed the screen meanwhile: conflict', r, 'conflict');
    eq('...the page asks (Reload or Save Anyway)', CONFIRMS.length && CONFIRMS[CONFIRMS.length - 1].text, 'This page changed since you started editing');
    ok('...still editing, the order still shown', EM.on() && names(EM.model().rooms) === 'Den,Attic,Kitchen,Yard');
    CONFIRMS[CONFIRMS.length - 1].opts.onNo();
    eq('Reload: the order as it was', names(EM.model().rooms), 'Attic,Den,Kitchen,Yard');
  });
},
function () {
  H.section('All Screens\' room order changed meanwhile: a conflict too (settings/set with versions["house"])');
  setBoard(b());
  location.pathname = '/dashboard-hall/room-kitchen';
  var h = who(true);
  E.enter(h, { viewEl: viewEl() });
  h.reads[h.reads.length - 1].res({ versions: { 'board/dashboard-hall': 3, house: 'h1' } });
  EM.roomsApply([1, 0, 2, 3]);
  var sv = E.active().saves();
  eq('only the rooms changed: one settings/set on the house settings', sv.map(function (s) { return [s.doc, s.msg.type]; }),
     [['house', 'hk_frontend/settings/set']]);
  var n = h.sent.length, done = E.done();
  return H.tick(8).then(function () {
    eq('sent with the house settings\' version read as Edit began', h.sent[n].msg.expect_version, 'h1');
    var err = new Error('changed'); err.code = 'conflict';
    h.sent[n].rej(err);
    return done;
  }).then(function (r) {
    eq('someone else changed All Screens\' rooms meanwhile: conflict', r, 'conflict');
    eq('...the page asks', CONFIRMS[CONFIRMS.length - 1].text, 'This page changed since you started editing');
    CONFIRMS[CONFIRMS.length - 1].onOk();
    return H.tick(8);
  }).then(function () {
    eq('Save Anyway: the same save again, without a version', [h.sent[n + 1].msg.type, 'expect_version' in h.sent[n + 1].msg],
       ['hk_frontend/settings/set', false]);
    h.sent[n + 1].res({ settings: {}, version: 'h2' });
    return H.tick(8);
  }).then(function () {
    eq('saved: out of Edit mode', E.active(), null);
  });
}
]);
