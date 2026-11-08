// @ts-check
// hk-house-status.js -- House Status (docs/phase11/HOUSE-STATUS.md): this screen's status chips as a Home Grid block
// and a sheet, in HomeView's look rather than the chip row's pills.
//
//   hk-house-status-card    `house_status` (S, W, T, L, XL; hk-grid-catalog.js): the sections at a glance in the
//                           language On Now shares (round two, 2026-11-08) -- the one thing that matters most as a
//                           headline, the sections as lines at their size's height, each its own tap to the page its
//                           chip opens; the rest are "+N more", which opens the sheet. Small is one button.
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
  // ROUND TWO (2026-11-08, the owner: "the layouts don't follow anything else ... It would be great if On Now and Home
  // Status shared a similar look"; then, of a first try in tiles: "we don't necessarily have to use Tiles to display
  // this data ... Let's be intentional on layout here"): ONE LANGUAGE FOR HOUSE STATUS AND ON NOW, built from the
  // block he liked -- On Now's first Tall, a big count with the kinds listed under it:
  //   A HEADLINE that answers the glance: On Now's count with "On" (quiet: "All Off"), House Status's one thing that
  //     matters most in words ("1 Window Open"; "All Good" with a green check when nothing needs a look).
  //   THE CATEGORIES AS LINES, not boxes: each a row -- the glyph on a disc (lit, in its color, while something is on or
  //     asks for a look; a neutral disc at rest), the name, the reading, a short "where" -- the whole row its tap, a
  //     hairline between rows, at a fixed height per size; a kind at rest reads quieter, never hidden.
  //   Per size composed, not a grid of equal boxes: S the headline over the kinds' discs; W the headline in the left
  //   third and the lines (or the discs with their counts) beside it; T the headline over the lines; L the headline and
  //   a sentence over richer lines; XL a headline column beside the lines. NOTHING STRETCHES: rows keep their height and
  //   the group is centered where it is shorter than the block. On Now (hk-grid-widgets.js) draws with the same parts.
  var ROW = { square: { W: 44, T: 44, L: 56, XL: 56 }, tile: { W: 44, T: 44, L: 48, XL: 56 } };
  var LABEL = 30;                                      // the label's row (24) and the gap under it
  var TAP = 44;                                        // a row is never shorter than a finger
  var SENTENCE = 21;                                   // a sentence under the headline (19) and its gap
  // a square cell's block or a tile's, by its height inside the inset (a one-row block: 160 or 122; two rows: 369 or 282)
  function shapeOf(size, ih) { return (size === 'S' || size === 'W' ? ih >= 145 : ih >= 330) ? 'square' : 'tile'; }
  // THE HEADLINE'S HEIGHT: a count 72 (its own column, a square Tall) or 44; words two lines of the title (22 / 28)
  function headH(o) { return o.words ? 56 : o.big ? 76 : 48; }
  // HOW A BLOCK IS COMPOSED, iw x ih inside its inset, n lines, o {words: a headline in words}: {shape, rowH, rows,
  // shown, more, big, sentence, side (the left column's width: W and XL), cols (W's lines across)}
  function plan(size, iw, ih, n, o) {
    o = o || {};
    var shape = shapeOf(size, ih), rowH = (ROW[shape] || ROW.square)[size] || 44, big = false, side = 0, sentence = false, cols = 1, room;
    n = Math.max(0, n || 0);
    if (size === 'S') return { shape: shape, rowH: 0, rows: 0, shown: 0, more: n, big: false, sentence: false, side: 0, cols: 0 };
    if (size === 'W') {
      side = Math.round(iw / 3);
      room = ih;
      // (counts are short: two across where the lines are many and the block short)
      cols = !o.words && n > Math.floor(room / rowH) ? 2 : 1;
    } else if (size === 'XL') {
      side = 200; big = shape === 'square'; sentence = true;
      room = ih;
    } else {
      big = size === 'T' && shape === 'square' && !o.words;
      room = ih - LABEL - headH({ words: o.words, big: big }) - 8;
      // (Large's sentence where it costs no line, or every line still fits)
      var fit = function (r) { return Math.floor((r - 2) / rowH); };
      if (size === 'L' && (fit(room - SENTENCE) === fit(room) || fit(room - SENTENCE) >= n)) { sentence = true; room -= SENTENCE; }
    }
    var rows = Math.max(1, Math.floor((room - 2) / rowH)), shown = Math.min(n, rows * cols);
    return { shape: shape, rowH: rowH, rows: Math.ceil(shown / cols), shown: shown, more: n - shown, big: big, sentence: sentence, side: side, cols: cols };
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

  var LIB = { ROW: ROW, LABEL: LABEL, TAP: TAP, shapeOf: shapeOf, headH: headH, plan: plan,
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

  // ======================================================================== the summary (On Now's too)
  // THE PARTS (ROUND TWO, 2026-11-08; the pure part's plan says where and how many): every size of House Status and of
  // On Now (hk-grid-widgets.js) is composed of these -- the label's row (the label in the block's accent, one key at
  // its end), the headline, a sentence, and the lines; Small and Wide also the discs.
  var SUM_CSS = [
    '.sm{flex:1;min-height:0;display:flex;flex-direction:column;min-width:0}',
    '.sm-h{display:flex;align-items:center;justify-content:space-between;gap:8px;height:24px;margin-bottom:6px;flex:none;min-width:0}',
    '.sm-l{' + type('label') + ';line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;text-shadow:' + v('glow') + '}',
    // the label's key (All Off, "+N more"): a capsule the row's height, at least a finger wide, a finger's reach round it
    '.sm-k{all:unset;box-sizing:border-box;position:relative;flex:none;display:flex;align-items:center;justify-content:center;gap:2px;height:24px;min-width:44px;padding:0 12px;',
    '  border-radius:12px;background:' + v('key') + ';' + type('caption') + ';font-weight:600;color:' + v('ink') + ';cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}',
    // (its reach up into the inset, never over a line)
    '.sm-k::after{content:"";position:absolute;left:-6px;right:-6px;top:-14px;bottom:-6px}',
    '.sm-k:active{filter:brightness(0.9)}',
    '.sm-k.q{background:none;padding:0 0 0 8px;justify-content:flex-end;color:' + v('ink-2') + ';font-weight:500;text-shadow:' + v('glow') + '}',
    '.sm-k hk-icon{width:12px;height:12px;--mdc-icon-size:12px;color:' + v('mark') + '}',
    // (a column's foot key -- Wide's and Extra Large's All Off -- a finger tall itself)
    '.sm-k.f{height:44px;border-radius:22px;padding:0 20px;' + type('body') + ';font-weight:600}.sm-k.f::after{display:none}',
    // THE HEADLINE: a count large, or the one thing that matters in words
    '.hl{display:flex;align-items:baseline;gap:6px;min-width:0;flex:none;text-shadow:' + v('glow') + '}',
    '.hl .n{' + type('hero') + ';line-height:48px;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.hl.big .n{font-size:72px;font-weight:500;letter-spacing:-2px;line-height:76px}',
    '.hl .u{' + type('headline') + ';color:' + v('ink-2') + ';white-space:nowrap}',
    '.hl.w{display:block;' + type('title') + ';line-height:28px;max-height:56px;overflow:hidden}',
    '.hl.w hk-icon,.hl.w hk-state-icon{display:inline-flex;vertical-align:-3px;margin-right:6px}',
    '.hl.w hk-countdown{font:inherit}.hl.w .v small{font-size:inherit;margin-left:0.25em}.hl.w .v.nr{color:' + v('ink-2') + '}',
    '.snt{' + type('body') + ';line-height:19px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;margin-top:2px;text-shadow:' + v('glow') + '}',
    // THE LINES, at their height, the group centered in what the headline leaves
    '.bd{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;margin-top:8px}',
    '.ls{display:grid;grid-template-columns:repeat(var(--c,1),minmax(0,1fr));column-gap:16px;flex:none}',
    '.ln{all:unset;box-sizing:border-box;position:relative;height:var(--rh);min-width:0;display:grid;grid-template-columns:var(--dk) minmax(0,1fr) auto;',
    '  align-items:center;column-gap:10px;border-top:1px solid ' + v('line') + ';color:' + v('ink') + ';cursor:pointer;-webkit-tap-highlight-color:transparent;transition:opacity ' + C.DUR.press + ' ease}',
    '.ls.nw .ln{column-gap:8px}.ls.nw .ln.u .nm{' + type('caption') + ';font-weight:600;line-height:17px}.ln.u{grid-template-columns:var(--dk) minmax(0,1fr)}.ln.r0{border-top:0}.ln:not(.in):active{opacity:.6}.ln.in{cursor:default}',
    '.ln:focus-visible,.sm-k:focus-visible,.sm-s:focus-visible,.di:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px;border-radius:12px}',
    '.ln .dt .v{display:inline}.ln .tx{display:flex;flex-direction:column;justify-content:center;min-width:0;text-shadow:' + v('glow') + '}',
    '.ln .nm{' + type('body') + ';font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ln .dt{' + type('caption') + ';line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ln .rd{' + type('headline') + ';white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;text-shadow:' + v('glow') + '}',
    '.ln .rd small{' + type('caption') + ';color:' + v('ink-2') + ';margin-left:3px}',
    '.ln .rd hk-countdown,.ln .dt hk-countdown{font:inherit}.ln .dt .v small{font:inherit;margin-left:0.25em;color:inherit}.ln .rd .v.nr{color:' + v('ink-3') + '}',
    '.ln.at .nm,.ln.at .rd{color:' + v('ink-2') + '}',
    // (a level -- the lights' brightness -- a small bar at the start of the line under the name)
    '.lv{display:inline-block;width:34px;height:4px;border-radius:2px;background:' + v('key-strong') + ';margin-right:6px;vertical-align:2px;overflow:hidden}',
    '.lv b{display:block;height:100%;border-radius:2px}',
    // THE DISC: the glyph in white on its color while something is on or asks for a look; a neutral disc at rest
    '.dk{display:grid;place-items:center;border-radius:50%;color:#fff;flex:none}',
    '.dk.off{background:' + v('key') + ';color:' + v('ink-2') + '}',
    '.dk hk-icon,.dk hk-state-icon{display:flex;--mdc-icon-size:100%}',
    '.dr{display:flex;gap:8px;flex:none;margin-top:8px}',
    // (Wide, the discs with their counts: each a column -- the disc, the count, the name -- the whole of it a tap)
    // (the discs a centered group 8 px apart, never spread across the row: nothing stretches, and their hit areas clear, 2026-11-08)
    '.dw{display:flex;justify-content:center;gap:8px;align-items:center;flex:1;min-width:0}',
    '.di{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:52px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.di:active{opacity:.6}.di b{' + type('headline') + ';line-height:20px;font-variant-numeric:tabular-nums;text-shadow:' + v('glow') + '}',
    '.di span{' + type('caption') + ';line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;text-shadow:' + v('glow') + '}',
    '.di.at b{color:' + v('ink-2') + '}',
    // WIDE AND EXTRA LARGE: a column of its own for the headline beside the lines
    '.sx{flex:1;min-height:0;display:flex;gap:var(--sg,16px);min-width:0}',
    '.sx>.sc{flex:none;width:var(--sw);display:flex;flex-direction:column;min-width:0}',
    '.sx>.sc .snt{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}',
    '.sx>.sc .ft{margin-top:auto;display:flex}',
    // (Extra Large's column: the headline, its sentence and its key one group, centered on the lines' own center -- the
    // label's row above it given back under it, so the two columns share their middle)
    '.sx>.sc .grp{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;margin-bottom:30px}',
    '.sx>.sc .grp .ft{margin-top:14px}.sx>.sc .grp .dr{margin-top:12px}',
    '.sx>.bd{flex:1;min-width:0;margin-top:0}',
    // SMALL: one button -- the label, the headline at the foot, the discs under it
    '.sm-s{all:unset;box-sizing:border-box;flex:1;min-height:0;display:flex;flex-direction:column;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.sm-s:active{opacity:.75}.sm-s .hl{margin-top:auto}.sm-s .sld{margin-top:auto;margin-bottom:4px;display:flex}.sm-s .sld+.hl{margin-top:0}.sm-s .snt{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
    '@media (prefers-reduced-motion:reduce){.ln{transition:none}}'
  ].join('');
  // a glyph on its disc: px the disc, color its color when lit (null: at rest); icon(px, color) draws the glyph
  function disc(icon, px, color) {
    return '<span class="dk' + (color ? '' : ' off') + '" style="width:' + px + 'px;height:' + px + 'px' + (color ? ';background:' + color : '') + '" aria-hidden="true">' +
      icon(Math.round(px * 0.58), color ? '#fff' : null) + '</span>';
  }
  // THE HEADLINE: {num, unit} -- a count large -- or {words (html)}; big: 72 px
  function headline(h, big) {
    if (h.words != null) return '<div class="hl w">' + h.words + '</div>';
    return '<div class="hl' + (big ? ' big' : '') + '"><span class="n">' + esc(String(h.num)) + '</span>' + (h.unit ? '<span class="u">' + esc(h.unit) + '</span>' : '') + '</div>';
  }
  // A LINE: r = {live, attrs, aria, icon(px, color), lit (its color while lit), name, reading (html), detail, level, rest}
  // under: the reading under the name (a narrow line with words to say)
  function line(r, P, i, under, dk) {
    var tag = r.live ? 'button type="button"' : 'div role="group"';
    var lv = r.level != null ? '<i class="lv"><b style="width:' + Math.max(4, Math.min(100, r.level)) + '%;background:' + (r.lit || v('ink-2')) + '"></b></i>' : '';
    var under2 = under ? r.reading + (r.detail ? ' · ' + esc(r.detail) : '') : lv + esc(r.detail || '');
    return '<' + tag + ' class="ln' + (under ? ' u' : '') + (r.live ? '' : ' in') + (r.rest ? ' at' : '') + (i < P.cols ? ' r0' : '') + '"' + (r.attrs ? ' ' + r.attrs : '') +
      ' aria-label="' + esc(r.aria || r.name) + '">' + disc(r.icon, dk, r.lit) + '<span class="tx"><span class="nm">' + esc(r.name) + '</span>' +
      (under2 ? '<span class="dt">' + under2 + '</span>' : '') + '</span>' + (under ? '' : '<span class="rd">' + r.reading + '</span>') +
      '</' + (r.live ? 'button' : 'div') + '>';
  }
  function lines(m, P, width) {
    // (a narrow column -- Tall's, 160 -- a smaller disc and gap, so "Doors & Windows" keeps its whole name)
    var nw = width / P.cols < 200, dk = nw ? 24 : P.rowH >= 56 ? 34 : P.rowH >= 48 ? 30 : 28, under = !!m.words && width / P.cols < 300;
    return '<div class="ls' + (nw ? ' nw' : '') + '" style="--c:' + P.cols + ';--rh:' + P.rowH + 'px;--dk:' + dk + 'px">' +
      m.rows.slice(0, P.shown).map(function (r, i) { return line(r, P, i, under, dk); }).join('') + '</div>';
  }
  // THE BLOCK, composed for its size. m = {label, color, key (the label row's key, html), side (Wide's key, under its
  // headline), head ({num, unit} | {words}), sentence, rows, words (the lines' readings are words), discs (Wide: the
  // discs with their counts instead of lines), small ({attrs, aria})}; box its inside; P its plan
  // (2026-11-08: Large was drawn both ways -- the headline over the lines, and beside them in a column of its own as
  // Extra Large has it; beside them squeezed the label and cut the lines' detail, so Large keeps the headline on top)
  function compose(m, size, box, P) {
    var lab = '<div class="sm-l" style="color:' + m.color + '">' + esc(m.label) + '</div>';
    var row = function (key) { return '<div class="sm-h">' + lab + (key || '') + '</div>'; };
    var snt = m.sentence ? '<div class="snt">' + m.sentence + '</div>' : '';
    if (size === 'S') {
      var ds = m.discs ? '<div class="dr">' + m.rows.map(function (r) { return disc(r.icon, 26, r.lit); }).join('') + '</div>' : '';
      // (a Small with no discs -- House Status's -- the leading thing's glyph on its disc over the headline, as a tile has)
      var ld = !m.discs && m.lead ? '<div class="sld">' + disc(m.lead.icon, 30, m.lead.lit) + '</div>' : '';
      return '<button type="button" class="sm-s"' + (m.small.attrs ? ' ' + m.small.attrs : '') + ' aria-label="' + esc(m.small.aria) + '">' + lab + ld +
        headline(m.head, false) + (m.discs ? '' : snt) + ds + '</button>';
    }
    if (size === 'W') {
      var right = m.discs ? '<div class="dw">' + m.rows.map(function (r) {
        return '<button type="button" class="di' + (r.rest ? ' at' : '') + '" ' + r.attrs + ' aria-label="' + esc(r.aria || r.name) + '">' + disc(r.icon, 36, r.lit) +
          '<b>' + (r.count != null ? esc(String(r.count)) : '') + '</b><span>' + esc(r.name) + '</span></button>';
      }).join('') + '</div>' : '<div class="bd">' + lines(m, P, box.iw - P.side - 16) + '</div>';
      return '<div class="sx" style="--sw:' + P.side + 'px">' + '<div class="sc">' + lab + '<div style="margin-top:6px">' + headline(m.head, false) + '</div>' +
        '<div class="ft">' + (m.side || '') + '</div></div>' + right + '</div>';
    }
    if (size === 'XL') {
      var rest = m.restDiscs ? '<div class="dr">' + m.rows.map(function (r) { return disc(r.icon, 26, r.lit); }).join('') + '</div>' : '';
      return '<div class="sx" style="--sw:' + P.side + 'px;--sg:22px"><div class="sc">' + row(m.key) + '<div class="grp">' + headline(m.head, P.big) + snt + rest +
        (m.side ? '<div class="ft">' + m.side + '</div>' : '') + '</div></div>' +
        '<div class="bd">' + lines(m, P, box.iw - P.side - 22) + '</div></div>';
    }
    return '<div class="sm">' + row(m.key) + headline(m.head, P.big) + (P.sentence ? snt : '') + '<div class="bd">' + lines(m, P, box.iw) + '</div></div>';
  }
  window.hkHouseStatus.tiles = { CSS: SUM_CSS, plan: plan, compose: compose, disc: disc };

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
      var size = this._size(), m = this._sections(), lab = '<div class="sm-l" style="color:' + accent() + '">House Status</div>';
      if (!m) { C.morph(this._plate, lab); return; }
      var box = inner(this, size), P = plan(size, box.iw, box.ih, m.total, { words: true });
      var shown = m.sections.slice(0, size === 'S' ? 0 : P.shown);
      this._shown = shown;
      if (!m.sections.length && size !== 'S') { C.morph(this._plate, lab + '<div class="none">Nothing to report</div>'); return; }
      // the headline: the one thing that matters most, in words ("1 Window Open"), else All Good with a green check
      var sec = lead(m.sections), need = !!(sec && (sec.urgent || sec.attention));
      var others = m.sections.filter(function (x) { return x !== sec && (x.urgent || x.attention); }).length;
      var green = (C.ACCENTS && C.ACCENTS.green) || '#30d158';
      // (Small has the green check on its own disc above the words)
      var head = need ? { words: reading(sec.reading) + (OPEN_WORD[sec.kind] ? ' ' + OPEN_WORD[sec.kind] : '') }
        : { words: (size === 'S' ? '' : '<hk-icon icon="mdi:check-circle" style="width:24px;height:24px;--mdc-icon-size:24px;color:' + green + '"></hk-icon>') + 'All Good' };
      var sentence = need ? esc(sec.name) + (others ? ' · ' + others + ' more to check' : '') : 'Nothing needs a look';
      // (a Tall block's label row has room for the label and "+2" only)
      var more = P.more > 0 ? '<button type="button" class="sm-k q" data-all aria-label="' + esc('All ' + count(m.total) + ': opens House Status') + '">+' + P.more +
        (box.iw < 200 ? '' : ' more') + CHEV + '</button>' : '';
      var model = { label: 'House Status', color: accent(), head: head, sentence: sentence, words: true, key: more, side: size === 'W' ? more : '',
        lead: need ? { icon: function (px, col) { return glyph(sec, px, col); }, lit: litOf(sec) || (C.ACCENTS && C.ACCENTS.orange) }
                   : { icon: function (px, col) { return '<hk-icon icon="mdi:check" style="width:' + px + 'px;height:' + px + 'px;color:' + col + '"></hk-icon>'; }, lit: green },
        small: { attrs: 'data-all', aria: 'House Status: ' + (need ? words(sec.reading) + ', ' + sec.name : 'all good') + (others ? ', ' + others + ' more to check' : '') + '. Opens House Status' },
        rows: shown.map(function (x, i) {
          var say = words(x.reading), dt = x.detail && x.detail.toLowerCase() !== say.toLowerCase() ? x.detail : null;
          return { live: goes(x), attrs: 'data-i="' + i + '"', aria: ariaOf(x), icon: function (px, col) { return glyph(x, px, col); }, lit: litOf(x),
                   name: x.name, reading: reading(x.reading), detail: dt };
        }) };
      C.morph(this._plate, compose(model, size, box, P));
      bindGlyphs(this._plate, this.client);
    }
  }
  // what a headline adds to a reading in words: a door's "1 Window" is "1 Window Open", a timer's "8:38" "8:38 Left"
  var OPEN_WORD = { doors_windows: 'Open', timers: 'Left' };
  // A SECTION'S DISC lit: in its chip's color while it asks for a look, or while something is on, playing or open
  function litOf(sec) {
    var r = sec.reading || {}, on = r.num != null && Number(r.num) > 0 && /^(on|playing|open|running|leak|leaks)$/i.test(String(r.unit || ''));
    if (!(sec.urgent || sec.attention || on)) return null;
    var c = sec.color && C.flatColor ? C.flatColor(sec.color, 'on') : sec.color;
    return c || (C.ACCENTS && C.ACCENTS.orange) || '#ff9f0a';
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
