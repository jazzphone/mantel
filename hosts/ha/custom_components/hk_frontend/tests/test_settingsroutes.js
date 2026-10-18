// The HK Settings page's addresses (panels/hk-settings.js resolve): which page
// an address opens. The page draws itself; this is only the routing decision,
// with each page stubbed to say its name.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
// the panel as the page has it: its model, kit and features first (the page
// imports them before it draws), so routes that read the model resolve
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
(0, eval)(read(HK_ROOT + '/frontend/panels/hk-settings.js').replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);'));
var pass = 0, fail = 0;
function ok(name, got, want) {
  if (got === want) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
var P = customElements.get('hk-settings-panel').prototype;
// A page shown a frontend object the way the panel's entry shows it: the host
// adapter's client for it, read off the element as `client`.
function show(pg, frontend) { Object.defineProperty(pg, 'client', { value: window.hkHostClient.from(frontend) }); }
var page = Object.create(P);
page.p_overview = function () { return 'overview'; };
page.p_screen = function (path) { return 'screen:' + path; };
function open(hash) { return P.resolve.call(page, hash.replace(/^#\/?/, '').split('/')); }

print('=== the screens ===');
ok('a screen opens its page', open('#/screens/dashboard-kitchen'), 'screen:dashboard-kitchen');
// There is no list page of screens (the list is the menu): #/screens alone
// drew "There's no dashboard at /undefined." -- the 1.0 docs' screenshot of
// the Screens list showed exactly that.
ok('#/screens with no screen named opens the Overview, not a screen called undefined', open('#/screens'), 'overview');
ok('...and so does #/screens/ (an empty name)', open('#/screens/'), 'overview');

page.data = { settings: { sky: {}, look: {} }, choices: {} };
ok('house backdrop opens its own page (Sky Colors)', open('#/house/sky/backdrop').title, 'Sky Colors');
page.dash = function (path) { return { path: path, title: 'Sky Test', item: true }; };
page.data.boards = { 'dashboard-sky': {} };
ok('screen sky opens the named page', P.p_screen.call(page, 'dashboard-sky', ['sky']).title, 'Sky / Background');
var backdrop = P.p_screen.call(page, 'dashboard-sky', ['sky', 'backdrop']);
ok('screen backdrop opens its picker (Sky Colors)', backdrop.title, 'Sky Colors');
ok('screen backdrop Back returns to Sky / Background', backdrop.back[1], '#/screens/dashboard-sky/sky');
// SKY LIVELINESS (2026-10-08): a woodland season has its own page now, Back
// to the seasons; the night sky has one too
ok('a woodland season opens its own page', open('#/house/sky/woodland/fall').title, 'Autumn');
ok('...Back to the seasons', open('#/house/sky/woodland/fall').back[1], '#/house/sky/woodland');
ok('...an unknown one is the seasons\' list', open('#/house/sky/woodland/monsoon').title, 'Woodland Between Occasions');
ok('the night sky opens its page', open('#/house/sky/night').title, 'Night Sky');

print('\n=== leaving the page: nothing of it keeps running ===');
(function () {
  var pg = Object.create(P), calls = [];
  var sr = { addEventListener: function () {}, removeEventListener: function () {} };
  Object.defineProperty(pg, 'shadowRoot', { value: sr });
  var connected = true;
  Object.defineProperty(pg, 'isConnected', { get: function () { return connected; } });
  var resolveSub = null, unsubbed = 0;
  show(pg, { connection: { subscribeMessage: function () {
    return new Promise(function (r) { resolveSub = r; }); } } });
  P.subscribe.call(pg);
  P.subscribe.call(pg);
  ok('one subscription asked for, however often subscribe() runs while it is on its way', typeof resolveSub, 'function');
  pg._soonT = setTimeout(function () { calls.push('soon'); }, 0);
  pg._stT = setTimeout(function () { calls.push('status'); }, 0);
  pg._skyWait = setInterval(function () { calls.push('sky'); }, 0);
  pg._saverWait = setInterval(function () { calls.push('saver'); }, 0);
  connected = false;
  P.disconnectedCallback.call(pg);
  ok('its timers are cleared', [pg._soonT, pg._stT, pg._skyWait, pg._saverWait].every(function (t) { return t == null; }), true);
  resolveSub(function () { unsubbed++; });
  drainMicrotasks();
  ok('a subscription that arrives after the page left is ended at once', unsubbed, 1);
  ok('...and not kept', pg._unsub == null, true);
  // back on the page: a fresh one is kept
  connected = true;
  P.subscribe.call(pg);
  resolveSub(function () { unsubbed++; });
  drainMicrotasks();
  ok('on the page again: the new subscription is kept', typeof pg._unsub, 'function');
  __runTimers();
  ok('...and the old timers never fire', calls.length, 0);
})();

print('=== accessories by type (2026-10-13) ===');
(function () {
  var pg = Object.create(P);
  pg.data = { settings: { sky: {}, look: {}, generated: {} }, choices: {}, counts: {}, accessories: {} };
  show(pg, { states: {}, entities: {}, devices: {}, areas: {} });
  pg.p_overview = function () { return 'overview'; };
  var go = function (hash) { return P.resolve.call(pg, hash.replace(/^#\/?/, '').split('/')); };
  ok('a type opens its page', go('#/accessories/type/lights').title, 'Lights');
  ok('...whose Back is Accessories', go('#/accessories/type/lights').back[1], '#/accessories');
  ok('What Counts’ old kind address opens the type', go('#/house/counts/locks').title, 'Locks');
  ok('...and What Counts itself opens Accessories', go('#/house/counts').title, 'Accessories');
  ok('a type’s Tile Order', go('#/accessories/type/locks/order').title, 'Tile Order');
  // (since 2026-10-16 the Security page's: Pages -> Security -> Tile Order)
  ok('...comes back to its page', go('#/accessories/type/locks/order').back[1], '#/page/security');
  ok('the old page-order address is Tile Order too', go('#/accessories/page/vacuums').title, 'Tile Order');
  ok('Added Accessories (was Also Shown)', go('#/accessories/added').title, 'Added Accessories');
  ok('...and its old address still opens it', go('#/accessories/also').title, 'Added Accessories');
  ok('an unknown type is not a type page', go('#/accessories/type/nope').title !== 'nope', true);
  ok('All Screens \u2192 Status Chips', go('#/house/chips').title, 'Status Chips');
  ok('...and one chip across the screens', go('#/house/chips/lights').title, 'Lights Chip');
  ok('...whose Back is Status Chips', go('#/house/chips/lights').back[1], '#/house/chips');
  // THE CHIP PAGES DRAW (2026-10-13: one read a list before it was made)
  pg.data.chip_kinds = ['lights', 'energy', 'doors_windows'];
  pg.data.boards = { 'dashboard-a': { chips_row: true, chips: [], chips_quiet: ['doors_windows'], chips_custom: ['mail'], home_page: true } };
  pg.data.custom_chips = [{ key: 'mail', name: 'Mail', after: 'end', card: { type: 'conditional', card: { type: 'custom:hk-status-chip-card', entity: 'sensor.m' } } }];
  pg.dash = function (p) { return { path: p, title: 'Screen A' }; };
  pg.hasAttribute = function () { return true; };
  pg.setB = function () { return Promise.resolve(true); };
  // (the stub DOM, enough for a page to draw)
  if (!document.createTextNode) document.createTextNode = function (t) { var e = document.createElement('#text'); e.textContent = String(t); return e; };
  // (its innerHTML makes no nodes: an icon's svg comes back undefined)
  var EP = document.createElement('div').constructor.prototype, ap = EP.appendChild;
  EP.appendChild = function (c) { return c ? ap.call(this, c) : c; };
  ['#/house/chips', '#/house/chips/lights', '#/house/chips/energy', '#/house/chips/doors_windows', '#/house/chips/chip%3Amail'].forEach(function (hash) {
    var err = null, box = document.createElement('div');
    try { go(hash).body(box); } catch (e) { err = String(e); }
    ok(hash + ' draws', err, null);
  });
  ok('every kind has a type of the same id', window.hkSettingsModel.COUNT_KINDS.every(function (k) { return !!window.hkSettingsModel.accType(k[0]); }), true);
})();

print('\n=== Screensaver and Wall Tablets (2026-10-13) ===');
(function () {
  var pg = Object.create(P);
  pg.p_overview = function () { return 'overview'; };
  pg.hs = function () { return null; };
  pg.data = { settings: { tablets: {} }, boards: {}, tablets: { living_room: { name: 'Living Room', screen: 'dashboard-livingroom', sleep: {} } } };
  var go = function (hash) { return P.resolve.call(pg, hash.replace(/^#\/?/, '').split('/')); };
  ok('Screensaver is its own page', go('#/house/screensaver').title, 'Screensaver');
  ok('...its clock style below it', go('#/house/screensaver/clock-style').back[1], '#/house/screensaver');
  var replaced = null;
  if (typeof history === 'undefined') (0, eval)('var history = {}');
  var saved = history.replaceState;
  history.replaceState = function (_s, _t, u) { replaced = u; };
  ok('its old address under Wall Tablets opens it', go('#/house/tablets/screensaver').title, 'Screensaver');
  ok('...and the address becomes its own', replaced, '#/house/screensaver');
  history.replaceState = saved;
  ok('Wall Tablets is the tablets', go('#/house/tablets').title, 'Wall Tablets');
  ok('a tablet opens its own page', go('#/house/tablets/living_room').title, 'Living Room');
  ok('...back to Wall Tablets', go('#/house/tablets/living_room').back[1], '#/house/tablets');
  ok('its Sleep Screen', go('#/house/tablets/living_room/sleep').back[1], '#/house/tablets/living_room');
  ok('a Sleep Screen list', go('#/house/tablets/living_room/sleep/presence').title, 'Presence');
  ok('Add Tablet', go('#/house/tablets/add').title, 'Add Tablet');
  ok('a tablet that isn\'t there is Wall Tablets', go('#/house/tablets/nope').title, 'Wall Tablets');
})();

print('\n=== Pages (2026-10-16) ===');
(function () {
  var M = window.hkSettingsModel;
  var pg = Object.create(P);
  pg.p_overview = function () { return 'overview'; };
  show(pg, { states: { 'valve.main_water': { state: 'open', attributes: { friendly_name: 'Main Water' } },
                         'weather.home': { state: 'sunny', attributes: {} }, 'calendar.family': { state: 'off', attributes: {} },
                         'camera.porch': { state: 'idle', attributes: {} } },
               entities: {}, devices: {}, areas: {}, config: {} });
  pg.data = { settings: { sky: { pages: {} }, look: {}, generated: {}, headers: {}, status_rows: {}, security: {}, features: {},
                          weather: {}, calendar: {}, cameras: {}, browse: { hide: [], discover: [] } },
              choices: { status_rows: { water: { kinds: ['leaks', 'valves'], default: ['leaks', 'valves'] },
                                        timers: { kinds: ['timers'], default: ['timers'] },
                                        vacuums: { kinds: ['vacuums', 'vacuum_battery'], default: ['vacuums', 'vacuum_battery'] },
                                        security: { kinds: ['security', 'locks'], default: ['security', 'locks'] } } },
              counts: { valves: { found: ['valve.main_water'] } }, kinds: { valves: 1, timers: 2, vacuums: 1, locks: 1 },
              accessories: { pages: {} }, dashboards: [{ path: 'dashboard-a', title: 'Screen A', item: true, generated: true }],
              boards: { 'dashboard-a': { pages: [], headers: { water: false } } }, features: {}, popups: [], custom_pages: [],
              page_kinds: ['water', 'timers', 'vacuums', 'security', 'weather', 'calendar', 'cameras'], thirdparty: {}, suggest: {} };
  pg.dash = function (p) { return { path: p, title: 'Screen A', item: true, generated: true }; };
  pg.hasAttribute = function () { return true; };
  pg.setB = function () { return Promise.resolve(true); };
  pg.setH = function () { return Promise.resolve(true); };
  pg.feat = function () { return { data: null }; };
  pg.pickers = {}; pg.errors = {};
  if (!document.createDocumentFragment) document.createDocumentFragment = function () { return document.createElement('#fragment'); };
  pg.announce = function () {};
  var go = function (hash) { return P.resolve.call(pg, hash.replace(/^#\/?/, '').split('/')); };
  // the sidebar's list: only the pages this house has, in the menu's order
  var keys = P.pagesListed.call(pg).map(function (p) { return p[0]; });
  ok('the Pages section lists what the house has', keys.join(','), 'security,water,energy,power,timers,vacuums,music,cameras,calendar,weather,live_tv');
  ok('...Doors & Windows only without an alarm', keys.indexOf('doors_windows') < 0, true);
  ok('a page opens its own settings page', go('#/page/water').title, 'Water');
  ok('...a top page, beside the sidebar', go('#/page/water').top, true);
  ok('its status row below it', go('#/page/water/status').back[1], '#/page/water');
  ok('a page with no such row is its page', go('#/page/weather/status').title, 'Weather');
  ok('House Timers are the Timers page’s', go('#/page/timers/house').title, 'House Timers');
  ok('the Vacuums tile order', go('#/page/vacuums/order').title, 'Tile Order');
  ok('a page’s background (Sky’s Page Backgrounds, moved)', go('#/page/water/background').title, 'Background');
  ok('an unknown page is the Overview', go('#/page/garden'), 'overview');
  // THE WEATHER PAGE'S OWN (2026-10-16)
  ok('Forecast & Details', go('#/page/weather/forecast').title, 'Forecast & Details');
  ok('...back to Weather', go('#/page/weather/forecast').back[1], '#/page/weather');
  ok('Radar Map, native', go('#/page/weather/radar').title, 'Radar Map');
  ok('its Advanced, back to Radar Map', go('#/page/weather/radar/advanced').back[1], '#/page/weather/radar');
  ok('the old card’s options, read only, back to Radar Map', go('#/page/weather/radar/yaml').back[1], '#/page/weather/radar');
  // OLD ADDRESSES FORWARD
  [['house/general', 'page/security'], ['house/general/timers', 'page/timers/house'], ['house/weather/radar', 'page/weather/radar'],
   ['house/calendar', 'page/calendar'], ['house/cameras', 'page/cameras'], ['house/status/water', 'page/water/status'],
   ['house/status/rooms', 'house/rooms/status'], ['house/status', 'page/climate'], ['house/climate', 'page/climate/status'],
   ['features/energy', 'page/energy'], ['features/clean', 'page/vacuums'], ['features/alarm', 'page/security'],
   ['features/tv', 'page/live_tv'], ['house/appearance/pill/timers', 'page/timers/pill'], ['house/sky/page/water', 'page/water/background'],
   ['accessories/page/vacuums', 'page/vacuums/order']].forEach(function (x) {
    ok(x[0] + ' forwards', M.routeForward(x[0]), x[1]);
  });
  [['features/energy/devices'], ['features/notify'], ['house/rooms/status'], ['house/sky/page/rooms'], ['page/water']].forEach(function (x) {
    ok(x[0] + ' stays', M.routeForward(x[0]), null);
  });
  ok('the old General opens Security', go('#/house/general').title, 'Security');
  ok('the Room Status Row is Rooms’', go('#/house/rooms/status').title, 'Room Status Row');
  ok('...and its old address finds it', go('#/house/status/rooms').title, 'Room Status Row');
  ok('a feature’s page belongs to its page in the sidebar', M.pageOfRoute('features/energy/devices'), 'energy');
  ok('...Power’s to Power', M.pageOfRoute('features/energy/power'), 'power');
  ok('...Alarm PIN’s to Security', M.pageOfRoute('features/alarm/add'), 'security');
  // a screen's own header switch
  ok('a screen’s Page Headers', P.p_screen.call(pg, 'dashboard-a', ['page-headers']).title, 'Page Headers');
  ok('the screens that turn a header off', M.headerOffOn(pg.data.boards, 'water').join(), 'dashboard-a');
  ok('a screen of only some pages shows just those', M.screenShows({ home_page: false, only_pages: ['energy'], pages: [] }, 'water'), false);
  ok('...a whole screen with Automatic pages shows every page', M.screenShows({ pages: [] }, 'water'), true);
  // DOORS & WINDOWS is Security's with an alarm (the screen's page list leaves it out)
  pg.data.settings.security = { alarm: 'alarm_control_panel.home' };
  ok('with an alarm, Doors & Windows is Security’s on a screen that shows Security', P.dwInSecurity.call(pg, { pages: [] }), true);
  ok('...not on one without Security', P.dwInSecurity.call(pg, { pages: ['doors_windows', 'lights'] }), false);
  pg.data.settings.security = {};
  // EVERY PAGE DRAWS
  if (!document.createTextNode) document.createTextNode = function (t) { var e = document.createElement('#text'); e.textContent = String(t); return e; };
  var EP = document.createElement('div').constructor.prototype, ap = EP.appendChild;
  EP.appendChild = function (c) { return c ? ap.call(this, c) : c; };
  ['#/page/water', '#/page/timers', '#/page/vacuums', '#/page/security', '#/page/water/status', '#/page/timers/status',
   '#/page/weather', '#/page/calendar', '#/page/energy', '#/page/power', '#/page/live_tv', '#/page/music', '#/page/cameras',
   '#/page/timers/pill', '#/page/weather/forecast', '#/page/weather/radar', '#/page/weather/radar/advanced',
   '#/page/weather/radar/yaml'].forEach(function (hash) {
    var err = null, box = document.createElement('div');
    try { go(hash).body(box); } catch (e) { err = String(e) + ' ' + (e.stack || '').split('\n')[0]; }
    ok(hash + ' draws', err, null);
  });
  var err2 = null;
  try { P.p_screen.call(pg, 'dashboard-a', ['page-headers']).body(document.createElement('div')); } catch (e) { err2 = String(e); }
  ok('Page Headers draws', err2, null);
  // ON SCREENS: each screen a link to its Pages on This Screen
  var box = document.createElement('div');
  go('#/page/water').body(box);
  var html = JSON.stringify(box, function (k, v) { return k === 'parentNode' || k === '_listeners' ? undefined : v; }) || '';
  ok('a page lists its screens, each opening that screen’s pages', html.indexOf('#/screens/dashboard-a/pages') >= 0, true);
})();

print('\n=== Flat Colors: one editor at every scope (2026-10-17) ===');
(function () {
  load(HK_ROOT + '/frontend/modules/hk-settings.js');
  // (the shim parses no markup: a checkmark row's svg is a stand-in)
  var EPr = document.createElement('span').constructor.prototype;
  if (!('firstChild' in EPr)) Object.defineProperty(EPr, 'firstChild', { configurable: true,
    get: function () { return this.children[0] || this._fc || (this._fc = document.createElement('svg')); } });
  var SAGE = '#7e9b83', ROSE = '#c17d91', LAV = '#9374bc';
  var pg = Object.create(P), writes = [];
  pg.p_overview = function () { return 'overview'; };
  show(pg, { states: {}, entities: {}, devices: {}, areas: { kitchen: { name: 'Kitchen' } }, config: {} });
  var look = { flat: true, flat_theme: 'light', glass: 'clear', flat_colors: { accent: SAGE, off_tint: 'accent' },
               flat_page_colors: { calendar: { accent: ROSE } }, page_accents: {}, page_pills: {} };
  pg.data = { settings: { sky: { pages: {}, flat_pages: {}, flat_background: 'color', flat_color: 'auto' }, look: look, menu: { accent: 'orange' },
                          generated: {}, headers: {}, status_rows: {}, security: {}, features: {}, weather: {}, calendar: {}, cameras: {}, browse: { hide: [], discover: [] } },
              choices: { flat_colors: [{ id: 'sage', label: 'Sage', light: '#EAF0ED', dark: '#151C1B' }] }, counts: {}, kinds: {},
              accessories: { pages: {} }, dashboards: [{ path: 'dashboard-k', title: 'Kitchen', item: true, generated: true }],
              boards: { 'dashboard-k': { pages: [], glass: 'house', flat_colors: { accent: LAV }, flat_page_colors: {} } },
              features: {}, popups: [], custom_pages: [], page_kinds: ['calendar', 'climate', 'rooms'], thirdparty: {}, suggest: {} };
  pg.dash = function (p) { return { path: p, title: 'Kitchen', item: true, generated: true }; };
  pg.hasAttribute = function () { return true; };
  pg.setB = function (path, ch) { writes.push(['b', path, ch]); return Promise.resolve(true); };
  pg.setH = function (ch) { writes.push(['h', ch]); return Promise.resolve(true); };
  pg.feat = function () { return { data: null }; };
  pg.pickers = {}; pg.errors = {}; pg.announce = function () {};
  var go = function (hash) { return P.resolve.call(pg, hash.replace(/^#\/?/, '').split('/')); };
  var scr = function (sub) { return P.p_screen.call(pg, 'dashboard-k', sub); };
  var draw = function (pgx) { var box = document.createElement('div'), err = null; try { pgx.body(box); } catch (e) { err = String(e) + ' ' + (e.stack || '').split('\n')[0]; } return { box: box, err: err }; };
  var all = function (el, out) { out = out || []; out.push(el); (el.children || []).forEach(function (c) { if (c && typeof c === 'object') all(c, out); }); return out; };
  var text = function (box) { return all(box).map(function (e) { return e._text || e.textContent || ''; }).join(' | '); };
  var byFk = function (box, fk) { return all(box).filter(function (e) { return e.attrs && e.attrs['data-fk'] === fk; })[0]; };
  var tap = function (el) { ((el && el._listeners && el._listeners.click) || []).forEach(function (f) { f({}); }); if (el && typeof el.onclick === 'function') el.onclick({}); };
  ok('All Screens’ Flat Colors', go('#/house/appearance/flat-colors').title, 'Flat Colors');
  ok('...back to Appearance', go('#/house/appearance/flat-colors').back[1], '#/house/appearance');
  ok('its Accent Color', go('#/house/appearance/flat-colors/accent').title, 'Accent Color');
  ok('...back to Flat Colors', go('#/house/appearance/flat-colors/accent').back[1], '#/house/appearance/flat-colors');
  ok('a page’s, on All Screens', go('#/house/appearance/flat-colors/page/calendar').title, 'Calendar');
  ok('its Off Pill Tint, back to the page', go('#/house/appearance/flat-colors/page/calendar/tint').back[1], '#/house/appearance/flat-colors/page/calendar');
  ok('a screen’s', scr(['flat-colors']).title, 'Flat Colors');
  ok('...with the screen’s preview', scr(['flat-colors']).preview, 'dashboard-k');
  ok('a page on a screen', scr(['flat-colors', 'page', 'calendar']).title, 'Calendar');
  ok('Room Pages’ rooms come back to Room Pages', go('#/house/appearance/flat-colors/page/room-kitchen').back[1], '#/house/appearance/flat-colors/page/rooms');
  ['#/house/appearance/flat-colors', '#/house/appearance/flat-colors/accent', '#/house/appearance/flat-colors/tint',
   '#/house/appearance/flat-colors/page/calendar', '#/house/appearance/flat-colors/page/rooms', '#/house/appearance/flat-colors/page/room-kitchen',
   '#/house/appearance', '#/page/calendar', '#/house/menu/accent'].forEach(function (h) { ok(h + ' draws', draw(go(h)).err, null); });
  [['flat-colors'], ['flat-colors', 'accent'], ['flat-colors', 'tint'], ['flat-colors', 'page', 'calendar'], ['flat-colors', 'page', 'calendar', 'accent'],
   ['sky', 'page', 'calendar']].forEach(function (sub) { ok('screen ' + sub.join('/') + ' draws', draw(scr(sub)).err, null); });
  ok('opening every one of them wrote nothing', writes.length, 0);
  // what the pages say
  var hp = text(draw(go('#/house/appearance')).box);
  ok('All Screens’ Appearance has Flat Colors, Sage', /Flat Colors/.test(hp) && /Sage/.test(hp), true);
  ok('...and says the Highlight is the Accent in Flat', /In Flat, the Accent Color/.test(hp), true);
  var kp = text(draw(scr(['flat-colors'])).box);
  ok('Kitchen: Lavender, its own; the tint from All Screens', /Lavender/.test(kp) && /Just This Screen/.test(kp) && /From All Screens/.test(kp), true);
  ok('Kitchen’s Calendar: All Screens’ Rose wins -- said so', /From All Screens/.test(text(draw(scr(['flat-colors'])).box)), true);
  var kc = text(draw(scr(['flat-colors', 'page', 'calendar'])).box);
  ok('Calendar on Kitchen: Rose, from Calendar on All Screens', /Rose/.test(kc) && /From Calendar on All Screens/.test(kc), true);
  var pick = draw(scr(['flat-colors', 'accent'])).box;
  ok('the screen’s picker: Same as All Screens, now Sage', /Same as All Screens/.test(text(pick)) && /Now Sage · All Screens/.test(text(pick)), true);
  var pp = text(draw(go('#/page/calendar')).box);
  ok('Pages → Calendar → Look keeps the Accent Color and adds Flat Colors', /Accent Color/.test(pp) && /Flat Colors/.test(pp), true);
  ok('the Highlight Color page says the Flat Accent is in use', /Using Flat Accent Color/.test(text(draw(go('#/house/menu/accent')).box)), true);
  // the writes
  look.flat_colors = { accent: 'auto', off_tint: 'auto' };
  tap(byFk(draw(go('#/house/appearance/flat-colors/accent')).box, 'flatc:accent:sage'));
  ok('an accent over an Automatic tint: both in one write, as patches', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'look.flat_colors.accent': SAGE, 'look.flat_colors.off_tint': 'accent' }]));
  look.flat_colors = { accent: SAGE, off_tint: '#789484' };
  tap(byFk(draw(go('#/house/appearance/flat-colors/accent')).box, 'flatc:accent:rose'));
  ok('...over a tint of its own: the tint stays', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'look.flat_colors.accent': ROSE }]));
  tap(byFk(draw(scr(['flat-colors', 'page', 'calendar', 'accent'])).box, 'flatc:accent:lavender'));
  ok('a page on a screen: one page’s patch, the other pages untouched', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { 'flat_page_colors.calendar': { accent: LAV } }]));
  tap(byFk(draw(scr(['flat-colors', 'accent'])).box, 'flatc:accent:inherit'));
  ok('Same as All Screens removes the field only', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { 'flat_colors.accent': null }]));
  tap(byFk(draw(go('#/house/appearance/flat-colors/page/calendar')).box, 'flatc:inherit'));
  ok('Use Inherited Colors on a page: the page’s entry goes', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'look.flat_page_colors.calendar': null }]));
  tap(byFk(draw(scr(['flat-colors'])).box, 'flatc:auto'));
  ok('Restore Automatic Colors: both Automatic here', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { 'flat_colors.accent': 'auto', 'flat_colors.off_tint': 'auto' }]));
  // an explicit background stays authoritative, and says so
  pg.data.settings.sky.flat_color = 'sage';
  look.flat_colors = { accent: SAGE, off_tint: 'accent' };
  var bgp = draw(go('#/house/appearance/flat-colors')).box;
  ok('a background chosen: Separate Choice, with Use Automatic Background', /Separate Choice/.test(text(bgp)) && !!byFk(bgp, 'flatc:bg-auto'), true);
  tap(byFk(bgp, 'flatc:bg-auto'));
  ok('...which writes only the background', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'sky.flat_background': 'color', 'sky.flat_color': 'auto' }]));
  // a Flat screen under a Glass house: All Screens' Flat Colors still editable
  look.flat = false; pg.data.boards['dashboard-k'].flat = true;
  var gp = text(draw(go('#/house/appearance')).box);
  ok('a Glass house with a Flat screen still shows Flat Colors, for those screens', /Flat Colors/.test(gp) && /For Screens Using Flat/.test(gp), true);
  ok('...and the screen links to All Screens’ Flat Colors', /All Screens’ Flat Colors/.test(text(draw(scr(['flat-colors'])).box)), true);
  ok('nothing written by looking', writes.length, 0);
})();

print(fail ? 'FAIL ' + fail + ' SETTINGS ROUTE TESTS' : 'ALL ' + pass + ' SETTINGS ROUTE TESTS PASS');
