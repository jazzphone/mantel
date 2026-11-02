// hk-saverpieces-picked.js -- THE SCREENSAVER'S PICKED-ENTITY GLANCE PIECES (2026-11-02, phase 13, phase 1b, wave C:
// docs/phase13/GLANCE-SPEC.md, "Wave C"): alarm, trash, pollen, appliance, leak, travel and price. One group, one file, loaded
// after hk-saverwidgets.js, which draws them: each piece is declared once (the plan's rule 1) with hkSaverWidgets.define() and drawn
// with the renderer's own classes and helpers (ring, inl, lines, ...), so it looks like the core pieces in every backdrop, ink and
// size. The few rules this group adds go through hkSaverWidgets.addCss, in `--u`, on the spacing scale (.4 .8 1.2 1.6 2.4 3.2).
//
// ONE ENTITY PICKED, WITH A SUGGESTED DEFAULT. Each piece has `entity` (appliance and travel also `entity2`), which the renderer's
// optsOf() hands over as an entity id or ''. '' is the SUGGESTED DEFAULT, found in the house's states by a pure function,
// hkSaverWidgets._.picked.suggest[piece](states, key) -> an id or '' (key 'entity', the default, or 'entity2'); .all(states) is the
// whole ranked list. The editor's picker calls the same functions, so the default it shows is the one the piece uses:
//
//   alarm      the first sensor.*_next_alarm (the Companion app's), a timestamp sensor first
//   trash      the first calendar, else sensor, whose id or name has trash, garbage, waste, recycl or bin
//   pollen     the first sensor with pollen in its id or name (an overall, total, index or level one first)
//   appliance  timestamp or duration sensors named for a washer, dryer or dishwasher (or wash, dry, remaining, finish, completion);
//              one per appliance, so entity and entity2 are two machines and not one machine's two sensors
//   travel     sensors from Waze or Google travel time (a duration with an origin or destination, or travel, commute, waze in the id)
//   price      the Energy plan's price entity (hkSettings energy.total.price), else a sensor named price, tariff or rate whose unit
//              has a currency
//
// WHERE EACH READS (the survey, side-session-notes/phase13-glance-data-sources.md, items 5, 8, 9 and 12):
//   alarm      the picked sensor's state, an ISO timestamp; shows while one is set within 24 hours
//   trash      a calendar: the shared calendar read (X.events()) AND a small read of its own (the picked calendar, three days, kept an
//              hour, shared by every trash piece), because the shared read need not cover tomorrow; a sensor: its state as a date, a
//              timestamp, "today" / "tomorrow", or the number of days until
//   pollen     words, a category/risk attribute, or a number (an index of 0 to 5 or 0 to 12, or a count per cubic meter)
//   appliance  a completion timestamp, a remaining duration, an operation-state sensor or a binary sensor; what it has to say about
//              "done" is partly remembered (below)
//   leak       Settings' kinds.leaks and kinds.smoke (all of them; none picked): `on` is tripped, unknown and unavailable are NOT
//              (a sleepy battery sensor sits at unknown for days: hk-header.js, ~550)
//   travel     the sensor's state (minutes) or attributes.duration; duration_in_traffic against duration for "slower than usual"
//   price      the sensor's state with its unit; tier / period and next_change attributes
//
// THE RULES (SCREENSAVER-UNIFIED.md, "The rules every piece follows"): nothing animates and nothing blurs; one read per source,
// shared (the calendar read per calendar; appliances' memory per entity); a read never wakes a read (0.1.104) -- the trash calendar's
// answer calls the renderer's shared watchers AFTER it lands, never from inside a read; data that is not there is a dash for the
// always-on pieces (pollen, travel, price: the screensaver leaves a blank inline piece out) and hides the "shows when" ones.
//
// THE DRAWING (PIECES-SPEC.md, "Spacing and alignment"): every circle has the renderer's ring track (7.5 wide, radius 43) and its
// label on the baseline 72; a glyph over a label is centered with it; figures are centered by their caps (ring()) and tabular;
// nothing sits closer than 1.6 u to a backdrop's edge.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._) return;
  if (W._.picked) return;                                       // loaded twice

  var H = W._;
  var esc = H.esc, num = H.num, clamp = H.clamp, cut = H.cut, tm = H.tm, ring = H.ring, inl = H.inl, lines = H.lines, accStyle = H.accStyle,
      DASH = H.DASH, DOT = H.DOT, ACC = H.ACC;
  var HOUR = 3600000, DAY = 86400000, MIN = 60000;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ------------------------------------------------------------ the look this group adds
  // Two rows of a rectangular piece (two appliances, two places): 4.6 u each with .4 u between, so 1.7 u of the 13 u is above and
  // below them. A dot, the name taking what room there is, the figure at the right. The leak card's title row: the title and a
  // glyph at the right, 2.4 u (under the title's 2.7 u line, so the title still sits .6 u over the first line).
  var CSS = [
    '.hksw .pk-rows{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--u) * .4)}',
    '.hksw .pk-row{display:flex;align-items:center;gap:calc(var(--u) * 1.2);min-width:0;height:calc(var(--u) * 4.6);font-size:calc(var(--u) * 2.2);line-height:1.2}',
    '.hksw .pk-row .dot{margin-right:0}',
    '.hksw .pk-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:700}',
    '.hksw .pk-v{flex:none;font-size:calc(var(--u) * 2);font-weight:600;opacity:.85}',
    '.hksw .pk-h{display:flex;align-items:center;justify-content:space-between;gap:calc(var(--u) * 1.6)}',
    '.hksw .pk-h svg{flex:none;width:calc(var(--u) * 2.4);height:calc(var(--u) * 2.4)}',
    '.hksw .pk-h + div{margin-top:calc(var(--u) * .6)}'
  ].join('\n');
  if (W.addCss) W.addCss(CSS);

  // ------------------------------------------------------------ accents ([light ink, dark ink] pairs)
  var INDIGO = ['#9aa8ff', '#4452b8'];                          // the phone's alarm
  var TEAL = ['#6fd6cf', '#1b8a85'];                            // an appliance at work
  var BLUE = ['#7cc8ff', '#1f78b8'];                            // the way to somewhere

  // ------------------------------------------------------------ small helpers
  function r200(v) { return Math.round(v * 200) / 200; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function usable(v) { return v !== undefined && v !== null && v !== 'unknown' && v !== 'unavailable' && v !== ''; }
  function obj(v) { return v && typeof v === 'object' ? v : null; }
  function stOf(st, id) { return id && st ? obj(st[id]) : null; }
  function attrsOf(st, id) { var s = stOf(st, id); return s && obj(s.attributes) ? s.attributes : {}; }
  function fnameOf(st, id) { var a = attrsOf(st, id); return a.friendly_name ? String(a.friendly_name) : ''; }
  function oidOf(id) { return String(id || '').split('.').slice(1).join('.'); }
  // a name: the friendly one, else the entity id's words in Title Case
  function nameOf(st, id) {
    var n = fnameOf(st, id);
    if (n) return n;
    return oidOf(id).replace(/_/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) || DASH;
  }
  function titleCase(s) { return String(s || '').replace(/[_\s]+/g, ' ').trim().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function setting(path, fb) {
    var HS = window.hkSettings;
    try { var v = HS && typeof HS.get === 'function' ? HS.get(path, fb) : fb; return v === undefined ? fb : v; } catch (e) { return fb; }
  }
  // an ISO date-time as an instant (Date.parse reads a bare "5" as a year in some engines: a state that is a number is not a time)
  function isoTime(v) {
    if (v instanceof Date) return +v;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v.trim())) return null;
    var t = Date.parse(v.trim().replace(' ', 'T'));
    return isFinite(t) ? t : null;
  }
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // whole local days from `now` to a date (0 today, 1 tomorrow, -1 yesterday)
  function dayN(d, now) { return Math.round((+midnight(d) - +midnight(now)) / DAY); }
  // a clock time, "7 PM" where the minutes are 0 (12-hour), else the renderer's "7:30 PM"
  function tmShort(d, h24) { return !h24 && d.getMinutes() === 0 ? ((d.getHours() % 12) || 12) + (d.getHours() < 12 ? ' AM' : ' PM') : tm(d, h24, true); }
  function wake(list) { list.slice().forEach(function (f) { try { f(); } catch (e) { /* that piece is gone */ } }); }
  function wakeAll() { wake((H.cal && H.cal.watchers) || []); }
  function ids(st, dom) { return Object.keys(st || {}).filter(function (k) { return k.indexOf(dom + '.') === 0; }).sort(); }
  function dcOf(st, id) { return attrsOf(st, id).device_class; }
  function unitOf(st, id) { return String(attrsOf(st, id).unit_of_measurement || ''); }
  // stable: ranked ids, the better rank first, then the id
  function ranked(list, rank) {
    return list.map(function (id) { return { id: id, r: rank(id) }; }).sort(function (a, b) { return a.r - b.r || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }).map(function (x) { return x.id; });
  }

  // ------------------------------------------------------------ glyphs (24 x 24, drawn with the line of the renderer's own)
  var LN = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  // (a glyph in a line of words: the renderer's .il sizes it to 1.15 em; in the leak card's title row .pk-h sizes it)
  function gl(inner) { return '<svg class="a" viewBox="0 0 24 24" aria-hidden="true"' + LN + '>' + inner + '</svg>'; }
  // (a glyph over a circle's label: 24 units scaled 1.5 and centered on the ring's middle, its top at 24 and its bottom at 54, so it and
  // the label on 72 stand centered together; thinner lines than a line of words has, as it is drawn larger)
  function ringed(inner, label) {
    var n = String(label).length, fs = n <= 5 ? 14 : n <= 7 ? 12 : 11;
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="a" cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="7.5"/>' +
      '<g class="a" transform="translate(32 21) scale(1.5)"' + LN.replace('stroke-width="2"', 'stroke-width="1.7"') + '>' + inner + '</g>' +
      '<text x="50" y="72" text-anchor="middle" font-weight="600" font-size="' + fs + '">' + esc(label) + '</text></svg>';
  }
  var BELL = '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.7a2 2 0 0 0 4 0"/>';
  var BIN = '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6"/>';
  var LEAF = '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8"/>';
  var DROP = '<path d="M12 3.2c3.6 4.3 6 7.2 6 10.3a6 6 0 0 1-12 0c0-3.1 2.4-6 6-10.3z"/>';
  var ALERT = '<path d="M12 3.5l9.2 16H2.8zM12 10v4.4M12 17.3v.1"/>';
  var BOLT = '<path d="M13 2.8L5.5 13.4h5.3l-.8 7.8 7.7-11h-5.3z"/>';
  var PIN = '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>';
  var MACHINE = '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="13.2" r="4.2"/><path d="M8 6.6h.1M11 6.6h.1"/>';

  // ------------------------------------------------------------ SUGGESTED DEFAULTS: pure functions of the house's states
  var TRASH_RE = /trash|garbage|waste|recycl|rubbish|(^|[^a-z])bins?($|[^a-z])/i;
  var POLLEN_RE = /pollen/i;
  var APPL_RE = /washer|dryer|dishwasher|wash|dry|remaining|finish|completion/i;
  var TRAVEL_RE = /travel|commute|waze/i;
  var PRICE_RE = /price|tariff|rate/i;
  var CURRENCY_RE = /\$|€|£|¢|¥|₹|\b(usd|eur|gbp|cad|aud|nzd|chf|jpy|sek|nok|dkk|pln|brl|zar|cents?)\b/i;
  // (a sensor that is something else: a battery, a signal, a humidity... )
  var NOT_IT = ['battery', 'humidity', 'temperature', 'signal_strength', 'voltage', 'current', 'power', 'illuminance', 'pressure'];

  function textOf(st, id) { return oidOf(id) + ' ' + fnameOf(st, id); }
  function sensorsOf(st) { return ids(st, 'sensor').filter(function (id) { return NOT_IT.indexOf(dcOf(st, id)) < 0; }); }

  function alarmAll(st) {
    var list = sensorsOf(st).filter(function (id) { return /(^|_)next_alarm($|_)/.test(oidOf(id)); });
    return ranked(list, function (id) { return dcOf(st, id) === 'timestamp' ? 0 : 1; });
  }
  function trashAll(st) {
    var cals = ids(st, 'calendar').filter(function (id) { return TRASH_RE.test(textOf(st, id)); });
    var sens = sensorsOf(st).filter(function (id) {
      var dc = dcOf(st, id);
      return (dc === undefined || ['timestamp', 'date', 'duration', 'enum'].indexOf(dc) >= 0) && TRASH_RE.test(textOf(st, id));
    });
    return cals.concat(sens);
  }
  function pollenAll(st) {
    var list = sensorsOf(st).filter(function (id) { return POLLEN_RE.test(textOf(st, id)); });
    return ranked(list, function (id) { return /overall|total|index|level|risk|count|all/i.test(textOf(st, id)) ? 0 : 1; });
  }
  // (the machine a name is: one per machine, so two suggestions are two machines)
  function machineOf(st, id) {
    var t = textOf(st, id);
    if (/dishwasher/i.test(t)) return 'dishwasher';
    if (/dryer|(^|[^a-z])dry($|[^a-z])/i.test(t)) return 'dryer';
    if (/washer|washing|wash/i.test(t)) return 'washer';
    return oidOf(id);
  }
  function applianceAll(st) {
    var list = sensorsOf(st).filter(function (id) {
      var dc = dcOf(st, id);
      return (dc === 'timestamp' || dc === 'duration') && APPL_RE.test(textOf(st, id));
    });
    var seen = {};
    return ranked(list, function (id) { return /washer|dryer|dishwasher/i.test(textOf(st, id)) ? 0 : 1; }).filter(function (id) {
      var m = machineOf(st, id);
      if (seen[m]) return false;
      seen[m] = 1;
      return true;
    });
  }
  function travelAll(st) {
    var strong = [], weak = [];
    sensorsOf(st).forEach(function (id) {
      var a = attrsOf(st, id);
      if (a.duration !== undefined && (a.origin !== undefined || a.destination !== undefined)) strong.push(id);
      else if (TRAVEL_RE.test(textOf(st, id))) weak.push(id);
    });
    return strong.concat(weak);
  }
  function priceAll(st) {
    var out = [], plan = obj(setting('energy', null)), pid = plan && obj(plan.total) ? plan.total.price : null;
    if (typeof pid === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(pid) && stOf(st, pid)) out.push(pid);
    sensorsOf(st).forEach(function (id) {
      if (out.indexOf(id) < 0 && PRICE_RE.test(textOf(st, id)) && CURRENCY_RE.test(unitOf(st, id))) out.push(id);
    });
    return out;
  }
  var ALL = { alarm: alarmAll, trash: trashAll, pollen: pollenAll, appliance: applianceAll, travel: travelAll, price: priceAll };
  var suggest = {};
  Object.keys(ALL).forEach(function (piece) {
    var f = function (states, key) {
      var all = [];
      try { all = ALL[piece](states || {}); } catch (e) { all = []; }
      return (key === 'entity2' ? all[1] : all[0]) || '';
    };
    f.all = function (states) { try { return ALL[piece](states || {}); } catch (e) { return []; } };
    suggest[piece] = f;
  });
  // the entity a piece reads: the one picked, else the suggested default
  function pick(X, piece) { return X.opts.entity || suggest[piece](X.st) || ''; }
  // two entities (appliance, travel): each the one picked, else the suggestions, never the same one twice
  function pickTwo(X, piece) {
    var a = X.opts.entity || '', b = X.opts.entity2 || '', all = suggest[piece].all(X.st);
    if (!a) a = all.filter(function (x) { return x !== b; })[0] || '';
    if (!b) b = all.filter(function (x) { return x !== a; })[0] || '';
    return [a, b].filter(function (x, i, l) { return x && l.indexOf(x) === i; });
  }

  // ------------------------------------------------------------ PHONE ALARM: while one is set within 24 hours
  //   -> null, or the instant the alarm rings
  function alarmOf(X) {
    var id = pick(X, 'alarm'), s = stOf(X.st, id);
    if (!s || !usable(s.state)) return null;
    var t = isoTime(String(s.state)), d = t == null ? null : t - +X.now;
    return d != null && d > -MIN && d <= DAY ? t : null;
  }
  W.define('alarm', {
    name: 'Phone Alarm', group: 'Time and Calendar', wave: 'C', facts: ['alarm'], source: 'sensor.*_next_alarm', when: 'while an alarm is set',
    wakes: ['minute', 'house'], pick: { entity: 'sensor' }, off: false, opts: { entity: 'entity:sensor' }, defaults: { entity: '' }, accent: INDIGO,
    shapes: {
      inline: {
        read: function (X) {
          var t = alarmOf(X);
          return t == null ? { off: true, text: '' } : { text: 'Alarm ' + tm(new Date(t), X.h24, true), gl: 1 };
        },
        draw: function (s) { return inl(gl(BELL), s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Alarm 6:30 AM', gl: 1 }
      },
      circular: {
        // the time, "ALARM" under it, the ring filling as it nears (empty at a day away)
        read: function (X) {
          var t = alarmOf(X);
          return t == null ? { off: true, main: DASH, frac: null } : { main: tm(new Date(t), X.h24, false), frac: r200(clamp(1 - (t - +X.now) / DAY, 0, 1)) };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: 'ALARM' }); },
        sample: { main: '6:30', frac: 0.7 }
      }
    }
  });

  // ------------------------------------------------------------ TRASH DAY: the day before and the day of
  // A calendar's events come from the renderer's shared read (X.events(): today and tomorrow, or what the screensaver hands in) and
  // from a small read of this group's own -- the picked calendar, three days, kept an hour, shared by every trash piece -- because
  // the shared one need not reach tomorrow. A failed read is asked again after five minutes, one that never answers is given up on.
  var TR_DAYS = 3, TR_TTL = HOUR, TR_RETRY = 5 * MIN, TR_LOST = 30000;
  var TR = { by: {}, asked: false };
  function trashRead(client, id) {
    var K = window.hkCalendar, now = Date.now(), r = TR.by[id] || (TR.by[id] = { evs: null, at: 0, busy: 0, failAt: 0, n: 0 });
    if (!K && !TR.asked && window.hkNeed && window.hkNeed.file) {
      TR.asked = true;
      try { Promise.resolve(window.hkNeed.file('hk-calendar.js')).then(wakeAll, function () { /* none */ }); } catch (e) { /* none */ }
    }
    if (r.busy && now - r.busy > TR_LOST) r.busy = 0;
    if (!K || !K.load || !client || r.busy || now - r.failAt < TR_RETRY || (r.evs && now - r.at < TR_TTL)) return r.evs || [];
    var n = ++r.n, from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + TR_DAYS);
    r.busy = now;
    try {
      K.load(client, [id], from, to).then(function (got) {
        if (n !== r.n) return;
        r.busy = 0; r.evs = (got && got.evs) || []; r.at = Date.now(); r.failAt = 0;
        wakeAll();
      }, function () { if (n === r.n) { r.busy = 0; r.failAt = Date.now(); } });
    } catch (e) { r.busy = 0; r.failAt = now; }
    return r.evs || [];
  }
  // the word the pick says: recycling where it says so, else trash
  function trashWord(text) { return /recycl/i.test(text) ? 'Recycling' : 'Trash'; }
  // the next trash event of a calendar, today (until it is over) or tomorrow: { word, n } or null. A dedicated trash calendar (its name
  // has the words) counts every event of it
  function trashEvent(evs, id, calName, now) {
    var t = +now, best = null;
    (evs || []).forEach(function (e) {
      if (!e || (e.cal && e.cal !== id)) return;
      var s = H.when(e.start), en = H.when(e.end);
      if (s == null) return;
      var title = String(e.title || e.summary || ''), all = !!e.allDay;
      if (!TRASH_RE.test(title) && !TRASH_RE.test(calName)) return;
      if (!all && (en == null ? s : en) <= t) return;                   // a pickup that is over
      var n = dayN(new Date(s), now);
      if (n < 0 || n > 1) return;
      if (!best || s < best.s) best = { s: s, n: n, word: trashWord(TRASH_RE.test(title) ? title : title + ' ' + calName) };
    });
    return best ? { word: best.word, n: best.n } : null;
  }
  // a sensor's day: "2026-11-03", an ISO time, "today" / "tomorrow" / "in 2 days", or the number of days until. -> whole days or null
  function sensorDays(s, now) {
    var v = String(s.state).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) return dayN(new Date(+m[1], +m[2] - 1, +m[3]), now);
    var t = isoTime(v);
    if (t != null) return dayN(new Date(t), now);
    if (/^-?\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
    if (/\btoday\b/i.test(v)) return 0;
    if (/\btomorrow\b/i.test(v)) return 1;
    if ((m = /\bin (\d+) days?\b/i.exec(v))) return +m[1];
    var a = obj(s.attributes), d = a ? num(a.days) : null;
    return d == null ? null : Math.round(d);
  }
  function trashOf(X) {
    var id = pick(X, 'trash'), s = stOf(X.st, id);
    if (!id) return null;
    if (id.split('.')[0] === 'calendar') {
      // (a calendar the hub has not sent a state for is still read: its events come from the calendar's own call)
      var evs = X.quiet ? [] : (X.events() || []).concat(trashRead(X.client, id));
      return trashEvent(evs, id, fnameOf(X.st, id), X.now);
    }
    if (!s || !usable(s.state)) return null;
    var n = sensorDays(s, X.now);
    if (n == null || n < 0 || n > 1) return null;
    var a = obj(s.attributes) || {};
    return { word: trashWord(nameOf(X.st, id) + ' ' + s.state + ' ' + (a.type || a.next_type || a.waste_type || a.description || '')), n: n };
  }
  W.define('trash', {
    name: 'Trash Day', group: 'Time and Calendar', wave: 'C', facts: ['trash'], source: 'hkCalendar', when: 'the day before and the day of',
    wakes: ['minute', 'house', 'calendar'], pick: { entity: 'calendar,sensor' }, off: false, opts: { entity: 'entity:calendar,sensor' }, defaults: { entity: '' }, accent: ACC.green,
    shapes: {
      inline: {
        read: function (X) {
          var t = trashOf(X);
          return t ? { text: t.word + (t.n ? ' tomorrow' : ' today'), gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(gl(BIN), s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Trash tomorrow', gl: 1 }
      },
      circular: {
        read: function (X) { var t = trashOf(X); return t ? { word: t.n ? 'TMRW' : 'TODAY' } : { off: true, word: '' }; },
        draw: function (s) { return ringed(BIN, s.word || 'TODAY'); },
        sample: { word: 'TMRW' }
      }
    }
  });

  // ------------------------------------------------------------ POLLEN: the level, always
  var LEVELS = ['None', 'Low', 'Moderate', 'High', 'Very High'];
  var SHORT = ['None', 'Low', 'Mod', 'High', 'V High'];
  var LEVEL_ACC = [ACC.green, ACC.green, ACC.yellow, ACC.orange, ACC.red];
  var LEVEL_ATTRS = ['category', 'risk', 'level', 'index_description', 'description', 'pollen_level', 'rating', 'status'];
  // a level in words, or null
  function wordLevel(v) {
    var t = String(v == null ? '' : v).toLowerCase().replace(/[_-]+/g, ' ');
    if (!t.trim()) return null;
    if (/very\s*high|extreme|severe|extremely/.test(t)) return 4;
    if (/\bnone\b|\bno pollen\b|\bzero\b|\babsent\b|\bnil\b|\bnone\b/.test(t)) return 0;
    if (/\bhigh\b|\bheavy\b/.test(t)) return 3;
    if (/moderate|medium|\bmod\b|\bmid\b/.test(t)) return 2;
    if (/very\s*low|\blow\b|\blight\b|\bslight\b/.test(t)) return 1;
    return null;
  }
  // a number as a level: counts per cubic meter by their own bands; an index of 0 to 5 (Google, Tomorrow.io) or 0 to 12 (Pollen.com)
  function numLevel(n, unit) {
    if (/m3|m³|grain|count|ppm|particle/i.test(unit)) return n <= 0 ? 0 : n < 30 ? 1 : n < 100 ? 2 : n < 300 ? 3 : 4;
    if (n <= 0) return 0;
    if (n <= 5) return n < 3 ? 1 : n < 4 ? 2 : n < 5 ? 3 : 4;
    return n <= 7.2 ? 2 : n <= 9.6 ? 3 : 4;
  }
  function pollenOf(X) {
    var id = pick(X, 'pollen'), s = stOf(X.st, id);
    if (!s || !usable(s.state)) return null;
    var a = obj(s.attributes) || {}, lvl = null, i;
    for (i = 0; i < LEVEL_ATTRS.length && lvl == null; i++) lvl = wordLevel(a[LEVEL_ATTRS[i]]);
    if (lvl == null) lvl = wordLevel(s.state);
    if (lvl == null && num(s.state) != null) lvl = numLevel(num(s.state), String(a.unit_of_measurement || ''));
    return lvl;
  }
  W.define('pollen', {
    name: 'Pollen', group: 'Weather and Sky', wave: 'C', facts: ['pollen'], source: 'sensor.*pollen*', when: null,
    wakes: ['house'], pick: { entity: 'sensor' }, off: false, opts: { entity: 'entity:sensor' }, defaults: { entity: '' },
    accent: function (s) { return s.lvl == null ? null : LEVEL_ACC[s.lvl]; },
    shapes: {
      inline: {
        read: function (X) { var l = pollenOf(X); return l == null ? { text: DASH, lvl: null } : { text: 'Pollen ' + LEVELS[l], lvl: l, gl: 1 }; },
        draw: function (s) { return inl(s.gl ? gl(LEAF) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Pollen High', lvl: 3, gl: 1 }
      },
      circular: {
        // a gauge filled by the level (a quarter a step; None is the track alone), the level in the middle, POLLEN under it
        read: function (X) {
          var l = pollenOf(X);
          return l == null ? { main: DASH, lvl: null, frac: null } : { main: SHORT[l], lvl: l, frac: l ? l / 4 : null };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: 'POLLEN' }); },
        sample: { main: 'High', lvl: 3, frac: 0.75 }
      }
    }
  });

  // ------------------------------------------------------------ APPLIANCES: while running, and for an hour after done
  // MEMORY, per entity: whether it was seen running, the longest time left seen in this run (the ring's total), and when it was seen to
  // stop. An appliance that says nothing of "done" itself (a binary sensor going off, a remaining time reaching 0) is done when we saw
  // it running and then not; a completion time or a state like "finished" says so itself. (A machine that finished while the page
  // wasn't looking is not guessed at: a false "Washer done" after a restart is worse than a missed one.)
  var MEM = {};
  var RUN_RE = /^(on|run|running|active|in progress|washing|drying|rinsing|spinning|cycle|working|wash|dry|delayed start|delayedstart|pause|paused|heating|in use)$/;
  var DONE_RE = /^(finished|end|done|complete|completed|ready to unload|cycle complete|cycle finished|cycle ended)$/;
  var DUR_UNIT = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400 };
  function machineName(st, id) {
    var n = nameOf(st, id), t = textOf(st, id);
    if (/dishwasher/i.test(t)) return 'Dishwasher';
    if (/dryer/i.test(t)) return 'Dryer';
    if (/washer|washing machine/i.test(t)) return 'Washer';
    n = n.replace(/\b(remaining|program|time|finish|finishes|finished|completion|complete|end|ends|cycle|operation|state|status|duration|left|estimated|eta|run|running|machine)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return cut(n || nameOf(st, id), 14);
  }
  // one appliance -> null (not at work, not long done, or not readable), else { id, name, k: 'run' | 'done', left: seconds | null, at: ms | null }
  function applianceOf(X, id) {
    var s = stOf(X.st, id);
    // (unavailable is not "stopped": the appliance may only be out of reach. Unknown is what a finished machine often says)
    if (!s || s.state === 'unavailable' || s.state === undefined || s.state === null) return null;
    var a = obj(s.attributes) || {}, dc = a.device_class, unit = String(a.unit_of_measurement || '').toLowerCase(), v = String(s.state).trim();
    var low = v.toLowerCase().replace(/[_-]+/g, ' '), t = +X.now, mem = MEM[id] || (MEM[id] = { run: false, max: 0, doneAt: null });
    var k = '', left = null, at = null, ts = isoTime(v), n = num(v), lc = isoTime(String(s.last_changed || ''));
    if (dc === 'timestamp' || ts != null) {
      // a completion time: ahead of us it is running, behind us by less than an hour it is done
      if (ts != null && ts > t && ts - t <= DAY) { k = 'run'; left = (ts - t) / 1000; at = ts; }
      else if (ts != null && ts <= t && t - ts < HOUR) { k = 'done'; at = ts; }
    } else if ((dc === 'duration' || DUR_UNIT[unit]) && n != null) {
      var secs = n * (DUR_UNIT[unit] || 60);
      if (secs > 0) { k = 'run'; left = secs; }
    } else if (RUN_RE.test(low)) {
      k = 'run';
    } else if (DONE_RE.test(low)) {
      var from = lc != null && lc <= t ? lc : (mem.doneAt != null ? mem.doneAt : t);
      if (t - from < HOUR) { k = 'done'; at = from; }
      mem.doneAt = from;
    }
    if (k === 'run') {
      mem.run = true; mem.doneAt = null;
      mem.max = left != null ? Math.max(mem.max, left) : mem.max;
    } else {
      // (it stopped while we watched, and nothing says it is done: that is done)
      if (!k && mem.run) { mem.doneAt = t; mem.run = false; }
      if (!k && mem.doneAt != null && t - mem.doneAt < HOUR) { k = 'done'; at = mem.doneAt; }
      if (k) mem.run = false;
      if (!k) mem.max = 0;
    }
    if (!k) return null;
    return { id: id, name: machineName(X.st, id), k: k, left: left, at: at, max: k === 'run' ? mem.max : 0 };
  }
  // what is at work, soonest finished first (one with no time to give last), then what is done, the latest first
  function appliancesOf(X) {
    var list = pickTwo(X, 'appliance').map(function (id) { return applianceOf(X, id); }).filter(Boolean);
    var run = list.filter(function (x) { return x.k === 'run'; }).sort(function (p, q) { return (p.left == null ? 1e12 : p.left) - (q.left == null ? 1e12 : q.left); });
    var done = list.filter(function (x) { return x.k === 'done'; }).sort(function (p, q) { return (q.at || 0) - (p.at || 0); });
    return run.concat(done);
  }
  // "24 min", "1 hr", "1 hr 5 min"; whole minutes, never under one
  function minsOf(left) { return Math.max(1, Math.ceil(left / 60 - 1e-9)); }
  function spanWords(m) { return m < 60 ? m + ' min' : Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); }
  function applWords(a) { return a.k === 'done' ? 'done' : a.m != null ? spanWords(a.m) + ' left' : 'running'; }
  // an appliance, as the spec carries it: whole minutes, so it is drawn again only when one passes
  function applSpec(a, X) {
    var m = a.left == null ? null : minsOf(a.left);
    // (the finish time on the minute: a spec that carried the second would be written again every second)
    var fin = a.k === 'run' && m != null ? Math.floor(+X.now / MIN) * MIN + m * MIN : a.at != null ? Math.floor(a.at / MIN) * MIN : null;
    return { name: a.name, k: a.k, m: m, fin: fin, frac: a.k === 'done' ? 1 : a.left != null && a.max > 0 ? r200(clamp(1 - a.left / a.max, 0, 1)) : null };
  }
  function shortName(n) { return /dishwasher/i.test(n) ? 'DISH' : cut(String(n).toUpperCase().split(/\s+/)[0], 7); }
  function applAcc(s) { return s.k === 'done' ? ACC.amber : s.k === 'run' ? TEAL : null; }
  W.define('appliance', {
    name: 'Appliances', group: 'Home', wave: 'C', facts: ['appliance'], source: 'sensor (remaining time, completion time or operation state)', when: 'while running, and an hour after',
    wakes: ['minute', 'house'], pick: { entity: 'sensor,binary_sensor', entity2: 'sensor,binary_sensor' }, off: false,
    opts: { entity: 'entity:sensor,binary_sensor', entity2: 'entity:sensor,binary_sensor' }, defaults: { entity: '', entity2: '' }, accent: applAcc,
    shapes: {
      inline: {
        read: function (X) {
          var a = appliancesOf(X)[0];
          if (!a) return { off: true, text: '', k: '' };
          var s = applSpec(a, X);
          return { text: s.name + ' ' + applWords(s), k: s.k, gl: 1 };
        },
        draw: function (s) { return inl(gl(MACHINE), s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Washer 24 min left', k: 'run', gl: 1 }
      },
      circular: {
        // the time left ("24m", "1h05"), the machine under it; done: DONE, the ring full
        read: function (X) {
          var a = appliancesOf(X)[0];
          if (!a) return { off: true, main: DASH, sub: '', k: '', frac: null };
          var s = applSpec(a, X);
          return { main: s.k === 'done' ? 'Done' : s.m == null ? 'Run' : s.m < 60 ? s.m + 'm' : Math.floor(s.m / 60) + 'h' + pad(s.m % 60), sub: shortName(s.name), k: s.k, frac: s.frac };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '24m', sub: 'WASHER', k: 'run', frac: 0.6 }
      },
      rectangular: {
        // two machines, a row each (a dot, the name, the time left); one, the three lines
        read: function (X) {
          var list = appliancesOf(X).slice(0, 2).map(function (a) { return applSpec(a, X); });
          if (!list.length) return { off: true, rows: [], k: '' };
          return { rows: list.map(function (s) { return { name: s.name, k: s.k, v: s.k === 'done' ? 'Done' : s.m != null ? spanWords(s.m) + ' left' : 'Running', fin: s.fin ? tm(new Date(s.fin), X.h24, true) : '' }; }), k: list[0].k };
        },
        draw: function (s) {
          if (s.rows.length === 1) {
            var r = s.rows[0];
            return lines(r.name, r.v, r.k === 'done' ? (r.fin ? 'Finished ' + r.fin : '') : r.fin ? 'Done at ' + r.fin : 'Running', true);
          }
          return '<div class="pk-rows">' + s.rows.map(function (r) {
            return '<div class="pk-row"' + accStyle(applAcc(r)) + '><i class="dot a"></i><div class="pk-n">' + esc(r.name) + '</div><div class="pk-v">' + esc(r.v) + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { rows: [{ name: 'Washer', k: 'run', v: '24 min left', fin: '8:06 PM' }, { name: 'Dryer', k: 'done', v: 'Done', fin: '7:30 PM' }], k: 'run' }
      }
    }
  });

  // ------------------------------------------------------------ LEAK AND SMOKE: while one is tripped
  var LEAK_DC = { moisture: 'water' }, SMOKE_DC = { smoke: 'smoke', carbon_monoxide: 'co', gas: 'gas' };
  // a kind's entities (Settings' Status & Chips lists where it has them; else the binary sensors of those device classes the chip finds)
  function kindIds(X, kind, table) {
    var k = setting('kinds', null);
    if (k && typeof k === 'object' && Object.keys(k).length) { var l = setting('kinds.' + kind, []); return Array.isArray(l) ? l : []; }
    var ents = (X.client && X.client.entities) || {};
    return ids(X.st, 'binary_sensor').filter(function (id) {
      var e = obj(ents[id]) || {}, a = attrsOf(X.st, id);
      return table[a.device_class] && !(e.hidden || e.entity_category || Array.isArray(a.entity_id));
    });
  }
  var LEAK_RANK = { smoke: 0, co: 1, gas: 2, water: 3 };
  var LEAK_TITLE = { water: 'Water leak', smoke: 'Smoke detected', co: 'CO detected', gas: 'Gas detected' };
  var LEAK_FROM = { water: 'Water at the ', smoke: 'Smoke in the ', co: 'CO in the ', gas: 'Gas in the ' };
  // the tripped ones, the most urgent first (smoke, CO, gas, water), the latest to trip first among those. Unknown is NOT tripped.
  function trippedOf(X) {
    var out = [], seen = {};
    [['leaks', LEAK_DC], ['smoke', SMOKE_DC]].forEach(function (g) {
      kindIds(X, g[0], g[1]).forEach(function (id) {
        if (typeof id !== 'string' || seen[id]) return;
        seen[id] = 1;
        var s = stOf(X.st, id);
        if (!s || s.state !== 'on') return;
        var dc = attrsOf(X.st, id).device_class, type = g[1][dc] || (g[0] === 'leaks' ? 'water' : 'smoke'), lc = isoTime(String(s.last_changed || ''));
        out.push({ id: id, type: type, at: lc });
      });
    });
    return out.sort(function (p, q) { return LEAK_RANK[p.type] - LEAK_RANK[q.type] || (q.at || 0) - (p.at || 0); });
  }
  // where, from the sensor's name without the words for what it senses ("Laundry Leak Sensor" -> "Laundry")
  function whereOf(st, id) {
    var w = nameOf(st, id).replace(/\b(water|leaks?|flood|moisture|smoke|co|carbon monoxide|gas|detector|sensor|alarm)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return /[a-z]/i.test(w) ? w : '';
  }
  function agoWords(at, now) {
    if (at == null) return '';
    var m = Math.floor((+now - at) / MIN);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' hr ago';
    var d = Math.floor(m / 1440);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function leakSpec(X) {
    var list = trippedOf(X);
    if (!list.length) return null;
    var f = list[0], where = whereOf(X.st, f.id);
    return { type: f.type, where: where, name: cut(where || nameOf(X.st, f.id), 24), ago: agoWords(f.at, X.now), more: list.length - 1 };
  }
  function leakWords(l) {
    var w = cut(l.where, 22), words = w ? LEAK_FROM[l.type] + (/^the\s/i.test(w) ? w.replace(/^the\s/i, '') : w) : LEAK_TITLE[l.type];
    return words + (l.more ? ' +' + l.more : '');
  }
  W.define('leak', {
    name: 'Leak and Smoke', group: 'Home', wave: 'C', facts: ['leak'], source: 'kinds.leaks, kinds.smoke', when: 'while one is tripped',
    wakes: ['minute', 'house'], pick: null, off: false, opts: {}, defaults: {}, accent: ACC.red,
    shapes: {
      inline: {
        read: function (X) {
          var l = leakSpec(X);
          return l ? { text: leakWords(l), type: l.type, gl: 1 } : { off: true, text: '', type: '' };
        },
        draw: function (s) { return inl(gl(s.type === 'water' ? DROP : ALERT), s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Water at the Laundry', type: 'water', gl: 1 }
      },
      card: {
        // what, where, and how long ago (the title row has the glyph at its right; more than one: how many more, after the time)
        read: function (X) {
          var l = leakSpec(X);
          return l ? { t: LEAK_TITLE[l.type], where: l.name, ago: l.ago + (l.more ? (l.ago ? ' · ' : '') + '+' + l.more + ' more' : ''), type: l.type } : { off: true, t: '', where: '', ago: '', type: '' };
        },
        draw: function (s) {
          return '<div class="cd ti"><div class="pk-h"><div class="ct">' + esc(s.t) + '</div>' + gl(s.type === 'water' ? DROP : ALERT) + '</div>' +
            '<div class="cl">' + esc(s.where || ' ') + '</div>' + (s.ago ? '<div class="s2">' + esc(s.ago) + '</div>' : '') + '</div>';
        },
        h: function (s) { return 8.1 + 3.78 + (s && s.ago ? 2.97 : 0); },
        sample: { t: 'Water leak', where: 'Laundry', ago: '4 min ago', type: 'water' }
      }
    }
  });

  // ------------------------------------------------------------ TRAVEL TIME: minutes to a place, always
  // minutes from a number or words: 24, "24", "24 mins", "1 hour 5 mins", "1:05"; null when it is none of those. `unit` for a bare number
  function minutesOf(v, unit) {
    if (v == null || v === '') return null;
    var u = String(unit || '').toLowerCase();
    if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v).trim())) {
      var n = Number(v);
      return !isFinite(n) || n < 0 ? null : DUR_UNIT[u] ? n * DUR_UNIT[u] / 60 : n;
    }
    var t = String(v).toLowerCase(), m = /^(\d+):(\d{2})$/.exec(t.trim());
    if (m) return +m[1] * 60 + +m[2];
    var total = 0, found = false;
    t.replace(/(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/g, function (x, q, w) {
      found = true;
      total += Number(q) * (DUR_UNIT[w] || DUR_UNIT[w.replace(/s$/, '')] || 60) / 60;
      return x;
    });
    return found ? total : null;
  }
  function travelName(st, id) {
    var n = fnameOf(st, id).replace(/\b(waze|google)\b/gi, ' ').replace(/\b(travel|drive|driving|commute|trip)?\s*(time|duration)\b/gi, ' ').replace(/\b(travel|commute)\b/gi, ' ')
      .replace(/\s+/g, ' ').replace(/^\W+|\W+$/g, '');
    return cut(n || 'Drive', 14);
  }
  // one place -> null, or { name, m: whole minutes, slow: 1 when its time is 25% over the usual, typ: usual minutes | null }
  function placeOf(X, id) {
    var s = stOf(X.st, id);
    if (!s) return null;
    var a = obj(s.attributes) || {}, unit = a.unit_of_measurement || 'min', m = usable(s.state) ? minutesOf(s.state, unit) : null;
    var typ = minutesOf(a.duration), inTraffic = minutesOf(a.duration_in_traffic);
    if (m == null) m = inTraffic != null ? inTraffic : typ;
    if (m == null) return null;
    var slow = typ != null && typ > 0 && inTraffic != null && inTraffic >= typ * 1.25;
    return { name: travelName(X.st, id), m: Math.round(m), slow: slow ? 1 : 0, typ: typ != null && inTraffic != null ? Math.round(typ) : null };
  }
  function minsWords(m) { return spanWords(m); }
  function travelAcc(s) { return s.slow ? ACC.amber : BLUE; }
  W.define('travel', {
    name: 'Travel Time', group: 'People and Travel', wave: 'C', facts: ['travel'], source: 'sensor (Waze or Google travel time)', when: null,
    wakes: ['minute', 'house'], pick: { entity: 'sensor', entity2: 'sensor' }, off: false,
    opts: { entity: 'entity:sensor', entity2: 'entity:sensor' }, defaults: { entity: '', entity2: '' }, accent: travelAcc,
    shapes: {
      inline: {
        read: function (X) {
          var p = placeOf(X, pickTwo(X, 'travel')[0]);
          return p ? { text: p.name + ' ' + minsWords(p.m), slow: p.slow, gl: 1 } : { text: DASH, slow: 0 };
        },
        draw: function (s) { return inl(s.gl ? gl(PIN) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Work 24 min', slow: 0, gl: 1 }
      },
      circular: {
        // the minutes on a clock's face (an hour round the ring), MIN under them
        read: function (X) {
          var p = placeOf(X, pickTwo(X, 'travel')[0]);
          return p ? { main: String(p.m), slow: p.slow, frac: r200(clamp(p.m / 60, 0, 1)) } : { main: DASH, slow: 0, frac: null };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: 'MIN' }); },
        sample: { main: '24', slow: 0, frac: 0.4 }
      },
      rectangular: {
        // two places, a row each; one, its three lines (the name, the time, how it compares with the usual)
        read: function (X) {
          var ps = pickTwo(X, 'travel').map(function (id) { return placeOf(X, id); }).filter(Boolean).slice(0, 2);
          if (!ps.length) return { rows: [], slow: 0 };
          return { rows: ps.map(function (p) {
            var d = p.typ != null ? p.m - p.typ : null;
            return { name: p.name, v: minsWords(p.m), slow: p.slow, note: p.slow ? spanWords(Math.max(1, d)) + ' slower than usual' : p.typ != null ? 'Usual traffic' : '' };
          }), slow: ps.some(function (p) { return p.slow; }) ? 1 : 0 };
        },
        draw: function (s) {
          if (!s.rows.length) return lines('Travel', DASH, '');
          if (s.rows.length === 1) return lines(s.rows[0].name, s.rows[0].v, s.rows[0].note, true);
          return '<div class="pk-rows">' + s.rows.map(function (r) {
            return '<div class="pk-row"' + accStyle(travelAcc(r)) + '><i class="dot a"></i><div class="pk-n">' + esc(r.name) + '</div><div class="pk-v">' + esc(r.v) + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { rows: [{ name: 'Work', v: '24 min', slow: 0, note: '' }, { name: 'School', v: '11 min', slow: 0, note: '' }], slow: 0 }
      }
    }
  });

  // ------------------------------------------------------------ PRICE: "Peak until 7 PM", else "$0.31/kWh"
  var TIER_KEYS = ['tier', 'period', 'price_level', 'level', 'current_period', 'current_tier', 'tou_period', 'rate_period', 'price_tier'];
  var NEXT_KEYS = ['next_change', 'next_change_at', 'next_tier_change', 'next_period_start', 'next_period', 'next_update', 'until', 'valid_until', 'period_end', 'tier_ends', 'ends_at', 'end_time', 'next_rate_change'];
  var CUR = { USD: '$', CAD: '$', AUD: '$', NZD: '$', MXN: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ', DKK: 'kr ' };
  // a tier word: how it stands ('low' | 'mid' | 'high' | '') and how it reads
  function tierOf(w) {
    var t = String(w == null ? '' : w).toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (!t || /^-?\d+(\.\d+)?$/.test(t) || /^(unknown|unavailable|none|null)$/.test(t)) return null;
    var k = /\b(off ?peak|super|low|cheap|night|valley|economy)\b/.test(t) ? 'low' : /\b(mid|middle|shoulder|standard|normal|partial|medium)\b|mid ?peak/.test(t) ? 'mid' : /\b(peak|on ?peak|high|critical|expensive)\b/.test(t) ? 'high' : '';
    var word = /^super off ?peak$/.test(t) ? 'Super off-peak' : /^off ?peak$/.test(t) ? 'Off-peak' : /^mid ?peak$/.test(t) ? 'Mid-peak' : /^on ?peak$/.test(t) ? 'Peak' : cut(titleCase(t), 16);
    return { k: k, word: word };
  }
  // the next change, in the future: an ISO time, or a clock time ("19:00") that comes next
  function nextChange(v, now) {
    var t = isoTime(typeof v === 'string' ? v : v instanceof Date ? v : null), m;
    if (t == null && typeof v === 'string' && (m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim()))) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], 0);
      t = +d <= +now ? +d + DAY : +d;
    }
    return t != null && t > +now ? t : null;
  }
  function fixed(v) {
    if (v >= 1) return v.toFixed(2);
    var s = (Math.round(v * 1000) / 1000).toFixed(3);
    return s.charAt(s.length - 1) === '0' ? s.slice(0, -1) : s;
  }
  // a price with its unit: "$0.31/kWh", "9.5¢/kWh", "€0.28/kWh" (the unit's own currency, else the house's, else dollars)
  function priceWords(v, unit, cur) {
    var u = String(unit || '').trim(), parts = u.split('/'), per, c;
    if (parts.length > 1) { c = parts[0].trim(); per = parts.slice(1).join('/').trim(); }
    else if (/^[mk]?wh$/i.test(u)) { c = ''; per = u; }
    else { c = u; per = 'kWh'; }
    per = per || 'kWh';
    if (/^(cents?|c|ct|¢)$/i.test(c)) return (Math.round(v * 10) / 10) + '¢/' + per;
    var sym = !c ? CUR[String(cur || 'USD').toUpperCase()] || '$' : CUR[c.toUpperCase()] !== undefined ? CUR[c.toUpperCase()] : c;
    return sym + fixed(v) + '/' + per;
  }
  function priceOf(X) {
    var id = pick(X, 'price'), s = stOf(X.st, id);
    if (!s || !usable(s.state)) return null;
    var a = obj(s.attributes) || {}, v = num(s.state), tier = null, i;
    for (i = 0; i < TIER_KEYS.length && !tier; i++) tier = tierOf(a[TIER_KEYS[i]]);
    if (!tier && v == null) {                                          // (a sensor whose state is the tier: a word that means one)
      var st = tierOf(s.state);
      if (st && st.k) tier = st;
    }
    var next = null;
    for (i = 0; i < NEXT_KEYS.length && next == null; i++) next = nextChange(a[NEXT_KEYS[i]], X.now);
    if (v == null && !tier) return null;
    var cfg = (X.client && X.client.config) || {};
    var money = v == null ? '' : priceWords(v, a.unit_of_measurement, cfg.currency);
    var until = '';
    if (next != null) {
      var d = new Date(next), n = dayN(d, X.now);
      until = ' until ' + (n === 0 ? '' : n === 1 ? 'tomorrow ' : DAYS[d.getDay()] + ' ') + tmShort(d, X.h24);
    }
    var text = tier ? tier.word + (next != null ? until : money ? DOT + money : '') : money + until;
    return { text: text, k: tier ? tier.k : '' };
  }
  W.define('price', {
    name: 'Price', group: 'Energy', wave: 'C', facts: ['price'], source: 'the Energy plan\'s price entity', when: null,
    wakes: ['minute', 'house'], pick: { entity: 'sensor,input_number,number' }, off: false,
    opts: { entity: 'entity:sensor,input_number,number' }, defaults: { entity: '' },
    accent: function (s) { return s.k === 'high' ? ACC.amber : s.k === 'low' ? ACC.green : ACC.yellow; },
    shapes: {
      inline: {
        read: function (X) { var p = priceOf(X); return p ? { text: cut(p.text, 36), k: p.k, gl: 1 } : { text: DASH, k: '' }; },
        draw: function (s) { return inl(s.gl ? gl(BOLT) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Peak until 7 PM', k: 'high', gl: 1 }
      }
    }
  });

  // for the tests, the editor's picker and a caller that wants the readings
  W._.picked = {
    suggest: suggest, TR: TR, MEM: MEM, CSS: CSS, trashEvent: trashEvent, sensorDays: sensorDays, wordLevel: wordLevel, numLevel: numLevel,
    minutesOf: minutesOf, priceWords: priceWords, tierOf: tierOf, LEVELS: LEVELS, INDIGO: INDIGO, TEAL: TEAL, BLUE: BLUE
  };
  window.hkSaverPiecesPicked = true;
})();
