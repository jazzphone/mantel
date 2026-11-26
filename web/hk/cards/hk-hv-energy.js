// @ts-check
// hk-hv-energy.js -- AN APPLE HOMEVIEW'S ENERGY PAGES (docs/phase36/PLAN.md, 2026-11-26): Energy and Power, each drawn for the
// HomeView (hk-hv.js: the kit, the frame) from the Energy feature's own model, sums and plans (hk_core/energy plan.py, power.py).
//
//   hk-hv-energy-card   Now | Today | Week | Month (the switch in the title row). Every tab says what the big Energy page says,
//                       laid out for the HomeView's one column: the rings (Energy, Cost, Solar, Water, Gas against a usual
//                       period, each figure beside them), the period's chart, its figures, Your Day's (Week's, Month's) own
//                       figures, What Stood Out, and EVERY CIRCUIT AND DEVICE the page knows as a list -- its watts now, or its
//                       kWh for the period, a thin bar against the biggest, the battery's Backup mark. A tap on one with a
//                       switch asks first (the house's confirm sheet); one without opens its sheet.
//   hk-hv-power-card    TWO FOLD (the owner, 2026-11-26: "shows current power usage and offers access to battery and circuit
//                       information"). Right now: the flow (the sun, the grid, the house, the battery) and the status in
//                       sentences. Then the house battery: its level, what it is doing, stored, its backup time, the day's
//                       level, its mode, its levels (dragged as Control Center's), EPS and its packs; the battery's circuits,
//                       each with its watts and its switch; every device drawing now; the sun; the cars.
//
// Both read their states when told (rule 13): the signature is a clock of its own (five seconds on Now and Power, a minute on
// the periods), the energy model's version, and the states of the controls the page shows (a switch turned off shows at once),
// never every sensor's change. The bars rise once on arrival, only with Motion on.
(function () {
  'use strict';
  if (window.hkHvEnergy) return;                   // double-load guard
  window.hkHvEnergy = { version: '2.0.0' };

  function whenKit(/** @type {(H: any) => void} */ fn) {
    if (window.hkHV && window.hkHV.ready) return fn(window.hkHV);
    window.addEventListener('hk-hv-ready', function () { fn(window.hkHV); }, { once: true });
    if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-hv.js');
  }

  whenKit(function (H) {
  if (window.hkHvEnergy.ready) return;
  window.hkHvEnergy.ready = true;
  var esc = H.esc, pt = H.P, v = H.C.v;

  // ------------------------------------------------------------------ colors
  var USED = '#5fd67d', SOLAR = '#ffd24a', BATT = '#30d158', SOLAR_G = '#ffcc00', GRID_G = '#ffffff', LINE = 'rgba(255,255,255,.2)';
  var RED = '#ff453a', AMBER = '#ff9f0a', BLUE = '#5ac8fa', CAR = '#64d2ff', PURPLE = '#bf5af2';
  // the rings' own colors (hk-energy-sums.js RING: Fitness's three, then the sun's and gas's)
  var RING = { energy: '#ff9f0a', cost: '#30d158', water: '#64d2ff', solar: '#ffd60a', gas: '#ff6b3d' };
  var RING_NAME = { energy: 'Energy', cost: 'Cost', solar: 'Solar', water: 'Water', gas: 'Gas' };
  var INK = 'var(--hk-ink, rgba(255,255,255,0.94))';
  // a source's glyph at rest is the words' own color when the screen's Icons are White; one that is doing something keeps its own
  /** @param {string} c @param {boolean} [active] */
  function gcol(c, active) { return !active && H.whiteGlyphs && H.whiteGlyphs() ? INK : c; }
  /** @param {string} hex @param {number} a */
  function rgba(hex, a) {
    var n = parseInt(String(hex).slice(1), 16);
    return isFinite(n) && /^#[0-9a-f]{6}$/i.test(hex) ? 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')' : hex;
  }
  // a level's fill on its white plate: its color washed toward white (the kit's fillOf, for any color)
  /** @param {string} hex */
  function wash(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    if (!isFinite(n) || !/^#[0-9a-f]{6}$/i.test(hex)) return '#d8f5df';
    var mix = function (/** @type {number} */ x) { return Math.round(x * 0.42 + 255 * 0.58); };
    return 'rgb(' + mix(n >> 16) + ',' + mix((n >> 8) & 255) + ',' + mix(n & 255) + ')';
  }

  // ------------------------------------------------------------------ glyphs the house's set has no name for (24 x 24)
  var G = {
    clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/>',
    batt: '<rect x="3" y="7" width="16" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5.5" y="9.5" width="8" height="5" rx="1" ' +
      'fill="currentColor"/><rect x="20" y="10" width="2" height="4" rx="1" fill="currentColor"/>',
    car: '<path d="M5 16v2M19 16v2M4 13l2-5h12l2 5v3H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    coin: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.8-2.4 1.8 0 2.6 5 1.4 5 4 0 1-1.1 ' +
      '1.8-2.6 1.8-1.2 0-2.2-.5-2.7-1.3M12 6.5v11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    sun: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    tower: '<path d="M12 2 7 22M12 2l5 20M8.5 15h7M9.6 10h4.8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    storm: '<path d="M7 14a5 5 0 1 1 2-9.6A6 6 0 0 1 20 9a4 4 0 0 1-2 7.5M12 12l-2 5h4l-2 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"/>',
    alert: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round"/>',
    pace: '<path d="M4 18a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18l4-6" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round"/>',
    home: '<path d="M4 11 12 4l8 7v9H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12.6 10 10 14h3.2l-.8 3.4L15 13h-3z" ' +
      'fill="currentColor"/>',
    plug: '<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    temp: '<path d="M10 4a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17" r="2" fill="currentColor"/>'
  };
  /** @param {string} name @param {number} size @param {string} [color] */
  function ig(name, size, color) {
    return '<span class="g" style="--gs:' + pt(size) + (color ? ';color:' + color : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (/** @type {any} */ (G)[name] || '') +
      '</svg></span>';
  }
  // ON THE BATTERY'S BACKUP (the Power plan's `backed`): a small battery and the word, in the battery's green
  function backupMark() { return '<span class="bk">' + ig('batt', 15, BATT) + 'Backup</span>'; }

  // ------------------------------------------------------------------ numbers and words
  function numTag() { try { return window.hkLocale && window.hkLocale.numTag ? window.hkLocale.numTag() : undefined; } catch (e) { return undefined; } }
  /** @param {number} x @param {number} d */
  function fx(x, d) { return (x || 0).toLocaleString(numTag(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  /** @param {number} x */
  function kwh(x) { return fx(x, Math.abs(x) >= 100 ? 0 : 1); }
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
  /** @param {number} t "Sep 13" */
  function dateShort(t) {
    try { return new Date(t).toLocaleDateString(tag(), zoned({ month: 'short', day: 'numeric', timeZone: tzOf() })); } catch (e) { return ''; }
  }
  /** @param {number} t "Thursday" */
  function weekday(t) {
    try { return new Date(t).toLocaleDateString(tag(), zoned({ weekday: 'long', timeZone: tzOf() })); } catch (e) { return ''; }
  }
  /** @param {string} t */
  function quiet(t) { return '<div class="pl quiet">' + esc(t) + '</div>'; }
  /** @param {any} st */
  function gone(st) { return !st || st.state === '' || st.state === 'unknown' || st.state === 'unavailable'; }
  /** @param {any} card @param {string} id the power, in watts (a kW sensor is scaled), or null */
  function pw(card, id) {
    var st = id && card.st(id);
    if (gone(st)) return null;
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
    return gone(st) ? null : st.state;
  }
  /** @param {any} card @param {string} id hours, from a runtime sensor in h, min, s or d */
  function hoursOf(card, id) {
    var n = num(card, id);
    if (n == null) return null;
    var u = String(((card.st(id) || {}).attributes || {}).unit_of_measurement || 'h').toLowerCase();
    return /^min/.test(u) ? n / 60 : /^s/.test(u) ? n / 3600 : /^d/.test(u) ? n * 24 : n;
  }
  // hours as "12 h 5 m" (under an hour "40 m")
  /** @param {number} h */
  function hm(h) {
    var m = Math.round((h || 0) * 60);
    return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' m' : '') : m + ' m';
  }
  /** @param {any} arr */
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i] || 0; return s; }
  /** @param {any} card @param {number} x @param {number} d */
  function money(card, x, d) { var C = window.hkCards; return C && C.money ? C.money(card.client, x, d) : '$' + fx(x, d); }
  // a number's value in its unit: "90%", "2.5 kW", "12 h"
  /** @param {number} x @param {string} unit */
  function numWord(x, unit) { return unit === 'W' ? wtext(x) : fx(x, Math.abs(x) < 10 && x % 1 ? 1 : 0) + (unit === '%' ? '%' : unit ? ' ' + unit : ''); }
  /** @param {number} x @param {number} [a] @param {number} [b] */
  function clamp(x, a, b) { return Math.max(a == null ? 0 : a, Math.min(b == null ? 1 : b, x)); }
  /** @param {number} n @param {string} one @param {string} [many] */
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  // ------------------------------------------------------------------ the Energy page's model and sums
  // hk-energy.js is a lazy card file; its parts register the sums (the model, the statistics, calc, highlights) as a function
  // over a kit object. The sums part uses nothing from the shell, so it runs here on a kit of this file's own, and the page's
  // one state (window.hkEnergyPage) is shared: the same model, the same numbers. The rings are drawn by the Energy page's own
  // ringSvg (window.hkEnergy, once hk-energy.js has run).
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
  function plan() { var S = window.hkSettings, p = S && S.get ? S.get('energy', null) : null; return p && typeof p === 'object' ? p : null; }

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
        // (a day with nothing yet and no last week's to show: a dot on the baseline says the day is there)
        g += text('·', cx, top + hh - 2, 'middle', 'opacity=".5"');
      }
      out += g + '</g>';
      labs += text(String(c.label || '').toUpperCase(), cx, top + hh + 20, 'middle', 'class="tx dl' + (c.now ? ' now' : '') + '"');
    });
    return '<svg class="bars' + (o.anim ? ' anim' : '') + '" viewBox="0 0 ' + W + ' ' + (top + hh + 26) + '" role="img" aria-label="' + esc(o.aria || 'Chart') + '">' + out + labs + '</svg>';
  }
  // A LINE THROUGH VALUES as an area (the last three hours' watts), W x Hh in pt; nulls (a bucket still open) are skipped
  /** @param {any[]} vals @param {number} W @param {number} Hh @param {string} color */
  function traceSvg(vals, W, Hh, color) {
    var pts = [], mx = 0.01, n = Math.max(1, vals.length - 1);
    vals.forEach(function (x) { if (typeof x === 'number' && isFinite(x) && x > mx) mx = x; });
    vals.forEach(function (x, i) { if (typeof x === 'number' && isFinite(x)) pts.push([i * W / n, Hh - 2 - (Hh - 6) * Math.max(0, x) / mx]); });
    if (pts.length < 2) return '<path d="M0 ' + (Hh - 2) + 'H' + W + '" stroke="' + LINE + '" stroke-width="2"/>';
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]); }).join(' '), last = pts[pts.length - 1];
    return '<path d="' + d + ' L' + f1(last[0]) + ' ' + Hh + ' L' + f1(pts[0][0]) + ' ' + Hh + ' Z" fill="' + rgba(color, 0.22) + '"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="' + f1(last[0]) + '" cy="' + f1(last[1]) + '" r="4" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>';
  }
  // the chart plate: its small heading and legend, then the chart at its foot (a Large plate, 4 across and 2 down)
  /** @param {string} label @param {string} legend @param {string} chart */
  function chartPlate(label, legend, chart) {
    return H.plate({ cls: 'c4 r2 cp' }, '<div class="chd"><span class="lbl">' + esc(label) + '</span><span class="lg">' + legend + '</span></div>' + chart);
  }
  /** @param {string} c @param {string} t */
  function key(c, t) { return '<span class="ky"><i style="background:' + c + '"></i>' + esc(t) + '</span>'; }

  // A FIGURE (Wide, 2 x 1: the owner's "1,581 kWh" cut off by a Small tile's edge): the glyph and its name, the figure, a line under
  // it -- 16 pt from every edge. o { g (html), label, fig (html), unit, sub, id, tone ('bad', 'ok') }
  /** @param {any} o */
  function figTile(o) {
    return H.plate({ cls: 'fw c2', act: o.id ? 'sheet' : null, data: { id: o.id || null }, label: o.label + ', ' + String(o.fig).replace(/<[^>]+>/g, '') + ' ' + (o.unit || '') },
      '<div class="fl">' + (o.g || '') + '<span>' + esc(o.label) + '</span></div><div class="fig' + (o.tone ? ' ' + o.tone : '') + '">' + o.fig +
      (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') + '</div>' + (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : ''));
  }
  /** @param {any[]} tiles */
  function figGrid(tiles) { return tiles.length ? '<div class="grid">' + tiles.map(figTile).join('') + '</div>' : ''; }
  // SENTENCES (the Energy page's Highlights, the Power page's status): a glyph in its color's disc, the words beside it.
  // rows [{ ic (svg inside), c, t (html), more (a sheet), alert }]
  /** @param {any[]} rows */
  function sayList(rows) {
    return '<div class="pl list c4 says"><div class="rows">' + rows.map(function (r) {
      var tg = r.more ? 'button' : 'div';
      return '<' + tg + ' class="rw sy' + (r.alert ? ' alert' : '') + '"' + (r.more ? ' data-act="sheet" data-id="' + esc(r.more) + '"' : '') + '>' +
        '<span class="ic" style="background:' + rgba(r.c, 0.16) + ';color:' + r.c + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + r.ic + '</svg></span>' +
        '<div class="tx">' + r.t + '</div></' + tg + '>';
    }).join('') + '</div></div>';
  }
  // A CIRCUIT OR A DEVICE AS A ROW (the leak sensors' rows): its glyph, its name, a second line (its room or kind, and the
  // battery's Backup mark), a thin bar against the biggest in the list, and its value at the right. A tap: 'dev' (the card
  // asks before a switch, else opens the sheet). x { key, icon, gc, name, sub, backed, val (html), w (0..1 or null), bar, off }
  /** @param {any} x */
  function devRow(x) {
    var mark = x.backed ? (x.sub ? '<i class="sep">·</i>' : '') + backupMark() : '';
    return '<button class="rw dv' + (x.off ? ' off' : '') + '" data-act="dev" data-k="' + esc(x.key) + '" aria-label="' + esc(x.name + ', ' + String(x.val).replace(/<[^>]+>/g, '') +
      (x.backed ? ', on the battery’s backup' : '')) + '">' + H.glyph(x.icon || 'hk:lightning-bolt', 26, x.gc) +
      '<div class="mid"><div class="nm">' + esc(x.name) + '</div>' + (x.sub || mark ? '<div class="st">' + esc(x.sub || '') + mark + '</div>' : '') +
      (x.w != null ? '<i class="ub" style="width:' + f1(Math.max(1.5, 100 * clamp(x.w))) + '%;background:' + (x.bar || USED) + '"></i>' : '') + '</div>' +
      '<div class="val">' + x.val + '</div></button>';
  }
  // the rows past the first `n`, folded under "N More" until it is tapped (data-k: which list)
  /** @param {string[]} rows @param {number} n @param {boolean} open @param {string} k @param {string} [one] @param {string} [many] */
  function folded(rows, n, open, k, one, many) {
    if (rows.length <= n + 1 || open) return rows;
    return rows.slice(0, n).concat(['<button class="rw more" data-act="fold" data-k="' + esc(k) + '"><span class="g" style="--gs:' + pt(26) + '">' + H.chev('down', 18) +
      '</span><div class="mid"><div class="nm">' + esc(count(rows.length - n, one || 'More', many || one || 'More')) + '</div></div></button>']);
  }

  // ------------------------------------------------------------------ the styles
  var CSS = [
    // a stack of plates outside the grid (lists, the rings, the battery): 12 apart, as the grid's own gap
    '.stk{display:flex;flex-direction:column;gap:' + pt(12) + '}',
    // (a list's first and last words as far from its edges as a figure's: 8 around the rows)
    '.pl.list{padding-top:' + pt(8) + ';padding-bottom:' + pt(8) + '}',
    // (blocks one after another, outside a section's heading: the grid's own 12 between them)
    '.grid+.grid,.grid+.stk,.stk+.grid,.stk+.stk,.grid+.pl,.stk+.pl,.flow+.pl{margin-top:' + pt(12) + '}',
    // FIGURES (Wide): every word 16 from the plate's edges
    '.fw{display:flex;flex-direction:column;justify-content:space-between;padding:' + pt(16) + ' ' + pt(18) + '}',
    '.fw .fl{display:flex;align-items:center;gap:' + pt(7) + ';min-width:0;font-size:' + pt(14) + ';font-weight:600;line-height:' + pt(18) + ';color:' + v('ink-2') + '}',
    '.fw .fl span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fw .fig{font-size:' + pt(28) + ';line-height:' + pt(32) + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fw .fig small{margin-left:' + pt(4) + '}.fw .fig.bad{color:' + v('fail', '#ff6961') + '}',
    '.fw .sub{font-size:' + pt(13) + ';font-weight:500;line-height:' + pt(17) + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // chart plates
    '.cp{display:flex;flex-direction:column;padding:' + pt(18) + ' ' + pt(20) + ' ' + pt(14) + '}',
    '.chd{display:flex;align-items:baseline;gap:' + pt(10) + ';flex:none}',
    '.chd .lg{margin-left:auto;font-size:' + pt(13) + ';font-weight:500;color:' + v('ink-2') + ';white-space:nowrap}',
    '.ky{display:inline-flex;align-items:center;margin-left:' + pt(10) + '}',
    '.ky i{display:inline-block;width:' + pt(9) + ';height:' + pt(9) + ';border-radius:' + pt(2.5) + ';margin-right:' + pt(5) + '}',
    '.bars{display:block;width:100%;height:auto;overflow:visible;margin-top:auto;font-family:inherit}',
    '.bars .tx{font-size:13px;font-weight:600;fill:currentColor;opacity:.68;font-variant-numeric:tabular-nums}',
    '.bars .tx.dl{letter-spacing:.4px;opacity:.68}.bars .tx.now{opacity:1}',
    '@keyframes hvRise{from{transform:scaleY(.001)}}',
    '.bars.anim .b{transform-box:fill-box;transform-origin:50% 100%;animation:hvRise .6s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 14ms)}',
    '@media (prefers-reduced-motion:reduce){.bars.anim .b{animation:none}}',
    // THE RINGS beside their figures, the period's sentence over them
    '.rg{display:flex;align-items:center;gap:' + pt(22) + ';padding:' + pt(18) + ' ' + pt(20) + ' ' + pt(18) + ' ' + pt(18) + '}',
    '.rg .rings{width:' + pt(176) + ';height:' + pt(176) + ';flex:none;display:block}',
    '.rings .tick{fill:#fff;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}',
    '.rg .rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:' + pt(14) + '}',
    '.rg .lede{font-size:' + pt(17) + ';font-weight:600;line-height:' + pt(22) + ';letter-spacing:' + pt(-0.2) + '}',
    '.rg .lede em{font-style:normal;color:' + RING.energy + '}',
    '.rg .rf{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + pt(12) + ' ' + pt(14) + '}',
    '.rf>div{min-width:0}',
    '.rf .k{display:flex;align-items:center;gap:' + pt(6) + ';font-size:' + pt(13) + ';font-weight:600;line-height:' + pt(17) + ';color:' + v('ink-2') + '}',
    '.rf .k i{width:' + pt(9) + ';height:' + pt(9) + ';border-radius:50%;flex:none}',
    '.rf .n{font-size:' + pt(22) + ';font-weight:700;letter-spacing:' + pt(-0.4) + ';line-height:' + pt(27) + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
      'font-variant-numeric:tabular-nums}',
    '.rf .n small{font-size:' + pt(14) + ';font-weight:600;margin-left:' + pt(3) + ';color:' + v('ink-2') + '}',
    '.rf .o{font-size:' + pt(13) + ';line-height:' + pt(17) + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // Now: the house's watts over the last three hours
    '.hero{display:flex;flex-direction:column;padding:' + pt(18) + ' ' + pt(20) + '}',
    '.hero .top{display:flex;align-items:flex-end;justify-content:space-between;gap:' + pt(16) + ';margin-top:' + pt(6) + '}',
    '.hero .big{display:flex;align-items:baseline;gap:' + pt(6) + ';white-space:nowrap}',
    '.hero .giant{font-size:' + pt(56) + ';letter-spacing:' + pt(-2) + '}.hero .u{font-size:' + pt(22) + ';font-weight:600;color:' + v('ink-2') + '}',
    '.hero .hcap{font-size:' + pt(13) + ';line-height:' + pt(18) + ';color:' + v('ink-2') + ';text-align:right;padding-bottom:' + pt(6) + '}',
    '.hero svg.tr{display:block;width:100%;height:auto;margin-top:' + pt(10) + ';overflow:visible}',
    '.hero .ax{display:flex;justify-content:space-between;margin-top:' + pt(6) + ';font-size:' + pt(13) + ';font-weight:600;color:' + v('ink-2') + '}',
    // SENTENCES
    '.rw.sy{gap:' + pt(12) + ';min-height:' + pt(58) + ';padding:' + pt(10) + ' ' + pt(12) + ' ' + pt(10) + ' ' + pt(6) + '}',
    '.sy .ic{width:' + pt(32) + ';height:' + pt(32) + ';border-radius:50%;display:grid;place-items:center;flex:none}',
    '.sy .ic svg{width:' + pt(18) + ';height:' + pt(18) + '}',
    '.sy .tx{flex:1;min-width:0;font-size:' + pt(15) + ';font-weight:500;line-height:' + pt(20) + ';color:' + v('ink-2') + '}',
    '.sy .tx b{color:' + v('ink') + ';font-weight:600}.sy.alert .tx b{color:' + v('fail', '#ff6961') + '}',
    // A CIRCUIT OR A DEVICE
    '.rw.dv{min-height:' + pt(64) + ';padding-top:' + pt(9) + ';padding-bottom:' + pt(9) + '}',
    '.rw.dv>.g{width:' + pt(36) + '}',
    '.dv .st{display:flex;align-items:center;gap:' + pt(5) + '}',
    '.dv .sep{font-style:normal;color:' + v('ink-3') + '}',
    '.bk{display:inline-flex;align-items:center;gap:' + pt(3) + ';color:' + BATT + ';font-weight:600;flex:none}',
    '.dv .ub{display:block;align-self:flex-start;height:' + pt(4) + ';border-radius:' + pt(2) + ';margin-top:' + pt(6) + ';opacity:.9}',
    '.dv .val{font-size:' + pt(16) + ';font-weight:600;color:' + v('ink') + ';padding-left:' + pt(8) + '}',
    '.dv .val small{font-size:' + pt(13) + ';font-weight:500;color:' + v('ink-2') + '}',
    '.dv.off .nm,.dv.off .val{color:' + v('ink-2') + '}.dv.off>.g{opacity:.55}',
    '.rw.more{min-height:' + pt(52) + ';color:' + v('ink-2') + '}.rw.more .nm{color:' + v('ink-2') + '}',
    // A LEVEL OF A NUMBER (the battery's charge limit, reserve, charging speed): the kit's Wide level, dragged here
    '.nlv{touch-action:pan-y}.nlv .st{font-size:' + pt(14) + ';line-height:' + pt(19) + '}.nlv .st b{font-weight:700;color:' + v('ink') + '}',
    // THE MODE: the select's choices sharing the plate's width, what the chosen one does under them
    '.md{padding:' + pt(16) + '}',
    '.mseg{display:flex;height:' + pt(44) + ';padding:' + pt(3) + ';border-radius:' + pt(22) + ';background:' + v('key') + ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);' +
      'text-shadow:none}',
    '.mseg button{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;padding:0 ' + pt(8) + ';border-radius:' + pt(19) + ';font-size:' + pt(15) +
      ';font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + v('ink') + '}',
    '.mseg button.on{background:#fff;color:#1c1c1e}',
    '.mdesc{margin:' + pt(12) + ' ' + pt(4) + ' 0;font-size:' + pt(15) + ';line-height:' + pt(20) + ';color:' + v('ink-2') + '}',
    // THE HOUSE BATTERY: its ring and level, what it is doing, its facts two by two
    '.bh{display:flex;align-items:center;gap:' + pt(22) + ';padding:' + pt(18) + ' ' + pt(20) + ' ' + pt(18) + ' ' + pt(18) + '}',
    '.bh .ring{position:relative;width:' + pt(136) + ';height:' + pt(136) + ';flex:none;display:grid;place-items:center}',
    '.bh .ring svg{position:absolute;inset:0;width:100%;height:100%}',
    '.bh .ring b{position:relative;font-size:' + pt(36) + ';font-weight:700;letter-spacing:' + pt(-1) + ';font-variant-numeric:tabular-nums}',
    '.bh .ring b small{font-size:' + pt(17) + ';margin-left:' + pt(1) + '}',
    '.bh .rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:' + pt(12) + '}',
    '.bh .doing{font-size:' + pt(20) + ';font-weight:700;letter-spacing:' + pt(-0.3) + ';line-height:' + pt(24) + '}',
    '.bh .doing small{display:block;font-size:' + pt(15) + ';font-weight:500;line-height:' + pt(20) + ';color:' + v('ink-2') + ';letter-spacing:0;margin-top:' + pt(2) + '}',
    '.bh .facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + pt(10) + ' ' + pt(14) + ';padding-top:' + pt(12) + ';border-top:1px solid ' + v('line') + '}',
    '.facts .k{font-size:' + pt(13) + ';font-weight:600;line-height:' + pt(17) + ';color:' + v('ink-2') + '}',
    '.facts .n{font-size:' + pt(19) + ';font-weight:700;line-height:' + pt(24) + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.facts .n.ok{color:' + BATT + '}.facts .n.bad{color:' + v('fail', '#ff6961') + '}',
    // Power: the flow
    '.flow{position:relative}',
    '.flow svg.ln{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
    '.nd{position:absolute;display:flex;flex-direction:column;align-items:center;text-align:center;transform:translateX(-50%);white-space:nowrap}',
    '.nd .disc{display:flex;align-items:center;justify-content:center;border-radius:50%;position:relative}',
    '.nd .hl{margin-top:' + pt(8) + ';font-variant-numeric:tabular-nums}.nd .st{margin-top:' + pt(1) + '}',
    '.nd .disc .in{display:flex;flex-direction:column;align-items:center}',
    '.nd .disc .hw{font-size:' + pt(22) + ';font-weight:700;letter-spacing:' + pt(-0.5) + ';margin-top:' + pt(4) + ';font-variant-numeric:tabular-nums}',
    '.nd .disc svg.ring{position:absolute;inset:0;width:100%;height:100%}',
    '.nd .disc .pc{font-size:' + pt(22) + ';font-weight:700;font-variant-numeric:tabular-nums;position:relative}',
    '.nd .disc.lit{color:#1c1c1e}',
    // where the sun goes: a bar in parts, its legend
    '.sg{padding:' + pt(16) + ' ' + pt(18) + ';display:flex;flex-direction:column;gap:' + pt(14) + '}',
    '.sg .k{display:flex;justify-content:space-between;gap:' + pt(10) + ';font-size:' + pt(13) + ';font-weight:600;color:' + v('ink-2') + '}',
    '.sbar{display:flex;height:' + pt(14) + ';border-radius:' + pt(7) + ';overflow:hidden;background:' + v('key') + ';margin-top:' + pt(6) + ';gap:' + pt(2) + '}',
    '.sbar i{display:block;height:100%}',
    '.slg{display:flex;flex-wrap:wrap;gap:' + pt(4) + ' ' + pt(14) + ';margin-top:' + pt(8) + ';font-size:' + pt(13) + ';color:' + v('ink-2') + '}',
    '.slg span{display:inline-flex;align-items:center;gap:' + pt(5) + '}.slg i{width:' + pt(9) + ';height:' + pt(9) + ';border-radius:50%}',
    '.empty{display:flex;align-items:center;justify-content:center;flex:1;padding:' + pt(18) + ';text-align:center;font-size:' + pt(15) + ';color:' + v('ink-2') + '}'
  ].join('\n');

  // ------------------------------------------------------------------ the pages' base
  class HvEnergyBase extends H.Page {
    constructor() {
      super();
      this._seen = {};
      /** @type {any} */
      this._open = {};                             // the lists unfolded ("N More" tapped)
      /** @type {any} */
      this._rows = {};                             // the rows drawn, by key, for a tap
      /** @type {string[]} */
      this._ctl = [];                              // the controls drawn (their states are in the signature)
      /** @type {any} */
      this._nheld = {};                            // a level just dragged, or a mode just picked, held until it answers
      wireNumbers(this);
    }
    static get CSS() { return H.CSS + '\n' + CSS; }
    // THE SIGNATURE IS A CLOCK OF ITS OWN: a power sensor changes every few seconds and nobody reads watts that fast, so Now (and
    // Power) draw at most every five seconds, the periods once a minute; the statistics wake the card when they land, the
    // energy model's version moves when HA's settings arrive, and a control's own state (a circuit switched off) draws at once
    _sigOf() {
      if (!this.client) return null;
      var c = this.client, s = '', fast = this._fast ? this._fast() : false;
      for (var i = 0; i < this._ctl.length; i++) { var x = c.states[this._ctl[i]]; s += (x ? x.state : 'x') + ';'; }
      return (this._sigKey ? this._sigKey() : '') + '|' + (E ? E.EP.ver : 0) + '|' + Math.floor(Date.now() / (fast ? 5e3 : 60e3)) + '|' + s;
    }
    _fast() { return false; }
    _sigKey() { return ''; }
    // a control's state, read while drawing and kept in the signature
    /** @param {string} id */
    ctl(id) { if (id && this._ctl.indexOf(id) < 0) this._ctl.push(id); return this.st(id); }
    _render() { if (!this._dragging) this._ctl = []; super._render(); }
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
    // WHERE A DEVICE SITS: its sensor's or switch's area (the registries), unless its name already says it -- and none for a
    // sensor that shares its device with another in the list (a panel's or a monitor's circuits sit where the panel is)
    /** @param {string[]} ids @param {string} name @param {any} [shared] the devices with more than one of the list's sensors */
    _area(ids, name, shared) {
      var c = this.client || {}, ents = c.entities || {}, devs = c.devices || {}, areas = c.areas || {};
      for (var i = 0; i < ids.length; i++) {
        var e = ids[i] && ents[ids[i]];
        if (e && e.device_id && shared && shared.dev[e.device_id] > 1) return '';
        var a = e && (e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id));
        if (a && shared && !shared.any && shared.area[a] > 3) return '';
        var n = a && areas[a] && areas[a].name;
        if (n) return String(name).toLowerCase().indexOf(String(n).toLowerCase()) >= 0 ? '' : n;
      }
      return '';
    }
    // how many of these sensors sit on each device (a panel's circuits, a monitor's channels); where the registry names no
    // devices, how many in each area (more than three in one is a panel's room, not theirs)
    /** @param {string[]} ids */
    _shared(ids) {
      var ents = (this.client && this.client.entities) || {}, out = { dev: {}, area: {}, any: false };
      ids.forEach(function (id) {
        var e = id && ents[id];
        if (!e) return;
        if (e.device_id) { out.any = true; /** @type {any} */ (out.dev)[e.device_id] = (/** @type {any} */ (out.dev)[e.device_id] || 0) + 1; }
        if (e.area_id) /** @type {any} */ (out.area)[e.area_id] = (/** @type {any} */ (out.area)[e.area_id] || 0) + 1;
      });
      return out;
    }
    // A ROW TAPPED: a circuit's or a device's switch asks first, in the house's own confirm sheet, what it is drawing and whether
    // the battery backs it up; one with no switch (or a switch that does not answer) opens its sheet
    /** @param {any} x { name, ctl, w, backed, sheet, what } */
    _rowTap(x) {
      var st = x.ctl && this.client && this.client.states[x.ctl], C = H.C, self = this;
      if (!x.ctl || gone(st) || !C.confirmSheet) { if (x.sheet) window.hkShell.moreInfo(x.sheet, this); return; }
      var on = st.state === 'on', dom = String(x.ctl).split('.')[0];
      var say = (on ? (x.w != null ? 'Drawing ' + wtext(x.w) + ' now. ' : '') : 'Off now. ') +
        (x.backed ? 'On the battery’s backup.' : x.backed === false ? 'Not on the battery’s backup.' : '');
      if (on && x.what) say = x.what + ' ' + say;
      C.confirmSheet(on && x.ask ? x.ask : (on ? 'Turn off ' : 'Turn on ') + x.name + '?', function () {
        self._call(dom === 'switch' || dom === 'light' || dom === 'fan' ? dom : 'homeassistant', on ? 'turn_off' : 'turn_on', { entity_id: x.ctl });
      }, { yes: x.yes && on ? x.yes : on ? 'Turn Off' : 'Turn On', destructive: on, detail: say.trim() });
    }
    /** @param {string} act @param {any} el @param {any} ev */
    act(act, el, ev) {
      var k = el.getAttribute('data-k');
      if (act === 'dev') { var x = this._rows[k]; if (x) this._rowTap(x); return true; }
      if (act === 'fold') { this._open[k] = true; this.redraw(); return true; }
      if (act === 'pick') { this._pick(el.getAttribute('data-id'), k); return true; }
      return false;
    }
    // A MODE CHOSEN: shown at once, then asked of the select; back to the select's own state after 4 s if it never takes
    /** @param {string} id @param {string} val */
    _pick(id, val) {
      var st = this.client && this.client.states[id];
      if (!st || st.state === val) return;
      var dom = id.split('.')[0];
      this._nheld[id] = { v: val, until: Date.now() + 4000 };
      this.redraw();
      var self = this;
      setTimeout(function () { self.redraw(); }, 4100);
      this._call(dom === 'input_select' ? 'input_select' : 'select', 'select_option', { entity_id: id, option: val });
    }
    // THE MODE (a select): its choices as one segmented control the plate's width, what the chosen one does under it
    /** @param {any} m { entity, options: [{ value, name, description }] } */
    _mode(m) {
      var st = this.ctl(m.entity), held = this._nheld[m.entity];
      if (gone(st)) return H.plate({ cls: 'c4 md', act: 'sheet', data: { id: m.entity } }, '<div class="mdesc" style="margin-top:0">No response from the mode.</div>');
      var cur = held && Date.now() < held.until && held.v !== st.state ? held.v : st.state;
      var opts = m.options && m.options.length ? m.options : ((st.attributes || {}).options || []).map(function (/** @type {string} */ o) {
        return { value: o, name: H.sentence(o).replace(/\b\w/g, function (/** @type {string} */ c) { return c.toUpperCase(); }) };
      });
      var on = opts.filter(function (/** @type {any} */ o) { return o.value === cur; })[0];
      return H.plate({ cls: 'c4 md' }, '<div class="mseg" role="radiogroup" aria-label="Mode">' + opts.map(function (/** @type {any} */ o) {
        return '<button role="radio" aria-checked="' + (o.value === cur) + '" class="' + (o.value === cur ? 'on' : '') + '" data-act="pick" data-id="' + esc(m.entity) +
          '" data-k="' + esc(o.value) + '">' + esc(o.name || o.value) + '</button>';
      }).join('') + '</div><div class="mdesc">' + esc(on ? on.description || '' : H.sentence(cur)) + '</div>');
    }
    // A LEVEL OF A NUMBER (Wide): the kit's level, its fill the value's share of the scale (a % of 100, else of its max), the
    // value at the right; dragged across (wireNumbers), sent once on letting go and held 2.5 s for the device to answer
    /** @param {any} l { entity, name, icon, color } */
    _numLevel(l) {
      var st = this.ctl(l.entity), a = (st && st.attributes) || {}, n = num(this, l.entity), held = this._nheld[l.entity];
      if (held && Date.now() < held.until) n = held.v;
      var unit = String(a.unit_of_measurement || ''), full = unit === '%' ? 100 : Number(a.max) || 100, ok = n != null && !gone(st);
      var col = H.hue(l.color || 'green'), p = ok ? Math.round(100 * clamp(/** @type {number} */ (n) / full)) : 0;
      var word = !ok ? 'No Response' : numWord(/** @type {number} */ (n), unit);
      // (the range beside the value: "90% · 80–100%"; the name keeps the line above to itself, the Wide tile too narrow for both)
      var range = a.min != null && a.max != null ? (unit === 'W' ? fx(a.min / 1000, 1) + '–' + wtext(a.max) : fx(a.min, 0) + '–' + fx(a.max, 0) + (unit === '%' ? '%' : '')) : '';
      return '<div class="pl lv nlv c2' + (ok ? ' lit' : '') + '" role="slider" tabindex="0" aria-valuemin="' + esc(a.min) + '" aria-valuemax="' + esc(a.max) + '" aria-valuenow="' +
        esc(n) + '" aria-label="' + esc(l.name) + '" data-nlv="' + esc(l.entity) + '" style="--v:' + p + '%;--f:' + wash(col) + '">' +
        '<i class="fill"></i><div class="row"><span class="tg" data-act="sheet" data-id="' + esc(l.entity) + '">' + H.glyph(l.icon || 'hk:battery-arrow-up-outline', 28, ok ? H.DEEP[l.color] ||
          col : col) + '</span><div class="words" data-act="sheet" data-id="' + esc(l.entity) + '"><div class="nm">' + esc(l.name) + '</div><div class="st"><b class="nv">' + esc(word) +
        '</b>' + (ok && range ? ' · ' + esc(range) : '') + '</div></div></div></div>';
    }
  }

  // A NUMBER'S LEVEL DRAGGED (the kit's level drag, for a number: its min, max and step): across sets it, relative to where the
  // finger lands; a drag that starts up or down is the page's scroll. While a finger is on it the page draws nothing.
  /** @param {any} card */
  function wireNumbers(card) {
    var root = card._root, s = /** @type {any} */ (null);
    /** @param {string} id */
    var spec = function (id) {
      var st = card.client && card.client.states[id], a = (st && st.attributes) || {}, n = st ? Number(st.state) : NaN;
      if (gone(st) || !isFinite(n)) return null;
      var unit = String(a.unit_of_measurement || ''), max = Number(a.max), min = Number(a.min);
      return { v: n, min: isFinite(min) ? min : 0, max: isFinite(max) ? max : 100, step: Number(a.step) || 1, full: unit === '%' ? 100 : isFinite(max) ? max : 100, unit: unit };
    };
    /** @param {any} sp @param {number} f */
    var valueAt = function (sp, f) { var x = Math.round(f * sp.full / sp.step) * sp.step; return Math.max(sp.min, Math.min(sp.max, +x.toFixed(4))); };
    /** @param {any} el @param {any} sp @param {number} x */
    var paint = function (el, sp, x) {
      el.style.setProperty('--v', Math.round(100 * clamp(x / sp.full)) + '%');
      var pc = el.querySelector('.nv');
      if (pc) pc.textContent = numWord(x, sp.unit);
      el.setAttribute('aria-valuenow', String(x));
    };
    /** @param {string} id @param {number} x */
    var send = function (id, x) {
      card._nheld[id] = { v: x, until: Date.now() + 2500 };
      setTimeout(function () { card.redraw(); }, 2600);
      card._call('number', 'set_value', { entity_id: id, value: x }).then(function (/** @type {boolean} */ good) { if (!good) { delete card._nheld[id]; card.redraw(); } });
    };
    root.addEventListener('pointerdown', function (/** @type {PointerEvent} */ ev) {
      if (ev.button > 0) return;
      var t = /** @type {any} */ (ev.target), el = t && t.closest ? t.closest('.nlv') : null;
      if (!el) return;
      var id = el.getAttribute('data-nlv'), sp = spec(id);
      if (!sp) return;
      var r = el.getBoundingClientRect();
      s = { el: el, id: id, sp: sp, x: ev.clientX, y: ev.clientY, w: Math.max(1, r.width), x0: sp.v, v: null, moved: false, side: false, pid: ev.pointerId };
    });
    root.addEventListener('pointermove', function (/** @type {PointerEvent} */ ev) {
      if (!s || ev.pointerId !== s.pid || s.side) return;
      var dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      if (!s.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) { s.side = true; return; }
        s.moved = true;
        card._dragging = true;
        s.el.classList.add('drag');
        try { s.el.setPointerCapture(ev.pointerId); } catch (x) { /* a test page */ }
      }
      ev.preventDefault();
      s.v = valueAt(s.sp, clamp(s.x0 / s.sp.full + dx / s.w));
      paint(s.el, s.sp, s.v);
    });
    /** @param {PointerEvent} ev @param {boolean} ok */
    var end = function (ev, ok) {
      if (!s || ev.pointerId !== s.pid) return;
      var d = s; s = null;
      if (!d.moved) return;
      card._eat = ok; setTimeout(function () { card._eat = false; }, 0);
      d.el.classList.remove('drag');
      card._dragging = false;
      if (ok && d.v != null && d.v !== d.x0) send(d.id, d.v);
      if (card._pending) { card._pending = false; card.redraw(); }
    };
    root.addEventListener('pointerup', function (/** @type {PointerEvent} */ ev) { end(ev, true); });
    root.addEventListener('pointercancel', function (/** @type {PointerEvent} */ ev) { end(ev, false); });
    root.addEventListener('keydown', function (/** @type {KeyboardEvent} */ ev) {
      var el = /** @type {any} */ (ev.target);
      if (!el || !el.classList || !el.classList.contains('nlv')) return;
      var id = el.getAttribute('data-nlv'), sp = spec(id), k = ev.key;
      if (!sp || ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].indexOf(k) < 0) return;
      ev.preventDefault();
      var up = k === 'ArrowUp' || k === 'ArrowRight', step = sp.unit === '%' ? Math.max(sp.step, 5) : sp.step;
      var x = Math.max(sp.min, Math.min(sp.max, sp.v + (up ? step : -step)));
      if (x !== sp.v) send(id, x);
    });
  }

  // ------------------------------------------------------------------ the sums each page reads
  // THE RINGS of a period (the Energy page's hero, hk-energy-page.js ringsOf): Energy, Cost, Solar, Water, Gas where the house
  // has them (the plan's choice, four at most), each against a usual period
  /** @param {any} M @param {any} R */
  function ringsOf(M, R) {
    var all = { energy: true, cost: M.hasCost, solar: M.src.solar.length > 0, water: M.src.water.ids.length > 0, gas: M.src.gas.ids.length > 0 };
    var want = Array.isArray(M.rings) && M.rings.length ? M.rings : ['energy', 'cost', 'solar', 'water', 'gas'];
    return want.filter(function (/** @type {string} */ k) { return /** @type {any} */ (all)[k]; }).slice(0, 4).map(function (/** @type {string} */ k) {
      var val = k === 'energy' ? R.home : k === 'cost' ? R.cost : R[k], typ = (k === 'energy' ? R.typ.home : R.typ[k]) * R.n;
      return { key: k, c: /** @type {any} */ (RING)[k], v: val, typ: typ, f: typ > 0 ? val / typ : 0 };
    });
  }
  // a usual day's step (the Your Month calendar's: well below .. well above)
  /** @param {number} r */
  function above(r) { return r >= 1.07; }
  /** @param {number} r */
  function below(r) { return r < 0.93; }
  // THE SPLIT (hk-energy-power.js powerSplit, Home Assistant's own order): the sun first to what is sold, then the battery,
  // then the house; the grid makes up what the battery took beyond the sun; the battery gives the rest. Watts, each >= 0.
  /** @param {any} r */
  function powerSplit(r) {
    var solar = Math.max(0, r.solar || 0), imp = Math.max(0, r.imp || 0), exp = Math.max(0, r.exp || 0), bc = Math.max(0, r.bc || 0), bd = Math.max(0, r.bd || 0);
    var home = r.home != null ? Math.max(0, r.home) : Math.max(0, imp - exp + solar + bd - bc);
    var s2g = Math.min(solar, exp), s2b = Math.min(solar - s2g, bc), s2h = Math.max(0, solar - s2g - s2b);
    var g2b = Math.max(0, bc - s2b), g2h = Math.max(0, imp - g2b), b2h = Math.max(0, bd - Math.max(0, exp - s2g));
    var all = s2h + g2h + b2h, mix = all > 0 ? { sun: s2h / all, grid: g2h / all, batt: b2h / all } : { sun: 0, grid: 0, batt: 0 };
    var main = 'grid';
    ['sun', 'batt'].forEach(function (k) { if (/** @type {any} */ (mix)[k] > /** @type {any} */ (mix)[main]) main = k; });
    return { home: home, s2g: s2g, s2b: s2b, s2h: s2h, g2b: g2b, g2h: g2h, b2h: b2h, mix: mix, main: all > 0 ? main : null };
  }
  // the kinds of section the Energy plan guesses, as the second line of a row
  var KIND = { hvac: 'Heating & Cooling', rooms: 'Room Circuit', appliances: 'Appliance', outlets: 'Outlets', charging: 'Charging', other: 'Other' };
  // the Power plan's own word for each device: backed up or not, and why (power.py `backed`, `why`), by its key
  /** @param {any} W */
  function backedBy(W) {
    var out = {};
    if (!W || W.backs_up === 'none' || !W.battery) return out;
    (W.sections || []).forEach(function (/** @type {any} */ s) {
      (s.items || []).forEach(function (/** @type {any} */ i) { /** @type {any} */ (out)[i.key] = { backed: !!i.backed, why: i.why || '', section: s.id }; });
    });
    return out;
  }

  // =================================================================== ENERGY
  var MODES = [{ k: 'now', t: 'Now' }, { k: 'day', t: 'Today' }, { k: 'week', t: 'Week' }, { k: 'month', t: 'Month' }];
  var SHOWN = 10;                                  // a list's rows before "N More"

  class HvEnergy extends HvEnergyBase {
    _per() {
      var m = this.mode();
      if (m) return m;
      var P0 = plan(), o = P0 && P0.page && P0.page.opens_on;
      return ['now', 'day', 'week', 'month'].indexOf(o) >= 0 ? o : 'day';
    }
    _fast() { return this._per() === 'now'; }
    _sigKey() { return this._per(); }
    draw() {
      var per = this._per(), title = (this._config || {}).title || 'Energy';
      /** @param {string} s */
      var head = function (s) { return H.head({ title: title, sum: s, right: H.seg(MODES, per, 'mode') }); };
      this._rows = {};
      var Ek = energy(this);
      if (!Ek) return head('') + quiet(failed ? 'Energy is not available on this screen.' : 'Loading…');
      if (!Ek.plan()) return head('') + quiet('Energy is not set up. Add it in ' + H.where('Pages → Energy') + '.');
      var M = Ek.model(this.client, this);
      if (!M) return head('') + quiet('Loading…');
      var D = M.ids.length ? Ek.series(this.client, this, M) : null;
      var R = D ? Ek.calcFor(M, D, per === 'now' ? 'day' : per, Ek.runtimes(this.client, this, M)) : null;
      if (per === 'now') return this._now(head, Ek, M, D, R);
      if (!M.ids.length) return head('') + quiet('No energy meters yet. Add them in Home Assistant’s Energy settings.');
      if (!D) return head('') + quiet('Loading…');
      if (!R) return head('') + quiet('No history yet.');
      if ((per === 'week' || per === 'month') && !R.has) return head('') + quiet('No history for ' + Ek.whenOf(per, R) + ' yet.');
      return this._period(per, head, Ek, M, D, R);
    }

    // ---------------------------------------------------------------- Now
    // THE HOUSE THIS MINUTE: its watts and the last three hours, where they come from (the grid, the battery, the sun), every
    // circuit and device drawing now; then today's rings, Your Day and what stood out
    /** @param {(s: string) => string} head @param {any} Ek @param {any} M @param {any} D @param {any} R */
    _now(head, Ek, M, D, R) {
      var self = this, P0 = M.P, W = P0.power || {}, B = W.battery || {}, T = M.total;
      var tw = T.power ? pw(this, T.power) : null;
      if (tw == null && W.home) tw = pw(this, W.home);
      var asKw = tw != null && tw >= 1000, hp = tw == null ? null : wparts(tw, asKw);
      var out = head(tw == null ? (R ? '<b>' + kwh(R.home) + '</b> kWh today' : 'No Reading') : '<b>' + hp[0] + '</b> ' + hp[1]);
      // ---- the house's watts, the last three hours
      var hero = '<div class="lbl">Using Now</div>';
      if (hp) {
        var five = Ek.live(this.client, this, M), id = T.power || W.home, row = five && five[id];
        var k = /^kw$/i.test(String(((this.st(id) || {}).attributes || {}).unit_of_measurement || '')) ? 1000 : 1;
        var tr = row ? row.map(function (/** @type {any} */ p) { return typeof p.v === 'number' ? p.v * k : null; }) : [];
        if (tr.length) tr.push(tw);                // (the line reaches now: the open buckets at its end are skipped, the reading now is its last point)
        var got = tr.filter(function (/** @type {any} */ z) { return typeof z === 'number'; }), avg = got.length ? sum(got) / got.length : null;
        var cap = (avg != null ? (tw > avg * 1.3 ? 'Above' : tw < avg * 0.7 ? 'Below' : 'About') + ' its 3-hour average, ' + wtext(avg) + '<br>' : '') +
          (R ? kwh(R.home) + ' kWh so far today' : '');
        var now = Date.now();
        hero += '<div class="top"><div class="big"><span class="giant">' + hp[0] + '</span><span class="u">' + hp[1] + '</span></div><div class="hcap">' + cap + '</div></div>' +
          (tr.length ? '<svg class="tr" viewBox="0 0 476 84" role="img" aria-label="The house’s power over the last three hours">' + traceSvg(tr, 476, 84, RING.energy) + '</svg>' +
            '<div class="ax"><span>' + esc(hourName(now - 3 * 36e5, true)) + '</span><span>' + esc(hourName(now - 2 * 36e5, true)) + '</span><span>' +
            esc(hourName(now - 36e5, true)) + '</span><span>Now</span></div>' : '<div class="empty">' + (five ? 'No history for the last three hours.' : 'Loading…') + '</div>');
        out += '<div class="stk">' + H.plate({ cls: 'hero', act: 'sheet', data: { id: id }, label: 'Using now, ' + hp.join(' ') }, hero) + '</div>';
      } else if (R && D) {
        // NO WHOLE-HOME POWER SENSOR: today so far, by hour
        out += '<div class="grid">' + this._dayChart(Ek, M, D, R, 'Today So Far') + '</div>';
      }
      // ---- where it comes from now: the grid, the battery, the sun
      var src = [];
      if (W.grid) {
        var g = pw(this, W.grid), gx = W.grid_export ? pw(this, W.grid_export) : null, imp = g == null ? 0 : Math.max(0, g), exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0;
        var down = W.grid_status ? reading(this, W.grid_status) === 'off' : false;
        src.push({ g: ig('tower', 16, gcol(down ? RED : GRID_G, down)), label: exp > 5 && !down ? 'To the Grid' : 'From the Grid', id: W.grid, tone: down ? 'bad' : '',
                   fig: down ? 'Down' : g == null ? '—' : wparts(exp > 5 ? exp : imp)[0], unit: down || g == null ? '' : wparts(exp > 5 ? exp : imp)[1],
                   sub: down ? 'The house is on the battery' : g == null ? 'No reading' : exp > 5 ? 'Sending back' : imp > 5 ? 'Bringing in' : 'Idle' });
      }
      if (B.level) {
        var lv = num(this, B.level), bc = pw(this, B.charge) || 0, bd = pw(this, B.discharge) || 0, bw = bc > 5 ? bc : bd > 5 ? -bd : 0;
        src.push({ g: ig('batt', 16, gcol(BATT, bw !== 0)), label: 'House Battery', id: B.level, fig: lv == null ? '—' : fx(lv, 0) + '%',
                   sub: lv == null ? 'No response' : bw > 0 ? 'Charging, ' + wtext(bw) : bw < 0 ? 'Powering the house, ' + wtext(-bw) : 'Standing by' });
      }
      if (W.solar) {
        var sun = pw(this, W.solar);
        src.push({ g: ig('sun', 16, gcol(SOLAR_G, (sun || 0) > 20)), label: 'Solar', id: W.solar, fig: sun == null ? '—' : wparts(Math.max(0, sun))[0],
                   unit: sun == null ? '' : wparts(Math.max(0, sun))[1], sub: sun == null ? 'No reading' : sun > 20 ? 'Making power' : 'Idle' });
      }
      if (R && R.solar > 0.05 && !W.solar) src.push({ g: ig('sun', 16, gcol(SOLAR_G)), label: 'Solar Today', fig: kwh(R.solar), unit: 'kWh', id: M.src.solar[0] });
      if (src.length === 1 && R) src.push({ g: ig('cal', 16, gcol(GRID_G)), label: 'Today So Far', fig: kwh(R.home), unit: 'kWh', sub: 'Since midnight' });
      out += figGrid(src);
      if (!hp && !src.length && !M.devs.length) return out + quiet('No power sensors yet. Add devices with a power sensor in ' + H.where('Energy') + '.');
      // ---- every circuit and device, watts now
      out += this._devices(Ek, M, R, 'now', 'Drawing Now');
      // ---- today's rings, Your Day, what stood out
      if (R && D) {
        out += H.section('Today', '<b>' + kwh(R.home) + '</b> kWh so far') + this._rings(Ek, M, R, 'day');
        out += this._yours(Ek, M, D, R, 'day');
        var hl = Ek.highlights(M, Object.assign({}, R, { per: 'now' }), this.client, function (/** @type {number} */ x, /** @type {number} */ d) { return money(self, x, d); });
        if (hl.length) out += H.section('What Stood Out') + sayList(hl.map(function (/** @type {any} */ h) { return { ic: h.ic, c: h.c, t: h.t, more: h.more || null }; }));
      } else if (M.ids.length) {
        out += H.section('Today') + quiet('Loading…');
      }
      return out;
    }

    // ---------------------------------------------------------------- Today, Week, Month
    /** @param {string} per @param {(s: string) => string} head @param {any} Ek @param {any} M @param {any} D @param {any} R */
    _period(per, head, Ek, M, D, R) {
      var self = this, isDay = per === 'day', hasSolar = M.src.solar.length > 0;
      var out = head('<b>' + kwh(R.home) + '</b> kWh' + (R.cur === false ? ' ' + esc(Ek.whenOf(per, R)) : ''));
      // ---- the rings, and the period's figures beside them
      out += this._rings(Ek, M, R, per);
      // ---- the chart
      var anim = this._anim(per), chart;
      /** @param {any} ser @param {number} i */
      var segsOf = function (ser, i) {
        var home = Ek.homeAt(M, ser, i), sn = hasSolar ? Math.min(Ek.vs(ser, M.src.solar, i), home) : 0;
        return [{ v: sn, c: SOLAR }, { v: Math.max(0, home - sn), c: USED }];
      };
      var legend = key(USED, 'Used') + (hasSolar ? key(SOLAR, 'Solar') : '');
      if (isDay) {
        chart = this._dayChart(Ek, M, D, R, 'By Hour');
      } else if (per === 'week') {
        var cols = R.slots.map(function (/** @type {any} */ i, /** @type {number} */ k) {
          var g = R.ghosts[k];
          return { v: i == null ? null : Ek.homeAt(M, D.d, i), label: dayShort(R.dates[k]), now: k === R.todayK, ghost: g != null ? Ek.homeAt(M, D.d, g) : 0 };
        });
        chart = chartPlate('By Day', key(USED, 'Used') + (R.cur ? key('rgba(255,255,255,.3)', 'Last Week') : ''), colsSvg(cols, { H: 104, anim: anim, aria: 'Energy used each day this week' }));
      } else {
        var F = window.hkStats.fields;
        var mbars = R.slots.map(function (/** @type {any} */ i, /** @type {number} */ k) {
          var day = F(R.dates[k]).day, g = R.ghosts[k];
          return { segs: i == null ? [] : segsOf(D.d, i), ghost: i == null && g != null ? Ek.homeAt(M, D.d, g) : 0, label: (day - 1) % 7 === 0 ? String(day) : '' };
        });
        chart = chartPlate('By Day', legend + (R.cur ? key('rgba(255,255,255,.3)', 'Last Month') : ''), barsSvg(mbars, { W: 476, H: 128, anim: anim, aria: 'Energy used each day this month' }));
      }
      // ---- where it came from: the grid, the battery, the sun, and the period before
      /** @param {string[]} ids */
      var useSum = function (ids) { return sum(R.idx.map(function (/** @type {number} */ i) { return Ek.vs(R.ser, ids, i); })); };
      var figs = [];
      if (M.src.imp.length) {
        var gin = useSum(M.src.imp), gout = M.src.exp.length ? useSum(M.src.exp) : 0;
        figs.push({ g: ig('tower', 16, gcol(GRID_G)), label: 'From the Grid', fig: kwh(gin), unit: 'kWh', id: M.src.imp[0],
                    sub: gout > 0.05 ? 'Sent back ' + kwh(gout) + ' kWh' : M.hasCost ? 'About ' + money(this, R.cost, isDay ? 2 : 0) : 'Bought ' + esc(Ek.whenOf(per, R)) });
      }
      if (M.src.battery || M.src.into.length) {
        figs.push({ g: ig('batt', 16, gcol(BATT)), label: 'Into the Battery', fig: kwh(R.into), unit: 'kWh', id: M.house && M.house.entity,
                    sub: R.out > 0.05 ? 'Gave back ' + kwh(R.out) + ' kWh' : 'The house hasn’t drawn on it' });
      }
      if (hasSolar) figs.push({ g: ig('sun', 16, gcol(SOLAR_G)), label: 'Solar', fig: kwh(R.solar), unit: 'kWh', id: M.src.solar[0], sub: 'Made ' + Ek.whenOf(per, R) });
      if (isDay) {
        var yT = sum(R.hYday.map(function (/** @type {number} */ i) { return Ek.homeAt(M, D.h, i); }));
        if (yT > 0.05) figs.push({ g: ig('cal', 16, gcol(GRID_G)), label: 'Yesterday', fig: kwh(yT), unit: 'kWh', sub: 'By this time, ' + kwh(yT * R.share) + ' kWh' });
      } else if (R.prev && R.prev.has && R.prev.home > 0) {
        var dp = Math.round(100 * (R.home - R.prev.home) / R.prev.home), wk = per === 'week' ? 'Week' : 'Month';
        figs.push({ g: ig('cal', 16, gcol(GRID_G)), label: R.cur ? 'Last ' + wk + ' by Now' : 'The ' + wk + ' Before', fig: kwh(R.prev.home), unit: 'kWh',
                    sub: Math.abs(dp) < 3 ? 'About the same' : Math.abs(dp) + '% ' + (dp < 0 ? 'less' : 'more') + ' ' + (R.cur ? 'this ' + wk.toLowerCase() : 'than it') });
      }
      // (an odd one out: a usual period beside it, so the row is whole)
      if (figs.length % 2 && R.typ.home > 0) {
        figs.push({ g: ig('clock', 16, gcol(BLUE)), label: isDay ? 'A Usual Day' : 'A Usual ' + (per === 'week' ? 'Week' : 'Month'), fig: kwh(R.typ.home * R.n), unit: 'kWh',
                    sub: 'From the ' + R.tw.length + ' days before' });
      }
      out += '<div class="grid">' + chart + '</div>' + figGrid(figs);
      // ---- every circuit and device, the period's kWh
      out += this._devices(Ek, M, R, per, 'Circuits & Devices');
      // ---- your day (week, month)
      out += this._yours(Ek, M, D, R, per);
      // ---- what stood out
      var hl = Ek.highlights(M, R, this.client, function (/** @type {number} */ x, /** @type {number} */ d) { return money(self, x, d); });
      if (hl.length) out += H.section('What Stood Out', esc(Ek.whenOf(per, R))) + sayList(hl.map(function (/** @type {any} */ h) { return { ic: h.ic, c: h.c, t: h.t, more: h.more || null }; }));
      // ---- this week (Today's last section): the last seven days
      if (isDay) out += this._week(Ek, M, D);
      return out;
    }

    // TODAY BY HOUR: what each hour used (the sun's part yellow), the hours still to come yesterday's, in gray
    /** @param {any} Ek @param {any} M @param {any} D @param {any} R @param {string} label */
    _dayChart(Ek, M, D, R, label) {
      var hasSolar = M.src.solar.length > 0, bars = [];
      for (var k = 0; k < 24; k++) {
        var lb = k === 0 || k === 6 || k === 12 || k === 18 || k === 23;
        var bar = { label: lb ? hourName(R.today0 + k * 36e5) : '', anchor: k === 0 ? 'start' : k === 23 ? 'end' : 'middle', segs: /** @type {any[]} */ ([]), ghost: 0 };
        if (k < R.hToday.length) {
          var i = R.hToday[k], home = Ek.homeAt(M, D.h, i), sn = hasSolar ? Math.min(Ek.vs(D.h, M.src.solar, i), home) : 0;
          bar.segs = [{ v: sn, c: SOLAR }, { v: Math.max(0, home - sn), c: USED }];
        } else if (R.hYday[k] != null) bar.ghost = Ek.homeAt(M, D.h, R.hYday[k]);
        bars.push(bar);
      }
      return chartPlate(label, key(USED, 'Used') + (hasSolar ? key(SOLAR, 'Solar') : '') + key('rgba(255,255,255,.3)', 'Yesterday'),
        barsSvg(bars, { W: 476, H: 128, anim: this._anim('day'), aria: 'Energy used each hour today' }));
    }

    // THE RINGS (the Energy page's hero): each ring the period so far against a usual one, a white dot where the usual would be
    // by now; beside them the period in a sentence and each ring's figure "of a usual" one
    /** @param {any} Ek @param {any} M @param {any} R @param {string} per */
    _rings(Ek, M, R, per) {
      var self = this, rings = ringsOf(M, R), EN = window.hkEnergy, day = per === 'day';
      if (!rings.length || !EN || !EN.ringSvg) return '';
      var tick = day ? R.share : R.cur ? R.days / R.n : 0;
      var list = rings.map(function (r) { return { key: r.key, c: r.c, f: r.f, tick: r.typ > 0 && tick > 0 && tick < 1 ? tick : null }; });
      var svg = EN.ringSvg(list, null, 0);
      // AGAINST USUAL: today's pace against a usual day; a week or a month so far against a usual one's pace (a whole one, once past)
      var when = Ek.whenOf(per, R), base = R.typ.home * (day ? 1 : R.days), gotE = day ? R.proj : R.home;
      var vsT = base > 0 ? Math.round(100 * (gotE - base) / base) : 0;
      var cmp = Math.abs(vsT) < 6 ? (day ? 'about a usual day' : 'about usual') : Math.abs(vsT) + '% ' + (vsT < 0 ? 'below' : 'above') + (day ? ' a usual day' : ' usual');
      var lede;
      if (R.typ.home <= 0) lede = 'Learning your usual: there isn’t a day of history yet.';
      else if (day || R.cur) {
        lede = (day ? 'On pace for ' : 'Heading for ') + '<em>' + fx(R.proj, 0) + ' kWh</em> ' + esc(when) + ', ' + cmp + (M.hasCost ? ', about ' + money(this, R.projCost, day ? 2 : 0) : '') + '.';
        if (!day && R.whole === 0 && R.share < 0.5 && R.prev && R.prev.allHome > 0) {
          lede = 'The ' + (per === 'week' ? 'week' : 'month') + ' has just started: <em>' + kwh(R.home) + ' kWh</em> so far.';
        }
      } else lede = 'Used <em>' + fx(R.home, 0) + ' kWh</em> ' + esc(when) + ', ' + cmp + (M.hasCost ? ', ' + money(this, R.cost, 0) : '') + '.';
      var figs = rings.map(function (r) {
        var water = r.key === 'water' || r.key === 'gas', unit = r.key === 'cost' ? '' : water ? Ek.unitOf(self.client, M.src[r.key].ids[0]) : 'kWh';
        var val = r.key === 'cost' ? money(self, r.v, 2) : water ? fx(r.v, 0) : kwh(r.v);
        var typ = r.key === 'cost' ? money(self, r.typ, day ? 2 : 0) : fx(r.typ, r.typ >= 100 || water ? 0 : 1);
        return '<div><div class="k"><i style="background:' + r.c + '"></i>' + /** @type {any} */ (RING_NAME)[r.key] + '</div><div class="n">' + esc(val) +
          (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div><div class="o">' + (r.typ > 0 ? 'of a usual ' + esc(typ) : 'Learning its usual') + '</div></div>';
      }).join('');
      return '<div class="stk">' + H.plate({ cls: 'rg' }, svg + '<div class="rt"><div class="lede">' + lede + '</div><div class="rf">' + figs + '</div></div>') + '</div>';
    }

    // YOUR DAY (WEEK, MONTH): the Your Day card's own figures -- the busiest and quietest hour or day, a usual day by now,
    // where the period is heading and what it costs
    /** @param {any} Ek @param {any} M @param {any} D @param {any} R @param {string} per */
    _yours(Ek, M, D, R, per) {
      var self = this, us = R.typ.home, tiles = [], cost = M.hasCost ? function (/** @type {number} */ x, /** @type {number} */ d) { return money(self, x, d); } : null;
      var heading = cost ? 'About ' + cost(R.projCost, per === 'day' ? 2 : 0) : 'A usual ' + (per === 'day' ? 'day' : per) + ': ' + fx(us * R.n, 0) + ' kWh';
      if (per === 'day') {
        var vals = R.hToday.map(function (/** @type {number} */ i) { return Ek.homeAt(M, D.h, i); });
        var bi = vals.indexOf(Math.max.apply(null, vals.concat([0]))), qi = -1, qv = Infinity;
        vals.forEach(function (/** @type {number} */ z, /** @type {number} */ i) { if (i < vals.length - 1 && z < qv) { qv = z; qi = i; } });
        if (bi >= 0 && vals[bi] > 0) tiles.push({ g: ig('up', 16, gcol(AMBER)), label: 'Busiest Hour', fig: esc(hourName(R.ax.h[R.hToday[bi]].t)), sub: kwh(vals[bi]) + ' kWh' });
        if (qi >= 0) tiles.push({ g: ig('down', 16, gcol(BATT)), label: 'Quietest Hour', fig: esc(hourName(R.ax.h[R.hToday[qi]].t)), sub: kwh(qv) + ' kWh' });
        if (us > 0) tiles.push({ g: ig('clock', 16, gcol(BLUE)), label: 'A Usual Day by Now', fig: kwh(us * R.share), unit: 'kWh', sub: 'Today so far, ' + kwh(R.home) + ' kWh' });
        if (us > 0) tiles.push({ g: ig('pace', 16, gcol(RING.energy)), label: 'On Pace For', fig: fx(R.proj, 0), unit: 'kWh', sub: heading });
        return tiles.length ? H.section('Your Day') + figGrid(tiles) : '';
      }
      var slots = R.slots, wv = slots.map(function (/** @type {any} */ i) { return i == null ? null : Ek.homeAt(M, D.d, i); });
      var have = [], whole = [];
      slots.forEach(function (/** @type {any} */ i, /** @type {number} */ k) { if (i != null) { have.push(k); if (k !== R.todayK) whole.push(k); } });
      /** @param {number[]} ks @param {boolean} big */
      var pick = function (ks, big) { return ks.reduce(function (a, k) { return a < 0 || (big ? wv[k] > wv[a] : wv[k] < wv[a]) ? k : a; }, -1); };
      var nm = per === 'week' ? function (/** @type {number} */ k) { return weekday(R.dates[k]); } : function (/** @type {number} */ k) { return dateShort(R.dates[k]); };
      var wb = pick(per === 'week' ? have : whole, true);
      tiles.push(wb >= 0 && wv[wb] > 0 ? { g: ig('up', 16, gcol(AMBER)), label: 'Biggest Day', fig: esc(nm(wb)), sub: fx(wv[wb], 0) + ' kWh' }
        : { g: ig('up', 16, gcol(AMBER)), label: 'Biggest Day', fig: '—', sub: 'Not a whole day in yet' });
      if (per === 'week') {
        var wq = whole.length >= 2 ? pick(whole, false) : -1;
        tiles.push(wq >= 0 ? { g: ig('down', 16, gcol(BATT)), label: 'Quietest Day', fig: esc(nm(wq)), sub: fx(wv[wq], 0) + ' kWh' }
          : { g: ig('down', 16, gcol(BATT)), label: 'Quietest Day', fig: '—', sub: 'Two whole days first' });
      } else {
        var hi = 0, lo = 0;
        whole.forEach(function (k) { var r = us > 0 ? /** @type {number} */ (wv[k]) / us : 1; if (above(r)) hi++; else if (below(r)) lo++; });
        tiles.push({ g: ig('up', 16, gcol(RED)), label: 'Days Above Usual', fig: whole.length ? String(hi) : '—', sub: 'Of ' + count(whole.length, 'whole day') });
        tiles.push({ g: ig('down', 16, gcol(BATT)), label: 'Days Below Usual', fig: whole.length ? String(lo) : '—', sub: 'Of ' + count(whole.length, 'whole day') });
      }
      var spent = sum(have.map(function (k) { return wv[k]; }));
      tiles.push({ g: ig('cal', 16, gcol(BLUE)), label: 'A Day ' + (R.cur ? (per === 'week' ? 'This Week' : 'This Month') : 'Then'),
                   fig: R.cur && R.whole === 0 ? '—' : fx(spent / Math.max(1, R.days), 0), unit: R.cur && R.whole === 0 ? '' : 'kWh', sub: 'Usually ' + fx(us, 0) + ' kWh' });
      if (R.cur) tiles.push({ g: ig('pace', 16, gcol(RING.energy)), label: 'Heading For', fig: fx(R.proj, 0), unit: 'kWh', sub: heading });
      else if (cost) tiles.push({ g: ig('coin', 16, gcol(RING.cost)), label: 'It Cost', fig: esc(cost(R.cost, 0)), sub: 'A usual day ' + cost(R.typ.cost, 2) });
      return H.section(per === 'week' ? 'Your Week' : 'Your Month') + figGrid(tiles);
    }

    // EVERY CIRCUIT AND DEVICE THE PAGE KNOWS (the measured top-level circuits and the appliances, each one's own inside it):
    // its watts now (Now) or its kWh for the period, biggest first, a thin bar against the biggest, the battery's Backup mark
    /** @param {any} Ek @param {any} M @param {any} R @param {string} per @param {string} title */
    _devices(Ek, M, R, per, title) {
      var self = this, P0 = M.P, now = per === 'now', backs = backedBy(P0.power), ctl = {}, byStat = {}, val = {};
      (P0.sections || []).forEach(function (/** @type {any} */ s) {
        (s.items || []).forEach(function (/** @type {any} */ i) { if (i.kind === 'device' && i.control) /** @type {any} */ (ctl)[i.key] = i.control; });
      });
      M.devs.forEach(function (/** @type {any} */ d) { if (d.stat) /** @type {any} */ (byStat)[d.stat] = d; });
      if (R) R.devices.forEach(function (/** @type {any} */ r) { /** @type {any} */ (val)[r.d.key] = r.v; });
      if (!M.devs.length) return H.section(title) + quiet('No circuits or devices yet. Add them in Home Assistant’s Energy settings.');
      var shared = this._shared(M.devs.map(function (/** @type {any} */ d) { return d.power; }));
      var rows = M.devs.map(function (/** @type {any} */ d) {
        var w = d.power ? pw(self, d.power) : null, b = /** @type {any} */ (backs)[d.key], par = d.parent && /** @type {any} */ (byStat)[d.parent];
        var c = /** @type {any} */ (ctl)[d.key] || null, cs = c ? self.ctl(c) : null, off = !!cs && cs.state === 'off';
        var x = now ? (w == null ? null : Math.max(0, w)) : d.stat ? /** @type {any} */ (val)[d.key] || 0 : null;
        var kind = par ? 'In ' + par.name : /** @type {any} */ (KIND)[d.sec.id] || d.sec.name, area = self._area([d.power, d.stat, c], d.name, shared);
        return { d: d, w: w, x: x, ctl: c, off: off, backed: b ? b.backed : null, sub: (area ? area + ' · ' : '') + kind,
                 color: Ek.colorOf(d.color, d.sec.color), today: R && d.stat ? /** @type {any} */ (val)[d.key] : null };
      });
      rows.sort(function (/** @type {any} */ a, /** @type {any} */ b) { return (b.x == null ? -1 : b.x) - (a.x == null ? -1 : a.x) || (a.d.parent ? 1 : 0) - (b.d.parent ? 1 : 0); });
      var top = rows.filter(function (/** @type {any} */ r) { return r.x != null; })[0], mx = top ? Math.max(top.x, now ? 5 : 0.05) : 1;
      var live = rows.filter(function (/** @type {any} */ r) { return r.x != null && r.x >= (now ? 5 : 0.05); }).length;
      var nb = rows.filter(function (/** @type {any} */ r) { return r.backed; }).length;
      var html = rows.map(function (/** @type {any} */ r) {
        var d = r.d, sheet = d.power || d.stat, valH;
        if (r.off) valH = 'Off';
        else if (now) valH = r.x == null ? (r.today != null ? kwh(r.today) + '<small> kWh today</small>' : '<small>No reading</small>') : esc(wtext(r.x));
        else valH = r.x == null ? '<small>No meter</small>' : esc(kwh(r.x)) + '<small> kWh</small>';
        /** @type {any} */ (self._rows)[d.key] = { name: d.name, ctl: r.ctl, w: now ? r.x : r.w, backed: r.backed, sheet: sheet };
        return devRow({ key: d.key, icon: d.icon, gc: H.glyphColor({ icon_color: d.color }, null, false), name: d.name, sub: r.sub, backed: r.backed,
                        val: valH, w: r.x == null || r.off || r.x <= 0 ? null : r.x / mx, bar: r.color, off: r.off });
      });
      var n = Math.max(Math.min(SHOWN, live), Math.min(4, rows.length));
      var sumLine = now ? (live ? live + ' drawing power' : 'Nothing drawing') : count(rows.length, 'device');
      if (nb) sumLine += ' · ' + nb + ' on the battery';
      return H.section(title, esc(sumLine)) + H.list(folded(html, n, !!this._open['dev' + per], 'dev' + per, now ? 'Not Drawing' : 'More'), 'c4');
    }

    // THIS WEEK (Today's last section): the last seven days, today lit, against the seven before
    /** @param {any} Ek @param {any} M @param {any} D */
    _week(Ek, M, D) {
      var ax = Ek.axisOf(D, M), nd = ax ? ax.d.length : 0, n7 = Math.min(7, nd);
      if (n7 < 2) return '';
      var wk = [], tot7 = 0;
      for (var q = nd - n7; q < nd; q++) {
        var v7 = Ek.homeAt(M, D.d, q);
        tot7 += v7;
        wk.push({ v: v7, label: q === nd - 1 ? 'Today' : dayShort(+ax.d[q].t), now: q === nd - 1 });
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
        cmp = Math.abs(wp) < 3 ? ' · about the same as last week' : ' · ' + Math.abs(wp) + '% ' + (wp < 0 ? 'less' : 'more') + ' than last week';
      }
      if (tot7 <= 0.05) return '';
      return H.section('This Week', '<b>' + kwh(tot7) + '</b> kWh' + cmp) + '<div class="grid">' +
        chartPlate('By Day', key(USED, 'Used'), colsSvg(wk, { H: 104, anim: this._anim('wk7'), aria: 'Energy used each of the last seven days' })) + '</div>';
    }
    /** @param {string} act @param {any} el @param {any} ev */
    act(act, el, ev) {
      if (act === 'mode') {
        var k = el.getAttribute('data-k');
        this._seen[k] = false;
        if (k === 'now') this._seen.day = false;
        return false;
      }
      return super.act(act, el, ev);
    }
  }
  H.register('hk-hv-energy-card', HvEnergy, 'HK HomeView Energy',
    'The Energy page on an Apple HomeView: Now, Today, Week and Month -- the rings, the chart, the figures and every circuit and device.');

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
  // the sensors the Power page reads: the plan's own (power.py), else what its cards were given (the strategy's `src`)
  /** @param {any} h @param {any} W */
  function powerCfg(h, W) {
    var hs = H.cardOf(h, 'hk-power-house-card') || {}, fl = H.cardOf(h, 'hk-power-flow-card') || {}, bt = H.cardOf(h, 'hk-house-battery-card') || {},
        st = H.cardOf(h, 'hk-power-status-card') || {}, sn = H.cardOf(h, 'hk-power-sun-card') || {}, B = W.battery || {};
    /** @param {string} k */
    var pick = function (k) { return W[k] || hs[k] || fl[k] || sn[k] || st[k] || null; };
    /** @param {string} k */
    var bat = function (k) { return B[k] || bt[k] || st[k] || hs[k] || fl[k] || null; };
    return { grid: pick('grid'), grid_export: pick('grid_export'), grid_status: pick('grid_status'), home: pick('home'), solar: pick('solar'),
             backed_power: pick('backed_power'), level: bat('level'), charge: bat('charge'), discharge: bat('discharge'), reserve: bat('reserve'),
             backup: bat('backup'), stored: bat('stored'), limit: bat('limit'), eps: bat('eps'), storm: bat('storm'), problem: bat('problem'), speed: bat('speed'),
             packs: B.packs || bt.packs || [] };
  }

  class HvPower extends HvEnergyBase {
    _fast() { return true; }
    _sigKey() { return 'power'; }
    draw() {
      this._rows = {};
      var Ek = energy(this), P0 = Ek && Ek.plan ? Ek.plan() : plan(), W = (P0 && P0.power) || null, title = (this._config || {}).title || (W && W.title) || 'Power';
      if (!P0) return H.head({ title: title }) + quiet(Ek || failed ? 'Energy is not set up. Add it in ' + H.where('Pages → Energy') + '.' : 'Loading…');
      if (!W) return H.head({ title: title }) + quiet('The Power page is off. Turn it on in ' + H.where('Pages → Energy') + '.');
      var c = powerCfg(this.h, W), hasBat = !!c.level, hasSun = !!c.solar, hasGrid = !!c.grid;
      // ---- the readings, in watts
      var g = pw(this, c.grid), gx = c.grid_export ? pw(this, c.grid_export) : null;
      var imp = g == null ? 0 : Math.max(0, g), exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0;
      var sun = c.solar ? Math.max(0, pw(this, c.solar) || 0) : 0;
      var bc = pw(this, c.charge) || 0, bd = pw(this, c.discharge) || 0, bw = bc > 5 ? bc : bd > 5 ? -bd : 0;
      var down = c.grid_status ? reading(this, c.grid_status) === 'off' : false;
      var home = c.home ? pw(this, c.home) : null;
      if (home == null && (g != null || (hasSun && pw(this, c.solar) != null))) home = Math.max(0, imp - exp + sun + (bw < 0 ? -bw : 0) - (bw > 0 ? bw : 0));
      // (in an outage a whole-home reading on the grid's side reads nothing: the house is what the battery and the sun give it)
      if (down) home = Math.max(home || 0, sun + (bw < 0 ? -bw : 0));
      var level = hasBat ? num(this, c.level) : null;
      var x = { c: c, W: W, imp: imp, exp: exp, sun: sun, bw: bw, down: down, home: home, level: level, g: g };
      var sumHtml = down ? '<b class="bad">Grid Down</b> · on the battery' : home == null ? 'No Reading' : '<b>' + wtext(home) + '</b> to the house';
      if (!hasGrid && !hasSun && !hasBat && home == null) {
        return H.head({ title: title, sum: 'No Reading' }) + quiet('No power sensors yet. Add them in ' + H.where('Pages → Energy → Power') + '.');
      }
      var out = H.head({ title: title, sum: sumHtml });
      // ---- RIGHT NOW: the flow, and what it means in sentences
      out += this._flow(x);
      var says = this._status(x);
      if (says.length) out += sayList(says).replace('class="pl list c4 says"', 'class="pl list c4 says" style="margin-top:' + pt(12) + '"');
      // ---- THE HOUSE BATTERY
      if (hasBat) out += this._battery(x);
      // ---- ITS CIRCUITS
      out += this._circuits(x);
      // ---- THE SUN
      if (hasSun) out += this._sunGoes(Ek, x) + this._sun(Ek, c);
      // ---- THE CARS
      out += this._cars(x);
      // ---- THE HOUSE: every device drawing now (the longest list, last)
      out += this._house(x);
      return out;
    }

    // THE FLOW between the sun, the grid, the house and the battery, each node's watts under it; a tap opens a node's sheet
    /** @param {any} x */
    _flow(x) {
      var c = x.c, hasBat = !!c.level, srcs = [], asKw = Math.max(x.sun, x.imp, x.exp, x.home || 0, Math.abs(x.bw)) >= 1000, home = x.home, level = x.level;
      if (c.solar) srcs.push('sun');
      if (c.grid) srcs.push('grid');
      var two = srcs.length === 2, FH = two ? 336 : 236, hy = two ? 150 : 104;
      var hx = hasBat ? 258 : srcs.length ? 396 : 258, sx = hasBat ? 66 : 100, bx = 450, sy = two ? [52, 238] : [hy];
      var lines = '', nodes = '';
      /** @param {number} cx @param {number} cy @param {number} d @param {string} inner @param {string} val @param {string} label @param {string} id @param {string} [cls] @param {string} [vc] */
      var node = function (cx, cy, d, inner, val, label, id, cls, vc) {
        return '<button class="nd" style="left:' + pt(cx) + ';top:' + pt(cy - d / 2) + '" data-act="sheet" data-id="' + esc(id || '') + '"' + (id ? '' : ' disabled') + '>' +
          '<span class="pl disc ' + (cls || '') + '" style="width:' + pt(d) + ';height:' + pt(d) + '">' + inner + '</span>' +
          '<span class="hl' + (vc ? ' ' + vc : '') + '">' + esc(val) + '</span><span class="st">' + esc(label) + '</span></button>';
      };
      srcs.forEach(function (s, i) {
        var cy = sy[i], end = [hx - 58, hy + (two ? (i ? 12 : -12) : 0)];
        if (s === 'sun') {
          lines += line([sx + 44, cy], end, x.sun > 20, SOLAR_G, false);
          nodes += node(sx, cy, 88, H.glyph('hk:white-balance-sunny', 36, gcol(SOLAR_G, x.sun > 20)), x.sun > 20 ? wtext(x.sun, asKw) : 'Idle', 'Solar', c.solar || '', '',
            x.sun > 20 ? '' : 'ink2');
        } else {
          var flowing = !x.down && (x.imp > 5 || x.exp > 5);
          lines += line([sx + 44, cy], end, flowing, x.exp > 5 ? SOLAR_G : '#ffffff', x.exp > 5);
          nodes += node(sx, cy, 88, H.glyph('hk:transmission-tower', 36, gcol(x.down ? RED : GRID_G, x.down)),
            x.down ? 'Down' : x.g == null ? '—' : x.exp > 5 ? wtext(x.exp, asKw) : x.imp > 5 ? wtext(x.imp, asKw) : 'Idle', x.exp > 5 && !x.down ? 'To the Grid' : 'Grid',
            c.grid || '', '', x.down ? 'bad' : flowing ? '' : 'ink2');
        }
      });
      // the house: a lit plate, its watts inside
      nodes += node(hx, hy, 124, '<span class="in">' + H.glyph('hk:home-lightning-bolt', 40, '#1fa846') + '<span class="hw">' + (home == null ? '—' : wtext(home, asKw)) + '</span></span>',
        'Home', 'Using', c.home || '', 'lit');
      if (hasBat) {
        lines += line([hx + 62, hy], [bx - 44, hy], x.bw !== 0, BATT, x.bw < 0);
        var lv = level == null ? 0 : clamp(level, 0, 100), rc = lv < 10 ? RED : lv < 20 ? AMBER : BATT;
        var ring = '<svg class="ring" viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="38" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6"/>' +
          (level != null ? '<circle cx="44" cy="44" r="38" fill="none" stroke="' + rc + '" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="' + f1(lv) +
            ' 100" transform="rotate(-90 44 44)"/>' : '') + '</svg><span class="pc">' + (level == null ? '—' : Math.round(lv) + '%') + '</span>';
        nodes += node(bx, hy, 88, ring, x.bw !== 0 ? wtext(x.bw, asKw) : level == null ? 'No Response' : 'Idle', x.bw > 0 ? 'Charging' : x.bw < 0 ? 'Powering the House' : 'Battery',
          c.level || '', '', x.bw === 0 ? 'ink2' : '');
      }
      if (!srcs.length && !hasBat) lines = '';
      return '<div class="flow" style="height:' + pt(FH) + '"><svg class="ln" viewBox="0 0 516 ' + FH + '" aria-hidden="true">' + lines + '</svg>' + nodes + '</div>';
    }

    // THE STATUS IN SENTENCES (the Power page's status card): an outage or a fault first, in red; then what the house runs on
    // and what the battery is doing, the sun, a car charging, the backup time, EPS and Storm Mode
    /** @param {any} x */
    _status(x) {
      var c = x.c, rows = [], lvl = x.level, bh = c.backup ? hoursOf(this, c.backup) : null, hasBat = !!(c.level || c.charge || c.discharge);
      var at = lvl != null ? ' at ' + Math.round(lvl) + '%' : '';
      if (x.down) rows.push({ more: c.grid_status, ic: G.tower, c: RED, alert: true, t: '<b>The grid is down.</b> The house is running on the battery' + at + '.' });
      if (c.problem && reading(this, c.problem) === 'on') rows.push({ more: c.problem, ic: G.alert, c: RED, alert: true, t: '<b>The battery reports a fault.</b> Check it in its own app.' });
      var Sx = powerSplit({ solar: x.sun, imp: x.imp, exp: x.exp, bc: x.bw > 0 ? x.bw : 0, bd: x.bw < 0 ? -x.bw : 0, home: x.home });
      if (!x.down && x.sun > 20) {
        rows.push({ more: c.solar, ic: G.sun, c: '#ffd60a', t: '<b>The sun</b> is covering ' + Math.min(100, Math.round(Sx.s2h / Math.max(1, Sx.home) * 100)) + '% of the house' +
          (Sx.s2g > 5 ? ' and selling ' + wtext(Sx.s2g) + ' back.' : Sx.s2b > 5 ? ' and charging the battery.' : '.') });
      }
      if (!x.down) {
        var on = ({ sun: 'Running mostly on the sun', batt: 'Running on the battery', grid: 'Running on the grid' })[Sx.main || 'grid'];
        var batSays = gone(this.st(c.level)) ? 'the battery isn’t answering' : 'the battery is ' + (x.bw > 0 ? 'charging at ' + wtext(x.bw) : x.bw < 0 ? 'helping with ' +
          wtext(-x.bw) : 'standing by') + (lvl != null ? ' (' + Math.round(lvl) + '%)' : '');
        if (x.home != null) rows.push({ more: c.grid_status || c.grid, ic: G.tower, c: AMBER, t: '<b>' + on + '</b>' + (hasBat ? '; ' + batSays : '') + '.' });
        else if (hasBat) rows.push({ more: c.level, ic: G.batt, c: BATT, t: '<b>No reading for the house.</b> ' + H.sentence(batSays) + '.' });
      }
      var self = this;
      (x.W.cars || []).forEach(function (/** @type {any} */ k) {
        var w = pw(self, k.charger || k.power);
        if (w != null && w > 5) rows.push({ more: k.level, ic: G.car, c: CAR, t: '<b>' + esc(k.name || 'A car') + '</b> is charging at ' + wtext(w) + ', ' +
          ({ sun: 'mostly from the sun', batt: 'mostly from the battery', grid: 'mostly from the grid' })[Sx.main || 'grid'] + '.' });
      });
      if (bh != null) rows.push({ more: c.backup, ic: G.batt, c: BATT, t: '<b>' + (x.down ? 'The battery will last ' : 'A full backup would last ') + hm(bh) + '</b> at this load' +
        (x.home != null ? ' (' + wtext(x.home) + ')' : '') + '.' });
      if (c.eps) {
        var eps = reading(this, c.eps);
        if (eps) rows.push({ more: c.eps, ic: G.bolt, c: BLUE, t: '<b>EPS is ' + (eps === 'on' ? 'on' : 'off') + '</b>' +
          (eps === 'on' ? ': the backed-up circuits switch over in under 20 ms.' : ': backed-up circuits may blink in an outage.') });
      }
      if (c.storm && reading(this, c.storm) === 'on') rows.push({ more: c.storm, ic: G.storm, c: PURPLE, t: '<b>Storm Mode is on</b>: charging to full ahead of the weather.' });
      return rows;
    }

    // THE HOUSE BATTERY: its level as the hero (a ring, the level inside), what it is doing and how fast, stored, the backup
    // time, its reserve and limit; the day's level; its mode; its levels you can set; its packs
    /** @param {any} x */
    _battery(x) {
      var c = x.c, W = x.W, lvl = x.level, st = this.st(c.level), self = this;
      var stored = c.stored ? num(this, c.stored) : null, bh = c.backup ? hoursOf(this, c.backup) : null, res = c.reserve ? num(this, c.reserve) : null;
      var lim = c.limit ? num(this, c.limit) : null, cap = stored != null && lvl ? stored / (lvl / 100) : null, lv = lvl == null ? 0 : clamp(lvl, 0, 100);
      var col = lvl == null ? 'rgba(255,255,255,.3)' : lv < 10 ? RED : lv < 20 ? AMBER : BATT;
      // what it is doing: charging (and when it is full), powering the house (and how long it lasts), standing by
      var doing, more = '';
      if (gone(st)) { doing = 'No Response'; more = 'The battery isn’t answering.'; }
      else if (x.bw > 0) {
        doing = 'Charging, ' + wtext(x.bw);
        var to = lim != null ? lim : 100;
        if (cap != null && lv < to) {
          var hrs = (cap * (to - lv) / 100) * 1000 / x.bw;
          if (hrs > 0 && hrs < 48) more = (to < 100 ? 'At ' + Math.round(to) + '%' : 'Full') + ' by ' + hourName(Date.now() + hrs * 36e5, true);
        } else if (lv >= to) more = 'At its limit';
      } else if (x.bw < 0) { doing = 'Powering the House, ' + wtext(-x.bw); more = bh != null ? 'Lasts about ' + hm(bh) + ' at this load' : ''; }
      else { doing = 'Standing By'; more = x.down ? 'The grid is down' : 'Ready for an outage'; }
      var ring = '<svg viewBox="0 0 136 136" aria-hidden="true"><circle cx="68" cy="68" r="60" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="11"/>' +
        (lvl != null ? '<circle cx="68" cy="68" r="60" fill="none" stroke="' + col + '" stroke-width="11" stroke-linecap="round" pathLength="100" stroke-dasharray="' + f1(lv) +
          ' 100" transform="rotate(-90 68 68)"/>' : '') +
        (res != null && lvl != null ? '<circle cx="' + f1(68 + 60 * Math.cos((res / 100 * 360 - 90) * Math.PI / 180)) + '" cy="' + f1(68 + 60 * Math.sin((res / 100 * 360 - 90) * Math.PI / 180)) +
          '" r="3.5" fill="#fff"/>' : '') + '</svg><b>' + (lvl == null ? '—' : Math.round(lv) + '<small>%</small>') + '</b>';
      /** @param {string} k @param {string} n @param {string} [cls] */
      var fact = function (k, n, cls) { return '<div><div class="k">' + esc(k) + '</div><div class="n' + (cls ? ' ' + cls : '') + '">' + esc(n) + '</div></div>'; };
      var facts = [];
      if (c.stored) facts.push(fact(cap != null ? 'Stored, of ' + fx(cap, 1) : 'Stored', stored == null ? '—' : fx(stored, 1) + ' kWh'));
      if (c.backup) facts.push(fact('Backup Time', bh == null ? '—' : hm(bh)));
      if (c.eps) { var eps = reading(this, c.eps); facts.push(fact('EPS', eps == null ? '—' : eps === 'on' ? 'On' : 'Off', eps === 'on' ? 'ok' : '')); }
      if (c.grid_status) facts.push(fact('Grid', x.down ? 'Down' : reading(this, c.grid_status) == null ? '—' : 'Up', x.down ? 'bad' : ''));
      if (facts.length < 4 && c.reserve) facts.push(fact('Reserve', res == null ? '—' : Math.round(res) + '%'));
      if (facts.length < 4 && c.limit) facts.push(fact('Charge Limit', lim == null ? '—' : Math.round(lim) + '%'));
      var sumText = [lvl != null ? Math.round(lvl) + '%' : null, stored != null ? fx(stored, 1) + ' kWh' : null, bh != null ? hm(bh) + ' of backup' : null].filter(Boolean).join(' · ');
      var out = H.section('House Battery', esc(sumText)) + '<div class="stk">' +
        H.plate({ cls: 'bh', act: 'sheet', data: { id: c.level }, label: 'House battery, ' + (lvl == null ? 'no response' : Math.round(lv) + '%') + ', ' + doing },
          '<div class="ring">' + ring + '</div><div class="rt"><div class="doing">' + esc(doing) + (more ? '<small>' + esc(more) + '</small>' : '') + '</div>' +
          (facts.length ? '<div class="facts">' + facts.slice(0, 4).join('') + '</div>' : '') + '</div>') + '</div>';
      out += this._dayLevel(c, lvl, x.bw, !!c.solar);
      // ---- its mode, its levels
      if (W.mode && W.mode.entity) out += H.section('Mode') + '<div class="stk">' + this._mode(W.mode) + '</div>';
      var levels = (W.levels || []).filter(function (/** @type {any} */ l) { return l && l.entity; });
      if (!levels.length) {
        levels = [[c.limit, 'Charge Limit', 'hk:battery-arrow-up-outline', 'green'], [c.reserve, 'Backup Reserve', 'hk:battery-lock', 'purple'],
                  [c.speed, 'Charging Speed', 'hk:speedometer', 'cyan']].filter(function (l) { return l[0] && /^number\./.test(l[0]); })
          .map(function (l) { return { entity: l[0], name: l[1], icon: l[2], color: l[3] }; });
      }
      if (levels.length) out += H.section('Levels', 'drag to set') + '<div class="grid">' + levels.map(function (/** @type {any} */ l) { return self._numLevel(l); }).join('') + '</div>';
      // ---- its packs, each with its level and temperature
      var packs = (c.packs || []).filter(function (/** @type {any} */ p) { return p && p.level; });
      if (packs.length) {
        out += H.section('Packs', count(packs.length, 'pack')) + H.list(packs.map(function (/** @type {any} */ p, /** @type {number} */ i) {
          var pl = num(self, p.level), t = p.temperature ? num(self, p.temperature) : null, tu = p.temperature ? ((self.st(p.temperature) || {}).attributes || {}).unit_of_measurement || '' : '';
          return H.row({ g: ig('batt', 24, gcol(BATT, true)), name: p.name || 'Pack ' + (i + 1), sub: t != null ? fx(t, 0) + ' ' + tu : '', val: pl == null ? 'No Response' : Math.round(pl) + '%',
                         act: 'sheet', data: { id: p.level } });
        }), 'c4');
      }
      return out;
    }

    // THE BATTERY THROUGH THE DAY: its level each hour since midnight (the hours' means) and now, the reserve dashed
    /** @param {any} c @param {number|null} level @param {number} bw @param {boolean} hasSun */
    _dayLevel(c, level, bw, hasSun) {
      var S = window.hkStats, hr = S && S.hourly && c.level ? S.hourly(this.client, c.level, 48, this, { type: 'mean' }) : null;
      var W = 476, hh = 116, now = Date.now(), body = '', note = '';
      if (S && c.level && !hr) {
        body = '<div class="empty">Loading…</div>';
      } else if (hr && hr.length) {
        var t0 = null;
        for (var i = hr.length - 1; i >= 0; i--) if (S.fields(hr[i].t).hour === 0) { t0 = +hr[i].t; break; }
        if (t0 == null) t0 = +hr[Math.max(0, hr.length - 24)].t;
        var X = function (/** @type {number} */ t) { return clamp((t - /** @type {number} */ (t0)) / 864e5) * W; };
        var Y = function (/** @type {number} */ y) { return 6 + (hh - 12) * (1 - clamp(y, 0, 100) / 100); };
        var pts = [], hours = [];
        hr.forEach(function (/** @type {any} */ r) {
          if (+r.t >= /** @type {number} */ (t0) && typeof r.v === 'number' && isFinite(r.v) && +r.t + 36e5 < now) { pts.push([X(+r.t + 18e5), Y(r.v)]); hours.push({ t: +r.t, v: r.v }); }
        });
        if (level != null) pts.push([X(now), Y(level)]);
        if (pts.length < 2) {
          body = '<div class="empty">No history for today yet.</div>';
        } else {
          var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]); }).join(' '), last = pts[pts.length - 1];
          var res = c.reserve ? num(this, c.reserve) : null;
          body = '<svg class="bars" viewBox="0 0 ' + W + ' ' + (hh + 22) + '" role="img" aria-label="Battery level today">' +
            [0, 50, 100].map(function (y) { return '<line x1="0" x2="' + W + '" y1="' + f1(Y(y)) + '" y2="' + f1(Y(y)) + '" stroke="rgba(255,255,255,.12)" stroke-width="1"/>'; }).join('') +
            '<path d="' + d + ' L' + f1(last[0]) + ' ' + f1(Y(0)) + ' L' + f1(pts[0][0]) + ' ' + f1(Y(0)) + 'Z" fill="rgba(48,209,88,.22)"/>' +
            (res != null ? '<line x1="0" x2="' + W + '" y1="' + f1(Y(res)) + '" y2="' + f1(Y(res)) + '" stroke="rgba(255,255,255,.4)" stroke-width="1.5" stroke-dasharray="4 5"/>' : '') +
            '<path d="' + d + '" fill="none" stroke="' + BATT + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
            '<circle cx="' + f1(last[0]) + '" cy="' + f1(last[1]) + '" r="5" fill="#fff"/>' +
            [0, 6, 12, 18].map(function (h6) { return text(hourName(/** @type {number} */ (t0) + h6 * 36e5), (h6 / 24) * W, hh + 17, h6 === 0 ? 'start' : 'middle'); }).join('') + '</svg>';
          // when it charged: the longest climb since midnight
          var best = null, run = null;
          for (var q = 1; q < hours.length; q++) {
            if (hours[q].v > hours[q - 1].v + 0.5) {
              if (!run) run = { a: hours[q - 1].t, b: hours[q].t + 36e5, from: hours[q - 1].v, to: hours[q].v };
              else { run.b = hours[q].t + 36e5; run.to = hours[q].v; }
            } else { if (run && (!best || run.to - run.from > best.to - best.from)) best = run; run = null; }
          }
          if (run && (!best || run.to - run.from > best.to - best.from)) best = run;
          if (best && best.to - best.from >= 5) note = 'Charged ' + (hasSun ? 'from solar ' : '') + hourName(best.a) + '–' + hourName(best.b);
          else if (bw > 0) note = 'Charging now';
          else if (bw < 0) note = 'Powering the house';
          else if (res != null) note = 'Reserve ' + Math.round(res) + '%';
        }
      } else return '';
      return '<div class="grid" style="margin-top:' + pt(12) + '">' + H.plate({ cls: 'c4 r2 cp' }, '<div class="chd"><span class="lbl">Level Today</span><span class="lg">' + esc(note) +
        '</span></div>' + body) + '</div>';
    }

    // THE BATTERY'S CIRCUITS (the Power plan's: a device whose power sensor or switch is on the battery's own device, a switch
    // group of its circuits): each one's watts now and its switch -- a tap asks before turning it off
    /** @param {any} x */
    _circuits(x) {
      var self = this, W = x.W;
      if (!W.battery || W.backs_up === 'none') return '';
      var all = [];
      (W.sections || []).forEach(function (/** @type {any} */ s) { (s.items || []).forEach(function (/** @type {any} */ i) { all.push(Object.assign({ sec: s }, i)); }); });
      var mine = all.filter(function (i) { return i.backed && /battery.s (device|circuits?)/.test(i.why || ''); });
      if (!mine.length) mine = all.filter(function (i) { return i.backed && i.control && !i.parent; });
      if (!mine.length) return '';
      var rows = mine.map(function (i) {
        var w = i.power ? pw(self, i.power) : null, cs = i.control ? self.ctl(i.control) : null, off = !!cs && cs.state === 'off', lost = !!i.control && gone(cs);
        return { i: i, w: w, off: off, lost: lost, x: off ? -1 : w == null ? -0.5 : Math.max(0, w) };
      }).sort(function (a, b) { return b.x - a.x; });
      var shared = this._shared(all.map(function (i) { return i.power; }));
      var mx = Math.max(5, rows[0].x), tot = sum(rows.map(function (r) { return r.off || r.w == null ? 0 : Math.max(0, r.w); }));
      var offN = rows.filter(function (r) { return r.off; }).length;
      var html = rows.map(function (r) {
        var i = r.i, area = self._area([i.power, i.control], i.name, shared), kind = /** @type {any} */ (KIND)[i.sec.id] || i.sec.name;
        var many = /(\d+) of the battery.s circuits/.exec(i.why || ''), what = many ? count(Number(many[1]), 'circuit') : '';
        var sub = (area ? area + ' · ' : '') + (what || kind);
        /** @type {any} */ (self._rows)['c:' + i.key] = { name: i.name, ctl: i.control, w: r.w, backed: true, sheet: i.power || i.control,
                                                         what: many ? 'It switches ' + count(Number(many[1]), 'circuit') + '.' : '' };
        return devRow({ key: 'c:' + i.key, icon: i.icon, gc: H.glyphColor({ icon_color: i.color }, null, false), name: i.name, sub: sub, backed: true, off: r.off,
                        val: r.off ? 'Off' : r.lost ? '<small>No Response</small>' : r.w == null ? '<small>No reading</small>' : esc(wtext(Math.max(0, r.w))),
                        w: r.off || r.w == null || r.w < 1 ? null : r.w / mx, bar: H.hue(i.color || 'green') });
      });
      return H.section('The Battery’s Circuits', esc(count(rows.length, 'circuit') + ' · ' + wtext(tot) + (offN ? ' · ' + offN + ' off' : ''))) + H.list(html, 'c4');
    }

    // THE HOUSE: every device drawing now, biggest first, each marked when the battery backs it up; what the battery covers
    /** @param {any} x */
    _house(x) {
      var self = this, W = x.W, c = x.c, items = [], seen = {};
      (W.sections || []).forEach(function (/** @type {any} */ s) {
        (s.items || []).forEach(function (/** @type {any} */ i) {
          if (i.power && !/** @type {any} */ (seen)[i.power]) { /** @type {any} */ (seen)[i.power] = 1; items.push(Object.assign({ sec: s }, i)); }
        });
      });
      if (!items.length) return '';
      var backs = !!W.battery && W.backs_up !== 'none';
      var rows = items.map(function (i) { var w = pw(self, i.power); return { i: i, w: w == null ? null : Math.max(0, w) }; })
        .sort(function (a, b) { return (b.w == null ? -1 : b.w) - (a.w == null ? -1 : a.w); });
      var on = rows.filter(function (r) { return r.w != null && r.w >= 5; }), mx = on.length ? on[0].w : 1, shared = this._shared(items.map(function (i) { return i.power; }));
      // the split: what the battery's own reading (backed_power) says it covers, else the backed devices' own (no child twice)
      var line = '';
      if (x.home != null && backs) {
        var bp = c.backed_power ? pw(this, c.backed_power) : null;
        var backed = bp != null ? Math.max(0, bp) : sum(on.filter(function (r) { return r.i.backed && !r.i.parent; }).map(function (r) { return r.w; }));
        if (backed > 0) line = ' · the battery covers ' + Math.min(100, Math.round(100 * backed / Math.max(1, x.home))) + '%';
      }
      var html = rows.map(function (r) {
        var i = r.i, area = self._area([i.power, i.control], i.name, shared), kind = /** @type {any} */ (KIND)[i.sec.id] || i.sec.name;
        /** @type {any} */ (self._rows)['h:' + i.key] = { name: i.name, ctl: i.control || null, w: r.w, backed: backs ? !!i.backed : null, sheet: i.power };
        if (i.control) self.ctl(i.control);
        var off = !!i.control && (self.st(i.control) || {}).state === 'off';
        return devRow({ key: 'h:' + i.key, icon: i.icon, gc: H.glyphColor({ icon_color: i.color }, null, false), name: i.name, sub: (area ? area + ' · ' : '') + kind,
                        backed: backs && i.backed, off: off, val: off ? 'Off' : r.w == null ? '<small>No reading</small>' : esc(wtext(r.w)),
                        w: r.w != null && r.w >= 5 ? r.w / mx : null, bar: H.hue(i.color || 'green') });
      });
      var head = H.section('The House', esc((x.home != null ? wtext(x.home) : count(on.length, 'device') + ' drawing') + line));
      if (!on.length) return head + quiet('Nothing is drawing power right now.') + H.list(folded(html, 0, !!this._open.house, 'house', 'Device', 'Devices'), 'c4');
      return head + H.list(folded(html, Math.min(on.length, 12), !!this._open.house, 'house', 'Not Drawing'), 'c4');
    }

    // WHERE THE SUN GOES: right now in watts (the split of the live readings) and today in kWh (the same split over the hours)
    /** @param {any} Ek @param {any} x */
    _sunGoes(Ek, x) {
      var r = powerSplit({ solar: x.sun, imp: x.imp, exp: x.exp, bc: x.bw > 0 ? x.bw : 0, bd: x.bw < 0 ? -x.bw : 0, home: x.home }), bat = !!x.c.level, T = null;
      var M = Ek && Ek.model ? Ek.model(this.client, this) : null, D = M && M.src.solar.length ? Ek.series(this.client, this, M) : null, ax = D && Ek.axisOf(D, M);
      if (ax) {
        var today0 = +ax.d[ax.d.length - 1].t, t = { s2h: 0, s2b: 0, s2g: 0, sun: 0 };
        ax.h.forEach(function (/** @type {any} */ p, /** @type {number} */ i) {
          if (+p.t < today0) return;
          var s = M.src, q = powerSplit({ solar: Ek.vs(D.h, s.solar, i), imp: Ek.vs(D.h, s.imp, i), exp: Ek.vs(D.h, s.exp, i), bc: Ek.vs(D.h, s.into, i), bd: Ek.vs(D.h, s.out, i), home: null });
          t.s2h += q.s2h; t.s2b += q.s2b; t.s2g += q.s2g; t.sun += Ek.vs(D.h, s.solar, i);
        });
        T = t;
      }
      /** @param {number[]} a @param {boolean} k */
      var bar = function (a, k) {
        var parts = [['The House', a[0], '#ffd60a'], ['Battery', a[1], BATT], ['The Grid', a[2], AMBER]]
          .filter(function (p) { return /** @type {number} */ (p[1]) > 0.001 && (p[0] !== 'Battery' || bat); });
        var tot = parts.reduce(function (s, p) { return s + /** @type {number} */ (p[1]); }, 0);
        if (tot <= 0.001) return '<div class="sbar"></div><div class="slg"><span>None</span></div>';
        return '<div class="sbar">' + parts.map(function (p) { return '<i style="width:' + (/** @type {number} */ (p[1]) / tot * 100).toFixed(2) + '%;background:' + p[2] + '"></i>'; }).join('') +
          '</div><div class="slg">' + parts.map(function (p) { return '<span><i style="background:' + p[2] + '"></i>' + esc(p[0]) + ' ' +
            esc(k ? kwh(/** @type {number} */ (p[1])) + ' kWh' : wtext(/** @type {number} */ (p[1]))) + '</span>'; }).join('') + '</div>';
      };
      return H.section('Where the Sun Goes', T ? kwh(T.sun) + ' kWh today' : '') + H.plate({ cls: 'c4 sg' },
        '<div><div class="k"><span>Right Now</span><span>' + esc(x.sun > 20 ? wtext(x.sun) : 'Idle') + '</span></div>' + bar([r.s2h, r.s2b, r.s2g], false) + '</div>' +
        (T ? '<div><div class="k"><span>Today</span><span>' + (T.sun > 0.05 ? 'You used ' + Math.round((T.s2h + T.s2b) / T.sun * 100) + '% yourself' : '') + '</span></div>' +
          bar([T.s2h, T.s2b, T.s2g], true) + '</div>' : ''));
    }

    // THE SUN TODAY: what it made, by hour, with yesterday's hours still to come in gray; the peak hour
    /** @param {any} Ek @param {any} c */
    _sun(Ek, c) {
      var S = window.hkStats, today = /** @type {any[]} */ ([]), yday = /** @type {any[]} */ ([]), tot = 0, ready = false, now = Date.now();
      var M = Ek && Ek.model ? Ek.model(this.client, this) : null, D = M && M.ids.length && M.src.solar.length ? Ek.series(this.client, this, M) : null;
      if (M && D) {
        var ax = Ek.axisOf(D, M);
        if (ax) {
          var t0 = +ax.d[ax.d.length - 1].t;
          ax.h.forEach(function (/** @type {any} */ p, /** @type {number} */ i) {
            var t = +p.t, x = Ek.vs(D.h, M.src.solar, i);
            if (t >= t0) { today.push({ t: t, v: x }); tot += x; } else if (t >= t0 - 864e5) yday.push({ t: t, v: x });
          });
          ready = true;
        }
      } else if (S && S.hourly && c.solar) {
        // no energy statistic for the sun: the power sensor's hourly means (kW over an hour is kWh)
        var hr = S.hourly(this.client, c.solar, 49, this, { type: 'mean' }), unit = String(((this.st(c.solar) || {}).attributes || {}).unit_of_measurement || 'W');
        if (hr && hr.length) {
          var k = /^kw$/i.test(unit) ? 1 : /^mw$/i.test(unit) ? 1000 : 0.001, mid = null;
          for (var i = hr.length - 1; i >= 0; i--) if (S.fields(hr[i].t).hour === 0) { mid = +hr[i].t; break; }
          if (mid == null) mid = now - 864e5;
          hr.forEach(function (/** @type {any} */ r) {
            var x = typeof r.v === 'number' && isFinite(r.v) ? Math.max(0, r.v * k) : 0, t = +r.t;
            if (t >= /** @type {number} */ (mid)) { today.push({ t: t, v: x }); tot += x; } else if (t >= /** @type {number} */ (mid) - 864e5) yday.push({ t: t, v: x });
          });
          ready = true;
        }
      }
      if (!ready) return H.section('Solar Today') + quiet('Loading…');
      var hourOf = function (/** @type {number} */ t) { return S && S.fields ? S.fields(t).hour : new Date(t).getHours(); };
      var bump = today.concat(yday).filter(function (x) { return x.v > 0.02; });
      var peak = today.reduce(function (a, x) { return !a || x.v > a.v ? x : a; }, null);
      var sub = fx(tot, 1) + ' kWh' + (peak && peak.v > 0.05 ? ' · peak ' + fx(peak.v, 1) + ' kW at ' + hourName(peak.t) : '');
      var chart;
      if (!bump.length) {
        chart = '<div class="empty">The sun hasn’t made any power yet.</div>';
      } else {
        var a = Math.min.apply(null, bump.map(function (x) { return hourOf(x.t); })), b = Math.max.apply(null, bump.map(function (x) { return hourOf(x.t); }));
        a = Math.max(0, a - 1); b = Math.min(23, b + 1);
        while (b - a < 5) { if (a > 0) a--; if (b < 23 && b - a < 5) b++; if (a === 0 && b === 23) break; }
        var byToday = {}, byYday = {};
        today.forEach(function (x) { /** @type {any} */ (byToday)[hourOf(x.t)] = x.v; });
        yday.forEach(function (x) { /** @type {any} */ (byYday)[hourOf(x.t)] = x.v; });
        var bars = [], t00 = today.length ? today[0].t - hourOf(today[0].t) * 36e5 : now;
        for (var h = a; h <= b; h++) {
          var bar = { segs: /** @type {any[]} */ ([]), ghost: 0, label: h === a || h === b || h === Math.round((a + b) / 2) ? hourName(t00 + h * 36e5) : '',
                      anchor: h === a ? 'start' : h === b ? 'end' : 'middle' };
          if (/** @type {any} */ (byToday)[h] > 0) bar.segs = [{ v: /** @type {any} */ (byToday)[h], c: SOLAR }];
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
      return H.section('Solar Today', esc(sub)) + '<div class="grid">' +
        H.plate({ cls: 'c4 r2 cp' }, '<div class="chd"><span class="lbl">By Hour</span><span class="lg">' + esc(side) + '</span></div>' + chart) + '</div>';
    }

    // THE CARS (the Power plan's): each one's level, its range, charging and how fast, its limit; a tap on one charging asks
    // before it stops, one that isn't opens its sheet
    /** @param {any} x */
    _cars(x) {
      var self = this, cars = (x.W.cars || []).filter(function (/** @type {any} */ k) { return k && k.level; });
      if (!cars.length) return '';
      var rows = cars.map(function (/** @type {any} */ k) {
        var lvl = num(self, k.level), w = pw(self, k.charger || k.power), cs = k.charge ? self.ctl(k.charge) : null;
        // (a car's limit and its cable: the plan's, else the ones beside its level on its own device, named as the car's
        // integration names them: `number.<car>_charge_limit`, `binary_sensor.<car>_charge_cable`)
        var base = String(k.level).replace(/^sensor\./, '').replace(/_battery(_level)?$/, '');
        var lim = num(self, k.limit || 'number.' + base + '_charge_limit'), rng = k.range ? num(self, k.range) : null;
        var ru = k.range ? ((self.st(k.range) || {}).attributes || {}).unit_of_measurement || 'mi' : '';
        var away = k.home ? reading(self, k.home) : null, plug = reading(self, k.plugged || 'binary_sensor.' + base + '_charge_cable'), charging = w != null && w > 5;
        var bits = [];
        if (rng != null) bits.push(fx(rng, 0) + ' ' + ru);
        if (charging) bits.push('Charging, ' + wtext(w));
        else if (plug === 'on') bits.push('Plugged In');
        else if (away && away !== 'home') bits.push('Away');
        if (lim != null) bits.push('Limit ' + Math.round(lim) + '%');
        /** @type {any} */ (self._rows)['car:' + k.level] = { name: k.name || 'the car', ctl: cs && cs.state === 'on' ? k.charge : null, w: charging ? w : null, sheet: k.level,
                                                           yes: 'Stop Charging', ask: 'Stop charging ' + (k.name || 'the car') + '?',
                                                           what: 'It stops until you start it again.' };
        var col = lvl == null ? CAR : lvl < 20 ? AMBER : BATT;
        return devRow({ key: 'car:' + k.level, icon: 'hk:car', gc: gcol(CAR, charging), name: k.name || k.level, sub: bits.join(' · '), backed: false,
                        val: lvl == null ? '<small>No Response</small>' : Math.round(lvl) + '%', w: lvl == null ? null : lvl / 100, bar: col });
      });
      return H.section('Cars', esc(count(cars.length, 'car'))) + H.list(rows, 'c4');
    }
  }
  H.register('hk-hv-power-card', HvPower, 'HK HomeView Power',
    'The Power page on an Apple HomeView: right now (the flow, the status), the house battery with its mode, levels and circuits, the house, the sun and the cars.');

  window.hkHvEnergy.Energy = HvEnergy;
  window.hkHvEnergy.Power = HvPower;
  });
})();
