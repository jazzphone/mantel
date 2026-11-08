// @ts-check
// hk-house-status.js -- House Status (docs/phase11/HOUSE-STATUS.md): this screen's status chips as a Home Grid block
// and a sheet, in HomeView's look rather than the chip row's pills.
//
//   hk-house-status-card    `house_status` (S, W, T, L, XL; hk-grid-catalog.js): the sections at a glance, as the
//                           summary tiles On Now shares (round two, 2026-11-08) -- each tile at its size's designed
//                           size, as many as fit, each its own tap to the page its chip opens; the rest are "+N more",
//                           which opens the sheet. Small is one button: the section that matters most, and the sheet.
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
  // ROUND TWO (2026-11-08, the owner: "the layouts don't follow anything else ... It would be great if On Now and
  // Home Status shared a similar look"): ONE LOOK FOR BOTH, THE SUMMARY TILES. A heading on the top inset (the label,
  // and at its end one key: "+N more" here, All Off in On Now), under it the categories as the Room block's inner
  // tiles -- Apple Home's category row, a glyph, a name and a state -- filling the block with no holes. The tile's
  // designed size (DESIGN) chooses what it says: one line, a stack (glyph over the reading over the name), a pill (the glyph
  // beside the name over the reading, as Apple Home's row) or a card (the glyph, then the reading large, the name and
  // a line or two of detail). On Now (hk-grid-widgets.js) draws with the same functions and CSS (the `tiles` below).
  var HEAD = 32;                                       // the heading's row (24) and the gap under it (8)
  var GAP = 8;                                         // between tiles (the Room block's)
  var TAP = 44;                                        // a tile is never shorter than a finger
  // NOTHING STRETCHES (2026-11-08, the owner: "entities in a card should maintain dimensions"): a tile has its designed
  // size at each block size -- its kind, its columns (its width: the block's width shared by them) and its height,
  // chosen here per size, cell shape and block, never grown to fill. A bigger block shows more tiles, or tiles made to
  // say more; what fits is shown, the group centered with a short last row centered, and the rest are "+N more".
  //   [kind, columns, height] -- square cells (196 x 196) and tiles (196 x 150); `count` On Now's (a count each, four
  //   kinds at most), `words` House Status's (readings in words, as many sections as the house has)
  var DESIGN = {
    square: { count: { W: ['pill', 2, 58], T: ['pill', 1, 76], L: ['card', 2, 162], XL: ['card', 2, 162] },
              words: { W: ['pill', 2, 58], T: ['pill', 1, 60], L: ['pill', 2, 76], XL: ['stack', 4, 162] } },
    tile: { count: { W: ['stack', 4, 88], T: ['pill', 1, 56], L: ['card', 2, 120], XL: ['card', 2, 120] },
            words: { W: ['stack', 3, 88], T: ['pill', 1, 56], L: ['pill', 2, 56], XL: ['stack', 4, 120] } }
  };
  // a square cell's block or a tile's, by its height inside the inset (a one-row block: 160 or 122; two rows: 369 or 282)
  function shapeOf(size, ih) { return (size === 'S' || size === 'W' ? ih >= 145 : ih >= 330) ? 'square' : 'tile'; }
  // HOW n TILES LAY OUT in a block of iw x ih px inside its inset: {cols, rows, shown, more, tw, th, kind, gap, head}
  function layout(size, iw, ih, n, block) {
    var shape = shapeOf(size, ih), d = (DESIGN[shape][block === 'count' ? 'count' : 'words'] || {})[size] || ['pill', 1, 60];
    // (less the plate's 1 px edge each side: the inset is measured from the block's outside)
    var body = ih - 2 - HEAD, cols = d[1], th = d[2];
    var tw = Math.floor((iw - 2 - (cols - 1) * GAP) / cols);
    var rows = Math.max(1, Math.floor((body + GAP) / (th + GAP)));
    var shown = Math.min(Math.max(0, n || 0), cols * rows);
    return { cols: cols, rows: Math.ceil(shown / cols) || 0, shown: shown, more: Math.max(0, (n || 0) - shown), tw: tw, th: th,
             kind: d[0], gap: GAP, head: HEAD, shape: shape };
  }
  // which of a tile's lines its height has room for: [the detail, the extra line]
  function lines(kind, th) {
    if (kind === 'stack') return [th >= 106, th >= 124];
    if (kind === 'pill') return [th >= 74, false];
    if (kind === 'card') return [th >= 102, th >= 119];
    return [false, false];
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

  var LIB = { HEAD: HEAD, GAP: GAP, TAP: TAP, DESIGN: DESIGN, shapeOf: shapeOf, layout: layout, lines: lines,
              wantWide: wantWide, sheetMode: sheetMode, lead: lead, words: words, fmtSecs: fmtSecs, secsOf: secsOf, count: count };
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

  // ======================================================================== the summary tiles (On Now's too)
  // THE LOOK (ROUND TWO, 2026-11-08; the pure part's DESIGN and layout say where and what): every size of House Status
  // and of On Now (hk-grid-widgets.js) is drawn with these. The heading: the label in the block's accent with the glass
  // glow, one key at its end. A tile: the inner radius, the key's wash, its glyph in its color while it has something
  // going on (in the ink at rest), and the whole of it one tap. Small: the label over the one thing that matters, its
  // reading large and a line under it.
  var SUM_CSS = [
    '.sm-h{display:flex;align-items:center;justify-content:space-between;gap:8px;height:24px;margin-bottom:8px;flex:none;min-width:0}',
    '.sm-l{' + type('label') + ';line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;text-shadow:' + v('glow') + '}',
    // the heading's key: a capsule the heading's height, at least a finger wide, with a finger's reach round it
    '.sm-k{all:unset;box-sizing:border-box;position:relative;flex:none;display:flex;align-items:center;justify-content:center;gap:2px;height:24px;min-width:44px;padding:0 12px;',
    '  border-radius:12px;background:' + v('key') + ';' + type('caption') + ';font-weight:600;color:' + v('ink') + ';cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}',
    // (its reach up into the inset, never over the tiles under it)
    '.sm-k::after{content:"";position:absolute;left:-6px;right:-6px;top:-14px;bottom:-6px}',
    '.sm-k:active{filter:brightness(0.9)}',
    '.sm-k.q{background:none;padding:0 0 0 8px;justify-content:flex-end;color:' + v('ink-2') + ';font-weight:500;text-shadow:' + v('glow') + '}',
    '.sm-k hk-icon{width:12px;height:12px;--mdc-icon-size:12px;color:' + v('mark') + '}',
    // the tiles at their size, the group centered in what the heading leaves, a short last row centered
    '.sm-g{flex:1;min-height:0;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:' + GAP + 'px}',
    // A TILE: one tap, its parts placed by its kind
    '.sm-t{all:unset;box-sizing:border-box;position:relative;flex:none;width:var(--tw);height:var(--th);overflow:hidden;display:grid;padding:10px 12px;',
    '  border-radius:var(--hk-inner-radius,12px);background:' + v('key') + ';color:' + v('ink') + ';cursor:pointer;-webkit-tap-highlight-color:transparent;',
    '  transition:transform ' + C.DUR.press + ' ease}',
    '.sm-t:not(.in):active{transform:scale(0.97)}.sm-t.in{cursor:default}',
    '.sm-t:focus-visible,.sm-k:focus-visible,.sm-s:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
    '.sm-t .g{grid-area:g;display:flex;align-self:center;color:' + v('ink') + '}',
    '.sm-t .nm{grid-area:n;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sm-t .v{grid-area:v;display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.sm-t .v small{margin-left:4px;font-size:0.6em;font-weight:600;letter-spacing:0;color:' + v('ink-2') + '}',
    '.sm-t .v.nr,.sm-t.at .v{color:' + v('ink-2') + '}.sm-t.at .g{color:' + v('ink-3') + '}',
    '.sm-t .v hk-countdown{font:inherit}',
    '.sm-t .dt,.sm-t .ex{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.sm-t .dt{grid-area:d}.sm-t .ex{grid-area:e}',
    // one line: the glyph, the name, the reading at the end
    '.k-line{grid-template-columns:22px minmax(0,1fr) auto;grid-template-areas:"g n v";column-gap:10px;align-items:center;padding:0 14px}',
    '.k-line .nm{' + type('body') + ';font-weight:600}.k-line .v{' + type('headline') + ';max-width:9em}.k-line .v small{font-size:13px}',
    // a stack: the glyph at the top, the reading and the name at the foot
    '.k-stack{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto auto auto auto;grid-template-areas:"g" "." "v" "n" "d" "e";padding:11px 12px 10px}',
    '.k-stack .g{align-self:start}.k-stack .v{' + type('title') + ';line-height:26px}.k-stack .v.tx{' + type('headline') + ';line-height:22px}',
    '.k-stack .v small{font-size:13px}.k-stack .nm{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + '}',
    // a pill (Apple Home's category): the glyph beside the name over the reading
    '.k-pill{grid-template-columns:24px minmax(0,1fr);grid-template-areas:"g n" "g v" "g d" "g e";column-gap:12px;align-content:center;padding:0 14px}',
    '.k-pill .nm{' + type('headline') + ';line-height:21px}.k-pill .v{' + type('body') + ';line-height:19px;color:' + v('ink-2') + '}.k-pill .v small{font-size:inherit;font-weight:inherit;margin-left:0.25em}',
    // a card: the glyph and the name on its top line, then at its foot the reading large and the lines of detail
    '.k-card{grid-template-columns:26px minmax(0,1fr);grid-template-rows:26px minmax(0,1fr) auto auto auto;grid-template-areas:"g n" ". ." "v v" "d d" "e e";column-gap:9px;padding:13px 14px 12px}',
    '.k-card .v{' + type('figure') + ';line-height:34px}.k-card .v.tx{' + type('title') + ';line-height:30px}',
    '.k-card .v small{' + type('headline') + ';letter-spacing:0}.k-card .nm{' + type('headline') + ';line-height:26px}',
    '.sm-t.nd .dt,.sm-t.ne .ex{display:none}',
    // SMALL: one button -- the label, then the glyph, the reading large and a line at the foot
    '.sm-s{all:unset;box-sizing:border-box;flex:1;min-height:0;display:flex;flex-direction:column;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.sm-s:active{opacity:.75}',
    '.sm-s .g{display:flex;margin-top:auto;margin-bottom:4px;color:' + v('ink') + '}',
    '.sm-s .v{display:block;' + type('figure-l') + ';line-height:42px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.sm-s .v.tx{' + type('title') + ';line-height:28px}.sm-s .v small{' + type('headline') + ';letter-spacing:0;margin-left:4px;color:' + v('ink-2') + '}',
    '.sm-s .v.nr{color:' + v('ink-2') + '}.sm-s .v hk-countdown{font:inherit}',
    '.sm-s .ln{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin-top:1px}',
    '@media (prefers-reduced-motion:reduce){.sm-t{transition:none}}'
  ].join('');
  // the heading: the label in its color, `right` its one key (or nothing)
  function sumHead(label, color, right) {
    return '<div class="sm-h"><div class="sm-l" style="color:' + color + '">' + esc(label) + '</div>' + (right || '') + '</div>';
  }
  // A TILE: t = {live (a button), attrs, aria, glyph (html), name, value (html, a .v span), detail, extra, rest (at rest)}
  function sumTile(t, F, i) {
    var ln = lines(F.kind, F.th), tag = t.live ? 'button type="button"' : 'div role="group"';
    return '<' + tag + ' class="sm-t k-' + F.kind + (t.live ? '' : ' in') + (t.rest ? ' at' : '') + (ln[0] && t.detail ? '' : ' nd') + (ln[1] && t.extra ? '' : ' ne') +
'"' + (t.attrs ? ' ' + t.attrs : '') + ' aria-label="' + esc(t.aria || t.name) + '">' +
      '<span class="g">' + t.glyph + '</span><span class="nm">' + esc(t.name) + '</span>' + t.value +
      (ln[0] && t.detail ? '<span class="dt">' + esc(t.detail) + '</span>' : '') + (ln[1] && t.extra ? '<span class="ex">' + esc(t.extra) + '</span>' : '') +
      '</' + (t.live ? 'button' : 'div') + '>';
  }
  function sumGrid(F, tiles) {
    return '<div class="sm-g" style="--tw:' + F.tw + 'px;--th:' + F.th + 'px">' + tiles.slice(0, F.shown).map(function (t, i) { return sumTile(t, F, i); }).join('') + '</div>';
  }
  // SMALL: s = {label, color, attrs, aria, glyph, value (html), line}
  function sumSmall(s) {
    return '<button type="button" class="sm-s"' + (s.attrs ? ' ' + s.attrs : '') + ' aria-label="' + esc(s.aria) + '">' +
      '<div class="sm-l" style="color:' + s.color + '">' + esc(s.label) + '</div>' + (s.glyph ? '<span class="g">' + s.glyph + '</span>' : '') +
      s.value + (s.line ? '<span class="ln">' + s.line + '</span>' : '') + '</button>';
  }
  window.hkHouseStatus.tiles = { CSS: SUM_CSS, head: sumHead, tile: sumTile, grid: sumGrid, small: sumSmall, layout: layout };

  // ======================================================================== the Home Grid block
  var BLOCK_CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.hs{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;',
    '  padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent}',
    '.none{margin:auto;' + type('body') + ';color:' + v('ink-2') + ';text-align:center;text-shadow:' + v('glow') + '}'
  ].join('') + SUM_CSS;
  var CHEV = '<hk-icon icon="mdi:chevron-right" aria-hidden="true"></hk-icon>';
  // the block's accent: the Security page's teal -- the house's state, as its chips are
  function accent() { return (C.ACCENTS && C.ACCENTS.teal) || v('ink-2'); }

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
      if (!m) { C.morph(this._plate, sumHead('House Status', accent(), '')); return; }
      var box = inner(this, size), html;
      if (size === 'S') html = this._small(m);
      else html = this._grid(m, size, box);
      C.morph(this._plate, html);
      bindGlyphs(this._plate, this.client);
    }
    _small(m) {
      var sec = lead(m.sections);
      this._shown = [];
      var aria = 'House Status' + (sec ? ': ' + ariaOf(sec) : ': nothing to report') + '. ' + count(m.total) + '. Opens House Status';
      if (!sec) return sumSmall({ label: 'House Status', color: accent(), attrs: 'data-all', aria: aria, glyph: glyph({ icon: 'mdi:home' }, 26, null),
                                   value: '<span class="v tx">All Clear</span>', line: 'Nothing to report' });
      return sumSmall({ label: 'House Status', color: accent(), attrs: 'data-all', aria: aria, glyph: glyph(sec, 26, tint(sec)), value: reading(sec.reading),
                        line: esc(sec.name) + (m.total > 1 ? ' · ' + esc(count(m.total)) : '') });
    }
    _grid(m, size, box) {
      var L = layout(size, box.iw, box.ih, m.total, 'words'), shown = m.sections.slice(0, L.shown);
      this._shown = shown;
      // (a Tall block's heading has room for the label and "+2" only)
      var more = L.more > 0 ? '<button type="button" class="sm-k q" data-all aria-label="' + esc('All ' + count(m.total) + ': opens House Status') + '">+' + L.more + (box.iw < 200 ? '' : ' more') + CHEV + '</button>' : '';
      var head = sumHead('House Status', accent(), more);
      if (!shown.length) return head + '<div class="none">Nothing to report</div>';
      var gpx = L.kind === 'card' ? 26 : L.kind === 'line' ? 20 : 24;
      return head + sumGrid(L, shown.map(function (sec, i) {
        return { live: goes(sec), attrs: 'data-i="' + i + '"', aria: ariaOf(sec), glyph: glyph(sec, gpx, tint(sec)), name: sec.name,
                 value: reading(sec.reading), detail: sec.detail, extra: sec.extra };
      }));
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
