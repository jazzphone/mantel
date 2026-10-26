// hk-sheet-controls.js - The toggle, fan and cover sheets.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-controls'] = function (K) {
    var at = K.at, C = K.C, clamp = K.clamp, fanGuard = K.fanGuard, fanLabel = K.fanLabel,
        fanSteps = K.fanSteps, glyph = K.glyph, gone = K.gone, num = K.num, Panel = K.Panel,
        PANEL_CSS = K.PANEL_CSS, sinceText = K.sinceText, SLIDER_H = K.SLIDER_H, SPEED_NAMES = K.SPEED_NAMES,
        throttle = K.throttle, unavailable = K.unavailable;

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

    // what the shell and the later sheet files use of this one
    K.CoverPanel = CoverPanel; K.FanPanel = FanPanel; K.TogglePanel = TogglePanel;
  };
})();
