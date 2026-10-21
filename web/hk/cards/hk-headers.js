// hk-headers.js -- THE PAGE HEADERS (2026-10-15)
//
// The cards between a category page's status row and its accessories, in the
// Energy page's material (hkCards.pageCardCss) and its three columns
// (hk-strategy.js headerGrid): Climate's heating and cooling through the day
// and the weather ahead; Lights & Outlets' rooms lit longest today and what is
// left on and coming tonight; Security's house with its ways in, today's
// activity and what needs looking after. The plan and the decisions behind it:
// hk_house/docs/PLAN-2026-10-15-page-headers.md.
//
// EVERY CARD WORKS ITSELF OUT from the house -- the page's accessories (the
// strategy hands them over), the registries, history, the logbook, the
// weather -- and the few guesses that can be wrong are HK Settings' (Your
// Home -> Status & Header -> <page>: settings.headers.<page>). A card with
// nothing to say is not drawn; none ever says "not configured".
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-headers] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkHeaders) return;                   // double-load guard
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
  function nameOf(h, id) { var s = h && h.states[id]; return (s && s.attributes.friendly_name) || id; }
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
        svg += '<clipPath id="' + cid + '"><rect x="' + x0.toFixed(1) + '" y="' + (H - hTot).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hTot.toFixed(1) + '" rx="' + rx.toFixed(1) + '"/></clipPath>';
        b.segs.forEach(function (g) {
          if (g.v <= 0) return;
          var hh = hTot * g.v / tot;
          y -= hh;
          svg += '<rect class="b" data-i="' + i + '" clip-path="url(#' + cid + ')" x="' + x0.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (hh + 0.5).toFixed(1) + '" fill="' + g.c + '"/>';
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

  class HkClimateRuntimeCard extends HeaderCard {
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._fcSub) { this._fcSub.then(function (u) { if (u) u(); }); this._fcSub = null; this._fcFor = null; }
    }
    connectedCallback() { if (super.connectedCallback) super.connectedCallback(); if (this._built) this.redraw(); }
    static get PART_CSS() {
      return BARS_CSS + [
        '.tot{display:flex;gap:40px;margin-top:10px;flex:none;min-width:0}',
        '.lg{margin-left:auto;align-self:flex-start;display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:11px;font-weight:600;color:' + v('ink-2') + ';white-space:nowrap}',
        '.lg span{display:flex;align-items:center;gap:6px}',
        '.lg i{display:inline-block;width:8px;height:8px;border-radius:50%}',
        '.lg i.ln{width:12px;height:0;border-top:2px solid var(--hk-flat-chart-line,rgba(255,255,255,0.85));border-radius:0}',
        // the indoor lines, each in its thermostat's colour, and its reading now
        // beside the thermostat's name -- the header is the quick look
        '.il{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}',
        '.tot .cap i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}',
        '.tot .cap b{font-weight:700;color:' + v('ink') + ';font-variant-numeric:tabular-nums}',
        '.tot>div{min-width:0}',
        '.tot .cap{margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.grow{flex:1;min-height:6px}',
        '@media (max-width:' + C.BP.phone + 'px){.tot{gap:24px}}'
      ].join('');
    }
    // the thermostats counted: Settings' pick, else the page's (the strategy
    // hands them over) that report heating and cooling
    _list() {
      var h = this.client, c = this._config || {}, pick = header('climate').thermostats;
      var all = (Array.isArray(pick) && pick.length ? pick : c.thermostats || []).filter(function (id) { return h.states[id] && /^climate\./.test(id); });
      return all.slice(0, 3);
    }
    _ids() { return this._list(); }
    _render() {
      this._shell('crun');
      var h = this.client, self = this;
      if (!h) return;
      var ths = this._list(), from = midnight(), now = Date.now();
      var acting = ths.filter(function (id) { return 'hvac_action' in (h.states[id].attributes || {}); });
      var list = acting.length ? acting : ths;
      if (!list.length) return this._paint('<div class="ttl"><b>Heating &amp; Cooling</b></div><div class="wait">No thermostats</div>');
      // the outside temperature: Configure -> Weather's outside sensor, else
      // the weather entity's own reading; the hours to come from its forecast
      var wid = (window.hkSettings && window.hkSettings.weatherId && window.hkSettings.weatherId(h.states)) || null;
      var outId = hs('weather.outside', null);
      if (outId && !h.states[outId]) outId = null;
      var outSrc = outId || wid;
      this._load('hist', 5 * MIN, function () {
        return h.callWS({ type: 'history/history_during_period', start_time: new Date(from).toISOString(),
          end_time: new Date().toISOString(), entity_ids: list.concat(outSrc ? [outSrc] : []), minimal_response: false, no_attributes: false,
          significant_changes_only: false });
      });
      var fcPort = window.hkCards.subscriptions(h);    // the client's subscription port
      if (wid && this._fcFor !== wid && fcPort) {
        if (this._fcSub) this._fcSub.then(function (u) { if (u) u(); });
        this._fcFor = wid;
        this._fcSub = fcPort.subscribeMessage(function (m) { self._fcH = (m && m.forecast) || []; self.redraw(); },
          { type: 'weather/subscribe_forecast', forecast_type: 'hourly', entity_id: wid }).catch(function () { return null; });
      }
      // the card's content width (contentRect: its padding already out)
      var H = this._hist, avail = Math.max(120, this._width());
      if (!H) return this._paint('<div class="ttl"><b>Heating &amp; Cooling</b></div><div class="wait">Loading today…</div>');
      var trim = function (id) { return nameOf(h, id).replace(/\s*(Ecobee\s*)?(Thermostat|Climate)$/i, '') || nameOf(h, id); };
      var nowK = Math.floor((now - from) / HOUR);
      var K = []; for (var k = 0; k < 24; k++) K.push(k);
      var inHour = function (sp, k) {
        var a = from + k * HOUR, b = a + HOUR;
        return sp.reduce(function (m, s) { return m + Math.max(0, Math.min(b, s[1]) - Math.max(a, s[0])); }, 0) / MIN;
      };
      if (!acting.length) {
        // NO HEATING OR COOLING REPORTED: the first thermostat's temperature,
        // each hour's mean, the bars from just under the day's lowest
        var s0 = steps(H[list[0]]).map(function (p) { return [p[0], num(p[2].current_temperature)]; }).filter(function (p) { return p[1] != null; });
        var mean = K.map(function (k) {
          var a = from + k * HOUR, xs = s0.filter(function (p) { return p[0] >= a && p[0] < a + HOUR; }).map(function (p) { return p[1]; });
          return xs.length ? xs.reduce(function (x, y) { return x + y; }, 0) / xs.length : null;
        });
        var got = mean.filter(function (x) { return x != null; }), floor = got.length ? Math.floor(Math.min.apply(null, got)) - 2 : 0;
        var B = bars(K.map(function (k) {
          return { segs: [{ v: mean[k] == null ? 0 : mean[k] - floor, c: COOL }], fut: k > nowK, label: HOUR_LABELS[k], now: k === nowK };
        }), avail, 56, true);
        this._nBars = 24;
        this._nowI = nowK;
        this._rdRest = 'Hover or touch an hour for its temperature';
        var cur = num(h.states[list[0]].attributes.current_temperature);
        this._paint('<div class="ttl"><b>Temperature Today</b><span>' + esc(trim(list[0])) + '</span></div>' +
          '<div class="tot"><div><div class="big num">' + (cur != null ? Math.round(cur) + '°' : '—') + '</div><div class="cap">now</div></div></div><div class="grow"></div>' +
          '<div class="bc">' + B.html + '</div><div class="rd">' + this._rdRest + '</div>');
        hourScrub(this, this._card.querySelector('.bc'), function (i) {
          var lab = (i % 12 || 12) + ' ' + (i < 12 ? 'AM' : 'PM');
          return lab + ' · ' + (i > nowK ? 'No data yet' : mean[i] == null ? 'No reading' : Math.round(mean[i]) + '° on average');
        });
        return;
      }
      var sys = list.map(function (id) {
        var s = steps(H[id]);
        return { id: id, name: trim(id),
                 cool: spans(s, from, now, function (p) { return p[2].hvac_action === 'cooling'; }),
                 heat: spans(s, from, now, function (p) { return p[2].hvac_action === 'heating'; }) };
      });
      var hours = K.map(function (k) {
        return { k: k, fut: k > nowK, sys: sys.map(function (s) { return { c: inHour(s.cool, k), h: inHour(s.heat, k) }; }) };
      });
      // ---- each thermostat's indoor temperature an hour, read as the outside
      // one is (the hour's middle; now, for this hour), and now
      sys.forEach(function (s, j) {
        var at = steps(H[s.id]).map(function (p) { return [p[0], num(p[2].current_temperature)]; })
          .filter(function (p) { return p[1] != null; });
        s.color = INSIDE[j % INSIDE.length];
        s.now = num(((h.states[s.id] || {}).attributes || {}).current_temperature);
        s.temp = K.map(function (k) {
          if (k > nowK) return null;
          if (k === nowK && s.now != null) return s.now;
          var tm = from + k * HOUR + HOUR / 2, last = null;
          for (var q = 0; q < at.length && at[q][0] <= tm; q++) last = at[q][1];
          return last;
        });
      });
      var hasIn = sys.some(function (s) { return s.temp.some(function (x) { return x != null; }); });
      // ---- the outside temperature an hour: the reading at the hour's
      // middle (now, for this hour); the forecast for the hours to come
      var outT = K.map(function () { return null; });
      if (outSrc && H[outSrc]) {
        var os = steps(H[outSrc]).map(function (p) {
          return [p[0], num(outId ? p[1] : p[2].temperature)];
        }).filter(function (p) { return p[1] != null; });
        var curOut = num(outId ? (h.states[outId] || {}).state : ((h.states[outSrc] || {}).attributes || {}).temperature);
        K.forEach(function (k) {
          if (k > nowK) return;
          var tm = k === nowK ? now : from + k * HOUR + HOUR / 2, last = null;
          for (var q = 0; q < os.length && os[q][0] <= tm; q++) last = os[q][1];
          outT[k] = k === nowK && curOut != null ? curOut : last;
        });
      }
      var fcT = K.map(function () { return null; });
      (this._fcH || []).forEach(function (f) {
        var k = Math.floor((Date.parse(f.datetime) - from) / HOUR);
        if (k > nowK && k < 24 && num(f.temperature) != null) fcT[k] = num(f.temperature);
      });
      var hasOut = outT.some(function (x) { return x != null; }) || fcT.some(function (x) { return x != null; });
      var anyHeat = sys.some(function (s) { return s.heat.length; }), anyCool = sys.some(function (s) { return s.cool.length; });
      var title = anyHeat && anyCool ? 'Heating &amp; Cooling Today' : anyHeat ? 'Heating Through the Day' : 'Cooling Through the Day';
      var B2 = bars(hours.map(function (x) {
        var c0 = x.sys.reduce(function (a, s) { return a + s.c; }, 0), h0 = x.sys.reduce(function (a, s) { return a + s.h; }, 0);
        return { segs: [{ v: h0, c: HEAT }, { v: c0, c: COOL }], fut: x.fut, label: HOUR_LABELS[x.k], now: x.k === nowK };
      }), avail, 56, true);
      this._nBars = 24;
      this._nowI = nowK;
      this._rdRest = hasOut || hasIn ? 'Hover or touch an hour for its runtime and temperatures' : 'Hover or touch an hour for runtime';
      // the lines over the bars, on their own scale (the day's coolest to
      // warmest): outside, and inside each thermostat -- one scale, so the
      // house reads against the weather
      if (hasOut || hasIn) {
        var all = outT.concat(fcT);
        sys.forEach(function (s) { all = all.concat(s.temp); });
        all = all.filter(function (x) { return x != null; });
        var tlo = Math.min.apply(null, all), thi = Math.max.apply(null, all), tsp = Math.max(4, thi - tlo);
        var BH = 56, ty = function (x) { return (BH - 6 - (x - tlo) / tsp * (BH - 16)).toFixed(1); };
        var bx = function (k) { return (k * (B2.bw + B2.gap) + B2.bw / 2).toFixed(1); };
        var seg = function (arr, cls) {
          var d = '', open = false;
          arr.forEach(function (x, k) { if (x == null) { open = false; return; } d += (open ? 'L' : 'M') + bx(k) + ' ' + ty(x); open = true; });
          return d ? '<path class="ol' + cls + '" d="' + d + '"/>' : '';
        };
        // the forecast joins the last reading, so the line has no gap at now
        var fcJoin = fcT.slice();
        if (outT[nowK] != null) fcJoin[nowK] = outT[nowK];
        var dots = K.map(function (k) {
          var x = outT[k] != null ? outT[k] : fcT[k];
          return x == null ? '' : '<circle class="od" data-i="' + k + '" cx="' + bx(k) + '" cy="' + ty(x) + '" r="3.5"/>';
        }).join('');
        var cur = outT[nowK];
        var tag = cur != null ? '<text class="ot" x="' + bx(nowK) + '" y="' + (Number(ty(cur)) - 7).toFixed(1) + '" text-anchor="middle">' + Math.round(cur) + '°</text>' : '';
        var inside = sys.map(function (s) {
          var d = '', open = false;
          s.temp.forEach(function (x, k) { if (x == null) { open = false; return; } d += (open ? 'L' : 'M') + bx(k) + ' ' + ty(x); open = true; });
          return d ? '<path class="il" stroke="' + s.color + '" d="' + d + '"/>' : '';
        }).join('');
        var inDots = sys.map(function (s) {
          return s.temp.map(function (x, k) {
            return x == null ? '' : '<circle class="od" data-i="' + k + '" cx="' + bx(k) + '" cy="' + ty(x) + '" r="3.5" style="fill:' + s.color + '"/>';
          }).join('');
        }).join('');
        B2.html = B2.html.replace('</svg>', inside + seg(fcJoin, ' fc') + seg(outT, '') + inDots + dots + tag + '</svg>');
      }
      var tot = sys.map(function (s) {
        var t = total(s.cool) + total(s.heat);
        return '<div data-more="' + esc(s.id) + '"><div class="big num">' + (t < MIN ? 'Idle' : durHtml(t)) + '</div><div class="cap">' +
          (hasIn ? '<i style="background:' + s.color + '"></i>' : '') + esc(s.name) + (s.now != null ? ' · <b>' + Math.round(s.now) + '°</b>' : '') + '</div></div>';
      }).join('');
      var lg = '<div class="lg"><span><i style="background:' + (anyHeat && !anyCool ? HEAT : COOL) + '"></i>' + (anyHeat && anyCool ? 'Heating · Cooling' : anyHeat ? 'Heating' : 'Cooling') + '</span>' +
        (hasOut ? '<span><i class="ln"></i>Outside</span>' : '') + '</div>';
      this._paint('<div class="ttl"><b>' + title + '</b></div><div class="tot">' + tot + lg + '</div><div class="grow"></div>' +
        '<div class="bc">' + B2.html + '</div><div class="rd">' + this._rdRest + '</div>');
      hourScrub(this, this._card.querySelector('.bc'), function (i) {
        var x = hours[i], lab = (i % 12 || 12) + ' ' + (i < 12 ? 'AM' : 'PM');
        var o = outT[i] != null ? 'Outside ' + Math.round(outT[i]) + '°' : fcT[i] != null ? 'Outside ' + Math.round(fcT[i]) + '° forecast' : '';
        if (x.fut) return lab + ' · ' + (o || 'No data yet');
        return lab + ' · ' + (o ? o + ' · ' : '') + sys.map(function (s, j) {
          var p = [], m = x.sys[j], t = s.temp[i];
          if (m.c >= 0.5) p.push(Math.round(m.c) + ' min cooling');
          if (m.h >= 0.5) p.push(Math.round(m.h) + ' min heating');
          return s.name + (t != null ? ' ' + Math.round(t) + '°' : '') + ' ' + (p.join(', ') || 'idle');
        }).join(' · ');
      });
    }
  }

  // ============================================= CLIMATE: OUTSIDE & AHEAD
  // The weather now (Settings' outside sensor first, as the Weather page),
  // today's high and low, the next three forecast hours two apart, and what
  // the evening does -- with sunset or sunrise.
  var WWORD = { 'clear-night': 'Clear', cloudy: 'Cloudy', exceptional: 'Unusual weather', fog: 'Foggy', hail: 'Hail', lightning: 'Thunderstorms',
    'lightning-rainy': 'Thunderstorms', partlycloudy: 'Partly cloudy', pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow',
    'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy' };
  class HkClimateOutsideCard extends HeaderCard {
    static get PART_CSS() {
      return [
        // the whole card opens the weather's sheet (hk-weather.js)
        '.all{flex:1;display:flex;flex-direction:column;min-height:0}',
        '.now{display:flex;align-items:center;gap:14px;margin:12px 0 10px}',
        '.now svg{flex:none}',
        '.now .t{' + C.figureCss('figure-l') + ';font-variant-numeric:tabular-nums}',
        '.now .w{font-size:13px;line-height:18px;min-width:0}',
        '.now .w span{display:block;color:' + v('ink-2') + '}',
        // THE HOURS AHEAD: as many as the card's width holds (six at a wall
        // tablet's third, twelve across an iPad's row), two hours apart where
        // the forecast reaches that far
        '.hrs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);padding:10px 0 0;border-top:1px solid ' + v('line') + '}',
        '.hrs>div{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0}',
        '.hrs b{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}',
        '.note{margin-top:auto;font-size:13px;line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '@media (max-width:' + C.BP.phone + 'px){.now{margin:10px 0}.note{margin-top:8px}}'
      ].join('');
    }
    _wx() {
      var h = this.client, c = this._config || {};
      return c.weather || (window.hkSettings && window.hkSettings.weatherId && window.hkSettings.weatherId(h.states)) ||
        Object.keys(h.states).filter(function (id) { return id.indexOf('weather.') === 0; })[0];
    }
    _ids() { return [this._wx(), hs('weather.outside', null), 'sun.sun']; }
    _render() {
      this._shell('cout');
      var h = this.client, self = this;
      if (!h) return;
      var wid = this._wx(), w = wid && h.states[wid];
      if (!w) return this._paint('<div class="ttl"><b>Outside &amp; Ahead</b></div><div class="wait">No weather</div>');
      var port = window.hkCards.subscriptions(h);      // the client's subscription port
      if (this._subWx !== wid && port) {
        this._unsub();
        this._subWx = wid;
        this._subs = ['hourly', 'daily'].map(function (t) {
          return port.subscribeMessage(function (m) { self['_' + t] = m.forecast || []; self.redraw(); },
            { type: 'weather/subscribe_forecast', forecast_type: t, entity_id: wid }).catch(function () { return null; });
        });
      }
      var now = Date.now(), out = hs('weather.outside', null), os = out && h.states[out];
      var t0 = os && num(os.state) != null ? num(os.state) : num(w.attributes.temperature);
      var day = (this._daily || [])[0], hi = day && num(day.temperature), lo = day && num(day.templow);
      var hrs = (this._hourly || []).filter(function (f) { return Date.parse(f.datetime) > now; });
      var slots = Math.max(3, Math.min(12, Math.floor(Math.max(0, this._width() - 44) / 54)));
      // two hours apart where the forecast reaches far enough, else every hour
      var step = Math.max(1, Math.min(2, Math.floor((hrs.length - 1) / Math.max(1, slots - 1)))), pick = [];
      for (var k = 0; pick.length < slots && k * step < hrs.length; k++) pick.push(hrs[k * step]);
      var HH = window.hkHeader || {}, wx = function (cond, px, night) {
        return HH.wxSvg ? HH.wxSvg(cond, px, { night: night }) : '<span style="display:inline-block;width:' + px + 'px;height:' + px + 'px"></span>';
      };
      var sun = h.states['sun.sun'], set = sun && Date.parse(sun.attributes.next_setting), rise = sun && Date.parse(sun.attributes.next_rising);
      var later = hrs[5] && num(hrs[5].temperature), h0 = new Date().getHours();
      var when = h0 >= 20 || h0 < 5 ? 'overnight' : h0 < 12 ? 'later today' : 'this evening';
      var trend = t0 == null || later == null ? '' : later <= t0 - 4 ? 'Cooling off ' + when : later >= t0 + 4 ? 'Warming up ' + when : 'Steady for the next few hours';
      var sunTxt = set && rise ? (set < rise ? 'sunset ' + hm(set) : 'sunrise ' + hm(rise)) : '';
      var unit = '°';
      var nightNow = !!(HH.isNight && HH.isNight(h.states));
      this._paint('<div class="all" data-more="' + esc(wid) + '"><div class="ttl"><b>Outside &amp; Ahead</b></div>' +
        '<div class="now">' + wx(w.state, 34, nightNow) +
        '<div class="t">' + (t0 != null ? Math.round(t0) + unit : '—') + '</div><div class="w">' + esc(WWORD[w.state] || w.state) +
        (hi != null ? '<span>High ' + Math.round(hi) + '° · Low ' + (lo != null ? Math.round(lo) + '°' : '—') + '</span>' : '') + '</div></div>' +
        '<div class="hrs">' + (pick.length ? pick.map(function (f) {
          var at = Date.parse(f.datetime), nt = f.is_daytime != null ? f.is_daytime === false : !!(HH.nightAt && HH.nightAt(h.states, f.datetime));
          return '<div><span class="mi">' + hr(at).replace(' ', '') + '</span>' + wx(f.condition === 'clear-night' && !nt ? 'sunny' : f.condition, 20, nt) +
            '<b>' + Math.round(num(f.temperature)) + '°</b></div>';
        }).join('') : '<div><span class="mi">Loading the forecast…</span></div>') + '</div>' +
        '<div class="note">' + esc([trend, sunTxt].filter(Boolean).join(' · ')) + '</div></div>');
    }
    _unsub() {
      (this._subs || []).forEach(function (p) { p.then(function (u) { if (u) u(); }); });
      this._subs = null;
      this._subWx = null;
    }
    disconnectedCallback() { super.disconnectedCallback(); this._unsub(); }
    connectedCallback() { if (super.connectedCallback) super.connectedCallback(); if (this._built) this.redraw(); }
  }

  // ===================================== LIGHTS: LIGHTING THROUGH THE DAY
  // The rooms lit longest today (a room is lit while any of its lights is),
  // as bars against the longest -- Settings' Rooms Shown, three by default.
  class HkLightsDayCard extends HeaderCard {
    static get PART_CSS() {
      return [
        '.sub{font-size:13px;color:' + v('ink-2') + ';margin-top:6px}',
        // the rows from the top, evenly apart (three fill the card, as the
        // concept's; one or two keep the same spacing rather than float)
        '.rows{flex:1;display:flex;flex-direction:column;gap:22px;padding-top:22px;min-height:0}',
        '.dr{display:grid;grid-template-columns:minmax(0,120px) minmax(0,1fr) 64px;gap:14px;align-items:center}',
        '.dr b{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dr .tr{height:10px;background:' + v('key') + ';border-radius:' + R.capsule('10px') + ';overflow:hidden}',
        '.dr .tr i{display:block;height:100%;background:' + P.yellow + ';border-radius:' + R.capsule('10px') + '}',
        '.dr span{font-size:13px;color:' + v('ink-2') + ';text-align:right;font-variant-numeric:tabular-nums}',
        '.none{margin:auto 0;font-size:13px;color:' + v('ink-2') + '}',
        '@media (max-width:' + C.BP.phone + 'px){.dr{grid-template-columns:minmax(0,96px) minmax(0,1fr) 58px;gap:10px}.rows{gap:16px;padding-top:16px}}'
      ].join('');
    }
    _ents() {
      var out = [];
      ((this._config || {}).rooms || []).forEach(function (r) { (r.lights || []).forEach(function (id) { out.push([id, r.name]); }); });
      return out;
    }
    _render() {
      this._shell('lday');
      var h = this.client, self = this;
      if (!h) return;
      var ents = this._ents().filter(function (e) { return h.states[e[0]]; }), from = midnight(), now = Date.now();
      var head = '<div class="ttl"><b>Lighting Through the Day</b></div><div class="sub">Time with at least one light on, by room</div>';
      if (!ents.length) return this._paint(head + '<div class="none">No lights on this page</div>');
      this._load('hist', 3 * MIN, function () {
        return h.callWS({ type: 'history/history_during_period', start_time: new Date(from).toISOString(),
          end_time: new Date().toISOString(), entity_ids: ents.map(function (e) { return e[0]; }),
          minimal_response: true, no_attributes: true, significant_changes_only: false });
      });
      var Hs = this._hist;
      if (!Hs) return this._paint(head + '<div class="wait">Loading today…</div>');
      var rooms = {};
      ents.forEach(function (e) {
        var s = (Hs[e[0]] || []).map(function (x) { return [(x.lu || x.lc) * 1000, x.s]; });
        // a light on all along: the history starts with its state at midnight
        var sp = spans(s, from, now, function (p) { return p[1] === 'on'; });
        if (!sp.length) return;
        (rooms[e[1]] = rooms[e[1]] || []).push.apply(rooms[e[1]], sp);
      });
      var n = Math.max(2, Math.min(5, header('lights').rooms || 3));
      var list = Object.keys(rooms).map(function (k) { return { name: k, t: total(merge(rooms[k])) }; })
        .sort(function (a, b) { return b.t - a.t; }).slice(0, n);
      var top = list.length ? list[0].t : 1;
      this._paint(head + (list.length ? '<div class="rows">' + list.map(function (r) {
        return '<div class="dr"><b>' + esc(r.name) + '</b><div class="tr"><i style="width:' + Math.max(2, r.t / top * 100).toFixed(1) + '%"></i></div><span>' + shortDur(r.t) + '</span></div>';
      }).join('') + '</div>' : '<div class="none">No lights have been on yet today.</div>'));
    }
  }

  // ====================================== LIGHTS: LEFT ON, THEN TONIGHT
  // LEFT ON: a light on in a room whose presence sensors (occupancy,
  // presence, motion -- the area's own) have all said nobody for a while
  // (Settings' Empty For, 10 min) -- each with Turn Off. A room with no such
  // sensor is never named: there is nothing to judge it by. TONIGHT: what
  // the lighting automations do in the next 16 hours, from the server's
  // schedule (page_headers.py); a row whose conditions fail now is dimmed.
  // Neither to show: what the lights that are on are set to (Light Levels).
  var SCHED = { data: null, sub: null, cards: new Set() };
  function schedule(card, h) {
    SCHED.cards.add(card);
    var port = !SCHED.sub && h ? window.hkCards.subscriptions(h) : null;
    if (port) {
      SCHED.sub = port.subscribeMessage(function (m) {
        SCHED.data = m || {};
        SCHED.cards.forEach(function (c) { c.redraw(); });
      }, { type: 'hk_frontend/page_headers/subscribe' }).catch(function (e) {
        console.warn('[hk-headers] the schedule', e);
        SCHED.data = SCHED.data || { lights: { schedule: [] } };
        SCHED.sub = null;
      });
    }
    return SCHED.data;
  }
  // an entry's next time: a sun event from sun.sun, a time of day, or an
  // input_datetime's time -- within the next 16 hours, else null
  function nextTime(h, e, now) {
    var t = null;
    if (e.kind === 'sun') {
      var sun = h.states['sun.sun'];
      if (!sun) return null;
      var base = Date.parse(e.event === 'sunrise' ? sun.attributes.next_rising : sun.attributes.next_setting);
      if (!isFinite(base)) return null;
      t = base + (e.offset_s || 0) * 1000;
      // the offset can put today's event already past, or tomorrow's within
      if (t < now) t += DAY;
      if (t - DAY > now) t -= DAY;
    } else if (e.kind === 'time') {
      var hhmm = e.at;
      if (!hhmm && e.entity) {
        var s = h.states[e.entity], a = s && s.attributes;
        if (a && a.has_time) hhmm = (a.hour != null ? a.hour : 0) + ':' + (a.minute != null ? a.minute : 0);
      }
      var m = /^(\d+):(\d+)/.exec(hhmm || '');
      if (!m) return null;
      var d = new Date(now); d.setHours(+m[1], +m[2], 0, 0);
      t = d.getTime();
      if (t <= now) t += DAY;
    }
    return t !== null && t - now <= 16 * HOUR ? t : null;
  }
  function kelvinWord(k) {
    return k < 3000 ? 'Warm white' : k < 3600 ? 'Soft white' : k < 4600 ? 'Neutral white' : k < 5600 ? 'Cool white' : 'Daylight';
  }
  var OUTDOOR = /yard|outdoor|outside|exterior|deck|patio|porch|driveway|garden|lawn|pool|attic|garage|shed|crawl/i;
  class HkLightsTonightCard extends HeaderCard {
    static get PART_CSS() {
      return [
        '.ttl span.warn{color:' + v('warn') + '}',
        '.lo{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:12px;padding:7px 0}',
        '.lo+.lo{border-top:1px solid ' + v('line') + '}',
        '.lo b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.lo .s{display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.lo .s em{font-style:normal;color:' + v('warn') + '}',
        '.ok{display:flex;align-items:center;gap:8px;font-size:13px;color:' + v('ink-2') + ';margin:12px 0 4px}',
        '.ok hk-icon{--mdc-icon-size:15px;width:15px;height:15px;display:flex;color:' + P.green + '}',
        '.tn{margin-top:auto;border-top:1px solid ' + v('line') + ';padding:10px 0 2px}',
        '.tn .h{display:flex;justify-content:space-between;align-items:baseline;' + C.labelCss('label-small') + '}',
        '.tn .h span{text-transform:none;letter-spacing:0}',
        '.ev{display:grid;grid-template-columns:66px minmax(0,1fr);gap:10px;align-items:baseline;margin-top:7px;font-size:13px}',
        '.ev time{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.ev span{color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ev i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}',
        // a condition fails now ("only when someone's home"): the row quieter
        '.ev.wait time,.ev.wait span{color:' + v('ink-3') + '}',
        '.none{font-size:13px;color:' + v('ink-3') + ';margin-top:7px}',
        // LIGHT LEVELS (the fallback)
        '.lr{display:flex;align-items:center;gap:12px;margin:16px 0 10px}',
        '.lr b{display:block;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}',
        '.lr .s{display:block;margin-top:4px}',
        '.sc{position:relative;height:6px;background:' + v('key') + ';border-radius:' + R.capsule('6px') + ';margin:0 0 6px 46px}',
        '.sc i{position:absolute;top:0;bottom:0;border-radius:' + R.capsule('6px') + ';background:' + P.yellow + '}',
        '.ll{margin-top:auto;font-size:11px;color:' + v('ink-3') + '}'
      ].join('');
    }
    _lights() {
      var out = [];
      ((this._config || {}).rooms || []).forEach(function (r) {
        (r.lights || []).forEach(function (id) { out.push({ id: id, room: r.name, icon: (r.icons || {})[id] }); });
      });
      return out;
    }
    _ids() { return this._lights().map(function (x) { return x.id; }).concat(this._occ || [], ['sun.sun']); }
    _render() {
      var self = this;
      if (!this._built) {
        this._shell('lnight');
        this._card.addEventListener('click', function (e) {
          var b = e.target && e.target.closest ? e.target.closest('.pill[data-off]') : null;
          if (!b) return;
          e.stopPropagation();
          var id = b.getAttribute('data-off');
          self._actions().callService(id.split('.')[0], 'turn_off', { entity_id: id });
          b.textContent = '…';
        }, true);
      }
      var h = this.client;
      if (!h) return;
      var cfg = header('lights'), now = Date.now();
      var lights = this._lights().filter(function (x) { return h.states[x.id]; });
      var ids = {};
      lights.forEach(function (x) { ids[x.id] = 1; });
      // ---- left on
      var occ = {}, occIds = [];
      Object.keys(h.states).forEach(function (id) {
        if (id.indexOf('binary_sensor.') !== 0) return;
        var s = h.states[id];
        if (!/^(occupancy|presence|motion)$/.test(s.attributes.device_class || '')) return;
        var a = areaOf(h, id);
        if (!a) return;
        occIds.push(id);
        var o = occ[a] = occ[a] || { on: false, since: 0 };
        if (s.state === 'on') o.on = true;
        o.since = Math.max(o.since, Date.parse(s.last_changed));
      });
      this._occ = occIds;
      var skip = Array.isArray(cfg.exclude_areas) ? cfg.exclude_areas : ((hs('status_rows', {}) || {}).lights || {}).exclude_areas || [];
      var after = (cfg.after_min || 10) * MIN;
      var sensed = false;
      var left = cfg.left_on === false ? [] : lights.map(function (x) {
        var s = h.states[x.id], a = areaOf(h, x.id), o = a && occ[a];
        if (!o || skip.indexOf(a) >= 0 || (!Array.isArray(cfg.exclude_areas) && OUTDOOR.test(areaName(h, a) || ''))) return null;
        sensed = true;
        if (s.state !== 'on' || o.on) return null;
        var em = now - Math.max(o.since, Date.parse(s.last_changed));
        return em >= after ? { x: x, empty: em, bri: num(s.attributes.brightness) } : null;
      }).filter(Boolean).sort(function (a, b) { return b.empty - a.empty; });
      // ---- tonight
      var S = cfg.tonight === false ? null : schedule(this, h);
      var pickAuto = Array.isArray(cfg.automations) ? cfg.automations : null;
      var evs = [];
      ((S && S.lights && S.lights.schedule) || []).forEach(function (e) {
        if (pickAuto && pickAuto.indexOf(e.automation) < 0) return;
        var n = (e.entities || []).filter(function (id) { return ids[id]; }).length;
        if (!n) return;
        var t = nextTime(h, e, now);
        if (t === null) return;
        var who = e.area && !/^(home|house)$/i.test(e.area) ? e.area : /interior|inside|indoor/i.test(e.name || '') ? 'Inside' : 'House';
        evs.push({ t: t, e: e, n: n, text: who + ' lights ' + e.effect + (e.kind === 'sun' ? ' · ' + e.event : '') });
      });
      evs.sort(function (a, b) { return a.t - b.t; });
      // the same automation's same moment once (a trigger listed twice)
      evs = evs.filter(function (x, i) { return !evs.slice(0, i).some(function (y) { return y.t === x.t && y.e.automation === x.e.automation; }); });
      // ---- nothing to judge and nothing scheduled: Light Levels
      if (!sensed && !evs.length && (S || cfg.tonight === false)) return this._levels(lights);
      var shown = left.slice(0, evs.length ? 2 : 3);
      var nEv = shown.length >= 2 ? 1 : shown.length === 1 ? 2 : 3;
      var head = '<div class="ttl"><b>' + (sensed || left.length ? 'Left On' : 'Tonight') + '</b>' +
        (sensed ? '<span' + (left.length ? ' class="warn">' + left.length + (left.length === 1 ? ' light' : ' lights') + ' in empty rooms' : '>by room presence') + '</span>' : '<span>lighting</span>') + '</div>';
      var lo = !sensed ? '' : left.length ? shown.map(function (z) {
        var nm = (h.states[z.x.id].attributes || {}).friendly_name || z.x.id;
        var icon = z.x.icon || 'hk:lightbulb';
        return '<div class="lo" data-more="' + esc(z.x.id) + '"><div class="well" style="--a:' + P.yellow + '"><hk-icon icon="' + esc(icon) + '"></hk-icon></div>' +
          '<div><b>' + esc(nm) + '</b><span class="s mi">' + esc(z.x.room || '') + ' · <em>empty ' + shortDur(z.empty) + '</em>' +
          (z.bri != null ? ' · ' + Math.round(z.bri / 2.55) + '%' : '') + '</span></div><button class="pill" data-off="' + esc(z.x.id) + '">Turn Off</button></div>';
      }).join('') : '<div class="ok"><hk-icon icon="hk:check-bold"></hk-icon>Nothing left on in an empty room</div>';
      var tn = '';
      if (cfg.tonight !== false) {
        var first = evs[0];
        var tag = sensed ? '<div class="h">Tonight<span>' : '<div class="h"><span></span><span>';
        tn = '<div class="tn"' + (sensed ? '' : ' style="border-top:0;margin-top:6px"') + '>' + tag + (first ? 'next in ' + shortDur(first.t - now) : S ? 'nothing scheduled' : '') + '</span></div>' +
          (evs.length ? evs.slice(0, sensed ? nEv : 4).map(function (x) {
            return '<div class="ev' + (x.e.ready === false ? ' wait' : '') + '" data-more="' + esc(x.e.automation) + '"><time>' + hm(x.t) + '</time><span><i style="background:' +
              (x.e.effect === 'on' ? P.yellow : v('mark')) + '"></i>' + esc(x.text) + (x.e.ready === false ? ' · not now' : '') + '</span></div>';
          }).join('') : '<div class="none">' + (S ? 'No lighting automations run in the next few hours.' : 'Reading the schedule…') + '</div>') + '</div>';
      }
      this._paint(head + lo + tn);
    }
    _levels(lights) {
      var h = this.client;
      var on = lights.map(function (x) { return h.states[x.id]; }).filter(function (s) { return s && s.entity_id.indexOf('light.') === 0 && s.state === 'on'; });
      var head = '<div class="ttl"><b>Light Levels</b><span>' + (on.length ? 'lights on now' : 'now') + '</span></div>';
      if (!on.length) {
        return this._paint(head + '<div class="lr"><div class="well" style="--a:' + P.yellow + '"><hk-icon icon="hk:lightbulb-outline"></hk-icon></div><div><b>All lights off</b>' +
          '<span class="s mi">Brightness and color show here when lights are on</span></div></div>');
      }
      var bri = on.map(function (s) { return num(s.attributes.brightness); }).filter(function (x) { return x != null; }).map(function (x) { return Math.round(x / 2.55); });
      var ks = on.map(function (s) {
        var k = num(s.attributes.color_temp_kelvin);
        return s.attributes.color_mode === 'color_temp' ? k : null;
      }).filter(function (x) { return x != null; });
      var colored = on.filter(function (s) { return /hs|rgb|xy/.test(s.attributes.color_mode || ''); }).length;
      var lo = bri.length ? Math.min.apply(null, bri) : null, hi = bri.length ? Math.max.apply(null, bri) : null;
      var avg = ks.length ? Math.round(ks.reduce(function (a, b) { return a + b; }, 0) / ks.length / 100) * 100 : null;
      this._paint(head +
        '<div class="lr"><div class="well" style="--a:' + P.yellow + '"><hk-icon icon="hk:white-balance-sunny"></hk-icon></div><div><b>' +
        (lo == null ? '—' : lo === hi ? lo + '%' : lo + '–' + hi + '%') + '</b><span class="s mi">Brightness · ' + bri.length + ' dimmable</span></div></div>' +
        (lo != null ? '<div class="sc"><i style="left:' + lo + '%;width:' + Math.max(2, hi - lo) + '%"></i></div>' : '') +
        '<div class="lr"><div class="well" style="--a:' + P.orange + '"><hk-icon icon="hk:lightbulb-outline"></hk-icon></div><div><b>' +
        (avg ? avg + ' K · ' + kelvinWord(avg) : colored ? colored + ' in color' : 'Not reported') + '</b><span class="s mi">Color · ' + ks.length + ' reporting' +
        (colored && avg ? ' · ' + colored + ' in color' : '') + '</span></div></div>' +
        '<div class="ll">From the lights that are on and report it.</div>');
    }
    disconnectedCallback() { super.disconnectedCallback(); SCHED.cards.delete(this); }
  }

  // ========================================= SECURITY: YOUR HOME + CARE
  // The house (the Power page's picture, or a Picture Folder of your own)
  // with a label for each way in that its art.json places (`doors`: the
  // spot on the picture, and where its label sits clear of the house) and
  // the house has: the lock and the contact read together -- or Settings'
  // pick. Beside it today's activity from the logbook, scrolling. Under it,
  // only while there is something to look after, Device Care: an entry
  // point gone quiet, or a low battery on a lock's or sensor's own device.
  // The card fills its row (the keypad's height, hk-strategy.js); on a phone,
  // where the two stack, it takes its own height.
  var ARTS = {};
  // the picture's art.json, kept in the browser between loads (hkCards.artJson)
  function artOf(base, fn) {
    if (ARTS[base] && ARTS[base].data) return fn(ARTS[base].data);
    C.artJson(base, function (j) { fn(j || {}); });
  }
  // THE WAYS IN, found by name when Settings does not say: a lock and a door
  // contact whose names say front / back / garage
  var WAYS = {
    front_door: { name: 'Front Door', re: /front/i },
    back_door: { name: 'Back Door', re: /(^|[^a-z])(back|rear|patio|deck)([^a-z]|$)/i },
    garage: { name: 'Garage', re: /garage/i }
  };
  function waysIn(h, c, pick) {
    var out = {};
    Object.keys(WAYS).forEach(function (k) {
      var W = WAYS[k], ids = Array.isArray(pick[k]) && pick[k].length ? pick[k] : null;
      if (!ids) {
        var named = function (list) { return (list || []).filter(function (id) { return h.states[id] && W.re.test(id + ' ' + nameOf(h, id)); }); };
        var lock = named(c.locks)[0];
        var door = k === 'garage' ? ((c.garage || []).filter(function (id) { return id.indexOf('cover.') === 0 && h.states[id]; })[0] || named(c.doors)[0])
                                  : named(c.doors).filter(function (id) { return !/garage/i.test(id + nameOf(h, id)) || k === 'garage'; })[0];
        if (k === 'back_door' && lock && /garage/i.test(lock)) lock = null;
        if (k === 'front_door' && lock && /garage|back/i.test(lock)) lock = null;
        ids = [lock, door].filter(Boolean);
      }
      if (ids.length) out[k] = ids.filter(function (id) { return h.states[id]; });
    });
    return out;
  }
  function wayState(h, ids) {
    var lock = ids.filter(function (id) { return id.indexOf('lock.') === 0; }).map(function (id) { return h.states[id]; })[0];
    var door = ids.filter(function (id) { return /^(binary_sensor|cover)\./.test(id); }).map(function (id) { return h.states[id]; });
    var cover = door.filter(function (s) { return s.entity_id.indexOf('cover.') === 0; })[0], contact = door.filter(function (s) { return s.entity_id.indexOf('cover.') !== 0; })[0];
    var openS = (cover && /^(open|opening|closing)$/.test(cover.state)) || (contact && contact.state === 'on');
    var unl = lock && lock.state !== 'locked';
    var main = cover || lock || contact;
    var word = openS ? 'Open' : cover ? 'Closed' : lock ? (lock.state === 'locked' ? 'Locked' : lock.state.charAt(0).toUpperCase() + lock.state.slice(1)) : contact ? 'Closed' : '—';
    var t = [lock, cover, contact].filter(Boolean).map(function (s) { return Date.parse(s.last_changed); }).sort().pop();
    return { main: main, word: word, warn: !!(openS || unl), t: t };
  }
  // GONE QUIET: Home Assistant says it is unavailable, or it has said nothing
  // since Home Assistant started (unknown) AND nothing else on its device has
  // reported in a day. A leak sensor only reports a leak changing, so after a
  // restart it is "unknown" for days while its battery, voltage and
  // temperature report every few hours -- it is working, and not named
  // (2026-10-16). Unknown with no device to judge by: not named either.
  var HEARD = 26 * HOUR;
  function siblings(h) {
    var n = Object.keys(h.entities || {}).length;
    if (siblings._n === n && siblings._h) return siblings._h;
    var out = {};
    Object.keys(h.entities || {}).forEach(function (id) {
      var e = h.entities[id];
      if (e && e.device_id) (out[e.device_id] = out[e.device_id] || []).push(id);
    });
    siblings._n = n; siblings._h = out;
    return out;
  }
  function goneQuiet(h, id, now) {
    var s = h.states[id];
    if (!s) return false;
    if (s.state === 'unavailable') return true;
    if (s.state !== 'unknown') return false;
    var e = h.entities && h.entities[id], sib = e && e.device_id ? siblings(h)[e.device_id] || [] : [];
    var others = sib.filter(function (x) { return x !== id && h.states[x]; });
    if (!others.length) return false;
    return !others.some(function (x) {
      var o = h.states[x];
      if (!o || o.state === 'unknown' || o.state === 'unavailable') return false;
      var t = Date.parse(o.last_reported || o.last_updated);
      return isFinite(t) && now - t < HEARD;
    });
  }
  // WHAT A ROW IS ABOUT, for its glyph and its words: a lock, a garage door,
  // a door, a window, a leak sensor, the alarm
  function kindOf(h, id, alarm) {
    if (id === alarm) return 'alarm';
    var d = id.split('.')[0], dc = ((h.states[id] || {}).attributes || {}).device_class;
    if (d === 'lock') return 'lock';
    if (d === 'cover' || dc === 'garage_door') return 'garage';
    if (dc === 'moisture') return 'leak';
    if (dc === 'window') return 'window';
    return 'door';
  }
  // the glyph for that kind in that state, and whether it is a warning
  function rowGlyph(kind, state) {
    var warn = /^(unlocked|jammed|open|opening|on|triggered)$/.test(state);
    var G = { lock: warn ? 'hk:lock-open-variant' : 'hk:lock', garage: warn ? 'hk:garage-open-variant' : 'hk:garage-variant',
              door: warn ? 'hk:door-open' : 'hk:door-closed', window: warn ? 'hk:window-open-variant' : 'hk:window-closed-variant',
              leak: warn ? 'hk:water-alert' : 'hk:water',
              alarm: state === 'disarmed' ? 'hk:shield-off' : state === 'triggered' ? 'hk:shield-alert' : /home|night/.test(state) ? 'hk:shield-home' : 'hk:shield-lock' };
    // THE COLOR ITS OWN TILE SHOWS in that state: a door, window or leak
    // sensor red while open or wet and a plain glyph when shut or dry (the
    // Doors & Windows and Water pages' tiles); a lock or garage door mint when
    // secure (the Locks pills), orange while it isn't; the alarm the keypad's
    // own (Disarm red, Home blue, Away green)
    var col = kind === 'alarm' ? (state === 'disarmed' || state === 'triggered' ? P.red : /home|night/.test(state) ? P.blue : P.green)
            : kind === 'door' || kind === 'window' || kind === 'leak' ? (warn ? P.red : v('ink-2'))
            : warn ? P.orange : P.mint;
    return { icon: G[kind] || 'hk:door-open', color: col };
  }
  var LOG_WORD = { locked: 'locked', unlocked: 'unlocked', jammed: 'jammed', open: 'opened', closed: 'closed', on: 'opened', off: 'closed',
                   disarmed: 'disarmed', armed_away: 'armed Away', armed_home: 'armed Home', armed_night: 'armed Night',
                   armed_vacation: 'armed Vacation', triggered: 'triggered' };
  var XP_KEY = 'hk-security-activity-expanded';
  class HkSecurityOverviewCard extends HeaderCard {
    static get PART_CSS() {
      var B = C.BLUR;
      return [
        // the grid stretches the card to its row (the keypad's height, less
        // the card's own margins): no height of its own, or it would add them
        ':host{display:block;position:relative;min-height:var(--hk-sec-min,360px)}',
        '.col{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px}',
        'hk-plate.hd.shome{height:auto;flex:1 1 0;min-height:0;padding:20px;container-name:shome}',
        '.in{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,357px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:22px}',
        'hk-plate.hd.care{height:auto;flex:none;padding:' + C.CARD.pad + ';flex-direction:row;align-items:center;gap:14px}',
        '.hi{display:flex;flex-direction:column;min-width:0;min-height:0}',
        '.hi .lab{' + C.labelCss('label-small') + '}',
        '.stage{flex:1 1 auto;min-height:0;box-sizing:border-box;padding:24px 0 34px;container-type:size;display:flex;align-items:center}',
        '.pic{position:relative;width:min(100cqw,calc(100cqh * var(--ar)));aspect-ratio:var(--ar);margin:0 auto}',
        '.pic img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 10px 18px rgba(0,0,0,.3))}',
        '.wire{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
        // a label: the Power page's chip material, small
        '.co{position:absolute;transform:translate(-50%,-50%);padding:6px 10px;border-radius:' + R.inner + 'px;white-space:nowrap;cursor:pointer;z-index:1;',
        '  background:' + v('float-plate') + ';-webkit-backdrop-filter:var(--hk-float-backdrop,' + B.medium + ');backdrop-filter:var(--hk-float-backdrop,' + B.medium + ');',
        '  border:1px solid ' + v('line') + ';box-shadow:0 6px 16px rgba(0,0,0,0.25);-webkit-tap-highlight-color:transparent}',
        '.co b{display:block;font-size:11px;font-weight:600}',
        '.co span{display:block;font-size:11px;color:' + v('ink-2') + ';margin-top:2px}',
        '.co.warn span{color:' + v('warn') + '}',
        '.ap{min-width:0;min-height:0;display:flex;flex-direction:column}',
        // EXPAND / COLLAPSE: every event a line of its own, or an open folded
        // into its close -- a small capsule after the count
        '.ap .ttl{align-items:center}',
        '.ap .ttl .cnt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:right}',
        '.xp{appearance:none;font:inherit;font-size:13px;font-weight:600;color:' + v('ink') + ';background:' + v('key') + ';',
        '  border:1px solid ' + v('line') + ';height:26px;padding:0 11px;border-radius:' + R.capsule('26px') + ';cursor:pointer;flex:none;',
        '  -webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
        '.xp:active{transform:scale(0.97);background:' + v('key-strong') + '}',
        '.xp[aria-pressed=true]{background:' + v('key-strong') + '}',
        // (its edges: the sheet's shadows, BASE_CSS .hk-edge -- was a fade)
        '.lst{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding-bottom:12px}',
        '.lst::-webkit-scrollbar{display:none}',
        '.ar{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid ' + v('line') + '}',
        '.ar:last-child{border-bottom:0}',
        '.ar .tx{flex:1;min-width:0}',
        // the row's glyph on its own, in its state's color (no well: the
        // user, 2026-10-16)
        '.ar .gl{--mdc-icon-size:20px;width:20px;height:20px;flex:none;display:flex;color:var(--a)}',
        '.ar b{display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ar .s{display:block;margin-top:3px;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ar time{flex:none}',
        '.none{margin-top:12px;font-size:13px;color:' + v('ink-2') + '}',
        // device care
        '.care .tx{flex:1;min-width:0}',
        '.care .lab{' + C.labelCss('label-small') + ';margin-bottom:4px}',
        '.care b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.care p{margin:3px 0 0;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // narrower (an iPad beside the keypad): the house over the activity
        '@container shome (max-width:600px){.in{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(150px,1.1fr) minmax(0,1fr);gap:6px}.stage{padding:6px 0 4px}}',
        '@container shome (max-width:420px){.co,.wire path{display:none}}',
        // a phone: the column takes its own height
        '@media (max-width:' + C.BP.phone + 'px){:host{height:auto;min-height:0}.col{position:static}',
        '  hk-plate.hd.shome{flex:none;height:560px}hk-plate.hd.care{min-height:0}}'
      ].join('');
    }
    _ids() { return this._watch || []; }
    // EXPANDED OR GROUPED: this screen's own choice (the browser's storage --
    // a tablet and a phone each keep theirs), grouped until asked
    _expanded() {
      if (this._xp === undefined) {
        try { this._xp = window.localStorage.getItem(XP_KEY) === '1'; } catch (e) { this._xp = false; }
      }
      return this._xp;
    }
    _setExpanded(on) {
      this._xp = !!on;
      try { window.localStorage.setItem(XP_KEY, on ? '1' : '0'); } catch (e) { /* private mode: for this page only */ }
      this.redraw();
    }
    _shell() {
      if (this._built) return;
      this._root.innerHTML = '<div class="col"><hk-plate class="hd shome" data-hk-role="card"></hk-plate><hk-plate class="hd care" data-hk-role="card"></hk-plate></div>';
      this._card = this._root.querySelector('.shome');
      this._care = this._root.querySelector('.care');
      var self = this;
      this._root.addEventListener('click', function (e) {
        var xp = e.target && e.target.closest ? e.target.closest('[data-expand]') : null;
        if (xp) { e.stopPropagation(); self._setExpanded(!self._expanded()); return; }
        // DEVICE CARE'S DETAILS, for more than one: the list the status
        // chips open (hk-detail.js openGroup), every one that needs looking
        // after, each opening its own sheet and coming back to the list
        var care = e.target && e.target.closest ? e.target.closest('[data-care]') : null;
        var D = window.hkDetail;
        if (care && D && D.openGroup && (self._careIds || []).length > 1) {
          e.stopPropagation();
          D.openGroup('Device Care', self._careIds.slice(), { icon: 'hk:alert-circle', color: P.yellow,
            resolve: function () { return self._careIds && self._careIds.length ? { title: 'Device Care', ids: self._careIds.slice() } : null; } });
          return;
        }
        var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
        var id = t && t.getAttribute('data-more');
        if (!id) return;
        e.stopPropagation();
        window.hkShell.moreInfo(id, self);
      });
      this._built = true;
    }
    _render() {
      this._shell();
      var h = this.client, c = this._config || {}, self = this;
      if (!h) return;
      var cfg = header('security'), now = Date.now();
      var ways = waysIn(h, c, cfg);
      var wayIds = [];
      Object.keys(ways).forEach(function (k) { wayIds = wayIds.concat(ways[k]); });
      var alarm = c.alarm || hs('security.alarm', null);
      var activity = (c.locks || []).concat((c.garage || []).filter(function (id) { return id.indexOf('cover.') === 0; }), wayIds,
          c.doors || [], c.windows || [], c.leaks || [], alarm ? [alarm] : [])
        .filter(function (id, i, a) { return id && a.indexOf(id) === i && h.states[id]; });
      var careIds = (c.locks || []).concat(c.doors || [], c.windows || [], c.garage || [], c.leaks || []).filter(function (id, i, a) { return a.indexOf(id) === i && h.states[id]; });
      this._watch = activity.concat(careIds);
      // ---- the picture
      var base = c.art || '/hk/power-house/';
      if (base.slice(-1) !== '/') base += '/';
      if (this._art === undefined) { this._art = null; artOf(base, function (j) { self._art = j; self.redraw(); }); }
      var A = this._art || {}, L = (A.layers || {}).house, D = A.doors || {};
      var pic = '';
      if (L) {
        var lx = L[1], ly = L[2], lw = L[3], lh = L[4];
        var px = function (p) { return [p[0] - lx, p[1] - ly]; };
        var wire = '', tags = '';
        if (cfg.callouts !== false) {
          Object.keys(WAYS).forEach(function (k) {
            var d = D[k], ids = ways[k];
            if (!d || !d.at || !d.tag || !ids || !ids.length) return;
            var w = wayState(h, ids), at = px(d.at), tg = px(d.tag), col = w.warn ? v('warn') : P.mint;
            wire += '<path d="M' + tg[0] + ' ' + tg[1] + 'L' + at[0] + ' ' + at[1] + '" stroke="rgba(255,255,255,0.5)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
              '<circle cx="' + at[0] + '" cy="' + at[1] + '" r="' + (lw / 70).toFixed(1) + '" fill="' + col + '" fill-opacity=".25"/>' +
              '<circle cx="' + at[0] + '" cy="' + at[1] + '" r="' + (lw / 128).toFixed(1) + '" fill="' + col + '"/>';
            tags += '<div class="co' + (w.warn ? ' warn' : '') + '" data-more="' + esc(w.main ? w.main.entity_id : ids[0]) + '" style="left:' +
              (tg[0] / lw * 100).toFixed(2) + '%;top:' + (tg[1] / lh * 100).toFixed(2) + '%"><b>' + esc(WAYS[k].name) + '</b><span>' + w.word +
              (w.t && now - w.t < DAY ? ' · ' + hm(w.t) : '') + '</span></div>';
          });
        }
        pic = '<div class="stage"><div class="pic" style="--ar:' + (lw / lh).toFixed(4) + '"><img src="' + esc(base + L[0]) + '" alt="" decoding="async">' +
          '<svg class="wire" viewBox="0 0 ' + lw + ' ' + lh + '" preserveAspectRatio="none" aria-hidden="true">' + wire + '</svg>' + tags + '</div></div>';
      }
      // ---- today's activity, from the logbook -- and, while today has been
      // quiet (just after midnight), the last day's, said to be yesterday's
      var m0 = midnight(), from = Math.min(m0, now - DAY);
      this._load('log', 2 * MIN, function () {
        return activity.length ? h.callWS({ type: 'logbook/get_events', start_time: new Date(from).toISOString(), entity_ids: activity }) : [];
      });
      var lastOf = {};
      var evs = (this._log || []).filter(function (e) {
        if (!e.entity_id || !LOG_WORD[e.state]) return false;
        // the same state said again (Home Assistant restarting) is not news;
        // nor is a leak sensor's "dry" that follows no leak (its first report
        // after a restart)
        var was = lastOf[e.entity_id], same = was === e.state;
        lastOf[e.entity_id] = e.state;
        if (e.state === 'off' && was !== 'on' && kindOf(h, e.entity_id, alarm) === 'leak') return false;
        return !same && e.when * 1000 >= from;
      });
      var today = evs.some(function (e) { return e.when * 1000 >= m0; });
      if (today) evs = evs.filter(function (e) { return e.when * 1000 >= m0; });
      evs.reverse();
      var rows = [], used = {}, seen = {}, expanded = this._expanded();
      var label = function (id) {
        var nm = nameOf(h, id).replace(/ (Lock|Entry|Door Input|Contact|Sensor)$/i, '');
        if (id === alarm) nm = 'Alarm';
        // a door contact reads as its way in ("Front Door", not "Front Door Entry")
        if (id.indexOf('binary_sensor.') === 0) Object.keys(ways).forEach(function (k) { if (ways[k].indexOf(id) >= 0) nm = WAYS[k].name; });
        return nm;
      };
      var forLong = function (ms) { return ms < MIN ? Math.max(1, Math.round(ms / 1000)) + ' seconds' : dur(ms).replace(/ min$/, ' minutes'); };
      evs.forEach(function (e, i) {
        if (used[i]) return;
        var id = e.entity_id, t = e.when * 1000, sub = '';
        var kind = kindOf(h, id, alarm);
        var pair = { off: 'on', closed: 'open', locked: 'unlocked' }[e.state];
        if (pair) {
          for (var j = i + 1; j < evs.length; j++) if (evs[j].entity_id === id) {
            if (evs[j].state === pair) {
              // grouped, the open or unlock is folded into this row;
              // expanded, it keeps a row of its own (this one still says how long)
              if (!expanded) used[j] = 1;
              sub = (e.state === 'locked' ? 'Unlocked for ' : kind === 'leak' ? 'Wet for ' : 'Open for ') + forLong(t - evs[j].when * 1000);
            }
            break;
          }
        } else if (id === alarm) {
          for (var q = i + 1; q < evs.length; q++) if (evs[q].entity_id === id) { sub = 'Previously ' + (LOG_WORD[evs[q].state] || evs[q].state); break; }
        }
        if (!sub && e.context_name) sub = 'by ' + e.context_name;
        var nm = label(id);
        if (kind === 'leak') nm = nm.replace(/ (Water )?Leak( Sensor)?( Moisture)?$/i, '');
        var word = kind === 'leak' ? (e.state === 'on' ? 'leak detected' : 'dry again') : LOG_WORD[e.state];
        var key = nm.replace(/ Door$/, '') + '|' + word + '|' + Math.round(t / MIN);
        if (seen[key]) return;
        seen[key] = 1;
        var g = rowGlyph(kind, e.state);
        rows.push('<div class="ar" data-more="' + esc(id) + '"><hk-icon class="gl" style="--a:' + g.color + '" icon="' + g.icon + '"></hk-icon>' +
          '<div class="tx"><b>' + esc(nm + ' ' + word) + '</b>' + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</div><time class="mi">' +
          (t < m0 ? 'Yesterday ' : '') + hm(t) + '</time></div>');
      });
      this._paint('<div class="in"><div class="hi"><div class="lab">Your Home</div>' + pic + '</div>' +
        '<div class="ap"><div class="ttl"><b>Recent Activity</b><span class="cnt">' + (!rows.length ? 'today' : today ? rows.length + ' today' : rows.length + (rows.length === 1 ? ' event' : ' events')) + '</span>' +
          (rows.length ? '<button class="xp" data-expand aria-pressed="' + expanded + '">' + (expanded ? 'Collapse' : 'Expand') + '</button>' : '') + '</div>' +
        (rows.length ? '<div class="hk-edge"><div class="lst">' + rows.join('') + '</div></div>' : '<div class="none">' + (this._log ? 'Nothing opened, unlocked or wet today.' : 'Reading today’s activity…') + '</div>') + '</div></div>');
      // ---- device care
      var quiet = careIds.filter(function (id) { return goneQuiet(h, id, now); });
      var low = [], lim = cfg.low_battery || 20, devs = {};
      careIds.forEach(function (id) { var e = h.entities && h.entities[id]; if (e && e.device_id) devs[e.device_id] = id; });
      var bats = this._bats;
      if (!bats || this._batsAt !== careIds.join(',')) {
        // the battery sensors on the care entities' own devices (once per
        // list: a walk of every entity)
        bats = this._bats = [];
        this._batsAt = careIds.join(',');
        if (h.entities) Object.keys(h.entities).forEach(function (id) {
          var e = h.entities[id], s = h.states[id];
          if (e.device_id && devs[e.device_id] && id.indexOf('sensor.') === 0 && s && s.attributes.device_class === 'battery') bats.push([id, devs[e.device_id]]);
        });
      }
      bats.forEach(function (b) {
        var s = h.states[b[0]], n = s && num(s.state);
        if (n != null && n <= lim) low.push({ id: b[0], n: n, of: b[1] });
      });
      this._watch = this._watch.concat(bats.map(function (b) { return b[0]; }));
      low.sort(function (a, b) { return a.n - b.n; });
      var item = null;
      if (low.length) {
        var dn = (h.devices && h.entities[low[0].id] && h.devices[h.entities[low[0].id].device_id]) || {};
        item = { id: low[0].id, icon: 'hk:battery-alert-variant-outline', b: (dn.name_by_user || dn.name || nameOf(h, low[0].of)) + ' battery · ' + Math.round(low[0].n) + '%',
                 p: low.length > 1 ? 'And ' + (low.length - 1) + ' more low. Replace soon to keep them reporting.' : 'Replace soon to keep it reporting.' };
      } else if (quiet.length) {
        item = { id: quiet[0], icon: 'hk:alert-circle', b: quiet.length + (quiet.length === 1 ? ' sensor isn’t reporting' : ' sensors aren’t reporting'),
                 p: quiet.slice(0, 3).map(function (id) { return nameOf(h, id).replace(/ (Water Leak Sensor.*|Sensor|Contact|Door Sensor)$/i, ''); }).join(', ') +
                    (quiet.length > 3 ? ' and ' + (quiet.length - 3) + ' more' : '') + ' — check power or signal.' };
      }
      // everything that needs looking after: the low batteries, then the quiet
      this._careIds = low.map(function (x) { return x.id; }).concat(quiet.filter(function (id) {
        return !low.some(function (x) { return x.of === id; });
      }));
      this._care.style.display = item ? '' : 'none';
      if (item) {
        if (low.length && quiet.length) item.p = item.p.replace(/\.$/, '') + ' · ' + quiet.length + (quiet.length === 1 ? ' sensor isn’t reporting.' : ' sensors aren’t reporting.');
        C.morph(this._care, '<div class="well" style="--a:' + P.yellow + '"><hk-icon icon="' + item.icon + '"></hk-icon></div><div class="tx"><div class="lab">Device Care</div><b>' + esc(item.b) + '</b><p>' + esc(item.p) + '</p></div>' +
          '<button class="pill"' + (this._careIds.length > 1 ? ' data-care' : '') + ' data-more="' + esc(item.id) + '">' + (this._careIds.length > 1 ? 'Show All' : 'Details') + '</button>');
      }
    }
  }

  // ================================================ THE UTILITY PAGES (2026-10-16)
  // Vacuums, Timers and Water open with header cards too
  // (hk_house/docs/PLAN-2026-10-16-utility-pages.md): the same material, the
  // same 240 px, the same three columns. Every figure is read from the house
  // -- the vacuums' own state history, the timers' deadlines, the Energy
  // settings' water meter, the valve -- and what cannot be known is said, not
  // guessed: a vacuum with no completion counter is "back on its dock", never
  // "completed"; an hour the meter has not reported is "No reading", never 0.
  function dayName(t) { return new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long' })); }
  function dayShort(t) { return new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short' })); }
  // "Today · 9:42 AM", "Yesterday · 11:04 AM", "Tuesday · 2:18 PM"
  function whenText(t, now) {
    var d0 = midnight(now), d = midnight(t);
    var day = d === d0 ? 'Today' : d === midnight(d0 - HOUR * 12) ? 'Yesterday' :
      now - t < 6 * DAY ? dayName(t) : new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ month: 'short', day: 'numeric' }));
    return day + ' · ' + hm(t);
  }
  // the local midnight `k` days before today's (a calendar step: DST-safe)
  function daysBack(k, now) { var d = new Date(midnight(now)); d.setDate(d.getDate() - k); return d.getTime(); }
  function overlap(sp, a, b) {
    return sp.reduce(function (m, s) { return m + Math.max(0, Math.min(b, s[1]) - Math.max(a, s[0])); }, 0);
  }
  // compressed history -> [[t, state]]
  function pts(list) { return (list || []).map(function (x) { return [(x.lu || x.lc) * 1000, x.s]; }); }
  // a counter's steps up: [t, ...] wherever it rose
  function rises(list) {
    var out = [], last = null;
    pts(list).forEach(function (p) {
      var n = num(p[1]);
      if (n === null) return;
      if (last !== null && n > last) out.push(p[0]);
      last = n;
    });
    return out;
  }
  var VAC_OK = { no_error: 1, none: 1, ok: 1, unknown: 1, unavailable: 1, '': 1 };
  var RUN_GAP = 20 * MIN;           // back to the dock to wash or charge, then on: one run
  var SETTLE = 45 * MIN;            // how long after a run its outcome is looked for
  // THE RUNS of one vacuum: its `cleaning` spans, those less than RUN_GAP
  // apart joined (a mop wash, a recharge), each with how it ended:
  //   done      the vacuum's own success counter rose (a Roomba's missions)
  //   failed    its failure counter rose, or it reported an error
  //   canceled  its cancel counter rose
  //   docked    it went back to its dock with no error -- the most a vacuum
  //             without a counter can say: a run stopped early docks too
  //   stopped   it ended somewhere other than the dock
  //   running   it is cleaning now
  function vacRuns(v, H, now) {
    var s = pts(H[v.entity]);
    if (!s.length) return [];
    var sp = spans(s.map(function (p) { return [p[0], p[1]]; }), s[0][0], now, function (p) { return p[1] === 'cleaning'; });
    var runs = [];
    sp.forEach(function (x) {
      var r = runs[runs.length - 1];
      if (r && x[0] - r.end < RUN_GAP) { r.end = x[1]; r.parts.push(x); }
      else runs.push({ start: x[0], end: x[1], parts: [x] });
    });
    var ok = rises(H[v.success]), bad = rises(H[v.failed]), cut = rises(H[v.canceled]);
    var errs = pts(H[v.error]).filter(function (p) { return !VAC_OK[p[1]]; }).map(function (p) { return [p[0], p[1]]; });
    var within = function (list, a, b) { return list.some(function (t) { return t >= a && t <= b; }); };
    runs.forEach(function (r) {
      r.clean = total(r.parts);
      var a = r.start, b = r.end + SETTLE;
      var last = s[s.length - 1];
      if (r.end >= now - 1000 && last && last[1] === 'cleaning') { r.out = 'running'; return; }
      var err = errs.filter(function (p) { return p[0] >= a && p[0] <= b; })[0];
      var errState = s.some(function (p) { return p[1] === 'error' && p[0] >= a && p[0] <= b; });
      if (within(ok, r.end - 2 * MIN, b)) r.out = 'done';
      else if (within(bad, a, b)) r.out = 'failed';
      else if (within(cut, a, b)) r.out = 'canceled';
      else if (err || errState) { r.out = 'failed'; r.why = err ? String(err[1]).replace(/_/g, ' ') : ''; }
      else if (s.some(function (p) { return p[1] === 'docked' && p[0] >= r.end && p[0] <= b; })) r.out = 'docked';
      else r.out = 'stopped';
    });
    return runs;
  }
  var OUT_WORD = { done: 'Completed', failed: 'Error', canceled: 'Canceled', docked: 'Back on dock',
                   stopped: 'Stopped', running: 'Cleaning now' };
  function vacName(h, id) {
    return nameOf(h, id).replace(/\s*(robot\s*)?vacuum$/i, '') || nameOf(h, id);
  }
  // the vacuums' history, shared by the page's two cards: one ask
  var VACH = { key: null, at: 0, data: null, wait: null, cards: new Set() };
  function vacHistory(card, h, list) {
    VACH.cards.add(card);
    var ids = [];
    list.forEach(function (v) { [v.entity, v.success, v.failed, v.canceled, v.error].forEach(function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); }); });
    var key = ids.join(','), now = Date.now();
    if ((VACH.key !== key || now - VACH.at > 5 * MIN) && !VACH.wait) {
      VACH.at = now;
      // a month asked; the recorder answers with what it keeps (14 days here)
      var from = daysBack(30, now);
      VACH.wait = h.callWS({ type: 'history/history_during_period', start_time: new Date(from).toISOString(),
        end_time: new Date(now).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true,
        significant_changes_only: false }).then(function (r) {
        VACH.key = key; VACH.data = { from: from, H: r || {} }; VACH.wait = null;
        VACH.cards.forEach(function (c) { if (c.isConnected) c.redraw(); else VACH.cards.delete(c); });
      }, function (e) { VACH.wait = null; VACH.at = now - 4 * MIN; console.warn('[hk-headers] vacuum history', e); });
    }
    return VACH.key === key ? VACH.data : null;
  }

  // ------------------------------------------- VACUUMS: CLEANING THIS WEEK
  // The last seven days, a bar each: how long the vacuums cleaned, every
  // vacuum's time added together (two cleaning at once is twice the
  // cleaning). Mopping is cleaning: the vacuum's `cleaning` state, whatever
  // its mode. Against the seven days before, to the same hour -- left out
  // when the history does not reach back that far.
  class HkVacuumWeekCard extends HeaderCard {
    static get PART_CSS() {
      return BARS_CSS + [
        '.tot{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-top:10px;flex:none;min-width:0}',
        '.tot .cap{margin-top:4px}',
        '.cmp{font-size:13px;line-height:18px;color:' + v('ink-2') + ';text-align:right;min-width:0}',
        '.grow{flex:1;min-height:6px}',
        // EACH DAY ITS LETTER AND ITS TIME under its bar (Energy's Your Week)
        '.bl{height:28px}',
        '.bl span{display:flex;flex-direction:column;align-items:center;gap:4px}',
        '.bl span em{font-style:normal;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums}',
        '.bl span.now em{color:' + v('ink') + '}',
        // the foot: the readout, and which color is which vacuum
        '.ft{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;min-width:0}',
        '.ft .rd{margin-top:0;flex:1;min-width:0}',
        '.lg{display:flex;gap:12px;font-size:11px;font-weight:600;color:' + v('ink-2') + ';white-space:nowrap;flex:none}',
        '.lg span{display:flex;align-items:center;gap:5px}',
        '.lg i{width:8px;height:8px;border-radius:50%}',
        '@container (max-width:' + C.BP.cardSide + 'px){.lg{display:none}}'
      ].join('');
    }
    _list() { return ((this._config || {}).vacuums || []).filter(function (x) { return x && x.entity; }); }
    _ids() { return this._list().map(function (x) { return x.entity; }); }
    disconnectedCallback() { super.disconnectedCallback(); VACH.cards.delete(this); }
    _render() {
      this._shell('vweek');
      var h = this.client;
      if (!h) return;
      var list = this._list().filter(function (x) { return h.states[x.entity]; });
      var head0 = '<div class="ttl"><b>Cleaning This Week</b><span>Last 7 days</span></div>';
      if (!list.length) return this._paint(head0 + '<div class="wait">No vacuums</div>');
      var D = vacHistory(this, h, list), avail = Math.max(120, this._width());
      if (!D) return this._paint(head0 + '<div class="wait">Loading the week…</div>');
      var now = Date.now(), H = D.H;
      var per = list.map(function (v) {
        var s = pts(H[v.entity]);
        return { v: v, name: vacName(h, v.entity), first: s.length ? s[0][0] : Infinity,
                 sp: s.length ? spans(s, s[0][0], now, function (p) { return p[1] === 'cleaning'; }) : [] };
      });
      // AS MANY DAYS AS THE CARD HOLDS (2026-10-16, the user: the wider it
      // goes, the more days): a day each 58 px (its bar, its gap, "3h 54m"
      // under it), never fewer than seven, never more than the history has
      // (the recorder's keep: 14 days in this house) nor a month
      var first = Math.min.apply(null, per.map(function (p) { return p.first; }));
      var have = 1;
      while (have < 31 && daysBack(have, now) + MIN >= first) have++;
      var n = Math.max(7, Math.min(Math.floor((avail + 14) / 58), have, 31));
      var days = [];
      for (var k = n - 1; k >= 0; k--) {
        var a = daysBack(k, now), b = k ? daysBack(k - 1, now) : now;
        days.push({ a: a, b: b, by: per.map(function (p) { return overlap(p.sp, a, b); }),
                    known: per.some(function (p) { return p.first <= a + MIN; }) || k === 0 });
      }
      days.forEach(function (d) { d.t = d.by.reduce(function (x, y) { return x + y; }, 0); });
      var week = days.reduce(function (x, d) { return x + d.t; }, 0);
      var head = '<div class="ttl"><b>' + (n === 7 ? 'Cleaning This Week' : 'Cleaning by Day') + '</b><span>Last ' + n + ' days</span></div>';
      // the same number of days before, to this same hour, if the history reaches
      var pa = daysBack(2 * n - 1, now), pb = now - n * DAY, cmp = '';
      if (per.every(function (p) { return p.first <= pa + MIN; })) {
        var prev = per.reduce(function (x, p) { return x + overlap(p.sp, pa, pb); }, 0), diff = week - prev;
        var than = n === 7 ? ' than last week' : ' than the ' + n + ' days before';
        cmp = Math.abs(diff) < 5 * MIN ? 'About the same as' + (n === 7 ? ' last week' : ' the ' + n + ' days before') :
          dur(Math.abs(diff)) + (diff < 0 ? ' less' : ' more') + than;
      }
      // EACH VACUUM ITS COLOR, stacked: whose cleaning a day was
      var VC = ['purple', 'teal', 'orange', 'pink', 'blue'].map(function (k) { return 'rgba(' + C.PALETTE.chart[k].join(',') + ',0.8)'; });
      var last = n - 1;
      // more than a week: each day by its date too ("Sat 3"), the week's names repeating
      var lab = function (d, i) { return i === last ? 'Today' : dayShort(d.a) + (n > 7 ? ' ' + new Date(d.a).getDate() : ''); };
      var B = bars(days.map(function (d, i) {
        return { segs: per.map(function (pp, j) { return { v: d.by[j] / MIN, c: VC[j % VC.length] }; }), fut: !d.known,
                 label: lab(d, i) + '<em>' + (d.known ? (d.t < MIN ? '—' : shortDur(d.t)) : '·') + '</em>', now: i === last };
      }), avail, 48, 80);
      var legend = per.length > 1 ? '<div class="lg">' + per.map(function (pp, j) {
        return '<span><i style="background:' + VC[j % VC.length] + '"></i>' + esc(pp.name) + '</span>';
      }).join('') + '</div>' : '';
      this._nBars = n;
      this._nowI = last;
      this._rdRest = 'Hover or touch a day for its cleaning';
      var multi = list.length > 1;
      this._paint(head + '<div class="tot"><div><div class="big num">' + (week < MIN ? '0<u>min</u>' : durHtml(week)) + '</div>' +
        '<div class="cap">' + (multi ? 'Across your vacuums' : esc(per[0].name)) + '</div></div>' +
        (cmp ? '<div class="cmp">' + cmp + '</div>' : '') + '</div><div class="grow"></div>' +
        '<div class="bc">' + B.html + '</div><div class="ft"><div class="rd">' + this._rdRest + '</div>' + legend + '</div>');
      hourScrub(this, this._card.querySelector('.bc'), function (i) {
        var d = days[i], lab = i === last ? 'Today' : dayName(d.a) + (n > 7 ? ' ' + new Date(d.a).getDate() : '');
        if (!d.known) return lab + ' · No history';
        if (d.t < MIN) return lab + ' · No cleaning';
        return lab + ' · ' + dur(d.t) + (multi ? ' · ' + per.map(function (p, j) {
          return d.by[j] >= MIN ? p.name + ' ' + dur(d.by[j]) : null;
        }).filter(Boolean).join(', ') : '');
      }, 'Cleaning by day');
    }
  }

  // ---------------------------------------------- VACUUMS: LAST COMPLETED
  // Each vacuum's latest run: when, how long it cleaned, and how it ended,
  // in the words vacRuns allows. "Last Completed" only when every row is a
  // confirmed completion; otherwise "Last Runs".
  class HkVacuumLastCard extends HeaderCard {
    static get PART_CSS() {
      return [
        '.rows{flex:1;display:flex;flex-direction:column;justify-content:flex-start;margin-top:6px;min-height:0}',
        '.vr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:7px 0}',
        '.vr:last-child{padding-bottom:0}',
        '.vr+.vr{border-top:1px solid ' + v('line') + '}',
        '.vr b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vr .s{display:block;margin-top:2px;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vr .s em{font-style:normal;color:' + v('warn') + '}',
        '.vr strong{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.more{margin-top:auto;font-size:13px;color:' + v('ink-2') + '}'
      ].join('');
    }
    _list() { return ((this._config || {}).vacuums || []).filter(function (x) { return x && x.entity; }); }
    _ids() { return this._list().map(function (x) { return x.entity; }); }
    disconnectedCallback() { super.disconnectedCallback(); VACH.cards.delete(this); }
    _render() {
      this._shell('vlast');
      var h = this.client;
      if (!h) return;
      var list = this._list().filter(function (x) { return h.states[x.entity]; });
      if (!list.length) return this._paint('<div class="ttl"><b>Last Runs</b></div><div class="wait">No vacuums</div>');
      var D = vacHistory(this, h, list);
      if (!D) return this._paint('<div class="ttl"><b>Last Runs</b></div><div class="wait">Loading…</div>');
      var now = Date.now();
      var rows = list.map(function (v) {
        var runs = vacRuns(v, D.H, now);
        var st = h.states[v.entity].state;
        // cleaning now: that, and the run before it
        var cur = runs.length && runs[runs.length - 1].out === 'running' ? runs.pop() : null;
        var last = runs[runs.length - 1] || null;
        return { v: v, name: vacName(h, v.entity), last: last, cur: cur, st: st, at: cur ? cur.start : last ? last.end : 0 };
      });
      var fit = 3, shown = rows.slice().sort(function (a, b) { return b.at - a.at; }).slice(0, fit);
      // in the page's order, the most recent three
      shown = rows.filter(function (r) { return shown.indexOf(r) >= 0; });
      var confirmed = shown.every(function (r) { return !r.cur && r.last && r.last.out === 'done'; });
      // the span the history covers (the recorder's keep)
      var f0 = Math.min.apply(null, list.map(function (v) { var p0 = pts(D.H[v.entity]); return p0.length ? p0[0][0] : now; }));
      var span = Math.max(1, Math.round((now - f0) / DAY)), spanText = span === 14 ? 'Past 2 weeks' : span === 7 ? 'Past week' : 'Past ' + span + ' days';
      var html = '<div class="ttl"><b>' + (confirmed ? 'Last Completed' : 'Last Runs') + '</b><span>' + spanText + '</span></div><div class="rows">' +
        shown.map(function (r) {
          var s, right = '';
          if (r.cur) { s = 'Cleaning now · since ' + hm(r.cur.start); right = shortDur(now - r.cur.start); }
          else if (r.last) {
            var w = OUT_WORD[r.last.out] + (r.last.why ? ': ' + r.last.why : '');
            s = esc(whenText(r.last.end, now)) + ' · ' + (r.last.out === 'failed' || r.last.out === 'stopped' ? '<em>' + esc(w) + '</em>' : esc(w));
            right = shortDur(r.last.clean);
          } else s = 'No runs in the ' + spanText.toLowerCase();
          return '<div class="vr" data-more="' + esc(r.v.entity) + '" role="button" tabindex="0"><div style="min-width:0"><b>' + esc(r.name) +
            '</b><span class="s">' + s + '</span></div><strong>' + right + '</strong></div>';
        }).join('') + '</div>' + (rows.length > fit ? '<div class="more">' + (rows.length - fit) + ' more on the page</div>' : '');
      this._paint(html);
      keyOpen(this);
    }
  }
  // Enter or Space on a row marked data-more opens it, as a tap does
  function keyOpen(card) {
    if (card._keyed || !card._card) return;
    card._keyed = true;
    card._card.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
      if (!t) return;
      e.preventDefault();
      t.click();
    });
  }

  // --------------------------------------------- TIMERS: FINISHING ORDER
  // ONE LINE THROUGH NOW (2026-10-16, the user: show the timers before
  // too, and more than three): the timers that ended in the last day on the
  // left, dimmed, then a Now mark, then the running ones soonest first --
  // when each finishes and how long is left. An order, not a time scale: the
  // steps are equal. As many as the card's width holds (130 px each); the
  // running ones first, the most recent past ones in what is left. Paused
  // timers have no deadline: counted, not placed. With nothing running the
  // line is the day's timers, so the card still says something.
  // "Ended", never "finished": history cannot tell a timer that ran out from
  // one canceled.
  function timerLabel(h, t) {
    var st = h.states[t.entity] || {};
    var raw = t.label_entity ? ((h.states[t.label_entity] || {}).state || '') : '';
    var given = ['', 'unknown', 'unavailable'].indexOf(String(raw).trim()) >= 0 ? '' : String(raw).trim();
    return given || t.label || (st.attributes || {}).friendly_name || t.entity;
  }
  // the runs that ended: [{t, start, end, name}] from compressed history
  function timerRuns(list, H, h) {
    var out = [];
    list.forEach(function (t) {
      var s = pts(H[t.entity]), names = pts(t.label_entity ? H[t.label_entity] : null), start = null;
      s.forEach(function (p, i) {
        var on = p[1] === 'active' || p[1] === 'paused';
        if (on && start === null && i > 0) start = p[0];
        if (!on && start !== null) {
          // its name as it was while it ran (a quick timer's slot is renamed for each)
          var nm = null;
          names.forEach(function (q) { if (q[0] <= start + 5000) nm = q[1]; });
          var given = nm && ['unknown', 'unavailable', ''].indexOf(String(nm).trim()) < 0 ? String(nm).trim() : '';
          if (p[0] - start >= MIN) out.push({ t: t, start: start, end: p[0], name: given || t.label || nameOf(h, t.entity) });
          start = null;
        }
      });
    });
    return out.sort(function (a, b) { return a.end - b.end; });
  }
  var EV_MIN = 130;
  class HkTimersOrderCard extends HeaderCard {
    static get PART_CSS() {
      return [
        '.sub{font-size:13px;color:' + v('ink-2') + ';margin-top:6px}',
        '.tl{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-height:0}',
        '.evs{display:grid;grid-auto-flow:column;gap:18px}',
        '.ev{min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:8px}',
        '.ev.past{opacity:.55}',
        '.ev:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:3px}',
        '.ev time,.ev .in{display:block;font-size:13px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ev b{display:block;margin:4px 0;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // THE LINE: a dot per timer at its column's start -- the past ones
        // hollow, the running ones in the timers' color -- and Now between
        '.ln{position:relative;height:9px;margin-top:12px}',
        '.ln:before{content:"";position:absolute;left:0;right:0;top:4px;border-top:2px solid ' + v('line-strong') + '}',
        '.ln i{position:absolute;top:0;width:9px;height:9px;border-radius:50%;box-sizing:border-box;background:var(--tint)}',
        '.ln i.past{background:none;border:2px solid ' + v('mark') + '}',
        '.ln em{position:absolute;top:-4px;width:2px;height:17px;margin-left:-1px;background:' + v('ink') + '}',
        '.ft{position:relative;height:16px;margin-top:8px;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap}',
        '.ft span{position:absolute;top:0}',
        '.ft .nw{color:' + v('ink') + ';font-weight:600}',
        '.none{margin:auto 0;font-size:15px;color:' + v('ink-2') + '}'
      ].join('');
    }
    _list() { return (this._config || {}).timers || []; }
    _ids() {
      var out = [];
      this._list().forEach(function (t) { out.push(t.entity); if (t.label_entity) out.push(t.label_entity); });
      return out;
    }
    _render() {
      this._shell('tord');
      var h = this.client, self = this;
      if (!h) return;
      var tint = (this._config || {}).tint || P.orange, now = Date.now();
      this._card.style.setProperty('--tint', tint);
      var all = this._list().filter(function (t) { return h.states[t.entity]; });
      // THE DAY BEFORE: asked every 5 minutes, and again whenever a timer
      // starts or stops (so one that just ended joins the line at once)
      var key = all.map(function (t) { return t.entity + ':' + h.states[t.entity].state; }).join(',');
      if (this._pastKey !== key) { this._pastKey = key; if (this._at) this._at.past = 0; }
      if (all.length) {
        var pm = (this._config || {}).past, ids = this._ids().filter(function (id) {
          return h.states[id] && (!Array.isArray(pm) || !pm.length || pm.indexOf(id) >= 0 || /^input_text\./.test(id));
        });
        this._load('past', 5 * MIN, function () {
          return h.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - DAY).toISOString(),
            end_time: new Date().toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true,
            significant_changes_only: false });
        });
      }
      var run = all.filter(function (t) { return h.states[t.entity].state === 'active'; }).map(function (t) {
        var end = Date.parse((h.states[t.entity].attributes || {}).finishes_at);
        return { t: t, end: isFinite(end) ? end : null, name: timerLabel(h, t) };
      }).filter(function (x) { return x.end !== null; }).sort(function (a, b) { return a.end - b.end; });
      var paused = all.filter(function (t) { return h.states[t.entity].state === 'paused'; }).length;
      // the past is the timers people start themselves (the quick timers and
      // the House Timers: `past`), not the automations' that cycle all day
      var mine = (this._config || {}).past;
      var pastList = Array.isArray(mine) && mine.length ? all.filter(function (t) { return mine.indexOf(t.entity) >= 0; }) : all;
      var past = this._past ? timerRuns(pastList, this._past, h) : [];
      var head = '<div class="ttl"><b>Finishing Order</b><span>' + (run.length ? run.length + ' running' : 'None running') +
        (paused ? ' · ' + paused + ' paused' : '') + '</span></div>';
      if (!run.length && !past.length) {
        return this._paint(head + '<div class="none">' + (this._past || !all.length ? 'Nothing has run in the last day.' : 'Loading the day…') +
          (paused ? ' ' + paused + ' paused below.' : ' Start one here or from House Timers.') + '</div>');
      }
      var w = this._width(), fit = Math.max(1, Math.min(6, Math.floor(((w || 680) + 18) / (EV_MIN + 18))));
      var up = run.slice(0, fit), rest = run.length - up.length;
      var back = past.slice(Math.max(0, past.length - (fit - up.length)));
      if (fit - up.length <= 0) back = [];
      var shown = back.map(function (x) { return { x: x, past: true }; }).concat(up.map(function (x) { return { x: x }; }));
      var n = shown.length, cols = Math.max(n, Math.min(fit, 4));
      var left = function (x) { var ms = x.end - now; return ms < MIN ? 'Under a minute' : 'In ' + dur(ms); };
      var ago = function (x) { return 'Ran ' + dur(x.end - x.start); };
      var when = function (t) { return midnight(t) === midnight(now) ? hm(t) : dayShort(t) + ' ' + hm(t); };
      // the columns' starts, as fractions of the line: equal steps
      var at = function (i) { return 'calc(' + i + ' * (100% + 18px) / ' + cols + ')'; };
      // nothing after it: Now ends the line
      var nowAt = back.length === n ? '100%' : back.length ? 'calc(' + back.length + ' * (100% + 18px) / ' + cols + ' - 9px)' : '0px';
      var sub = run.length ? (back.length ? 'Earlier, then what finishes next' : 'What finishes next') : 'Nothing running · the last day’s timers';
      var foot = rest ? rest + ' more in Running below' : '';
      this._paint(head + '<div class="sub">' + sub + '</div><div class="tl"><div class="evs" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' +
        shown.map(function (e) {
          var x = e.x;
          return e.past
            ? '<div class="ev past" data-more="' + esc(x.t.entity) + '" role="button" tabindex="0" aria-label="' +
                esc(x.name + ', ended ' + when(x.end) + ', ' + ago(x)) + '"><time>Ended ' + when(x.end) + '</time><b>' + esc(x.name) +
                '</b><span class="in">' + ago(x) + '</span></div>'
            : '<div class="ev" data-more="' + esc(x.t.entity) + '" role="button" tabindex="0" aria-label="' +
                esc(x.name + ', finishes ' + hm(x.end) + ', ' + left(x)) + '"><time>' + hm(x.end) + '</time><b>' + esc(x.name) +
                '</b><span class="in">' + left(x) + '</span></div>';
        }).join('') + '</div><div class="ln" aria-hidden="true">' + shown.map(function (e, i) {
          return '<i class="' + (e.past ? 'past' : '') + '" style="left:' + at(i) + '"></i>';
        }).join('') + '<em style="left:' + nowAt + '"></em></div><div class="ft"><span class="nw" style="left:' + nowAt +
        ';transform:translateX(' + (back.length === n ? '-100%' : back.length ? '-50%' : '0') + ')">Now</span>' +
        (foot ? '<span style="right:0">' + foot + '</span>' : '') + '</div></div>');
      keyOpen(this);
    }
  }

  // ------------------------------------------------ TIMERS: START A TIMER
  // The six quick durations, three across, and Create a Timer -- the
  // keypad, a name and its quick names in a sheet (hk-timer-new-card,
  // `layout: sheet`). Both through the quick-timer helpers, which answer
  // whether a timer started (all four slots busy says so).
  function minsLabel(m) {
    return m < 60 ? m + ' min' : (m % 60 ? Math.floor(m / 60) + ' hr ' + (m % 60) + ' min' : (m / 60) + ' hr');
  }
  function minsHms(m) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(Math.floor(m / 60)) + ':' + p(m % 60) + ':00'; }
  class HkTimersStartCard extends HeaderCard {
    static get PART_CSS() {
      return [
        '.ttl .hk-status{margin:0;min-height:0;font-size:13px;line-height:20px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.qs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:40px;gap:10px;margin-top:14px}',
        // the 40 px capsule of the selectable pills (hk-base .pill), on the
        // card's plate as a key, not as glass of its own
        '.qk{appearance:none;font:inherit;height:40px;border-radius:' + R.capsule('40px') + ';border:1px solid ' + v('line') + ';background:' + v('key') + ';',
        '  color:' + v('ink') + ';' + C.PILL_LABEL + ';cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px;',
        '  -webkit-tap-highlight-color:transparent;transition:transform ' + C.DUR.press + ' ease}',
        '.qk:active{transform:scale(0.96);background:' + v('key-strong') + '}',
        '.qk:disabled{opacity:.45;cursor:default}',
        '.mk{display:flex;align-items:center;gap:14px;margin-top:auto;min-width:0}',
        '.mk .new{flex:none;background:' + C.SELECTED_BG + ';color:' + C.SELECTED_TEXT + ';border-color:transparent;padding:0 18px;display:flex;align-items:center;gap:6px}',
        '.mk .new hk-icon{--mdc-icon-size:18px;width:18px;height:18px;display:flex}',
        // (the hint on one line, or not at all: in a narrow card it wrapped
        // to three beside the button)
        '.mk small{font-size:13px;line-height:17px;color:' + v('ink-2') + ';min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '@container (max-width:380px){.mk small{display:none}}',
        // FLAT: set into the card, as the presets are -- stone, not a white
        // button on the ivory (DESIGN.md "Raised or set in", 2026-10-17)
        ':host([hk-flat]) .mk .new{background:' + v('key') + ';color:' + v('ink') + ';border-color:' + v('line') + '}',
        'button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
        '@media (prefers-reduced-motion: reduce){.qk,.qk:active{transition:none;transform:none}}'
      ].join('');
    }
    _ids() { return []; }
    _presets() { return ((this._config || {}).presets || [5, 10, 15, 20, 30, 60]).slice(0, 6); }
    _script(key, dflt) {
      var ent = (this._config || {})[key] || dflt;
      return ent.indexOf('.') === -1 ? ['script', ent] : ent.split('.');
    }
    _quick(m) {
      var self = this, p = this._script('quick_script', 'script.quick_timer_start'), label = minsLabel(m);
      if (!this.client.states[p.join('.')]) { this._setStatus('failed', 'The quick-timer helpers are not installed.'); return this.redraw(); }
      if (!this._begin('Starting ' + label + '…')) return;
      this._callResp(p[0], p[1], { duration: minsHms(m) }).then(function (r) {
        self._end();
        if (!r.ok) self._setStatus('failed', 'Could not reach Home Assistant.');
        else if (r.response && r.response.started === false) self._setStatus('warn', 'All four quick timers are busy.');
        else self._setStatus('sent', 'Started ' + label, 4000);
        self.redraw();
      });
    }
    _create() {
      var c = this._config || {}, D = window.hkDetail;
      if (!D || !D.open) return;
      D.open(null, { name: 'New Timer', icon: 'mdi:timer-plus-outline', icon_color: c.tint || P.orange },
        // glass: false -- the sheet is its own blur; a card in the page's
        // shared blur would have the page's layer cut to its shape and drawn
        // under the sheet as a solid box
        { cards: { cards: [{ type: 'custom:hk-timer-new-card', layout: 'sheet', glass: false, close_on_start: true, tint: c.tint,
          create_script: c.create_script || 'script.quick_timer_create', name_chips: (c.name_chips || []).slice(0, 6) }] } });
    }
    _render() {
      this._shell('tstart');
      var h = this.client, self = this;
      if (!h) return;
      var st = this._hkStatus, busy = !!this._busy;
      this._paint('<div class="ttl"><b>Start a Timer</b><div class="hk-status" role="status" aria-live="polite"' +
        (st ? ' data-kind="' + st.kind + '">' + esc(st.text) : '>') + '</div></div>' +
        '<div class="qs">' + this._presets().map(function (m) {
          return '<button class="qk" data-q="' + m + '" aria-label="Start a ' + minsLabel(m) + ' timer"' + (busy ? ' disabled' : '') + '>' + minsLabel(m) + '</button>';
        }).join('') + '</div><div class="mk"><button class="qk new" data-new><hk-icon icon="mdi:plus"></hk-icon>Create a Timer</button>' +
        '<small>Choose a name &amp; duration</small></div>');
      if (!this._wired) {
        this._wired = true;
        this._card.addEventListener('click', function (e) {
          var b = e.target && e.target.closest ? e.target.closest('button') : null;
          if (!b || b.disabled) return;
          if (b.hasAttribute('data-new')) self._create();
          else if (b.hasAttribute('data-q')) self._quick(+b.getAttribute('data-q'));
        });
      }
    }
  }

  // ------------------------------------------ WATER: THROUGH THE DAY
  // The water meter Home Assistant's Energy settings name (energy/get_prefs,
  // its water sources), hour by hour since midnight from the recorder's
  // statistics; this hour so far from its five-minute statistics. An hour
  // with no statistic is "No reading", never zero. Against yesterday to
  // the same time, when yesterday's hours are all there. No meter: no card.
  // `meter:` (HK Settings -> Pages -> Water) names one instead.
  var WATER = { src: null, wait: null };
  function waterSources(card, h) {
    if (WATER.src) return WATER.src;
    if (!WATER.wait && h.callWS) {
      WATER.wait = h.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
        var ids = [];
        ((pr && pr.energy_sources) || []).forEach(function (s) { if (s.type === 'water' && s.stat_energy_from) ids.push(s.stat_energy_from); });
        WATER.src = { ids: ids };
      }, function () { WATER.src = { ids: [] }; }).then(function () { WATER.wait = null; card.redraw(); });
    }
    return null;
  }
  function amount(x) { return x < 10 ? (Math.round(x * 10) / 10).toString() : Math.round(x).toLocaleString(window.hkLocale.numTag()); }
  class HkWaterDayCard extends HeaderCard {
    static get PART_CSS() {
      return BARS_CSS + [
        ':host([hidden]){display:none}',
        '.tot{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-top:10px;flex:none;min-width:0}',
        '.tot .big{cursor:pointer}',
        '.cmp{font-size:13px;line-height:18px;color:' + v('ink-2') + ';text-align:right}',
        '.grow{flex:1;min-height:6px}'
      ].join('');
    }
    _ids() { return []; }
    _render() {
      this._shell('wday');
      var h = this.client;
      if (!h) return;
      var head = '<div class="ttl"><b>Water Through the Day</b><span>Hourly</span></div>';
      // a meter chosen on HK Settings -> Pages -> Water wins over the
      // Energy settings' own
      var own = (this._config || {}).meter;
      var src = own ? { ids: [own] } : waterSources(this, h);
      if (!src) return this._paint(head + '<div class="wait">Loading today…</div>');
      var ids = src.ids.filter(function (id) { return h.states[id] || /:/.test(id); });
      this.toggleAttribute('hidden', !ids.length);
      if (!ids.length) return this._paint('');
      var S = window.hkStats;
      if (!S) return this._paint(head + '<div class="wait">Loading today…</div>');
      var hr48 = S.hourly(h, ids, 48, this), fm = S.fiveMinute(h, ids, 13, this, { type: 'change' });
      if (!hr48) return this._paint(head + '<div class="wait">Loading today…</div>');
      var sum = function (series, i) {
        var got = false, t = 0;
        ids.forEach(function (id) { var r = series[id] && series[id][i]; if (r && r.v != null) { got = true; t += r.v; } });
        return got ? t : null;
      };
      var first = hr48[ids[0]] || [], n = first.length, now = Date.now();
      // today's hours: from the bucket at HA's midnight to the one we are in
      var start = -1;
      for (var i = n - 1; i >= 0; i--) { if (S.fields(first[i].t).hour === 0) { start = i; break; } }
      if (start < 0) start = Math.max(0, n - 24);
      var today = [], yday = [];
      for (var j = start; j < n; j++) today.push({ t: first[j].t, v: sum(hr48, j) });
      for (var y = Math.max(0, start - 24); y < start; y++) yday.push({ t: first[y].t, v: sum(hr48, y) });
      // the open hour: its closed five-minute buckets
      var cur = today[today.length - 1], hourStart = +cur.t, part = null;
      if (fm) {
        var f0 = fm[ids[0]] || [];
        f0.forEach(function (r, k) {
          if (+r.t < hourStart) return;
          var x = sum(fm, k);
          if (x != null) part = (part || 0) + x;
        });
      }
      cur.v = part;
      cur.open = true;
      var nowK = today.length - 1;
      var got = today.filter(function (x) { return x.v != null; });
      var tot = got.reduce(function (a, x) { return a + x.v; }, 0);
      var st0 = h.states[ids[0]], unit = (st0 && st0.attributes.unit_of_measurement) || '';
      // yesterday to this minute: its whole hours before this one, and the
      // same part of this hour
      var cmp = '';
      var frac = Math.min(1, (now - hourStart) / HOUR);
      if (yday.length >= nowK + 1 && yday.slice(0, nowK + 1).every(function (x) { return x.v != null; })) {
        var yv = yday.slice(0, nowK).reduce(function (a, x) { return a + x.v; }, 0) + yday[nowK].v * frac;
        if (yv > 0.5) {
          var pct = Math.round((tot - yv) / yv * 100);
          cmp = Math.abs(pct) < 5 ? 'About the same as<br>yesterday at this time'
            : Math.abs(pct) + '% ' + (pct < 0 ? 'below' : 'above') + ' yesterday<br>at this time';
        }
      }
      var B = bars(today.map(function (x, k) {
        var hr = S.fields(x.t).hour;
        return { segs: [{ v: x.v || 0, c: COOL }], fut: x.v == null, label: HOUR_LABELS[hr], now: k === nowK };
      }).concat(Array.apply(null, Array(Math.max(0, 24 - today.length))).map(function (_, k) {
        var hr = (S.fields(cur.t).hour + k + 1) % 24;
        return { segs: [{ v: 0, c: COOL }], fut: true, label: HOUR_LABELS[hr] };
      })), Math.max(120, this._width()), 56, true);
      this._nBars = 24;
      this._nowI = nowK;
      this._rdRest = 'Hover or touch an hour for its water';
      this._paint(head + '<div class="tot"><div class="big num" data-more="' + esc(/:/.test(ids[0]) ? '' : ids[0]) + '">' + amount(tot) +
        '<u>' + esc(unit) + ' today</u></div>' + (cmp ? '<div class="cmp">' + cmp + '</div>' : '') + '</div><div class="grow"></div>' +
        '<div class="bc">' + B.html + '</div><div class="rd">' + this._rdRest + '</div>');
      hourScrub(this, this._card.querySelector('.bc'), function (k) {
        var x = today[k], lab;
        if (!x) { var hr = (S.fields(cur.t).hour + (k - nowK)) % 24; return (hr % 12 || 12) + ' ' + (hr < 12 ? 'AM' : 'PM') + ' · Not yet'; }
        var hh = S.fields(x.t).hour;
        lab = (hh % 12 || 12) + ' ' + (hh < 12 ? 'AM' : 'PM');
        if (x.open) return lab + ' so far · ' + (x.v == null ? 'No reading yet' : amount(x.v) + ' ' + unit);
        return lab + ' · ' + (x.v == null ? 'No reading' : amount(x.v) + ' ' + unit);
      }, 'Water by hour');
    }
  }

  // ------------------------------------------- WATER: THE MAIN SUPPLY
  // The supply valve from above: a fine ring, its ports, and a quarter-turn
  // handle -- along the pipe when open, across it when closed -- beside the
  // state in words, and the On / Off control under them. Behind the whole
  // card, while the supply is confirmed open, three translucent waves drift
  // across each other: a sign the supply is on, never a measure of flow.
  // Opening, closing, unknown and unavailable are said as they are; the
  // waves wait for Home Assistant to confirm Open. A change asks first.
  // The water's colors are the card's art (DESIGN.md rule 4), named here.
  var WAVES = { back: '#9ae1eb', middle: '#42a8d6', front: '#238fb9', wash: 'linear-gradient(155deg,rgba(69,152,183,0.04),rgba(36,138,192,0.14))' };
  var WAVE_PATHS = [
    ['back', 'M0 120C100 120 120 64 240 64S440 120 600 120C700 120 720 64 840 64S1040 120 1200 120V240H0Z'],
    ['middle', 'M0 95C100 95 180 143 300 143S500 95 600 95C700 95 780 143 900 143S1100 95 1200 95V240H0Z'],
    ['front', 'M0 110C100 110 160 75 300 75S480 110 600 110C700 110 760 75 900 75S1080 110 1200 110V240H0Z']];
  var PENDING_MS = 90e3;
  function supplyState(st) {
    if (!st) return 'unavailable';
    var s = st.state, d = st.entity_id.split('.')[0];
    if (d === 'switch' || d === 'input_boolean') return s === 'on' ? 'open' : s === 'off' ? 'closed' : s === 'unavailable' ? 'unavailable' : 'unknown';
    return { open: 'open', closed: 'closed', opening: 'opening', closing: 'closing', unavailable: 'unavailable' }[s] || 'unknown';
  }
  class HkWaterSupplyCard extends HeaderCard {
    static get PART_CSS() {
      var E = C.EASE, U = C.DUR;
      return [
        'hk-plate.hd.supply{position:relative;isolation:isolate}',
        '.wash{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;border-radius:inherit;background:' + WAVES.wash + ';',
        '  opacity:0;transition:opacity ' + U.standard + ' ' + E.standard + '}',
        '.on .wash{opacity:1}',
        '.wave{position:absolute;top:0;left:0;width:200%;height:100%;max-width:none;animation:hkw-drift 25s linear infinite;animation-play-state:paused}',
        '.wave.back{fill:' + WAVES.back + ';opacity:.14;animation-duration:31s;animation-delay:-7s}',
        '.wave.middle{fill:' + WAVES.middle + ';opacity:.19;animation-duration:25s;animation-direction:reverse;animation-delay:-16s}',
        '.wave.front{fill:' + WAVES.front + ';opacity:.16;animation-duration:21s;animation-delay:-3s}',
        '.on:not(.still) .wave{animation-play-state:running;will-change:transform}',
        '@keyframes hkw-drift{to{transform:translateX(-50%)}}',
        '.fg{position:relative;z-index:1;display:flex;flex-direction:column;flex:1;min-height:0}',
        '.ttl .hk-status{margin:0;min-height:0;font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.sc{display:grid;grid-template-columns:88px minmax(0,1fr);gap:20px;align-items:center;margin-top:12px;cursor:pointer}',
        '.vi{width:88px;height:88px;overflow:hidden}',
        '.vi svg{display:block;width:88px;height:88px}',
        '.vi .ring{fill:none;stroke:' + v('mark') + ';stroke-width:1}',
        '.vi .port{stroke:' + v('glyph') + ';stroke-opacity:.6;stroke-width:2;stroke-linecap:round}',
        '.vi .tick{stroke:' + v('mark') + ';stroke-width:1}',
        '.vi .hub{fill:' + v('key') + ';stroke:' + v('line-strong') + ';stroke-width:1}',
        '.vi .hd{transform-box:view-box;transform-origin:44px 44px;transform:rotate(-90deg);transition:transform ' + U.standard + ' ' + E.standard + '}',
        '.vi .hd path{stroke:' + v('glyph') + ';stroke-width:4;stroke-linecap:round}',
        '.vi .hd circle{fill:' + v('key-strong') + ';stroke:' + v('glyph') + ';stroke-width:2}',
        '.open .vi .hd{transform:rotate(0deg)}',
        '.open .vi .hd path,.open .vi .hd circle{stroke:' + WAVES.back + '}',
        '.moving .vi .hd{transform:rotate(-45deg)}',
        '.lost .vi .hd{opacity:0}',
        '.vw{min-width:0}',
        '.vw strong{display:block;' + C.figureCss('figure') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vw small{display:flex;align-items:center;gap:7px;margin-top:6px;font-size:13px;line-height:18px;color:' + v('ink-2') + '}',
        '.vw small i{width:6px;height:6px;border-radius:50%;flex:none;background:' + v('mark') + '}',
        '.open .vw small i{background:' + WAVES.back + '}',
        // THE TWO-POSITION CONTROL: the segmented control's well, its
        // selected half the shared near-white
        '.sw{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin-top:auto;border-radius:' + R.capsule('48px') + ';',
        '  background:' + v('key') + ';border:1px solid ' + v('line') + '}',
        '.sw button{appearance:none;font:inherit;height:38px;border:0;border-radius:' + R.capsule('38px') + ';background:none;color:' + v('ink') + ';',
        '  ' + C.PILL_LABEL + ';cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color ' + U.fade + ' ease}',
        '.sw button[aria-pressed="true"]{background:' + C.SELECTED_BG + ';color:' + C.SELECTED_TEXT + '}',
        '.sw button:disabled{cursor:default;color:' + v('ink-3') + '}',
        '.sw button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
        '@media (prefers-reduced-motion: reduce){',
        '  .wave{animation:none!important;will-change:auto}',
        '  .wash,.vi .hd,.sw button{transition:none}}'
      ].join('');
    }
    _ids() { var c = this._config || {}; return c.entity ? [c.entity] : []; }
    _sigOf() { return super._sigOf() + '|' + (this._pend ? this._pend.to : '') + '|' + (this._hkStatus ? this._hkStatus.text : '') + '|' + !!this._busy; }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._io) { this._io.disconnect(); this._io = null; }
      clearTimeout(this._pendT);
    }
    // PAUSED OFF SCREEN: the waves run only while the card can be seen
    _watch() {
      if (this._io || typeof IntersectionObserver !== 'function' || !this._card) return;
      var self = this;
      this._io = new IntersectionObserver(function (en) {
        self._card.classList.toggle('still', !en[en.length - 1].isIntersecting);
      });
      this._io.observe(this._card);
    }
    _send(open) {
      var self = this, id = this._config.entity, d = id.split('.')[0];
      var svc = d === 'valve' ? (open ? 'open_valve' : 'close_valve') : (open ? 'turn_on' : 'turn_off');
      if (!this._begin(open ? 'Opening…' : 'Closing…')) return;
      this._pend = { to: open ? 'open' : 'closed', at: Date.now() };
      clearTimeout(this._pendT);
      this._pendT = setTimeout(function () {
        if (!self._pend) return;
        self._pend = null;
        self._setStatus('warn', 'The valve has not answered');
        self.redraw();
      }, PENDING_MS);
      this._call(d === 'valve' ? 'valve' : 'homeassistant', d === 'valve' ? svc : svc, { entity_id: id }).then(function (ok) {
        self._end();
        if (!ok) {
          self._pend = null;
          clearTimeout(self._pendT);
          self._setStatus('failed', 'Could not reach Home Assistant');
        } else self._setStatus(null);
        self.redraw();
      });
    }
    _ask(open) {
      var self = this, name = (this._config && this._config.name) || 'the main water supply';
      if (C.confirmSheet) {
        C.confirmSheet(open ? 'Turn ' + name + ' back on?' : 'Shut off ' + name + '?', function () { self._send(open); },
          { yes: open ? 'Turn On' : 'Shut Off', destructive: !open,
            detail: open ? 'Water will flow to the house again.' : 'No water will reach the house until it is turned back on.' });
      } else this._send(open);
    }
    _render() {
      this._shell('supply');
      var h = this.client, c = this._config || {}, self = this;
      if (!h) return;
      var st = h.states[c.entity], s = supplyState(st);
      // a command sent and not yet answered: said as on its way, until the
      // valve reports where it is
      if (this._pend && (s === this._pend.to || Date.now() - this._pend.at > PENDING_MS)) { this._pend = null; clearTimeout(this._pendT); }
      var pend = this._pend, show = pend && s !== 'opening' && s !== 'closing' ? (pend.to === 'open' ? 'opening' : 'closing') : s;
      var WORD = { open: ['Open', 'Supply enabled'], closed: ['Closed', 'Supply shut off'],
                   opening: ['Opening…', pend ? 'Sent · waiting for the valve' : 'Waiting for the valve'],
                   closing: ['Closing…', pend ? 'Sent · waiting for the valve' : 'Waiting for the valve'],
                   unknown: ['Unknown', 'The valve has not reported'], unavailable: ['Unavailable', 'Can’t reach the valve'] }[show];
      var cls = (show === 'open' ? 'open on' : show === 'closed' ? 'closed' : show === 'unavailable' || show === 'unknown' ? 'lost' : 'moving');
      this._card.className = 'hd supply ' + cls + (this._card.classList.contains('still') ? ' still' : '') + (this._card.classList.contains('anim') ? ' anim' : '');
      var off = s === 'unavailable' || !!pend || !!this._busy, stt = this._hkStatus;
      var title = c.title || 'Main Water Supply';
      this._paint('<div class="wash" aria-hidden="true">' + WAVE_PATHS.map(function (p) {
          return '<svg class="wave ' + p[0] + '" viewBox="0 0 1200 240" preserveAspectRatio="none" focusable="false"><path d="' + p[1] + '"/></svg>';
        }).join('') + '</div>' +
        '<div class="fg"><div class="ttl"><b>' + esc(title) + '</b><div class="hk-status" role="status" aria-live="polite"' +
        (stt && stt.kind !== 'pending' ? ' data-kind="' + stt.kind + '">' + esc(stt.text) : '>') + '</div></div>' +
        '<div class="sc" data-more="' + esc(c.entity) + '"><div class="vi"><svg viewBox="0 0 88 88" role="img" aria-label="' +
        (show === 'open' ? 'Valve handle along the pipe: open' : show === 'closed' ? 'Valve handle across the pipe: closed' : 'Valve position not confirmed') + '">' +
        '<circle class="ring" cx="44" cy="44" r="34"/><path class="port" d="M2 44H17M71 44H86"/><path class="tick" d="M44 5V9M44 79V83"/>' +
        '<circle class="hub" cx="44" cy="44" r="22"/><g class="hd"><path d="M24 44H64"/><circle cx="44" cy="44" r="4"/></g></svg></div>' +
        '<div class="vw"><strong>' + WORD[0] + '</strong><small><i></i>' + WORD[1] + '</small></div></div>' +
        '<div class="sw" role="group" aria-label="' + esc(title) + '">' +
        '<button data-v="off" aria-pressed="' + (s === 'closed') + '"' + (off ? ' disabled' : '') + '>Off</button>' +
        '<button data-v="on" aria-pressed="' + (s === 'open') + '"' + (off ? ' disabled' : '') + '>On</button></div></div>');
      this._watch();
      if (!this._wired) {
        this._wired = true;
        this._card.addEventListener('click', function (e) {
          var b = e.target && e.target.closest ? e.target.closest('.sw button') : null;
          if (!b || b.disabled) return;
          var want = b.getAttribute('data-v') === 'on', now = supplyState((self.client || {}).states[self._config.entity]);
          if ((want && now === 'open') || (!want && now === 'closed')) return;
          self._ask(want);
        });
      }
    }
  }

  // ------------------------------------------------------------ register
  var HEIGHT = [{ name: 'height', selector: { text: {} } }];
  register('hk-climate-runtime-card', HkClimateRuntimeCard, 'HK Heating & Cooling Today',
    'Each thermostat’s heating and cooling today, hour by hour (the Climate page’s header).',
    [{ name: 'thermostats', selector: { entity: { multiple: true, filter: { domain: 'climate' } } } }].concat(HEIGHT),
    function (client) { return { thermostats: Object.keys(client.states).filter(function (id) { return id.indexOf('climate.') === 0; }).slice(0, 3) }; });
  register('hk-climate-outside-card', HkClimateOutsideCard, 'HK Outside & Ahead',
    'The weather now, today’s high and low, the next hours and the evening ahead (the Climate page’s header).',
    [{ name: 'weather', selector: { entity: { filter: { domain: 'weather' } } } }].concat(HEIGHT), function () { return {}; });
  register('hk-lights-day-card', HkLightsDayCard, 'HK Lighting Through the Day',
    'The rooms lit longest today (the Lights page’s header). Rooms: [{name, lights: [ids]}].',
    [{ name: 'rooms', selector: { object: {} } }].concat(HEIGHT), function () { return { rooms: [] }; });
  register('hk-lights-tonight-card', HkLightsTonightCard, 'HK Left On & Tonight',
    'Lights on in empty rooms, and what the lighting automations do next (the Lights page’s header).',
    [{ name: 'rooms', selector: { object: {} } }].concat(HEIGHT), function () { return { rooms: [] }; });
  register('hk-security-overview-card', HkSecurityOverviewCard, 'HK Your Home',
    'The house with its ways in, today’s activity and Device Care (the Security page’s header).',
    [{ name: 'alarm', selector: { entity: { filter: { domain: 'alarm_control_panel' } } } },
     { name: 'locks', selector: { entity: { multiple: true, filter: { domain: 'lock' } } } },
     { name: 'doors', selector: { entity: { multiple: true, filter: { domain: 'binary_sensor' } } } },
     { name: 'garage', selector: { entity: { multiple: true, filter: { domain: ['cover', 'binary_sensor'] } } } },
     { name: 'art', selector: { text: {} } }], function () { return {}; });

  var VACS = [{ name: 'vacuums', selector: { object: {} } }].concat(HEIGHT);
  register('hk-vacuum-week-card', HkVacuumWeekCard, 'HK Cleaning This Week',
    'How long the vacuums cleaned each of the last seven days (the Vacuums page’s header). Vacuums: [{entity, success, failed, canceled, error}].',
    VACS, function () { return { vacuums: [] }; });
  register('hk-vacuum-last-card', HkVacuumLastCard, 'HK Last Completed',
    'Each vacuum’s latest run and how it ended (the Vacuums page’s header).', VACS, function () { return { vacuums: [] }; });
  register('hk-timers-order-card', HkTimersOrderCard, 'HK Finishing Order',
    'The running timers, soonest first (the Timers page’s header). Timers: [{entity, label, label_entity}].',
    [{ name: 'timers', selector: { object: {} } }].concat(HEIGHT), function () { return { timers: [] }; });
  register('hk-timers-start-card', HkTimersStartCard, 'HK Start a Timer',
    'Six quick timers and Create a Timer, through the quick-timer helpers (the Timers page’s header).',
    [{ name: 'presets', selector: { object: {} } }, { name: 'name_chips', selector: { object: {} } }].concat(HEIGHT), function () { return {}; });
  register('hk-water-day-card', HkWaterDayCard, 'HK Water Through the Day',
    'The Energy settings’ water meter, hour by hour today (the Water page’s header).', HEIGHT, function () { return {}; });
  register('hk-water-supply-card', HkWaterSupplyCard, 'HK Main Water Supply',
    'The main water valve: its position, On / Off, and water behind the card while it is open (the Water page’s header).',
    [{ name: 'entity', selector: { entity: { filter: { domain: ['valve', 'switch'] } } } }, { name: 'title', selector: { text: {} } }].concat(HEIGHT),
    function (client) { return { entity: Object.keys(client.states).filter(function (id) { return id.indexOf('valve.') === 0; })[0] }; });

  window.hkHeaders = { version: '1.0.0', vacRuns: vacRuns, supplyState: supplyState, timerRuns: timerRuns, nextTime: nextTime, goneQuiet: goneQuiet, kindOf: kindOf, rowGlyph: rowGlyph, waysIn: waysIn, wayState: wayState, bars: bars, spans: spans, merge: merge,
    // tests: a picture's art.json as if fetched, and the schedule as if sent
    __art: function (base, j) { ARTS[base] = { data: j }; },
    __schedule: function (d) { SCHED.data = d; SCHED.cards.forEach(function (c) { c.redraw(); }); },
    // the automation sheet: an automation's next run from the same schedule
    schedule: function (card, h) { return schedule(card, h); }, unschedule: function (card) { SCHED.cards.delete(card); } };
  });
})();

// ======================================================== THE AUTOMATION SHEET
// THE AUTOMATION SHEET (hk-detail.js kind `automation`, 2026-10-16): what a
// tap on an automation opens -- Tonight's rows on the Lights page, a tile --
// in place of Home Assistant's dialog. One column, the standard sheet:
//   Run Now        runs its actions now (automation.trigger: its conditions
//                  skipped, as Home Assistant's own Run does)
//   On / Off Today / Off
//                  Off Today is off until midnight and on again by itself
//                  (snooze.py: kept through a restart; turning it on or off
//                  by hand ends it)
//   Last Run / Next Run
//                  its last_triggered; the next run from the Lights page's
//                  schedule (page_headers.py) when one falls in the next 16 h
//   History        the last 7 days from the logbook: each run and what set it
//                  off, and each time it was turned on or off
(function () {
  'use strict';
  function whenDetail(fn) {
    if (window.hkDetail && window.hkDetail._) return fn(window.hkDetail);
    window.addEventListener('hk-detail-ready', function () { if (window.hkDetail) fn(window.hkDetail); }, { once: true });
  }
  whenDetail(function (X) {
    if (customElements.get('hk-detail-automation')) return;
    var U = X._, C = window.hkCards, esc = C.esc, SP = U.SP, v = C.v;
    var DAY = 864e5, WEEK = 7 * DAY;
    function hm(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
    function dayWord(t) {
      var d = new Date(t), m = new Date(); m.setHours(0, 0, 0, 0);
      var diff = Math.round((m - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
      return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff === -1 ? 'Tomorrow' :
        d.toLocaleDateString([], diff < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' });
    }
    function when(t) { return dayWord(t) + ', ' + hm(t); }
    // "Lighting - Front Yard - Scheduled Exterior Lights" (the house's naming,
    // Group - Area - Description): the description is its name, the area its line
    function parts(name) {
      var p = String(name || '').split(/\s+-\s+/);
      return p.length >= 3 ? { name: p.slice(2).join(' - '), sub: p[1] + ' · ' + p[0] } :
        p.length === 2 ? { name: p[1], sub: p[0] } : { name: p[0], sub: '' };
    }
    // the logbook's "triggered by state of binary_sensor.x" -> "Front Door";
    // "triggered by time" -> "Time"; "triggered by Sun event sunset" -> "Sunset"
    function cause(h, msg) {
      var m = String(msg || '').replace(/^triggered by\s*/i, '');
      var ent = /(?:state of|numeric state of|event)\s+([a-z_]+\.[a-z0-9_]+)/i.exec(m);
      if (ent && h.states[ent[1]]) return (h.states[ent[1]].attributes || {}).friendly_name || ent[1];
      var sun = /sun(?:\s+event)?\s+(sunset|sunrise)/i.exec(m);
      if (sun) return sun[1][0].toUpperCase() + sun[1].slice(1);
      if (/^action run$/i.test(m) || /^service/i.test(m)) return 'Run by hand';
      m = m.replace(/^(state|time pattern|time|event) (of )?/i, function (a, b) { return b.charAt(0).toUpperCase() + b.slice(1) + (a.trim() === b ? '' : ' '); });
      return m ? m.charAt(0).toUpperCase() + m.slice(1) : '';
    }
    var SNOOZE = { until: {}, sub: null, n: 0, panels: new Set() };
    function snoozed(panel, h) {
      SNOOZE.panels.add(panel);
      var port = !SNOOZE.sub && h ? window.hkCards.subscriptions(h) : null;
      if (port) {
        SNOOZE.sub = port.subscribeMessage(function (m) {
          SNOOZE.until = (m && m.until) || {}; SNOOZE.n++;
          SNOOZE.panels.forEach(function (p) { p._kick(); });
        }, { type: 'hk_frontend/snooze/subscribe' }).catch(function () { SNOOZE.sub = null; return null; });
      }
      return SNOOZE.until;
    }

    var CSS = [
      ':host{display:block;color:' + v('ink') + '}',
      // the sheet's height filled (hkFill): the history takes what is left, and scrolls
      ':host(.fill){display:flex;flex-direction:column}',
      ':host(.fill) > div{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.ap{display:flex;flex-direction:column;gap:' + SP.block + 'px;flex:1;min-height:0}',
      '.ap > *{flex:none}',
      '.ap > .hist{flex:1 1 auto;min-height:150px;display:flex;flex-direction:column}',
      '.card{border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:' + SP.cardPad + ';min-width:0}',
      '.lab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;' + C.labelCss('label') + ';line-height:16px;margin-bottom:0}',
      '.lab .n{text-transform:none;letter-spacing:0;font-weight:500}',
      // Run Now: the sheets' one wide button
      '.run{appearance:none;font:inherit;width:100%;height:50px;border:0;border-radius:25px;background:#fff;color:#1c1c1e;',
      '  font-size:17px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.run hk-icon{--mdc-icon-size:20px}',
      '.run:active{opacity:.8}',
      '.run.sent{background:' + C.PALETTE.icon.green + ';color:#fff}',
      C.segCss('.seg', { on: '.sel', fill: true }),
      '.note{font-size:13px;line-height:18px;color:' + v('ink-2') + ';margin-top:8px;padding:0 ' + SP.inset + 'px;min-height:18px}',
      // Last Run | Next Run
      '.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:' + SP.block + 'px}',
      '.two .x{font-size:17px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.two .k{' + C.labelCss('label-small') + '}',
      '.two .s{font-size:13px;line-height:18px;color:' + v('ink-2') + ';margin-top:2px}',
      // the history rows
      // (its edges: the sheet's shadows, BASE_CSS .hk-edge -- was a fade)
      '.hsf{margin-top:4px;flex:1 1 0}',
      '.hs{flex:1 1 0;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
      '.hs::-webkit-scrollbar{display:none}',
      '.r{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 0;border-top:1px solid ' + v('line') + '}',
      '.r:first-child{border-top:0}',
      '.r hk-icon{--mdc-icon-size:18px}',
      '.r b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.r span{display:block;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.r time{font-size:13px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.none{font-size:15px;color:' + v('ink-2') + ';padding:8px 0}'
    ].join('');

    class AutomationPanel extends U.Panel {
      static get CSS() { return U.PANEL_CSS + CSS; }
      hkWidthKind() { return 'automation'; }
      hkNoGear() { return true; }
      hkFill() { return true; }
      // the header: the robot, lit while it is on; its description for a name
      hkHead(h, d) {
        var s = h.states[d.id];
        if (!s) return false;
        var on = s.state === 'on';
        d.well.style.background = on ? C.PALETTE.icon.blue : 'rgba(255,255,255,0.12)';
        d.icon.style.color = on ? '#fff' : C.PALETTE.icon.blue;
        d.icon.icon = on ? 'mdi:robot' : 'mdi:robot-off';
        d.tt.textContent = parts((s.attributes || {}).friendly_name || d.id).name;
        return true;
      }
      _kick() { this._hkSig = null; if (this.client) super.redraw(); }
      _sigOf() {
        var s = this._stateObj;
        return s ? s.last_updated + '|' + SNOOZE.n + '|' + (this._logN || 0) + '|' + (this._sent ? 1 : 0) + '|' + Math.floor(Date.now() / 60e3) : null;
      }
      connectedCallback() { if (super.connectedCallback) super.connectedCallback(); this._log = null; }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        SNOOZE.panels.delete(this);
        if (window.hkHeaders && window.hkHeaders.unschedule) window.hkHeaders.unschedule(this);
        clearTimeout(this._sentT);
      }
      redraw() { this._kick(); }
      // the choice marked, its white sliding over from the one before
      _pick(m) {
        var root = this._root, was = root.querySelector('.seg button.sel');
        if (was && was.getAttribute('data-m') === m) return;
        var from = was && C.segBox ? C.segBox(was) : null;
        root.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-m') === m); });
        var now = root.querySelector('.seg button.sel');
        if (was && now && C.slideSeg) C.slideSeg(now, from);
      }
      // the logbook's last week, read once a sheet (and again after a run)
      _history() {
        var h = this.client, self = this;
        if (this._log || !h || !h.callWS) return;
        this._log = [];
        var now = Date.now();
        h.callWS({ type: 'logbook/get_events', entity_ids: [this._id],
                   start_time: new Date(now - WEEK).toISOString(), end_time: new Date(now + 60e3).toISOString() })
          .then(function (rows) {
            self._log = (rows || []).map(function (r) {
              var t = (typeof r.when === 'number' ? r.when * 1000 : Date.parse(r.when));
              return { t: t, msg: r.message || '', st: r.state || null, by: r.context_user_id ? 'by someone' : '' };
            }).filter(function (r) { return isFinite(r.t); }).sort(function (a, b) { return b.t - a.t; });
            self._logN = (self._logN || 0) + 1; self._kick();
          }).catch(function () { self._log = []; self._logN = (self._logN || 0) + 1; self._kick(); });
      }
      _render() {
        var h = this.client, s = this._stateObj, self = this;
        if (!h || !s) return;
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="ap"><button class="run"></button><div><div class="seg">' +
            '<button data-m="on">On</button><button data-m="today">Off Today</button><button data-m="off">Off</button></div><div class="note"></div></div>' +
            '<div class="card when"></div><div class="card hist"></div></div>';
          this._root.querySelector('.run').addEventListener('click', function () {
            self._svc('automation', 'trigger', { skip_condition: true });
            self._sent = true; self._kick();
            clearTimeout(self._sentT);
            self._sentT = setTimeout(function () { self._sent = false; self._log = null; self._kick(); }, 2500);
          });
          this._root.querySelector('.seg').addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button[data-m]') : null;
            if (!b) return;
            var m = b.getAttribute('data-m'), paused = !!SNOOZE.until[self._id];
            if (m === 'on') { if (paused) self._call('hk_frontend', 'resume_automation', { entity_id: self._id }); else self._svc('automation', 'turn_on'); }
            else if (m === 'today') self._call('hk_frontend', 'pause_automation', { entity_id: self._id });
            else self._svc('automation', 'turn_off');
            self._pick(m);
          });
        }
        this._history();
        var until = snoozed(this, h)[this._id], on = s.state === 'on', na = this._na(s);
        var mode = on ? 'on' : until ? 'today' : 'off';
        var run = this._root.querySelector('.run');
        run.classList.toggle('sent', !!this._sent);
        run.innerHTML = this._sent ? '<hk-icon icon="hk:check-bold"></hk-icon>Running' : '<hk-icon icon="mdi:play"></hk-icon>Run Now';
        this._pick(mode);
        var p = parts((s.attributes || {}).friendly_name);
        this._root.querySelector('.note').textContent = na ? 'Unavailable' :
          mode === 'today' ? 'Back on ' + (Date.parse(until) - Date.now() < DAY ? 'at midnight' : when(Date.parse(until))) :
          mode === 'off' ? 'Off until it is turned on again' : (p.sub || 'Runs when it is set off');
        // last and next
        var last = Date.parse((s.attributes || {}).last_triggered);
        var S = window.hkHeaders && window.hkHeaders.schedule ? window.hkHeaders.schedule(this, h) : null, next = null, nextE = null, now = Date.now();
        ((S && S.lights && S.lights.schedule) || []).forEach(function (e) {
          if (e.automation !== self._id) return;
          var t = window.hkHeaders.nextTime(h, e, now);
          if (t !== null && (next === null || t < next)) { next = t; nextE = e; }
        });
        var whenH = '<div class="lab"><span>Runs</span></div><div class="two">' +
          '<div><div class="k">Last Run</div><div class="x">' + (isFinite(last) ? esc(hm(last)) : 'Never') + '</div>' +
            (isFinite(last) ? '<div class="s">' + esc(dayWord(last)) + '</div>' : '') + '</div>' +
          '<div><div class="k">Next Run</div><div class="x">' + (next !== null && on ? esc(hm(next)) : '—') + '</div>' +
            '<div class="s">' + (next !== null && on ? esc(dayWord(next) + (nextE.kind === 'sun' ? ' · ' + nextE.event : '') + (nextE.ready === false ? ' · if its conditions hold' : '')) :
              on ? 'When it is set off' : 'Not while off') + '</div></div></div>';
        C.morph(this._root.querySelector('.when'), whenH);
        // history
        var log = this._log;
        var runs = (log || []).filter(function (r) { return !r.st; }).length;
        var rows = (log || []).slice(0, 60).map(function (r) {
          var ran = !r.st, ic = ran ? 'mdi:play-circle' : r.st === 'on' ? 'mdi:robot' : 'mdi:robot-off';
          var col = ran ? C.PALETTE.icon.blue : v('ink-2');
          // a run: what set it off; else what was done to it
          var what = ran ? cause(h, r.msg) || 'Ran' : r.st === 'on' ? 'Turned On' : r.st === 'off' ? 'Turned Off' : r.st;
          return '<div class="r"><hk-icon icon="' + ic + '" style="color:' + col + '"></hk-icon><div><b>' + esc(what) + '</b></div>' +
            '<time>' + esc(when(r.t)) + '</time></div>';
        }).join('');
        C.morph(this._root.querySelector('.hist'), '<div class="lab"><span>Past 7 Days</span>' +
          (log && log.length ? '<span class="n">' + runs + (runs === 1 ? ' run' : ' runs') + '</span>' : '') + '</div>' +
          (log === null || (log && !log.length && !this._logN) ? '<div class="none">Reading the logbook…</div>' :
           rows ? '<div class="hk-edge hsf"><div class="hs">' + rows + '</div></div>' : '<div class="none">It has not run in the past 7 days.</div>'));
      }
    }
    U.def('hk-detail-automation', AutomationPanel);
  });
})();

// ============================================================ THE TIMER SHEET
// THE TIMER SHEET (hk-detail.js kind `timer`, 2026-10-16): what a tap on a
// timer opens -- the Timers page's Finishing Order, its running cards, a
// House Timer's tile -- in place of Home Assistant's dialog. The vacuum
// sheet's shape, the standard sheet:
//   the dial      the time left, read from the deadline (hk-timers.js
//                 <hk-countdown>, which also hands the ring its fraction), and
//                 when it ends; paused, the time it holds; idle, its length
//   the commands  Pause / Resume, +5 min, Restart, Finish -- as the running
//                 card's -- or Start when it is idle. Finish, not Cancel: it
//                 fires the timer's finished event, so what it was for happens
//   Past 7 Days   each run from the history: how long it ran, when it ended
//                 ("ended", never "finished": history cannot tell which)
(function () {
  'use strict';
  function whenDetail(fn) {
    if (window.hkDetail && window.hkDetail._) return fn(window.hkDetail);
    window.addEventListener('hk-detail-ready', function () { if (window.hkDetail) fn(window.hkDetail); }, { once: true });
  }
  whenDetail(function (X) {
    if (customElements.get('hk-detail-timer')) return;
    var U = X._, C = window.hkCards, esc = C.esc, SP = U.SP, v = C.v;
    var MIN = 60e3, DAY = 864e5, WEEK = 7 * DAY;
    var TINT = 'rgba(255, 159, 10, 0.95)', RING = 2 * Math.PI * 92;
    function secs(x) { return window.hkTimers && window.hkTimers.secs ? window.hkTimers.secs(x) : 0; }
    function hm(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
    function dayWord(t) {
      var d = new Date(t), m = new Date(); m.setHours(0, 0, 0, 0);
      var diff = Math.round((m - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
      return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], diff < 7 ? { weekday: 'long' } : { month: 'short', day: 'numeric' });
    }
    // "2 hr", "1 hr 30 min", "25 min", "45 sec"
    function length(s) {
      s = Math.round(s);
      if (s < 60) return s + ' sec';
      var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      if (m === 60) { h++; m = 0; }
      return h ? h + ' hr' + (m ? ' ' + m + ' min' : '') : m + ' min';
    }
    function clock(s) {
      s = Math.max(0, Math.round(s));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }
    // a quick timer's slot is named by its helper (input_text.quick_timer_N_name)
    function labelOf(id) {
      var m = /^timer\.quick_(\d+)$/.exec(id);
      return m ? 'input_text.quick_timer_' + m[1] + '_name' : null;
    }
    function nameOf(h, id) {
      var lab = labelOf(id), raw = lab && h.states[lab] ? String(h.states[lab].state || '').trim() : '';
      if (raw && raw !== 'unknown' && raw !== 'unavailable') return raw;
      var s = h.states[id], f = (s && s.attributes.friendly_name) || id;
      return String(f).replace(/\s*[-–]?\s*timer\s*$/i, '') || f;
    }

    var CSS = [
      ':host{display:block;color:' + v('ink') + '}',
      ':host(.fill){display:flex;flex-direction:column}',
      ':host(.fill) > div{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.tp{display:flex;flex-direction:column;align-items:center;gap:' + SP.region + 'px;flex:1;min-height:0}',
      '.tp > *{flex:none}',
      // THE DIAL: the ring empties as the time does (--hk-left, hk-countdown's)
      '.dial{position:relative;width:200px;height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}',
      '.dial svg{position:absolute;inset:0;transform:rotate(-90deg)}',
      '.dial .tr{fill:none;stroke:' + v('line-strong') + ';stroke-width:8}',
      '.dial .fl{fill:none;stroke:var(--tint);stroke-width:8;stroke-linecap:round;stroke-dasharray:' + RING.toFixed(1) + ';',
      '  stroke-dashoffset:calc((1 - var(--hk-left, 1)) * ' + RING.toFixed(1) + 'px)}',
      '.held .dial .fl{stroke:' + v('ink-3') + '}',
      '.idle .dial .fl{stroke:' + v('line-strong') + '}',
      '.dial hk-countdown,.dial .cd{position:relative;' + C.figureCss('figure-l') + ';font-weight:600;font-variant-numeric:tabular-nums}',
      '.dial .w{position:relative;font-size:13px;line-height:18px;color:' + v('ink-2') + ';text-align:center;max-width:150px}',
      // the commands: the vacuum sheet's round 72s with their captions
      '.cmds{align-self:stretch;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
      '.cmds button{display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:none;color:' + v('ink') + ';',
      '  font:inherit;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent}',
      '.cmds .ci{width:72px;height:72px;border-radius:' + C.R.capsule('72px') + ';display:flex;align-items:center;justify-content:center;',
      '  background:' + v('key-strong') + ';transition:background ' + C.DUR.fade + ',color ' + C.DUR.fade + '}',
      '.cmds .ci hk-icon{--mdc-icon-size:28px}',
      '.cmds button:active .ci{background:rgba(255,255,255,0.24)}',
      '.cmds button.sel .ci{background:var(--tint);color:rgba(0,0,0,0.85)}',
      '.cmds button[disabled]{opacity:.35;cursor:default}',
      '.cmds button:focus-visible{outline:none}',
      '.cmds button:focus-visible .ci{box-shadow:0 0 0 3px rgba(100,181,255,0.8)}',
      '.cmds .cl{font-size:13px;font-weight:600;color:' + v('ink-2') + '}',
      '.why{font-size:13px;color:' + v('fail') + ';text-align:center;min-height:18px;margin-top:-' + SP.block + 'px}',
      // Past 7 Days, the automation sheet's history card
      '.card{align-self:stretch;border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:' + SP.cardPad + ';min-width:0;flex:1 1 auto;min-height:120px;display:flex;flex-direction:column}',
      '.lab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;' + C.labelCss('label') + ';line-height:16px}',
      '.lab .n{text-transform:none;letter-spacing:0;font-weight:500}',
      // THE LIST HAS EDGES: a rule under the label, and the sheet's shadows
      // at both ends as it scrolls (BASE_CSS .hk-edge)
      '.hist .lab{padding-bottom:' + SP.line + 'px;border-bottom:1px solid ' + v('line') + '}',
      '.hsf{flex:1 1 0}',
      '.hs{flex:1 1 0;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
      '.hs::-webkit-scrollbar{display:none}',
      '.r{display:block;padding:10px 0;border-top:1px solid ' + v('line') + '}',
      '.r:first-child{border-top:0}',
      '.r b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.r span{display:block;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.r time{font-size:13px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.none{font-size:15px;color:' + v('ink-2') + ';padding:8px 0}',
      '@media (max-width:' + C.BP.phone + 'px){.dial{width:170px;height:170px}.cmds .ci{width:60px;height:60px}}',
      '@media (prefers-reduced-motion: reduce){.cmds .ci{transition:none}}'
    ].join('');

    class TimerPanel extends U.Panel {
      static get CSS() { return U.PANEL_CSS + CSS; }
      hkWidthKind() { return 'timer'; }
      hkNoGear() { return false; }
      hkFill() { return true; }
      // the header: its glyph, lit while it runs; its name
      hkHead(h, d) {
        var s = h.states[d.id];
        if (!s) return false;
        var on = s.state === 'active';
        d.well.style.background = on ? TINT : 'rgba(255,255,255,0.12)';
        d.icon.style.color = on ? 'rgba(0,0,0,0.82)' : TINT;
        // h: the sheet's client (hk-detail.js paintHeader)
        if (h.bindStateIcon) h.bindStateIcon(d.icon, s); else d.icon.stateObj = s;
        d.icon.icon = U.headIcon(d.look, s) || (s.attributes || {}).icon || 'mdi:timer-outline';
        // the tile's name, else the accessory's, else the timer's own less "- Timer"
        d.tt.textContent = (d.src && d.src.name) || U.accName(d.id) || nameOf(h, d.id);
        return true;
      }
      _kick() { this._hkSig = null; if (this.client) super.redraw(); }
      _sigOf() {
        var s = this._stateObj, h = this.client, lab = labelOf(this._id);
        return s ? s.last_updated + '|' + (lab && h.states[lab] ? h.states[lab].state : '') + '|' + (this._logN || 0) + '|' +
          (this._why || '') + '|' + Math.floor(Date.now() / MIN) : null;
      }
      connectedCallback() { if (super.connectedCallback) super.connectedCallback(); this._log = null; }
      // the week's runs, read once a sheet (and again when it starts or stops)
      _history() {
        var h = this.client, self = this, id = this._id, lab = labelOf(id), now = Date.now();
        var st = this._stateObj && this._stateObj.state;
        if (this._logFor === st && this._log) return;
        this._logFor = st;
        if (!h || !h.callWS) return;
        this._log = this._log || null;
        h.callWS({ type: 'history/history_during_period', start_time: new Date(now - WEEK).toISOString(), end_time: new Date(now).toISOString(),
                   entity_ids: [id].concat(lab && h.states[lab] ? [lab] : []), minimal_response: true, no_attributes: true,
                   significant_changes_only: false }).then(function (H) {
          var X2 = window.hkHeaders;
          self._log = X2 && X2.timerRuns ? X2.timerRuns([{ entity: id, label_entity: lab, label: nameOf(h, id) }], H || {}, h).reverse() : [];
          self._logN = (self._logN || 0) + 1; self._kick();
        }, function () { self._log = []; self._logN = (self._logN || 0) + 1; self._kick(); });
      }
      _left(s) {
        var a = s.attributes || {};
        if (s.state === 'active' && a.finishes_at) { var e = Date.parse(a.finishes_at); if (isFinite(e)) return Math.max(0, (e - Date.now()) / 1000); }
        return secs(a.remaining);
      }
      _hms(t) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; t = Math.round(t); return Math.floor(t / 3600) + ':' + p(Math.floor(t % 3600 / 60)) + ':' + p(t % 60); }
      _do(what) {
        var s = this._stateObj, self = this;
        if (!s) return;
        var call;
        if (what === 'toggle') call = s.state === 'active' ? this._svc('timer', 'pause') : this._svc('timer', 'start');
        else if (what === 'plus') call = this._svc('timer', 'start', { duration: this._hms(this._left(s) + 300) });
        else if (what === 'restart') call = this._svc('timer', 'start', { duration: (s.attributes || {}).duration || '0:00:00' });
        else if (what === 'finish') call = this._svc('timer', 'finish');
        Promise.resolve(call).then(function (ok) { self._why = ok === false ? 'Could not reach Home Assistant' : ''; self._kick(); });
      }
      _render() {
        var h = this.client, s = this._stateObj, self = this;
        if (!h || !s) return;
        if (!this._built) {
          this._built = true;
          this.style.setProperty('--tint', TINT);
          this._root.innerHTML = '<div class="tp"><div class="dial"></div><div class="cmds" role="group" aria-label="Timer controls"></div>' +
            '<div class="why" role="status" aria-live="polite"></div><div class="card hist"></div></div>';
          this._root.querySelector('.cmds').addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button[data-a]') : null;
            if (b && !b.disabled) self._do(b.getAttribute('data-a'));
          });
        }
        this._history();
        var na = this._na(s), st = s.state, a = s.attributes || {}, total = secs(a.duration);
        var tp = this._root.querySelector('.tp');
        tp.className = 'tp ' + (st === 'active' ? 'run' : st === 'paused' ? 'held' : 'idle');
        // THE DIAL: rebuilt only when what it counts from changes, so the
        // countdown keeps its own clock between
        var key = st + '|' + (a.finishes_at || '') + '|' + (a.remaining || '') + '|' + (a.duration || '');
        if (this._dialKey !== key) {
          this._dialKey = key;
          var end = Date.parse(a.finishes_at), cd, words;
          if (st === 'active' && isFinite(end)) {
            cd = '<hk-countdown deadline="' + end + '" total="' + total + '"></hk-countdown>';
            words = 'Ends ' + esc(hm(end)) + (total ? ' · ' + length(total) : '');
          } else if (st === 'paused') {
            var hold = secs(a.remaining);
            cd = '<hk-countdown hold="' + hold + '" total="' + total + '"></hk-countdown>';
            words = 'Paused' + (total ? ' · ' + length(total) + ' timer' : '');
          } else {
            cd = '<div class="cd">' + (total ? clock(total) : '—') + '</div>';
            words = na ? 'Unavailable' : total ? 'Ready · ' + length(total) : 'Ready';
          }
          var dial = this._root.querySelector('.dial');
          dial.style.setProperty('--hk-left', st === 'idle' || !total ? '1' : String(Math.max(0, Math.min(1, this._left(s) / total)).toFixed(2)));
          dial.innerHTML = '<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="tr" cx="100" cy="100" r="92"/><circle class="fl" cx="100" cy="100" r="92"/></svg>' +
            cd + '<div class="w">' + words + '</div>';
        }
        // THE COMMANDS: the running card's four, or Start
        var idle = st !== 'active' && st !== 'paused';
        var btn = function (act, icon, label, sel) {
          return '<button data-a="' + act + '" class="' + (sel ? 'sel' : '') + '"' + (na ? ' disabled' : '') + ' aria-label="' + label + '">' +
            '<span class="ci"><hk-icon icon="' + icon + '"></hk-icon></span><span class="cl">' + label + '</span></button>';
        };
        var cmds = st === 'active' ? btn('toggle', 'mdi:pause', 'Pause') : btn('toggle', 'mdi:play', st === 'paused' ? 'Resume' : 'Start', true);
        cmds += idle ? '<button disabled aria-hidden="true" tabindex="-1"><span class="ci"><hk-icon icon="mdi:plus"></hk-icon></span><span class="cl">5 min</span></button>'
                     : btn('plus', 'mdi:plus', '5 min');
        cmds += btn('restart', 'mdi:restart', 'Restart');
        cmds += idle ? '<button disabled aria-hidden="true" tabindex="-1"><span class="ci"><hk-icon icon="mdi:check"></hk-icon></span><span class="cl">Finish</span></button>'
                     : btn('finish', 'mdi:check', 'Finish');
        C.morph(this._root.querySelector('.cmds'), cmds);
        this._root.querySelector('.why').textContent = this._why || '';
        // Past 7 Days
        var log = this._log;
        // when each ended, how long it ran -- and its name only where it was
        // not this one's (a quick timer's slot is named afresh each run)
        var mine = nameOf(h, this._id);
        var rows = (log || []).slice(0, 40).map(function (r) {
          return '<div class="r"><b>' + esc(dayWord(r.end) + ', ' + hm(r.end)) + '</b><span>Ran ' + esc(length((r.end - r.start) / 1000)) +
            ' \u00b7 ' + esc(hm(r.start)) + ' \u2013 ' + esc(hm(r.end)) + (r.name && r.name !== mine ? ' \u00b7 ' + esc(r.name) : '') + '</span></div>';
        }).join('');
        C.morph(this._root.querySelector('.hist'), '<div class="lab"><span>Past 7 Days</span>' +
          (log && log.length ? '<span class="n">' + log.length + (log.length === 1 ? ' run' : ' runs') + '</span>' : '') + '</div>' +
          (log === null ? '<div class="none">Reading the history…</div>' :
           rows ? '<div class="hk-edge hsf"><div class="hs">' + rows + '</div></div>' : '<div class="none">It has not run in the past 7 days.</div>'));
      }
    }
    U.def('hk-detail-timer', TimerPanel);
  });
})();
