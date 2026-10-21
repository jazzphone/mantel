// THE ENERGY PAGE'S SUMS (hk-energy.js, window.hkEnergyPage.__calc), driven
// with AN INVENTED SAMPLE HOUSE'S NUMBERS: its plan (the settings feed's `energy`), its
// Home Assistant Energy settings (energy/get_prefs, energy/info), and 49 hours
// and 61 days of its statistics, as of Monday 2026-10-19 14:53 MDT (the house is
// in Denver; tests/run sets TZ to match) and aligned the way hk-stats aligns
// them (tests/fixtures/sample_energy.json, made by a seeded generator).
//
// THE EXPECTED FIGURES ARE NOT THE CODE'S OWN. Today's, the week's, the
// month's and the usual day's were summed separately from the raw statistics
// (grid 28.74 kWh, $2.85, battery charged 3.52 kWh, water 38.78 gal today),
// following Home Assistant's Energy dashboard's formulas. A sum here that
// drifts from them is a page that disagrees with Home Assistant.
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

var F = JSON.parse(read(HK_ROOT + '/tests/fixtures/sample_energy.json'));
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
   JSON.stringify(M.src.imp) === '["sensor.grid_import_energy"]' && JSON.stringify(M.src.cost) === '["sensor.grid_import_energy_cost"]', M.src);
ok('the battery\'s meters: charge in, output out', M.src.battery && M.src.into[0] === 'sensor.battery_charged_energy' &&
   M.src.out[0] === 'sensor.battery_discharged_energy', M.src);
ok('water is a source of its own', M.src.water.ids[0] === 'sensor.water_meter_total', M.src.water);
var byName = {};
M.devs.forEach(function (d) { byName[d.name] = d; });
ok('a device in HA\'s settings is counted', byName['Workshop Outlets'].counted && byName['Study'].counted);
ok('a device HA marks as inside another is not counted twice (Server Closet in Workshop Outlets)', !byName['Server Closet'].counted);
ok('a device HK adds by itself is a tile but not counted (Battery Charge)', byName['Battery Charge'] && !byName['Battery Charge'].counted);
ok('22 devices counted, as HA counts them', M.devs.filter(function (d) { return d.counted; }).length === 22,
   M.devs.filter(function (d) { return d.counted; }).length);
ok('each section keeps its own color', M.sections[0].color === '#5ac8fa' && M.sections[1].color === '#bf5af2');
ok('the house battery is the plan\'s house battery', M.house && M.house.house === true);

// ---------------------------------------------------------------- today
var R = EP.__calc(M, D, 'day', F.now);
ok('today: the house used grid 28.74 - battery charge 3.52 = 25.22 kWh (HA\'s formula)', near(R.home, 25.223), R.home);
ok('today\'s cost is HA\'s: $2.85', near(R.cost, 2.851), R.cost);
ok('today\'s water is HA\'s: 38.78 gal', near(R.water, 38.776), R.water);
ok('the battery charged 3.52 kWh, gave back none', near(R.into, 3.52) && near(R.out, 0), [R.into, R.out]);
ok('on a device + not on a device = what the house used', near(R.onDevice + R.untracked, R.home), [R.onDevice, R.untracked]);
ok('on a device today: 23.38 kWh, the rest 1.84', near(R.onDevice, 23.38) && near(R.untracked, 1.843), [R.onDevice, R.untracked]);
ok('fifteen hours of today so far', R.idx.length === 15, R.idx.length);
ok('a usual day is the 30 before today: 44.56 kWh', near(R.typ.home, 44.560), R.typ.home);
ok('how much of a usual day has gone by, from yesterday\'s shape', R.share > 0.3 && R.share < 0.8, R.share);
ok('the projection is today over that share', near(R.proj, R.home / R.share, 0.001));
var secSum = R.secs.reduce(function (a, s) { return a + s.v; }, 0);
ok('the sections add up to what is on a device', near(secSum, R.onDevice), [secSum, R.onDevice]);

// ---------------------------------------------------------------- the week and the month
// CALENDAR PERIODS (the fixture is Monday 2026-10-19 14:53): the week from
// Sunday Oct 18, the month from Oct 1. Summed separately from the raw
// statistics, as the figures above were.
var W = EP.__calc(M, D, 'week', F.now);
ok('this week (Sun Oct 18 - Mon): 70.56 kWh, $8.08', near(W.home, 70.561) && near(W.cost, 8.083), [W.home, W.cost]);
ok('...seven slots, Sunday and today with days, the five to come without', W.n === 7 && W.slots.length === 7 && W.idx.length === 2 &&
   W.slots[1] === F.dAxis.length - 1 && W.slots.slice(2).every(function (x) { return x === null; }) && W.todayK === 1, W.slots);
ok('...the days gone: one whole day and today\'s part (R.n x R.pshare)', near(W.n * W.pshare, 1 + W.share, 1e-9) && near(W.days, 1 + W.share, 1e-9));
ok('...each day to come carries last week\'s same day (Tue Oct 13 ...)', W.ghosts[0] === null && W.ghosts[1] === null &&
   W.ghosts[2] === F.dAxis.length - 7 && W.ghosts[6] === F.dAxis.length - 3, W.ghosts);
ok('...last week by now: Sun Oct 11 and Mon Oct 12 as far as today has gone', W.prev.byNow &&
   near(W.prev.home, 55.426 + 47.936 * W.share, 0.02) && near(W.prev.allHome, 298.950), [W.prev.home, W.prev.allHome]);
ok('...heading for: so far and a usual day for each day left', near(W.proj, W.home + W.typ.home * (7 - W.days), 1e-6), W.proj);
var Mo = EP.__calc(M, D, 'month', F.now);
ok('this month (Oct 1-19): 859.94 kWh, $104.46, 2,198.06 gal', near(Mo.home, 859.941) && near(Mo.cost, 104.457) && near(Mo.water, 2198.062),
   [Mo.home, Mo.cost, Mo.water]);
ok('...thirty-one slots, nineteen with days', Mo.n === 31 && Mo.idx.length === 19 && Mo.todayK === 18);
ok('...September by now: the 1st to the 18th and the 19th as far as today has gone, of 1,250.87 in all',
   near(Mo.prev.home, 748.787 + 37.353 * Mo.share, 0.02) && near(Mo.prev.allHome, 1250.867), [Mo.prev.home, Mo.prev.allHome]);
// A PERIOD BEFORE THIS ONE: whole, against the one before it in full
var W1 = EP.__calc(M, D, 'week', F.now, null, { back: 1 });
ok('last week (Oct 11-17): 298.95 kWh, every day there, nothing to come', near(W1.home, 298.950) && W1.idx.length === 7 && !W1.cur &&
   W1.todayK === -1 && W1.ghosts.every(function (x) { return x === null; }) && !W1.prev.byNow, [W1.home, W1.idx.length]);
ok('...its usual day is the 30 before it, and it heads for itself', W1.tw.length === 30 && W1.tw[29] === F.dAxis.length - 10 && near(W1.proj, W1.home));
var Mo1 = EP.__calc(M, D, 'month', F.now, null, { back: 1 });
ok('September: 1,250.87 kWh over its 30 days', near(Mo1.home, 1250.867) && Mo1.n === 30 && Mo1.idx.length === 30, [Mo1.home, Mo1.n]);
// A COST SENSOR THAT STARTED OVER: the fixture's Aug 25 holds HA's own -$412
// reset; that day is priced at the meter's rate, so no period goes negative
var Au = EP.__calc(M, D, 'month', F.now, null, { back: 2 });
var aug25 = Au.idx.filter(function (i) { return new Date(F.dAxis[i]).getDate() === 25; })[0];
ok('August with its reset day: a cost, never below zero (Aug 25 at the meter\'s own rate)', Au.cost > 0 &&
   F.d['sensor.grid_import_energy_cost'][aug25] < -400 && Au.idx.length === 12, [Au.cost, Au.idx.length]);
var Wm = EP.__calc(M, D, 'week', F.now, null, { ws: 1 });
ok('a week from Monday (the user\'s first day): today alone so far, 25.22 kWh as on Today', Wm.idx.length === 1 && Wm.idx[0] === F.dAxis.length - 1 &&
   Wm.todayK === 0 && near(Wm.home, 25.223), [Wm.idx, Wm.home]);
var N = EP.__calc(M, D, 'now', F.now);
ok('Now sums today, like Today', near(N.home, R.home) && N.idx.length === R.idx.length);

// ---------------------------------------------------------------- the usual day's window
var M7 = EP.__buildModel(Object.assign({}, F.plan, { page: { typical: 7 } }), F.prefs, F.info);
var R7 = EP.__calc(M7, D, 'day', F.now);
var by7 = 0;
for (var i = F.dAxis.length - 8; i < F.dAxis.length - 1; i++) {
  by7 += Math.max(0, (F.d['sensor.grid_import_energy'][i] || 0) - (F.d['sensor.battery_charged_energy'][i] || 0) +
                     (F.d['sensor.battery_discharged_energy'][i] || 0));
}
ok('A Typical Day: The 7 Days Before', near(R7.typ.home, by7 / 7), [R7.typ.home, by7 / 7]);

// ---------------------------------------------------------------- without HA's settings
var Mp = EP.__buildModel(F.plan, {}, {});
var Rp = EP.__calc(Mp, D, 'day', F.now);
ok('no energy/get_prefs: the plan\'s whole-home meter and cost', Mp.src.imp[0] === 'sensor.grid_import_energy' &&
   near(Rp.home, 28.743) && near(Rp.cost, 2.851), [Rp.home, Rp.cost]);
ok('...and its devices are counted unless the plan nests them', Mp.devs.filter(function (d) { return d.name === 'Server Closet'; })[0].counted === false);

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
ok('...one says the battery charged 3.5 kWh', hl.some(function (x) { return /charged 3\.5 kWh/.test(x.t); }));
var hlm = EP.__highlights(M, Mo, hass, money);
ok('every highlight says what it is about, for its tap', hl.every(function (x) { return !!(x.more || x.sec); }) &&
   hl.some(function (x) { return x.more === 'sensor.grid_import_energy'; }), hl.map(function (x) { return x.more; }));
ok('the month has four too (the day that used the most first)', hlm.length === 4 && /used the most/.test(hlm[0].t), hlm.map(function (x) { return x.t; }));

// ---------------------------------------------------------------- AC runtime
ok('a daily runtime bar is linked to its device by name ("Loft AC Runtime" is the Loft AC\'s)',
   byName['Loft AC'].runtime === 'sensor.loft_hvac_run_time' && byName['Main Floor AC'].runtime === 'sensor.main_floor_hvac_run_time' &&
   !byName['Loft Air'].runtime, [byName['Loft AC'].runtime, byName['Loft Air'].runtime]);
ok('...and asked for in one request', M.runtimes.length === 2, M.runtimes);
var Fp2 = JSON.parse(JSON.stringify(F.plan));
Fp2.usages.forEach(function (u) { if (u.runtime) u.name = u.name.replace('AC Runtime', 'HVAC Run Time'); });
var M2 = EP.__buildModel(Fp2, F.prefs, F.info), up2 = M2.devs.filter(function (d) { return d.name === 'Loft AC'; })[0];
ok('..."Loft HVAC Run Time" is the Loft AC\'s too (HVAC is AC; Run Time is not part of the name)',
   up2.runtime === 'sensor.loft_hvac_run_time' && !M2.devs.filter(function (d) { return d.name === 'Loft Air'; })[0].runtime);
// two hours every day before today, 0.4 h so far today
var RT = {};
M.runtimes.forEach(function (id) {
  RT[id] = F.dAxis.map(function (t, i) { return { t: new Date(t), v: i === F.dAxis.length - 1 ? 0.4 : 2 }; });
});
var Rr = EP.__calc(M, D, 'day', F.now, RT);
var up = Rr.devices.filter(function (r) { return r.d.name === 'Loft AC'; })[0];
ok('today\'s runtime and the usual day\'s', up.rt && near(up.rt.v, 0.4) && near(up.rt.usual, 2), up.rt);
var Rw = EP.__calc(M, D, 'week', F.now, RT);
ok('a week\'s runtime is its days\' sum (Sunday 2 h, today 0.4)', near(Rw.devices.filter(function (r) { return r.d.name === 'Loft AC'; })[0].rt.v, 2.4));
var hlr = EP.__highlights(M, Rr, hass, money);
ok('an AC well under its usual hours is a highlight', hlr.some(function (x) { return /Loft AC ran 24m<\/b> today, \d+% less than usual by now/.test(x.t) ||
   /Main Floor AC ran 24m<\/b> today/.test(x.t); }), hlr.map(function (x) { return x.t; }));
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
      var val = k >= 10 ? null : id === 'sensor.grid_import_energy' ? 0.1 : id === 'sensor.grid_import_energy_cost' ? 0.02 :
                id === 'sensor.water_meter_total' ? 1 : 0;
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
  ok('Home Energy: today is the page\'s Today and the open hour on top (25.22 + 1.00 kWh)', s1 && near(s1.today.energy, R1.home + 1.0, 0.001), s1 && s1.today);
  ok('...its cost and water too', s1 && near(s1.today.cost, R1.cost + 0.2, 0.001) && near(s1.today.water, R1.water + 10, 0.001));
  ok('...up to the last closed five minutes (14:50)', s1 && s1.asOf === t14 + 50 * 6e4, s1 && new Date(s1.asOf));
  ok('...house totals load independently before attribution circuits', asked[0].indexOf('sensor.grid_import_energy') >= 0 && asked[0].length < M.ids.length && asked[1].length === 22, asked);
  var cause = EP.__contributor;
  var cx = { src: M.src, devs: [{ counted: true, stat: 'fixture.cool', name: 'Loft AC' }, { counted: false, stat: 'fixture.child', name: 'Child' }] };
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
