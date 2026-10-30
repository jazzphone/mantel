// hk-detail.js - detail sheets in the style of the Home app, in place of
// Home Assistant's more-info dialog.
//
// THE TAP CONTRACT IS UNCHANGED. A pill's glyph toggles; its name (or any
// card with nothing to toggle) fires the host's more-info event
// (hkShell.events.moreInfo), exactly as before.
// This file catches that event on the way down (a capture listener on
// window) and opens its own sheet instead of HA's dialog. No dashboard
// changes, no new gestures, no holds.
//
// ONLY ON DASHBOARDS. The event is taken only when it comes from a dashboard
// (ha-panel-lovelace) or an hk card (the pop-ups live beside the panel), and
// never from inside HA's own Settings screens or dialogs -- an hk card in the
// card editor's preview included. Those keep HA's dialog.
//
// SIMPLE, ON PURPOSE. One big control per sheet; only the thermostat and
// sensors carry extra information. No history, no settings, nothing that
// leads anywhere a household user should not go.
//
// A KIND OF ENTITY WITH NO SHEET HERE (Phase 2 P2.5, docs/phase2/SHEETS.md)
// goes to the host's own detail when the host has one (hkShell.hostDetail:
// Home Assistant's more-info dialog, exactly as before -- the event is let
// through untouched), and to HK's generic sheet when it has none (Mantel):
// its state and key attributes in the client's words, a control only where
// one is obvious, and for an admin on a host with its own detail, "Open in
// Home Assistant". On such a host every request is HK's to answer (sheets
// switched off, a tap from outside a dashboard): no tap is ever dead.
//
// THE PANELS ARE NOT IN THIS FILE: this is the shell (the sheet, the interception, the pop-ups); each
// kind of device's panel is a file in web/hk/sheets/, loaded from here (see "the sheets", below).
// They are beside cards/, not in it, because both hosts load every file in cards/ as a card.
//
// LIVE STATE: the sheet is not a card, so nothing hands it a client. It takes
// every new one from hkCards.onClient (hk-base.js) AND from the host adapter's
// current client (hkCards.client(), see open()): the hub only moves while hk
// cards are on screen. Everything a sheet reads comes through the client, and
// its controls act through the client's action port (HkBase._call).
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards.HkBase);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards.HkBase);
    }, { once: true });
  }

  whenBase(function (HkBase) {
    if (window.hkDetail) return;
    var C = window.hkCards;
    var esc = C.esc;
    // A SHEET'S CHOICES ARE HK'S SEGMENTED CONTROL (hk-base.js segCss), the
    // dashboard's own: the chosen one marked `.sel`, its white sliding over
    // from the one before
    function segPick(root, sel, attr, value) {
      if (!root) return;
      var was = root.querySelector('button.sel'), from = was && C.segBox ? C.segBox(was) : null;
      root.querySelectorAll(sel).forEach(function (b) { b.classList.toggle('sel', b.getAttribute(attr) === value); });
      var now = root.querySelector('button.sel');
      if (was && now && now !== was && C.slideSeg) C.slideSeg(now, from);
    }
    var PAL = C.PALETTE.icon;
    var DOORS = C.DOOR_COVERS || { garage: 1, gate: 1, door: 1 };

    // ------------------------------------------------------------ helpers
    var ON_STATES = ['on', 'open', 'opening', 'closing', 'unlocked', 'playing',
                     'armed_home', 'armed_away', 'armed_night', 'armed_vacation',
                     'cleaning', 'returning', 'paused', 'heat', 'cool', 'heat_cool',
                     'auto', 'dry', 'fan_only'];
    // The tile's domain colours (hk-tile.js DOMAIN_MAP), so the sheet's glyph
    // is the colour of the pill it was opened from.
    var DOMAIN_COL = {
      light: 'yellow', switch: 'orange', input_boolean: 'orange', fan: 'blue',
      cover: 'blue', lock: 'green', climate: 'red', media_player: 'red',
      sensor: 'blue', binary_sensor: 'blue', vacuum: 'green', humidifier: 'blue',
      water_heater: 'orange', valve: 'blue', number: 'blue', select: 'blue',
      input_number: 'blue', input_select: 'blue', alarm_control_panel: 'green'
    };
    function stOf(h, id) { return (h && h.states && id) ? h.states[id] : null; }
    // A client as is; a legacy host input through the host adapter.
    function asClient(x) {
      if (!x || (window.hkClient && window.hkClient.is(x))) return x || null;
      return window.hkHostClient && window.hkHostClient.from ? window.hkHostClient.from(x) : null;
    }
    function at(s, k) { return s && s.attributes ? s.attributes[k] : undefined; }
    function num(v) { var n = Number(v); return (v === null || v === '' || !isFinite(n)) ? null : n; }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function domainOf(id) { return String(id || '').split('.')[0]; }
    function isOn(s) { return !!s && ON_STATES.indexOf(s.state) !== -1; }
    function unavailable(s) { return !s || s.state === 'unavailable' || s.state === 'unknown'; }
    // NO READING IS NOT NO CONTROL: `unavailable` (or no state) is a device
    // that cannot be reached; `unknown` (a Z-Wave or Zigbee device after a
    // restart, before it reports) still takes commands, as in Home
    // Assistant's own dialog -- which a sheet replaces, so a dead sheet left
    // no way to command it at all. unavailable() above stays for readings.
    function gone(s) { return !s || s.state === 'unavailable'; }

    function colourName(src, id) {
      var c = src && src.icon_color ? String(src.icon_color).toLowerCase().trim() : '';
      if (c && PAL[c]) return PAL[c];
      if (c) return src.icon_color;
      return PAL[DOMAIN_COL[domainOf(id)] || 'gray'] || PAL.gray;
    }

    // Light capabilities, from supported_color_modes.
    var COLOUR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];
    function lightCaps(s) {
      var modes = at(s, 'supported_color_modes') || [];
      var colour = modes.some(function (m) { return COLOUR_MODES.indexOf(m) !== -1; });
      var temp = modes.indexOf('color_temp') !== -1;
      var dim = modes.some(function (m) { return m !== 'onoff'; });
      var fx = (at(s, 'effect_list') || []).length > 0;
      return { colour: colour, temp: temp, dim: dim, effects: fx };
    }

    // WHICH SHEET. null = no sheet of its own here: the host's own detail
    // (HA's dialog, as before), or HK's generic sheet on a host without one.
    function kindOf(h, id) {
      var s = stOf(h, id);
      if (!s) return null;
      var d = domainOf(id);
      var f = num(at(s, 'supported_features')) || 0;
      switch (d) {
        case 'light': return lightCaps(s).dim ? 'light' : 'toggle';
        case 'switch': case 'input_boolean': return 'toggle';
        case 'fan': return (at(s, 'percentage') != null || (f & 1)) ? 'fan' : 'toggle';
        case 'cover':
          // Nothing to open, close or place -- a tilt-only blind (open/close
          // TILT and tilt position, bits 16-128): HA's dialog, which has the
          // tilt controls this sheet does not.
          if (!(f & 7)) return null;
          // A DOOR IS THE LOCK'S RING -- a garage, a gate, a car's frunk --
          // from the same list hk-base's one-tap guard uses, so the two can
          // never disagree about what a door is.
          if (DOORS[at(s, 'device_class')]) return 'garage';
          return (f & 4) ? 'cover' : 'cover_buttons';
        case 'lock': return 'lock';
        case 'climate': return 'climate';
        case 'media_player': return 'media';
        case 'sensor': return num(s.state) != null || at(s, 'unit_of_measurement') ? 'sensor' : 'state';
        case 'binary_sensor': return 'binary';
        case 'vacuum': return 'vacuum';
        case 'humidifier': return 'humidifier';
        case 'water_heater': return 'water_heater';
        case 'valve': return 'valve';
        case 'number': case 'input_number': return 'number';
        case 'select': case 'input_select': return 'select';
        case 'alarm_control_panel': return 'alarm';
        case 'camera': return 'camera';
        case 'button': case 'input_button': return 'button';
        // a person: where they are (hk-person.js); a calendar: its event --
        // the one going on or next, or the one a notification or the
        // Calendar page hands over (hk-calendar.js)
        case 'person': return 'person';
        case 'calendar': return 'event';
        // the weather: HK's own sheet (hk-weather.js), not Home Assistant's
        case 'weather': return 'weather';
        // an automation: run it, pause it, when it ran (hk-headers.js)
        case 'automation': return 'automation';
        // a timer: its countdown, its controls, its week (hk-headers.js)
        case 'timer': return 'timer';
        default: return null;
      }
    }

    // FAN SPEEDS. A Lutron Caseta fan steps in 25s: its own names are
    // low / medium / medium-high / high.
    var SPEED_NAMES = {
      2: ['Low', 'High'],
      3: ['Low', 'Medium', 'High'],
      4: ['Low', 'Medium', 'Medium-High', 'High'],
      5: ['Low', 'Medium-Low', 'Medium', 'Medium-High', 'High']
    };
    function fanSteps(s) {
      var step = num(at(s, 'percentage_step')) || 1;
      return Math.max(1, Math.round(100 / Math.max(1, step)));
    }
    function fanLabel(pct, n, on) {
      if (!on || !pct) return 'Off';
      var names = SPEED_NAMES[n];
      if (!names) return Math.round(pct) + '%';
      return names[clamp(Math.round(pct / (100 / n)), 1, n) - 1];
    }
    // timer.fan_manual_<room>: the timer of a manual-override guard, when the
    // home's automations keep one. fan.living_room_fan -> living_room.
    function fanGuard(id) {
      return 'timer.fan_manual_' + String(id).replace(/^fan\./, '').replace(/_fan$/, '');
    }

    // At most `max` points, averaged in time buckets: a power sensor writes a
    // row every few seconds, and 17,000 points in one SVG path is a tablet's
    // whole frame budget.
    function downsample(pts, max) {
      if (!pts || pts.length <= max) return pts || [];
      var t0 = +pts[0].t, t1 = +pts[pts.length - 1].t, span = (t1 - t0) || 1;
      var out = [], b = -1, sum = 0, n = 0, bt = 0;
      pts.forEach(function (p) {
        var k = Math.min(max - 1, Math.floor((+p.t - t0) / span * max));
        if (k !== b && n) { out.push({ t: new Date(bt / n), v: sum / n }); sum = 0; n = 0; bt = 0; }
        b = k; sum += p.v; n++; bt += +p.t;
      });
      if (n) out.push({ t: new Date(bt / n), v: sum / n });
      return out;
    }

    // A LINE SPANS ITS RANGE, NOT ITS ROWS. hkChart.line draws first row to
    // last row, and a sensor that has not changed lately has few rows: an
    // unchanged hour is ONE row -- "No history for this range" for a value
    // that was known all hour (most battery sensors, most of the time) -- and
    // a day that last changed at noon would end its "Now" axis at noon. So:
    // the value in force at t0 is pinned AT t0, and the live reading closes
    // the line at `now`. pts: [{t: Date|ms, v}]; returns [{t: ms, v}].
    function spanTo(pts, t0, now, live) {
      var out = [], before = null;
      (pts || []).forEach(function (p) {
        if (!p || p.v == null || !isFinite(p.v)) return;
        var t = +p.t;
        if (!isFinite(t) || t > now) return;
        if (t < t0) { before = p; return; }
        out.push({ t: t, v: p.v });
      });
      if (before && (!out.length || out[0].t > t0)) out.unshift({ t: t0, v: before.v });
      if (live != null && isFinite(live)) out.push({ t: now, v: live });
      return out;
    }

    // ------------------------------------------------------------ axes
    // ROUND NUMBERS UP THE LEFT, TIMES ALONG THE BOTTOM, so both axes carry
    // information. niceTicks picks 3-5 round values spanning the data and
    // the chart is drawn to exactly that range (hkChart's lo/hi/pad, bars'
    // max), so every label sits on its gridline: the gridlines are placed by
    // the same formula the line is.
    var AX_PAD = 6;
    function niceTicks(lo, hi, want) {
      if (!isFinite(lo) || !isFinite(hi)) return null;
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      var raw = (hi - lo) / Math.max(1, (want || 4) - 1);
      var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
      // 1, 2, 5 or 10: no 2.5 -- a tick at 72.5 printed "73", which is a lie
      var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
      var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
      var out = [];
      for (var v = a; v <= b + step / 2; v += step) out.push(+v.toFixed(6));
      if (out.length < 2) out.push(+(a + step).toFixed(6));
      return out;
    }
    function tickText(v, unit, step) {
      var a = Math.abs(v);
      var scale = a >= 1000 ? 1000 : 1;
      // Match the axis step: a 0.005 kW grid must not say "0" on every
      // line. Keep the existing shorthand when used outside an axis.
      var digits = step > 0 ? Math.max(0, Math.min(6, Math.ceil(-Math.log(step / scale) / Math.LN10 - 1e-9)))
        : scale === 1000 ? 1 : a >= 10 || v === Math.round(v) ? 0 : 1;
      var t = String(+(v / scale).toFixed(digits)) + (scale === 1000 ? 'k' : '');
      return /°/.test(unit || '') ? t + '°' : /%/.test(unit || '') ? t + '%' : t;
    }
    // n labels across a span of `ms` ending now: clock times for an hour or
    // two, hours for a day, weekdays for a week, dates beyond. The last is
    // "Now" (a day or less) or "Today".
    function timeTicks(ms, n) {
      var now = Date.now(), out = [];
      for (var i = 0; i < n; i++) {
        var f = i / (n - 1), d = new Date(now - ms * (1 - f)), t;
        if (i === n - 1) t = ms <= 36 * 3600000 ? 'Now' : 'Today';
        else if (ms <= 2 * 3600000) t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
        else if (ms <= 36 * 3600000) t = d.toLocaleTimeString([], { hour: 'numeric' }).replace(/:00/, '');
        else if (ms <= 8 * 86400000) t = d.toLocaleDateString([], { weekday: 'short' });
        else t = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        out.push({ f: f, t: t });
      }
      return out;
    }
    function timeRow(ms, n, cls) {
      return '<div class="' + (cls || 'axx') + '">' + timeTicks(ms, n).map(function (k) {
        return '<span style="left:' + (k.f * 100).toFixed(2) + '%">' + esc(k.t) + '</span>';
      }).join('') + '</div>';
    }
    // A CALENDAR PERIOD'S TIME ROW: each day labeled under itself -- a
    // week's day names (letters on a phone), a month's 1st, 8th, 15th, 22nd
    // and 29th -- today in orange, the days still to come quieter.
    // cal: { dates (each day's midnight), todayK (-1: a past period), short }
    function calRow(cal) {
      var S = window.hkStats, n = cal.dates.length, out = '';
      cal.dates.forEach(function (t, k) {
        var f = S.fields(t), lab;
        if (n <= 7) lab = cal.short ? 'SMTWTFS'[f.weekday] : new Date(t).toLocaleDateString([], { weekday: 'short', timeZone: S.tz() });
        else if (f.day === 1) lab = new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: S.tz() });
        else if ((f.day - 1) % 7 === 0) lab = String(f.day);
        else return;
        var cls = k === cal.todayK ? 'today' : cal.todayK >= 0 && k > cal.todayK ? 'fut' : '';
        out += '<span class="' + cls + '" style="left:' + ((k + 0.5) / n * 100).toFixed(2) + '%">' + esc(lab) + '</span>';
      });
      return '<div class="axx cal">' + out + '</div>';
    }
    // o: { pts, bars (bool), H, unit, ms (the span), n (time labels), colour,
    //      fluid, span: [t0, t1] (a line over a calendar period, empty past
    //      now), cal (calRow's: the days labeled under themselves), floor (the
    //      scale's least top: a usual day, so a first day is not the whole
    //      chart), gw (a day to come's gray, in words: "last week") } -- a
    //      FLUID chart fills whatever height its box has (the thermostat's
    //      trend, stretched to the dial's height): no padding, every rule and
    //      label placed by percentage, so it stays true at any height (the
    //      box's CSS must stretch .axc and the svg)
    function axesChart(o) {
      var vals = (o.pts || []).filter(function (p) { return p && p.v != null && isFinite(p.v); })
                              .map(function (p) { return p.v; });
      if (!vals.length || !window.hkChart) return '';
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), H = o.H;
      if (o.bars) {
        (o.pts || []).forEach(function (p) { if (p && isFinite(p.ghost) && p.ghost > hi) hi = p.ghost; });
        if (isFinite(o.floor) && o.floor > hi) hi = o.floor;
      }
      var ticks = o.bars ? niceTicks(0, Math.max(hi, 1e-9), 4) : niceTicks(lo, hi, 4);
      var tLo = ticks[0], tHi = ticks[ticks.length - 1], pad = o.fluid ? 0 : AX_PAD;
      var plot = o.bars
        ? window.hkChart.bars(o.pts, { height: H, split: 0, labels: false, avg: false, scale: false, max: tHi })
        : window.hkChart.line(o.pts, { height: H, colour: o.colour || 'orange', lo: tLo, hi: tHi, pad: pad, grid: false,
                                       t0: o.span && o.span[0], t1: o.span && o.span[1] });
      var y = function (v) {
        if (o.fluid) return ((tHi - v) / (tHi - tLo) * 100).toFixed(2) + '%';
        return (o.bars ? H - (v - tLo) / (tHi - tLo) * H : pad + (tHi - v) / (tHi - tLo) * (H - 2 * pad)).toFixed(1) + 'px';
      };
      var grid = '', labs = '';
      var tickStep = ticks[1] - ticks[0];
      ticks.forEach(function (v, i) {
        var top = y(v);
        grid += '<i class="gr' + (i === 0 ? ' b' : '') + '" style="top:' + top + '"></i>';
        labs += '<span style="top:' + top + '">' + esc(tickText(v, o.unit, tickStep)) + '</span>';
      });
      var hs = o.fluid ? '' : ' style="height:' + H + 'px"';
      var widest = ticks.map(function (v) { return tickText(v, o.unit, tickStep); })
                        .reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
      // what the plot DREW, for the readout (scrub): the same points, the
      // same value range and padding, so its dot lands on the line
      var drawn = o.bars
        ? (o.pts || []).map(function (p) {
            var q = [+p.t, p && p.v != null && isFinite(p.v) ? p.v : null];
            if (p && isFinite(p.ghost)) q.push(p.ghost);
            return q;
          })
        : (o.pts || []).filter(function (p) { return p && p.v != null && isFinite(p.v); }).map(function (p) { return [+p.t, p.v]; });
      var hks = { k: o.bars ? 'b' : 'l', u: o.unit || '', lo: tLo, hi: tHi, pad: o.bars ? 0 : pad, ms: o.ms, p: drawn };
      if (o.span) { hks.t0 = o.span[0]; hks.t1 = o.span[1]; }
      if (o.gw) hks.gw = o.gw;
      return '<div class="axc' + (o.fluid ? ' fl' : '') + '"><div class="ay"' + hs + '><b class="sz">' + esc(widest) + '</b>' + labs + '</div>' +
             '<div class="ap"' + hs + ' data-hks="' + esc(JSON.stringify(hks)) + '">' + grid + plot + '</div>' +
             (o.cal ? calRow(o.cal) : timeRow(o.ms, o.n || 5)) + '</div>';
    }

    // ------------------------------------------------------------ the readout
    // HOVER OR TOUCH A CHART AND IT SAYS WHAT IS THERE: a vertical line at the
    // nearest point, a dot on the line (a bar chart lights its bar instead),
    // and a label at the TOP of the line -- above the plot, where a finger
    // never covers it -- with the value and its time. A mouse shows it while
    // over the plot; a finger while it is down (pan-y: a vertical swipe still
    // scrolls the sheet, and the browser's pointercancel takes it away).
    //
    // scrub(box) is called with the chart's STABLE container after every
    // paint: the first call listens, every call puts the readout back on the
    // new plot. A power sensor's chart is redrawn on each state push, every
    // few seconds, and a finger held still must not lose its readout to it.
    function scrubValue(v, unit) {
      if (v == null) return '—';
      var a = Math.abs(v), d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
      if (/°|%/.test(unit)) d = a >= 100 ? 0 : 1;
      var t = Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
      return !unit ? t : /^(°|%)/.test(unit) ? t + unit : t + ' ' + unit;
    }
    function dayWord(t, now) {
      var d = new Date(t), n = new Date(now), y = new Date(now - 86400000);
      var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
      return same(d, n) ? 'Today' : same(d, y) ? 'Yesterday' : null;
    }
    // A POINT'S TIME, as precise as its chart: a clock time across a day
    // (Now for the live reading that closes the line), the weekday too
    // across a week, the date across a month.
    function scrubTimeLine(t, ms, now) {
      if (now - t < 60000) return 'Now';
      var d = new Date(t), clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (ms <= 36 * 3600000) return clock;
      if (ms <= 8 * 86400000) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + clock;
      return dayWord(t, now) || d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    // A BAR'S TIME is its whole span: "2 – 3 PM" (the hour still going is
    // "2 PM – Now"), a day is "Today", "Yesterday" or "Tue, Oct 7".
    function scrubTimeBar(t, step, now) {
      if (step < 20 * 3600000) {
        var h = function (x) { return new Date(x).toLocaleTimeString([], { hour: 'numeric' }); };
        var a = h(t), b = t + step > now ? 'Now' : h(t + step);
        var sa = a.match(/\s?([AP]M)$/i), sb = b.match(/\s?([AP]M)$/i);
        if (sa && sb && sa[1] === sb[1]) a = a.replace(sa[0], '');
        return a + ' – ' + b;
      }
      return dayWord(t, now) || new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    // the point at a fraction across the plot: the nearest in time for a
    // line (drawn by time, first row to last, as hkChart.line does), the
    // column under it for bars. {i, f (its own fraction), v, label}
    function scrubPick(d, f, now) {
      var p = d.p, n = p.length;
      if (!n) return null;
      if (d.k === 'b') {
        var i = clamp(Math.floor(f * n), 0, n - 1), lab = scrubTimeBar(p[i][0], d.ms / n, now);
        // a day still to come: last period's same day (its gray), or nothing yet
        if (p[i][1] == null && p[i][0] > now) {
          return p[i].length > 2 ? { i: i, f: (i + 0.5) / n, v: p[i][2], label: lab + ' \u00b7 ' + (d.gw || 'last period') }
                                 : { i: i, f: (i + 0.5) / n, v: null, text: lab, label: 'to come' };
        }
        return { i: i, f: (i + 0.5) / n, v: p[i][1], label: lab };
      }
      // a line over a calendar period spans it, not its first row to its last
      var t0 = d.t1 > d.t0 ? d.t0 : p[0][0], t1 = d.t1 > d.t0 ? d.t1 : p[n - 1][0], timed = t1 > t0;
      var want = timed ? t0 + f * (t1 - t0) : f * (n - 1), at = function (k) { return timed ? p[k][0] : k; };
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (at(m) <= want) lo = m; else hi = m; }
      var j = Math.abs(at(hi) - want) < Math.abs(at(lo) - want) ? hi : lo;
      return { i: j, f: timed ? (p[j][0] - t0) / (t1 - t0) : (n > 1 ? j / (n - 1) : 0), v: p[j][1],
               label: scrubTimeLine(p[j][0], d.ms, now) };
    }
    function scrubShow(box, ap, clientX) {
      var d = ap._hks;
      if (d === undefined) { try { d = JSON.parse(ap.getAttribute('data-hks') || 'null'); } catch (e) { d = null; } ap._hks = d; }
      if (!d || !d.p || !d.p.length) return;
      var r = ap.getBoundingClientRect();
      if (r.width < 2) return;
      var pick = scrubPick(d, clamp((clientX - r.left) / r.width, 0, 1), Date.now());
      if (!pick) return;
      var L = ap._hksL;
      if (!L) {
        L = ap._hksL = document.createElement('div');
        L.className = 'hks';
        L.setAttribute('aria-hidden', 'true');
        L.innerHTML = '<i class="hkl"></i>' + (d.k === 'l' ? '<b class="hkd"></b>' : '') +
                      '<div class="hkp"><span class="v"></span><span class="t"></span></div>';
        ap.appendChild(L);
        if (d.k === 'l') {
          // the dot is the line's own color
          var stroke = ap.querySelector('svg path[stroke]');
          if (stroke) L.querySelector('.hkd').style.borderColor = stroke.getAttribute('stroke');
        } else {
          ap._hksBars = ap.querySelector('[style*="grid-template-columns"]');
          if (ap._hksBars) ap._hksBars.classList.add('hksg');
        }
      }
      // on a device pixel, as every rule is (a half-pixel line is a blur)
      var dpr = window.devicePixelRatio || 1, x = Math.round(pick.f * r.width * dpr) / dpr;
      L.firstChild.style.transform = 'translateX(' + x + 'px)';
      if (d.k === 'l') {
        var span = (d.hi - d.lo) || 1, y = d.pad + (d.hi - pick.v) / span * (r.height - 2 * d.pad);
        L.querySelector('.hkd').style.transform = 'translate(' + x + 'px,' + y.toFixed(1) + 'px)';
      } else if (ap._hksBars && ap._hksOn !== pick.i) {
        var cells = ap._hksBars.children;
        if (cells[ap._hksOn]) cells[ap._hksOn].classList.remove('hkon');
        if (cells[pick.i]) cells[pick.i].classList.add('hkon');
        ap._hksOn = pick.i;
      }
      var pill = L.lastChild;
      if (ap._hksTxt !== pick.label + '|' + pick.v + '|' + pick.text) {
        ap._hksTxt = pick.label + '|' + pick.v + '|' + pick.text;
        pill.firstChild.textContent = pick.text != null ? pick.text : scrubValue(pick.v, d.u);
        pill.lastChild.textContent = pick.label;
        ap._hksW = pill.offsetWidth;
      }
      // the label centered on the line, kept inside the chart: it may run
      // over the values' column on the left, never past the plot's right
      var axc = ap.parentNode, left = axc ? axc.getBoundingClientRect().left - r.left : 0;
      var w = ap._hksW || 0, pl = clamp(x - w / 2, left, Math.max(left, r.width - w));
      pill.style.transform = 'translateX(' + Math.round(pl * dpr) / dpr + 'px)';
      L.classList.add('on');
      if (d.k === 'b' && ap._hksBars) ap._hksBars.classList.add('on');
    }
    function scrubHide(box) {
      box._hksX = null;
      box.querySelectorAll('.ap .hks.on, .ap .hksg.on').forEach(function (e) { e.classList.remove('on'); });
    }
    function scrub(box) {
      if (!box) return;
      if (!box._hksBound) {
        box._hksBound = true;
        box._hksX = null;
        var plotOf = function (e) {
          var path = e.composedPath ? e.composedPath() : [];
          for (var i = 0; i < path.length && path[i] !== box; i++) {
            if (path[i].classList && path[i].classList.contains('ap')) return path[i];
          }
          return null;
        };
        var to = function (ap, x) { box._hksX = x; scrubShow(box, ap, x); };
        box.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'mouse') return;
          var ap = plotOf(e);
          if (!ap) return;
          box._hksId = e.pointerId;
          try { box.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
          to(ap, e.clientX);
        });
        box.addEventListener('pointermove', function (e) {
          if (e.pointerType === 'mouse') {
            var ap = plotOf(e);
            if (ap) to(ap, e.clientX); else if (box._hksX != null) scrubHide(box);
            return;
          }
          if (e.pointerId !== box._hksId || box._hksX == null) return;
          var cur = box.querySelector('.ap');
          if (cur) to(cur, e.clientX);
        });
        var end = function (e) {
          if (e.pointerType === 'mouse' && e.type !== 'pointerleave') return;
          if (e.pointerType !== 'mouse' && e.pointerId !== box._hksId) return;
          box._hksId = null;
          scrubHide(box);
        };
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
        box.addEventListener('pointerleave', end);
        return;
      }
      // a redraw: the readout back where it was, on the new plot
      if (box._hksX != null) {
        var ap2 = box.querySelector('.ap');
        if (ap2) scrubShow(box, ap2, box._hksX);
      }
    }

    // Colour temperature -> an sRGB swatch (Tanner Helland's fit).
    function kelvinRgb(k) {
      var t = clamp(k, 1000, 40000) / 100, r, g, b;
      r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
      return [clamp(Math.round(r), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(b), 0, 255)];
    }
    function css(rgb) { return 'rgb(' + rgb.join(',') + ')'; }
    function hsCss(hs) { return 'hsl(' + Math.round(hs[0]) + ',100%,' + Math.round(100 - (hs[1] / 2)) + '%)'; }
    // A fill colour for a light: its own colour, lifted toward white so a dim
    // red is still readable as a slider.
    function lightFill(s) {
      var rgb = at(s, 'rgb_color');
      var look = window.hkSettings && window.hkSettings.rendering ? window.hkSettings.rendering() : {};
      if (look.flat && look.theme === 'light') {
        // White light belongs to the sheet's neutral control palette. A
        // white fill on its white sheet made the active level disappear.
        if (!rgb || rgb.length !== 3 || Math.max.apply(null, rgb) - Math.min.apply(null, rgb) < 32) return C.v('track-fill');
        return css(rgb); // colored light keeps its color, without a white wash
      }
      if (!rgb || rgb.length !== 3) return 'rgba(255,255,255,0.95)';
      return css(rgb.map(function (c) { return Math.round(c + (255 - c) * 0.3); }));
    }

    // HA's favourite colours for a light live in the entity registry
    // (options.light.favorite_colors). Reading it needs an admin; a wall
    // tablet is not one, so it gets the same kind of defaults HA itself
    // offers: a few whites across the light's range, then colours.
    var FAV_CACHE = {};
    function defaultFavourites(s) {
      var caps = lightCaps(s), out = [];
      if (caps.temp) {
        var lo = num(at(s, 'min_color_temp_kelvin')) || 2000, hi = num(at(s, 'max_color_temp_kelvin')) || 6500;
        [2700, 4000, 6000].forEach(function (k) { out.push({ color_temp_kelvin: clamp(k, lo, hi) }); });
      }
      if (caps.colour) {
        [[0, 100], [30, 100], [120, 90], [210, 100], [280, 85], [330, 75]].forEach(function (hs) {
          out.push({ hs_color: hs });
        });
      }
      return out.slice(0, 6);
    }
    function favourites(h, s, cb) {
      var id = s.entity_id;
      if (FAV_CACHE[id]) return FAV_CACHE[id];
      FAV_CACHE[id] = defaultFavourites(s);
      if (h && h.user && h.user.is_admin && h.callWS) {
        h.callWS({ type: 'config/entity_registry/get', entity_id: id }).then(function (e) {
          var f = e && e.options && e.options.light && e.options.light.favorite_colors;
          if (Array.isArray(f) && f.length) { FAV_CACHE[id] = f; if (cb) cb(); }
        }).catch(function () { /* defaults stand */ });
      }
      return FAV_CACHE[id];
    }
    function favCss(f) {
      if (f.color_temp_kelvin) return css(kelvinRgb(f.color_temp_kelvin));
      if (f.hs_color) return hsCss(f.hs_color);
      if (f.rgb_color) return css(f.rgb_color);
      if (f.rgbw_color) return css(f.rgbw_color.slice(0, 3));
      if (f.rgbww_color) return css(f.rgbww_color.slice(0, 3));
      if (f.xy_color) return 'rgb(255,255,255)';
      return 'rgb(255,255,255)';
    }
    function favMatches(f, s) {
      if (f.color_temp_kelvin) {
        return at(s, 'color_mode') === 'color_temp' && Math.abs((num(at(s, 'color_temp_kelvin')) || 0) - f.color_temp_kelvin) < 120;
      }
      var hs = at(s, 'hs_color');
      if (f.hs_color && hs && at(s, 'color_mode') !== 'color_temp') {
        var dh = Math.abs(hs[0] - f.hs_color[0]); dh = Math.min(dh, 360 - dh);
        return dh < 8 && Math.abs(hs[1] - f.hs_color[1]) < 8;
      }
      return false;
    }

    function throttle(fn, ms) {
      var last = 0, t = null, args = null;
      function run() { last = Date.now(); t = null; fn.apply(null, args); }
      var w = function () {
        args = arguments;
        var wait = ms - (Date.now() - last);
        if (wait <= 0) { clearTimeout(t); run(); } else if (!t) t = setTimeout(run, wait);
      };
      w.cancel = function () { clearTimeout(t); t = null; };
      return w;
    }

    function glyph(icon, size) {
      return '<hk-icon icon="' + esc(icon) + '" style="--mdc-icon-size:' + size + 'px"></hk-icon>';
    }
    var BACK = 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z';

    // ------------------------------------------------------------ the sheet
    // Widths on a tablet. On a phone every sheet is the screen less 16 px a
    // side (CSS below), whatever its kind.
    // TWO WIDTHS AND ONE HEIGHT: every sheet is STD wide except the two that
    // lay out in two columns, and every sheet is SHEET_H tall -- the X and the
    // name land in the same place whatever opens. The keys stay per kind so a
    // kind can move.
    var STD = 460, WIDE = 820, SHEET_H = 680;
    // A SHORT SCREEN: wider than a phone, under 500 px tall, held sideways
    var SHORT_MQ = '(orientation:landscape) and (max-height:500px) and (min-width:' + (C.BP.phone + 1) + 'px)';
    // ONE SPACING SCALE for every sheet (2026-10-12: gaps intentional, things
    // aligned). 20 between regions -- the header and the body, two columns,
    // a notification and the sheet under it; 20 (a phone 16) between a
    // control sheet's big pieces -- the control, the state, what's under
    // it; 12 between blocks in a column and between buttons side by side;
    // 6 from a title to its line. Cards: radius 20, padding 16 18 14 (a
    // card of rows alone 14 18); text outside a card on the card text's
    // edge, 18 in.
    // (hkCards.SP, hk-base.js: one of the three spacing tiers)
    var SP = C.SP;
    // Full-height light and shade controls share a silhouette. Color lights
    // keep the shorter slider that leaves room for swatches and effects.
    var SLIDER_H = { full: 400, phone: 330 };
    // ONE PHONE HEIGHT TOO, the speaker's, so every sheet is the same size.
    // The whole screen less 80 -- which only the stacked thermostat needs --
    // would leave every other phone sheet in 200-350 px of empty space.
    // 643 = the playing speaker's panel (548, Browse Music the last row) +
    // the header, gap, padding and border (94) + 1: the tallest sheet that
    // does not scroll. Measured with offsetHeight -- a sheet caught mid-open
    // is scaled 0.98 and its rect reads 2% short. The thermostat (668) and
    // the water heater (644) scroll inside theirs; a shorter screen still
    // takes screen - 80 and scrolls more of them.
    var PHONE_H = 643;
    var WIDTH = {
      light: STD, light_colour: STD, toggle: STD, fan: STD, cover: STD,
      cover_buttons: STD, lock: STD, climate: WIDE, media: STD, media_tv: STD,
      sensor: WIDE, state: STD, binary: STD, vacuum: STD, control: STD,
      // the water heater is the thermostat's sheet: its ring, its size, its
      // two columns -- the two are the same, and the same size
      number: STD, select: STD, humidifier: STD, water_heater: WIDE, alarm: STD,
      // a person (them | where they are) and an event (it | its day): two
      // columns on a tablet, one on a phone
      person: WIDE, event: WIDE, weather: WIDE, automation: STD, timer: STD,
      // HK's generic sheet (Phase 2 P2.5): a state, a few lines, at most a button
      generic: STD,
      // a room's "3 Windows": two full pills a row (2 x 196 + 10 of its ~410)
      group: STD,
      // a custom pop-up's own cards: narrow or wide, as it asks
      cards: STD, cards_wide: WIDE,
      // a camera: the camera pop-ups' 1200 (16:9 -> 675 of picture);
      // the height is the picture's (hkAutoHeight), never past the screen
      camera: 1200
    };
    var AUTO_CLOSE_MS = 60000;

    var SHEET_CSS = [
      // it takes focus on opening (the keyboard's place to start), with no ring
      '.sheet:focus{outline:none}',
      '.hkd{position:fixed;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;',
      '  pointer-events:none;-webkit-tap-highlight-color:transparent;color:' + window.hkCards.v('ink') + ';',
      // the dashboard's font: the sheet is mounted outside the view
      '  ' + window.hkCards.FONT_ROOT + ';',
      // CENTRED ON THE DASHBOARD, past Home Assistant's sidebar (hk-menu.js
      // publishes where the dashboard starts) -- a docked menu is part of the
      // dashboard, so the sheet centres over it too. The backdrop, inset 0,
      // still covers everything.
      // ...and clear of a side safe area (the iPhone Duo's strip, a phone
      // turned: hk-base.js SAFE, 2026-10-30)
      '  box-sizing:border-box;padding-left:max(var(--hk-content-left,0px), var(--hk-safe-left,env(safe-area-inset-left,0px)));padding-right:var(--hk-safe-right,env(safe-area-inset-right,0px))}',
      // A CARD IN THE SHEET wears the look's plate for a sheet (M.bg), when
      // the look has one: Tinted's dark plate on this dark sheet is a hole
      '.hkd{--hk-plate-here:var(--hk-glass-plate-sheet)}',
      '.hkd .bd{position:absolute;inset:0;background:rgba(17,17,17,0.34);opacity:0;',
      '  transition:opacity .3s ease;pointer-events:auto}',
      '.hkd.open .bd{opacity:1}',
      // THE CAPS ARE THE SCREEN LESS 16 px A SIDE. On the car the document is
      // zoomed (tesla-viewport.js, <html> at ~0.67), and a viewport unit is
      // zoomed with it: 100dvh capped the thermostat at 406 of 638 px. That
      // script sets --hk-vw / --hk-vh in layout px on a zoomed car dashboard
      // only; everywhere else they are unset and the viewport units stand.
      // ONE HEIGHT: SHEET_H on a tablet, the screen less 40 px top and bottom
      // on a phone (below) -- and never past the screen less 16 a side, which
      // is where a short window (the car, a phone on its side) scrolls.
      '.hkd .sheet{position:relative;box-sizing:border-box;pointer-events:auto;',
      '  width:var(--hkd-w,' + STD + 'px);max-width:calc(var(--hk-vw, 100vw) - max(var(--hk-content-left, 0px), var(--hk-safe-left,env(safe-area-inset-left,0px))) - var(--hk-safe-right,env(safe-area-inset-right,0px)) - 32px);',
      '  height:' + SHEET_H + 'px;max-height:calc(var(--hk-vh, 100dvh) - 32px);',
      '  display:flex;flex-direction:column;gap:20px;padding:24px;border-radius:38px;',
      // THE COLOUR COMES THROUGH: a light tint over a saturated blur, so the
      // sky and the pills behind tint the sheet the way the Home app's cards
      // are tinted. A look may wear its own (--hk-sheet-*: Bright Glass's
      // white .22 over blur(34px) saturate(2) and its rim, 2026-10-30).
      '  background:var(--hk-sheet-plate,rgba(28,28,32,0.52));-webkit-backdrop-filter:var(--hk-sheet-backdrop,blur(34px) saturate(1.9));',
      '  backdrop-filter:var(--hk-sheet-backdrop,blur(34px) saturate(1.9));border:var(--hk-sheet-edge,1px solid rgba(255,255,255,0.12));',
      '  box-shadow:var(--hk-sheet-shadow,0 26px 64px rgba(0,0,0,0.55));overflow:hidden;',
      '  opacity:0;transform:translateY(24px) scale(.98);',
      '  transition:opacity .25s ease,transform .3s cubic-bezier(.32,.72,0,1)}',
      '.hkd.open .sheet{opacity:1;transform:none}',
      // One clip edge for the scroller AND its shadow. A sticky pseudo inside
      // the padded body sat 8 px below that edge, letting content show above
      // it. The frame needs no measured top and stays aligned at Safari zoom.
      '.hkd .body-frame{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      // no shadows at its ends: a list is cut clean (hk-base.js SCROLL EDGES)
      // THE HEADER IS EXACTLY AS TALL AS THE X (44, a phone 40), so the X --
      // centred on the row -- sits the sheet's padding from the top AND from
      // the right. It is the glyph and the NAME, centred together: room, state
      // and speed are all in the sheet itself.
      '.hkd .hd{display:flex;align-items:center;gap:14px;flex-shrink:0;height:44px}',
      '.hkd .well{width:44px;height:44px;border-radius:22px;flex-shrink:0;display:flex;',
      '  align-items:center;justify-content:center;background:rgba(255,255,255,0.12);transition:background .2s}',
      '.hkd .well hk-state-icon{--mdc-icon-size:24px;width:24px;height:24px;display:flex}',
      '.hkd .tx{flex-grow:1;min-width:0}',
      '.hkd .tt{font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:24px;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE X IS THE SAME SIZE AS THE WELL, so centring it on the header row
      // puts it exactly as far from the top as from the right (the sheet's
      // padding either way) -- the rule the alarm pop-up's X broke.
      '.hkd .x{width:44px;height:44px;border-radius:22px;border:0;padding:0;flex-shrink:0;',
      '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
      '  background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.92);--mdc-icon-size:20px}',
      '.hkd .x:active{background:rgba(255,255,255,0.26)}',
      '.hkd .body{flex-grow:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
      '  -webkit-overflow-scrolling:touch;scrollbar-width:none;display:flex;flex-direction:column}',
      '.hkd .body::-webkit-scrollbar{display:none}',
      // ...RIGHT UP TO THE HEADER: the body takes back the sheet's gap above
      // it as padding, so what scrolls slides under the name (the shadow at
      // its foot, shadeCss) instead of being cut off a gap below it. At rest
      // nothing moves. (A bare sheet's header floats: it has no gap to take.)
      // ...but not right against the glyph and the X (2026-10-12: the line
      // touched them): 12 px of the gap stay clear above where it scrolls
      '.hkd .sheet:not(.bare) .body-frame{margin-top:-8px}',
      '.hkd .sheet:not(.bare) .body{padding-top:8px}',
      // THE CONTROL SITS IN THE MIDDLE of what the header leaves. Auto
      // margins, not justify-content:center: when a short window makes the
      // content taller than the body, auto margins fall to zero and the body
      // scrolls from the top; centring would cut the top off unreachably.
      '.hkd .body > *{margin-block:auto}',
      // a panel that FILLS the body instead (a pick list) -- see hkFill
      '.hkd .body > .fill{margin-block:0;flex-grow:1;min-height:0;display:flex;flex-direction:column}',
      // A BARE SHEET (the camera): a camera pop-up, not a control sheet --
      // the picture to every edge, the pop-ups' 30 px corners, no header, the
      // X floating over the picture as the pop-ups' is (rgba(28,28,30,.62),
      // as far from the top as from the right, 18). As wide as --hkd-w, or narrower
      // when the screen is too short for the picture at that width (--hkd-ar
      // is its shape), so there are never bars beside it. Specific enough to
      // win over the phone rules below.
      // opaque: the picture fills it, so the sheet's frost is work nobody sees
      // -- a 34 px blur of everything behind a 1200x675 box, re-run whenever
      // the strip's live tile or the sky moves under it
      '.hkd .sheet.bare{padding:0;gap:0;border-radius:30px;height:auto;background:#0b0d12;',
      '  -webkit-backdrop-filter:none;backdrop-filter:none;',
      '  width:min(var(--hkd-w,1200px), calc((var(--hk-vh, 100dvh) - 32px) * var(--hkd-ar, 1.7778)))}',
      '.hkd .sheet.bare .hd{position:absolute;top:18px;right:18px;z-index:3;height:auto}',
      '.hkd .sheet.bare .well,.hkd .sheet.bare .tx{display:none}',
      // (white on it in every look: Flat's ink glyph vanished on the dark
      // plate, the user 2026-10-17)
      '.hkd .sheet.bare .x{background:rgba(28,28,30,0.62);color:#fff}',
      '.hkd .sheet.bare .body{overflow:hidden}',
      // ...and the pop-ups' dim (hk-popup.js, rgba(17,17,17,.8)): a control
      // sheet's lighter one lets the sky tint its glass; a picture has none.
      '.hkd.bare .bd{background:rgba(17,17,17,0.8)}',
      '@media (max-width:' + C.BP.phone + 'px){',
      '  .hkd .sheet{width:calc(var(--hk-vw, 100vw) - var(--hk-safe-left,env(safe-area-inset-left,0px)) - var(--hk-safe-right,env(safe-area-inset-right,0px)) - 32px);padding:18px;gap:16px;border-radius:30px;',
      // (20 above and below on a small phone -- an iPhone SE's 667 -- where 40 left a media sheet's last row under its foot)
      '    height:min(' + PHONE_H + 'px, calc(var(--hk-vh, 100dvh) - 40px))}',
      '}',
      // (a phone's header, glyph, X and title -- a short screen's too)
      '@media (max-width:' + C.BP.phone + 'px),' + SHORT_MQ + '{',
      '  .hkd .well,.hkd .x{width:40px;height:40px;border-radius:20px}',
      '  .hkd .hd{height:40px;gap:12px}',
      '  .hkd .sheet:not(.bare) .body-frame{margin-top:-6px}',
      '  .hkd .sheet:not(.bare) .body{padding-top:6px}',
      '  .hkd .tt{font-size:20px;line-height:22px}',
      '}',
      // A SHORT SCREEN (2026-10-24: a phone on its side, 844 x 390; the
      // car's): the sheet is the screen's height less 12 px a side, wide
      // enough for two columns -- the control on the left at the body's
      // full height, what it reads and its buttons beside it (PANEL_CSS
      // SHORT) -- with a phone's header and corners. HAS_SHORT is the one
      // test, here and in the panels.
      '@media ' + SHORT_MQ + '{',
      '  .hkd .sheet{width:calc(var(--hkd-w,' + STD + 'px) + 120px);height:calc(var(--hk-vh, 100dvh) - 24px);max-height:calc(var(--hk-vh, 100dvh) - 24px);',
      '    padding:16px;gap:12px;border-radius:30px}',
      '  .hkd .sheet:has(hk-detail-media){width:min(760px, calc(var(--hk-vw, 100vw) - max(var(--hk-content-left, 0px), var(--hk-safe-left,env(safe-area-inset-left,0px))) - var(--hk-safe-right,env(safe-area-inset-right,0px)) - 32px))}',
      '}',
      '@media (prefers-reduced-motion:reduce){.hkd .bd,.hkd .sheet,.hkd .body-frame::before,.hkd .body-frame::after{transition:none}}'
    ].join('');

    // Recalculate the footer when content or the viewport changes as well
    // as on scroll. The settings pane and forecasts can grow after opening.
    // No per-frame work; observers/listeners belong to this sheet's lifetime.
    function sheetEdges(body, sheet) {
      var offTop = C.shade(body, sheet), ro, mo;
      function check() {
        var more = body.scrollHeight - body.clientHeight - body.scrollTop > 2;
        if (more === sheet.hasAttribute('hk-scroll-more')) return;
        if (more) sheet.setAttribute('hk-scroll-more', ''); else sheet.removeAttribute('hk-scroll-more');
      }
      function observe() {
        if (ro) {
          ro.disconnect(); ro.observe(body);
          Array.prototype.forEach.call(body.children, function (child) {
            ro.observe(child);
            if (child._root && child._root.nodeType === 1) ro.observe(child._root);
          });
        }
        check();
      }
      body.addEventListener('scroll', check, { passive: true });
      if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(check);
      if (typeof MutationObserver !== 'undefined') { mo = new MutationObserver(observe); mo.observe(body, { childList: true }); }
      observe();
      return function () { offTop(); body.removeEventListener('scroll', check); if (ro) ro.disconnect(); if (mo) mo.disconnect(); };
    }

    // A NOTIFICATION, OPENED (hk-notify.js -> open(id, null, { note })): it
    // rides on the sheet a tile opens, and the sheet keeps its size.
    //   tablet, a one-column sheet: the sheet is WIDE and the notification
    //     is its left column (340 -- the sheet's own 410 stays on the right)
    //   a two-column sheet (a person, an event, the thermostat): the card
    //     at the top of its left column (the panel places it: hkNote), else
    //     at the top of the body
    //   phone: the card first in the sheet's own scroll
    //   the camera (a bare sheet): over the picture's top on a tablet,
    //     under the picture on a phone
    var NOTE_CSS = [
      '.hkd .body.n2{flex-direction:row;gap:' + SP.region + 'px;align-items:stretch}',
      '.hkd .body.n2 > *{margin-block:0}',
      '.hkd .body.n2 > :not(.hkn-col){flex:1;min-width:0;align-self:center}',
      '.hkd .body.n2 > .fill{align-self:stretch}',
      '.hkn-col{width:340px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;',
      '  text-align:center;border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:24px ' + SP.inset + 'px;box-sizing:border-box}',
      '.hkn-col .hero{width:96px;height:96px;border-radius:48px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.hkn-col .hero hk-icon{--mdc-icon-size:48px;color:#fff;display:flex}',
      '.hkn-col .pic{width:100%;aspect-ratio:16/9;border-radius:12px;object-fit:cover;flex:none;background:rgba(255,255,255,0.06);cursor:pointer}',
      '.hkn-col .imp{margin-top:20px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#ff453a}',
      '.hkn-col .what{margin-top:20px;font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:26px;overflow-wrap:anywhere}',
      '.hkn-col .imp + .what{margin-top:' + SP.line + 'px}',
      '.hkn-col .msg,.hkn-col .when{margin-top:' + SP.line + 'px;font-size:15px;line-height:20px;color:' + window.hkCards.v('ink-2') + '}',
      '.hkn-col .msg{color:' + window.hkCards.v('ink') + '}',
      '.hkn-col .acts{align-self:stretch;display:flex;flex-direction:column;gap:' + SP.block + 'px;margin-top:24px}',
      '.hkn-b{height:50px;border-radius:25px;border:0;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 18px;',
      '  white-space:nowrap;background:rgba(255,255,255,0.14);color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent;min-width:0}',
      '.hkn-b:active{background:rgba(255,255,255,0.24)}',
      '.hkn-b hk-icon{--mdc-icon-size:20px;display:flex;flex:none}',
      '.hkn-b span{overflow:hidden;text-overflow:ellipsis}',
      '.hkn-b .chev{opacity:.5;font-size:19px;margin-left:-2px;flex:none}',
      '.hkn-b.on{background:rgba(255,255,255,0.92);color:rgba(0,0,0,0.85)}',
      // the card: 14 all round, the glyph and the buttons on one left edge
      '.hkn-card{display:flex;flex-direction:column;gap:' + SP.block + 'px;padding:14px;border-radius:' + SP.cardR + 'px;',
      '  background:rgba(255,255,255,0.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);flex-shrink:0;color:' + window.hkCards.v('ink') + ';box-sizing:border-box;text-align:left}',
      '.hkd .body > .hkn-card{margin:0 0 ' + SP.region + 'px}',
      '.hkn-card .r1{display:flex;align-items:center;gap:12px}',
      '.hkn-card .r2{display:flex;gap:' + SP.block + 'px}',
      '.hkn-card .r2 .hkn-b{flex:1;height:40px;border-radius:20px;font-size:14px;padding:0 12px;gap:6px}',
      '.hkn-card .r2 .hkn-b hk-icon{--mdc-icon-size:18px}',
      '.hkn-card .ni{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.hkn-card .ni hk-icon{--mdc-icon-size:19px;color:#fff;display:flex}',
      '.hkn-card .nt{flex:1;min-width:0}',
      '.hkn-card .n1{font-size:15px;font-weight:650;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hkn-card .n2{font-size:13px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hkn-card .imp{color:#ff453a;font-weight:700}',
      '.hkn-card img{width:58px;height:40px;border-radius:8px;object-fit:cover;flex:none;cursor:pointer;background:rgba(255,255,255,0.06)}',
      // over the camera's picture (a tablet), its top left -- the foot has
      // the camera's own controls: dark, not a second blur (one blur layer
      // per sheet, the sheet's own)
      '.hkn-card.over{position:absolute;left:' + SP.region + 'px;top:' + SP.region + 'px;width:420px;max-width:calc(100% - 40px);z-index:3;',
      '  background:rgba(24,24,28,0.93)}',
      '.hkn-card.under{margin:' + SP.block + 'px}',
      // a phone: the words alone, a little smaller ("Doors & Windows ›" fits)
      '@media (max-width:' + C.BP.phone + 'px){.hkn-card .r2 .hkn-b hk-icon{display:none}.hkn-card .r2 .hkn-b{font-size:13px;padding:0 10px}}'
    ].join('');

    var D = { el: null };

    function haRoot() {
      return window.hkShell.overlayRoot() || document.body;
    }

    // THE ROOM: the media sheet's "Playing on · Living Room" (a pill can be
    // named for a shortcut like "Apple Music", not for where it plays).
    function roomOf(h, id) {
      var e = h && h.entities && h.entities[id];
      if (!e) return '';
      var area = e.area_id;
      if (!area && e.device_id && h.devices && h.devices[e.device_id]) area = h.devices[e.device_id].area_id;
      var a = area && h.areas && h.areas[area];
      return a ? a.name : '';
    }

    // A NEAR-WHITE WELL TAKES A DARK GLYPH. The well is the pill's colour
    // while the thing is on, and a pill can be coloured near-white (the
    // speakers are rgba(255,255,255,0.85)): a white glyph on it vanishes.
    // Near-white = every channel bright, so yellow and mint keep white.
    function nearWhite(c) {
      var t = String(c || '').trim(), rgb = null, m;
      if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t))) {
        var x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
        rgb = [0, 2, 4].map(function (i) { return parseInt(x.substr(i, 2), 16); });
      } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(t))) {
        rgb = m[1].split(',').slice(0, 3).map(parseFloat);
      }
      return !!rgb && rgb.length === 3 && Math.min.apply(null, rgb) >= 200;
    }

    // THE HEADER'S GLYPH IS THE ENTITY'S OWN GLYPH: the header icons and the
    // pop-ups' icons match the entity's icons, and the mdi icons are only the
    // fallback. In order:
    //   1. the card it was opened from -- its `icon`, and `icon_states` by
    //      state, exactly as that tile draws it;
    //   2. opened from anywhere else (a chip, a room's status row, #alarm, a
    //      link in another sheet): THIS dashboard's own card for the entity,
    //      the first that names an hk: glyph;
    //   3. the entity's own icon, as its SF Symbol when the glyph set has one
    //      of the same name (mdi:fan -> hk:fan, as the menu does);
    //   4. and only then Home Assistant's own icon for it.
    // The colour follows the same card (icon_color), so the header matches
    // the pill it stands for.
    var LOOKS = typeof WeakMap === 'function' ? new WeakMap() : null;
    function lookOf(id) {
      var cfg = C.menu && typeof C.menu.config === 'function' ? C.menu.config() : null;
      if (!cfg || !id || !LOOKS) return null;
      var map = LOOKS.get(cfg);
      if (!map) {
        map = {};
        (function walk(node, depth) {
          if (!node || typeof node !== 'object' || depth > 14) return;
          if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
          if (typeof node.entity === 'string' && typeof node.icon === 'string' && /^hk:/.test(node.icon) &&
              !map[node.entity]) {
            map[node.entity] = { icon: node.icon, icon_states: node.icon_states, icon_color: node.icon_color };
          }
          for (var k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && node[k] && typeof node[k] === 'object') walk(node[k], depth + 1);
          }
        })(cfg.views, 0);
        LOOKS.set(cfg, map);
      }
      return map[id] || null;
    }
    // The card whose look the header takes: the one it was opened from when
    // that names a glyph, else the dashboard's card for the entity.
    function lookFor(src, id) {
      return (src && src.icon) ? src : (lookOf(id) || src || {});
    }
    function headIcon(look, s) {
      var m = look && look.icon_states, st = s && s.state;
      if (m && st != null) {
        // `on:` unquoted in YAML is the boolean true (hk-tile.js normalises
        // its own copy; a looked-up config is raw)
        var alias = st === 'on' ? 'true' : st === 'off' ? 'false' : null;
        if (m[st] != null) return m[st];
        if (alias && m[alias] != null) return m[alias];
      }
      if (look && look.icon) return look.icon;
      var acc = s && accIcon(s.entity_id);
      if (acc) return acc;
      var own = s && s.attributes && s.attributes.icon;
      var mm = /^mdi:(.+)$/.exec(String(own || ''));
      var g = window.hkGlyphs && window.hkGlyphs.icons;
      if (mm && g && g[mm[1]]) return 'hk:' + mm[1];
      return null;                          // Home Assistant's own, via stateObj
    }

    function paintHeader(h) {
      var d = D, s = stOf(h, d.id);
      if (d.panel && d.panel.hkHead && d.panel.hkHead(h, d)) return;
      var on = isOn(s);
      d.well.style.background = on ? d.colour : 'rgba(255,255,255,0.12)';
      d.icon.style.color = on ? (nearWhite(d.colour) ? 'rgba(0,0,0,0.78)' : '#fff') : d.colour;
      if (h && h.bindStateIcon) h.bindStateIcon(d.icon, s); else d.icon.stateObj = s;
      var hk = headIcon(d.look, s);
      if (hk) d.icon.icon = hk;
      else if (d.icon.icon) d.icon.icon = undefined;
      // AN ALARM'S GLYPH IS ITS STATE: the shield and colour the keypad shows
      // at rest (hk-security.js HkAlarmKeypadCard.status) on a plain well --
      // not the domain's fixed green, which would put a green shield over a
      // red "Disarmed".
      var K = domainOf(d.id) === 'alarm_control_panel' && !(d.look && d.look.icon_color) &&
              customElements.get('hk-alarm-keypad-card');
      if (K && K.status) {
        var look = K.status(s);
        d.well.style.background = 'rgba(255,255,255,0.12)';
        d.icon.style.color = look.color;
        d.icon.icon = look.icon;
      }
      // A camera is its own glyph, and is named for its device ("Driveway"),
      // not its stream ("Driveway Camera Low resolution channel").
      if (domainOf(d.id) === 'camera' && !hk) d.icon.icon = 'hk:camera';
      // the name on the tile it was opened from (a generated tile already
      // carries the accessory's), else the accessory's own (its gear), else
      // the panel's -- the card over the home, as everywhere
      d.tt.textContent = (d.src && d.src.name) || accName(d.id) ||
                         (d.panel && d.panel.hkTitle && d.panel.hkTitle(h, s)) || at(s, 'friendly_name') || d.id;
    }

    function armAuto() {
      clearTimeout(D.auto);
      // all: an accessory opened from a Climate list goes with its list --
      // left to idle, the tablet is back on its page in one timeout, not two
      D.auto = setTimeout(function () { close(false, true); }, D.autoMs || AUTO_CLOSE_MS);
    }

    // Does this dashboard have a view at `path`? true / false, or null when
    // the config cannot be read.
    function hasView(path) {
      try {
        var conf = window.hkShell.dashboardConfig();
        var views = conf && conf.views;
        if (!views) return null;
        return views.some(function (x) { return x.path === path; });
      } catch (e) { return null; }
    }

    // ============================================================ NOTIFICATION
    // GO TO: the page the screen itself shows the accessory on -- the same
    // lists the generated pages are built from (hkStrategy.pageMembers) --
    // else its room's page, else nothing; a page this dashboard does not
    // have is skipped. A notification's own (its Go To: a page, or "none")
    // wins. A calendar's event: the Calendar page at that day.
    function viewOf(path) {
      try {
        var views = window.hkShell.dashboardConfig().views;
        for (var i = 0; i < views.length; i++) if (views[i].path === path) return views[i];
      } catch (e) { /* no dashboard */ }
      return null;
    }
    function areaOf(h, id) {
      var e = h && h.entities && h.entities[id];
      if (!e) return null;
      return e.area_id || (e.device_id && h.devices && h.devices[e.device_id] ? h.devices[e.device_id].area_id : null);
    }
    // (a door or window goes to Security where there is no Doors & Windows
    // page: the two are one page in a house with an alarm, 2026-10-16)
    var GO_PAGES = [['doors-windows', ['doors', 'windows']], ['security', ['security', 'locks', 'garage', 'doors', 'windows']],
                    ['water', ['leaks', 'valves']], ['lights', ['lights', 'outlets']]];
    var GO_DOMAINS = { vacuum: 'vacuums', camera: 'cameras', calendar: 'calendar', timer: 'timers' };
    function ymdOf(d) {
      return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }
    function goFor(h, n) {
      if (!n || n.go === 'none' || n.kind === 'people') return null;
      var dash = '/' + (String(location.pathname).split('/')[1] || '') + '/';
      var at_ = function (path, q) {
        var v = viewOf(path);
        return v ? { path: dash + path + (q || ''), title: v.title || path, icon: v.icon || 'mdi:arrow-right' } : null;
      };
      if (n.go) return at_(n.go);
      var id = n.entity || n.sheet;
      if (n.kind === 'calendar' || domainOf(id) === 'calendar') {
        var st = n.event && n.event.start ? new Date(String(n.event.start).length <= 10 ? n.event.start + 'T00:00:00' : n.event.start) : null;
        return at_('calendar', st && !isNaN(st) ? '?day=' + ymdOf(st) : '');
      }
      var S = window.hkStrategy, got = null;
      if (S && S.pageMembers && id) {
        GO_PAGES.some(function (g) {
          var m = null;
          try { m = S.pageMembers(h, g[0]); } catch (e) { m = null; }
          if (m && g[1].some(function (k) { return (m[k] || []).indexOf(id) >= 0; })) got = at_(g[0]);
          return !!got;
        });
      }
      if (!got && GO_DOMAINS[domainOf(id)]) got = at_(GO_DOMAINS[domainOf(id)]);
      if (!got && n.sheet && domainOf(n.sheet) === 'camera') got = at_('cameras');
      if (!got) {
        var M = window.hkCards && window.hkCards.menu, area = areaOf(h, id);
        var rp = M && area && M.roomPath ? M.roomPath(area) : null;
        var seg = rp ? rp.split('/').pop() : null;
        var v = seg ? viewOf(seg) : null;
        if (rp && v) got = { path: rp, title: v.title || (h.areas && h.areas[area] && h.areas[area].name) || seg, icon: v.icon || 'mdi:sofa' };
      }
      return got;
    }
    function noteClock(t) {
      try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
    }
    // "now · 8:42 PM", "5 min ago · 8:37 PM"
    function noteWhen(n) {
      var t = n.ts ? n.ts * 1000 : n._at;
      if (!t || isNaN(t)) return '';
      var m = Math.floor((Date.now() - t) / 60000);
      var rel = m < 1 ? 'now' : m < 60 ? m + ' min ago' : '';
      return (rel ? rel + ' · ' : '') + noteClock(t);
    }
    function muteLabel(until) { return until ? 'Muted until ' + noteClock(until * 1000) : 'Mute 1 Hour'; }
    // note: { n: the notification, snap: its picture's signed URL or null }
    // mode: col | card | over | under
    function noteEl(h, note, mode) {
      var n = note.n || {}, go = goFor(h, n), el = document.createElement('div');
      var icon = '<hk-icon icon="' + esc(n.icon || 'hk:bell') + '"></hk-icon>';
      var b = function (cls, ic, text, chev) {
        return '<button class="hkn-b ' + cls + '">' + (ic ? '<hk-icon icon="' + esc(ic) + '"></hk-icon>' : '') +
          '<span>' + esc(text) + '</span>' + (chev ? '<span class="chev">›</span>' : '') + '</button>';
      };
      var acts = (go ? b('go', go.icon, go.title, true) : '') +
                 (n.mute ? b('mute' + (note.until ? ' on' : ''), 'mdi:bell-off-outline', muteLabel(note.until)) : '');
      var when = noteWhen(n);
      if (mode === 'col') {
        el.className = 'hkn-col';
        el.innerHTML = (note.snap ? '<img class="pic" alt="" src="' + esc(note.snap) + '">'
                                  : '<div class="hero" style="background:' + esc(n.tint || '#8e8e93') + '">' + icon + '</div>') +
          (n.important ? '<div class="imp">Important</div>' : '') +
          '<div class="what">' + esc(n.title || '') + '</div>' +
          (n.message ? '<div class="msg">' + esc(n.message) + '</div>' : '') +
          (when ? '<div class="when">' + esc(when) + '</div>' : '') +
          (acts ? '<div class="acts">' + acts + '</div>' : '');
      } else {
        el.className = 'hkn-card' + (mode === 'over' ? ' over' : mode === 'under' ? ' under' : '');
        el.innerHTML = '<div class="r1"><div class="ni" style="background:' + esc(n.tint || '#8e8e93') + '">' + icon + '</div>' +
          '<div class="nt"><div class="n1">' + esc(n.title || '') + '</div><div class="n2">' +
          (n.important ? '<span class="imp">Important · </span>' : '') + esc([n.message, when].filter(Boolean).join(' · ')) + '</div></div>' +
          (note.snap && mode !== 'over' ? '<img alt="" src="' + esc(note.snap) + '">' : '') + '</div>' +
          (acts ? '<div class="r2">' + acts + '</div>' : '');
      }
      el.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button, img') : null;
        if (!t) return;
        e.stopPropagation();
        if (t.classList.contains('go')) { navigateFrom(go.path); return; }
        if (t.classList.contains('mute')) {
          var act = C.actions(C.client() || h);
          if (!act || t.disabled) return;
          t.disabled = true;
          act.callWS({ type: 'hk_notify/mute', key: n.mute, minutes: note.until ? 0 : 60 }).then(function (r) {
            note.until = r && r.until ? r.until : null;
            t.classList.toggle('on', !!note.until);
            t.querySelector('span').textContent = muteLabel(note.until);
          }, function () { /* not muted: the button says so */ }).then(function () { t.disabled = false; });
          return;
        }
        // the picture: the camera, live -- and back
        if (t.tagName === 'IMG' && n.camera && n.camera !== D.id) open(n.camera, null, { note: note, back: D.back0 });
      });
      return el;
    }
    // where the notification goes in an open sheet (see NOTE_CSS)
    function placeNote(h, el, sheet, panel, note, width) {
      var body = sheet.querySelector('.body');
      var phone = matchMedia('(max-width:' + C.BP.phone + 'px)').matches;
      if (panel.hkBare && panel.hkBare()) {
        if (phone) sheet.appendChild(noteEl(h, note, 'under'));
        else sheet.appendChild(noteEl(h, note, 'over'));
        return;
      }
      if (phone || width >= WIDE) {
        var card = noteEl(h, note, 'card');
        if (!phone && panel.hkNote) panel.hkNote(card);
        else { body.insertBefore(card, body.firstChild); body.style.justifyContent = 'flex-start'; }
        return;
      }
      sheet.style.setProperty('--hkd-w', WIDE + 'px');
      body.classList.add('n2');
      body.insertBefore(noteEl(h, note, 'col'), body.firstChild);
    }

    // OUR HISTORY ENTRY CARRIES A TOKEN, and only an entry with THIS sheet's
    // token is ours to go back from. "Any hkDetail state" is not enough: a
    // pop-up that opens while the sheet is up (the #media bar when Play is
    // pressed in a speaker's sheet) pushes its entry with a copy of ours, the
    // X would then go back off the pop-up's entry, and hk-popup would read
    // that as a hand close -- a dismissal.
    var TOK = 0;
    function ours(d) {
      return !!(d && d.tok && history.state && history.state.hkTok === d.tok);
    }

    // ============================================================ ACCESSORY
    // SETTINGS: the Home app's per-accessory settings, behind a gear in the
    // sheet's header -- for admins only, since a wall tablet's user must not
    // rename the home. Everything is saved as it is changed (accessories.py;
    // the room is Home Assistant's own area) and reaches every screen: a
    // generated dashboard redraws within ten seconds.
    //
    //   Name        the tile's and the sheet's name, the home's (or, with
    //               "Only on this dashboard", this one's)
    //   Room        Home Assistant's area for it
    //   Show As     a switch drawn and counted as a light, a fan, an outlet
    //   Size        its tile regular or tall, over its kind's own
    //   Spinning    a fan's tile glyph turning while it is on, or still
    //   Icon        the glyph
    //   Where It Shows      Show in HK Frontend, then each place it can be
    //                       hidden from -- Home, its room's page, the pages
    //                       and chips of its kinds (hiding.py; the same
    //                       switches as HK Settings -> Hidden Accessories)
    //   Favorite on this dashboard
    var ACC_CSS = [
      '.hkd .gear{width:44px;height:44px;border-radius:22px;border:0;padding:0;flex-shrink:0;',
      '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
      '  background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.92);--mdc-icon-size:20px}',
      '.hkd .gear:active{background:rgba(255,255,255,0.26)}',
      // a phone's header row is 40 px, as are its well and X (SHEET_CSS)
      '@media (max-width:' + C.BP.phone + 'px){.hkd .gear{width:40px;height:40px;border-radius:20px}}',
      '.hkd .gear[hidden]{display:none}',
      '.hkd .body > .acc{margin-block:0}',
      '.acc{display:flex;flex-direction:column;gap:20px;padding-bottom:6px;font-size:16px}',
      // colours are variables with the sheet's (dark) values as defaults, so
      // the settings page can draw the same pane in its own light or dark
      '.acc .cap{font-size:13px;font-weight:600;letter-spacing:.3px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');',
      '  text-transform:uppercase;padding:0 6px 6px}',
      '.acc .grp{background:var(--acc-cell,rgba(255,255,255,0.08));border-radius:14px;overflow:hidden}',
      '.acc .row{display:flex;align-items:center;justify-content:space-between;gap:14px;',
      '  min-height:50px;padding:0 16px;box-sizing:border-box}',
      // the line between two rows starts at their text, as iOS draws it
      '.acc .row + .row{background:linear-gradient(var(--acc-sep,rgba(255,255,255,0.09)),var(--acc-sep,rgba(255,255,255,0.09)))',
      '  16px 0/calc(100% - 16px) 1px no-repeat}',
      '.acc .row .k{flex-shrink:0;color:var(--acc-label,' + window.hkCards.v('ink') + ')}',
      // a place's line under its name (Where it shows): what that place covers
      '.acc .row .k small{display:block;font-size:13px;line-height:17px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');margin-top:1px}',
      '.acc .row .k small[hidden]{display:none}',
      '.acc .row.place .k,.acc .row.wall .k{flex-shrink:1;min-width:0;padding:9px 0}',
      '.acc .row.dim .k{opacity:.45}',
      '.acc .tg:disabled{opacity:.45;cursor:default}',
      '.acc .note a{color:var(--acc-focus,#0a84ff);text-decoration:none}',
      '.acc input.nm{flex:1;min-width:0;background:transparent;border:0;color:var(--acc-text,' + window.hkCards.v('ink') + ');font:inherit;',
      '  text-align:right;outline:none;padding:0;text-overflow:ellipsis}',
      // the whole row's height is the field's target, not its 21 px of text
      '.acc .row input.nm,.acc .row select{align-self:stretch;min-height:44px}',
      '.acc input.nm::placeholder{color:var(--acc-label3,' + window.hkCards.v('ink-3') + ')}',
      '.acc select{min-width:0;max-width:60%;background:transparent;color:var(--acc-value,' + window.hkCards.v('ink-2') + ');border:0;',
      '  font:inherit;text-align:right;outline:none;-webkit-appearance:none;appearance:none;cursor:pointer}',
      '.acc select option{color:#000}',
      '.acc .tg{-webkit-appearance:none;appearance:none;width:51px;height:31px;border-radius:16px;margin:0;',
      '  background:var(--acc-fill,rgba(255,255,255,0.18));position:relative;cursor:pointer;flex-shrink:0;transition:background .2s}',
      '.acc .tg::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;',
      '  background:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);transition:transform .2s}',
      '.acc .tg:checked{background:var(--acc-green,#34c759)}',
      '.acc .tg:checked::after{transform:translateX(20px)}',
      '.acc .seg{display:flex;gap:2px;background:var(--acc-seg,rgba(255,255,255,0.08));border-radius:10px;padding:2px;margin:10px 12px}',
      // each choice as wide as its word, the rest shared out: equal fifths
      // left "Automatic" (bold when chosen) spilling into "Light" on a phone
      '.acc .seg button{flex:1 1 auto;min-width:0;padding:0 6px;height:32px;border:0;border-radius:8px;background:transparent;',
      '  color:var(--acc-text,' + window.hkCards.v('ink') + ');font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}',
      '.acc .seg button.on{background:var(--acc-seg-on,rgba(255,255,255,0.24));font-weight:600}',
      '.acc .glyphs{display:grid;grid-template-columns:repeat(auto-fill,46px);justify-content:center;gap:8px;padding:12px}',
      '.acc .glyphs button{width:46px;height:46px;border-radius:23px;border:0;cursor:pointer;justify-self:center;',
      '  background:var(--acc-glyph,rgba(255,255,255,0.10));color:var(--acc-text,#fff);--mdc-icon-size:23px;display:flex;',
      '  align-items:center;justify-content:center;font:inherit;font-size:11px}',
      '.acc .glyphs button.on{background:var(--acc-glyph-on-bg,rgba(255,255,255,0.92));color:var(--acc-glyph-on-fg,#000)}',
      '.acc .swatches{display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px}',
      '.acc .swatches button{width:32px;height:32px;border-radius:16px;border:2px solid transparent;cursor:pointer;',
      '  font:inherit;font-size:10px;color:var(--acc-text,' + window.hkCards.v('ink') + ');background:var(--acc-glyph,rgba(255,255,255,0.12))}',
      '.acc .swatches button.on{border-color:var(--acc-text,#fff);box-shadow:0 0 0 2px rgba(0,0,0,0.4) inset}',
      '.acc .swatches button:first-child{width:auto;padding:0 10px}',
      '.acc .glyphs.fvg{border-top:1px solid var(--acc-sep,rgba(255,255,255,0.09))}',
      // ARRANGE: Move Left / Move Right, over a small copy of the tiles it
      // moves among, laid out as the dashboard lays them out
      '.acc .arrb{display:flex;gap:8px;padding:10px 12px 0}',
      '.acc .arrb button,.acc .edpg{flex:1;height:40px;border:0;border-radius:10px;background:var(--acc-glyph,rgba(255,255,255,0.12));',
      '  color:var(--acc-text,#fff);font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;',
      '  justify-content:center;gap:6px;--mdc-icon-size:18px}',
      '.acc .arrb button:disabled{opacity:.35;cursor:default}',
      '.acc .arrb button:not(:disabled):active,.acc .edpg:active{background:var(--acc-seg-on,rgba(255,255,255,0.24))}',
      // EDIT THIS PAGE: Arrange's button (above), the whole group's width
      '.acc .edpg{width:calc(100% - 24px);margin:10px 12px}',
      '.acc .mini{display:grid;grid-auto-flow:dense;grid-auto-rows:30px;gap:5px;padding:12px}',
      '.acc .mini .mt{display:flex;align-items:center;gap:5px;min-width:0;border-radius:9px;padding:0 7px;',
      '  background:var(--acc-glyph,rgba(255,255,255,0.10));color:var(--acc-label2,rgba(255,255,255,0.7));font-size:11px;',
      '  --mdc-icon-size:14px;transition:background .2s,color .2s}',
      '.acc .mini .mt.tall{grid-row:span 2;flex-direction:column;align-items:flex-start;justify-content:space-between;padding:7px}',
      '.acc .mini .mt span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      // a tall tile stacks its name under the glyph: a column's item is as
      // wide as its text unless held to the tile, and a long name ran over
      // the next tile instead of ending in an ellipsis
      // ...and at the foot of the tile with or without a glyph above it (a
      // water heater has none: alone, space-between put its name at the top)
      '.acc .mini .mt.tall span{max-width:100%;margin-top:auto}',
      '.acc .mini .mt.on{background:var(--acc-glyph-on-bg,rgba(255,255,255,0.92));color:var(--acc-glyph-on-fg,#000);font-weight:600}',
      '.acc .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
      // SEARCH EVERY ICON: the Apple glyphs, then Home Assistant's Material ones
      '.acc .gsearch{display:block;padding:12px 12px 0}',
      '.acc .gsearch input{width:100%;box-sizing:border-box;height:36px;border:0;border-radius:10px;padding:0 12px;',
      '  background:var(--acc-glyph,rgba(255,255,255,0.10));color:var(--acc-text,' + window.hkCards.v('ink') + ');font:inherit;font-size:15px;outline:none}',
      '.acc .gsearch input::placeholder{color:var(--acc-label3,' + window.hkCards.v('ink-3') + ')}',
      '.acc .gsearch.fvs{border-top:1px solid var(--acc-sep,rgba(255,255,255,0.09))}',
      '.acc .glyphs .gh{grid-column:1/-1;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;',
      '  color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:4px 2px 0}',
      '.acc .glyphs .gn{grid-column:1/-1;font-size:13px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:0 2px}',
      '.acc .with{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 12px}',
      '.acc .with[hidden]{display:none}',
      '.acc .with button{height:32px;border-radius:16px;border:0;background:var(--acc-glyph,rgba(255,255,255,0.14));color:var(--acc-text,' + window.hkCards.v('ink') + ');',
      '  font:inherit;font-size:14px;padding:0 12px;cursor:pointer}',
      '.acc .reset{height:50px;border:0;border-radius:14px;background:var(--acc-cell,rgba(255,255,255,0.08));',
      '  color:var(--acc-red,#ff453a);font:inherit;cursor:pointer;width:100%}',
      // Reset asks first, in place (an alert over a sheet would stack two sheets)
      '.acc .sure{display:flex;flex-direction:column;gap:8px}',
      '.acc .sure[hidden]{display:none}',
      '.acc .sure .q{font-size:13px;line-height:18px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:0 6px;text-align:center}',
      '.acc .sure .b{display:flex;gap:8px}',
      '.acc .sure button{flex:1;height:44px;border:0;border-radius:12px;font:inherit;cursor:pointer;',
      '  background:var(--acc-cell,rgba(255,255,255,0.08));color:var(--acc-text,' + window.hkCards.v('ink') + ')}',
      '.acc .sure button.go{color:var(--acc-red,#ff453a);font-weight:600}',
      '.acc .note{font-size:13px;line-height:18px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:0 6px}',
      // a footer under its group, a little apart from it, as iOS sets one
      '.acc .grp + .note{margin-top:6px}',
      '.acc .err{color:var(--acc-orange,#ff9f0a)}',
      '.acc .sec[hidden],.acc .row[hidden]{display:none}',
      '.acc a.row{color:inherit;text-decoration:none}.acc a.row svg{opacity:.45}',
      '.acc .tg:focus-visible,.acc button:focus-visible,.acc select:focus-visible,.acc input:focus-visible{outline:2px solid var(--acc-focus,#0a84ff);outline-offset:2px}'
    ].join('');

    // The glyphs a kind of thing is offered, the Home app's vocabulary first
    // -- Apple's Home symbols for that kind (2026-10-01: every one the glyph
    // file has), then the house's own favorites. Anything else is a search
    // away (glyphSearch): every hk: glyph, and Home Assistant's Material
    // Design icons.
    var GLYPHS = {
      light: ['lightbulb', 'lightbulb-group', 'lightbulb-multiple', 'lightbulb-variant', 'lightbulb-on', 'lightbulb-night',
              'ceiling-light', 'ceiling-light-multiple', 'chandelier', 'ceiling-fan-light', 'lamp', 'floor-lamp', 'desk-lamp',
              'wall-sconce', 'wall-sconce-flat', 'vanity-light', 'light-recessed', 'lightbulb-spot', 'light-flood-down',
              'lightbulb-fluorescent-tube', 'outdoor-lamp', 'coach-lamp', 'string-lights', 'led-strip-variant',
              'light-switch', 'christmas-tree', 'pine-tree', 'motion-sensor', 'sword', 'fire'],
      outlet: ['power-socket-us', 'power-strip', 'power-plug', 'toggle-switch', 'light-switch', 'remote',
               'gesture-tap-button', 'coffee', 'lamp', 'string-lights', 'christmas-tree', 'fire', 'fireplace',
               'fan', 'fan-desk', 'fan-floor', 'air-purifier', 'radiator', 'television', 'monitor', 'projector',
               'audio-video', 'desktop-tower', 'laptop', 'server', 'server-network', 'router-wireless', 'printer',
               'printer-3d', 'amplifier', 'gamepad-variant', 'run-fast', 'washing-machine', 'tumble-dryer',
               'dishwasher', 'fridge', 'microwave', 'toaster-oven', 'stove', 'pot-steam', 'pot', 'popcorn',
               'water-boiler', 'sprinkler-variant', 'sprinkler', 'pool', 'faucet', 'scent', 'guitar-acoustic',
               'teddy-bear', 'party-popper', 'bell', 'clock', 'ev-plug-tesla', 'ev-station', 'power-plug-battery-outline'],
      fan: ['fan', 'ceiling-fan', 'ceiling-fan-light', 'fan-desk', 'fan-floor', 'air-purifier', 'air-conditioner',
            'hvac', 'air-humidifier', 'dehumidifier', 'radiator', 'fireplace', 'heat-wave', 'snowflake'],
      climate: ['thermostat', 'home-thermometer', 'air-conditioner', 'hvac', 'radiator', 'fireplace', 'heat-wave',
                'snowflake', 'fan', 'ceiling-fan', 'air-purifier', 'water-boiler', 'thermometer-water'],
      humidifier: ['air-humidifier', 'air-humidifier-active', 'dehumidifier', 'air-purifier', 'water-percent', 'scent'],
      cover: ['blinds-horizontal', 'blinds-vertical', 'blinds-vertical-closed', 'roller-shade', 'roman-shade',
              'roman-shade-open', 'window-shutter', 'window-shutter-open', 'curtains', 'curtains-closed',
              'window-closed-variant', 'window-closed', 'window-open', 'awning', 'skylight', 'garage',
              'garage-variant', 'garage-double', 'gate', 'door-closed', 'door-sliding', 'door-french'],
      // a door or window sensor: each is drawn open and shut (its pair)
      contact: ['door-closed', 'door-sliding', 'door-french', 'window-closed-variant', 'window-closed', 'skylight',
                'garage', 'garage-variant', 'garage-double', 'gate', 'contact-sensor', 'mailbox-up'],
      sensor: ['motion-sensor', 'motion', 'contact-sensor', 'smoke-detector', 'molecule-co', 'molecule-co2',
               'air-filter', 'home-thermometer', 'water-percent', 'water', 'water-alert', 'pipe-leak',
               'lightning-bolt', 'home-battery', 'speedometer', 'doorbell-video', 'bell', 'mailbox-up', 'walk'],
      media_player: ['television', 'apple-tv', 'homepod', 'homepod-mini', 'speaker', 'speaker-multiple',
                     'speaker-play', 'television-speaker', 'audio-video', 'amplifier', 'radio', 'projector',
                     'remote-tv', 'music', 'volume-high', 'monitor', 'laptop', 'cellphone', 'tablet', 'gamepad-variant'],
      lock: ['lock', 'lock-smart', 'door-closed-lock', 'door-french', 'door-sliding', 'gate', 'key-variant', 'garage',
             'garage-double', 'shield-lock'],
      camera: ['camera', 'webcam', 'doorbell-video', 'motion'],
      alarm_control_panel: ['shield-home', 'shield-lock', 'alarm-light', 'alarm-light-off', 'bell', 'motion-sensor'],
      vacuum: ['robot-vacuum'],
      valve: ['spigot', 'sprinkler', 'sprinkler-variant', 'water', 'pipe-leak', 'faucet', 'shower', 'bathtub',
              'pool', 'waves', 'water-boiler'],
      scene: ['home', 'sparkles', 'star-fill', 'weather-night', 'white-balance-sunny', 'weather-sunset-up', 'bed',
              'sofa', 'seat', 'silverware-fork-knife', 'television', 'music', 'party-popper', 'balloon', 'walk',
              'location-enter', 'bag-suitcase', 'car', 'sleep', 'lightbulb', 'fire', 'christmas-tree', 'shield-home'],
      other: ['home', 'star-fill', 'sparkles', 'toggle-switch', 'power-socket-us', 'lightbulb', 'fan',
              'thermometer-water', 'water', 'timer-sand', 'clock', 'alarm', 'bell', 'bed', 'sofa', 'seat', 'dresser',
              'desk', 'table-furniture', 'bookshelf', 'stairs', 'bathtub', 'shower', 'toilet', 'hanger', 'shield-home',
              'car', 'ev-station', 'paw', 'flower', 'pine-tree', 'party-popper', 'balloon', 'trash-can', 'package-variant',
              'wifi', 'cellphone', 'tablet', 'watch', 'laptop', 'wrench']
    };
    GLYPHS.water_heater = GLYPHS.climate;
    GLYPHS.binary_sensor = GLYPHS.sensor;
    GLYPHS.script = GLYPHS.scene;
    GLYPHS.input_button = GLYPHS.button = GLYPHS.outlet;
    function glyphsFor(id, show) {
      var d = domainOf(id);
      if (show === 'light') return GLYPHS.light;
      if (show === 'fan') return GLYPHS.fan;
      if (show === 'switch' || show === 'outlet') return GLYPHS.outlet;
      if (d === 'switch' || d === 'input_boolean') return GLYPHS.outlet;
      if (d === 'binary_sensor') {
        var dc = at(stOf(C.client(), id), 'device_class');
        if (/^(door|window|garage_door|opening)$/.test(String(dc || ''))) return GLYPHS.contact;
      }
      return GLYPHS[d] || GLYPHS.other;
    }
    // SEARCH EVERY ICON: the hk: glyphs (the house's glyph file, else the
    // names the lists above use), then Home Assistant's own Material Design
    // icons, read from its icon list with their keywords (/static/mdi/
    // iconList.json -- the file its own icon picker reads), less those with
    // an hk: twin of the same name (one is drawn as the other: an mdi: icon
    // is drawn from the hk set where it has one). [{v, icon, mdi}] matching
    // every word, at most MAX of the Material ones.
    var MDI_LIST = null;
    function mdiList() {
      if (!MDI_LIST) {
        MDI_LIST = (typeof fetch === 'function' ? fetch('/static/mdi/iconList.json')
          .then(function (r) { return r.ok ? r.json() : []; }) : Promise.resolve([]))
          .catch(function () { return []; })
          .then(function (l) { return Array.isArray(l) ? l : []; });
      }
      return MDI_LIST;
    }
    function hkNames() {
      var g = window.hkGlyphs && window.hkGlyphs.icons, seen = {}, out = [];
      var add = function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } };
      Object.keys(g || {}).forEach(add);
      Object.keys(GLYPHS).forEach(function (k) { GLYPHS[k].forEach(add); });
      return out.sort();
    }
    function glyphSearch(q, list) {
      var words = String(q || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
      var hit = function (t) { return words.every(function (w) { return t.indexOf(w) >= 0; }); };
      var names = hkNames(), have = {};
      names.forEach(function (n) { have[n] = 1; });
      var hk = names.filter(function (n) { return hit(n.replace(/-/g, ' ')); })
        .map(function (n) { return { v: 'hk:' + n, icon: 'hk:' + n }; });
      var mdi = (list || []).filter(function (it) {
        return it && it.name && !have[it.name] && hit(it.name.replace(/-/g, ' ') + ' ' + (it.keywords || []).join(' ').toLowerCase());
      });
      // BY ITS NAME FIRST: an icon whose name has the words ("fan-off") before
      // one found only by a keyword that happens to begin with them (a unicorn,
      // "fantasy") -- in Home Assistant's order within each
      var byName = function (it) { return hit(it.name.replace(/-/g, ' ')) ? 0 : 1; };
      mdi = mdi.map(function (it, i) { return [byName(it), i, it]; })
        .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; });
      return { hk: hk, mdi: mdi.map(function (it) { return { v: 'mdi:' + it.name, icon: 'mdi:' + it.name, mdi: true }; }) };
    }
    var SEARCH_MAX = 120;

    // ARRANGE (2026-10-01): a tile moved left or right among the tiles it
    // sits with -- read off the page, from the tile the sheet opened from.
    // The generated dashboard says where each tile lives (hk-strategy.js
    // hk_place): a room's section on Home, a group on a room page, or the
    // Favorites. What moves is the tile's place in the room's Tile Order
    // (accessories `rooms`, every screen) or this screen's favorites; what
    // is NOT on show there (a tile off Home, another group's) keeps its
    // place. Left and right are reading order: the end of a row wraps.
    var GROUP_WORDS = { Climate: 'climate accessories', Lights: 'lights', 'Speakers & TVs': 'speakers and TVs',
                        Security: 'security accessories', Water: 'water accessories', Other: 'other accessories' };
    function arrangeOf(h, id, tile) {
      var cfg = tile && tile._config, place = cfg && cfg.hk_place;
      var root = tile && tile.parentNode;
      // (a category page's tile -- its place has a `page` -- is Edit mode's
      // to arrange, not the sheet's)
      if (!place || place.page || !root || !root.children) return null;
      var kids = [].filter.call(root.children, function (k) { return k._config && k._config.entity; });
      var visible = kids.map(function (k) { return k._config.entity; });
      if (visible.length < 2 || visible.indexOf(id) < 0) return null;
      var look = {};
      kids.forEach(function (k) {
        var c = k._config, vl = c.view_layout || {};
        look[c.entity] = { name: c.name || at(stOf(h, c.entity), 'friendly_name') || c.entity, icon: c.icon || '',
                           tall: c.size === 'tall' || /span\s*2/.test(String(vl['grid-row'] || '')) };
      });
      var cols = 0;
      try { cols = String(getComputedStyle(root).gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean).length; }
      catch (e) { /* no layout (a test) */ }
      cols = Math.max(1, Math.min(6, cols || 4));
      if (place.fav) {
        var dash = dashNow(), b = (((window.hkSettings && window.hkSettings.get('boards', null)) || {})[dash]) || {};
        var favs = (b.favorites || []).slice();
        visible.forEach(function (x) { if (favs.indexOf(x) < 0) favs.push(x); });
        return { fav: true, dash: dash, visible: visible, full: favs, look: look, cols: cols,
                 note: 'Moves it among the Favorites on this screen.' };
      }
      var area = place.area, areas = h.areas || {};
      if (!area || !areas[area]) return null;
      var full = [];
      try {
        var HS = window.hkSettings, G = (HS && HS.get('generated', null)) || {};
        var r = window.hkStrategy && window.hkStrategy.rooms
          ? window.hkStrategy.rooms(h, { areas: [area], include_entities: G.include_entities || [] }) : [];
        full = (r[0] && r[0].entities) ? r[0].entities.slice() : [];
      } catch (e) { full = []; }
      visible.forEach(function (x) { if (full.indexOf(x) < 0) full.push(x); });
      var room = areas[area].name;
      return { area: area, visible: visible, full: full, look: look, cols: cols,
               note: place.group ? 'Moves it among the ' + (GROUP_WORDS[place.group] || 'accessories') + ' in the ' + room + '.'
                                 : 'Moves it among the tiles in the ' + room + '.' };
    }
    // one step left (-1) or right (1): the new visible order, and the whole
    // list it is saved as -- the visible tiles take the places they held, in
    // their new order; the others stay where they were. null at an end.
    function arrangeMove(visible, full, id, dir) {
      var i = visible.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= visible.length) return null;
      var v = visible.slice(); v[i] = v[j]; v[j] = id;
      var out = full.slice(), n = 0;
      out.forEach(function (x, k) { if (visible.indexOf(x) >= 0) out[k] = v[n++]; });
      return { visible: v, full: out };
    }
    function accessoriesNow() {
      var HS = window.hkSettings;
      return (HS && HS.get('accessories', null)) || { entities: {}, rooms: {} };
    }
    function accOf(id) { return (accessoriesNow().entities || {})[id] || {}; }
    function dashNow() { try { return String(location.pathname).split('/')[1] || ''; } catch (e) { return ''; } }
    // THE ACCESSORY'S NAME for the sheet's title: this dashboard's, else the
    // home's (null: none set).
    function accName(id) {
      var a = accOf(id), dash = dashNow();
      return (a.names && a.names[dash]) || a.name || null;
    }
    function accIcon(id) {
      var v = String(accOf(id).icon || '');
      return v ? (/^mdi:/.test(v) ? 'hk:' + v.slice(4) : v) : null;
    }
    function canEdit(h) { return !!(h && h.user && h.user.is_admin); }
    // Is this dashboard a generated one (custom:hk-dashboard)? Only those
    // draw favorites, so only there is "Favorite on this dashboard" offered.
    function generatedHere() {
      try {
        var panel = window.hkShell.panel();
        var raw = panel && panel.lovelace && panel.lovelace.rawConfig;
        return !!(raw && raw.strategy && /hk-dashboard$/.test(String(raw.strategy.type || '')));
      } catch (e) { return false; }
    }

    // opts.panel: drawn on the settings page, which is no dashboard -- no
    // "Only on this dashboard", no "Favorite on this dashboard".
    // WHERE IT SHOWS, filled in when the server answers: Show in HK Frontend
    // (off: hidden everywhere), then each place this accessory can be hidden
    // from. Hidden with its whole device or room, the switch says so and
    // waits for that to change (Hidden Accessories).
    function wherePane(h, el, id, area, opts, fail) {
      var grp = el.querySelector('.sec.where .grp'), wall = el.querySelector('.row.wall');
      var shown = wall.querySelector('.tg.shown'), why = wall.querySelector('.wwhy');
      var rows = [];
      var paint = function (snap) {
        rows.forEach(function (r) { r.remove(); });
        rows = [];
        var e = (h.entities || {})[id] || {};
        var dev = e.device_id && (snap.devices || []).indexOf(e.device_id) >= 0 ? (h.devices || {})[e.device_id] : null;
        var room = area && (snap.areas || []).indexOf(area) >= 0 ? area : null;
        var every = (snap.everywhere || []).indexOf(id) >= 0;
        var off = (snap.off || {})[id] || [], can = (snap.can || {})[id] || [];
        var locked = !!(dev || room);
        shown.disabled = locked;
        shown.checked = !every && !locked;
        why.hidden = !locked;
        why.textContent = dev ? 'Hidden with its device, ' + (dev.name_by_user || dev.name || 'this device')
          : room ? 'Hidden with its room, ' + (((h.areas || {})[room] || {}).name || room) : '';
        var after = wall;
        can.forEach(function (k) {
          var p = (snap.places || {})[k] || [k, ''];
          var name = k === 'room' ? ((((h.areas || {})[area] || {}).name || 'Its') + ' Room Page') : p[0];
          var r = document.createElement('div');
          r.className = 'row place' + (every || locked ? ' dim' : '');
          r.innerHTML = '<span class="k">' + esc(name) + '<small>' + esc(p[1]) + '</small></span>' +
            '<input class="tg" type="checkbox" role="switch">';
          var tg = r.querySelector('.tg');
          tg.setAttribute('aria-label', 'Show on ' + name);
          tg.dataset.k = k;
          tg.checked = off.indexOf(k) < 0;
          tg.disabled = every || locked;
          tg.addEventListener('change', function () { send(false); });
          after.insertAdjacentElement('afterend', r);
          after = r;
          rows.push(r);
        });
        // ALSO COUNT AS: on = counted there (added); what it could be added to, off
        var also = el.querySelector('.sec.also'), ag = also && also.querySelector('.grp');
        if (!ag) return;
        var added = (snap.added || {})[id] || [];
        var ks = (snap.order || []).filter(function (k) { return added.indexOf(k) >= 0 || ((snap.also || {})[id] || []).indexOf(k) >= 0; });
        also.hidden = !ks.length;
        ag.innerHTML = '';
        ks.forEach(function (k) {
          var p = (snap.places || {})[k] || [k, ''];
          var r = document.createElement('div');
          r.className = 'row place';
          r.innerHTML = '<span class="k">' + esc(p[0]) + '<small>' + esc(p[1]) + '</small></span><input class="tg" type="checkbox" role="switch">';
          var tg = r.querySelector('.tg');
          tg.setAttribute('aria-label', 'Also count as ' + p[0]);
          tg.checked = added.indexOf(k) >= 0;
          tg.addEventListener('change', function () {
            var kinds = {};
            kinds[k] = tg.checked;
            if (!opts.panel && window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
            h.actions.callWS({ type: 'hk_frontend/hidden/also', entity_ids: [id], kinds: kinds })
              .then(function (s2) { paint(s2); if (opts.onSave) opts.onSave(true); },
                    function (err) { fail(err); if (opts.onSave) opts.onSave(false); });
          });
          ag.appendChild(r);
        });
      };
      var send = function (everywhere) {
        var places = {};
        rows.forEach(function (r) { var tg = r.querySelector('.tg'); if (!tg.checked) places[tg.dataset.k] = true; });
        if (!opts.panel && window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
        return h.actions.callWS({ type: 'hk_frontend/hidden/set', entity_ids: [id], everywhere: everywhere, places: everywhere ? {} : places })
          .then(function (snap) { paint(snap); if (opts.onSave) opts.onSave(true); },
                function (err) { fail(err); if (opts.onSave) opts.onSave(false); });
      };
      shown.addEventListener('change', function () { send(!shown.checked); });
      h.callWS({ type: 'hk_frontend/hidden/get', entity_ids: [id] }).then(paint, function () {
        why.hidden = false;
        why.textContent = 'Couldn’t read where it shows.';
      });
    }

    function accessoryPane(h, id, onName, opts) {
      opts = opts || {};
      // A client; the settings page (slice 11) still hands its host input,
      // which the host adapter turns into one. Its saves go through the
      // client's action port, its reads through the client.
      h = asClient(h);
      var el = document.createElement('div');
      el.className = 'acc';
      // ITS OWN COPY: the pane writes what was just chosen into `cur` as it
      // saves (cur.icon = ...), and accOf() hands back the live settings'
      // own object -- written there, the settings feed's answer looked like
      // no change, so no screen redrew until a reload (2026-10-01)
      var cur = JSON.parse(JSON.stringify(accOf(id))), dash = dashNow();
      var d = domainOf(id);
      var s = stOf(h, id);
      var HS = window.hkSettings;
      var boards = (HS && HS.get('boards', null)) || {};
      // opts.generated: said by the caller (tests); else read off the page
      var gen = opts.generated !== undefined ? !!opts.generated : generatedHere();
      var board = opts.panel || !gen ? null : boards[dash];
      // WHAT IS RELEVANT: "As a favorite" for something that is a favorite
      // somewhere, "As a chip" for a chip -- or for anything that already has
      // those set, so nothing set hides. Its Color is for everything.
      var anyBoard = function (key) {
        return Object.keys(boards).some(function (p) { return ((boards[p] || {})[key] || []).indexOf(id) >= 0; });
      };
      var isChip = anyBoard('chips_extra');
      var favShown = anyBoard('favorites') || !!(cur.fav_name || cur.fav_icon || cur.fav_room || (cur.fav_with && cur.fav_with.length));
      var chipRows = isChip || !!(cur.when || cur.attribute || cur.label);
      var e = (h.entities || {})[id] || {};
      var devArea = e.device_id && h.devices && h.devices[e.device_id] ? h.devices[e.device_id].area_id : null;
      var area = e.area_id || devArea || '';
      var here = !!(cur.names && cur.names[dash]);
      var errBox = null;

      function fail(err) {
        if (!errBox) return;
        errBox.textContent = 'Not saved: ' + ((err && err.message) || err || 'unknown error');
        errBox.hidden = false;
      }
      function save(changes) {
        if (errBox) errBox.hidden = true;
        // changed on a dashboard's own sheet: that screen shows it as soon as
        // the sheet closes (hk-strategy.js ownChange)
        if (!opts.panel && window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
        return h.actions.callWS(Object.assign({ type: 'hk_frontend/accessory/set', entity_id: id }, changes)).then(function (r) {
          if (opts.onSave) opts.onSave(true);
          return r;
        }, function (e) { fail(e); if (opts.onSave) opts.onSave(false); });
      }

      var html = '';
      html += '<div><div class="cap">Name and room</div><div class="grp">' +
        '<div class="row"><span class="k">Name</span><input class="nm" type="text" maxlength="60" aria-label="Name" ' +
        'autocomplete="off" spellcheck="false"></div>' +
        (opts.panel ? '' : '<div class="row"><span class="k">Only on this dashboard</span><input class="tg here" type="checkbox" role="switch" aria-label="Only on this dashboard"></div>') +
        '<div class="row"><span class="k">Room</span><select class="room" aria-label="Room"></select></div></div></div>';
      var showable = d === 'switch' || d === 'light' || d === 'input_boolean';
      if (showable) {
        html += '<div><div class="cap">Show as</div><div class="grp"><div class="seg show"></div></div></div>';
      }
      // WHAT ITS STATES ARE CALLED: a switch or a helper's
      // "Blocked" / "Allowed" in place of On / Off, on its tiles and favorite
      var named2 = d === 'switch' || d === 'input_boolean';
      if (named2) {
        html += '<div><div class="cap">What it says</div><div class="grp">' +
          '<div class="row"><span class="k">When on</span><input class="nm ontx" type="text" maxlength="30" aria-label="When on, it says" ' +
          'placeholder="On" autocomplete="off" spellcheck="false"></div>' +
          '<div class="row"><span class="k">When off</span><input class="nm offtx" type="text" maxlength="30" aria-label="When off, it says" ' +
          'placeholder="Off" autocomplete="off" spellcheck="false"></div></div></div>';
      }
      // ITS TILE'S HEIGHT on a generated dashboard: a light as a tall tile, a
      // lock as a pill (Automatic: what its kind is drawn as)
      html += '<div><div class="cap">Tile size</div><div class="grp"><div class="seg size"></div></div></div>';
      var arr = opts.tile ? arrangeOf(h, id, opts.tile) : null;
      if (arr) {
        html += '<div class="sec arr"><div class="cap">Arrange</div><div class="grp">' +
          '<div class="arrb"><button class="mvl" aria-label="Move Left"><hk-icon icon="mdi:chevron-left"></hk-icon>Move Left</button>' +
          '<button class="mvr" aria-label="Move Right">Move Right<hk-icon icon="mdi:chevron-right"></hk-icon></button></div>' +
          '<div class="mini" aria-hidden="true"></div><span class="sr" aria-live="polite"></span></div>' +
          '<div class="note">' + esc(arr.note) + '</div></div>';
      }
      // EDIT THIS PAGE (hk-edit.js, Edit mode): the page's pills dragged and
      // sized in place -- the way in on a screen whose menu is off, since a
      // sheet always opens. An Owner or Admin, not at a wall tablet, on a
      // page with something to arrange.
      var editHere = false;
      try { editHere = !opts.panel && !!(window.hkEdit && window.hkEdit.offer && window.hkEdit.offer(h)); } catch (e) { editHere = false; }
      if (editHere) {
        html += '<div class="sec editpg"><div class="cap">This Page</div><div class="grp"><button class="edpg" type="button">' +
          '<hk-icon icon="mdi:pencil"></hk-icon>Edit This Page</button></div>' +
          '<div class="note">Drag the tiles on this page into place, and make them Tall or Regular.</div></div>';
      }
      html += '<div><div class="cap">Icon</div><div class="grp"><label class="gsearch"><input type="search" class="gq" ' +
        'placeholder="Search all icons" aria-label="Search all icons" autocomplete="off" spellcheck="false"></label>' +
        '<div class="glyphs"></div></div></div>';
      // SPIN: for a fan (or what is drawn as one) -- its tile's glyph turns
      // while it is on, and a chosen icon is not always one that reads as
      // spinning. Still: never. Automatic: its kind (a fan spins). Built for
      // anything Show As can make a fan, and shown while it is one.
      // It spins only while Animations are on (Sky / Background: hk-base.js
      // hk-still), so the note says so -- and, on a screen where they are
      // off, that it is standing still for that reason.
      if (d === 'fan' || showable) {
        var animOff = false;
        if (!(opts && opts.panel)) {
          try { animOff = !!(window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false); } catch (e) { animOff = false; }
        }
        html += '<div class="spinrow"' + (d === 'fan' || cur.show_as === 'fan' ? '' : ' hidden') + '>' +
          '<div class="cap">Spinning</div><div class="grp"><div class="seg spin" role="group" aria-label="Spinning"></div></div>' +
          // under its group, as every other note in the pane (Arrange, Energy)
          '<div class="note">Whether its tile’s glyph turns while it is on. It turns only while Animations are on ' +
          '(HK Settings → Sky / Background, for All Screens or each screen).' +
          (animOff ? ' They’re off on this screen, so it stays still.' : '') + '</div></div>';
      }
      // WHERE IT SHOWS (Hidden Accessories, hiding.py): Show in HK Frontend,
      // then a switch for each place it can be hidden from -- asked of the
      // server, which knows its kinds -- and, on a dashboard, Favorite
      html += '<div class="sec where"><div class="cap">Where it shows</div><div class="grp">' +
        '<div class="row wall"><span class="k">Show in ' + window.hkShell.productName() + '<small class="wwhy" hidden></small></span>' +
        '<input class="tg shown" type="checkbox" role="switch" aria-label="Show in ' + window.hkShell.productName() + '" disabled></div>' +
        (board ? '<div class="row"><span class="k">Favorite on this dashboard</span><input class="tg fav" type="checkbox" role="switch" aria-label="Favorite on this dashboard"></div>' : '') +
        '</div><div class="note">' + (opts.panel
          ? 'Anything off here is listed in <a href="#/accessories/hidden">Hidden Accessories</a>, with where.'
          : 'Anything off here is listed in HK Settings → Accessories → Hidden Accessories.') + '</div></div>' +
        // ALSO COUNT AS (Status & Chips' Also count, moved here 2026-10-12):
        // the kinds it isn't found in by itself but could be counted in
        '<div class="sec also" hidden><div class="cap">Also count as</div><div class="grp"></div>' +
        '<div class="note">Counted there too, though it isn’t found there by itself — an outlet you think of as a light, ' +
        'a camera that hears the smoke alarm.</div></div>';
      // ON THE ENERGY PAGE (the Energy feature): a device's own settings
      // there -- its name, its section, shown or not -- and the way to the
      // rest (its power sensor, its switch) on HK Settings
      var enRec = energyRec(id), enPlan = enRec ? energyPlan() : null;
      if (enRec) {
        var enSecs = (enPlan.sections || []);
        var enIn = enSecs.filter(function (x) { return (x.items || []).some(function (i) { return i.key === enRec.key; }); })[0];
        html += '<div class="sec energy"><div class="cap">On the Energy page</div><div class="grp">' +
          '<div class="row"><span class="k">Name there</span><input class="nm enn" type="text" maxlength="40" aria-label="Name on the Energy page" ' +
          'autocomplete="off" spellcheck="false"></div>' +
          '<div class="row"><span class="k">Section</span><select class="ens" aria-label="Section on the Energy page">' +
          (enIn ? '' : '<option value="" selected>Hidden</option>') +
          enSecs.map(function (x) { return '<option value="' + esc(x.id) + '"' + (enIn && enIn.id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="row"><span class="k">Show there</span><input class="tg enh" type="checkbox" role="switch" aria-label="Show on the Energy page"' +
          (enIn ? ' checked' : '') + '></div>' +
          '<a class="row enl" href="/hk-settings#/features/energy/devices/' + encodeURIComponent(enRec.key) + '"><span class="k">More energy settings</span>' + CHEV + '</a>' +
          '</div><div class="note">Its power sensor and its switch are on HK Settings → Features → Energy.</div></div>';
      }
      // AS A FAVORITE: its name and glyph on the favorites row,
      // on every dashboard where it is a favorite, and the lights it controls
      // together with there ("Main + Table Lights")
      var joinable = d === 'light' || d === 'switch' || d === 'input_boolean';
      html += '<div class="sec fav"' + (favShown ? '' : ' hidden') + '><div class="cap">As a favorite</div><div class="grp">' +
        '<div class="row"><span class="k">Name</span><input class="nm fvn" type="text" maxlength="60" aria-label="Name as a favorite" ' +
        'autocomplete="off" spellcheck="false"></div>' +
        // the room line above its name there (a helper with no area)
        '<div class="row"><span class="k">Room</span><input class="nm fvr" type="text" maxlength="40" aria-label="Room line as a favorite" ' +
        'autocomplete="off" spellcheck="false"></div>' +
        '<label class="gsearch fvs"><input type="search" class="fvq" placeholder="Search all icons" ' +
        'aria-label="Search all icons as a favorite" autocomplete="off" spellcheck="false"></label>' +
        '<div class="glyphs fvg"></div>' +
        (joinable ? '<div class="row"><span class="k">Together with</span><select class="fvw" aria-label="Together with"></select></div>' +
                    '<div class="with"></div>' : '') +
        '</div></div>';
      // ITS COLOR: one choice, worn everywhere it is drawn -- its tiles on
      // every page, its favorite, its chip, its pill in the Scenes row
      // (hk-strategy tileOf, hk-chip, hk-tile HkSceneCard). Every accessory
      // has it. Then, as a chip only, what the chip reads and when it shows.
      html += '<div class="sec chip"><div class="cap">Color</div><div class="grp"><div class="swatches"></div></div></div>' +
        '<div class="sec chiprows"' + (chipRows ? '' : ' hidden') + '><div class="cap">As a chip</div><div class="grp">' +
        '<div class="row"><span class="k">Show only when it is</span><input class="nm when" type="text" maxlength="60" aria-label="Show only when it is" ' +
        'placeholder="any state" autocomplete="off" spellcheck="false"></div>' +
        // what the chip reads: its state, or one of its attributes, so a
        // chip of your own can pick what it shows
        '<div class="row"><span class="k">Shows</span><select class="attr" aria-label="Shows"></select></div>' +
        '<div class="row"><span class="k">Label</span><input class="nm lbl" type="text" maxlength="40" aria-label="Label" ' +
        'placeholder="what it shows" autocomplete="off" spellcheck="false"></div></div></div>';
      html += '<button class="reset">Reset to Automatic</button>' +
        '<div class="sure" hidden role="group" aria-label="Reset to Automatic"><div class="q">Every setting of this accessory goes back ' +
        'to automatic, on every screen. Its room stays.</div><div class="b"><button class="no">Cancel</button>' +
        '<button class="go">Reset</button></div></div>' +
        '<div class="note err" hidden></div>' +
        '<div class="note">Saved as you change it, on every screen. The room is Home Assistant\'s own; ' +
        'the name and icon are these dashboards\' only.</div>';
      el.innerHTML = html;
      errBox = el.querySelector('.err');

      // ON THE ENERGY PAGE: through the Energy feature's own commands
      if (enRec) {
        var enSave = function (changes) {
          return h.actions.callWS({ type: 'hk_energy/device/set', key: enRec.key, changes: changes }).catch(fail);
        };
        var enn = el.querySelector('.enn'), ens = el.querySelector('.ens'), enh = el.querySelector('.enh');
        var enName = (enPlan.names || {})[enRec.key] || enRec.name || '';
        enn.placeholder = enName;
        enn.addEventListener('change', function () { enSave({ name: enn.value.trim() || null }); });
        enn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') enn.blur(); });
        enh.addEventListener('change', function () { enSave({ hidden: !enh.checked }); });
        ens.addEventListener('change', function () {
          if (!ens.value) return;
          // moved by the server, in the sections as STORED: the plan here
          // leaves out hidden devices and empty sections, and rebuilding the
          // list from it lost both. The device is shown there too.
          enh.checked = true;
          h.actions.callWS({ type: 'hk_energy/device/section', key: enRec.key, section: ens.value }).catch(fail);
        });
      }

      // NAME
      var nm = el.querySelector('.nm'), hereBox = el.querySelector('.here') || { checked: false, addEventListener: function () {} };
      var fallback = at(s, 'friendly_name') || id;
      nm.placeholder = fallback;
      hereBox.checked = here;
      nm.value = (here ? cur.names[dash] : cur.name) || '';
      var nt = null;
      var saveName = function () {
        clearTimeout(nt);
        var v = nm.value.trim();
        var ch = { name: v || null };
        if (hereBox.checked) ch.screen = dash;
        else cur.name = v || null;
        save(ch).then(function () { if (onName) onName(v || null); });
      };
      nm.addEventListener('input', function () { clearTimeout(nt); nt = setTimeout(saveName, 700); });
      nm.addEventListener('change', saveName);
      nm.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') nm.blur(); });
      hereBox.addEventListener('change', function () {
        // moving the name between "the home's" and "this dashboard's"
        // (turning it off must not save the typed per-screen name as the
        // HOME's, overwriting it: the home's name comes back.)
        var v = nm.value.trim();
        if (hereBox.checked) {
          save({ name: v || null, screen: dash });
        } else {
          save({ name: null, screen: dash }).then(function () {
            nm.value = cur.name || '';
            if (onName) onName(cur.name || null);
          });
        }
      });

      // ROOM (Home Assistant's area). Choosing the device's own area goes
      // back to following the device.
      var room = el.querySelector('.room');
      var areas = Object.keys(h.areas || {}).map(function (k) { return h.areas[k]; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      room.innerHTML = '<option value="">No room</option>' + areas.map(function (a) {
        return '<option value="' + a.area_id + '">' + String(a.name).replace(/</g, '&lt;') + '</option>';
      }).join('');
      room.value = area;
      room.addEventListener('change', function () {
        var v = room.value || null;
        if (errBox) errBox.hidden = true;
        h.actions.callWS({ type: 'config/entity_registry/update', entity_id: id,
                   area_id: v && v === devArea ? null : v }).catch(fail);
      });

      // SHOW AS
      var seg = el.querySelector('.seg.show');
      if (seg) {
        var showAs = [['', 'Automatic'], ['light', 'Light'], ['switch', 'Switch'], ['outlet', 'Outlet'], ['fan', 'Fan']];
        seg.innerHTML = showAs.map(function (o) {
          return '<button data-v="' + o[0] + '"' + ((cur.show_as || '') === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
        }).join('');
        seg.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          cur.show_as = b.dataset.v || null;
          save({ show_as: cur.show_as });
          paintGlyphs(cur.show_as);
          showSpin();
        });
      }

      // SIZE
      var sizeSeg = el.querySelector('.seg.size');
      var paintSize = function () {
        sizeSeg.innerHTML = [['', 'Automatic'], ['regular', 'Regular'], ['tall', 'Tall']].map(function (o) {
          return '<button data-v="' + o[0] + '"' + ((cur.size || '') === o[0] ? ' class="on"' : '') +
                 ' aria-pressed="' + ((cur.size || '') === o[0]) + '">' + o[1] + '</button>';
        }).join('');
      };
      paintSize();
      sizeSeg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        cur.size = b.dataset.v || null;
        paintSize();
        save({ size: cur.size });
      });

      // SPIN (a fan)
      var spinSeg = el.querySelector('.seg.spin'), spinRow = el.querySelector('.spinrow');
      function showSpin() { if (spinRow) spinRow.hidden = !(d === 'fan' || cur.show_as === 'fan'); }
      var paintSpin = function () {
        if (!spinSeg) return;
        var v = cur.anim || '';
        spinSeg.innerHTML = [['', 'Automatic'], ['spin', 'Spin'], ['none', 'Still']].map(function (o) {
          return '<button data-v="' + o[0] + '"' + (v === o[0] ? ' class="on"' : '') +
                 ' aria-pressed="' + (v === o[0]) + '">' + o[1] + '</button>';
        }).join('');
      };
      paintSpin();
      if (spinSeg) {
        spinSeg.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          cur.anim = b.dataset.v || null;
          paintSpin();
          save({ anim: cur.anim });
        });
      }

      // ARRANGE
      if (arr) {
        var mini = el.querySelector('.mini'), mvl = el.querySelector('.mvl'), mvr = el.querySelector('.mvr');
        var sr = el.querySelector('.arr .sr'), queue = Promise.resolve();
        var paintArr = function () {
          mini.style.gridTemplateColumns = 'repeat(' + arr.cols + ',minmax(0,1fr))';
          mini.innerHTML = arr.visible.map(function (x) {
            var t = arr.look[x] || {};
            return '<div class="mt' + (t.tall ? ' tall' : '') + (x === id ? ' on' : '') + '">' +
              (t.icon ? '<hk-icon icon="' + esc(t.icon) + '"></hk-icon>' : '') + '<span>' + esc(t.name || x) + '</span></div>';
          }).join('');
          var i = arr.visible.indexOf(id);
          mvl.disabled = i <= 0;
          mvr.disabled = i >= arr.visible.length - 1;
        };
        var move = function (dir) {
          var next = arrangeMove(arr.visible, arr.full, id, dir);
          if (!next) return;
          arr.visible = next.visible; arr.full = next.full;
          paintArr();
          var i = arr.visible.indexOf(id);
          if (sr) sr.textContent = 'Now ' + (i + 1) + ' of ' + arr.visible.length;
          if (window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
          if (errBox) errBox.hidden = true;
          var msg = arr.fav ? { type: 'hk_frontend/board/set', dashboard: arr.dash, changes: { favorites: next.full } }
                            : { type: 'hk_frontend/accessory/order', area_id: arr.area, entities: next.full };
          // one at a time, in the order tapped
          queue = queue.then(function () { return h.actions.callWS(msg); }).catch(fail);
        };
        mvl.addEventListener('click', function () { move(-1); });
        mvr.addEventListener('click', function () { move(1); });
        paintArr();
      }

      // EDIT THIS PAGE: the sheet goes, the page goes into Edit mode
      var edpg = editHere ? el.querySelector('.edpg') : null;
      if (edpg) {
        edpg.addEventListener('click', function () {
          if (opts.close) opts.close();
          if (window.hkEdit && window.hkEdit.enter) window.hkEdit.enter(h);
        });
      }

      // ICON
      var grid = el.querySelector('.glyphs');
      // A GLYPH GRID: its kind's list (Auto first), or what a search finds --
      // the hk: glyphs, then the Material ones under their own heading.
      function glyphGrid(box, q, chosen, list, auto) {
        var btn = function (it) {
          var on = chosen === it.v || chosen.replace(/^(hk|mdi):/, '') === it.v.replace(/^(hk|mdi):/, '');
          return '<button data-v="' + esc(it.v) + '" aria-label="' + esc(it.v.replace(/^(hk|mdi):/, '').replace(/-/g, ' ')) +
                 (it.mdi ? ' (Material)' : '') + '"' + (on ? ' class="on"' : '') + '><hk-icon icon="' + esc(it.icon) + '"></hk-icon></button>';
        };
        var query = String(q || '').trim();
        box._q = query;
        if (!query) {
          if (chosen && list.indexOf(chosen.replace(/^(hk|mdi):/, '')) < 0) list = [chosen.replace(/^(hk|mdi):/, '')].concat(list);
          box.innerHTML = '<button data-v="" class="' + (chosen ? '' : 'on') + '" aria-label="' + auto[1] + '">' + auto[0] + '</button>' +
            list.map(function (g) { return btn({ v: 'hk:' + g, icon: 'hk:' + g }); }).join('');
          return;
        }
        var paint = function (mdiAll) {
          if (box._q !== query) return;           // a later search won
          var got = glyphSearch(query, mdiAll);
          var mdi = got.mdi.slice(0, SEARCH_MAX);
          box.innerHTML = got.hk.map(btn).join('') +
            (mdi.length ? '<div class="gh">Material Design</div>' + mdi.map(btn).join('') : '') +
            (got.mdi.length > SEARCH_MAX ? '<div class="gn">' + SEARCH_MAX + ' of ' + got.mdi.length + ' Material icons. Keep typing to narrow it down.</div>' : '') +
            (!got.hk.length && !got.mdi.length ? '<div class="gn">' + (mdiAll ? 'No icon matches.' : 'Searching…') + '</div>' : '');
        };
        paint(null);
        mdiList().then(paint);
      }
      var gq = el.querySelector('.gq');
      function paintGlyphs(show) {
        if (show !== undefined) gq.value = '';
        glyphGrid(grid, gq.value, String(cur.icon || ''), glyphsFor(id, show === undefined ? cur.show_as : show), ['Auto', 'Automatic']);
      }
      gq.addEventListener('input', function () { paintGlyphs(); });
      paintGlyphs();
      grid.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        grid.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        cur.icon = b.dataset.v || null;
        save({ icon: b.dataset.v || null });
      });

      // WHERE IT SHOWS: what hides it, from the server (hiding.py); a
      // change sets every place at once, as Hidden Accessories does
      var fav = el.querySelector('.fav');
      wherePane(h, el, id, area, opts, fail);
      if (fav && board) {
        fav.checked = (board.favorites || []).indexOf(id) >= 0;
        fav.addEventListener('change', function () {
          if (errBox) errBox.hidden = true;
          if (fav.checked) { var fs = el.querySelector('.sec.fav'); if (fs) fs.hidden = false; }
          h.actions.callWS({ type: 'hk_frontend/board/favorite', dashboard: dash, entity_id: id,
                     favorite: fav.checked }).catch(fail);
        });
      }

      // AS A FAVORITE
      var fvn = el.querySelector('.fvn'), fvg = el.querySelector('.fvg'), fvw = el.querySelector('.fvw');
      var withBox = el.querySelector('.with');
      fvn.value = cur.fav_name || '';
      var favFallback = function () { return nm.value.trim() || fallback; };
      fvn.placeholder = favFallback();
      var fvr = el.querySelector('.fvr');
      if (fvr) fvr.placeholder = (area && h.areas && h.areas[area] && h.areas[area].name) || 'None';
      ['input', 'change'].forEach(function (t) { nm.addEventListener(t, function () { fvn.placeholder = favFallback(); }); });
      var ft = null;
      var saveFav = function () { clearTimeout(ft); save({ fav_name: fvn.value.trim() || null }); };
      fvn.addEventListener('input', function () { clearTimeout(ft); ft = setTimeout(saveFav, 700); });
      fvn.addEventListener('change', saveFav);
      fvn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') fvn.blur(); });
      var fvq = el.querySelector('.fvq');
      function paintFavGlyphs() {
        glyphGrid(fvg, fvq.value, String(cur.fav_icon || ''), glyphsFor(id, cur.show_as), ['Same', 'Same as its icon']);
      }
      fvq.addEventListener('input', function () { paintFavGlyphs(); });
      paintFavGlyphs();
      fvg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        fvg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        cur.fav_icon = b.dataset.v || null;
        save({ fav_icon: b.dataset.v || null });
      });
      var nameOfId = function (x) { return at(stOf(h, x), 'friendly_name') || x; };
      function paintWith() {
        if (!fvw) return;
        var chosen = Array.isArray(cur.fav_with) ? cur.fav_with : [];
        withBox.innerHTML = chosen.map(function (x) {
          return '<button data-v="' + x + '" aria-label="Remove ' + esc(nameOfId(x)) + '">' + esc(nameOfId(x)) +
                 ' <span aria-hidden="true">\u2715</span></button>';
        }).join('');
        withBox.hidden = !chosen.length;
        // the others it could be joined with: this room's first, then the rest
        var areaOfId = function (x) {
          var ex = (h.entities || {})[x] || {};
          return ex.area_id || (ex.device_id && h.devices && h.devices[ex.device_id] ? h.devices[ex.device_id].area_id : '');
        };
        var pool = Object.keys(h.states).filter(function (x) {
          var dx = domainOf(x), ex = (h.entities || {})[x] || {};
          return x !== id && chosen.indexOf(x) < 0 && !ex.hidden && !ex.entity_category &&
                 (d === 'light' ? dx === 'light' : (dx === 'switch' || dx === 'light' || dx === 'input_boolean'));
        }).sort(function (x, y) {
          return ((areaOfId(y) === area) - (areaOfId(x) === area)) || nameOfId(x).localeCompare(nameOfId(y));
        });
        fvw.innerHTML = '<option value="">' + (chosen.length ? 'Add another' : 'Nothing else') + '</option>' +
          pool.map(function (x) { return '<option value="' + x + '">' + esc(nameOfId(x)) + '</option>'; }).join('');
        fvw.value = '';
      }
      if (fvw) {
        paintWith();
        fvw.addEventListener('change', function () {
          if (!fvw.value) return;
          cur.fav_with = (Array.isArray(cur.fav_with) ? cur.fav_with : []).concat([fvw.value]);
          save({ fav_with: cur.fav_with });
          paintWith();
        });
        withBox.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          cur.fav_with = (cur.fav_with || []).filter(function (x) { return x !== b.dataset.v; });
          save({ fav_with: cur.fav_with.length ? cur.fav_with : null });
          paintWith();
        });
      }

      // COLOR, SHOW ONLY WHEN, LABEL
      var SW = { white: '#f2f2f7', yellow: '#ffd60a', orange: '#ff9f0a', red: '#ff453a', pink: '#ff375f',
                 purple: '#bf5af2', blue: '#0a84ff', teal: '#64d2ff', mint: '#63e6e2', green: '#30d158' };
      var sw = el.querySelector('.swatches');
      if (sw) {
        sw.innerHTML = '<button data-v="" class="' + (cur.color ? '' : 'on') + '">Auto</button>' + Object.keys(SW).map(function (c) {
          return '<button data-v="' + c + '" aria-label="' + c + '" class="' + (cur.color === c ? 'on' : '') +
                 '" style="background:' + SW[c] + '"></button>';
        }).join('');
        sw.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          sw.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          save({ color: b.dataset.v || null });
        });
      }
      var attrSel = el.querySelector('.attr');
      if (attrSel) {
        var sa = (h.states[id] && h.states[id].attributes) || {};
        var SKIP = { friendly_name: 1, icon: 1, entity_picture: 1, supported_features: 1, device_class: 1,
                     unit_of_measurement: 1, state_class: 1, attribution: 1, restored: 1, editable: 1, id: 1 };
        var keys = Object.keys(sa).filter(function (k) {
          var v = sa[k];
          return !SKIP[k] && v !== null && (typeof v !== 'object');
        }).sort();
        if (cur.attribute && keys.indexOf(cur.attribute) < 0) keys.unshift(cur.attribute);
        attrSel.innerHTML = '<option value="">Its state</option>' + keys.map(function (k) {
          return '<option value="' + esc(k) + '"' + (cur.attribute === k ? ' selected' : '') + '>' +
            esc(k.replace(/_/g, ' ')) + '</option>';
        }).join('');
        attrSel.addEventListener('change', function () { save({ attribute: attrSel.value || null }); });
      }
      [['.when', 'when'], ['.lbl', 'label'], ['.ontx', 'on_text'], ['.offtx', 'off_text'], ['.fvr', 'fav_room']].forEach(function (p) {
        var inp = el.querySelector(p[0]);
        if (!inp) return;
        inp.value = cur[p[1]] || '';
        var t = null;
        var go = function () { clearTimeout(t); var ch = {}; ch[p[1]] = inp.value.trim() || null; save(ch); };
        inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(go, 700); });
        inp.addEventListener('change', go);
      });

      var resetBtn = el.querySelector('.reset'), sure = el.querySelector('.sure');
      var noBtn = el.querySelector('.sure .no'), goBtn = el.querySelector('.sure .go');
      var focus = function (b) { if (b && b.focus) b.focus(); };
      resetBtn.addEventListener('click', function () {
        resetBtn.hidden = true; sure.hidden = false;
        focus(noBtn);
      });
      noBtn.addEventListener('click', function () {
        sure.hidden = true; resetBtn.hidden = false; focus(resetBtn);
      });
      goBtn.addEventListener('click', function () {
        sure.hidden = true; resetBtn.hidden = false;
        var all = { name: null, icon: null, show_as: null, size: null, anim: null, status: null, home: null, color: null, when: null, label: null,
                    attribute: null, fav_name: null, fav_icon: null, fav_with: null, fav_room: null,
                    on_text: null, off_text: null };
        save(all).then(function () { return save({ name: null, screen: dash }); }).then(function () {
          cur = {};
          nm.value = ''; hereBox.checked = false; st.checked = true; hm.checked = true;
          if (seg) seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', !x.dataset.v); });
          paintSize();
          paintSpin();
          showSpin();
          paintGlyphs(null);
          fvn.value = ''; paintFavGlyphs(); paintWith();
          // everything the reset cleared shows cleared (the colour, what a
          // chip shows, its gate and label), not their old values
          if (sw) sw.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', !x.dataset.v); });
          if (attrSel) attrSel.value = '';
          ['.when', '.lbl', '.ontx', '.offtx', '.fvr'].forEach(function (q) { var i = el.querySelector(q); if (i) i.value = ''; });
          if (onName) onName(null);
        });
      });
      return el;
    }

    // THE BRIDGE: a sheet's controls act through the client's action port
    // (HkBase._call), so a panel is simply shown its client. A card inside a
    // sheet (the thermostat, the alarm keypad) gets what goes with the client
    // from the host adapter: in HA an HK card takes the frontend's object at its
    // entry and reads the client made from it, and an HA-drawn card needs that
    // object itself (or the client itself, read-only, when there is none).
    function bridge(el, client) { window.hkHostClient.bridge(el, client); }

    // opts: { direct } -- open this sheet, not the #alarm pop-up that hands
    //        back to it; { hashed } -- opened FOR a pop-up's hash, whose own
    //        history entry is the one Back leaves (so none is pushed here);
    //        { onClose } -- called once the sheet has gone, however it went;
    //        { generic } -- true: HK's generic sheet when there is no sheet of
    //        its own here (or its element is not defined); 'only': the
    //        generic sheet whatever the kind (sheets switched off on a host
    //        without a detail of its own)
    function open(id, src, opts) {
      opts = opts || {};
      var h = C.client();
      // A GROUP (openGroup below) is a sheet of several things, not one;
      // CARDS (a custom pop-up) the home's own cards.
      var kind = opts.group ? 'group' : opts.cards ? 'cards' : opts.generic === 'only' ? 'generic' : kindOf(h, id);
      if (!kind && opts.generic) kind = 'generic';
      if (!kind) return false;
      // THE ALARM IS A SHEET LIKE THE REST -- just the keypad -- opened
      // directly on a tap, not through a # pop-up. The #alarm pop-up remains
      // for an alarm automation that opens it by URL, and it hands straight
      // back here (opts.direct).
      var tag = PANELS[kind];
      // ITS PANEL'S CODE NOT LOADED YET (Mantel, 2026-10-29: the weather's, an
      // event's, an automation's and a timer's live in card files a page loads
      // on first use, hk-loader.js hkNeed): opened once it has come
      var N = window.hkNeed;
      if (tag && N && N.has && N.has(tag)) {
        N(tag).then(function () { if (customElements.get(tag)) open(id, src, opts); });
        return true;
      }
      if ((!tag || !customElements.get(tag)) && opts.generic && !opts.group && !opts.cards) { kind = 'generic'; tag = PANELS.generic; }
      if (!tag || !customElements.get(tag)) return false;
      // the generic sheet is about a state: nothing to show for none
      if (kind === 'generic' && !stOf(h, id)) return false;
      // A SHEET OPENED FROM A SHEET takes over the open one's history entry
      // rather than stacking a second: pushing again would leave the first
      // entry behind, and the next Back press would land on it and do nothing.
      var reuse = false;
      var returnGroup = D.el && D.kind === 'group' && D.group && D.group.row ? D.group
        : D.el && D.returnGroup ? D.returnGroup : null;
      if (D.el) { reuse = D.pushed && ours(D); close(true); }

      var s = stOf(h, id);
      var tok = ++TOK;
      var el = document.createElement('div');
      el.className = 'hkd';
      C.flatSurface(el, 'detail');
      el.innerHTML = '<style>' + SHEET_CSS + ACC_CSS + NOTE_CSS + C.flatCss('.hkd[hk-flat]') +
        '.hkd[hk-flat] .sheet{background:var(--hk-flat-elevated);color:var(--hk-ink);box-shadow:var(--hk-flat-elevated-shadow);border-color:var(--hk-line)}' +
        '.hkd[hk-flat] .x,.hkd[hk-flat] .gear{background:var(--hk-key);color:var(--hk-ink)}' +
        '.hkd[hk-flat] .well{background:var(--hk-key)}' + '</style><div class="bd"></div>' +
        '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="hkd-t' + tok + '">' +
          '<div class="hd"><div class="well"><hk-state-icon></hk-state-icon></div>' +
          '<div class="tx"><div class="tt" id="hkd-t' + tok + '"></div></div>' +
          '<button class="gear" aria-label="Accessory settings" hidden><hk-icon icon="mdi:cog"></hk-icon></button>' +
          '<button class="x" aria-label="Close"><hk-icon icon="mdi:close"></hk-icon></button></div>' +
          '<div class="body-frame"><div class="body"></div></div></div>';
      var sheet = el.querySelector('.sheet');
      var panel = document.createElement(tag);
      // glass: false -- the sheet is its own blur; a panel in hk-glass's
      // member set would only make it re-measure the page on every open and
      // close.
      panel.setConfig(Object.assign({ entity: id, kind: kind, src: src || {}, glass: false, event: opts.event || null },
        opts.group ? { entities: opts.group.ids, room: opts.group.room, groupKind: opts.group.kind,
                       row: opts.group.row, resolve: opts.group.resolve } :
        opts.cards ? { cards: opts.cards.cards, width: opts.cards.width } : {}));

      D = {
        el: el, id: id, kind: kind, src: src || {}, panel: panel, sheet: sheet, tok: tok,
        well: el.querySelector('.well'), icon: el.querySelector('hk-state-icon'),
        tt: el.querySelector('.tt'), fed: null,
        // where it opened: a move to another page, or to a pop-up's hash,
        // takes the sheet down (see `moved` below)
        path: location.pathname, hash: location.hash,
        look: lookFor(src, id),
        colour: colourName(lookFor(src, id), id), sig: null, closing: false,
        // a pop-up's own "Close after" (Pop-ups)
        autoMs: opts.autoClose > 0 ? opts.autoClose : 0
      };
      D.group = opts.group || null;
      D.returnGroup = !opts.group && !opts.cards ? returnGroup : null;
      // BACK TO THE SHEET IT CAME FROM (a person's Other Members, a
      // notification's picture): { id, src, opts }; back0 is this one, for
      // a sheet opened from it
      D.back = opts.back || null;
      D.back0 = { id: id, src: src || null, opts: opts };
      var wpx = WIDTH[panel.hkWidthKind ? panel.hkWidthKind(h, s) : kind] || 440;
      sheet.style.setProperty('--hkd-w', wpx + 'px');
      if (panel.hkFill && panel.hkFill()) panel.classList.add('fill');
      // A sheet as tall as its content (the camera's picture) instead of the
      // one height every control sheet shares; a bare one (the camera) is the
      // picture alone.
      if (panel.hkAutoHeight && panel.hkAutoHeight()) sheet.style.height = 'auto';
      if (panel.hkBare && panel.hkBare()) { sheet.classList.add('bare'); el.classList.add('bare'); }
      sheet.querySelector('.body').appendChild(panel);
      if (opts.note) placeNote(h, el, sheet, panel, opts.note, wpx);
      D.offEdges = sheetEdges(sheet.querySelector('.body'), sheet);
      el.querySelector('.bd').addEventListener('click', function () { close(); });
      el.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); close(); });
      if (D.back) {
        var bk = document.createElement('button');
        bk.className = 'x';
        bk.setAttribute('aria-label', 'Back');
        bk.innerHTML = '<hk-icon icon="mdi:chevron-left"></hk-icon>';
        bk.addEventListener('click', function (e) { e.stopPropagation(); close(); });
        el.querySelector('.hd').insertBefore(bk, el.querySelector('.well'));
      } else if (D.returnGroup) {
        var back = document.createElement('button');
        back.className = 'x';
        back.setAttribute('aria-label', 'Back to ' + D.returnGroup.title);
        back.innerHTML = '<hk-icon icon="mdi:chevron-left"></hk-icon>';
        back.addEventListener('click', function (e) { e.stopPropagation(); close(); });
        el.querySelector('.hd').insertBefore(back, el.querySelector('.well'));
      }
      // THE GEAR: this accessory's settings in place of its controls, and
      // back (admins only; not on a picture sheet or a group of several).
      var gear = el.querySelector('.gear');
      if (canEdit(h) && !opts.group && !opts.cards && !(panel.hkBare && panel.hkBare()) && !(panel.hkNoGear && panel.hkNoGear())) {
        gear.hidden = false;
        gear.addEventListener('click', function (e) {
          e.stopPropagation();
          var body = sheet.querySelector('.body');
          var pane = body.querySelector('.acc');
          if (pane) {
            body.removeChild(pane);
            panel.style.display = '';
            gear.firstChild.setAttribute('icon', 'mdi:cog');
            gear.setAttribute('aria-label', 'Accessory settings');
            return;
          }
          panel.style.display = 'none';
          body.appendChild(accessoryPane(C.client() || h, id, function (name) {
            // what was just typed shows at once (a hand-written tile's own
            // name is back the next time the sheet opens)
            if (D.el === el) D.tt.textContent = name || (D.src && D.src.name) ||
              at(stOf(C.client(), id), 'friendly_name') || id;
          }, { tile: D.el === el && D.src ? D.src.el : null, close: function () { close(); } }));
          body.scrollTop = 0;
          gear.firstChild.setAttribute('icon', 'mdi:check');
          gear.setAttribute('aria-label', 'Done');
        });
      }
      sheet.addEventListener('pointerdown', armAuto, true);
      panel.hkSheet = { close: close, sheet: sheet };
      // THE KEYBOARD STAYS IN THE SHEET (2026-10-16): Tab and Shift-Tab go
      // round what the sheet holds, shadow roots and all; the sheet itself
      // takes focus on opening (not a field: a tablet's keyboard would rise),
      // and closing hands focus back to what opened it.
      var prevFocus = deepActive();
      sheet.setAttribute('tabindex', '-1');
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var list = focusables(sheet);
        if (!list.length) { e.preventDefault(); return; }
        var cur = deepActive(), i = list.indexOf(cur);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
      });

      haRoot().appendChild(el);
      var d = D;
      // EVERY NEW CLIENT, FROM EITHER SOURCE, ONCE. The hub (hk-base.js)
      // hands over each new one at once, but moves only while hk cards are on
      // screen; the host adapter always knows the current one (in Home
      // Assistant, read off the frontend's root element), so it is looked at
      // too, four times a second while the sheet is open: one lookup and an
      // identity compare, gone with the sheet. (It was looked at every
      // animation frame, and a callback every frame kept the tablet drawing
      // 60 frames a second for as long as a sheet was open.) The host does
      // not announce its updates, and wrapping its setter would be reaching
      // into the frontend's own element.
      var feed = function (nc) {
        if (!nc || nc === d.fed || D !== d) return;
        d.fed = nc;
        var ns = stOf(nc, d.id);
        var sig = ns ? ns.last_updated : 'x';
        if (sig !== d.sig) { d.sig = sig; paintHeader(nc); }
        // A panel acts through its client's action port, so this file's own
        // panels are simply shown the client. The rest (camera, group, custom
        // cards, and the panels other files define) are fed through the bridge,
        // as before; they read the client too, and pass it on to their cards.
        if (CLIENT_FED.indexOf(panel.constructor) >= 0) panel.client = nc; else bridge(panel, nc);
      };
      feed(h);
      d.off = C.onClient(feed);
      var poll = function () {
        if (D !== d) return;
        feed(C.client());
        d.raf = setTimeout(poll, 250);
      };
      d.raf = setTimeout(poll, 250);
      // THE BACK BUTTON CLOSES IT, like a pop-up: one history entry, same URL.
      // A hash would do the same but would also close any hk-popup sheet the
      // detail was opened from (hk-popup matches the hash exactly).
      var entry = { hkDetail: id, hkTok: tok };
      d.onClose = opts.onClose || null;
      // OPENED FOR A POP-UP'S HASH (#alarm): that hash's own entry is the one
      // Back leaves, so pushing another would take two presses to get out
      if (opts.hashed) d.pushed = false;
      else try {
        if (reuse) history.replaceState(entry, '', location.href);
        else history.pushState(entry, '', location.href);
        d.pushed = true;
      } catch (e) { d.pushed = false; }
      if (el.hasAttribute('hk-flat')) el.classList.add('open');
      else requestAnimationFrame(function () {
        requestAnimationFrame(function () { if (D.el === el) el.classList.add('open'); });
      });
      armAuto();
      d.covers = true;
      d.prevFocus = prevFocus;
      try { sheet.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      covering(1);
      if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold('hk-detail', true);
      return true;
    }

    // the element with focus, inside any shadow roots
    function deepActive() {
      var a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      return a;
    }
    // what Tab can reach in `root`, in order, through shadow roots
    var FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
    function focusables(root) {
      var out = [];
      (function walk(n) {
        var kids = n.shadowRoot ? n.shadowRoot.children : n.children;
        if (n.nodeType === 1 && n !== root && n.matches && n.matches(FOCUSABLE) && n.getClientRects().length &&
            n.getAttribute('aria-disabled') !== 'true') out.push(n);
        Array.prototype.forEach.call(kids || [], walk);
        if (n.shadowRoot) Array.prototype.forEach.call(n.children || [], function (c) { if (c.assignedSlot) walk(c); });
      })(root);
      return out;
    }

    // silent: no history.back() -- the entry is already gone (popstate), or a
    // new sheet, a pop-up or a navigation is taking over.
    // A SHEET COVERS THE PAGE, as a pop-up does (hk-popup.js hkPopupCover):
    // the camera strip stops swapping stills under its blur until it goes.
    function covering(delta) {
      window.hkPopupCover = Math.max(0, (window.hkPopupCover || 0) + delta);
      try {
        window.dispatchEvent(new CustomEvent('hk-popup-change',
          { detail: { open: window.hkPopupOpen || 0, cover: window.hkPopupCover } }));
      } catch (e) { /* no event bus (a test) */ }
    }
    // all: not back to the list an accessory was opened from (returnGroup)
    function close(silent, all) {
      var d = D;
      if (!d.el || d.closing) return;
      if (!silent && !all && d.returnGroup && ours(d) && location.pathname === d.path && location.hash === d.hash) {
        restoreGroup(d.returnGroup);
        return;
      }
      if (!silent && !all && d.back && ours(d) && location.pathname === d.path && location.hash === d.hash) {
        open(d.back.id, d.back.src, d.back.opts);
        return;
      }
      d.closing = true;
      if (d.prevFocus && d.prevFocus.isConnected && d.prevFocus.focus) {
        try { d.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      }
      if (d.covers) { d.covers = false; covering(-1); }
      clearTimeout(d.auto);
      if (d.off) d.off();
      if (d.offEdges) d.offEdges();
      if (d.raf) clearTimeout(d.raf);
      d.el.classList.remove('open');
      var el = d.el;
      var remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (el.hasAttribute('hk-flat')) remove(); else setTimeout(remove, 320);
      D = { el: null };
      if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold('hk-detail', false);
      if (!silent && d.pushed && ours(d)) history.back();
      if (d.onClose) { try { d.onClose(); } catch (e) { /* the caller's */ } }
    }

    // "OPEN IN HOME ASSISTANT" (the generic sheet, for an admin on a host with
    // a detail of its own): the sheet goes first, with its history entry --
    // the host's dialog keeps one of its own, and the Back that took the
    // sheet's entry would otherwise land on the dialog's and close it -- and
    // then the host shows its own detail. false: the host has none.
    function toHost(id) {
      var sh = window.hkShell;
      if (!id || !sh.hostDetail(id)) return false;
      var go = function () { sh.openHostDetail(id); };
      var d = D;
      if (!d.el) { go(); return true; }
      var back = !!(d.pushed && ours(d));
      close(false, true);
      if (!back) { go(); return true; }
      var done = false;
      var run = function () {
        if (done) return;
        done = true;
        window.removeEventListener('popstate', run);
        go();
      };
      window.addEventListener('popstate', run);
      setTimeout(run, 400);
      return true;
    }

    window.addEventListener('popstate', function () {
      if (D.el && !ours(D)) {
        if (D.returnGroup && location.pathname === D.path && location.hash === D.hash) restoreGroup(D.returnGroup);
        else if (D.back && location.pathname === D.path && location.hash === D.hash) open(D.back.id, D.back.src, D.back.opts);
        else close(true);
      }
    });

    // A POP-UP OR ANOTHER PAGE TAKES THE SCREEN: the sheet goes, quietly. A
    // pop-up's sheet sits under this one (z-index 7 to our 8), so a pop-up
    // opened by its trigger -- the #media bar when music starts, a quick
    // timer -- would be hidden until the sheet was closed. The hash the
    // sheet opened over (a sheet opened from inside a pop-up) is not a move.
    function moved() {
      if (!D.el) return;
      // A POP-UP'S SHEET GOES WITH ITS HASH, as an hk-popup-card does: an
      // alarm automation that re-opens #alarm every 50 s by loading the root
      // and then the hash again must close and re-open it (restarting its
      // Close after), not leave it up to time out mid-alarm.
      if (D.popup && location.hash !== '#' + D.popup) { close(true); return; }
      if (location.pathname !== D.path || (location.hash && location.hash !== D.hash)) close(true);
    }
    window.hkShell.onNavigate(moved);
    window.addEventListener('hashchange', moved);

    // ESCAPE CLOSES IT, like HA's dialog. On window, bubbling: hk-base's
    // confirm and choose sheets take Escape at document capture and stop it,
    // so a question asked over this sheet closes alone.
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && D.el) { e.stopPropagation(); close(); }
    });

    // Leave the sheet for another page (Browse Music): drop our history entry
    // without going back, then navigate.
    function navigateFrom(path) {
      if (D.el) {
        try { if (ours(D)) history.replaceState(null, '', location.href); } catch (e) { /* ok */ }
        close(true);
      }
      window.hkShell.navigate(path);
    }

    // ------------------------------------------------------------ interception
    // HA's own surfaces, anywhere in the event's path. Checked over the WHOLE
    // path before anything is taken: an hk card inside HA's card-editor
    // preview (an HA dialog) is still an HK- element, and a first-match
    // walk would take it before it ever reached the dialog.
    var HA_OWN = { 'HA-PANEL-CONFIG': 1, 'HA-DIALOG': 1, 'HA-MD-DIALOG': 1, 'HA-WA-DIALOG': 1,
                   'HA-ADAPTIVE-DIALOG': 1, 'HA-MORE-INFO-DIALOG': 1 };
    function fromDashboard(e) {
      var path = e.composedPath ? e.composedPath() : [], mine = false;
      for (var i = 0; i < path.length; i++) {
        var t = path[i] && path[i].tagName;
        if (!t) continue;
        if (HA_OWN[t]) return false;
        if (window.hkShell.is(path[i], 'panel') || t.indexOf('HK-') === 0) mine = true;
      }
      return mine;
    }
    // THE CARD THAT ASKED, for its name, glyph, colour and any confirmation:
    // the sheet should look like the pill it came from. Only a card whose own
    // entity is the one asked about: the first hk card in the path can be a
    // container (a row, a grid) or a card showing something else, and its
    // name would then label the wrong sheet. None: {} -- the entity's own name.
    function sourceOf(e, id) {
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var el = path[i];
        if (!el || !el._config || !el.tagName || el.tagName.indexOf('HK-') !== 0) continue;
        var c = el._config;
        if (c.entity !== id) continue;
        var conf = (c.icon_tap_action && c.icon_tap_action.confirmation) ||
                   (c.tap_action && c.tap_action.confirmation) || null;
        var out = { name: c.name, icon: c.icon, icon_color: c.icon_color, confirmation: conf,
                    type: el.tagName.toLowerCase(), config: c };
        // the tile itself, for Arrange (accessoryPane): hidden from any copy
        Object.defineProperty(out, 'el', { value: el, enumerable: false });
        return out;
      }
      return {};
    }
    // OFF: the Configure menu's detail sheets switch (look.details),
    // a card's own `detail: false`, or localStorage hk-detail-off=1 on one screen.
    function disabled(src) {
      if (C.setting && C.setting('look.details', true) === false) return true;
      try { if (localStorage.getItem('hk-detail-off') === '1') return true; } catch (e) { /* none */ }
      return !!(src && src.config && src.config.detail === false);
    }


    // ------------------------------------------------------------ the sheets
    // THE PANELS LIVE IN web/hk/sheets/, one file per kind of device, and this file is the shell around
    // them. Each file registers one function in window.hkSheets; they run here, in this order (a later one
    // may use an earlier one), each given the kit K: what the sheets use of the shell, in one object. What the
    // shell uses of them -- the panel base and CSS, the registry, the group and the energy and generic
    // helpers -- they hand back on K, and are taken from it just below.
    //
    // NOTHING IS TAKEN UNTIL THE SHEETS ARE UP: the interception, the pop-up routing and window.hkDetail
    // itself (wire(), below) start after the last file has run, so a tap before then is HA's own dialog,
    // never a dead one. The files are fetched in parallel; a host that has already loaded them (the
    // suites) starts at once, in the same turn.
    var SHEETS = ['hk-sheet-base.js', 'hk-sheet-light.js', 'hk-sheet-lock.js', 'hk-sheet-climate.js', 'hk-sheet-media.js', 'hk-sheet-sensor.js', 'hk-sheet-controls.js', 'hk-sheet-generic.js', 'hk-sheet-vacuum.js', 'hk-sheet-appliances.js', 'hk-sheet-waterheater.js', 'hk-sheet-security.js', 'hk-sheet-group.js'];
    var arcPath, CHEV, CLIENT_FED, DAY, dayRows, def, dur, energyPlan, energyRec, GENERIC_SKIP,
        genericControl, genericRows, money, openGroup, Panel, PANEL_CSS, PANELS, reportsAction,
        restoreGroup, runTimes, SENSE_CSS, sinceText, spansOf, trendOf;
    function kit() {
      return {
        accName: accName, at: at, axesChart: axesChart, BACK: BACK, bridge: bridge, C: C, canEdit: canEdit,
        clamp: clamp, colourName: colourName, css: css, domainOf: domainOf, downsample: downsample,
        esc: esc, fanGuard: fanGuard, fanLabel: fanLabel, fanSteps: fanSteps, favCss: favCss,
        favMatches: favMatches, favourites: favourites, glyph: glyph, gone: gone, hasView: hasView,
        HkBase: HkBase, hsCss: hsCss, isOn: isOn, kelvinRgb: kelvinRgb, lightCaps: lightCaps,
        lightFill: lightFill, lookFor: lookFor, navigateFrom: navigateFrom, num: num, open: open,
        roomOf: roomOf, scrub: scrub, segPick: segPick, SHORT_MQ: SHORT_MQ, SLIDER_H: SLIDER_H, SP: SP,
        spanTo: spanTo, SPEED_NAMES: SPEED_NAMES, stOf: stOf, throttle: throttle, timeRow: timeRow,
        toHost: toHost, unavailable: unavailable, sheetState: function () { return D; }
      };
    }
    function sheetKey(file) { return file.replace(/\.js$/, ''); }
    function runSheets() {
      var K = kit();
      SHEETS.forEach(function (file) { window.hkSheets[sheetKey(file)](K); });
      arcPath = K.arcPath; CHEV = K.CHEV; CLIENT_FED = K.CLIENT_FED; DAY = K.DAY; dayRows = K.dayRows;
      def = K.def; dur = K.dur; energyPlan = K.energyPlan; energyRec = K.energyRec;
      GENERIC_SKIP = K.GENERIC_SKIP; genericControl = K.genericControl; genericRows = K.genericRows;
      money = K.money; openGroup = K.openGroup; Panel = K.Panel; PANEL_CSS = K.PANEL_CSS; PANELS = K.PANELS;
      reportsAction = K.reportsAction; restoreGroup = K.restoreGroup; runTimes = K.runTimes;
      SENSE_CSS = K.SENSE_CSS; sinceText = K.sinceText; spansOf = K.spansOf; trendOf = K.trendOf;
      wire();
    }
    function loadSheets() {
      var have = window.hkSheets || {};
      var missing = SHEETS.filter(function (file) { return !have[sheetKey(file)]; });
      if (!missing.length) { runSheets(); return; }
      // (window.hkV: Mantel's build's ?v= on an address put together here, web/shim/base.js)
      Promise.all(missing.map(function (file) { var u = '/hk/sheets/' + file; return import(window.hkV ? window.hkV(u) : u); }))
        .then(runSheets)
        .catch(function (err) { console.error('[hk-detail] the sheets did not start', err); });
    }

    // ================================================================ POP-UPS
    // THE HOME'S POP-UPS (Pop-ups in HK Settings): a hash
    // on any dashboard's address -- `#doorbell` -- opens its sheet, which is
    // how an automation that loads `<dashboard>/0#doorbell` on a tablet shows
    // it. A YAML hk-popup-card on the page that claims the same hash wins (it
    // is mounted by then: the look waits GRACE_MS for a page's cards). And
    // hk_frontend.show_popup (the settings module's events) sets the hash on
    // the screens it asks.
    var POPUP_GRACE_MS = 700;
    function popupsNow() {
      var HS = window.hkSettings;
      return (HS && HS.get('popups', null)) || [];
    }
    function popupFor(hash) {
      var dash = dashNow();
      var name = String(hash || '').replace(/^#/, '');
      // this dashboard's gear -> Screen -> Answer pop-ups
      var b = C.menu && typeof C.menu.board === 'function' ? C.menu.board() : null;
      if (b && b.popups === false) return null;
      return popupsNow().filter(function (p) {
        return p && p.hash === name && (!p.dashboards || !p.dashboards.length || p.dashboards.indexOf(dash) >= 0);
      })[0] || null;
    }
    // does a pop-up item answer this hash on this dashboard? (hk-popup.js asks,
    // so the now-playing bar never takes the hash from one)
    function answers(hash) { return !!popupFor(hash); }
    function yamlClaims(hash) {
      var P = window.hkPopup;
      return !!(P && typeof P.hashes === 'function' && P.hashes().indexOf(hash) >= 0);
    }
    // opens the pop-up for `hash` here (true), or says why not (false)
    function openPopup(hash) {
      var p = popupFor(hash);
      if (!p || yamlClaims(hash)) return false;
      if (D.el && D.popup === p.hash) return true;          // already up
      var h = C.client();
      var clear = function () {
        // closed by hand or by time: the hash goes, so nothing reopens it
        if (location.hash === hash) {
          try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* ok */ }
        }
      };
      var o = { hashed: true, onClose: clear, autoClose: (p.close_after || 60) * 1000 };
      var ok = false;
      if (p.kind === 'camera' && p.entity) {
        ok = open(p.entity, { popup: p }, o);
      } else if (p.kind === 'alarm') {
        var alarm = p.entity || (window.hkSettings && window.hkSettings.get('security.alarm', null));
        ok = !!alarm && open(alarm, {}, Object.assign({ direct: true }, o));
      } else if (p.kind === 'accessories' && p.entities && p.entities.length) {
        ok = openGroup(p.name, p.entities.filter(function (e) { return h && h.states && h.states[e]; }), {}, o);
      } else if (p.kind === 'cards') {
        ok = open(null, { name: p.name || '#' + p.hash, icon: p.icon || 'mdi:card-text-outline', icon_color: 'rgba(255,255,255,0.92)' },
                  Object.assign({ cards: { cards: p.cards || [], width: p.width } }, o));
      }
      if (ok && D.el) D.popup = p.hash;
      return !!ok;
    }
    // ONLY ON A DASHBOARD: a show_popup, or a #hash, on one of Home
    // Assistant's own pages (Settings, the map) must not open the sheet
    // over it. The host shell knows (in HA: the address's panel is a
    // lovelace one; not up yet is not a dashboard).
    function onDashboard() {
      return window.hkShell.isDashboard() === true;
    }
    var routeT = null;
    function route() {
      clearTimeout(routeT);
      var hash = location.hash;
      if (!hash || hash.length < 2 || !onDashboard() || !popupFor(hash)) return;
      routeT = setTimeout(function () { if (location.hash === hash) openPopup(hash); }, POPUP_GRACE_MS);
    }
    // SHOW POP-UP (hk_frontend.show_popup): this screen, if it is one of those
    // asked -- on a listed dashboard (or any), signed in as a listed user (or
    // anyone) -- gets the hash, and the router above opens it.
    // A HIDDEN PAGE HOLDS IT: a browser tab in the background would take
    // every show_popup -- history entries and sheets nobody sees. But a
    // wall tablet whose screen is off reports hidden too, and the
    // doorbell must be up when the screen wakes. So a hidden page keeps the
    // newest request and opens it when it becomes visible, if the pop-up's
    // own Close after has not run out by then.
    var held = null;
    // CLOSE POP-UP (hk_frontend.close_popup): the same screens, the other
    // half -- the alarm keypad held up for as long as the alarm lasts comes
    // down when it clears. Only a sheet that IS this pop-up closes; anything
    // else on screen is somebody's and stays. A request held for a hidden
    // page goes too, or the keypad would come up on the next wake for an
    // alarm that is already over.
    function closeAsked(e) {
      var dash = dashNow(), h = C.client();
      if (e.dashboards && e.dashboards.length && e.dashboards.indexOf(dash) < 0) return false;
      if (e.users && e.users.length && !(h && h.user && e.users.indexOf(h.user.id) >= 0)) return false;
      if (held && held.ev && held.ev.detail && held.ev.detail.popup === e.popup) held = null;
      if (!D.el || D.popup !== e.popup) return false;
      close(false, true);
      // the hash goes too, whoever opened the sheet: left on the address, a
      // reload (the midnight one) would put the keypad back up
      if (location.hash === '#' + e.popup) {
        try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* ok */ }
      }
      return true;
    }
    function asked(ev) {
      var e = ev && ev.detail;
      if (e && e.type === 'popup_close' && e.popup) return closeAsked(e);
      if (!e || e.type !== 'popup' || !e.popup) return false;
      if (!onDashboard()) return false;
      if (document.visibilityState === 'hidden') {
        var pp = popupFor('#' + e.popup);
        if (pp) held = { ev: ev, until: Date.now() + (pp.close_after || 60) * 1000 };
        return false;
      }
      var dash = dashNow(), h = C.client();
      if (e.dashboards && e.dashboards.length && e.dashboards.indexOf(dash) < 0) return false;
      if (e.users && e.users.length && !(h && h.user && e.users.indexOf(h.user.id) >= 0)) return false;
      if (!popupFor('#' + e.popup)) return false;
      // ASKED AGAIN WHILE IT IS UP (the alarm automation re-shows it every
      // minute while the alarm lasts): nothing to navigate -- that would close
      // a keypad mid-code -- only its Close after runs again from now. And no
      // second history entry for the same hash, or Back does nothing once.
      var same = location.hash === '#' + e.popup;
      if (same && D.el && D.popup === e.popup) { armAuto(); return true; }
      try {
        history[same ? 'replaceState' : 'pushState'](history.state, '', location.pathname + location.search + '#' + e.popup);
        window.hkShell.announce({ detail: { replace: false } });
      } catch (err) { return false; }
      return true;
    }

    // WHAT STARTS WHEN THE SHEETS ARE UP: the interception of a more-info request, the pop-up routing, the
    // house events, and the object the rest of HK talks to.
    function wire() {
      // THE HOST'S OWN DETAIL (HA's dialog) keeps what HK leaves: a tap from
      // the host's own pages, sheets switched off, a kind with no sheet here --
      // let through untouched. A host without one leaves it all to HK: the
      // generic sheet in place of a missing one ('only': sheets switched off).
      window.addEventListener(window.hkShell.events.moreInfo, function (e) {
        var id = e.detail && e.detail.entityId;
        if (!id) return;
        var host = window.hkShell.hostDetail(id);
        if (host && !fromDashboard(e)) return;
        var src = sourceOf(e, id), off = disabled(src);
        if (host && (off || !kindOf(C.client(), id))) return;
        // Taken only if a sheet actually opened: open() can still say no (a
        // sheet's element not defined yet), and a swallowed event would be a
        // dead tap. The host's own dialog then opens.
        if (!open(id, src, host ? undefined : { generic: off ? 'only' : true })) return;
        e.stopImmediatePropagation();
        e.stopPropagation();
      }, true);

      [window.hkShell.navEvent, 'hashchange', 'popstate'].forEach(function (ev) {
        window.addEventListener(ev, route);
      });
      // the pop-ups can arrive after the page (a fresh load with #doorbell)
      (function wait() {
        if (window.hkSettings && window.hkSettings.onChange) { window.hkSettings.onChange(route); route(); }
        else setTimeout(wait, 200);
      })();

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !held) return;
        var h2 = held; held = null;
        if (Date.now() < h2.until) asked(h2.ev);
      });

      window.addEventListener('hk-house-event', asked);

      window.hkDetail = {
        version: '1.0.0',
        open: open,
        openGroup: openGroup,
        close: close,
        navigateFrom: navigateFrom,
        kindOf: kindOf,
        answers: answers,
        // the pieces later phases and the tests build on
        _: {
          runTimes: runTimes, dur: dur, niceTicks: niceTicks, axesChart: axesChart, scrub: scrub, scrubPick: scrubPick, scrubValue: scrubValue, tickText: tickText, timeTicks: timeTicks, arcPath: arcPath,
          STD: STD, WIDE: WIDE, SHEET_H: SHEET_H, PHONE_H: PHONE_H, SP: SP, SHORT_MQ: SHORT_MQ,
          dayRows: dayRows, spansOf: spansOf, sinceText: sinceText, timeRow: timeRow, SENSE_CSS: SENSE_CSS, DAY: DAY,
          goFor: goFor, noteEl: noteEl, noteWhen: noteWhen, areaOf: areaOf, roomOf: roomOf, NOTE_CSS: NOTE_CSS,
          Panel: Panel, PANELS: PANELS, PANEL_CSS: PANEL_CSS, WIDTH: WIDTH, def: def, stOf: stOf, at: at,
          num: num, clamp: clamp, isOn: isOn, unavailable: unavailable, throttle: throttle, glyph: glyph,
          lookOf: lookOf, lookFor: lookFor, headIcon: headIcon,
          esc: esc, CHEV: CHEV, BACK: BACK, fanSteps: fanSteps, fanLabel: fanLabel, fanGuard: fanGuard,
          downsample: downsample, kelvinRgb: kelvinRgb, lightFill: lightFill, lightCaps: lightCaps, defaultFavourites: defaultFavourites,
          favMatches: favMatches, fromDashboard: fromDashboard, sourceOf: sourceOf, colourName: colourName,
          nearWhite: nearWhite, spanTo: spanTo, trendOf: trendOf, reportsAction: reportsAction,
          accessoryPane: accessoryPane, accName: accName, accIcon: accIcon, canEdit: canEdit, glyphsFor: glyphsFor, glyphSearch: glyphSearch, arrangeOf: arrangeOf, arrangeMove: arrangeMove, money: money, ACC_CSS: ACC_CSS,
          popupFor: popupFor, openPopup: openPopup, route: route, asked: asked, onDashboard: onDashboard, SHEET_CSS: SHEET_CSS,
          genericControl: genericControl, genericRows: genericRows, toHost: toHost, GENERIC_SKIP: GENERIC_SKIP,
          state: function () { return D; }
        }
      };
      try { window.dispatchEvent(new Event('hk-detail-ready')); } catch (e) { /* no window events (a test) */ }
    }

    loadSheets();
  });
})();
