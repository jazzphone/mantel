// hk-settings.js: the fallbacks a house with nothing configured gets, and
// the cache/change plumbing every page relies on.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-settings.js');
var HS = window.hkSettings;
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function st(v) { return { state: String(v), attributes: {} }; }

print('=== defaults: nothing configured ===');
ok('weather: the first weather entity, sorted', HS.weatherId({ 'weather.zz': st('x'), 'weather.aa': st('y'), 'sun.sun': st('z') }) === 'weather.aa');
ok('weather: none at all is null', HS.weatherId({}) === null);
var ck = HS.clock({});
ok('clock without Time & Date sensors uses the screen clock', /^\d\d:\d\d$/.test(ck.time) && /^\d{4}-\d\d-\d\d$/.test(ck.date), ck);
ok('clock with the sensors reads them', HS.clock({ 'sensor.time': st('07:05'), 'sensor.date': st('2026-01-02') }).time === '07:05');
// Known new moons and full moons (UTC): the computed phase lands within a day.
function near(a, b) { var d = Math.abs(a - b); return Math.min(d, 1 - d) < 1 / 29.5; }
ok('new moon 2026-01-18 is ~0', near(HS.moon({}, new Date(Date.UTC(2026, 0, 18, 19, 52))), 0), HS.moon({}, new Date(Date.UTC(2026, 0, 18, 19, 52))));
ok('full moon 2026-03-03 is ~0.5', near(HS.moon({}, new Date(Date.UTC(2026, 2, 3, 11, 38))), 0.5), HS.moon({}, new Date(Date.UTC(2026, 2, 3, 11, 38))));
ok('seasonal gate: absent means on', HS.seasonalOn({}) === true);
// Browse Music before the integration answers: its five Discover rows, as the
// queries a library card runs -- a generated dashboard's page has no YAML
// rows of its own.
ok('browse: the five default Discover rows, in order',
   HS.get('browse.discover').map(function (r) { return r.title; }).join('|') ===
   'Recently played|Favorite playlists|Most played|Recently added|Favorite radio');
ok('browse: nothing left out by default', HS.get('browse.hide').length === 0);

print('\n=== computed holiday seasons (the built-in windows) ===');
function s(y, m, d) { return HS.seasonName({}, new Date(y, m - 1, d, 12)); }
ok('Sep 21 is nothing', s(2026, 9, 21) === '');
ok('Sep 22 starts Halloween', s(2026, 9, 22) === 'Halloween');
ok('Oct 31 is Halloween', s(2026, 10, 31) === 'Halloween');
ok('Nov 1 starts Thanksgiving', s(2026, 11, 1) === 'Thanksgiving');
ok('Thanksgiving Day 2026 (Nov 26) is Thanksgiving', s(2026, 11, 26) === 'Thanksgiving');
// The Christmas SKY window is Dec 7..25: the garland is eligible only from
// Dec 7, so the weeks after Thanksgiving are no season for it.
ok('the day after Thanksgiving is no season for the sky', s(2026, 11, 27) === '');
ok('Christmas starts Dec 7', s(2026, 12, 6) === '' && s(2026, 12, 7) === 'Christmas');
ok('Thanksgiving 2027 is Nov 25', s(2027, 11, 25) === 'Thanksgiving' && s(2027, 11, 26) === '');
ok('Dec 25 is Christmas', s(2026, 12, 25) === 'Christmas');
ok('Dec 26 is nothing', s(2026, 12, 26) === '');

print('\n=== the server answer ===');
var seen = 0, woke = 0;
HS.onChange(function () { seen++; });
window.addEventListener('hk-module-ready', function (e) { if (e.detail && e.detail.module === 'hk-settings') woke++; });
var v0 = HS.version;
HS._apply({ configured: true, weather: { entity: 'weather.home', place: 'HOME' }, sky: { moon: 'sensor.moon' },
            clock: { time: null, date: null } });
ok('a change bumps the version, calls listeners and wakes the cards', HS.version === v0 + 1 && seen === 1 && woke === 1);
ok('the chosen weather entity wins, even if missing', HS.weatherId({ 'weather.aa': st('x') }) === 'weather.home');
ok('a chosen moon sensor is read', HS.moon({ 'sensor.moon': st('0.25') }) === 0.25);
ok('a chosen but unavailable moon sensor is 0.5', HS.moon({ 'sensor.moon': st('unavailable') }) === 0.5);
ok('a cleared clock sensor falls back to the screen', /^\d\d:\d\d$/.test(HS.clock({ 'sensor.time': st('99:99') }).time));
ok('unset sections keep their defaults', JSON.stringify(HS.get('security.locks')) === '[]');
HS._apply({ configured: true, weather: { entity: 'weather.home', place: 'HOME' }, sky: { moon: 'sensor.moon' },
            clock: { time: null, date: null } });
ok('the same answer again is not a change', HS.version === v0 + 1 && seen === 1);
ok('the answer is cached for the next page load', JSON.parse(localStorage.getItem('hk_settings')).weather.entity === 'weather.home');
ok('unknown keys are ignored', (HS._apply({ weather: { nonsense: 1 } }), HS.get('weather.nonsense')) === undefined);
// the dashboard items arrive whole, keyed by the dashboards' own url paths
// THE HOUSE'S CUSTOM CHIPS and PAGES arrive whole (a merge that dropped the
// chips would leave a screen that lists one drawing nothing)
HS._apply({ configured: true, custom_chips: [{ key: 'battery', name: 'Battery', after: 'end', card: { type: 'custom:hk-status-chip-card' } }],
            custom_pages: [{ path: 'energy', title: 'Energy', view: { cards: [] } }] });
ok('custom chips reach the screens', JSON.stringify(HS.get('custom_chips', null).map(function (c) { return c.key; })) === '["battery"]');
ok('...and custom pages', HS.get('custom_pages', [])[0].path === 'energy');
HS._apply({ configured: true });
ok('...none when the house has none', HS.get('custom_chips', null).length === 0);
// THE FEATURES ADDED: a card offers a feature only when it is added.
HS._apply({ configured: true, added: ['clean_areas', 'music', 5] });
ok('the added features reach the screens', JSON.stringify(HS.get('added', null)) === '["clean_areas","music"]');
HS._apply({ configured: true });
ok('...none added: an empty list', JSON.stringify(HS.get('added', null)) === '[]');
// THE ENERGY PAGE'S PLAN reaches the screens whole; none without the feature
HS._apply({ configured: true, added: ['energy'], energy: { title: 'Energy', sections: [{ id: 'rooms', items: [] }] } });
ok('the Energy page\'s plan reaches the screens', HS.get('energy.title', null) === 'Energy' && HS.get('energy.sections', []).length === 1);
HS._apply({ configured: true });
ok('...none without Energy', HS.get('energy', 'none') === 'none');
HS._apply({ configured: true, boards: { 'dashboard-hall': { menu: 'open', time_weather: 'menu' } } });
ok('the dashboard items are kept whole', HS.get('boards.dashboard-hall.menu') === 'open' &&
   HS.get('boards.dashboard-hall.time_weather') === 'menu');
HS._apply({ configured: true });
ok('...and none is an empty map, never a leftover', JSON.stringify(HS.get('boards', null)) === '{}');
HS._apply({ configured: true, boards: ['dashboard-hall'] });
ok('a list where the map should be is not taken', JSON.stringify(HS.get('boards', null)) === '{}');

print('\n=== seasonal themes: Christmas start, themes off ===');
HS._apply({ configured: true, sky: { christmas_from: '12-01' } });
ok('Christmas from 12-01: Nov 27 is not Christmas yet', s(2026, 11, 27) === '');
ok('...Dec 1 is', s(2026, 12, 1) === 'Christmas');
ok('...and Thanksgiving still runs to its day', s(2026, 11, 26) === 'Thanksgiving');
HS._apply({ configured: true, sky: { christmas_from: '11-15' } });
ok('a start before Thanksgiving wins over it', s(2026, 11, 20) === 'Christmas');
HS._apply({ configured: true, sky: { themes: ['christmas', 'birthday'] } });
ok('themeOn follows the list', HS.themeOn('christmas') && !HS.themeOn('thanksgiving'));
HS._apply({ configured: true });
ok('with no list, every theme is on', HS.themeOn('space-night') && HS.themeOn('halloween'));

print('\n=== the header counts a garage COVER, and a moving one is not shut ===');
load(HK_ROOT + '/frontend/modules/hk-header.js');
HS._apply({ configured: true, security: { alarm: 'alarm_control_panel.a', garage: ['cover.garage'],
            doors: ['binary_sensor.garage_entry'], locks: [], windows: [] } });
function sec(g, d) {
  return window.hkHeader.status({ 'alarm_control_panel.a': st('armed_away'), 'cover.garage': st(g),
                                  'binary_sensor.garage_entry': st(d) });
}
ok('closed cover + shut entry door: Home Secured', sec('closed', 'off').secured === true);
ok('an open cover says Garage Open', sec('open', 'off').items.indexOf('Garage Open') >= 0);
ok('a cover still OPENING is not secured', sec('opening', 'off').secured === false && sec('opening', 'off').garageOpen);
ok('a cover CLOSING is not secured either', sec('closing', 'off').secured === false);
ok('the entry door is a DOOR, not the garage', JSON.stringify(sec('closed', 'on').items) === '["1 Door Open"]', sec('closed', 'on').items);

print('\n=== the Seasonal decorations switch ===');
HS._apply({ configured: true, sky: { decorations: false } });
ok('the switch off: no decoration, whatever else says', HS.seasonalOn({}) === false);
HS._apply({ configured: true, sky: { decorations: true, seasonal: 'input_boolean.extra' } });
ok('on, with an extra gate that is off: none', HS.seasonalOn({ 'input_boolean.extra': st('off') }) === false);
ok('on, with the extra gate on: decorations', HS.seasonalOn({ 'input_boolean.extra': st('on') }) === true);
HS._apply({ configured: true });
ok('by default: decorations', HS.seasonalOn({}) === true);

print('\n=== each screen\'s own strength of the same look, across a navigation ===');
if (!document.documentElement) document.documentElement = document.createElement('html');
location.pathname = '/dashboard-a/home';
HS._apply({ configured: true, look: { glass: 'blur', blur: 50 },
  boards: { 'dashboard-a': { blur: 10 }, 'dashboard-b': { blur: 90 } } });
var rs = document.documentElement.style;
ok('screen A: its own blur (10 -> 4 px)', /blur\(4px\)/.test(rs['--hk-blur-filter'] || ''), rs['--hk-blur-filter']);
location.pathname = '/dashboard-b/home';
dispatchEvent(new CustomEvent('location-changed'));
ok('...then screen B, the same look at its own 90: 36 px (it kept A\'s 4 px)',
   /blur\(36px\)/.test(rs['--hk-blur-filter'] || ''), rs['--hk-blur-filter']);
HS._apply({ configured: true });


HS._apply({ sky: {} });
ok('existing users retain Old Decorations', HS.skyLook().decorationStyle === 'old');
location.pathname = '/dashboard-sky/home';
HS._apply({sky:{decoration_style:'new'},boards:{'dashboard-sky':{sky_decoration_style:'old'}}});
ok('screen keeps old style while house uses new', HS.skyLook().decorationStyle === 'old');
HS._apply({sky:{decoration_style:'old'},boards:{'dashboard-sky':{sky_decoration_style:'new'}}});
ok('screen can opt into new style independently', HS.skyLook().decorationStyle === 'new');
HS._apply({sky:{decoration_style:'new'},boards:{'dashboard-sky':{sky_decoration_style:null}}});
ok('reset style follows All Screens', HS.skyLook().decorationStyle === 'new');
print('=== Moving Things ===');
HS._apply({ sky: {} });
ok('moving things behind the cards unless chosen', HS.skyLook().moving === 'behind');
HS._apply({sky:{moving:'front'},boards:{'dashboard-sky':{sky_moving:null}}});
ok('...All Screens\' in front', HS.skyLook().moving === 'front');
HS._apply({sky:{moving:'front'},boards:{'dashboard-sky':{sky_moving:'behind'}}});
ok('...a screen can keep them behind', HS.skyLook().moving === 'behind');
HS._apply({sky:{moving:'behind'},boards:{'dashboard-sky':{sky_moving:'front'}}});
ok('...or bring them in front on its own', HS.skyLook().moving === 'front');
print('=== Reduce Motion (2026-10-29) ===');
(function () {
  var realMM = globalThis.matchMedia, reduce = false;
  globalThis.matchMedia = function (q) { return { matches: /prefers-reduced-motion/.test(q) && reduce }; };
  HS._apply({ sky: {} });
  ok('animations are on unless something turns them off', HS.skyLook().animations === true && HS.reducedMotion() === false);
  reduce = true;
  ok('a device that asks for reduced motion: the sky is at rest (skyLook().animations false)',
     HS.skyLook().animations === false && HS.reducedMotion() === true);
  ok('...the other looks are untouched', HS.skyLook().weather === true && HS.skyLook().precipitation === true && HS.skyLook().decorations === true);
  reduce = false;
  HS._apply({ sky: { animations: false } });
  ok('a screen whose Animations are off is at rest, as before', HS.skyLook().animations === false);
  reduce = true;
  HS._apply({ sky: { animations: true } });
  ok('...and the device\'s word is not saved: the setting underneath is as it was', HS.get('sky.animations') === true && HS.skyLook().animations === false);
  reduce = false;
  ok('...and applies again when the device stops asking', HS.skyLook().animations === true);
  globalThis.matchMedia = function () { throw new Error('no media'); };
  ok('a browser that cannot answer: motion stays', HS.skyLook().animations === true && HS.reducedMotion() === false);
  globalThis.matchMedia = realMM;
  HS._apply({ sky: {} });
})();
print('=== Daytime Sky ===');
HS._apply({ sky: {} });
ok('the daytime sky is Natural by default (full brightness)', HS.skyLook().brightness === 1);
HS._apply({ sky: { daytime: 'balanced' } });
ok('Balanced is half', HS.skyLook().brightness === 0.5);
HS._apply({ sky: { daytime: 'balanced' }, boards: { 'dashboard-sky': { sky_daytime: 'deep' } } });
ok('a screen can choose Deep on its own', HS.skyLook().brightness === 0);
HS._apply({ sky: { daytime: 'deep' }, boards: { 'dashboard-sky': { sky_daytime: null } } });
ok('...and follows All Screens again when reset', HS.skyLook().brightness === 0);
HS._apply({ sky: { daytime: 'glaring' } });
ok('an unknown daytime sky is Natural', HS.skyLook().brightness === 1);
print('=== Sky / Background inheritance ===');
location.pathname = '/dashboard-sky/home';
var houseStops = { day: ['#123456', '#223344', '#334455', '#445566'], night: ['#010203', '#020304', '#030405', '#040506'] };
var ownStops = { day: ['#555555', '#444444', '#333333', '#222222'], night: ['#111111', '#222222', '#333333', '#444444'] };
HS._apply({ sky: { animations: false, weather: false, decorations: false, gradient: 'custom', gradient_custom: houseStops },
            boards: { 'dashboard-sky': { sky_gradient: null, sky_custom: ownStops } } });
var sl = HS.skyLook();
ok('following uses all house flags and house custom colors, even with a stored own draft',
   !sl.animations && !sl.weather && !sl.decorations && JSON.stringify(sl.backdrop) === JSON.stringify(houseStops));
HS._apply({ sky: { decorations: false, gradient: 'dusk' }, boards: { 'dashboard-sky': {
  sky_animations: false, sky_weather: false, sky_decorations: true, sky_gradient: 'live' } } });
sl = HS.skyLook();
ok('own Live overrides a fixed house backdrop', sl.backdrop === null);
ok('own decorations on overrides house off through the seasonal gate', sl.decorations && HS.seasonalOn({}));
HS._apply({ sky: { seasonal: 'input_boolean.extra', decorations: false },
            boards: { 'dashboard-sky': { sky_decorations: true, sky_gradient: 'custom', sky_custom: ownStops } } });
ok('own custom colors resolve', JSON.stringify(HS.skyLook().backdrop) === JSON.stringify(ownStops));
ok('the extra seasonal gate still applies to an own decorations override', !HS.seasonalOn({ 'input_boolean.extra': st('off') }));
HS._apply({ sky: { gradient: 'fjord' }, boards: { 'dashboard-sky': { sky_gradient: null } } });
ok('curated backdrop matches the published palette', JSON.stringify(HS.skyLook().backdrop.day) === JSON.stringify(HS.skyPalettes().filter(function(p) { return p.id === 'fjord'; })[0].day));
location.pathname = '/dashboard-other/home';
ok('moving to another dashboard uses that dashboard settings', HS.skyLook().animations === true);
HS._apply({ sky: { gradient: 'custom', gradient_custom: null } });
ok('unset custom stops fall back to live', HS.skyLook().backdrop === null);
HS._apply({ sky: { gradient: 'bad' } });
ok('unknown persisted palette falls back to live', HS.skyLook().backdrop === null);
print('=== the Background: Live Sky, Color or Photo (2026-10-13) ===');
location.pathname = '/dashboard-sky/home';
var photoA = '/api/image/serve/' + 'a'.repeat(32) + '/original', photoB = '/local/porch.jpg';
var mid = HS.skyPalettes().filter(function (p) { return p.id === 'midnight'; })[0];
HS._apply({ sky: {} });
ok('the live sky by default', HS.skyLook().background.mode === 'live' && HS.skyLook().background.stops === null);
HS._apply({ sky: { background: 'color' } });
var bgc = HS.skyLook().background;
ok('Color is a still: Midnight unless chosen', bgc.mode === 'color' && JSON.stringify(bgc.stops.day) === JSON.stringify(mid.day));
HS._apply({ sky: { background: 'color', color: 'custom', gradient_custom: houseStops } });
ok('...Custom: the house\u2019s own stops', JSON.stringify(HS.skyLook().background.stops) === JSON.stringify(houseStops));
HS._apply({ sky: { background: 'color', color: 'custom', gradient_custom: null } });
ok('...Custom with no stops is Black, never the live sky', JSON.stringify(HS.skyLook().background.stops) === JSON.stringify(HS.BLACK));
HS._apply({ sky: { background: 'photo', photo: photoA } });
ok('Photo: All Screens\u2019 photo', HS.skyLook().background.mode === 'photo' && HS.skyLook().background.photo === photoA);
HS._apply({ sky: { background: 'photo', photo: null } });
ok('...none chosen: no photo (the sky paints Black)', HS.skyLook().background.photo === null);
HS._apply({ sky: { background: 'live', photo: photoA, color: 'plum' }, boards: { 'dashboard-sky': { sky_background: 'photo', sky_photo: photoB } } });
ok('a screen\u2019s own Photo, over All Screens\u2019 Live Sky', HS.skyLook().background.mode === 'photo' && HS.skyLook().background.photo === photoB);
HS._apply({ sky: { background: 'photo', photo: photoA }, boards: { 'dashboard-sky': { sky_background: null, sky_photo: null } } });
ok('...following All Screens: its photo', HS.skyLook().background.photo === photoA);
HS._apply({ sky: { background: 'color', color: 'plum' }, boards: { 'dashboard-sky': { sky_background: null, sky_color: 'ember' } } });
ok('a screen\u2019s own color, under All Screens\u2019 Color', JSON.stringify(HS.skyLook().background.stops) ===
   JSON.stringify(HS.skyPalettes().filter(function (p) { return p.id === 'ember'; })[0] && { day: HS.skyPalettes().filter(function (p) { return p.id === 'ember'; })[0].day, night: HS.skyPalettes().filter(function (p) { return p.id === 'ember'; })[0].night }));
HS._apply({ sky: { background: 'live', photo: photoA, page_photos: { lights: photoB } }, boards: { 'dashboard-sky': { sky_pages: { lights: 'photo' } } } });
ok('a page\u2019s own photo', HS.pagePhoto('lights') === photoB);
ok('...a page without one: the screen\u2019s photo', HS.pagePhoto('climate') === photoA);
HS._apply({ sky: { page_photos: { lights: photoB } }, boards: { 'dashboard-sky': { sky_page_photos: { lights: photoA } } } });
ok('...this screen\u2019s for the page first', HS.pagePhoto('lights') === photoA);
HS._apply({ sky: { background: 'photo', photo: photoA } });
var lk = HS.photoLook();
ok('a photo as taken by default: no blur, dim, tint', lk.blur === 0 && lk.dim === 0 && lk.saturate === 1 && lk.tint === null && lk.amount === 0);
HS._apply({ sky: { background: 'photo', photo: photoA, photo_look: { blur: 50, dim: 40, saturation: 150, tint: 'plum', tint_amount: 30 } } });
lk = HS.skyLook().background.look;
ok('the look: blur 50% is 20 px, dim 40%, saturation 150%', lk.blur === 20 && Math.abs(lk.dim - 0.4) < 1e-9 && lk.saturate === 1.5);
ok('...and a Plum tint at 30%', lk.tint && lk.tint.day[0] === '#150e1f' && Math.abs(lk.amount - 0.3) < 1e-9);
HS._apply({ sky: { background: 'photo', photo: photoA, photo_look: { blur: 50 } }, boards: { 'dashboard-sky': { sky_photo_look: { blur: 0, dim: 10 } } } });
ok('a screen\u2019s own look over All Screens\u2019', HS.photoLook().blur === 0 && Math.abs(HS.photoLook().dim - 0.1) < 1e-9);
print('=== a room\u2019s own background and a page\u2019s own look ===');
HS._apply({ sky: { pages: { rooms: 'photo' }, photo: photoA, page_photos: { 'room-kitchen': photoB }, page_looks: { 'room-kitchen': { blur: 25 } },
                   photo_look: { dim: 30 } }, boards: { 'dashboard-sky': {} } });
ok('a room\u2019s page follows Room Pages', HS.pageSky(['room-office', 'rooms']) === 'photo');
ok('...its own photo first', HS.pagePhoto(['room-kitchen', 'rooms']) === photoB && HS.pagePhoto(['room-office', 'rooms']) === photoA);
ok('...its own look', HS.pageLook(['room-kitchen', 'rooms']).blur === 10 && HS.pageLook(['room-kitchen', 'rooms']).dim === 0);
ok('...else the screen\u2019s', Math.abs(HS.pageLook(['room-office', 'rooms']).dim - 0.3) < 1e-9);
HS._apply({ sky: { pages: { rooms: 'photo', 'room-kitchen': 'live' } }, boards: { 'dashboard-sky': { sky_pages: { rooms: 'plum' } } } });
ok('a room\u2019s own choice beats Room Pages, even a screen\u2019s', HS.pageSky(['room-kitchen', 'rooms']) === 'live' && HS.pageSky(['room-office', 'rooms']) === 'plum');
ok('a plain key still works', HS.pageSky('rooms') === 'plum');
ok('Black is a color to choose', !!HS.skyPalettes().filter(function (p) { return p.id === 'black'; })[0]);
print('=== Landscapes as the Background (2026-10-14) ===');
var landFetched = [];
var fetchBefore = globalThis.fetch;
globalThis.fetch = function (u) { landFetched.push(u); return Promise.resolve({ json: function () {
  return Promise.resolve({ photos: [{ file: '01.webp' }, { file: '02.webp' }, { file: '../evil.js' }, { file: '03.webp' }] }); } }); };
HS._apply({ sky: { background: 'landscapes', landscape: '02.webp' }, boards: { 'dashboard-sky': {} } });
var lb = HS.skyLook().background;
ok('Landscapes before its list has come: a photo not there yet (Black), never the live sky', lb.mode === 'photo' && lb.landscapes === true && lb.photo === null);
var landHeard = 0, landOff = HS.onChange(function () { landHeard++; });
drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('...its list from /hk/landscapes/index.json, once, and every screen hears it came', landFetched.length === 1 && landFetched[0] === '/hk/landscapes/index.json' && landHeard >= 1, landFetched);
ok('Stay the Same: the one picked', HS.skyLook().background.photo === '/hk/landscapes/02.webp');
var L3 = [{ file: '01.webp' }, { file: '02.webp' }, { file: '03.webp' }];
ok('...a name that is not a plain image file is not in the list', HS.landscapeFile('evil.js', L3) !== 'evil.js');
ok('On a Schedule, every hour: the same within the hour', HS.landscapeFile('every:60', L3, new Date(2026, 9, 14, 10, 1)) === HS.landscapeFile('every:60', L3, new Date(2026, 9, 14, 10, 59)));
ok('...and the next hour another', HS.landscapeFile('every:60', L3, new Date(2026, 9, 14, 10, 59)) !== HS.landscapeFile('every:60', L3, new Date(2026, 9, 14, 11, 0)));
ok('...every day: changes at local midnight, not before', HS.landscapeFile('every:1440', L3, new Date(2026, 9, 14, 0, 1)) === HS.landscapeFile('every:1440', L3, new Date(2026, 9, 14, 23, 59)) &&
   HS.landscapeFile('every:1440', L3, new Date(2026, 9, 14, 23, 59)) !== HS.landscapeFile('every:1440', L3, new Date(2026, 9, 15, 0, 1)));
var L50 = [], seen50 = {};
for (var li = 1; li <= 50; li++) L50.push({ file: (li < 10 ? '0' : '') + li + '.webp' });
for (var wn = 0; wn < 50; wn++) seen50[HS.landscapeFile('wake', L50, null, wn)] = 1;
ok('every one of fifty comes round in fifty changes, the next never its neighbor in the list', Object.keys(seen50).length === 50 &&
   Math.abs(parseInt(HS.landscapeFile('wake', L50, null, 1), 10) - parseInt(HS.landscapeFile('wake', L50, null, 0), 10)) > 1);
ok('a picked file no longer in the list: a new one each day instead', /^0[123]\.webp$/.test(HS.landscapeFile('gone.webp', L3)));
HS._apply({ sky: { background: 'landscapes', landscape: 'wake' } });
var w0 = HS.skyLook().background.photo;
landHeard = 0;
dispatchEvent({ type: 'hk-saver', detail: { on: true } });
var w1 = HS.skyLook().background.photo;
ok('Each Time the Screen Wakes: a new one as the screensaver STARTS (drawn while nobody looks)', w1 && w1 !== w0 && landHeard === 1, [w0, w1]);
dispatchEvent({ type: 'hk-black', detail: { on: true } });
ok('...the black straight after it is the same sleep', HS.skyLook().background.photo === w1);
dispatchEvent({ type: 'hk-saver', detail: { on: false } });
ok('...and the wake itself changes nothing', HS.skyLook().background.photo === w1);
landOff();
HS._apply({ sky: { background: 'live', landscape: '03.webp', landscape_look: { dim: 20 }, pages: { lights: 'landscapes' }, page_looks: { lights: { blur: 50 } } } });
var pl = HS.pageLandscape('lights'), pc = HS.pageLandscape('climate');
ok('a page set to Landscapes: the screen’s landscape, with the page’s own look', pl.photo === '/hk/landscapes/03.webp' && pl.look.blur === 20);
ok('...a page without a look of its own: the landscape look', pc.photo === '/hk/landscapes/03.webp' && Math.abs(pc.look.dim - 0.2) < 1e-9);
HS._apply({ sky: { background: 'photo', photo: photoA, landscape: '01.webp', landscape_look: { dim: 10 } },
            boards: { 'dashboard-sky': { sky_background: 'landscapes', sky_landscape: '03.webp', sky_landscape_look: { dim: 40 } } } });
var sb = HS.skyLook().background;
ok('a screen’s own Landscapes, landscape and look over All Screens’ Photo', sb.photo === '/hk/landscapes/03.webp' && Math.abs(sb.look.dim - 0.4) < 1e-9);
HS._apply({ sky: { background: 'landscapes', landscape: '01.webp', landscape_look: { dim: 10 } }, boards: { 'dashboard-sky': { sky_background: null } } });
ok('...following All Screens: theirs', HS.skyLook().background.photo === '/hk/landscapes/01.webp' && Math.abs(HS.skyLook().background.look.dim - 0.1) < 1e-9);
// HK SETTINGS' PREVIEW picks the same one the screens do (hk-settings-model.js)
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var MM = window.hkSettingsModel, sameAll = true;
['every:15', 'every:60', 'every:1440', '02.webp', 'gone.webp'].forEach(function (ch) {
  [new Date(2026, 9, 14, 3, 7), new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 0, 0)].forEach(function (d) {
    if (MM.landscapeFile(ch, L50, d) !== HS.landscapeFile(ch, L50, d)) sameAll = false;
  });
});
for (wn = 0; wn < 60; wn++) if (MM.landscapeFile('wake', L50, null, wn) !== HS.landscapeFile('wake', L50, null, wn)) sameAll = false;
ok('HK Settings’ preview and the screens pick the same landscape', sameAll);
ok('...and say it in words', MM.landscapeLabel('wake') === 'Each Time the Screen Wakes' && MM.landscapeLabel('every:60') === 'Every Hour' &&
   MM.landscapeLabel(null) === 'Every Day' && MM.landscapeLabel('02.webp', [{ file: '02.webp', title: 'A lake' }]) === 'A lake');
globalThis.fetch = fetchBefore;
HS._apply({ configured: true });
location.pathname = '/';

print('\n=== a subscription that survives ===');
function settle() { var p = Promise.resolve(); for (var i = 0; i < 6; i++) p = p.then(function () {}); return p; }
var calls = [], readyL = [], unsubs = 0;
var fake = {
  subscribeMessage: function (cb, msg, opts) {
    calls.push({ cb: cb, msg: msg, opts: opts });
    // The first answer is what a page gets while Home Assistant is starting.
    if (calls.length === 1) return Promise.reject({ code: 'unknown_command', message: 'Unknown command.' });
    return Promise.resolve(function () { unsubs++; });
  },
  addEventListener: function (t, f) { if (t === 'ready') readyL.push(f); },
  removeEventListener: function (t, f) { readyL = readyL.filter(function (x) { return x !== f; }); }
};
var got = [];
var endSub = HS.subscribe(fake, { type: 'hk_frontend/settings/subscribe' }, function (ev) { got.push(ev); }, 'test');
settle().then(function () {
  ok('the first attempt was refused', calls.length === 1);
  ok('home-assistant-js-websocket is not left to resubscribe', calls[0].opts && calls[0].opts.resubscribe === false);
  __runTimers();                                          // the backoff elapses
  return settle();
}).then(function () {
  ok('a refused subscribe is retried', calls.length === 2, calls.length);
  calls[1].cb({ n: 1 });
  ok('...and its events arrive', got.length === 1 && got[0].n === 1);
  readyL.forEach(function (f) { f(); });                  // Home Assistant restarted
  return settle();
}).then(function () {
  ok('a reconnect subscribes again', calls.length === 3, calls.length);
  calls[1].cb({ n: 'stale' });
  ok('the old subscription is ignored', got.length === 1);
  calls[2].cb({ n: 2 });
  ok('the new one delivers', got.length === 2 && got[1].n === 2);
  endSub();
  ok('ending it unsubscribes', unsubs === 1, unsubs);
  ok('...and stops listening for reconnects', readyL.length === 0);
  return HS.whenLive(10);
}).then(function (live) {
  ok('whenLive: the answer is in', live === true && HS.configured === true);

  print('\n=== which wall tablet this page is (1.14) ===');
  var hass = function (name) { return { user: { name: name } }; };
  location.pathname = '/dashboard-b/0';
  HS._apply({ configured: true, boards: { 'dashboard-a': { tablet_user: 'a' }, 'dashboard-b': {} } });
  ok('a server before 1.14 (no tablets): the screen\'s own Tablet User', HS.tablet(hass('a')) === null);
  location.pathname = '/dashboard-a/0';
  ok('...on its own screen, signed in as it', HS.tablet(hass('a')).id === 'dashboard-a' && HS.tablet(hass('a')).legacy);
  var items = { one: { name: 'One', screen: 'dashboard-a', user: 'wall', idle_time: 50 },
                two: { name: 'Two', screen: 'dashboard-b', user: 'wall', idle_time: 30 },
                hall: { name: 'Hall', screen: 'dashboard-b', user: '', idle_time: 120 } };
  HS._apply({ configured: true, boards: {}, tablet_items: items });
  location.pathname = '/dashboard-b/lights';
  ok('by its user: the one on this screen first', HS.tablet(hass('wall')).id === 'two');
  location.pathname = '/dashboard-c/0';
  ok('...else its user\'s first', HS.tablet(hass('wall')).id === 'one');
  ok('a user no tablet has: none', HS.tablet(hass('Mark')) === null && HS.tablet(null) === null);
  location.search = '?hk_tablet=hall';
  load(HK_ROOT + '/frontend/modules/hk-settings.js');           // a fresh page load (it returns at once: already set up)
  delete window.hkSettings; load(HK_ROOT + '/frontend/modules/hk-settings.js');
  var HS2 = window.hkSettings;
  HS2._apply({ configured: true, boards: {}, tablet_items: items });
  location.search = '';
  ok('?hk_tablet= is remembered: the hall tablet, whoever is signed in', HS2.tablet(hass('wall')).id === 'hall' &&
     localStorage.getItem('hk-tablet') === 'hall');
  location.search = '?hk_tablet=none';
  delete window.hkSettings; load(HK_ROOT + '/frontend/modules/hk-settings.js');
  window.hkSettings._apply({ configured: true, boards: {}, tablet_items: items });
  location.search = '';
  ok('?hk_tablet=none forgets it', !localStorage.getItem('hk-tablet') && window.hkSettings.tablet(hass('Mark')) === null);
  window.hkSettings = HS;
  print(fail ? 'FAIL ' + fail + ' SETTINGS TESTS' : 'ALL ' + pass + ' SETTINGS TESTS PASS');
  if (fail) throw new Error('settings tests failed');
});
