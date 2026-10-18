// Raw history keeps recorder timestamps, and line() uses elapsed time.
var root = HK_ROOT, pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }
// line() draws in the house palette, which hk-charts reads from hk-base.js
// (window.hkCards.PALETTE) when a chart is drawn -- in a browser every caller
// is an hk card, so hk-base.js has already run. It needs the DOM shim to load;
// the shim's timers only run on demand, so the real setTimeout this suite
// waits on below is put back.
var realSetTimeout = setTimeout;
load(root + '/tests/dom.js');
load(root + '/frontend/cards/hk-base.js');
globalThis.setTimeout = realSetTimeout;
globalThis.window = globalThis;
globalThis.console = { warn: function () {}, error: function () {}, info: function () {} };
globalThis.addEventListener = function () {};
globalThis.dispatchEvent = function () {};
globalThis.CustomEvent = function () {};
load(root + '/frontend/modules/hk-stats.js');
load(root + '/frontend/modules/hk-charts.js');

var rows = [[
  { state: '10', last_changed: '2026-09-15T10:00:00Z' },
  { state: '20', last_changed: '2026-09-15T11:00:00Z' },
  { state: '30', last_changed: '2026-09-15T13:00:00Z' }
]];
var hass = { callApi: function () { return Promise.resolve(rows); } };
hkStats.history(hass, 'sensor.power', 3, null);
setTimeout(function () {
  var points = hkStats.history(hass, 'sensor.power', 3, null);
  check('history returns timestamped values',
        points.length === 3 && points[1].v === 20 && points[1].t instanceof Date);
  var timed = hkChart.line(points, { height: 100 });
  check('the middle point sits at one third of elapsed time',
        timed.indexOf('L253.3 ') !== -1);
  var numeric = hkChart.line([10, 20, 30], { height: 100 });
  check('numeric callers retain equal spacing', numeric.indexOf('L380.0 ') !== -1);
  print(fail ? 'FAIL ' + fail + ' HISTORY TESTS' : 'ALL ' + pass + ' HISTORY TESTS PASS');
}, 0);
