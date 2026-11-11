// hk-layout-home-grid.js - the Home Grid view.
//
// PART OF THE LAYOUT CARDS (hk-layout.js). Not a card and not run on its own: it registers one
// function, which hk-layout.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkLayoutParts = window.hkLayoutParts || {})['hk-layout-home-grid'] = function (K) {
    var C = K.C, cellInset = K.cellInset, cellRadius = K.cellRadius, cellShape = K.cellShape, GRID = K.GRID,
        gridNight = K.gridNight, gridNightNow = K.gridNightNow, SAFE_PAD_L = K.SAFE_PAD_L, SAFE_PAD_R = K.SAFE_PAD_R;

    class HkHomeGridView extends HTMLElement {
      setConfig(config) {
        this._config = config || {};
        if (!this._sr) this._sr = this.attachShadow({ mode: 'open' });
        this._build();
        this._place();
      }
      set lovelace(l) { this._lovelace = l; }
      get lovelace() { return this._lovelace; }
      set narrow(n) { this._narrow = n; }
      set index(i) { this._index = i; }
      set cards(c) { this._cards = c || []; this._place(); }
      get cards() { return this._cards || []; }
      set badges(b) { this._badges = b || []; this._place(); }
      get badges() { return this._badges || []; }

      _build() {
        if (this._root) return;
        var st = document.createElement('style');
        // the side gutter: the page's edge to its plates, as every page has it
        // (hk-grid-view's gutter: --hk-side of the width and 8 px; 27 px at
        // 1,280 -- six 196 px columns and 10 px gaps); the same at the top and
        // the foot. (A card's own :host margin -- a pull-up made for a page's
        // flow -- wins over the view's, so a card drops it with :host([size]).)
        //
        // THE TAB BAR'S ROOM comes out of the height (docs/phase11/HOME-GRID.md,
        // "The tab bar"): the bar pads the view on its side and says how much
        // as --hk-bar-room on it (top or bottom; hk-tabbar.js publish()), and
        // --hk-tabbar-h on <html> at the bottom. The canvas fits the remaining
        // room uniformly; rows keep their logical height when the dock changes.
        // EDIT MODE'S BAR comes out of it too (--hk-edit-room, hk-edit.js
        // makeRoom): the grid fits under the bar, never runs under the foot.
        //
        // Do not put clip-path on a cell: it creates a backdrop root, so a
        // shared blur inside a swipe track cannot sample the wallpaper.
        // Cards and swipe tracks clip their own content; the grid clips its
        // outer boundary. Shadows can extend between the cells.
        st.textContent =
          ':host{--g-room:calc(var(--hk-bar-room,var(--hk-tabbar-h,0px)) + var(--hk-pane-b,0px) + var(--hk-edit-room,0px));display:block;position:relative;' +
          'height:calc(100dvh - var(--g-room));max-height:calc(100dvh - var(--g-room));overflow:hidden;' +
          // (clear of a side safe area, as every view: hk-grid-view; _measure fits the grid between)
          'container-type:size;box-sizing:border-box;padding-left:' + SAFE_PAD_L + ';padding-right:' + SAFE_PAD_R + '}' +
          '#root{--g-pad:' + GRID.pad + 'px;--g-gap:' + GRID.gap + 'px;' +
          'box-sizing:border-box;display:grid;position:absolute;transform-origin:top left;padding:var(--g-pad);gap:var(--g-gap);' +
          'grid-template-columns:repeat(var(--g-cols), ' + C.TILE.w + 'px);overflow:hidden}' +
          // (the band clips what runs past the grid, but not the clock's glow or the chips' shadows: 20 px of room
          // inside the clip, given back by the margin, so it takes the same place -- the owner, 2026-10-31: a hard
          // line under the date and round the Security chip)
          '.band{grid-column:1 / -1;grid-row:1;min-width:0;min-height:0;overflow:hidden;padding:20px;margin:-20px}' +
          '.cell{position:relative;min-width:0;min-height:0;overflow:visible;' +
          'container-type:size;container-name:hk-cell;' +
          // THE BLOCK'S INSET (hkCards.blockPad): 14 px on tiles, 18 on square cells (a 34 px corner's curve comes 10 px
          // in), and a Square screen's outer corner on top (cellInset's --hk-in-*)
          '--hk-block-pad:14px;--hk-pad-t:calc(var(--hk-block-pad) + var(--hk-in-t,0px));--hk-pad-r:calc(var(--hk-block-pad) + var(--hk-in-r,0px));' +
          '--hk-pad-b:calc(var(--hk-block-pad) + var(--hk-in-b,0px));--hk-pad-l:calc(var(--hk-block-pad) + var(--hk-in-l,0px));--hk-shape-pad:var(--hk-block-pad);' +
            '--hk-text-in:calc(var(--hk-block-pad) - var(--hk-shape-pad));--hk-spad-t:calc(var(--hk-shape-pad) + var(--hk-in-t,0px));--hk-spad-r:calc(var(--hk-shape-pad) + var(--hk-in-r,0px));' +
            '--hk-spad-b:calc(var(--hk-shape-pad) + var(--hk-in-b,0px));--hk-spad-l:calc(var(--hk-shape-pad) + var(--hk-in-l,0px))}' +
          // ...and its cells say they are square (2026-10-31, the owner: the glyphs small on a 1280 x 800 tablet): a block
          // asked "a square cell?" by its height (180 px or more), and beside the Side Pane a square cell is ~154 px. The
          // blocks ask `(min-height:180px) or style(--hk-cell-shape: square)`: where style() is unknown, as it was
          ':host([cell=square]) .cell{--hk-block-pad:18px;--hk-shape-pad:13px;--hk-cell-shape:square}' +   // (shapes on the inset at the grid's gap, 13 -- text keeps 18: 2026-11-08)
          // ...and on square cells what sits inside a block's plate on its inset is concentric with it (34 - 18); tiles keep
          // their pills' own corners (at 23.5 - 14 they would be near square)
          ':host([cell=square]) .cell{--hk-inner-radius:max(12px, calc(var(--hk-block-radius, 34px) - var(--hk-shape-pad)))}' +
          '.cell>*,.band>*{display:block;box-sizing:border-box;width:100%;max-height:100%;margin:0!important}' +
          '.cell>*{height:100%}' +
          // HIDE BOX (2026-10-24): the block's boxes (card and panel plates, hkCards.plate) clear, no edge, no shadow and
          // no frost behind them -- its tiles keep theirs; the clock reads --hk-bare
          '.cell[data-bare]{--hk-bare:1;--hk-block-plate:transparent;--hk-block-edge:transparent;--hk-block-shadow:none;--hk-block-glass:0;--hk-block-backdrop:none}' +
          // a card that only listens (a pop-up, the docked bar) takes no room
          '.aside{position:absolute;left:0;top:0;width:0;height:0;overflow:visible}' +
          // VIEWS (2026-10-24, StandBy's): a screen's views share the grid, each
          // a canvas's width aside from the one showing (--cur) -- the root
          // clips them -- and slide in as one, following a finger (--drag)
          '.cell[data-view]{transform:translateX(calc((var(--v) - var(--cur, 0)) * var(--g-w) + var(--drag, 0px)));' +
          'transition:transform var(--view-ms, .45s) var(--view-ease, cubic-bezier(.32,.72,0,1))}' +
          '#root.dragging .cell[data-view]{transition:none}' +
          // (and not drawn while they rest out of sight: Safari lets a scaled grid's scrollers and
          // videos past its clip, so a camera or a room's pages showed through in the next view)
          '#root:not(.dragging):not(.sliding) .cell[data-view][inert]{visibility:hidden}' +
          ':host([views]){touch-action:pan-y}' +
          // ...and their dots, under the grid: a tap goes to that view
          // (centred on the grid, between the side paddings)
          '.vdots{position:absolute;left:calc(50% + (' + SAFE_PAD_L + ' - ' + SAFE_PAD_R + ') / 2);transform:translateX(-50%);display:none;gap:2px;z-index:2}' +
          ':host([views]) .vdots{display:flex}' +
          '.vdots button{all:unset;box-sizing:border-box;width:18px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer}' +
          '.vdots button::after{content:"";width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.35);transition:background .2s}' +
          '.vdots button[aria-current="true"]::after{background:rgba(255,255,255,.95)}' +
          '.vdots button:focus-visible{outline:2px solid rgba(255,255,255,.7);border-radius:50%}' + (window.hkGridCatalog ? window.hkGridCatalog.sheetCss(C.v) : '');
        this._sr.appendChild(st);
        var root = document.createElement('div');
        root.id = 'root';
        this._sr.appendChild(root);
        this._root = root;
        var dots = document.createElement('div');
        dots.className = 'vdots';
        dots.setAttribute('role', 'tablist');
        dots.setAttribute('aria-label', 'Views');
        this._sr.appendChild(dots);
        this._dots = dots;
        this._swipeViews();
      }
      // THE VIEWS' SWIPE: a finger (or a pointer) moving sideways anywhere on
      // the grid takes the views with it, unless it began on something that
      // moves sideways itself -- a block that swipes its own pages, a slider, a
      // dial; past a fifth of the width, or quickly, it lands on the next. The
      // first and the last view give a little, and come back -- unless Swipe
      // Between Pages is on here: a swipe past the last view (or back past the
      // first) is handed to the page swipe (hk-pageswipe.js), as the event
      // hk-swipe-past with the travel so far, and goes on to the next page.
      // What moves sideways itself is one list, hkDrag.sideways (hk-drag.js).
      _swipeViews() {
        var self = this, g = null;
        ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click'].forEach(function (t) {
          self.addEventListener(t, function (e) {
            var D = window.hkDrag;     // (without it, nothing here is known to be the grid's)
            if (!g && D && D.viewSwipe) g = D.viewSwipe(self);
            if (g) g[t](e);
          }, t === 'click');
        });
      }
      // both views drawn while one slides out and the other in, for that long; the curve it used goes with it
      _slideFor(ms) {
        var root = this._root, self = this;
        root.classList.add('sliding');
        clearTimeout(this._sliding);
        this._sliding = setTimeout(function () {
          self._sliding = 0;
          root.classList.remove('sliding');
          root.style.removeProperty('--view-ms');
          root.style.removeProperty('--view-ease');
        }, ms + 60);
      }
      _views() { return this._config ? this._grid().views : 1; }
      // ARRIVING BY A PAGE SWIPE (hk-pageswipe.js): forward, its first view;
      // back from the next page, its last -- so the swipe reads as one strip
      swipeEnter(dir) {
        var n = this._views();
        if (n < 2) return;
        var root = this._root;
        // (no slide: it is already where it lands)
        if (root) root.classList.add('dragging');
        this._showView(dir < 0 ? n - 1 : 0);
        if (root) { void root.offsetWidth; root.classList.remove('dragging'); }
      }
      // the view to show (the swipe, a dot, the editor's View)
      _showView(i) {
        var n = this._views();
        i = Math.max(0, Math.min(n - 1, i | 0));
        // (both views drawn while one slides out and the other in)
        if (this._root && this._view !== undefined && this._view !== i) {
          var root = this._root;
          this._slideFor(this._slideMs || 450);
        }
        this._view = i;
        if (this._root) this._root.style.setProperty('--cur', String(i));
        var self = this;
        if (this._dots) {
          if (this._dots.childNodes.length !== n) {
            this._dots.textContent = '';
            for (var k = 0; k < n; k++) {
              var b = document.createElement('button');
              b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', 'View ' + (k + 1));
              (function (k) { b.addEventListener('click', function (e) { e.stopPropagation(); self._showView(k); }); })(k);
              this._dots.appendChild(b);
            }
          }
          Array.prototype.forEach.call(this._dots.childNodes, function (b, k) { b.setAttribute('aria-current', String(k === i)); });
        }
        // (what is in another view is out of reach: no focus, nothing read out)
        Array.prototype.forEach.call(this._root ? this._root.childNodes : [], function (c) {
          if (!c.hasAttribute || !c.hasAttribute('data-view')) return;
          var off = +c.getAttribute('data-view') !== i;
          if (off) c.setAttribute('inert', ''); else c.removeAttribute('inert');
          if (off) c.setAttribute('aria-hidden', 'true'); else c.removeAttribute('aria-hidden');
        });
      }

      // the grid's numbers, checked (what hk_core checks; a view written by
      // hand gets the defaults)
      _grid() {
        var g = (this._config && this._config.grid) || {};
        var cols = [6, 5, 4, 3, 2].indexOf(g.cols) >= 0 ? g.cols : 6;
        var rows = (g.rows >= 2 && g.rows <= 6 && g.rows === Math.floor(g.rows)) ? g.rows : 4;
        return { cols: cols, rows: rows, band: g.band !== false, scale: Number.isInteger(g.scale) && g.scale >= 50 && g.scale <= 100 ? g.scale : 100,
                 grow: g.grow === true, night: g.night && (g.night.mode === 'night' || g.night.mode === 'always') ? g.night : null,
                 views: g.views >= 2 && g.views <= 4 && g.views === Math.floor(g.views) ? g.views : 1,
                 cell: g.cell === 'square' ? 'square' : 'tile', screen: g.screen === 'square' ? 'square' : null };
      }

      _place() {
        if (!this._root || !this._config) return;
        var g = this._grid(), root = this._root, top = g.band ? 1 : 0, shape = cellShape(g);
        root.style.setProperty('--g-cols', String(g.cols));
        root.style.setProperty('--g-rows', String(g.rows));
        root.style.gridTemplateRows = (top ? GRID.band + 'px ' : '') + 'repeat(' + g.rows + ', ' + shape.h + 'px)';
        // (square cells: their gap and edge; tiles keep the stylesheet's)
        if (g.cell === 'square') { root.style.setProperty('--g-gap', shape.gap + 'px'); root.style.setProperty('--g-pad', shape.pad + 'px'); }
        else { root.style.removeProperty('--g-gap'); root.style.removeProperty('--g-pad'); }
        if (g.cell === 'square') this.setAttribute('cell', 'square'); else this.removeAttribute('cell');
        var cfgs = this._config.cards || [], els = this._cards || [];
        this._slots = this._slots || [];
        // RECONCILE, NEVER EMPTY-AND-REFILL (hk-grid-view's reason): a slot per
        // config card, kept; only a card that changed is moved into it.
        var want = [];
        cfgs.forEach(function (cfg, i) {
          var el = els[i];
          var slot = this._slots[i] || (this._slots[i] = document.createElement('div'));
          var cell = cfg && cfg.hk_cell, sz = cell && GRID.sizes[cell.size];
          // FULL (F, 2026-10-30): the view's whole grid -- its columns and rows
          var full = !!sz && (!sz[0] || !sz[1]);
          if (full) sz = [g.cols, g.rows];
          if (cfg && cfg.hk_band && top) {
            slot.className = 'band';
            slot.removeAttribute('size');
            slot.style.cssText = '';
          } else if (sz && Array.isArray(cell.at)) {
            var c = cell.at[0], r = cell.at[1];
            // (a block past the edge -- only a hand-written view can have one --
            // is left out, never allowed to grow the page)
            if (!(c >= 0 && r >= 0 && c + sz[0] <= g.cols && r + sz[1] <= g.rows)) { want.push(null); return; }
            slot.className = 'cell';
            slot.setAttribute('size', cell.size);
            if (cell.id) slot.setAttribute('data-id', cell.id); else slot.removeAttribute('data-id');
            if (cell.bare) slot.setAttribute('data-bare', ''); else slot.removeAttribute('data-bare');
            slot.style.cssText = '';
            // (its view, when the screen has more than one)
            var vw = g.views > 1 ? Math.max(0, Math.min(g.views - 1, cell.view | 0)) : -1;
            if (vw >= 0) { slot.setAttribute('data-view', String(vw)); slot.style.setProperty('--v', String(vw)); } else slot.removeAttribute('data-view');
            slot.style.gridColumn = (c + 1) + ' / span ' + sz[0];
            // (Tiny: its cell's top or bottom half, a gap between two)
            slot.style.gridRow = (r + 1 + top) + ' / span ' + sz[1]; if (cell.size === 'XS') { slot.style.alignSelf = cell.at && cell.at[2] ? 'end' : 'start'; slot.style.height = 'calc((100% - ' +
              cellShape(g).gap + 'px) / 2)'; }
            // (a Full block's card reads its span here: hkCards HkBase._block)
            if (full) { slot.style.setProperty('--hk-span-c', String(sz[0])); slot.style.setProperty('--hk-span-r', String(sz[1])); }
            // (square cells: the block's corners, read by its plate -- hkCards.plate)
            var rad = cellRadius(g, cell.at, sz);
            if (rad) slot.style.setProperty('--hk-block-radius', rad);
            var ins = cellInset(g, cell.at, sz);
            if (ins) ['t', 'r', 'b', 'l'].forEach(function (k) { if (ins[k]) slot.style.setProperty('--hk-in-' + k, ins[k] + 'px'); });
            if (el && el.setAttribute) el.setAttribute('size', cell.size);
            // TILE STYLE (2026-10-30): Centred on the block's card, which its tiles
            // read (hk-tile.js, hk-grid-cards.js KEY_CSS); Home is no attribute
            if (el && el.setAttribute) { if (cell.tile === 'centred') el.setAttribute('tile', 'centred'); else el.removeAttribute('tile'); }
          } else if (cfg && cfg.hk_band) {
            want.push(null); return;                // the band, turned off
          } else {
            slot.className = 'aside';
            slot.removeAttribute('size');
            slot.style.cssText = '';
          }
          if (el && slot.firstChild !== el) {
            while (slot.firstChild) slot.removeChild(slot.firstChild);
            slot.appendChild(el);
          } else if (!el) {
            while (slot.firstChild) slot.removeChild(slot.firstChild);
          }
          want.push(slot); if (slot.className === 'cell' && window.hkGridCatalog) window.hkGridCatalog.sheetSlot(slot, (cell && cell.sheet) || null, this);   // (its custom sheet)
        }, this);
        want = want.filter(Boolean);
        want.forEach(function (slot, i) {
          var at = root.childNodes[i] || null;
          if (at !== slot) root.insertBefore(slot, at);
        });
        while (root.childNodes.length > want.length) root.removeChild(root.lastChild);
        if (g.views > 1) this.setAttribute('views', String(g.views)); else this.removeAttribute('views');
        this._showView(this._view || 0);
        this._measure();
        this._announce();
      }

      // ONE CELL'S SIZE, in px, as --hk-cell-w / --hk-cell-h on the grid (every
      // card inherits them). Measured, not a calc() of container units: a
      // custom property inherits as written, and inside a cell -- a container
      // itself -- 100cqw would be the cell's width, not the screen's.
      _measure() {
        var root = this._root, g = this._grid();
        if (!root || !this.isConnected || !root.getBoundingClientRect) return;
        // Logical geometry never depends on viewport shape. Fit the whole canvas
        // uniformly inside the room left by the dock; optionally make it smaller.
        var shape = cellShape(g), pad = shape.pad, gap = shape.gap;
        var w = g.cols * C.TILE.w + (g.cols - 1) * gap + 2 * pad;
        var h = g.rows * shape.h + (g.rows - 1) * gap + 2 * pad + (g.band ? GRID.band + gap : 0);
        // (Fill the Screen, `grow`: past its own size too -- a phone on its side, whose grid is smaller than it)
        // (the width between the view's side paddings -- a side safe area, hk-grid-view's -- and the grid
        // centred in it: the absolute root is placed from the padding box)
        var cs = getComputedStyle(this), pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
        var cw = Math.max(0, this.clientWidth - pl - pr);
        var scale = Math.min(g.grow ? Infinity : 1, cw / w, this.clientHeight / h) * g.scale / 100;
        if (!(scale > 0)) return;
        this._gridScale = scale;
        root.style.width = w + 'px'; root.style.height = h + 'px';
        root.style.left = pl + Math.max(0, (cw - w * scale) / 2) + 'px';
        root.style.top = Math.max(0, (this.clientHeight - h * scale) / 2) + 'px';
        root.style.transform = 'scale(' + scale + ')';
        root.style.setProperty('--g-w', w + 'px');
        // the views' dots in the middle of the grid's foot margin
        if (this._dots && g.views > 1) this._dots.style.top = Math.round(parseFloat(root.style.top) + (h - pad / 2) * scale - 9) + 'px';
        root.style.setProperty('--hk-cell-w', C.TILE.w + 'px');
        root.style.setProperty('--hk-cell-h', shape.h + 'px');
      }

      // BESIDE THE SIDE PANE (2026-10-30, hk-sidepane.js): the width the grid
      // takes when it fills a height `H` (the screen's, less the tab bar's
      // room) -- its own canvas scaled as _measure scales it, and its side
      // paddings -- so the pane can take what it leaves (444 px beside a 3 x 3
      // on a 1180 x 820 tablet). The pane then narrows the page (hk-menu.js),
      // and the grid lays itself in what is left, on either side, as ever.
      paneRoom(H) {
        // (the canvas _measure last laid out, whatever its cells' shape)
        var g = this._grid(), rs = this._root && this._root.style;
        var w = rs ? parseFloat(rs.width) : 0, h = rs ? parseFloat(rs.height) : 0;
        if (!(w > 0 && h > 0 && H > 0)) return 0;
        var scale = Math.min(g.grow ? Infinity : 1, H / h) * g.scale / 100;
        var cs = typeof getComputedStyle === 'function' ? getComputedStyle(this) : null;
        var side = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
        return Math.round(w * scale + side);
      }

      // EDIT MODE ON THE DASHBOARD (2026-10-31, hk-edit-grid.js): the blocks
      // laid out afresh -- a config's cards and their elements together, matched
      // by index as ever, the elements kept that are kept -- and the cells'
      // box on the screen, for where a carried block lands
      arrange(config, els) {
        this._config = config || {};
        this._cards = els || [];
        this._place();
      }
      // { left, top, width, height } of the cells (not the band, not the edge)
      // in the window's px, their gap there, the scale and the grid's numbers
      cellBox() {
        var root = this._root, g = this._grid(), k = this._gridScale || 1;
        if (!root || !root.getBoundingClientRect) return null;
        var shape = cellShape(g), r = root.getBoundingClientRect(), top = g.band ? GRID.band + shape.gap : 0;
        return { left: r.left + shape.pad * k, top: r.top + (shape.pad + top) * k,
                 width: (g.cols * C.TILE.w + (g.cols - 1) * shape.gap) * k, height: (g.rows * shape.h + (g.rows - 1) * shape.gap) * k,
                 gap: shape.gap * k, scale: k, cols: g.cols, rows: g.rows, views: g.views, view: this._view || 0 };
      }

      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (!this._ro && typeof ResizeObserver !== 'undefined') {
          var me = this;
          this._ro = new ResizeObserver(function () { me._measure(); });
        }
        if (this._ro) this._ro.observe(this);
        this._measure();
        this._announce();
        this._nightCheck();
        var self = this;
        if (!this._nightT) this._nightT = setInterval(function () { self._nightCheck(); }, 30000);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._ro) this._ro.disconnect();
        this._announced = false;
        if (this._nightT) { clearInterval(this._nightT); this._nightT = null; }
        gridNight(false);
      }
      // NIGHT MODE (2026-10-24, StandBy's and the screensaver's clock's): while
      // the screen's night lasts -- between From and Until, across midnight,
      // or Always -- the whole screen one dim red (gridNight). Checked every
      // 30 s; Home only: another page, or this view gone, lets it go.
      _nightCheck() {
        var n = this._config && this._grid().night;
        gridNight(!!n && this.isConnected && !this.hasAttribute('data-hk-offstage') && gridNightNow(n, new Date()));
      }
      _stageChanged() { this._nightCheck(); }
      // hk-view-ready, as hk-grid-view says it (the sky repaints with the page)
      _announce() {
        if (this._announced || !this.isConnected || !this._config || this.hasAttribute('data-hk-offstage')) return;
        if ((this._config.cards || []).length && !(this._cards || []).length) return;
        this._announced = true;
        try {
          window.dispatchEvent(new CustomEvent('hk-view-ready', { detail: { view: this } }));
        } catch (e) {
          console.error('[hk-home-grid-view] hk-view-ready listener threw', e);
        }
      }
    }

    // what the shell and the later parts use of this one
    K.HkHomeGridView = HkHomeGridView;
  };
})();
