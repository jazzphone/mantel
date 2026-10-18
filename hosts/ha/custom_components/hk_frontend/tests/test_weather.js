// hk-weather-tile-card's WIND variant, specifically what it says when a
// reading is missing.
//
// Gusts are the case that matters: OpenWeatherMap only sends `wind_gust` when
// the observation carries one, so the gust sensor alternates between a number
// and `unknown` all day. "Gusts / -- mph NE" for the unknown half would read
// as a broken card rather than as calm air.
//
// _wind() returns its markup as a string and reads only _config and _st(), so
// it runs on a bare prototype the way test_tile runs _label().
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');

var WTile = customElements.get('hk-weather-tile-card');

var pass = 0, fail = 0;
function ok(n, got, want) {
  if (got === want) { pass++; print('  PASS  ' + n + '   ' + JSON.stringify(got)); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + JSON.stringify(got) +
                       '\n          want ' + JSON.stringify(want)); }
}
function st(id, state, attrs) {
  return { entity_id: id, state: state, attributes: attrs || {}, last_updated: 't' };
}
// The text a person reads, with the SVG stripped: tags out, whitespace
// collapsed. The compass's own numerals survive (they are <text>), which is
// what lets the hub speed be asserted here too.
function text(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function wind(states) {
  var c = Object.create(WTile.prototype);
  c._config = {
    variant: 'wind',
    entity: 'weather.owm',
    speed: 'sensor.wind_speed',
    gust: 'sensor.wind_gust'
  };
  c._hass = { states: states };
  return text(c._wind());
}

var WX = st('weather.owm', 'sunny', { wind_bearing: 30, wind_speed: 4.61 });

print('=== wind: no speed sensor configured ===');
(function () {
  var c = Object.create(WTile.prototype);
  c._config = { variant: 'wind', entity: 'weather.owm' };
  c._hass = { states: { 'weather.owm': WX } };
  ok('reads the weather entity\'s own wind_speed', /\b5 mph\b/.test(text(c._wind())), true);
})();

print('=== wind: gusts present ===');
ok('speed + gust + direction',
   wind({ 'weather.owm': WX,
          'sensor.wind_speed': st('sensor.wind_speed', '4.60808876163207'),
          'sensor.wind_gust':  st('sensor.wind_gust', '7.00161059413028') }),
   'N S E W 5 mph Gusts 7 mph NE');

print('=== wind: gust unknown ===');
var noGust = wind({ 'weather.owm': WX,
                    'sensor.wind_speed': st('sensor.wind_speed', '4.60808876163207'),
                    'sensor.wind_gust':  st('sensor.wind_gust', 'unknown') });
ok('says the direction instead', noGust, 'N S E W 5 mph From NE');
ok('never prints "--" next to a unit', /-- mph/.test(noGust), false);
ok('never prints a bare "Gusts"', /Gusts/.test(noGust), false);

print('=== wind: gust entity absent entirely ===');
ok('unavailable is the same case as unknown',
   wind({ 'weather.owm': WX,
          'sensor.wind_speed': st('sensor.wind_speed', '4.6'),
          'sensor.wind_gust':  st('sensor.wind_gust', 'unavailable') }),
   'N S E W 5 mph From NE');
ok('missing from states at all',
   wind({ 'weather.owm': WX,
          'sensor.wind_speed': st('sensor.wind_speed', '4.6') }),
   'N S E W 5 mph From NE');

print('=== wind: no bearing ===');
// With neither gust nor bearing there is nothing to caption the compass with,
// so the side is dropped rather than left as an empty column.
ok('compass stands alone',
   wind({ 'weather.owm': st('weather.owm', 'sunny', {}),
          'sensor.wind_speed': st('sensor.wind_speed', '4.6') }),
   'N S E W 5 mph');
ok('bearing alone still captions the compass',
   wind({ 'weather.owm': st('weather.owm', 'sunny', { wind_bearing: 180 }),
          'sensor.wind_speed': st('sensor.wind_speed', '4.6') }),
   'N S E W 5 mph From S');

print('=== wind: no speed ===');
// The hub keeps "--" here, and should: the speed is the tile's whole subject,
// and a compass with no number in it would say less, not more.
ok('hub reads --',
   wind({ 'weather.owm': WX }),
   'N S E W -- mph From NE');

print('=== wind: bearing rounds to the nearest of eight ===');
var dir = function (b) {
  return wind({ 'weather.owm': st('weather.owm', 'sunny', { wind_bearing: b }),
                'sensor.wind_speed': st('sensor.wind_speed', '4.6') }).split('From ')[1];
};
ok('0 -> N', dir(0), 'N');
ok('22 -> N (below the half-sector)', dir(22), 'N');
ok('23 -> NE (above it)', dir(23), 'NE');
ok('315 -> NW', dir(315), 'NW');
ok('359 -> N (wraps)', dir(359), 'N');
ok('360 -> N (modulo)', dir(360), 'N');

// ---------------------------------------------------------------- GLYPHS
// hk-header.js's condition glyphs, names and night test. The drawings are the
// home's (the `weather` section of its hk-glyphs.js, Apple artwork that does not
// ship); without them Material Design icons stand in.
var H = window.hkHeader;
var CONDS = ['sunny','clear-night','partlycloudy','cloudy','fog','hail','lightning',
             'lightning-rainy','pouring','rainy','snowy','snowy-rainy','windy',
             'windy-variant','exceptional'];
function everyCondition(test) {
  var broken = [];
  CONDS.forEach(function (c) {
    [false, true].forEach(function (n) {
      if (!test(H.wxSvg(c, 26, { night: n }))) broken.push(c + (n ? '/night' : ''));
    });
  });
  return broken.join(', ');
}

print('=== glyphs: no glyph file -> Material stand-ins ===');
var savedGlyphs = window.hkGlyphs;
window.hkGlyphs = undefined;
ok('not ready without the file', H.wxReady(), false);
ok('all 15 conditions x day/night draw a Material icon', everyCondition(function (g) {
  return /^<ha-icon class="hk-wx" icon="mdi:(weather-[a-z-]+|alert)" role="img" aria-label="[^"]+"/.test(g);
}), '');
ok('sunny is the yellow sun', /icon="mdi:weather-sunny"[^>]*color:#FFD60A/.test(H.wxSvg('sunny', 26)), true);
ok('partly cloudy at night is the night cloud', /mdi:weather-night-partly-cloudy/.test(H.wxSvg('partlycloudy', 26, { night: true })), true);
ok('unknown condition falls back, not blank', /mdi:weather-partly-cloudy/.test(H.wxSvg('nonsense', 26)), true);
ok('stand-in size is applied', /width:30px; height:30px; --mdc-icon-size:30px;/.test(H.wxSvg('cloudy', 30)), true);
// THE SCREENSAVER'S WEATHER moves its symbol by name (o.sym, 2026-10-14);
// every other caller's markup is as it was
ok('sym: the symbol names itself for a caller\'s CSS', /data-sym="mdi"/.test(H.wxSvg('rainy', 30, { sym: true })) && !/data-sym/.test(H.wxSvg('rainy', 30)), true);
var glyphsWas = window.hkGlyphs;
window.hkGlyphs = { weather: { 'cloud.rain.fill': ['0 0 120 120', [['c', 'M0 0h1v1z'], ['w', 'M2 2h1v1z']]] } };
ok('...an SF symbol too, by its own name', /<svg class="hk-wx" data-sym="cloud.rain.fill"/.test(H.wxSvg('rainy', 30, { sym: true })) && !/data-sym/.test(H.wxSvg('rainy', 30)), true);
window.hkGlyphs = glyphsWas;
ok('stand-in carries o.style', /margin-right:12px;"><\/ha-icon>$/.test(H.wxSvg('cloudy', 30, { style: ' margin-right:12px;' })), true);

print('=== glyphs: the home\'s file -> multicolor inline SVG ===');
// Stand-in drawings, one per symbol, each layer a rectangle with its role --
// a home's real file is checked with HK_FILES=/config/<folder> tests/run weather.
var FAKE = {};
['sun.max.fill','moon.stars.fill','cloud.sun.fill','cloud.moon.fill','cloud.fill','cloud.fog.fill',
 'cloud.hail.fill','cloud.bolt.fill','cloud.bolt.rain.fill','cloud.heavyrain.fill','cloud.rain.fill',
 'cloud.moon.rain.fill','cloud.snow.fill','cloud.sleet.fill','wind','exclamationmark.triangle.fill'
].forEach(function (k) {
  FAKE[k] = ['0 -100 120 120', [['y', 'M0-10L10-10L10 0Z'], ['w', 'M20-10L30-10L30 0Z'], ['c', 'M40-10L50-10L50 0Z']]];
});
var HOME = null;
if (typeof HK_FILES === 'string' && HK_FILES) {
  load(HK_FILES + '/iconset/hk-glyphs.js');
  HOME = window.hkGlyphs;
}
window.hkGlyphs = HOME || { icons: {}, twotone: {}, weather: FAKE };
ok('ready with the file', H.wxReady(), true);
ok('all 15 conditions x day/night draw inline SVG', everyCondition(function (g) {
  return /^<svg class="hk-wx" viewBox="[-\d. ]+"/.test(g) && /<path style="fill:(#[0-9A-F]{6}|var\(--hk-wx-[wc],#[0-9A-F]{6}\))" d="M/.test(g);
}), '');
ok('sunny by day is the sun', H.wxSymbol('sunny', false), 'sun.max.fill');
ok('sunny at night is the moon', H.wxSymbol('sunny', true), 'moon.stars.fill');
ok('partly cloudy at night is cloud.moon', H.wxSymbol('partlycloudy', true), 'cloud.moon.fill');
ok('MULTICOLOR: partly cloudy carries yellow and white',
   /#FFD60A/.test(H.wxSvg('partlycloudy', 26)) && /#FFFFFF/.test(H.wxSvg('partlycloudy', 26)), true);
ok('MULTICOLOR: rain carries cyan', /#64D2FF/.test(H.wxSvg('rainy', 26)), true);
ok('size is applied', /width:30px; height:30px;/.test(H.wxSvg('cloudy', 30)), true);
ok('a CSS size string passes through', /width:1.2em; height:1.2em;/.test(H.wxSvg('cloudy', '1.2em')), true);
ok('a path closes with </path>, never />', /\/>/.test(H.wxSvg('rainy', 26)), false);
window.hkGlyphs = savedGlyphs;

print('=== condition names ===');
ok('partlycloudy', H.conditionName('partlycloudy'), 'Partly Cloudy');
ok('clear-night', H.conditionName('clear-night'), 'Clear');
ok('lightning-rainy', H.conditionName('lightning-rainy'), 'Thunderstorms');
ok('unmapped id still reads as words', H.conditionName('freezing-drizzle'), 'Freezing Drizzle');

print('=== nightAt: forecast hours against sun.sun ===');
// sun.sun on an afternoon (sun up): sets 23:40Z, rises 11:09Z.
var SUN = { 'sun.sun': { state: 'above_horizon', attributes: {
  next_setting: '2026-09-13T23:40:15Z', next_rising: '2026-09-14T11:09:11Z' } } };
ok('22:00Z, before sunset', H.nightAt(SUN, '2026-09-13T22:00:00Z'), false);
ok('23:00Z, mostly before sunset (mid 23:30)', H.nightAt(SUN, '2026-09-13T23:00:00Z'), false);
ok('00:00Z, after sunset', H.nightAt(SUN, '2026-09-14T00:00:00Z'), true);
ok('07:00Z, OWM calls it "sunny" -- still night', H.nightAt(SUN, '2026-09-14T07:00:00Z'), true);
ok('11:00Z, mid 11:30 is after sunrise', H.nightAt(SUN, '2026-09-14T11:00:00Z'), false);
ok('17:00Z next day', H.nightAt(SUN, '2026-09-14T17:00:00Z'), false);
ok('the NEXT evening repeats', H.nightAt(SUN, '2026-09-15T01:00:00Z'), true);
// Same instants asked at night, when next_rising comes BEFORE next_setting.
var NIGHT = { 'sun.sun': { state: 'below_horizon', attributes: {
  next_rising: '2026-09-14T11:09:11Z', next_setting: '2026-09-14T23:38:40Z' } } };
ok('at night: 05:00Z is night', H.nightAt(NIGHT, '2026-09-14T05:00:00Z'), true);
ok('at night: 15:00Z is day', H.nightAt(NIGHT, '2026-09-14T15:00:00Z'), false);
ok('no sun.sun -> day, never a guess', H.nightAt({}, '2026-09-14T05:00:00Z'), false);

// THE MOON TILE WITH NO SENSOR follows the built-in phase -- the same answer
// the live sky draws.
var mt = Object.create(WTile.prototype);
mt._config = { variant: 'moon' };
mt._hass = { states: {} };
window.hkSettings = { moon: function () { return 0.5; } };
ok('no sensor: the built-in phase', mt._phase(), 0.5);
ok('...drawn as a full moon', /Full/.test(mt._moon()) && /Moon/.test(mt._moon()), true);
mt._config = { variant: 'moon', phase: 'sensor.p' };
mt._st = function (id) { return id === 'sensor.p' ? { state: '0.25', attributes: {} } : null; };
ok('a named sensor still wins', mt._phase(), 0.25);
delete window.hkSettings;

// A REFUSED FORECAST SUBSCRIPTION. With no forecast sensor the band asks the
// weather entity directly, and Home Assistant refuses that for an entity
// without the kind asked for. Rather than ask again on every render, silently,
// it warns once and backs off.
print('=== forecast subscription: refused, warned once, backed off ===');
(function () {
  var Band = customElements.get('hk-weather-band-card');
  var asked = 0, answer = 'refuse', listener = null;
  var conn = { subscribeMessage: function (cb, msg) {
    asked++;
    if (answer === 'refuse') return Promise.reject({ code: 'not_supported', message: 'no hourly' });
    listener = cb;
    return Promise.resolve(function () {});
  } };
  var warned = [], realWarn = console.warn, realNow = Date.now, now = 1e12;
  console.warn = function (m) { warned.push(String(m)); };
  Date.now = function () { return now; };
  function band() {
    var b = Object.create(Band.prototype);
    b._config = { entity: 'weather.refuser' };
    b._hass = { states: {}, connection: conn };
    b.isConnected = true;
    b.requestUpdate = function () {};
    return b;
  }
  try {
    var b = band();
    b._forecast('hourly', null);
    drainMicrotasks();
    ok('asked once', asked, 1);
    ok('the refusal is logged', warned.length, 1);
    ok('...naming the entity and the kind', /hourly.*weather\.refuser/.test(warned[0]), true);
    b._forecast('hourly', null); b._forecast('hourly', null);
    drainMicrotasks();
    ok('the next renders do not ask again', asked, 1);
    ok('another band for the same entity waits too', (band()._forecast('hourly', null), asked), 1);
    now += 61 * 1000;
    b._forecast('hourly', null);
    drainMicrotasks();
    ok('after a minute it asks again', asked, 2);
    ok('a second refusal is not logged again', warned.length, 1);
    now += 61 * 1000;
    b._forecast('hourly', null);
    ok('the wait doubles: not after one more minute', asked, 2);
    now += 60 * 1000;
    answer = 'accept';
    b._forecast('hourly', null);
    drainMicrotasks();
    ok('after two it asks again', asked, 3);
    listener({ forecast: [{ datetime: 'x', temperature: 70 }] });
    ok('an answer is drawn', b._forecast('hourly', null).length, 1);
    ok('...and the daily kind is its own subscription', (b._forecast('daily', null), asked), 4);
  } finally {
    console.warn = realWarn; Date.now = realNow;
  }
})();

// ------------------------------------------------ THE WEATHER, FITTED
// hkHeader.fitWeather: what goes when the width runs out -- the
// last detail bits, then the detail line, then the text -- never an ellipsis.
print('=== the weather fitted to its width ===');
(function () {
  var HS0 = window.hkSettings;
  window.hkSettings = Object.assign({}, HS0 || {}, { weatherId: function () { return 'weather.home'; } });
  var html = H.weather({ 'weather.home': { state: 'sunny', attributes: {
    temperature: 71, apparent_temperature: 70, humidity: 44, wind_speed: 5 } } }, {});
  window.hkSettings = HS0;
  ok('the text, its first line and its detail carry the fit hooks',
     /data-hk-wx="text"/.test(html) && /data-hk-wx="main"/.test(html) && /data-hk-wx="detail"/.test(html), true);
  ok('each detail bit is its own span, the separator inside it',
     (html.match(/<span data-hk-wx-bit>/g) || []).length === 3 && /<span data-hk-wx-bit> • 44% Humidity<\/span>/.test(html), true);
  // A stand-in for the rendered markup: a line overflows when its content is
  // wider than its box, and the detail's content shrinks as bits are hidden.
  function fake(mainNeed, bitWidths, room) {
    var attrs = {};
    var shown = function () {
      var f = attrs['data-wx-fit'];
      if (f === 'glyph' || f === '0') return 0;
      return f === undefined ? bitWidths.length : Math.min(Number(f), bitWidths.length);
    };
    var main = { get clientWidth() { return room; }, get scrollWidth() { return mainNeed; } };
    var detail = {
      get clientWidth() { return shown() ? room : 0; },
      get scrollWidth() { return bitWidths.slice(0, shown()).reduce(function (a, b) { return a + b; }, 0); },
      querySelectorAll: function () { return bitWidths.map(function () { return {}; }); }
    };
    var text = { querySelector: function (q) { return q.indexOf('main') !== -1 ? main : detail; } };
    var holder = { setAttribute: function (k, v) { attrs[k] = v; }, removeAttribute: function (k) { delete attrs[k]; },
                   querySelector: function () { return text; } };
    H.fitWeather(holder);
    return attrs['data-wx-fit'] === undefined ? 'all' : attrs['data-wx-fit'];
  }
  ok('room for everything: nothing hidden', fake(150, [90, 110, 100], 320), 'all');
  ok('no room for the wind: it goes, humidity stays', fake(150, [90, 110, 100], 250), '2');
  ok('no room for humidity either: "Feels 70°" alone', fake(150, [90, 110, 100], 150), '1');
  ok('not even that: the detail line goes', fake(150, [90, 110, 100], 150 - 0) === '1' && fake(80, [90, 110, 100], 85), '0');
  ok('the first line does not fit: the glyph alone', fake(150, [90, 110, 100], 60), 'glyph');
})();

print(fail ? ('  ' + fail + ' FAILED') : ('  ALL ' + pass + ' WEATHER TESTS PASS'));
