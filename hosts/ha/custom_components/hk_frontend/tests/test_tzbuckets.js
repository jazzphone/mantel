// hk-stats time buckets: they belong to HOME ASSISTANT's timezone.
//
// TWO TRAPS ARE PINNED HERE.
//
// 1. THE REMOTE CLIENT. The recorder buckets `period: day` at midnight in HA's
//    configured zone: in New York a day bucket starts at 04:00Z, midnight
//    EDT. An axis built with setHours(0,0,0,0) -- the browser's midnight --
//    with rows matched by EXACT timestamp matches not one key in a browser in
//    another zone, so every bucket stays null and the chart is blank -- no
//    error, no clue.
//
// 2. DST, WHICH NEEDS NO TRAVEL AT ALL. An hourly axis stepped with
//    setHours(getHours() - i), wall-clock arithmetic, runs ...05:00Z, 07:00Z
//    across the America/New_York fall-back: the 06:00Z bucket (the repeated
//    1 AM) has no slot and one hour of that night is dropped, every year, in
//    the home's own timezone.
//
// These tests drive the module with a FIXED clock and a fixed zone so the
// boundaries are exact rather than "whatever today happens to be".
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

globalThis.window = globalThis;
var warned = [];
globalThis.console = { warn: function () { warned.push([].slice.call(arguments).join(' ')); },
                       error: function () {}, info: function () {}, log: function () {} };
load(root + '/frontend/modules/hk-stats.js');
var S = window.hkStats;

// A clock the test owns. hk-stats reads Date.now() for the newest bucket.
var REAL_NOW = Date.now;
function at(iso, fn) {
  var t = +new Date(iso);
  Date.now = function () { return t; };
  try { return fn(); } finally { Date.now = REAL_NOW; }
}

// A connection that only has to carry a zone and a callWS that never lands --
// every assertion here is about the axis, which is built before the request.
function hassIn(tz) {
  return { config: { time_zone: tz }, callWS: function () { return new Promise(function () {}); } };
}
function iso(d) { return new Date(d).toISOString(); }

// The module only adopts a zone through a public call, so make one. The result
// is null (nothing cached yet) and irrelevant; the side effect is the point.
function adopt(tz) { S.daily(hassIn(tz), 'sensor.x', 2, null); }

// ---------------------------------------------------------------- the zone
adopt('America/New_York');
check('the HA timezone is adopted from hass.config', S.tz() === 'America/New_York');

// --- 1. DAY BUCKETS ARE HA MIDNIGHT, WHEREVER THE BROWSER IS --------------
// Asserted as an absolute instant, so it holds whatever zone jsc is run in.
// 2026-09-10 in New York is EDT (UTC-4), so midnight is 04:00Z.
at('2026-09-12T18:30:00Z', function () {
  var rows = [{ start: '2026-09-10T04:00:00.000Z', change: 5 },
              { start: '2026-09-11T04:00:00.000Z', change: 6 },
              { start: '2026-09-12T04:00:00.000Z', change: 7 }];
  var got = S.__align(rows, 'day', 3, 'change');
  check('three HA-midnight day buckets all land', got[0].v === 5 && got[1].v === 6 && got[2].v === 7);
  check('the newest day bucket starts at HA midnight, not browser midnight',
        iso(got[2].t) === '2026-09-12T04:00:00.000Z');
  check('day buckets are exactly 24h apart outside a transition',
        got[2].t - got[1].t === 864e5);
});

// A browser in another zone must get the SAME buckets. This is the blank-chart
// case: an exact-timestamp match finds a slot for none of these rows.
at('2026-09-12T18:30:00Z', function () {
  var rows = [{ start: '2026-09-11T04:00:00.000Z', change: 6 },
              { start: '2026-09-12T04:00:00.000Z', change: 7 }];
  var got = S.__align(rows, 'day', 2, 'change');
  check('a client anywhere still receives HA-day buckets',
        got[0].v === 6 && got[1].v === 7);
});

// --- 2. FALL-BACK: 25 HOURS, NONE SKIPPED, NONE DUPLICATED ----------------
// 2026-11-01 America/New_York: 02:00 EDT becomes 01:00 EST. 05:00Z and 06:00Z
// are two DIFFERENT real hours that both read "1 AM", and the recorder has a
// bucket for each.
at('2026-11-01T08:00:00Z', function () {           // 03:00 EST
  var rows = [];
  for (var h = 0; h <= 8; h++) {
    rows.push({ start: iso(Date.UTC(2026, 10, 1, h)), change: h });
  }
  var got = S.__align(rows, 'hour', 9, 'change');
  check('every one of the nine real hours has a slot',
        got.length === 9 && got.every(function (r) { return r.v !== null; }));
  check('the repeated 1 AM hour (06:00Z) is NOT dropped',
        got.some(function (r) { return iso(r.t) === '2026-11-01T06:00:00.000Z'; }));
  check('no two hourly slots are the same instant',
        new Set(got.map(function (r) { return +r.t; })).size === 9);
  check('hourly slots are exactly one real hour apart across the transition',
        got.every(function (r, i) { return i === 0 || (r.t - got[i - 1].t) === 36e5; }));
  check('each hour keeps its own value in order',
        got.map(function (r) { return r.v; }).join(',') === '0,1,2,3,4,5,6,7,8');
});

// A fall-back DAY is 25 hours long, so the day axis must not assume 24.
at('2026-11-02T18:00:00Z', function () {
  var got = S.__align([], 'day', 3, 'change');
  // got = [Oct 31, Nov 1, Nov 2] midnights, so the interval that CONTAINS
  // the transition is the second one: the length of Nov 1 itself.
  check('the day before the transition is a normal 24 hours',
        got[1].t - got[0].t === 864e5);
  check('the fall-back day is 25 hours long on the day axis',
        got[2].t - got[1].t === 25 * 36e5);
  check('no date is duplicated across the fall-back',
        new Set(got.map(function (r) { return +r.t; })).size === 3);
});

// --- SPRING FORWARD: a 23-hour day, and an hour that does not exist --------
// 2026-03-08 America/New_York: 02:00 EST jumps to 03:00 EDT.
at('2026-03-09T18:00:00Z', function () {
  var got = S.__align([], 'day', 3, 'change');
  // got = [Mar 7, Mar 8, Mar 9]; Mar 8 is the short day.
  check('the spring-forward day is 23 hours long',
        got[2].t - got[1].t === 23 * 36e5);
  check('no date is skipped across spring forward',
        new Set(got.map(function (r) { return +r.t; })).size === 3);
  check('every spring-forward day boundary is a real HA midnight',
        got.every(function (r) {
          return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
            hour12: false, hour: '2-digit' }).format(r.t).replace('24', '00') === '00';
        }));
});

// --- MISSING BUCKETS STAY EXPLICIT NULLS ----------------------------------
at('2026-09-12T18:30:00Z', function () {
  var rows = [{ start: '2026-09-10T04:00:00.000Z', change: 5 },
              // 09-11 absent
              { start: '2026-09-12T04:00:00.000Z', change: 7 }];
  var got = S.__align(rows, 'day', 3, 'change');
  check('a missing day is a null hole, not a shift',
        got[0].v === 5 && got[1].v === null && got[2].v === 7);
  check('a non-finite value is normalised to null',
        S.__align([{ start: '2026-09-12T04:00:00.000Z', change: NaN }],
                  'day', 1, 'change')[0].v === null);
});

// --- A ZONE WITH A HALF-HOUR OFFSET ---------------------------------------
// Kolkata is UTC+5:30 with no DST: midnight there is 18:30Z the day before.
// It is the case that a "floor to the UTC hour" shortcut would get wrong.
adopt('Asia/Kolkata');
at('2026-09-12T10:00:00Z', function () {
  var got = S.__align([], 'day', 2, 'change');
  check('a half-hour-offset zone floors to its own midnight',
        iso(got[1].t) === '2026-09-11T18:30:00.000Z');
});

// --- FIVE-MINUTE BUCKETS (the Energy page's live lines) --------------------
// Steps of exactly 300 000 ms ending in the bucket we are inside, and rows
// placed by range: a row at 18:25Z lands in the 18:25 slot, the open 18:30
// bucket stays null until the recorder closes it.
adopt('America/New_York');
at('2026-09-12T18:31:40Z', function () {
  var got = S.__align([{ start: '2026-09-12T18:25:00.000Z', mean: 412 },
                       { start: '2026-09-12T18:20:00.000Z', mean: 380 }], '5minute', 4, 'mean');
  check('a five-minute axis ends in the bucket we are inside', iso(got[3].t) === '2026-09-12T18:30:00.000Z');
  check('five-minute buckets step 300 000 ms', got[3].t - got[2].t === 3e5 && got[1].t - got[0].t === 3e5);
  check('five-minute rows land in their slots', got[2].v === 412 && got[1].v === 380 && got[0].v === null);
  check('the open five-minute bucket is null', got[3].v === null);
});
// A half-hour zone still has five-minute edges on the UTC grid.
adopt('Asia/Kolkata');
at('2026-09-12T10:07:00Z', function () {
  var got = S.__align([], '5minute', 2, 'mean');
  check('five-minute edges hold in a half-hour zone', iso(got[1].t) === '2026-09-12T10:05:00.000Z');
});
adopt('America/New_York');

// --- THE FALLBACK: AN Intl THAT CANNOT DO ZONES ---------------------------
// Documented and tested rather than silently returning browser-local buckets.
(function () {
  var realDTF = Intl.DateTimeFormat;
  warned.length = 0;
  Intl.DateTimeFormat = function (l, o) {
    if (o && o.timeZone === 'Mars/Olympus') throw new RangeError('unknown zone');
    return new realDTF(l, o);
  };
  try {
    adopt('Mars/Olympus');
    check('an unresolvable zone is refused, not adopted', S.tz() !== 'Mars/Olympus');
    check('an unresolvable zone says so once', warned.some(function (w) {
      return w.indexOf('cannot resolve') !== -1;
    }));
    at('2026-09-12T18:30:00Z', function () {
      var got = S.__align([], 'day', 2, 'change');
      check('the fallback still produces a usable axis',
            got.length === 2 && got[1].t - got[0].t === 864e5);
    });
  } finally { Intl.DateTimeFormat = realDTF; }
})();

print(fail ? 'FAIL ' + fail + ' TZ BUCKET TESTS' : 'ALL ' + pass + ' TZ BUCKET TESTS PASS');
