// @ts-check
// hk-hv-energy.js -- AN APPLE HOMEVIEW'S ENERGY PAGES (docs/phase36/PLAN.md, 2026-11-26): Energy and Power, each drawn for the
// HomeView (hk-hv.js: the kit, the frame) from the Energy feature's own model and sums.
//
//   hk-hv-energy-card   Now | Today | Week | Month. Now: what the house uses this minute, and what is using it. Today: the day
//                       by hour, the source figures, where it went, the week. Week and Month: the period's bars and figures,
//                       and where it went. The model and the sums are the Energy page's (hk-energy-sums.js, loaded with
//                       hk-energy.js), so the two never disagree.
//   hk-hv-power-card    the flow (solar, grid, home, battery) with live watts; then the battery through the day and the sun
//                       today. It reads what the Power page's own cards were given (the strategy's `src`).
//
// Both read their states when told (rule 13): the page's signature is a clock of its own (five seconds on Now and Power, a
// minute elsewhere) and the energy model's version, never every sensor's change. The bars rise once on arrival, only with
// Motion on (the kit's :host([hk-still]) and the reduced-motion query stop them).
(function () {
  'use strict';
  if (window.hkHvEnergy) return;                   // double-load guard
  window.hkHvEnergy = { version: '1.0.0' };

  function whenKit(/** @type {(H: any) => void} */ fn) {
    if (window.hkHV && window.hkHV.ready) return fn(window.hkHV);
    window.addEventListener('hk-hv-ready', function () { fn(window.hkHV); }, { once: true });
    if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-hv.js');
  }

  whenKit(function (H) {
  if (window.hkHvEnergy.ready) return;
  window.hkHvEnergy.ready = true;
  var esc = H.esc;

  // ------------------------------------------------------------------ colors
  var USED = '#5fd67d', SOLAR = '#ffd24a', BATT = '#30d158', SOLAR_G = '#ffcc00', GRID_G = '#ffffff', LINE = 'rgba(255,255,255,.2)';
  var INK = 'var(--hk-ink, rgba(255,255,255,0.94))';
  // a source's glyph at rest is the words' own color when the screen's Icons are White; one that is doing something keeps its own
  /** @param {string} c @param {boolean} [active] */
  function gcol(c, active) { return !active && H.whiteGlyphs && H.whiteGlyphs() ? INK : c; }

  // ------------------------------------------------------------------ numbers and words
  function numTag() { try { return window.hkLocale && window.hkLocale.numTag ? window.hkLocale.numTag() : undefined; } catch (e) { return undefined; } }
  /** @param {number} v @param {number} d */
  function fx(v, d) { return (v || 0).toLocaleString(numTag(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  /** @param {number} v */
  function kwh(v) { return fx(v, Math.abs(v) >= 100 ? 0 : 1); }
  // watts as [figure, unit]: kW (one decimal) from a thousand, or when `asKw` says the whole plate is in kW
  /** @param {number} w @param {boolean} [asKw] */
  function wparts(w, asKw) {
    w = Math.abs(w || 0);
    return asKw || w >= 1000 ? [fx(w / 1000, 1), 'kW'] : [fx(w, 0), 'W'];
  }
  /** @param {number} w @param {boolean} [asKw] */
  function wtext(w, asKw) { return wparts(w, asKw).join(' '); }
  function tzOf() { try { return window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined; } catch (e) { return undefined; } }
  /** @param {any} opts */
  function zoned(opts) { var L = window.hkLocale; return L && L.zoned ? L.zoned(opts) : opts; }
  function tag() { var L = window.hkLocale; try { return L && L.tag ? L.tag() : undefined; } catch (e) { return undefined; } }
  // "9 AM" and "9:40 AM", in the house's zone
  /** @param {number} t @param {boolean} [minutes] */
  function hourName(t, minutes) {
    var L = window.hkLocale, o = minutes ? { hour: 'numeric', minute: '2-digit', timeZone: tzOf() } : { hour: 'numeric', timeZone: tzOf() };
    try { return new Date(t).toLocaleTimeString(tag(), L && L.clock ? L.clock(o) : o); } catch (e) { return new Date(t).getHours() + ':00'; }
  }
  /** @param {number} t */
  function dayShort(t) {
    try { return new Date(t).toLocaleDateString(tag(), zoned({ weekday: 'short', timeZone: tzOf() })); } catch (e) { return ''; }
  }
  /** @param {string} t */
  function quiet(t) { return '<div class="pl quiet">' + esc(t) + '</div>'; }
  /** @param {any} card @param {string} id the power, in watts (a kW sensor is scaled), or null */
  function pw(card, id) {
    var st = id && card.st(id);
    if (!st || st.state === '' || st.state === 'unknown' || st.state === 'unavailable') return null;
    var n = Number(st.state);
    if (!isFinite(n)) return null;
    var u = String((st.attributes || {}).unit_of_measurement || 'W');
    return /^kw$/i.test(u) ? n * 1000 : /^mw$/i.test(u) ? n * 1e6 : n;
  }
  /** @param {any} card @param {string} id */
  function num(card, id) {
    var st = id && card.st(id), n = st ? Number(st.state) : NaN;
    return st && st.state !== '' && isFinite(n) ? n : null;
  }
  /** @param {any} card @param {string} id a state that says something, or null (unknown is not an answer) */
  function reading(card, id) {
    var st = id && card.st(id);
    return st && st.state !== '' && st.state !== 'unknown' && st.state !== 'unavailable' ? st.state : null;
  }
  /** @param {number} h hours as "14 h" */
  function hoursText(h) { return h >= 1 ? 'about ' + Math.round(h) + ' h' : 'about ' + Math.max(1, Math.round(h * 60)) + ' min'; }
  /** @param {any} arr */
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i] || 0; return s; }
  /** @param {any} card @param {number} v @param {number} d */
  function money(card, v, d) { var C = window.hkCards; return C && C.money ? C.money(card.client, v, d) : '$' + fx(v, d); }

  // ------------------------------------------------------------------ the Energy page's model and sums
  // hk-energy.js is a lazy card file; its parts register the sums (the model, the statistics, calc) as a function over a kit
  // object. The sums part uses nothing from the shell, so it runs here on a kit of this file's own, and the page's one state
  // (window.hkEnergyPage) is shared: the same model, the same numbers.
  /** @type {any} */
  var E = null;
  var asked = false, failed = false, waiting = /** @type {any[]} */ ([]);
  /** @param {any} card */
  function energy(card) {
    if (E) return E;
    if (!asked) {
      asked = true;
      var done = function () {
        var parts = window.hkEnergyParts, fn = parts && parts['hk-energy-sums'];
        if (fn) { try { var K = {}; fn(K); E = K; } catch (e) { console.error('[hk-hv-energy] the sums did not start', e); } }
        if (!E) failed = true;
        var list = waiting; waiting = [];
        list.forEach(function (c) { if (c.isConnected) c.redraw(); });
      };
      var need = window.hkNeed && window.hkNeed.file ? window.hkNeed.file('hk-energy.js') : null;
      Promise.resolve(need).then(function () { return (window.__hkSplitReady || {})['cards/hk-energy']; }).then(done, done);
    }
    if (waiting.indexOf(card) < 0) waiting.push(card);
    return null;
  }

  // ------------------------------------------------------------------ charts (all in pt: the viewBox is the plate's inner width)
  /** @param {number} n */
  function f1(n) { return n.toFixed(1); }
  // a bar with its top corners rounded
  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
  function topRound(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return 'M' + f1(x) + ' ' + f1(y + h) + 'V' + f1(y + r) + 'Q' + f1(x) + ' ' + f1(y) + ' ' + f1(x + r) + ' ' + f1(y) + 'H' + f1(x + w - r) +
      'Q' + f1(x + w) + ' ' + f1(y) + ' ' + f1(x + w) + ' ' + f1(y + r) + 'V' + f1(y + h) + 'Z';
  }
  /** @param {any} b */
  function total(b) { return sum((b.segs || []).map(function (/** @type {any} */ g) { return g.v; })); }
  /** @param {string} t @param {number} x @param {number} y @param {string} anchor @param {string} [extra] */
  function text(t, x, y, anchor, extra) {
    return '<text x="' + f1(x) + '" y="' + f1(y) + '" text-anchor="' + anchor + '" class="tx"' + (extra ? ' ' + extra : '') + '>' + esc(t) + '</text>';
  }
  // THE ENERGY PAGE'S BARS (hk-energy-day.js barChart, which DESIGN.md "One chart system" names): at most 20 wide, a gap of 0.42
  // of a bar, the chart only as wide as its bars; a bar is a stack of parts (bottom to top), `ghost` a quiet bar for what
  // is still to come; labels under their own bars.
  // o { W, H, maxW, anim, aria }; bars [{ segs: [{ v, c }], ghost, label, anchor }]
  /** @param {any[]} bars @param {any} o */
  function barsSvg(bars, o) {
    var n = bars.length, W = o.W || 476, hh = o.H || 128, bw = Math.max(3, Math.min(o.maxW || 20, W / (n + (n - 1) * 0.42))), gap = bw * 0.42;
    var tw = n * bw + (n - 1) * gap, x0 = (W - tw) / 2, mx = 0.001, out = '', labs = '';
    bars.forEach(function (b) { mx = Math.max(mx, total(b), b.ghost || 0); });
    bars.forEach(function (b, k) {
      var x = x0 + k * (bw + gap), t = total(b), r = Math.min(4, bw / 3), g = '<g class="b" style="--i:' + k + '">';
      if (b.ghost > 0) { var gh = Math.max(3, hh * b.ghost / mx); g += '<path d="' + topRound(x, hh - gh, bw, gh, r) + '" fill="rgba(255,255,255,.14)"/>'; }
      if (t > 0) {
        var th = Math.max(3, hh * t / mx), segs = b.segs.filter(function (/** @type {any} */ s) { return s.v > 0; }), cum = 0, parts = [];
        segs.forEach(function (/** @type {any} */ s) { cum += s.v; parts.push({ c: s.c, h: th * cum / t }); });
        // the tallest part first (rounded on top), each shorter one over it, from the foot
        for (var j = parts.length - 1; j >= 0; j--) {
          g += j === parts.length - 1 ? '<path d="' + topRound(x, hh - parts[j].h, bw, parts[j].h, r) + '" fill="' + parts[j].c + '"/>'
            : '<rect x="' + f1(x) + '" y="' + f1(hh - parts[j].h) + '" width="' + f1(bw) + '" height="' + f1(parts[j].h) + '" fill="' + parts[j].c + '"/>';
        }
      } else if (!b.ghost) {
        g += '<rect x="' + f1(x) + '" y="' + (hh - 3) + '" width="' + f1(bw) + '" height="3" rx="1.5" fill="' + LINE + '"/>';
      }
      out += g + '</g>';
      if (b.label) labs += text(b.label, b.anchor === 'start' ? x : b.anchor === 'end' ? x + bw : x + bw / 2, hh + 17, b.anchor || 'middle');
    });
    return '<svg class="bars' + (o.anim ? ' anim' : '') + '" viewBox="0 0 ' + W + ' ' + (hh + 22) + '" role="img" aria-label="' + esc(o.aria || 'Chart') + '">' + out + labs + '</svg>';
  }
  // A WEEK'S SEVEN BARS (the mockups' columns: the figure over each, the day under it, today lit). cols [{ v, label, now, ghost }]
  /** @param {any[]} cols @param {any} o */
  function colsSvg(cols, o) {
    var n = cols.length, W = 476, cw = W / n, bw = Math.min(30, cw - 14), hh = o.H || 104, top = 22, mx = 0.001, out = '', labs = '';
    cols.forEach(function (c) { mx = Math.max(mx, c.v || 0, c.ghost || 0); });
    cols.forEach(function (c, k) {
      var cx = (k + 0.5) * cw, x = cx - bw / 2, g = '<g class="b" style="--i:' + k + '">';
      if (c.ghost > 0) { var gh = Math.max(3, hh * c.ghost / mx); g += '<path d="' + topRound(x, top + hh - gh, bw, gh, 6) + '" fill="rgba(255,255,255,.14)"/>'; }
      if (c.v != null) {
        var bh = Math.max(4, hh * c.v / mx), y = top + hh - bh;
        g += '<path d="' + topRound(x, y, bw, bh, 6) + '" fill="' + (c.now ? '#8fe6a6' : USED) + '"' + (c.now ? ' stroke="rgba(255,255,255,.75)" stroke-width="2"' : '') + '/>';
        g += text(kwh(c.v), cx, y - 6, 'middle', 'opacity="' + (c.now ? 1 : 0.78) + '"');
      } else if (!(c.ghost > 0)) {
        // (a day with nothing yet and no last week's to show: a dot on the baseline says the day is there; one with a ghost bar
        // needs none)
        g += text('·', cx, top + hh - 2, 'middle', 'opacity=".5"');
      }
      out += g + '</g>';
      labs += text(String(c.label || '').toUpperCase(), cx, top + hh + 20, 'middle', 'class="tx dl' + (c.now ? ' now' : '') + '"');
    });
    return '<svg class="bars' + (o.anim ? ' anim' : '') + '" viewBox="0 0 ' + W + ' ' + (top + hh + 26) + '" role="img" aria-label="' + esc(o.aria || 'Chart') + '">' + out + labs + '</svg>';
  }
  // the chart plate: its small heading and legend, then the chart at its foot (a Large plate, 4 across and 2 down)
  /** @param {string} label @param {string} legend @param {string} chart */
  function chartPlate(label, legend, chart) {
    return H.plate({ cls: 'c4 r2 cp' }, '<div class="chd"><span class="lbl">' + esc(label) + '</span><span class="lg">' + legend + '</span></div>' + chart);
  }
  /** @param {string} c @param {string} t */
  function key(c, t) { return '<span class="ky"><i style="background:' + c + '"></i>' + esc(t) + '</span>'; }

  // a figure tile (Small): the glyph and its name, the figure at the foot. spans fill the row: 4 / 3 / 2 / 1 tiles
  /** @param {any} o { g, label, fig, unit, span, id } */
  function figTile(o) {
    return H.plate({ cls: 'ft' + (o.span > 1 ? ' c' + o.span : ''), act: o.id ? 'sheet' : null, data: { id: o.id || null }, label: o.label },
      '<div class="fl">' + (o.g || '') + '<span class="lbl">' + esc(o.label) + '</span></div><div class="fig">' + o.fig + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') + '</div>');
  }
  /** @param {number} n */
  function spans(n) { return n >= 4 ? [1, 1, 1, 1] : n === 3 ? [1, 1, 2] : n === 2 ? [2, 2] : [4]; }
  /** @param {any[]} tiles */
  function tileRow(tiles) {
    tiles = tiles.slice(0, 4);
    var sp = spans(tiles.length);
    return tiles.map(function (t, i) { return figTile(Object.assign({}, t, { span: sp[i] })); }).join('');
  }
  // a list of bar rows: [{ name, val, w (0..1), id, quiet }]
  /** @param {any[]} rows @param {string} [cls] */
  function barRows(rows, cls) {
    return H.plate({ cls: (cls || 'c4') + ' el' }, '<div class="rows">' + rows.map(function (r) {
      var inner = '<div class="mid"><div class="l1"><span class="nm' + (r.quiet ? ' ink2' : '') + '">' + esc(r.name) + '</span><span class="val">' + esc(r.val) + '</span></div>' +
        '<i class="ub" style="width:' + Math.max(2, Math.round(100 * r.w)) + '%' + (r.quiet ? ';background:rgba(255,255,255,.3)' : '') + '"></i></div>';
      return r.id ? '<button class="rw er" data-act="sheet" data-id="' + esc(r.id) + '">' + inner + '</button>' : '<div class="rw er">' + inner + '</div>';
    }).join('') + '</div>');
  }

  // ------------------------------------------------------------------ the pages' base
  var CSS = [
    // figure tiles
    '.ft{display:flex;flex-direction:column;justify-content:space-between;padding:' + H.P(14) + ' ' + H.P(10) + ' ' + H.P(14) + ' ' + H.P(14) + '}',
    '.ft .fl{display:flex;align-items:center;gap:' + H.P(5) + ';min-width:0}',
    '.ft .fl .lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:none;letter-spacing:0;font-size:' + H.P(14) + '}',
    '.ft .fig{font-size:' + H.P(26) + ';white-space:nowrap}',
    // chart plates
    '.cp{display:flex;flex-direction:column;padding:' + H.P(18) + ' ' + H.P(20) + ' ' + H.P(14) + '}',
    '.chd{display:flex;align-items:baseline;gap:' + H.P(10) + ';flex:none}',
    '.chd .lg{margin-left:auto;font-size:' + H.P(13) + ';font-weight:500;color:var(--hk-ink-2,rgba(255,255,255,.68));white-space:nowrap}',
    '.ky{display:inline-flex;align-items:center;margin-left:' + H.P(10) + '}',
    '.ky i{display:inline-block;width:' + H.P(9) + ';height:' + H.P(9) + ';border-radius:' + H.P(2.5) + ';margin-right:' + H.P(5) + '}',
    '.bars{display:block;width:100%;height:auto;overflow:visible;margin-top:auto;font-family:inherit}',
    '.bars .tx{font-size:13px;font-weight:600;fill:currentColor;opacity:.68;font-variant-numeric:tabular-nums}',
    '.bars .tx.dl{letter-spacing:.4px;opacity:.68}.bars .tx.now{opacity:1}',
    '.ln .tx{font-size:13px;font-weight:600;fill:currentColor;opacity:.68}',
    '@keyframes hvRise{from{transform:scaleY(.001)}}',
    '.bars.anim .b{transform-box:fill-box;transform-origin:50% 100%;animation:hvRise .6s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 14ms)}',
    '@media (prefers-reduced-motion:reduce){.bars.anim .b{animation:none}}',
    // bar rows (Where It Went; what is using power)
    '.el{padding:' + H.P(8) + ' ' + H.P(12) + ' ' + H.P(8) + ' ' + H.P(14) + '}',
    '.rw.er{min-height:' + H.P(53) + ';padding:0 0 0 ' + H.P(2) + '}',
    '.rw.er .l1{display:flex;align-items:baseline;gap:' + H.P(8) + '}.rw.er .l1 .nm{flex:1;min-width:0}',
    '.ub{display:block;height:' + H.P(5) + ';border-radius:' + H.P(3) + ';margin-top:' + H.P(5) + ';background:' + USED + '}',
    // Now: the hero beside the devices
    '.hero{display:flex;flex-direction:column;padding:' + H.P(20) + ' ' + H.P(20) + ' ' + H.P(22) + '}',
    '.hero .big{display:flex;align-items:baseline;gap:' + H.P(6) + ';margin-top:' + H.P(10) + '}',
    '.hero .big .giant{font-size:' + H.P(80) + ';letter-spacing:' + H.P(-3) + '}.hero .big .u{font-size:' + H.P(22) + ';font-weight:600;color:var(--hk-ink-2,rgba(255,255,255,.68))}',
    '.hero .src{display:flex;flex-direction:column;gap:' + H.P(12) + ';margin-top:auto}',
    '.hero .sr{display:flex;align-items:center;gap:' + H.P(10) + '}.hero .sr .nm{flex:1;min-width:0}.hero .sr .hl{font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.hero .foot{margin-top:auto;font-size:' + H.P(15) + ';font-weight:500;color:var(--hk-ink-2,rgba(255,255,255,.68))}',
    '.empty{display:flex;align-items:center;justify-content:center;height:100%;padding:' + H.P(18) + ';text-align:center;font-size:' + H.P(15) + ';color:var(--hk-ink-2,rgba(255,255,255,.68))}',
    // Power: the flow
    '.flow{position:relative;height:' + H.P(336) + '}',
    '.flow svg.ln{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
    '.nd{position:absolute;display:flex;flex-direction:column;align-items:center;text-align:center;transform:translateX(-50%);white-space:nowrap}',
    '.nd .disc{display:flex;align-items:center;justify-content:center;border-radius:50%;position:relative}',
    '.nd .hl{margin-top:' + H.P(8) + ';font-variant-numeric:tabular-nums}.nd .st{margin-top:' + H.P(1) + '}',
    '.nd .disc .in{display:flex;flex-direction:column;align-items:center}',
    '.nd .disc .hw{font-size:' + H.P(24) + ';font-weight:700;letter-spacing:' + H.P(-0.5) + ';margin-top:' + H.P(4) + ';font-variant-numeric:tabular-nums}',
    '.nd .disc svg.ring{position:absolute;inset:0;width:100%;height:100%}',
    '.nd .disc .pc{font-size:' + H.P(22) + ';font-weight:700;font-variant-numeric:tabular-nums;position:relative}',
    '.nd .disc.lit{color:#1c1c1e}',
    '.sunl{font-size:' + H.P(13) + '}'
  ].join('\n');

  class HvEnergyBase extends H.Page {
    constructor() {
      super();
      this.minutely = true;
      this._seen = {};
    }
    static get CSS() { return H.CSS + '\n' + CSS; }
    // THE SIGNATURE IS A CLOCK OF ITS OWN: a power sensor changes every few seconds and nobody reads watts that fast, so Now (and
    // Power) draw at most every five seconds, the periods once a minute; the statistics wake the card when they land, and
    // the energy model's version moves when HA's settings arrive
    _sigOf() {
      if (!this.client) return null;
      var fast = this._fast ? this._fast() : false;
      return (this._sigKey ? this._sigKey() : '') + '|' + (E ? E.EP.ver : 0) + '|' + Math.floor(Date.now() / (fast ? 5e3 : 60e3));
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (E && E.EP && E.EP.cards) E.EP.cards.delete(this);
    }
    // the bars rise once, the first time a chart of this kind is drawn, and only with Motion on
    /** @param {string} k */
    _anim(k) {
      if (this._seen[k]) return false;
      this._seen[k] = true;
      var on = true;
      try { var S = window.hkSettings, r = S && S.rendering ? S.rendering() : null; on = !r || r.motion !== false; } catch (e) { on = true; }
      return on;
    }
  }

  // =================================================================== ENERGY
  var MODES = [{ k: 'now', t: 'Now' }, { k: 'day', t: 'Today' }, { k: 'week', t: 'Week' }, { k: 'month', t: 'Month' }];

  class HvEnergy extends HvEnergyBase {
    _per() {
      var m = this.mode();
      if (m) return m;
      var P = E && E.plan ? E.plan() : null, o = P && P.page && P.page.opens_on;
      return ['now', 'day', 'week', 'month'].indexOf(o) >= 0 ? o : 'day';
    }
    _fast() { return this._per() === 'now'; }
    _sigKey() { return this._per(); }
    draw() {
      var per = this._per(), title = (this._config || {}).title || 'Energy';
      /** @param {string} s */
      var head = function (s) { return H.head({ title: title, sum: s, right: H.seg(MODES, per, 'mode') }); };
      var Ek = energy(this);
      if (!Ek) return head('') + quiet(failed ? 'Energy is not available on this screen.' : 'Loading…');
      if (!Ek.plan()) return head('') + quiet('Energy is not set up. Add it in ' + H.esc(H.where('Pages → Energy')) + '.');
      var M = Ek.model(this.client, this);
      if (!M) return head('') + quiet('Loading…');
      var D = M.ids.length ? Ek.series(this.client, this, M) : null;
      if (per === 'now') return this._now(head, Ek, M, D);
      if (!M.ids.length) return head('') + quiet('No energy meters yet. Add them in Home Assistant’s Energy settings.');
      if (!D) return head('') + quiet('Loading…');
      var R = Ek.calcFor(M, D, per, null);
      if (!R) return head('') + quiet('No history yet.');
      return this._period(per, head, Ek, M, D, R);
    }

    // ---------------------------------------------------------------- Now
    /** @param {(s: string) => string} head @param {any} Ek @param {any} M @param {any} D */
    _now(head, Ek, M, D) {
      var self = this, plan = Ek.plan(), W = (plan && plan.power) || {}, B = W.battery || {};
      var live = M.devs.filter(function (/** @type {any} */ d) { return d.counted && d.power; }).map(function (/** @type {any} */ d) {
        return { d: d, w: Math.max(0, pw(self, d.power) || 0) };
      }).filter(function (/** @type {any} */ r) { return r.w >= 5; }).sort(function (/** @type {any} */ a, /** @type {any} */ b) { return b.w - a.w; });
      var tw = M.total.power ? pw(this, M.total.power) : null;
      if (tw == null && W.home) tw = pw(this, W.home);
      if (tw == null && live.length) tw = sum(live.map(function (/** @type {any} */ r) { return r.w; }));
      var asKw = tw != null && tw >= 1000;
      var hp = tw == null ? ['—', ''] : wparts(tw, asKw);
      // the sources (the Power plan's readings): what the sun gives, the grid, the battery
      var src = [];
      if (W.solar) {
        var sun = Math.max(0, pw(this, W.solar) || 0);
        src.push({ g: H.glyph('hk:white-balance-sunny', 22, gcol(SOLAR_G, sun > 20)), name: 'Solar', val: pw(this, W.solar) == null ? '\u2014' : sun > 20 ? wtext(sun, asKw) : 'Idle', id: W.solar });
      }
      if (W.grid) {
        var g = pw(this, W.grid), gx = W.grid_export ? pw(this, W.grid_export) : null, imp = g == null ? 0 : Math.max(0, g), exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0;
        var down = W.grid_status ? reading(this, W.grid_status) === 'off' : false;
        src.push({ g: H.glyph('hk:transmission-tower', 22, gcol(down ? '#ff453a' : GRID_G, down)), name: exp > 5 && !down ? 'To Grid' : 'Grid',
                   val: down ? 'Down' : exp > 5 ? wtext(exp, asKw) : imp > 5 ? wtext(imp, asKw) : 'Idle', id: W.grid, bad: down });
      }
      if (B.level || B.charge || B.discharge) {
        var bc = pw(this, B.charge) || 0, bd = pw(this, B.discharge) || 0, bw = bc > 5 ? bc : bd > 5 ? -bd : 0, lv = B.level ? num(this, B.level) : null;
        src.push({ g: H.glyph('hk:home-battery', 22, gcol(BATT, bw !== 0)), name: 'Battery' + (lv != null ? ' ' + Math.round(lv) + '%' : ''),
                   val: bw > 0 ? 'Charging ' + wtext(bw, asKw) : bw < 0 ? 'Giving ' + wtext(bw, asKw) : 'Idle', id: B.level || B.charge, idle: bw === 0 });
      }
      var heroHtml = '<div class="lbl">Using Now</div>' + (tw == null ? '<div class="big"><span class="hl ink2">No Reading</span></div>' :
        '<div class="big"><span class="giant">' + hp[0] + '</span><span class="u">' + hp[1] + '</span></div>');
      if (src.length) {
        heroHtml += '<div class="src">' + src.map(function (s) {
          return '<button class="sr" data-act="sheet" data-id="' + esc(s.id) + '">' + s.g + '<span class="nm">' + esc(s.name) + '</span><span class="hl' +
            (s.bad ? ' bad' : s.idle || s.val === 'Idle' ? ' ink2' : '') + '">' + esc(s.val) + '</span></button>';
        }).join('') + '</div>';
      } else if (D) {
        var R = Ek.calcFor(M, D, 'day', null);
        if (R) heroHtml += '<div class="foot">' + kwh(R.home) + ' kWh so far today</div>';
      }
      var sumHtml = tw == null ? 'No Reading' : '<b>' + hp[0] + '</b> ' + hp[1];
      if (tw == null && !src.length) {
        return head(sumHtml) + quiet('No power sensors yet. Add devices with a power sensor in ' + H.esc(H.where('Energy')) + '.');
      }
      // what is using it, biggest first: five, then everything else
      var top = live.slice(0, 5), shown = sum(top.map(function (/** @type {any} */ r) { return r.w; }));
      var maxW = Math.max(1, top.length ? top[0].w : 1, tw != null ? Math.max(0, tw - shown) : 0);
      var rows = top.map(function (/** @type {any} */ r) { return { name: r.d.name, val: wtext(r.w), w: r.w / maxW, id: r.d.power || r.d.stat }; });
      var rest = tw != null ? Math.max(0, tw - shown) : 0;
      if (rows.length && rest >= 5) rows.push({ name: 'Everything Else', val: wtext(rest), w: rest / maxW, quiet: true });
      var out = head(sumHtml) + '<div class="grid">' + H.plate({ cls: 'c2 r3 hero' }, heroHtml) +
        (rows.length ? barRows(rows, 'c2 r3') : H.plate({ cls: 'c2 r3' }, '<div class="empty">Nothing is using power right now.</div>')) + '</div>';
      // more of the same scrolls: the devices past the fifth
      if (live.length > 5) {
        var more = live.slice(5, 25), mm = Math.max(1, more[0].w);
        out += H.section('Also Using Power', more.length + (more.length === 1 ? ' device' : ' devices')) +
          '<div class="grid">' + barRows(more.map(function (/** @type {any} */ r) { return { name: r.d.name, val: wtext(r.w), w: r.w / mm, id: r.d.power || r.d.stat }; })) + '</div>';
      }
      return out;
    }

    // ---------------------------------------------------------------- Today, Week, Month
    /** @param {string} per @param {(s: string) => string} head @param {any} Ek @param {any} M @param {any} D @param {any} R */
    _period(per, head, Ek, M, D, R) {
      var self = this, isDay = per === 'day', hasSolar = M.src.solar.length > 0, hasGrid = M.src.imp.length > 0, hasBat = !!(M.src.battery || M.src.into.length);
      var sumHtml = '<b>' + kwh(R.home) + '</b> kWh';
      if ((per === 'week' || per === 'month') && !R.has) return head('') + quiet('No history for ' + Ek.whenOf(per, R) + ' yet.');
      var out = head(sumHtml);
      /** @param {string[]} ids */
      var useSum = function (ids) { return sum(R.idx.map(function (/** @type {number} */ i) { return Ek.vs(R.ser, ids, i); })); };
      // ---- the chart
      var anim = this._anim(per), chart;
      /** @param {any} ser @param {number} i */
      var segsOf = function (ser, i) {
        var home = Ek.homeAt(M, ser, i), sun = hasSolar ? Math.min(Ek.vs(ser, M.src.solar, i), home) : 0;
        return [{ v: sun, c: SOLAR }, { v: Math.max(0, home - sun), c: USED }];
      };
      var legend = key(USED, 'Used') + (hasSolar ? key(SOLAR, 'Solar') : '');
      if (isDay) {
        var bars = [];
        for (var k = 0; k < 24; k++) {
          var lb = k === 0 || k === 6 || k === 12 || k === 18 || k === 23;
          var bar = { label: lb ? hourName(R.today0 + k * 36e5) : '', anchor: k === 0 ? 'start' : k === 23 ? 'end' : 'middle', segs: [], ghost: 0 };
          if (k < R.hToday.length) bar.segs = segsOf(D.h, R.hToday[k]);
          else if (R.hYday[k] != null) bar.ghost = Ek.homeAt(M, D.h, R.hYday[k]);
          bars.push(bar);
        }
        chart = chartPlate('By Hour', legend, barsSvg(bars, { W: 476, H: 128, anim: anim, aria: 'Energy used each hour today' }));
      } else if (per === 'week') {
        var cols = R.slots.map(function (/** @type {any} */ i, /** @type {number} */ k) {
          var d = R.dates[k], g = R.ghosts[k];
          return { v: i == null ? null : Ek.homeAt(M, D.d, i), label: dayShort(d), now: k === R.todayK, ghost: g != null ? Ek.homeAt(M, D.d, g) : 0 };
        });
        chart = chartPlate('By Day', key(USED, 'Used') + (R.cur ? key('rgba(255,255,255,.3)', 'Last Week') : ''), colsSvg(cols, { H: 104, anim: anim, aria: 'Energy used each day this week' }));
      } else {
        var F = window.hkStats.fields;
        var mbars = R.slots.map(function (/** @type {any} */ i, /** @type {number} */ k) {
          var day = F(R.dates[k]).day, g = R.ghosts[k];
          return { segs: i == null ? [] : segsOf(D.d, i), ghost: i == null && g != null ? Ek.homeAt(M, D.d, g) : 0, label: (day - 1) % 7 === 0 ? String(day) : '' };
        });
        chart = chartPlate('By Day', legend, barsSvg(mbars, { W: 476, H: 128, anim: anim, aria: 'Energy used each day this month' }));
      }
      // ---- the figures: the row is filled whatever the house has
      var tiles = [];
      var cand = [];
      if (isDay) {
        var yT = sum(R.hYday.map(function (/** @type {number} */ i) { return Ek.homeAt(M, D.h, i); }));
        if (hasSolar) cand.push({ g: H.glyph('hk:white-balance-sunny', 16, gcol(SOLAR_G)), label: 'Solar', fig: kwh(R.solar), unit: 'kWh', id: M.src.solar[0] });
        if (hasGrid) cand.push({ g: H.glyph('hk:transmission-tower', 16, gcol(GRID_G)), label: 'Grid', fig: kwh(useSum(M.src.imp)), unit: 'kWh', id: M.src.imp[0] });
        if (hasBat) cand.push({ g: H.glyph('hk:home-battery', 16, gcol(BATT)), label: 'Battery', fig: kwh(R.out), unit: 'kWh', id: M.house && M.house.entity });
        if (yT > 0.05) cand.push({ g: H.glyph('hk:calendar', 16, gcol(GRID_G)), label: 'Yesterday', fig: kwh(yT), unit: 'kWh' });
        if (M.hasCost) cand.push({ g: H.glyph('mdi:currency-usd', 16, gcol(BATT)), label: 'Cost', fig: money(this, R.cost, 2), unit: '' });
      } else {
        var days = Math.max(1, R.days), pvOk = R.prev && R.prev.has && R.prev.home > 0;
        cand.push({ g: H.glyph('hk:lightning-bolt', 16, gcol(USED)), label: 'Used', fig: kwh(R.home), unit: 'kWh' });
        cand.push({ g: H.glyph('hk:calendar', 16, gcol(GRID_G)), label: 'A Day', fig: kwh(R.home / days), unit: 'kWh' });
        if (hasSolar) cand.push({ g: H.glyph('hk:white-balance-sunny', 16, gcol(SOLAR_G)), label: 'Solar', fig: kwh(R.solar), unit: 'kWh', id: M.src.solar[0] });
        if (hasGrid) cand.push({ g: H.glyph('hk:transmission-tower', 16, gcol(GRID_G)), label: 'Grid', fig: kwh(useSum(M.src.imp)), unit: 'kWh', id: M.src.imp[0] });
        if (M.hasCost) cand.push({ g: H.glyph('mdi:currency-usd', 16, gcol(BATT)), label: 'Cost', fig: money(this, R.cost, 0), unit: '' });
        if (pvOk) {
          var dp = Math.round(100 * (R.home - R.prev.home) / R.prev.home);
          cand.push({ g: H.glyph('hk:calendar', 16, gcol(GRID_G)), label: per === 'week' ? 'vs Last Week' : 'vs Last Month', fig: (dp > 0 ? '+' : dp < 0 ? '−' : '') + Math.abs(dp), unit: '%' });
        }
      }
      tiles = cand;
      out += '<div class="grid">' + chart + tileRow(tiles) + '</div>';
      // ---- where it went
      var counted = R.counted.filter(function (/** @type {any} */ r) { return r.v > 0.05; }).sort(function (/** @type {any} */ a, /** @type {any} */ b) { return b.v - a.v; });
      if (counted.length) {
        var shown = counted.slice(0, 8), rest = Math.max(0, R.untracked), mx = Math.max(0.001, shown[0].v, rest);
        var rows = shown.map(function (/** @type {any} */ r) { return { name: r.d.name, val: kwh(r.v) + ' kWh', w: r.v / mx, id: r.d.power || r.d.stat }; });
        if (rest > 0.05) rows.push({ name: 'Everything Else', val: kwh(rest) + ' kWh', w: rest / mx, quiet: true });
        out += H.section('Where It Went', Ek.whenOf(per, R)) + '<div class="grid">' + barRows(rows) + '</div>';
      }
      // ---- this week (Today's last section): the last seven days
      if (isDay) {
        var ax = Ek.axisOf(D, M), nd = ax ? ax.d.length : 0, n7 = Math.min(7, nd);
        if (n7 >= 2) {
          var wk = [], tot7 = 0;
          for (var q = nd - n7; q < nd; q++) {
            var v7 = Ek.homeAt(M, D.d, q);
            tot7 += v7;
            wk.push({ v: v7, label: dayShort(+ax.d[q].t), now: q === nd - 1 });
          }
          // against the seven days before: the whole days of each (today is a part of one)
          var whole = 0, wholePrev = 0, wn = 0;
          for (var p = 0; p < n7 - 1; p++) {
            var a0 = nd - n7 + p, b0 = nd - 2 * n7 + p;
            if (b0 < 0) { wn = 0; break; }
            wn++;
            whole += Ek.homeAt(M, D.d, a0); wholePrev += Ek.homeAt(M, D.d, b0);
          }
          var cmp = '';
          if (wn === n7 - 1 && wholePrev > 0.5) {
            var wp = Math.round(100 * (whole - wholePrev) / wholePrev);
            cmp = Math.abs(wp) < 3 ? ' \u00b7 about the same as last week' : ' \u00b7 ' + Math.abs(wp) + '% ' + (wp < 0 ? 'less' : 'more') + ' than last week';
          }
          if (tot7 > 0.05) {
            out += H.section('This Week', kwh(tot7) + ' kWh' + cmp) + '<div class="grid">' +
              chartPlate('By Day', key(USED, 'Used'), colsSvg(wk, { H: 104, anim: this._anim('wk7'), aria: 'Energy used each of the last seven days' })) + '</div>';
          }
        }
      }
      return out;
    }
    /** @param {string} act @param {any} el @param {any} ev */
    act(act, el, ev) {
      if (act === 'mode') {
        var k = el.getAttribute('data-k');
        if (k === 'week' || k === 'month') this._seen[k] = false;
        return false;
      }
      return false;
    }
  }
  H.register('hk-hv-energy-card', HvEnergy, 'HK HomeView Energy', 'The Energy page on an Apple HomeView: Now, Today, Week and Month.');

  // =================================================================== POWER
  // THE FLOW: the sources at the left (the sun, the grid), the house in the middle, the battery at the right; a house without
  // one of them is laid out without it. A line is lit when power moves along it, with a chevron for the way; at rest it is a dotted track.
  /** @param {number[][]} p @param {number} t */
  function bez(p, t) {
    var u = 1 - t;
    var x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
    var y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
    var dx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
    var dy = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
    return { x: x, y: y, a: Math.atan2(dy, dx) * 180 / Math.PI };
  }
  // a line between two points (a curve when they differ in height), lit or a dotted track; `back` flows from the end
  /** @param {number[]} a @param {number[]} b @param {boolean} on @param {string} color @param {boolean} back */
  function line(a, b, on, color, back) {
    var dx = Math.max(40, Math.abs(b[0] - a[0]) * 0.55), p = [a, [a[0] + dx, a[1]], [b[0] - dx, b[1]], b];
    var d = 'M' + a[0] + ' ' + a[1] + 'C' + p[1][0] + ' ' + p[1][1] + ' ' + p[2][0] + ' ' + p[2][1] + ' ' + b[0] + ' ' + b[1];
    if (!on) return '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 9"/>';
    var m = bez(p, 0.5);
    return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>' +
      '<g transform="translate(' + f1(m.x) + ' ' + f1(m.y) + ') rotate(' + f1(m.a + (back ? 180 : 0)) + ')"><path d="M-5 -5.5L3 0L-5 5.5" fill="none" stroke="' + color +
      '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.4))"/></g>';
  }
  // the sensors each part of the Power page was given (the strategy's `src`: its cards), else the plan's own
  /** @param {any} h @param {any} W */
  function powerCfg(h, W) {
    var hs = H.cardOf(h, 'hk-power-house-card') || {}, fl = H.cardOf(h, 'hk-power-flow-card') || {}, bt = H.cardOf(h, 'hk-house-battery-card') || {},
        st = H.cardOf(h, 'hk-power-status-card') || {}, sn = H.cardOf(h, 'hk-power-sun-card') || {}, B = W.battery || {};
    /** @param {string} k @param {string} [bk] */
    var pick = function (k, bk) { return hs[k] || fl[k] || sn[k] || st[k] || bt[k] || W[k] || (bk ? B[bk] : null) || null; };
    return { grid: pick('grid'), grid_export: pick('grid_export'), grid_status: pick('grid_status'), home: pick('home'), solar: hs.solar || sn.solar || st.solar || W.solar || null,
             level: hs.level || fl.level || bt.level || B.level || null, charge: pick('charge', 'charge'), discharge: pick('discharge', 'discharge'),
             reserve: hs.reserve || bt.reserve || B.reserve || null, backup: bt.backup || st.backup || B.backup || null, stored: bt.stored || B.stored || null };
  }
  /** @param {any} card @param {string} id hours, from a runtime sensor in h, min, s or d */
  function hoursOf(card, id) {
    var v = num(card, id);
    if (v == null) return null;
    var u = String(((card.st(id) || {}).attributes || {}).unit_of_measurement || 'h').toLowerCase();
    return /^min/.test(u) ? v / 60 : /^s/.test(u) ? v / 3600 : /^d/.test(u) ? v * 24 : v;
  }

  class HvPower extends HvEnergyBase {
    _fast() { return true; }
    _sigKey() { return 'power'; }
    draw() {
      var Ek = energy(this), plan = Ek && Ek.plan ? Ek.plan() : (window.hkSettings && window.hkSettings.get ? window.hkSettings.get('energy', null) : null), W = (plan && plan.power) || {};
      var c = powerCfg(this.h, W), title = (this._config || {}).title || 'Power';
      var hasBat = !!c.level, hasSun = !!c.solar, hasGrid = !!c.grid;
      // the readings, in watts
      var g = pw(this, c.grid), gx = c.grid_export ? pw(this, c.grid_export) : null;
      var imp = g == null ? 0 : Math.max(0, g), exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0;
      var sun = c.solar ? Math.max(0, pw(this, c.solar) || 0) : 0;
      var bc = pw(this, c.charge) || 0, bd = pw(this, c.discharge) || 0, bw = bc > 5 ? bc : bd > 5 ? -bd : 0;
      var gs = c.grid_status ? reading(this, c.grid_status) : null, down = gs === 'off';
      var home = c.home ? pw(this, c.home) : null;
      if (home == null && (hasGrid || hasSun)) home = Math.max(0, imp - exp + sun + (bw < 0 ? -bw : 0) - (bw > 0 ? bw : 0));
      var asKw = Math.max(sun, imp, exp, home || 0, Math.abs(bw)) >= 1000;
      var level = hasBat ? num(this, c.level) : null;
      var sumHtml = down ? '<b class="bad">Grid Down</b> · on the battery' : home == null ? 'No Reading' : '<b>' + wtext(home, asKw) + '</b> to the house';
      if (!hasGrid && !hasSun && !hasBat && home == null) {
        return H.head({ title: title, sum: 'No Reading' }) + quiet('No power sensors yet. Add them in ' + H.esc(H.where('Energy')) + '.');
      }
      var out = H.head({ title: title, sum: sumHtml });
      // ---- the flow
      var srcs = [];
      if (hasSun) srcs.push('sun');
      if (hasGrid) srcs.push('grid');
      var hx = hasBat ? 280 : srcs.length ? 396 : 258, hy = 150, sx = hasBat ? 66 : 100, bx = 458, by = 150;
      var sy = srcs.length === 2 ? [52, 238] : [hy];
      var lines = '', nodes = '';
      /** @param {number} cx @param {number} cy @param {number} d @param {string} inner @param {string} val @param {string} label @param {string} id @param {string} [cls] @param {string} [vc] */
      var node = function (cx, cy, d, inner, val, label, id, cls, vc) {
        return '<button class="nd" style="left:' + H.P(cx) + ';top:' + H.P(cy - d / 2) + '" data-act="sheet" data-id="' + esc(id || '') + '"' + (id ? '' : ' disabled') + '>' +
          '<span class="pl disc ' + (cls || '') + '" style="width:' + H.P(d) + ';height:' + H.P(d) + '">' + inner + '</span>' +
          '<span class="hl' + (vc ? ' ' + vc : '') + '">' + esc(val) + '</span><span class="st">' + esc(label) + '</span></button>';
      };
      srcs.forEach(function (/** @type {string} */ s, /** @type {number} */ i) {
        var cy = sy[i], end = [hx - 58, hy + (srcs.length === 2 ? (i ? 12 : -12) : 0)];
        if (s === 'sun') {
          lines += line([sx + 44, cy], end, sun > 20, SOLAR_G, false);
          nodes += node(sx, cy, 88, H.glyph('hk:white-balance-sunny', 36, gcol(SOLAR_G, sun > 20)), sun > 20 ? wtext(sun, asKw) : 'Idle', 'Solar', c.solar || '', '', sun > 20 ? '' : 'ink2');
        } else {
          var flowing = !down && (imp > 5 || exp > 5);
          lines += line([sx + 44, cy], end, flowing, exp > 5 ? SOLAR_G : '#ffffff', exp > 5);
          nodes += node(sx, cy, 88, H.glyph('hk:transmission-tower', 36, gcol(down ? '#ff453a' : GRID_G, down)),
            down ? 'Down' : exp > 5 ? wtext(exp, asKw) : imp > 5 ? wtext(imp, asKw) : 'Idle', exp > 5 && !down ? 'To Grid' : 'Grid', c.grid || '', '', down ? 'bad' : flowing ? '' : 'ink2');
        }
      }, this);
      // the house: a lit plate, its watts inside
      nodes += node(hx, hy, 124, '<span class="in">' + H.glyph('hk:home-lightning-bolt', 40, '#1fa846') + '<span class="hw">' + (home == null ? '—' : wtext(home, asKw)) + '</span></span>',
        'Home', '', c.home || '', 'lit');
      if (hasBat) {
        lines += line([hx + 62, hy], [bx - 44, by], bw !== 0, BATT, bw < 0);
        var lv = level == null ? 0 : Math.max(0, Math.min(100, level)), rc = lv < 10 ? '#ff453a' : lv < 20 ? '#ff9f0a' : BATT;
        var ring = '<svg class="ring" viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="38" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6"/>' +
          (level != null ? '<circle cx="44" cy="44" r="38" fill="none" stroke="' + rc + '" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="' + f1(lv) +
            ' 100" transform="rotate(-90 44 44)"/>' : '') + '</svg><span class="pc">' + (level == null ? '—' : Math.round(lv) + '%') + '</span>';
        nodes += node(bx, by, 88, ring, bw !== 0 ? wtext(bw, asKw) : 'Idle', bw > 0 ? 'Battery Charging' : bw < 0 ? 'Battery Giving' : 'Battery', c.level || '', '', bw === 0 ? 'ink2' : '');
      }
      if (!srcs.length && !hasBat) lines = '';
      out += '<div class="flow"><svg class="ln" viewBox="0 0 516 336" aria-hidden="true">' + lines + '</svg>' + nodes + '</div>';
      // ---- the battery through the day
      if (hasBat) out += this._battery(c, level, bw, hasSun);
      // ---- the sun today
      if (hasSun) out += this._sun(Ek, W, c);
      return out;
    }

    // THE BATTERY: its level through the day (each hour's mean since midnight, and the level now), the reserve dashed
    /** @param {any} c @param {number|null} level @param {number} bw @param {boolean} hasSun */
    _battery(c, level, bw, hasSun) {
      var S = window.hkStats, bh = c.backup ? hoursOf(this, c.backup) : null, stored = c.stored ? num(this, c.stored) : null;
      var sumText = [level != null ? Math.round(level) + '%' : null, stored != null ? fx(stored, 1) + ' kWh' : null,
                     bh != null && bh > 0 ? hoursText(bh) + ' of backup' : null].filter(Boolean).join(' \u00b7 ');
      var hr = S && S.hourly && c.level ? S.hourly(this.client, c.level, 48, this, { type: 'mean' }) : null;
      var W = 476, hh = 116, now = Date.now(), body = '', note = '';
      if (S && c.level && !hr) {
        body = '<div class="empty">Loading…</div>';
      } else if (hr && hr.length) {
        var t0 = null;
        for (var i = hr.length - 1; i >= 0; i--) if (S.fields(hr[i].t).hour === 0) { t0 = +hr[i].t; break; }
        if (t0 == null) t0 = +hr[Math.max(0, hr.length - 24)].t;
        var X = function (/** @type {number} */ t) { return Math.max(0, Math.min(1, (t - t0) / 864e5)) * W; };
        var Y = function (/** @type {number} */ v) { return 6 + (hh - 12) * (1 - Math.max(0, Math.min(100, v)) / 100); };
        var pts = [], hours = [];
        hr.forEach(function (/** @type {any} */ r) {
          if (+r.t >= t0 && typeof r.v === 'number' && isFinite(r.v) && +r.t + 36e5 < now) { pts.push([X(+r.t + 18e5), Y(r.v)]); hours.push({ t: +r.t, v: r.v }); }
        });
        if (level != null) pts.push([X(now), Y(level)]);
        if (pts.length < 2) {
          body = '<div class="empty">No history for today yet.</div>';
        } else {
          var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]); }).join(' '), last = pts[pts.length - 1];
          var res = c.reserve ? num(this, c.reserve) : null, ink3 = 'rgba(255,255,255,.12)';
          body = '<svg class="bars ln" viewBox="0 0 ' + W + ' ' + (hh + 22) + '" role="img" aria-label="Battery level today">' +
            [0, 50, 100].map(function (v) { return '<line x1="0" x2="' + W + '" y1="' + f1(Y(v)) + '" y2="' + f1(Y(v)) + '" stroke="' + ink3 + '" stroke-width="1"/>'; }).join('') +
            '<path d="' + d + ' L' + f1(last[0]) + ' ' + f1(Y(0)) + ' L' + f1(pts[0][0]) + ' ' + f1(Y(0)) + 'Z" fill="rgba(48,209,88,.22)"/>' +
            (res != null ? '<line x1="0" x2="' + W + '" y1="' + f1(Y(res)) + '" y2="' + f1(Y(res)) + '" stroke="rgba(255,255,255,.4)" stroke-width="1.5" stroke-dasharray="4 5"/>' : '') +
            '<path d="' + d + '" fill="none" stroke="' + BATT + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
            '<circle cx="' + f1(last[0]) + '" cy="' + f1(last[1]) + '" r="5" fill="#fff"/>' +
            [0, 6, 12, 18].map(function (h6) { return text(hourName(t0 + h6 * 36e5), (h6 / 24) * W, hh + 17, h6 === 0 ? 'start' : 'middle'); }).join('') + '</svg>';
          // when it charged: the longest climb since midnight
          var best = null, run = null;
          for (var q = 1; q < hours.length; q++) {
            if (hours[q].v > hours[q - 1].v + 0.5) {
              if (!run) run = { a: hours[q - 1].t, b: hours[q].t + 36e5, from: hours[q - 1].v, to: hours[q].v };
              else { run.b = hours[q].t + 36e5; run.to = hours[q].v; }
            }
            else { if (run && (!best || run.to - run.from > best.to - best.from)) best = run; run = null; }
          }
          if (run && (!best || run.to - run.from > best.to - best.from)) best = run;
          if (best && best.to - best.from >= 5) note = 'Charged ' + (hasSun ? 'from solar ' : '') + hourName(best.a) + '–' + hourName(best.b);
          else if (bw > 0) note = 'Charging now';
          else if (bw < 0) note = 'Powering the house';
        }
      }
      return H.section('Battery', sumText) + '<div class="grid">' +
        H.plate({ cls: 'c4 r2 cp' }, '<div class="chd"><span class="lbl">Level Today</span><span class="lg">' + esc(note) + '</span></div>' + body) + '</div>';
    }

    // THE SUN TODAY: what it made, by hour, with yesterday's hours still to come in gray; the peak hour
    /** @param {any} Ek @param {any} W @param {any} c */
    _sun(Ek, W, c) {
      var S = window.hkStats, self = this, today = /** @type {any[]} */ ([]), yday = /** @type {any[]} */ ([]), total = 0, ready = false, now = Date.now();
      var M = Ek && Ek.model ? Ek.model(this.client, this) : null, D = M && M.ids.length && M.src.solar.length ? Ek.series(this.client, this, M) : null;
      if (M && D) {
        var ax = Ek.axisOf(D, M);
        if (ax) {
          var t0 = +ax.d[ax.d.length - 1].t;
          ax.h.forEach(function (/** @type {any} */ p, /** @type {number} */ i) {
            var t = +p.t, v = Ek.vs(D.h, M.src.solar, i);
            if (t >= t0) { today.push({ t: t, v: v }); total += v; } else if (t >= t0 - 864e5) yday.push({ t: t, v: v });
          });
          ready = true;
        }
      } else if (S && S.hourly && c.solar) {
        // no energy statistic for the sun: the power sensor's hourly means (kW per hour is kWh)
        var hr = S.hourly(this.client, c.solar, 49, this, { type: 'mean' }), unit = String(((this.st(c.solar) || {}).attributes || {}).unit_of_measurement || 'W');
        if (hr && hr.length) {
          var k = /^kw$/i.test(unit) ? 1 : /^mw$/i.test(unit) ? 1000 : 0.001, mid = null;
          for (var i = hr.length - 1; i >= 0; i--) if (S.fields(hr[i].t).hour === 0) { mid = +hr[i].t; break; }
          if (mid == null) mid = now - 864e5;
          hr.forEach(function (/** @type {any} */ r) {
            var v = typeof r.v === 'number' && isFinite(r.v) ? Math.max(0, r.v * k) : 0, t = +r.t;
            if (t >= mid) { today.push({ t: t, v: v }); total += v; } else if (t >= mid - 864e5) yday.push({ t: t, v: v });
          });
          ready = true;
        }
      }
      if (!ready) return H.section('Solar Today') + '<div class="grid">' + quiet('Loading…') + '</div>';
      var hourOf = function (/** @type {number} */ t) { return S && S.fields ? S.fields(t).hour : new Date(t).getHours(); };
      var bump = today.concat(yday).filter(function (x) { return x.v > 0.02; });
      var peak = today.reduce(function (a, x) { return !a || x.v > a.v ? x : a; }, null);
      var sub = fx(total, 1) + ' kWh' + (peak && peak.v > 0.05 ? ' · peak ' + fx(peak.v, 1) + ' kW at ' + hourName(peak.t) : '');
      var chart;
      if (!bump.length) {
        chart = '<div class="empty">The sun has not made any power yet.</div>';
      } else {
        var a = Math.min.apply(null, bump.map(function (x) { return hourOf(x.t); })), b = Math.max.apply(null, bump.map(function (x) { return hourOf(x.t); }));
        a = Math.max(0, a - 1); b = Math.min(23, b + 1);
        while (b - a < 5) { if (a > 0) a--; if (b < 23 && b - a < 5) b++; if (a === 0 && b === 23) break; }
        var byToday = {}, byYday = {};
        today.forEach(function (x) { /** @type {any} */ (byToday)[hourOf(x.t)] = x.v; });
        yday.forEach(function (x) { /** @type {any} */ (byYday)[hourOf(x.t)] = x.v; });
        var nowH = S && S.fields ? S.fields(now).hour : new Date(now).getHours(), bars = [], t00 = today.length ? today[0].t - hourOf(today[0].t) * 36e5 : now;
        for (var h = a; h <= b; h++) {
          var past = /** @type {any} */ (byToday)[h] != null;
          var bar = { segs: /** @type {any[]} */ ([]), ghost: 0, label: h === a || h === b || h === Math.round((a + b) / 2) ? hourName(t00 + h * 36e5) : '',
                      anchor: h === a ? 'start' : h === b ? 'end' : 'middle' };
          if (past && /** @type {any} */ (byToday)[h] > 0) bar.segs = [{ v: /** @type {any} */ (byToday)[h], c: SOLAR }];
          else if (/** @type {any} */ (byYday)[h] > 0) bar.ghost = /** @type {any} */ (byYday)[h];
          bars.push(bar);
        }
        chart = barsSvg(bars, { W: 476, H: 96, anim: this._anim('sun'), aria: 'Solar energy each hour today' });
      }
      var sunE = this.st('sun.sun'), at = sunE && sunE.attributes, side = '';
      if (sunE && at) {
        var up = sunE.state === 'above_horizon', when = up ? at.next_setting : at.next_rising;
        if (when) side = (up ? 'Sunset ' : 'Sunrise ') + hourName(Date.parse(when), true);
      }
      return H.section('Solar Today', sub) + '<div class="grid">' +
        H.plate({ cls: 'c4 r2 cp' }, '<div class="chd"><span class="lbl">By Hour</span><span class="lg">' + esc(side) + '</span></div>' + chart) + '</div>';
    }
  }
  H.register('hk-hv-power-card', HvPower, 'HK HomeView Power', 'The Power page on an Apple HomeView: the flow between the sun, the grid, the house and the battery.');

  window.hkHvEnergy.Energy = HvEnergy;
  window.hkHvEnergy.Power = HvPower;
  });
})();
