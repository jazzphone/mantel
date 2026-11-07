// @ts-check
// hk-house-status.js -- House Status (docs/phase11/HOUSE-STATUS.md): this screen's status chips as a Home Grid block
// and a sheet, in HomeView's look rather than the chip row's pills.
//
//   hk-house-status-card    `house_status` (S, W, T, L, XL; hk-grid-catalog.js): the sections at a glance. Wide and Tall
//                           four, Large six, Extra Large six or eight -- as many as the block's measure holds at a
//                           readable size, each its own tap to the page its chip opens; the rest are "+N more", which
//                           opens the sheet. Small is one button: the section that matters most, and the sheet.
//   hk-house-status-sheet   the sheet's body, in the shared detail sheet (hkDetail.open {panel}): every section the
//                           screen shows. Wide (820) when two columns of panels fit the window, else the standard
//                           sheet's rows (in two columns on a short, wide window); the body scrolls, never shrinks.
//
// WHAT IT SHOWS is the chips' (hkChip.status, hk-chip.js): which chips, their order, Always or When Active, Smoke & CO
// first, the custom and entity chips -- whether or not the screen draws its chip row. Nothing here decides what a
// chip says; this file lays out what it says. Taps open pages and sheets only: no section turns anything on or off.
//
// THE PURE PART is first and has no DOM (window.hkHouseStatus.lib): tests/test_house_status.py runs it in node.
(function () {
  'use strict';
  if (window.hkHouseStatus) return;                    // double-load guard

  // ======================================================================== pure
  // the sections a size holds (its capacity: what is drawn when there are more is the same, plus "+N more")
  var CAP = { S: 0, W: 4, T: 4, L: 6, XL: 8 };
  var HEAD = 44;                                       // the heading's row: the label and "+N more", a finger tall
  var HEAD_TIGHT = 26;                                 // ...on a block too short for that (a Wide tile cell, 150 tall)
  var TAP = 44;                                        // a section is never shorter than a finger
  var FOOT = 30;                                       // "+N more" under the sections, on a block too narrow for it beside the heading
  var NARROW = 210;                                    // ...narrower than this (Tall, a Small-wide column)
  // [columns, rows] for n sections at a size: Wide two by two, Tall a column, Large two by three, Extra Large three
  // by two (four by two past six) -- and fewer, laid out for fewer, never six slots with two filled
  function gridOf(size, n) {
    n = Math.max(1, n);
    if (size === 'W') return n >= 4 ? [2, 2] : [n, 1];
    if (size === 'T') return [1, Math.min(n, 4)];
    if (size === 'L') return n >= 5 ? [2, 3] : n === 4 ? [2, 2] : [1, n];
    if (size === 'XL') return n >= 7 ? [4, 2] : n >= 5 ? [3, 2] : n === 4 ? [2, 2] : [n, 1];
    return [1, 1];
  }
  // HOW n SECTIONS LAY OUT in a block of iw x ih px (inside its inset): {cols, rows, shown, more, head, density, rowH,
  // colW, gap}. density by the room a section has: 'one' a single line (the glyph, the name, the reading), 'two' the
  // name over the reading, 'rich' and its line of detail, 'full' larger, with a second line. Rows that would be under
  // a finger's height are given up (the sections go to "+N more"), never squeezed.
  function layout(size, iw, ih, n) {
    var cap = CAP[size] || 0, shown = Math.min(Math.max(0, n), cap), g = gridOf(size, shown), cols = g[0], rows = g[1];
    var gap = size === 'XL' ? 18 : 22;
    var foot = n > shown && iw < NARROW ? FOOT : 0;
    var head = (ih - foot - HEAD) / rows >= 56 ? HEAD : HEAD_TIGHT;
    var rowH = (ih - head - foot) / rows;
    while (rows > 1 && rowH < TAP) {
      rows--; shown = Math.min(shown, cols * rows);
      foot = n > shown && iw < NARROW ? FOOT : 0;
      rowH = (ih - head - foot) / rows;
    }
    var colW = (iw - (cols - 1) * gap) / cols;
    var density = rowH >= 120 && colW >= 120 ? 'full' : rowH >= 88 ? 'rich' : rowH >= 56 ? 'two' : 'one';
    return { cols: cols, rows: rows, shown: shown, more: Math.max(0, n - shown), head: head, foot: foot, density: density,
             rowH: rowH, colW: colW, gap: gap };
  }
  // THE SHEET'S WIDTH, asked when it opens: the wide one (820) for two or more sections when the window has room
  // for it beside the screen's own menu (a docked menu's width, `left`) and height for its panels (640: the sheet's
  // 680 less what the window takes, about three rows of them), and is no phone and no short window, which have
  // sheets of their own (hk-detail.js); else the standard one
  function wantWide(vw, vh, n, left) {
    return n >= 2 && vw > 640 && vh >= 640 && vw - (left || 0) - 32 >= 820;
  }
  // THE SHEET'S BODY by its own width: panels two across (the wide sheet), rows two across (a short window's
  // wider sheet), or rows
  function sheetMode(w, n) {
    if (n >= 2 && w >= 640) return 'panels';
    if (n >= 3 && w >= 480) return 'rows2';
    return 'rows';
  }
  // the section Small shows: an alert, else one asking for attention, else the first
  function lead(sections) {
    var s = sections || [];
    return s.filter(function (x) { return x.urgent; })[0] || s.filter(function (x) { return x.attention; })[0] || s[0] || null;
  }
  // a reading in words (Small, a screen reader): "3 On", "72°", "8:42", "Armed Home", "No reading"
  function fmtSecs(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' : '') + (h && m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function secsOf(cd, now) {
    if (cd.hold != null) return Math.max(0, Number(cd.hold) || 0);
    return Math.max(0, Math.round((Number(cd.deadline) - (now == null ? Date.now() : now)) / 1000));
  }
  function words(r, now) {
    if (!r || r.none) return 'No reading';
    if (r.countdown) return fmtSecs(secsOf(r.countdown, now)) + (r.countdown.hold != null ? ' paused' : ' left');
    if (r.text) return r.text;
    return r.unit ? r.num + ' ' + r.unit : r.num;
  }
  function count(n) { return n === 1 ? '1 status' : n + ' statuses'; }

  var LIB = { CAP: CAP, HEAD: HEAD, HEAD_TIGHT: HEAD_TIGHT, TAP: TAP, FOOT: FOOT, NARROW: NARROW, gridOf: gridOf, layout: layout, wantWide: wantWide,
              sheetMode: sheetMode, lead: lead, words: words, fmtSecs: fmtSecs, secsOf: secsOf, count: count };
  window.hkHouseStatus = { version: '1.0.0', lib: LIB };

  // ======================================================================== the cards
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-house-status] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkHouseStatus.Card) return;
  var HkBase = C.HkBase, register = C.register, esc = C.esc, v = C.v, T = C.TYPE;
  function type(role) {
    var t = T[role];
    return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '') +
      (t.upper ? ';text-transform:uppercase' : '');
  }
  // the model, from hk-chip.js (a core file; in Home Assistant a resource that may come after this one)
  function S() { return window.hkChip && window.hkChip.status; }
  function board() {
    var M = C.menu;
    try { return (M && M.board ? M.board() : null) || {}; } catch (e) { return {}; }
  }
  // the block in px inside its inset: the view's measure, else a square cell's (as the other blocks' inner())
  var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
  function inner(card, size) {
    if (card._watchBlock) card._watchBlock();
    var b = card._block ? card._block() : null, d = SQ_BLOCK[size] || SQ_BLOCK.L, pad = 18;
    try { pad = parseFloat(getComputedStyle(card).getPropertyValue('--hk-block-pad')) || 18; } catch (e) { pad = 18; }
    return { iw: (b ? b.w : d[0]) - 2 * pad, ih: (b ? b.h : d[1]) - 2 * pad };
  }
  function sizeOf(el) {
    var s = (el.getAttribute && el.getAttribute('size')) || (el._config || {}).size;
    return /^(S|W|T|L|XL)$/.test(s || '') ? s : null;
  }
  // a glyph: the chip's own, else the entity's (an entity chip with no glyph of its own: its state's)
  function glyph(sec, px, color) {
    var st = 'width:' + px + 'px;height:' + px + 'px;--mdc-icon-size:' + px + 'px' + (color ? ';color:' + color : '');
    if (sec.icon) return '<hk-icon class="gl" icon="' + esc(sec.icon) + '" style="' + st + '" aria-hidden="true"></hk-icon>';
    return '<hk-state-icon class="gl" data-e="' + esc(sec.entity || '') + '" style="' + st + '" aria-hidden="true"></hk-state-icon>';
  }
  // the glyph's color: a section asking for attention (an alert, a timer running, a door open) in its chip's color,
  // the rest in the ink -- HomeView's look is the wallpaper's, not a row of colors
  function tint(sec) {
    if (!sec.attention || !sec.color) return null;
    return C.flatColor ? C.flatColor(sec.color, 'on') : sec.color;
  }
  function reading(r, unitRole) {
    if (!r || r.none) return '<span class="v nr">—</span>';
    if (r.countdown) {
      var cd = r.countdown, secs = secsOf(cd), text = window.hkTimers && window.hkTimers.fmt ? window.hkTimers.fmt(secs) : fmtSecs(secs);
      // (the text is the countdown's own now, so a redraw between its ticks never blanks it; it counts from there)
      return '<span class="v"><hk-countdown ' + (cd.hold != null ? 'hold="' + Number(cd.hold) + '"' : 'deadline="' + Number(cd.deadline) + '"') + '>' +
        esc(text) + '</hk-countdown>' + (cd.hold != null ? '<small>Paused</small>' : '') + '</span>';
    }
    if (r.text) return '<span class="v tx">' + esc(r.text) + '</span>';
    return '<span class="v">' + esc(r.num) + (r.unit ? '<small' + (unitRole ? ' class="' + unitRole + '"' : '') + '>' + esc(r.unit) + '</small>' : '') + '</span>';
  }
  function ariaOf(sec) {
    return [sec.name, words(sec.reading), sec.detail].filter(Boolean).join(', ');
  }
  function goes(sec) { return !!sec.tap && sec.tap.action !== 'none' && !(sec.tap.action === 'more-info' && !sec.entity); }
  // A SECTION'S TAP: what its chip's tap does -- the page (a kind's, through the screen's own pages), the entity's
  // sheet, a link, the Intercom -- once. From the sheet a page closes the sheet on its way (hkDetail.navigateFrom).
  function go(el, sec, inSheet) {
    var t = sec && sec.tap, a = t && t.action, D = window.hkDetail;
    if (!a || a === 'none') return false;
    if (a === 'navigate' && t.navigation_path) {
      var path = C.navPath ? C.navPath(t) : t.navigation_path;
      if (inSheet && D && D.navigateFrom) D.navigateFrom(path); else C.navigate(path, el);
      return true;
    }
    if (a === 'more-info' && sec.entity) { window.hkShell.moreInfo(sec.entity, el); return true; }
    if (a === 'url' && t.url_path) { window.open(t.url_path, t.target || '_blank'); return true; }
    if (a === 'intercom' && el._act) { el._act({ action: 'intercom' }); return true; }
    return false;
  }
  // the layout viewport (a zoomed car's --hk-vw / --hk-vh, tesla-viewport.js), and a docked menu's width
  function viewport() {
    var cs = null;
    try { cs = getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    var px = function (name, fb) { var n = cs ? parseFloat(cs.getPropertyValue(name)) : NaN; return n > 0 ? n : fb; };
    return { w: px('--hk-vw', window.innerWidth || 0), h: px('--hk-vh', window.innerHeight || 0), left: px('--hk-content-left', 0) };
  }
  // THE SHEET, opened from the block (Small, "+N more", the block's plate) -- or from anywhere, hkHouseStatus.open()
  function openSheet(n) {
    var D = window.hkDetail;
    if (!D || typeof D.open !== 'function') return false;
    var vp = viewport();
    return !!D.open(null, { name: 'House Status', icon: 'mdi:home' },
      { panel: { tag: 'hk-house-status-sheet', config: { wide: wantWide(vp.w, vp.h, n, vp.left) } } });
  }
  // the client's state glyphs, once drawn (an entity chip with no glyph of its own)
  function bindGlyphs(root, client) {
    if (!client || !client.bindStateIcon) return;
    Array.prototype.forEach.call(root.querySelectorAll('hk-state-icon[data-e]'), function (el) {
      var id = el.getAttribute('data-e'), st = id && client.states ? client.states[id] : null;
      if (st && el.__hkSt !== st) { el.__hkSt = st; client.bindStateIcon(el, st); }
    });
  }

  // ---- what both read: the plan (rebuilt when the settings or the screen's pages move), the sections now
  var Mixin = function (Base) {
    return class extends Base {
      setConfig(config) {
        this._planned = null;
        super.setConfig(config || {});
      }
      connectedCallback() {
        super.connectedCallback();
        this._planned = null;                          // (planned again: the Intercom's watch is let go on the way out)
        if (!this._wake) { var self = this; this._wake = function () { self.redraw(); }; }
        // a settings change (Status & Chips, the screen's chips) and the chip model's arrival
        window.addEventListener('hk-module-ready', this._wake);
        window.addEventListener('hk-chip-ready', this._wake);
      }
      disconnectedCallback() {
        super.disconnectedCallback();
        if (this._wake) { window.removeEventListener('hk-module-ready', this._wake); window.removeEventListener('hk-chip-ready', this._wake); }
        if (this._icOff) { this._icOff(); this._icOff = null; }
      }
      // (hkChip's Intercom watch, icWatch, calls this when the Intercom's feed moves)
      _plan() { this.redraw(); }
      _model() {
        var M = S(), c = this.client;
        if (!M || !c) return null;
        var b = board(), key = M.key(b, c);
        if (!this._planned || this._planned.key !== key) {
          this._planned = M.plan(b, c);
          // the Intercom's entry, for a screen that has it among its chips (as the chip row does): its feed is kept
          // while this card is up, and let go in disconnectedCallback (_icOff)
          if (M.watch && this.isConnected) M.watch(this, b, 'chips_extra');
        }
        return this._planned;
      }
      // REDRAWN when one of the chips' entities moves, the plan moves, or the block's measure does
      _sigOf() {
        var p = this._model(), c = this.client;
        if (!p) return 'hs:none';
        var out = p.key + '#' + (window.hkTimers ? 'T' : 't') + (this.getAttribute && this.getAttribute('size') || '') + (this._blockKey || '') + ';';
        for (var i = 0; i < p.ids.length; i++) {
          var s = c.states[p.ids[i]];
          out += p.ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
        }
        return out;
      }
      _sections() {
        var p = this._model(), M = S();
        return p && M ? M.read(p, this.client) : null;
      }
    };
  };

  // ======================================================================== the Home Grid block
  var BLOCK_CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.hs{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;',
    '  padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent}',
    '.hd{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;min-width:0}',
    '.lb{' + type('label') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    // "+N more": a finger's target round its words, however short the heading's row
    '.mo{all:unset;box-sizing:border-box;position:relative;flex:none;display:flex;align-items:center;gap:2px;min-width:44px;height:100%;',
    '  justify-content:flex-end;' + type('caption') + ';color:' + v('ink-2') + ';cursor:pointer;white-space:nowrap}',
    '.mo::before{content:"";position:absolute;left:-10px;right:-10px;top:50%;height:44px;transform:translateY(-50%)}',
    '.mo hk-icon{width:12px;height:12px;--mdc-icon-size:12px;color:' + v('mark') + '}',
    '.mo:focus-visible,.sc:focus-visible,.all:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px;border-radius:12px}',
    '.hf{display:flex;align-items:flex-end;justify-content:flex-end;flex:none;border-top:1px solid ' + v('line') + '}',
    '.hf .mo{height:auto;min-height:24px}',
    '.gr{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--c),minmax(0,1fr));grid-template-rows:repeat(var(--r),minmax(0,1fr));column-gap:var(--g)}',
    // A SECTION: the whole of it one tap
    '.sc{all:unset;box-sizing:border-box;position:relative;min-width:0;min-height:44px;display:grid;align-content:center;',
    '  cursor:pointer;-webkit-tap-highlight-color:transparent;transition:opacity ' + C.DUR.press + ' ease}',
    '.sc.in{cursor:default}',
    '.sc:not(.in):active{opacity:.7}',
    '.sc.rt{border-top:1px solid ' + v('line') + '}',
    '.sc .gl{display:flex;flex:none;color:' + v('ink') + '}',
    '.sc .nm{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.sc .v{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;color:' + v('ink') + '}',
    '.sc .v small{' + type('body') + ';letter-spacing:0;color:' + v('ink-2') + ';margin-left:4px}',
    '.sc .v.nr{color:' + v('ink-3') + '}',
    '.sc .dt,.sc .ex{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    // one line: the glyph, the name, the reading at the end
    '.d-one .sc{grid-template-columns:20px minmax(0,1fr) auto;grid-template-areas:"g n v";column-gap:8px;align-items:center}',
    '.d-one .sc .v{grid-area:v;' + type('headline') + ';line-height:22px}',
    '.d-one .sc .v small{' + type('caption') + ';margin-left:3px}',
    // two lines: the name over the reading, the glyph beside both
    '.d-two .sc{grid-template-columns:20px minmax(0,1fr);grid-template-areas:"g n" "g v";column-gap:10px;row-gap:0;padding:2px 0}',
    '.d-two .sc .v{' + type('figure') + ';line-height:34px}',
    '.d-two .sc .v.tx{' + type('title') + ';line-height:28px}',
    // and a line of detail; the glyph with the name
    // (from the top of their row, not centered: a row's names and readings line up across it whatever each has under it)
    '.d-rich .sc,.d-full .sc{grid-template-columns:20px minmax(0,1fr);grid-template-areas:"g n" "v v" "d d" "e e";column-gap:7px;row-gap:3px;align-items:center;align-content:start;padding:12px 0 8px}',
    '.d-full .sc{padding-top:16px}',
    '.d-rich .sc .v,.d-full .sc .v{' + type('figure') + ';line-height:36px}',
    '.d-rich .sc .v.tx,.d-full .sc .v.tx{' + type('title') + ';line-height:30px}',
    '.d-full .sc{grid-template-columns:24px minmax(0,1fr);row-gap:5px}',
    '.d-full .sc .v{' + type('figure-l') + ';line-height:42px}',
    '.d-full .sc .v small{' + type('headline') + ';letter-spacing:0}',
    '.d-full .sc .dt{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
    '.sc .gl{grid-area:g}.sc .nm{grid-area:n}.sc .v{grid-area:v}.sc .dt{grid-area:d}.sc .ex{grid-area:e}',
    '.none{margin:auto;' + type('body') + ';color:' + v('ink-2') + ';text-align:center}',
    // SMALL: one button, the plate's whole face
    '.all{all:unset;box-sizing:border-box;flex:1;min-height:0;display:flex;flex-direction:column;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.all:active{opacity:.75}',
    '.all .ld{display:flex;flex-direction:column;gap:2px;min-width:0;margin-top:10px}',
    '.all .ld .gl{display:flex;margin-bottom:6px;color:' + v('ink') + '}',
    '.all .p{' + type('headline') + ';line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.all .s{' + type('body') + ';line-height:19px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.all .s hk-countdown{font:inherit}',
    '.all .f{margin-top:auto;display:flex;align-items:center;gap:3px;' + type('caption') + ';line-height:17px;color:' + v('ink-2') + '}',
    '.all .f hk-icon{width:12px;height:12px;--mdc-icon-size:12px;color:' + v('mark') + '}',
    // (a tile cell's Small, 150 tall: the glyph beside the name)
    '.all.lo .ld{flex-direction:row;align-items:center;gap:8px;margin-top:6px}.all.lo .ld .gl{margin:0}.all.lo .ld>div{min-width:0}',
    '@media (prefers-reduced-motion:reduce){.sc{transition:none}}'
  ].join('');
  var CHEV = '<hk-icon icon="mdi:chevron-right" aria-hidden="true"></hk-icon>';

  class HkHouseStatusCard extends Mixin(HkBase) {
    static get CSS() { return BLOCK_CSS; }
    getCardSize() { return 4; }
    _size() { return sizeOf(this) || 'L'; }
    // (the plate's tap, hk-base.js openTarget): anywhere that is no section -- the heading, a gap -- opens the sheet
    _tapTarget() { var self = this; return [{ run: function () { self._open(); } }]; }
    _open() { var m = this._sections(); return openSheet(m ? m.total : 0); }
    _render() {
      var self = this;
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<hk-plate class="hs" data-hk-role="card" role="group" aria-label="House Status"></hk-plate>';
        this._plate = this._root.querySelector('hk-plate');
        this._plate.addEventListener('click', function (e) {
          var t = /** @type {any} */ (e.target), b = t && t.closest ? t.closest('[data-i],[data-all]') : null;
          if (!b) return;
          e.stopPropagation();                         // one tap, one place: never the plate's too
          if (b.hasAttribute('data-all')) { self._open(); return; }
          var sec = (self._shown || [])[Number(b.getAttribute('data-i'))];
          if (sec) go(self, sec, false);
        });
      }
      var size = this._size(), m = this._sections();
      if (!m) { C.morph(this._plate, '<div class="hd" style="height:' + HEAD + 'px"><div class="lb">House Status</div></div>'); return; }
      var box = inner(this, size), html;
      if (size === 'S') html = this._small(m, box);
      else html = this._grid(m, size, box);
      C.morph(this._plate, html);
      bindGlyphs(this._plate, this.client);
    }
    _small(m, box) {
      var sec = lead(m.sections), lo = box.ih < 140;
      this._shown = [];
      var aria = 'House Status' + (sec ? ': ' + ariaOf(sec) : ': nothing to report') + '. ' + count(m.total) + '. Opens House Status';
      if (!sec) {
        return '<button type="button" class="all" data-all aria-label="' + esc(aria) + '"><div class="lb">House Status</div>' +
          '<div class="ld"><div class="p">Nothing to report</div></div></button>';
      }
      var r = sec.reading, say = r && r.countdown ? reading(r).replace(/^<span class="v">|<\/span>$/g, '') : esc(words(r));
      return '<button type="button" class="all' + (lo ? ' lo' : '') + '" data-all aria-label="' + esc(aria) + '"><div class="lb">House Status</div>' +
        '<div class="ld">' + glyph(sec, lo ? 22 : 28, tint(sec)) + '<div><div class="p">' + esc(sec.name) + '</div><div class="s">' + say + '</div></div></div>' +
        '<div class="f">' + esc(count(m.total)) + CHEV + '</div></button>';
    }
    _grid(m, size, box) {
      var L = layout(size, box.iw, box.ih, m.total), shown = m.sections.slice(0, L.shown);
      this._shown = shown;
      var more = L.more > 0 ? '<button type="button" class="mo" data-all aria-label="' + esc('All ' + count(m.total) + ': opens House Status') + '">+' + L.more + ' more' + CHEV + '</button>' : '';
      var head = '<div class="hd" style="height:' + L.head + 'px"><div class="lb">House Status</div>' + (L.foot ? '' : more) + '</div>';
      var foot = L.foot && more ? '<div class="hf" style="height:' + L.foot + 'px">' + more + '</div>' : '';
      if (!shown.length) return head + '<div class="none">Nothing to report</div>';
      var gpx = L.density === 'full' ? 24 : 20;
      var cells = shown.map(function (sec, i) {
        var live = goes(sec), top = i >= L.cols;
        var rich = L.density === 'rich' || L.density === 'full';
        return '<' + (live ? 'button type="button"' : 'div role="group"') + ' class="sc' + (live ? '' : ' in') + (top ? ' rt' : '') + '" data-i="' + i + '" aria-label="' + esc(ariaOf(sec)) + '">' +
          glyph(sec, gpx, tint(sec)) + '<span class="nm">' + esc(sec.name) + '</span>' + reading(sec.reading) +
          (rich && sec.detail ? '<span class="dt">' + esc(sec.detail) + '</span>' : '') +
          (L.density === 'full' && sec.extra ? '<span class="ex">' + esc(sec.extra) + '</span>' : '') +
          '</' + (live ? 'button' : 'div') + '>';
      }).join('');
      return head + '<div class="gr d-' + L.density + '" style="--c:' + L.cols + ';--r:' + L.rows + ';--g:' + L.gap + 'px">' + cells + '</div>' + foot;
    }
  }

  // ======================================================================== the sheet's body
  var SP = C.SP || {};
  var SHEET_CSS = [
    ':host{display:flex;flex-direction:column;color:' + v('ink') + '}',
    '.rt{flex:1 0 auto;display:flex;flex-direction:column;gap:12px}',
    // ROWS: one card of them, as the standard sheet's lists
    '.list{border-radius:20px;background:' + v('key') + ';padding:2px 18px;display:grid;grid-template-columns:minmax(0,1fr);column-gap:20px}',
    ':host([mode="rows2"]) .list{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.row{all:unset;box-sizing:border-box;display:grid;grid-template-columns:24px minmax(0,1fr) auto 12px;align-items:center;column-gap:12px;',
    '  min-height:72px;padding:12px 0;cursor:pointer;-webkit-tap-highlight-color:transparent;border-top:1px solid ' + v('line') + ';min-width:0;container-type:inline-size}',
    '.row.ft{border-top:0}',
    '.row.in{cursor:default;grid-template-columns:24px minmax(0,1fr) auto}',
    '.row:not(.in):active,.pn:not(.in):active{opacity:.7}',
    '.row:focus-visible,.pn:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px;border-radius:12px}',
    '.row .gl,.pn .gl{display:flex;color:' + v('ink') + '}',
    '.row .tx{display:flex;flex-direction:column;gap:3px;min-width:0}',
    // (a long name or reading takes a second line rather than pushing the other off: "Weather Alerts", "Wind Advisory")
    '.row .nm{' + type('body') + ';line-height:20px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}',
    '.row .dt{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}',
    '.row .v{' + type('title') + ';line-height:27px;white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;max-width:13em;overflow:hidden;text-overflow:ellipsis}',
    '.row .v small{' + type('caption') + ';letter-spacing:0;color:' + v('ink-2') + ';margin-left:4px}',
    '.row .v.tx{' + type('headline') + ';line-height:22px;white-space:normal;max-width:min(8.5em, 42cqw);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
    '.v.nr{color:' + v('ink-3') + '}',
    '.ch{display:flex;color:' + v('mark') + '}.ch hk-icon{width:12px;height:12px;--mdc-icon-size:12px}',
    // PANELS (the wide sheet): six fill the body, two by three; more scroll at the same size
    '.grid{flex:1 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(176px,1fr);gap:12px 20px}',
    '.pn{all:unset;box-sizing:border-box;min-width:0;display:grid;grid-template-columns:24px minmax(0,1fr) 16px;',
    '  grid-template-areas:"g n c" "v v v" "d d d" "e e e";grid-template-rows:24px 52px 20px 18px;column-gap:8px;row-gap:8px;align-content:center;',
    '  padding:' + (SP.cardPad || '16px 18px 14px') + ';border-radius:20px;background:' + v('key') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.pn.in{cursor:default}',
    '.pn .gl{grid-area:g}.pn .nm{grid-area:n;' + type('headline') + ';line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pn .ch{grid-area:c;justify-self:end}',
    '.pn .v{grid-area:v;' + type('hero') + ';line-height:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.pn .v small{' + type('headline') + ';letter-spacing:0;color:' + v('ink-2') + ';margin-left:6px}',
    '.pn .v.tx{' + type('figure') + ';line-height:52px}',
    '.pn .dt{grid-area:d;' + type('body') + ';line-height:20px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pn .ex{grid-area:e;' + type('caption') + ';line-height:18px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.note{' + type('caption') + ';line-height:18px;color:' + v('ink-3') + ';padding:0 18px 4px}',
    '.none{margin:auto;padding:40px 12px;' + type('body') + ';color:' + v('ink-2') + ';text-align:center}',
    '@media (prefers-reduced-motion:reduce){.row,.pn{transition:none}}'
  ].join('');

  class HkHouseStatusSheet extends Mixin(HkBase) {
    static get CSS() { return SHEET_CSS; }
    // the shell's width (hk-detail.js WIDTH): the wide sheet, or the standard one; filling its body
    hkWidthKind() { return (this._config || {}).wide ? 'cards_wide' : 'cards'; }
    hkFill() { return true; }
    hkNoGear() { return true; }
    // the header: the house's glyph in the ink, like any sheet's at rest, and the name
    hkHead(h, d) {
      d.well.style.background = '';
      d.icon.style.color = v('ink');
      d.icon.icon = 'mdi:home';
      d.tt.textContent = 'House Status';
      return true;
    }
    connectedCallback() {
      super.connectedCallback();
      var self = this;
      if (!this._ro && typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(function () { self._measure(); });
        this._ro.observe(/** @type {Element} */ (/** @type {unknown} */ (this)));
      }
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
    }
    // the body's width chooses the layout; drawn again only when that changes
    _measure() {
      var w = this.getBoundingClientRect ? this.getBoundingClientRect().width : 0;
      if (!(w > 0) || w === this._w) return;
      this._w = w;
      if (this._built) this.redraw();
    }
    _render() {
      var self = this;
      if (!this._built) {
        this._built = true;
        this._root.className = 'rt';
        this._root.addEventListener('click', function (e) {
          var t = /** @type {any} */ (e.target), b = t && t.closest ? t.closest('[data-i]') : null;
          if (!b) return;
          e.stopPropagation();
          var sec = (self._shown || [])[Number(b.getAttribute('data-i'))];
          if (sec) go(self, sec, true);
        });
      }
      var m = this._sections();
      if (!m) { C.morph(this._root, ''); return; }
      var w = this._w || (this.getBoundingClientRect ? this.getBoundingClientRect().width : 0) || 412;
      // (a phone's sheet is one column of rows, however wide the phone: hk-detail.js's phone sheet)
      var phone = false;
      try { phone = window.matchMedia('(max-width:' + ((C.BP && C.BP.phone) || 640) + 'px)').matches; } catch (e) { phone = false; }
      var mode = phone ? 'rows' : sheetMode(w, m.total);
      if (this.getAttribute('mode') !== mode) this.setAttribute('mode', mode);
      this._shown = m.sections;
      var html;
      if (!m.sections.length) html = '<div class="none">Nothing to report</div>';
      else if (mode === 'panels') html = '<div class="grid">' + m.sections.map(panel).join('') + '</div>';
      else {
        var cols = mode === 'rows2' ? 2 : 1;
        html = '<div class="list">' + m.sections.map(function (sec, i) { return row(sec, i, i < cols); }).join('') + '</div>';
      }
      // CUSTOM CHIPS IT CANNOT READ, named: a card that is no status chip has no reading to trust (hk-chip.js)
      if (m.unsupported && m.unsupported.length) {
        html += '<div class="note">Not shown here: ' + esc(m.unsupported.join(', ')) + ' (custom chips House Status can’t read)</div>';
      }
      C.morph(this._root, html);
      bindGlyphs(this._root, this.client);
    }
  }
  function row(sec, i, first) {
    var live = goes(sec);
    return '<' + (live ? 'button type="button"' : 'div role="group"') + ' class="row' + (live ? '' : ' in') + (first ? ' ft' : '') + '" data-i="' + i + '" aria-label="' + esc(ariaOf(sec)) + '">' +
      glyph(sec, 24, tint(sec)) + '<span class="tx"><span class="nm">' + esc(sec.name) + '</span>' +
      (sec.detail ? '<span class="dt">' + esc(sec.detail) + '</span>' : '') + '</span>' + reading(sec.reading) +
      (live ? '<span class="ch">' + CHEV + '</span>' : '') + '</' + (live ? 'button' : 'div') + '>';
  }
  function panel(sec, i) {
    var live = goes(sec);
    return '<' + (live ? 'button type="button"' : 'div role="group"') + ' class="pn' + (live ? '' : ' in') + '" data-i="' + i + '" aria-label="' + esc(ariaOf(sec)) + '">' +
      glyph(sec, 24, tint(sec)) + '<span class="nm">' + esc(sec.name) + '</span>' + (live ? '<span class="ch">' + CHEV + '</span>' : '') +
      reading(sec.reading) + (sec.detail ? '<span class="dt">' + esc(sec.detail) + '</span>' : '') +
      (sec.extra ? '<span class="ex">' + esc(sec.extra) + '</span>' : '') + '</' + (live ? 'button' : 'div') + '>';
  }

  register('hk-house-status-card', HkHouseStatusCard, 'HK House Status',
    'This screen’s status chips at a glance -- each opens its page -- and all of them in a sheet. Made for a Home Grid.');
  register('hk-house-status-sheet', HkHouseStatusSheet, 'HK House Status Sheet', 'The House Status sheet’s body.');
  // a block and a sheet, never cards to add by hand
  if (C.unlisted) { C.unlisted('hk-house-status-card'); C.unlisted('hk-house-status-sheet'); }
  window.hkHouseStatus.Card = HkHouseStatusCard;
  window.hkHouseStatus.Sheet = HkHouseStatusSheet;
  window.hkHouseStatus.open = function () {
    var M = S(), c = C.client ? C.client() : null, n = 0;
    try { n = M && c ? M.read(M.plan(board(), c), c).total : 0; } catch (e) { n = 0; }
    return openSheet(n);
  };
  window.hkHouseStatus._ = { go: go, goes: goes, reading: reading, viewport: viewport };
  });
})();
