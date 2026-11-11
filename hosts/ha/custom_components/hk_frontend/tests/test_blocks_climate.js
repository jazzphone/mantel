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
    H.ok('the target alone, in the middle of what the foot leaves (held for the modes)', /<div class="tg" data-big-num[^>]*><div class="one heat"><b>68<\/b><\/div><\/div>/.test(html),
      html.slice(0, 300));
    H.ok('...the arrows either side of the name, "Heat · 66°" under it', /data-big-step="-1"[\s\S]*<b>Thermostat<\/b><i>Heat · 66°<\/i>[\s\S]*data-big-step="1"/.test(html), html);
    H.ok('...no row of modes (Tall\'s), the hold\'s modes still there', !/class="mr"/.test(html) && /class="modes"/.test(html));
    var r = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'S'), rh = r.html();
    H.ok('heat and cool: the two side by side, heat first, as the reading (not keys: no pick), the pair named for a screen reader',
      /class="tt heat"><small>Heat<\/small><b>68<\/b><\/div><div class="tt cool"><small>Cool<\/small><b>72<\/b>/.test(rh) && !/data-big-pick/.test(rh) &&
      /aria-label="Heat to 68, cool to 72 degrees/.test(rh), rh.slice(0, 600));
    H.ok('..."Auto · 66°" under the name', /<i>Auto · 66°<\/i>/.test(rh));
    H.ok('...the name is words (the block\'s own tap opens the sheet), one action on the block: the arrows', !/<button class="nm"/.test(rh) && /<div class="nm">/.test(rh) &&
      !/data-big-pick|class="trow|class="rng/.test(rh));
    r._bigNudge(1, function () {});
    H.ok('...and the arrows slide the pair together (2026-11-08, the controls rule)', r._hold.hi === 73 && r._hold.lo === 69 && r._hold.which === 'both', r._hold);
    var rt = big('heat_cool', { target_temp_low: 68, target_temp_high: 89, max_temp: 90 }, 'S');
    rt._bigNudge(1, function () {});
    H.ok('...the pair stops at the entity\'s limit, the gap between them kept', rt._hold.hi === 90 && rt._hold.lo === 69, rt._hold);
    var o = big('off', { temperature: 68 }, 'S');
    H.ok('off: Off, the arrows not to be used', /<b>Off<\/b>/.test(o.html()) && count(o.html(), /data-big-step="[^"]+" aria-label="[^"]+" disabled/g) === 2);
    var d = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'S', 'dial').html();
    H.ok('Small is Big Number whatever the style: a tile has no room for the ring', /surface big/.test(d) && !/data-ring/.test(d), d.slice(0, 200));
    H.ok('...Tall keeps the dial it was given', /data-ring/.test(big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'T', 'dial').html()));
  },
  function () {
    H.section('the thermostat, Tall: the name, the targets between their arrows, the Mode key');
    var t = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'T'), html = t.html();
    H.ok('cool over heat, each labelled in its colour', /class="tt cool"[\s\S]*<small>Cool To<\/small><b>72<\/b>[\s\S]*class="tt heat"[\s\S]*<small>Heat To<\/small><b>68<\/b>/.test(html),
      html.slice(0, 700));
    H.ok('a range: the name heads the block (words), the two targets one above the other between the arrows that slide both, then one Mode key that opens the sheet (three controls at most, 2026-11-08)', /class="hd"><div class="nm"><b>Thermostat<\/b>[\s\S]*class="tgr"><button class="ar"[^>]*data-big-step="-1"[^>]*aria-label="Lower both targets"[\s\S]*class="tg" data-big-num[\s\S]*class="tt cool"[\s\S]*class="tt heat"[\s\S]*data-big-step="1"[\s\S]*<button class="mb" type="button" data-tstat-details[^>]*>Mode · Auto ›<\/button>/.test(html) && !/class="mr"|class="trow|class="rng|data-big-pick/.test(html), html);
    var sh = big('heat', { temperature: 68 }, 'T').html();
    H.ok('one target: the arrows either side of it, the modes the sheet\'s',
      /class="tgr"><button class="ar"[^>]*data-big-step="-1"[\s\S]*class="tg" data-big-num[\s\S]*data-big-step="1"[\s\S]*class="mb"[^>]*>Mode · Heat ›/.test(sh) && !/class="rng"/.test(sh), sh);
    var wd = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'W').html();
    H.ok('Wide: one Mode key, not four circles', /class="mq"><button class="mb"[^>]*>Mode · Auto ›<\/button><\/div>/.test(wd) && !/data-big-mode=/.test(wd), wd.slice(-400));
    H.ok('...no row of modes and no foot: the arrows flank the target', !/class="ff"/.test(html) && !/data-big-mode=/.test(html));
    var one = big('cool', { temperature: 74 }, 'T');
    H.ok('one target: its label and the number', /<div class="one cool"><small>Cool To<\/small><b>74<\/b><\/div>/.test(one.html()), one.html().slice(0, 300));
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
    H.ok('Large: the measured face, the room and the mode under the name', /<div class="face">\s*<div class="bn" data-big-num[^>]*>68<\/div>/.test(l) && /<i>Living Room · Heat<\/i>/.test(l) &&
      !/class="mc"/.test(l), l.slice(0, 400));
    var x = big('heat', { temperature: 68 }, 'XL').html();
    H.ok('Extra Large: the face, the room under the name', /<div class="face">[\s\S]*<b>Thermostat<\/b><i>Living Room<\/i>/.test(x), x.slice(0, 600));
    H.ok('...the modes as a column, named, Heat on', /class="mc" role="group" aria-label="Mode"><b>Mode<\/b><button class="on" type="button" data-big-mode="heat"[^>]*><hk-icon icon="mdi:fire" aria-hidden="true"><\/hk-icon>Heat<\/button>[\s\S]*>Off<\/button>/.test(x), x);
    H.ok('...the real readings under them', /<span>Inside 66° · 41% humidity<\/span><\/div>/.test(x));
    H.ok('...no humidity, just inside', /<span>Inside 66°<\/span>/.test(big('heat', { temperature: 68, current_humidity: null }, 'XL').html()));
    var xr = big('heat_cool', { target_temp_low: 68, target_temp_high: 72 }, 'XL').html();
    H.ok('...heat and cool: the two on the face, the picked one\'s dot', /class="pk sel"[^>]*data-big-pick="low"[^>]*>68<\/button><span class="ds"/.test(xr), xr.slice(0, 500));
    var css = big('heat', { temperature: 68 }, 'S')._extraCss();
    H.ok('the dot is the face\'s; Small, Wide and Tall do not pick (the range is a reading of one designed size)', /\.big \.bn \.pk\.sel::before\{/.test(css) &&
      !/\.big \.tt\.sel|\.trow|\.rng/.test(css) && /\.big \.tt b\{font-size:44px\}/.test(css));
    H.ok('Tall\'s Mode key 44 px, the arrows 40 x 44 with a hit area out 4 px toward the edge only (none overlaps another)', /\.big \.mb\{[^}]*align-self:stretch;height:44px/.test(css) &&
      /\.big :is\(\.ff,\.tgr\) \.ar\{width:40px;height:44px/.test(css) && /\.ar:last-child::after\{left:0;right:-4px\}/.test(css));
    H.ok('Extra Large\'s face leaves the column its room', /:host\(\[size=XL\]\) \.big \.face\{right:calc\(var\(--hk-pad-r,18px\) \+ 200px\)\}/.test(css));
    H.ok('Small\'s number takes what the foot leaves, the same above and below', /:host\(\[size=S\]\) \.big \.one b\{font-size:min\(78px,calc\(\(100cqh/.test(css) &&
      /\.big \.tg\{flex:1 1 auto;[^}]*align-items:center;justify-content:center/.test(css));
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
    H.ok('...the symbol, the condition, today\'s high and low at the foot',
      /<div class="sc"><span class="sym" aria-hidden="true">[\s\S]*<\/span><span class="sct"><b>Partly Cloudy<\/b><span>H:70°  L:50°<\/span><\/span><\/div>/.test(s), s);
    H.ok('...and no hours or days', !/class="hrs"|class="days"/.test(s));
  },
  function () {
    H.section('Wide, Tall, Large');
    var w = block('W');
    H.ok('Wide as it was: the top and six hours', /class="wb W hh"/.test(w) && /class="top"/.test(w) && count(w, /class="hr"/g) === 6 && !/class="days"/.test(w), w.slice(0, 200));
    var t = block('T');
    H.ok('Tall: the condition, the high and low, then eight hours, one a line', /<div class="tl">[\s\S]*<b>Partly Cloudy<\/b><\/div><span class="th">H:70°  L:50°<\/span>/.test(t) &&
      count(t, /class="vr"/g) === 8, t);
    var l = block('L');
    H.ok('Large: the top, six hours, five days', /class="top"/.test(l) && count(l, /class="hr"/g) === 6 && count(l, /class="day"/g) === 5 && !/readings/.test(l), l.slice(0, 300));
    H.ok('Big Temperature still any size it is chosen for', /class="wb big T"/.test(block('T', null, { big: true })));
  },
  function () {
    H.section('Extra Large, a small Weather page');
    var x = block('XL');
    H.ok('the left column: the top, five hours, the readings', /<div class="lc"><div class="top">[\s\S]*class="hrs"[\s\S]*<div class="rds">/.test(x) && count(x, /class="hr"/g) === 5, x.slice(0, 300));
    H.ok('...feels like, humidity, wind (its direction in the label)', /Feels like<\/small><b>62°<\/b>/.test(x) && /Humidity<\/small><b>52%<\/b>/.test(x) && /Wind NW<\/small><b>6 mph<\/b>/.test(x),
      x);
    H.ok('...six readings at most, two across a square cell: each its own 6 of 12 columns, none stretched', count(x, /<span style="grid-column:span \d+">/g) === 6, x);
    var more = block('XL', { 'weather.openweathermap': ['sunny', { temperature: 64, friendly_name: 'OpenWeatherMap', pressure: 1015, pressure_unit: 'hPa', visibility: 10, visibility_unit: 'mi',
      dew_point: 48, humidity: 52 }] });
    H.ok('...pressure, visibility and dew point when the house has them (after the six, so cut)', /Rain<\/small>/.test(more) && count(more, /<span style="grid-column:/g) === 6, more);
    H.ok('...the chance of rain today, sunset, UV', /Rain<\/small><b>20%<\/b>/.test(x) && /Sunset<\/small><b>[0-9:]+ [AP]M<\/b>/.test(x) && /UV<\/small><b>2 Low<\/b>/.test(x));
    H.ok('the right: seven days, named', /<div class="rc"><b class="lab">7-Day Forecast<\/b><div class="days">/.test(x) && count(x, /class="day"/g) === 7);
    var dark = block('XL', { 'sun.sun': ['below_horizon', { next_setting: '2026-11-01T22:36:00Z', next_rising: '2026-11-01T11:10:00Z' }] });
    H.ok('after dark, the sunrise', /Sunrise<\/small>/.test(dark) && !/Sunset<\/small>/.test(dark));
    var bare = block('XL', { 'weather.openweathermap': ['sunny', { temperature: 64, friendly_name: 'OpenWeatherMap' }], 'sensor.openweathermap_apparent_temperature': ['unknown', {}],
                             'sensor.openweathermap_humidity': ['unknown', {}], 'sensor.openweathermap_wind_speed': ['unknown', {}] });
    H.ok('a reading the house lacks is left out, not shown empty', !/Feels like|Humidity|Wind/.test(bare) && /Rain<\/small>/.test(bare), bare);
  }
]);
