// THE CLIMATE BLOCKS AS WIDGETS (2026-10-31, the owner's notes on the Home
// Grid widget mock-up): the Thermostat's Big Number at Small, Tall and Extra
// Large (hk-control.js _big), and the Weather block at each of its sizes
// (hk-weather.js _renderBlock). A fictional house: nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_climate');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/sample_settings.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-control.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');

var T0 = Date.UTC(2026, 9, 31, 15, 0, 0);
Date.now = function () { return T0 + 7 * 60e3; };

// ---- the thermostat, as test_thermostat.js draws it: the markup read as written
function big(state, attrs, size, style) {
  var C = customElements.get('hk-control-card'), c = new C(), calls = [], html = '';
  c.setConfig(Object.assign({ type: 'custom:hk-control-card', entity: 'climate.den' }, style === 'dial' ? {} : { style: 'big' }));
  c.setAttribute('size', size);
  Object.defineProperty(c.shadowRoot, 'innerHTML', { get: function () { return html; }, set: function (v) { html = String(v); } });
  c.hass = { states: { 'climate.den': { state: state, attributes: Object.assign({ friendly_name: 'Thermostat', min_temp: 50, max_temp: 90,
               current_temperature: 66, current_humidity: 41, hvac_modes: ['off', 'heat', 'cool', 'heat_cool'] }, attrs) } },
             entities: { 'climate.den': { area_id: 'den' } }, areas: { den: { area_id: 'den', name: 'Living Room' } }, devices: {},
             callService: function (d, sv, data) { calls.push([d, sv, data]); return Promise.resolve(); } };
  c.calls = calls; c.html = function () { return html.split('</style>')[1] || ''; };
  return c;
}

// ---- the weather, as test_weatherpage.js feeds it
function hourly(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ datetime: new Date(T0 + i * 3600e3).toISOString(), condition: i % 2 ? 'cloudy' : 'sunny',
                                          temperature: 60 + i, precipitation_probability: 10 + i, uv_index: 3 });
  return out;
}
function daily(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ datetime: new Date(T0 + i * 864e5).toISOString(), condition: 'sunny', temperature: 70 - i,
                                          templow: 50 + i, precipitation_probability: 20 });
  return out;
}
function house(extra) {
  return H.house(Object.assign({
    'weather.openweathermap': ['partlycloudy', { temperature: 64, apparent_temperature: 62, humidity: 52, wind_speed: 6, wind_bearing: 315,
      wind_speed_unit: 'mph', uv_index: 2, friendly_name: 'OpenWeatherMap' }],
    'sensor.openweathermap_apparent_temperature': ['62', {}],
    'sensor.openweathermap_humidity': ['52', {}],
    'sensor.openweathermap_wind_speed': ['6', { unit_of_measurement: 'mph' }],
    'sensor.weather_hourly_forecast': ['24', { forecast: hourly(24) }],
    'sensor.weather_daily_forecast': ['8', { forecast: daily(8) }],
    'sun.sun': ['above_horizon', { next_setting: '2026-10-31T22:37:00Z', next_rising: '2026-11-01T11:10:00Z', elevation: 30 }]
  }, extra || {}));
}
function block(size, extra, cfg) {
  var s = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
  s.weather.place = 'Riverside';
  window.hkSettings._apply(s);
  var c = H.make('hk-weather-band-card');
  c.setConfig(Object.assign({ type: 'custom:hk-weather-band-card', section: 'hero', entity: 'weather.openweathermap' }, cfg || {}));
  c.setAttribute('size', size);
  c.hass = house(extra).hass();
  return H.morphed(c._root);
}
var count = function (html, re) { return (html.match(re) || []).length; };

H.run('CLIMATE BLOCKS', [
  function () {
    H.section('the thermostat, Small: the number over the foot, the mode and the reading under the name');
    var s = big('heat', { temperature: 68 }, 'S'), html = s.html();
    H.ok('the target alone, in the middle of what the foot leaves (held for the modes)', /<div class="tg" data-big-num[^>]*><div class="one heat"><b>68<\/b><\/div><\/div>/.test(html), html.slice(0, 300));
    H.ok('...the arrows either side of the name, "Heat · 66°" under it', /data-big-step="-1"[\s\S]*<b>Thermostat<\/b><i>Heat · 66°<\/i>[\s\S]*data-big-step="1"/.test(html), html);
    H.ok('...no row of modes (Tall\'s), the hold\'s modes still there', !/class="mr"/.test(html) && /class="modes"/.test(html));
    var r = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'S'), rh = r.html();
    H.ok('heat and cool: the two side by side, heat first, the picked one on its plate', /class="tt heat sel"[^>]*data-big-pick="low"[\s\S]*<small>Heat<\/small><b>68<\/b>[\s\S]*class="tt cool"[^>]*data-big-pick="high"[\s\S]*<small>Cool<\/small><b>72<\/b>/.test(rh), rh.slice(0, 600));
    H.ok('..."Auto · 66°" under the name', /<i>Auto · 66°<\/i>/.test(rh));
    r._bigPick = 'high'; r._render();
    H.ok('...a pick moves the plate', /class="tt cool sel"/.test(r.html()) && !/class="tt heat sel"/.test(r.html()));
    r._bigNudge(1, function () {});
    H.ok('...and the arrows step the one picked', r._hold.hi === 73 && r._hold.lo === 68, r._hold);
    var o = big('off', { temperature: 68 }, 'S');
    H.ok('off: Off, the arrows not to be used', /<b>Off<\/b>/.test(o.html()) && count(o.html(), /data-big-step="[^"]+" aria-label="[^"]+" disabled/g) === 2);
    var d = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'S', 'dial').html();
    H.ok('Small is Big Number whatever the style: a tile has no room for the ring', /surface big/.test(d) && !/data-ring/.test(d), d.slice(0, 200));
    H.ok('...Tall keeps the dial it was given', /data-ring/.test(big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'T', 'dial').html()));
  },
  function () {
    H.section('the thermostat, Tall: the targets stacked, a row of modes, the foot');
    var t = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'T'), html = t.html();
    H.ok('cool over heat, each labelled in its colour, the picked (heat) on its plate', /class="tt cool"[\s\S]*<small>Cool to<\/small><b>72<\/b>[\s\S]*class="tt heat sel"[\s\S]*<small>Heat to<\/small><b>68<\/b>/.test(html), html.slice(0, 700));
    H.ok('the modes in a row: Heat, Cool, Auto, Off, the one it is in on', /class="mr" role="group" aria-label="Mode"><button class="" type="button" data-big-mode="heat"[^>]*aria-label="Heat"><hk-icon icon="mdi:fire"[\s\S]*data-big-mode="cool"[\s\S]*class="on" type="button" data-big-mode="heat_cool"[^>]*aria-label="Auto"[\s\S]*data-big-mode="off"/.test(html), html);
    H.ok('...then the foot', /class="mr"[\s\S]*class="ff"[\s\S]*<i>Auto · 66°<\/i>/.test(html));
    var one = big('cool', { temperature: 74 }, 'T');
    H.ok('one target: its label and the number', /<div class="one cool"><small>Cool to<\/small><b>74<\/b><\/div>/.test(one.html()), one.html().slice(0, 300));
    // (the row's binding, on a stand-in for the block: a tap is set_hvac_mode)
    var probe = { dataset: { bigMode: 'off' } }, got = [];
    var host = { querySelectorAll: function (sel) { return sel === '[data-big-mode]' ? [probe] : []; }, querySelector: function () { return null; } };
    one._bindBig(host, function (d, sv, data) { got.push([d, sv, data]); });
    probe.onclick({ stopPropagation: function () {} });
    H.eq('a tap on a mode sets it', got, [['climate', 'set_hvac_mode', { hvac_mode: 'off' }]]);
    H.ok('(only the four: a fan mode stays the hold\'s)', !/data-big-mode="fan_only"/.test(big('heat', { temperature: 68, hvac_modes: ['off', 'heat', 'fan_only'] }, 'T').html()) &&
      /data-mode="fan_only"/.test(big('heat', { temperature: 68, hvac_modes: ['off', 'heat', 'fan_only'] }, 'T').html()));
  },
  function () {
    H.section('the thermostat, Large and Extra Large');
    var l = big('heat', { temperature: 68 }, 'L').html();
    H.ok('Large: the measured face, the room and the mode under the name', /<div class="face">\s*<div class="bn" data-big-num[^>]*>68<\/div>/.test(l) && /<i>Living Room · Heat<\/i>/.test(l) && !/class="mc"/.test(l), l.slice(0, 400));
    var x = big('heat', { temperature: 68 }, 'XL').html();
    H.ok('Extra Large: the face, the room under the name', /<div class="face">[\s\S]*<b>Thermostat<\/b><i>Living Room<\/i>/.test(x), x.slice(0, 600));
    H.ok('...the modes as a column, named, Heat on', /class="mc" role="group" aria-label="Mode"><b>Mode<\/b><button class="on" type="button" data-big-mode="heat"[^>]*><hk-icon icon="mdi:fire" aria-hidden="true"><\/hk-icon>Heat<\/button>[\s\S]*>Off<\/button>/.test(x), x);
    H.ok('...the real readings under them', /<span>Inside 66° · 41% humidity<\/span><\/div>/.test(x));
    H.ok('...no humidity, just inside', /<span>Inside 66°<\/span>/.test(big('heat', { temperature: 68, current_humidity: null }, 'XL').html()));
    var xr = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'XL').html();
    H.ok('...heat and cool: the two on the face, the picked one\'s dot', /class="pk sel"[^>]*data-big-pick="low"[^>]*>68<\/button><span class="ds"/.test(xr), xr.slice(0, 500));
    var css = big('heat', { temperature: 68 }, 'S')._extraCss();
    H.ok('the dot is the face\'s; Small and Tall pick by the plate', /\.big \.bn \.pk\.sel::before\{/.test(css) && /\.big \.tt\.sel\{background:/.test(css));
    H.ok('Tall\'s modes 44 px, four in 176', /\.big \.mr\{[^}]*width:176px;height:44px/.test(css) && /\.big \.mr button\{[^}]*width:44px;height:44px/.test(css));
    H.ok('Extra Large\'s face leaves the column its room', /:host\(\[size=XL\]\) \.big \.face\{right:calc\(var\(--hk-pad-r,18px\) \+ 200px\)\}/.test(css));
    H.ok('Small\'s number takes what the foot leaves, the same above and below', /:host\(\[size=S\]\) \.big \.one b\{font-size:min\(78px,calc\(\(100cqh/.test(css) && /\.big \.tg\{flex:1 1 auto;[^}]*align-items:center;justify-content:center/.test(css));
  },
  function () {
    H.section('the catalog: Big Number at every size, the dial\'s Extra Large the sheet');
    var C = window.hkGridCatalog;
    H.eq('Extra Large in Big Number', C.config({ card: 'thermostat', size: 'XL', opts: { style: 'big', entity: 'climate.den' } }, {}).type, 'custom:hk-control-card');
    H.eq('...the dial\'s, the sheet', C.config({ card: 'thermostat', size: 'XL', opts: { entity: 'climate.den' } }, {}).type, 'custom:hk-grid-panel-card');
  },
  function () {
    H.section('the weather, Small: the place, the temperature, the symbol, the condition, high and low');
    var s = block('S');
    H.ok('the place and the temperature', /<b class="place-name">Riverside<\/b><div class="tpn">64°<\/div>/.test(s), s.slice(0, 300));
    H.ok('...the symbol, the condition, today\'s high and low at the foot', /<div class="sc"><span class="sym" aria-hidden="true">[\s\S]*<\/span><span class="sct"><b>Partly Cloudy<\/b><span>H:70°  L:50°<\/span><\/span><\/div>/.test(s), s);
    H.ok('...and no hours or days', !/class="hrs"|class="days"/.test(s));
  },
  function () {
    H.section('Wide, Tall, Large');
    var w = block('W');
    H.ok('Wide as it was: the top and six hours', /class="wb W hh"/.test(w) && /class="top"/.test(w) && count(w, /class="hr"/g) === 6 && !/class="days"/.test(w), w.slice(0, 200));
    var t = block('T');
    H.ok('Tall: the condition, the high and low, then eight hours, one a line', /<div class="tl">[\s\S]*<b>Partly Cloudy<\/b><\/div><span class="th">H:70°  L:50°<\/span>/.test(t) && count(t, /class="vr"/g) === 8, t);
    var l = block('L');
    H.ok('Large: the top, six hours, five days', /class="top"/.test(l) && count(l, /class="hr"/g) === 6 && count(l, /class="day"/g) === 5 && !/readings/.test(l), l.slice(0, 300));
    H.ok('Big Temperature still any size it is chosen for', /class="wb big T"/.test(block('T', null, { big: true })));
  },
  function () {
    H.section('Extra Large, a small Weather page');
    var x = block('XL');
    H.ok('the left column: the top, five hours, the readings', /<div class="lc"><div class="top">[\s\S]*class="hrs"[\s\S]*<div class="rds">/.test(x) && count(x, /class="hr"/g) === 5, x.slice(0, 300));
    H.ok('...feels like, humidity, wind with its direction', /Feels like<\/small><b>62°<\/b>/.test(x) && /Humidity<\/small><b>52%<\/b>/.test(x) && /Wind<\/small><b>6 mph NW<\/b>/.test(x), x);
    H.ok('...the chance of rain today, sunset, UV', /Rain<\/small><b>20%<\/b>/.test(x) && /Sunset<\/small><b>[0-9:]+ [AP]M<\/b>/.test(x) && /UV<\/small><b>2 Low<\/b>/.test(x));
    H.ok('the right: seven days, named', /<div class="rc"><b class="lab">7-Day Forecast<\/b><div class="days">/.test(x) && count(x, /class="day"/g) === 7);
    var dark = block('XL', { 'sun.sun': ['below_horizon', { next_setting: '2026-11-01T22:36:00Z', next_rising: '2026-11-01T11:10:00Z' }] });
    H.ok('after dark, the sunrise', /Sunrise<\/small>/.test(dark) && !/Sunset<\/small>/.test(dark));
    var bare = block('XL', { 'weather.openweathermap': ['sunny', { temperature: 64, friendly_name: 'OpenWeatherMap' }], 'sensor.openweathermap_apparent_temperature': ['unknown', {}],
                             'sensor.openweathermap_humidity': ['unknown', {}], 'sensor.openweathermap_wind_speed': ['unknown', {}] });
    H.ok('a reading the house lacks is left out, not shown empty', !/Feels like|Humidity|Wind</.test(bare) && /Rain<\/small>/.test(bare), bare);
  }
]);
