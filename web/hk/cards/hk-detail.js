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
      '  box-sizing:border-box;padding-left:var(--hk-content-left,0px)}',
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
      '  width:var(--hkd-w,' + STD + 'px);max-width:calc(var(--hk-vw, 100vw) - var(--hk-content-left, 0px) - 32px);',
      '  height:' + SHEET_H + 'px;max-height:calc(var(--hk-vh, 100dvh) - 32px);',
      '  display:flex;flex-direction:column;gap:20px;padding:24px;border-radius:38px;',
      // THE COLOUR COMES THROUGH: a light tint over a saturated blur, so the
      // sky and the pills behind tint the sheet the way the Home app's cards
      // are tinted.
      '  background:rgba(28,28,32,0.52);-webkit-backdrop-filter:blur(34px) saturate(1.9);',
      '  backdrop-filter:blur(34px) saturate(1.9);border:1px solid rgba(255,255,255,0.12);',
      '  box-shadow:0 26px 64px rgba(0,0,0,0.55);overflow:hidden;',
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
      // 16 from the top, 18 from the right). As wide as --hkd-w, or narrower
      // when the screen is too short for the picture at that width (--hkd-ar
      // is its shape), so there are never bars beside it. Specific enough to
      // win over the phone rules below.
      // opaque: the picture fills it, so the sheet's frost is work nobody sees
      // -- a 34 px blur of everything behind a 1200x675 box, re-run whenever
      // the strip's live tile or the sky moves under it
      '.hkd .sheet.bare{padding:0;gap:0;border-radius:30px;height:auto;background:#0b0d12;',
      '  -webkit-backdrop-filter:none;backdrop-filter:none;',
      '  width:min(var(--hkd-w,1200px), calc((var(--hk-vh, 100dvh) - 32px) * var(--hkd-ar, 1.7778)))}',
      '.hkd .sheet.bare .hd{position:absolute;top:16px;right:18px;z-index:3;height:auto}',
      '.hkd .sheet.bare .well,.hkd .sheet.bare .tx{display:none}',
      // (white on it in every look: Flat's ink glyph vanished on the dark
      // plate, the user 2026-10-17)
      '.hkd .sheet.bare .x{background:rgba(28,28,30,0.62);color:#fff}',
      '.hkd .sheet.bare .body{overflow:hidden}',
      // ...and the pop-ups' dim (hk-popup.js, rgba(17,17,17,.8)): a control
      // sheet's lighter one lets the sky tint its glass; a picture has none.
      '.hkd.bare .bd{background:rgba(17,17,17,0.8)}',
      '@media (max-width:' + C.BP.phone + 'px){',
      '  .hkd .sheet{width:calc(var(--hk-vw, 100vw) - 32px);padding:18px;gap:16px;border-radius:30px;',
      '    height:min(' + PHONE_H + 'px, calc(var(--hk-vh, 100dvh) - 80px))}',
      '  .hkd .well,.hkd .x{width:40px;height:40px;border-radius:20px}',
      '  .hkd .hd{height:40px;gap:12px}',
      '  .hkd .sheet:not(.bare) .body-frame{margin-top:-6px}',
      '  .hkd .sheet:not(.bare) .body{padding-top:6px}',
      '  .hkd .tt{font-size:20px;line-height:22px}',
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
      '.acc .arrb button{flex:1;height:40px;border:0;border-radius:10px;background:var(--acc-glyph,rgba(255,255,255,0.12));',
      '  color:var(--acc-text,#fff);font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;',
      '  justify-content:center;gap:6px;--mdc-icon-size:18px}',
      '.acc .arrb button:disabled{opacity:.35;cursor:default}',
      '.acc .arrb button:not(:disabled):active{background:var(--acc-seg-on,rgba(255,255,255,0.24))}',
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
      if (!place || !root || !root.children) return null;
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
          }, { tile: D.el === el && D.src ? D.src.el : null }));
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

    // ------------------------------------------------------------ panels
    // Recessed controls on Flat's elevated sheet. Keep the glass CSS below
    // intact: translucent white is its material, but disappears on Light.
    // Scope by role and state so artwork, color swatches and live colors stay
    // their own, and an inactive control never inherits a selected fill.
    var FLAT_PANEL_CSS = [
      ':host([hk-flat]) .tg:not(.on){background:' + C.v('key') + '}',
      ':host([hk-flat]) .tg .kn{box-shadow:none;border:1px solid ' + C.v('line') + ';box-sizing:border-box}',
      ':host([hk-flat]) .tg:not(.on) .kn{color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .vs::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host(hk-detail-fan[hk-flat="light"]) .vs .fill,:host(hk-detail-number[hk-flat="light"]) .vs .fill{background:' + C.v('track-fill') + '}',
      ':host(hk-detail-fan[hk-flat="light"]) .vs .gl.dark{color:var(--hk-seg-on,' + C.SELECTED_BG + ')}',
      ':host([hk-flat="light"]) .vs.neutral-fill .gl.dark{color:var(--hk-seg-on,' + C.SELECTED_BG + ')}',
      ':host([hk-flat]) .vs .tick{background:' + C.v('mark') + '}',
      ':host([hk-flat]) .vs .tick.in{background:' + C.v('line') + '}',
      ':host([hk-flat]) .btn.sel,:host([hk-flat]) .acts .pw.lit{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host([hk-flat]) .bot:not(.live):not(.bad),:host([hk-flat]) .state:not(.open){background:' + C.v('key') + ';color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .cmds button{color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .cmds .ci{background:' + C.v('key') + '}',
      ':host([hk-flat]) .cmds button.sel .ci{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host([hk-flat]) .chips span:not(.err),:host([hk-flat]) .guard button{background:' + C.v('key') + '}',
      ':host([hk-flat]) .chart,:host([hk-flat]) .stats,:host([hk-flat]) .trend,:host([hk-flat]) .tl,:host([hk-flat]) .en .rows{background:' + C.v('key') + '}',
      ':host([hk-flat]) .now{background:' + C.v('key') + '}',
      // The wide thermostat splits its readings and run time into two cards.
      ':host([hk-flat][wide]) .now{background:transparent}',
      ':host([hk-flat][wide]) .now .rd,:host([hk-flat][wide]) .now .run{background:' + C.v('key') + '}',
      // Water heaters keep their single reading card at either width.
      ':host(hk-detail-water-heater[hk-flat][wide]) .now{background:' + C.v('key') + '}',
      ':host([hk-flat]) .now .run,:host([hk-flat]) .en .row + .row{border-color:' + C.v('line') + '}',
      ':host([hk-flat]) .ap .gr{background:' + C.v('line') + '}',
      ':host([hk-flat]) .ap .gr.b{background:' + C.v('line-strong') + '}',
      ':host([hk-flat]) .hks .hkl{border-color:' + C.v('mark') + '}',
      ':host([hk-flat]) .hks .hkp{background:' + C.v('overlay-solid') + '}',
      ':host([hk-flat]) .hks .hkp .v{color:' + C.v('ink') + '}',
      ':host([hk-flat]) .list,:host([hk-flat]) .search{background:' + C.v('key') + '}',
      ':host([hk-flat]) .list button{border-color:' + C.v('line') + '}',
      ':host([hk-flat]) .search > svg{stroke:' + C.v('ink-2') + '}',
      ':host([hk-flat]) .list button:active,:host([hk-flat]) .vp button:not(.on):active{background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) .chd .nv button,:host([hk-flat]) .vst button{background:' + C.v('key') + ';color:' + C.v('ink') + '}',
      ':host([hk-flat]) .tp button{color:' + C.v('ink') + '}',
      ':host([hk-flat]) .pg,:host([hk-flat]) .vol .t{background:' + C.v('line-strong') + '}',
      ':host([hk-flat]) .pg i{background:' + C.v('track-fill') + '}',
      ':host([hk-flat]) .gw:not(.on){background:' + C.v('key') + '}',
      ':host([hk-flat]) .gw:not(.on) .gc{background:' + C.v('key-strong') + ';color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .tl .bar{background:' + C.v('line-strong') + '}',
      ':host([hk-flat]) .tl .bar .q{background:' + C.v('line') + '}',
      ':host([hk-flat]) .lk .trk{stroke:' + C.v('line-strong') + '}',
      ':host([hk-flat="light"]) .lk .trk,:host([hk-flat="light"]) .dl .trk{stroke:' + C.v('key') + '}',
      ':host([hk-flat]) .lk.water.shut{background:' + C.v('key') + '}',
      ':host([hk-flat]) .lk.water.shut .core{background:' + C.v('key-strong') + ';color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .dl .cur{fill:' + C.v('ink') + '}',
      ':host(hk-detail-water-heater[hk-flat]) .acts:not(.mseg) button,:host([hk-flat]) .pwr button{background:' + C.v('key') + ';color:' + C.v('ink') + '}',
      ':host(hk-detail-water-heater[hk-flat]) .acts:not(.mseg) button.sel,:host([hk-flat]) .pwr button.sel{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + '}',
      ':host(hk-detail-water-heater[hk-flat]) .sw:not(.on){background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) .vs.off .fill{background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) .mk span{color:' + C.v('ink-2') + '}',
      ':host([hk-flat]) .vp button.on{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + '}',
      ':host([hk-flat]) .vp button:not(:first-child)::before{background:' + C.v('line') + '}'
    ].join('');
    var PANEL_CSS = FLAT_PANEL_CSS + [
      ':host{display:block;color:' + window.hkCards.v('ink') + ';font-family:inherit}',
      // a display rule beats the hidden attribute; this puts it back
      '[hidden]{display:none!important}',
      // 3 px above and below, the same: a centred panel is centred to the pixel
      '.pn{display:flex;flex-direction:column;align-items:center;gap:20px;padding:3px 0}',
      '.big{font-size:44px;font-weight:600;letter-spacing:-1.5px;line-height:1;',
      '  font-variant-numeric:tabular-nums;min-height:44px;text-align:center}',
      '.lab{align-self:stretch;font-size:13px;font-weight:600;letter-spacing:0.3px;',
      '  color:' + window.hkCards.v('ink-2') + ';text-transform:uppercase;margin-bottom:-10px}',
      // the vertical slider (brightness, speed, shade)
      // ONE SLIDER SIZE on every sheet (150 x 440; a phone 128 x 360)
      '.vs{position:relative;width:150px;height:440px;border-radius:44px;flex-shrink:0;',
      '  background:rgba(255,255,255,0.14);overflow:hidden;touch-action:none;cursor:pointer;',
      '  outline:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}',
      '.vs:focus-visible{box-shadow:0 0 0 3px rgba(100,181,255,0.8)}',
      // shorter when a row of buttons sits under it (a colour light, a humidifier)
      '.vs.short{height:320px}',
      '.vs .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:rgba(255,255,255,0.95);',
      '  transition:height .18s ease}',
      '.vs.drag .fill{transition:none}',
      '.vs .gl{position:absolute;left:0;right:0;bottom:22px;display:flex;justify-content:center;',
      '  pointer-events:none;color:rgba(255,255,255,0.72);transition:color .15s}',
      '.vs .gl.dark{color:rgba(0,0,0,0.55)}',
      '.vs .tick{position:absolute;left:20px;right:20px;height:2px;border-radius:1px;',
      '  background:rgba(255,255,255,0.16);pointer-events:none}',
      '.vs .tick.in{background:rgba(0,0,0,0.13)}',
      // buttons -- NOT ".pill": hk-base's BASE_CSS owns that name (the
      // dashboard's glass pill, with the blur layer's marker), and reusing it
      // draws a dark box behind every sheet button
      '.btn{height:52px;border:0;border-radius:26px;padding:0 20px;display:inline-flex;',
      '  align-items:center;justify-content:center;gap:8px;font:inherit;font-size:16px;',
      '  font-weight:600;color:#fff;background:rgba(255,255,255,0.13);cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent}',
      '.btn:active{background:rgba(255,255,255,0.24)}',
      '.btn.sel{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.88)}',
      '.btn[disabled]{opacity:.4;cursor:default}',
      // UNAVAILABLE (Panel._na): every control greys out and takes no input
      ':host([na]) .vs,:host([na]) .btn,:host([na]) .sw,:host([na]) .tp,:host([na]) .vol,',
      ':host([na]) .vst,:host([na]) .list,:host([na]) .cmds{opacity:.4;pointer-events:none}',
      '.menu{align-self:stretch;justify-content:space-between;padding:0 16px 0 20px}',
      '.menu .cur{display:inline-flex;align-items:center;gap:4px;color:rgba(235,235,245,0.62);',
      '  font-weight:500;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.menu .cur svg{flex-shrink:0}',
      '.muted{font-size:15px;color:' + window.hkCards.v('ink-2') + ';text-align:center}',
      // A STATE AND ITS LINE ARE ONE PIECE ("Closed" / "Hold to open",
      // "Closed" / "Since 8:20 AM"): SP.line under it, whatever the gap
      // between the sheet's pieces (20, a phone 16)
      '.pn > .big + .muted,.pn > .big + .since{margin-top:-14px}',
      // the axes (axesChart): values up the left, each centred on its rule
      // ONE GRID: the values' column, as wide as its WIDEST label (a hidden
      // copy of it sizes the column), then the plot; the times sit under the
      // plot in the same grid. A fixed 38 px column leaves short labels ("0",
      // "2") far in from the card's edge while the plot runs to the other --
      // the chart looks off-centre in its card.
      '.axc{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:10px;align-items:start}',
      '.ay{position:relative}',
      '.ay .sz{visibility:hidden;display:block;height:0;overflow:hidden;font-size:12px;line-height:14px;',
      '  font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ay span{position:absolute;right:0;transform:translateY(-50%);font-size:12px;line-height:14px;',
      '  color:' + window.hkCards.v('ink-3') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ap{position:relative;min-width:0}',
      '.axc > .axx{grid-column:2;margin:8px 0 0}',
      '.ap .gr{position:absolute;left:0;right:0;height:1px;margin-top:-0.5px;background:rgba(255,255,255,0.07);pointer-events:none}',
      '.ap .gr.b{background:rgba(255,255,255,0.16)}',
      '.axc.fl{align-items:stretch;grid-template-rows:minmax(0,1fr) auto}',
      '.axc.fl .ap > svg{height:100% !important;overflow:visible}',
      '.axx{position:relative;height:14px;margin:8px 0 0 48px;font-size:12px;line-height:14px;color:' + window.hkCards.v('ink-3') + '}',
      '.axx span{position:absolute;top:0;white-space:nowrap;transform:translateX(-50%)}',
      '.axx span:first-child{transform:none}',
      '.axx span:last-child{transform:translateX(-100%)}',
      // a calendar period's labels sit centered under their days, the ends too
      '.axx.cal span,.axx.cal span:first-child,.axx.cal span:last-child{transform:translateX(-50%)}',
      '.axx.cal span.today{color:#f4b562;font-weight:700}',
      '.axx.cal span.fut{opacity:.65}',
      // the readout (scrub): a vertical swipe on the plot still scrolls the
      // sheet; a held finger selects nothing and opens no callout
      '.ap[data-hks]{touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;',
      '  -webkit-tap-highlight-color:transparent}',
      '.hks{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .12s ease;z-index:2}',
      '.hks.on{opacity:1}',
      // the line runs from the label down to the plot's floor
      '.hks .hkl{position:absolute;left:0;top:-3px;bottom:0;width:0;border-left:1px solid rgba(255,255,255,0.55)}',
      '.hks .hkd{position:absolute;left:-6px;top:-6px;width:12px;height:12px;box-sizing:border-box;border-radius:50%;',
      '  background:#fff;border:3px solid #ff9f0a;box-shadow:0 1px 4px rgba(0,0,0,0.45)}',
      '.hks .hkp{position:absolute;left:0;bottom:calc(100% + 3px);display:flex;align-items:baseline;gap:7px;',
      '  padding:4px 10px;border-radius:13px;white-space:nowrap;background:rgba(24,24,28,0.93);',
      '  box-shadow:0 0 0 0.5px rgba(255,255,255,0.14),0 4px 14px rgba(0,0,0,0.35)}',
      '.hks .hkp .v{font-size:15px;line-height:18px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}',
      '.hks .hkp .t{font-size:13px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums}',
      // a bar chart lights the bar under the line: the others step back
      '.hksg > div{transition:opacity .12s ease}',
      '.hksg.on > div:not(.hkon){opacity:.4}',
      '@media (max-width:' + C.BP.phone + 'px){',
      '  .pn{gap:16px}',
      '  .pn > .big + .muted,.pn > .big + .since{margin-top:-10px}',
      '  .big{font-size:38px;min-height:38px}',
      '  .vs{width:128px;height:360px;border-radius:38px}',
      '  .vs.short{height:280px}',
      '  .vs .gl{bottom:18px}',
      '  .lab{margin-bottom:-8px}',
      '  .btn{height:48px;border-radius:24px;font-size:15px}',
      '}'
    ].join('');

    var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
               '<path d="m9 6 6 6-6 6"/></svg>';
    // the current row's tick (effects, inputs, every pick list) and the search glyph
    var TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF9F0A" stroke-width="2.6" ' +
               'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    var SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(235,235,245,.6)" stroke-width="2.2" ' +
                 'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>';

    class Panel extends HkBase {
      static get CSS() { return PANEL_CSS; }
      // _stateObj, not _st: HkBase has a METHOD _st(id), and a getter of the
      // same name would replace it for every panel.
      get _stateObj() { return stOf(this.client, this._config && this._config.entity); }
      get _id() { return this._config && this._config.entity; }
      get _src() { return (this._config && this._config.src) || {}; }
      _svc(domain, service, data) {
        return this._call(domain, service, Object.assign({ entity_id: this._id }, data || {}));
      }
      // UNAVAILABLE, ONE WAY FOR EVERY SHEET: the controls grey out and take
      // no input (PANEL_CSS :host([na])), and the caller's readout says
      // "Unavailable" -- never a stale "Off" or a shade drawn "Open". Only
      // `unavailable`: an `unknown` device still takes commands, as in HA.
      _na(s) {
        var na = !!s && s.state === 'unavailable';
        if (na) this.setAttribute('na', ''); else this.removeAttribute('na');
        return na;
      }
      // The vertical slider. o: { steps, glyph, onInput(v), onChange(v), label }
      // Drag moves from where it is (as the Home app does); a tap jumps to the tap.
      _vslider(o) {
        var self = this;
        var el = document.createElement('div');
        el.className = 'vs';
        el.setAttribute('role', 'slider');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', o.label || 'Level');
        el.setAttribute('aria-valuemin', '0');
        el.setAttribute('aria-valuemax', '100');
        var ticks = '';
        if (o.steps && o.steps > 1 && o.steps <= 10) {
          for (var i = 1; i < o.steps; i++) {
            ticks += '<div class="tick" data-f="' + (i / o.steps) + '" style="bottom:calc(' + (i / o.steps * 100) + '% - 1px)"></div>';
          }
        }
        el.innerHTML = '<div class="fill"></div>' + ticks + '<div class="gl">' + (o.glyph || '') + '</div>';
        var fill = el.querySelector('.fill'), gl = el.querySelector('.gl');
        var cur = 0, drag = null;
        function snap(v) {
          v = clamp(v, 0, 1);
          if (o.steps && o.steps > 1) return Math.round(v * o.steps) / o.steps;
          return Math.round(v * 100) / 100;
        }
        function show(v) {
          cur = v;
          fill.style.height = (v * 100) + '%';
          el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
          var h = el.clientHeight || 380;
          gl.classList.toggle('dark', v * h > 58);
          el.querySelectorAll('.tick').forEach(function (t) {
            t.classList.toggle('in', Number(t.getAttribute('data-f')) < v - 1e-6);
          });
        }
        el.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          try { el.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
          drag = { y0: e.clientY, v0: cur, moved: false, rect: el.getBoundingClientRect() };
        });
        el.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var dy = e.clientY - drag.y0;
          if (!drag.moved && Math.abs(dy) < 5) return;
          if (!drag.moved) { drag.moved = true; el.classList.add('drag'); }
          var v = snap(drag.v0 - dy / drag.rect.height);
          if (v !== cur) { show(v); if (o.onInput) o.onInput(v); }
        });
        function end(e, cancel) {
          if (!drag) return;
          var d = drag; drag = null;
          el.classList.remove('drag');
          if (cancel) return;
          var v = d.moved ? cur : snap(1 - (e.clientY - d.rect.top) / d.rect.height);
          show(v);
          if (o.onChange) o.onChange(v);
        }
        el.addEventListener('pointerup', function (e) { end(e, false); });
        el.addEventListener('pointercancel', function (e) { end(e, true); });
        el.addEventListener('keydown', function (e) {
          var step = o.steps && o.steps > 1 ? 1 / o.steps : 0.05;
          var v = null;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = snap(cur + step);
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = snap(cur - step);
          if (v == null) return;
          e.preventDefault();
          show(v);
          if (o.onChange) o.onChange(v);
        });
        return {
          el: el,
          set: function (v) { if (!drag) show(clamp(v, 0, 1)); },
          fill: function (bg) { fill.style.background = bg; },
          dragging: function () { return !!drag; }
        };
      }
      // TWO COLUMNS WHEN THERE IS ROOM, decided here and not by a CSS
      // container query: Safari does not match container-query rules in a shadow
      // tree against :host, so the thermostat and the graph would stay stacked
      // (and overflow the 680 sheet) there while Chrome is fine. A panel that
      // has a wide layout returns its width from _wideAt(); its CSS keys off
      // :host([wide]) and _onWide() repaints whatever it drew for the other
      // width.
      _wideAt() { return 0; }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var at = this._wideAt(), self = this;
        if (!at || this._ro || typeof ResizeObserver === 'undefined') return;
        this._ro = new ResizeObserver(function () {
          var w = self.clientWidth >= at;
          if (w === self.hasAttribute('wide')) return;
          if (w) self.setAttribute('wide', ''); else self.removeAttribute('wide');
          if (self._onWide) self._onWide();
        });
        this._ro.observe(this);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._tickT) { clearInterval(this._tickT); this._tickT = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
      }
    }

    // ------------------------------------------------------------ light
    class LightPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          '.vs:not(.short){height:' + SLIDER_H.full + 'px}',
          // THE COLOUR GROUP: label, circles and Effects share one left edge and
          // one width (the row of circles), centred under the slider.
          '.grp{display:flex;flex-direction:column;gap:12px;align-self:center;max-width:100%;min-width:300px}',
          // the circles sit 4 px inside the row (room for the selected ring), so
          // the label and the button step in 4 px to share their edges exactly
          '.grp .lab{margin:0 0 -2px 4px}',
          '.grp .menu{align-self:stretch;margin:0 4px}',
          '.sw{display:flex;gap:12px;justify-content:flex-start;overflow-x:auto;',
          '  scrollbar-width:none;padding:4px}',
          '.sw::-webkit-scrollbar{display:none}',
          '.sw button{width:46px;height:46px;border-radius:23px;border:0;padding:0;flex-shrink:0;',
          '  cursor:pointer;box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
          '.sw button.sel{box-shadow:0 0 0 3px rgba(28,28,30,1),0 0 0 6px #fff}',
          '.sw .rainbow{background:conic-gradient(hsl(0,100%,55%),hsl(60,100%,55%),hsl(120,100%,50%),',
          '  hsl(180,100%,50%),hsl(240,100%,60%),hsl(300,100%,55%),hsl(360,100%,55%))}',
          // the sub-views: back row, wheel, whites, effects list
          // one height for every sub-view, so Colour <-> White does not
          // make the sheet jump (the wheel's view is the tallest)
          '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px;min-height:436px}',
          '.ctv{min-height:40px}',
          '.bk{display:flex;align-items:center;gap:10px}',
          '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
          '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
          C.segCss('.seg', { on: '.sel', fill: true }),
          '.wheel{position:relative;width:300px;height:300px;border-radius:50%;align-self:center;',
          '  touch-action:none;cursor:crosshair;',
          '  background:radial-gradient(circle closest-side,#fff,rgba(255,255,255,0)),',
          '  conic-gradient(hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),',
          '  hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))}',
          '.knob{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:17px;',
          '  border:4px solid #fff;box-sizing:border-box;box-shadow:0 2px 10px rgba(0,0,0,0.45);pointer-events:none}',
          '.ct{position:relative;height:56px;border-radius:28px;touch-action:none;cursor:pointer}',
          '.ct .knob{top:50%}',
          '.ctv{font-size:34px;font-weight:600;letter-spacing:-1px;text-align:center;font-variant-numeric:tabular-nums}',
          '.lf{flex:0 0 auto}',
          '.list{border-radius:18px;background:rgba(255,255,255,0.06);max-height:420px;overflow-y:auto;',
          '  overscroll-behavior:contain;scrollbar-width:none}',
          '.list::-webkit-scrollbar{display:none}',
          '.list button{display:flex;align-items:center;justify-content:space-between;width:100%;',
          '  min-height:52px;padding:0 18px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);',
          '  background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;font-size:17px;text-align:left;cursor:pointer}',
          '.list button:last-child{border-bottom:0}',
          '.list .hd2{padding:16px 18px 6px;font-size:13px;font-weight:600;letter-spacing:0.3px;',
          '  color:' + window.hkCards.v('ink-2') + ';text-transform:uppercase}',
          '.list button:active{background:rgba(255,255,255,0.08)}',
          '.search{display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:14px;',
          '  background:rgba(255,255,255,0.10)}',
          '.search input{flex-grow:1;min-width:0;border:0;background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;',
          '  font-size:17px;outline:none}',
          '.search input::placeholder{color:' + window.hkCards.v('ink-3') + '}',
          '@media (max-width:' + C.BP.phone + 'px){',
          '  .vs:not(.short){height:' + SLIDER_H.phone + 'px}',
          '  .sw{gap:8px}',
          '  .grp{min-width:0}',
          '  .sw button{width:38px;height:38px;border-radius:19px}',
          '  .wheel{width:250px;height:250px}',
          '  .sub{min-height:374px}',
          '  .list{max-height:340px}',
          '}'
        ].join('');
      }
      hkWidthKind(h, s) { var c = lightCaps(s); return (c.colour || c.temp || c.effects) ? 'light_colour' : 'light'; }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        this._na(s);
        if (!this._built) this._build();
        this._view === 'main' ? this._paintMain(s) : this._view === 'effects' ? this._paintEffects(s) : this._paintWheel(s);
      }
      _build() {
        this._built = true;
        this._view = this._view || 'main';
        var self = this;
        this._root.innerHTML = '';
        var pn = document.createElement('div');
        pn.className = 'pn';
        this._root.appendChild(pn);
        this._pn = pn;
        if (this._view !== 'main') return this._buildSub();
        var s = this._stateObj, caps = lightCaps(s);
        var big = document.createElement('div');
        big.className = 'big';
        pn.appendChild(big);
        this._big = big;
        var send = throttle(function (v) {
          if (v <= 0) self._svc('light', 'turn_off');
          else self._svc('light', 'turn_on', { brightness_pct: Math.max(1, Math.round(v * 100)) });
        }, 350);
        this._slider = this._vslider({
          label: 'Brightness',
          glyph: glyph((this._src.icon || 'hk:lightbulb'), 30),
          onInput: function (v) { big.textContent = Math.round(v * 100) + '%'; send(v); },
          onChange: function (v) { big.textContent = v <= 0 ? 'Off' : Math.round(v * 100) + '%'; send(v); }
        });
        pn.appendChild(this._slider.el);
        if (caps.colour || caps.temp || caps.effects) {
          this._slider.el.classList.add('short');
          var grp = document.createElement('div');
          grp.className = 'grp';
          pn.appendChild(grp);
          if (caps.colour || caps.temp) {
            var lab = document.createElement('div');
            lab.className = 'lab';
            lab.textContent = 'Favorite colors';
            grp.appendChild(lab);
            var sw = document.createElement('div');
            sw.className = 'sw';
            grp.appendChild(sw);
            this._sw = sw;
            this._favSig = null;
          }
          if (caps.effects) {
            var fx = document.createElement('button');
            fx.className = 'btn menu';
            fx.innerHTML = '<span>Effects</span><span class="cur"></span>';
            fx.addEventListener('click', function () { self._go('effects'); });
            grp.appendChild(fx);
            this._fx = fx;
          }
        }
      }
      _go(view) {
        this._view = view;
        this._built = false;
        this._render();
      }
      _paintMain(s) {
        var on = s.state === 'on';
        var b = num(at(s, 'brightness'));
        var v = on ? (b != null ? b / 255 : 1) : 0;
        if (!this._slider.dragging()) {
          this._slider.set(v);
          this._big.textContent = s.state === 'unavailable' ? 'Unavailable' : on ? Math.round(v * 100) + '%' : 'Off';
        }
        var fill = lightFill(s);
        this._slider.fill(fill);
        this._slider.el.classList.toggle('neutral-fill', fill === C.v('track-fill'));
        if (this._sw) this._paintFavs(s);
        if (this._fx) {
          // "off" is HA's no-effect; some lights say "none" or "None" instead
          var e = at(s, 'effect');
          var none = !e || e === 'off' || String(e).toLowerCase() === 'none';
          this._fx.querySelector('.cur').innerHTML = esc(none ? 'None' : e) + CHEV;
        }
      }
      _paintFavs(s) {
        var self = this;
        var favs = favourites(this.client, s, function () { self._favSig = null; self._render(); });
        var sig = JSON.stringify(favs) + '|' + (at(s, 'hs_color') || '') + '|' + at(s, 'color_temp_kelvin') + '|' + at(s, 'color_mode');
        if (sig === this._favSig) return;
        this._favSig = sig;
        var html = favs.map(function (f, i) {
          return '<button data-i="' + i + '" aria-label="Favorite color ' + (i + 1) + '" class="' +
                 (favMatches(f, s) ? 'sel' : '') + '" style="background:' + favCss(f) + '"></button>';
        }).join('') + '<button class="rainbow" aria-label="More colors"></button>';
        this._sw.innerHTML = html;
        this._sw.querySelectorAll('button[data-i]').forEach(function (b) {
          b.addEventListener('click', function () {
            var f = favs[Number(b.getAttribute('data-i'))];
            self._svc('light', 'turn_on', Object.assign({}, f));
          });
        });
        this._sw.querySelector('.rainbow').addEventListener('click', function () { self._go('wheel'); });
      }
      // ---- sub-views
      _buildSub() {
        var self = this, s = this._stateObj, caps = lightCaps(s);
        var sub = document.createElement('div');
        sub.className = 'sub';
        this._pn.appendChild(sub);
        var title = this._view === 'effects' ? 'Effects' : 'Color';
        sub.innerHTML = '<div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">' + title + '</div></div>';
        sub.querySelector('.bk button').addEventListener('click', function () { self._go('main'); });
        if (this._view === 'effects') {
          var list = (at(s, 'effect_list') || []).slice();
          if (list.length > 12) {
            var se = document.createElement('label');
            se.className = 'search';
            se.innerHTML = SEARCH + '<input type="search" placeholder="Search effects" aria-label="Search effects" autocomplete="off">';
            sub.appendChild(se);
            se.querySelector('input').addEventListener('input', function (ev) {
              self._q = ev.target.value;
              self._paintEffects(self._stateObj, true);
            });
          }
          var box = document.createElement('div'), lf = document.createElement('div');
          box.className = 'list'; lf.className = 'hk-edge lf';
          lf.appendChild(box); sub.appendChild(lf);
          C.edges(lf);
          this._list = box;
          this._q = '';
          this._fxSig = null;
          return;
        }
        // the wheel: Colour and/or White
        this._tab = this._tab || (caps.colour ? 'colour' : 'white');
        if (caps.colour && caps.temp) {
          var seg = document.createElement('div');
          seg.className = 'seg';
          seg.innerHTML = '<button data-t="colour">Color</button><button data-t="white">White</button>';
          seg.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function () {
              var was = seg.querySelector('button.sel');
              self._segFrom = was && C.segBox ? C.segBox(was) : null;
              self._tab = b.getAttribute('data-t');
              self._go('wheel');
            });
            b.classList.toggle('sel', b.getAttribute('data-t') === self._tab);
          });
          sub.appendChild(seg);
          // the panel is drawn anew: the white slides from where it was
          if (this._segFrom && C.slideSeg) C.slideSeg(seg.querySelector('button.sel'), this._segFrom);
          this._segFrom = null;
        }
        if (this._tab === 'colour') {
          var w = document.createElement('div');
          w.className = 'wheel';
          w.setAttribute('role', 'slider');
          w.setAttribute('aria-label', 'Color');
          w.innerHTML = '<div class="knob"></div>';
          sub.appendChild(w);
          this._wheel = w;
          var sendHs = throttle(function (hs) { self._svc('light', 'turn_on', { hs_color: hs }); }, 300);
          var pick = function (e) {
            var r = w.getBoundingClientRect(), R = r.width / 2;
            var dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
            var hue = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
            var sat = clamp(Math.sqrt(dx * dx + dy * dy) / R, 0, 1) * 100;
            var hs = [Math.round(hue), Math.round(sat)];
            self._placeKnob(hs);
            sendHs(hs);
          };
          var down = false;
          w.addEventListener('pointerdown', function (e) { e.preventDefault(); down = true; try { w.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } pick(e); });
          w.addEventListener('pointermove', function (e) { if (down) pick(e); });
          w.addEventListener('pointerup', function (e) { if (down) { down = false; pick(e); } });
          w.addEventListener('pointercancel', function () { down = false; });
        } else {
          var lo = num(at(s, 'min_color_temp_kelvin')) || 2000, hi = num(at(s, 'max_color_temp_kelvin')) || 6500;
          var val = document.createElement('div');
          val.className = 'ctv';
          sub.appendChild(val);
          var ct = document.createElement('div');
          ct.className = 'ct';
          ct.setAttribute('role', 'slider');
          ct.setAttribute('aria-label', 'Color temperature');
          var stops = [];
          for (var k = 0; k <= 4; k++) stops.push(css(kelvinRgb(lo + (hi - lo) * k / 4)));
          ct.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
          ct.innerHTML = '<div class="knob"></div>';
          sub.appendChild(ct);
          this._ct = { el: ct, val: val, lo: lo, hi: hi };
          var sendK = throttle(function (kv) { self._svc('light', 'turn_on', { color_temp_kelvin: kv }); }, 300);
          var pickK = function (e) {
            var r = ct.getBoundingClientRect();
            var f = clamp((e.clientX - r.left - 28) / (r.width - 56), 0, 1);
            var kv = Math.round((lo + (hi - lo) * f) / 50) * 50;
            self._placeCt(kv);
            sendK(kv);
          };
          var dn = false;
          ct.addEventListener('pointerdown', function (e) { e.preventDefault(); dn = true; try { ct.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } pickK(e); });
          ct.addEventListener('pointermove', function (e) { if (dn) pickK(e); });
          ct.addEventListener('pointerup', function (e) { if (dn) { dn = false; pickK(e); } });
          ct.addEventListener('pointercancel', function () { dn = false; });
        }
      }
      _placeKnob(hs) {
        if (!this._wheel) return;
        var k = this._wheel.querySelector('.knob');
        var a = hs[0] * Math.PI / 180, r = hs[1] / 100 * 50;
        k.style.left = (50 + Math.sin(a) * r) + '%';
        k.style.top = (50 - Math.cos(a) * r) + '%';
        k.style.background = hsCss(hs);
      }
      _placeCt(kv) {
        var c = this._ct;
        if (!c) return;
        var f = clamp((kv - c.lo) / ((c.hi - c.lo) || 1), 0, 1);
        var k = c.el.querySelector('.knob');
        k.style.left = 'calc(28px + ' + (f * 100) + '% - ' + (f * 56) + 'px)';
        k.style.background = css(kelvinRgb(kv));
        c.val.textContent = kv + ' K';
      }
      _paintWheel(s) {
        // A light that is off (or in a white mode) reports no colour: the
        // marker waits at the white centre rather than a corner of the box.
        if (this._wheel && !this._wheel.matches(':active')) {
          var hs = at(s, 'color_mode') !== 'color_temp' && at(s, 'hs_color');
          this._placeKnob(hs || [0, 0]);
        }
        if (this._ct) {
          var kv = num(at(s, 'color_temp_kelvin'));
          if (kv && !this._ct.el.matches(':active')) this._placeCt(kv);
          else if (!kv && !this._ct.placed) {
            // no reading (off, or in colour): the knob waits mid-strip, and
            // the readout stays blank rather than claim a temperature
            this._placeCt(Math.round((this._ct.lo + this._ct.hi) / 2));
            this._ct.val.textContent = '';
          }
          this._ct.placed = true;
        }
      }
      _paintEffects(s, force) {
        var self = this;
        var cur = at(s, 'effect');
        var q = (this._q || '').toLowerCase();
        var list = (at(s, 'effect_list') || []).filter(function (e) { return !q || String(e).toLowerCase().indexOf(q) !== -1; });
        var sig = cur + '|' + q + '|' + list.length;
        if (!force && sig === this._fxSig) return;
        this._fxSig = sig;
        var tick = TICK;
        // WLED lists its presets first ("Preset: Doorbell"), then a divider
        // line, then the effects: two headed sections, the prefix dropped, and
        // no row for the divider. Anything else is one plain list.
        var presets = [], plain = [];
        list.forEach(function (e) {
          var t = String(e);
          if (/^[\s\u2500-\u257f\-_=\u2014]+$/.test(t)) return;
          if (/^preset:\s*/i.test(t)) presets.push(e); else plain.push(e);
        });
        var row = function (e) {
          var label = String(e).replace(/^preset:\s*/i, '');
          return '<button data-e="' + esc(e) + '"><span>' + esc(label) + '</span>' + (e === cur ? tick : '') + '</button>';
        };
        var html = '';
        if (presets.length) html += '<div class="hd2">Presets</div>' + presets.map(row).join('') + (plain.length ? '<div class="hd2">Effects</div>' : '');
        html += plain.map(row).join('');
        this._list.innerHTML = html || '<div class="muted" style="padding:18px">No effects match</div>';
        this._list.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () { self._svc('light', 'turn_on', { effect: b.getAttribute('data-e') }); });
        });
      }
    }

    // ------------------------------------------------------------ toggle
    class TogglePanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // 150 x 320: the sliders' width, shorter than them (a 440 switch
          // reads as a funny tall pill)
          '.tg{position:relative;width:150px;height:320px;border-radius:75px;border:0;padding:0;',
          '  cursor:pointer;background:rgba(255,255,255,0.16);transition:background .25s;',
          '  -webkit-tap-highlight-color:transparent}',
          '.tg.on{background:#30d158}',
          '.tg .kn{position:absolute;left:12px;right:12px;top:calc(100% - 12px - 126px);height:126px;',
          '  border-radius:63px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,0.25);display:flex;',
          '  align-items:center;justify-content:center;color:rgba(0,0,0,0.35);',
          '  transition:top .28s cubic-bezier(.32,.72,0,1),color .25s}',
          '.tg.on .kn{top:12px;color:#30d158}',
          '.tg[disabled]{opacity:.45;cursor:default}',
          '.since{font-size:16px;color:' + window.hkCards.v('ink-2') + ';min-height:20px}',
          '@media (max-width:' + C.BP.phone + 'px){.tg{width:128px;height:280px;border-radius:64px}',
          '  .tg .kn{height:108px;border-radius:54px;top:calc(100% - 12px - 108px)}.tg.on .kn{top:12px}}'
        ].join('');
      }
      hkWidthKind() { return 'toggle'; }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        var self = this;
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><div class="big"></div><button class="tg" role="switch"><div class="kn">' +
            '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.4 7.4a8 8 0 1 0 11.2 0"/></svg>' +
            '</div></button><div class="since"></div></div>';
          this._tg = this._root.querySelector('.tg');
          this._big = this._root.querySelector('.big');
          this._since = this._root.querySelector('.since');
          this._tg.addEventListener('click', function () { self._toggle(); });
        }
        var on = s.state === 'on';
        this._tg.classList.toggle('on', on);
        this._tg.setAttribute('aria-checked', on ? 'true' : 'false');
        this._tg.setAttribute('aria-label', (this._src.name || at(s, 'friendly_name') || '') + (on ? ' on' : ' off'));
        this._tg.disabled = gone(s);
        this._big.textContent = gone(s) ? 'Unavailable' : s.state === 'unknown' ? 'Unknown' : on ? 'On' : 'Off';
        this._since.textContent = unavailable(s) ? '' : sinceText(s.last_changed);
      }
      _toggle() {
        var self = this, s = this._stateObj;
        var go = function () { self._svc('homeassistant', 'toggle'); };
        var conf = this._src.confirmation;
        if (conf && C.confirmSheet) C.confirmSheet(conf.text || ('Turn ' + (s.state === 'on' ? 'off' : 'on') + '?'), go);
        else go();
      }
    }

    // ------------------------------------------------------------ fan
    class FanPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // 16, not 20 (the phone's SP.piecePhone, 2026-10-12: measured): the
          // word, its percentage, the 420 slider and a guard chip only fit
          // the one sheet height at 16
          '.pn{gap:16px}',
          '.rd{text-align:center}',
          '.pct{font-size:16px;color:' + window.hkCards.v('ink-2') + ';margin-top:6px;min-height:20px;font-variant-numeric:tabular-nums}',
          '.vs{height:420px}',
          '.wrap{position:relative}',
          '.names{position:absolute;left:calc(100% + 16px);top:0;bottom:0;width:max-content;pointer-events:none}',
          '.names span{position:absolute;left:0;transform:translateY(50%);font-size:15px;',
          '  color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;transition:color .15s}',
          '.names span.cur{color:' + window.hkCards.v('ink') + ';font-weight:600}',
          '.guard{display:flex;align-items:center;gap:10px;height:40px;padding:0 5px 0 14px;',
          '  border-radius:20px;background:rgba(255,179,64,0.16);color:#FFB340;font-size:15px;font-weight:600}',
          '.guard button{height:30px;padding:0 13px;border:0;border-radius:15px;font:inherit;font-size:13px;',
          '  font-weight:600;color:' + window.hkCards.v('ink') + ';background:rgba(255,255,255,0.16);cursor:pointer}',
          '@media (max-width:' + C.BP.phone + 'px){.names{left:calc(100% + 12px)}.names span{font-size:14px}.vs{height:340px}}'
        ].join('');
      }
      hkWidthKind() { return 'fan'; }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var n = fanSteps(s);
        if (!this._built || this._n !== n) {
          this._built = true;
          this._n = n;
          this._root.innerHTML = '<div class="pn"><div class="rd"><div class="big"></div><div class="pct"></div></div>' +
            '<div class="wrap"></div><div class="gslot"></div></div>';
          this._big = this._root.querySelector('.big');
          this._pct = this._root.querySelector('.pct');
          var send = throttle(function (v) {
            if (v <= 0) self._svc('fan', 'turn_off');
            else self._svc('fan', 'set_percentage', { percentage: Math.round(v * 100) });
          }, 400);
          var steps = n <= 10 ? n : 0;
          this._slider = this._vslider({
            label: 'Speed', steps: steps,
            glyph: glyph(this._src.icon || 'hk:fan', 32),
            onInput: function (v) { self._big.textContent = fanLabel(v * 100, n, v > 0); self._pct.textContent = self._pctText(v * 100, v > 0); },
            onChange: function (v) { self._big.textContent = fanLabel(v * 100, n, v > 0); self._pct.textContent = self._pctText(v * 100, v > 0); send(v); }
          });
          var wrap = this._root.querySelector('.wrap');
          wrap.appendChild(this._slider.el);
          if (SPEED_NAMES[n]) {
            var names = document.createElement('div');
            names.className = 'names';
            names.innerHTML = SPEED_NAMES[n].map(function (nm, i) {
              // each speed's name at the middle of its band
              return '<span data-i="' + (i + 1) + '" style="bottom:' + ((i + 0.5) / n * 100) + '%">' + nm + '</span>';
            }).join('');
            wrap.appendChild(names);
            this._names = names;
          }
          this._gslot = this._root.querySelector('.gslot');
          if (!this._tickT) this._tickT = setInterval(function () { self._paintGuard(); }, 30000);
        }
        var on = s.state === 'on', na = this._na(s);
        var pct = on ? (num(at(s, 'percentage')) || 0) : 0;
        if (!this._slider.dragging()) {
          this._slider.set(pct / 100);
          this._big.textContent = na ? 'Unavailable' : fanLabel(pct, n, on);
          this._pct.textContent = na ? '' : this._pctText(pct, on);
        }
        if (this._names) {
          var ci = on ? clamp(Math.round(pct / (100 / n)), 1, n) : 0;
          this._names.querySelectorAll('span').forEach(function (sp) {
            sp.classList.toggle('cur', Number(sp.getAttribute('data-i')) === ci);
          });
        }
        this._paintGuard();
      }
      // the speed as a number under its name ("Medium" / "50%"); a fan with
      // no named steps already reads as a percentage, so it says nothing more
      _pctText(pct, on) {
        if (!on || !pct) return '';
        return SPEED_NAMES[this._n] ? Math.round(pct) + '%' : '';
      }
      _sigOf() {
        var h = this.client, id = this._id;
        if (!h || !id) return null;
        var a = h.states[id], g = h.states[fanGuard(id)];
        return (a ? a.last_updated : 'x') + '|' + (g ? g.last_updated : 'x');
      }
      _paintGuard() {
        var h = this.client, slot = this._gslot, self = this;
        if (!h || !slot) return;
        var g = h.states[fanGuard(this._id)];
        if (!g || g.state !== 'active') { slot.innerHTML = ''; return; }
        var fin = at(g, 'finishes_at') ? Date.parse(at(g, 'finishes_at')) : NaN;
        var mins = isFinite(fin) ? Math.max(1, Math.ceil((fin - Date.now()) / 60000)) : null;
        slot.innerHTML = '<div class="guard"><span>Automations paused' + (mins ? ' · ' + mins + ' min' : '') +
                         '</span><button>Cancel</button></div>';
        slot.querySelector('button').addEventListener('click', function () {
          self._call('timer', 'cancel', { entity_id: fanGuard(self._id) });
        });
      }
    }

    // ------------------------------------------------------------ cover
    var ICON_PATH = {
      up: 'M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z',
      down: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
      stop: 'M8 8h8v8H8z'
    };
    function svgIcon(path, size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + path + '"/></svg>';
    }
    class CoverPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // THE SHADE ITSELF: the track is the fabric (slats from the top),
          // the fill is the window it uncovers, the handle is the shade's edge.
          '.vs.shade{background:repeating-linear-gradient(180deg,#e7e1d4 0,#e7e1d4 22px,#cfc6b3 22px,#cfc6b3 24px)}',
          '.vs.shade .fill{background:linear-gradient(180deg,#7f9fc6,#56779f)}',
          '.vs.shade .fill::before{content:"";position:absolute;left:50%;top:-3px;width:52px;height:6px;',
          '  margin-left:-26px;border-radius:3px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,0.4)}',
          '.vs.shade .gl{display:none}',
          '.vs.shade{height:' + SLIDER_H.full + 'px}',
          '.btns{display:flex;gap:12px;justify-content:center}',
          '.btns .btn{width:76px;padding:0}',
          '.btns.wide{align-self:stretch}',
          '.btns.wide .btn{flex:1;width:auto;gap:6px}',
          '.state{width:220px;height:220px;border-radius:110px;display:flex;align-items:center;',
          '  justify-content:center;background:rgba(255,255,255,0.10);color:rgba(255,255,255,0.85)}',
          '.state.open{background:rgba(86,189,228,0.22);color:#56bde4}',
          '@media (max-width:' + C.BP.phone + 'px){.state{width:180px;height:180px;border-radius:90px}.vs.shade{height:' + SLIDER_H.phone + 'px}',
          '  .btns .btn{width:68px}}'
        ].join('');
      }
      hkWidthKind(h, s) { return ((num(at(s, 'supported_features')) || 0) & 4) ? 'cover' : 'cover_buttons'; }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var f = num(at(s, 'supported_features')) || 0;
        var hasPos = !!(f & 4);
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><div class="big"></div><div class="ctl"></div><div class="btns"></div></div>';
          this._big = this._root.querySelector('.big');
          var ctl = this._root.querySelector('.ctl');
          if (hasPos) {
            var send = throttle(function (v) {
              self._svc('cover', 'set_cover_position', { position: Math.round(v * 100) });
            }, 500);
            this._slider = this._vslider({
              label: 'Position',
              onInput: function (v) { self._big.textContent = self._posText(Math.round(v * 100)); },
              onChange: function (v) { self._big.textContent = self._posText(Math.round(v * 100)); send(v); }
            });
            this._slider.el.classList.add('shade');
            ctl.appendChild(this._slider.el);
          } else {
            ctl.innerHTML = '<div class="state">' + glyph(this._src.icon || 'hk:blinds-horizontal', 88) + '</div>';
            this._stateEl = ctl.firstChild;
          }
          var btns = this._root.querySelector('.btns');
          if (!hasPos) btns.classList.add('wide');
          var defs = [];
          if (f & 1) defs.push(['open_cover', 'Open', ICON_PATH.up]);
          if (f & 8) defs.push(['stop_cover', 'Stop', ICON_PATH.stop]);
          if (f & 2) defs.push(['close_cover', 'Close', ICON_PATH.down]);
          btns.innerHTML = defs.map(function (d) {
            return '<button class="btn" data-s="' + d[0] + '" aria-label="' + d[1] + '">' + svgIcon(d[2], 24) +
                   (hasPos ? '' : '<span>' + d[1] + '</span>') + '</button>';
          }).join('');
          btns.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function () { self._svc('cover', b.getAttribute('data-s')); });
          });
        }
        var na = this._na(s), pos = num(at(s, 'current_position'));
        if (hasPos) {
          if (!this._slider.dragging()) {
            // no position reported: the end its state names, else nothing to
            // claim -- an unavailable shade must not read "Open" at 100 %
            var p = pos != null ? pos : s.state === 'closed' ? 0 : s.state === 'open' ? 100 : null;
            this._slider.set((p || 0) / 100);
            this._big.textContent = na ? 'Unavailable' : p == null ? '—' : this._posText(p);
          }
        } else {
          var st = s.state;
          this._big.textContent = na ? 'Unavailable' : st === 'unknown' ? '—' :
            ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' })[st] || st;
          if (this._stateEl) this._stateEl.classList.toggle('open', st === 'open' || st === 'opening');
        }
      }
      _posText(p) { return p <= 0 ? 'Closed' : p >= 100 ? 'Open' : p + '% open'; }
    }

    // ------------------------------------------------------------ lock + garage
    // THE HOLD RING. A door that lets someone in is opened by a hold: the ring
    // fills over a second, let go early and nothing happens, so a mis-tap on a
    // wall tablet never opens a door. Securing it again is a tap. The lock and
    // the garage are two specs on one panel so they look and behave the same.
    var HOLD_MS = 1000;
    class RingPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // 264: a little over 236 (360 is far too big)
          '.lk{position:relative;width:264px;height:264px;border-radius:132px;border:0;padding:0;',
          '  cursor:pointer;background:rgba(48,209,88,0.16);display:flex;align-items:center;',
          '  justify-content:center;-webkit-tap-highlight-color:transparent;touch-action:none;',
          '  -webkit-user-select:none;user-select:none}',
          '.lk svg.ring{position:absolute;inset:0;pointer-events:none}',
          '.lk .trk{fill:none;stroke:rgba(255,255,255,0.12);stroke-width:8}',
          '.lk .prg{fill:none;stroke:#30d158;stroke-width:8;stroke-linecap:round;',
          '  stroke-dasharray:703.7;stroke-dashoffset:703.7;transition:stroke-dashoffset .25s ease}',
          '.lk.holding .prg{stroke-dashoffset:0;transition:stroke-dashoffset ' + HOLD_MS + 'ms linear}',
          '.lk .core{width:192px;height:192px;border-radius:96px;background:#30d158;display:flex;',
          '  align-items:center;justify-content:center;color:#fff;transition:background .25s,transform .15s}',
          '.lk:active .core{transform:scale(.97)}',
          '.lk.open{background:rgba(255,159,10,0.16)}',
          '.lk.open .core{background:#ff9f0a}',
          '.lk.open .prg{stroke:#ff9f0a}',
          '.lk.busy .core{animation:hkd-pulse 1.1s ease-in-out infinite}',
          '.lk.bad{background:rgba(255,69,58,0.16)}.lk.bad .core{background:#ff453a}',
          // tone "water": blue when it runs, grey when it is shut (the Home app's valve)
          // the palette's blue (the header well's), not iOS system blue
          '.lk.water{background:rgba(86,189,228,0.16)}.lk.water .core{background:#56bde4}.lk.water .prg{stroke:#56bde4}',
          '.lk.water.shut{background:rgba(255,255,255,0.08)}.lk.water.shut .core{background:rgba(255,255,255,0.22)}',
          '@keyframes hkd-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
          '.big.lkt{font-size:38px}',
          '.hint{font-size:16px}',
          '@media (max-width:' + C.BP.phone + 'px){.lk{width:228px;height:228px;border-radius:114px}',
          '  .lk .core{width:166px;height:166px;border-radius:83px}.big.lkt{font-size:32px}}',
          '@media (prefers-reduced-motion:reduce){.lk.busy .core{animation:none}}'
        ].join('');
      }
      // spec(st) -> { word, glyph, hint, label, open, busy, bad,
      //               hold: [domain, service] | null, tap: [domain, service] | null, ask }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><button class="lk">' +
            '<svg class="ring" viewBox="0 0 236 236" aria-hidden="true"><circle class="trk" cx="118" cy="118" r="112"/>' +
            '<circle class="prg" cx="118" cy="118" r="112" transform="rotate(-90 118 118)"/></svg>' +
            '<div class="core"></div></button><div class="big lkt"></div><div class="muted hint"></div></div>';
          var b = this._lk = this._root.querySelector('.lk');
          this._core = this._root.querySelector('.core');
          this._big = this._root.querySelector('.big');
          this._hint = this._root.querySelector('.hint');
          // ONE PRESS, ONE ACTION, DECIDED WHEN THE FINGER LANDS.
          // Reading the spec again on release means a hold that outlasts the
          // device's answer does the OPPOSITE on the way up: the lock reports
          // unlocked under the finger and letting go locks it again; the
          // garage reads open and letting go sends close_cover -- a relay
          // pulse, which stops a moving door. So a press keeps the spec it
          // landed on. A hold spec never taps: let go early and nothing
          // happens, and once the hold has fired the release does nothing.
          var press = null;
          var call = function (a) { if (a) self._svc(a[0], a[1]); };
          // the device is still where the press found it (nobody else moved
          // it meanwhile): the same hold is still the one on offer
          var still = function (a) {
            var now = self._stateObj, sp = now && self.spec(now);
            return !!(sp && sp.hold && sp.hold[1] === a[1]);
          };
          var cancel = function () {
            if (press) clearTimeout(press.timer);
            press = null;
            b.classList.remove('holding');
          };
          b.addEventListener('pointerdown', function (e) {
            var st = self._stateObj, sp = st && self.spec(st);
            if (!sp || (!sp.hold && !sp.tap)) return;
            e.preventDefault();
            try { b.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
            cancel();
            var p = press = { sp: sp, timer: null, fired: false };
            if (!sp.hold) return;
            b.classList.add('holding');
            p.timer = setTimeout(function () {
              p.timer = null;
              p.fired = true;
              b.classList.remove('holding');
              if (still(p.sp.hold)) call(p.sp.hold);
            }, HOLD_MS);
          });
          b.addEventListener('pointerup', function () {
            var p = press;
            cancel();
            if (!p || p.fired || p.sp.hold) return;
            call(p.sp.tap);
          });
          b.addEventListener('pointercancel', cancel);
          b.addEventListener('pointerleave', function () { if (press && press.timer) cancel(); });
          b.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            var st = self._stateObj, sp = st && self.spec(st);
            if (!sp) return;
            // the keyboard cannot hold, so it asks -- and sends only if the
            // device is still where the question found it
            if (sp.hold) C.confirmSheet(sp.ask, function () { if (still(sp.hold)) call(sp.hold); });
            else call(sp.tap);
          });
        }
        var sp = this.spec(s);
        this._lk.classList.toggle('open', !!sp.open);
        this._lk.classList.toggle('busy', !!sp.busy);
        this._lk.classList.toggle('bad', !!sp.bad);
        this._lk.classList.toggle('water', sp.tone === 'water');
        this._lk.classList.toggle('shut', !!sp.shut);
        if (this._glyph !== sp.glyph) { this._glyph = sp.glyph; this._core.innerHTML = glyph(sp.glyph, 80); }
        this._big.textContent = sp.word;
        this._hint.textContent = sp.hint || '';
        this._lk.setAttribute('aria-label', sp.label || sp.word);
      }
      _who(st, fallback) { return (this._src && this._src.name) || at(st, 'friendly_name') || fallback; }
    }

    class LockPanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      spec(s) {
        var st = s.state;
        var locked = st === 'locked', open = st === 'unlocked' || st === 'open';
        var jammed = st === 'jammed', bad = jammed || gone(s), unsure = st === 'unknown';
        return {
          word: bad ? (jammed ? 'Jammed' : 'Unavailable') : unsure ? 'Unknown' :
            ({ locked: 'Locked', unlocked: 'Unlocked', locking: 'Locking…', unlocking: 'Unlocking…', open: 'Open', opening: 'Opening…' })[st] || st,
          glyph: open || st === 'unlocking' ? 'hk:lock-open-variant' : 'hk:lock',
          open: open || st === 'unlocking', busy: st === 'locking' || st === 'unlocking' || st === 'opening', bad: bad,
          hold: locked ? ['lock', 'unlock'] : null,
          // JAMMED: try locking again, the safe direction -- HA's dialog is
          // not reachable from here, so this is the only retry there is
          // (not knowing either: locking is the safe way to find out)
          tap: open || jammed || unsure ? ['lock', 'lock'] : null,
          hint: locked ? 'Hold to unlock' : open || jammed || unsure ? 'Tap to lock' : '',
          label: locked ? 'Hold to unlock' : 'Lock',
          ask: 'Unlock ' + this._who(s, 'the door') + '?'
        };
      }
    }

    // A DOOR COVER -- a garage, a gate, a car's frunk or charge port -- is a
    // door too: hold to open, tap to close, and while it moves a tap stops it
    // (when the opener can stop).
    class GaragePanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      spec(s) {
        var st = s.state, f = num(at(s, 'supported_features')) || 0;
        var moving = st === 'opening' || st === 'closing';
        var stop = moving && (f & 8) ? ['cover', 'stop_cover'] : null;
        var bad = gone(s), door = at(s, 'device_class') === 'door', unsure = st === 'unknown';
        var shut = st === 'closed' || st === 'closing';
        return {
          word: bad ? 'Unavailable' : unsure ? 'Unknown' : ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' })[st] || st,
          glyph: door ? (shut ? 'hk:door-closed' : 'hk:door-open') : shut ? 'hk:garage-variant' : 'hk:garage-open-variant',
          open: st === 'open' || st === 'opening', busy: moving, bad: bad,
          // (not knowing: a tap closes, the safe way -- a ring with a hold
          // takes no tap, so not both)
          hold: st === 'closed' && (f & 1) ? ['cover', 'open_cover'] : null,
          tap: (st === 'open' || unsure) && (f & 2) ? ['cover', 'close_cover'] : stop,
          hint: st === 'closed' ? 'Hold to open' : st === 'open' || (unsure && (f & 2)) ? 'Tap to close' : stop ? 'Tap to stop' : '',
          label: st === 'closed' ? 'Hold to open' : st === 'open' || (unsure && (f & 2)) ? 'Close' : stop ? 'Stop' : '',
          ask: 'Open ' + this._who(s, door ? 'the door' : 'the garage') + '?'
        };
      }
    }

    // A BUTTON -- a computer's Wake on LAN, an input_button -- is the lock's
    // ring with one tap and no hold: it has no state to protect, and pressing
    // it twice only sends the packet twice. Its state is the time it was
    // last pressed, so the ring pulses "Sent" for a moment after a press
    // and the line under it says when that was.
    var SENT_MS = 4000;
    class ButtonPanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      _wakes() {
        var s = this._stateObj;
        return /wake[\s_-]*on[\s_-]*lan/i.test(String(this._id) + ' ' + String(at(s, 'friendly_name') || ''));
      }
      spec(s) {
        // 'unknown' is a button never pressed since Home Assistant started --
        // not a dead one: only 'unavailable' is
        var bad = !s || s.state === 'unavailable', wake = this._wakes();
        var t = Date.parse(s.state), sent = isFinite(t) && Date.now() - t < SENT_MS && Date.now() >= t - 2000;
        return {
          word: bad ? 'Unavailable' : sent ? (wake ? 'Waking…' : 'Sent') : wake ? 'Wake' : 'Press',
          glyph: this._src.icon || at(s, 'icon') || (wake ? 'hk:desktop-tower' : 'mdi:gesture-tap-button'),
          busy: sent, bad: bad,
          tap: bad ? null : [domainOf(this._id), 'press'],
          hint: bad ? '' : lastText(s.state, wake),
          label: wake ? 'Wake ' + this._who(s, 'the computer') : 'Press ' + this._who(s, 'the button')
        };
      }
      _render() {
        super._render();
        // the pulse ends by itself: no state change comes to end it
        var s = this._stateObj, t = s ? Date.parse(s.state) : NaN, left = t + SENT_MS - Date.now(), self = this;
        clearTimeout(this._sentT);
        if (isFinite(left) && left > 0 && left <= SENT_MS) this._sentT = setTimeout(function () { self._render(); }, left + 50);
      }
      disconnectedCallback() { clearTimeout(this._sentT); if (super.disconnectedCallback) super.disconnectedCallback(); }
    }
    // "Last woken 9:14 PM" today, "Last woken Oct 1, 9:14 PM" before that
    function lastText(iso, wake) {
      var t = Date.parse(iso), verb = wake ? 'Last woken ' : 'Last pressed ';
      if (!isFinite(t)) return wake ? 'Tap to wake' : 'Tap to press';
      var d = new Date(t), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (d.toDateString() === new Date().toDateString()) return verb + time;
      return verb + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
    }

    // ------------------------------------------------------------ climate
    // The home's own thermostat card (hk-thermostat-card) in `bare` mode --
    // the dial, modes and fan exactly as on the Climate page -- plus the
    // reading around it and the day's trend.
    var RUNNING = { heating: 1, cooling: 1 };
    // rows: HA's compressed history ({s, a, lu}); live: the current state,
    // which covers the time since the last recorded row -- from its own
    // last_updated when that is newer, so a start or stop after the fetch
    // counts from when it happened, not from the next fetch.
    function runTimes(rows, now, live) {
      var mid = new Date(now); mid.setHours(0, 0, 0, 0);
      var tMid = +mid;
      var yd = new Date(tMid); yd.setDate(yd.getDate() - 1);
      var yMid = +yd;   // setDate, not minus 24 h: a DST day is 23 or 25 hours
      var pts = rows.map(function (r) {
        return { t: (r.lu || r.lc || 0) * 1000, on: !!(r.a && RUNNING[r.a.hvac_action]) };
      }).filter(function (p) { return p.t; });
      if (live) {
        var lt = Date.parse(live.last_updated), last = pts.length ? pts[pts.length - 1].t : 0;
        pts.push({ t: isFinite(lt) && lt > last && lt < now ? lt : now, on: !!RUNNING[at(live, 'hvac_action')] });
      }
      var today = 0, yesterday = 0;
      for (var i = 0; i < pts.length; i++) {
        if (!pts[i].on) continue;
        var a = pts[i].t, b = i + 1 < pts.length ? pts[i + 1].t : now;
        today += Math.max(0, Math.min(b, now) - Math.max(a, tMid));
        yesterday += Math.max(0, Math.min(b, tMid) - Math.max(a, yMid));
      }
      return { today: today / 1000, yesterday: yesterday / 1000 };
    }
    // Does this thermostat say what it is doing at all? A water heater or a
    // car's climate entity never reports hvac_action, and its run time would
    // read "0 min" every day.
    function reportsAction(rows, live) {
      return at(live, 'hvac_action') != null ||
        !!(rows && rows.some(function (r) { return r.a && r.a.hvac_action != null; }));
    }
    // THE TREND IS THE THERMOSTAT'S OWN READING: current_temperature in the
    // rows the run time already fetched -- no second request, and not the
    // home's temperature sensor (features.temperature, which may be a mean
    // of several thermostats and says nothing about a water heater or a car).
    // the wide sheet's dial column, shared by the thermostat and the water heater:
    // the ring as wide as its buttons, bigger digits and rows
    var TSTAT_WIDE = 'width:400px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;' +
      '--hk-tstat-ring:100%;--hk-tstat-val:58px;--hk-tstat-gap:22px;--hk-tstat-seg:44px;--hk-tstat-seg-font:14px;' +
      '--hk-tstat-fan-gap:10px;--hk-tstat-fan:38px;--hk-tstat-fan-font:13px';
    function trendOf(rows, now, live) {
      var pts = rows.map(function (r) {
        return { t: (r.lu || r.lc || 0) * 1000, v: num(r.a && r.a.current_temperature) };
      });
      return spanTo(pts, now - 24 * 3600000, now, num(at(live, 'current_temperature')));
    }
    function dur(sec) {
      var m = Math.round(sec / 60);
      if (m < 60) return m + ' min';
      var hh = Math.floor(m / 60), mm = m % 60;
      return hh + ' hr' + (mm ? ' ' + mm + ' min' : '');
    }
    class ClimatePanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // 12 (SP.block): the run-time row has to fit an 800 px tablet with margin
          '.pn{gap:12px}',
          // narrow (a phone): one column -- .side dissolves into it
          '.side{display:contents}',
          '.dial{align-self:stretch;display:flex;justify-content:center}',
          // full width, so the mode and fan rows share their edges with the
          // reading card below (the ring itself stays 300 px, centred)
          '.dial > *{width:100%}',
          // each reading centred in its third
          '.now{align-self:stretch;display:flex;flex-direction:column;gap:12px;',
          '  padding:12px 18px;border-radius:20px;background:rgba(255,255,255,0.08);text-align:center}',
          '.now .rd{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
          '.now .k{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
          '.now .v{font-size:19px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}',
          // RUN TIME, today and yesterday: the second row of the same card,
          // two halves under a hairline
          '.now .run{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;',
          '  padding-top:12px;border-top:1px solid rgba(255,255,255,0.10)}',
          '.trend{align-self:stretch;padding:12px 16px 8px;border-radius:20px;background:rgba(255,255,255,0.08)}',
          '.trend .t{font-size:13px;font-weight:600;letter-spacing:0.3px;color:' + window.hkCards.v('ink-2') + ';',
          '  text-transform:uppercase;margin-bottom:6px}',
          '@media (max-width:' + C.BP.phone + 'px){.now{padding:12px 14px;gap:10px}.now .rd,.now .run{gap:8px}',
          '  .now .run{padding-top:10px}.now .v{font-size:17px}}',
          // WIDE: the dial, modes and fan on the left; the readings,
          // run time and trend on the right, as tall as the left -- the right
          // column stretches and its trend card takes the difference, so the
          // tops line up and so do the bottoms. :host([wide]) -- see _wideAt.
          ':host([wide]) .pn{flex-direction:row;align-items:stretch;gap:28px}',
          // THE DIAL AS WIDE AS ITS BUTTONS (not 102 px empty above and
          // below): a 400 px column, the ring filling it, bigger digits and
          // rows, more air between them -- the card's --hk-tstat-* sizes
          ':host([wide]) .dial{' + TSTAT_WIDE + '}',
          ':host([wide]) .side{display:flex;flex-direction:column;gap:12px;flex:1;min-width:0}',
          ':host([wide]) .now{background:none;padding:0;gap:14px}',
          ':host([wide]) .now .rd,:host([wide]) .now .run{padding:' + SP.rowsPad + ';border-radius:20px;background:rgba(255,255,255,0.08)}',
          ':host([wide]) .now .run{border-top:0}',
          ':host([wide]) .trend{flex:1;display:flex;flex-direction:column;padding:' + SP.cardPad + ';min-height:0}',
          // the chart takes whatever height is left, so the right column is
          // exactly as tall as the dial column: tops AND bottoms line up
          ':host([wide]) .trend .axc{flex:1;min-height:72px;margin-top:8px}',
          ':host([wide]) .trend .t{margin-bottom:0}'
        ].join('');
      }
      hkWidthKind() { return 'climate'; }
      _wideAt() { return 700; }
      // the trend is drawn for one width (fluid and five times, or fixed and
      // three): redraw it for the other, and realign the columns
      _onWide() { this._trendKey = null; this._paintRuns(); this._alignTop(); }
      // RUN TIME: seconds heating or cooling since midnight, and all of
      // yesterday, from the thermostat's own hvac_action history (any home,
      // no helper sensors). Fetched every 5 minutes; "today" is re-added up
      // to now every minute, so a running system counts up. The same rows
      // carry current_temperature, which is the trend.
      _runs() {
        var self = this, h = this.client, id = this._id, now = Date.now();
        if (h && h.callWS && (!this._runAt || now - this._runAt > 300000)) {
          this._runAt = now;
          var y = new Date(); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - 1);
          h.callWS({ type: 'history/history_during_period', start_time: y.toISOString(), entity_ids: [id],
                     minimal_response: false, no_attributes: false, significant_changes_only: false })
            .then(function (r) { self._runRows = (r && r[id]) || []; self._paintRuns(); },
                  function () { self._runAt = 0; });
        }
        this._paintRuns();
      }
      _paintRuns() {
        var rt = this._root.querySelector('.rt'), ry = this._root.querySelector('.ry');
        var run = this._root.querySelector('.run');
        if (!rt) return;
        var rows = this._runRows, live = this._stateObj, now = Date.now();
        var reports = reportsAction(rows, live);
        run.hidden = !reports;
        if (!rows) return;
        if (reports) {
          var t = runTimes(rows, now, live);
          rt.textContent = dur(t.today);
          ry.textContent = dur(t.yesterday);
        }
        // redrawn when the rows or the reading move, not on every minute's tick
        var key = rows.length + '|' + (rows.length ? rows[rows.length - 1].lu : '') + '|' + at(live, 'current_temperature');
        if (!window.hkChart || key === this._trendKey) return;
        var pts = trendOf(rows, now, live);
        if (pts.length < 2) return;
        this._trendKey = key;
        this._trend.hidden = false;
        // the wide sheet's trend is a real chart with both axes; a phone's is
        // shorter with three times
        var wide = this.hasAttribute('wide');
        this._trend.innerHTML = '<div class="t">Inside, last 24 hours</div>' +
          axesChart({ pts: downsample(pts, 240), H: wide ? 120 : 96, unit: '°', ms: 24 * 3600000, n: wide ? 5 : 3,
                      colour: 'orange', fluid: wide });
        scrub(this._trend);
        this._alignTop();
      }
      // THE RIGHT COLUMN STARTS WHERE THE DIAL IS SEEN TO START. The dial
      // card's ring has empty space above its track (the track's top is
      // y = 100 - 78 - 11 of a 172-high viewBox: ~16 px on a 300 px ring), so
      // "both columns start at the card's top" still read as the readings
      // sitting higher than the dial. Measured from the ring itself, so it
      // follows the card if its geometry changes; wide layout only.
      _alignTop() {
        var side = this._root.querySelector('.side'), card = this._card;
        if (!side || !side.style) return;
        var ring = card && card.shadowRoot && card.shadowRoot.querySelector('svg.ring');
        if (!this.hasAttribute('wide') || !ring || !ring.getBoundingClientRect) { side.style.marginTop = ''; return; }
        var rr = ring.getBoundingClientRect(), cr = card.getBoundingClientRect();
        if (!rr.height) return;
        var inset = rr.top - cr.top + rr.height * (100 - 78 - 11) / 172;
        side.style.marginTop = Math.max(0, Math.round(inset)) + 'px';
      }
      _sigOf() {
        var h = this.client, id = this._id;
        if (!h || !id) return null;
        var a = h.states[id], w = h.states[this._wx()];
        return (a ? a.last_updated : 'x') + '|' + (w ? w.last_updated : '');
      }
      _wx() { return (C.setting && C.setting('weather.entity', null)) || ''; }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        var h = this.client;
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><div class="dial"></div><div class="side"><div class="now"><div class="rd"></div>' +
            '<div class="run"><div><div class="k">Ran today</div><div class="v rt">—</div></div>' +
            '<div><div class="k">Yesterday</div><div class="v ry">—</div></div></div></div><div class="trend" hidden></div></div></div>';
          var card = document.createElement('hk-thermostat-card');
          try { card.setConfig({ entity: this._id, bare: true, glass: false }); } catch (e) { /* not ready */ }
          this._card = card;
          this._root.querySelector('.dial').appendChild(card);
          this._now = this._root.querySelector('.now .rd');
          this._trend = this._root.querySelector('.trend');
          // a running system's "today" grows while the sheet is open
          var self = this;
          this._tickT = setInterval(function () { self._runs(); }, 60000);
        }
        // the thermostat card gets what goes with the client (the host adapter decides)
        if (this._card) bridge(this._card, h);
        this._alignTop();
        var a = s.attributes || {};
        var wx = stOf(h, this._wx());
        var out = wx && at(wx, 'temperature') != null ? Math.round(at(wx, 'temperature')) + '°' : '—';
        var cur = a.current_temperature != null ? Math.round(a.current_temperature) + '°' : '—';
        var hum = a.current_humidity != null ? Math.round(a.current_humidity) + '%' : '—';
        this._now.innerHTML = '<div><div class="k">Inside</div><div class="v">' + cur + '</div></div>' +
          '<div><div class="k">Humidity</div><div class="v">' + hum + '</div></div>' +
          '<div><div class="k">Outside</div><div class="v">' + out + '</div></div>';
        this._runs();
      }
    }

    // ------------------------------------------------------------ media
    // THE PLAY MUSIC PAGE'S PLAYER: framed artwork, title, artist and album,
    // the "playing on" line, the progress bar, plain transport icons, and the
    // thin volume slider in the playlist accent. A speaker adds Browse Music;
    // a TV adds an Input list (same pattern as a light's effects) and a power
    // button.
    var ACCENT = '#b25bd9';
    var MF = { PAUSE: 1, VOLUME_SET: 4, PREV: 16, NEXT: 32, VOLUME_STEP: 1024, PLAY: 16384 };
    function isTv(s) {
      var a = s.attributes || {}, oid = String(s.entity_id).split('.')[1] || '';
      if (a.device_class === 'tv') return true;
      if (a.device_class === 'speaker' || a.mass_player_type) return false;
      return /(^|_)(tv|apple_tv|roku|webos)(_|$)/.test(oid) || (Array.isArray(a.source_list) && a.source_list.length > 0 && /tv/.test(oid));
    }
    function clock(sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
      return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }
    // The view to Browse Music on: the setting, if this dashboard has it.
    function browseView() {
      var v = C.setting ? C.setting('look.browse_view', 'music-browse') : 'music-browse';
      if (!v) return null;
      // cannot tell (null): offer it
      return hasView(v) === false ? null : v;
    }
    class MediaPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // INSET AND TIGHT: the player's text and controls sit 20 px
          // in from the sheet's padding, 12 apart; the TV's picture comes in
          // with them, the speaker's cover is centred anyway
          '.pl{align-self:stretch;display:flex;flex-direction:column;gap:12px;margin:0 20px}',
          '.art{align-self:center;box-sizing:border-box;border-radius:16px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.24);',
          '  background:linear-gradient(135deg,#3a3a40,#6e6e76);display:flex;align-items:center;justify-content:center;',
          // 260, not 280: with the title, times and Browse Music the player
          // measures 581 px against the 568 a 680 sheet has
          '  color:rgba(255,255,255,0.7);width:260px;height:260px;flex-shrink:0}',
          // .ab: one box per picture (see _paint), so a stale one's fallback
          // can only ever reach its own box
          '.art .ab{width:100%;height:100%;display:flex;align-items:center;justify-content:center}',
          '.art img{width:100%;height:100%;object-fit:cover;display:block}',
          '.art.tv{width:100%;height:auto;aspect-ratio:16/9}',
          '.ti{font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ar{font-size:15px;color:' + window.hkCards.v('ink-2') + ';margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.on{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:' + window.hkCards.v('ink-3') + '}',
          '.pg{height:4px;border-radius:2px;background:rgba(255,255,255,0.22);overflow:hidden}',
          '.pg i{display:block;height:100%;width:0;background:#fff;border-radius:2px}',
          '.tm{display:flex;justify-content:space-between;font-size:12px;color:' + window.hkCards.v('ink-2') + ';',
          '  margin-top:6px;font-variant-numeric:tabular-nums}',
          '.tp{display:flex;justify-content:center;align-items:center;gap:44px}',
          '.tp button{width:52px;height:52px;border:0;border-radius:26px;background:transparent;color:#fff;',
          '  display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
          '.tp button:active{background:rgba(255,255,255,0.12)}',
          '.tp button[disabled]{opacity:.3;cursor:default}',
          '.tp .pp{width:60px;height:60px;border-radius:30px}',
          '.vol{position:relative;height:28px;touch-action:none;cursor:pointer;margin:0 2px}',
          '.vol .t{position:absolute;left:0;right:0;top:11px;height:6px;border-radius:3px;background:rgba(255,255,255,0.28)}',
          '.vol .f{position:absolute;left:0;top:11px;height:6px;border-radius:3px;background:' + ACCENT + '}',
          '.vol .k{position:absolute;top:0;width:28px;height:28px;margin-left:-14px;border-radius:14px;background:#fff;',
          '  box-shadow:0 1px 6px rgba(0,0,0,0.3)}',
          // a player that steps its volume but never reports a level (an Apple TV
          // driving the receiver): a slider could only guess, so down and up
          '.vst{display:flex;align-items:center;justify-content:center;gap:28px;height:44px}',
          // THE VOLUME ROW SITS HALFWAY between the transport and the row under
          // it, with equal space above and below. What is seen above it is the
          // pause glyph's ink, which ends 15 px of empty button plus the glyph's
          // own padding above the row's edge, so plain 12 px gaps read as 31
          // above and 12 below. Up 8, 11 more below: 23 and 23, measured, for the
          // slider and the +/- buttons; the play button's hit area still clears
          // it by 4 px, and the tablet speaker sheet (Browse Music) keeps its
          // 566 px body.
          '.vst{margin:-8px 0 11px}',
          '.vol{margin:-8px 2px 11px}',
          '.vst button{width:44px;height:44px;border-radius:22px;border:0;padding:0;display:flex;align-items:center;',
          '  justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.vst button:active{background:rgba(255,255,255,0.24)}',
          '.vst span{font-size:15px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';min-width:64px;text-align:center}',
          '.acts{display:flex;gap:12px}',
          '.acts .btn{flex:1}',
          '.acts .pw{flex:0 0 52px;padding:0}',
          '.acts .pw.lit{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.85)}',
          '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px}',
          '.bk{display:flex;align-items:center;gap:10px}',
          '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
          '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
          '.lf{flex:0 0 auto}',
          '.list{border-radius:18px;background:rgba(255,255,255,0.06);max-height:420px;overflow-y:auto;',
          '  overscroll-behavior:contain;scrollbar-width:none}',
          '.list::-webkit-scrollbar{display:none}',
          '.list button{display:flex;align-items:center;justify-content:space-between;width:100%;',
          '  min-height:52px;padding:0 18px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);',
          '  background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;font-size:17px;text-align:left;cursor:pointer}',
          '.list button:last-child{border-bottom:0}',
          '@media (max-width:' + C.BP.phone + 'px){',
          '  .pl{margin:0 8px}',
          '  .art{width:250px;height:250px}.art.tv{width:100%;height:auto}',
          '  .ti{font-size:20px}.tp{gap:30px}.list{max-height:340px}',
          '}'
        ].join('');
      }
      hkWidthKind(h, s) { return isTv(s) ? 'media_tv' : 'media'; }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        if (!this._built) this._build(s);
        if (this._view === 'inputs') return this._paintInputs(s);
        this._paint(s);
      }
      _build(s) {
        this._built = true;
        this._view = this._view || 'main';
        var self = this;
        this._tv = isTv(s);
        if (this._view === 'inputs') {
          this._root.innerHTML = '<div class="pn"><div class="sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">Input</div></div><div class="hk-edge lf"><div class="list"></div></div></div></div>';
          this._root.querySelector('.bk button').addEventListener('click', function () { self._go('main'); });
          this._list = this._root.querySelector('.list');
          C.edges(this._root);
          this._inSig = null;
          return;
        }
        this._root.innerHTML = '<div class="pn"><div class="pl">' +
          '<div class="art' + (this._tv ? ' tv' : '') + '"></div>' +
          '<div><div class="ti"></div><div class="ar"></div></div>' +
          '<div class="on"></div>' +
          '<div><div class="pg"><i></i></div><div class="tm"><span class="el"></span><span class="du"></span></div></div>' +
          '<div class="tp"><button class="pv" aria-label="Previous">' + glyph('mdi:skip-previous', 30) + '</button>' +
          '<button class="pp" aria-label="Play or pause"></button>' +
          '<button class="nx" aria-label="Next">' + glyph('mdi:skip-next', 30) + '</button></div>' +
          '<div class="vol" role="slider" aria-label="Volume" tabindex="0"><div class="t"></div><div class="f"></div><div class="k"></div></div>' +
          '<div class="vst" hidden><button class="vd" aria-label="Volume down">' + glyph('mdi:volume-minus', 22) + '</button>' +
          '<span>Volume</span><button class="vu" aria-label="Volume up">' + glyph('mdi:volume-plus', 22) + '</button></div>' +
          '<div class="acts"></div></div></div>';
        var q = function (c) { return self._root.querySelector(c); };
        this._e = { art: q('.art'), ti: q('.ti'), ar: q('.ar'), on: q('.on'), pg: q('.pg i'), el: q('.el'), du: q('.du'),
                    pv: q('.pv'), pp: q('.pp'), nx: q('.nx'), vol: q('.vol'), vst: q('.vst'), acts: q('.acts') };
        q('.vd').addEventListener('click', function () { self._svc('media_player', 'volume_down'); });
        q('.vu').addEventListener('click', function () { self._svc('media_player', 'volume_up'); });
        this._e.pv.addEventListener('click', function () { self._svc('media_player', 'media_previous_track'); });
        this._e.nx.addEventListener('click', function () { self._svc('media_player', 'media_next_track'); });
        this._e.pp.addEventListener('click', function () { self._svc('media_player', 'media_play_pause'); });
        // volume: drag or tap along the track
        var vol = this._e.vol, sendV = throttle(function (v) { self._svc('media_player', 'volume_set', { volume_level: v }); }, 250);
        var pick = function (e) {
          var r = vol.getBoundingClientRect();
          var v = clamp((e.clientX - r.left) / r.width, 0, 1);
          v = Math.round(v * 100) / 100;
          self._showVol(v);
          sendV(v);
        };
        var down = false;
        vol.addEventListener('pointerdown', function (e) { e.preventDefault(); down = true; self._volDrag = true; try { vol.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } pick(e); });
        vol.addEventListener('pointermove', function (e) { if (down) pick(e); });
        var up = function (e) { if (down) { down = false; pick(e); setTimeout(function () { self._volDrag = false; }, 800); } };
        vol.addEventListener('pointerup', up);
        vol.addEventListener('pointercancel', function () { down = false; self._volDrag = false; });
        vol.addEventListener('keydown', function (e) {
          var cur = num(at(self._stateObj, 'volume_level')) || 0, v = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = clamp(cur + 0.05, 0, 1);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = clamp(cur - 0.05, 0, 1);
          if (v == null) return;
          e.preventDefault(); self._showVol(v); sendV(v);
        });
        // actions: Browse Music (a speaker) or Input + power (a TV)
        var acts = this._e.acts;
        if (this._tv) {
          if (Array.isArray(at(s, 'source_list')) && at(s, 'source_list').length) {
            var inp = document.createElement('button');
            inp.className = 'btn menu';
            inp.innerHTML = '<span>Input</span><span class="cur"></span>';
            inp.addEventListener('click', function () { self._go('inputs'); });
            acts.appendChild(inp);
            this._e.inp = inp;
          }
          var pw = document.createElement('button');
          pw.className = 'btn pw';
          pw.setAttribute('aria-label', 'Power');
          pw.innerHTML = glyph('mdi:power', 22);
          pw.addEventListener('click', function () {
            var st = self._stateObj;
            self._svc('media_player', st && st.state !== 'off' && st.state !== 'standby' ? 'turn_off' : 'turn_on');
          });
          acts.appendChild(pw);
          this._e.pw = pw;
        } else {
          // BROWSE ONLY FOR A SPEAKER THE MUSIC FEATURE PLAYS TO. Browse plays to
          // the focused speaker, and focus refuses one it does not know (a speaker
          // outside Music Assistant): the button would then browse for another room.
          var bv = browseView(), M2 = window.hkMusic;
          if (bv && M2 && M2.known && M2.known(this._id)) {
            var br = document.createElement('button');
            br.className = 'btn';
            br.textContent = 'Browse Music';
            br.addEventListener('click', function () {
              // Browse plays to the focused speaker: make it this one first.
              if (window.hkMusic && window.hkMusic.setFocus) window.hkMusic.setFocus(self._id);
              var seg = String(location.pathname).split('/')[1];
              navigateFrom('/' + seg + '/' + bv);
            });
            acts.appendChild(br);
          }
        }
        if (!acts.children.length) acts.hidden = true;
      }
      _go(view) { this._view = view; this._built = false; this._render(); }
      _showVol(v) {
        this._e.vol.querySelector('.f').style.width = (v * 100) + '%';
        this._e.vol.querySelector('.k').style.left = 'calc(14px + ' + (v * 100) + '% - ' + (v * 28) + 'px)';
        this._e.vol.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      }
      _paint(s) {
        var a = s.attributes || {}, e = this._e, self = this;
        var f = num(a.supported_features) || 0;
        var na = this._na(s);
        var off = s.state === 'off' || s.state === 'standby' || unavailable(s);
        var title = na ? 'Unavailable' :
          a.media_title || (off ? 'Off' : s.state === 'idle' ? 'Not playing' : (a.app_name || a.source || ''));
        var line = [a.media_artist || a.media_series_title, a.media_album_name].filter(Boolean).join(' · ') ||
                   (this._tv ? (a.app_name || a.source || '') : '');
        e.ti.textContent = title;
        e.ar.textContent = line;
        // WHERE it plays: the speaker's room (the pill's own name can be a
        // shortcut like "Apple Music"), else its own name.
        var where = roomOf(this.client, this._id) || a.friendly_name || '';
        e.on.textContent = (s.state === 'playing' ? 'Playing on · ' : s.state === 'paused' ? 'Paused on · ' : off ? '' : 'Ready on · ') + (off ? '' : where);
        // artwork: entity_picture_local FIRST, as the now-playing bar and Play
        // Music do (hk-media). Music Assistant's entity_picture is
        // http://<music-assistant-host>:8095/imageproxy/..., which an https page
        // must not load and which reaches the art proxy only for an https reverse
        // proxy to refuse (no cover in Safari, or on a tablet over https, while
        // Chrome over http is fine). _local is HA's own media_player_proxy on
        // this origin. Any other host still goes through the art proxy.
        // '' not undefined: an idle speaker has no picture on the FIRST paint too
        var pic = a.entity_picture_local || a.entity_picture || '';
        // A NEW BOX PER PICTURE, swapped in. _artImage appends to the box it
        // is handed and its placeholder fallback rewrites that whole box, so
        // one shared box would stack a second cover beside the first on a track
        // change -- and the old cover's 6 s timeout, firing later, would wipe
        // the new one. The old image's request is stopped as it goes.
        if (pic !== this._pic) {
          this._pic = pic;
          var icon = glyph(this._tv ? 'hk:television' : 'hk:homepod', this._tv ? 56 : 72);
          var box = document.createElement('div');
          box.className = 'ab';
          if (this._artImg) { try { this._artImg.src = ''; } catch (x) { /* going anyway */ } }
          this._artImg = pic && this._artImage ? this._artImage(pic, box, icon, 600) : null;
          if (!this._artImg) box.innerHTML = icon;
          e.art.innerHTML = '';
          e.art.appendChild(box);
        }
        e.pp.innerHTML = glyph(s.state === 'playing' ? 'mdi:pause' : 'mdi:play', 38);
        e.pp.disabled = off || !(f & (MF.PAUSE | MF.PLAY));
        e.pv.disabled = off || !(f & MF.PREV);
        e.nx.disabled = off || !(f & MF.NEXT);
        var level = a.volume_level != null, step = !level && !!(f & MF.VOLUME_STEP);
        // OFF: no volume row at all. Hidden (visibility) it would keep its 28-44
        // px, and Prev / Play / Next would sit 27 px under the progress bar but
        // 83 over Input. Removed, the transport is centred.
        e.vol.hidden = step || off;
        e.vst.hidden = !step || off;
        e.vst.style.visibility = '';
        e.vol.style.visibility = (f & MF.VOLUME_SET) && level ? '' : 'hidden';
        if (!this._volDrag) this._showVol(num(a.volume_level) || 0);
        // an Apple TV's "input" is the app it is in
        if (e.inp) e.inp.querySelector('.cur').innerHTML = esc(a.source || a.app_name || '') + CHEV;
        if (e.pw) e.pw.classList.toggle('lit', !off);
        this._tick();
        clearInterval(this._tickT);
        this._tickT = s.state === 'playing' ? setInterval(function () { self._tick(); }, 1000) : null;
      }
      _tick() {
        var s = this._stateObj, e = this._e;
        if (!s || !e) return;
        var a = s.attributes || {};
        var dur = num(a.media_duration), pos = num(a.media_position);
        if (!dur || pos == null) { e.pg.style.width = '0'; e.el.textContent = ''; e.du.textContent = ''; return; }
        if (s.state === 'playing' && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
        pos = clamp(pos, 0, dur);
        e.pg.style.width = (pos / dur * 100) + '%';
        e.el.textContent = clock(pos);
        e.du.textContent = clock(dur);
      }
      _paintInputs(s) {
        var self = this, cur = at(s, 'source'), list = at(s, 'source_list') || [];
        cur = cur || at(s, 'app_name');
        var sig = cur + '|' + list.length;
        if (sig === this._inSig) return;
        this._inSig = sig;
        var tick = TICK;
        this._list.innerHTML = list.map(function (x) {
          return '<button data-s="' + esc(x) + '"><span>' + esc(x) + '</span>' + (x === cur ? tick : '') + '</button>';
        }).join('');
        this._list.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            self._svc('media_player', 'select_source', { source: b.getAttribute('data-s') });
            self._go('main');
          });
        });
      }
    }

    // ------------------------------------------------------------ sensor
    // The one sheet (with the thermostat) that carries information: the
    // reading, Hour / Day / Week / Month, the graph and its low / average /
    // high. An energy meter draws its use as bars (per hour, per day) with a
    // total instead.
    var RANGES = [['hour', 'Hour'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
    var RANGE_H = { hour: 1, day: 24, week: 168, month: 720 };
    // WEEK AND MONTH ARE CALENDAR PERIODS (the user, 2026-10-12), stepped
    // back with ‹ › as the Energy page's are: half a year of weeks, a year
    // of months. Hour and Day stay the last hour and the last 24 hours.
    var MAX_BACK = { week: 26, month: 12 };
    var CHEV_L = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    var CHEV_R = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
    function calTz() { return window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined; }
    function monthName(t) {
      var o = { month: 'long', timeZone: calTz() };
      if (new Date(t).getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
      return new Date(t).toLocaleDateString([], o);
    }
    function shortDate(t) { return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: calTz() }); }
    // "This Week", "Last Week", "Week of Sep 27"; "This Month", "Last Month", "August"
    function periodName(r, back, start) {
      var wk = r === 'week';
      if (!back) return wk ? 'This Week' : 'This Month';
      if (back === 1) return wk ? 'Last Week' : 'Last Month';
      return wk ? 'Week of ' + shortDate(start) : monthName(start);
    }
    // "Oct 11 – 17", "Sep 27 – Oct 3", "Oct 1 – 31"
    function periodRange(a, b) {
      var F = window.hkStats.fields, fa = F(a), fb = F(b);
      return shortDate(a) + ' \u2013 ' + (fa.month === fb.month ? fb.day : shortDate(b));
    }
    // the figures under a meter's week or month (the row over the ranges
    // already names the period, so these stay short enough for a phone)
    function calNames(cal) {
      var wk = cal.r === 'week';
      return [cal.cur ? 'So Far' : 'Total', 'Daily Average',
              cal.cur ? (wk ? 'Last Week by Now' : 'Last Month by Now') : (wk ? 'Week Before' : monthName(cal.P1.start))];
    }
    function isEnergy(s) {
      var a = s.attributes || {};
      return a.state_class === 'total_increasing' || a.state_class === 'total' || a.device_class === 'energy';
    }
    function fmtNum(v, s) {
      var a = s.attributes || {};
      var unit = a.unit_of_measurement || '';
      var d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
      if (/°|%/.test(unit)) d = Math.abs(v) >= 100 ? 0 : 1;
      return Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
    }
    // AN ENERGY DEVICE'S SHEET (the Energy feature's plan, the settings
    // feed's `energy`): the power sensor or the meter of a device on the
    // Energy page. Its sheet adds today's use, its cost and the usual day,
    // daily bars from its meter for Week and Month, the circuit it is part
    // of and the ones inside it, and the switch it is plugged into.
    function energyPlan() {
      var HS = window.hkSettings, p = HS && HS.get('energy', null);
      return p && typeof p === 'object' ? p : null;
    }
    function energyRec(id) {
      var p = energyPlan();
      return p && p.devices && id ? p.devices[id] || null : null;
    }
    function priceOf(h, P, today) {
      var T = (P && P.total) || {};
      if (typeof T.price === 'number') return T.price;
      if (typeof T.price === 'string') { var st = stOf(h, T.price); var v = st && num(st.state); if (v != null) return v; }
      // the house's own cost today over its kWh today: what a kWh costs now
      if (T.cost && T.stat && today) {
        var c = today(T.cost), k = today(T.stat);
        if (c != null && k) return c / k;
      }
      return null;
    }
    // AN AMOUNT IN THE HOUSE'S CURRENCY (Settings -> System -> General):
    // "$1.24", "€1,24"; a currency the browser cannot name is its code
    function money(h, v, digits) { return window.hkCards.money(h, v, digits); }
    var EN_CSS = [
      '.en{display:flex;flex-direction:column;gap:12px}',
      '.en[hidden]{display:none}',
      '.stats .sub{font-size:12px;color:' + window.hkCards.v('ink-2') + ';margin-top:2px;min-height:15px}',
      // ONE HEIGHT IN EVERY RANGE (the user: the sheet bounced between Day
      // and Week): label, value and line in three rows lined up across the
      // columns, and on a phone room kept for a label or a line on two lines
      '.stats.ens{grid-template-rows:auto auto auto;grid-auto-flow:column;row-gap:0;align-content:center}',
      '.stats.ens > div{display:contents}',
      '@media (max-width:' + C.BP.phone + 'px){.stats.ens{min-height:var(--hk-ens-h,112px)}}',
      '.stats .sub.up{color:#ff9f0a}.stats .sub.down{color:#30d158}',
      '.en .rows{border-radius:20px;background:rgba(255,255,255,0.08);overflow:hidden}',
      '.en .row{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px 0 18px;border:0;width:100%;',
      '  background:transparent;color:inherit;font:inherit;font-size:16px;text-align:left;cursor:pointer;box-sizing:border-box}',
      '.en .row + .row{border-top:1px solid rgba(255,255,255,0.08)}',
      '.en .row .k{color:' + window.hkCards.v('ink-2') + ';font-size:14px;min-width:84px}',
      '.en .row .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
      '.en .row .v{color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.en .row svg{flex-shrink:0;color:rgba(235,235,245,0.35)}',
      '.en .sw{flex-shrink:0;height:34px;min-width:64px;padding:0 14px;border-radius:17px;border:0;font:inherit;font-size:15px;',
      '  font-weight:600;cursor:pointer;background:rgba(255,255,255,0.14);color:' + window.hkCards.v('ink') + '}',
      '.en .sw.on{background:#30d158;color:#fff}'
    ].join('');
    function wattsText(h, id) {
      var st = stOf(h, id);
      if (!st || !window.hkChart) return '';
      var w = window.hkChart.power(h.states, id, { watts: true, fallback: null });
      if (w == null) return '';
      return Math.abs(w) >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + ' W';
    }

    class SensorPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // WIDE on a tablet: the value left, the ranges right, a tall chart
          // with both axes. By the sheet's own width (:host([wide]), see
          // _wideAt), so a narrow sheet (a phone, a small window) stacks them
          // whatever the screen is.
          '.pn{align-items:stretch;gap:20px}',
          '.top{display:flex;flex-direction:column;gap:12px}',
          ':host([wide]) .top{flex-direction:row;justify-content:space-between;align-items:flex-end}',
          ':host([wide]) .top .rc{width:380px;flex-shrink:0}',
          // THE PERIOD AND ‹ › over the ranges: what the chart shows ("This
          // Week · Oct 11 – 17"), stepping through the weeks or months
          '.rc{display:flex;flex-direction:column;gap:10px}',
          '.chd{display:flex;align-items:center;gap:10px;height:36px}',
          '.chd .pl{flex:1;min-width:0;font-size:15px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';',
          '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          ':host([wide]) .chd .pl{text-align:right}',
          '.chd .nv{display:flex;gap:8px;flex-shrink:0}',
          '.chd .nv[hidden]{display:none}',
          '.chd .nv button{width:36px;height:36px;border-radius:18px;border:0;padding:0;margin:0;display:flex;align-items:center;justify-content:center;',
          '  background:rgba(255,255,255,0.14);color:' + window.hkCards.v('ink') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}',
          '.chd .nv button:active{background:rgba(255,255,255,0.26)}',
          '.chd .nv button:disabled{opacity:0.35;cursor:default;background:rgba(255,255,255,0.14)}',
          '.rd{align-self:stretch}',
          '.val{display:flex;align-items:baseline;gap:8px}',
          '.upd{margin-top:6px;font-size:14px;line-height:18px;min-height:18px;color:' + window.hkCards.v('ink-2') + '}',
          '.val .n{font-size:72px;font-weight:600;letter-spacing:-2.5px;line-height:1;font-variant-numeric:tabular-nums}',
          '.val .u{font-size:26px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
          C.segCss('.seg', { on: '.sel', fill: true }),
          '.chart{padding:' + SP.cardPad + ';border-radius:20px;background:rgba(255,255,255,0.08);',
          '  box-sizing:border-box;position:relative}',
          // the placeholder is the chart's own height (plot + time row), so
          // the sheet does not jump when the data lands
          '.chart .ph{display:flex;align-items:center;justify-content:center;',
          '  color:' + window.hkCards.v('ink-3') + ';font-size:15px}',
          '.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:' + SP.rowsPad + ';',
          '  border-radius:20px;background:rgba(255,255,255,0.08);text-align:center}',
          '.stats .k{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
          // the last range's chart and figures, dimmed while the next one loads
          '.chart .axc,.stats{transition:opacity .2s ease}',
          '.chart.stale .axc,.stats.stale{opacity:.35}',
          '.stats .v{font-size:19px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}',
          '@media (max-width:' + C.BP.phone + 'px){.val .n{font-size:60px}.val .u{font-size:22px}',
          '  .pn{gap:16px}.stats .v{font-size:17px}.stats .k{font-size:12px}.stats{gap:8px;padding:14px 12px}}'
        ].join('') + EN_CSS;
      }
      hkWidthKind() { return 'sensor'; }
      _wideAt() { return 700; }
      // an energy device's sheet also follows its switch and the circuits
      // beside it (their watts on its rows)
      _sigOf() {
        var base = super._sigOf(), h = this.client, rec = energyRec(this._id);
        if (!rec || !h) return base;
        var P = energyPlan() || {}, ids = [rec.control];
        [rec.parent].concat(rec.children || []).forEach(function (k) { var o = (P.devices || {})[k]; if (o) ids.push(o.power); });
        return base + '|' + ids.filter(Boolean).map(function (i) {
          var x = h.states[i]; return i + '=' + (x ? x.last_updated : 'x');
        }).join(';');
      }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var energy = isEnergy(s);
        if (!this._built) {
          this._built = true;
          this._range = this._range || 'day';
          var ranges = energy ? RANGES.slice(1) : RANGES;
          this._root.innerHTML = '<div class="pn"><div class="top"><div class="rd"><div class="val"><span class="n"></span><span class="u"></span></div>' +
            '<div class="upd"></div></div>' +
            '<div class="rc"><div class="chd"><span class="pl"></span><span class="nv" hidden>' +
              '<button data-n="1">' + CHEV_L + '</button><button data-n="-1">' + CHEV_R + '</button></span></div>' +
            '<div class="seg">' + ranges.map(function (r) { return '<button data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div></div></div>' +
            '<div class="chart"></div><div class="stats"></div><div class="en" hidden></div></div>';
          // a range opens on the period we are in
          this._root.querySelectorAll('.seg button').forEach(function (b) {
            b.addEventListener('click', function () { self._range = b.getAttribute('data-r'); self._back = 0; self._paintSeg(); self.redraw(); });
          });
          this._root.querySelectorAll('.nv button').forEach(function (b) {
            b.addEventListener('click', function () {
              if (b.disabled) return;
              self._back = Math.max(0, Math.min(MAX_BACK[self._range] || 0, (self._back || 0) + Number(b.getAttribute('data-n'))));
              self.redraw();
            });
          });
          this._head = this._root.querySelector('.chd');
          this._n = this._root.querySelector('.n');
          this._u = this._root.querySelector('.u');
          this._chart = this._root.querySelector('.chart');
          this._stats = this._root.querySelector('.stats');
          this._en = this._root.querySelector('.en');
          this._paintSeg();
          this._upd = this._root.querySelector('.upd');
          if (!this._tickT) this._tickT = setInterval(function () { self._paintUpd(self._stateObj); }, 30000);
        }
        var v = num(s.state);
        this._n.textContent = v == null ? (unavailable(s) ? '—' : s.state) : fmtNum(v, s);
        this._u.textContent = at(s, 'unit_of_measurement') || '';
        this._paintUpd(s);
        this._rec = energyRec(this._id);
        this._paintHead();
        this._paintChart(s, energy);
        this._paintEnergy(s, energy);
      }
      // A CALENDAR WEEK OR MONTH (the user's first day of the week), `back`
      // periods before this one, and the one before it: each day's midnight
      // in Home Assistant's zone. Null on Hour and Day (the last hour, the
      // last 24 hours) and where hk-stats cannot say.
      _cal() {
        var r = this._range, S = window.hkStats;
        if ((r !== 'week' && r !== 'month') || !S || !S.period || !S.weekStart) return null;
        var ws = S.weekStart(this.client), now = Date.now(), back = this._back || 0, today0 = S.addDays(now, 0);
        var key = [r, back, ws, today0].join('|');
        if (this._calK === key) return this._calV;
        var days = function (P) {
          var out = [], t = P.start;
          for (var k = 0; k < P.len; k++) { out.push(t); t = S.addDays(t, 1); }
          return { list: out, end: t };
        };
        var P0 = S.period(r, back, now, ws), P1 = S.period(r, back + 1, now, ws), a = days(P0);
        this._calK = key;
        this._calV = { r: r, back: back, cur: back === 0, P0: P0, P1: P1, dates: a.list, end: a.end, pdates: days(P1).list,
                       today0: today0, todayK: a.list.indexOf(today0) };
        return this._calV;
      }
      _paintHead() {
        if (!this._head) return;
        var cal = this._cal(), wk = this._range === 'week', nv = this._head.querySelector('.nv');
        var label = !cal ? (this._range === 'hour' ? 'The last hour' : 'The last 24 hours')
          : periodName(cal.r, cal.back, cal.P0.start) + ' \u00b7 ' + periodRange(cal.P0.start, cal.dates[cal.dates.length - 1]);
        this._head.querySelector('.pl').textContent = label;
        nv.hidden = !cal;
        if (cal) {
          nv.children[0].disabled = cal.back >= MAX_BACK[cal.r];
          nv.children[1].disabled = cal.back === 0;
          nv.children[0].setAttribute('aria-label', 'Previous ' + (wk ? 'week' : 'month'));
          nv.children[1].setAttribute('aria-label', 'Next ' + (wk ? 'week' : 'month'));
        }
      }
      // AN ENERGY DEVICE: today, its cost, the usual day; where it sits; its switch
      _paintEnergy(s, energy) {
        var rec = this._rec, el = this._en, h = this.client, self = this;
        if (!el) return;
        if (!rec) { el.hidden = true; el.innerHTML = ''; return; }
        var P = energyPlan() || {}, T = P.total || {}, S = window.hkStats;
        var ids = [rec.stat, T.stat, T.cost].filter(Boolean);
        var all = rec.stat && S ? S.daily(h, ids, 8, this) : null;
        var today = function (id) {
          var a = all && all[id], v = a && a.length ? a[a.length - 1].v : null;
          return Number.isFinite(v) ? v : null;
        };
        var kwh = rec.stat ? today(rec.stat) : null;
        var price = priceOf(h, P, all ? today : null);
        this._price = price;
        var usual = null;
        if (all && all[rec.stat]) {
          var prev = all[rec.stat].slice(0, -1).map(function (p) { return p && p.v; }).filter(function (v) { return Number.isFinite(v); });
          if (prev.length) usual = prev.reduce(function (a, b) { return a + b; }, 0) / prev.length;
        }
        var f1 = function (v) { return v == null ? '—' : (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' kWh'; };
        var cost = kwh != null && price != null ? money(h, kwh * price, 2) : '—';
        var cmp = '';
        if (kwh != null && usual) {
          // a day is not over: compare with the usual day so far
          var frac = Math.max(0.05, (Date.now() - new Date().setHours(0, 0, 0, 0)) / 864e5);
          var r = kwh / (usual * frac);
          cmp = r > 1.15 ? 'Above usual so far' : r < 0.85 ? 'Below usual so far' : 'About usual so far';
        }
        var rows = [];
        var names = P.names || {};
        var other = function (key) { return (P.devices || {})[key] || null; };
        if (rec.parent) {
          var pr = other(rec.parent);
          rows.push({ k: 'Part of', t: names[rec.parent] || (pr && pr.name) || rec.parent, v: pr && pr.power ? wattsText(h, pr.power) : '',
                      go: pr ? (pr.power || pr.stat) : null });
        }
        (rec.children || []).forEach(function (key) {
          var c = other(key);
          rows.push({ k: 'Includes', t: names[key] || (c && c.name) || key, v: c && c.power ? wattsText(h, c.power) : '',
                      go: c ? (c.power || c.stat) : null });
        });
        var sw = rec.control && stOf(h, rec.control);
        // TODAY, ITS COST, THE USUAL DAY: the figures under the chart on Hour
        // and Day (Week and Month show the meter's own bars and totals)
        if (rec.stat && (this._range === 'hour' || this._range === 'day')) {
          var sh = '<div><div class="k">Today</div><div class="v">' + f1(kwh) + '</div><div class="sub">' + esc(cmp) + '</div></div>' +
            '<div><div class="k">Cost Today</div><div class="v">' + cost + '</div><div class="sub">' +
              (price != null ? money(h, price, 3) + ' a kWh' : '') + '</div></div>' +
            '<div><div class="k">Usual Day</div><div class="v">' + f1(usual) + '</div><div class="sub">Last 7 days</div></div>';
          this._stats.classList.add('ens');
          this._stats.classList.remove('stale');
          if (this._stats._en !== sh || this._stats.innerHTML.indexOf('Usual Day') < 0) { this._stats.innerHTML = sh; this._stats._en = sh; }
        }
        var html = (rows.length || sw ? '<div class="rows">' + rows.map(function (r, i) {
            return '<button class="row" data-i="' + i + '"><span class="k">' + esc(r.k) + '</span><span class="t">' + esc(r.t) + '</span>' +
              '<span class="v">' + esc(r.v) + '</span>' + (r.go ? CHEV : '') + '</button>';
          }).join('') + (sw ? '<div class="row"><span class="k">Switch</span><span class="t">' +
            esc((sw.attributes && sw.attributes.friendly_name) || rec.control) + '</span><button class="sw' +
            (sw.state === 'on' ? ' on' : '') + '" aria-label="Turn ' + (sw.state === 'on' ? 'off' : 'on') + '">' +
            (sw.state === 'on' ? 'On' : sw.state === 'off' ? 'Off' : esc(sw.state)) + '</button></div>' : '') + '</div>' : '');
        el.hidden = !html;
        if (el._html === html) return;
        el._html = html;
        el.innerHTML = html;
        el.querySelectorAll('.row[data-i]').forEach(function (b) {
          var r = rows[Number(b.getAttribute('data-i'))];
          if (r && r.go) b.addEventListener('click', function () { if (window.hkDetail) window.hkDetail.open(r.go); });
        });
        var btn = el.querySelector('.sw');
        if (btn) btn.addEventListener('click', function () { self._call('switch', 'toggle', { entity_id: rec.control }); });
      }
      // A METER'S CALENDAR WEEK OR MONTH: a bar for every day of it, each
      // labeled under itself; a day still to come is last period's same day
      // in gray (the user, 2026-10-12); never scaled below a usual day, so a
      // Sunday morning's one bar is not the whole chart. Its figures: so far
      // (or the total), the daily average with its peak, and the period
      // before at the same point (or whole, for a past one).
      _paintCalBars(s, pts, cal, H, unit, phone, empty) {
        var byT = {}, h = this.client, wk = cal.r === 'week', u = esc(unit), S = window.hkStats;
        pts.forEach(function (p) { if (p && p.v != null && isFinite(p.v)) byT[+p.t] = p.v; });
        var data = cal.dates.map(function (t, k) {
          var fut = cal.cur && k > cal.todayK, pt = { t: new Date(t), v: fut || byT[t] == null ? null : byT[t] };
          if (fut && k < cal.pdates.length && byT[cal.pdates[k]] != null) pt.ghost = byT[cal.pdates[k]];
          return pt;
        });
        var have = [];
        data.forEach(function (p, k) { if (p.v != null) have.push(k); });
        if (!have.length) { empty(this); return; }
        // a usual day: the whole days before today in hand, a week of them
        var before = [];
        for (var q = 1; q <= 7; q++) { var bv = byT[S.addDays(cal.today0, -q)]; if (bv != null) before.push(bv); }
        var usual = before.length ? before.reduce(function (a, b) { return a + b; }, 0) / before.length : null;
        this._chart.innerHTML = axesChart({ pts: data, bars: true, H: H, unit: unit, ms: cal.P0.len * 864e5,
          cal: { dates: cal.dates, todayK: cal.cur ? cal.todayK : -1, short: phone }, floor: cal.cur ? usual : null,
          gw: wk ? 'last week\u2019s' : 'last month\u2019s' });
        scrub(this._chart);
        var val = function (k) { return data[k].v; }, add = function (a, k) { return a + val(k); };
        var tot = have.reduce(add, 0), whole = have.filter(function (k) { return k !== cal.todayK; });
        var avg = whole.length ? whole.reduce(add, 0) / whole.length : null;
        var pk = have.reduce(function (a, k) { return a < 0 || val(k) > val(a) ? k : a; }, -1);
        // the period before, as far into it as this one has gone (today by the clock)
        var gone = cal.cur ? cal.todayK : cal.pdates.length, frac = Math.max(0, Math.min(1, (Date.now() - cal.today0) / 864e5));
        var prev = 0, pany = false;
        cal.pdates.forEach(function (t, k) {
          var v = byT[t];
          if (v == null) return;
          pany = true;
          prev += !cal.cur || gone >= cal.pdates.length || k < gone ? v : k === gone ? v * frac : 0;
        });
        var pct = pany && prev > 0 ? Math.round(100 * (tot - prev) / prev) : null;
        var cmp = pct == null ? '' : Math.abs(pct) < 5 ? 'About the same' : Math.abs(pct) + '% ' + (pct > 0 ? 'more' : 'less');
        var price = this._price != null ? this._price : priceOf(h, energyPlan(), null);
        var day = function (k) { return wk ? new Date(cal.dates[k]).toLocaleDateString([], { weekday: 'short', timeZone: calTz() }) : shortDate(cal.dates[k]); };
        var names = calNames(cal), fig = function (v) { return v == null ? '\u2014' : fmtNum(v, s) + ' ' + u; };
        this._stats.hidden = false;
        this._stats.classList.add('ens');
        this._stats.innerHTML =
          '<div><div class="k">' + esc(names[0]) + '</div><div class="v">' + fig(tot) + '</div><div class="sub">' +
            (price != null ? money(h, tot * price, 2) : esc(periodRange(cal.P0.start, cal.dates[have[have.length - 1]]))) + '</div></div>' +
          '<div><div class="k">' + esc(names[1]) + '</div><div class="v">' + fig(avg) + '</div><div class="sub">' +
            (pk >= 0 ? 'Peak ' + esc(day(pk)) + ' \u00b7 ' + fmtNum(val(pk), s) : '') + '</div></div>' +
          '<div><div class="k">' + esc(names[2]) + '</div><div class="v">' + fig(pany ? prev : null) + '</div><div class="sub' +
            (pct != null && Math.abs(pct) >= 5 ? (pct > 0 ? ' up' : ' down') : '') + '">' + esc(cmp) + '</div></div>';
      }
      // when the reading last changed ("Updated just now", "Updated 5 min ago")
      _paintUpd(s) {
        if (!this._upd || !s) return;
        var t = Date.parse(s.last_changed || s.last_updated);
        var ago = Math.round((Date.now() - t) / 60000);
        this._upd.textContent = unavailable(s) || !isFinite(t) ? '' : ago < 1 ? 'Updated just now' :
          ago < 60 ? 'Updated ' + ago + ' min ago' :
          'Updated ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
      _paintSeg() {
        var r = this._range;
        segPick(this._root.querySelector('.seg'), 'button', 'data-r', r);
      }
      // The series for the range, or null while it loads.
      _series(s, energy, meter) {
        var h = this.client, id = meter || this._id, r = this._range, S = window.hkStats;
        if (!S) return null;
        var self = this;
        var viaStats = function (fn, n, opts) {
          var d = S[fn](h, id, n, self, opts);
          if (d && d.some(function (p) { return p && p.v != null; })) return d;
          // STILL ON ITS WAY (a new week or month asked for): the last chart
          // stays, dimmed -- never a moment of "No history" while it loads
          if (!d) return null;
          // NO LONG-TERM STATISTICS for this sensor: hk-stats has answered, and
          // the answer is empty -- its recorded history, at once (it waited
          // 2.6 s on a timer for nothing)
          return undefined;
        };
        var out, cal = this._cal();
        // A CALENDAR WEEK OR MONTH: from its own start (and, for a meter's
        // bars, the period before it, which it is read against) to today
        if (cal) {
          var dayN = function (from) { return Math.round((cal.today0 - from) / 864e5) + 1; };
          var hrs = Math.ceil((Date.now() - cal.P0.start) / 36e5) + 1;
          if (energy) { out = viaStats('daily', dayN(cal.P1.start), {}); return out === undefined ? [] : out; }
          out = r === 'week' ? viaStats('hourly', hrs, { type: 'mean' }) : viaStats('daily', dayN(cal.P0.start), { type: 'mean' });
          // no long-term statistics: this week's or month's recorded history (two weeks at most)
          return out === undefined ? (cal.cur ? S.history(h, id, Math.min(hrs, 336), this) : []) : out;
        }
        if (energy) {
          if (r === 'day') out = viaStats('hourly', 24, {});
          else if (r === 'week') out = viaStats('daily', 7, {});
          else out = viaStats('daily', 30, {});
          return out === undefined ? [] : out;
        }
        if (r === 'hour') return S.history(h, id, 1, this);
        if (r === 'day') return S.history(h, id, 24, this);
        if (r === 'week') { out = viaStats('hourly', 168, { type: 'mean' }); return out === undefined ? S.history(h, id, 168, this) : out; }
        out = viaStats('daily', 30, { type: 'mean' });
        return out === undefined ? S.history(h, id, 336, this) : out;
      }
      _paintChart(s, energy) {
        var r = this._range;
        // AN ENERGY DEVICE'S POWER: Week and Month are its meter's daily use
        var meter = !energy && this._rec && this._rec.stat && (r === 'week' || r === 'month') ? this._rec.stat : null;
        if (meter) {
          energy = true;
          s = { entity_id: meter, state: '', attributes: { unit_of_measurement: 'kWh' } };
        }
        var pts = this._series(s, energy, meter);
        var unit = at(s, 'unit_of_measurement') || '', u = esc(unit);
        // plot height and time labels: a tall chart in the wide sheet, a
        // shorter one with three times on a phone
        var phone = matchMedia('(max-width:' + C.BP.phone + 'px)').matches;
        // an energy device's sheet keeps room under the chart for its rows
        var cal = this._cal(), wk = r === 'week';
        var H = phone ? 180 : (this._rec ? 200 : 250), NT = phone ? 3 : 5, MS = cal ? cal.P0.len * 864e5 : RANGE_H[r] * 3600000;
        // NOTHING CHANGES HEIGHT ON A RANGE SWITCH, so the card does not bounce.
        // The stats row is never taken out -- dashes when there is nothing to
        // say -- and a chart already drawn stays, dimmed, until the new range
        // lands; the placeholder is only for the first open, at the chart's
        // own height. Taking the row out would re-centre the whole sheet twice.
        var ks = energy && cal ? calNames(cal) : energy ? ['24-hour total', 'Hourly average', 'Peak hour'] : ['Low', 'Average', 'High'];
        // a meter's or an energy device's figures carry a line under each
        // value, in every range and while they load, so the row never changes height
        var ens = energy || !!this._rec;
        var dash = function (self) {
          self._stats.hidden = false;
          self._stats.classList.remove('stale');
          self._stats.classList.toggle('ens', ens);
          self._stats.innerHTML = ks.map(function (k) { return '<div><div class="k">' + k + '</div><div class="v">—</div>' + (ens ? '<div class="sub"></div>' : '') + '</div>'; }).join('');
        };
        var ph = function (self, text) {
          self._chart.classList.remove('stale');
          self._chart.innerHTML = '<div class="ph" style="height:' + (H + 22) + 'px">' + text + '</div>';
          dash(self);
        };
        var empty = function (self) { ph(self, 'No history for this range'); };
        if (!pts) {
          this._ser = null;
          if (this._chart.querySelector('.axc')) { this._chart.classList.add('stale'); this._stats.classList.add('stale'); return; }
          ph(this, 'Loading…');
          return;
        }
        this._chart.classList.remove('stale');
        this._stats.classList.remove('stale');
        var c = this._ser;
        if (energy) {
          // bars move only with their series: drawn again when it changes
          if (c && c.src === pts && c.r === r && c.cal === cal) return;
          this._ser = { src: pts, r: r, cal: cal };
          if (cal) { this._paintCalBars(s, pts, cal, H, unit, phone, empty); return; }
          var nums = pts.filter(function (p) { return p && p.v != null && isFinite(p.v); }).map(function (p) { return p.v; });
          // none at all is "no history", not a "0 kWh" total
          if (!nums.length) { empty(this); return; }
          this._chart.innerHTML = axesChart({ pts: pts, bars: true, H: H, unit: unit, ms: MS, n: NT });
          scrub(this._chart);
          this._stats.hidden = false;
          var tot = nums.reduce(function (a, b) { return a + b; }, 0);
          // the headline is the meter (today so far); these are the chart's span
          var per = { day: 'Hourly average', week: 'Daily average', month: 'Daily average' }[r];
          var span = { day: '24-hour total', week: '7-day total', month: '30-day total' }[r];
          var peak = { day: 'Peak hour', week: 'Peak day', month: 'Peak day' }[r];
          this._stats.classList.add('ens');
          this._stats.innerHTML = '<div><div class="k">' + span + '</div><div class="v">' + fmtNum(tot, s) + ' ' + u + '</div><div class="sub"></div></div>' +
            '<div><div class="k">' + per + '</div><div class="v">' + fmtNum(tot / nums.length, s) + ' ' + u + '</div><div class="sub"></div></div>' +
            '<div><div class="k">' + peak + '</div><div class="v">' + fmtNum(Math.max.apply(null, nums.concat([0])), s) + ' ' + u + '</div><div class="sub"></div></div>';
          return;
        }
        // THE LINE. The heavy part -- a day of a power sensor is ~11,000 rows
        // -- is filtered, downsampled and summed ONCE per series; a state
        // push only pins the ends (the range start, the live reading) rather
        // than redoing all of it every few seconds.
        if (!c || c.src !== pts || c.r !== r || c.cal !== cal) {
          var full = pts.filter(function (p) { return p && p.v != null && isFinite(p.v) && (!cal || (+p.t >= cal.P0.start && +p.t < cal.end)); });
          var lo = Infinity, hi = -Infinity, sum = 0;
          full.forEach(function (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; sum += p.v; });
          c = this._ser = { src: pts, r: r, cal: cal, ds: downsample(full, 300), lo: lo, hi: hi, sum: sum, n: full.length };
        }
        var now = Date.now(), live = num(s.state);
        // a calendar period's line runs from its start to now (a past one to
        // its end), across the whole period: the days to come are empty
        if (cal && !cal.cur) live = null;
        var line = cal ? spanTo(c.ds, cal.P0.start, cal.cur ? now : cal.end - 1, live) : spanTo(c.ds, now - RANGE_H[r] * 3600000, now, live);
        if (line.length < 2) { empty(this); return; }
        this._chart.innerHTML = axesChart({ pts: line, H: H, unit: unit, ms: MS, n: NT, colour: 'orange',
          span: cal ? [cal.P0.start, cal.end] : null, cal: cal ? { dates: cal.dates, todayK: cal.cur ? cal.todayK : -1, short: phone } : null });
        scrub(this._chart);
        var low = live != null ? Math.min(c.lo, live) : c.lo, high = live != null ? Math.max(c.hi, live) : c.hi;
        this._stats.classList.toggle('ens', ens);
        var avg = c.n ? c.sum / c.n : live;
        this._stats.hidden = false;
        var sb = ens ? '<div class="sub"></div>' : '';
        this._stats.innerHTML = '<div><div class="k">Low</div><div class="v">' + fmtNum(low, s) + ' ' + u + '</div>' + sb + '</div>' +
          '<div><div class="k">Average</div><div class="v">' + fmtNum(avg, s) + ' ' + u + '</div>' + sb + '</div>' +
          '<div><div class="k">High</div><div class="v">' + fmtNum(high, s) + ' ' + u + '</div>' + (ens ? '<div class="sub"></div>' : '') + '</div>';
      }
    }

    // ------------------------------------------------------------ binary / state
    var BIN_WORDS = {
      door: ['Closed', 'Open'], window: ['Closed', 'Open'], garage_door: ['Closed', 'Open'], opening: ['Closed', 'Open'],
      moisture: ['Dry', 'Wet'], motion: ['Clear', 'Detected'], occupancy: ['Clear', 'Detected'], presence: ['Away', 'Home'],
      lock: ['Locked', 'Unlocked'], smoke: ['Clear', 'Detected'], gas: ['Clear', 'Detected'], problem: ['OK', 'Problem'],
      connectivity: ['Disconnected', 'Connected'], plug: ['Unplugged', 'Plugged in'], power: ['Off', 'On'], battery: ['Normal', 'Low']
    };
    function sinceText(iso) {
      var t = Date.parse(iso);
      if (!isFinite(t)) return '';
      var d = new Date(t), today = new Date();
      var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (d.toDateString() === today.toDateString()) return 'Since ' + time;
      return 'Since ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
    }
    // THE SENSOR'S OWN GLYPH, large, in the pill's colour while it is on /
    // open (the state icon follows the state: a door open or shut), then the
    // word, "Since", and a card for the last 24 hours with its times along
    // the bottom. Shared by the door-style and the text sensors.
    var SENSE_CSS = [
      '.pn{gap:20px}',
      '.gw{width:180px;height:180px;border-radius:90px;display:flex;align-items:center;justify-content:center;',
      '  background:rgba(255,255,255,0.07);transition:background .25s}',
      '.gw .gc{width:120px;height:120px;border-radius:60px;display:flex;align-items:center;justify-content:center;',
      '  background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.85);transition:background .25s,color .25s}',
      '.gw hk-state-icon{--mdc-icon-size:56px;display:flex}',
      '.gw.on{background:color-mix(in srgb,var(--hkd-accent,#56bde4) 22%,transparent)}',
      '.gw.on .gc{background:var(--hkd-accent,#56bde4);color:#fff}',
      '.big.w{font-size:52px}',
      '.since{font-size:16px;color:' + window.hkCards.v('ink-2') + ';min-height:20px}',
      '.tl{align-self:stretch;padding:' + SP.cardPad + ';border-radius:20px;background:rgba(255,255,255,0.08)}',
      '.tl .th{display:flex;justify-content:space-between;align-items:baseline;gap:12px}',
      '.tl .t{font-size:13px;font-weight:600;letter-spacing:0.3px;color:' + window.hkCards.v('ink-2') + ';text-transform:uppercase}',
      '.tl .n{font-size:15px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
      '.tl .bar{position:relative;height:64px;margin-top:12px;border-radius:10px;background:rgba(255,255,255,0.10);overflow:hidden}',
      '.tl .bar i{position:absolute;top:0;bottom:0;min-width:2px}',
      '.tl .bar .q{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.08)}',
      '.tl .axx{margin-left:0}',
      '.tl .lg{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
      '.tl .lg span{display:inline-flex;align-items:center;gap:6px}',
      '.tl .lg b{width:10px;height:10px;border-radius:3px;display:inline-block}',
      '@media (max-width:' + C.BP.phone + 'px){.pn{gap:16px}.gw{width:150px;height:150px;border-radius:75px}',
      '  .gw .gc{width:100px;height:100px;border-radius:50px}.gw hk-state-icon{--mdc-icon-size:48px}',
      '  .big.w{font-size:44px}.tl .bar{height:52px}}'
    ].join('');
    var DAY = 24 * 3600000;
    var QUARTERS = '<b class="q" style="left:25%"></b><b class="q" style="left:50%"></b><b class="q" style="left:75%"></b>';
    function senseShell(title) {
      return '<div class="pn"><div class="gw"><div class="gc"><hk-state-icon></hk-state-icon></div></div>' +
        '<div class="big w"></div><div class="since"></div>' +
        '<div class="tl" hidden><div class="th"><span class="t">' + title + '</span><span class="n"></span></div>' +
        '<div class="bar"></div>' + timeRow(DAY, 5) + '<div class="lg" hidden></div></div></div>';
    }
    // the day's rows, straight from the recorder (hkStats.history keeps numbers only)
    function dayRows(h, id) {
      if (!h || !h.callApi) return Promise.reject(new Error('no api'));
      var start = new Date(Date.now() - DAY);
      var url = 'history/period/' + encodeURIComponent(start.toISOString()) + '?filter_entity_id=' +
                encodeURIComponent(id) + '&minimal_response&no_attributes';
      return h.callApi('GET', url).then(function (res) {
        return { t0: start.getTime(), rows: (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : [] };
      });
    }
    // rows -> [{state, a, b}] clipped to [t0, now]
    function spansOf(rows, t0, now) {
      return (rows || []).map(function (r, i) {
        var a = Math.max(t0, Date.parse(r.last_changed || r.last_updated));
        var b = i + 1 < rows.length ? Date.parse(rows[i + 1].last_changed || rows[i + 1].last_updated) : now;
        return { state: r.state, a: a, b: Math.min(now, b) };
      }).filter(function (g) { return g.b > g.a; });
    }
    class SensePanel extends Panel {
      static get CSS() { return PANEL_CSS + SENSE_CSS; }
      _shell(title) {
        this._root.innerHTML = senseShell(title);
        var q = this._root.querySelector.bind(this._root);
        this._gw = q('.gw'); this._icon = q('hk-state-icon');
        this._big = q('.big'); this._since = q('.since'); this._tl = q('.tl');
        this.style.setProperty('--hkd-accent', colourName(lookFor(this._src, this._id), this._id));
        if (this._src.icon) this._icon.icon = this._src.icon;
      }
      _glyph(s, on) {
        var c = this.client;
        if (c && c.bindStateIcon) c.bindStateIcon(this._icon, s); else this._icon.stateObj = s;
        this._gw.classList.toggle('on', !!on);
      }
      _fetch() {
        var self = this;
        dayRows(this.client, this._id).then(function (r) {
          self._rows = r.rows; self._t0 = r.t0;
          self._paintDay();
        }).catch(function () { /* no timeline */ });
      }
    }
    class BinaryPanel extends SensePanel {
      hkWidthKind() { return 'binary'; }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        if (!this._built) {
          this._built = true;
          this._shell('Last 24 hours');
          this._fetch();
        }
        var w = BIN_WORDS[at(s, 'device_class')] || ['Off', 'On'];
        this._glyph(s, s.state === 'on');
        // `unknown`: a sleepy sensor that has not reported since a restart --
        // "No Report", as its tile and room row say
        this._big.textContent = gone(s) ? 'Unavailable' : s.state === 'unknown' ? 'No Report' : (s.state === 'on' ? w[1] : w[0]);
        this._since.textContent = sinceText(s.last_changed);
        if (this._lastSeen !== s.last_changed) { this._lastSeen = s.last_changed; if (this._rows) this._fetch(); }
      }
      _paintDay() {
        var t0 = this._t0, now = Date.now(), span = now - t0, opens = 0, prev = null;
        var segs = spansOf(this._rows, t0, now);
        segs.forEach(function (g, i) { if (g.state === 'on' && prev !== 'on' && i > 0) opens++; prev = g.state; });
        var s = this._stateObj, w = BIN_WORDS[at(s, 'device_class')] || ['Off', 'On'];
        this._tl.hidden = false;
        this._tl.querySelector('.bar').innerHTML = QUARTERS + segs.filter(function (g) { return g.state === 'on'; }).map(function (g) {
          return '<i style="left:' + ((g.a - t0) / span * 100).toFixed(2) + '%;width:' + Math.max(0.3, (g.b - g.a) / span * 100).toFixed(2) +
                 '%;background:var(--hkd-accent,#56bde4)"></i>';
        }).join('');
        this._tl.querySelector('.n').textContent = opens ? w[1] + ' ' + opens + (opens === 1 ? ' time' : ' times') : 'No change in 24 hours';
      }
    }
    // A TEXT SENSOR: its value, and the day as a strip of its states with the
    // time spent in each (the most-held state in the pill's colour).
    var STRIP = ['var(--hkd-accent,#56bde4)', 'rgba(255,255,255,0.24)', '#ff9f0a', '#bf5af2', '#30d158', '#ff6961'];
    class StatePanel extends SensePanel {
      hkWidthKind() { return 'state'; }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        if (!this._built) {
          this._built = true;
          this._shell('Last 24 hours');
          this._fetch();
        }
        var h = this.client, txt;
        try { txt = h.formatEntityState ? h.formatEntityState(s) : s.state; } catch (e) { txt = s.state; }
        this._glyph(s, !unavailable(s) && s.state !== 'off' && s.state !== 'unknown');
        this._big.textContent = unavailable(s) ? 'Unavailable' : txt;
        this._since.textContent = sinceText(s.last_changed);
        if (this._lastSeen !== s.last_changed) { this._lastSeen = s.last_changed; if (this._rows) this._fetch(); }
      }
      _paintDay() {
        var t0 = this._t0, now = Date.now(), span = now - t0, h = this.client, self = this;
        var segs = spansOf(this._rows, t0, now).filter(function (g) { return g.state !== 'unavailable' && g.state !== 'unknown'; });
        if (!segs.length) return;
        var total = {};
        segs.forEach(function (g) { total[g.state] = (total[g.state] || 0) + (g.b - g.a); });
        var order = Object.keys(total).sort(function (a, b) { return total[b] - total[a]; });
        var col = {};
        order.forEach(function (st, i) { col[st] = STRIP[Math.min(i, STRIP.length - 1)]; });
        var word = function (st) {
          try { return h.formatEntityState ? h.formatEntityState(Object.assign({}, self._stateObj, { state: st })) : st; } catch (e) { return st; }
        };
        this._tl.hidden = false;
        this._tl.querySelector('.n').textContent = order.length === 1 ? 'No change in 24 hours' :
          (segs.length - 1) + (segs.length === 2 ? ' change' : ' changes');
        this._tl.querySelector('.bar').innerHTML = segs.map(function (g) {
          return '<i style="left:' + ((g.a - t0) / span * 100).toFixed(2) + '%;width:' + Math.max(0.3, (g.b - g.a) / span * 100).toFixed(2) +
                 '%;background:' + col[g.state] + '"></i>';
        }).join('') + QUARTERS;
        var lg = this._tl.querySelector('.lg');
        lg.hidden = false;
        lg.innerHTML = order.slice(0, 4).map(function (st) {
          return '<span><b style="background:' + col[st] + '"></b>' + esc(word(st)) + ' · ' + dur(total[st] / 1000) + '</span>';
        }).join('');
      }
    }

    // ------------------------------------------------------------ generic
    // THE GENERIC SHEET (Phase 2 P2.5): an entity HK draws no sheet of its
    // own for, on a host without a detail of its own (Mantel; Home Assistant
    // keeps its more-info dialog for these). Its glyph, its state in the
    // client's words, since when, what it says about itself (its key
    // attributes, named and formatted by the client), a control only where
    // one is obvious, and for an admin on a host with a detail of its own,
    // "Open in Home Assistant" (toHost). Nothing else: no history, no
    // settings beyond the gear every sheet has for an admin.
    //
    // NOT A KEY ATTRIBUTE: what the sheet already shows (name, glyph, unit,
    // the state's class), the host's bookkeeping, and anything that is not
    // a short value.
    var GENERIC_SKIP = {
      friendly_name: 1, icon: 1, entity_picture: 1, supported_features: 1, supported_color_modes: 1,
      assumed_state: 1, attribution: 1, device_class: 1, unit_of_measurement: 1, state_class: 1,
      editable: 1, id: 1, restored: 1, entity_id: 1, hidden: 1, icon_color: 1, options: 1
    };
    var GENERIC_ROWS = 8;
    // [{ key, name, value }]: at most GENERIC_ROWS, in the entity's own order
    function genericRows(c, s) {
      var a = (s && s.attributes) || {}, out = [];
      Object.keys(a).forEach(function (k) {
        if (out.length >= GENERIC_ROWS || GENERIC_SKIP[k]) return;
        var v = a[k], t = typeof v;
        var short = t === 'string' ? v !== '' && v.length <= 120 : t === 'number' ? isFinite(v) : t === 'boolean' ? true :
          Array.isArray(v) ? v.length > 0 && v.length <= 6 && v.every(function (x) { return typeof x === 'string' || typeof x === 'number'; }) : false;
        if (!short) return;
        var name, value;
        try { name = c && c.formatEntityAttributeName ? c.formatEntityAttributeName(s, k) : k; } catch (e) { name = k; }
        try { value = c && c.formatEntityAttributeValue ? c.formatEntityAttributeValue(s, k) : String(v); } catch (e) { value = String(v); }
        if (value == null || value === '') return;
        out.push({ key: k, name: String(name || k), value: String(value) });
      });
      return out;
    }
    // THE ONE OBVIOUS CONTROL, through the client's action port: a toggle
    // (homeassistant.toggle) for an on/off state in a domain that takes one,
    // Activate for a scene, Run for a script; none for anything else, and
    // never for what HK never toggles in one tap (hk-base's neverToggles).
    var GENERIC_TOGGLE = { remote: 1, group: 1, input_boolean: 1, switch: 1, light: 1, fan: 1, humidifier: 1 };
    function genericControl(c, id, s) {
      if (!s || !id) return null;
      var d = domainOf(id);
      if (C.neverToggles && C.neverToggles(c, id)) return null;
      if (d === 'scene') return { kind: 'run', label: 'Activate', domain: 'scene', service: 'turn_on' };
      if (d === 'script') return { kind: 'run', label: 'Run', domain: 'script', service: 'turn_on' };
      if (GENERIC_TOGGLE[d] && (s.state === 'on' || s.state === 'off')) {
        return { kind: 'toggle', label: s.state === 'on' ? 'Turn Off' : 'Turn On', domain: 'homeassistant', service: 'toggle' };
      }
      return null;
    }
    var GENERIC_CSS = [
      // a long state (a date and time, a sentence) steps down and wraps rather than leave the sheet
      '.big{max-width:100%;overflow-wrap:anywhere}',
      '.big.w.long{font-size:30px;letter-spacing:-0.5px;line-height:1.15}',
      '.gbtn{min-width:200px;height:50px;padding:0 24px;border:0;border-radius:25px;font:inherit;font-size:17px;font-weight:600;',
      '  color:' + window.hkCards.v('ink') + ';background:rgba(255,255,255,0.16);cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.gbtn.on{background:#30d158;color:#fff}',
      '.gbtn[disabled]{opacity:.45;cursor:default}',
      '.attrs{align-self:stretch;padding:4px 20px;border-radius:20px;background:rgba(255,255,255,0.08)}',
      '.attrs .r{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 0;font-size:15px}',
      '.attrs .r + .r{border-top:0.5px solid rgba(255,255,255,0.12)}',
      '.attrs .k{color:' + window.hkCards.v('ink-2') + '}',
      '.attrs .v{text-align:right;overflow-wrap:anywhere}',
      '.hostlink{appearance:none;border:0;background:none;font:inherit;font-size:15px;color:#0a84ff;cursor:pointer;padding:6px 10px}',
      ':host([hk-flat]) .attrs{background:' + C.v('key') + '}',
      ':host([hk-flat]) .attrs .r + .r{border-top-color:' + C.v('line') + '}',
      ':host([hk-flat]) .gbtn:not(.on){background:' + C.v('key') + ';color:' + C.v('glyph') + '}'
    ].join('');
    class GenericPanel extends SensePanel {
      static get CSS() { return PANEL_CSS + SENSE_CSS + GENERIC_CSS; }
      hkWidthKind() { return 'generic'; }
      _render() {
        var s = this._stateObj, c = this.client, self = this;
        if (!s) return;
        if (!this._built) {
          this._built = true;
          this._shell('');
          var pn = this._root.querySelector('.pn');
          this._gCtl = document.createElement('button');
          this._gCtl.className = 'gbtn';
          this._gCtl.hidden = true;
          this._gCtl.addEventListener('click', function () { self._gRun(); });
          this._gList = document.createElement('div');
          this._gList.className = 'attrs';
          this._gList.hidden = true;
          this._gHost = document.createElement('button');
          this._gHost.className = 'hostlink';
          this._gHost.textContent = 'Open in Home Assistant';
          this._gHost.hidden = true;
          this._gHost.addEventListener('click', function () { toHost(self._id); });
          pn.appendChild(this._gCtl);
          pn.appendChild(this._gList);
          pn.appendChild(this._gHost);
        }
        var txt;
        try { txt = c && c.formatEntityState ? c.formatEntityState(s) : s.state; } catch (e) { txt = s.state; }
        this._glyph(s, isOn(s));
        this._big.textContent = gone(s) ? 'Unavailable' : txt;
        this._big.classList.toggle('long', String(this._big.textContent).length > 14);
        this._since.textContent = unavailable(s) ? '' : sinceText(s.last_changed);
        // the control: what it does now (a toggle's word follows the state)
        var ctl = genericControl(c, this._id, s);
        this._gSpec = ctl;
        this._gCtl.hidden = !ctl;
        if (ctl) {
          this._gCtl.textContent = ctl.label;
          this._gCtl.classList.toggle('on', ctl.kind === 'toggle' && s.state === 'on');
          this._gCtl.disabled = gone(s);
        }
        // the key attributes, redrawn only when what they say changed
        var rows = genericRows(c, s), sig = JSON.stringify(rows);
        if (sig !== this._gSig) {
          this._gSig = sig;
          this._gRows = rows;
          this._gList.innerHTML = '';
          rows.forEach(function (r) {
            var row = document.createElement('div'), k = document.createElement('span'), v = document.createElement('span');
            row.className = 'r'; k.className = 'k'; v.className = 'v';
            k.textContent = r.name; v.textContent = r.value;
            row.appendChild(k); row.appendChild(v);
            self._gList.appendChild(row);
          });
          this._gList.hidden = !rows.length;
        }
        // an admin, on a host with a detail of its own (none in Mantel)
        this._gHost.hidden = !(canEdit(c) && window.hkShell.hostDetail(this._id));
      }
      _gRun() {
        var ctl = this._gSpec, s = this._stateObj, self = this;
        if (!ctl || !s || gone(s)) return;
        var go = function () { self._svc(ctl.domain, ctl.service); };
        var conf = this._src.confirmation;
        if (conf && C.confirmSheet) C.confirmSheet(conf.text || (ctl.label + '?'), go);
        else go();
      }
    }

    // ------------------------------------------------------------ lists
    // One pick-list look for every "choose one of these": a select, a
    // humidifier's modes. The current row carries the orange tick the light's
    // effects use; past 12 rows there is a search.
    var LIST_CSS = [
      // (each list in a frame with the sheet's shadows: BASE_CSS .hk-edge)
      '.lf{flex:0 0 auto;align-self:stretch}',
      '.list{align-self:stretch;border-radius:18px;background:rgba(255,255,255,0.06);max-height:420px;overflow-y:auto;',
      '  overscroll-behavior:contain;scrollbar-width:none}',
      '.list::-webkit-scrollbar{display:none}',
      '.list button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;',
      '  min-height:52px;padding:0 18px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);',
      '  background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;font-size:17px;text-align:left;cursor:pointer}',
      '.list button span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.list button svg{flex-shrink:0}',
      '.list button:last-child{border-bottom:0}',
      '.list button:active{background:rgba(255,255,255,0.08)}',
      '.search{align-self:stretch;display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:14px;',
      '  background:rgba(255,255,255,0.10)}',
      '.search input{flex-grow:1;min-width:0;border:0;background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;',
      '  font-size:17px;outline:none}',
      '.search input::placeholder{color:' + window.hkCards.v('ink-3') + '}',
      '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px}',
      '.bk{display:flex;align-items:center;gap:10px}',
      '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
      '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
      '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
      '@media (max-width:' + C.BP.phone + 'px){.list{max-height:340px}}'
    ].join('');
    function pretty(v) {
      var t = String(v == null ? '' : v).replace(/_/g, ' ');
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    // pickList(host, options, onPick, label): paints the list (and, past 12
    // options, its search) into host; returns repaint(cur) for state changes.
    // `label` names the search field for a screen reader.
    function pickList(host, options, onPick, label) {
      var q = '', sig = null, box = document.createElement('div');
      box.className = 'list';
      if (options.length > 12) {
        var se = document.createElement('label');
        se.className = 'search';
        se.innerHTML = SEARCH + '<input type="search" placeholder="Search" aria-label="Search ' + esc(label || '') + '" autocomplete="off">';
        host.appendChild(se);
        se.querySelector('input').addEventListener('input', function (ev) { q = ev.target.value.toLowerCase(); paint(last, true); });
      }
      var lf = document.createElement('div');
      lf.className = 'hk-edge lf';
      lf.appendChild(box); host.appendChild(lf);
      C.edges(lf);
      var last = null;
      function paint(cur, force) {
        last = cur;
        var s2 = cur + '|' + q;
        if (!force && s2 === sig) return;
        sig = s2;
        var rows = options.filter(function (o) { return !q || pretty(o).toLowerCase().indexOf(q) !== -1; });
        box.innerHTML = rows.map(function (o) {
          return '<button data-o="' + esc(o) + '"' + (o === cur ? ' aria-current="true"' : '') + '><span>' + esc(pretty(o)) + '</span>' +
                 (o === cur ? TICK : '') + '</button>';
        }).join('') || '<div class="muted" style="padding:18px">Nothing matches</div>';
        box.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () { onPick(b.getAttribute('data-o')); });
        });
      }
      return paint;
    }

    // ------------------------------------------------------------ vacuum
    // The robot, what it is doing, and its four commands. Battery, room,
    // progress and errors are SEPARATE sensors here (the vacuum entities carry
    // no battery_level): the vacuum page's card names them, and a vacuum
    // opened from anywhere else finds them on its own device.
    var VF = { PAUSE: 4, RETURN_HOME: 16, LOCATE: 512, START: 8192 };
    var VAC_WORDS = { docked: 'Docked', cleaning: 'Cleaning', paused: 'Paused', returning: 'Returning',
                      idle: 'Idle', error: 'Error' };
    var VAC_OK = ['no_error', 'none', 'ok', 'unknown', 'unavailable', ''];
    function deviceSensor(h, id, test) {
      var ents = h && h.entities, me = ents && ents[id];
      if (!me || !me.device_id) return null;
      var hit = null;
      Object.keys(ents).some(function (k) {
        if (k.indexOf('sensor.') !== 0 || !ents[k] || ents[k].device_id !== me.device_id) return false;
        if (test(k, h.states[k])) { hit = k; return true; }
        return false;
      });
      return hit;
    }
    class VacuumPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          '.pn{gap:20px;padding:3px 0}',
          // the robot 200 and its commands 72: sized for the one sheet height
          '.bot{width:200px;height:200px;border-radius:100px;display:flex;align-items:center;justify-content:center;',
          '  background:rgba(255,255,255,0.10);color:rgba(255,255,255,0.85);transition:background .25s,color .25s}',
          '.bot.live{background:rgba(48,209,88,0.20);color:#30d158}',
          '.bot.bad{background:rgba(255,69,58,0.18);color:#ff453a}',
          '.big.w{font-size:40px}',
          '.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;min-height:30px}',
          '.chips span{height:30px;padding:0 12px;border-radius:15px;display:inline-flex;align-items:center;',
          '  font-size:14px;font-weight:600;background:rgba(255,255,255,0.10);color:' + window.hkCards.v('ink-2') + ';',
          '  font-variant-numeric:tabular-nums}',
          '.chips .good{color:#30d158}.chips .warn{color:#ffd60a}.chips .low{color:#ff453a}',
          '.chips .err{background:rgba(255,69,58,0.18);color:#ff6961}',
          '.cmds{align-self:stretch;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
          '.cmds button{display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:none;',
          '  color:#fff;font:inherit;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent}',
          '.cmds .ci{width:72px;height:72px;border-radius:36px;display:flex;align-items:center;justify-content:center;',
          '  background:rgba(255,255,255,0.13);transition:background .2s,color .2s}',
          '.cmds button:active .ci{background:rgba(255,255,255,0.24)}',
          '.cmds button.sel .ci{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.85)}',
          '.cmds button[disabled]{opacity:.35;cursor:default}',
          '.cmds .cl{font-size:14px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
          '.pn > .menu{margin-top:0}',
          // CLEAN AREAS: the rooms this robot has on its map, two to a row,
          // a pick toggles; the green button sends only this robot.
          '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px}',
          '.bk{display:flex;align-items:center;gap:10px}',
          '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
          '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
          '.agf{flex:0 0 auto}',
          '.ag{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:360px;overflow-y:auto;',
          '  overscroll-behavior:contain;scrollbar-width:none}',
          '.ag::-webkit-scrollbar{display:none}',
          // centred: text-only buttons have no glyph to share a left edge with
          '.ag .btn{height:48px;border-radius:24px;padding:0 12px;font-size:15px;min-width:0;justify-content:center;text-align:center}',
          '.ag .btn span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
          '.go{align-self:stretch;background:#30d158}',
          '.go:active{background:#28b84c}',
          '.go[disabled]{background:rgba(255,255,255,0.13);opacity:.5}',
          '.why{font-size:14px;color:#ff6961;text-align:center;min-height:18px;margin-top:-6px}',
          '@media (max-width:' + C.BP.phone + 'px){.bot{width:170px;height:170px;border-radius:85px}',
          '  .cmds .ci{width:60px;height:60px;border-radius:30px}.big.w{font-size:34px}',
          '  .ag{max-height:320px}.ag .btn{height:44px;border-radius:22px;padding:0 10px}}'
        ].join('');
      }
      hkWidthKind() { return 'vacuum'; }
      // the sensors: the source card's, else found on the vacuum's device
      _parts() {
        if (this._pt) return this._pt;
        var c = this._src.config || {}, h = this.client, id = this._id;
        var find = function (re, dc) {
          return deviceSensor(h, id, function (k, st) {
            return dc ? !!(st && st.attributes && st.attributes.device_class === dc) : re.test(k);
          });
        };
        this._pt = {
          battery: c.battery || find(null, 'battery'),
          room: c.room || find(/current_room$/),
          progress: c.progress || find(/cleaning_progress$/),
          error: c.error || find(/(operational|vacuum)_error$/),
          dock_error: c.dock_error || find(/dock_error$/)
        };
        return this._pt;
      }
      _v(id) { var c = this.client, st = id && c && c.states[id]; return st ? st.state : null; }
      // The chips read other sensors (battery, room, progress, errors): they
      // are inputs like the vacuum, or a battery charging on the dock would
      // never move the sheet (the default signature is the vacuum alone).
      _sigOf() {
        var h = this.client, id = this._id;
        if (!h || !id) return null;
        var p = this._parts(), out = '';
        [id, p.battery, p.room, p.progress, p.error, p.dock_error].forEach(function (k) {
          var st = k && h.states[k];
          out += (st ? st.last_updated : 'x') + '|';
        });
        return out;
      }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        this._na(s);
        var f = num(at(s, 'supported_features')) || 0;
        if (!this._view) this._view = 'main';
        if (this._view === 'areas') { this._renderAreas(); return; }
        if (!this._built) {
          this._built = true;
          var cmds = [['start', 'mdi:play', 'Start', VF.START], ['pause', 'mdi:pause', 'Pause', VF.PAUSE],
                      ['locate', 'mdi:map-marker', 'Locate', VF.LOCATE], ['return_to_base', 'mdi:home-import-outline', 'Dock', VF.RETURN_HOME]];
          this._root.innerHTML = '<div class="pn"><div class="bot">' + glyph('mdi:robot-vacuum', 96) + '</div>' +
            '<div class="big w"></div><div class="chips"></div><div class="cmds">' +
            cmds.map(function (c) {
              return '<button data-s="' + c[0] + '"' + (f & c[3] ? '' : ' disabled') + ' aria-label="' + c[2] + '">' +
                     '<div class="ci">' + glyph(c[1], 30) + '</div><div class="cl">' + c[2] + '</div></button>';
            }).join('') + '</div></div>';
          this._root.querySelectorAll('.cmds button').forEach(function (b) {
            b.addEventListener('click', function () { self._svc('vacuum', b.getAttribute('data-s')); });
          });
          this._bot = this._root.querySelector('.bot');
          this._big = this._root.querySelector('.big');
          this._chips = this._root.querySelector('.chips');
          this._areasBtn();
        }
        var st = s.state, p = this._parts();
        var live = st === 'cleaning' || st === 'returning';
        var chips = [];
        var bn = num(at(s, 'battery_level'));
        if (bn == null) bn = num(this._v(p.battery));
        if (bn != null) chips.push([Math.round(bn) + '% battery', bn <= 20 ? 'low' : bn <= 40 ? 'warn' : '']);
        // a room and a percentage next to a DOCKED vacuum are last run's
        if (live) {
          var room = this._v(p.room);
          if (room && room !== 'unknown' && room !== 'unavailable') chips.push([room, '']);
          var pr = num(this._v(p.progress));
          if (pr != null && pr > 0) chips.push([Math.round(pr) + '% done', 'good']);
        }
        var errs = [p.error, p.dock_error].map(function (id) { return self._v(id); })
          .filter(function (e) { return e && VAC_OK.indexOf(e) === -1; });
        errs.forEach(function (e) { chips.push([pretty(e), 'err']); });
        var bad = unavailable(s) || st === 'error' || errs.length > 0;
        this._bot.classList.toggle('live', live && !bad);
        this._bot.classList.toggle('bad', bad);
        this._big.textContent = unavailable(s) ? 'Unavailable' : VAC_WORDS[st] || pretty(st);
        var html = chips.map(function (c) { return '<span class="' + c[1] + '">' + esc(c[0]) + '</span>'; }).join('');
        if (this._chipsHtml !== html) { this._chipsHtml = html; this._chips.innerHTML = html; }
        var on = { start: st === 'cleaning', pause: st === 'paused', return_to_base: st === 'returning' };
        this._root.querySelectorAll('.cmds button').forEach(function (b) {
          b.classList.toggle('sel', !!on[b.getAttribute('data-s')]);
        });
      }
    }

    // ------------------------------------------------------------ vacuum: areas
    // WHICH ROOMS THIS ROBOT KNOWS comes from Home Assistant's own mapping (the
    // vacuum's entity settings), read through Clean Areas' dry run -- a
    // plan, nothing sent -- once per sheet. Only a robot that takes
    // vacuum.clean_area gets the button; one that just starts in its own room
    // has nothing to choose.
    VacuumPanel.prototype._areasBtn = function () {
      var self = this, h = this.client;
      var add = function () {
        if (!self._reach || !self._reach.length || self._view !== 'main') return;
        var pn = self._root.querySelector('.pn');
        if (!pn || pn.querySelector('.menu')) return;
        var b = document.createElement('button');
        b.className = 'btn menu';
        b.innerHTML = '<span>Clean Areas</span><span class="cur">' + self._reach.length + ' rooms' + CHEV + '</span>';
        b.addEventListener('click', function () { self._view = 'areas'; self._built = false; self._render(); });
        pn.appendChild(b);
      };
      if (this._reach !== undefined) { add(); return; }
      this._reach = null;
      var C1 = window.hkCards;
      if (!h || !C1 || !C1.added || !C1.added('clean_areas') || !h.services || !h.services.vacuum ||
          !h.services.vacuum.clean_area) return;
      var id = this._id;
      this._callResp('hk_frontend', 'clean_areas', { areas: Object.keys(h.areas || {}), dry_run: true }).then(function (res) {
        var plan = (res && res.response && res.response.plan) || [];
        var mine = plan.filter(function (p) { return p.vacuum === id && p.action === 'clean_area'; })[0];
        var areas = (mine && mine.areas) || [];
        var hh = self.client || h;
        self._reach = areas.map(function (a) { return { id: a, name: (hh.areas[a] && hh.areas[a].name) || pretty(a) }; })
          .sort(function (x, y) { return x.name.localeCompare(y.name); });
        add();
      });
    };
    VacuumPanel.prototype._renderAreas = function () {
      var self = this;
      if (!this._pick) this._pick = new Set();
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<div class="pn"><div class="sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">Clean Areas</div></div>' +
          '<div class="hk-edge agf"><div class="ag">' + (this._reach || []).map(function (a) {
            return '<button class="btn" data-a="' + esc(a.id) + '" aria-pressed="false"><span>' + esc(a.name) + '</span></button>';
          }).join('') + '</div></div><button class="btn go" disabled></button><div class="why"></div></div></div>';
        this._root.querySelector('.bk button').addEventListener('click', function () { self._view = 'main'; self._built = false; self._render(); });
        C.edges(this._root);
        this._root.querySelectorAll('.ag .btn').forEach(function (b) {
          b.addEventListener('click', function () {
            var a = b.getAttribute('data-a');
            if (self._pick.has(a)) self._pick.delete(a); else self._pick.add(a);
            self._paintAreas();
          });
        });
        var go = this._goBtn = this._root.querySelector('.go');
        this._why = this._root.querySelector('.why');
        go.addEventListener('click', function () {
          if (!self._pick.size || go.disabled) return;
          var areas = Array.from(self._pick);
          go.disabled = true;
          self._why.textContent = '';
          // THIS robot only: the picker on the vacuum page is the home-wide one
          self._svc('vacuum', 'clean_area', { cleaning_area_id: areas }).then(function (ok) {
            if (ok) { self._pick.clear(); self._view = 'main'; self._built = false; self._render(); return; }
            // the selection survives a failed send
            self._why.textContent = 'Could not start. Tap to try again.';
            self._paintAreas();
          });
        });
      }
      this._paintAreas();
    };
    VacuumPanel.prototype._paintAreas = function () {
      var pick = this._pick, n = pick.size;
      this._root.querySelectorAll('.ag .btn').forEach(function (b) {
        var on = pick.has(b.getAttribute('data-a'));
        b.classList.toggle('sel', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (this._goBtn) {
        this._goBtn.disabled = !n;
        this._goBtn.textContent = n ? 'Clean ' + n + (n === 1 ? ' Area' : ' Areas') : 'Choose Areas';
      }
    };

    // ------------------------------------------------------------ valve
    // The water is never one tap either way: the lock's ring, held to close
    // AND held to open. Blue while it runs, grey when it is shut.
    class ValvePanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      spec(s) {
        var st = s.state, f = num(at(s, 'supported_features')) || 0;
        var bad = gone(s), unsure = st === 'unknown';
        var what = ({ water: 'the water', gas: 'the gas' })[at(s, 'device_class')] || this._who(s, 'the valve');
        var shut = st === 'closed' || st === 'closing';
        return {
          word: bad ? 'Unavailable' : unsure ? 'Unknown' : ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' })[st] || pretty(st),
          glyph: at(s, 'device_class') === 'gas' ? 'mdi:fire' : shut ? 'hk:water-alert' : 'hk:water',
          tone: 'water', shut: shut, busy: st === 'opening' || st === 'closing', bad: bad,
          // (not knowing: closing is the safe way -- the water off)
          hold: st === 'closed' && (f & 1) ? ['valve', 'open_valve'] : (st === 'open' || unsure) && (f & 2) ? ['valve', 'close_valve'] : null,
          tap: null,
          hint: st === 'closed' ? 'Hold to open' : st === 'open' || unsure ? 'Hold to close' : '',
          label: st === 'closed' ? 'Hold to open' : st === 'open' || unsure ? 'Hold to close' : '',
          ask: (st === 'open' || unsure ? 'Turn off ' : 'Turn on ') + what + '?'
        };
      }
    }

    // ------------------------------------------------------------ numbers
    // A number is the brightness slider with the value above it.
    class NumberPanel extends Panel {
      static get CSS() { return PANEL_CSS + '.big .u{font-size:22px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';margin-left:4px;letter-spacing:0}'; }
      hkWidthKind() { return 'number'; }
      _range(s) {
        var lo = num(at(s, 'min')), hi = num(at(s, 'max')), step = num(at(s, 'step')) || 1;
        if (lo == null) lo = 0;
        if (hi == null || hi <= lo) hi = lo + 100;
        return { lo: lo, hi: hi, step: step, n: Math.round((hi - lo) / step) };
      }
      _fmt(v, r) {
        var dp = String(r.step).indexOf('.') === -1 ? 0 : String(r.step).split('.')[1].length;
        return Number(v).toFixed(dp);
      }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var r = this._range(s), u = at(s, 'unit_of_measurement') || '';
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><div class="big"><span class="n"></span><span class="u"></span></div></div>';
          var pn = this._root.querySelector('.pn');
          var val = function (v) { return r.lo + Math.round(v * r.n) * r.step; };
          var send = throttle(function (v) { self._svc(domainOf(self._id), 'set_value', { value: Number(self._fmt(val(v), r)) }); }, 400);
          this._slider = this._vslider({
            steps: r.n <= 10 ? r.n : 0, label: at(s, 'friendly_name') || 'Value',
            onInput: function (v) { self._n.textContent = self._fmt(val(v), r); },
            onChange: function (v) { self._n.textContent = self._fmt(val(v), r); send(v); }
          });
          pn.appendChild(this._slider.el);
          this._n = this._root.querySelector('.n');
          this._root.querySelector('.u').textContent = u;
        }
        var v = num(s.state), na = this._na(s);
        if (!this._slider.dragging()) {
          this._n.textContent = na ? 'Unavailable' : v == null ? '—' : this._fmt(v, r);
          if (v != null) this._slider.set((v - r.lo) / (r.hi - r.lo));
        }
      }
    }

    // ------------------------------------------------------------ selects
    // A select is its list.
    // THE LIST FILLS THE SHEET: rows stretch from 52 to at most ROW_MAX px,
    // so eight options fill the height and three stay a list, centred --
    // and past what fits, it scrolls at 52.
    var ROW_MAX = 68;
    class SelectPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + LIST_CSS + [
          // the host fills the body; HkBase's own wrapper div passes it on
          ':host{display:flex;flex-direction:column}',
          ':host > div{flex:1;min-height:0;display:flex;flex-direction:column}',
          '.pn{flex:1;min-height:0;align-items:stretch;justify-content:center;gap:16px;padding:0}',
          '.list{flex:1 1 auto;min-height:0;max-height:none;display:flex;flex-direction:column}',
          '.list button{flex:1 0 52px}',
          // AN OPTION WRAPS rather than ending in an ellipsis: a select's
          // options are sentences as often as names ("Relaxed 2 min (may
          // return behind screensaver)" lost its point on a phone). Two
          // lines still fit ROW_MAX.
          '.list button span{white-space:normal;overflow-wrap:anywhere;line-height:22px;padding:12px 0}',
          '@media (max-width:' + C.BP.phone + 'px){.list{max-height:none}}'
        ].join('');
      }
      hkWidthKind() { return 'select'; }
      hkFill() { return true; }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var opts = (at(s, 'options') || []).slice();
        var sig = opts.join('|');
        if (!this._built || this._opsSig !== sig) {
          this._built = true;
          this._opsSig = sig;
          this._root.innerHTML = '<div class="pn"></div>';
          this._paint = pickList(this._root.querySelector('.pn'), opts, function (o) {
            self._svc(domainOf(self._id), 'select_option', { option: o });
          }, at(s, 'friendly_name'));
          this._root.querySelector('.list').style.maxHeight = (opts.length * ROW_MAX) + 'px';
        }
        this._na(s);
        this._paint(s.state);
      }
    }

    // ------------------------------------------------------------ humidifier
    // Target humidity is the slider; power and (when it has them) the mode
    // sit under it, the mode opening its list.
    class HumidifierPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + LIST_CSS + [
          '.pn{gap:20px}',
          // Target and Now, side by side
          '.rds{align-self:stretch;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));text-align:center}',
          '.rds .k{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
          '.rds .v{font-size:40px;font-weight:600;letter-spacing:-1px;line-height:1.15;font-variant-numeric:tabular-nums}',
          '.rds .v.nw{color:' + window.hkCards.v('ink-2') + '}',
          // the slider between an empty column and the "Now" marker's, so it
          // stays centred on the sheet
          '.sl{display:grid;grid-template-columns:96px 150px 96px;column-gap:14px;align-items:center}',
          // 400, not 330: at 330 the same 150 px width reads as a wider slider
          // than the fan's 420 -- the proportion, not the width
          '.vs{height:400px}',
          '.vs .fill{background:linear-gradient(180deg,#8fd6ef,#56bde4)}',
          '.vs.off .fill{background:rgba(255,255,255,0.35)}',
          '.mk{position:relative;height:400px}',
          '.mk span{position:absolute;left:0;transform:translateY(50%);display:flex;align-items:center;gap:6px;',
          '  font-size:13px;font-weight:600;color:rgba(235,235,245,0.8);white-space:nowrap;transition:bottom .2s}',
          '.mk span::before{content:"";width:14px;height:2px;border-radius:1px;background:currentColor}',
          '.acts{align-self:stretch;display:flex;gap:12px;align-items:center}',
          '.acts .menu{flex:1}',
          C.segCss('.seg', { on: '.sel', fill: true }),
          '.seg{flex:1;min-width:0}',
          '.acts .pw{width:44px;height:44px;padding:0;flex-shrink:0}',
          '.acts .pw.lit{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.85)}',
          '.acts .wide{flex:1}',
          '@media (max-width:' + C.BP.phone + 'px){.sl{grid-template-columns:72px 128px 72px;column-gap:10px}',
          '  .vs{height:330px}.mk{height:330px}.rds .v{font-size:34px}',
          '  .seg button{font-size:13px;line-height:15px;white-space:normal;text-overflow:clip}}'
        ].join('');
      }
      hkWidthKind() { return 'humidifier'; }
      _go(v) { this._view = v; this._built = false; this._render(); }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var a = s.attributes || {}, on = s.state === 'on';
        var lo = num(a.min_humidity) != null ? num(a.min_humidity) : 0, hi = num(a.max_humidity) || 100;
        var modes = (a.available_modes || []).slice();
        if (!this._built) {
          this._built = true;
          if (this._view === 'modes') {
            this._root.innerHTML = '<div class="pn"><div class="sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">Mode</div></div></div></div>';
            this._root.querySelector('.bk button').addEventListener('click', function () { self._go('main'); });
            this._paintModes = pickList(this._root.querySelector('.sub'), modes, function (m) {
              self._svc('humidifier', 'set_mode', { mode: m });
              self._go('main');
            }, 'modes');
          } else {
            this._paintModes = null;
            this._root.innerHTML = '<div class="pn">' +
              '<div class="rds"><div><div class="k">Target</div><div class="v tg"></div></div>' +
              '<div><div class="k kn">Now</div><div class="v nw"></div></div></div>' +
              '<div class="sl"><div></div><div class="slot"></div><div class="mk"><span></span></div></div>' +
              '<div class="acts"></div></div>';
            var val = function (v) { return Math.round(lo + v * (hi - lo)); };
            var send = throttle(function (v) { self._svc('humidifier', 'set_humidity', { humidity: val(v) }); }, 400);
            this._slider = this._vslider({
              label: 'Target humidity', glyph: glyph('mdi:water-percent', 30),
              onInput: function (v) { self._tgt.textContent = val(v) + '%'; },
              onChange: function (v) { self._tgt.textContent = val(v) + '%'; send(v); }
            });
            this._root.querySelector('.slot').appendChild(this._slider.el);
            this._tgt = this._root.querySelector('.tg');
            this._nw = this._root.querySelector('.nw');
            this._kn = this._root.querySelector('.kn');
            this._mk = this._root.querySelector('.mk span');
            var acts = this._root.querySelector('.acts');
            this._seg = null; this._mode = null;
            if (modes.length && modes.length <= 4) {
              // up to four modes: a segmented row; more: the pick list
              var seg = document.createElement('div');
              seg.className = 'seg';
              seg.innerHTML = modes.map(function (m) { return '<button data-m="' + esc(m) + '">' + esc(pretty(m)) + '</button>'; }).join('');
              seg.querySelectorAll('button').forEach(function (b) {
                b.addEventListener('click', function () { self._svc('humidifier', 'set_mode', { mode: b.getAttribute('data-m') }); });
              });
              acts.appendChild(seg);
              this._seg = seg;
            } else if (modes.length) {
              var m = document.createElement('button');
              m.className = 'btn menu';
              m.innerHTML = '<span>Mode</span><span class="cur"></span>';
              m.addEventListener('click', function () { self._go('modes'); });
              acts.appendChild(m);
              this._mode = m;
            }
            var pw = document.createElement('button');
            pw.className = 'btn pw';
            pw.setAttribute('aria-label', 'Power');
            pw.innerHTML = glyph('mdi:power', 24);
            pw.addEventListener('click', function () { self._svc('humidifier', self._stateObj.state === 'on' ? 'turn_off' : 'turn_on'); });
            // no modes: the power button is the row, with its words
            if (!modes.length) { pw.className = 'btn wide'; pw.innerHTML = glyph('mdi:power', 22) + '<span class="pwl"></span>'; }
            acts.appendChild(pw);
            this._pw = pw;
          }
        }
        var na = this._na(s);
        if (this._paintModes) { this._paintModes(a.mode); return; }
        var t = num(a.humidity), cur = num(a.current_humidity);
        if (!this._slider.dragging()) {
          this._tgt.textContent = t == null || na ? '—' : Math.round(t) + '%';
          if (t != null) this._slider.set((t - lo) / (hi - lo));
        }
        this._slider.el.classList.toggle('off', !on);
        this._nw.textContent = na || cur == null ? '—' : Math.round(cur) + '%';
        this._kn.textContent = na ? 'Unavailable' : !on ? 'Now · Off' :
          'Now · ' + (a.action === 'drying' ? 'Drying' : a.action === 'humidifying' ? 'Humidifying' : a.action === 'idle' ? 'Idle' : 'On');
        // the marker: where the air is, against where it is asked to be
        this._mk.hidden = cur == null || na;
        if (cur != null) {
          this._mk.style.bottom = (clamp((cur - lo) / (hi - lo), 0, 1) * 100).toFixed(1) + '%';
          this._mk.textContent = 'Now ' + Math.round(cur) + '%';
        }
        if (this._seg) segPick(this._seg, 'button', 'data-m', a.mode);
        if (this._mode) this._mode.querySelector('.cur').innerHTML = esc(pretty(a.mode || '')) + CHEV;
        this._pw.classList.toggle('lit', on && this._pw.classList.contains('pw'));
        this._pw.classList.toggle('sel', on && !this._pw.classList.contains('pw'));
        var l = this._pw.querySelector('.pwl');
        if (l) l.textContent = on ? 'Turn Off' : 'Turn On';
      }
    }

    // ------------------------------------------------------------ water heater
    // THE THERMOSTAT'S SHEET, ONE SETPOINT: the two are the same, and the
    // same size. The ring is the thermostat
    // card's ring -- same box, radius, stroke, knob, blue-to-orange band and
    // current-temperature dot (hk-control _climate; a test holds the numbers
    // together) -- sized by the same --hk-tstat-* variables, so the wide sheet
    // makes both 400 px and a phone both 300. Left: the ring, the operation
    // modes and the power. Right: the tank now and its 24-hour low and high,
    // away mode, and the tank's last day. Drag the ring or use the arrows.
    var WF = { TARGET: 1, MODE: 2, AWAY: 4, ONOFF: 8 };
    // the heater's own words for its modes: one word where HA's is
    // two and the row is a quarter wide ("High demand" -> "Demand"), and
    // "Heat Pump" capitalised as the name it is; the rest are pretty(m)
    var WH_WORDS = { high_demand: 'Demand', heat_pump: 'Heat Pump' };
    function whWord(m) { return WH_WORDS[m] || pretty(m); }
    // hk-control _climate: viewBox 0 0 200 172, centre (100,100), r 78,
    // 135 degrees round through 270 (the gap at the bottom)
    var WD = { W: 200, H: 172, CX: 100, CY: 100, R: 78, A0: 135, SWEEP: 270 };
    function arcPoint(deg) {
      var r = deg * Math.PI / 180;
      return [WD.CX + WD.R * Math.cos(r), WD.CY + WD.R * Math.sin(r)];
    }
    function arcPath(f) {
      var a = arcPoint(WD.A0), b = arcPoint(WD.A0 + WD.SWEEP * f);
      var large = WD.SWEEP * f > 180 ? 1 : 0;
      return 'M' + a[0].toFixed(2) + ' ' + a[1].toFixed(2) + ' A' + WD.R + ' ' + WD.R + ' 0 ' + large + ' 1 ' + b[0].toFixed(2) + ' ' + b[1].toFixed(2);
    }
    class WaterHeaterPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + LIST_CSS + [
          '.pn{gap:12px}',
          // narrow (a phone): one column -- .side dissolves into it
          '.side{display:contents}',
          '.dial{align-self:stretch;display:flex;flex-direction:column;align-items:center}',
          // the ring: hk-control's .ring/.tstat-wrap/.tstat-face, value for value
          // pan-y, as the thermostat's ring: a vertical swipe scrolls the sheet
          '.dl{position:relative;width:100%;max-width:var(--hk-tstat-ring,300px);touch-action:pan-y;cursor:pointer;',
          '  outline:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}',
          '.dl:focus-visible{border-radius:20px;box-shadow:0 0 0 3px rgba(100,181,255,0.8)}',
          '.dl svg{display:block;width:100%;height:auto;overflow:visible}',
          '.dl .trk{fill:none;stroke:' + window.hkCards.v('line-strong') + ';stroke-width:22px;stroke-linecap:round}',
          '.dl .bnd{fill:none;stroke-width:22px;stroke-linecap:round}',
          '.dl .kn{fill:#fff;stroke:rgba(0,0,0,.18);stroke-width:1px}',
          '.dl .cur{fill:rgba(255,255,255,.92)}',
          '.dl .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}',
          '.dl .l{font-size:11px;font-weight:730;letter-spacing:1.1px;text-transform:uppercase;color:' + window.hkCards.v('ink-2') + '}',
          '.dl .t{font-size:var(--hk-tstat-val,46px);font-weight:600;letter-spacing:-2px;line-height:1.04;',
          '  font-variant-numeric:tabular-nums;margin-top:2px}',
          '.dl .r{font-size:13px;font-weight:680;margin-top:4px;color:#ff9f0a}',
          '.dl.off .r{color:' + window.hkCards.v('ink-2') + '}',
          // the modes: the thermostat's mode row (hk-control .tstat-modes
          // .segment). A label may take two lines -- "High demand" in a
          // quarter of the row -- rather than lose its end.
          '.acts,.pwr{align-self:stretch;display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));gap:6px}',
          // + 2: the card's flex gap under its ring (.tstat{gap:2px})
          '.acts,.dl + .pwr{margin-top:calc(var(--hk-tstat-gap,14px) + 2px)}',
          '.acts button,.pwr button{height:var(--hk-tstat-seg,40px);border:0;border-radius:13px;background:rgba(255,255,255,.09);',
          '  color:rgba(255,255,255,.92);font:inherit;font-size:var(--hk-tstat-seg-font,12.5px);font-weight:680;line-height:1.15;',
          '  padding:0 4px;cursor:pointer;white-space:normal;overflow:hidden;display:flex;align-items:center;justify-content:center;',
          '  gap:6px;-webkit-tap-highlight-color:transparent}',
          '.acts button.sel,.pwr button.sel{background:rgba(255,255,255,.96);color:rgba(0,0,0,.88)}',
          C.segCss('.acts.mseg', { on: '.sel', fill: true }),
          '.acts.mseg{display:flex}',
          '.acts .menu{justify-content:space-between;padding:0 14px}',
          // THE POWER, ITS OWN ROW, AS WIDE AS THE MODES: where the
          // thermostat has its fan row, and sized as that row
          '.acts + .pwr{margin-top:calc(var(--hk-tstat-fan-gap,6px) + 2px)}',
          '.pwr button{height:var(--hk-tstat-fan,32px);border-radius:11px;font-size:var(--hk-tstat-fan-font,11.5px);font-weight:640}',
          // the tank now and its day's low and high (the thermostat's reading card)
          '.now{align-self:stretch;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;',
          '  padding:12px 18px;border-radius:20px;background:rgba(255,255,255,0.08);text-align:center}',
          '.now .k{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
          '.now .v{font-size:19px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}',
          '.away{align-self:stretch;justify-content:space-between;padding:0 12px 0 20px}',
          '.sw{width:51px;height:31px;border-radius:16px;background:rgba(255,255,255,0.22);position:relative;flex-shrink:0;transition:background .2s}',
          '.sw i{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;transition:left .2s}',
          '.sw.on{background:#30d158}.sw.on i{left:22px}',
          '.trend{align-self:stretch;padding:12px 16px 8px;border-radius:20px;background:rgba(255,255,255,0.08)}',
          '.trend .tt2{font-size:13px;font-weight:600;letter-spacing:0.3px;color:' + window.hkCards.v('ink-2') + ';text-transform:uppercase;margin-bottom:6px}',
          '@media (max-width:' + C.BP.phone + 'px){.now{padding:12px 14px;gap:8px}.now .v{font-size:17px}}',
          // WIDE: the thermostat's two columns -- see ClimatePanel
          ':host([wide]) .pn{flex-direction:row;align-items:stretch;gap:28px}',
          ':host([wide]) .dial{' + TSTAT_WIDE + '}',
          ':host([wide]) .side{display:flex;flex-direction:column;gap:12px;flex:1;min-width:0}',
          ':host([wide]) .now{padding:14px 18px}',
          ':host([wide]) .trend{flex:1;display:flex;flex-direction:column;padding:' + SP.cardPad + ';min-height:0}',
          ':host([wide]) .trend .axc{flex:1;min-height:72px;margin-top:8px}',
          ':host([wide]) .trend .tt2{margin-bottom:0}'
        ].join('');
      }
      hkWidthKind() { return 'water_heater'; }
      _wideAt() { return 700; }
      _onWide() { this._tankKey = null; this._paintTank(); this._alignTop(); }
      _go(v) { this._view = v; this._built = false; this._render(); }
      _range(s) {
        var a = s.attributes || {};
        var c = this.client, unit = window.hkLocale.units().temp;
        var lo = num(a.min_temp), hi = num(a.max_temp);
        if (lo == null) lo = /C/.test(unit) ? 30 : 90;
        if (hi == null || hi <= lo) hi = /C/.test(unit) ? 70 : 150;
        return { lo: lo, hi: hi, step: num(a.target_temp_step) || (/C/.test(unit) ? 0.5 : 1) };
      }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        var a = s.attributes || {}, f = num(a.supported_features) || 0;
        // "off" is the power, not a mode: it leaves the mode row for the power
        // button (the heater's own turn_off where it has one)
        var all = (a.operation_list || []).slice();
        var hasOff = all.indexOf('off') !== -1;
        var modes = all.filter(function (m) { return m !== 'off'; });
        var power = !!(f & WF.ONOFF) || hasOff;
        if (!this._built) {
          this._built = true;
          if (this._view === 'modes') {
            this._root.innerHTML = '<div class="pn"><div class="sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">Mode</div></div></div></div>';
            this._root.querySelector('.bk button').addEventListener('click', function () { self._go('main'); });
            this._paintModes = pickList(this._root.querySelector('.sub'), modes, function (m) {
              self._svc('water_heater', 'set_operation_mode', { operation_mode: m });
              self._go('main');
            }, 'modes');
          } else {
            this._paintModes = null;
            // what the heater has decides what is built: up to four modes as
            // the row, more as the pick list, away mode only where it exists
            var segMode = (f & WF.MODE) && modes.length && modes.length <= 4;
            var menuMode = (f & WF.MODE) && modes.length > 4;
            this._root.innerHTML = '<div class="pn"><div class="dial">' +
              '<div class="dl" role="slider" tabindex="0" aria-label="Target temperature">' +
              '<svg viewBox="0 0 ' + WD.W + ' ' + WD.H + '" aria-hidden="true">' +
              '<defs class="gd"></defs>' +
              '<path class="trk" d="' + arcPath(1) + '"/><path class="bnd" stroke="url(#whg)" d=""/>' +
              '<circle class="cur" r="4" cx="0" cy="0"/><circle class="kn" r="13" cx="0" cy="0"/></svg>' +
              '<div class="c"><div class="l">Heat to</div><div class="t"></div><div class="r"></div></div></div>' +
              (segMode ? '<div class="acts mseg" style="--n:' + modes.length + '">' +
                modes.map(function (m) { return '<button class="seg-m" data-m="' + esc(m) + '">' + esc(whWord(m)) + '</button>'; }).join('') + '</div>' : '') +
              (menuMode ? '<div class="acts" style="--n:1"><button class="menu mode"><span>Mode</span><span class="cur"></span></button></div>' : '') +
              (power ? '<div class="pwr" style="--n:1"><button class="pw" aria-label="Power">' + glyph('mdi:power', 18) + '<span class="pwl"></span></button></div>' : '') +
              '</div><div class="side">' +
              '<div class="now"><div><div class="k">Tank now</div><div class="v tn">—</div></div>' +
              '<div><div class="k">Lowest</div><div class="v tl">—</div></div>' +
              '<div><div class="k">Highest</div><div class="v th">—</div></div></div>' +
              ((f & WF.AWAY) ? '<button class="btn away" role="switch"><span>Away mode</span><span class="sw"><i></i></span></button>' : '') +
              '<div class="trend" hidden></div></div></div>';
            this._dl = this._root.querySelector('.dl');
            this._wire();
            this._seg = segMode ? this._root.querySelector('.acts') : null;
            this._mode = menuMode ? this._root.querySelector('.mode') : null;
            this._away = (f & WF.AWAY) ? this._root.querySelector('.away') : null;
            this._pw = power ? this._root.querySelector('.pw') : null;
            if (this._pw) this._pw.addEventListener('click', function () {
              var st = self._stateObj, ff = num(at(st, 'supported_features')) || 0, isOff = st.state === 'off';
              if (ff & WF.ONOFF) { self._svc('water_heater', isOff ? 'turn_on' : 'turn_off'); return; }
              // no on/off service: "off" is a mode; on is the last mode it ran in
              var back = self._lastMode || (at(st, 'operation_list') || []).filter(function (m) { return m !== 'off'; })[0];
              self._svc('water_heater', 'set_operation_mode', { operation_mode: isOff ? back : 'off' });
            });
            if (this._seg) this._seg.querySelectorAll('[data-m]').forEach(function (b) {
              b.addEventListener('click', function () { self._svc('water_heater', 'set_operation_mode', { operation_mode: b.getAttribute('data-m') }); });
            });
            if (this._mode) this._mode.addEventListener('click', function () { self._go('modes'); });
            if (this._away) this._away.addEventListener('click', function () {
              self._svc('water_heater', 'set_away_mode', { away_mode: at(self._stateObj, 'away_mode') !== 'on' });
            });
            this._trend = this._root.querySelector('.trend');
            this._runAt = 0; this._tankKey = null;
          }
        }
        var na = this._na(s);
        if (this._paintModes) { this._paintModes(a.operation_mode || s.state); return; }
        var cur = num(a.current_temperature), off = s.state === 'off';
        this._dl.classList.toggle('off', off);
        if (!this._drag) this._paintDial(num(a.temperature));
        var om = a.operation_mode || s.state;
        if (om && om !== 'off') this._lastMode = om;
        // the face's third line is the thermostat's "Cooling": what it is doing
        this._root.querySelector('.r').textContent = na ? 'Unavailable' : off ? 'Off' : whWord(om || 'on');
        this._root.querySelector('.tn').textContent = na || cur == null ? '—' : Math.round(cur) + '°';
        if (this._seg) segPick(this._seg, '[data-m]', 'data-m', om);
        if (this._pw) {
          this._pw.classList.toggle('sel', !off);
          this._pw.setAttribute('aria-pressed', off ? 'false' : 'true');
          // the humidifier's wide power button says what a tap does
          this._pw.querySelector('.pwl').textContent = off ? 'Turn On' : 'Turn Off';
        }
        if (this._mode) this._mode.querySelector('.cur').innerHTML = esc(whWord(om || '')) + CHEV;
        if (this._away) {
          var aw = at(s, 'away_mode') === 'on';
          this._away.querySelector('.sw').classList.toggle('on', aw);
          this._away.setAttribute('aria-checked', aw ? 'true' : 'false');
        }
        this._alignTop();
        this._tank();
      }
      // the band from the bottom of the scale to the setpoint, cold to warm,
      // the knob on the setpoint, the dot at the tank -- hk-control _climate
      _paintDial(t) {
        var s = this._stateObj, r = this._range(s), off = s.state === 'off';
        var fr = t == null ? 0 : clamp((t - r.lo) / (r.hi - r.lo), 0, 1);
        var p0 = arcPoint(WD.A0), p = arcPoint(WD.A0 + WD.SWEEP * fr);
        var c0 = off ? 'rgba(255,255,255,.30)' : '#32ade6', c1 = off ? 'rgba(255,255,255,.30)' : '#ff9f0a';
        this._dl.querySelector('.gd').innerHTML = '<linearGradient id="whg" gradientUnits="userSpaceOnUse" x1="' + p0[0].toFixed(2) +
          '" y1="' + p0[1].toFixed(2) + '" x2="' + p[0].toFixed(2) + '" y2="' + p[1].toFixed(2) + '">' +
          '<stop offset="0" stop-color="' + c0 + '"/><stop offset="1" stop-color="' + c1 + '"/></linearGradient>';
        this._dl.querySelector('.bnd').setAttribute('d', fr > 0.001 ? arcPath(fr) : '');
        var k = this._dl.querySelector('.kn');
        k.setAttribute('cx', p[0].toFixed(2)); k.setAttribute('cy', p[1].toFixed(2));
        k.style.display = t == null || off ? 'none' : '';
        var cur = num(at(s, 'current_temperature')), d = this._dl.querySelector('.cur');
        d.style.display = cur == null ? 'none' : '';
        if (cur != null) {
          var q = arcPoint(WD.A0 + WD.SWEEP * clamp((cur - r.lo) / (r.hi - r.lo), 0, 1));
          d.setAttribute('cx', q[0].toFixed(2)); d.setAttribute('cy', q[1].toFixed(2));
        }
        this._dl.querySelector('.t').textContent = t == null ? '—' : (r.step < 1 ? t.toFixed(1) : Math.round(t)) + '°';
        this._dl.setAttribute('aria-valuenow', t == null ? '' : String(t));
      }
      // THE RIGHT COLUMN STARTS WHERE THE RING IS SEEN TO START -- the track's
      // top, y = 100 - 78 - 11 of the 172 box (as ClimatePanel._alignTop)
      _alignTop() {
        var side = this._root.querySelector('.side'), dial = this._root.querySelector('.dial');
        if (!side || !side.style || !dial) return;
        var svg = this._dl && this._dl.querySelector('svg');
        if (!this.hasAttribute('wide') || !svg || !svg.getBoundingClientRect) { side.style.marginTop = ''; return; }
        var rr = svg.getBoundingClientRect(), dr = dial.getBoundingClientRect();
        if (!rr.height) return;
        side.style.marginTop = Math.max(0, Math.round(rr.top - dr.top + rr.height * (WD.CY - WD.R - 11) / WD.H)) + 'px';
      }
      // THE THERMOSTAT RING'S GESTURE (hk-control _bind), because the phone
      // sheet scrolls and the dial must not take every touch. pan-y hands
      // a vertical swipe that starts on the dial to the sheet; nothing is
      // painted until the finger has moved SLOP px, so brushing it while
      // scrolling does not jump the number; the browser reports "that was a
      // scroll" by CANCELLING the pointer, which puts the dial back; a tap
      // that does not travel sets that point on lift. The heater hears the
      // value once, on release. Arrow keys unchanged.
      _wire() {
        var self = this, dl = this._dl;
        var send = throttle(function (t) { self._svc('water_heater', 'set_temperature', { temperature: t }); }, 500);
        var valueAt = function (e) {
          var b = dl.getBoundingClientRect(), sx = WD.W / b.width, sy = WD.H / b.height;
          var x = (e.clientX - b.left) * sx - WD.CX, y = (e.clientY - b.top) * sy - WD.CY;
          var deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
          var rel = (deg - WD.A0 + 360) % 360;
          if (rel > WD.SWEEP) rel = rel > (WD.SWEEP + 360) / 2 ? 0 : WD.SWEEP;
          var r = self._range(self._stateObj);
          var t = r.lo + rel / WD.SWEEP * (r.hi - r.lo);
          return clamp(Math.round(t / r.step) * r.step, r.lo, r.hi);
        };
        var ok = function () { var st = self._stateObj; return st && !unavailable(st) && st.state !== 'off' && ((num(at(st, 'supported_features')) || 0) & WF.TARGET); };
        var SLOP = 6, armed = null;
        var restore = function () { self._paintDial(num(at(self._stateObj, 'temperature'))); };
        dl.addEventListener('pointerdown', function (e) {
          if (!ok()) return;
          try { dl.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
          // armed, not grabbed: no paint yet
          armed = { x: e.clientX, y: e.clientY, t: valueAt(e) };
        });
        dl.addEventListener('pointermove', function (e) {
          if (armed && !self._drag) {
            var dx = e.clientX - armed.x, dy = e.clientY - armed.y;
            if (dx * dx + dy * dy <= SLOP * SLOP) return;     // not yet a drag
            self._drag = true;
          }
          if (!self._drag) return;
          self._paintDial(valueAt(e));
        });
        dl.addEventListener('pointerup', function (e) {
          if (!armed && !self._drag) return;
          try { dl.releasePointerCapture(e.pointerId); } catch (x) { /* ok */ }
          // a drag lands where it ended; a tap that did not travel, where it was
          var t = self._drag ? valueAt(e) : armed.t;
          self._drag = false; armed = null;
          self._paintDial(t);
          self._svc('water_heater', 'set_temperature', { temperature: t });
        });
        // the sheet took it for a scroll: forget it and show the real setpoint
        dl.addEventListener('pointercancel', function (e) {
          try { dl.releasePointerCapture(e.pointerId); } catch (x) { /* ok */ }
          var was = self._drag || armed;
          self._drag = false; armed = null;
          if (was) restore();
        });
        dl.addEventListener('keydown', function (e) {
          if (!ok()) return;
          var r = self._range(self._stateObj), cur = num(at(self._stateObj, 'temperature'));
          if (cur == null) cur = r.lo;
          var d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? r.step : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -r.step : 0;
          if (!d) return;
          e.preventDefault();
          var t = clamp(cur + d, r.lo, r.hi);
          self._paintDial(t); send(t);
        });
      }
      // the tank's last day, from the heater's own history (current_temperature)
      _tank() {
        var self = this, h = this.client, id = this._id, now = Date.now();
        if (!this._trend) return;
        if (h && h.callWS && (!this._runAt || now - this._runAt > 300000)) {
          this._runAt = now;
          h.callWS({ type: 'history/history_during_period', start_time: new Date(now - 24 * 3600000).toISOString(), entity_ids: [id],
                     minimal_response: false, no_attributes: false, significant_changes_only: false })
            .then(function (r) { self._rows = (r && r[id]) || []; self._paintTank(); }, function () { self._runAt = 0; });
        }
        this._paintTank();
      }
      _paintTank() {
        if (!this._rows || !this._trend) return;
        var pts = trendOf(this._rows, Date.now(), this._stateObj);
        var vs = pts.map(function (p) { return p.v; }).filter(function (v) { return v != null; });
        var lo = this._root.querySelector('.tl'), hi = this._root.querySelector('.th');
        if (lo && vs.length) {
          lo.textContent = Math.round(Math.min.apply(null, vs)) + '°';
          hi.textContent = Math.round(Math.max.apply(null, vs)) + '°';
        }
        if (pts.length < 2) return;
        // redrawn when the rows or the reading move, or the width changes
        var key = this._rows.length + '|' + at(this._stateObj, 'current_temperature');
        if (key === this._tankKey) return;
        this._tankKey = key;
        var wide = this.hasAttribute('wide'), phone = matchMedia('(max-width:' + C.BP.phone + 'px)').matches;
        this._trend.hidden = false;
        this._trend.innerHTML = '<div class="tt2">Tank, last 24 hours</div>' +
          axesChart({ pts: downsample(pts, 240), H: wide ? 120 : 70, unit: '°', ms: 24 * 3600000, n: phone ? 3 : 5,
                      colour: 'orange', fluid: wide });
        scrub(this._trend);
      }
    }

    // ------------------------------------------------------------ alarm
    // JUST THE KEYPAD, in the sheet: the state as the word every sheet leads
    // with, and the home's own keypad card under it -- the same card the
    // Security page shows, so the code path cannot drift. Locks and a
    // status block belong on the Security page, not in the alarm's sheet.
    var ALARM_WORDS = { disarmed: 'Disarmed', armed_home: 'Armed Home', armed_away: 'Armed Away', armed_night: 'Armed Night',
                        armed_vacation: 'Armed Vacation', armed_custom_bypass: 'Armed', arming: 'Arming…',
                        disarming: 'Disarming…', pending: 'Pending…', triggered: 'Triggered' };
    class AlarmPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          '.pn{align-items:stretch;gap:20px}',
          '.big.al{font-size:40px;align-self:center;display:flex;align-items:center;gap:12px}',
          '.big.al.trg{color:#ff453a}',
          // the shield the Security page's keypad shows at rest, in its colour
          '.big.al hk-icon{--mdc-icon-size:36px;width:36px;height:36px;display:flex;flex:none}',
          // the Security page's keypad, unboxed, its keys a size up for the sheet
          'hk-alarm-keypad-card{display:block;--hk-kp-key:56px}',
          // AN ALARM WITH NO CODE, AS A SHADE'S SHEET: the state's word, and
          // under it the slider's own capsule (.vs: its size, its glass) with
          // the modes spread down it -- the one it is in filled as the
          // slider's fill is, a hairline between the others
          '.pn.tapn{align-items:center}',
          '.pn.tapn .big.trg{color:#ff453a}',
          // where a shade's Open / Stop / Close row sits: kept empty, so the
          // word and the capsule land where a shade's do (the sheet centres)
          '.vpsp{height:52px}',
          '.vs.vp{height:400px;display:flex;flex-direction:column;padding:6px;box-sizing:border-box;cursor:default;touch-action:manipulation}',
          '.vp button{position:relative;flex:1 1 0;min-height:0;border:0;border-radius:38px;background:transparent;color:' + window.hkCards.v('ink') + ';',
          '  font:inherit;font-size:19px;font-weight:600;letter-spacing:-.2px;cursor:pointer;',
          '  -webkit-tap-highlight-color:transparent;transition:background .2s ease,color .2s ease}',
          '.vp button.on{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.88)}',
          // (the slider's own tick: 20 px in from each side, 2 px)
          '.vp button:not(:first-child)::before{content:"";position:absolute;left:14px;right:14px;top:-1px;',
          '  height:2px;border-radius:1px;background:rgba(255,255,255,0.16);transition:opacity .2s}',
          '.vp button.on::before,.vp button.on + button::before{opacity:0}',
          '.vp button:not(.on):active{background:rgba(255,255,255,0.10)}',
          '.vp button:focus-visible{outline:2px solid rgba(100,181,255,0.8);outline-offset:-2px}',
          ':host([na]) .vp button{opacity:.4;pointer-events:none}',
          '@media (max-width:' + C.BP.phone + 'px){.big.al{font-size:34px}.pn{gap:16px}.vs.vp{height:330px}.vp button{font-size:17px}.vpsp{height:48px}}'
        ].join('');
      }
      hkWidthKind() { return 'alarm'; }
      // the modes, in the picker's order, and the state each one sets
      static picks(K, s) {
        var W = { home: ['Home', 'armed_home'], away: ['Away', 'armed_away'], night: ['Night', 'armed_night'],
                  vacation: ['Vacation', 'armed_vacation'], custom_bypass: ['Custom', 'armed_custom_bypass'] };
        return K.modes(s).map(function (m) { return { key: m, label: W[m][0], state: W[m][1], service: 'alarm_arm_' + m }; })
          .concat([{ key: 'off', label: 'Off', state: 'disarmed', service: 'alarm_disarm' }]);
      }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        var K = customElements.get('hk-alarm-keypad-card');
        var codeless = !!(K && K.codeless && K.codeless(s));
        var shape = codeless ? 'tap:' + K.modes(s).join(',') : 'pad';
        if (this._built && this._shape !== shape) { this._built = false; this._card = null; this._vp = null; }
        this._shape = shape;
        if (!this._built && codeless) {
          this._built = true;
          this._root.innerHTML = '<div class="pn tapn"><div class="big"><span></span></div>' +
            '<div class="vs vp" role="radiogroup" aria-label="Mode"></div><div class="vpsp" aria-hidden="true"></div></div>';
          this._big = this._root.querySelector('.big');
          this._bigIcon = null;             // the word alone, as a shade's
          this._bigWord = this._big.querySelector('span');
          var self = this;
          this._vp = this._root.querySelector('.vp');
          AlarmPanel.picks(K, s).forEach(function (p) {
            var b = document.createElement('button');
            b.type = 'button'; b.textContent = p.label; b.setAttribute('role', 'radio');
            b.dataset.state = p.state;
            b.addEventListener('click', function () {
              // the pill moves at once; the panel's answer settles it -- a
              // refusal puts it straight back, and it never outlives its 10 s
              var want = self._want = { state: p.state, until: Date.now() + 10000 };
              self._paintPicks();
              clearTimeout(self._wantT);
              self._wantT = setTimeout(function () { if (self._want === want && self._vp) self._paintPicks(); }, 10050);
              self._svc('alarm_control_panel', p.service, {}).then(function (ok) {
                if (!ok && self._want === want) { self._want = null; if (self._vp) self._paintPicks(); }
              });
            });
            self._vp.appendChild(b);
          });
        }
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><div class="big al"><hk-icon></hk-icon><span></span></div></div>';
          this._big = this._root.querySelector('.big');
          this._bigIcon = this._big.querySelector('hk-icon');
          this._bigWord = this._big.querySelector('span');
          var card = document.createElement('hk-alarm-keypad-card');
          // glass: false -- the sheet is its own blur (as every panel).
          // status: false -- the sheet leads with the state word already, so
          // its readout stays the code line rather than saying it twice.
          try { card.setConfig({ entity: this._id, glass: false, status: false }); } catch (e) { /* not ready */ }
          this._root.querySelector('.pn').appendChild(card);
          this._card = card;
        }
        if (this._card) bridge(this._card, this.client);
        var st = s.state;
        (this._bigWord || this._big).textContent = unavailable(s) ? 'Unavailable' : ALARM_WORDS[st] || pretty(st);
        this._big.classList.toggle('trg', st === 'triggered');
        if (this._vp) this._paintPicks();
        if (this._bigIcon && K && K.status) {
          var look = K.status(s);
          if (this._bigIcon.getAttribute('icon') !== look.icon) this._bigIcon.setAttribute('icon', look.icon);
          this._bigIcon.style.color = look.color;
        }
      }
    }

    // the pill on the mode it is in -- or on the one just tapped while the
    // panel gets there (arming, pending), until it answers or 10 s pass
    AlarmPanel.prototype._paintPicks = function () {
      var s = this._stateObj, st = s ? s.state : '';
      var w = this._want;
      if (w && (st === w.state || Date.now() > w.until)) w = this._want = null;
      var on = w ? w.state : st;
      [].forEach.call(this._vp.children, function (b) {
        var yes = b.dataset.state === on;
        b.classList.toggle('on', yes);
        b.setAttribute('aria-checked', yes ? 'true' : 'false');
      });
    };

    // ------------------------------------------------------------ a camera
    // THE CAMERA SHEET: what every camera tap opens -- a tile on the Cameras
    // page, a room page's camera, the strip's stills and live tile -- in
    // place of HA's dialog, which on these dashboards is either a plain
    // dialog or, under a finger, nothing at all. It is a camera pop-up as a
    // sheet: hk-doorbell-card, which runs its own stream WITH sound, at the
    // camera's own shape, with hold-to-talk where the camera has a speaker.
    // A stream channel is chosen up: a strip shows the LOW resolution
    // channel, the sheet the HIGH one of the same device when there is one.
    function cameraStream(h, id) {
      var ents = (h && h.entities) || {}, e = ents[id], dev = e && e.device_id;
      if (!dev) return id;
      var hi = Object.keys(ents).filter(function (k) {
        return k.indexOf('camera.') === 0 && ents[k].device_id === dev && /high/.test(k) &&
               h.states[k] && h.states[k].state !== 'unavailable';
      }).sort()[0];
      return hi || id;
    }
    function cameraSpeaker(h, id) {
      var ents = (h && h.entities) || {}, e = ents[id], dev = e && e.device_id;
      if (!dev) return null;
      return Object.keys(ents).filter(function (k) {
        return k.indexOf('media_player.') === 0 && ents[k].device_id === dev && /speaker/.test(k);
      }).sort()[0] || null;
    }
    function cameraName(h, id) {
      var ents = (h && h.entities) || {}, devs = (h && h.devices) || {}, e = ents[id] || {};
      var dv = e.device_id && devs[e.device_id];
      var n = (dv && (dv.name_by_user || dv.name)) || at(stOf(h, id), 'friendly_name') || id;
      return String(n).replace(/\s+(low|medium|high)\s+resolution\s+channel$/i, '')
                      .replace(/\s+camera$/i, '') || n;
    }
    class CameraPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // the pop-ups' corners, reaching the picture through the card
          ':host{display:block;border-radius:30px}',
          // never taller than the screen less 16 a side: the sheet is the
          // picture and nothing else
          ':host{--hk-db-max:calc(var(--hk-vh, 100dvh) - 32px)}',
          '.cam{border-radius:inherit}',
          '.na{aspect-ratio:16/9;border-radius:inherit;background:rgba(255,255,255,0.06);display:flex;flex-direction:column;',
          '  align-items:center;justify-content:center;gap:14px;color:rgba(235,235,245,0.62);font-size:17px;font-weight:600}'
        ].join('');
      }
      hkWidthKind() { return 'camera'; }
      hkAutoHeight() { return true; }
      hkBare() { return true; }
      hkTitle(h) { return cameraName(h, this._id); }
      // AN UNAVAILABLE CAMERA IS SAID, NOT BLACK: the stream card over a camera
      // that is gone would draw an empty black sheet. The signature follows
      // only that, so the card is built the moment the camera comes back.
      _streamOf(h) {
        var pc = (this._config && this._config.src && this._config.src.popup) || {};
        return pc.stream || cameraStream(h, this._id);
      }
      _gone(h) { var st = h && h.states[this._streamOf(h)]; return !st || st.state === 'unavailable'; }
      _sigOf() { var c = this.client; return c ? 'camera|' + this._gone(c) : null; }
      // ...while the stream card inside hears every new client (its poster's
      // signed picture, its own state), not only the ones that rebuild this
      _receiveClient() {
        if (this._card && this._card.hkSetClient) this._card.hkSetClient(this.client);
        super._receiveClient();
      }
      // THE SHEET TAKES THE CAMERA'S SHAPE: the pop-ups' sizes, a picture
      // about 750 tall at most 1200 wide -- the doorbell (4:3) 1000 x 750, a
      // 16:9 camera 1200 x 675. A camera with a speaker is the doorbell, so
      // it starts at 4:3; the still, once loaded, has the last word.
      _shape(ar) {
        var sh = this.hkSheet && this.hkSheet.sheet;
        if (!sh || !(ar > 0)) return;
        sh.style.setProperty('--hkd-ar', String(ar));
        sh.style.setProperty('--hkd-w', Math.min(1200, Math.round(750 * ar)) + 'px');
      }
      _render() {
        var h = this.client;
        if (!h) return;
        // _naEl, not _na: Panel._na(s) is the shared unavailable helper, and a
        // property of that name would replace it (see HkBase method shadowing)
        if (this._gone(h)) {
          // THE CAMERA WENT AWAY WHILE ITS SHEET WAS OPEN: its stream card goes
          // too (its detach stops the stream and its retries), or the dead video
          // and the message stacked, and the sheet grew by a picture. It is
          // built again when the camera comes back.
          if (this._card) {
            if (this._card.parentNode) this._card.parentNode.removeChild(this._card);
            this._card = null;
          }
          if (!this._naEl) {
            this._shape(16 / 9);
            this._naEl = document.createElement('div');
            this._naEl.className = 'na';
            this._naEl.innerHTML = glyph('hk:camera', 56) + '<div>' + esc(cameraName(h, this._id)) + ' is unavailable</div>';
            this._root.appendChild(this._naEl);
          }
          return;
        }
        if (this._naEl) { if (this._naEl.parentNode) this._naEl.parentNode.removeChild(this._naEl); this._naEl = null; }
        if (!this._card) {
          // a pop-up's own (Pop-ups: talk-back speaker, full-resolution
          // picture), else what the camera's device has
          var pc = (this._config && this._config.src && this._config.src.popup) || {};
          var stream = pc.stream || cameraStream(h, this._id);
          var sp = pc.speaker || cameraSpeaker(h, this._id);
          var cfg = { type: 'custom:hk-doorbell-card', entity: stream, volume: true,
                      aspect_ratio: 'auto', glass: false };
          // as the camera pop-ups: a camera is captioned with its name, the
          // doorbell (the camera that talks) is not
          if (sp) cfg.speaker = sp; else cfg.name = cameraName(h, this._id);
          this._shape(sp ? 4 / 3 : 16 / 9);
          var self = this, st = h.states[stream];
          var pic = st && st.attributes && !C.stale(st) && st.attributes.entity_picture;
          if (pic) {
            var probe = new Image();
            probe.onload = function () {
              if (probe.naturalWidth && probe.naturalHeight) self._shape(probe.naturalWidth / probe.naturalHeight);
            };
            // ONLY THE SHAPE IS WANTED: a small still keeps the camera's
            // aspect (HA scales to cover, both dimensions or none -- see
            // hk-cameras.js), where the bare URL would fetch the high channel's
            // full 3840x2160 frame, ~1.8 MB, on every camera sheet.
            probe.src = pic + (pic.indexOf('?') < 0 ? '?' : '&') + 'width=320&height=180';
          }
          this._card = C.create(cfg);
          if (this._card) {
            this._card.classList.add('cam');
            this._card.style.borderRadius = 'inherit';
            this._card.style.display = 'block';
            this._root.appendChild(this._card);
          }
        }
        // the stream card gets what goes with this client (the host adapter decides)
        if (this._card && this._card.hkSetClient) this._card.hkSetClient(h);
      }
    }

    // ------------------------------------------------------------ registry
    // kind (kindOf) -> element
    var PANELS = {
      light: 'hk-detail-light',
      toggle: 'hk-detail-toggle',
      fan: 'hk-detail-fan',
      cover: 'hk-detail-cover',
      cover_buttons: 'hk-detail-cover', garage: 'hk-detail-garage',
      vacuum: 'hk-detail-vacuum', valve: 'hk-detail-valve', number: 'hk-detail-number',
      select: 'hk-detail-select', humidifier: 'hk-detail-humidifier', water_heater: 'hk-detail-water-heater',
      lock: 'hk-detail-lock', button: 'hk-detail-button',
      climate: 'hk-detail-climate',
      media: 'hk-detail-media',
      sensor: 'hk-detail-sensor',
      state: 'hk-detail-state',
      binary: 'hk-detail-binary',
      alarm: 'hk-detail-alarm',
      camera: 'hk-detail-camera',
      group: 'hk-detail-group',
      cards: 'hk-detail-cards',
      // defined by hk-person.js, hk-calendar.js, hk-weather.js and hk-headers.js (each loads on its own;
      // open() says no until the element exists)
      person: 'hk-detail-person',
      event: 'hk-detail-event',
      weather: 'hk-detail-weather',
      automation: 'hk-detail-automation',
      timer: 'hk-detail-timer',
      // HK's generic sheet, for a kind with no sheet of its own on a host
      // without a detail of its own (Phase 2 P2.5)
      generic: 'hk-detail-generic'
    };
    function def(tag, Ctor) { if (!customElements.get(tag)) customElements.define(tag, Ctor); }
    // The panels fed a client alone (open(): every panel defined here except
    // the camera, group and custom-cards sheets, which hold cards of their own
    // and are still fed through the bridge).
    var CLIENT_FED = [LightPanel, TogglePanel, FanPanel, CoverPanel, LockPanel, GaragePanel, ButtonPanel,
                      ClimatePanel, MediaPanel, SensorPanel, StatePanel, BinaryPanel, VacuumPanel, ValvePanel,
                      NumberPanel, SelectPanel, HumidifierPanel, WaterHeaterPanel, AlarmPanel, GenericPanel];
    def('hk-detail-light', LightPanel);
    def('hk-detail-generic', GenericPanel);
    def('hk-detail-toggle', TogglePanel);
    def('hk-detail-fan', FanPanel);
    def('hk-detail-cover', CoverPanel);
    def('hk-detail-lock', LockPanel);
    def('hk-detail-garage', GaragePanel);
    def('hk-detail-button', ButtonPanel);
    def('hk-detail-climate', ClimatePanel);
    def('hk-detail-media', MediaPanel);
    def('hk-detail-sensor', SensorPanel);
    def('hk-detail-state', StatePanel);
    def('hk-detail-binary', BinaryPanel);
    def('hk-detail-vacuum', VacuumPanel);
    def('hk-detail-valve', ValvePanel);
    def('hk-detail-number', NumberPanel);
    def('hk-detail-select', SelectPanel);
    def('hk-detail-humidifier', HumidifierPanel);
    def('hk-detail-water-heater', WaterHeaterPanel);
    def('hk-detail-alarm', AlarmPanel);
    def('hk-detail-camera', CameraPanel);

    // ------------------------------------------------------------ a group
    // A ROOM'S "3 WINDOWS" (hk-room.js): the sheet every device gets, holding
    // those devices as the dashboard's own tiles, two to a row. A tile's name
    // opens that device's sheet in place of this one, as any sheet opened
    // from a sheet does. Tiles come from the generated dashboard's builder
    // where it has one for the kind (a fan is a fan tile), else a sensor tile
    // that reads its own state.
    var SENSOR_TILE = {
      windows: { icon: 'hk:window-closed-variant', on: 'hk:window-open-variant', label: 'open_closed' },
      doors: { icon: 'hk:door-closed', on: 'hk:door-open', label: 'open_closed' },
      garage: { icon: 'hk:garage', on: 'hk:garage-open', label: 'open_closed' },
      motion: { icon: 'hk:motion-sensor', label: 'state' },
      occupancy: { icon: 'hk:walk', label: 'state' },
      leaks: { icon: 'hk:water', on: 'hk:water-alert', label: 'state' }
    };
    function groupTile(h, id, room, kind) {
      var st = stOf(h, id), full = at(st, 'friendly_name') || id, S = window.hkStrategy;
      // the accessory's own name (its gear), as on every other page
      var name = accName(id) || (S && S.shortName ? S.shortName(full, room) : full);
      var d = domainOf(id);
      if (kind === 'temperature' || kind === 'humidity') {
        var e = (h.entities || {})[id] || {}, dev = (h.devices || {})[e.device_id] || {};
        var area = (h.areas || {})[e.area_id || dev.area_id] || {};
        room = area.name || '';
        name = accName(id) || (S && S.shortName ? S.shortName(full, room) : full);
        return { type: 'custom:hk-tile-card', entity: id, name: name, room: room, layout: room ? 'favourite' : 'standard',
          icon: kind === 'temperature' ? 'hk:home-thermometer' : 'hk:water-percent', icon_color: 'blue',
          label_mode: 'climate_' + kind, tap_action: { action: 'more-info' } };
      }
      if (d !== 'binary_sensor' && d !== 'sensor' && S && S.tileFor) {
        var t = S.tileFor(h, id, name);
        if (t) { t = Object.assign({}, t); delete t.view_layout; return t; }
      }
      var k = SENSOR_TILE[kind] || { icon: 'mdi:eye', label: 'state' };
      var closed = k.icon, opened = k.on;
      // a door, window or garage sensor's own glyph (its gear), as its pair
      if (opened && S && S.contactGlyphs) { var g = S.contactGlyphs(id, opened, closed); opened = g[0]; closed = g[1]; }
      var cfg = { type: 'custom:hk-tile-card', entity: id, name: name, icon: closed,
                  icon_color: 'blue', label_mode: k.label };
      if (opened && opened !== closed) cfg.icon_states = { on: opened };
      return cfg;
    }
    class GroupPanel extends HkBase {
      static get CSS() {
        // A sheet is the same 460 px on an iPad as on a desk, so its two
        // columns keep the full pill (--hk-pill is the iPad's, 170, on the page).
        // No cell bleed: a phone tile is its cell PLUS 8 px, for the 4 px
        // margins layout-card gives a page's cells (hk-tile.js) -- this grid
        // has none, so each pill would run 8 px into the gap and the right
        // column would be cut off at the sheet's edge on a phone.
        var T = C.TILE;
        return ':host{display:block;--hk-pill:' + T.w + 'px;--hk-cell-bleed:0px}' +
          '.summary{color:' + window.hkCards.v('ink-2') + ';font-size:16px;padding:0 0 18px;text-align:center}' +
          '.grp{display:grid;grid-template-columns:repeat(2,' + T.w + 'px);grid-auto-rows:auto;gap:' + T.gridGap + 'px;' +
          '  justify-content:center;align-content:start;padding:2px 0 8px}' +
          '@media (max-width:' + C.BP.phone + 'px){.grp{grid-template-columns:repeat(2,minmax(0,1fr))}}';
      }
      hkWidthKind() { return 'group'; }
      hkFill() { return true; }
      // null: every update goes on to the pills, which gate themselves. The
      // LIST is worked out again (resolve -- a page's members, a walk of the
      // house -- and every pill's config) only when what it reads moved:
      // its members' states, the registries (rooms, areas), the settings
      // and the modules (GEN, via _hkGen) -- not on every push.
      _sigOf() { return null; }
      _listSig(h) {
        var regs = [h.entities, h.devices, h.areas];
        if (!this._regs || regs.some(function (r, i) { return r !== this._regs[i]; }, this)) {
          this._regs = regs;
          this._regN = (this._regN || 0) + 1;
        }
        var HS = window.hkSettings, st = h.states || {}, out = this._regN + '|' + this._hkGen + '|' + (HS && HS.version) + '|';
        (this._ids || []).forEach(function (id) { out += id + '=' + (st[id] ? st[id].last_updated : 'x') + ';'; });
        return out;
      }
      _render() {
        // reads through the client; each pill gets what goes with it (the host adapter decides)
        var c = this.client, cfg = this._config || {};
        if (!c) return;
        if (this._built && this._lsig === this._listSig(c)) {
          (this._kids || []).forEach(function (el) { feedPill(el, c); });
          return;
        }
        var resolved = cfg.resolve ? cfg.resolve(c) : null;
        var ids = resolved ? resolved.ids : cfg.entities || [];
        var configs = ids.map(function (id) {
          var room = cfg.room;
          if (cfg.row) {
            var e = (c.entities || {})[id] || {}, d = (c.devices || {})[e.device_id] || {};
            room = ((c.areas || {})[e.area_id || d.area_id] || {}).name || '';
          }
          var t = groupTile(c, id, room, cfg.groupKind);
          // The sheet already blurs its backdrop. Every nested pill must
          // stay out of the shared glass renderer too: its clipped layer in
          // the scrolling body adds a second blur inside an animated blur
          // surface, producing rectangular artifacts on tablet GPUs.
          t.glass = false;
          if (cfg.row) {
            t.room = room || '';
            // The room line needs its own explicit grid track. Leaving the
            // standard two-row layout creates an implicit third column and
            // squeezes the accessory name/readout almost out of view.
            t.layout = room ? 'favourite' : 'standard';
            t.size = 'regular';
            t.tap_action = { action: 'more-info' };
            delete t.icon_tap_action;
          }
          return t;
        });
        var key = JSON.stringify(configs);
        if (!this._built || key !== this._key) {
          this._built = true;
          this._key = key;
          var scroll = this.parentNode && this.parentNode.scrollTop;
          var grid = document.createElement('div');
          grid.className = 'grp';
          this._kids = configs.map(function (config) {
            var el = C.create(config);
            if (el) grid.appendChild(el);
            return el;
          }).filter(Boolean);
          this._root.innerHTML = '';
          if (cfg.row) {
            this._summary = document.createElement('div');
            this._summary.className = 'summary';
            this._root.appendChild(this._summary);
          }
          this._root.appendChild(grid);
          if (this.parentNode && scroll != null) this.parentNode.scrollTop = scroll;
        }
        if (resolved && this._summary) {
          this._summary.textContent = resolved.value;
          if (D.panel === this) D.tt.textContent = resolved.title;
        }
        this._ids = ids.slice();
        this._lsig = this._listSig(c);
        (this._kids || []).forEach(function (el) { feedPill(el, c); });
      }
    }
    // A PILL (hkCards.create) gets what goes with the client once it is
    // configured; anything else straight through the host adapter.
    function feedPill(el, client) {
      if (el.hkSetClient) el.hkSetClient(client); else window.hkHostClient.bridge(el, client);
    }
    def('hk-detail-group', GroupPanel);
    // A CUSTOM POP-UP'S CARDS (Pop-ups -> Custom): any cards, in
    // a column, built by Home Assistant's own card helpers (a core card or a
    // custom one), fed what goes with the sheet's client (through the host
    // adapter) while the sheet is up. A card that cannot be built is HA's error
    // card, in its place.
    class CardsPanel extends HkBase {
      static get CSS() {
        return ':host{display:block}' +
          '.cards{display:flex;flex-direction:column;gap:12px;padding:2px 0 8px}' +
          '.none{color:' + window.hkCards.v('ink-2') + ';font-size:15px;text-align:center;padding:40px 12px}';
      }
      hkWidthKind() { return (this._config || {}).width === 'wide' ? 'cards_wide' : 'cards'; }
      hkFill() { return true; }
      _sigOf() { return null; }
      _render() {
        var c = this.client, cfg = this._config || {}, self = this;
        if (!c) return;
        if (!this._built) {
          this._built = true;
          this._kids = [];
          var box = document.createElement('div');
          box.className = 'cards';
          this._root.innerHTML = '';
          this._root.appendChild(box);
          var list = Array.isArray(cfg.cards) ? cfg.cards : [];
          if (!list.length) {
            box.innerHTML = '<div class="none">No cards yet.</div>';
          } else if (typeof window.loadCardHelpers === 'function') {
            window.loadCardHelpers().then(function (helpers) {
              list.forEach(function (cc) {
                var el;
                try { el = helpers.createCardElement(cc); } catch (e) {
                  el = helpers.createCardElement({ type: 'error', error: String(e && e.message || e), origConfig: cc });
                }
                window.hkHostClient.bridge(el, self.client);
                box.appendChild(el);
                self._kids.push(el);
              });
            }, function (e) { console.error('[hk-detail] custom pop-up: no card helpers', e); });
          }
        }
        (this._kids || []).forEach(function (el) { window.hkHostClient.bridge(el, c); });
      }
    }
    def('hk-detail-cards', CardsPanel);
    // openGroup(title, ids, { icon, room, kind, color, row, resolve })
    //   row: a page's status row the list was opened from (hk-room.js; the
    //   Climate page's was `climate`, still taken): each pill says its own
    //   room, a summary heads the list, `resolve` keeps both live, and an
    //   accessory opened from it comes back to it
    function openGroup(title, ids, o, extra) {
      o = o || {};
      if (!ids || !ids.length) return false;
      return open(null, { name: title, icon: o.icon, icon_color: o.color || 'rgba(255,255,255,0.92)' },
                  Object.assign({ group: { title: title, ids: ids.slice(), room: o.room || '', kind: o.kind || '',
                    icon: o.icon, color: o.color, row: o.row || o.climate, resolve: o.resolve } }, extra || {}));
    }
    function restoreGroup(g) {
      var current = g.resolve && g.resolve(C.client());
      // An empty category still needs a way back out after its last member
      // was removed while a device's controls were open.
      return open(null, { name: current ? current.title : g.title, icon: g.icon,
                          icon_color: g.color || 'rgba(255,255,255,0.92)' },
        { group: Object.assign({}, g, { ids: current ? current.ids : g.ids }) });
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
    [window.hkShell.navEvent, 'hashchange', 'popstate'].forEach(function (ev) {
      window.addEventListener(ev, route);
    });
    // the pop-ups can arrive after the page (a fresh load with #doorbell)
    (function wait() {
      if (window.hkSettings && window.hkSettings.onChange) { window.hkSettings.onChange(route); route(); }
      else setTimeout(wait, 200);
    })();
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
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !held) return;
      var h2 = held; held = null;
      if (Date.now() < h2.until) asked(h2.ev);
    });
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
        STD: STD, WIDE: WIDE, SHEET_H: SHEET_H, PHONE_H: PHONE_H, SP: SP,
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
  });
})();
