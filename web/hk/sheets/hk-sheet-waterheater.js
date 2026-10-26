// hk-sheet-waterheater.js - The water heater sheet.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-waterheater'] = function (K) {
    var at = K.at, axesChart = K.axesChart, BACK = K.BACK, C = K.C, CHEV = K.CHEV, clamp = K.clamp,
        downsample = K.downsample, esc = K.esc, glyph = K.glyph, LIST_CSS = K.LIST_CSS, num = K.num,
        Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, pickList = K.pickList, pretty = K.pretty, scrub = K.scrub,
        segPick = K.segPick, SHORT_MQ = K.SHORT_MQ, SP = K.SP, throttle = K.throttle, trendOf = K.trendOf,
        TSTAT_WIDE = K.TSTAT_WIDE, unavailable = K.unavailable;

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
          // (the modes a size down on a phone and a short screen, as the thermostat's: "Performance" whole in a third of the row)
          '@media (max-width:' + C.BP.phone + 'px),' + SHORT_MQ + '{.acts.mseg button{font-size:13px;letter-spacing:-0.1px}}',
          // WIDE: the thermostat's two columns -- see ClimatePanel
          ':host([wide]) .pn{flex-direction:row;align-items:stretch;gap:28px}',
          ':host([wide]) .dial{' + TSTAT_WIDE + '}',
          ':host([wide]) .side{display:flex;flex-direction:column;gap:12px;flex:1;min-width:0}',
          ':host([wide]) .now{padding:14px 18px}',
          ':host([wide]) .trend{flex:1;display:flex;flex-direction:column;padding:' + SP.cardPad + ';min-height:0}',
          ':host([wide]) .trend .axc{flex:1;min-height:72px;margin-top:8px}',
          ':host([wide]) .trend .tt2{margin-bottom:0}',
          // A SHORT SCREEN: the thermostat's -- the ring the control on the
          // left (PANEL_CSS SHORT), as tall as the body, 0.86 as tall as wide,
          // and the tank's readings, the modes and the power beside it; the
          // trend gives way, as the thermostat's does
          '@media ' + SHORT_MQ + '{',
          '  :host .pn > .dial.dial{display:contents}',
          '  :host .pn .dl{grid-column:1;grid-row:1 / 8;width:min(260px, calc(var(--hk-short-h) / 0.86));max-width:none;align-self:center}',
          '  :host .pn .dial > :is(.acts,.pwr){grid-column:2;margin:6px 0;justify-self:stretch}',
          '  :host .pn .now{order:-1;justify-self:stretch}:host .pn .away{justify-self:stretch}',
          '  :host .pn .trend{display:none}',
          '}'
        ].join('');
      }
      hkWidthKind() { return 'water_heater'; }
      // (a short screen keeps its own two columns, PANEL_CSS SHORT, never the tablet's)
      _wideAt() { return window.matchMedia && matchMedia(SHORT_MQ).matches ? Infinity : 700; }
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

    // what the shell and the later sheet files use of this one
    K.arcPath = arcPath; K.WaterHeaterPanel = WaterHeaterPanel;
  };
})();
