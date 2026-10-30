// THE PAGES SCREEN (docs/phase11/HOMEVIEW-LOOK.md, Phase J): an iPad-style
// home screen of a screen's pages (cards/hk-pages-screen.js), its settings as
// a screen reads them (modules/hk-settings.js pagesScreen), its place right
// after Home (hk-strategy.js, the menu's list and the tab bar's tabs). The
// icons follow the menu, wear their page's accent, carry their badges; the
// rooms fold; the grid fits each size; the Home pill shows where there is no
// tab bar. The fictional house only.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function near(a, b, e) { return Math.abs(a - b) <= (e || 0.5); }

// ---- the settings, as a screen reads them (the real module)
load(HK_ROOT + '/frontend/modules/hk-settings.js');
var HS = window.hkSettings;
print('=== the settings ===');
var d0 = HS.pagesScreen({});
ok('All Screens\' defaults: off, the menu\'s icons, a Rooms folder, no widgets, the pill when there\'s no tab bar',
   JSON.stringify(d0) === JSON.stringify({ show: 'off', icons: 'menu', rooms: 'folder', widgets: [], pill: 'auto' }), d0);
HS._apply({ configured: true, pages_screen: { show: 'on', icons: 'menu', rooms: 'each', widgets: [{ kind: 'weather', size: 'more', place: 'right' }], pill: 'auto' } });
var r1 = HS.pagesScreen({ pages_screen: null });
ok('a screen Same as All Screens reads All Screens\'', r1.show === 'on' && r1.rooms === 'each' && r1.widgets.length === 1, r1);
var r2 = HS.pagesScreen({ pages_screen: { rooms: 'none', pill: 'off', icons: ['lights', 'climate'] } });
ok('...a screen\'s own fields win, each on its own', r2.show === 'on' && r2.rooms === 'none' && r2.pill === 'off' &&
   r2.icons.join() === 'lights,climate' && r2.widgets[0].kind === 'weather', r2);
var r3 = HS.pagesScreen({ pages_screen: { rooms: 'sideways', show: true, icons: ['a', 'a'] } });
ok('...a bad field of its own is All Screens\' (never a throw)', r3.rooms === 'each' && r3.show === 'on' && r3.icons === 'menu', r3);
HS._apply({ configured: true });

// ---- the card, the menu and the tab bar
location.pathname = '/dashboard-hall/pages';
window.innerWidth = 1180; window.innerHeight = 820;
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-menu.js');
load(HK_ROOT + '/frontend/modules/hk-tabbar.js');
load(HK_ROOT + '/frontend/cards/hk-pages-screen.js');
var C = window.hkCards, P = window.hkPagesScreen._, model = window.hkMenu._.model;
ok('the card is defined and out of the card picker', !!customElements.get('hk-pages-screen-card') &&
   !window.customCards.some(function (c) { return c.type === 'hk-pages-screen-card'; }));

var AREAS = { kitchen: { name: 'Kitchen', icon: 'mdi:silverware-fork-knife' }, den: { name: 'Den' },
              office: { name: 'Office' }, porch: { name: 'Porch' }, attic: { name: 'Attic' } };
var VIEWS = [
  { title: 'Home', path: 'home', cards: [] },
  { title: 'Pages', path: 'pages', icon: 'mdi:view-grid', pages_screen: true, cards: [{ type: 'custom:hk-pages-screen-card' }] },
  { title: 'Weather', path: 'weather', icon: 'mdi:weather-partly-cloudy', menu: 'top' },
  { title: 'Lights', path: 'lights', icon: 'mdi:lightbulb' },
  { title: 'Climate', path: 'climate', icon: 'mdi:home-thermometer' },
  { title: 'Security', path: 'security', icon: 'mdi:lock' },
  { title: 'Calendar', path: 'calendar', icon: 'mdi:calendar-month' },
  { title: 'Timers', path: 'timers', icon: 'mdi:timer-sand' },
  { title: 'Music', path: 'playmusic', icon: 'mdi:speaker' },
  { title: 'Kitchen', path: 'room-kitchen', area: 'kitchen' },
  { title: 'Den', path: 'room-den', area: 'den' },
  { title: 'Office', path: 'room-office', area: 'office' },
  { title: 'Porch', path: 'room-porch', area: 'porch' },
  { title: 'Attic', path: 'room-attic', area: 'attic' }
];
print('=== right after Home ===');
var m = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall' });
ok('the menu lists the Pages screen right after Home, with its grid glyph', m.pages && m.pages.title === 'Pages' &&
   m.pages.path === '/dashboard-hall/pages' && m.pages.icon === 'mdi:view-grid' && m.pages.kind === 'pages', m.pages);
ok('...never among the top pages or the Categories', !m.top.concat(m.categories).some(function (x) { return x.kind === 'pages'; }));
var mc = model({ views: VIEWS }, AREAS, { dash: 'dashboard-hall', categories: ['lights'] });
ok('...whatever Categories the screen chose', !!mc.pages && mc.categories.map(function (x) { return x.title; }).join() === 'Lights');
var noPages = model({ views: VIEWS.filter(function (v) { return !v.pages_screen; }) }, AREAS, { dash: 'dashboard-hall' });
ok('no Pages screen view (Pages Screen off): no entry', noPages.pages === null);
var T = window.hkTabBar._;
var pt = T.parts(m, { shown: 4, more: true });
ok('the tab bar: Home, then Pages, then the Categories', pt.tabs.map(function (x) { return x.title; }).join() === 'Home,Pages,Lights,Climate', pt.tabs.map(function (x) { return x.title; }));
var pa = window.hkMenu._.pagesAfterHome;
ok('the swipe order\'s extension puts it after Home', pa([{ kind: 'home' }, { kind: 'category', t: 1 }, { kind: 'pages' }]).map(function (x) { return x.kind; }).join() === 'home,pages,category' &&
   pa(['home', 'lights', 'pages'], 'pages').join() === 'home,pages,lights');

print('=== the icons follow the menu ===');
var PO = C.PAGE_OF_PATH;
function pageOf(k) { return PO[k] || k; }
var list = P.icons(m, VIEWS, { icons: 'menu', rooms: 'folder' }, pageOf);
ok('the menu\'s top pages and Categories, in its order, then the Rooms folder',
   list.map(function (x) { return x.title; }).join() === 'Weather,Lights,Climate,Security,Calendar,Timers,Music,Rooms', list.map(function (x) { return x.title; }));
ok('...each opens its page; Music is the music page', list[1].path === '/dashboard-hall/lights' && list[6].page === 'music');
ok('...the Pages screen is not an icon of itself', !list.some(function (x) { return x.key === 'pages'; }));
var own = P.icons(m, VIEWS, { icons: ['security', 'gone', 'lights'], rooms: 'none' }, pageOf);
ok('a list of its own: its pages in its order, one that is gone skipped, no rooms',
   own.map(function (x) { return x.title + ' ' + x.path; }).join() === 'Security /dashboard-hall/security,Lights /dashboard-hall/lights', own);
var each = P.icons(m, VIEWS, { icons: 'menu', rooms: 'each' }, pageOf);
ok('rooms Each: an icon per room, after the pages, each a color of its own', each.length === 12 && each[7].kind === 'room' &&
   each[7].title === 'Attic' && each[7].tint !== each[8].tint, each.slice(7).map(function (x) { return x.title; }));
var fold = list[list.length - 1];
ok('the folder holds the rooms, in the menu\'s room order', fold.kind === 'folder' && fold.rooms.map(function (r) { return r.title; }).join() === 'Attic,Den,Kitchen,Office,Porch');
ok('no rooms: no folder', !P.icons(noPages.rooms ? { top: [], categories: [], rooms: [] } : {}, VIEWS, { rooms: 'folder' }).length);

print('=== accents ===');
var gr = P.gradient('#0a84ff');
ok('an icon\'s gradient: lighter at the top, deeper at the foot', parseInt(gr[0].substr(5, 2), 16) > 0xff * 0.9 && parseInt(gr[1].substr(5, 2), 16) < 0xff, gr);
ok('...its page\'s Accent Color: Lights yellow, Climate blue (PAGE_ACCENTS)', C.pageAccentHex('lights') === C.ACCENTS.yellow &&
   C.pageAccentHex('climate') === C.ACCENTS.blue && C.pageAccentHex('music') === C.ACCENTS.pink);
window.hkSettings = { get: function (p, f) { return p === 'look.page_accents' ? { lights: 'green' } : f; } };
ok('...a page\'s own Accent Color wins', C.pageAccentHex('lights') === C.ACCENTS.green);
window.hkSettings = HS;

print('=== badges ===');
function st(s, a) { return { state: s, attributes: a || {} }; }
var states = { 'sensor.running_quick_timers': st('2'), 'binary_sensor.front_door': st('on'), 'binary_sensor.back_door': st('off'),
               'cover.garage': st('open'), 'alarm_control_panel.house': st('armed_away') };
var bd = P.badges(states, { alarm: 'alarm_control_panel.house', doors: ['binary_sensor.front_door', 'binary_sensor.back_door'], garage: ['cover.garage'] },
                  [{ page: 'lights' }, { go: './lights' }, { page: null }]);
ok('timers: the quick timers running', bd.timers === 2, bd);
ok('security: a door open, the garage up, the alarm armed', bd.security === 3, bd);
ok('a notification showing for a page: on that page\'s icon', bd['path:lights'] === 2, bd);
var quiet = P.badges({ 'timer.tea': st('idle'), 'alarm_control_panel.house': st('disarmed') }, { alarm: 'alarm_control_panel.house' }, []);
ok('nothing waiting: no badges', Object.keys(quiet).length === 0, quiet);
ok('no quick timers sensor: the timers active', P.badges({ 'timer.tea': st('active'), 'timer.egg': st('active') }, {}, []).timers === 2);

print('=== the grid at each size ===');
var g1 = P.grid(1180, 820, { pill: true });
ok('a landscape tablet: 6 x 3, 120 px icons in 176 x 200 slots', g1.cols === 6 && g1.rows === 3 && near(g1.slotW, 176, 1) && near(g1.icon, 120, 1) && g1.s > 0.99, g1);
ok('...62 in from the sides, 130 down (the mock-up\'s)', near(g1.gutter, 62, 0.5) && near(g1.top, 131, 1), g1);
var g2 = P.grid(820, 1180, { pill: true });
ok('upright: 4 x 5', g2.cols === 4 && g2.rows === 5 && g2.icon > 110 && g2.icon <= 120, g2);
var g3 = P.grid(390, 844, { pill: true });
ok('a phone: 4 x 6, about an iPhone\'s 60 px icons, labels never under 12', g3.cols === 4 && g3.rows === 6 && near(g3.icon, 60, 2) && g3.label >= 12, g3);
var g4 = P.grid(844, 390, {});
ok('a phone on its side: 6 x 2', g4.cols === 6 && g4.rows === 2, g4);
var g5 = P.grid(1180, 736, { pill: false });
ok('beside a tab bar (less height, no pill): still 6 x 3, a little smaller', g5.cols === 6 && g5.rows === 3 && g5.s < 1 && g5.s > 0.9, g5);

print('=== placing them ===');
var p1 = P.place(10, [], 6, 3);
ok('icons row by row; one screen holds 18', p1.length === 1 && p1[0].icons[6].col === 0 && p1[0].icons[6].row === 1);
var p2 = P.place(20, [], 6, 3);
ok('more than fit: a second Pages screen', p2.length === 2 && p2[1].icons.length === 2 && p2[1].icons[0].i === 18);
var p3 = P.place(16, [{ kind: 'weather', size: 'more', place: 'right' }], 6, 3);
ok('a Large widget, right: 2 x 2 at the top right (the mock-up\'s)', p3[0].widgets[0].col === 4 && p3[0].widgets[0].row === 0 &&
   p3[0].widgets[0].cw === 2 && p3[0].widgets[0].ch === 2, p3[0].widgets);
ok('...the icons flow round it', p3[0].icons[4].col === 0 && p3[0].icons[4].row === 1 && p3[0].icons.length === 14 && p3[1].icons.length === 2,
   p3[0].icons.slice(0, 6));
var p4 = P.place(4, [{ kind: 'clock', size: 'less', place: 'left' }, { kind: 'calendar', size: 'more', place: 'left' }], 6, 3);
ok('Small 2 x 1 and Large 2 x 2 stack down their side', p4[0].widgets[0].row === 0 && p4[0].widgets[0].ch === 1 &&
   p4[0].widgets[1].row === 1 && p4[0].widgets[1].col === 0 && p4[0].icons[0].col === 2, p4[0]);
var p5 = P.place(0, [{ kind: 'a', size: 'more' }, { kind: 'b', size: 'more' }], 4, 6);
ok('a phone: two Large widgets down the right', p5[0].widgets[1].row === 2 && p5[0].widgets[1].col === 2);
ok('nothing: one empty screen', P.place(0, [], 6, 3).length === 1);

print('=== the pill ===');
ok('Automatic: the pill where the screen has no tab bar, none beside one', P.pillOn('auto', false) && !P.pillOn('auto', true));
ok('Always and Never', P.pillOn('on', true) && !P.pillOn('off', false));

print('=== drawn ===');
var card = new (customElements.get('hk-pages-screen-card'))();
var data = { ps: { show: 'on', icons: 'menu', rooms: 'folder', widgets: [], pill: 'auto' }, m: m, list: list,
             badges: { timers: 2, security: 1 }, temp: '54°', who: { name: 'Avery', pic: '' }, tabBar: false, flat: false,
             widgets: [], render: null };
var html = card._html(data, { W: 1180, H: 820 }, new Date(2026, 9, 30, 8, 42));
function count(re) { return (html.match(re) || []).length; }
ok('an icon per page and the folder, each a button', count(/class="app"/g) === 8, count(/class="app"/g));
ok('Lights in its yellow, top to bottom', html.indexOf('linear-gradient(180deg,' + P.gradient(C.ACCENTS.yellow)[0] + ',' + P.gradient(C.ACCENTS.yellow)[1] + ')') > 0);
ok('...its corner 22.4 % of the 120 px icon', /border-radius:26\.[89]px/.test(html));
ok('Calendar shows today: Fri 30', />Fri<\/i>/.test(html) && />30<\/span>/.test(html));
ok('Weather shows the temperature', html.indexOf('>54°</span>') > 0);
ok('badges: Timers 2, Security 1, in red', />2<\/b>/.test(html) && />1<\/b>/.test(html) && html.indexOf('background:' + C.ACCENTS.red) > 0);
ok('...said to VoiceOver', html.indexOf('aria-label="Timers, 2 waiting"') > 0);
ok('the folder: four rooms in miniature', count(/<u style/g) === 4);
ok('the date and time top left, who\'s here top right (an initial)', /class="when"/.test(html) && />A<\/div>/.test(html));
ok('the time faint behind', /class="time" aria-hidden="true"/.test(html));
ok('no tab bar: the Home pill', html.indexOf('class="pill"') > 0);
ok('one screen: no dots, and the screens\' swipe is the page\'s', html.indexOf('class="dots"') < 0 && html.indexOf('data-hk-control') < 0);
var hb = card._html(Object.assign({}, data, { tabBar: true }), { W: 1180, H: 736 }, new Date(2026, 9, 30, 8, 42));
ok('beside a tab bar: no pill', hb.indexOf('class="pill"') < 0);
var many = Object.assign({}, data, { list: each.concat(each).concat(each) });
var hm = card._html(many, { W: 1180, H: 820 }, new Date());
ok('more than fit: two screens, their dots, their own swipe', /data-dot="1"/.test(hm) && hm.indexOf('data-hk-control') > 0);
card._folder = true;
var ho = card._html(data, { W: 1180, H: 820 }, new Date());
ok('the folder opened: the five rooms as their own icons', /class="open"/.test(ho) && (ho.split('class="open"')[1].match(/class="app"/g) || []).length === 5);
card._folder = false;
var withW = Object.assign({}, data, { widgets: [{ kind: 'weather', size: 'more', place: 'right' }], render: function () { return '<i>wx</i>'; } });
var hw = card._html(withW, { W: 1180, H: 820 }, new Date());
ok('a widget\'s place: 2 x 2 at the top right, 328 wide', /class="wd" data-w="0" data-kind="weather" style="left:77[78][0-9.]*px;top:13[0-9.]*px;width:32[78][0-9.]*px/.test(hw), (hw.match(/class="wd"[^>]*/) || [])[0]);
var hp = card._html(data, { W: 390, H: 844 }, new Date());
ok('a phone: the iPhone\'s pill', hp.indexOf('--pw:134px') > 0);

print('=== the strategy: only while it is on ===');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
var hass = { states: { 'light.desk': { entity_id: 'light.desk', state: 'on', attributes: { friendly_name: 'Desk' } } },
             areas: { office: { area_id: 'office', name: 'Office' } }, entities: { 'light.desk': { area_id: 'office' } }, devices: {} };
var ON = false;
location.pathname = '/dashboard-hall/home';
window.hkSettings = { get: function (p, f) { return p === 'boards' ? { 'dashboard-hall': { pages: [] } } : f; },
                      weatherId: function () { return null; },
                      pagesScreen: function () { return { show: ON ? 'on' : 'off' }; } };
window.hkStrategy.generate({ music: false, popups: false }, hass).then(function (cfg) {
  ok('off (every screen today): no Pages screen', !cfg.views.some(function (v) { return v.pages_screen; }));
  ON = true;
  return window.hkStrategy.generate({ music: false, popups: false }, hass);
}).then(function (cfg) {
  var v = cfg.views[1] || {};
  ok('on: /pages right after Home, its one card', v.pages_screen === true && v.path === 'pages' && v.cards[0].type === 'custom:hk-pages-screen-card');
  ok('...on Home\'s sky', !!cfg.views[0].sky === !!v.sky);
  ok('...on the page\'s own edges', v.layout.margin === '0px' && v.layout.padding === '0px');
}).then(function () {
  // ---- Swipe Between Pages, loaded after the menu (as hk-loader.js loads them): the Pages screen joins its order
  load(HK_ROOT + '/frontend/modules/hk-pageswipe.js');
  var o = window.hkPageSwipe._.order({ items: [{ kind: 'home', path: 'home' }, { kind: 'lights', path: 'lights' }, { kind: 'pages', path: 'pages' }] });
  var os = o.map(function (x) { return x.path; }).join();
  ok('the swipe\'s order: Home, then the Pages screen, then the rest', os === 'home,pages,lights', os);
  var none = window.hkPageSwipe._.order({ items: [{ kind: 'home', path: 'home' }, { kind: 'lights', path: 'lights' }] });
  var ns = none.map(function (x) { return x.path; }).join();
  ok('...no Pages screen: the order as it was', ns === 'home,lights', ns);
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' PAGES SCREEN TESTS' : 'ALL ' + pass + ' PAGES SCREEN TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
