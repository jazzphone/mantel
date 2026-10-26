// hk-sheet-sensor.js - The sensor sheet (its history chart, the energy device sheet) and the binary-sensor, state and text-sensor sheets.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-sensor'] = function (K) {
    var at = K.at, axesChart = K.axesChart, C = K.C, CHEV = K.CHEV, colourName = K.colourName,
        downsample = K.downsample, dur = K.dur, esc = K.esc, gone = K.gone, lookFor = K.lookFor, num = K.num,
        Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, scrub = K.scrub, segPick = K.segPick,
        SHORT_MQ = K.SHORT_MQ, SP = K.SP, spanTo = K.spanTo, stOf = K.stOf, timeRow = K.timeRow,
        unavailable = K.unavailable;

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
          '@media (max-width:' + C.BP.phone + 'px),' + SHORT_MQ + '{.val .n{font-size:60px}.val .u{font-size:22px}',
          '  .pn{gap:16px}.stats .v{font-size:17px}.stats .k{font-size:12px}.stats{gap:8px;padding:14px 12px}}'
          ,
          // A SHORT SCREEN (PANEL_CSS SHORT): two columns, the body's height --
          // the reading over its stats on the left, its range over the chart
          // on the right, the chart's foot on the stats' (the plot's height,
          // _render: what the body leaves)
          '@media ' + SHORT_MQ + '{',
          '  :host .pn{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-rows:auto minmax(0,1fr);',
          '    column-gap:24px;row-gap:12px;height:var(--hk-short-h);box-sizing:border-box;padding:0;align-items:stretch}',
          '  :host .pn > .top{display:contents}',
          '  :host .pn .rd{grid-column:1;grid-row:1;align-self:start}',
          '  :host .pn .rc,:host([wide]) .pn .top .rc{grid-column:2;grid-row:1;width:auto}',
          '  :host .pn > .chart{grid-column:2;grid-row:2;align-self:end}',
          '  :host .pn > .stats{grid-column:1;grid-row:2;align-self:end}',
          '  :host .pn > .en{grid-column:1 / -1}',
          '}'
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
        // a short screen: the plot as tall as the body leaves under the range
        // row -- the body less the range (90), the chart card's padding and
        // its time row (54) and the gap (12)
        var short = matchMedia(SHORT_MQ).matches, pnEl = short && this._root.querySelector('.pn');
        var room = pnEl ? pnEl.clientHeight : 0;
        // an energy device's sheet keeps room under the chart for its rows
        var cal = this._cal(), wk = r === 'week';
        var H = short && room ? Math.max(96, room - 156) : phone ? 180 : (this._rec ? 200 : 250), NT = phone ? 3 : short ? 4 : 5, MS = cal ? cal.P0.len * 864e5 : RANGE_H[r] * 3600000;
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

    // what the shell and the later sheet files use of this one
    K.BinaryPanel = BinaryPanel; K.DAY = DAY; K.dayRows = dayRows; K.energyPlan = energyPlan;
    K.energyRec = energyRec; K.money = money; K.SENSE_CSS = SENSE_CSS; K.SensePanel = SensePanel;
    K.SensorPanel = SensorPanel; K.sinceText = sinceText; K.spansOf = spansOf; K.StatePanel = StatePanel;
  };
})();
