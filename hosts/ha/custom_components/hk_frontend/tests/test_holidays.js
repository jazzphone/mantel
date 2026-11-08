// hk-holidays.js (phase 20, docs/phase20/HOLIDAY-SLIDE.md): the holiday calendar the screensaver's Holiday slide
// counts down to -- when each holiday falls, whole days in the house's own time zone (never moved by a clock change),
// and which one shows (Next Up, Take Turns, One Holiday, the window of days).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var window = this;
load(HK_ROOT + '/frontend/modules/hk-holidays.js');
var HH = window.hkHolidays;

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
function P(y, m, d) { return { y: y, m: m, d: d }; }
function iso(p) { return p.y + '-' + ('0' + p.m).slice(-2) + '-' + ('0' + p.d).slice(-2); }
function get(list, id) { return list.filter(function (h) { return h.id === id; })[0]; }

// ---------------------------------------------------------------- the dates
var EASTER = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2029: '2029-04-01',
               2030: '2030-04-21', 2031: '2031-04-13', 2032: '2032-03-28', 2033: '2033-04-17', 2034: '2034-04-09', 2035: '2035-03-25' };
ok('Easter 2024-2035, the known dates', Object.keys(EASTER).every(function (y) { return iso(HH._.easter(Number(y))) === EASTER[y]; }),
   Object.keys(EASTER).map(function (y) { return iso(HH._.easter(Number(y))); }));
var TG = { 2024: '2024-11-28', 2025: '2025-11-27', 2026: '2026-11-26', 2027: '2027-11-25', 2030: '2030-11-28' };
ok('Thanksgiving: the fourth Thursday of November', Object.keys(TG).every(function (y) {
  return iso(get(HH.list(P(Number(y), 1, 2), {}), 'thanksgiving').date) === TG[y]; }));
ok('Mother’s Day: the second Sunday of May (2026-05-10, 2027-05-09)',
   iso(get(HH.list(P(2026, 1, 2), {}), 'mothers').date) === '2026-05-10' && iso(get(HH.list(P(2027, 1, 2), {}), 'mothers').date) === '2027-05-09');
ok('Father’s Day: the third Sunday of June (2026-06-21, 2027-06-20)',
   iso(get(HH.list(P(2026, 1, 2), {}), 'fathers').date) === '2026-06-21' && iso(get(HH.list(P(2027, 1, 2), {}), 'fathers').date) === '2027-06-20');

// ---------------------------------------------------------------- the count
var nov8 = HH.list(P(2026, 11, 8), {});
ok('Counting: Thanksgiving 18 days from November 8, 2026; Christmas 47', get(nov8, 'thanksgiving').days === 18 && get(nov8, 'christmas').days === 47);
ok('Today is 0, tomorrow 1', get(HH.list(P(2026, 12, 25), {}), 'christmas').days === 0 && get(HH.list(P(2026, 12, 24), {}), 'christmas').days === 1);
ok('The day after rolls to next year', get(HH.list(P(2026, 12, 26), {}), 'christmas').days === 364 &&
   iso(get(HH.list(P(2026, 12, 26), {}), 'christmas').date) === '2027-12-25');
ok('New Year’s across the year’s end: 1 on December 31, 0 on January 1, 2027 its year',
   get(HH.list(P(2026, 12, 31), {}), 'newyear').days === 1 && get(HH.list(P(2027, 1, 1), {}), 'newyear').days === 0 &&
   get(HH.list(P(2026, 12, 31), {}), 'newyear').date.y === 2027);
ok('Soonest first', nov8[0].id === 'thanksgiving' && nov8[1].id === 'christmas' && nov8[2].id === 'newyear', nov8.map(function (h) { return h.id; }));
// the clock changes: whole days from the date parts, never ms / 86400000 of two local times
var spring = HH.today(Date.UTC(2026, 2, 7, 18), 'America/New_York'), springNext = HH.today(Date.UTC(2026, 2, 8, 18), 'America/New_York');
var fall = HH.today(Date.UTC(2026, 10, 1, 3, 30), 'America/New_York'), fallNext = HH.today(Date.UTC(2026, 10, 2, 4, 30), 'America/New_York');
ok('Across the spring clock change: one day apart, the count down by one',
   HH.between(spring, springNext) === 1 && get(HH.list(spring, {}), 'easter').days - get(HH.list(springNext, {}), 'easter').days === 1);
ok('Across the fall clock change (an hour longer): one day apart', iso(fall) === '2026-10-31' && iso(fallNext) === '2026-11-01' && HH.between(fall, fallNext) === 1);
// a time zone unlike the browser's: the house's date
var instant = Date.UTC(2026, 11, 25, 3, 0);          // 03:00 UTC on December 25: still the 24th in Los Angeles
ok('In a time zone unlike the browser’s: the house’s own date', iso(HH.today(instant, 'America/Los_Angeles')) === '2026-12-24' &&
   iso(HH.today(instant, 'Asia/Tokyo')) === '2026-12-25' &&
   get(HH.list(instant, { tz: 'America/Los_Angeles' }), 'christmas').days === 1 && get(HH.list(instant, { tz: 'Asia/Tokyo' }), 'christmas').days === 0);
ok('An unknown zone: the browser’s, not an error', !!HH.today(instant, 'Not/AZone').y);
ok('Weekends Left: the Saturdays between (Nov 8 to Dec 25, 2026: 6)', HH.weekends(P(2026, 11, 8), P(2026, 12, 25)) === 6 && HH.weekends(P(2026, 12, 24), P(2026, 12, 25)) === 0);

// ---------------------------------------------------------------- birthdays and your own dates
var bd = [{ name: 'Anna', month: 2, day: 29 }, { name: 'Mark', month: 3, day: 14 }, { name: '', month: 1, day: 1 }, { name: 'X', month: 2, day: 31 }];
var b27 = HH.list(P(2027, 2, 1), { birthdays: bd }), b28 = HH.list(P(2028, 2, 1), { birthdays: bd });
ok('February 29 birthdays: on the 28th in other years, the 29th in a leap year',
   iso(get(b27, 'birthday:anna').date) === '2027-02-28' && iso(get(b28, 'birthday:anna').date) === '2028-02-29');
ok('A birthday: its name, its greeting, balloons; a nameless or impossible one left out',
   get(b27, 'birthday:mark').name === 'Mark’s Birthday' && get(b27, 'birthday:mark').hello[1] === 'Mark' && get(b27, 'birthday:mark').fx === 'balloons' &&
   b27.filter(function (h) { return h.birthday; }).length === 2);
ok('holiday_off "birthdays" turns them all off', HH.list(P(2027, 2, 1), { birthdays: bd, off: ['birthdays'] }).filter(function (h) { return h.birthday; }).length === 0);
var own = [{ name: 'Beach Trip', month: 7, day: 12, scene: 'summer' }, { name: 'Moving Day', month: 3, day: 1, year: 2026 }, { name: 'Recital', month: 12, day: 3, year: 2026, scene: 'nope' }];
var o1 = HH.list(P(2026, 11, 8), { own: own });
ok('Your own date: every year, its scene', get(o1, 'own:beach-trip').days === between(P(2026, 11, 8), P(2027, 7, 12)) && get(o1, 'own:beach-trip').fx === 'butterflies');
ok('A one-off date that has passed drops off; one still to come stays (an unknown scene: Spring)', !get(o1, 'own:moving-day') && get(o1, 'own:recital').days === 25 &&
   get(o1, 'own:recital').ownScene === 'spring');
function between(a, b) { return HH.between(a, b); }
ok('Names: up to 40 characters', get(HH.list(P(2026, 1, 1), { own: [{ name: new Array(60).join('ab'), month: 5, day: 5 }] }), 'own:' + HH._.slug(new Array(60).join('ab'))).name.length === 40);

// ---------------------------------------------------------------- which one shows
ok('Next Up: the soonest within the window', HH.pick(P(2026, 11, 8), { pick: 'next', days: 60 }).id === 'thanksgiving' &&
   HH.pick(P(2026, 11, 27), { pick: 'next', days: 60 }).id === 'christmas');
ok('Nothing in range: null (the slide stays away)', HH.pick(P(2026, 8, 20), { pick: 'next', days: 30 }) === null);
ok('The window: 30, 60 and 90 days', HH.pick(P(2026, 10, 1), { pick: 'next', days: 30 }).id === 'halloween' &&
   HH.inRange(P(2026, 10, 1), { days: 90 }).map(function (h) { return h.id; }).join() === 'halloween,thanksgiving,christmas');
ok('One Holiday: the one picked, within the window', HH.pick(P(2026, 11, 8), { pick: 'one', one: 'christmas', days: 60 }).id === 'christmas' &&
   HH.pick(P(2026, 9, 1), { pick: 'one', one: 'christmas', days: 60 }) === null);
var t = [0, 1, 2, 3].map(function (n) { return HH.pick(P(2026, 11, 8), { pick: 'turns', days: 60, turn: n }).id; });
ok('Take Turns: each in turn', t.join() === 'thanksgiving,christmas,newyear,thanksgiving', t);
ok('holiday_off: an off holiday never shows', HH.pick(P(2026, 11, 8), { pick: 'next', days: 60, off: ['thanksgiving'] }).id === 'christmas');
ok('US-only ones off outside the US', !get(HH.list(P(2026, 11, 8), { us: false }), 'thanksgiving') && !get(HH.list(P(2026, 11, 8), { us: false }), 'july4') &&
   !!get(HH.list(P(2026, 11, 8), { us: false }), 'christmas'));
ok('Coming Up: the next three after the one showing', HH.after(P(2026, 11, 8), {}, get(nov8, 'thanksgiving'), 3).map(function (h) { return h.id; }).join() === 'christmas,newyear,valentines');
ok('The lists the options page uses', HH.IDS.length === 9 && HH.PAINTED.join() === 'newyear,halloween,thanksgiving,christmas' && HH.US_ONLY.join() === 'july4,thanksgiving');

print(fail ? 'FAIL ' + fail + ' HOLIDAY TESTS' : 'ALL ' + pass + ' HOLIDAY TESTS PASS');
if (fail) throw new Error(fail + ' failed');
