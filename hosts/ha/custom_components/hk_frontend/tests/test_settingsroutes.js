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
ok('screen sky opens the named page', P.p_screen.call(page, 'dashboard-sky', ['sky']).title, 'Background');
var backdrop = P.p_screen.call(page, 'dashboard-sky', ['sky', 'backdrop']);
ok('screen backdrop opens its picker (Sky Colors)', backdrop.title, 'Sky Colors');
ok('screen backdrop Back returns to Background', backdrop.back[1], '#/screens/dashboard-sky/sky');
// SKY LIVELINESS (2026-10-08): a woodland season has its own page now, Back
// to the seasons; the night sky has one too
ok('a woodland season opens its own page', open('#/house/sky/woodland/fall').title, 'Autumn');
ok('...Back to the seasons', open('#/house/sky/woodland/fall').back[1], '#/house/appearance/sky/woodland');
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

print('\n=== Sleep Screen: Near the Screen (2026-10-30) ===');
(function () {
  var pg = Object.create(P), writes = [];
  var sl = { decided_by: 'hk', near: ['binary_sensor.hall_radar_zone', 'sensor.hall_distance'], near_cm: 80 };
  pg.p_overview = function () { return 'overview'; };
  pg.hs = function () { return null; };
  pg.hasAttribute = function () { return true; };
  pg.setT = function (tid, ch) { writes.push(ch); return Promise.resolve(true); };
  pg.pickers = {}; pg.errors = {}; pg.announce = function () {};
  pg.data = { settings: { tablets: {} }, boards: {}, choices: {}, tablets: { hall: { name: 'Hall', screen: 'dashboard-hall', sleep: sl } } };
  var go = function (hash) { return P.resolve.call(pg, hash.replace(/^#\/?/, '').split('/')); };
  var draw = function (pgx) { var box = document.createElement('div'), err = null; try { pgx.body(box); } catch (e) { err = String(e) + ' ' + (e.stack || '').split('\n')[0]; } return { box: box, err: err }; };
  var all = function (el, out) { out = out || []; out.push(el); (el.children || []).forEach(function (c) { if (c && typeof c === 'object') all(c, out); }); return out; };
  var text = function (box) { return all(box).map(function (e) { return e._text || e.textContent || ''; }).join(' | '); };
  var d = draw(go('#/house/tablets/hall/sleep'));
  ok('the Sleep Screen page draws', d.err, null);
  var t = text(d.box);
  ok('...with Near the Screen, its two sensors', /Near the Screen/.test(t) && /2 Entities/.test(t), true);
  ok('...Closer Than, for its distance sensor', /Closer Than/.test(t), true);
  ok('...and Back to the Screensaver', /Back to the Screensaver/.test(t), true);
  ok('its list page', go('#/house/tablets/hall/sleep/near').title, 'Near the Screen');
  sl.near = ['binary_sensor.hall_radar_zone'];
  t = text(draw(go('#/house/tablets/hall/sleep')).box);
  ok('a zone sensor alone: no Closer Than', /Closer Than/.test(t) || !/Back to the Screensaver/.test(t), false);
  sl.near = [];
  t = text(draw(go('#/house/tablets/hall/sleep')).box);
  ok('none chosen: the row and what it is for, nothing more', /Near the Screen/.test(t) && !/Back to the Screensaver/.test(t), true);
  sl.decided_by = 'automation';
  t = text(draw(go('#/house/tablets/hall/sleep')).box);
  ok('an automation deciding: the page says Near the Screen needs it decided here', /needs Decided By/.test(t), true);
  ok('opening it wrote nothing', writes.length, 0);
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
  [['features/energy/devices'], ['features/notify'], ['house/rooms/status'], ['house/appearance/sky/page/rooms'], ['page/water']].forEach(function (x) {
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
  ok('...one with the menu’s highlight now: back to Appearance', go('#/house/appearance/flat-colors/accent').back[1], '#/house/appearance');
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
  ok('...and says the Highlight is the Accent in Flat', /Accent Color/.test(hp) && /in Flat it also shades/.test(hp), true);
  var kp = text(draw(scr(['flat-colors'])).box);
  ok('Kitchen’s Flat Colors: the tint from All Screens, no accent of its own here (it is Appearance’s)', /From All Screens/.test(kp) && !/Lavender/.test(kp), true);
  var ka = text(draw(scr(['appearance'])).box);
  ok('Kitchen’s Appearance: its Accent Color, Lavender, its own Flat accent kept as Just This Screen', /Accent Color/.test(ka) && /Lavender/.test(ka) && /Just This Screen/.test(ka), true);
  ok('Kitchen’s Calendar: All Screens’ Rose wins -- said so', /From All Screens/.test(text(draw(scr(['flat-colors'])).box)), true);
  var kc = text(draw(scr(['flat-colors', 'page', 'calendar'])).box);
  ok('Calendar on Kitchen: Rose, from Calendar on All Screens', /Rose/.test(kc) && /From Calendar on All Screens/.test(kc), true);
  var pick = draw(scr(['accent'])).box;
  ok('the screen’s Accent Color: Same as All Screens, now Sage (All Screens’ Flat accent, in Flat)', /Same as All Screens/.test(text(pick)) && /Now Sage/.test(text(pick)), true);
  var pp = text(draw(go('#/page/calendar')).box);
  ok('Pages → Calendar → Look keeps the Accent Color and adds Flat Colors', /Accent Color/.test(pp) && /Flat Colors/.test(pp), true);
  ok('the old Highlight Color address is the Accent Color, Sage while All Screens is Flat', /Sage/.test(text(draw(go('#/house/menu/accent')).box)) && go('#/house/menu/accent').title === 'Accent Color', true);
  // the writes: one Accent Color, the menu's and Flat's together
  look.flat_colors = { accent: 'auto', off_tint: 'auto' };
  tap(byFk(draw(go('#/house/appearance/accent')).box, 'accent:blue'));
  ok('an accent over an Automatic tint: both colors and the tint in one write', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'menu.accent': 'blue', 'look.flat_colors.accent': 'blue', 'look.flat_colors.off_tint': 'accent' }]));
  look.flat_colors = { accent: SAGE, off_tint: '#789484' };
  tap(byFk(draw(go('#/house/appearance/accent')).box, 'accent:pink'));
  ok('...over a tint of its own: the tint stays', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'menu.accent': 'pink', 'look.flat_colors.accent': 'pink' }]));
  tap(byFk(draw(scr(['flat-colors', 'page', 'calendar', 'accent'])).box, 'flatc:accent:lavender'));
  ok('a page on a screen: one page’s patch, the other pages untouched', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { 'flat_page_colors.calendar': { accent: LAV } }]));
  tap(byFk(draw(scr(['accent'])).box, 'accent:inherit'));
  ok('Same as All Screens: both of the screen’s own go', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { menu_own: [], 'flat_colors.accent': null }]));
  tap(byFk(draw(scr(['accent'])).box, 'accent:green'));
  ok('...a color of its own: Just This Screen, both', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { accent: 'green', menu_own: ['accent'], 'flat_colors.accent': 'green' }]));
  tap(byFk(draw(go('#/house/appearance/flat-colors/page/calendar')).box, 'flatc:inherit'));
  ok('Use Inherited Colors on a page: the page’s entry goes', JSON.stringify(writes.pop()), JSON.stringify(['h', { 'look.flat_page_colors.calendar': null }]));
  tap(byFk(draw(scr(['flat-colors'])).box, 'flatc:auto'));
  ok('Restore Automatic Colors: the tint Automatic here (the accent is Appearance’s)', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { 'flat_colors.off_tint': 'auto' }]));
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

(function () {
  var pg = Object.create(P), states = {
    'light.bulb': { attributes: {} },
    'light.lamps': { attributes: { group_entities: ['light.bulb'] } },
    'light.hidden_group': { attributes: { entity_id: ['light.bulb'] } }
  };
  show(pg, { states: states, entities: {} });
  pg.data = { counts: { lights: { found: ['light.bulb'], exclude: [] } } };
  pg.accIds = function () { return Object.keys(states); };
  pg.hiddenAll = function (id) { return id === 'light.hidden_group'; };
  pg.hid = function () { return {}; };
  var T = window.hkSettingsModel.accType('lights');
  ok('light group controls appear in their accessory type without being counted',
     P.typeMembers.call(pg, T).join(), 'light.bulb,light.lamps');
  ok('accessory list count includes the visible group control', P.typeCount.call(pg, T), 2);
})();

print('\n=== Appearance and Menu, reorganized (2026-10-29) ===');
(function () {
  var EPr = document.createElement('span').constructor.prototype;
  if (!('firstChild' in EPr)) Object.defineProperty(EPr, 'firstChild', { configurable: true,
    get: function () { return this.children[0] || this._fc || (this._fc = document.createElement('svg')); } });
  var pg = Object.create(P), writes = [];
  pg.p_overview = function () { return 'overview'; };
  show(pg, { states: {}, entities: {}, devices: {}, areas: { kitchen: { name: 'Kitchen' } }, config: {} });
  var look = { flat: false, glass: 'blur', blur: 50, flat_colors: { accent: 'auto', off_tint: 'auto' }, flat_page_colors: {}, page_accents: {}, page_pills: {} };
  var boards = {
    // its own Tab Bar Size and accent; the rest All Screens'
    'dashboard-k': { pages: [], glass: 'house', menu: 'tabbar', menu_phone: 'button', button_phone: 'tab', menu_own: ['accent', 'tab_bar_size'],
                     accent: 'teal', tab_bar_size: 'large', tab_bar_pos: 'bottom', tab_position: '', tab_size: 'large', tab_size_phone: 'standard',
                     page_header: 'current', flat_colors: {}, rooms_custom: false, chips_row: true, chips: [], cameras: [], scenes: [], favorites: [],
                     categories: [], menu_top: [], headers: {}, tablets: [], popups: true, sky: true },
    'dashboard-c': { pages: [], glass: 'house', menu: 'off', menu_phone: 'off', menu_own: [], flat_colors: {} } };
  pg.data = { settings: { sky: { pages: {}, flat_pages: {}, background: 'live' }, look: look, menu: { accent: 'orange', bar_size: 'medium', style: 'auto' },
                          rooms: {}, generated: {}, headers: {}, status_rows: {}, security: {}, features: {}, weather: {}, calendar: {}, cameras: {}, browse: { hide: [], discover: [] } },
              choices: {}, counts: {}, kinds: {}, accessories: { pages: {} }, tablets: {},
              dashboards: [{ path: 'dashboard-k', title: 'Kitchen', item: true, generated: true }, { path: 'dashboard-c', title: 'Car', item: true, generated: true }],
              boards: boards, features: {}, popups: [], custom_pages: [], page_kinds: ['climate'], thirdparty: {}, suggest: {} };
  pg.dash = function (p) { return { path: p, title: p === 'dashboard-k' ? 'Kitchen' : 'Car', item: true, generated: true }; };
  pg.back = function () {}; pg.client = pg.client || {};
  pg.hasAttribute = function () { return true; };
  pg.setB = function (path, ch) { writes.push(['b', path, ch]); return Promise.resolve(true); };
  pg.setH = function (ch) { writes.push(['h', ch]); return Promise.resolve(true); };
  pg.feat = function () { return { data: null }; };
  pg.pickers = {}; pg.errors = {}; pg.announce = function () {};
  var go = function (hash) { return P.resolve.call(pg, hash.replace(/^#\/?/, '').split('/')); };
  var draw = function (pgx) { var box = document.createElement('div'), err = null; try { pgx.body(box); } catch (e) { err = String(e) + ' ' + (e.stack || '').split('\n')[0]; } return { box: box, err: err }; };
  var all = function (el, out) { out = out || []; out.push(el); (el.children || []).forEach(function (c) { if (c && typeof c === 'object') all(c, out); }); return out; };
  var text = function (box) { return all(box).map(function (e) { return e._text || e.textContent || ''; }).join(' | '); };
  var byFk = function (box, fk) { return all(box).filter(function (e) { return e.attrs && e.attrs['data-fk'] === fk; })[0]; };
  var tap = function (el) { ((el && el._listeners && el._listeners.click) || []).forEach(function (f) { f({}); }); if (el && typeof el.onclick === 'function') el.onclick({}); };
  ['#/house/appearance', '#/house/appearance/accent', '#/house/appearance/sky', '#/house/menu', '#/house/menu/side', '#/house/menu/edge-tab',
   '#/house/menu/tab-bar', '#/house/menu/header', '#/house/menu/side/tablets', '#/house/menu/side/phones',
   '#/screens/dashboard-k', '#/screens/dashboard-k/appearance', '#/screens/dashboard-k/accent', '#/screens/dashboard-k/menu',
   '#/screens/dashboard-k/menu/side', '#/screens/dashboard-k/menu/edge-tab', '#/screens/dashboard-k/menu/tab-bar',
   '#/screens/dashboard-k/menu/side/phones', '#/screens/dashboard-c/menu', '#/screens/dashboard-c/appearance'].forEach(function (h) {
    ok(h + ' draws', draw(go(h)).err, null);
  });
  ok('opening every one of them wrote nothing', writes.length, 0);
  // the old addresses open the new pages
  ok('Background (Sky / Background before) opens under Appearance', go('#/house/sky').title === 'Background' && go('#/house/sky').back[1] === '#/house/appearance', true);
  ok('...and its pages too', go('#/house/sky/woodland').back[1], '#/house/appearance/sky');
  ok('the sidebar has no Sky entry', /\['sky',/.test(read(HK_ROOT + '/frontend/panels/hk-settings.js').split('var HOUSE = [')[1].split('];')[0]), false);
  ok('the Highlight Color is the Accent Color', go('#/house/menu/accent').title, 'Accent Color');
  ok('...a screen’s too, whether its menu follows or not', go('#/screens/dashboard-k/menu/accent').title, 'Accent Color');
  ok('the device pages open Menu', go('#/house/menu/tablets').title, 'Menu');
  ok('...a button style the Side Menu’s', go('#/house/menu/tablets/style').title === 'Button Style' && go('#/house/menu/tablets/style').back[1] === '#/house/menu/side', true);
  ok('a screen’s device page opens its Menu', go('#/screens/dashboard-k/menu/phones').title, 'Menu');
  // All Screens -> Appearance
  var ap = text(draw(go('#/house/appearance')).box);
  ok('All Screens’ Appearance: Style (with Tile Style), Colors & Background, Tab Bar', ['Style', 'Tile Style', 'Colors & Background', 'Tab Bar', 'Accent Color', 'Tab Bar Glass', 'Background'].every(function (w) { return ap.indexOf(w) >= 0; }) &&
     !/Tab Bar Look|Sky \/ Background|Tiles/.test(ap), true);
  ok('...no Flat Colors while no screen is Flat', /Flat Colors/.test(ap), false);
  // All Screens -> Menu
  var mp = text(draw(go('#/house/menu')).box);
  ok('Menu on Each Screen: its two choices in words as the value', /Tab Bar, Button on Phones/.test(mp) && /\bOff\b/.test(mp) && !/ · /.test(mp), true);
  ok('Navigation: who uses each', /Side Menu/.test(mp) && /Edge Tab/.test(mp) && /Tab Bar/.test(mp) && /Kitchen/.test(mp), true);
  ok('...and the rooms’ one home, and Back Button & Title', /Rooms in the Menu/.test(mp) && /Back Button & Title/.test(mp), true);
  ok('a kind says who uses it, under its title (the page\'s scope line)', /Not used on any screen/.test(go('#/house/menu/side').scope) === false &&
     /Used by Kitchen/.test(go('#/house/menu/edge-tab').scope) && !/Used by/.test(text(draw(go('#/house/menu/edge-tab')).box)), true);
  // a screen's Menu Settings: only the kinds it uses, each setting its own one at a time
  var sm = text(draw(go('#/screens/dashboard-k/menu')).box);
  ok('a screen’s Menu Settings lists only the kinds it uses', /Side Menu/.test(sm) && /Edge Tab/.test(sm) && /Tab Bar/.test(sm), true);
  var nm = draw(go('#/screens/dashboard-c/menu')).box;
  ok('...a screen with no menu: its menu on each device at the top, no kinds', /Menu on This Screen/.test(text(nm)) && !!byFk(nm, 'b:menu:off') && !!byFk(nm, 'b:menu_phone:off') && !/Navigation/.test(text(nm)), true);
  ok('...and its page has the one Menu row, its menus in words', /Off/.test(text(draw(go('#/screens/dashboard-c')).box)) && !byFk(draw(go('#/screens/dashboard-c')).box, 'b:menu:off'), true);
  var tbp = draw(go('#/screens/dashboard-k/menu/tab-bar')).box;
  ok('its Tab Bar page: Size Just This Screen, Position Same as All Screens', /Just This Screen/.test(text(tbp)) && /Same as All Screens/.test(text(tbp)), true);
  tap(byFk(tbp, 'b:tab_bar_size:reset'));
  ok('Reset to All Screens takes the one setting back', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { menu_own: ['accent'] }]));
  var sp = draw(go('#/screens/dashboard-k/menu/side/phones')).box;
  tap(byFk(sp, 'phone:chip'));
  ok('a button style chosen on a screen is its own', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { button_phone: 'chip', menu_own: ['accent', 'tab_bar_size', 'button_phone'] }]));
  // a screen's page: Appearance one row; Back Button & Title in its Header
  var main = text(draw(go('#/screens/dashboard-k')).box);
  ok('a screen’s Appearance is one row: its style and whose it is', /Appearance/.test(main) && /Blur/.test(main) && !/Shared Layer/.test(main) && /Same as All Screens/.test(main), true);
  ok('...Back Button & Title beside its other header settings', /Back Button & Title/.test(main), true);
  ok('...no Sky group of its own any more', main.split('Sky / Background').length - 1, 0);
  var sa = text(draw(go('#/screens/dashboard-k/appearance')).box);
  ok('a screen’s Appearance: laid out as All Screens’', ['Style', 'Colors', 'Background', 'Accent Color', 'Teal', 'Just This Screen', 'Tab Bar Glass'].every(function (w) { return sa.indexOf(w) >= 0; }), true);
  ok('...a screen with no tab bar has no Tab Bar Look', /Tab Bar Look/.test(text(draw(go('#/screens/dashboard-c/appearance')).box)), false);

  // RECOMMENDED (2026-10-29): one change that should help where a tablet draws under 45 frames a second (a sample from before the ladder speaks for the style)
  ok('no recommendation on a host without tablet reports', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)), false);
  var asked = 0;
  var reports = [{ name: 'Kitchen Tablet', screens: ['dashboard-k'], fps: 38.2, fps_screen: 'dashboard-k', fps_style: 'blur', fps_at: Date.now() / 1000 - 60 }];
  pg._host = { tabletHealth: function () { asked++; return Promise.resolve(reports); } };
  draw(go('#/screens/dashboard-k/appearance'));
  drainMicrotasks();
  var rp = draw(go('#/screens/dashboard-k/appearance')).box, rt = text(rp);
  ok('the host is asked once for its tablets’ numbers', asked, 1);
  ok('a screen’s Appearance: why, after the Style', /Kitchen Tablet draws 38 frames a second with Blur\. Glass looks almost the same and is lighter\./.test(rt) &&
     rt.indexOf('Recommended') > rt.indexOf('Appearance Style') && rt.indexOf('Recommended') < rt.indexOf('Accent Color'), true);
  ok('...Use Glass on This Screen and Use Flat', !!byFk(rp, 'rec:glass') && !!byFk(rp, 'rec:flat'), true);
  ok('...opening it wrote nothing', writes.length, 0);
  tap(byFk(rp, 'rec:glass'));
  ok('Use Glass sets this screen’s own style, never All Screens’', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { flat: false, glass: 'clear' }]));
  tap(byFk(rp, 'rec:flat'));
  ok('Use Flat too', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { flat: true }]));
  var hr = draw(go('#/house/appearance')).box;
  ok('All Screens’ Appearance: a row for the screen, to its Appearance', !!byFk(hr, 'rec:slow:dashboard-k') &&
     byFk(hr, 'rec:slow:dashboard-k').attrs.href === '#/screens/dashboard-k/appearance' && /Kitchen Tablet: 38 frames a second/.test(text(hr)), true);
  ok('...and only for it (no report from the other screen)', !byFk(hr, 'rec:slow:dashboard-c'), true);
  ok('...without buttons of its own', !byFk(hr, 'rec:glass') && !byFk(hr, 'rec:flat'), true);
  boards['dashboard-k'].glass = 'clear';
  ok('gone once the screen wears Glass', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)) ||
     !!byFk(draw(go('#/house/appearance')).box, 'rec:slow:dashboard-k'), false);
  boards['dashboard-k'].glass = 'house';
  reports[0].fps = 52;
  ok('...and while the tablet draws 45 or more', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)), false);
  reports[0].fps = 38.2;
  ok('a host with reports shows none under This Device', /for This Device/.test(text(draw(go('#/screens/dashboard-k')).box)), false);
  // THE LADDER, one step at a time: a sample speaks only for what was on the screen when it was drawn
  var Mo = window.hkSettingsModel, kb = boards['dashboard-k'], sample = function (fps, cams) {
    return { name: 'Kitchen Tablet', screens: ['dashboard-k'], fps: fps, fps_screen: 'dashboard-k', fps_style: 'x', fps_at: Date.now() / 1000 - 60,
             fps_sig: Mo.ladderSignature(Mo.ladderFacts(kb, look, pg.data.settings.sky, cams || { strip: false })) };
  };
  reports[0] = sample(38.2);
  var l1 = draw(go('#/screens/dashboard-k/appearance')).box;
  ok('a sample with its signature: step 1, the style', !!byFk(l1, 'rec:glass') && !!byFk(l1, 'rec:flat') && !byFk(l1, 'rec:rain'), true);
  ok('...its footer says when the next one comes', /Glass looks almost the same and is lighter\. If it’s still slow an hour from now, the next suggestion appears here\./.test(text(l1)), true);
  tap(byFk(l1, 'rec:glass'));
  Object.assign(kb, writes.pop()[2]);
  ok('the style taken: nothing more from the same sample', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)) ||
     !!byFk(draw(go('#/house/appearance')).box, 'rec:slow:dashboard-k'), false);
  reports[0] = sample(52);
  ok('...nor from a new one that is fast', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)), false);
  reports[0] = sample(40.4);
  var l2 = draw(go('#/screens/dashboard-k/appearance')).box;
  ok('a new one that is still slow: step 2, Rain & Snow', /Kitchen Tablet draws 40 frames a second with Rain & Snow on\./.test(text(l2)) &&
     !byFk(l2, 'rec:glass') && /Turn Off Rain & Snow on This Screen/.test(text(l2)) && !!byFk(l2, 'rec:flat'), true);
  var hr2 = draw(go('#/house/appearance')).box;
  ok('...All Screens’ Appearance names the change in the screen’s row', /Rain & Snow/.test(text(byFk(hr2, 'rec:slow:dashboard-k'))), true);
  ok('...opening them wrote nothing', writes.length, 0);
  tap(byFk(l2, 'rec:rain'));
  ok('Turn Off Rain & Snow is this screen’s own', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { sky_precipitation: false }]));
  kb.sky_precipitation = false;
  reports[0] = sample(41);
  var l3 = draw(go('#/screens/dashboard-k/appearance')).box;
  ok('step 3 is Animations (Moving Things are behind the cards here)', /with Animations on\. Off, the sky holds still/.test(text(l3)) && !!byFk(l3, 'rec:anim'), true);
  tap(byFk(l3, 'rec:anim'));
  ok('...Animations off, this screen only', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { sky_animations: false }]));
  kb.sky_animations = false;
  reports[0] = sample(41);
  ok('...no camera in the house: the ladder ends', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)), false);
  // a house with a camera: the last step, Live First Camera
  pg.client.states['camera.front'] = { state: 'idle', attributes: {} };
  reports[0] = sample(41, { strip: true });
  var l4 = draw(go('#/screens/dashboard-k/appearance')).box;
  ok('a camera on the screen: Live First Camera off, the last step (no next one to promise)', !!byFk(l4, 'rec:camera') && /with a camera playing live/.test(text(l4)) &&
     !/the next suggestion appears here/.test(text(l4)), true);
  tap(byFk(l4, 'rec:camera'));
  ok('...this screen’s own', JSON.stringify(writes.pop()), JSON.stringify(['b', 'dashboard-k', { camera_live_video: false }]));
  delete pg.client.states['camera.front'];
  delete kb.sky_precipitation; delete kb.sky_animations;
  reports[0] = { name: 'Kitchen Tablet', screens: ['dashboard-k'], fps: 38.2, fps_screen: 'dashboard-k', fps_style: 'blur', fps_at: Date.now() / 1000 - 60 };
  kb.glass = 'house'; kb.flat = undefined;
  // HOME ASSISTANT: no reports; this device's own sample, under This Device on the screen it measured
  pg._host = null; pg._health = undefined;
  localStorage.setItem('hk-fps', JSON.stringify({ fps: 31.6, at: Date.now() - 60000, screen: 'dashboard-k', style: 'blur' }));
  var dp = draw(go('#/screens/dashboard-k')).box, dt = text(dp);
  ok('This Device: this device’s own number, on the screen it measured', /Recommended for This Device/.test(dt) &&
     /This device draws 32 frames a second with Blur/.test(dt) && dt.indexOf('Recommended for This Device') > dt.indexOf('Car Browser'), true);
  ok('...with the same two buttons', !!byFk(dp, 'rec:glass') && !!byFk(dp, 'rec:flat'), true);
  ok('...not on another screen’s page', /for This Device/.test(text(draw(go('#/screens/dashboard-c')).box)), false);
  ok('...nor on the Appearance page (its home is This Device)', /Recommended/.test(text(draw(go('#/screens/dashboard-k/appearance')).box)), false);
  localStorage.removeItem('hk-fps');
  ok('...and nothing without a sample', /for This Device/.test(text(draw(go('#/screens/dashboard-k')).box)), false);
  // ...the ladder too: the next step from a new sample, none from one drawn with something else on
  var mine = function (b2, fps) {
    return JSON.stringify({ fps: fps, at: Date.now() - 60000, screen: 'dashboard-k', style: 'clear',
                            sig: Mo.ladderSignature(Mo.ladderFacts(b2, look, pg.data.settings.sky, { strip: false })) });
  };
  kb.glass = 'clear';
  localStorage.setItem('hk-fps', mine(kb, 33));
  var dr = draw(go('#/screens/dashboard-k')).box;
  ok('This Device: once the style is Glass, the next step from a sample drawn with it', /Recommended for This Device/.test(text(dr)) &&
     /This device draws 33 frames a second with Rain & Snow on\./.test(text(dr)) && !!byFk(dr, 'rec:rain'), true);
  localStorage.setItem('hk-fps', mine(Object.assign({}, kb, { glass: 'blur' }), 33));
  ok('...but nothing from one drawn with Blur still on', /for This Device/.test(text(draw(go('#/screens/dashboard-k')).box)), false);
  localStorage.removeItem('hk-fps');
  kb.glass = 'house';
  ok('opening every one of them wrote nothing', writes.length, 0);
})();

print('\n=== the clock recommendation on the kit’s recommend (2026-10-29) ===');
(function () {
  var g = window.hkSettingsKit.recommend({ title: 'Recommended for Kitchen', says: 'Why it is.', actions: [{ label: 'Use It', sk: 'saver:clock_rec', onClick: function () {} }] });
  var kids = g.children, said = function (el) {
    return (el._text || el.textContent || '') + (el.children || []).map(function (k) { return typeof k === 'object' ? said(k) : String(k); }).join('');
  };
  ok('a group with its title, its button and its reason', [kids.length, said(kids[0]), said(kids[2])].join(' | '), '3 | Recommended for Kitchen | Why it is.');
  ok('...the button keeps its key', kids[1].children[0].attrs['data-fk'], 'saver:clock_rec');
  ok('the saver’s clock page draws it through the kit', /K\.recommend\(\{ title: room \? 'Recommended for ' \+ room/.test(read(HK_ROOT + '/frontend/panels/hk-settings.js')), true);
})();

print(fail ? 'FAIL ' + fail + ' SETTINGS ROUTE TESTS' : 'ALL ' + pass + ' SETTINGS ROUTE TESTS PASS');
