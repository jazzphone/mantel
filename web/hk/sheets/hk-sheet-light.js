// hk-sheet-light.js - The light sheet: brightness, colour and temperature, favourites.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-light'] = function (K) {
    var at = K.at, BACK = K.BACK, C = K.C, CHEV = K.CHEV, clamp = K.clamp, css = K.css, esc = K.esc,
        favCss = K.favCss, favMatches = K.favMatches, favourites = K.favourites, glyph = K.glyph,
        hsCss = K.hsCss, kelvinRgb = K.kelvinRgb, lightCaps = K.lightCaps, lightFill = K.lightFill,
        num = K.num, Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, SEARCH = K.SEARCH, SLIDER_H = K.SLIDER_H,
        throttle = K.throttle, TICK = K.TICK;

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
          // (seven circles across the sheet: 38, or smaller on a small phone's
          // 375 before the last is cut off -- the sheet's 32 margin and 36
          // padding, the row's 8 and its six 8 px gaps -- and the row centred)
          '  .sw{gap:8px;justify-content:center}',
          '  .grp{min-width:0}',
          '  .sw button{width:min(38px, calc((var(--hk-vw, 100vw) - 124px) / 7));height:auto;aspect-ratio:1;border-radius:50%}',
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

    // what the shell and the later sheet files use of this one
    K.LightPanel = LightPanel;
  };
})();
