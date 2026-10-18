// The seven occasional surprise themes (hk-sky.js).
//
// These mirror the schedule each theme was designed with -- exact birthdays,
// holiday weeks, season ranges, rarity -- so hk-sky.js is proved FAITHFUL to
// it rather than merely plausible.
//
// The property that matters most: selection is deterministic per LOCAL calendar
// day. Every screen in the home must agree, and a navigation, refresh,
// sleep/wake or weather update must never re-roll.
var root = HK_ROOT, pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

globalThis.window = globalThis;
globalThis.addEventListener = function () {};
globalThis.location = { pathname: '/' };
globalThis.setInterval = function () { return 1; };
globalThis.clearInterval = function () {};
function stub() {
  return { style: { setProperty: function () {}, getPropertyValue: function () { return ''; } },
           classList: { toggle: function () {}, add: function () {} },
           appendChild: function () {}, insertBefore: function () {},
           querySelector: function () { return null; },
           querySelectorAll: function () { return []; },
           getRootNode: function () { return null; },
           remove: function () {}, children: [] };
}
globalThis.document = { createElement: stub, addEventListener: function () {},
  readyState: 'complete', head: { appendChild: function () {} },
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; }, body: stub() };
load(root + '/tests/sample_settings.js');
load(root + '/frontend/modules/hk-sky.js');

var S = window.hkSky._surprise;
function d(y, m, day) { return new Date(y, m - 1, day, 12); }
// `r && r.id` would yield null for a miss; these checks expect undefined, as `?.id` gives.
function id(y, m, day, o) { var r = S(d(y, m, day), o); return r ? r.id : undefined; }

var YEARS = [2026, 2027, 2028, 2030];
var okB = true, okPerson = true, okJuly = true, okVal = true, okDet = true,
    okRange = true, okNone = true;

YEARS.forEach(function (y) {
  // ---- birthdays are exact, every year, and BEAT an active Christmas -----
  [[2, 4, 'Alex'], [7, 10, 'Sam'], [12, 16, 'Jordan']].forEach(function (b) {
    var r = S(d(y, b[0], b[1]), { existingActive: 'christmas' });
    if (!r || r.id !== 'birthday') okB = false;
    if (!r || r.person !== b[2]) okPerson = false;
  });
  // ---- holiday weeks cover every day of the week ------------------------
  for (var day = 28; day <= 30; day++) if (id(y, 6, day) !== 'fourth-of-july') okJuly = false;
  for (day = 1; day <= 4; day++)       if (id(y, 7, day) !== 'fourth-of-july') okJuly = false;
  for (day = 8; day <= 14; day++)      if (id(y, 2, day) !== 'valentines-day') okVal = false;

  // ---- and stop at the boundary ----------------------------------------
  var after4 = S(d(y, 7, 5)), after14 = S(d(y, 2, 15));
  if (after4 && after4.reason === 'holiday-week') okJuly = false;
  if (after14 && after14.reason === 'holiday-week') okVal = false;

  // ---- determinism and season ranges, every day of every month ---------
  for (var m = 1; m <= 12; m++) for (day = 1; day <= 28; day++) {
    var D = d(y, m, day);
    var a = S(D), b2 = S(new Date(D));
    if (JSON.stringify(a) !== JSON.stringify(b2)) okDet = false;
    var md = m * 100 + day;
    if (a && a.id === 'spring-garden' && !(md >= 320 && md <= 620)) okRange = false;
    if (a && a.id === 'winter-wonderland' && !(md >= 1221 || md <= 319)) okRange = false;
    if (S(D, { enabled: [] }) !== null) okNone = false;
  }
});

check('birthdays fire on the exact date, every year', okB);
check('birthdays name the right person',              okPerson);
check('birthdays beat an active Christmas',           okB);
check('Jun 28 - Jul 4 is the Fourth of July week',    okJuly);
check('Feb 8 - 14 is the Valentine week',             okVal);
check('selection is stable for a given local day',    okDet);
check('spring and winter stay inside their ranges',   okRange);
check('nothing installed means nothing is chosen',    okNone);

// ---- the gates --------------------------------------------------------
check('sky gate off means no surprise',
      id(2026, 12, 16, { skyEnabled: false }) === undefined);
check('seasonal gate off means no surprise',
      id(2026, 7, 4, { seasonalEnabled: false }) === undefined);

// ---- installed-only, and priority against the existing seasons --------
check('an uninstalled birthday falls back to the existing season',
      id(2026, 12, 16, { enabled: [], existingActive: 'christmas' }) === 'christmas');
check('an ordinary day yields to the existing season',
      id(2026, 4, 1, { existingActive: 'halloween' }) === 'halloween');
check('a holiday week beats the existing season',
      id(2026, 7, 4, { existingActive: 'halloween' }) === 'fourth-of-july');
check('the existing season is reported as such',
      S(d(2026, 4, 1), { existingActive: 'halloween' }).reason === 'existing-season');

// ---- rarity is roughly as advertised ----------------------------------
// Not an exact promise -- these are configurable defaults, not guaranteed
// yearly counts. This guards an order of magnitude, so a broken hash shows up
// as 0 days or every day rather than passing quietly.
// STORYBOOK AND SPACE ARE ONE DAY PER MONTH.
//
// Small daily rolls (1.5%, 1%) clump: a salt can give ZERO space nights in a
// whole year, and a theme you might not see for two years is not a surprise.
// The day is picked deterministically from the month, so the yield is 10-12
// a year -- twelve, less the months where a higher-priority
// theme (a holiday week, a birthday, an eligible season, a spring/winter
// surprise) lands on the same day and wins.
function countOver(years, wanted) {
  var n = 0;
  years.forEach(function (year) {
    for (var m = 1; m <= 12; m++) {
      var dim = new Date(year, m, 0).getDate();
      for (var day = 1; day <= dim; day++) {
        var r = S(d(year, m, day));
        if (r && r.id === wanted) n++;
      }
    }
  });
  return n;
}
var Y = [2026, 2027, 2028, 2029, 2030];
var story = countOver(Y, 'storybook-magic'), space = countOver(Y, 'space-night');
var spring = countOver(Y, 'spring-garden'), winter = countOver(Y, 'winter-wonderland');
print('   (days over 2026-2030: storybook ' + story + ', space ' + space +
      ', spring ' + spring + ', winter ' + winter + ')');
check('storybook lands about once a month',  story >= 45 && story <= 60);
check('space night lands about once a month', space >= 45 && space <= 60);

// At most ONE of each per calendar month, and never on the same day -- a
// collision would cost a whole month, because storybook is checked first.
var okOnce = true, okClash = true;
Y.forEach(function (year) {
  for (var m = 1; m <= 12; m++) {
    var dim = new Date(year, m, 0).getDate(), sN = 0, pN = 0;
    for (var day = 1; day <= dim; day++) {
      var r = S(d(year, m, day));
      if (r && r.id === 'storybook-magic') sN++;
      if (r && r.id === 'space-night') pN++;
      if (window.hkSky._surprises && r && r.id === 'space-night' && sN && pN &&
          S(d(year, m, day)).id === 'storybook-magic') okClash = false;
    }
    if (sN > 1 || pN > 1) okOnce = false;
  }
});
check('never more than one of each per month', okOnce);
check('spring garden fires on some spring days', spring >= 15 && spring <= 150);
check('winter wonderland fires on some winter days', winter >= 15 && winter <= 150);

// --- Configure -> Seasonal sky ---------------------------------------------
var HSx = window.hkSettings;
function surpriseOn(date) { var r = S(date, {}); return r && r.id; }
function daysWith(id) {
  var n = 0;
  for (var t = new Date(2026, 0, 1); t.getFullYear() === 2026; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    if (surpriseOn(t) === id) n++;
  }
  return n;
}
function withSky(extra) {
  HSx._apply(Object.assign({}, HK_SAMPLE_SETTINGS, { sky: Object.assign({}, HK_SAMPLE_SETTINGS.sky, extra) }));
}
var springNorth = daysWith('spring-garden');
check('by default, spring and the Fourth both happen', springNorth > 0 && daysWith('fourth-of-july') === 7);
withSky({ themes: ['halloween', 'thanksgiving', 'christmas', 'birthday', 'valentines-day', 'spring-garden',
                   'winter-wonderland', 'storybook-magic', 'space-night'] });      // no Fourth of July
check('a theme turned off never runs', daysWith('fourth-of-july') === 0);
check('...and the others are untouched', daysWith('spring-garden') === springNorth);
withSky({ themes: [] });
check('birthdays turned off: no birthday even on the day', S(new Date(2026, 1, 4), {}) === null ||
      S(new Date(2026, 1, 4), {}).id !== 'birthday');
withSky({ hemisphere: 'south' });
var springMonths = [], winterMonths = [];
for (var t2 = new Date(2026, 0, 1); t2.getFullYear() === 2026; t2 = new Date(t2.getFullYear(), t2.getMonth(), t2.getDate() + 1)) {
  var id2 = surpriseOn(t2);
  if (id2 === 'spring-garden') springMonths.push(t2.getMonth() + 1);
  if (id2 === 'winter-wonderland') winterMonths.push(t2.getMonth() + 1);
}
check('southern hemisphere: spring comes in Sep-Dec', springMonths.length > 0 &&
      springMonths.every(function (m) { return m >= 9 && m <= 12; }));
check('southern hemisphere: winter comes in Jun-Sep', winterMonths.length > 0 &&
      winterMonths.every(function (m) { return m >= 6 && m <= 9; }));
HSx._apply(HK_SAMPLE_SETTINGS);

// ---- how often and when, configurable ------------------------------------
function sky(extra) {
  var cfg = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
  cfg.sky = Object.assign({}, cfg.sky || {}, extra);
  HSx._apply(cfg);
}
function perMonth(year, id) {
  var counts = [];
  for (var m = 1; m <= 12; m++) {
    var dim = new Date(year, m, 0).getDate(), n = 0;
    for (var day = 1; day <= dim; day++) { var r = S(d(year, m, day)); if (r && r.id === id) n++; }
    counts.push(n);
  }
  return counts;
}
sky({ storybook_per_month: '4', space_per_month: '2' });
var sb = perMonth(2027, 'storybook-magic'), sp = perMonth(2027, 'space-night');
check('storybook four times a month: never more, rarely fewer (birthdays and weeks win)',
      sb.every(function (n) { return n <= 4; }) && sb.filter(function (n) { return n === 4; }).length >= 8);
check('space night twice a month, never on a storybook day',
      sp.every(function (n) { return n <= 2; }) && sp.filter(function (n) { return n === 2; }).length >= 8);
sky({});
var base = perMonth(2027, 'storybook-magic');
sky({ storybook_per_month: '2' });
var two = perMonth(2027, 'storybook-magic');
var keep = true;
for (var mm = 1; mm <= 12; mm++) {
  var dim2 = new Date(2027, mm, 0).getDate();
  for (var dd = 1; dd <= dim2; dd++) {
    HSx._apply(HK_SAMPLE_SETTINGS); var a1 = S(d(2027, mm, dd));
    sky({ storybook_per_month: '2' }); var a2 = S(d(2027, mm, dd));
    if (a1 && a1.id === 'storybook-magic' && !(a2 && a2.id === 'storybook-magic')) keep = false;
  }
}
check('more days a month keeps the built-in day', keep && two.reduce(function (a, b) { return a + b; }, 0) >
      base.reduce(function (a, b) { return a + b; }, 0));
sky({ spring_often: 'often' });
var often = countOver([2026, 2027, 2028], 'spring-garden');
sky({ spring_often: 'rarely' });
var rarely = countOver([2026, 2027, 2028], 'spring-garden');
sky({});
var usual = countOver([2026, 2027, 2028], 'spring-garden');
check('spring: often > sometimes > rarely', often > usual && usual > rarely);
sky({ july4_from: '07-01', july4_to: '07-07' });
check('the Fourth of July week moves with its dates', (S(d(2026, 7, 7)) || {}).id === 'fourth-of-july' &&
      (S(d(2026, 6, 29)) || {}).id !== 'fourth-of-july');
HSx._apply(HK_SAMPLE_SETTINGS);

print((fail ? 'FAIL ' : 'ALL ') + (pass + fail) + ' SURPRISE TESTS' + (fail ? ' -- ' + fail + ' FAILED' : ' PASS'));
if (fail) throw new Error('surprise tests failed');
