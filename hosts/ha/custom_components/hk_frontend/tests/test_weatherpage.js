// THE WEATHER PAGE'S CARDS (2026-10-16): the band's sections (hero, hourly,
// daily), the details card and its page-look tiles, the alert card's expired
// alerts, the one shared forecast subscription (hkWxForecast), and the radar
// module's providers -- fed recorded provider answers (fixtures), never the
// network.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/sample_settings.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');

// This suite mounts child cards through createElement, as Lovelace does.
// The shared string-DOM shim does not upgrade custom tags or move an
// already-parented node on append; model those browser contracts here.
var createWeatherElement = document.createElement;
document.createElement = function (tag) {
  return customElements.get(tag) ? H.make(tag) : createWeatherElement.call(document, tag);
};
HTMLElement.prototype.remove = El.prototype.remove;
var appendWeatherChild = El.prototype.appendChild;
El.prototype.appendChild = function (child) {
  if (child.parentNode) child.parentNode.removeChild(child);
  return appendWeatherChild.call(this, child);
};

var T0 = Date.UTC(2026, 8, 26, 13, 0, 0);
Date.now = function () { return T0 + 7 * 60e3; };
function hourly(n, extra) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push(Object.assign({ datetime: new Date(T0 + i * 3600e3).toISOString(), condition: 'sunny',
      temperature: 70 + i, precipitation_probability: i === 5 ? 70 : 0, wind_speed: 4 + i, humidity: 50 + i,
      pressure: 29.8 + i * 0.02, uv_index: i < 4 ? 6 - i : 0, wind_gust_speed: 12 }, extra || {}));
  }
  return out;
}
function daily(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ datetime: new Date(T0 + i * 864e5).toISOString(), condition: 'clear-night', temperature: 80 - i,
               templow: 50 + i, precipitation_probability: i === 1 ? 60 : 5 });
  }
  return out;
}
function house(extra) {
  return H.house(Object.assign({
    'weather.openweathermap': ['partlycloudy', { temperature: 72.4, apparent_temperature: 77, humidity: 48, dew_point: 61,
      wind_speed: 9.6, wind_bearing: 230, wind_speed_unit: 'mph', pressure: 29.85, pressure_unit: 'inHg', friendly_name: 'OpenWeatherMap' }],
    'sensor.openweathermap_apparent_temperature': ['77', {}],
    'sensor.openweathermap_humidity': ['48', {}],
    'sensor.openweathermap_wind_speed': ['9.6', { unit_of_measurement: 'mph' }],
    'sensor.weather_hourly_forecast': ['24', { forecast: hourly(24) }],
    'sensor.weather_daily_forecast': ['8', { forecast: daily(8) }],
    'sun.sun': ['above_horizon', { next_setting: '2026-09-26T23:20:00Z', next_rising: '2026-09-27T11:10:00Z', elevation: 30, rising: false }]
  }, extra || {}));
}
function setPage(p) {
  var s = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
  s.weather.page = Object.assign({}, window.hkSettings.DEFAULTS.weather.page, p || {});
  window.hkSettings._apply(s);
}

H.run('WEATHER PAGE CARDS', [
  function () {
    H.section('the hero: the place, now, today and what is coming');
    setPage();
    var placeSettings = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
    placeSettings.weather.place = 'Springfield';
    window.hkSettings._apply(placeSettings);
    var h = house(), c = H.make('hk-weather-band-card');
    c.setConfig({ type: 'custom:hk-weather-band-card', section: 'hero', entity: 'weather.openweathermap' });
    c.hass = h.hass();
    var html = H.morphed(c._root);
    H.ok('only the configured place, without a prefix or decorative dot', /<div class="pl">Springfield<\/div>/.test(html), html.slice(0, 200));
    H.ok('the temperature and condition', /72°/.test(html) && /Partly Cloudy/i.test(html), html);
    H.ok('today’s high and low from the daily forecast', /H:80°/.test(html) && /L:50°/.test(html));
    H.ok('what is coming, from the forecast: rain likely', /Rain likely around/.test(html), html);
    H.ok('...and how it feels when that differs', /Feels like 77°/.test(html));
    H.ok('the condition backdrop is decorative and marked for shared layer motion',
      /class="bd" aria-hidden="true"/.test(html) && /data-sym=/.test(html), html);
    var night = house({ 'sun.sun': ['below_horizon', {}] });
    c.hass = night.hass();
    html = H.morphed(c._root);
    H.ok('the same condition uses its night variant after sunset', /weather-night-partly-cloudy/.test(html), html);
    var missing = house({ 'weather.openweathermap': ['unavailable', {}] });
    c.hass = missing.hass();
    html = H.morphed(c._root);
    H.ok('unavailable weather does not invent a backdrop', /class="bd" aria-hidden="true"><\/div>/.test(html), html);
    H.throws('a section that is not one is refused', function () { c.setConfig({ section: 'week' }); });
  },
  function () {
    H.section('one number for now: the outside sensor, as the sheet and Climate read it');
    var st = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
    st.weather.outside = 'sensor.backyard_temperature';
    st.weather.page = window.hkSettings.DEFAULTS.weather.page;
    window.hkSettings._apply(st);
    var h = house({ 'sensor.backyard_temperature': ['66.6', { unit_of_measurement: '°F' }] });
    var hero = H.make('hk-weather-band-card');
    hero.setConfig({ type: 'custom:hk-weather-band-card', section: 'hero', entity: 'weather.openweathermap' });
    hero.hass = h.hass();
    H.ok('the hero says the outside sensor’s 67°', /class="tp"[^>]*>67°/.test(H.morphed(hero._root)) || />67°</.test(H.morphed(hero._root)), H.morphed(hero._root).slice(0, 300));
    var hr = H.make('hk-weather-band-card');
    hr.setConfig({ type: 'custom:hk-weather-band-card', section: 'hourly', entity: 'weather.openweathermap' });
    hr.hass = h.hass();
    var cells = H.morphed(H.part(hr._root, '.hrs'));
    H.ok('...and so does the hourly Now; the next hour is the forecast’s', /Now<\/span>.*?<b>67°<\/b>/.test(cells) && /<b>71°<\/b>/.test(cells), cells.slice(0, 500));
    H.ok('...a changed outside reading redraws', (hero.hass = h.set('sensor.backyard_temperature', '60'), />60°</.test(H.morphed(hero._root))));
    window.hkSettings._apply(HK_SAMPLE_SETTINGS);
  },
  function () {
    H.section('the hours: as many as asked and given, three views, a tap reads one');
    setPage({ hours: 6 });
    var h = house(), c = H.make('hk-weather-band-card');
    c.setConfig({ type: 'custom:hk-weather-band-card', section: 'hourly', entity: 'weather.openweathermap' });
    c.hass = h.hass();
    var cells = H.morphed(H.part(c._root, '.hrs'));
    H.eq('six hours, as weather.page asks', (cells.match(/class="hr"/g) || []).length, 6);
    H.ok('Temperature first; rain chance under an hour from 20 %', /<b>72°<\/b>/.test(cells) && /class="p">70%/.test(cells), cells.slice(0, 400));
    var seg = H.morphed(H.part(c._root, '.seg'));
    H.ok('Temperature is the chosen view', /data-m="temperature" aria-selected="true"/.test(seg), seg);
    c._metric = 'wind'; c.redraw();
    cells = H.morphed(H.part(c._root, '.hrs'));
    H.ok('the Wind view: speeds with their unit', /<b>4<small>mph<\/small><\/b>/.test(cells), cells.slice(0, 300));
    c._sel = 2; c.redraw();
    var rd = H.morphed(H.part(c._root, '.rd'));
    H.ok('a tapped hour is read out', /72°/.test(rd) && /% chance of rain/.test(rd) && /OpenWeatherMap/.test(rd), rd);
    // a forecast with no rain chance: Rain is offered but not choosable, and the saved Rain view falls back
    setPage({ hourly_metric: 'rain' });
    var h2 = house({ 'sensor.weather_hourly_forecast': ['24', { forecast: hourly(24).map(function (x) { delete x.precipitation_probability; return x; }) }] });
    var c2 = H.make('hk-weather-band-card');
    c2.setConfig({ type: 'custom:hk-weather-band-card', section: 'hourly', entity: 'weather.openweathermap' });
    c2.hass = h2.hass();
    seg = H.morphed(H.part(c2._root, '.seg'));
    H.ok('a view the forecast lacks is disabled', /data-m="rain" aria-selected="false" aria-checked="false" disabled/.test(seg), seg);
    H.eq('...and the page opens on the first it has, the setting kept', [c2._metricShown, window.hkSettings.weatherPage().hourly_metric].join(), 'temperature,rain');
    // no forecast at all: said, not drawn as empty cells
    setPage();
    var h3 = house({ 'sensor.weather_hourly_forecast': ['0', { forecast: [] }] });
    var c3 = H.make('hk-weather-band-card');
    c3.setConfig({ type: 'custom:hk-weather-band-card', section: 'hourly', entity: 'weather.openweathermap' });
    c3.hass = h3.hass();
    H.ok('no hours: it says so', /No hourly forecast from OpenWeatherMap/.test(H.morphed(H.part(c3._root, '.hrs'))));
  },
  function () {
    H.section('the days: only those given, on one scale');
    setPage({ days: 10 });
    var h = house(), c = H.make('hk-weather-band-card');
    c.setConfig({ type: 'custom:hk-weather-band-card', section: 'daily', entity: 'weather.openweathermap' });
    c.hass = h.hass();
    var rows = H.morphed(H.part(c._root, '.dys'));
    H.eq('ten asked, eight given: eight', (rows.match(/class="dy"/g) || []).length, 8);
    H.eq('...and the title says eight', H.part(c._root, '.nm').textContent, '8-Day Forecast');
    H.ok('a day is never night: clear-night reads as sunny', /Today: Sunny/.test(rows), rows.slice(0, 300));
    var ranges = Array.from(rows.matchAll(/<i style="left:([\d.]+)%;right:([\d.]+)%/g));
    H.eq('one scale: today spans the week’s coldest low and warmest high', ranges[0].slice(1).map(Number), [0, 0]);
    H.eq('the next day is inset on that same 30-degree scale', ranges[1].slice(1).map(Number).map(function (n) { return Math.round(n * 10) / 10; }), [3.3, 3.3]);
    H.ok('rain chance from 20 % under the glyph', /<small>60%<\/small>/.test(rows));
    H.ok('the week in a line', /Warmest today at 80°, coolest/.test(H.part(c._root, '.ft').textContent));
  },
  function () {
    H.section('the details: the tiles weather.page names, in its order');
    setPage({ details: ['pressure', 'wind', 'humidity'] });
    var h = house(), c = H.make('hk-weather-details-card');
    c.setConfig({ type: 'custom:hk-weather-details-card', entity: 'weather.openweathermap' });
    c.hass = h.hass();
    var tiles = H.part(c._root, '.dg').children;
    H.eq('three tiles, in order', tiles.map(function (t) { return t._config.variant; }).join(), 'pressure,wind,humidity');
    H.ok('each in the page look', tiles.every(function (t) { return t._config.look === 'page'; }));
    var pr = H.morphed(H.part(tiles[0]._root, '.pb')), pn = H.morphed(H.part(tiles[0]._root, '.pn'));
    H.ok('Pressure: the reading, its unit, the trend from the forecast', /29\.85<small>inHg/.test(pr) && /Forecast to rise/.test(pn), [pr, pn]);
    var wb = H.morphed(H.part(tiles[1]._root, '.pb')), wn = H.morphed(H.part(tiles[1]._root, '.pn'));
    H.ok('Wind: the speed (the house’s sensor) and where from', /10<small>mph/.test(wb) && /From the SW/.test(wb), wb);
    H.ok('...gusts from the forecast when no gust sensor', /Gusts up to 12 mph/.test(wn), wn);
    H.ok('Humidity: the dew point beside it', /dew point is 61°/.test(H.morphed(H.part(tiles[2]._root, '.pn'))));
    setPage({ details: ['moon', 'wind'] });
    c.hass = h.set('sun.sun', 'above_horizon');
    tiles = H.part(c._root, '.dg').children;
    H.eq('a new order follows at once, a tile no longer listed gone', tiles.map(function (t) { return t._config.variant; }).join(), 'moon,wind');
    // a reading the service doesn't give: said, not invented
    setPage({ details: ['uv'] });
    var h2 = house({ 'sensor.weather_hourly_forecast': ['24', { forecast: hourly(24).map(function (x) { delete x.uv_index; return x; }) }] });
    var s2 = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS)); s2.weather.uv = null; s2.weather.page = { details: ['uv'] };
    window.hkSettings._apply(s2);
    var c2 = H.make('hk-weather-details-card');
    c2.setConfig({ type: 'custom:hk-weather-details-card', entity: 'weather.openweathermap' });
    c2.hass = h2.hass();
    var t2 = H.part(c2._root, '.dg').children[0];
    H.ok('UV not given: Not available, and whose', /Not available/.test(H.morphed(H.part(t2._root, '.pb'))) &&
         /OpenWeatherMap doesn’t give a UV index/.test(H.morphed(H.part(t2._root, '.pn'))));
    H.throws('a tile variant that is not one is refused', function () { H.make('hk-weather-tile-card').setConfig({ variant: 'tides' }); });
    window.hkSettings._apply(HK_SAMPLE_SETTINGS);
  },
  function () {
    H.section('one forecast subscription, however many watch it');
    var F = window.hkWxForecast, h = house(), conn = h.hass().connection;
    var n0 = h.subs.length, got = 0;
    var a = F.watch(conn, 'hourly', 'weather.x', function () { got++; });
    var b = F.watch(conn, 'hourly', 'weather.x', function () { got++; });
    H.eq('two watchers, one subscription', h.subs.length - n0, 1);
    h.subs[h.subs.length - 1].cb({ forecast: [{ datetime: 'x' }] });
    H.eq('both told', got, 2);
    H.eq('both read it', a.data().length + b.data().length, 2);
    a.release();
    return H.tick().then(function () {
      H.eq('one let go: still subscribed', h.activeSubs(), 1);
      b.release();
      return H.tick();
    }).then(function () {
      H.eq('the last let go: unsubscribed', h.activeSubs(), 0);
      H.eq('...and its reconnect listener gone', h.readyListeners(), 0);
    });
  },
  function () {
    H.section('alerts: an ended one is not shown');
    var h = house({ 'sensor.nws_alerts': ['1', { Alerts: [{ Event: 'Frost Advisory', Severity: 'Minor', Ends: '2026-09-26T10:00:00Z' }] }] });
    var c = H.make('hk-alert-card');
    c.setConfig({ type: 'custom:hk-alert-card', entity: 'sensor.nws_alerts', details: true });
    c.hass = h.hass();
    H.eq('expired: hidden, though the sensor still counts it', c._alertShown, false);
    c.hass = h.set('sensor.nws_alerts', '1', { Alerts: [{ Event: 'Wind Advisory', Severity: 'Moderate', Ends: '2026-09-26T23:00:00Z' }] });
    H.eq('in effect: shown', c._alertShown, true);
    H.ok('...with its details action', /Details ›/.test(H.part(c._root, '.count').textContent));
  },
  function () {
    H.section('the radar card: nothing loaded while the radar is off');
    setPage();
    var h = house(), c = H.make('hk-radar-card');
    c.setConfig({ type: 'custom:hk-radar-card' });
    H.attach(c);
    c.hass = h.hass();
    H.eq('off: hidden, and the module never asked for', [c.style.display, !!c._loading, !!window.hkRadar].join(), 'none,false,false');
    H.detach(c);
  }
]);
