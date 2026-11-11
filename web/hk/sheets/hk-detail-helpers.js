// hk-detail-helpers.js - what a sheet reads off a state: kinds, fan steps, colors and the charts' axes.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-detail-helpers'] = function (K) {
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
        case 'media_player': return window.hkTv && window.hkTv.isMine(h, id) ? 'tv' : 'media';   // (a room's TV or its player: hk-sheet-tv.js)
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

    // what the shell and the later parts use of this one
    K.asClient = asClient; K.at = at; K.axesChart = axesChart; K.C = C; K.clamp = clamp; K.colourName = colourName;
    K.domainOf = domainOf; K.downsample = downsample; K.esc = esc; K.fanGuard = fanGuard; K.fanLabel = fanLabel;
    K.fanSteps = fanSteps; K.gone = gone; K.isOn = isOn; K.kindOf = kindOf; K.lightCaps = lightCaps;
    K.niceTicks = niceTicks; K.num = num; K.segPick = segPick; K.spanTo = spanTo; K.SPEED_NAMES = SPEED_NAMES;
    K.stOf = stOf; K.tickText = tickText; K.timeRow = timeRow; K.timeTicks = timeTicks; K.unavailable = unavailable;
  };
})();
