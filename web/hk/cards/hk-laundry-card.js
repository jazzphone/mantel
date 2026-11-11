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
    pause: '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="4" y="3" width="3.6" height="12" rx="1.4" fill="currentColor"/><rect x="10.4" y="3" width="3.6" height="12" rx="1.4" fill="currentColor"/></svg>',
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
    '.ct .nm{' + type('headline') + ';font-size:21px;line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;margin-top:6px}',
    '.ct .st{font-size:20px;font-weight:400;line-height:27px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.ct.sm .nm{font-size:17px;line-height:22px;margin-top:4px}.ct.sm .st{font-size:16px;line-height:21px}',
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
      var list = L.lookAll(this.client), first = L.first(list);
      // two at most, the one most worth a look first where only one fits; otherwise in the house's own order
      return list.length > 2 ? [first].concat(list.filter(function (o) { return o !== first; }).sort(function (a, b) { return L.rank(a) - L.rank(b); }).slice(0, 1)) : list;
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
      list.forEach(function (m) { L.ids(s && { states: s }, m).forEach(function (id) { var st = s[id]; out += id + '=' + (st ? st.state + '@' + (st.last_changed || '') : 'x') + ';'; }); });
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
    _tone(o) { return o.state === 'leak' || o.state === 'error' ? ' red' : (o.state === 'done' || o.state === 'wrinkle') ? ' mint' : ''; }
    // (narrow: too little room for every step's name -- a narrow Tall -- only the step it's on is named)
    _track(o, w) {
      if (!o.steps) return '';
      var narrow = w != null && (w - 6 * (o.steps.length - 1)) / o.steps.length < 42;
      return '<div class="trk' + (narrow ? ' nar' : '') + '">' + o.steps.map(function (s) {
        return '<div class="s' + (s.done ? ' done' : s.now ? ' now' : '') + '"><div class="b"><i style="width:' + (s.done ? 100 : s.now ? 50 : 0) + '%"></i></div><div class="n">' + esc(s.name) + '</div></div>';
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
      if (o.remote !== null) rows.push(['Remote Control', o.remote ? 'On' : 'Off']);
      if (o.watts != null && o.src === 'power') rows.push(['Power', Math.round(o.watts) + ' W']);
      if (o.pct != null) rows.push(['Progress', Math.round(o.pct) + '%']);
      var m = window.hkLaundry.byId(this.client, o.id);
      if (m && m.leak) rows.push(['Leak Sensor', o.leak ? 'Wet' : 'Dry', o.leak]);
      rows = rows.slice(0, max);
      return rows.length ? '<div class="rows">' + rows.map(function (r) { return '<div class="r">' + esc(r[0]) + '<b' + (r[2] ? ' class="red"' : '') + '>' + esc(r[1]) + '</b></div>'; }).join('') + '</div>' : '';
    }
    _ctile(o, dw, small, pills) {
      return '<div class="ct' + (small ? ' sm' : '') + '">' + this._art(o, dw) + '<div class="nm">' + esc(o.name) + '</div><div class="st' + this._tone(o) + '">' + esc(o.short) + '</div>' + (pills || '') + '</div>';
    }
    // a drawing's width that fits a height (the drawing is 140 : 150)
    _fit(w, h) { return Math.max(40, Math.min(w, h * 140 / 150)); }
    _one(size, box, o) {
      var iw = box.iw, ih = box.ih, tone = this._tone(o), fin = o.endsWords ? '<div class="fn">' + esc(o.endsWords) + '</div>' : '';
      if (size === 'S') return this._ctile(o, this._fit(iw, ih - (box.tile ? 50 : 62)) * (box.tile ? 1 : 0.92), box.tile, '');
      if (size === 'W') {
        var aw = this._fit(Math.min(170, iw * 0.4), ih);
        var wp = this._pills(o, 1), foot = (box.tile && (wp || ih < 100) ? '' : this._track(o, iw - aw - 16)) + wp;
        return '<div style="display:flex;gap:16px;align-items:center;flex:1;min-width:0">' + this._art(o, aw) +
          '<div class="col" style="align-self:stretch"><div class="ti' + '">' + esc(o.title) + '</div><div class="sb' + tone + '">' + esc(o.sub) + '</div>' + (box.tile ? '' : fin) +
          (foot ? '<div class="foot">' + foot + '</div>' : '') + '</div></div>';
      }
      if (size === 'T') {
        var tfoot = this._track(o, iw) + this._pills(o, 1);
        var th = ih - 26 - 20 - (o.endsWords && !box.tile ? 18 : 0) - (o.steps ? 35 : 0) - (tfoot.indexOf('pill') >= 0 ? 52 : 0) - 24;
        return '<div class="col" style="align-items:center;text-align:center;gap:6px">' + this._art(o, this._fit(iw * 0.94, th)) +
          '<div class="ti" style="margin-top:4px">' + esc(o.title) + '</div><div class="sb' + tone + '">' + esc(o.sub) + '</div>' + (box.tile ? '' : fin) +
          (tfoot ? '<div class="foot" style="width:100%;align-items:center">' + tfoot + '</div>' : '') + '</div>';
      }
      if (size === 'L') {
        var lp = this._pills(o, 2), nRows = box.tile ? 0 : Math.max(0, Math.min(3, Math.floor((ih - 190 - (o.steps ? 40 : 0) - (lp ? 52 : 0)) / 38)));
        var lrows = nRows ? this._rows(o, nRows) : '';
        var used = (o.steps ? 41 : 0) + (lrows ? (lrows.match(/class="r"/g) || []).length * 38 + 12 : 0) + (lp ? 52 : 0) + 12;
        var lart = this._fit(Math.min(180, iw * 0.46), Math.min(ih - used, 200));
        return '<div class="col" style="gap:12px"><div style="display:flex;gap:14px;align-items:flex-start;min-width:0">' + this._art(o, lart) +
          '<div class="col"><div class="hero' + tone + '">' + esc(o.title) + '</div><div class="sb' + (o.state === 'leak' ? ' red' : '') + '">' + esc(o.sub) + '</div>' + fin + '</div></div>' +
          this._track(o, iw) + lrows + (lp ? '<div class="foot">' + lp + '</div>' : '') + '</div>';
      }
      var xrows = this._rows(o, box.tile ? 2 : 4), xp = this._pills(o, 2);
      return '<div style="display:flex;gap:22px;flex:1;min-width:0"><div style="width:' + Math.round(Math.min(240, iw * 0.42)) + 'px;flex:none;display:flex;align-items:center;justify-content:center">' +
        this._art(o, this._fit(Math.min(240, iw * 0.42), ih)) + '</div>' +
        '<div class="col" style="gap:6px"><div class="hero' + tone + '">' + esc(o.title) + '</div>' +
        '<div class="sb' + (o.state === 'leak' ? ' red' : '') + '">' + esc([o.sub, o.endsWords].filter(Boolean).join(' · ')) + '</div>' +
        (o.steps ? '<div style="margin-top:10px">' + this._track(o, iw - Math.min(240, iw * 0.42) - 22) + '</div>' : '') + (xrows ? '<div style="margin-top:6px">' + xrows + '</div>' : '') +
        (xp ? '<div class="foot">' + xp + '</div>' : '') + '</div></div>';
    }
    _two(size, box, list) {
      var self = this, iw = box.iw, ih = box.ih;
      var half = function (o, inner) { return '<div class="half" data-open data-m="' + esc(o.id) + '" role="button" tabindex="0" aria-label="' + esc(o.name + ', ' + o.title) + '">' + inner + '</div>'; };
      if (size === 'W') return list.map(function (o, i) { return (i ? '<div class="hv"></div>' : '') + half(o, self._ctile(o, self._fit(iw / 2 - 30, ih - 54), true, '')); }).join('');
      if (size === 'T') {
        return '<div class="col" style="gap:0">' + list.map(function (o, i) { return (i ? '<div class="hh"></div>' : '') + half(o, self._ctile(o, self._fit(iw * 0.6, ih / 2 - 64), true, '')); }).join('') + '</div>';
      }
      if (size === 'L') {
        return list.map(function (o, i) {
          var p = self._pills(o, 1), t = box.tile ? '' : self._track(o, iw / 2 - 24);
          var aw = self._fit(Math.min(130, iw / 2 - 24), ih - 100 - (t ? 34 : 0) - (p ? 52 : 0));
          return (i ? '<div class="hv"></div>' : '') + half(o, '<div class="ct">' + self._art(o, aw) + '<div class="nm" style="font-size:17px;line-height:22px">' + esc(o.name) + '</div>' +
            '<div class="ti" style="font-size:20px;line-height:24px' + (self._tone(o) ? ';color:' + (o.state === 'leak' || o.state === 'error' ? RED : MINT) : '') + '">' + esc(o.title) + '</div><div class="fn" style="color:' + v('ink-2') + '">' + esc(o.sub) + '</div>' +
            (t || p ? '<div style="margin-top:12px;width:100%;display:flex;flex-direction:column;gap:12px;align-items:center">' + t + p + '</div>' : '') + '</div>');
        }).join('');
      }
      // Extra Large: each its own column -- the drawing and its words, the steps, its readings, its keys
      return list.map(function (o, i) {
        var rows = self._rows(o, box.tile ? 1 : 3), p = self._pills(o, 2);
        return (i ? '<div class="hv"></div>' : '') + half(o, '<div class="col" style="gap:12px;padding:0 6px"><div style="display:flex;gap:12px;align-items:flex-start">' +
          self._art(o, box.tile ? 80 : 104) + '<div class="col" style="gap:4px"><div class="lbl">' + esc(o.name) + '</div><div class="ti' + self._tone(o) + '">' + esc(o.title) + '</div>' +
          '<div class="fn" style="color:' + v('ink-2') + '">' + esc(o.sub) + '</div>' + (o.endsWords && !box.tile ? '<div class="fn">' + esc(o.endsWords) + '</div>' : '') + '</div></div>' +
          self._track(o, iw / 2 - 30) + rows + (p ? '<div class="foot">' + p + '</div>' : '') + '</div>');
      }).join('');
    }
    _render() {
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
      if (this._html === html) return;
      this._html = html;
      this._root.innerHTML = html;
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

  register('hk-grid-laundry-card', HkLaundryCard, 'HK Laundry',
    'The house’s washers and dryers: what each is doing, how long, and when it’s done. Made for a Home Grid block.');
  if (C.unlisted) C.unlisted('hk-grid-laundry-card');
  window.hkLaundryCard.Card = HkLaundryCard;
  });
})();
