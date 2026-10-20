// The menu of pages and rooms (modules/hk-menu.js) and the state every way
// into it reads (hk-base.js hkCards.menu): what the menu lists, which button
// opens it, and where a room heading leads. Nothing here names a real house.
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

// ---- a page to read from: the settings, the URL and the dashboard's config
var SETTINGS = {};
window.hkSettings = { get: function (path, fb) {
  var v = SETTINGS, p = String(path).split('.');
  for (var i = 0; i < p.length; i++) { if (v == null) break; v = v[p[i]]; }
  return v == null ? fb : v;
} };
location.pathname = '/dashboard-hall/0';
var CFG = null;
var panelW = 1280;
var panel = { get lovelace() { return { config: CFG }; }, getBoundingClientRect: function () {
  return { left: 0, top: 0, width: panelW, height: 800, right: panelW, bottom: 800 }; } };
var main = { shadowRoot: { querySelector: function (s) { return s === 'ha-panel-lovelace' ? panel : null; } } };
var ha = { shadowRoot: { querySelector: function (s) { return s === 'home-assistant-main' ? main : null; } } };
document.querySelector = function (s) { return s === 'home-assistant' ? ha : null; };
window.innerWidth = 1280;

load(root + '/frontend/cards/hk-base.js');
load(root + '/frontend/cards/hk-layout.js');
load(root + '/frontend/cards/hk-stat.js');
load(root + '/frontend/modules/hk-menu.js');
var C = window.hkCards, M = C.menu, model = window.hkMenu._.model, isHere = window.hkMenu._.isHere;

var AREAS = {
  kitchen: { name: 'Kitchen', icon: 'mdi:silverware-fork-knife' },
  den: { name: 'Den', icon: null },
  attic: { name: 'Attic', icon: 'mdi:archive' },
  yard: { name: 'Back Yard', icon: 'mdi:pine-tree' },
  deck: { name: 'Deck' }
};
var VIEWS = [
  { title: 'Hall', path: 'hall', cards: [] },
  { title: 'Weather', path: 'weather', icon: 'mdi:weather-partly-cloudy', menu: 'top' },
  { title: 'Lights & Outlets', menu_title: 'Lights', path: 'lights', icon: 'mdi:lightbulb' },
  { title: 'Browse Music', path: 'music-browse', menu: false },
  { title: 'Kitchen', path: 'room-kitchen', area: 'kitchen', subview: true },
  { path: 'untitled' },
  { title: 'Den', area: 'den' },
  { title: 'Yard', path: 'room-yard', area: ['yard', 'deck'] },
  { title: 'Attic page', strategy: { type: 'custom:hk-room', area: 'attic' }, path: 'room-attic' },
  { title: 'Staff', path: 'staff', visible: [{ user: 'u-staff' }] },
  { title: 'Gone', path: 'gone', visible: false },
  { title: 'Energy', path: 'energy', icon: 'mdi:lightning-bolt' }
];

print('=== the list ===');
var m = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', user: 'u-me' });
ok('the first view is Home, whatever it is called', m.home.title === 'Home' && m.home.path === '/dashboard-hall/hall');
ok('menu: top sits beside Home', m.top.length === 1 && m.top[0].title === 'Weather');
// TOP OF THE MENU chosen by the screen: Energy promoted, Weather moved down
// among the categories
var mt = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', user: 'u-me', top: ['energy'] });
ok('a screen\'s own top: Energy under Home, Weather among the categories',
   mt.top.map(function (x) { return x.title; }).join() === 'Energy' &&
   mt.categories.map(function (x) { return x.title; }).join() === 'Weather,Lights',
   [mt.top.map(function (x) { return x.title; }), mt.categories.map(function (x) { return x.title; })]);
var mh = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', user: 'u-me', top: ['music-browse'] });
ok('...a page chosen for the top shows even with its view\'s menu: false',
   mh.top.map(function (x) { return x.title; }).join() === 'Browse Music');
ok('categories in the dashboard\'s order, menu_title wins, untitled and hidden left out',
   m.categories.map(function (x) { return x.title; }).join(',') === 'Lights,Energy',
   m.categories.map(function (x) { return x.title; }).join(','));
ok('a view hidden from this user is left out; one for everyone stays',
   !m.categories.some(function (x) { return x.title === 'Staff' || x.title === 'Gone'; }));
ok('rooms A to Z, by the page\'s own title, else the area\'s name',
   m.rooms.map(function (x) { return x.title; }).join(',') === 'Attic page,Den,Kitchen,Yard',
   m.rooms.map(function (x) { return x.title; }).join(','));
var yard = m.rooms.filter(function (x) { return x.title === 'Yard'; })[0];
ok('a room spanning two areas is named and pictured by the first', yard.icon === 'mdi:pine-tree' && yard.areas.join() === 'yard,deck');
ok('the room strategy\'s area counts', m.rooms.some(function (x) { return x.title === 'Attic page' && x.path === '/dashboard-hall/room-attic'; }));
ok('a room page with no title takes its area\'s name', model({ views: [{}, { area: 'yard' }] }, AREAS, {}).rooms[0].title === 'Back Yard');
ok('an area with no icon gets the room glyph', m.rooms.filter(function (x) { return x.title === 'Den'; })[0].icon === 'mdi:floor-plan');
ok('a view with no path is addressed by its index', m.rooms.filter(function (x) { return x.title === 'Den'; })[0].path === '/dashboard-hall/6');
var d = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', order: 'dashboard' });
ok('rooms in the dashboard\'s order when asked', d.rooms.map(function (x) { return x.title; }).join(',') === 'Kitchen,Den,Yard,Attic page');
ok('the Staff view shows for its own user', model({ views: VIEWS }, AREAS, { dash: 'x', user: 'u-staff' })
   .categories.some(function (x) { return x.title === 'Staff'; }));
ok('no config, no list', model(null, AREAS, {}).home === null);

var withHa = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', ha: true });
ok('the Home Assistant section, when on, is its own section -- not a top row',
   withHa.ha === true && withHa.top.map(function (x) { return x.title; }).join() === 'Weather');
ok('off, there is no section', m.ha === false);

// THE HOME ASSISTANT SECTION'S CONTENTS (haItems): Home Assistant's own pages,
// from its panels and this user's sidebar order -- read live, never stored.
var haItems = window.hkMenu._.haItems;
var PANELS = {
  lovelace: { title: null, icon: null },
  config: { title: 'config', icon: 'mdi:cog', require_admin: true },
  'config/integrations': { title: 'Integrations', icon: 'mdi:puzzle', require_admin: true },
  'config/automation': { title: 'Automations', icon: 'mdi:cogs', require_admin: true },
  map: { title: 'map', icon: 'mdi:map' },
  logbook: { title: 'logbook', icon: 'mdi:format-list-bulleted-type' },
  hacs: { title: 'HACS', icon: 'hacs:hacs', require_admin: true },
  'dashboard-hall': { title: 'Hall', icon: 'mdi:home', show_in_sidebar: true },
  'dashboard-den': { title: 'Den', icon: 'mdi:sofa', show_in_sidebar: false },
  home: { title: 'home', icon: 'mdi:home' },
  profile: { title: null }
};
var LOC = { 'panel.map': 'Map', 'panel.logbook': 'Activity', 'panel.home': 'Areas' };
function hassFor(admin) { return { user: { is_admin: admin }, panels: PANELS, localize: function (k) { return LOC[k] || ''; } }; }
var PREFS = { panelOrder: ['dashboard-hall', 'hacs', 'map'], hiddenPanels: ['home'] };
var titles = function (xs) { return xs.map(function (x) { return x.title; }).join(','); };
var adm = haItems(hassFor(true), PREFS, {});
ok('an admin: Integrations, Automations, Settings, Notifications, More, Show Menu, Profile',
   titles(adm) === 'Integrations,Automations,Settings,Notifications,More,Show Menu,Profile', titles(adm));
ok('...Settings carries the updates-and-repairs count, Notifications its own',
   adm[2].badge === 'settings' && adm[3].badge === 'notif' && !adm[0].badge);
ok('...each opens Home Assistant\'s own page', adm[0].path === '/config/integrations/dashboard' &&
   adm[1].path === '/config/automation/dashboard' && adm[2].path === '/config/dashboard' && adm[6].path === '/profile/general');
var open = haItems(hassFor(true), PREFS, { moreOpen: true });
var subs = open.filter(function (x) { return x.kind === 'sub'; });
ok('More opened: the rest of the sidebar, in this user\'s order, then A to Z',
   titles(subs) === 'Hall,HACS,Map,Activity', titles(subs));
ok('...titled as Home Assistant titles them (logbook is "Activity")', subs[3].title === 'Activity');
ok('...without what they hid, what is off the sidebar, or what More would repeat',
   !subs.some(function (x) { return /Areas|Den|Integrations|Automations|config/.test(x.title); }));
ok('...each a way to its page', subs[0].path === '/dashboard-hall' && subs[1].icon === 'hacs:hacs');
var user = haItems(hassFor(false), PREFS, { moreOpen: true });
ok('not an admin: no Integrations, Automations or Settings, and no admin-only pages',
   titles(user) === 'Notifications,More,Hall,Map,Activity,Show Menu,Profile', titles(user));
ok('Home Assistant\'s sidebar already on screen: no Show Menu',
   haItems(hassFor(true), PREFS, { sidebarShown: true }).every(function (x) { return x.kind !== 'ha'; }));
ok('no sidebar order saved: the pages A to Z', titles(haItems(hassFor(true), null, { moreOpen: true })
   .filter(function (x) { return x.kind === 'sub'; })) === 'Activity,Areas,HACS,Hall,Map');
ok('none of it is ever "here"', open.every(function (x) { return isHere(x, '/dashboard-hall/0') === false; }));

// WHERE HOME ASSISTANT IS (hkShell.haNav; a host outside Home Assistant, 2026-10-19): its sidebar when the
// host is Home Assistant or shows the page inside it; one row opening it when it is elsewhere; nothing when there
// is none to open. A row that could do nothing is never listed.
(function () {
  var H = window.hkMenu._, SH = window.hkShell;
  var was = { nav: SH.haNav, side: SH.sidebarData };
  ok('Home Assistant itself: its sidebar, as always', H.haNav() === 'own' &&
     titles(H.haList(PREFS, {})) === titles(haItems(SH.sidebarData(), PREFS, {})));
  SH.sidebarData = function () { var s = hassFor(false); s.prefs = { panelOrder: ['map'], hiddenPanels: ['logbook'] }; s.shown = true; return s; };
  var own = H.haList(PREFS, { moreOpen: true });
  ok('...a host\'s own sidebar order wins over the one read here', titles(own.filter(function (x) { return x.kind === 'sub'; })) === 'Map,Areas,Hall', titles(own));
  SH.haNav = function () { return { link: 'https://ha.home.example', top: true }; };
  var one = H.haList(PREFS, { moreOpen: true });
  ok('Home Assistant elsewhere: one row, opening its address', one.length === 1 && one[0].kind === 'halink' &&
     one[0].href === 'https://ha.home.example' && one[0].top === true && one[0].title === 'Open Home Assistant', JSON.stringify(one));
  var keyLink = H.haKey();
  SH.haNav = function () { return { link: 'javascript:alert(1)' }; };
  ok('...only an http(s) address', H.haList(PREFS, {}).length === 0 && H.haNav() === null);
  SH.haNav = function () { return null; };
  ok('nowhere to open it (a wall tablet): no rows', H.haList(PREFS, {}).length === 0 && H.haKey() === 'none' && keyLink !== 'none');
  var opened = [], assigned = [], wo = window.open, la = location.assign;
  window.open = function (u, t) { opened.push([u, t]); };
  location.assign = function (u) { assigned.push(u); };
  H.haOpen({ href: 'https://ha.home.example', top: true });
  H.haOpen({ href: 'https://ha.home.example', top: false });
  ok('the row opens it in the top window (a framed page) or this one', opened.length === 1 && opened[0][1] === '_top' &&
     assigned.length === 1 && assigned[0] === 'https://ha.home.example', JSON.stringify([opened, assigned]));
  window.open = wo; location.assign = la;
  SH.haNav = was.nav; SH.sidebarData = was.side;
})();

print('\n=== categories: the chips\' pages, or the ones chosen ===');
var chip = function (path, extra) {
  return Object.assign({ type: 'custom:hk-status-chip-card', tap_action: { action: 'navigate', navigation_path: path } }, extra || {});
};
var CHIPPED = [{ title: 'Hall', path: 'hall', cards: [{ type: 'custom:hk-row-card', cards: [
    chip('./energy'), chip('/dashboard-hall/lights'),
    { type: 'conditional', card: chip('./weather') },         // a top page: stays at the top
    chip('#alarm'),                                           // a pop-up is not a page
    { type: 'custom:hk-status-chip-card', tap_action: { action: 'more-info' } }] }] }].concat(VIEWS.slice(1));
var cp = window.hkMenu._.chipPaths(CHIPPED[0], 'dashboard-hall');
ok('the chips\' targets, in chip order, as view paths', cp.join() === 'energy,lights,weather', cp.join());
var mc = model({ views: CHIPPED }, AREAS, { dash: 'dashboard-hall', user: 'u-me' });
ok('by default Categories are the pages the chips open, in CHIP order',
   mc.categories.map(function (x) { return x.title; }).join() === 'Energy,Lights', mc.categories.map(function (x) { return x.title; }).join());
ok('...the top pages and the rooms are not affected', mc.top[0].title === 'Weather' && mc.rooms.length === 4);
var chosenM = model({ views: CHIPPED }, AREAS, { dash: 'dashboard-hall', user: 'u-me', categories: ['lights', 'music-browse', 'staff'] });
ok('chosen in Configure: only those, a view\'s own `menu: false` overruled',
   chosenM.categories.map(function (x) { return x.title; }).join() === 'Lights,Browse Music',
   chosenM.categories.map(function (x) { return x.title; }).join());
ok('...but never a view Home Assistant hides from this user', !chosenM.categories.some(function (x) { return x.title === 'Staff'; }));
ok('with no chips on Home, every titled page (as above)', m.categories.length === 2);
// THE CHIPS CARD: one hk-chips-card draws a chip per kind; the
// menu reads the screen's Chips (else the card's chips:, else every kind),
// each kind as the first of its pages the dashboard has, then its extra chips
var CARDED = [{ title: 'Hall', path: 'hall', cards: [{ type: 'custom:hk-chips-card',
    extra: [{ after: 'end', card: chip('./energy') }] }] },
  { title: 'Weather', path: 'weather', menu: 'top' }, { title: 'Alarm', path: 'alarm' },
  { title: 'Lights', path: 'lights' }, { title: 'Speakers', path: 'playmusic' },
  { title: 'Energy', path: 'energy' }, { title: 'Climate', path: 'climate' }];
var cc = window.hkMenu._.chipPaths(CARDED[0], 'dashboard-hall', { views: CARDED });
ok('every kind, as the pages there are (Security -> alarm, Blinds -> climate once), then the extra chip',
   cc.join() === 'weather,alarm,climate,lights,playmusic,energy', cc.join());
var cc2 = window.hkMenu._.chipPaths(CARDED[0], 'dashboard-hall', { views: CARDED, chips: ['lights', 'sensor.mail', 'speakers'] });
ok('...the screen\'s own Chips, in their order (an entity chip opens no page)', cc2.join() === 'lights,playmusic,energy', cc2.join());
var cc3 = window.hkMenu._.chipPaths(CARDED[0], 'dashboard-hall', { views: CARDED, row: false });
ok('...no chip row: only the chips written out', cc3.join() === 'energy', cc3.join());
var GEN = JSON.parse(JSON.stringify(CARDED)); GEN[0].cards[0].in_menu = false;
var mg = model({ views: GEN }, AREAS, { dash: 'dashboard-hall' });
ok('a generated screen\'s chips card (in_menu: false) picks nothing: every page is listed',
   mg.categories.map(function (x) { return x.title; }).join() === 'Alarm,Lights,Speakers,Energy,Climate',
   mg.categories.map(function (x) { return x.title; }).join());
var mcc = model({ views: CARDED }, AREAS, { dash: 'dashboard-hall', chips: ['climate', 'lights'] });
ok('automatic Categories on a chips-card Home are its chips\' pages, not just the written-out chip',
   mcc.categories.map(function (x) { return x.title; }).join() === 'Climate,Lights,Energy',
   mcc.categories.map(function (x) { return x.title; }).join());
// ORDER -> PAGES: a dashboard's page order ranks its pages here,
// and Browse Music follows Play Music
var PM = [{ title: 'Hall', path: 'hall', cards: [{ type: 'custom:hk-row-card', cards: [
    chip('./lights'), chip('./playmusic'), chip('./energy')] }] },
  { title: 'Lights', path: 'lights' }, { title: 'Play Music', path: 'playmusic' },
  { title: 'Browse Music', path: 'music-browse', menu_follows: 'playmusic' }, { title: 'Energy', path: 'energy' }];
var t = function (mm) { return mm.categories.map(function (x) { return x.title; }).join(); };
ok('no page order: the chips rule, and Browse Music sits right after Play Music',
   t(model({ views: PM }, AREAS, { dash: 'd' })) === 'Lights,Play Music,Browse Music,Energy', t(model({ views: PM }, AREAS, { dash: 'd' })));
ok('a page order ranks the menu, custom pages included',
   t(model({ views: PM }, AREAS, { dash: 'd', pageOrder: ['energy', 'playmusic', 'lights'] })) === 'Energy,Play Music,Browse Music,Lights',
   t(model({ views: PM }, AREAS, { dash: 'd', pageOrder: ['energy', 'playmusic', 'lights'] })));
ok('...and Browse Music can be placed on its own',
   t(model({ views: PM }, AREAS, { dash: 'd', pageOrder: ['music-browse', 'lights', 'playmusic'] })) === 'Browse Music,Lights,Play Music,Energy',
   t(model({ views: PM }, AREAS, { dash: 'd', pageOrder: ['music-browse', 'lights', 'playmusic'] })));
var PMnoPlay = PM.map(function (v) { return v.path === 'playmusic' ? Object.assign({}, v, { menu: false }) : v; });
ok('Browse Music is never in the menu without Play Music', t(model({ views: PMnoPlay }, AREAS, { dash: 'd' })).indexOf('Browse') < 0,
   t(model({ views: PMnoPlay }, AREAS, { dash: 'd' })));
// BROWSE MUSIC AS THE MUSIC PAGE'S OTHER ADDRESS (2026-10-11): `menu: false`
// on a follower -- never its own row, even where a screen chose it in its
// categories back when it was a page of its own (Music listed twice)
var PMone = PM.map(function (v) { return v.path === 'music-browse' ? Object.assign({}, v, { title: 'Music', menu: false }) :
                                          v.path === 'playmusic' ? Object.assign({}, v, { title: 'Music' }) : v; });
ok('an address of another page is not in the menu', t(model({ views: PMone }, AREAS, { dash: 'd' })) === 'Lights,Music,Energy',
   t(model({ views: PMone }, AREAS, { dash: 'd' })));
ok('...not even chosen in the screen\'s categories (Music once)',
   t(model({ views: PMone }, AREAS, { dash: 'd', categories: ['lights', 'playmusic', 'energy', 'music-browse'] })) === 'Lights,Music,Energy',
   t(model({ views: PMone }, AREAS, { dash: 'd', categories: ['lights', 'playmusic', 'energy', 'music-browse'] })));
var pp = window.hkMenu._.pagePaths;
ok('a page order as view paths: kinds, Browse Music, a custom page this dashboard shows (rooms is not a page)',
   pp(['live_tv', 'music', 'browse', 'energy', 'gone', 'rooms'], ['energy']).join() === 'live-tv,playmusic,music-browse,energy',
   pp(['live_tv', 'music', 'browse', 'energy', 'gone', 'rooms'], ['energy']).join());
ok('...none set: none', pp([], ['energy']).length === 0 && pp(undefined).length === 0);

print('\n=== the tab\'s place ===');
var tc = window.hkMenu._.tabCentre;
ok('automatic: level with the measured date line', tc('', 117.8, 800, 62) === 117.8);
ok('...or where a wall tablet\'s date sits, before it is measured', tc('', null, 800, 62) === 118);
ok('a distance from the top of the page', tc('140px', 117.8, 800, 62) === 140 && tc('140', 117.8, 800, 62) === 140);
ok('a share of the visible page', tc('25%', 117.8, 800, 62) === 200);
ok('never off the screen', tc('2px', 117.8, 800, 62) === 39 && tc('100%', 117.8, 800, 62) === 761);
ok('nonsense is automatic', tc('lots', 117.8, 800, 62) === 117.8);

print('\n=== where you are ===');
ok('Home is here at the dashboard root, /0 and its own path',
   isHere(m.home, '/dashboard-hall') && isHere(m.home, '/dashboard-hall/0') && isHere(m.home, '/dashboard-hall/hall'));
ok('Home is not here on a room', !isHere(m.home, '/dashboard-hall/room-kitchen'));
var kitchen = m.rooms.filter(function (x) { return x.title === 'Kitchen'; })[0];
ok('a room is here by path and by index', isHere(kitchen, '/dashboard-hall/room-kitchen') && isHere(kitchen, '/dashboard-hall/4'));

print('\n=== glyphs ===');
window.hkGlyphs = { icons: { sofa: 'M0 0', home: 'M1 1' } };
ok('an mdi icon this home has as an SF Symbol is drawn as the symbol', window.hkMenu._.glyph('mdi:sofa') === 'hk:sofa');
ok('one it does not have stays Material', window.hkMenu._.glyph('mdi:grill') === 'mdi:grill');
ok('an hk: icon is left alone', window.hkMenu._.glyph('hk:lock') === 'hk:lock');

print('\n=== on or off, chip or tab (each dashboard its own item: settings.py boards) ===');
CFG = { views: VIEWS };
var HALL = function () { return SETTINGS.boards['dashboard-hall']; };
ok('off by default: no item for the dashboard', M.on() === false && M.style() === null);
SETTINGS = { boards: { 'dashboard-hall': { menu: 'auto' } } };
ok('on for a dashboard with a menu', M.on() === true);
ok('Automatic, no menu button on Home: the edge tab', M.style() === 'tab');
CFG = { views: [{ title: 'Hall', cards: [{ type: 'custom:hk-row-card', cards: [],
        lead: { type: 'custom:hk-menu-button-card' } }] }].concat(VIEWS.slice(1)) };
ok('Automatic, the chip row carries the button: the chip', M.style() === 'chip');
CFG = { views: [{ title: 'Hall', cards: [{ type: 'grid', cards: [{ type: 'custom:hk-chips-card' }] }] }]
        .concat(VIEWS.slice(1)) };
ok('the chips card puts the button at the start of its row: the chip', M.homeButton() && M.style() === 'chip');
CFG = { views: [{ title: 'Hall', cards: [{ type: 'custom:hk-chips-card', lead: false }] }].concat(VIEWS.slice(1)) };
ok('...not when its lead is turned off', !M.homeButton() && M.style() === 'tab');
CFG = { views: [{ title: 'Hall', cards: [{ type: 'custom:hk-chips-card', lead: { type: 'custom:hk-back-card' } }] }]
        .concat(VIEWS.slice(1)) };
ok('...nor when its lead is some other card', !M.homeButton());
CFG = { views: [{ title: 'Hall', cards: [{ type: 'custom:hk-row-card', cards: [],
        lead: { type: 'custom:hk-menu-button-card' } }] }].concat(VIEWS.slice(1)) };
HALL().menu = 'tab';
ok('Edge tab wins over a chip row', M.style() === 'tab');
HALL().menu = 'chip';
CFG = { views: VIEWS };
ok('Pinned chip is the chip even without one on Home', M.style() === 'chip');
HALL().menu = 'tab';
window.innerWidth = 402;
ok('a phone gets Phones\' menu: a button, the chip unless it says otherwise', M.style() === 'chip');
window.innerWidth = 744;
ok('so does an iPad mini held upright: its 18.9 px margin has no room for the tab', M.style() === 'chip');
window.innerWidth = 1133;
ok('an iPad held sideways keeps the tab', M.style() === 'tab');
window.innerWidth = 1280;
location.pathname = '/dashboard-other/0';
ok('another dashboard has no menu', M.on() === false && M.style() === null && M.clock() === false);
location.pathname = '/dashboard-hall/lights';
ok('every page of a dashboard shares its style', M.style() === 'tab');
ok('the clock opens it by default', M.clock() === true);
HALL().clock = false;
ok('...unless that is turned off', M.clock() === false);
ok('the sidebar glyph by default', M.icon() === 'hk:dock-left');
HALL().glyph = 'lines';
ok('three lines when chosen', M.icon() === 'hk:menu');

print('\n=== always shown ===');
SETTINGS = { boards: { 'dashboard-hall': { menu: 'open' } } };
ok('always shown with room for it: no button at all', M.docked() === true && M.style() === 'docked');
ok('...and the clock has nothing to open', M.clock() === false);
window.innerWidth = 402;
ok('a phone has no room: hidden, behind the round button', M.docked() === false && M.style() === 'chip');
window.innerWidth = 1280;
window.innerWidth = 744;
panelW = 744;
ok('an iPad mini held upright (744): folded, behind the round button', M.docked() === false && M.style() === 'chip');
panelW = 1000;
ok('1,000 px, the default fold point: still open', M.docked() === true);
HALL().dock_min = 1400;
panelW = 1280;
ok('...and the fold point is a setting: at 1,400 a 1,280 dashboard folds', M.docked() === false);
delete HALL().dock_min;
window.innerWidth = 1280;
HALL().menu = 'tab';
ok('a button menu stays hidden until opened', M.docked() === false && M.style() === 'tab');

print('\n=== the time and weather in the menu ===');
SETTINGS = { boards: { 'dashboard-hall': { menu: 'open' } } };
ok('off unless the dashboard says so', M.hasTime() === false);
HALL().time_weather = 'menu';
ok('on, and the menu always shown: the menu has the time', M.hasTime() === true);
panelW = 900;
ok('folded (narrower than the fold point): the header has it back', M.docked() === false && M.hasTime() === false);
panelW = 1280;
HALL().menu = 'tab';
ok('on but not always shown: nowhere to put it, the header keeps it', M.hasTime() === false);

print('\n=== each dashboard its own item (settings.py boards) ===');
SETTINGS = { boards: { 'dashboard-other': { menu: 'chip' } } };
ok('a dashboard without an item has no menu', M.on() === false && M.style() === null);
SETTINGS.boards['dashboard-hall'] = { menu: 'tab', ha_row: true, categories: ['lights'], tab_position: '140px' };
ok('its own button style', M.on() === true && M.style() === 'tab');
ok('...and its own row, categories and tab position, the rest at their defaults',
   M.board().ha_row === true && M.board().categories.join() === 'lights' && M.board().tab_position === '140px' &&
   M.board().menu_rooms === 'az' && M.board().home_rooms === 'as_is' && M.board().dock_min === 1000);
SETTINGS.boards['dashboard-hall'] = { menu: 'open', time_weather: 'menu' };
ok('always open, with the time in it', M.docked() === true && M.style() === 'docked' && M.hasTime() === true);
SETTINGS.boards['dashboard-hall'].dock_min = 1400;
// (Folded, it is the screen's Phones menu -- a button, the chip unless it
// says otherwise -- not the automatic button)
ok('its own fold point: at 1,400 a 1,280 dashboard folds, to its Phones menu, and the header has the time',
   M.docked() === false && M.style() === 'chip' && M.hasTime() === false);
SETTINGS.boards['dashboard-hall'].button_phone = 'tab';
ok('...folded to the edge tab when that is Phones\' button', M.style() === 'tab' && M.tab() === 'always');
SETTINGS.boards['dashboard-hall'].menu_phone = 'tabbar';
ok('...and to the tab bar when that is Phones\' menu', M.tabBar() === true && M.on() === false && M.docked() === false);
SETTINGS.boards['dashboard-hall'].menu_phone = 'off';
ok('...Phones off: a folded tablet keeps the chip, never no way in', M.on() === true && M.tabBar() === false);
SETTINGS.boards['dashboard-hall'] = { menu: 'off' };
ok('off', M.on() === false);
location.pathname = '/dashboard-other/0';
ok('the other dashboard keeps its own chip', M.style() === 'chip');
location.pathname = '/dashboard-hall/lights';
var byArea = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', order: 'order', roomOrder: ['yard', 'kitchen'] });
ok('room order: the listed areas first, in that order, then the rest in the dashboard\'s order',
   byArea.rooms.map(function (x) { return x.title; }).join(',') === 'Yard,Kitchen,Den,Attic page',
   byArea.rooms.map(function (x) { return x.title; }).join(','));
var byDeck = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', order: 'order', roomOrder: ['deck'] });
ok('a room spanning two areas is placed by either', byDeck.rooms[0].title === 'Yard');
var none = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', order: 'order', roomOrder: [] });
ok('an empty room order is the dashboard\'s order', none.rooms.map(function (x) { return x.title; }).join(',') === 'Kitchen,Den,Yard,Attic page');
SETTINGS = { boards: { 'dashboard-hall': { menu: 'tab' } } };

print('\n=== room headings ===');
ok('a heading for an area leads to its room page', M.roomPath('kitchen') === '/dashboard-hall/room-kitchen');
ok('...by index when the view has no path', M.roomPath('den') === '/dashboard-hall/6');
ok('either area of a two-area room leads there', M.roomPath('deck') === '/dashboard-hall/room-yard');
ok('an area with no room page stays a plain heading', M.roomPath('garage') === null);
SETTINGS.rooms = { headings: false };
ok('headings stay plain when that is turned off', M.roomPath('kitchen') === null);
SETTINGS.rooms = { headings: true };
ok('the view key is read off a room view', M.areasOfView({ area: ['a', 'b'] }).join() === 'a,b' &&
   M.areasOfView({ strategy: { area: 'c' } }).join() === 'c' && M.areasOfView({}).length === 0);

var H = customElements.get('hk-heading-card');
var h = new H();
h.setConfig({ name: 'Kitchen', area: 'kitchen' });
ok('the heading card renders as a room link', h._roomWas === '/dashboard-hall/room-kitchen');
var plain = new H();
plain.setConfig({ name: 'Scenes' });
ok('a heading with no area is untouched', plain._roomWas === null || plain._roomWas === undefined);

print('\n=== the round buttons ===');
var B = customElements.get('hk-menu-button-card');
var b = new B();
SETTINGS = { boards: { 'dashboard-hall': { menu: 'tab' } } };
b.setConfig({});
ok('with the edge tab the menu chip draws nothing and takes no space', b._showWas === false && b.hasAttribute('hidden'));
HALL().menu = 'chip';
b.setConfig({});
ok('with the chip it draws', b._showWas === true && !b.hasAttribute('hidden'));
var Back = customElements.get('hk-back-card');
var bk = new Back();
bk.setConfig({});
ok('the back button carries the menu button in chip style', bk._menuWas === true);
HALL().menu = 'tab';
bk.setConfig({});
ok('...and not with the edge tab', bk._menuWas === false);
HALL().menu = 'off';
bk.setConfig({});
ok('...nor on a dashboard without the menu', bk._menuWas === false);
SETTINGS = { boards: { 'dashboard-hall': { menu: 'open' } } };
b.setConfig({});
bk.setConfig({});
ok('always shown: the menu chip and the button beside the chevron both go', b._showWas === false && bk._menuWas === false);
SETTINGS = { boards: { 'dashboard-hall': { menu: 'chip' } } };
var keep = C.menu;
delete C.menu;
var old = new Back();
var threw = null;
try { old.setConfig({}); } catch (e) { threw = e; }
ok('an older hk-base.js with no menu (the first load after an update): the chevron draws alone',
   !threw && old._menuWas === false, String(threw));
C.menu = keep;

// THE HIGHLIGHT SLIDES TO THE NEW ROW (2026-10-10), as the tab bar's: a
// layer behind the row, started over the old row and sprung home by a
// transform; a tap starts it before the page's work (navigate after a frame)
var msrc = readFile(root + '/frontend/modules/hk-menu.js');
ok('the highlight is a layer behind the row, moved by a transform with a spring',
   /'\.row\.here::before\{[^']*z-index:-1/.test(msrc) && /transform:translate\(var\(--hx,0px\),var\(--hy,0px\)\) scale\(var\(--sx,1\),var\(--sy,1\)\)/.test(msrc) &&
   /transition:transform \.42s ' \+ SPRING/.test(msrc));
ok('...not under Reduce Motion', /prefers-reduced-motion:reduce\)\{[^}]*\.row\.here::before\{transition:none\}/.test(msrc));
ok('...on a page change and on a tap, the tap before the new page is asked for',
   /slideHere\(hereRow\);/.test(msrc) && /slideHere\(r\);[\s\S]{0,600}?N\(it\.path, null\)/.test(msrc));

// ONE BOARD PER SETTINGS VERSION: the menu's questions are asked on every
// hass push, and each built the board again (95 keys, a dozen times a push).
// hk-settings counts the feeds it applies; a new feed is a new board.
(function () {
  var keepHS = window.hkSettings, ver = 1;
  SETTINGS = { boards: { 'dashboard-hall': { menu: 'chip', glyph: 'lines' } } };
  window.hkSettings = { get: keepHS.get, get version() { return ver; } };
  location.pathname = '/dashboard-hall/0';
  var a = M.board(), b = M.board();
  ok('a copy for each caller, of one board', a !== b && a.menu === 'chip' && b.glyph === 'lines');
  ok('the menu reads it', M.icon() === 'hk:menu');
  var reads = 0, hall = { menu: 'chip' };
  Object.defineProperty(hall, 'glyph', { enumerable: true, get: function () { reads++; return 'lines'; } });
  SETTINGS = { boards: { 'dashboard-hall': hall } };
  M.icon(); var once = reads; M.sig(); M.style(); M.icon();
  ok('...the same version and feed: built once, however often it is asked', once > 0 && reads === once, once + ' then ' + reads);
  SETTINGS = { boards: { 'dashboard-hall': { menu: 'chip', glyph: 'dock' } } };
  ver = 2;
  ok('...a new feed (version) is read at once', M.icon() === 'hk:dock-left');
  location.pathname = '/dashboard-other/0';
  ok('...and another dashboard is its own', M.board().menu === 'off');
  location.pathname = '/dashboard-hall/0';
  window.hkSettings = keepHS;
})();

// THE HOST'S OWN PAGES (hkShell.hostMenu): none in Home Assistant, so no section and no word; a host
// names its own section (Mantel's shell says "Mantel": decision 27)
(function () {
  var hostItems = window.hkMenu._.hostItems;
  ok('Home Assistant: no host pages', hostItems().length === 0, JSON.stringify(hostItems()));
  var was = window.hkShell.hostMenu;
  window.hkShell.hostMenu = function () { return [{ title: 'Example Settings', icon: 'mdi:cog', href: '/settings', section: 'Example' }, { title: 'no href' }]; };
  var got = hostItems();
  ok('a host\'s page: its title, address and its own section name', got.length === 1 && got[0].section === 'Example' &&
     got[0].kind === 'hostlink' && got[0].href === '/settings', JSON.stringify(got));
  // a row may ask the host to do something instead of opening a page (its own `run`)
  var ran = 0;
  window.hkShell.hostMenu = function () { return [{ title: 'Back', icon: 'mdi:arrow-left', run: function () { ran++; }, section: 'Example' }]; };
  got = hostItems();
  ok('a host\'s action: kept, with its run and no address', got.length === 1 && typeof got[0].run === 'function' &&
     got[0].href === '', JSON.stringify(got));
  got[0].run();
  ok('...and it is the host\'s own function', ran === 1, String(ran));
  window.hkShell.hostMenu = was;
  var src = read(root + '/frontend/modules/hk-menu.js') + read(root + '/frontend/modules/hk-tabbar.js');
  ok('neither the menu nor the tab bar names a host of its own', !/mantel/i.test(src));
})();

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' MENU TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
