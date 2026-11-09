// THE ENERGY GROUP'S WIDGET BLOCKS (2026-10-31, the owner's mock-up "Home Grid
// blocks, widget style"): Energy Rings (hk-energy-rings-card), the Battery
// block's five sizes (hk-house-battery-card), the Power, Water and Doors &
// Windows panels' own small sizes (hk-grid-panel-card) and On Now
// (hk-on-now-card). The Energy page's sums are driven with the invented
// sample house of test_energysums.js (tests/fixtures/sample_energy.json); the
// rest with a fictional house. Nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_energy');
// the day's hours drawn are "now"'s: pinned to noon (fixed_clock.js), so hours still to come exist whatever the real
// hour is (run after 23:00, Power W had none, and the half-ink check failed: the third audit pass, 2026-11-01)
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

// the settings feed, as the page holds it: the house's lists, the Energy
// feature's power page and the Water page's meter
var FEED = {
  added: ['energy'],
  energy: { sections: [], power: { home: 'sensor.home_power', solar: 'sensor.solar_power', grid: 'sensor.grid_power',
                                   battery: { level: 'sensor.battery_level' } } },
  headers: { water: { meter: 'sensor.water_meter' } },
  kinds: { lights: ['light.kitchen_pendants', 'light.den_lamp', 'light.porch_light', 'light.all_downstairs'],
           speakers: ['media_player.kitchen_speaker', 'media_player.den_speaker'], fans: ['fan.bedroom_fan'],
           doors: ['binary_sensor.front_door', 'binary_sensor.back_door'], windows: ['binary_sensor.office_window'],
           garage: ['cover.garage_door'], locks: ['lock.front_door'], leaks: ['binary_sensor.sink_leak'] },
  generated: { exclude_entities: ['light.den_lamp'] }
};
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return null; }
};

load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');
// (On Now draws with House Status's summary tiles, round two: its file is On Now's kit)
load(HK_ROOT + '/frontend/cards/hk-house-status.js');
window.hkCards.createCard = function (cfg, client) {
  var el = window.hkCards.create(cfg);
  if (el && client) el.hkSetClient(client);
  return el;
};

var ok = H.ok, eq = H.eq, S = window.hkStats, EP = window.hkEnergyPage;
function near(a, b, tol) { return typeof a === 'number' && Math.abs(a - b) <= (tol || 0.01); }
function sized(tag, size, cfg) {
  var card = H.make(tag);
  card.setAttribute('size', size);
  card.setConfig(Object.assign({ type: 'custom:' + tag }, cfg || {}));
  return card;
}

// ---- the sample house's statistics (test_energysums.js), aligned as hk-stats aligns them
var F = JSON.parse(read(HK_ROOT + '/tests/fixtures/sample_energy.json'));
function aligned(map, axis) {
  var out = {};
  Object.keys(map).forEach(function (id) { out[id] = axis.map(function (t, i) { return { t: new Date(t), v: map[id][i] }; }); });
  return out;
}
var D = { h: aligned(F.h, F.hAxis), d: aligned(F.d, F.dAxis) };
var M = EP.__buildModel(F.plan, F.prefs, F.info);
// the open hour: ten closed five-minute buckets, each 0.1 kWh drawn, 2 cents, 1 gallon
var t14 = F.hAxis[F.hAxis.length - 1], FIVE = {};
M.ids.forEach(function (id) {
  FIVE[id] = [];
  for (var k = 0; k < 12; k++) {
    FIVE[id].push({ t: new Date(t14 + k * 3e5), v: k >= 10 ? null : id === 'sensor.grid_import_energy' ? 0.1 :
      id === 'sensor.grid_import_energy_cost' ? 0.02 : id === 'sensor.water_meter_total' ? 1 : 0 });
  }
});
// the stand-in statistics for the energy part, and for the house's own meters after it
var saved = { hourly: S.hourly, daily: S.daily, fiveMinute: S.fiveMinute, weekStart: S.weekStart };
function energyStats() {
  S.hourly = function () { return D.h; };
  S.daily = function () { return D.d; };
  S.fiveMinute = function (h, ids, n, card, o) { return o && o.type === 'change' ? FIVE : null; };
  S.weekStart = function () { return 0; };
}
// 48 hours (the last one open), 8 days, 37 five-minute buckets: a meter's
// made-up readings, `per` each, ending with the hour we are in
function series(n, step, end, fn) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ t: new Date(end - (n - 1 - i) * step), v: fn(i) });
  return out;
}
function houseStats() {
  var hour0 = new Date(); hour0.setMinutes(0, 0, 0);
  var day0 = new Date(); day0.setHours(0, 0, 0, 0);
  S.hourly = function (h, ids, n, card, o) {
    var one = function (id) { return series(n, 36e5, +hour0, function (i) { return o && o.type === 'mean' ? 40 + i % 24 * 2 : i === n - 1 ? null : 2 + i % 5; }); };
    if (!Array.isArray(ids)) return one(ids);
    var out = {}; ids.forEach(function (id) { out[id] = one(id); }); return out;
  };
  S.daily = function (h, ids, n) { var out = {}; ids.forEach(function (id) { out[id] = series(n, 864e5, +day0, function (i) { return 60 + i * 10; }); }); return out; };
  S.fiveMinute = function (h, ids, n) { var out = {}; ids.forEach(function (id) { out[id] = series(n, 3e5, Date.now(), function (i) { return i === n - 1 ? null : 1000 + i * 20; }); }); return out; };
}

H.run('ENERGY BLOCKS', [
function () {
  H.section('summary(): the rings for today, this week and this month, from the page\'s own sums');
  var savedHS = window.hkSettings;
  window.hkSettings = { get: function (k, dflt) { return k === 'energy' ? F.plan : dflt; } };
  EP.prefs = F.prefs; EP.info = F.info; EP.prefsAt = Date.now(); EP.cache = null;
  energyStats();
  var hass = { states: {}, callWS: function () { return new Promise(function () {}); } };
  var waker = { isConnected: true, requestUpdate: function () {}, redraw: function () {} };
  var s = window.hkEnergy.summary(hass, waker, F.now), P = s && s.periods;
  ok('three periods', P && P.day && P.week && P.month, s && Object.keys(s.periods || {}));
  eq('today\'s rings are the screensaver\'s', P.day.rings.map(function (r) { return [r.key, r.v, r.typ, r.tick]; }),
     s.rings.map(function (r) { return [r.key, r.v, r.typ, r.tick]; }));
  var R1 = EP.__calc(M, D, 'day', F.now), Wk = EP.__calc(M, D, 'week', F.now, null, { back: 0, ws: 0 });
  var e = P.week.rings[0];
  ok('the week: the page\'s This Week and the open hour (calc\'s own calendar week)', near(e.v, Wk.home + 1.0, 0.001), [e.v, Wk.home]);
  ok('...against a usual day for each of its days', near(e.typ, R1.typ.home * Wk.n, 0.001), [e.typ, R1.typ.home * Wk.n]);
  ok('...its dot where a usual week is by now: the days gone and today\'s share', near(e.tick, (Wk.whole + s.rings[0].tick) / Wk.n, 1e-6) && e.tick > 0 && e.tick < 1, e.tick);
  var m = P.month.rings[0];
  ok('the month: the screensaver\'s month so far', near(m.v, s.month.energy, 0.001), [m.v, s.month.energy]);
  ok('...where its cost is heading is the screensaver\'s', near(P.month.heading.cost, s.projCost, 0.001), [P.month.heading.cost, s.projCost]);
  eq('...named for its month', P.month.name, s.monthName);
  ok('today\'s cost heading: so far and the rest of a usual day', P.day.heading.cost > s.today.cost && P.day.heading.cost < s.today.cost + R1.typ.cost, P.day.heading);

  H.section('hk-energy-rings-card: each size, the switch, a tap');
  var at = function () { return new Date(F.now); };
  var card = sized('hk-energy-rings-card', 'W', { period: 'week' });
  card._clock = at;
  hkGive(card, hass);
  card._render();
  var html = H.morphed(card._card);
  ok('W: the rings and the switch, This Week chosen', /class="rings"/.test(html) && /data-p="week" aria-pressed="true"/.test(html) && /data-p="day" aria-pressed="false"/.test(html), html.slice(0, 300));
  ok('...each figure beside them, with its name', /<b>Energy<\/b>/.test(html) && /<b>Cost<\/b>/.test(html) && /<b>Water<\/b>/.test(html), html);
  ok('...a ring a figure: three here (the sample house has no solar)', (html.match(/class="arc" /g) || []).length === 3, html.match(/class="arc" /g));
  card._pick('month');
  html = H.morphed(card._card);
  ok('a tap on Month: the month, in place', /data-p="month" aria-pressed="true"/.test(html) && card._period === 'month');
  var xl = sized('hk-energy-rings-card', 'XL', { period: 'month' });
  xl._clock = at; hkGive(xl, hass); xl._render();
  html = H.morphed(xl._card);
  ok('XL: the figures two by two, "% of usual", and the month so far with where its cost is heading',
     /class="wgrid /.test(html) && /% of usual/.test(html) && new RegExp(s.monthName + ' so far').test(html) && /Heading for \$/.test(html), html);
  var sm = sized('hk-energy-rings-card', 'S', {});
  sm._clock = at; hkGive(sm, hass); sm._render();
  html = H.morphed(sm._card);
  ok('S: the rings and the period under them, no switch', /<small>Today<\/small>/.test(html) && !/data-p=/.test(html), html);
  eq('...the block is the button', [sm._card.getAttribute('role'), sm._card.getAttribute('tabindex')], ['button', '0']);
  sm._pick(null);
  ok('...a tap moves it on to This Week', sm._period === 'week' && /This Week/.test(H.morphed(sm._card)));
  var tl = sized('hk-energy-rings-card', 'T', { period: 'bogus' });
  eq('a period the block does not know starts on Today', tl._period, 'day');
  window.hkSettings = savedHS; EP.cache = null; EP.prefs = null;
  S.hourly = saved.hourly; S.daily = saved.daily; S.fiveMinute = saved.fiveMinute; S.weekStart = saved.weekStart;
},
function () {
  H.section('hk-house-battery-card on a Home Grid: S to XL');
  houseStats();
  var house = H.house({
    'sensor.battery_level': ['82', { unit_of_measurement: '%' }], 'sensor.stored': ['11.2', { unit_of_measurement: 'kWh' }],
    'sensor.backup': ['9.5', { unit_of_measurement: 'h' }], 'number.reserve': ['20', { unit_of_measurement: '%' }],
    'sensor.charge': ['1840', { unit_of_measurement: 'W' }], 'sensor.discharge': ['0', { unit_of_measurement: 'W' }],
    'sensor.solar_power': ['2.1', { unit_of_measurement: 'kW' }], 'sensor.home_power': ['1400', { unit_of_measurement: 'W' }],
    'sensor.grid_power': ['0', { unit_of_measurement: 'W' }] });
  var cfg = { level: 'sensor.battery_level', stored: 'sensor.stored', backup: 'sensor.backup', reserve: 'number.reserve',
              charge: 'sensor.charge', discharge: 'sensor.discharge' };
  var draw = function (size, hass) { var c = sized('hk-house-battery-card', size, cfg); c.hass = hass || house.hass(); return H.morphed(c._card); };
  var s = draw('S');
  // (2026-11-07, the review: one ring as large as the block, the level and what it is doing inside it)
  ok('S: no name (2026-11-08), one ring with the level and its state inside', !/Battery</.test(s) && /class="bring"/.test(s) && /class="in"><b[^>]*>82%<\/b><small>Charging</.test(s), s);
  var w = draw('W');
  ok('W: charging and the stored kWh, the backup at the foot, a larger ring', /Charging · 11.2 kWh/.test(w) && /About 9h 30m of backup/.test(w) && /width:120px/.test(w), w);
  var t = draw('T');
  ok('T: the ring as large as the column (160 on a square cell)', /width:160px/.test(t) && /11.2 kWh · 9h 30m of backup/.test(t), t);
  var l = draw('L');
  ok('L: the level inside the ring; the stored kWh beside it', /<b style="font-size:\d+px">82%<\/b><small>Charging<\/small>/.test(l) && />11.2 kWh</.test(l), l);
  ok('...solar in, the house using, from the grid, full by -- from the Energy feature\'s power page',
     /Solar In<\/b><span>2.1 kW/.test(l) && /House Using<\/b><span>1.4 kW/.test(l) && /From Grid<\/b><span>0 W/.test(l) && /Full By<\/b><span>\d{1,2}:\d\d/.test(l), l);
  var x = draw('XL');
  ok('XL: the day\'s charge as 24 bars, and the four figures', (x.match(/<rect /g) || []).length === 24 && /Using<\/b>/.test(x), x.match(/<rect /g));
  var giving = house.set('sensor.charge', '0');
  giving = house.set('sensor.discharge', '900');
  l = draw('L', giving);
  ok('giving to the house: how long it lasts, not when it is full', /Lasts<\/b><span>9h 30m/.test(l) && /In use/.test(l), l);
  var low = house.set('sensor.battery_level', '15');
  ok('at or under its reserve: the ring red', /#ff453a/.test(draw('S', low)));
  S.hourly = saved.hourly; S.daily = saved.daily; S.fiveMinute = saved.fiveMinute;
},
function () {
  H.section('the panels\' own small sizes: Power S, Water S W T, Doors & Windows S W T');
  houseStats();
  var house = H.house({
    'sensor.home_power': ['1800', { unit_of_measurement: 'W' }],
    'sensor.solar_power': ['2100', { unit_of_measurement: 'W' }],
    'sensor.battery_level': ['76', { unit_of_measurement: '%' }],
    'sensor.water_meter': ['48211', { unit_of_measurement: 'gal' }],
    'binary_sensor.sink_leak': ['off', { friendly_name: 'Sink Leak', device_class: 'moisture' }],
    'binary_sensor.front_door': ['off', { friendly_name: 'Front Door', device_class: 'door' }],
    'binary_sensor.back_door': ['off', { friendly_name: 'Back Door', device_class: 'door' }],
    'binary_sensor.office_window': ['on', { friendly_name: 'Office Window', device_class: 'window' }],
    'cover.garage_door': ['closed', { friendly_name: 'Garage Door', device_class: 'garage' }],
    'lock.front_door': ['locked', { friendly_name: 'Front Door Lock' }] });
  var panel = function (kind, size, hass) {
    var c = sized('hk-grid-panel-card', size, { panel: kind });
    hkGive(c, hass || house.hass()); c._render();
    return c;
  };
  var p = panel('power', 'S'), html = H.morphed(p._own.plate);
  ok('Power S: using now, large, in kW, and the last three hours as twelve bars', /Using Now/.test(html) && />1.8</.test(html) && />kW</.test(html) &&
     (html.match(/<rect /g) || []).length === 12, html);
  html = H.morphed(panel('power', 'W')._own.plate);
  ok('Power W: on its own plate, the power now and the day as 24 hours', /1.8 kW</.test(html) && (html.match(/<rect /g) || []).length === 24, html);
  ok('...the hours still to come yesterday\'s, at half the ink', (html.match(/fill-opacity=".5"/g) || []).length > 0, html);
  html = H.morphed(panel('power', 'L')._own.plate);
  ok('Power L: the sun and the battery under the figure, the hours under the chart', /Solar 2.1 kW · Battery 76%/.test(html) && /12 AM/.test(html), html);
  html = H.morphed(panel('power', 'XL')._own.plate);
  ok('Power XL: the chart left, today\'s top users right, the house first', /Today<\/span>/.test(html) && /<b>House<\/b>/.test(html) && /mdi:home/.test(html), html);
  html = H.morphed(panel('water', 'S')._own.plate);
  ok('Water S: today large (the hours since midnight and this one so far), gal today, twelve bars', /class="wb" data-more="sensor.water_meter">/.test(html) && /gal today/.test(html) &&
     (html.match(/<rect /g) || []).length === 12, html);
  html = H.morphed(panel('water', 'W')._own.plate);
  ok('Water W: the number beside the day\'s 24 hours, against a usual day', (html.match(/<rect /g) || []).length === 24 && /usual/i.test(html), html);
  html = H.morphed(panel('water', 'T')._own.plate);
  ok('Water T: the short chart, then This Week, the days before newest first', /This Week/.test(html) && (html.match(/<em>\d+ gal<\/em>/g) || []).length >= 2, html);
  html = H.morphed(panel('water', 'L')._own.plate);
  ok('Water L: Today, "N gal" large, against usual and no leaks, the day\'s 24 hours', /Today<\/span><\/div><div class="wb" data-more="sensor.water_meter">[\d,]+ gal</.test(html) &&
     /no leaks/.test(html) && (html.match(/<rect /g) || []).length === 24, html);
  html = H.morphed(panel('water', 'XL', house.set('binary_sensor.sink_leak', 'on'))._own.plate);
  ok('Water XL: This Week beside it, today first; a wet sensor by name, in red', /This Week/.test(html) && /Leak: Sink Leak/.test(html) &&
     (html.match(/<em>\d+ gal<\/em>/g) || []).length >= 3, html);
  house.set('binary_sensor.sink_leak', 'off');
  html = H.morphed(panel('doors', 'S')._own.plate);
  ok('Doors S: how many are open, large, and which', /class="wb xl">1</.test(html) && /Open · Office Window/.test(html) && /mdi:window-open/.test(html), html);
  html = H.morphed(panel('doors', 'W')._own.plate);
  ok('Doors W: the count beside the list, the open one first and in orange', />1 Open</.test(html) && /class="ws">Office Window</.test(html) && !/All doors closed/.test(html) &&
     html.indexOf('Office Window') < html.indexOf('Front Door') && /color:#ff9f0a">Open</.test(html), html);
  ok('...a row opens its own sheet; the locks are Security\'s, not here', /data-more="binary_sensor.front_door"/.test(html) && !/lock.front_door/.test(html));
  // Large and Extra Large (2026-10-31, the owner: not the house picture): the same list, 44 px rows; Extra Large the count beside it
  var pl = panel('doors', 'L');
  ok('Doors L: its own plate, not the house picture', !!pl._own && pl._own.spec.own === 'doors');
  html = H.morphed(pl._own.plate);
  ok('...the count over rows at their own 48 px (nothing stretches), the open one first, no foot', /class="wb xl">1</.test(html) && /class="wr tall"/.test(html) && !/wr grow|total/.test(html) &&
     html.indexOf('Office Window') < html.indexOf('Front Door'), html);
  html = H.morphed(panel('doors', 'XL')._own.plate);
  ok('Doors XL: the count in its own column beside the list', /class="wsplit"/.test(html) && /flex:0 0 200px/.test(html) &&
     /class="ws">Office Window</.test(html) && !/All doors closed/.test(html) && (html.match(/<div data-more=/g) || []).length === 4, html);
  var closed = house.set('binary_sensor.office_window', 'off');
  html = H.morphed(panel('doors', 'T', closed)._own.plate);
  ok('Doors T: all closed, with a check, the list under it', /mdi:check-circle/.test(html) && />All Closed<\/div>/.test(html) && (html.match(/<div data-more=/g) || []).length === 4, html);
  var p2 = panel('doors', 'S'), sig = p2._sigOf();
  hkGive(p2, house.set('binary_sensor.back_door', 'on'));
  ok('a door opening redraws the block (its signature reads them)', p2._sigOf() !== sig);
  S.hourly = saved.hourly; S.daily = saved.daily; S.fiveMinute = saved.fiveMinute;
},
function () {
  H.section('hk-on-now-card: what is on, by kind; Off and All Off');
  var house = H.house({
    'light.kitchen_pendants': ['on', { friendly_name: 'Kitchen Pendants' }],
    'light.den_lamp': ['on', { friendly_name: 'Den Lamp' }],
    'light.porch_light': ['on', { friendly_name: 'Porch Light' }],
    'light.all_downstairs': ['on', { friendly_name: 'All Downstairs', entity_id: ['light.kitchen_pendants', 'light.porch_light'] }],
    'media_player.kitchen_speaker': ['playing', { friendly_name: 'Kitchen Speaker' }],
    'media_player.den_speaker': ['paused', { friendly_name: 'Den Speaker' }],
    'fan.bedroom_fan': ['on', { friendly_name: 'Bedroom Fan' }],
    'switch.coffee_maker': ['on', { friendly_name: 'Coffee Maker' }],
    'switch.car_charging': ['on', { friendly_name: 'Car Charging' }] });
  var hass = function (h) {
    h = h || house.hass();
    h.areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, porch: { area_id: 'porch', name: 'Porch' }, den: { area_id: 'den', name: 'Den' },
                bedroom: { area_id: 'bedroom', name: 'Bedroom' } };
    h.entities = { 'light.kitchen_pendants': { area_id: 'kitchen' }, 'light.porch_light': { area_id: 'porch' }, 'light.den_lamp': { area_id: 'den' },
                   'media_player.kitchen_speaker': { area_id: 'kitchen' }, 'fan.bedroom_fan': { area_id: 'bedroom' }, 'switch.coffee_maker': { area_id: 'kitchen' } };
    h.devices = {};
    return h;
  };
  var o = window.hkGridCards._.whatsOn(window.hkHostClient.from(hass()));
  eq('the kinds on: two lights, a speaker playing, a fan, a switch in a room', o.kinds.map(function (x) { return x.kind.key + ' ' + x.ids.length; }),
     ['lights 2', 'speakers 1', 'fans 1', 'switches 1']);
  ok('...not a group light (its lights are counted), not a hidden one, not a paused speaker, not a switch in no room',
     o.things.every(function (t) { return ['light.all_downstairs', 'light.den_lamp', 'media_player.den_speaker', 'switch.car_charging'].indexOf(t.id) < 0; }));
  eq('...the room off the front of a name, unless only what it is would be left', o.things.filter(function (t) { return t.kind.key === 'lights'; }).map(function (t) { return [t.name, t.room]; }),
     [['Pendants', 'Kitchen'], ['Porch Light', 'Porch']]);
  eq('...and every kind the house has, each with all of its things (a tile at rest says it has them)', o.every.map(function (x) { return x.kind.key + ' ' + x.ids.length + '/' + x.all.length; }),
     ['lights 2/2', 'speakers 1/2', 'fans 1/1', 'switches 1/1']);
  var draw = function (size, cfg) { var c = sized('hk-on-now-card', size, cfg || {}); hkGive(c, hass()); c._render(); return c; };
  // ROUND TWO (2026-11-08): the headline over the kinds as lines, House Status's parts (hk-house-status.js)
  var html = H.morphed(draw('S')._plate);
  // (2026-11-09, the owner: "we can remove the On Now heading"; "The Small card could probably show more data": the total, then each kind's
  // count beside its disc, a 2 x 2 of pictures -- the block's one button is the tap, the counts are no controls)
  ok('S: the count large over a 2 x 2 of the kinds\' discs, each with its count; no heading', /<span class="n">5<\/span><span class="u">On<\/span>/.test(html) &&
     (html.match(/class="dk"/g) || []).length === 4 && /<b>2<\/b>/.test(html) && (html.match(/<b>1<\/b>/g) || []).length === 3 && /class="dcs/.test(html) &&
     (html.match(/<button/g) || []).length === 1 && !/sm-l|sm-h|On Now/.test(html.replace(/aria-label="[^"]*"/g, '')), html);
  html = H.morphed(draw('W')._plate);
  ok('W: the count in its column with All Off at its foot; the kinds as discs with their counts, each opening it',
     (html.match(/class="di" data-open-kind="/g) || []).length === 4 && /class="sm-k f" data-all/.test(html) && !/data-off-kind=/.test(html) && /<b>2<\/b><span>Lights<\/span>/.test(html), html);
  html = H.morphed(draw('T')._plate);
  ok('T: the count over a line a kind -- its lit disc, its name and where, its count', /class="sm-k" data-all/.test(html) &&
     /class="ln r0" data-open-kind="lights"[^>]*><span class="dk" style="width:24px;height:24px;background:[^"]+"[^>]*>.*?<span class="nm">Lights<\/span><span class="dt">Kitchen, Porch<\/span><\/span><span class="rd">2<\/span>/.test(html), html);
  var l = draw('L');
  html = H.morphed(l._plate);
  ok('L: a sentence under the count, lines saying where -- a switch by its name', /<div class="snt">2 lights, 1 speaker, 1 fan and 1 switch<\/div>/.test(html) &&
     /<span class="dt">Coffee Maker<\/span>/.test(html) && (html.match(/class="ln/g) || []).length === 4, html);
  html = H.morphed(draw('XL')._plate);
  ok('XL: the count top left in a column of its own (no heading), All Off at its foot, the four lines beside it', /class="sx tp"/.test(html) && /class="sm-k f" data-all/.test(html) && !/sm-l|sm-h/.test(html) && /<div class="sc"><div class="grp" style="margin-bottom:0"><div class="hl big">/.test(html) && (html.match(/class="ln/g) || []).length === 4, html);
  // TAP ZONES (2026-11-07): a kind opens a sheet of those things (one thing: its own sheet)
  var went = [], saveD = window.hkDetail, saveM = window.hkShell.moreInfo;
  window.hkDetail = { openGroup: function (title, ids, o) { went.push(['group', title, ids, o && o.icon]); return true; } };
  window.hkShell.moreInfo = function (id) { went.push(['sheet', id]); };
  l._openKind('lights'); l._openKind('fans'); l._openKind('speakers'); l._openKind('switches'); l._openKind('doors');
  eq('a kind opens its sheet: Lights On, one fan or speaker its own', went, [
    ['group', 'Lights On', ['light.kitchen_pendants', 'light.porch_light'], 'mdi:lightbulb'], ['sheet', 'fan.bedroom_fan'],
    ['sheet', 'media_player.kitchen_speaker'], ['sheet', 'switch.coffee_maker']]);
  // ...or, Categories: Go to Its Page (`open: page`), its page where the screen has one, else its sheet
  went.length = 0;
  var M = window.hkCards.menu, pp = M.pagePath, navWas = window.hkShell.navigate;
  M.pagePath = function (p) { return p === 'lights' || p === 'playmusic' ? '/home/' + p : null; };
  window.hkShell.navigate = function (path) { went.push(['page', path]); };
  var pg = draw('L', { open: 'page' });
  pg._openKind('lights'); pg._openKind('speakers'); pg._openKind('fans');
  eq('Go to Its Page: the Lights page, the music page; fans with no page here, their sheet', went,
     [['page', '/home/lights'], ['page', '/home/playmusic'], ['sheet', 'fan.bedroom_fan']]);
  M.pagePath = pp; window.hkShell.navigate = navWas;
  window.hkDetail = saveD; window.hkShell.moreInfo = saveM;
  house.calls.length = 0;
  l._off('light.porch_light');
  l._off(null, 'lights');
  return H.tick().then(function () {
    eq('Off: that thing; a kind: all of them in one call', house.calls, [
      { domain: 'light', service: 'turn_off', data: { entity_id: 'light.porch_light' } },
      { domain: 'light', service: 'turn_off', data: { entity_id: ['light.kitchen_pendants', 'light.porch_light'] } }]);
    house.calls.length = 0;
    l._off(null, null, true);
    return H.tick();
  }).then(function () {
    eq('All Off: one call per kind, the speaker paused', house.calls.map(function (c) { return c.domain + '.' + c.service; }),
       ['light.turn_off', 'media_player.media_pause', 'fan.turn_off', 'switch.turn_off']);
    // QUIET (round two): nothing on -- every kind the house has at rest, said once, no All Off; Small "All Off"
    var none = H.house({ 'light.kitchen_pendants': ['off', {}], 'light.den_lamp': ['off', {}], 'fan.bedroom_fan': ['off', {}] });
    var c = sized('hk-on-now-card', 'L', {}); hkGive(c, hass(none.hass())); c._render();
    var q = H.morphed(c._plate);
    ok('nothing on: each kind at rest ("Off", how many it has), no All Off, never "0" or "Nothing is on"',
       (q.match(/class="ln at/g) || []).length === 2 && /<span class="rd">Off<\/span>/.test(q) && /<span class="dt">1 light<\/span>/.test(q) && !/data-all/.test(q) && !/Nothing is on|>0</.test(q) &&
       /<div class="hl w">All Off<\/div>/.test(q), q);
    var cs = sized('hk-on-now-card', 'S', {}); hkGive(cs, hass(none.hass())); cs._render();
    ok('...Small: "All Off", once, over the kinds\' discs at rest', /<div class="hl w">All Off<\/div>/.test(H.morphed(cs._plate)) && /class="dk off"/.test(H.morphed(cs._plate)) &&
       !/Nothing/.test(H.morphed(cs._plate)), H.morphed(cs._plate));
    // ...a kind at rest opens all of its things (one: its own sheet)
    var w2 = []; window.hkShell.moreInfo = function (id) { w2.push(id); };
    c._openKind('lights');
    window.hkShell.moreInfo = saveM;
    eq('...a kind at rest: its things\' sheet', w2, ['light.kitchen_pendants']);
  });
}
]);
