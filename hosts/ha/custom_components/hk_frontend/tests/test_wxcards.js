// hk-alert-card, hk-clock-card, hk-weather-band-card, hk-weather-strip-card
// -- CONSTRUCTED AND DRIVEN, the way Lovelace drives them.
//
// The picker entry and the editor form are tested elsewhere; this suite tests
// the cards themselves. Each is built with `new`, given the config a real
// dashboard uses (the Weather page, a car browser's topbar, the phone header,
// the screensaver), fed a hass with the entities that config reads, and held
// to three things:
//
//   1. it renders, and what it draws is the entity's data;
//   2. the render gate: a relevant entity moves the signature and redraws, an
//      unrelated one does neither;
//   3. attach / detach / re-attach throws nothing and leaves nothing behind --
//      the band's ResizeObserver and forecast subscriptions included.
//
// The settings are the sample house's (tests/sample_settings.js), which name
// the same kinds of sensors a real Configure page does.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/sample_settings.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');
function editorFields(tag) {
  var C = customElements.get(tag), probe = C.getConfigElement();
  var EC = customElements.get(String(probe.tagName || '').toLowerCase());
  var ed = EC ? new EC() : probe;
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.hass = { states: {} }; ed.setConfig({ type: 'custom:' + tag });
  var out = {};
  (function walk(list) { (list || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
  return out;
}

var ALERTS = 'sensor.nws_alerts_alerts';
function hourly(n, t0) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ datetime: new Date(t0 + i * 3600e3).toISOString(), condition: 'sunny',
               temperature: 70 + (i % 5), precipitation_probability: i === 3 ? 40 : 0 });
  }
  return out;
}
function daily(n, t0) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ datetime: new Date(t0 + i * 864e5).toISOString(), condition: 'clear-night',
               temperature: 79 - i, templow: 50 + i });
  }
  return out;
}
var T0 = Date.UTC(2026, 8, 26, 13, 0, 0);
// The suite runs at 13:07 on the day its forecasts were made: the band drops
// hourly slots that have already ended, so a real clock would drop them all.
Date.now = function () { return T0 + 7 * 60e3; };
// The entities the four configs read, in the shapes the real sensors carry.
function wxHouse() {
  return H.house({
    'weather.openweathermap': ['sunny', { temperature: 72.4, apparent_temperature: 73,
      humidity: 48, wind_speed: 4.6, wind_speed_unit: 'mph', friendly_name: 'OpenWeatherMap' }],
    'sensor.openweathermap_apparent_temperature': ['73.2', { unit_of_measurement: '°F' }],
    'sensor.openweathermap_humidity': ['48', { unit_of_measurement: '%' }],
    'sensor.openweathermap_wind_speed': ['4.6', { unit_of_measurement: 'mph' }],
    'sensor.weather_hourly_forecast': ['24', { forecast: hourly(24, T0) }],
    'sensor.weather_daily_forecast': ['8', { forecast: daily(8, T0) }],
    'sun.sun': ['above_horizon', { next_setting: '2026-09-26T23:20:00Z',
                                   next_rising: '2026-09-27T11:10:00Z' }],
    'sensor.time': ['07:05', {}],
    'sensor.date': ['2026-09-26', {}],
    'light.kitchen_table_light': ['off', { friendly_name: 'Kitchen Table Light' }],
    [ALERTS]: ['1', { Alerts: [{ Event: 'Heat Advisory', Severity: 'Moderate',
      Ends: '2026-09-26T23:00:00Z', AreasAffected: 'North County; Central County; South County' }],
      friendly_name: 'NWS Alerts' }]
  });
}
function text(el) { return el ? el.textContent : '(missing)'; }

H.run('WEATHER CARDS', [

  // ------------------------------------------------------------ hk-screensaver-status-card
  function () {
    H.section('hk-screensaver-status-card (Home Status on the screensaver)');
    // what Home Status says stands in, sized as asked, and each drawing is
    // kept (this DOM does not parse HTML): the card is under test
    var real = window.hkHeader.security, realMorph = window.hkCards.morph, drawn = [];
    window.hkHeader.security = function (st, o) { return '<div>Front Door Open ' + o.line1Size + '</div>'; };
    window.hkCards.morph = function (el, v) { drawn.push(v); };
    var c = H.make('hk-screensaver-status-card');
    c.setConfig({});
    c.hass = wxHouse().hass();
    H.ok('it draws what Home Status says', drawn.length > 0 && /36px/.test(drawn[drawn.length - 1]), drawn);
    // ...SET AGAIN (the screensaver's pane coming or going sizes it anew): a
    // rebuild starts empty and must draw again -- the same words included,
    // never kept in mind as already drawn and the new box left blank
    c.setConfig({ line1_size: '22px', line_size: '16px', align: 'left' });
    H.ok('set again, it draws again', /22px/.test(drawn[drawn.length - 1]), drawn);
    var n = drawn.length;
    c.setConfig({});
    H.ok('...and set back, it draws the first again', drawn.length === n + 1 && /36px/.test(drawn[n]), drawn);
    // ...and SET THE SAME (what the pane does when it is reapplied): the
    // same words, into a new box -- drawn, not skipped as unchanged
    c.setConfig({});
    H.ok('set the same again, it still draws', drawn.length === n + 2, drawn.length - n);
    // A CHEAP SIGNATURE (2026-10-29): the header's HTML is built only when what it is made of moved -- not on every
    // push of the house, to be compared and thrown away
    var calls = 0, items = ['Front Door Open'], realStatus = window.hkHeader.status;
    window.hkHeader.security = function (st, o) { calls++; return '<div>' + items.join() + ' ' + o.line1Size + '</div>'; };
    window.hkHeader.status = function () { return { secured: false, items: items.slice() }; };
    var d = H.make('hk-screensaver-status-card');
    d.setConfig({});
    d.hass = wxHouse().hass();
    var c0 = calls;
    for (var i = 0; i < 5; i++) d.hass = wxHouse().hass();                    // pushes that change nothing it shows
    H.ok('pushes of the house that change nothing it shows build no header', calls === c0, calls - c0);
    items = ['Front Door Open', '1 Lock Unlocked'];
    d.hass = wxHouse().hass();
    H.ok('...a change in what the line says builds it, and it is drawn', calls === c0 + 1 && /1 Lock Unlocked/.test(drawn[drawn.length - 1]), [calls - c0, drawn[drawn.length - 1]]);
    window.hkHeader.status = realStatus;
    window.hkHeader.security = real; window.hkCards.morph = realMorph;
  },

  // ------------------------------------------------------------ hk-alert-card
  function () {
    H.section('hk-alert-card (the Weather page)');
    // NO entity: the card takes Configure -> Weather's alerts sensor, and must not throw.
    var bare = H.make('hk-alert-card');
    H.noThrow('an alert card without an entity takes the house\'s alerts sensor', function () {
      bare.setConfig({ title: 'x' });
      bare.hass = wxHouse().hass();
    });
    H.eq('...which is Configure -> Weather -> Alerts', bare._config.entity, HK_SAMPLE_SETTINGS.weather.alerts);
    var mine = H.make('hk-alert-card');
    mine.setConfig({ title: 'x', entity: 'sensor.other_alerts' });
    mine.hass = wxHouse().hass();
    H.eq('...but a card that names its own keeps it', mine._config.entity, 'sensor.other_alerts');
    var house = wxHouse(), card = H.make('hk-alert-card');
    H.noThrow('setConfig with the Weather page config', function () {
      card.setConfig({ type: 'custom:hk-alert-card', entity: ALERTS, title: 'Severe Weather',
                       source: 'National Weather Service', icon: 'mdi:alert' });
    });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root;
    H.ok('draws the plate', /hk-plate class="alert"/.test(R.__html), R.__html.slice(0, 60));
    H.eq('title', text(H.part(R, '.title')), 'Severe Weather');
    H.eq('source', text(H.part(R, '.src')), 'National Weather Service');
    H.ok('body names the event and when it ends',
         /^Heat Advisory\. These conditions are expected to last until .+, Saturday, September 26\.$/
           .test(text(H.part(R, '.body'))), text(H.part(R, '.body')));
    H.eq('count line: severity, alerts, areas', text(H.part(R, '.count')),
         'Moderate  ·  1 alert  ·  3 areas');
    H.eq('a moderate alert is amber', H.part(R, '.icon').style.color, 'rgba(255, 159, 10, 0.98)');

    H.gate('alert', card, house,
      function () {
        return house.set(ALERTS, '2', { Alerts: [
          { Event: 'Tornado Warning', Severity: 'Extreme', Expires: '2026-09-26T20:00:00Z' },
          { Event: 'Heat Advisory', Severity: 'Moderate' }] });
      },
      function () { return house.set('light.kitchen_table_light', 'on'); });
    H.ok('the new alert is drawn', /^Tornado Warning\./.test(text(H.part(R, '.body'))));
    H.eq('...counted', text(H.part(R, '.count')), 'Extreme  ·  2 alerts');
    H.eq('...and an extreme one is red', H.part(R, '.icon').style.color, 'rgba(255, 69, 58, 0.98)');

    // ONLY WHILE ONE IS LIVE: none, and it hides itself the way a conditional
    // card does (no wrapper needed on a dashboard of one's own); the card
    // editor's preview still draws it, saying when it shows.
    var quiet = wxHouse(), q = H.make('hk-alert-card'), told = [];
    q.dispatchEvent = function (e) { told.push(e.type + ':' + e.detail.value); return true; };
    q.setConfig({ entity: ALERTS });
    q.hass = quiet.set(ALERTS, '0', { Alerts: [] });
    H.ok('no alert: hidden', q.hidden === true && q._alertShown === false);
    H.eq('...and takes no room', q.getCardSize(), 0);
    q.preview = true;
    H.ok('in the editor preview: drawn, as a sample', q.hidden === false &&
         /only while an alert is active/.test(text(H.part(q._root, '.body'))), text(H.part(q._root, '.body')));
    H.eq('...counting none', text(H.part(q._root, '.count')), 'No alerts now');
    q.preview = false;
    H.ok('out of the preview: hidden again', q.hidden === true);
    q.hass = quiet.set(ALERTS, '1', { Alerts: [{ Event: 'Frost Advisory', Severity: 'Minor' }] });
    H.ok('an alert comes: shown', q.hidden === false && /^Frost Advisory\./.test(text(H.part(q._root, '.body'))));
    return H.lifecycle('alert', card, house, function (c) { c.hass = house.hass(); });
  },

  // ------------------------------------------------------------ hk-clock-card
  function () {
    H.section('hk-clock-card (the screensaver, a car browser\'s topbar)');
    var house = wxHouse(), card = H.make('hk-clock-card');
    H.noThrow('setConfig with the screensaver config', function () {
      card.setConfig({ type: 'custom:hk-clock-card', time_size: '150px', ampm_size: '40px',
        date_size: '40px', time_letter_spacing: '0px', ampm_letter_spacing: '0.37px',
        date_letter_spacing: '0.37px', time_line_height: '1', date_format: 'monthday',
        date_gap: '4px', gap: '8px', color: 'rgba(255,255,255,0.95)',
        ampm_color: 'rgba(255,255,255,0.70)', date_color: 'rgba(255,255,255,0.85)' });
    });
    H.eq('no hass, nothing drawn yet', H.morphed(card._root), '');
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var m = H.morphed(card._root);
    H.ok('draws through morph(), into a clock plate', /^<hk-plate class="clock" style="margin:0">/.test(m), m.slice(0, 60));
    H.ok('the time is the Time sensor, 12-hour', />7:05<\/span>/.test(m) && />AM<\/span>/.test(m));
    H.ok('the screensaver date format', /September, 26th/.test(m));
    H.ok('its own sizes, not the header\'s', /font-size:150px/.test(m) && !/font-size:72px/.test(m));
    H.ok('its own colors win over the light-page tokens',
         /color:rgba\(255,255,255,0\.85\)/.test(m) && !/--hk-ink/.test(m));
    var hh = window.hkHeader, hs = house.hass().states;
    H.ok('the header\'s defaults follow a light page (the text scale the fallback)',
         /color:var\(--hk-ink, rgba\(255,255,255,0\.94\)\)/.test(hh.row(hs, {})) &&
         /filter:var\(--hk-glow, drop-shadow\(0px 1px 3px/.test(hh.row(hs, {})));

    H.gate('clock', card, house,
      function () { return house.set('sensor.time', '13:06'); },
      function () { return house.set('light.kitchen_table_light', 'on'); });
    H.ok('the next minute is drawn', />1:06<\/span>/.test(H.morphed(card._root)) &&
         />PM<\/span>/.test(H.morphed(card._root)));
    var r0 = card.__renders;
    card.hass = house.set('sensor.date', '2026-09-27');
    H.ok('the Date sensor is an input too', card.__renders === r0 + 1 &&
         /September, 27th/.test(H.morphed(card._root)));
    // The Time sensor's attributes do not matter: the signature is the time
    // and the date as text, so a new stamp alone does not redraw.
    r0 = card.__renders;
    card.hass = house.touch('sensor.time');
    H.eq('a re-stamped but unchanged time does not redraw', card.__renders - r0, 0);

    var tesla = H.make('hk-clock-card');
    H.noThrow('the car-browser topbar config renders', function () {
      tesla.setConfig({ type: 'custom:hk-clock-card', height: '108px', padding: '10px 0px',
        shadow: true, time_size: '52px', ampm_size: '19px', date_size: '15px' });
      tesla.hass = house.hass();
    });
    var tm = H.morphed(tesla._root);
    H.ok('car topbar: height, padding and the drop-shadow filter reach the plate',
         /height:108px;padding:10px 0px;filter:var\(--hk-glow, drop-shadow/.test(tm), tm.slice(0, 120));
    H.ok('car topbar: the header date format', /Sunday, September 27th/.test(tm));
    return H.lifecycle('clock', card, house, function (c) { c.hass = house.hass(); });
  },

  // ----------------------------------------------------- hk-weather-band-card
  function () {
    H.section('hk-weather-band-card (the Weather page, a car browser)');
    var bareBand = H.make('hk-weather-band-card');
    H.noThrow('a band without an entity takes the house\'s weather', function () {
      bareBand.setConfig({ hours: 12 });
      bareBand.hass = wxHouse().hass();
    });
    H.eq('...Configure -> Weather\'s entity', bareBand._config.entity, 'weather.openweathermap');
    var house = wxHouse(), card = H.make('hk-weather-band-card');
    H.noThrow('setConfig with the Weather page config', function () {
      card.setConfig({ type: 'custom:hk-weather-band-card', entity: 'weather.openweathermap',
                       hours: 12, days: 8 });
    });
    H.eq('tap does nothing unless configured', card._config.tap_action, { action: 'none' });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var html = card._root.__html;
    H.ok('the place is the one chosen in Configure', /HOME · SPRINGFIELD/.test(html));
    H.ok('the temperature is the weather entity\'s', /<div class="temp">72°<\/div>/.test(html));
    H.ok('the condition is named, not title-cased', /<div class="cond">Sunny<\/div>/.test(html));
    H.ok('feels-like and humidity come from the chosen SENSORS',
         /Feels 73° · 48% humidity/.test(html));
    H.eq('twelve hours and eight days, from the two forecast sensors',
         [(html.split('class="hrule"')[0].match(/<div class="hi">/g) || []).length,
          (html.split('class="hrule"')[1].match(/<div class="hi">/g) || []).length], [12, 8]);
    H.ok('the first hour is Now, the first day Today', /class="lbl now">Now</.test(html) && /class="lbl now">Today</.test(html));
    // The daily sensor says clear-night for every day (OpenWeatherMap does);
    // a DAY is drawn as the clear day it is, never a moon.
    H.eq('a daily clear-night is drawn as a clear day',
         (html.split('class="hrule"')[1].match(/aria-label="([^"]+)"/g) || []).join(),
         new Array(9).join('aria-label="Sunny",').slice(0, -1));
    H.eq('no forecast subscription when the sensors are chosen', house.subs.length, 0);

    // A SENSOR REFRESHED ON THE HOUR CAN START WITH THE HOUR THAT JUST ENDED
    // (seen live: at 22:07 the list began at 21:00, labelled Now, then 10 PM).
    var stale = H.make('hk-weather-band-card'), sh = wxHouse();
    stale.setConfig({ type: 'custom:hk-weather-band-card', entity: 'weather.openweathermap', hours: 12, days: 8 });
    sh.set('sensor.weather_hourly_forecast', '24', { forecast: hourly(24, T0 - 3600e3) });
    stale.hass = sh.hass();
    var sHtml = stale._root.__html.split('class="hrule"')[0];
    var nextH = new Date(T0 + 3600e3).getHours();     // the machine's own zone, as the card's
    H.eq('an hourly slot that has ended is skipped: Now is the hour we are in, then the next',
         (sHtml.match(/class="lbl[^"]*">[^<]+/g) || []).slice(0, 2).map(function (x) { return x.split('>')[1]; }),
         ['Now', (nextH % 12 === 0 ? 12 : nextH % 12) + (nextH < 12 ? ' AM' : ' PM')]);
    H.eq('...and the band still fills its twelve hours', (sHtml.match(/<div class="hi">/g) || []).length, 12);
    H.eq('...the temperature under Now is the current slot\'s', (sHtml.match(/<div class="hi">(\d+)/) || [])[1], '71');

    H.gate('band', card, house,
      function () { return house.set('sensor.weather_hourly_forecast', '24', { forecast: hourly(24, T0 + 3600e3) }); },
      function () { return house.set('light.kitchen_table_light', 'on'); });
    var r0 = card.__renders;
    card.hass = house.set('sensor.openweathermap_apparent_temperature', '80.1');
    H.ok('the feels-like sensor is in the signature', card.__renders === r0 + 1 &&
         /Feels 80°/.test(card._root.__html));
    card.hass = house.set('sensor.weather_daily_forecast', '8', { forecast: daily(8, T0 + 864e5) });
    H.eq('the daily forecast sensor is in the signature', card.__renders, r0 + 2);

    // THE COLUMN COUNT IS PART OF THE SIGNATURE: a resize across a column
    // boundary must redraw, one that does not cross must not.
    H.attach(card);
    H.eq('attached: one ResizeObserver on the host', H.observed(), 1);
    r0 = card.__renders;
    H.resize(card, 1200);
    H.eq('a wide host still draws the cap (12 hours)', card.__renders - r0, 0);
    H.resize(card, 397 + 6 * 44);     // room for six 40px hours with 4px gaps
    H.eq('a narrow host redraws once with fewer hours', card.__renders - r0, 1);
    H.eq('...six of them', (card._root.__html.split('class="hrule"')[0].match(/<div class="hi">/g) || []).length, 6);
    H.resize(card, 397 + 6 * 44 + 1);
    H.eq('a resize that crosses no boundary does not redraw', card.__renders - r0, 1);
    // TODAY'S COLUMN, SLIMMER (`now_width`: the screensaver's band beside its
    // calendar pane): the strips get the room it gives up, side by side
    var c0 = card._config;
    card._config = Object.assign({}, c0, { now_width: 200 });
    H.resize(card, 297 + 8 * 44);
    H.eq('a 200px today column leaves room for eight 40px hours', card._fit(12, 40), 8);
    H.eq('...beside it, not stood up', card._narrow(), false);
    card._config = Object.assign({}, c0, { now_width: 5 });
    H.eq('a width it cannot use is the usual 300', card._side(), 397);
    card._config = c0;
    H.detach(card);
    H.eq('detached: the observer is disconnected', H.observed(), 0);
    return H.lifecycle('band', card, house, function (c) { c.hass = house.hass(); });
  },

  // A HOUSE WITHOUT FORECAST SENSORS: the band asks the weather entity itself
  // (weather/subscribe_forecast), one subscription per kind, and must drop
  // them when it leaves the page.
  function () {
    H.section('hk-weather-band-card: forecast by subscription');
    var saved = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
    saved.weather.forecast_hourly = null;
    saved.weather.forecast_daily = null;
    window.hkSettings._apply(saved);
    var house = wxHouse(), card = H.make('hk-weather-band-card');
    card.setConfig({ type: 'custom:hk-weather-band-card', entity: 'weather.openweathermap',
                     hours: 12, days: 8 });
    card.hass = house.hass();
    var ready0 = house.readyListeners();     // the hass hub's own, for the page's life
    H.eq('not on the page: no subscription yet', house.subs.length, 0);
    H.attach(card);
    card.hass = house.set('weather.openweathermap', 'cloudy');
    H.eq('on the page: hourly and daily are subscribed', house.subs.map(function (s) {
      return s.msg.type + ':' + s.msg.forecast_type + ':' + s.msg.entity_id; }),
      ['weather/subscribe_forecast:hourly:weather.openweathermap',
       'weather/subscribe_forecast:daily:weather.openweathermap']);
    var r0 = card.__renders;
    house.subs[0].cb({ forecast: hourly(24, T0) });
    H.eq('a forecast event redraws the band', card.__renders - r0, 1);
    H.eq('...with the hours it carried', (card._root.__html.match(/<div class="hi">/g) || []).length, 12);
    card.hass = house.set('light.kitchen_table_light', 'on');
    H.eq('an unrelated push does not subscribe again', house.subs.length, 2);
    // A RECONNECT (a restart): the server forgot both; the library's own
    // resubscribe is off (a refused one was dropped for good) and the band
    // asks again itself.
    H.ok('its subscriptions are its own to renew (resubscribe: false)',
         house.subs.every(function (s) { return s.opts.resubscribe === false; }));
    house.reconnect();
    card.hass = house.set('light.kitchen_table_light', 'off');
    H.eq('after a reconnect both are asked for again', house.activeSubs(), 2);
    H.detach(card);
    return H.tick().then(function () {
      H.eq('detached: both subscriptions dropped', house.activeSubs(), 0);
      H.eq('detached: the observer is disconnected', H.observed(), 0);
      H.attach(card);
      card.hass = house.set('light.kitchen_table_light', 'off');

      // disconnectedCallback also drops the render gate's signature, so the
      // first hass push after a re-attach -- ANY push, not only a weather
      // change -- renders and subscribes again. Otherwise the cached forecast
      // would stay on screen until the weather entity itself changed (only
      // houses without forecast sensors take this path).
      H.eq('re-attached: the next push, unrelated or not, subscribes again',
           house.activeSubs(), 2);
      card.hass = house.set('weather.openweathermap', 'sunny');
      H.eq('...and a weather update does not subscribe twice', house.activeSubs(), 2);
      H.detach(card);
      return H.tick();
    }).then(function () {
      H.eq('detached again: nothing left subscribed', house.activeSubs(), 0);
      H.eq('...and no reconnect listener of its own left behind', house.readyListeners(), ready0);
      window.hkSettings._apply(HK_SAMPLE_SETTINGS);
    });
  },

  // --------------------------------------------------- hk-weather-strip-card
  function () {
    H.section('hk-weather-strip-card (the phone header, the screensaver)');
    var house = wxHouse(), card = H.make('hk-weather-strip-card');
    H.noThrow('setConfig with the phone config (no entity)', function () {
      card.setConfig({ type: 'custom:hk-weather-strip-card', margin: '30px 0px 19px 0px',
                       tap_action: { action: 'navigate', navigation_path: './weather' } });
    });
    H.eq('no entity in the config: the one chosen in Configure', card._config.entity, 'weather.openweathermap');
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var html = card._root.__html;
    H.ok('draws a tappable strip with its margin',
         /^<hk-plate class="strip tappable" style="margin:30px 0px 19px 0px">/.test(html), html.slice(0, 80));
    H.ok('the temperature is the weather entity\'s', /72°/.test(html));
    H.ok('the tap is wired once, on the root', (card._root._listeners.click || []).length === 1);

    H.gate('strip', card, house,
      function () { return house.set('weather.openweathermap', 'cloudy', { temperature: 64 }); },
      function () { return house.set('sensor.openweathermap_humidity', '51'); });
    H.ok('the new reading is drawn', /64°/.test(card._root.__html));
    var r0 = card.__renders;
    card.hass = house.set('sun.sun', 'below_horizon');
    H.eq('sunset redraws (the glyph turns to a moon)', card.__renders - r0, 1);
    r0 = card.__renders;
    card.hass = house.touch('sun.sun');
    H.eq('...but sun.sun\'s attributes moving does not', card.__renders - r0, 0);
    H.eq('re-rendering never adds a second tap listener', (card._root._listeners.click || []).length, 1);

    // ITS OWN `entity`: a strip that names a weather entity draws that one,
    // not the one HK Settings chose
    var two = wxHouse(), own = H.make('hk-weather-strip-card');
    own.setConfig({ entity: 'weather.cabin' });
    own.hass = two.set('weather.cabin', 'rainy', { temperature: 51, friendly_name: 'Cabin' });
    H.ok('its own entity is drawn', /51°/.test(own._root.__html) && !/72°/.test(own._root.__html),
         own._root.__html.slice(0, 200));

    var saver = H.make('hk-weather-strip-card');
    H.noThrow('the screensaver config renders', function () {
      saver.setConfig({ type: 'custom:hk-weather-strip-card', variant: 'inline', unit: 'F',
        main_size: '36px', main_letter_spacing: '0.37px', glyph_size: '60px', temp_gap: '36px',
        icon_gap: '12px', color: 'rgba(255,255,255,0.95)', margin: '-4px 0px 0px 20px', layer: true });
      saver.hass = house.hass();
    });
    H.ok('screensaver: inert (no tap), on its own layer',
         /^<hk-plate class="strip" style="margin:-4px 0px 0px 20px;will-change:transform">/.test(saver._root.__html) &&
         !(saver._root._listeners.click || []).length);
    return H.lifecycle('strip', card, house, function (c) { c.hass = house.hass(); });
  },

  function () {
    H.section("hkHeader.now(): the menu's time and weather (modules/hk-menu.js)");
    var house = wxHouse(), v = window.hkHeader.now(house.hass().states);
    H.eq('the Time & Date sensors, 12-hour', v.time + ' ' + v.ampm, '7:05 AM');
    H.eq('a short date for a 300 px menu', v.date, 'Saturday, Sep 26');
    H.eq("the weather entity's temperature, rounded", v.temp, '72\u00b0');
    H.eq('its condition by name', v.condition, 'Sunny');
    H.eq('feels-like', v.feels, 'Feels 73\u00b0');
    H.eq('day or night by sun.sun, for the glyph', v.night, false);
    var day0 = (house.hass().states['sensor.weather_daily_forecast'].attributes.forecast || []).filter(function (x) {
      var t = new Date(x.datetime); return t.getDate() === 26 && t.getMonth() === 8;
    })[0];
    H.ok("today's high and low, from the daily forecast sensor (2026-10-17)",
         !!day0 && v.high === Math.round(day0.temperature) && v.low === Math.round(day0.templow), JSON.stringify([v.high, v.low, day0]));
    H.ok('...and the numbers behind the text', v.tempN === 72 && v.feelsN === 73);
    var none = window.hkHeader.now({});
    H.ok('no Time & Date sensors: this screen\'s own clock, as the header does',
         /^\d{1,2}:\d\d$/.test(none.time) && /^[AP]M$/.test(none.ampm) && /^\w+day, \w{3} \d{1,2}$/.test(none.date),
         JSON.stringify(none));
    H.ok('no weather entity: a placeholder temperature and nothing else, never a throw',
         none.temp === '--\u00b0' && none.condition === '' && none.feels === '' && none.high === null && none.low === null);

    H.section('hk-header-card steps aside when the menu has the time');
    var card = H.make('hk-header-card');
    card.setConfig({ type: 'custom:hk-header-card' });
    var M = window.hkCards.menu, was = M.hasTime;
    M.hasTime = function () { return false; };
    card.hass = house.hass();
    H.ok('drawn as usual', !!card._lastL && /7:05/.test(card._lastL));
    var s0 = card._sigOf();
    M.hasTime = function () { return true; };
    H.ok('the menu having the time is an input to the render gate', card._sigOf() !== s0);
    card.hass = house.hass();
    H.eq('...so the next push redraws, and the header draws nothing of its own', card._lastL, null);
    M.hasTime = function () { return false; };
    card.hass = house.hass();
    H.ok('the menu folds: the header is back', !!card._lastL && /7:05/.test(card._lastL));
    M.hasTime = was;
  },

  // THE EDITORS say what the cards do.
  function () {
    H.section('editors');
    var strip = editorFields('hk-weather-strip-card'), alert = editorFields('hk-alert-card');
    H.ok('strip: shadow is a CSS filter (it goes into filter:)', /CSS filter/.test(strip.shadow.helper) && !/text-shadow/.test(strip.shadow.helper));
    H.eq('alert: only the NWS Alerts integration\'s sensors', alert.entity.selector.entity.filter,
         { integration: 'nws_alerts', domain: 'sensor' });
  }
]);
