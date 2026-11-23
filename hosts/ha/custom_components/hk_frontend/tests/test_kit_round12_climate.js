// ROUND 12's KIT CARDS (2026-11-23; docs/phase34/PLAN.md, hk-kit.js): Thermostat Extra Large (the Large face and its readings, Mode and Fan in one
// plate), Weather at every size (the symbol behind the number, the hours, the days) and Clock (the face; Double Extra Large the clock and the
// calendar). The jsc DOM does not parse markup: each card's html is read as written, and what its keys do through the handlers it binds.
// A fictional house; the clock pinned to a Monday at noon.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run kit_round12');
var FIXED_DAY = [2026, 10, 23];                // (a Monday; new Date() is that day at noon)
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/sample_settings.js');
window.HK_SIDEPANE_NO_WIRE = true;
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-kit.js');
load(HK_ROOT + '/frontend/cards/hk-control.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');
load(HK_ROOT + '/frontend/cards/hk-calendar.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');

var T0 = new Date(2026, 10, 23, 12, 0, 0).getTime();
// the clock at another time for a moment: new Date() says h:m:s of the same day
var RealDate = Date;
function atTime(h, m, s, fn) {
  var F = function () { return arguments.length ? new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))() : new RealDate(2026, 10, 23, h, m, s); };
  F.prototype = RealDate.prototype; F.now = function () { return new RealDate(2026, 10, 23, h, m, s).getTime(); }; F.UTC = RealDate.UTC; F.parse = RealDate.parse;
  Date = F;
  try { return fn(); } finally { Date = RealDate; }
}
var count = function (html, re) { return (html.match(re) || []).length; };
function html(card) { return card._root.__html || ''; }
// the block's size in design px, as the grid's cells make it
var DIMS = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405], XXL: [1241, 405] };
function sized(card, sz) { card.setAttribute('size', sz); card._block = function () { return { w: DIMS[sz][0], h: DIMS[sz][1] }; }; return card; }

// ---------------------------------------------------------------- the thermostat, Extra Large
function thermo(state, attrs, cfg) {
  var C = customElements.get('hk-control-card'), c = new C(), html0 = '', hs;
  c.setConfig(Object.assign({ type: 'custom:hk-control-card', entity: 'climate.den', weather: 'weather.home' }, cfg || {}));
  sized(c, 'XL');
  Object.defineProperty(c.shadowRoot, 'innerHTML', { get: function () { return html0; }, set: function (v) { html0 = String(v); } });
  hs = H.house({ 'climate.den': [state, Object.assign({ friendly_name: 'Den', min_temp: 50, max_temp: 90, current_temperature: 66, current_humidity: 41,
    hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], fan_modes: ['auto', 'on'], fan_mode: 'auto', temperature: 70, hvac_action: 'heating' }, attrs)],
    'weather.home': ['partlycloudy', { temperature: 60 }] });
  c.hass = hs.hass();
  c.hs = hs; c.html = function () { return html0.split('</style>').pop() || ''; };
  return c;
}
// the handlers the card binds on a root, by selector, each given a fake button
function binds(card, sel, data) {
  var fired = [], b = { dataset: data, onclick: null };
  card._bindKit({ querySelectorAll: function (s) { return s === sel ? [b] : []; } });
  b.onclick({ stopPropagation: function () {} });
  return b;
}

H.run('ROUND 12 KIT CARDS', [
  function () {
    H.section('Thermostat, Extra Large: the Large face and its readings in one plate');
    var c = thermo('heat', {}), s = c.html();
    H.ok('one lit plate, a hairline at 405', /class="kit lit/.test(s) && /left:405px;top:18px;width:1px;height:369px/.test(s), s.slice(0, 300));
    H.ok('...Inside, Humidity and Outside as rows, the value over its name', />66°<\/p>|66°/.test(s) && /Inside/.test(s) && /41%/.test(s) && /Humidity/.test(s) && /60°/.test(s) && /Outside/.test(s),
      s);
    H.ok('...Outside is the weather entity\'s', />60°</.test(s));
    H.ok('...Mode and Fan as 64 px keys at the foot, the mode named', /data-xl-pick="mode"[^>]*>[\s\S]*Heat/.test(s) && /data-xl-pick="fan"[^>]*>[\s\S]*Fan Auto/.test(s) &&
      count(s, /class="key"[^>]*height:64px/g) === 2, s);
    H.ok('...the Large face is still there (the steppers)', /data-big-step="-1"/.test(s) && /data-big-step="1"/.test(s));
    H.ok('...no fan modes: no Fan key', !/data-xl-pick="fan"/.test(thermo('heat', { fan_modes: undefined, fan_mode: undefined }).html()));
    H.ok('...no humidity: no row for it', !/Humidity/.test(thermo('heat', { current_humidity: null }).html()));
    H.ok('...idle is glass, not lit', !/class="kit lit/.test(thermo('heat_cool', { target_temp_low: 65, target_temp_high: 74, hvac_action: 'idle' }).html()));
    var o = thermo('heat', {}, { weather: undefined }).html();
    H.ok('...no weather entity: no Outside row', !/Outside/.test(o));
  },
  function () {
    H.section('...Mode and Fan open their choices in the column, a choice sets it');
    var c = thermo('heat', {}), h = c.html();
    var b = binds(c, '[data-xl-pick]', { xlPick: 'mode' });
    var s = c.html();
    H.ok('Mode: a row to go back, one row for each mode, Heat checked', /data-xl-pick=""/.test(s) && /data-xl-mode="heat"/.test(s) && /data-xl-mode="cool"/.test(s) &&
      /data-xl-mode="heat_cool"/.test(s) && /data-xl-mode="off"/.test(s) && !/data-xl-pick="mode"/.test(s) && /M5 12\.5l4\.5 4\.5L19 7\.5/.test(s), s);
    H.ok('...Heat / Cool / Auto / Off in the column\'s words', /Auto/.test(s) && /Cool/.test(s) && /Off/.test(s));
    binds(c, '[data-xl-mode]', { xlMode: 'cool' });
    H.eq('...a choice sets the mode', c.hs.calls.map(function (x) { return [x.domain, x.service, x.data]; }),
      [['climate', 'set_hvac_mode', { entity_id: 'climate.den', hvac_mode: 'cool' }]]);
    H.ok('...and the column is back', /data-xl-pick="mode"/.test(c.html()));
    binds(c, '[data-xl-pick]', { xlPick: 'fan' });
    var f = c.html();
    H.ok('Fan: its own choices', /data-xl-fan="auto"/.test(f) && /data-xl-fan="on"/.test(f), f);
    binds(c, '[data-xl-fan]', { xlFan: 'on' });
    H.eq('...a choice sets it', c.hs.calls.slice(1).map(function (x) { return [x.domain, x.service, x.data]; }),
      [['climate', 'set_fan_mode', { entity_id: 'climate.den', fan_mode: 'on' }]]);
    binds(c, '[data-xl-pick]', { xlPick: 'mode' });
    binds(c, '[data-xl-pick]', { xlPick: '' });
    H.ok('...the first row goes back', /data-xl-pick="mode"/.test(c.html()));
  },
  function () {
    H.section('the catalog: Extra Large is the same card whatever the style, its weather entity beside it');
    var cfg = window.hkGridCatalog.config({ card: 'thermostat', size: 'XL', opts: { entity: 'climate.den' } }, { weather: 'weather.home' });
    H.eq('XL', cfg, { type: 'custom:hk-control-card', entity: 'climate.den', weather: 'weather.home' });
    H.eq('...Large is not given it', window.hkGridCatalog.config({ card: 'thermostat', size: 'L', opts: { entity: 'climate.den' } }, { weather: 'weather.home' }),
      { type: 'custom:hk-control-card', entity: 'climate.den' });
  }
].concat((function () {
  // ---------------------------------------------------------------- the weather block
  function hourly(n) { var o = []; for (var i = 0; i < n; i++) o.push({ datetime: new Date(T0 + i * 3600e3).toISOString(), condition: i % 2 ? 'cloudy' : 'sunny', temperature: 60 + i }); return o; }
  function daily(n) { var o = []; for (var i = 0; i < n; i++) o.push({ datetime: new Date(T0 + i * 864e5).toISOString(), condition: 'sunny', temperature: 70 - i, templow: 50 + i }); return o; }
  function wx(sz, cfg) {
    var s = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
    s.weather.place = 'Riverside';
    window.hkSettings._apply(s);
    var c = H.make('hk-weather-band-card');
    c.setConfig(Object.assign({ type: 'custom:hk-weather-band-card', section: 'hero', entity: 'weather.openweathermap' }, cfg || {}));
    sized(c, sz);
    c.hass = H.house({
      'weather.openweathermap': ['partlycloudy', { temperature: 64, humidity: 52, temperature_unit: '°F' }],
      'sensor.weather_hourly_forecast': ['24', { forecast: hourly(24) }], 'sensor.weather_daily_forecast': ['8', { forecast: daily(8) }],
      'sun.sun': ['above_horizon', { next_setting: '2026-11-23T22:37:00Z', next_rising: '2026-11-24T11:10:00Z', elevation: 30 }]
    }).hass();
    return html(c);
  }
  return [function () {
    H.section('Weather, every size, from the kit');
    var s = wx('S');
    H.ok('Small: centered, the symbol behind the number at half strength, the condition and H / L under', /opacity:\.5/.test(s) && /justify-content:center/.test(s) &&
      />64°</.test(s) && /Partly Cloudy/.test(s) && /H 70°/.test(s) && !/Now/.test(s), s.slice(0, 600));
    var w = wx('W');
    H.ok('Wide: the place, the number, three hours, the symbol tucked behind the end of the number', /Riverside/.test(w) && count(w, /class="a kl"/g) === 3 && /Now/.test(w) &&
      /fill-opacity|hk-wx/.test(w), w.slice(0, 500));
    var t = wx('T');
    H.ok('Tall: six hours in two rows', count(t, /class="a kl"/g) === 6, count(t, /class="a kl"/g));
    var l = wx('L');
    H.ok('Large: five hours, a hairline above and below them, two days as rows with their range bars', count(l, /class="a kl"/g) === 5 && count(l, /class="a trk"/g) === 2 &&
      /Riverside/.test(l) && count(l, /class="a sep"/g) >= 3, l.slice(0, 400));
    var xl = wx('XL');
    H.ok('Extra Large: eight hours, the days', count(xl, /class="a kl"/g) === 8 && count(xl, /class="a trk"/g) === 2);
    H.ok('...a day\'s row: its low, the bar, its high (tomorrow 51° to 69°)', />51°</.test(xl) && />69°</.test(xl));
    // (no glyphs file in this suite: the stand-in icon is drawn, whose one color cannot be dimmed by layer; the layered symbol is looked at in the twin)
    H.ok('a symbol is drawn behind the number on Wide', /<hk-icon class="hk-wx"|<svg class="hk-wx"/.test(w));
    H.ok('Big Temperature keeps its own drawing', /class="wb big/.test(H.morphed((function () {
      var c = H.make('hk-weather-band-card'); c.setConfig({ type: 'custom:hk-weather-band-card', section: 'hero', entity: 'weather.openweathermap', big: true }); sized(c, 'S');
      c.hass = H.house({ 'weather.openweathermap': ['partlycloudy', { temperature: 64 }] }).hass(); return c._root; })())) );
    var sky = wx('S', { sky: true });
    H.ok('a sky: its element behind the face, the block\'s white words', /<hk-grid-weather-sky/.test(sky) && /--hk-ink:#fff/.test(sky), sky.slice(0, 300));
  }];
})()).concat((function () {
  // ---------------------------------------------------------------- the clock
  var SET = { motion: true, anim: true };
  window.hkSettings.rendering = function () { return { motion: SET.motion, flat: false, theme: 'dark' }; };
  window.hkSettings.skyLook = function () { return { animations: SET.anim }; };
  function clock(sz, cfg) {
    var c = H.make('hk-grid-clock-card');
    sized(c, sz);                              // (the view sets the size as it places the card; a card with none is the older drawing)
    c.setConfig(Object.assign({ type: 'custom:hk-grid-clock-card', clock_style: 'numbers' }, cfg || {}));
    c.isConnected = true;
    var hs = H.house({ 'calendar.family': ['off', { friendly_name: 'Family', supported_features: 7 }] });
    c.hass = hs.hass();
    c.hs = hs;
    return c;
  }
  // whether the kit takes a clock of this style at this size (no host: nothing is drawn)
  function probe(sz, cfg) {
    var c = H.make('hk-grid-clock-card');
    c._config = Object.assign({ type: 'custom:hk-grid-clock-card', clock_style: 'numbers' }, cfg);
    sized(c, sz);
    return c._kitOn();
  }
  return [function () {
    H.section('Clock: the face, and the time and date beside it');
    var c = clock('S'), s = html(c);
    H.ok('Small: the face alone -- twelve numerals, the hands, a second hand and its hub', count(s, /<text /g) === 12 && /class="hh"/.test(s) && /class="mh"/.test(s) && /class="sh"/.test(s) &&
      !/class="a kh"/.test(s), s.slice(0, 200));
    var w = html(clock('W'));
    H.ok('Wide: the time as the hero, the weekday and the date', /class="a kh"/.test(w) && /Monday/.test(w) && /November 23/.test(w) && /AM|PM/.test(w), w.slice(0, 200));
    var t = html(clock('T'));
    H.ok('Tall: the time and the short date under the face', /class="a kh"/.test(t) && /Monday, Nov 23/.test(t));
    H.ok('Large: the face only, bigger', count(html(clock('L')), /<text /g) === 12 && /width="379"/.test(html(clock('L'))));
    H.ok('Extra Large: the face beside the reading', /class="a kh"/.test(html(clock('XL'))) && /class="ckf"|class="a ckf"/.test(html(clock('XL'))));
    var at = atTime(14, 7, 30, function () { return html(clock('S')); });
    H.ok('the hands are the house\'s time: 2:07:30 is 63.5 degrees on the hour hand, 45 on the minute\'s, 180 on the second\'s',
      /class="hh" style="transform:rotate\(63\.5deg\)/.test(at) && /class="mh" style="transform:rotate\(45deg\)/.test(at) && /class="sh" style="transform:rotate\(180deg\)/.test(at),
        at.slice(at.indexOf('class="hh"') - 20, at.indexOf('class="hh"') + 400));
    H.ok('...and the time is 2:07 PM', /2:07/.test(atTime(14, 7, 30, function () { return html(clock('W')); })) && /PM/.test(atTime(14, 7, 30, function () { return html(clock('W')); })));
    H.ok('Digital and the screensaver\'s faces keep their drawing below Double Extra Large (the kit does not take them)', !probe('W', { clock_style: '' }) &&
      !probe('L', { clock_style: 'classic' }) && probe('XXL', { clock_style: '' }) && !probe('XXL', { clock_style: 'classic' }) && probe('XL', {}) && !probe('XL', { bare: true }));
  }, function () {
    H.section('the second hand obeys Motion and the Background\'s Animations');
    SET.motion = false;
    H.ok('Motion off: no second hand, the hub stays', !/class="sh"/.test(html(clock('L'))) && /<circle/.test(html(clock('L'))));
    SET.motion = true; SET.anim = false;
    H.ok('Animations off: none either', !/class="sh"/.test(html(clock('L'))));
    SET.anim = true;
    H.ok('both on: it is drawn', /class="sh"/.test(html(clock('L'))));
    var t0 = H.timers(), c = clock('S');
    c._kitStep();
    H.ok('a card on the page waits for one timer (the next second), not a loop of frames', H.timers() - t0 === 1, H.timers() - t0);
    SET.motion = false;
    c._kitStep();
    H.ok('Motion switched off: it is drawn again without the hand, and waits a minute', !/class="sh"/.test(html(c)) && H.timers() - t0 === 1);
    c.disconnectedCallback();
    H.ok('a card that leaves the page keeps no timer', H.timers() === t0, H.timers() - t0);
    SET.motion = true;
  }, function () {
    H.section('Double Extra Large: the clock and the calendar');
    var c = clock('XXL'), s0 = html(c);
    H.ok('the face, the time, the weekday and the date with its year before any event has come', /class="a kh"/.test(s0) && /November 23, 2026/.test(s0) && /November/.test(s0), s0.slice(0, 100));
    H.ok('...the month: 30 days, today in a red circle', count(s0, /class="a fc num"/g) === 30 && /background:#ff3b30/.test(s0));
    var y = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var TODAY = new Date(2026, 10, 23), U = window.hkCalendar._;
    var ev = function (uid, title, d, h, m) { return { uid: uid, summary: title, start: { dateTime: U.isoLocal(new Date(2026, 10, d, h, m || 0)) },
      end: { dateTime: U.isoLocal(new Date(2026, 10, d, h + 1, m || 0)) } }; };
    return H.tick(4).then(function () {
      U.store.got = {}; U.store.live = {};
      var d = clock('XXL');
      return H.tick(6).then(function () {
        d.hs.api.forEach(function (r) { r.resolve([ev('p', 'Piano Lesson', 23, 14), ev('d', 'Dinner Out', 23, 18, 30), ev('t', 'Dentist', 24, 9), ev('o', 'Gone', 23, 8)]); });
        return H.tick(8).then(function () { return d; });
      });
    }).then(function (d) {
      var s = html(d);
      H.ok('the events still to come as rows, the past one left out', /Piano Lesson/.test(s) && /Dinner Out/.test(s) && /Dentist/.test(s) && !/Gone/.test(s), s.slice(-600));
      H.ok('...their times short: 2 PM, 6:30 PM, Tomorrow 9 AM', /2 PM/.test(s) && /6:30 PM/.test(s) && /Tomorrow, 9 AM/.test(s), s.slice(-700));
      H.ok('...the title says Today', /Today/.test(s));
      H.ok('...a dot under the days with events: today\'s and tomorrow\'s', count(s, /border-radius:calc\(5px \/ 2\)/g) === 2, count(s, /border-radius:calc\(5px \/ 2\)/g));
      H.ok('...the calendar asked for the month\'s weeks and the week ahead, once', d.hs.api.length === 1 && /^calendars\/calendar\.family\?start=2026-11-01/.test(d.hs.api[0].path), d.hs.api[0] &&
        d.hs.api[0].path);
      H.ok('...a tap on the month or an event goes to that day on the Calendar page', /data-day="2026-11-23"/.test(s) && /data-day="2026-11-24"/.test(s));
      var dg = html(clock('XXL', { clock_style: '' }));
      H.ok('Digital at Double Extra Large: the time itself in the face\'s place, the same month', /class="a kh"/.test(dg) && count(dg, /<text /g) === 0 && count(dg, /class="a fc num"/g) === 30);
    });
  }];
})()));
