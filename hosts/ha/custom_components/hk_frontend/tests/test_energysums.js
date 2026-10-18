// THE ENERGY PAGE'S SUMS (hk-energy.js, window.hkEnergyPage.__calc), driven
// with ONE HOUSE'S REAL NUMBERS: its plan (the settings feed's `energy`), its
// Home Assistant Energy settings (energy/get_prefs, energy/info), and 49 hours
// and 61 days of its statistics, captured 2026-10-12 14:53 EDT and aligned the
// way hk-stats aligns them (tests/fixtures/energy_house.json).
//
// THE EXPECTED FIGURES ARE NOT THE CODE'S OWN. Today's were read off Home
// Assistant's Energy dashboard at that moment (grid 33.03 kWh, $4.61, battery
// charged 2.26 kWh, water 84.49 gal); the week, month and usual-day figures
// were summed separately from the raw statistics. A sum here that drifts from
// them is a page that disagrees with Home Assistant.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function near(a, b, tol) { return typeof a === 'number' && Math.abs(a - b) <= (tol || 0.01); }

var F = JSON.parse(read(HK_ROOT + '/tests/fixtures/energy_house.json'));
var EP = window.hkEnergyPage;
function aligned(map, axis) {
  var out = {};
  Object.keys(map).forEach(function (id) {
    out[id] = axis.map(function (t, i) { return { t: new Date(t), v: map[id][i] }; });
  });
  return out;
}
var D = { h: aligned(F.h, F.hAxis), d: aligned(F.d, F.dAxis) };
var M = EP.__buildModel(F.plan, F.prefs, F.info);

// ---------------------------------------------------------------- the model
ok('the grid meter and its cost sensor come from HA\'s settings and energy/info',
   JSON.stringify(M.src.imp) === '["sensor.main_power_utility"]' && JSON.stringify(M.src.cost) === '["sensor.main_power_utility_cost"]', M.src);
ok('the battery\'s meters: charge in, output out', M.src.battery && M.src.into[0] === 'sensor.battery_charge_consumption' &&
   M.src.out[0] === 'sensor.battery_output_consumption', M.src);
ok('water is a source of its own', M.src.water.ids[0] === 'sensor.droplet_water_integrated', M.src.water);
var byName = {};
M.devs.forEach(function (d) { byName[d.name] = d; });
ok('a device in HA\'s settings is counted', byName['Garage Outlets'].counted && byName['Office'].counted);
ok('a device HA marks as inside another is not counted twice (Network Rack in Garage Outlets)', !byName['Network Rack'].counted);
ok('a device HK adds by itself is a tile but not counted (Battery Charge)', byName['Battery Charge'] && !byName['Battery Charge'].counted);
ok('23 devices counted, as HA counts them', M.devs.filter(function (d) { return d.counted; }).length === 23,
   M.devs.filter(function (d) { return d.counted; }).length);
ok('each section keeps its own color', M.sections[0].color === '#5ac8fa' && M.sections[1].color === '#bf5af2');
ok('the house battery is the plan\'s house battery', M.house && M.house.house === true);

// ---------------------------------------------------------------- today
var R = EP.__calc(M, D, 'day', F.now);
ok('today: the house used grid 33.03 - battery charge 2.26 = 30.77 kWh (HA\'s formula)', near(R.home, 30.768), R.home);
ok('today\'s cost is HA\'s: $4.61', near(R.cost, 4.612), R.cost);
ok('today\'s water is HA\'s: 84.49 gal', near(R.water, 84.488), R.water);
ok('the battery charged 2.26 kWh, gave back none', near(R.into, 2.263) && near(R.out, 0), [R.into, R.out]);
ok('on a device + not on a device = what the house used', near(R.onDevice + R.untracked, R.home), [R.onDevice, R.untracked]);
ok('on a device today: 29.57 kWh, the rest 1.20', near(R.onDevice, 29.57) && near(R.untracked, 1.198), [R.onDevice, R.untracked]);
ok('fifteen hours of today so far', R.idx.length === 15, R.idx.length);
ok('a usual day is the 30 before today: 79.42 kWh', near(R.typ.home, 79.416), R.typ.home);
ok('how much of a usual day has gone by, from yesterday\'s shape', R.share > 0.3 && R.share < 0.8, R.share);
ok('the projection is today over that share', near(R.proj, R.home / R.share, 0.001));
var secSum = R.secs.reduce(function (a, s) { return a + s.v; }, 0);
ok('the sections add up to what is on a device', near(secSum, R.onDevice), [secSum, R.onDevice]);

// ---------------------------------------------------------------- the week and the month
// CALENDAR PERIODS (the fixture is Monday 2026-10-12 14:53): the week from
// Sunday Oct 11, the month from Oct 1. Summed separately from the raw
// statistics, as the figures above were.
var W = EP.__calc(M, D, 'week', F.now);
ok('this week (Sun Oct 11 - Mon): 90.82 kWh, $13.47', near(W.home, 90.818) && near(W.cost, 13.468), [W.home, W.cost]);
ok('...seven slots, Sunday and today with days, the five to come without', W.n === 7 && W.slots.length === 7 && W.idx.length === 2 &&
   W.slots[1] === F.dAxis.length - 1 && W.slots.slice(2).every(function (x) { return x === null; }) && W.todayK === 1, W.slots);
ok('...the days gone: one whole day and today\'s part (R.n x R.pshare)', near(W.n * W.pshare, 1 + W.share, 1e-9) && near(W.days, 1 + W.share, 1e-9));
ok('...each day to come carries last week\'s same day (Tue Oct 6 ...)', W.ghosts[0] === null && W.ghosts[1] === null &&
   W.ghosts[2] === F.dAxis.length - 7 && W.ghosts[6] === F.dAxis.length - 3, W.ghosts);
ok('...last week by now: Sun Oct 4 and Mon Oct 5 as far as today has gone', W.prev.byNow &&
   near(W.prev.home, 73.802 + 74.288 * W.share, 0.02) && near(W.prev.allHome, 480.003), [W.prev.home, W.prev.allHome]);
ok('...heading for: so far and a usual day for each day left', near(W.proj, W.home + W.typ.home * (7 - W.days), 1e-6), W.proj);
var Mo = EP.__calc(M, D, 'month', F.now);
ok('this month (Oct 1-12): 815.42 kWh, $118.48, 1,596.97 gal', near(Mo.home, 815.419) && near(Mo.cost, 118.476) && near(Mo.water, 1596.973),
   [Mo.home, Mo.cost, Mo.water]);
ok('...thirty-one slots, twelve with days', Mo.n === 31 && Mo.idx.length === 12 && Mo.todayK === 11);
ok('...September by now: the 1st to the 11th and the 12th as far as today has gone, of 2,760.09 in all',
   near(Mo.prev.home, 1162.259 + 40.796 * Mo.share, 0.02) && near(Mo.prev.allHome, 2760.086), [Mo.prev.home, Mo.prev.allHome]);
// A PERIOD BEFORE THIS ONE: whole, against the one before it in full
var W1 = EP.__calc(M, D, 'week', F.now, null, { back: 1 });
ok('last week (Oct 4-10): 480.00 kWh, every day there, nothing to come', near(W1.home, 480.003) && W1.idx.length === 7 && !W1.cur &&
   W1.todayK === -1 && W1.ghosts.every(function (x) { return x === null; }) && !W1.prev.byNow, [W1.home, W1.idx.length]);
ok('...its usual day is the 30 before it, and it heads for itself', W1.tw.length === 30 && W1.tw[29] === F.dAxis.length - 10 && near(W1.proj, W1.home));
var Mo1 = EP.__calc(M, D, 'month', F.now, null, { back: 1 });
ok('September: 2,760.09 kWh over its 30 days', near(Mo1.home, 2760.086) && Mo1.n === 30 && Mo1.idx.length === 30, [Mo1.home, Mo1.n]);
// A COST SENSOR THAT STARTED OVER: the fixture's Aug 22 holds HA's own -$586
// reset; that day is priced at the meter's rate, so no period goes negative
var Au = EP.__calc(M, D, 'month', F.now, null, { back: 2 });
var aug22 = Au.idx.filter(function (i) { return new Date(F.dAxis[i]).getDate() === 22; })[0];
ok('August with its reset day: a cost, never below zero (Aug 22 at the meter\'s own rate)', Au.cost > 0 &&
   F.d['sensor.main_power_utility_cost'][aug22] < -500 && Au.idx.length === 19, [Au.cost, Au.idx.length]);
var Wm = EP.__calc(M, D, 'week', F.now, null, { ws: 1 });
ok('a week from Monday (the user\'s first day): today alone so far, 30.77 kWh as on Today', Wm.idx.length === 1 && Wm.idx[0] === F.dAxis.length - 1 &&
   Wm.todayK === 0 && near(Wm.home, 30.768), [Wm.idx, Wm.home]);
var N = EP.__calc(M, D, 'now', F.now);
ok('Now sums today, like Today', near(N.home, R.home) && N.idx.length === R.idx.length);

// ---------------------------------------------------------------- the usual day's window
var M7 = EP.__buildModel(Object.assign({}, F.plan, { page: { typical: 7 } }), F.prefs, F.info);
var R7 = EP.__calc(M7, D, 'day', F.now);
var by7 = 0;
for (var i = F.dAxis.length - 8; i < F.dAxis.length - 1; i++) {
  by7 += Math.max(0, (F.d['sensor.main_power_utility'][i] || 0) - (F.d['sensor.battery_charge_consumption'][i] || 0) +
                     (F.d['sensor.battery_output_consumption'][i] || 0));
}
ok('A Typical Day: The 7 Days Before', near(R7.typ.home, by7 / 7), [R7.typ.home, by7 / 7]);

// ---------------------------------------------------------------- without HA's settings
var Mp = EP.__buildModel(F.plan, {}, {});
var Rp = EP.__calc(Mp, D, 'day', F.now);
ok('no energy/get_prefs: the plan\'s whole-home meter and cost', Mp.src.imp[0] === 'sensor.main_power_utility' &&
   near(Rp.home, 33.031) && near(Rp.cost, 4.612), [Rp.home, Rp.cost]);
ok('...and its devices are counted unless the plan nests them', Mp.devs.filter(function (d) { return d.name === 'Network Rack'; })[0].counted === false);

// ---------------------------------------------------------------- the older grid shape
var older = { energy_sources: [{ type: 'grid', flow_from: [{ stat_energy_from: 'sensor.a', stat_cost: 'sensor.a_cost' }],
  flow_to: [{ stat_energy_to: 'sensor.b', stat_compensation: 'sensor.b_comp' }] }, { type: 'solar', stat_energy_from: 'sensor.sun' },
  { type: 'gas', stat_energy_from: 'sensor.gas', stat_cost: null }] };
var so = EP.__sources(older, { cost_sensors: { 'sensor.gas': 'sensor.gas_cost' } });
ok('flow_from / flow_to grids, solar and gas, with energy/info\'s cost sensor', so.imp[0] === 'sensor.a' && so.cost[0] === 'sensor.a_cost' &&
   so.exp[0] === 'sensor.b' && so.comp[0] === 'sensor.b_comp' && so.solar[0] === 'sensor.sun' && so.gas.cost[0] === 'sensor.gas_cost', so);

// ---------------------------------------------------------------- highlights
var money = function (v, d) { return '$' + v.toFixed(d); };
var hass = { states: {} };
var hl = EP.__highlights(M, R, hass, money);
ok('today has four highlights', hl.length === 4, hl.map(function (x) { return x.t; }));
ok('...the first is the busiest hour', /busiest hour/.test(hl[0].t), hl[0].t);
ok('...one says the battery charged 2.3 kWh', hl.some(function (x) { return /charged 2\.3 kWh/.test(x.t); }));
var hlm = EP.__highlights(M, Mo, hass, money);
ok('every highlight says what it is about, for its tap', hl.every(function (x) { return !!(x.more || x.sec); }) &&
   hl.some(function (x) { return x.more === 'sensor.main_power_utility'; }), hl.map(function (x) { return x.more; }));
ok('the month has four too (the day that used the most first)', hlm.length === 4 && /used the most/.test(hlm[0].t), hlm.map(function (x) { return x.t; }));

// ---------------------------------------------------------------- AC runtime
ok('a daily runtime bar is linked to its device by name ("Upstairs AC Runtime" is the Upstairs AC\'s)',
   byName['Upstairs AC'].runtime === 'sensor.upstairs_hvac_run_time' && byName['Downstairs AC'].runtime === 'sensor.downstairs_hvac_run_time' &&
   !byName['Upstairs Air'].runtime, [byName['Upstairs AC'].runtime, byName['Upstairs Air'].runtime]);
ok('...and asked for in one request', M.runtimes.length === 2, M.runtimes);
var Fp2 = JSON.parse(JSON.stringify(F.plan));
Fp2.usages.forEach(function (u) { if (u.runtime) u.name = u.name.replace('AC Runtime', 'HVAC Run Time'); });
var M2 = EP.__buildModel(Fp2, F.prefs, F.info), up2 = M2.devs.filter(function (d) { return d.name === 'Upstairs AC'; })[0];
ok('..."Upstairs HVAC Run Time" is the Upstairs AC\'s too (HVAC is AC; Run Time is not part of the name)',
   up2.runtime === 'sensor.upstairs_hvac_run_time' && !M2.devs.filter(function (d) { return d.name === 'Upstairs Air'; })[0].runtime);
// two hours every day before today, 0.4 h so far today
var RT = {};
M.runtimes.forEach(function (id) {
  RT[id] = F.dAxis.map(function (t, i) { return { t: new Date(t), v: i === F.dAxis.length - 1 ? 0.4 : 2 }; });
});
var Rr = EP.__calc(M, D, 'day', F.now, RT);
var up = Rr.devices.filter(function (r) { return r.d.name === 'Upstairs AC'; })[0];
ok('today\'s runtime and the usual day\'s', up.rt && near(up.rt.v, 0.4) && near(up.rt.usual, 2), up.rt);
var Rw = EP.__calc(M, D, 'week', F.now, RT);
ok('a week\'s runtime is its days\' sum (Sunday 2 h, today 0.4)', near(Rw.devices.filter(function (r) { return r.d.name === 'Upstairs AC'; })[0].rt.v, 2.4));
var hlr = EP.__highlights(M, Rr, hass, money);
ok('an AC well under its usual hours is a highlight', hlr.some(function (x) { return /Upstairs AC ran 24m<\/b> today, \d+% less than usual by now/.test(x.t) ||
   /Downstairs AC ran 24m<\/b> today/.test(x.t); }), hlr.map(function (x) { return x.t; }));
ok('hours read as hours and minutes', EP.__hm(1.9166) === '1h 55m' && EP.__hm(0.4) === '24m' && EP.__hm(0) === '0m');

// ---------------------------------------------------------------- the page's API
ok('the API keeps its model apart from its cache (sectionColor before any model)', typeof EP.getModel === 'function' &&
   EP.sectionColor('rooms') === null);
EP.cache = M;
ok('...and a section\'s color once there is one', EP.sectionColor('rooms') === '#bf5af2' && EP.sectionColor('nope') === null);
EP.cache = null;
ok('the tab starts on the plan\'s Opens On, else Now', EP.getPeriod() === 'now');

// ---------------------------------------------------------------- the screensaver's Home Energy
// (hk-saver-energy.js reads window.hkEnergy.summary): the page's own sums,
// plus the hour Home Assistant has not closed yet, from five-minute changes
(function () {
  var H = window.hkEnergy;
  if (!H || !H.summary) { ok('the summary is exported for the screensaver', false); return; }
  var S = window.hkStats, saved = { hourly: S.hourly, daily: S.daily, fiveMinute: S.fiveMinute, weekStart: S.weekStart };
  var savedHS = window.hkSettings;
  window.hkSettings = { get: function (k, dflt) { return k === 'energy' ? F.plan : dflt; } };
  EP.prefs = F.prefs; EP.info = F.info; EP.prefsAt = Date.now(); EP.cache = null;
  // the open hour: 14:00 has no hourly bucket yet (the fixture's last is
  // null); ten closed five-minute buckets from 14:00, each 0.1 kWh drawn,
  // 2 cents, 1 gallon; the eleventh still open
  var t14 = F.hAxis[F.hAxis.length - 1], five = {};
  M.ids.forEach(function (id) {
    five[id] = [];
    for (var k = 0; k < 12; k++) {
      var val = k >= 10 ? null : id === 'sensor.main_power_utility' ? 0.1 : id === 'sensor.main_power_utility_cost' ? 0.02 :
                id === 'sensor.droplet_water_integrated' ? 1 : 0;
      five[id].push({ t: new Date(t14 + k * 3e5), v: val });
    }
  });
  var asked = [];
  S.hourly = function (h, ids) { asked.push(ids); return D.h; };
  S.daily = function () { return D.d; };
  S.fiveMinute = function (h, ids, n, card, o) { return o && o.type === 'change' ? five : null; };
  S.weekStart = function () { return 0; };
  var hass = { states: {}, callWS: function () { return new Promise(function () {}); } };
  var waker = { isConnected: true, requestUpdate: function () {}, redraw: function () {} };
  var s1 = H.summary(hass, waker, F.now);
  var R1 = EP.__calc(M, D, 'day', F.now);
  ok('Home Energy: today is the page\'s Today and the open hour on top (30.77 + 1.00 kWh)', s1 && near(s1.today.energy, R1.home + 1.0, 0.001), s1 && s1.today);
  ok('...its cost and water too', s1 && near(s1.today.cost, R1.cost + 0.2, 0.001) && near(s1.today.water, R1.water + 10, 0.001));
  ok('...up to the last closed five minutes (14:50)', s1 && s1.asOf === t14 + 50 * 6e4, s1 && new Date(s1.asOf));
  ok('...house totals load independently before attribution circuits', asked[0].indexOf('sensor.main_power_utility') >= 0 && asked[0].length < M.ids.length && asked[1].length === 23, asked);
  var cause = EP.__contributor;
  var cx = { src: M.src, devs: [{ counted: true, stat: 'fixture.cool', name: 'Upstairs AC' }, { counted: false, stat: 'fixture.child', name: 'Child' }] };
  var ch = Object.assign({}, D.h), cd = Object.assign({}, D.d), cf = {}, cT = R1;
  ch['fixture.cool'] = D.h[M.src.imp[0]].map(function(q,i) { return {t:q.t,v:cT.hToday.indexOf(i)>=0 && q.v!=null ? 0.8 : q.v==null ? null : 0.01}; });
  cd['fixture.cool'] = D.d[M.src.imp[0]].map(function(q) { return {t:q.t,v:0.5}; });
  cf['fixture.cool'] = five[M.src.imp[0]].map(function(q) { return {t:q.t,v:q.v}; });
  var c = cause(cx, {h:ch,d:cd}, cf, cT, s1.asOf, 2);
  ok('...measured AC increase produces a human cooling explanation', c && c.name === 'extra cooling', c);
  ok('...no explanation when home is below usual', cause(cx,{h:ch,d:cd},cf,cT,s1.asOf,-2) === null);
  var row = ch['fixture.cool'][cT.hToday[0]], stamp = row.t; row.t = new Date(+row.t - 36e5);
  ok('...previous-bucket stand-ins cannot shift circuit attribution', cause(cx,{h:ch,d:cd},cf,cT,s1.asOf,2) === null);
  row.t = stamp;
  cf['fixture.cool'][2].v = null;
  ok('...missing open-hour readings suppress attribution', cause(cx,{h:ch,d:cd},cf,cT,s1.asOf,2) === null);
  var Mo = EP.__calc(M, D, 'month', F.now, null, { back: 0, ws: 0 });
  ok('...the month so far: the page\'s This Month and the open hour', s1 && near(s1.month.energy, Mo.home + 1.0, 0.001), s1 && s1.month);
  ok('...where the month\'s cost is heading: so far, and a usual day for each day left',
     s1 && s1.projCost > s1.month.cost && s1.projCost < s1.month.cost + 31 * R1.typ.cost, s1 && [s1.month.cost, s1.projCost]);
  ok('...the rings: energy, cost, water, each against a usual day, each with its own dot', s1 &&
     s1.rings.map(function (r) { return r.key; }).join() === 'energy,cost,water' &&
     s1.rings.every(function (r) { return r.typ > 0 && r.tick > 0 && r.tick < 1; }), s1 && s1.rings);
  ok('...yesterday by now is less than all of yesterday', s1 && s1.yday > 0 && s1.yday < R1.typ.home * 3, s1 && s1.yday);
  ok('...nothing from five-minute statistics yet: today as the page has it, up to the last closed hour', (function () {
    S.fiveMinute = function () { return null; };
    var s2 = H.summary(hass, waker, F.now);
    return s2 && near(s2.today.energy, R1.home, 0.001) && s2.asOf === t14;
  })());
  var svg = H.ringSvg([{ key: 'energy', c: '#ff9f0a', f: 0.3, tick: 0.4 }, { key: 'cost', c: '#30d158', f: 0.5, tick: null }], null, 0);
  ok('the rings: a dot only on a ring with a usual by now', (svg.match(/class="tick"/g) || []).length === 1, svg);
  S.hourly = saved.hourly; S.daily = saved.daily; S.fiveMinute = saved.fiveMinute; S.weekStart = saved.weekStart;
  window.hkSettings = savedHS; EP.cache = null; EP.prefs = null;
})();

print(fail ? 'FAIL ' + fail + ' ENERGY SUMS TESTS' : 'ALL ' + pass + ' ENERGY SUMS TESTS PASS');
