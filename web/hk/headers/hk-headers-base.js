// hk-headers-base.js - the header base, its CSS and the bars.
//
// PART OF THE PAGE HEADERS (hk-headers.js). Not a card and not run on its own: it registers one
// function, which hk-headers.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHeadersParts = window.hkHeadersParts || {})['hk-headers-base'] = function (K) {
    var C = K.C;

    var HkBase = C.HkBase, register = C.register, v = C.v, esc = C.esc, R = C.R, P = C.PALETTE.icon;
    var MIN = 60e3, HOUR = 36e5, DAY = 864e5;
    var COOL = '#5ac8fa', HEAT = '#ff9f0a';         // the Energy page's heating & cooling, and heat
    // EACH THERMOSTAT'S INDOOR LINE (Climate's Through the Day): apart from the
    // bars' blue and orange and the outside line's white
    var INSIDE = ['#bf5af2', '#30d158', '#ffd60a'];

    // ------------------------------------------------------------- helpers
    function hs(path, fb) { return C.setting(path, fb); }
    function header(page) { return Object.assign({}, (hs('headers', {}) || {})[page] || {}); }
    function num(x) { if (x === null || x === undefined || x === '') return null; var n = Number(x); return isFinite(n) ? n : null; }
    function midnight(t) { var d = new Date(t || Date.now()); d.setHours(0, 0, 0, 0); return d.getTime(); }
    function hm(t) { return new Date(t).toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit' })); }
    function hr(t) { return new Date(t).toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric' })); }
    // "1 h 12 m" / "45 min"; html: the units small, as Energy's figures
    function dur(ms) {
      var m = Math.max(0, Math.round(ms / MIN));
      if (m < 60) return m + ' min';
      return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' m' : '');
    }
    function durHtml(ms) {
      var m = Math.max(0, Math.round(ms / MIN));
      if (m < 60) return m + '<u>min</u>';
      return Math.floor(m / 60) + '<u>h</u>' + (m % 60 ? ' ' + (m % 60) + '<u>m</u>' : '');
    }
    function shortDur(ms) {
      var m = Math.max(0, Math.round(ms / MIN));
      return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
    }
    // (Mantel's own name first: hkCards.accName, 2026-10-31)
    function ownName(id) { var C0 = window.hkCards; return (C0 && C0.accName && C0.accName(id)) || null; }
    function nameOf(h, id) { var s = h && h.states[id]; return ownName(id) || (s && s.attributes.friendly_name) || id; }
    function areaOf(h, id) {
      var e = h.entities && h.entities[id];
      if (!e) return null;
      return e.area_id || (e.device_id && h.devices && h.devices[e.device_id] && h.devices[e.device_id].area_id) || null;
    }
    function areaName(h, a) { return (h.areas && h.areas[a] && h.areas[a].name) || a; }
    // compressed history (s, a, lu) -> [[t, state, attrs]]
    function steps(list) {
      var out = [], a = {};
      (list || []).forEach(function (x) { if (x.a) a = x.a; out.push([(x.lu || x.lc) * 1000, x.s, a]); });
      return out;
    }
    function spans(series, from, to, test) {
      var out = [], start = null;
      series.forEach(function (p) {
        var on = test(p);
        if (on && start === null) start = Math.max(from, p[0]);
        if (!on && start !== null) { out.push([start, p[0]]); start = null; }
      });
      if (start !== null) out.push([start, to]);
      return out.filter(function (s) { return s[1] > s[0]; });
    }
    function merge(list) {
      var sp = list.slice().sort(function (a, b) { return a[0] - b[0]; }), m = [];
      sp.forEach(function (s) { if (m.length && s[0] <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], s[1]); else m.push(s.slice()); });
      return m;
    }
    function total(sp) { return sp.reduce(function (a, s) { return a + s[1] - s[0]; }, 0); }
    function inSpan(sp, t) { return sp.some(function (s) { return t >= s[0] && t < s[1]; }); }

    // ========================================================== THE CARDS
    // The page card (Energy's), 240 px tall in the header (the strategy's
    // `height`), and what every header card does alike: a tap on anything
    // marked data-more opens that thing's sheet; data asked for once and again
    // every so often while on the page; drawn again when it comes.
    var BASE_CSS = [
      C.pageCardCss('hd'),
      // the micro role: axis labels, a readout, a small note
      '.mi{font-size:11px;font-weight:600;color:' + v('ink-3') + '}',
      '[data-more]{cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '[data-more]:active{opacity:0.7}',
      'svg{display:block}',
      '.well{width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:50%;color:var(--a);',
      '  background:color-mix(in srgb,var(--a) 16%,transparent)}',
      '.well hk-icon{--mdc-icon-size:19px;width:19px;height:19px;display:flex}',
      '.pill{appearance:none;font:inherit;font-size:13px;font-weight:600;color:' + v('ink') + ';background:' + v('key') + ';',
      '  border:1px solid ' + v('line') + ';height:34px;padding:0 14px;border-radius:' + R.capsule('34px') + ';cursor:pointer;flex:none;',
      '  -webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
      '.pill:active{transform:scale(0.97);background:' + v('key-strong') + '}',
      // a phone: the card as tall as what it holds
      '@media (max-width:' + C.BP.phone + 'px){hk-plate.hd{height:auto;min-height:var(--hk-hd-min,200px)}}',
      // THE HEADER BUILDS IN (2026-10-16, the user: "a nice touch"): the first
      // time a card has something to show, its parts rise into place one after
      // another and its graphs draw in from the left -- the Energy page's build
      // curve, transform, opacity and clip only. Never on a live update; reduced
      // motion, never.
      '@keyframes hkHdIn{from{opacity:0;transform:translateY(8px)}}',
      '@keyframes hkHdWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}',
      '@keyframes hkHdGrow{from{transform:scaleX(0.001)}}',
      '.anim > *{animation:hkHdIn ' + C.DUR.build + ' ' + C.EASE.build + ' backwards}',
      '.anim > :nth-child(2){animation-delay:60ms}.anim > :nth-child(3){animation-delay:120ms}',
      '.anim > :nth-child(4){animation-delay:180ms}.anim > :nth-child(n+5){animation-delay:240ms}',
      '.anim .bc svg,.anim .ln{animation:hkHdWipe .9s ' + C.EASE.build + ' 150ms backwards}',
      '.anim .dr .tr i{animation:hkHdGrow .8s ' + C.EASE.build + ' 200ms backwards;transform-origin:0 50%}',
      '@media (prefers-reduced-motion: reduce){.anim > *,.anim .bc svg,.anim .ln,.anim .dr .tr i{animation:none}}'
    ].join('');
    class HeaderCard extends HkBase {
      // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
      static get FLAT_MOTION() { return true; }
      static get CSS() { return BASE_CSS + (this.PART_CSS || ''); }
      getCardSize() { return 5; }
      _ids() { return []; }
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        // the minute too: "on 12 min", "next in 2 h" move with the clock
        return (this._ver || 0) + '|' + Math.floor(Date.now() / MIN) + '|' + this._ids().map(function (id) {
          var s = h.states[id];
          return s ? s.last_updated : '-';
        }).join(',');
      }
      _shell(cls) {
        if (this._built) return;
        this._root.innerHTML = '<hk-plate class="hd ' + cls + '" data-hk-role="card"></hk-plate>';
        this._card = this._root.querySelector('hk-plate');
        var hgt = this._config && this._config.height;
        if (this._card.style && this._card.style.setProperty) this._card.style.setProperty('--hk-ep-h', hgt ? String(hgt) : '240px');
        var self = this;
        this._card.addEventListener('click', function (e) {
          var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
          var id = t && t.getAttribute('data-more');
          if (!id) return;
          e.stopPropagation();
          window.hkShell.moreInfo(id, self);
        });
        this._built = true;
      }
      _paint(html) {
        if (this._last === html) return;
        this._last = html;
        C.morph(this._card, html);
        // the first paint with something in it builds in (BASE_CSS .anim)
        if (!this._built1 && html && !/class="(wait|none)"/.test(html)) {
          this._built1 = true;
          var card = this._card;
          card.classList.add('anim');
          setTimeout(function () { card.classList.remove('anim'); }, 1600);
        }
      }
      redraw() { this._ver = (this._ver || 0) + 1; this._hkSig = null; if (this.client) super.redraw(); }
      _load(key, every, fn) {
        var self = this, now = Date.now();
        this._at = this._at || {};
        if (this._at[key] && now - this._at[key] < every) return;
        this._at[key] = now;
        Promise.resolve().then(fn).then(function (r) { self['_' + key] = r; self.redraw(); })
          .catch(function (e) { self._at[key] = now - every + 30e3; console.warn('[hk-headers] ' + key, e); });
      }
      // the card's inner width, kept (the bars are sized to it)
      _width() {
        var self = this;
        if (!this._ro && typeof ResizeObserver === 'function' && this._card) {
          this._ro = new ResizeObserver(function (en) {
            var w = Math.round(en[0].contentRect.width);
            if (w && w !== self._w) { self._w = w; self.redraw(); }
          });
          this._ro.observe(this._card);
        }
        return this._w || (this._card && this._card.clientWidth) || 0;
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
      }
    }

    // ========================================== CLIMATE: THE DAY'S RUNTIME
    // Each thermostat's heating and cooling today, from its own hvac_action
    // history: a figure each, and the hours as bars (Energy's chart rules: bars
    // at most 20 px, 0.42 of a bar apart, the chart as wide as its bars, labels
    // under their own bars). Hover or touch an hour for its minutes. A house
    // whose thermostats say nothing of heating or cooling gets their
    // temperature through the day instead.
    var BARS_CSS = [
      '.bc{display:flex;flex-direction:column;align-items:stretch;touch-action:pan-y;-webkit-user-select:none;user-select:none}',
      '.bc svg rect.b{transition:opacity .12s ease}',
      '.bc.on svg rect.b:not(.hit){opacity:.4}',
      // THE OUTSIDE TEMPERATURE over the bars: solid where it was measured,
      // dashed where it is forecast; its dot at the hour under the finger
      '.ol{fill:none;stroke:var(--hk-flat-chart-line,rgba(255,255,255,0.85));stroke-width:1.75;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}',
      '.ol.fc{stroke-dasharray:2 4;stroke:var(--hk-flat-chart-line,rgba(255,255,255,0.55))}',
      '.od{fill:#fff;stroke:rgba(0,0,0,0.45);stroke-width:1.5;opacity:0;transition:opacity .12s ease}',
      '.od.hit{opacity:1}',
      '.ot{font-size:11px;font-weight:600;fill:' + v('ink-2') + ';font-variant-numeric:tabular-nums}',
      '.bl{position:relative;height:12px;margin-top:6px}',
      '.bl span{position:absolute;top:0;transform:translateX(-50%);font-size:11px;font-weight:600;line-height:1;white-space:nowrap;color:' + v('ink-3') + '}',
      '.bl span.now{color:' + v('ink') + '}',
      '.bc:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:' + R.small + 'px}',
      '.rd{margin-top:10px;min-height:14px;font-size:11px;font-weight:600;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}'
    ].join('');
    // bars: [{segs: [{v, c}], fut, label, now}] -> the svg and its labels
    // fill: the bars span the whole width they are given (the Climate header:
    // the chart lines up with the figures above it and the legend's right edge,
    // the user's call 2026-10-16) -- the 0.42 gap kept, the 20 px cap not
    // (a number for `fill`: across the whole width, but no bar wider than
    // that -- seven days in a wide card would otherwise be slabs, so the days
    // spread out instead: the gaps grow and the chart still spans the card)
    function bars(list, avail, H, fill) {
      var n = list.length, bw0 = avail / (n + (n - 1) * 0.42);
      var bw = Math.max(3, fill === true ? bw0 : typeof fill === 'number' ? Math.min(fill, bw0) : Math.min(20, bw0)), gap = bw * 0.42, W = n * bw + (n - 1) * gap;
      if (typeof fill === 'number' && n > 1 && W < avail) { gap = (avail - n * bw) / (n - 1); W = avail; }
      var mx = 0;
      list.forEach(function (b) { var t = b.segs.reduce(function (a, g) { return a + g.v; }, 0); if (t > mx) mx = t; });
      mx = Math.max(mx, b0(list));
      var rx = Math.min(4, bw / 3), svg = '', labs = '';
      list.forEach(function (b, i) {
        var x0 = i * (bw + gap), tot = b.segs.reduce(function (a, g) { return a + g.v; }, 0);
        if (tot <= 0) {
          svg += '<rect class="b" data-i="' + i + '" x="' + x0.toFixed(1) + '" y="' + (H - 3) + '" width="' + bw.toFixed(1) + '" height="3" rx="1.5" fill="' +
            (b.fut ? v('line') : v('line-strong')) + '"/>';
        } else {
          var hTot = Math.max(3, H * tot / mx), y = H, cid = 'hb' + i;
          svg += '<clipPath id="' + cid + '"><rect x="' + x0.toFixed(1) + '" y="' + (H - hTot).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hTot.toFixed(1) + '" rx="' + rx.toFixed(1) +
            '"/></clipPath>';
          b.segs.forEach(function (g) {
            if (g.v <= 0) return;
            var hh = hTot * g.v / tot;
            y -= hh;
            svg += '<rect class="b" data-i="' + i + '" clip-path="url(#' + cid + ')" x="' + x0.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' +
              (hh + 0.5).toFixed(1) + '" fill="' + g.c + '"/>';
          });
        }
        if (b.label) labs += '<span class="' + (b.now ? 'now' : '') + '" style="left:' + (x0 + bw / 2).toFixed(1) + 'px">' + b.label + '</span>';
      });
      return { W: W, bw: bw, gap: gap, html: '<svg width="' + W.toFixed(1) + '" height="' + H + '" viewBox="0 0 ' + W.toFixed(1) + ' ' + H + '" style="overflow:visible">' + svg + '</svg>' +
        '<div class="bl" style="width:' + W.toFixed(1) + 'px">' + labs + '</div>' };
    }
    function b0() { return 30; }        // the bars' floor scale: half an hour of either reads as half a bar
    var HOUR_LABELS = { 0: '12a', 6: '6a', 12: '12p', 18: '6p' };
    // HOVER OR TOUCH an hour: its bar lit, the others back, the readout says it
    // HOVER, TOUCH OR KEYS: the shared scrubber (hkCards.scrub), reading the
    // card's own bar count, now, readout (.rd) and summary
    function hourScrub(card, box, say, name) {
      C.scrub(card, box, { say: say, name: name,
        count: function () { return card._nBars || 24; }, nowI: function () { return card._nowI; },
        rest: function () { return card._rdRest || ''; },
        readout: function () { return card._card && card._card.querySelector('.rd'); } });
    }

    // what the shell and the later parts use of this one
    K.areaName = areaName; K.areaOf = areaOf; K.bars = bars; K.BARS_CSS = BARS_CSS; K.COOL = COOL; K.DAY = DAY;
    K.dur = dur; K.durHtml = durHtml; K.esc = esc; K.header = header; K.HeaderCard = HeaderCard; K.HEAT = HEAT;
    K.hm = hm; K.HOUR = HOUR; K.HOUR_LABELS = HOUR_LABELS; K.hourScrub = hourScrub; K.hr = hr; K.hs = hs;
    K.INSIDE = INSIDE; K.merge = merge; K.midnight = midnight; K.MIN = MIN; K.nameOf = nameOf; K.num = num;
    K.ownName = ownName; K.P = P; K.R = R; K.register = register; K.shortDur = shortDur; K.spans = spans;
    K.steps = steps; K.total = total; K.v = v;
  };
})();
