// @ts-check
// hk-laundry-card.js -- the Laundry block (`laundry` in hk-grid-catalog.js; docs/phase22/LAUNDRY.md), 2026-11-10.
//
//   hk-grid-laundry-card   The house's washers and dryers (Accessories -> Laundry, else found by themselves; hk-laundry.js reads
//                          them): one machine drawn large with what it is doing, how long, when it's done and the cycle's steps;
//                          two side by side, each a centered tile of its own. S, W, T, L and XL, on square cells (196 x 196) and
//                          tile cells (196 x 150).
//
// AS THE OWNER APPROVED IT (the mockup, docs/phase22/mockup/laundry.html): the drawing animated by what the machine does, its words
// under or beside it, the headline at the upper left wherever there is one (DESIGN.md "HomeView (Tall) on the Home Grid"); Small is
// HomeView's centered tile. NOTHING STRETCHES: the drawing takes the room, the words and the pills keep their sizes. Pause and Stop
// show only where the machine offers them and allows remote control (the sheet says why when it doesn't); Clear only on a Done the
// house's server holds. A tap on the plate (or on one machine's half) opens its sheet (hk-sheet-laundry.js).
(function () {
  'use strict';
  if (window.hkLaundryCard) return;                    // double-load guard
  window.hkLaundryCard = { version: '1.0.0' };

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-laundry-card] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkLaundryCard.Card) return;
  var HkBase = C.HkBase, register = C.register, esc = C.esc, v = C.v, T = C.TYPE;
  function type(role) {
    var t = T[role];
    return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '');
  }
  var SIZES = /^(S|W|T|L|XL)$/;
  var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
  var MINT = (C.ACCENTS && C.ACCENTS.mint) || '#63e6e2', RED = (C.ACCENTS && C.ACCENTS.red) || '#ff453a';
  var ICON = {
    pause:
      '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="4" y="3" width="3.6" height="12" rx="1.4" fill="currentColor"/><rect x="10.4" y="3" width="3.6" height="12" rx="1.4" ' +
      'fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 3.4v11.2c0 .8.9 1.3 1.6.9l9-5.6c.6-.4.6-1.3 0-1.7l-9-5.6C5.9 2.2 5 2.6 5 3.4Z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="3.5" y="3.5" width="11" height="11" rx="2.6" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9.4l3.5 3.6 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  var CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.la{box-sizing:border-box;height:100%;position:relative;display:flex;overflow:hidden;padding:' + C.blockPad('18px') + ';' +
      C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent;cursor:pointer}',
    '.art{flex:none;display:block}',
    // a centered tile (Small, and each machine of two): the drawing, the name, what it is doing
    '.ct{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px}',
    '.ct .nm{' + type('headline') + ';font-size:21px;line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;margin-top:12px}',
    '.ct .st{font-size:20px;font-weight:400;line-height:27px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.ct.sm .nm{font-size:17px;line-height:22px;margin-top:10px}.ct.sm .st{font-size:16px;line-height:21px}',
    '.ct .pills{margin-top:10px}',
    '.hv{width:1px;align-self:stretch;flex:none;background:' + v('line') + ';margin:0 6px}',
    '.hh{height:1px;align-self:stretch;flex:none;background:' + v('line') + ';margin:6px 0}',
    // the words beside or under the drawing: a name label, the title (or the hero), its line, the finish
    '.col{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:5px}',
    '.lbl{' + type('label') + ';text-transform:uppercase;color:' + v('ink-2') + ';line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ti{' + type('title') + ';line-height:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hero{' + type('figure') + ';line-height:34px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // (read from across the room, DESIGN.md: what it is doing 17, when it's done 15 -- the owner, 2026-11-10: "the text could actually be bigger")
    '.sb{font-size:17px;font-weight:500;line-height:22px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fn{' + type('body') + ';line-height:20px;color:' + v('ink-3') + ';white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.mint{color:' + MINT + '}.red{color:' + RED + '}',
    '.foot{margin-top:auto;display:flex;flex-direction:column;gap:12px;min-width:0}',
    // the cycle's steps: a short bar each, its name under it
    '.trk{display:flex;gap:6px;width:100%}',
    '.trk .s{flex:1 1 0;display:flex;flex-direction:column;gap:6px;min-width:0}',
    '.trk .b{height:6px;border-radius:3px;background:' + v('line-strong') + ';overflow:hidden}.trk .b i{display:block;height:100%;background:' + MINT + '}',
    '.trk .n{' + type('label-small') + ';text-transform:uppercase;color:' + v('ink-3') + ';line-height:13px;white-space:nowrap}',
    '.trk .s.now .n{color:' + v('ink') + '}.trk .s.done .n{color:' + v('ink-2') + '}',
    '.trk.nar .s:not(.now) .n{visibility:hidden}',
    // readings on Large and Extra Large: hairlines between, the value at the right
    '.rows{display:flex;flex-direction:column}',
    '.rows .r{display:flex;justify-content:space-between;gap:10px;height:38px;align-items:center;border-top:1px solid ' + v('line') + ';' + type('body') + ';color:' + v('ink-2') + '}',
    '.rows .r:first-child{border-top:0}',
    '.rows .r b{font-weight:600;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rows .r b.red{color:' + RED + '}',
    // THE STANDARD PILL (DESIGN.md): a 40 px capsule in the key's fill, an 18 px glyph and a 15 / 600 word, a 56 px touch
    '.pills{display:flex;gap:16px;flex-wrap:nowrap}',
    '.pill{all:unset;box-sizing:border-box;position:relative;flex:none;display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 16px;border-radius:20px;',
    '  background:' + v('key') + ';color:' + v('ink') + ';font-size:15px;font-weight:600;line-height:1;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}',
    '.pill::after{content:"";position:absolute;inset:-8px -6px}.pill:active{filter:brightness(.9)}',
    '.pill:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
    '.pill svg{width:18px;height:18px;flex:none}.pill.stop{color:' + RED + '}',
    '.more{position:absolute;top:14px;right:16px;' + type('label-small') + ';color:' + v('ink-3') + '}',
    '.half{flex:1 1 0;min-width:0;min-height:0;display:flex}',
    // the cycle's settings under the finish (Extra Large); THIS LOAD'S POWER: its watts, what it has used, its graph (hk-laundry.js trace)
    '.set{' + type('body') + ';line-height:20px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pw{margin-top:auto;display:flex;flex-direction:column;gap:8px;min-width:0}.pw svg{display:block;overflow:visible}',
    '.pw .ph{display:flex;align-items:baseline;gap:8px;min-width:0;line-height:22px}.pw .pl{' + type('body') + ';color:' + v('ink-2') + '}',
    '.pw .ph b{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.pw .pk{margin-left:auto;' + type('body') + ';color:' + v('ink-3') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.none{margin:auto 0 0}.none .ti{white-space:normal}.none .sb{white-space:normal}',
    '@media (prefers-reduced-motion:reduce){.pill:active{filter:none}}'
  ].join('');

  class HkLaundryCard extends HkBase {
    static get CSS() { return CSS + (window.hkLaundry ? window.hkLaundry.CSS : ''); }
    getCardSize() { return 4; }
    _size() {
      var s = (this.getAttribute && this.getAttribute('size')) || (this._config || {}).size;
      return SIZES.test(s || '') ? s : 'L';
    }
    // the block inside its inset, its cell shape (as hk-alert.js reads it)
    _box(size) {
      this._watchBlock();
      var b = this._block(), d = SQ_BLOCK[size] || SQ_BLOCK.L, cs = null, pad = {};
      try { cs = getComputedStyle(/** @type {any} */ (this)); } catch (e) { cs = null; }
      ['t', 'r', 'b', 'l'].forEach(function (k) { var n = cs ? parseFloat(cs.getPropertyValue('--hk-pad-' + k)) : NaN; pad[k] = n >= 0 ? n : 18; });
      var w = b ? b.w : d[0], h = b ? b.h : d[1];
      var tile = (size === 'S' || size === 'W') ? h < 180 : h < 370;
      return { w: w, h: h, iw: Math.max(0, w - pad.l - pad.r), ih: Math.max(0, h - pad.t - pad.b), tile: tile };
    }
    _looks() {
      var L = window.hkLaundry;
      if (!L || !this.client) return [];
      // two at most, the one most worth a look first where only one fits; otherwise in the house's own order (hk-laundry.js shown)
      return L.shown(L.lookAll(this.client), 'W');
    }
    _tapTarget() {
      var self = this, o = (this._last || [])[0];
      if (!o) return [];
      return [{ run: function () { var L = window.hkLaundry; if (L) L.open(o.id, self.client); } }];
    }
    _sigOf() {
      var L = window.hkLaundry, s = (this.client && this.client.states) || {}, out = this._size() + (this._blockKey || '') + '|' + Math.floor(Date.now() / 30000) + '|';
      if (!L || !this.client) return out + 'none';
      var list = L.machines(this.client);
      out += list.map(function (m) { return m.id + ':' + m.kind + ':' + m.name; }).join(',') + '|';
      list.forEach(function (m) { L.ids(s && { states: s }, m).forEach(function (id) { if (id === m.power && m.status) return; var st = s[id]; out += id + '=' +
        (st ? st.state + '@' + (st.last_changed || '') : 'x') + ';'; }); });
      return out;
    }
    connectedCallback() {
      super.connectedCallback();
      var self = this;
      clearInterval(this._tick);
      this._tick = setInterval(function () { self.redraw(); }, 30000);
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      clearInterval(this._tick); this._tick = null;
    }
    // THE PARTS
    _art(o, w) {
      var L = window.hkLaundry;
      return '<div class="art" style="width:' + Math.round(w) + 'px">' + L.art(o.state, o.kind, { display: w >= 90 ? L.display(o) : '', label: o.name + ', ' + o.title }) + '</div>';
    }
    // THE DRAWING TRIMMED TO THE MACHINE (94 : 132; hk-laundry.js `crop`), for the flipped blocks (the owner, 2026-11-10: "the text is
    // where it is in relation to the animation ... looks kind of thrown on"): its sides are the machine's own, its right edge on the block's
    // inset; its top keeps room for the heat lines (the owner: on Extra Large "the heat animation is really close to the top edge"), so
    // they start level with the state's capitals and the machine a line lower, level with the time. CAP: a hero's capitals sit 7 px under
    // its line's top (30 / 34), a title's 5 (22 / 26)
    _artC(o, w, cap) {
      var L = window.hkLaundry;
      return '<div class="art" style="width:' + Math.round(w) + 'px;margin-top:' + (cap || 0) + 'px">' +
        L.art(o.state, o.kind, { crop: true, display: w >= 70 ? L.display(o) : '', label: o.name + ', ' + o.title }) + '</div>';
    }
    _fitC(w, h) { return Math.max(40, Math.min(w, h * 94 / 132)); }
    _tone(o) { return o.state === 'leak' || o.state === 'error' ? ' red' : (o.state === 'done' || o.state === 'wrinkle') ? ' mint' : ''; }
    // (narrow: too little room for every step's name -- a narrow Tall -- only the step it's on is named)
    _track(o, w) {
      if (!o.steps) return '';
      var narrow = w != null && (w - 6 * (o.steps.length - 1)) / o.steps.length < 42;
      return '<div class="trk' + (narrow ? ' nar' : '') + '">' + o.steps.map(function (s) {
        return '<div class="s' + (s.done ? ' done' : s.now ? ' now' : '') + '"><div class="b"><i style="width:' + (s.done ? 100 : s.now ? 50 : 0) + '%' + (s.color ? ';background:' + s.color : '') +
          '"></i></div><div class="n">' + esc(s.name) + '</div></div>';
      }).join('') + '</div>';
    }
    // the keys a block may hold: Clear on a held Done; Pause (or Resume) and Stop where the machine takes them now
    _pills(o, max) {
      var L = window.hkLaundry, out = [];
      if (o.held && (o.machine === 'done' || o.machine === 'wrinkle')) out.push('<button type="button" class="pill" data-k="clear" data-m="' + esc(o.id) + '">' + ICON.check + 'Clear</button>');
      else if (o.runs && o.machine !== 'delayed') {
        var m = L.byId(this.client, o.id), c = m ? L.controls(this.client, m) : null;
        if (c && !c.why) {
          if (o.machine === 'paused' && c.resume) out.push('<button type="button" class="pill" data-k="resume" data-m="' + esc(o.id) + '">' + ICON.play + 'Resume</button>');
          else if (o.machine !== 'paused' && c.pause) out.push('<button type="button" class="pill" data-k="pause" data-m="' + esc(o.id) + '">' + ICON.pause + 'Pause</button>');
          if (c.stop) out.push('<button type="button" class="pill stop" data-k="stop" data-m="' + esc(o.id) + '">' + ICON.stop + 'Stop</button>');
        }
      }
      out = out.slice(0, max);
      return out.length ? '<div class="pills">' + out.join('') + '</div>' : '';
    }
    _rows(o, max) {
      var rows = [];
      if (o.door) rows.push(['Door', o.door]);
      // (no Remote Control here -- the owner, 2026-11-10: "probably don't need to see if remote control is on or not"; the sheet keeps
      // it, where it says why Pause and Stop aren't offered)
      if (o.watts != null && o.src === 'power') rows.push(['Power', Math.round(o.watts) + ' W']);
      if (o.pct != null) rows.push(['Progress', Math.round(o.pct) + '%']);
      var m = window.hkLaundry.byId(this.client, o.id);
      if (m && m.leak) rows.push(['Leak Sensor', o.leak ? 'Wet' : 'Dry', o.leak]);
      rows = rows.slice(0, max);
      return rows.length ? '<div class="rows">' + rows.map(function (r) { return '<div class="r">' + esc(r[0]) + '<b' + (r[2] ? ' class="red"' : '') + '>' + esc(r[1]) + '</b></div>'; }).join('') +
        '</div>' : '';
    }
    // THIS LOAD'S POWER (the owner, 2026-11-10: the mockups, "you may be able to add the power to the Large card as well"): "Power 451 W",
    // the kWh it has used at the right, and under them its watts since it started, each stretch in its step's color, a dotted line on
    // to the finish. Drawn into its place (.pw) apart from the block, so the drum never restarts for a new reading
    _trace(o) {
      var L = window.hkLaundry, m = L.byId(this.client, o.id);
      if (!m || !m.power || !L.trace) return null;
      var t = L.trace(this.client, m, o, this, Date.now());
      return t ? { m: m, t: t } : null;
    }
    _pwPart(o, tr, w, gh) {
      this._pwHtml = this._pwHtml || {};
      var L = window.hkLaundry, t = tr.t, unit = String((((this.client.states || {})[tr.m.power] || {}).attributes || {}).unit_of_measurement || '');
      var watts = t.wait ? (o.watts || 0) * (/^kw$/i.test(unit) ? 1000 : 1) : t.watts, still = t.wait || t.bare;
      var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
      var h = '<div class="ph"><span class="pl">Power</span><b>' + fmt(watts) + ' W</b>' +
        (still ? '' : '<span class="pk">' + (t.kwh < 10 ? t.kwh.toFixed(1) : fmt(t.kwh)) + ' kWh' + (w >= 300 ? ' this load' : '') + '</span>') + '</div>';
      if (!still && gh >= 28 && t.bins.length) {
        var W = Math.max(40, Math.round(w)), H = Math.round(Math.min(gh, 90)), max = Math.max(500, t.peak * 1.1), span = Math.max(1, t.end - t.start);
        var X = function (x) { return ((x - t.start) / span * W).toFixed(1); }, Y = function (x) { return (H - 2 - Math.min(1, x / max) * (H - 8)).toFixed(1); };
        var groups = [], svg = '';
        t.bins.forEach(function (b) {
          var p = { x: (b.t0 + b.t1) / 2, w: b.w }, g = groups[groups.length - 1];
          if (!g || g.k !== b.k) groups.push({ k: b.k, p: g ? [g.p[g.p.length - 1], p] : [{ x: t.start, w: b.w }, p] }); else g.p.push(p);
        });
        groups[groups.length - 1].p.push({ x: t.now, w: t.watts });
        groups.forEach(function (g, i) {
          var c = L.STEP_COLORS[g.k] || '#63e6e2', line = g.p.map(function (p, k) { return (k ? 'L' : 'M') + X(p.x) + ' ' + Y(p.w); }).join('');
          svg += '<defs><linearGradient id="lpg' + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c + '" stop-opacity=".36"/><stop offset="1" stop-color="' + c +
            '" stop-opacity="0"/></linearGradient></defs>' +
            '<path d="' + line + 'L' + X(g.p[g.p.length - 1].x) + ' ' + H + 'L' + X(g.p[0].x) + ' ' + H + 'Z" fill="url(#lpg' + i + ')"/>' +
            '<path d="' + line + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        });
        var nx = X(t.now), ny = Y(t.watts);
        svg += (t.end > t.now + 60000 ? '<line x1="' + nx + '" y1="' + H + '" x2="' + W + '" y2="' + H + '" stroke="' + v('ink-3') +
          '" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/>' : '') +
          '<circle cx="' + nx + '" cy="' + ny + '" r="8" fill="' + v('ink') + '" opacity=".16"/><circle cx="' + nx + '" cy="' + ny + '" r="4.5" fill="' + v('ink') + '"/>';
        h += '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Power this load, ' + fmt(t.peak) + ' W at most">' + svg + '</svg>';
      }
      this._pwHtml[o.id] = h;
      return '<div class="pw" data-pw="' + esc(o.id) + '"></div>';
    }
    _ctile(o, dw, small, pills) {
      return '<div class="ct' + (small ? ' sm' : '') + '">' + this._art(o, dw) + '<div class="nm">' + esc(o.name) + '</div><div class="st' + this._tone(o) + '">' + esc(o.short) + '</div>' +
        (pills || '') + '</div>';
    }
    // a drawing's width that fits a height (the drawing is 140 : 150)
    _fit(w, h) { return Math.max(40, Math.min(w, h * 140 / 150)); }
    _one(size, box, o) {
      var iw = box.iw, ih = box.ih, tone = this._tone(o), fin = o.endsWords ? '<div class="fn">' + esc(o.endsWords) + '</div>' : '';
      if (size === 'S') return this._ctile(o, this._fit(iw, ih - (box.tile ? 56 : 68)) * (box.tile ? 1 : 0.92), box.tile, '');
      // FLIPPED (2026-11-10, the owner's go-ahead on the mockup): what it is doing upper left, where the headline rule puts it; the machine
      // on the right, trimmed to its ink; GAP clear between them, never less ("breathing room between the texts and the animated glyphs");
      // the steps and readings under the words on the same left edge
      var GAP = 18;
      if (size === 'W') {
        var aw = this._fitC(Math.min(110, iw * 0.32), ih - 5);
        var wp = this._pills(o, 1), foot = (box.tile && (wp || ih < 100) ? '' : this._track(o, iw - aw - GAP)) + wp;
        return '<div style="display:flex;gap:' + GAP + 'px;align-items:flex-start;flex:1;min-width:0">' +
          '<div class="col" style="align-self:stretch"><div class="ti' + tone + '">' + esc(o.title) + '</div><div class="sb' + (o.state === 'leak' ? ' red' : '') + '">' + esc(o.sub) + '</div>' +
            (box.tile ? '' : fin) +
          (foot ? '<div class="foot">' + foot + '</div>' : '') + '</div>' + this._artC(o, aw, 5) + '</div>';
      }
      if (size === 'T') {
        var tfoot = this._track(o, iw) + this._pills(o, 1);
        var th = ih - 34 - 20 - (o.endsWords && !box.tile ? 18 : 0) - (o.steps ? 35 : 0) - (tfoot.indexOf('pill') >= 0 ? 52 : 0) - 24;
        return '<div class="col" style="align-items:center;text-align:center;gap:6px">' + this._art(o, this._fit(iw * 0.94, th)) +
          '<div class="ti" style="margin-top:12px">' + esc(o.title) + '</div><div class="sb' + tone + '">' + esc(o.sub) + '</div>' + (box.tile ? '' : fin) +
          (tfoot ? '<div class="foot" style="width:100%;align-items:center">' + tfoot + '</div>' : '') + '</div>';
      }
      var words = '<div class="col" style="gap:4px;flex:none"><div class="hero' + tone + '">' + esc(o.title) + '</div><div class="sb' + (o.state === 'leak' ? ' red' : '') + '">' + esc(o.sub) +
        '</div>' + fin + '</div>';
      if (size === 'L') {
        // (the readings first -- the owner: "what happened to the other data on the Large ... card": up to three rows, then the drawing
        // takes the height that leaves, never shorter than the words beside it)
        var lp = this._pills(o, 2), ltr = this._trace(o);
        if (ltr) {
          // (with its power: the words and the machine, the steps, then the power to the foot -- the graph takes what is left, 44 at least)
          var lfoot = 14 + (o.steps ? 40 : 0) + 30 + (lp ? 66 : 0), ltop = Math.max(91, Math.min(166, ih - lfoot - 56)), lw = this._fitC(Math.min(116, iw * 0.36), ltop - 7);
          var lgh = ih - Math.max(lw * 132 / 94 + 7, 84) - lfoot;
          return '<div class="col" style="gap:14px"><div style="display:flex;gap:' + GAP + 'px;align-items:flex-start;justify-content:space-between;min-width:0">' + words + this._artC(o, lw, 7) +
            '</div>' +
            this._track(o, iw) + this._pwPart(o, ltr, iw, lgh) + (lp ? '<div class="foot" style="margin-top:0">' + lp + '</div>' : '') + '</div>';
        }
        var all = box.tile ? 0 : (this._rows(o, 3).match(/class="r"/g) || []).length;
        var free = ih - 14 - (o.steps ? 43 : 0) - (lp ? 52 : 0), n = Math.max(0, Math.min(all, Math.floor((free - 84) / 38)));
        var lrows = n ? this._rows(o, n) : '', la = this._fitC(Math.min(116, iw * 0.36), Math.max(84, Math.min(166, free - n * 38 - (n ? 12 : 0))) - 7);
        return '<div class="col" style="gap:14px"><div style="display:flex;gap:' + GAP + 'px;align-items:flex-start;justify-content:space-between;min-width:0">' + words + this._artC(o, la, 7) +
          '</div>' +
          this._track(o, iw) + lrows + (lp ? '<div class="foot">' + lp + '</div>' : '') + '</div>';
      }
      // (Extra Large: the cycle's settings under the finish, and this load's power in place of the readings when it has a power sensor)
      var xa = this._fitC(Math.min(170, iw * 0.36), ih - 7), xp = this._pills(o, 2), xtr = this._trace(o), cw = iw - xa - GAP;
      var xm = window.hkLaundry.byId(this.client, o.id), xs = xm && window.hkLaundry.settingsOf ? window.hkLaundry.settingsOf(this.client, xm) : '';
      var xwords = xs ? words.replace(/<\/div>$/, '<div class="set">' + esc(xs) + '</div></div>') : words;
      var used = 34 + 22 + (fin ? 24 : 0) + (xs ? 24 : 0) + 14 + (o.steps ? 40 : 0) + 30 + (xp ? 66 : 0);
      var xbody = xtr ? this._pwPart(o, xtr, cw, ih - used) : this._rows(o, box.tile ? 2 : 4);
      return '<div style="display:flex;gap:' + GAP + 'px;flex:1;min-width:0;align-items:flex-start">' +
        '<div class="col" style="gap:14px;align-self:stretch">' + xwords + this._track(o, cw) + xbody + (xp ? '<div class="foot"' + (xtr ? ' style="margin-top:0"' : '') + '>' + xp + '</div>' : '') +
          '</div>' +
        this._artC(o, xa, 7) + '</div>';
    }
    _two(size, box, list) {
      var self = this, iw = box.iw, ih = box.ih;
      var half = function (o, inner) { return '<div class="half" data-open data-m="' + esc(o.id) + '" role="button" tabindex="0" aria-label="' + esc(o.name + ', ' + o.title) + '">' + inner + '</div>';
        };
      if (size === 'W') return list.map(function (o, i) { return (i ? '<div class="hv"></div>' : '') + half(o, self._ctile(o, self._fit(iw / 2 - 30, ih - 54), true, '')); }).join('');
      if (size === 'T') {
        return '<div class="col" style="gap:0">' + list.map(function (o, i) { return (i ? '<div class="hh"></div>' : '') + half(o, self._ctile(o, self._fit(iw * 0.6, ih / 2 - 64), true, '')); }).join(
          '') + '</div>';
      }
      if (size === 'L') {
        return list.map(function (o, i) {
          var p = self._pills(o, 1), t = box.tile ? '' : self._track(o, iw / 2 - 24);
          var aw = self._fit(Math.min(130, iw / 2 - 24), ih - 100 - (t ? 34 : 0) - (p ? 52 : 0));
          return (i ? '<div class="hv"></div>' : '') + half(o, '<div class="ct">' + self._art(o, aw) + '<div class="nm" style="font-size:17px;line-height:22px">' + esc(o.name) + '</div>' +
            '<div class="ti" style="font-size:20px;line-height:24px' + (self._tone(o) ? ';color:' + (o.state === 'leak' || o.state === 'error' ? RED : MINT) : '') + '">' + esc(o.title) +
              '</div><div class="fn" style="color:' + v('ink-2') + '">' + esc(o.sub) + '</div>' +
            (t || p ? '<div style="margin-top:12px;width:100%;display:flex;flex-direction:column;gap:12px;align-items:center">' + t + p + '</div>' : '') + '</div>');
        }).join('');
      }
      // Extra Large: each its own column, flipped as one machine is -- its name over what it is doing (two need telling apart), the machine
      // at the column's upper right, the steps, its readings and its keys under the words
      return list.map(function (o, i) {
        var rows = self._rows(o, box.tile ? 1 : 3), p = self._pills(o, 2), cw = iw / 2 - 26, xa = self._fitC(Math.min(88, cw * 0.36), 112);
        return (i ? '<div class="hv"></div>' : '') + half(o, '<div class="col" style="gap:12px;padding:0 6px"><div style="display:flex;gap:16px;align-items:flex-start">' +
          '<div class="col" style="gap:4px"><div class="lbl">' + esc(o.name) + '</div><div class="ti' + self._tone(o) + '">' + esc(o.title) + '</div>' +
          '<div class="fn" style="color:' + v('ink-2') + '">' + esc(o.sub) + '</div>' + (o.endsWords && !box.tile ? '<div class="fn">' + esc(o.endsWords) + '</div>' : '') + '</div>' +
          self._artC(o, xa, 21) + '</div>' + self._track(o, cw) + rows + (p ? '<div class="foot">' + p + '</div>' : '') + '</div>');
      }).join('');
    }
    // THE KIT'S CARD (round 12, phase 34; hk-kit.js): today's card in the kit's parts, the owner: "I'd like to use the animations we have
    // created - i'm a pretty big fan of the card we have now for laundry, but wanted to just make it more in line with the new style",
    // "I don't want separate little tiles", "we have one machine that does both Washing and Drying. Is the card setup to support that? The
    // existing one does this." Kept: the front-loader drawn and animated by what it does (hkLaundry.art), the name, what it is doing, the
    // time, the cycle's steps and its keys (Clear on a held Done; Pause or Resume and Stop where the machine offers them). New: ONE plate,
    // a hairline between two machines, the words in the kit's type on the 18 inset, the steps as 6 px bars in their colors with their names
    // under (the one it is in, in ink), keys as the kit's 64 keys on the 13 edge.
    //   S   the machine that needs you (a leak or an error, then a Done, then the one running), its drawing and words centered
    //   W   two halves: the drawing, the name, "Rinsing . 24 min left"      T   the same, one above the other
    //   L   two columns: the drawing, the words, the steps named, a key foot       XL  each column flipped as today's one machine is: its name
    //       over what it is doing in display type, the time left and the end, the drawing cropped at its upper right, steps, readings, keys
    // ONE MACHINE (a washer-dryer, or a house with one) is the plate itself, the drawing large: W drawing left with the words, the steps and
    // its key at the right; T drawing, words, steps, key; L the drawing big, the steps named (Wash Rinse Spin Dry Cool for a combo); XL the
    // words left, the cropped drawing right, steps, readings, the key at the foot.
    _renderKit() {
      var K = window.hkKit, L = window.hkLaundry, self = this;
      if (!K || !L || !this.client) return false;
      this._watchBlock();
      var size = this._size(), k = K.ctx(this), w = k.w, h = k.h, E = k.E, X = k.X, KH = K.KH, G = K.G, sq = h >= 180, esc2 = K.esc;
      var all = L.lookAll(this.client), list = L.shown(all, size), o = '';
      this._last = list;
      var ink = K.v('ink', 'rgba(255,255,255,0.94)'), ink3 = K.v('ink-3', 'rgba(255,255,255,0.40)');
      /** @param {any} m */
      var toneOf = function (m) { return m.state === 'leak' || m.state === 'error' ? RED : (m.state === 'done' || m.state === 'wrinkle') ? MINT : ''; };
      // WHAT IT IS DOING in one line, "Rinsing . 24 min left", the state's word in its color (Done mint, a leak or an error red); where the
      // line is too long for its room, the short one ("24 min left", "Done"), then the state alone
      /** @param {any} m @param {number} ww */
      var said = function (m, ww) {
        var room = Math.floor(ww / 8.4), t = toneOf(m), full = m.title + (m.sub ? ' · ' + m.sub : '');
        var one = function (/** @type {string} */ a, /** @type {string} */ b) { return (t ? '<span style="color:' + t + '">' + esc2(a) + '</span>' : esc2(a)) + (b ? ' · ' + esc2(b) : ''); };
        if (full.length <= room) return one(m.title, m.sub);
        if (m.short && m.short !== m.title && m.short.length <= room) return t ? '<span style="color:' + t + '">' + esc2(m.short) + '</span>' : esc2(m.short);
        return one(m.title, '');
      };
      /** @param {number} x @param {number} y @param {number} ww @param {any} m @param {string} [al] */
      var words = function (x, y, ww, m, al) {
        var cs = 'pointer-events:none' + (al ? ';text-align:' + al : '');
        return K.tx(x, y, ww, 'kt', esc2(m.name), cs) + K.tx(x, y + 24, ww, 'kb', said(m, ww), cs);
      };
      // the machine drawn in a room of aw x ah: its own 140 : 150 (cropped to its ink, 94 : 132, for the flipped blocks), centered or at the right
      /** @param {any} m @param {number} x @param {number} y @param {number} aw @param {number} ah @param {boolean} [crop] @param {boolean} [right] */
      var art = function (m, x, y, aw, ah, crop, right) {
        var dw = Math.max(30, crop ? Math.min(aw, ah * 94 / 132) : Math.min(aw, ah * 140 / 150)), dh = crop ? dw * 132 / 94 : dw * 150 / 140;
        var shown = L.display(m);
        return K.box(right ? x + aw - dw : x + (aw - dw) / 2, y, dw, dh, '', 'pointer-events:none',
          L.art(m.state, m.kind, { crop: !!crop, display: dw >= (crop ? 70 : 90) ? shown : '', label: m.name + ', ' + m.title }));
      };
      var artH = function (/** @type {number} */ aw, /** @type {number} */ ah, /** @type {boolean} */ crop) {
        var dw = crop ? Math.min(aw, ah * 94 / 132) : Math.min(aw, ah * 140 / 150); return crop ? dw * 132 / 94 : dw * 150 / 140; };
      // THE STEPS: a 6 px bar each in its color (done whole, the one it is in half), its name under (the one it is in, in ink); a name that
      // has no room is left off the others
      /** @param {number} x @param {number} y @param {number} ww @param {any} m @param {boolean} named */
      var steps = function (x, y, ww, m, named) {
        if (!m.steps) return '';
        var n = m.steps.length, sw = (ww - (n - 1) * 6) / n, out = '';
        m.steps.forEach(function (/** @type {any} */ s, /** @type {number} */ i) {
          var f = s.done ? 100 : s.now ? 50 : 0, sx = x + i * (sw + 6);
          out += K.box(sx, y, sw, 6, '', 'border-radius:3px;overflow:hidden;pointer-events:none;background:' + K.v('line-strong', 'rgba(255,255,255,.24)'),
            '<i style="display:block;height:100%;width:' + f + '%;border-radius:3px;background:' + (s.color || MINT) + '"></i>');
          if (named && (sw >= 46 || s.now)) out += K.tx(sx, y + 12, sw, 'kl', esc2(s.name), 'pointer-events:none' + (s.now ? ';color:' + ink : ''));
        });
        return out;
      };
      // THE KEYS (what a tap asks of the machine is the card's, bound below): the first takes the room; a second (Stop) is a 64 key of its own
      // unless both have room for their words
      /** @param {any} m */
      var keyList = function (m) {
        return L.keys(self.client, m).map(function (/** @type {any} */ c) {
          var g = c.k === 'clear' ? K.svg('check', 22) : c.k === 'pause' ? K.svg('pause', 22) : c.k === 'resume' ? K.svg('play', 22) :
            '<span class="g" style="width:22px;height:22px"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" ' +
              'rx="3"/></svg></span>';
          return { g: g, t: c.name, label: c.name + ' the ' + String(m.name).toLowerCase(), data: { k: c.k, m: m.id }, tint: c.k === 'stop' ? RED : '' };
        });
      };
      /** @param {number} x @param {number} y @param {number} ww @param {any} m */
      var keys = function (x, y, ww, m) {
        var ks = keyList(m);
        if (!ks.length) return '';
        if (ks.length === 1) return K.key(x, y, ww, KH, ks[0]);
        if ((ww - G) / 2 >= 100) return K.keyRow(x, y, ww, ks.slice(0, 2));
        var b = Object.assign({}, ks[1]); delete b.t;
        return K.key(x, y, ww - G - KH, KH, ks[0]) + K.key(x + ww - KH, y, KH, KH, b);
      };
      // a machine's half (or the whole plate's touch where one machine is drawn): its sheet
      /** @param {number} x @param {number} y @param {number} ww @param {number} hh @param {any} m */
      var hit = function (x, y, ww, hh, m) {
        return '<button type="button" class="hit" data-notap data-open data-m="' + esc2(m.id) + '" aria-label="' + esc2(m.name + ', ' + m.title) + '" style="' + K.st(x, y, ww, hh) + '"></button>';
      };
      // a machine centered in its tile (Small, and each of two on Wide and Tall): the drawing over the name and what it is doing
      /** @param {any} m @param {number} x0 @param {number} y0 @param {number} tw @param {number} th @param {number} maxA */
      var tileOf = function (m, x0, y0, tw, th, maxA) {
        var p = th >= 180 ? 9 : 5, ah = Math.min(maxA, th - p - 7 - 46 - (th >= 180 ? 18 : 6));
        return art(m, x0 + 4, y0 + p, tw - 8, ah) + words(x0 + 10, y0 + p + artH(tw - 8, ah, false) + 7, tw - 20, m, 'center');
      };
      var more = all.length > 2 && size !== 'S' ? K.tx(w - E - 44, 6, 44, 'kl', '+' + (all.length - 2), 'text-align:right;pointer-events:none') : '';
      var cl = list.length;
      if (!cl) {
        var where = window.hkShell && window.hkShell.settingsPlace ? window.hkShell.settingsPlace('Accessories → Laundry') : 'Accessories → Laundry';
        var none = 'No washer or dryer yet. Add one in ' + esc2(where) + '.';
        o = size === 'S' ? K.tx(X, 18, w - 2 * X, 'kt', 'Laundry') + K.tx(X, 44, w - 2 * X, 'kb', none, 'white-space:normal') :
          K.head(k, { title: 'Laundry' }) + K.tx(X, 74, w - 2 * X, 'kb', none, 'white-space:normal');
      } else if (size === 'S') {
        o = tileOf(list[0], 0, 0, w, h, sq ? 107 : 84);
      } else if (cl === 1) {
        // ONE MACHINE: the plate is the machine
        var m = list[0], ks = keyList(m).length, fy = K.FY(k);
        if (size === 'W') {
          var wa = sq ? 172 : h - 20, wd = Math.min(160, wa * 140 / 150), wx = E + 6 + wd + 11, ww1 = w - wx - X;
          o = art(m, E + 6, sq ? 10 : 10, 160, wa) + words(wx, sq ? 22 : 16, ww1, m) +
            ((sq || !ks) ? steps(wx, sq ? 82 : 70, ww1, m, false) : '') + keys(wx - 6, fy, w - wx + 6 - E, m);
        } else if (size === 'T') {
          var ta = Math.max(70, Math.min(160, h - 12 - 12 - 46 - (m.steps ? 22 : 0) - (ks ? 85 : 20))), ty = 12 + artH(150, ta, false) + 12;
          o = art(m, (w - 150) / 2, 12, 150, ta) + words(X, ty, w - 2 * X, m, 'center') + steps(X, ty + 64, w - 2 * X, m, false) + keys(E, fy, w - 2 * E, m);
        } else if (size === 'L') {
          var la = Math.max(90, Math.min(203, h - 8 - 3 - 46 - 16 - 32 - (ks ? 85 : 20))), ly = 8 + artH(190, la, false) + 3;
          o = art(m, (w - 190) / 2, 8, 190, la) + words(X, ly, w - 2 * X, m, 'center') + steps(X, ly + 62, w - 2 * X, m, true) + keys(E, fy, w - 2 * E, m);
        } else {
          var xa = 176, ax = w - X - 6 - xa, lw1 = ax - X - 14, fl = L.facts(this.client, m), tc = toneOf(m);
          o = art(m, ax, 14, xa, h - 14 - 90, true, true) + K.tx(X, 18, lw1, 'kl', esc2(m.name), 'pointer-events:none') +
            K.tx(X, 42, lw1, 'kd', esc2(m.title), 'pointer-events:none' + (tc ? ';color:' + tc : '')) + K.tx(X, 72, lw1, 'kb', esc2(m.sub), 'pointer-events:none') +
            (m.endsWords ? K.tx(X, 94, lw1, 'kb', esc2(m.endsWords), 'pointer-events:none;color:' + ink3) : '') + steps(X, 150, ax - X - 24, m, true);
          var xr = K.rows(k, 0, ax - 6, m.steps ? 196 : 130, fy - 4, 1, fl.map(function (/** @type {any} */ r) {
            return { t: r.t, b: r.b, tCss: r.red ? 'color:' + RED : '' }; }));
          o += xr.html + keys(E, fy, w - 2 * E, m);
        }
      } else {
        // TWO: two halves of one plate with a hairline between
        var hw = (w - 1) / 2, hh = (h - 1) / 2, a0 = list[0], a1 = list[1];
        if (size === 'W') {
          o = [a0, a1].map(function (m2, i) { var x0 = i * (hw + 1); return hit(x0, 0, hw, h, m2) + tileOf(m2, x0, 0, hw, h, sq ? 103 : 84); }).join('') +
            K.box(hw, 22, 1, h - 44, 'sep', 'pointer-events:none');
        } else if (size === 'T') {
          o = [a0, a1].map(function (m2, i) { var y0 = i * (hh + 1); return hit(0, y0, w, hh, m2) + tileOf(m2, 0, y0, w, hh, 118); }).join('') +
            K.box(X, hh, w - 2 * X, 1, 'sep', 'pointer-events:none');
        } else if (size === 'L') {
          o = [a0, a1].map(function (m2, i) {
            var x0 = i * (hw + 1), ls = !!m2.steps, la2 = Math.max(80, Math.min(144, h - 10 - 7 - 46 - (ls ? 54 : 10) - 85)), ay = 10, wy = ay + artH(hw - 8, la2, false) + 9;
            return hit(x0, 0, hw, h, m2) + art(m2, x0 + 4, ay, hw - 8, la2) + words(x0 + 12, wy, hw - 24, m2, 'center') + steps(x0 + X, wy + 62, hw - 2 * X, m2, true) +
              keys(x0 + E, K.FY(k), hw - 2 * E, m2);
          }).join('') + K.box(hw, 22, 1, h - 44, 'sep', 'pointer-events:none');
        } else {
          o = [a0, a1].map(function (m2, i) {
            var x0 = i * (hw + 1), aw2 = 104, tc2 = toneOf(m2), lw2 = hw - aw2 - X - 14 - X, fl2 = L.facts(self.client, m2).filter(function (/** @type {any} */ r) { return r.b !== 'Progress'; });
            var sy = 180, part = hit(x0, 0, hw, h, m2) + art(m2, x0 + hw - X - 6 - aw2, 16, aw2, 150, true, true) + K.tx(x0 + X, 18, lw2, 'kl', esc2(m2.name), 'pointer-events:none') +
              K.tx(x0 + X, 42, lw2, 'kd', esc2(m2.title), 'pointer-events:none' + (tc2 ? ';color:' + tc2 : '')) + K.tx(x0 + X, 72, lw2, 'kb', esc2(m2.sub), 'pointer-events:none') +
              (m2.endsWords ? K.tx(x0 + X, 94, lw2, 'kb', esc2(m2.endsWords), 'pointer-events:none;color:' + ink3) : '') + steps(x0 + X, sy, hw - 2 * X, m2, true);
            part += K.rows(k, x0, hw, m2.steps ? sy + 42 : 130, K.FY(k) - 4, 1, fl2.map(function (/** @type {any} */ r) {
              return { t: r.t, b: r.b, tCss: r.red ? 'color:' + RED : '', data: { open: '1', m: m2.id } }; })).html;
            return part + keys(x0 + E, K.FY(k), hw - 2 * E, m2);
          }).join('') + K.box(hw, 22, 1, h - 44, 'sep', 'pointer-events:none');
        }
      }
      var label = list.map(function (m3) { return m3.name + ', ' + m3.title + (m3.sub ? ', ' + m3.sub : ''); }).join('; ') || 'Laundry';
      return K.draw(this, K.plate(k, o + more, { label: label, cls: 'la' }), function (/** @type {any} */ root) { self._bindKit(root); });
    }
    /** @param {any} root */
    _bindKit(root) {
      var self = this, L = window.hkLaundry;
      root.querySelectorAll('[data-open]').forEach(function (/** @type {any} */ el) {
        el.addEventListener('click', function () { L.open(el.getAttribute('data-m'), self.client); });
      });
      root.querySelectorAll('button[data-k]').forEach(function (/** @type {any} */ b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-m'), kind = b.getAttribute('data-k');
          if (kind === 'clear') { self._call('script', L.CLEAR, { machine: id }); return; }
          var m = L.byId(self.client, id), c = m ? L.controls(self.client, m)[kind] : null;
          if (c) self._call(c[0], c[1], c[2]);
        });
      });
    }
    _render() {
      // (the kit's card, hk-kit.js; the older drawing below only where the kit draws none)
      if (window.hkKit && window.hkKit.on(this)) { if (this._renderKit()) return; } else if (window.hkKit) window.hkKit.forget(this);
      var self = this, size = this._size(), box = this._box(size), list = this._looks(), L = window.hkLaundry;
      this._last = list;
      var all = L && this.client ? L.machines(this.client).length : 0;
      var body;
      if (!L || !list.length) {
        var where = window.hkShell && window.hkShell.settingsPlace ? window.hkShell.settingsPlace('Accessories \u2192 Laundry') : 'Accessories \u2192 Laundry';
        body = '<div class="col none"><div class="ti">Laundry</div><div class="sb">No washer or dryer yet. Add one in ' + esc(where) + '.</div></div>';
      } else if (list.length === 1 || size === 'S') {
        body = this._one(size, box, list[0]) + (size === 'S' && all > 1 ? '<div class="more">+' + (all - 1) + '</div>' : '');
      } else {
        body = this._two(size, box, list) + (all > 2 ? '<div class="more">+' + (all - 2) + '</div>' : '');
      }
      var html = '<hk-plate class="la ' + size + (box.tile ? ' tc' : ' sq') + (list.length > 1 && size !== 'S' ? ' two' : '') + '" data-hk-role="card" role="group" aria-label="' +
        esc(list.map(function (o) { return o.name + ', ' + o.title + (o.sub ? ', ' + o.sub : ''); }).join('; ') || 'Laundry') + '"' +
        (size === 'W' && list.length > 1 ? ' style="padding-left:8px;padding-right:8px"' : '') + '>' + body + '</hk-plate>';
      if (this._html === html) { this._fillPower(); return; }
      this._html = html;
      this._root.innerHTML = html;
      this._fillPower();
      Array.prototype.forEach.call(this._root.querySelectorAll('.pill'), function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = b.getAttribute('data-m'), k = b.getAttribute('data-k');
          if (k === 'clear') { self._call('script', L.CLEAR, { machine: id }); return; }
          var m = L.byId(self.client, id), c = m ? L.controls(self.client, m)[k] : null;
          if (c) self._call(c[0], c[1], c[2]);
        });
      });
      Array.prototype.forEach.call(this._root.querySelectorAll('.half[data-open]'), function (el) {
        var go = function (e) { e.stopPropagation(); L.open(el.getAttribute('data-m'), self.client); };
        el.addEventListener('click', go);
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
      });
    }
  }

  HkLaundryCard.prototype._fillPower = function () {
    var self = this, parts = this._pwHtml || {};
    Array.prototype.forEach.call(this._root.querySelectorAll('.pw[data-pw]'), function (el) {
      var h = parts[el.getAttribute('data-pw')] || '';
      if (el._hkH !== h) { el._hkH = h; el.innerHTML = h; }
    });
    self._pwHtml = {};
  };
  register('hk-grid-laundry-card', HkLaundryCard, 'HK Laundry',
    'The house’s washers and dryers: what each is doing, how long, and when it’s done. Made for a Home Grid block.');
  if (C.unlisted) C.unlisted('hk-grid-laundry-card');
  window.hkLaundryCard.Card = HkLaundryCard;
  });
})();
