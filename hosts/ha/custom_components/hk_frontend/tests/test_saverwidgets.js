// The screensaver's lock-screen widgets (modules/hk-saverwidgets.js; docs/phase12/SCREENSAVER-EDITOR.md, C1): the
// circular, rectangular, inline and band widgets of the layout's catalog, drawn from a house's real data -- the
// weather now and its forecasts, the sun, timers, locks, the house battery and the Energy page's sums, the calendar,
// Home Status -- drawn again only when what they say changes, and sized from `u`.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');
load(HK_ROOT + '/frontend/modules/hk-saverlayout.js');
load(HK_ROOT + '/frontend/modules/hk-saverwidgets.js');
// (the glance groups' files: every piece the catalog lists is drawn by the renderer or one of them, phase 1b)
window.hkSaverLayout.FILES.forEach(function (f) { load(HK_ROOT + '/frontend/modules/hk-saverpieces-' + f + '.js'); });
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
var SW = window.hkSaverWidgets, WL = window.hkSaverLayout;

// a fictional house: Fernhill. Sunday 1 November 2026, 10:57 in the morning
var NOW = new Date(2026, 10, 1, 10, 57, 0);
var NIGHT = new Date(2026, 10, 1, 22, 0, 0);
var states = function (over) {
  var s = {
    'weather.home': { entity_id: 'weather.home', state: 'partlycloudy', attributes: { temperature: 64, temperature_unit: '°F', humidity: 52, wind_speed: 6, wind_speed_unit: 'mph' } },
    'sensor.air_quality': { entity_id: 'sensor.air_quality', state: '33', attributes: { device_class: 'aqi' } },
    'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { next_setting: '2026-11-01T17:52:00', next_rising: '2026-11-02T06:48:00' } },
    'sensor.running_quick_timers': { entity_id: 'sensor.running_quick_timers', state: '2', attributes: { running: [
      { entity_id: 'timer.quick_laundry', name: 'Laundry Load', finishes_at: '2026-11-01T11:40:00' },
      { entity_id: 'timer.quick_pasta', name: 'Pasta', finishes_at: '2026-11-01T11:01:12' }] } },
    'timer.quick_pasta': { entity_id: 'timer.quick_pasta', state: 'active', attributes: { duration: '0:10:00', finishes_at: '2026-11-01T11:01:12' } },
    'lock.front_door': { entity_id: 'lock.front_door', state: 'locked', attributes: {} },
    'lock.garage_entry': { entity_id: 'lock.garage_entry', state: 'unlocked', attributes: {} },
    'climate.hall': { entity_id: 'climate.hall', state: 'heat', attributes: { current_temperature: 71 } },
    'climate.den': { entity_id: 'climate.den', state: 'heat', attributes: { current_temperature: 73 } },
    'sensor.house_battery_charge': { entity_id: 'sensor.house_battery_charge', state: '84', attributes: { device_class: 'battery' } },
    'sensor.solar_power': { entity_id: 'sensor.solar_power', state: '2400', attributes: { device_class: 'power', unit_of_measurement: 'W' } },
    'calendar.family': { entity_id: 'calendar.family', state: 'off', attributes: { friendly_name: 'Family' } },
    'alarm_control_panel.house': { entity_id: 'alarm_control_panel.house', state: 'disarmed', attributes: {} }
  };
  Object.keys(over || {}).forEach(function (k) { if (over[k] === null) delete s[k]; else s[k] = over[k]; });
  return s;
};
var client = function (over, port) { return { states: states(over), config: { location_name: 'Fernhill', unit_system: { temperature: '°F' } }, subscriptions: port }; };
// Status & Chips' lists, as hkSettings gives them
var SETTINGS = { 'security.alarm': 'alarm_control_panel.house', 'kinds.locks': ['lock.front_door', 'lock.garage_entry'] };
window.hkSettings = { get: function (k, d) { return k in SETTINGS ? SETTINGS[k] : d; } };
var EVENT = { title: 'Piano Lesson', loc: '', cal: 'calendar.family', allDay: false, start: new Date(2026, 10, 1, 15, 30), end: new Date(2026, 10, 1, 16, 30) };
var CTX = { events: [EVENT], title: 'Lake Weekend · 2024' };

// the energy page's sums, as hk-energy.js summary() gives them
var energyCalls = 0, wakers = [], battery = 84;
window.hkEnergy = {
  summary: function (c, waker) { if (!c || !Object.keys(c.states || {}).length) return null; energyCalls++; wakers.push(waker); return { battery: battery, today: { energy: 12.4, solar: 9.8 }, rings: [{ key: 'energy' }, { key: 'solar' }] }; },
  kwh: function (v) { return (Math.round(v * 10) / 10).toFixed(1); }
};

// a widget with its markup recorded (the shim's innerHTML keeps nothing)
function spy(w) {
  var log = [];
  Object.defineProperty(w.el, 'innerHTML', { configurable: true, get: function () { return log[log.length - 1] || ''; }, set: function (v) { log.push(String(v)); } });
  w.log = log;
  return w;
}
function make(id, o) { return spy(SW.create(id, o || { u: 8 })); }
function html(id, c, now, o, ctx) { var w = make(id, o); w.update(c || client(), now || NOW, ctx || CTX); var h = w.html = w.el.innerHTML; w.destroy(); return h; }
// the words in some markup
function words(h) { return h.replace(/<[^>]*>/g, '|').split('|').filter(function (t) { return t.trim(); }).join(' '); }

print('=== what this file draws ===');
var CATALOG = WL.CATALOG;
// (v2, phase 13: the catalog is pieces in shapes, `piece.shape`; the renderer draws every one, cards and bands too)
var drawn = [];
Object.keys(SW.PIECES).forEach(function (p) { Object.keys(SW.PIECES[p].shapes).forEach(function (sh) { drawn.push(p + '.' + sh); }); });
ok('every piece in every shape of the layout\'s catalog is one the renderer draws, and no other', drawn.slice().sort(), Object.keys(CATALOG).sort());
ok('...each in the shape the catalog says', Object.keys(CATALOG).filter(function (id) { return id.split('.')[1] !== CATALOG[id][0]; }), []);
ok('...and the first layouts\' widgets still draw (v1 ids)', SW.IDS.filter(function (id) { var c = SW.create(id, { u: 8 }); if (c) c.destroy(); return !c; }), []);
// (phase 13: the cards and the forecast band are pieces too, in their Card and Band shapes -- the renderer's, never HK's cards)
ok('...the cards and the forecast band are pieces now, drawn here', [SW.has('time', 'card'), SW.has('weather', 'band'), (function () { var c = SW.create('music_card', { u: 8 }); if (c) c.destroy(); return !!c && c.piece === 'music' && c.shape === 'card'; })()], [true, true, true]);

print('=== every widget draws, in a full house and an empty one ===');
var full = client(), empty = { states: {}, config: {} };
SW.IDS.forEach(function (id) {
  var h, e;
  try { h = html(id, full, NOW, { u: 8 }, CTX); } catch (x) { h = 'THREW ' + x.message; }
  try { e = html(id, empty, NOW, { u: 8 }, {}); } catch (x) { e = 'THREW ' + x.message; }
  ok(id + ': drawn in a full house, and in an empty one', [h.length > 20 && h.indexOf('THREW') !== 0, e.length > 20 && e.indexOf('THREW') !== 0], [true, true]);
});
// (the date, and Home Status where the house has nothing to say, are words and not data)
var dashed = SW.IDS.filter(function (id) { return ['date', 'status_line', 'home_status'].indexOf(id) < 0; });
ok('an empty house: a dash for everything that needs data', dashed.filter(function (id) { return html(id, empty, NOW, { u: 8 }, {}).indexOf('—') < 0; }), []);
ok('...Home Status, with an alarm and locks named that say nothing, says so: missing is not safe', [words(html('date', empty, NOW)), words(html('status_line', empty)), words(html('home_status', empty))],
   ['Sunday, November 1', '3 Sensors Unknown', 'Home 3 Sensors Unknown']);
var HS0 = window.hkSettings; window.hkSettings = null;
ok('...a house with none named has nothing to say: all clear', [words(html('status_line', empty)), words(html('home_status', empty))], ['All Clear', 'Home All Clear']);
window.hkSettings = HS0;
var none = make('temp'); none.update(null, NOW);
ok('no client at all: the same as an empty house', words(none.el.innerHTML), words(html('temp', empty)));

print('=== the key texts ===');
var subs = [];
var port = { subscribeMessage: function (cb, msg) { subs.push({ cb: cb, msg: msg }); return Promise.resolve(function () {}); } };
var t = make('temp', { u: 8 });
t.update(client({}, port), NOW);
ok('the temperature: 64°, and no range until the day\'s forecast is in', [words(t.el.innerHTML), t.el.innerHTML.indexOf('stroke-dasharray') >= 0], ['64°', true]);
ok('...it asks for the daily forecast of the house\'s weather', subs.map(function (s) { return s.msg.forecast_type + ' ' + s.msg.entity_id; }), ['daily weather.home']);
var before = t.log.length;
subs[0].cb({ forecast: [{ datetime: '2026-11-01T00:00:00', temperature: 72, templow: 55, condition: 'sunny' }] });
ok('...the forecast arriving draws it again by itself: 64°, the low and the high', [t.log.length - before, words(t.el.innerHTML)], [1, '64° 55 72']);
var c = 2 * Math.PI * 43 * 0.75, frac = Math.round((64 - 55) / (72 - 55) * 200) / 200;
ok('...the arc is how far 64° is from the low to the high', t.el.innerHTML.indexOf('stroke-dasharray="' + (c * frac).toFixed(2) + ' ') >= 0, true);
ok('...and a gauge (open at the bottom), not a whole ring', t.el.innerHTML.indexOf('rotate(135 50 50)') >= 0, true);
t.destroy();
ok('AQI: the number on its scale of 300', [words(html('aqi')), html('aqi').indexOf('stroke-dasharray="' + (c * 0.11).toFixed(2) + ' ') >= 0], ['33 AQI', true]);
ok('humidity, outside', words(html('humidity')), '52% HUM');
ok('inside: the mean of the thermostats', words(html('inside')), '72° IN');
SETTINGS['features.temperature'] = 'sensor.hall_temperature';
ok('...the sensor Status & Chips names, where it is there', words(html('inside', client({ 'sensor.hall_temperature': { state: '68.4', attributes: {} } }))), '68° IN');
delete SETTINGS['features.temperature'];
ok('the house battery, from the Energy page\'s sums', words(html('battery')), '84% HOME');
var energyWas = window.hkEnergy; window.hkEnergy = null;
ok('...else the side pane\'s scan for a battery sensor', words(html('battery')), '84% HOME');
window.hkEnergy = energyWas;
ok('solar: kW from watts', words(html('solar')), '2.4 kW');
ok('...and from kW', words(html('solar', client({ 'sensor.solar_power': { state: '6.25', attributes: { device_class: 'power', unit_of_measurement: 'kW' } } }))), '6.3 kW');
ok('the timer ending soonest: its time left and name', words(html('timer')), '4:12 PASTA');
var tmr = html('timer');
ok('...a ring of the time left of ten minutes', tmr.indexOf('stroke-dasharray="' + (2 * Math.PI * 43 * Math.round(252 / 600 * 500) / 500).toFixed(2) + ' ') >= 0, true);
ok('...an hour and more: hours too; none running: a dash', [words(html('timer', client({ 'sensor.running_quick_timers': { state: '1', attributes: { running: [{ name: 'Roast', finishes_at: '2026-11-01T12:12:03' }] } } }))),
   words(html('timer', client({ 'sensor.running_quick_timers': null })))], ['1:15:03 ROAST', '— TIMER']);
ok('locks: one unlocked', words(html('locks')), '1 Unlocked');
ok('...all locked', words(html('locks', client({ 'lock.garage_entry': { state: 'locked', attributes: {} } }))), 'Locked');
ok('...an unlocked lock is an open one', [html('locks').indexOf('M8 10V7a4 4 0 0 1 7.6-1.7') >= 0, html('locks', client({ 'lock.garage_entry': { state: 'locked', attributes: {} } })).indexOf('M8 10V7a4 4 0 0 1 8 0v3') >= 0], [true, true]);
ok('...locks that don\'t answer count for nothing', words(html('locks', client({ 'lock.front_door': { state: 'unavailable', attributes: {} }, 'lock.garage_entry': { state: 'unavailable', attributes: {} } }))), '—');
ok('the sunset by day: 5:52, and in 24-hour time', [words(html('sunset')), words(html('sunset', client(), NOW, { u: 8, h24: true }))], ['5:52 SUNSET', '17:52 SUNSET']);
var dark = client({ 'sun.sun': { state: 'below_horizon', attributes: { next_setting: '2026-11-02T17:51:00', next_rising: '2026-11-02T06:48:00' } } });
ok('...after dark the sunrise comes first', words(html('sunset', dark, NIGHT)), '6:48 SUNRISE');
ok('...the ring: how far through the day', html('sunset').indexOf('stroke-dasharray="' + (2 * Math.PI * 43 * Math.round((NOW - new Date(2026, 10, 1, 6, 48)) / (new Date(2026, 10, 1, 17, 52) - new Date(2026, 10, 1, 6, 48)) * 200) / 200).toFixed(2) + ' ') >= 0, true);

print('=== the rectangles ===');
ok('Up Next: when, what, where (the calendar\'s name)', words(html('next_event')), 'Up Next · 3:30 PM Piano Lesson Family');
ok('...its location where it has one; in 24-hour time', [words(html('next_event', client(), NOW, { u: 8 }, { events: [Object.assign({}, EVENT, { loc: 'Music School' })] })),
   words(html('next_event', client(), NOW, { u: 8, h24: true }, CTX))], ['Up Next · 3:30 PM Piano Lesson Music School', 'Up Next · 15:30 Piano Lesson Family']);
ok('...one under way is now, until; tomorrow\'s says so; nothing is a dash', [
   words(html('next_event', client(), new Date(2026, 10, 1, 16, 0), { u: 8 }, CTX)),
   words(html('next_event', client(), NOW, { u: 8 }, { events: [Object.assign({}, EVENT, { start: new Date(2026, 10, 2, 9, 15), end: new Date(2026, 10, 2, 10, 0) })] })),
   words(html('next_event', client(), NOW, { u: 8 }, { events: [] }))],
   ['Now · until 4:30 PM Piano Lesson Family', 'Up Next · Tomorrow, 9:15 AM Piano Lesson Family', 'Up Next —']);
// (the rectangle shows the next two now: an all-day event still waits for a timed one, second)
ok('...an all-day event waits for a timed one', words(html('next_event', client(), NOW, { u: 8 }, { events: [{ title: 'Trash Day', cal: 'calendar.family', allDay: true, start: new Date(2026, 10, 1), end: new Date(2026, 10, 2) }, EVENT] })), 'Piano Lesson 3:30 PM · Family Trash Day All Day · Family');
ok('Home Status: the alarm, and what is wrong', words(html('home_status')), 'Home Disarmed 1 Lock Unlocked');
SETTINGS['security.alarm'] = 'alarm_control_panel.house';
var armed = client({ 'alarm_control_panel.house': { state: 'armed_away', attributes: {} }, 'lock.garage_entry': { state: 'locked', attributes: {} } });
ok('...secured, and how it is armed', words(html('home_status', armed)), 'Home Secured Armed Away');
ok('Energy Today: used and made, from the Energy page\'s sums', words(html('energy_today')), 'Energy Today 12.4 kWh used 9.8 kWh made');
var hport = { subscribeMessage: function (cb, msg) { subs.push({ cb: cb, msg: msg }); return Promise.resolve(function () {}); } };
subs.length = 0;
var nh = make('next_hours', { u: 8 });
nh.update(client({}, hport), NOW);
ok('Next Hours: now, then two blank hours until the hourly forecast is in', words(nh.el.innerHTML), 'Now 64° 11 AM — 12 PM —');
ok('...it asks for the hourly forecast', subs.map(function (s) { return s.msg.forecast_type; }), ['hourly']);
subs[0].cb({ forecast: [
  { datetime: '2026-11-01T10:00:00', temperature: 63, condition: 'cloudy' }, { datetime: '2026-11-01T11:00:00', temperature: 66, condition: 'cloudy' },
  { datetime: '2026-11-01T12:00:00', temperature: 68.4, condition: 'sunny' }, { datetime: '2026-11-01T13:00:00', temperature: 70, condition: 'sunny' }] });
ok('...the next three hours: time, glyph, temperature', words(nh.el.innerHTML), 'Now 64° 11 AM 66° 12 PM 68°');
ok('...each with a glyph of its condition (the current one partly cloudy, then cloud, then sun)', [nh.el.innerHTML.split('<svg').length - 1, nh.el.innerHTML.indexOf('<circle cx="8.2"') >= 0, nh.el.innerHTML.indexOf('<circle cx="12" cy="12" r="4.4"') >= 0], [3, true, true]);
nh.destroy();
ok('...in 24-hour time', words(html('next_hours', client(), NOW, { u: 8, h24: true })), 'Now 64° 11:00 — 12:00 —');

print('=== the inline widgets ===');
ok('the date', words(html('date')), 'Sunday, November 1');
ok('...the weather: its glyph, the temperature and the condition', [words(html('weather_line')), html('weather_line').indexOf('<svg') >= 0], ['64° Partly Cloudy', true]);
ok('...at night the moon', html('weather_line', client({ 'weather.home': { state: 'clear-night', attributes: { temperature: 51, temperature_unit: '°F' } }, 'sun.sun': { state: 'below_horizon', attributes: { next_setting: '2026-11-02T17:51:00', next_rising: '2026-11-02T06:48:00' } } }), NIGHT).indexOf('M20 14.6A8.6') >= 0, true);
ok('...Home Status in a line, as the card says it', words(html('status_line')), 'Disarmed · 1 Lock Unlocked');
ok('...and secured', words(html('status_line', armed)), 'Home Secured');
ok('...the next event; in 24-hour time', [words(html('event_line')), words(html('event_line', client(), NOW, { u: 8, h24: true }))], ['Piano Lesson · 3:30 PM', 'Piano Lesson · 15:30']);
ok('...the photo\'s title, as the caller gives it; none given a dash; none to give nothing', [words(html('photo_title', client(), NOW, { u: 8 }, { title: 'Lake Weekend · 2024' })),
   words(html('photo_title', client(), NOW, { u: 8 }, {})), words(html('photo_title', client(), NOW, { u: 8 }, { title: '' }))], ['Lake Weekend · 2024', '—', '']);
var hdr = window.hkHeader; window.hkHeader = null;
ok('...Home Status without the header: a dash', words(html('status_line')), '—');
window.hkHeader = hdr;

print('=== the readings band ===');
ok('Sunset, Wind, Humidity and AQI, each figure over its label', words(html('readings')), '5:52 PM Sunset 6 mph Wind 52% Humidity 33 AQI');
ok('...only the ones the house has', words(html('readings', client({ 'sensor.air_quality': null }))), '5:52 PM Sunset 6 mph Wind 52% Humidity');
ok('...after dark the sunrise; 24-hour', [words(html('readings', dark, NIGHT)), words(html('readings', client(), NOW, { u: 8, h24: true }))],
   ['6:48 AM Sunrise 6 mph Wind 52% Humidity 33 AQI', '17:52 Sunset 6 mph Wind 52% Humidity 33 AQI']);

print('=== drawn again only when the words change ===');
var w = make('temp', { u: 8 });
var cl = client();
ok('the first update draws', w.update(cl, NOW), true);
var node = w.el;
ok('...the same house a minute on: nothing drawn, the same node', [w.update(cl, new Date(+NOW + 60000)), w.log.length, w.el === node], [false, 1, true]);
cl.states['weather.home'] = Object.assign({}, cl.states['weather.home'], { attributes: Object.assign({}, cl.states['weather.home'].attributes, { temperature: 65 }) });
ok('...a degree warmer: drawn', [w.update(cl, NOW), w.log.length, words(w.el.innerHTML)], [true, 2, '65°']);
ok('...a different reading nobody sees (the wind): not drawn', (function () {
  cl.states['weather.home'] = Object.assign({}, cl.states['weather.home'], { attributes: Object.assign({}, cl.states['weather.home'].attributes, { wind_speed: 9 }) });
  return [w.update(cl, NOW), w.log.length];
})(), [false, 2]);
var d = make('date', { u: 8 });
d.update(cl, NOW); d.update(cl, new Date(2026, 10, 1, 23, 59));
ok('the date: not again within the day, again at midnight', [d.log.length, d.update(cl, new Date(2026, 10, 2, 0, 1)), d.log.length], [1, true, 2]);
var tw = make('timer', { u: 8 });
tw.update(cl, NOW);
ok('a running timer is live, and draws again as its time runs down', [tw.live, tw.update(cl, new Date(+NOW + 1000)), words(tw.el.innerHTML)], [true, true, '4:11 PASTA']);
tw.update(cl, new Date(2026, 10, 1, 11, 2, 0));
ok('...at the end, 0:00 and no longer live', [words(tw.el.innerHTML), tw.live], ['0:00 PASTA', false]);
ok('a widget that isn\'t live never says so', [w.live, d.live], [false, false]);
var eg = make('battery', { u: 8 });
energyCalls = 0; wakers.length = 0;
var realNow = Date.now, clock = realNow();
Date.now = function () { return clock; };
eg.update(cl, NOW); eg.update(cl, new Date(+NOW + 60000));
ok('the Energy page\'s sums are read once for a while, not at every update', energyCalls, 1);
battery = 79;
__resetTimers();
wakers[0].requestUpdate(); wakers[0].requestUpdate();
ok('...a wake reads again a moment later, never from inside the read: one timer, no read yet', [energyCalls, __timerCount()], [1, 1]);
clock += 1000; __runTimers(); __resetTimers();
ok('...and when the statistics arrive, read again and drawn (by itself)', [energyCalls, words(eg.el.innerHTML), eg.log.length], [2, '79% HOME', 2]);
ok('...the same waker each time (one subscriber, not one more on every read)', wakers.length === 2 && wakers[0] === wakers[1], true);
ok('...the waker says it is connected, until the widget is gone', (function () { var was = wakers[0].isConnected; eg.destroy(); return [was, wakers[0].isConnected]; })(), [true, false]);
// A SUMMARY THAT WAKES WHOEVER READS IT, at every read (2026-11-01: the house's Battery widget held the page, a wall
// tablet's screensaver and Settings' preview, in a loop of reads): a read a second at most, and the page breathes
var plain = window.hkEnergy.summary;
window.hkEnergy.summary = function (c, waker) { var r = plain(c, waker); waker.requestUpdate(); return r; };
var lw = make('battery', { u: 8 });
energyCalls = 0;
lw.update(cl, NOW);
var rounds = 0;
for (; rounds < 5 && __timerCount(); rounds++) { var held = __timerCount(); clock += 1000; __runTimers(); __timers.splice(0, held); }
ok('...a summary that always wakes: one read, then one a second (not a loop inside a read)', [energyCalls, rounds], [6, 5]);
lw.destroy(); __resetTimers();
ok('...gone, it is woken no more', (lw.update(cl, NOW), energyCalls), 6);
window.hkEnergy.summary = plain; Date.now = realNow;
battery = 84;
w.destroy(); d.destroy(); tw.destroy();

print('=== the calendar is read at most every five minutes ===');
var loads = 0, K0 = window.hkCalendar;
window.hkCalendar = { ids: function () { return ['calendar.family']; }, load: function (c, ids, from, to) {
  loads++;
  return { then: function (ok1) { ok1({ evs: [EVENT], failed: [] }); } };      // (answered at once)
} };
var CAL = SW._.cal;
CAL.evs = null; CAL.at = 0; CAL.busy = 0; CAL.failAt = 0;
var ne = make('next_event', { u: 8 }), el2 = make('event_line', { u: 8 });
ne.update(cl, NOW, {}); el2.update(cl, NOW, {});
ok('the first update reads the calendar, once for both widgets, and draws what comes', [loads, words(ne.el.innerHTML), words(el2.el.innerHTML)], [1, 'Up Next · 3:30 PM Piano Lesson Family', 'Piano Lesson · 3:30 PM']);
ne.update(cl, new Date(+NOW + 240000), {});
ok('...four minutes later: not again', loads, 1);
CAL.at -= 400000;
ne.update(cl, new Date(+NOW + 400000), {});
ok('...after five: again', loads, 2);
ne.destroy(); el2.destroy();
ok('...a widget that is gone is not drawn when it lands', CAL.watchers.length, 0);
window.hkCalendar = { ids: function () { return ['calendar.family']; }, load: function () { loads++; return { then: function (a, b) { b(new Error('offline')); } }; } };
CAL.evs = null; CAL.at = 0; CAL.failAt = 0; loads = 0;
var nf = make('next_event', { u: 8 });
nf.update(cl, NOW, {}); nf.update(cl, NOW, {});
ok('a read that fails is not asked again at once; the widget draws a dash', [loads, words(nf.el.innerHTML)], [1, 'Up Next —']);
nf.destroy();
window.hkCalendar = K0;
CAL.evs = null; CAL.at = 0; CAL.failAt = 0;
var asked = [];
window.hkNeed = { file: function (f) { asked.push(f); return Promise.resolve(); } };
var nn = make('next_event', { u: 8 });
nn.update(cl, NOW, {}); nn.update(cl, NOW, {});
ok('no calendar code yet: asked for once (the loader\'s hkNeed), the widget a dash meanwhile', [asked, words(nn.el.innerHTML)], [['hk-calendar.js'], 'Up Next —']);
nn.destroy();
window.hkNeed = undefined;

print('=== the forecasts are let go of ===');
var base = window.hkWxForecast.active();
subs.length = 0;
var f1 = make('temp', { u: 8 }), f2 = make('next_hours', { u: 8 }), f3 = make('temp', { u: 8 });
var cp = client({}, port);
f1.update(cp, NOW); f2.update(cp, NOW); f3.update(cp, NOW);
ok('two widgets of one kind share a subscription; each kind has one', [window.hkWxForecast.active() - base, subs.length], [2, 2]);
subs[0].cb({ forecast: [{ datetime: '2026-11-01T00:00:00', temperature: 72, templow: 55 }] });
var f4 = make('temp', { u: 8 });
f4.update(cp, NOW);
ok('...a widget that comes after a forecast has arrived has it at once', words(f4.el.innerHTML), '64° 55 72');
f1.destroy(); f3.destroy();
ok('...a subscription stays while one is left that wants it', window.hkWxForecast.active() - base, 2);
f4.destroy(); f2.destroy();
ok('...all let go when the last widget is gone', window.hkWxForecast.active() - base, 0);
ok('...a destroyed widget draws no more', (function () { return [f1.update(cp, NOW), f1.el.parentNode || null]; })(), [false, null]);

print('=== a reading that fails draws dashes ===');
var R0 = window.hkWxReadings.read;
window.hkWxReadings.read = function () { throw new Error('boom'); };
var bad = '';
try { bad = words(html('temp')) + '|' + words(html('weather_line')); } catch (x) { bad = 'THREW'; }
ok('the weather throwing: dashes, not an error', bad, '—|—');
window.hkWxReadings.read = R0;

print('=== sized from u ===');
var m = function (id, u, o) { return SW.create(id, Object.assign({ u: u }, o || {})).measure(); };
ok('circular: 13 u square', [m('temp', 6), m('temp', 12)], [{ w: 78, h: 78 }, { w: 156, h: 156 }]);
ok('rectangular: 29 u by 13 u, twice a circle\'s width and more', [m('next_event', 6), m('next_hours', 12)], [{ w: 174, h: 78 }, { w: 348, h: 156 }]);
ok('inline: 3.6 u high', [m('date', 10).h, m('photo_title', 5).h], [36, 18]);
var il = make('date', { u: 6 }), il2 = make('date', { u: 12 }), ib = make('date', { u: 6, back: 'glass' });
il.update(cl, NOW); il2.update(cl, NOW); ib.update(cl, NOW);
var a = il.measure(), b = il2.measure();
ok('...its width the text\'s: nothing before the first update, then about a letter\'s width each, in proportion to u',
   [SW.create('date', { u: 6 }).measure().w, a.w > 18 * 6 * 1.2 && a.w < 18 * 6 * 3, Math.abs(b.w / a.w - 2) < 0.02], [0, true, true]);
ok('...more with a backdrop (its padding)', ib.measure().w > a.w, true);
var longer = make('photo_title', { u: 6 }); longer.update(cl, NOW, { title: 'Lake Weekend, Two Thousand Twenty-Four, With the Cousins' });
ok('...more for more words', longer.measure().w > a.w, true);
var wl = make('weather_line', { u: 6 }); wl.update(cl, NOW);
var wd = make('date', { u: 6 }); wd.update(cl, NOW);
ok('...a glyph takes room too', wl.measure().w > 0, true);
il.setU(9);
ok('setU: the size follows, and the CSS variable', [il.measure().h, il.el.style['--u']], [32.4, '9px']);
ok('a band: 10 u high, a column\'s width for each reading', (function () { var r = make('readings', { u: 6 }); r.update(cl, NOW); return r.measure(); })(), { w: 4 * 14 * 6, h: 60 });
ok('a bad u is the default; the box reaches the element as --u', [m('aqi', 0).w, m('aqi', -3).w, make('aqi', { u: 7.5 }).el.style['--u']], [104, 104, '7.5px']);

print('=== backdrops and colors ===');
var cls = function (o) { return SW.create('aqi', Object.assign({ u: 8 }, o)).el.className; };
ok('the default: none, the screen\'s ink', cls({}), 'hksw k-circular p-readings w-aqi b-none c-auto');
// (white is the screen's one ink now: v1's white reads as auto, 2026-11-02)
ok('glass and white; tint and accent', [cls({ back: 'glass', color: 'white' }), cls({ back: 'tint', color: 'accent' })],
   ['hksw k-circular p-readings w-aqi b-glass c-auto', 'hksw k-circular p-readings w-aqi b-tint c-accent']);
ok('...something else is the default', cls({ back: 'frosted', color: 'pink' }), 'hksw k-circular p-readings w-aqi b-none c-auto');
var CSS = SW.CSS;
ok('the stylesheet: no backdrop-filter on a wall tablet; glass a static fill and a hairline', [/backdrop-filter/.test(CSS), /\.b-glass\{background:rgba\(255,255,255,\.16\);box-shadow:inset 0 0 0 1px/.test(CSS)], [false, true]);
ok('...the tint mixes the color into a dark fill, with a plain one beneath for a browser without color-mix', /\.b-tint\{background:rgba\(0,0,0,\.38\);background:color-mix\(in srgb,var\(--sw-ink\) 20%,rgba\(0,0,0,\.38\)\)\}/.test(CSS), true);
ok('...auto is the screen\'s one ink (else the caller\'s --tint), accent --hk-accent', [/\.c-auto\{--sw-ink:var\(--lay-ink,var\(--tint,#fff\)\)\}/.test(CSS), /\.c-accent\{--sw-ink:var\(--hk-accent,#ffb38a\)\}/.test(CSS)], [true, true]);
ok('...everything is sized in --u: 13 u for a circle, 29 by 13 for a rectangle, 3.6 u for a line, 10 u for the band',
   [/k-circular\{width:calc\(var\(--u\) \* 13\);height:calc\(var\(--u\) \* 13\)/, /k-rectangular\{width:calc\(var\(--u\) \* 29\);height:calc\(var\(--u\) \* 13\)/,
    /k-inline\{[^}]*height:calc\(var\(--u\) \* 3\.6\)/, /k-band\{width:100%;height:calc\(var\(--u\) \* 10\)/].map(function (re) { return re.test(CSS); }), [true, true, true, true]);
var styleCount = (document.head.children || []).filter(function (e) { return e.tagName === 'style'; }).length;
ok('one stylesheet for the page, however many widgets', styleCount, 1);

print('=== an update takes any clock ===');
var nw = make('date', { u: 8 });
nw.update(cl, +NOW);
ok('a number is a time', words(nw.el.innerHTML), 'Sunday, November 1');
nw.destroy();

print(fail ? 'FAIL ' + fail + ' SAVER WIDGETS TESTS' : 'ALL ' + pass + ' SAVER WIDGETS TESTS PASS');
if (fail) throw new Error(fail + ' failed');
