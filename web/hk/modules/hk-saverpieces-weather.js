// hk-saverpieces-weather.js -- THE SCREENSAVER'S WEATHER AND SKY PIECES (2026-11-02, phase 13, phase 1b, wave A:
// docs/phase13/GLANCE-SPEC.md, "Weather and Sky"): rain, alert, uv, wind, pressure, feels, moon and sun. One group, one
// file, loaded after hk-saverwidgets.js, which draws them: each piece is declared once (the plan's rule 1) with
// hkSaverWidgets.define() and drawn with the renderer's own classes and helpers (ring, inl, lines, ...), so it looks like the
// core pieces in every backdrop, ink and size. This file keeps no CSS of its own: the few shapes that need a size set it
// on the element, in `--u`, on the spacing scale (.4 .8 1.2 1.6 2.4 3.2).
//
// WHERE EACH READS (the survey, side-session-notes/phase13-glance-data-sources.md):
//   rain      the hourly forecast (hkWxForecast, the renderer's one watcher per kind: X.hourly()), its
//             precipitation_probability and condition, and the weather entity's condition now
//   alert     Settings' weather.alerts sensor (NWS: attributes.Alerts[]); an alert that has ended is dropped, as the Weather
//             page's _first() drops it (Ends, else Expires, in the past)
//   uv, wind, feels
//             hkSettings.nowRead(states, 'uv' | 'wind' | 'gust' | 'feels_like'): the Settings sensor, else the weather
//             entity's own attribute, as the Weather page reads it. Wind's unit and feels' range come from hkWxReadings
//   pressure  the weather entity's pressure and pressure_unit; the arrow from the hourly forecast's pressure
//   moon      hkSettings.moon(states, now), 0..1
//   sun       sun.sun: next_rising, next_setting, state
//
// THE RULES (SCREENSAVER-UNIFIED.md, "The rules every piece follows"): nothing animates and nothing blurs (no motion of any
// kind, no backdrop filter); one read per source, shared (the forecast through the renderer's shared watch, the hourly
// list worked out once a minute for every rain and pressure piece); no read wakes anything; a piece that "shows when..." says
// so through `off` (rain while nothing is likely in 12 hours, alert while none is active); data that is not there is a dash,
// never "nothing wrong".
//
// THE DRAWING (PIECES-SPEC.md, "Spacing and alignment"): every circle is the renderer's ring (track 7.5, radius 43, the
// label on the baseline 72), or the same track and text where a ring cannot draw it (the moon, the day's arc), so the row's
// circles are one size; figures are centered by their caps, 100 box units = the circle; times and figures are tabular
// (the renderer's .hksw sets that); nothing sits closer than 1.6 u to a backdrop's edge.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._) return;
  if (window.hkSaverPiecesWeather) return;

  var _ = W._, esc = _.esc, num = _.num, clamp = _.clamp, when = _.when, cut = _.cut, deg = _.deg, tm = _.tm, DASH = _.DASH, DOT = _.DOT;
  var ring = _.ring, inl = _.inl, lines = _.lines, tempAcc = _.tempAcc, ACC = _.ACC;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var HOUR = 3600000, DAY = 86400000;

  // ------------------------------------------------------------ accents ([light ink, dark ink] pairs)
  var RAINC = ['#82c3ff', '#2a74c8'];            // the rain glyph's blue
  var TEAL = ['#8ad8c0', '#2f8f7e'];             // the wind's, and a minor alert
  var SLATE = ['#9db4d6', '#4a6a9a'];            // the pressure's slate blue
  var MOONC = ['#f3dfa2', '#a07d1c'];            // pale gold
  var VIOLET = ['#c58bff', '#7a35c4'];
  var SEV = { extreme: ACC.red, severe: ACC.orange, moderate: ACC.yellow, minor: TEAL, unknown: ACC.amber };
  var UVC = [ACC.green, ACC.yellow, ACC.orange, ACC.red, VIOLET];

  // ------------------------------------------------------------ small helpers
  function r200(v) { return Math.round(v * 200) / 200; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // a time: "3 PM", "6:15 PM", or 24-hour "15:00"
  function at(d, h24) {
    var h = d.getHours(), m = d.getMinutes();
    if (h24) return pad2(h) + ':' + pad2(m);
    return ((h % 12) || 12) + (m ? ':' + pad2(m) : '') + (h < 12 ? ' AM' : ' PM');
  }
  // how far a day is from today: '' today, 'tomorrow', else the weekday ("Tue")
  function dayPart(d, now) {
    var n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY);
    return n <= 0 ? '' : n === 1 ? 'tomorrow' : DAYS[d.getDay()];
  }
  function stamp(d, now, h24) { var p = dayPart(d, now); return (p ? p + ' ' : '') + at(d, h24); }
  // degrees Fahrenheit from a temperature in the unit the weather says (else the house's): the accent's scale
  function fahr(X, v, unit) {
    if (v == null) return null;
    var us = ((X.client && X.client.config) || {}).unit_system || {}, c = unit ? unit === 'C' : /C/.test(String(us.temperature || ''));
    return Math.round(c ? v * 9 / 5 + 32 : v);
  }
  // the weather entity: the one hkWxReadings read, else Settings' (hkSettings.weatherId), else the first in the house
  function wxEntity(X, w) {
    var st = X.st || {}, HS = window.hkSettings, id = w && w.entity && st[w.entity] ? w.entity : null;
    if (!id && HS && typeof HS.weatherId === 'function') { try { id = HS.weatherId(st); } catch (e) { id = null; } }
    if (!id || !st[id]) id = Object.keys(st).filter(function (k) { return k.indexOf('weather.') === 0; }).sort()[0] || null;
    return id ? { id: id, s: st[id] } : null;
  }
  // a reading Settings -> Weather names a sensor for, else the entity's own attribute (hkSettings.nowRead): a number or null
  function nowRead(X, key, ent) {
    var HS = window.hkSettings;
    if (!HS || typeof HS.nowRead !== 'function') return null;
    try { return num(HS.nowRead(X.st || {}, key, ent ? ent.id : undefined)); } catch (e) { return null; }
  }

  // ------------------------------------------------------------ the hourly forecast, worked out once a minute for every piece
  //   the hours still to come, each { at, cond, pop, wet (the word for a wet condition, else ''), eff (the chance: its own, else
  //   100 for a wet condition, else null), likely (40%+ or wet) }
  var WET = { rainy: 'Rain', pouring: 'Rain', 'lightning-rainy': 'Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', hail: 'Hail' };
  var HRS = { data: null, n: -1, a: '', z: '', min: -1, list: [] };
  function hoursOf(X) {
    var data = X.hourly() || [], t = +X.now, min = Math.floor(t / 60000), n = data.length;
    var a = n ? String((data[0] || {}).datetime) : '', z = n ? String((data[n - 1] || {}).datetime) : '';
    if (HRS.data === data && HRS.n === n && HRS.a === a && HRS.z === z && HRS.min === min) return HRS.list;
    var list = data.map(function (f) { return { at: when(f && f.datetime), f: f }; })
      .filter(function (e) { return e.at != null && e.at > t; }).sort(function (p, q) { return p.at - q.at; })
      .map(function (e) {
        var cond = String(e.f.condition || ''), pop = num(e.f.precipitation_probability), wet = WET[cond] || '';
        return { at: e.at, cond: cond, pop: pop, wet: wet, eff: pop != null ? pop : wet ? 100 : null, likely: (pop != null && pop >= 40) || !!wet };
      });
    HRS.data = data; HRS.n = n; HRS.a = a; HRS.z = z; HRS.min = min; HRS.list = list;
    return list;
  }

  // ------------------------------------------------------------ RAIN SOON
  //   -> null while nothing is likely within 12 hours and nothing falls now; else { kind, text, peak }
  function rainOf(X) {
    var w = X.wx();                                   // (also starts the hourly watch: the piece's `fc`)
    var ent = wxEntity(X, w), t = +X.now, cond = ent ? String(ent.s.state || '') : '', nowWet = WET[cond] || '';
    var win = hoursOf(X).filter(function (e) { return e.at <= t + 12 * HOUR; }), first = null, end = null, peak = null, i;
    for (i = 0; i < win.length; i++) if (win[i].likely) { first = win[i]; break; }
    if (!nowWet && !first) return null;
    var kind = nowWet || first.wet || 'Rain', text;
    for (i = 0; i < win.length; i++) if (win[i].eff != null && (peak == null || win[i].eff > peak)) peak = win[i].eff;
    if (nowWet) {
      // (falling now: until the first hour that is not likely; "continues" when the whole window is)
      for (i = 0; i < win.length; i++) if (!win[i].likely) { end = win[i]; break; }
      text = end ? kind + ' until ' + stamp(new Date(end.at), X.now, X.h24) : win.length ? kind + ' continues' : kind + ' now';
    } else {
      var d = new Date(first.at), p = dayPart(d, X.now);
      text = kind + ' ' + (p ? p + ' ' : '') + 'at ' + at(d, X.h24);
    }
    return { kind: kind, text: text, peak: peak };
  }
  var RAIN_GLYPH = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 14.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10 1A3.1 3.1 0 0 0 7 14.5z"/>' +
    '<path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  // eight hours as bars, in a 250 x 96 box (1 unit = .1 u of the screen): a header (RAIN, the highest chance), the bars on a
  // baseline, the first and last hour under them. The bars are 2.4 u wide, .8 u apart (24.8 u of the 25 the piece has), so
  // the first label starts at the first bar's edge and the last ends at the last bar's
  function barsDraw(s) {
    var P = 24, G = 8, H = 36, BASE = 64, i, svg = '<svg viewBox="0 0 250 96" aria-hidden="true" style="width:calc(var(--u) * 25);height:calc(var(--u) * 9.6)">';
    svg += '<text x="1" y="16" font-size="20" font-weight="600" opacity=".75" letter-spacing=".6">' + esc(String(s.kind || 'Rain').toUpperCase()) + '</text>';
    svg += '<text x="249" y="16" text-anchor="end" font-size="20" font-weight="700">' + esc(s.peak) + '</text>';
    for (i = 0; i < s.pops.length; i++) {
      var p = s.pops[i];
      if (p == null || p <= 0) continue;
      var h = Math.max(4, Math.round(clamp(p, 0, 100) / 100 * H));
      svg += '<rect class="a" x="' + (1 + i * (P + G)) + '" y="' + (BASE - h) + '" width="' + P + '" height="' + h + '" rx="4" fill="currentColor"' + (s.lk[i] ? '' : ' opacity=".45"') + '/>';
    }
    svg += '<path d="M1 65H249" stroke="currentColor" stroke-opacity=".3" stroke-width="2" stroke-linecap="round" fill="none"/>';
    svg += '<text x="1" y="90" font-size="20" font-weight="600" opacity=".8">' + esc(s.first) + '</text>';
    svg += '<text x="249" y="90" text-anchor="end" font-size="20" font-weight="600" opacity=".8">' + esc(s.last) + '</text>';
    return svg + '</svg>';
  }
  W.define('rain', {
    name: 'Rain Soon', group: 'Weather and Sky', wave: 'A', facts: ['rain'], source: 'hkWxForecast', when: 'when rain is coming',
    wakes: ['minute', 'house', 'forecast'], pick: null, off: false, opts: {}, accent: RAINC,
    shapes: {
      inline: {
        fc: ['hourly'],
        read: function (X) {
          var r = rainOf(X);
          return r ? { text: r.text, gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(RAIN_GLYPH, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Rain at 3 PM', gl: 1 }
      },
      circular: {
        // the highest chance in the next 12 hours, as a gauge
        fc: ['hourly'],
        read: function (X) {
          var r = rainOf(X);
          if (!r) return { off: true, main: DASH, sub: 'RAIN', frac: null };
          return { main: r.peak == null ? DASH : Math.round(r.peak) + '%', sub: r.kind.toUpperCase(), frac: r.peak == null ? null : r200(clamp(r.peak / 100, 0, 1)) };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '60%', sub: 'RAIN', frac: 0.6 }
      },
      rectangular: {
        // a bar per hour for the next eight, the chance as its height; the likely hours solid
        fc: ['hourly'],
        read: function (X) {
          var r = rainOf(X);
          if (!r) return { off: true };
          var hrs = hoursOf(X).slice(0, 8), t0 = hrs.length ? hrs[0].at : Math.ceil(+X.now / HOUR) * HOUR, pops = [], lk = [], i, top = null;
          for (i = 0; i < 8; i++) {
            var e = hrs[i], v = e && e.eff != null ? Math.round(e.eff) : null;
            pops.push(v); lk.push(e && e.likely ? 1 : 0);
            if (v != null && (top == null || v > top)) top = v;
          }
          return { kind: r.kind, pops: pops, lk: lk, peak: top == null ? DASH : top + '%', first: at(new Date(t0), X.h24), last: at(new Date(t0 + 7 * HOUR), X.h24) };
        },
        draw: barsDraw,
        sample: { kind: 'Rain', pops: [10, 20, 40, 60, 70, 50, 30, 10], lk: [0, 0, 1, 1, 1, 1, 0, 0], peak: '70%', first: '3 PM', last: '10 PM' }
      }
    }
  });

  // ------------------------------------------------------------ WEATHER ALERT
  var RANK = { extreme: 0, severe: 1, moderate: 2, minor: 3 };
  // the live alerts, most severe first: the NWS sensor's Alerts[], those that have not ended (Ends, else Expires); a sensor that
  // counts alerts but lists none still has one to name
  function alertsOf(X) {
    var HS = window.hkSettings, id = HS && typeof HS.get === 'function' ? HS.get('weather.alerts', null) : null, st = id && X.st ? X.st[id] : null;
    if (!st) return [];
    var rows = st.attributes && Array.isArray(st.attributes.Alerts) ? st.attributes.Alerts : [], t = +X.now;
    var live = rows.filter(function (a) {
      if (!a || typeof a !== 'object') return false;
      var end = Date.parse(a.Ends || a.Expires || '');
      return !isFinite(end) || end > t;
    }).map(function (a) {
      var sev = String(a.Severity || '').toLowerCase(), end = Date.parse(a.Ends || a.Expires || '');
      return { event: String(a.Event || a.Headline || 'Weather Alert'), head: String(a.Headline || '').replace(/\s+/g, ' ').trim(),
               sev: RANK[sev] != null ? sev : 'unknown', end: isFinite(end) ? end : null };
    });
    if (!rows.length && (num(st.state) || 0) > 0) live = [{ event: 'Weather Alert', head: '', sev: 'unknown', end: null }];
    return live.sort(function (p, q) { return (RANK[p.sev] == null ? 4 : RANK[p.sev]) - (RANK[q.sev] == null ? 4 : RANK[q.sev]) || (p.end || Infinity) - (q.end || Infinity); });
  }
  var ALERT_GLYPH = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 4.2l9 15.6H3z"/><path d="M12 10v4.2M12 17v.1"/></svg>';
  // a headline in two lines of up to n letters: broken at a space, the second cut short
  function twoLines(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    if (s.length <= n) return [s];
    var k = s.lastIndexOf(' ', n);
    if (k < n * 0.5) k = n;
    return [s.slice(0, k).trim(), cut(s.slice(k).trim(), n)];
  }
  W.define('alert', {
    name: 'Weather Alert', group: 'Weather and Sky', wave: 'A', facts: ['alert'], source: 'weather.alerts', when: 'while one is active',
    wakes: ['minute', 'house'], pick: null, off: false, opts: {},
    accent: function (s) { return SEV[s.sev] || SEV.unknown; },
    shapes: {
      inline: {
        read: function (X) {
          var a = alertsOf(X)[0];
          if (!a) return { off: true, text: '' };
          return { text: a.event + (a.end != null ? ' until ' + stamp(new Date(a.end), X.now, X.h24) : ''), sev: a.sev, gl: 1 };
        },
        draw: function (s) { return inl(ALERT_GLYPH, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Wind Advisory until 6 PM', sev: 'moderate', gl: 1 }
      },
      card: {
        // the event (bold), until when, the headline (two lines at most)
        read: function (X) {
          var a = alertsOf(X)[0];
          if (!a) return { off: true };
          return { event: a.event, sev: a.sev, until: a.end != null ? 'Until ' + stamp(new Date(a.end), X.now, X.h24) : 'Active alert',
                   head: a.head && a.head !== a.event ? twoLines(a.head, 34) : [] };
        },
        draw: function (s) {
          return '<div class="cd"><div class="cl" style="font-weight:700"><i class="dot a"></i>' + esc(s.event) + '</div><div class="s2">' + esc(s.until) + '</div>' +
            s.head.map(function (l, i) { return '<div class="s2" style="opacity:.7' + (i ? '' : ';margin-top:calc(var(--u) * .4)') + '">' + esc(l) + '</div>'; }).join('') + '</div>';
        },
        h: function (s) { var k = s && s.head ? s.head.length : 0; return 4 + 3.78 + 2.97 * (1 + k) + (k ? 0.4 : 0); },
        sample: { event: 'Wind Advisory', sev: 'moderate', until: 'Until 6 PM', head: ['Winds 25 to 35 mph with gusts up to', '50 mph expected this afternoon.'] }
      }
    }
  });

  // ------------------------------------------------------------ UV
  // the WHO scale: low 0-2 green, moderate 3-5 yellow, high 6-7 orange, very high 8-10 red, extreme 11+ violet
  function uvBand(v) { return v <= 2 ? 0 : v <= 5 ? 1 : v <= 7 ? 2 : v <= 10 ? 3 : 4; }
  W.define('uv', {
    name: 'UV', group: 'Weather and Sky', wave: 'A', facts: ['uv'], source: 'hkSettings.nowRead', when: null,
    wakes: ['minute', 'house'], pick: null, off: false, opts: {},
    accent: function (s) { return s.v == null ? null : UVC[uvBand(s.v)]; },
    shapes: {
      circular: {
        read: function (X) {
          var ent = wxEntity(X, X.wx()), raw = nowRead(X, 'uv', ent);
          if (raw == null) return { main: DASH, frac: null, v: null };
          var v = Math.max(0, Math.round(raw));
          return { main: v >= 11 ? '11+' : String(v), frac: r200(clamp(raw / 11, 0, 1)), v: v };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: 'UV' }); },
        sample: { main: '6', frac: 0.55, v: 6 }
      }
    }
  });

  // ------------------------------------------------------------ WIND AND GUSTS
  var WIND_TOP = [[/mph|mi/i, 40], [/km/i, 60], [/m\/s|ms/i, 18], [/kn|kt/i, 35]];
  W.define('wind', {
    name: 'Wind and Gusts', group: 'Weather and Sky', wave: 'A', facts: ['wind'], source: 'hkSettings.nowRead', when: null,
    wakes: ['minute', 'house'], pick: null, off: false, opts: {}, accent: TEAL,
    shapes: {
      circular: {
        // the speed, the gust under it ("G 14"; the unit where there is none), a gauge to 40 mph (60 km/h)
        read: function (X) {
          var w = X.wx(), ent = wxEntity(X, w), v = nowRead(X, 'wind', ent), g = nowRead(X, 'gust', ent);
          var unit = String((w && w.windUnit) || (ent && ent.s.attributes && ent.s.attributes.wind_speed_unit) || ''), top = 40;
          WIND_TOP.forEach(function (r) { if (r[0].test(unit)) top = r[1]; });
          return { main: v == null ? DASH : String(Math.round(v)), sub: g != null ? 'G ' + Math.round(g) : unit ? unit.toUpperCase() : 'WIND',
                   frac: v == null ? null : r200(clamp(v / top, 0, 1)) };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '12', sub: 'G 21', frac: 0.3 }
      }
    }
  });

  // ------------------------------------------------------------ PRESSURE
  //   the unit's factor to hPa; inHg is kept as it is (its own range, its own step)
  function pUnit(unit, v) {
    var u = String(unit || '').toLowerCase().replace(/\s/g, '');
    if (u === 'inhg') return { inhg: true, f: 33.8639, dp: 2 };
    if (u === 'hpa' || u === 'mbar' || u === 'mb') return { f: 1, dp: 0 };
    if (u === 'kpa') return { f: 10, dp: 1 };
    if (u === 'mmhg') return { f: 1.33322, dp: 0 };
    if (u === 'pa') return { f: 0.01, dp: 0 };
    if (u === 'psi') return { f: 68.9476, dp: 1 };
    if (v >= 20 && v <= 35) return { inhg: true, f: 33.8639, dp: 2 };
    return v > 800 ? { f: 1, dp: 0 } : null;
  }
  // the hourly forecast's pressure three hours on, against the forecast's own first hour: 1 rising, -1 falling, 0 steady or unknown
  function pressureDir(X, k) {
    var t = +X.now, rows = (X.hourly() || []).map(function (f) { return { at: when(f && f.datetime), p: num(f && f.pressure) }; })
      .filter(function (e) { return e.at != null && e.p != null && e.at >= t - HOUR; }).sort(function (a, b) { return a.at - b.at; });
    if (rows.length < 2) return 0;
    var base = rows[0], goal = t + 3 * HOUR, best = null;
    rows.forEach(function (e) { if (e.at > base.at && (best == null || Math.abs(e.at - goal) < Math.abs(best.at - goal))) best = e; });
    if (!best || Math.abs(best.at - goal) > 90 * 60000) return 0;
    var dv = best.p - base.p, step = k.inhg ? 0.03 : 1, d = k.inhg ? dv : dv * k.f;
    return d >= step ? 1 : d <= -step ? -1 : 0;
  }
  // (an arrow in the gauge's open bottom, under the unit, on the center line)
  function arrow(dir) {
    return '<path d="' + (dir > 0 ? 'M50 91V81M45.5 85.5L50 81l4.5 4.5' : 'M50 81v10M45.5 86.5L50 91l4.5-4.5') +
      '" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>';
  }
  W.define('pressure', {
    name: 'Pressure', group: 'Weather and Sky', wave: 'A', facts: ['pressure'], source: 'weather entity', when: null,
    wakes: ['minute', 'house', 'forecast'], pick: null, off: false, opts: {}, accent: SLATE,
    shapes: {
      circular: {
        fc: ['hourly'],
        read: function (X) {
          var ent = wxEntity(X, X.wx()), a = ent && ent.s.attributes ? ent.s.attributes : {}, v = num(a.pressure), unit = String(a.pressure_unit || '');
          var k = v == null ? null : pUnit(unit, v);
          if (v == null) return { main: DASH, sub: unit, frac: null, dir: 0 };
          // (the gauge: 28.5-31 inHg, 965-1050 hPa, where nearly every reading lands)
          var frac = !k ? null : k.inhg ? (v - 28.5) / 2.5 : (v * k.f - 965) / 85;
          return { main: k ? v.toFixed(k.dp) : String(Math.round(v)), sub: unit, frac: frac == null ? null : r200(clamp(frac, 0, 1)), dir: k ? pressureDir(X, k) : 0 };
        },
        draw: function (s) {
          var svg = ring({ gauge: true, frac: s.frac, main: s.main, sub: s.sub });
          return s.dir ? svg.replace(/<\/svg>$/, arrow(s.dir) + '</svg>') : svg;
        },
        sample: { main: '30.12', sub: 'inHg', frac: 0.65, dir: 1 }
      }
    }
  });

  // ------------------------------------------------------------ FEELS LIKE
  W.define('feels', {
    name: 'Feels Like', group: 'Weather and Sky', wave: 'A', facts: ['feels'], source: 'hkSettings.nowRead', when: null,
    wakes: ['minute', 'house', 'forecast'], pick: null, off: false, opts: {}, accent: function (s) { return tempAcc(s.tf); },
    shapes: {
      circular: {
        // the temperature along today's low to high, as the weather piece's gauge has it
        fc: ['daily'],
        read: function (X) {
          var w = X.wx(), ent = wxEntity(X, w), v = nowRead(X, 'feels_like', ent), hi = w && w.hi, lo = w && w.lo;
          return { main: deg(v), sub: 'FEELS', tf: fahr(X, v, w && w.unit),
                   frac: v != null && hi != null && lo != null && hi > lo ? r200(clamp((v - lo) / (hi - lo), 0, 1)) : null };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '61°', sub: 'FEELS', tf: 61, frac: 0.5 }
      }
    }
  });

  // ------------------------------------------------------------ MOON
  function moonName(p) {
    return p < 0.03 ? 'New Moon' : p < 0.22 ? 'Waxing Crescent' : p < 0.28 ? 'First Quarter' : p < 0.47 ? 'Waxing Gibbous' : p < 0.53 ? 'Full Moon' :
      p < 0.72 ? 'Waning Gibbous' : p < 0.78 ? 'Last Quarter' : p < 0.97 ? 'Waning Crescent' : 'New Moon';
  }
  function moonSpec(p) {
    p = Math.round((p - Math.floor(p)) * 1000) / 1000;
    return { p: p, name: moonName(p), pct: Math.round((1 - Math.cos(2 * Math.PI * p)) / 2 * 100) };
  }
  // the disc in a box: the dark side faint, the lit part a path (the same two arcs as the Weather page's moon: the limb from the
  // top to the bottom on the lit side, back along the terminator)
  function moonDisc(p, cx, cy, r) {
    var c = Math.cos(2 * Math.PI * p), illum = (1 - c) / 2, waxing = p < 0.5, rx = r * Math.abs(c), a1 = waxing ? 1 : 0, a2 = illum > 0.5 ? a1 : 1 - a1;
    var f = function (v) { return v.toFixed(2); };
    return '<circle class="a" cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '" fill="currentColor" opacity=".3"/>' +
      (illum < 0.004 ? '' : '<path class="a" fill="currentColor" d="M' + f(cx) + ' ' + f(cy - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 ' + a1 + ' ' + f(cx) + ' ' + f(cy + r) +
        'A' + f(rx) + ' ' + f(r) + ' 0 0 ' + a2 + ' ' + f(cx) + ' ' + f(cy - r) + 'Z"/>');
  }
  function moonRead(X) {
    var HS = window.hkSettings, p = null;
    try { p = HS && typeof HS.moon === 'function' ? num(HS.moon(X.st || {}, X.now)) : null; } catch (e) { p = null; }
    return p == null ? null : moonSpec(p);
  }
  W.define('moon', {
    name: 'Moon', group: 'Weather and Sky', wave: 'A', facts: ['moon'], source: 'hkSettings.moon', when: null,
    wakes: ['minute', 'house'], pick: null, off: false, opts: {}, accent: MOONC,
    shapes: {
      inline: {
        read: function (X) { var m = moonRead(X); return m ? { p: m.p, text: m.name, gl: 1 } : { p: null, text: DASH }; },
        draw: function (s) { return inl(s.p == null ? '' : '<svg viewBox="0 0 24 24" aria-hidden="true">' + moonDisc(s.p, 12, 12, 9) + '</svg>', s.text); },
        text: function (s) { return s.text; },
        sample: function () { var m = moonSpec(0.37); return { p: m.p, text: m.name, gl: 1 }; }
      },
      circular: {
        // the ring's track with the moon in it (r 18 over the center line, clear of the label), the illumination on the label baseline
        read: function (X) { var m = moonRead(X); return m ? { p: m.p, sub: m.pct + '%' } : { p: null, sub: DASH }; },
        draw: function (s) {
          return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="a" cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="7.5"/>' +
            (s.p == null ? '' : moonDisc(s.p, 50, 42, 18)) +
            '<text x="50" y="72" text-anchor="middle" font-weight="600" font-size="14" opacity=".85">' + esc(s.sub) + '</text></svg>';
        },
        sample: function () { var m = moonSpec(0.37); return { p: m.p, sub: m.pct + '%' }; }
      }
    }
  });

  // ------------------------------------------------------------ SUN
  // the day: sunrise and sunset (today's; once the sun is up, next_rising is tomorrow's, so today's is a day before it), its
  // length, and how far through it we are (null at night)
  function sunDay(X) {
    var s = X.st && X.st['sun.sun'] || {}, a = s.attributes || {}, set = when(a.next_setting), rise = when(a.next_rising), t = +X.now;
    var up = set != null && rise != null ? set < rise : s.state === 'above_horizon';
    var r0 = rise == null ? null : up ? rise - DAY : rise;
    if (r0 == null || set == null || set <= r0) return { up: up, rise: null, set: null, len: null, frac: null };
    return { up: up, rise: r0, set: set, len: set - r0, frac: up ? r200(clamp((t - r0) / (set - r0), 0, 1)) : null };
  }
  function sunGlyph() {
    return '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 18.5a5 5 0 0 1 10 0z"/>' +
      '<path d="M2.5 18.5h19M12 6.2v2.4M5.2 9.6l1.7 1.7M18.8 9.6l-1.7 1.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  // the ring's figure rules (the size by its length, the caps on the center line, 45 over a label)
  function figure(s) {
    var n = String(s).length, big = n <= 3 ? 30 : n === 4 ? 26 : n === 5 ? 21 : n === 6 ? 18 : 15;
    return '<text x="50" y="' + (45 + big * 0.355).toFixed(1) + '" text-anchor="middle" font-weight="700" font-size="' + big + '">' + esc(s) + '</text>';
  }
  function arcDraw(s) {
    var R = 43, pt = function (f) { var a = Math.PI * f; return [50 - R * Math.cos(a), 50 - R * Math.sin(a)]; };
    var stroke = ' fill="none" stroke="currentColor" stroke-width="7.5" stroke-linecap="round"';
    var svg = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="a" d="M7 50A43 43 0 0 1 93 50"' + stroke + ' stroke-opacity=".3"/>';
    if (s.frac != null && !s.night) {
      var p = pt(s.frac);
      if (s.frac >= 0.005) svg += '<path class="a" d="M7 50A43 43 0 0 1 ' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + '"' + stroke + '/>';
      svg += '<circle class="a" cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="6.5" fill="currentColor"/>';
    } else if (s.night) {
      // (at night the sun rests at the end of its arc)
      svg += '<circle class="a" cx="93" cy="50" r="6.5" fill="currentColor" opacity=".55"/>';
    }
    return svg + figure(s.main) + '<text x="50" y="72" text-anchor="middle" font-weight="600" font-size="12" opacity=".85">' + esc(s.sub) + '</text></svg>';
  }
  function lengthText(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }
  W.define('sun', {
    name: 'Sun', group: 'Weather and Sky', wave: 'A', facts: ['sun'], source: 'sun.sun', when: null,
    wakes: ['minute', 'house'], pick: null, off: false, opts: {}, accent: ACC.amber,
    shapes: {
      inline: {
        // the next of the two
        read: function (X) {
          var n = W._.sunNext(X.st || {}, X.now);
          return n ? { text: n.name + ' ' + tm(n.at, X.h24, true), gl: 1 } : { text: DASH };
        },
        draw: function (s) { return inl(s.gl ? sunGlyph() : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Sunset 5:12 PM', gl: 1 }
      },
      circular: {
        // the day's arc, the sun on it by the daylight passed (resting at its end by night), the next time and which it is
        read: function (X) {
          var n = W._.sunNext(X.st || {}, X.now), d = sunDay(X);
          if (!n) return { main: DASH, sub: 'SUNSET', frac: null, night: false };
          return { main: tm(n.at, X.h24), sub: n.name.toUpperCase(), frac: d.frac, night: !d.up };
        },
        draw: arcDraw,
        sample: { main: '5:12', sub: 'SUNSET', frac: 0.62, night: false }
      },
      rectangular: {
        // DAYLIGHT, the day's length, sunrise and sunset
        read: function (X) {
          var d = sunDay(X);
          if (d.len == null) return { l1: 'DAYLIGHT', l2: DASH, l3: '' };
          return { l1: 'DAYLIGHT', l2: lengthText(d.len), l3: 'Up ' + tm(new Date(d.rise), X.h24) + DOT + 'Down ' + tm(new Date(d.set), X.h24) };
        },
        draw: function (s) { return lines(s.l1, s.l2, s.l3, true); },
        sample: { l1: 'DAYLIGHT', l2: '10h 21m', l3: 'Up 6:51' + DOT + 'Down 5:12' }
      }
    }
  });

  window.hkSaverPiecesWeather = true;
})();
