// The Weather page's own settings on a screen (hk-settings.js weatherPage,
// radarNative, radarPlan) and in HK Settings (hk-settings-model.js): the
// same defaults as settings.py (test_settings.py holds hk-settings.js to it),
// lenient reads of what is stored, and where the radar comes from.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-settings.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var HS = window.hkSettings, M = window.hkSettingsModel;
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

print('=== one set of defaults ===');
ok('the page: the model is the screens’ copy', eq(M.WX_PAGE_DEFAULTS, HS.DEFAULTS.weather.page), M.WX_PAGE_DEFAULTS);
ok('the radar: likewise', eq(M.RADAR_DEFAULTS, HS.DEFAULTS.weather.radar_native));
ok('nothing stored: the defaults', eq(HS.weatherPage(), HS.DEFAULTS.weather.page) && eq(HS.radarNative(), HS.DEFAULTS.weather.radar_native));
ok('the radar is off on a new house', HS.radarNative().enabled === false);

print('\n=== what is stored, read leniently ===');
HS._apply({ configured: true, weather: { page: { hours: 24, show_hourly: false, details: ['moon', 'tide', 'moon', 'wind'], days: 7 },
                                          radar_native: { enabled: true, zoom: 30, opacity: 50, provider: 'dwd', zone: 'sensor.x' } } });
var p = HS.weatherPage(), r = HS.radarNative();
ok('a stored false stays false', p.show_hourly === false && p.show_daily === true);
ok('a good value is kept, a bad one is its default', p.hours === 24 && p.days === 8, p);
ok('details: known, once each, in order', eq(p.details, ['moon', 'wind']), p.details);
ok('radar: bad zoom and provider are the defaults', r.zoom === 5 && r.provider === 'auto' && r.opacity === 50 && r.enabled === true, r);
ok('...a zone must be a zone', r.zone === null);
HS._apply({ configured: true, weather: { page: { show_current: false } } });
ok('a partial object from an older page is whole', HS.get('weather.page').hours === 12 && HS.get('weather.page').show_current === false,
   HS.get('weather.page'));

print('\n=== where the radar comes from ===');
var hass = function (country, extra) {
  return { config: { latitude: 34.9, longitude: -82.1, country: country }, states: extra || {} };
};
function plan(r, h) { HS._apply({ configured: true, weather: { radar_native: r } }); return HS.radarPlan(h); }
var a = plan({ enabled: true }, hass('US'));
ok('automatic at a US home: NOAA', a.provider === 'noaa' && !a.reason && a.place === 'Home' && a.lat === 34.9, a);
ok('automatic at a home elsewhere: RainViewer', plan({ enabled: true }, hass('CA')).provider === 'rainviewer');
var nc = plan({ enabled: true }, hass(null));
ok('a home with no country asks', nc.provider === null && nc.reason === 'choose', nc);
var z = plan({ enabled: true, center: 'zone', zone: 'zone.work' },
             hass('US', { 'zone.work': { state: '0', attributes: { latitude: 51.5, longitude: -0.1, friendly_name: 'Work' } } }));
ok('a zone: its own place, its country unknown -- Automatic asks', z.reason === 'choose' && z.place === 'Work' && z.lat === 51.5, z);
ok('...a chosen provider there is used', plan({ enabled: true, center: 'zone', zone: 'zone.work', provider: 'rainviewer' },
   hass('US', { 'zone.work': { state: '0', attributes: { latitude: 51.5, longitude: -0.1 } } })).provider === 'rainviewer');
ok('a zone that is gone says so', plan({ enabled: true, center: 'zone', zone: 'zone.gone', provider: 'noaa' }, hass('US')).reason === 'zone');
ok('no location says so', plan({ enabled: true }, { config: {}, states: {} }).reason === 'location');
// the model's copy decides the same
[[{ enabled: true }, hass('US')], [{ enabled: true }, hass(null)], [{ enabled: true, center: 'zone', zone: 'zone.w' }, hass('US')],
 [{ enabled: true, provider: 'rainviewer' }, hass('US')]].forEach(function (x, i) {
  var full = Object.assign({}, M.RADAR_DEFAULTS, x[0]);
  var mine = plan(full, x[1]), theirs = M.radarPlanOf(full, x[1]);
  ok('the settings page’s plan is the screen’s (' + i + ')', mine.provider === theirs.provider && mine.reason === theirs.reason && mine.place === theirs.place);
});

print('\n=== the summaries ===');
ok('Forecast & Details', M.forecastSummary(M.WX_PAGE_DEFAULTS) === '12 Hours · 8 Days · 6 Details', M.forecastSummary(M.WX_PAGE_DEFAULTS));
ok('...what is off is left out', M.forecastSummary(Object.assign({}, M.WX_PAGE_DEFAULTS, { show_hourly: false, details: ['moon'] })) === '8 Days · 1 Detail');
var on = Object.assign({}, M.RADAR_DEFAULTS, { enabled: true });
ok('Radar Map: Off', M.radarSummary(M.RADAR_DEFAULTS, M.radarPlanOf(M.RADAR_DEFAULTS, hass('US'))) === 'Off');
ok('...its provider and place, never “Connected”', M.radarSummary(on, M.radarPlanOf(on, hass('US'))) === 'NOAA · Home');
ok('...or what it needs', M.radarSummary(on, M.radarPlanOf(on, hass(null))) === 'Choose a Provider');
ok('the stored page over the defaults', M.wxPage({ weather: { page: { days: 5 } } }).days === 5 && M.wxPage({}).hours === 12);
ok('the legacy options the radar took over', M.RADAR_LEGACY_MAPPED.indexOf('zoom_level') >= 0 && M.RADAR_LEGACY_MAPPED.indexOf('height') < 0);
['weather.page', 'weather.radar_native', 'weather.radar_native.check', 'weather.page.load_animation'].forEach(function (sk) {
  ok('search finds ' + sk, M.SEARCH.some(function (s) { return s[2] === sk; }));
});

print(fail ? 'FAIL ' + fail + ' WEATHER PAGE SETTINGS TESTS' : 'ALL ' + pass + ' WEATHER PAGE SETTINGS TESTS PASS');
if (fail) throw new Error('weather page settings tests failed');
