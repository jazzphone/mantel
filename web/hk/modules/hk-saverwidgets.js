// hk-saverwidgets.js -- THE SCREENSAVER'S LOCK-SCREEN WIDGETS (2026-11-01, the owner: "Lets do the editor!";
// docs/phase12/SCREENSAVER-EDITOR.md, phase C1): the circular, rectangular, inline and band widgets of
// hk-saverlayout.js's CATALOG, drawn from the house's real data in the approved mock-up's look (screensaver-editor.html:
// ring(), circ(), rect(), line(), bandHtml(), .bk-glass, .bk-tint). The cards (Now Playing, Timers, Weather, Home
// Status, the clock, the forecast band) are not here: they are the screensaver's own, placed by hk-saver.js.
//
//   circular   temp aqi humidity inside battery solar timer locks sunset         13 u square
//   rectangular next_event next_hours home_status energy_today                    29 u x 13 u
//   inline     date weather_line status_line event_line photo_title               3.6 u high, as wide as its text
//   band       readings (Big Weather's bottom row: Sunset, Wind, Humidity, AQI)  10 u high, the band's width
//
// WHAT IT COSTS A WALL TABLET: a widget is a handful of words and one small SVG, and is written again only when
// the words it shows have changed (update() compares what it would draw with what it drew). Nothing animates and
// nothing here keeps a timer: the caller calls update() on the minute and when the house changes (a running timer's
// widget says `live`: the one that wants a call every second). Glass is a static translucent fill and a hairline,
// never a backdrop-filter. What arrives later -- a forecast, the Energy page's sums, the calendar's events -- draws
// the widget again by itself when it lands.
//
//   hkSaverWidgets.create(id, { u, back, color, h24, weather }) -> { el, measure(), update(client, now, ctx), setU(u), destroy(), live, id, kind }
//     u        px per unit (1 % of the screen's shorter side): everything is sized from `--u` on `el`, so the caller sizes
//              the widget by plan()'s box (it sets el's left and top; the band also its width)
//     back     'none' | 'glass' | 'tint'
//     color    'auto' (the caller's `--tint` on a parent) | 'white' | 'accent' (`--hk-accent`, else #ffb38a)
//     h24      24-hour times;  weather   the weather entity id, or null (the house's)
//     update(client, now, ctx)  client {states, config, subscriptions?}; now a Date; ctx {title (photo_title: undefined
//              draws a dash, '' draws nothing), events (next_event, event_line: the calendar's events, to share one read)};
//              true if it drew again
//     measure() -> {w, h} px: its fixed unit size (inline: its text's width, measured when the page can, else
//              estimated from the text's length -- call it after update())
//   hkSaverWidgets.has(id) / kind(id) / IDS: what this file draws (the others are cards)
(function () {
  'use strict';
  if (window.hkSaverWidgets) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var DASH = '—';
  var DOT = ' · ';
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var BACKS = ['none', 'glass', 'tint'], COLORS = ['auto', 'white', 'accent'];
  // each widget's size in units: [width, height]; an inline widget's width is its text's
  var SIZE = { circular: [13, 13], rectangular: [29, 13], inline: [0, 3.6], band: [0, 10] };
  var CAL_TTL = 300000;                     // the calendar is read at most this often (shared by every widget)
  var ENERGY_TTL = 30000;

  // ------------------------------------------------------------ the look (the mock-up's, in units of `--u`)
  var CSS = [
    '.hksw{box-sizing:border-box;display:flex;align-items:center;font-family:' + FONT + ';font-weight:600;line-height:1.15;',
    '  white-space:nowrap;color:var(--sw-ink);-webkit-font-smoothing:antialiased;font-variant-numeric:proportional-nums}',
    '.hksw.c-auto{--sw-ink:var(--tint,#fff)}',
    '.hksw.c-white{--sw-ink:#fff}',
    '.hksw.c-accent{--sw-ink:var(--hk-accent,#ffb38a)}',
    // THE BACKDROP: Glass is a static scrim and a hairline (no backdrop-filter on a wall tablet), Tint the color in a dark fill
    '.hksw.b-none{text-shadow:0 1px 8px rgba(0,0,0,.28)}',
    '.hksw.b-glass{background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}',
    '.hksw.b-tint{background:rgba(0,0,0,.38);background:color-mix(in srgb,var(--sw-ink) 20%,rgba(0,0,0,.38))}',
    '.hksw svg{display:block;flex:none}',
    '.hksw text{fill:currentColor;font-family:inherit}',
    '.hksw.k-circular{width:calc(var(--u) * 13);height:calc(var(--u) * 13);border-radius:50%;justify-content:center}',
    '.hksw.k-circular svg{width:100%;height:100%}',
    '.hksw.k-circular:not(.b-none) svg{width:86%;height:86%}',
    '.hksw.k-rectangular{width:calc(var(--u) * 29);height:calc(var(--u) * 13);padding:0 calc(var(--u) * 1.6);border-radius:calc(var(--u) * 1.6);overflow:hidden}',
    '.hksw .rt{min-width:0;flex:1;font-size:calc(var(--u) * 2);line-height:1.25}',
    '.hksw .rt > div{overflow:hidden;text-overflow:ellipsis}',
    '.hksw .rt .l1{opacity:.75;letter-spacing:.03em;text-transform:uppercase}',
    '.hksw .rt .l2{font-size:calc(var(--u) * 2.8);font-weight:700}',
    '.hksw .rt .l3{opacity:.85}',
    '.hksw .hrs{display:flex;justify-content:center;gap:calc(var(--u) * 3.9);margin:auto;font-size:calc(var(--u) * 2.34);text-align:center}',
    '.hksw .hrs > div > div:first-child{opacity:.8}',
    '.hksw .hrs svg{width:calc(var(--u) * 3.6);height:calc(var(--u) * 3.6);margin:calc(var(--u) * .65) auto}',
    '.hksw.k-inline{display:inline-flex;height:calc(var(--u) * 3.6);font-size:calc(var(--u) * 2.8)}',
    '.hksw.k-inline:not(.b-none){padding:0 calc(var(--u) * 1.4);border-radius:999px}',
    '.hksw .il{display:inline-flex;align-items:center;gap:.3em}',
    '.hksw .il svg{width:1.15em;height:1.15em}',
    '.hksw.k-band{width:100%;height:calc(var(--u) * 10);justify-content:space-around;text-align:center;font-size:calc(var(--u) * 3.4)}',
    '.hksw.k-band:not(.b-none){padding:0 calc(var(--u) * 2);border-radius:calc(var(--u) * 1.6)}',
    '.hksw .rd small{display:block;font-size:calc(var(--u) * 2.5);font-weight:500;opacity:.8}'
  ].join('\n');
  var cssIn = false;
  // one style for the page (a caller with a shadow root of its own puts hkSaverWidgets.CSS in it)
  function ensureCss() {
    var host = document.head || document.body || null;
    if (cssIn || !host || !host.appendChild) return;
    var st = document.createElement('style');
    st.setAttribute('data-hk-saverwidgets', '');
    st.textContent = CSS;
    host.appendChild(st);
    cssIn = true;
  }

  // ------------------------------------------------------------ small helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function num(v) { var n = Number(v); return v !== null && v !== undefined && v !== '' && isFinite(n) ? n : null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round(v) { return v == null ? DASH : String(Math.round(v)); }
  function deg(v) { return v == null ? DASH : Math.round(v) + '°'; }
  function when(v) { var t = v instanceof Date ? +v : Date.parse(v); return isFinite(t) ? t : null; }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  // a time: 12-hour "5:52" (with AM or PM where asked), or 24-hour "17:52"
  function tm(d, h24, mer) {
    var h = d.getHours(), m = d.getMinutes();
    if (h24) return pad(h) + ':' + pad(m);
    return ((h % 12) || 12) + ':' + pad(m) + (mer ? (h < 12 ? ' AM' : ' PM') : '');
  }
  // an hour's name in a column: "12 PM", or "13:00"
  function hourName(d, h24) {
    var h = d.getHours();
    return h24 ? pad(h) + ':00' : ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function secs(v) {
    // (hkTimers.secs, as the strip reads a timer's length: seconds, or H:MM:SS)
    var T = window.hkTimers;
    if (T && T.secs) return T.secs(v);
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var p = String(v).split(':').map(Number);
    if (p.some(isNaN)) return 0;
    while (p.length < 3) p.unshift(0);
    return p[0] * 3600 + p[1] * 60 + p[2];
  }
  function clockText(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
  }

  // ------------------------------------------------------------ glyphs (our own; hk-saverfaces.js keeps its two private)
  var CLOUD = 'M7 14.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10 1A3.1 3.1 0 0 0 7 14.5z';
  var SUN = '<circle cx="12" cy="12" r="4.4"/><path d="M11 2.6h2v2.6h-2zM11 18.8h2v2.6h-2zM2.6 11h2.6v2H2.6zM18.8 11h2.6v2h-2.6zM4.9 6.3l1.4-1.4 1.8 1.8-1.4 1.4zM15.9 17.3l1.4-1.4 1.8 1.8-1.4 1.4zM4.9 17.7l1.8-1.8 1.4 1.4-1.8 1.8zM15.9 6.7l1.8-1.8 1.4 1.4-1.8 1.8z"/>';
  var MOON = '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6z"/>';
  var LINE = ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"';
  var GLYPH = {
    sun: SUN, moon: MOON,
    cloud: '<path d="M7 19h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 19z"/>',
    partly: '<circle cx="8.2" cy="8" r="3"/><path d="M9.6 20h7.6a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1A2.9 2.9 0 0 0 9.6 20z"/>',
    partlynight: '<path d="M11.6 4.2A5 5 0 1 0 14 12 5.5 5.5 0 0 1 11.6 4.2z" transform="translate(-4 -1) scale(.8)"/><path d="M9.6 20h7.6a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1A2.9 2.9 0 0 0 9.6 20z"/>',
    rain: '<path d="' + CLOUD + '"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"' + LINE + '/>',
    snow: '<path d="' + CLOUD + '"/><path d="M8 18.5v.1M12 20v.1M16 18.5v.1"' + LINE.replace('1.8', '2.6') + '/>',
    bolt: '<path d="' + CLOUD + '"/><path d="M12.8 14.6l-3 4.4h2.6l-1 3.4 3.8-5h-2.6z"/>',
    fog: '<path d="M4 9h16M6 13h14M4 17h12"' + LINE.replace('1.8', '2.2') + '/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h15a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h7v2H3z"/>'
  };
  var WXG = { sunny: 'sun', 'clear-night': 'moon', partlycloudy: 'partly', cloudy: 'cloud', fog: 'fog', rainy: 'rain', pouring: 'rain', hail: 'rain',
              snowy: 'snow', 'snowy-rainy': 'snow', lightning: 'bolt', 'lightning-rainy': 'bolt', windy: 'wind', 'windy-variant': 'wind', exceptional: 'cloud' };
  // a condition's glyph; at night the sun is the moon
  function wxGlyph(cond, night) {
    var g = WXG[cond] || 'cloud';
    if (night && g === 'sun') g = 'moon';
    if (night && g === 'partly') g = 'partlynight';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + GLYPH[g] + '</svg>';
  }
  function lockGlyph(open) {
    return '<path d="M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" fill="currentColor"/>' +
      '<path d="' + (open ? 'M8 10V7a4 4 0 0 1 7.6-1.7' : 'M8 10V7a4 4 0 0 1 8 0v3') + '"' + LINE.replace('1.8', '2.2') + '/>';
  }

  // ------------------------------------------------------------ the ring (the mock-up's ring(), in a 100 x 100 box)
  //   frac  how full (null: the track alone); gauge: a three-quarter arc open at the bottom, else a whole ring
  //   main  the figure; sub the label under it; subs [lo, hi] the two ends of a gauge, at its open bottom
  function ring(o) {
    var r = 43, c = 2 * Math.PI * r, arc = o.gauge ? 0.75 : 1, rot = o.gauge ? 135 : -90;
    var circle = function (op, len) {
      return '<circle cx="50" cy="50" r="43" fill="none" stroke="currentColor"' + (op ? ' stroke-opacity="' + op + '"' : '') +
        ' stroke-width="7.5" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(' + rot + ' 50 50)"/>';
    };
    var T = function (x, y, size, w, s, op) {
      return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-weight="' + w + '" font-size="' + size + '"' + (op ? ' opacity="' + op + '"' : '') + '>' + esc(s) + '</text>';
    };
    var n = String(o.main).length, big = n <= 3 ? 30 : n === 4 ? 26 : n === 5 ? 21 : n === 6 ? 18 : 15;
    var hasSub = o.sub != null && o.sub !== '';
    var svg = '<svg viewBox="0 0 100 100" aria-hidden="true">' + circle('.3', c * arc);
    if (o.frac != null) svg += circle(null, c * arc * clamp(o.frac, 0, 1));
    svg += T(50, hasSub || o.subs ? 53 : 58, big, 700, o.main);
    if (hasSub) svg += T(50, 74, String(o.sub).length <= 4 ? 14 : String(o.sub).length <= 6 ? 12 : 10, 600, o.sub, '.85');
    if (o.subs) svg += T(31, 90, 13, 600, o.subs[0], '.85') + T(69, 90, 13, 600, o.subs[1], '.85');
    return svg + '</svg>';
  }

  // ------------------------------------------------------------ what the house says
  // THE HOME STATUS WORDS, from the header's one security calculation (hk-header.js status(), which the screensaver's
  // Home Status card draws): "Home Secured" when armed and everything shut, else what isn't, its first two items --
  // the card's own first line. Where the header isn't loaded the card draws nothing and so do we: a dash.
  var ALARM = { armed_home: 'Armed Home', armed_away: 'Armed Away', armed_night: 'Armed Night', armed_vacation: 'Armed Vacation',
                disarmed: 'Disarmed', triggered: 'Triggered', pending: 'Pending', arming: 'Arming' };
  function homeWords(states) {
    var H = window.hkHeader;
    if (!H || typeof H.status !== 'function') return null;
    var s = H.status(states || {});
    return { secured: s.secured, items: s.items, alarm: ALARM[s.alarmRaw] || '',
             line: s.secured ? 'Home Secured' : s.items.slice(0, 2).join(DOT) || 'All Clear' };
  }
  // the house's locks: the ones Status & Chips names, else every lock
  function locksOf(states) {
    var H = window.hkHeader, ids = [];
    try { ids = H && H.lists ? H.lists().locks || [] : []; } catch (e) { ids = []; }
    if (!ids.length) ids = Object.keys(states).filter(function (k) { return k.indexOf('lock.') === 0; });
    return ids;
  }
  // the sun's next event: whichever of next_setting and next_rising is first, and how far through the day (or night)
  // it is -- from the last event of the other kind, a day before the coming one of it
  function sunNext(states, now) {
    var a = (states['sun.sun'] || {}).attributes || {}, t = +now;
    var set = when(a.next_setting), rise = when(a.next_rising);
    var ev = [['Sunset', set, rise], ['Sunrise', rise, set]].filter(function (e) { return e[1] != null && e[1] >= t - 60000; })
      .sort(function (p, q) { return p[1] - q[1]; })[0];
    if (!ev) return null;
    var start = ev[2] != null ? ev[2] - 86400000 : ev[1] - 43200000;
    return { name: ev[0], at: new Date(ev[1]), frac: clamp((t - start) / (ev[1] - start), 0, 1) };
  }
  // the house's inside temperature: Status & Chips' Indoor Temperature, else the thermostats' (the chosen ones, else
  // every climate) mean current_temperature
  function insideOf(X) {
    var HS = window.hkSettings, st = X.st, id = HS && HS.get ? HS.get('features.temperature', null) : null, v = id && st[id] ? num(st[id].state) : null;
    if (v != null) return v;
    var list = HS && HS.get ? HS.get('features.thermostats', []) : [];
    if (!Array.isArray(list) || !list.length) list = Object.keys(st).filter(function (k) { return k.indexOf('climate.') === 0; });
    var t = list.map(function (k) { return st[k] && num((st[k].attributes || {}).current_temperature); }).filter(function (x) { return x != null; });
    return t.length ? t.reduce(function (p, q) { return p + q; }, 0) / t.length : null;
  }
  // the house battery and the sun (the Energy page's house battery where its sums are in; the side pane's scan else)
  function scan(st, re, dc) {
    return Object.keys(st).filter(function (k) { return re.test(k) && (!dc || (st[k].attributes || {}).device_class === dc) && num(st[k].state) !== null; })[0] || null;
  }
  function batteryOf(X) {
    var s = X.energy(), v = s && s.battery != null ? s.battery : null;
    if (v != null) return v;
    // (mirrors hk-sidepane.js energy: a sensor named for the house, home or Powerwall battery)
    var id = scan(X.st, /^sensor\..*(house|home|powerwall).*battery/, 'battery');
    return id ? num(X.st[id].state) : null;
  }
  function solarOf(X) {
    // (mirrors hk-sidepane.js energy: a sensor named for solar power; also a power sensor named for the panels)
    var st = X.st, id = scan(st, /^sensor\..*solar.*power/) || scan(st, /^sensor\..*(solar|pv)/, 'power');
    if (!id) return null;
    var v = num(st[id].state), u = (st[id].attributes || {}).unit_of_measurement;
    return v == null ? null : u === 'W' ? v / 1000 : v;
  }
  // the calendar's next event: a timed one not yet over (one under way is NOW), else today's first all-day one
  function nextEvent(evs, now, names) {
    var t = +now, day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), day1 = new Date(+day0 + 90000000);
    var list = (evs || []).map(function (e) {
      var s = when(e && e.start), en = when(e && e.end);
      return s == null ? null : { title: String(e.title || e.summary || 'Event'), loc: String(e.loc || e.location || ''), cal: e.cal, allDay: !!e.allDay,
                                  start: new Date(s), end: new Date(en == null ? s + 3600000 : en) };
    }).filter(Boolean).sort(function (a, b) { return a.start - b.start; });
    var pick = list.filter(function (e) { return !e.allDay && +e.end > t; })[0] ||
               list.filter(function (e) { return e.allDay && +e.end > t && +e.start < +day1; })[0];
    if (!pick) return null;
    pick.where = pick.loc || (names && pick.cal && names[pick.cal]) || '';
    pick.now = !pick.allDay && +pick.start <= t;
    pick.dayN = Math.round((new Date(pick.start.getFullYear(), pick.start.getMonth(), pick.start.getDate()) - day0) / 86400000);
    return pick;
  }
  // "3:30 PM", "Tomorrow, 9:15 AM", "Thu, 9:15 AM", "until 4:30 PM", "All Day"
  function eventWhen(e, h24) {
    if (e.now) return 'until ' + tm(e.end, h24, true);
    var day = e.dayN <= 0 ? '' : e.dayN === 1 ? 'Tomorrow' : DAYS[e.start.getDay()].slice(0, 3);
    if (e.allDay) return day || 'All Day';
    return (day ? day + ', ' : '') + tm(e.start, h24, true);
  }

  // ------------------------------------------------------------ the widgets
  // each: kind; fc: the forecast it watches; read(X) -> spec (what it would draw, JSON-able); draw(spec) -> html;
  // text(spec) -> its words, for an inline widget's width. X (see create()): st, now, h24, ctx, wx(), energy(), events().
  var DEFS = {
    temp: { kind: 'circular', fc: 'daily',
      read: function (X) {
        var w = X.wx(), t = w && w.temp, hi = w && w.hi, lo = w && w.lo;
        return { main: deg(t), lo: lo == null ? '' : round(lo), hi: hi == null ? '' : round(hi),
                 frac: t != null && hi != null && lo != null && hi > lo ? Math.round(clamp((t - lo) / (hi - lo), 0, 1) * 200) / 200 : null };
      },
      draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, subs: s.lo !== '' && s.hi !== '' ? [s.lo, s.hi] : null }); } },
    aqi: { kind: 'circular',
      read: function (X) { var w = X.wx(), a = w && w.aqi; return { main: a == null ? DASH : String(a), frac: a == null ? null : Math.round(clamp(a / 300, 0, 1) * 200) / 200 }; },
      draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: 'AQI' }); } },
    humidity: { kind: 'circular',
      read: function (X) { var w = X.wx(), h = w && w.humidity; return { main: h == null ? DASH : Math.round(h) + '%', frac: h == null ? null : clamp(h / 100, 0, 1) }; },
      draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: 'HUM' }); } },
    inside: { kind: 'circular',
      read: function (X) {
        var v = insideOf(X), us = ((X.client && X.client.config) || {}).unit_system || {}, c = /C/.test(String(us.temperature || '')), lo = c ? 10 : 50, hi = c ? 32 : 90;
        return { main: deg(v), frac: v == null ? null : Math.round(clamp((v - lo) / (hi - lo), 0, 1) * 200) / 200 };
      },
      draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: 'IN' }); } },
    battery: { kind: 'circular',
      read: function (X) { var b = batteryOf(X); return { main: b == null ? DASH : Math.round(b) + '%', frac: b == null ? null : clamp(b / 100, 0, 1) }; },
      draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: 'HOME' }); } },
    solar: { kind: 'circular',
      read: function (X) {
        var k = solarOf(X), top = k == null ? 5 : k > 10 ? 20 : k > 5 ? 10 : 5;
        return { main: k == null ? DASH : k >= 10 ? String(Math.round(k)) : (Math.round(k * 10) / 10).toFixed(1), frac: k == null ? null : Math.round(clamp(k / top, 0, 1) * 200) / 200 };
      },
      draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: 'kW' }); } },
    timer: { kind: 'circular',
      // the running timer ending soonest (the strip's sensor, sensor.running_quick_timers: its `running` rows), its time
      // left as a ring that empties
      read: function (X) {
        var run = ((X.st['sensor.running_quick_timers'] || {}).attributes || {}).running, t = +X.now;
        var row = (Array.isArray(run) ? run : []).filter(function (r) { return r && when(r.finishes_at) != null; })
          .sort(function (p, q) { return when(p.finishes_at) - when(q.finishes_at); })[0];
        if (!row) return { main: DASH, name: 'TIMER', frac: 0, live: false };
        var left = Math.max(0, Math.ceil((when(row.finishes_at) - t) / 1000)), ent = row.entity_id && X.st[row.entity_id];
        var total = secs(row.total) || (ent ? secs((ent.attributes || {}).duration) : 0);
        return { main: clockText(left), name: cut(String(row.name || 'Timer').toUpperCase(), 9), frac: total ? Math.round(clamp(left / total, 0, 1) * 500) / 500 : 1, live: left > 0 };
      },
      draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.name }); } },
    locks: { kind: 'circular',
      read: function (X) {
        var n = 0, known = 0;
        locksOf(X.st).forEach(function (id) {
          var v = (X.st[id] || {}).state;
          if (v === 'unknown' || v === 'unavailable' || v === undefined) return;
          known++;
          if (v === 'unlocked') n++;
        });
        return { text: !known ? DASH : n ? n + ' Unlocked' : 'Locked', open: n > 0 };
      },
      draw: function (s) {
        var fs = s.text.length > 8 ? 12 : 14;
        return '<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(31 16) scale(1.55)">' + lockGlyph(s.open) + '</g>' +
          '<text x="50" y="82" text-anchor="middle" font-weight="600" font-size="' + fs + '">' + esc(s.text) + '</text></svg>';
      } },
    sunset: { kind: 'circular',
      read: function (X) {
        var n = sunNext(X.st, X.now);
        return n ? { main: tm(n.at, X.h24), name: n.name.toUpperCase(), frac: Math.round(n.frac * 200) / 200 } : { main: DASH, name: 'SUNSET', frac: null };
      },
      draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.name }); } },

    next_event: { kind: 'rectangular',
      read: function (X) {
        var e = nextEvent(X.events(), X.now, X.calNames());
        return e ? { l1: (e.now ? 'Now' : 'Up Next') + DOT + eventWhen(e, X.h24), l2: e.title, l3: e.where } : { l1: 'Up Next', l2: DASH, l3: '' };
      },
      draw: function (s) { return lines(s.l1, s.l2, s.l3); } },
    next_hours: { kind: 'rectangular', fc: 'hourly',
      // Now, then the two hours after it from the hourly forecast
      read: function (X) {
        var w = X.wx(), t = +X.now, night = X.night, cols = [{ t: 'Now', c: w ? w.cond : null, n: night(t), v: w ? deg(w.temp) : DASH }];
        var next = (X.hourly() || []).map(function (f) { return { at: when(f && f.datetime), f: f }; })
          .filter(function (e) { return e.at != null && e.at > t; }).sort(function (p, q) { return p.at - q.at; }).slice(0, 2);
        for (var i = 0; i < 2; i++) {
          var e = next[i], at = e ? new Date(e.at) : new Date(new Date(t).setMinutes(0, 0, 0) + 3600000 * (i + 1));
          cols.push({ t: hourName(at, X.h24), c: e ? e.f.condition : null, n: e ? (e.f.is_daytime === false || (e.f.is_daytime == null && night(e.at))) : false, v: e ? deg(num(e.f.temperature)) : DASH });
        }
        return { cols: cols };
      },
      draw: function (s) {
        return '<div class="hrs">' + s.cols.map(function (c) {
          return '<div><div>' + esc(c.t) + '</div>' + (c.c ? wxGlyph(c.c, c.n) : '<svg viewBox="0 0 24 24" aria-hidden="true"></svg>') + '<div>' + esc(c.v) + '</div></div>';
        }).join('') + '</div>';
      } },
    home_status: { kind: 'rectangular',
      // HOME, then the alarm and the first thing wrong; or Secured, and the alarm
      read: function (X) {
        var h = homeWords(X.st);
        if (!h) return { l1: 'Home', l2: DASH, l3: '' };
        return { l1: 'Home', l2: h.secured ? 'Secured' : h.items[0] || h.alarm || 'All Clear', l3: h.secured ? h.alarm : h.items.slice(1, 3).join(DOT) };
      },
      draw: function (s) { return lines(s.l1, s.l2, s.l3); } },
    energy_today: { kind: 'rectangular',
      // the Energy page's sums (hkEnergy.summary, as the Energy slide reads them): today's use and what the panels made
      read: function (X) {
        var s = X.energy(), H = window.hkEnergy, k = function (v) { return (H && H.kwh ? H.kwh(v) : (Math.round(v * 10) / 10).toFixed(1)) + ' kWh'; };
        if (!s || !s.today) return { l1: 'Energy Today', l2: DASH + ' kWh used', l3: DASH + ' kWh made' };
        var solar = (s.rings || []).some(function (r) { return r.key === 'solar'; });
        return { l1: 'Energy Today', l2: k(s.today.energy) + ' used', l3: solar ? k(s.today.solar) + ' made' : '' };
      },
      draw: function (s) { return lines(s.l1, s.l2, s.l3); } },

    date: { kind: 'inline',
      read: function (X) { return { text: DAYS[X.now.getDay()] + ', ' + MONTHS[X.now.getMonth()] + ' ' + X.now.getDate() }; } },
    weather_line: { kind: 'inline',
      read: function (X) {
        var w = X.wx();
        return w && w.temp != null ? { text: deg(w.temp) + ' ' + (w.says || ''), g: wxGlyph(w.cond, X.night(+X.now)) } : { text: DASH, g: '' };
      } },
    status_line: { kind: 'inline',
      read: function (X) { var h = homeWords(X.st); return { text: h ? h.line : DASH }; } },
    event_line: { kind: 'inline',
      read: function (X) {
        var e = nextEvent(X.events(), X.now, X.calNames());
        return { text: e ? e.title + DOT + eventWhen(e, X.h24) : DASH };
      } },
    photo_title: { kind: 'inline',
      read: function (X) { var t = X.ctx && X.ctx.title; return { text: t === undefined || t === null ? DASH : String(t) }; } },

    readings: { kind: 'band',
      // Big Weather's bottom row, as it draws it: only the readings the house has, each figure over its label
      read: function (X) {
        var w = X.wx(), cols = [], n = sunNext(X.st, X.now);
        if (w && n) cols.push([tm(n.at, X.h24, true), n.name]);
        else if (w && w.sunset) cols.push([tm(w.sunset, X.h24, true), 'Sunset']);
        if (w && w.wind != null) cols.push([Math.round(w.wind) + (w.windUnit ? ' ' + w.windUnit : ''), 'Wind']);
        if (w && w.humidity != null) cols.push([Math.round(w.humidity) + '%', 'Humidity']);
        if (w && w.aqi != null) cols.push([String(w.aqi), 'AQI']);
        return { cols: cols };
      },
      draw: function (s) {
        return s.cols.length ? s.cols.map(function (c) { return '<div class="rd">' + esc(c[0]) + '<small>' + esc(c[1]) + '</small></div>'; }).join('') : '<div class="rd">' + DASH + '</div>';
      } }
  };
  // a rectangular widget's three lines: a small label, a bold line, a line under it
  function lines(a, b, c) {
    return '<div class="rt"><div class="l1">' + esc(a) + '</div><div class="l2">' + esc(b) + '</div>' + (c ? '<div class="l3">' + esc(c) + '</div>' : '') + '</div>';
  }
  // an inline widget's markup: its glyph, then its words
  Object.keys(DEFS).forEach(function (id) {
    var d = DEFS[id];
    if (d.kind === 'inline') {
      d.draw = function (s) { return '<span class="il">' + (s.g || '') + '<span>' + esc(s.text) + '</span></span>'; };
      d.text = function (s) { return s.text; };
    }
  });

  // ------------------------------------------------------------ one widget
  function create(id, opts) {
    var def = DEFS[id];
    if (!def) return null;
    opts = opts || {};
    var back = BACKS.indexOf(opts.back) >= 0 ? opts.back : 'none', color = COLORS.indexOf(opts.color) >= 0 ? opts.color : 'auto';
    var u = num(opts.u) > 0 ? num(opts.u) : 8, h24 = !!opts.h24;
    var el = document.createElement('div');
    el.className = 'hksw k-' + def.kind + ' w-' + id + ' b-' + back + ' c-' + color;
    el.style.setProperty('--u', u + 'px');
    ensureCss();

    var dead = false, busy = false, drawn = null, spec = null, last = { client: null, now: null, ctx: null };
    var daily = [], hourly = [], fc = null, fcFor = '', needFetched = {};
    var en = { at: 0, val: null, stale: false };
    var api = { el: el, id: id, kind: def.kind, live: false };

    // THE FORECAST this widget draws (daily: today's high and low; hourly: the next hours), watched as the cards watch it
    // (hkWxForecast), drawn again when it arrives, and let go of in destroy()
    function watchForecast(entity) {
      var F = window.hkWxForecast, c = last.client;
      if (!def.fc || !F || !c || !c.subscriptions || !entity || fcFor === entity) return false;
      if (fc) fc.release();
      fcFor = entity;
      var kind = def.fc, got = function (w) { if (kind === 'daily') daily = w.data(); else hourly = w.data(); };
      var w = fc = F.watch(c.subscriptions, kind, entity, function () {
        if (!w || fc !== w) return;
        got(w);
        again();
      });
      // (a forecast another card already watches is here now, and is not announced again)
      got(w);
      return true;
    }
    // CODE THAT ISN'T THERE YET (Mantel loads its card files on first use): asked for once, drawn again when it lands
    function need(file) {
      if (needFetched[file] || !window.hkNeed || !window.hkNeed.file) return;
      needFetched[file] = true;
      try { Promise.resolve(window.hkNeed.file(file)).then(again, function () { /* the next update asks no more */ }); } catch (e) { /* none */ }
    }
    // (with the clock the caller last gave: an editor's preview of the evening keeps its evening)
    function again() { if (!dead && last.client) api.update(last.client, last.now, last.ctx); }

    var X = {
      client: null, st: {}, now: new Date(), h24: h24, ctx: null, quiet: false,
      // the weather now (hkWxReadings, the Weather page's reading) with the daily forecast this widget watches
      wx: function () {
        var R = window.hkWxReadings;
        if (X.quiet) return null;
        if (!R) { need('hk-weather.js'); return null; }
        var w = R.read(X.client, { entity: opts.weather || null, daily: daily });
        if (w && watchForecast(w.entity)) w = R.read(X.client, { entity: opts.weather || null, daily: daily });
        if (fc) fc.ensure();
        return w;
      },
      hourly: function () { return X.quiet ? [] : hourly; },
      // night at an instant: the header's reading of the sun's times, else the sun now
      night: function (t) {
        var H = window.hkHeader;
        try { if (H && H.nightAt) return !!H.nightAt(X.st, t); } catch (e) { /* below */ }
        return (X.st['sun.sun'] || {}).state === 'below_horizon' && Math.abs(t - +X.now) < 3600000;
      },
      // the Energy page's sums, kept ENERGY_TTL (a minute's worth of statistics is not worth reading every update); the
      // statistics' arrival draws the widget again
      energy: function () {
        var H = window.hkEnergy, t = Date.now();
        if (X.quiet) return null;
        if (!H || !H.summary) { need('hk-energy.js'); return null; }
        // (asked again when its sums arrive -- at most once a second: a summary that wakes whoever just read it would
        // otherwise read again at once, forever, and hold the page; 2026-11-01, the house's Battery widget)
        if (en.at && t - en.at < (en.stale ? 1000 : en.val ? ENERGY_TTL : 3000)) return en.val;
        en.stale = false; en.at = t;
        try {
          en.val = H.summary(X.client, waker) || null;
        } catch (e) { console.warn('[hk-saverwidgets]', id, e && e.message); en.val = null; }
        return en.val;
      },
      // the calendar's events: handed in (ctx.events), else the shared read (one per CAL_TTL for every widget)
      events: function () { return X.quiet ? [] : X.ctx && Array.isArray(X.ctx.events) ? X.ctx.events : calendar(X.client); },
      calNames: function () {
        var names = {};
        Object.keys(X.st).forEach(function (k) { if (k.indexOf('calendar.') === 0) names[k] = (X.st[k].attributes || {}).friendly_name || ''; });
        return names;
      }
    };
    // ONE WAKER for this widget, and its wake a moment later: the summary keeps who it wakes (a new one on each read
    // was a new subscriber each time), and a wake drawn at once from inside a read never lets the page breathe
    var wakeT = null, waker = { get isConnected() { return !dead; }, requestUpdate: wake, redraw: wake };
    function wake() {
      en.stale = true;
      if (wakeT || dead) return;
      // (after the second a read waits for: then the read it wakes for is one that reads)
      wakeT = setTimeout(function () { wakeT = null; if (!busy) again(); }, Math.max(250, 1000 - (Date.now() - en.at)));
    }
    if (id === 'next_event' || id === 'event_line') CAL.watchers.push(again);

    api.update = function (client, now, ctx) {
      if (dead) return false;
      last.client = client || { states: {} }; last.now = now; last.ctx = ctx;
      X.client = last.client; X.st = last.client.states || {};
      X.now = now instanceof Date ? now : isFinite(now) && now !== null && now !== undefined ? new Date(now) : new Date();
      X.ctx = ctx || null;
      if (busy) { en.stale = true; return false; }
      busy = true;
      try {
        try { spec = def.read(X); } catch (e) {
          // (a reading that throws draws what an empty house would: dashes)
          console.warn('[hk-saverwidgets]', id, e && e.message);
          X.quiet = true;
          try { X.st = {}; X.ctx = null; spec = def.read(X); } catch (e2) { return false; } finally { X.quiet = false; }
        }
      } finally { busy = false; }
      api.live = !!spec.live;
      var key = JSON.stringify(spec);
      if (key === drawn) return false;
      drawn = key;
      el.innerHTML = def.draw(spec);
      return true;
    };

    // THE SIZE IT WANTS, in px: its unit size; an inline widget's is its text's -- measured where the page can, else
    // estimated from the number of letters (the tests' shim has no layout)
    api.measure = function () {
      var k = SIZE[def.kind], pad = def.kind === 'inline' && back !== 'none' ? 2.8 * u : 0;
      if (def.kind === 'inline') {
        var inner = el.firstElementChild || null, mw = inner && inner.offsetWidth > 0 ? inner.offsetWidth : 0;
        if (mw) return { w: Math.ceil(mw + pad), h: k[1] * u };
        var txt = spec ? def.text(spec) : '';
        return { w: txt ? Math.ceil(txt.length * 0.52 * 2.8 * u + (spec.g ? 4 * u : 0) + pad) : 0, h: k[1] * u };
      }
      if (def.kind === 'band') return { w: Math.max(1, spec ? spec.cols.length : 0) * 14 * u, h: k[1] * u };
      return { w: k[0] * u, h: k[1] * u };
    };
    api.setU = function (v) {
      if (!(num(v) > 0)) return;
      u = num(v);
      el.style.setProperty('--u', u + 'px');
    };
    api.destroy = function () {
      dead = true;
      clearTimeout(wakeT); wakeT = null;
      if (window.hkStats && window.hkStats.release) { try { window.hkStats.release(waker); } catch (e) { /* gone */ } }
      if (fc) { fc.release(); fc = null; }
      var i = CAL.watchers.indexOf(again);
      if (i >= 0) CAL.watchers.splice(i, 1);
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    return api;
  }

  // THE CALENDAR'S EVENTS, one read for every widget that wants them (hkCalendar.load, the Calendar page's and the
  // side pane's own): today and tomorrow, asked for again after CAL_TTL, a failed read after CAL_RETRY, and a read
  // that never answers given up after CAL_LOST (as the side pane's: one sent as the connection was made again never
  // answers). No calendar code or no calendars: nothing is asked.
  var CAL_RETRY = 30000, CAL_LOST = 30000;
  var CAL = { evs: null, at: 0, busy: 0, failAt: 0, n: 0, asked: false, watchers: [] };
  function calendar(client) {
    var K = window.hkCalendar, now = Date.now();
    if (!K && !CAL.asked && window.hkNeed && window.hkNeed.file) {
      CAL.asked = true;
      try { Promise.resolve(window.hkNeed.file('hk-calendar.js')).then(function () { CAL.watchers.slice().forEach(function (f) { f(); }); }, function () { /* none */ }); } catch (e) { /* none */ }
    }
    if (CAL.busy && now - CAL.busy > CAL_LOST) CAL.busy = 0;
    if (!K || !K.load || !K.ids || !client || CAL.busy || now - CAL.failAt < CAL_RETRY || (CAL.evs && now - CAL.at < CAL_TTL)) return CAL.evs || [];
    var ids = [];
    try { ids = K.ids(client); } catch (e) { ids = []; }
    if (!ids.length) { CAL.evs = []; CAL.at = now; return CAL.evs; }
    var n = ++CAL.n, from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 2);
    CAL.busy = now;
    var done = function () { CAL.busy = 0; };
    try {
      K.load(client, ids, from, to).then(function (got) {
        if (n !== CAL.n) return;
        done(); CAL.evs = (got && got.evs) || []; CAL.at = Date.now(); CAL.failAt = 0;
        CAL.watchers.slice().forEach(function (f) { f(); });
      }, function () { if (n === CAL.n) { done(); CAL.failAt = Date.now(); } });
    } catch (e) { done(); CAL.failAt = now; }
    return CAL.evs || [];
  }

  window.hkSaverWidgets = {
    IDS: Object.keys(DEFS), has: function (id) { return !!DEFS[id]; }, kind: function (id) { return DEFS[id] ? DEFS[id].kind : null; },
    create: create, CSS: CSS,
    _: { ring: ring, wxGlyph: wxGlyph, nextEvent: nextEvent, eventWhen: eventWhen, sunNext: sunNext, homeWords: homeWords, cal: CAL, tm: tm }
  };
})();
