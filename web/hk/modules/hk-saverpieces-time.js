// hk-saverpieces-time.js -- THE SCREENSAVER'S TIME AND CALENDAR GLANCE PIECES (2026-11-02, phase 13 / 1b, wave A;
// docs/phase13/GLANCE-SPEC.md, "Time and Calendar"): Countdown, World Clock, and the Calendar piece's Card shape.
//
// A glance group is one file, loaded after hk-saverwidgets.js (the screensaver loads only the files its layout uses). It
// registers its pieces with hkSaverWidgets.define() and draws with the renderer's helpers and classes, so a piece looks
// like the core ones. Every rule of the plan holds (SCREENSAVER-UNIFIED.md, "The rules every piece follows"): nothing here
// animates, nothing blurs, and the only timer is the shared read's retry; one read per source, shared:
//
//   countdown   inline, circular       the next all-day event two or more days away, or the next whose title has opts.match
//                                      (hkCalendar over the next 120 days: ONE read for every countdown piece, kept an
//                                      hour; a failed read asked again after 5 minutes). Inline "Beach Trip in 12 days";
//                                      circular the days left in a ring that fills as the day nears (over 30 days).
//   world       inline, circular,      opts.city / opts.city2 (IANA ids), the browser's Intl. Inline "London 3:57 PM";
//               rectangular            circular a small dial and the city's three letters; rectangular two cities, each its
//                                      time and "Tomorrow" / "Yesterday" when its date differs from the house's.
//   events      card (added to the     "Today", then the rest of today's events (four at most; all-day last), each its time
//               core piece)            and title, in the calendar's own color (the shared calendar read, as the core shapes).
//
// A read never wakes a read (0.1.104): the countdown's read lands, THEN the watchers (the renderer's shared list, so
// every piece that wakes on 'calendar' draws again) are called, never from inside a read.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W.PIECES) return;
  if (W._ && W._.time) return;                                  // loaded twice
  var H = W._;
  var esc = H.esc, ring = H.ring, inl = H.inl, cut = H.cut, tm = H.tm, when = H.when, accStyle = H.accStyle, DASH = H.DASH;

  var GROUP = 'Time and Calendar';
  var CORAL = ['#ff9a85', '#c4482e'];                           // Countdown: a soft coral (light ink, black ink)
  var INDIGO = ['#9aa8ff', '#4452b8'];                          // World Clock: a calm indigo

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ------------------------------------------------------------ the look this group adds (--u, the spacing scale: .4 .8 1.2 1.6 2.4 3.2)
  // World Clock's rows (a city and its day, the time at the right) and the Calendar card's rows (a dot, a time column, the
  // title). Figures are tabular (the renderer sets it for every piece), so a time never jitters.
  var CSS = [
    // world, rectangular: two rows of 4.6 u with .4 u between, so 1.7 u of the 13 u is above and below them
    '.hksw .wc{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--u) * .4)}',
    '.hksw .wr{display:flex;align-items:center;gap:calc(var(--u) * 1.2);min-width:0;height:calc(var(--u) * 4.6)}',
    '.hksw .wr .wn{flex:1;min-width:0}',
    '.hksw .wr .wn > div{overflow:hidden;text-overflow:ellipsis}',
    '.hksw .wr .wn1{font-size:calc(var(--u) * 2.2);line-height:1.2;font-weight:700}',
    '.hksw .wr .wn2{font-size:calc(var(--u) * 1.6);line-height:1.2;font-weight:600;opacity:.85}',
    '.hksw .wr .wt{flex:none;text-align:right;font-size:calc(var(--u) * 2.8);line-height:1.2;font-weight:700}',
    '.hksw .wr .wt small{font-size:calc(var(--u) * 1.6);font-weight:600;opacity:.8;margin-left:calc(var(--u) * .4)}',
    // calendar, card: a dot, a time column (so the titles share one left edge), the title
    '.hksw .cd .er{display:flex;align-items:center;min-width:0;font-size:calc(var(--u) * 2.4);line-height:1.35}',
    '.hksw .cd .er .dot{margin-right:calc(var(--u) * 1.2)}',
    '.hksw .cd .er .tc{flex:none;min-width:4.9em;margin-right:calc(var(--u) * 1.2);font-weight:500;opacity:.75}',
    '.hksw .cd .er.t24 .tc{min-width:2.9em}',
    '.hksw .cd .er .et{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600}'
  ].join('\n');
  // (its rules join the renderer's one sheet: the page's and every shadow root's it handed out, hkSaverWidgets.addCss)
  if (W.addCss) W.addCss(CSS);

  // ------------------------------------------------------------ COUNTDOWN: its own shared calendar read, 120 days ahead
  var CD_DAYS = 120, CD_TTL = 3600000, CD_RETRY = 300000, CD_LOST = 30000;
  var CD = { evs: null, at: 0, busy: 0, failAt: 0, n: 0, asked: false };
  function wakeAll() {
    // (after the read has landed, never inside it: the renderer's calendar watchers each draw their piece again)
    var list = (H.cal && H.cal.watchers) || [];
    list.slice().forEach(function (f) { try { f(); } catch (e) { /* that piece is gone */ } });
  }
  function countdownEvents(client) {
    var K = window.hkCalendar, now = Date.now();
    if (!K && !CD.asked && window.hkNeed && window.hkNeed.file) {
      CD.asked = true;
      try { Promise.resolve(window.hkNeed.file('hk-calendar.js')).then(wakeAll, function () { /* none */ }); } catch (e) { /* none */ }
    }
    if (CD.busy && now - CD.busy > CD_LOST) CD.busy = 0;       // (a read that never answers is given up on)
    if (!K || !K.load || !K.ids || !client || CD.busy || now - CD.failAt < CD_RETRY || (CD.evs && now - CD.at < CD_TTL)) return CD.evs || [];
    var ids = [];
    try { ids = K.ids(client); } catch (e) { ids = []; }
    if (!ids || !ids.length) { CD.evs = []; CD.at = now; return CD.evs; }
    var n = ++CD.n, from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + CD_DAYS);
    CD.busy = now;
    try {
      K.load(client, ids, from, to).then(function (got) {
        if (n !== CD.n) return;
        CD.busy = 0; CD.evs = (got && got.evs) || []; CD.at = Date.now(); CD.failAt = 0;
        wakeAll();
      }, function () { if (n === CD.n) { CD.busy = 0; CD.failAt = Date.now(); } });
    } catch (e) { CD.busy = 0; CD.failAt = now; }
    return CD.evs || [];
  }
  // the event to count down to, from the calendar's events: with a match, the next whose title has those words (today's
  // included until it is over); without one, the next all-day event at least two days away. { title, dayN } or null
  function pickCountdown(evs, now, match) {
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), t = +now, m = String(match == null ? '' : match).trim().toLowerCase(), best = null;
    (evs || []).forEach(function (e) {
      var s = when(e && e.start), en = when(e && e.end);
      if (s == null) return;
      var sd = new Date(s), dayN = Math.round((new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()) - day0) / 86400000);
      var title = String(e.title || e.summary || 'Event'), allDay = !!e.allDay;
      if (m) {
        if (title.toLowerCase().indexOf(m) < 0 || dayN < 0) return;
        if (dayN === 0 && !allDay && (en == null ? s : en) <= t) return;       // today's, and already over
      } else if (!allDay || dayN < 2) return;
      if (!best || s < best.s) best = { s: s, title: title, dayN: dayN };
    });
    return best ? { title: best.title, dayN: best.dayN } : null;
  }
  function daysWords(n) { return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'; }
  // the ring fills as the day nears: empty at 30 days or more, full on the day
  function nearness(n) { return n >= 30 ? null : Math.round(Math.max(0, Math.min(1, 1 - n / 30)) * 200) / 200; }

  W.define('countdown', {
    name: 'Countdown', group: GROUP, wave: 'A', facts: ['countdown'], source: 'hkCalendar', when: null,
    wakes: ['minute', 'calendar'], pick: null, off: false, opts: { match: 'text' }, defaults: { match: '' }, accent: CORAL,
    shapes: {
      inline: {
        read: function (X) {
          var e = pickCountdown(X.quiet ? [] : countdownEvents(X.client), X.now, X.opts.match);
          return e ? { text: cut(e.title, 28) + ' ' + daysWords(e.dayN), gl: 1 } : { text: DASH };
        },
        draw: function (s) { return inl(s.gl ? '<i class="dot a"></i>' : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Beach Trip in 12 days', gl: 1 }
      },
      circular: {
        read: function (X) {
          var e = pickCountdown(X.quiet ? [] : countdownEvents(X.client), X.now, X.opts.match);
          return e ? { main: String(e.dayN), sub: e.dayN === 1 ? 'DAY' : 'DAYS', frac: nearness(e.dayN) } : { main: DASH, sub: 'DAYS', frac: null };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '12', sub: 'DAYS', frac: 0.6 }
      }
    }
  });

  // ------------------------------------------------------------ WORLD CLOCK: the browser's Intl, one formatter per zone
  var CITIES = ['Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
    'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo',
    'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
    'America/New_York', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Reykjavik'];
  // the dial's three letters: the city's usual short code where its first three letters would be a poor one
  var CODES = { 'Europe/London': 'LON', 'Europe/Paris': 'PAR', 'Europe/Berlin': 'BER', 'Europe/Rome': 'ROM', 'Europe/Madrid': 'MAD', 'Europe/Athens': 'ATH',
    'Europe/Istanbul': 'IST', 'Europe/Moscow': 'MOS', 'Africa/Cairo': 'CAI', 'Africa/Johannesburg': 'JNB', 'Asia/Dubai': 'DXB', 'Asia/Kolkata': 'KOL',
    'Asia/Bangkok': 'BKK', 'Asia/Singapore': 'SIN', 'Asia/Hong_Kong': 'HKG', 'Asia/Shanghai': 'SHA', 'Asia/Tokyo': 'TOK', 'Asia/Seoul': 'SEO',
    'Australia/Sydney': 'SYD', 'Pacific/Auckland': 'AKL', 'Pacific/Honolulu': 'HNL', 'America/Anchorage': 'ANC', 'America/Los_Angeles': 'LAX',
    'America/Denver': 'DEN', 'America/Chicago': 'CHI', 'America/New_York': 'NYC', 'America/Toronto': 'TOR', 'America/Mexico_City': 'MEX',
    'America/Sao_Paulo': 'SAO', 'America/Argentina/Buenos_Aires': 'BUE', 'Atlantic/Reykjavik': 'REY' };
  var NAMES = { 'America/Sao_Paulo': 'São Paulo' };
  // the city of an IANA id: its last segment, underscores to spaces (Asia/Kolkata is Kolkata, whatever else people call it)
  function cityName(id) { return NAMES[id] || String(id || '').split('/').pop().replace(/_/g, ' ') || DASH; }
  function cityCode(id) { return CODES[id] || cityName(id).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || DASH; }

  var FMT = {};
  // an instant as the wall clock of a zone says it: { y, mo, d, h, m } (null for a zone the browser doesn't know)
  function zoneParts(date, zone) {
    var f = FMT[zone];
    if (f === undefined) {
      try { f = FMT[zone] = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); }
      catch (e) { f = FMT[zone] = null; }
    }
    if (!f) return null;
    try {
      var o = {};
      f.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') o[p.type] = +p.value; });
      return { y: o.year, mo: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, m: o.minute };
    } catch (e) { return null; }
  }
  function dayKey(p) { return p.y * 10000 + p.mo * 100 + p.d; }
  // the house's date: in the house's zone where the house knows it (hkLocale), else the clock we were handed
  function houseKey(now) {
    var L = window.hkLocale, z = null;
    try { z = L && L.zone ? L.zone() : null; } catch (e) { z = null; }
    var p = z ? zoneParts(now, z) : null;
    return p ? dayKey(p) : now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  }
  // a time as words: "3:57 PM" (the number and its AM or PM apart), or 24-hour "15:57"
  function clockOf(p, h24) {
    if (!p) return { t: DASH, ap: '' };
    return h24 ? { t: pad(p.h) + ':' + pad(p.m), ap: '' } : { t: ((p.h % 12) || 12) + ':' + pad(p.m), ap: p.h < 12 ? 'AM' : 'PM' };
  }
  function worldRow(id, now, h24, hk) {
    var p = zoneParts(now, id), c = clockOf(p, h24), k = p ? dayKey(p) : hk;
    return { n: cityName(id), t: c.t, ap: c.ap, d: k > hk ? 'Tomorrow' : k < hk ? 'Yesterday' : '' };
  }
  // the clock face: a track like every circular piece's (r 43, stroke 7.5), a small dial inside it above the label's baseline (72)
  function dial(code, p) {
    var cx = 50, cy = 42, R = 17.5, at = function (deg, len) {
      var a = deg * Math.PI / 180;
      return (cx + len * Math.sin(a)).toFixed(2) + ' ' + (cy - len * Math.cos(a)).toFixed(2);
    };
    var ticks = [0, 90, 180, 270].map(function (d) { return 'M' + at(d, R - 4.2) + 'L' + at(d, R - 1.8); }).join('');
    var svg = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="a" cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="7.5"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.8"/>' +
      '<path d="' + ticks + '" fill="none" stroke="currentColor" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round"/>';
    if (p) {
      svg += '<path d="M' + cx + ' ' + cy + 'L' + at((p.h % 12 + p.m / 60) * 30, 9.5) + '" class="a" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>' +
        '<path d="M' + cx + ' ' + cy + 'L' + at(p.m * 6, 14.2) + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="1.9" fill="currentColor"/>';
    }
    return svg + '<text x="50" y="72" text-anchor="middle" font-weight="600" font-size="14" opacity=".85">' + esc(code) + '</text></svg>';
  }
  var CLOCK =
    '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path ' +
    'd="M12 7v5l3 2"/></svg>';

  W.define('world', {
    name: 'World Clock', group: GROUP, wave: 'A', facts: ['world'], source: 'Intl', when: null,
    wakes: ['minute'], pick: null, off: false, opts: { city: CITIES, city2: CITIES }, defaults: { city: 'Europe/London', city2: 'Asia/Tokyo' }, accent: INDIGO,
    shapes: {
      inline: {
        read: function (X) {
          var p = zoneParts(X.now, X.opts.city), c = clockOf(p, X.h24);
          return { text: cityName(X.opts.city) + ' ' + c.t + (c.ap ? ' ' + c.ap : ''), gl: 1 };
        },
        draw: function (s) { return inl(CLOCK, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'London 3:57 PM', gl: 1 }
      },
      circular: {
        read: function (X) {
          var p = zoneParts(X.now, X.opts.city);
          return { c: cityCode(X.opts.city), h: p ? p.h : null, m: p ? p.m : null };
        },
        draw: function (s) { return dial(s.c, s.h == null ? null : { h: s.h, m: s.m }); },
        sample: { c: 'LON', h: 10, m: 10 }
      },
      rectangular: {
        // two cities, each its name (and "Tomorrow" or "Yesterday" under it), its time at the right
        read: function (X) {
          var hk = houseKey(X.now);
          return { rows: [X.opts.city, X.opts.city2].map(function (id) { return worldRow(id, X.now, X.h24, hk); }) };
        },
        draw: function (s) {
          return '<div class="wc">' + s.rows.map(function (r) {
            return '<div class="wr"><div class="wn"><div class="wn1">' + esc(r.n) + '</div>' + (r.d ? '<div class="wn2 a">' + esc(r.d) + '</div>' : '') + '</div>' +
              '<div class="wt">' + esc(r.t) + (r.ap ? '<small>' + esc(r.ap) + '</small>' : '') + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { rows: [{ n: 'London', t: '3:57', ap: 'PM', d: '' }, { n: 'Tokyo', t: '12:57', ap: 'AM', d: 'Tomorrow' }] }
      }
    }
  });

  // ------------------------------------------------------------ EVENTS, Card: the rest of today (added to the core piece, whose shapes stay)
  var CARD_ROWS = 4;
  // an event's color, as the core pieces draw it (the renderer's eventAcc, which it doesn't share yet): the calendar's own as
  // Settings has it, in hk-calendar.js's palette, as a [light, dark] pair
  function hex(v) { return (Math.round(Math.max(0, Math.min(255, v))) + 256).toString(16).slice(1); }
  function eventColor(e, st) {
    if (H.eventAcc) return H.eventAcc(e, st);
    var HS = window.hkSettings, C = window.hkCards, key = 'orange', hue = (C && C.PALETTE && C.PALETTE.chart) || {};
    try { key = HS && HS.eventColor ? HS.eventColor(e.cal, e.title, e.uid, st) : HS && HS.calendarColor ? HS.calendarColor(e.cal, st) : 'orange'; } catch (x) { key = 'orange'; }
    if (key === 'white') return null;
    var rgb = hue[key] && hue[key].length === 3 ? hue[key] : [255, 159, 10];
    return ['#' + rgb.map(hex).join(''), '#' + rgb.map(function (v) { return hex(v * 0.62); }).join('')];
  }
  var events = W.PIECES.events;
  if (events && events.shapes && !events.shapes.card) {
    events.shapes.card = {
      read: function (X) {
        // today's: what is under way (Now) and what is still to come in order, then the all-day ones
        var rows = H.nextEvents(X.events(), X.now, X.calNames(), 64).filter(function (e) { return e.dayN <= 0; }).slice(0, CARD_ROWS).map(function (e) {
          return { t: e.now ? 'Now' : e.allDay ? 'All Day' : tm(e.start, X.h24, true), title: cut(e.title, 48), c: eventColor(e, X.st) };
        });
        return { evs: rows, h24: !!X.h24 };
      },
      draw: function (s) {
        var body = s.evs.length ? s.evs.map(function (e) {
          return '<div class="er' + (s.h24 ? ' t24' : '') + '"' + accStyle(e.c) + '><i class="dot a"></i><span class="tc">' + esc(e.t) + '</span><span class="et">' + esc(e.title) + '</span></div>';
        }).join('') : '<div class="cl">Nothing else today</div>';
        return '<div class="cd ti"><div class="ct">Today</div>' + body + '</div>';
      },
      h: function (s) { return 8.1 + (s && s.evs && s.evs.length ? 3.24 * s.evs.length : 3.78); },
      sample: { evs: [{ t: '3:30 PM', title: 'Piano Lesson', c: ['#ff9f0a', '#9a5f06'] }, { t: '6:00 PM', title: 'Dinner at Mom’s', c: ['#5ea5ff', '#1d5fb8'] },
                      { t: 'All Day', title: 'Recycling Day', c: ['#5fd38a', '#1f8a4c'] }], h24: false }
    };
  }

  // (for the tests, and a caller that wants the pieces' readings)
  W._.time = { cd: CD, pickCountdown: pickCountdown, countdownEvents: countdownEvents, zoneParts: zoneParts, cityName: cityName, cityCode: cityCode, CITIES: CITIES,
               CORAL: CORAL, INDIGO: INDIGO, CSS: CSS };
})();
