// hk-sheet-climate.js - The thermostat sheet.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-climate'] = function (K) {
    var at = K.at, axesChart = K.axesChart, bridge = K.bridge, C = K.C, downsample = K.downsample,
        num = K.num, Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, scrub = K.scrub, SHORT_MQ = K.SHORT_MQ,
        SP = K.SP, spanTo = K.spanTo, stOf = K.stOf;

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
          // the side column's modes and fan (a short screen's, _sideRows): the thermostat card's own segmented look
          '.sctl{display:none}',
          C.segCss('.sctl .seg', { on: '[aria-pressed="true"]', fill: true }),
          '.sctl .seg button{flex:1 1 0}',
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
      // THE MODES AND THE FAN IN THE SIDE COLUMN (a short screen: the ring
      // alone fills the dial's column, --hk-tstat-rows none): the thermostat
      // card's own two rows, as segmented controls, the current one pressed
      _sideRows(s, a) {
        var box = this._root.querySelector('.sctl'), self = this;
        if (!box) return;
        var NAME = { heat_cool: 'Auto', auto: 'Auto', heat: 'Heat', cool: 'Cool', off: 'Off', dry: 'Dry', fan_only: 'Fan', on: 'On', low: 'Low', medium: 'Medium', high: 'High' };
        var word = function (m) { return NAME[m] || String(m).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); };
        var row = function (label, list, cur, kind) {
          if (!Array.isArray(list) || list.length < 2) return '';
          return '<div class="seg" role="group" aria-label="' + label + '">' + list.slice(0, 5).map(function (m) {
            return '<button type="button" data-' + kind + '="' + C.esc(m) + '" aria-pressed="' + (m === cur) + '">' + C.esc(word(m)) + '</button>';
          }).join('') + '</div>';
        };
        var html = row('Mode', a.hvac_modes, s.state, 'mode') + row('Fan', a.fan_modes, a.fan_mode, 'fan');
        if (html === this._sideHtml) return;
        this._sideHtml = html; box.innerHTML = html;
        if (!this._sideTaps) {
          this._sideTaps = true;
          box.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button');
            if (!b) return;
            if (b.getAttribute('data-mode')) self._svc('climate', 'set_hvac_mode', { hvac_mode: b.getAttribute('data-mode') });
            else if (b.getAttribute('data-fan')) self._svc('climate', 'set_fan_mode', { fan_mode: b.getAttribute('data-fan') });
          });
        }
      }
      // A SHORT SCREEN: the dial as wide as makes it exactly the body's
      // height. What it holds besides the ring (its face's margins, the mode
      // row, the fan's) is measured, not guessed, and the ring -- 0.87 as
      // tall as it is wide -- gets the rest; again when the window changes.
      _fitShort() {
        var dial = this._root.querySelector('.dial'), card = this._card, self = this;
        if (!this._shortMq) {
          this._shortMq = window.matchMedia(SHORT_MQ);
          var again = function () { self._fitShort(); self._alignTop(); };
          this._listenShort(again);
          window.addEventListener('resize', again);
          this._undo(function () { window.removeEventListener('resize', again); });
          // ...and whenever the panel or its thermostat settle (the sheet lays out after the first render)
          if (typeof ResizeObserver !== 'undefined') {
            // (a frame later: resizing the dial inside the observer's own callback loops it)
            this._shortRO = new ResizeObserver(function () { requestAnimationFrame(function () { if (self._shortMq.matches) self._fitShort(); }); });
            var pn0 = this._root.querySelector('.pn');
            if (pn0) this._shortRO.observe(pn0);
            if (card) this._shortRO.observe(card);
          }
        }
        if (!dial) return;
        if (!this._shortMq.matches) { dial.style.width = ''; return; }
        var wrap = card && card.shadowRoot && card.shadowRoot.querySelector('.tstat-wrap');
        // (the panel's own height: --hk-short-h, measured -- a custom property reads back as its calc())
        var pn = this._root.querySelector('.pn'), room = pn ? pn.clientHeight : 0;
        if (!wrap || !room || !card.offsetHeight || !wrap.offsetWidth) return;
        var rest = card.offsetHeight - wrap.offsetHeight, k = wrap.offsetHeight / wrap.offsetWidth;
        var w = Math.max(160, Math.min(320, Math.floor((room - rest) / k)));
        if (Math.abs(w - dial.offsetWidth) > 1) dial.style.width = w + 'px';
      }
      _alignTop() {
        var side = this._root.querySelector('.side'), card = this._card;
        if (!side || !side.style) return;
        var ring = card && card.shadowRoot && card.shadowRoot.querySelector('svg.ring');
        // (a short screen centres the readings on the dial instead: PANEL_CSS SHORT)
        if (this._shortMq && this._shortMq.matches) { side.style.marginTop = ''; return; }
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
          // (.sctl: the modes and the fan, beside the ring on a short screen -- PANEL_CSS SHORT; hidden otherwise)
          this._root.innerHTML = '<div class="pn"><div class="dial"></div><div class="side"><div class="sctl"></div><div class="now"><div class="rd"></div>' +
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
        this._fitShort();
        this._alignTop();
        var a = s.attributes || {};
        this._sideRows(s, a);
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

    // what the shell and the later sheet files use of this one
    K.ClimatePanel = ClimatePanel; K.dur = dur; K.reportsAction = reportsAction; K.runTimes = runTimes;
    K.trendOf = trendOf; K.TSTAT_WIDE = TSTAT_WIDE;
  };
})();
