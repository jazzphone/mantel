// hk-sheet-appliances.js - The valve, number, select and humidifier sheets.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-appliances'] = function (K) {
    var at = K.at, BACK = K.BACK, C = K.C, CHEV = K.CHEV, clamp = K.clamp, domainOf = K.domainOf,
        esc = K.esc, glyph = K.glyph, gone = K.gone, LIST_CSS = K.LIST_CSS, num = K.num, Panel = K.Panel,
        PANEL_CSS = K.PANEL_CSS, pickList = K.pickList, pretty = K.pretty, RingPanel = K.RingPanel,
        segPick = K.segPick, SHORT_MQ = K.SHORT_MQ, throttle = K.throttle;

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
          '  .seg button{font-size:13px;line-height:15px;white-space:normal;text-overflow:clip}}',
          // A SHORT SCREEN: the slider and its marker the control on the left
          // (PANEL_CSS SHORT), the readings and the modes beside them
          '@media ' + SHORT_MQ + '{:host .pn > .sl{grid-template-columns:var(--hk-short-w) 64px;column-gap:10px;justify-self:start}:host .pn > .sl > :first-child{display:none}' +
          '  :host .pn > .sl .mk{height:var(--hk-short-h)}:host .pn > .rds .v{font-size:34px}:host .pn > :is(.rds,.acts){justify-self:stretch}}'
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

    // what the shell and the later sheet files use of this one
    K.HumidifierPanel = HumidifierPanel; K.NumberPanel = NumberPanel; K.SelectPanel = SelectPanel;
    K.ValvePanel = ValvePanel;
  };
})();
