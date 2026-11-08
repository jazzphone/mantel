// @ts-check
// hk-holidays.js -- THE HOLIDAY CALENDAR (phase 20, docs/phase20/HOLIDAY-SLIDE.md): which holidays there are, when
// each falls, and how many whole days away it is in the house's own time zone. Pure dates, no DOM: the screensaver's
// Holiday slide (hk-saver-holiday.js) and its options page read it, and tests drive it with any day.
//
// COUNTING is whole calendar days between the house's today and the holiday's date, from their date parts (year,
// month, day) and never by dividing milliseconds of two local times, so a clock change can never move the count.
// Today is the date the house's clock shows (hkStats.tz), whatever the browser's own zone.
//
//   hkHolidays.today(now, tz)          -> {y, m, d}  the house's date at the instant `now`
//   hkHolidays.list(now, opts)         -> [{id, name, short, date: {y, m, d}, days, scene, land, light, fx, hello,
//                                           c, g, a, ...}] the enabled ones, soonest first
//   hkHolidays.pick(now, opts)         -> the one to show (or null): opts.pick 'next' | 'turns' | 'one', opts.one,
//                                         opts.days (the window), opts.turn (Take Turns' count)
//   hkHolidays.between(a, b)           -> whole days from date parts a to b
//   hkHolidays.weekends(a, b)          -> the Saturdays after a and before b
//   opts: {tz, off: [ids], own: [{name, month, day, year?, scene}], birthdays: [{name, month, day}], us: bool}
(function () {
  'use strict';
  if (window.hkHolidays) return;

  // ---------------------------------------------------------------- dates as parts
  function P(y, m, d) { return { y: y, m: m, d: d }; }
  function num(p) { return Date.UTC(p.y, p.m - 1, p.d); }
  function between(a, b) { return Math.round((num(b) - num(a)) / 864e5); }
  function weekday(p) { return new Date(num(p)).getUTCDay(); }
  function addDays(p, n) { var t = new Date(num(p) + n * 864e5); return P(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  // the n-th weekday `wd` (0 Sunday) of month m; n = -1: the last
  function nth(y, m, wd, n) {
    if (n < 0) { var last = P(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()); return addDays(last, -((weekday(last) - wd + 7) % 7)); }
    var first = P(y, m, 1);
    return P(y, m, 1 + ((wd - weekday(first) + 7) % 7) + (n - 1) * 7);
  }
  // Easter Sunday (the Gregorian computus, Meeus / Jones / Butcher)
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return P(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
  }
  // a fixed month and day in year y; February 29 is the 28th in other years
  function fixed(y, m, d) { return m === 2 && d === 29 && !leap(y) ? P(y, 2, 28) : P(y, m, d); }

  // the house's date at the instant `now` (a Date or ms), in time zone `tz` (else the browser's)
  var fmts = {};
  function today(now, tz) {
    var t = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    if (tz) {
      try {
        var f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })), o = {};
        f.formatToParts(t).forEach(function (x) { o[x.type] = x.value; });
        if (o.year && o.month && o.day) return P(Number(o.year), Number(o.month), Number(o.day));
      } catch (e) { /* an unknown zone: the browser's */ }
    }
    return P(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  // ---------------------------------------------------------------- the holidays
  // Each: when it falls in year y, its words, its scene and its colors (c the number, g its glow, a its dot in
  // Coming Up). scene: one of the four painted rooms, or none (outdoors over the sky's landscape `land` at `light`,
  // with the effects `fx`). `us`: a US holiday, off by default in a house outside the US.
  var BUILT_IN = [
    { id: 'newyear', name: 'New Year’s Day', short: 'New Year’s', at: function (y) { return P(y, 1, 1); }, hello: ['Happy', 'New Year'],
      scene: 'newyear', land: 'winter', light: 'night', fx: 'fireworks', foil: true, year: true, c: '#ffe7a8', g: 'transparent', a: '#f4cb68' },
    { id: 'valentines', name: 'Valentine’s Day', short: 'Valentine’s', at: function (y) { return P(y, 2, 14); }, hello: ['Happy', 'Valentine’s Day'],
      land: 'winter', light: 'dusk', fx: 'hearts', c: '#ffe6ec', g: 'rgba(255,90,130,.36)', a: '#ff6b8e' },
    { id: 'easter', name: 'Easter', at: easter, hello: ['Happy', 'Easter'],
      land: 'spring', light: 'day', fx: 'petals', c: '#fffdf6', g: 'rgba(255,240,180,.25)', a: '#ffb3d1' },
    { id: 'mothers', name: 'Mother’s Day', at: function (y) { return nth(y, 5, 0, 2); }, hello: ['Happy', 'Mother’s Day'],
      land: 'spring', light: 'day', fx: 'petals', c: '#fffdf6', g: 'rgba(255,220,230,.25)', a: '#ff9fc4' },
    { id: 'fathers', name: 'Father’s Day', at: function (y) { return nth(y, 6, 0, 3); }, hello: ['Happy', 'Father’s Day'],
      land: 'summer', light: 'day', fx: 'butterflies', c: '#fffdf6', g: 'rgba(255,230,160,.2)', a: '#64d2ff' },
    { id: 'july4', name: 'Fourth of July', short: 'The Fourth', at: function (y) { return P(y, 7, 4); }, hello: ['Happy', 'Fourth of July'], us: true,
      land: 'july4', light: 'night', fx: 'fireworks', flag: true, c: '#ffffff', g: 'transparent', a: '#5fa8ff' },
    { id: 'halloween', name: 'Halloween', at: function (y) { return P(y, 10, 31); }, hello: ['Happy', 'Halloween'],
      scene: 'haunt', land: 'halloween', light: 'night', fx: 'bats', c: '#ffdcae', g: 'rgba(255,130,30,.42)', a: '#ff8a1f' },
    { id: 'thanksgiving', name: 'Thanksgiving', at: function (y) { return nth(y, 11, 4, 4); }, hello: ['Happy', 'Thanksgiving'], us: true,
      scene: 'thanks', land: 'fall', light: 'dusk', fx: 'leaves', c: '#fff1dc', g: 'rgba(255,170,90,.26)', a: '#ff9f0a' },
    { id: 'christmas', name: 'Christmas', at: function (y) { return P(y, 12, 25); }, hello: ['Merry', 'Christmas'],
      scene: 'room', land: 'christmas', light: 'night', fx: 'snow', c: '#fffaf0', g: 'rgba(255,214,150,.3)', a: '#ff6b5e' }
  ];
  var IDS = BUILT_IN.map(function (h) { return h.id; });
  var US_ONLY = BUILT_IN.filter(function (h) { return h.us; }).map(function (h) { return h.id; });
  // the four with a painted scene (Holiday Options -> Outdoors can send each outdoors instead)
  var PAINTED = BUILT_IN.filter(function (h) { return h.scene; }).map(function (h) { return h.id; });
  // the scenes a date of your own can wear: the sky's landscapes and their effects
  var OWN_SCENES = {
    spring: { land: 'spring', light: 'day', fx: 'petals', c: '#fffdf6', g: 'rgba(255,240,180,.25)', a: '#ffb3d1', label: 'Spring Meadow' },
    summer: { land: 'summer', light: 'day', fx: 'butterflies', c: '#fffdf6', g: 'rgba(255,230,160,.2)', a: '#66d4cf', label: 'Summer Day' },
    fall: { land: 'fall', light: 'dusk', fx: 'leaves', c: '#fff1dc', g: 'rgba(255,170,90,.26)', a: '#ff9f0a', label: 'Falling Leaves' },
    winter: { land: 'winter', light: 'night', fx: 'snow', c: '#fffaf0', g: 'rgba(200,220,255,.3)', a: '#9fc7ff', label: 'Snowy Night' },
    party: { land: 'spring', light: 'dusk', fx: 'balloons', c: '#ffffff', g: 'rgba(255,200,120,.25)', a: '#b48cff', label: 'Balloons' },
    fireworks: { land: 'summer', light: 'night', fx: 'fireworks', c: '#ffffff', g: 'transparent', a: '#ffd76a', label: 'Fireworks' }
  };
  var OWN_MAX = 12, NAME_MAX = 40;
  // a season's landscape for a birthday (northern months; the sky turns them for a southern house)
  function seasonOf(m) { return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'fall'; }
  function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'date'; }
  function okDay(m, d, y) { return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y || 2024, m, 0)).getUTCDate(); }

  // the next date on or after `from` that holiday `h` falls on (its date this year, else next year's)
  function nextOf(at, from) {
    var d = at(from.y);
    return between(from, d) < 0 ? at(from.y + 1) : d;
  }
  function entry(h, from, extra) {
    var date = nextOf(h.at, from), o = { days: between(from, date), date: date };
    Object.keys(h).forEach(function (k) { if (k !== 'at') o[k] = h[k]; });
    if (!o.short) o.short = o.name;
    return extra ? Object.assign(o, extra) : o;
  }

  // EVERY ENABLED HOLIDAY, soonest first: the built-in ones not in opts.off (US-only ones off outside the US unless
  // opts.us), the sky's birthdays ('birthdays' in off turns them all off), and your own dates (a one-off date with a
  // year drops off once it has passed)
  function list(now, opts) {
    opts = opts || {};
    var from = now && now.y ? now : today(now, opts.tz), off = {}, out = [];
    (Array.isArray(opts.off) ? opts.off : []).forEach(function (id) { off[id] = true; });
    BUILT_IN.forEach(function (h) {
      if (off[h.id] || (h.us && opts.us === false)) return;
      out.push(entry(h, from));
    });
    if (!off.birthdays) (Array.isArray(opts.birthdays) ? opts.birthdays : []).forEach(function (b) {
      var m = Number(b && b.month), d = Number(b && b.day), name = String((b && b.name) || '').trim().slice(0, NAME_MAX);
      if (!name || !okDay(m, d, 2024)) return;
      var land = seasonOf(m);
      out.push(entry({ id: 'birthday:' + slug(name), name: name + '’s Birthday', short: name, at: function (y) { return fixed(y, m, d); },
        hello: ['Happy Birthday,', name], birthday: true, person: name, land: land, light: 'dusk', fx: 'balloons',
        c: '#ffffff', g: 'rgba(255,200,120,.25)', a: '#b48cff' }, from));
    });
    (Array.isArray(opts.own) ? opts.own : []).slice(0, OWN_MAX).forEach(function (o) {
      var m = Number(o && o.month), d = Number(o && o.day), y = o && o.year != null ? Number(o.year) : null;
      var name = String((o && o.name) || '').trim().slice(0, NAME_MAX), sc = OWN_SCENES[o && o.scene] || OWN_SCENES.spring;
      if (!name || !okDay(m, d, y || 2024) || (y != null && !(y >= 1900 && y <= 2200))) return;
      var at = y != null ? function () { return P(y, m, d); } : function (yy) { return fixed(yy, m, d); };
      var e = entry({ id: 'own:' + slug(name), name: name, at: at, hello: ['Today’s the', name], own: true, oneOff: y != null,
        land: sc.land, light: sc.light, fx: sc.fx, c: sc.c, g: sc.g, a: sc.a, ownScene: o.scene in OWN_SCENES ? o.scene : 'spring' }, from);
      if (y != null && e.days < 0) return;          // (a one-off date that has passed)
      out.push(e);
    });
    out.sort(function (a, b) { return a.days - b.days || IDS.indexOf(a.id) - IDS.indexOf(b.id); });
    return out;
  }

  // THE ONE TO SHOW: among the enabled holidays within opts.days (the window, default 60), Next Up the soonest,
  // Take Turns each in turn (opts.turn counts the turns), One Holiday the one picked; null when none is in range
  function inRange(now, opts) {
    var win = Number(opts && opts.days) || 60;
    return list(now, opts).filter(function (h) { return h.days >= 0 && h.days <= win; });
  }
  function pick(now, opts) {
    opts = opts || {};
    var near = inRange(now, opts);
    if (!near.length) return null;
    if (opts.pick === 'one') return near.filter(function (h) { return h.id === opts.one; })[0] || null;
    if (opts.pick === 'turns') return near[((Number(opts.turn) || 0) % near.length + near.length) % near.length];
    return near[0];
  }
  // the next ones after `h`, for Coming Up (whatever the window)
  function after(now, opts, h, n) {
    return list(now, opts).filter(function (x) { return !h || x.id !== h.id; }).slice(0, n || 3);
  }
  // the Saturdays strictly after a and before b (Weekends Left)
  function weekends(a, b) {
    var n = between(a, b), w = weekday(a), count = 0;
    for (var i = 1; i < n; i++) if ((w + i) % 7 === 6) count++;
    return count;
  }

  window.hkHolidays = {
    IDS: IDS.slice(), US_ONLY: US_ONLY.slice(), PAINTED: PAINTED.slice(), OWN_SCENES: OWN_SCENES, OWN_MAX: OWN_MAX, NAME_MAX: NAME_MAX,
    today: today, list: list, pick: pick, inRange: inRange, after: after, between: between, weekends: weekends,
    _: { easter: easter, nth: nth, fixed: fixed, addDays: addDays, weekday: weekday, slug: slug }
  };
})();
