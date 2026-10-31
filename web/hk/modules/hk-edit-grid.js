// hk-edit-grid.js - EDIT MODE ON A HOME GRID (2026-10-31, the owner: "the
// same live edit mode on the HomeView/HomeGrid style dashboard like we have
// on the generated dashboards ... drag things around or even change sizes /
// remove icons ... right from the dashboard itself"). A Home Grid screen's
// Home (hk-layout.js hk-home-grid-view) is an hkEdit.surface like any page
// (the contract is at the top of hk-edit.js): Edit Page in the menu, Edit
// This Page in the tab bar's More and in an accessory's sheet, the same bar,
// Cancel and Done. In Edit mode each block wiggles and
//   drags         a finger that moves (or is held), or the mouse, carries it;
//                 it snaps to the cells, its outline shows where it would go,
//                 and the blocks it lands on make room as they do in the Home
//                 Grid editor (hkGridEditor.makeRoom: the space it left, else
//                 the nearest free place); where there is none the outline is
//                 red and the drop puts it back. The arrow keys move it a
//                 cell, the same way.
//   its size      the badge at its foot: the sizes its card comes in
//                 (hk-grid-catalog.js; hk_core home_grid.py CATALOG is the
//                 mirror) that this grid holds -- where it is if it fits
//                 there, else the nearest place it fits with nothing moved;
//                 a size with no room anywhere is offered greyed, saying so
//   removed       the minus at its top left (or Delete on the keyboard)
//   added         Add in the bar: the catalog's cards, each at its sizes,
//                 put in the first space that fits in the view shown; a
//                 size with no free space is placed by hand -- held over the
//                 grid, it replaces the blocks it covers (hkGridEditor.addOver:
//                 the others make room first when they can), those washed red
//                 and named in the bar's line while it is held
// THE LAYOUT IS THE SCREEN'S `home_grid`, and only that: the draft is the
// layout the screen was drawn from, changed only by the editor's own pure
// functions (place, makeRoom, firstSpace, valid -- hk-grid-editor.js,
// loaded when a Home Grid is first offered Edit), and Done sends it as the
// Home Grid editor's Save does -- board/set {home_grid} with the screen's
// version (panel/get's versions["board/<path>"]), checked by hk_core
// (settings/home_grid.py check). Nothing else about the screen changes here;
// a block's options, the grid's columns and rows, its views: the Home Grid
// editor (Settings).
// THE PREVIEW is the page itself: the blocks drawn again from the draft by
// the strategy's own homeGridView, each block's element kept while its card
// is the same (a move changes only its cell), and made afresh when its card
// changes (a size, a new block). Cancel puts the view's own config and
// elements back; Done leaves it as arranged until the strategy builds the
// screen again from what was saved. Square cells, a Square screen, the Side
// Pane beside the grid and a screen's views (the dots go to another view;
// blocks move within the view shown) keep working as they draw.
//
// Loaded by hk-loader.js after hk-edit.js (in parallel: it registers once
// window.hkEdit is there); assigns window.hkEditGrid.
(function (global) {
  'use strict';
  if (global.hkEditGrid) return;

  var DOMAIN = 'hk_frontend';
  var VIEW_TYPE = 'custom:hk-home-grid-view';
  var EDITOR_URL = '/hk/panels/hk-grid-editor.js';
  var KIT_URL = '/hk/panels/hk-settings-kit.js';
  var HOLD_MS = 250;            // a finger held this long picks a block up (Edit mode's, hk-edit.js)
  var SETTLE = 260;             // ms: a block gliding to its place
  var HINT = 'Drag the blocks into place, change their sizes, remove them or add more.';
  // the cards Add offers: every catalog card but the two that are nothing
  // until a thing is chosen for them (Arrange Home Grid in Settings does that)
  var NEEDS_A_CHOICE = ['accessory', 'scene'];

  function E() { return global.hkEdit || null; }
  function X() { return global.hkGridEditor || null; }
  function G() { return global.hkGridCatalog || null; }
  function cards() { return global.hkCards || null; }
  function win() { return global.window || global; }
  function doc() { return global.document; }
  function v(name, fb) { var C = cards(); return C && C.v ? C.v(name) : fb; }
  function raf(fn) { var r = global.requestAnimationFrame; return r ? r(fn) : setTimeout(fn, 16); }
  function ease() { var C = cards(); return (C && C.EASE && C.EASE.standard) || 'cubic-bezier(.32,.72,0,1)'; }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function J(x) { return JSON.stringify(x === undefined ? null : x); }
  function motionOn() {
    try {
      var S = global.hkSettings;
      if (S && S.rendering && S.rendering().motion === false) return false;
      var mm = win().matchMedia;
      if (mm && mm('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* no media queries */ }
    return true;
  }
  function setting(path, fb) {
    var HS = global.hkSettings;
    try { return HS && HS.get ? HS.get(path, fb) : fb; } catch (e) { return fb; }
  }
  // the screen's own settings, as the strategy reads them (hkCards.menu.board
  // holds only the menu's)
  function board(dash) {
    var b = (setting('boards', null) || {})[dash];
    return b && typeof b === 'object' ? b : {};
  }
  // ...its Tile Style, as the strategy reads it for its Home Grid
  function tilesOf(b) { return ['auto', 'home', 'centred'].indexOf(b.tile_style) >= 0 ? b.tile_style : setting('look.tile_style'); }

  // ------------------------------------------------------------ loading
  function load(url) {
    // (hkV: a build's ?v= on the address, as the loader's own imports)
    return import(global.hkV ? global.hkV(url) : url);
  }
  var editorP = null;
  // the Home Grid editor's placement rules (it defines its element too, which
  // stays unused here)
  function editor() {
    if (X()) return Promise.resolve(X());
    if (!editorP) {
      editorP = load(EDITOR_URL).then(function () { return X(); }, function (err) {
        editorP = null;
        if (global.console) console.error('[hk-edit-grid] Edit mode on a Home Grid needs hk-grid-editor.js', err);
        return null;
      });
    }
    return editorP;
  }
  function kit() {
    if (global.hkSettingsKit) return Promise.resolve(global.hkSettingsKit);
    return load(KIT_URL).then(function () { return global.hkSettingsKit; });
  }

  // ------------------------------------------------------------ the layout (pure)
  function find(grid, id) { for (var i = 0; i < grid.items.length; i++) if (grid.items[i].id === id) return grid.items[i]; return null; }
  // A NEW SIZE for a block: where it is if it fits there, else the nearest
  // place in its view where it fits with nothing else moved; null: nowhere
  // (a resize never makes room: the editor's rule)
  function resized(Xe, grid, id, size) {
    var it = find(grid, id);
    if (!it) return null;
    if (it.size === size) return grid;
    if (Xe.cannotResize(it, size)) return null;
    var here = Xe.place(grid, id, it.at, size);
    if (here) return here;
    var best = null, bd = Infinity;
    for (var r = 0; r < grid.rows; r++) {
      for (var c = 0; c < grid.cols; c++) {
        var d = Math.hypot(c - it.at[0], r - it.at[1]);
        if (d >= bd) continue;
        var out = Xe.place(grid, id, [c, r], size);
        if (out) { best = out; bd = d; }
      }
    }
    return best;
  }
  // the sizes a block's card comes in that the grid holds, each with whether
  // it can take it now (and why not, in words)
  function sizesOf(Xe, grid, id) {
    var it = find(grid, id), cat = it && G() && G().table()[it.card];
    if (!cat) return [];
    return cat.sizes.filter(function (s) {
      var z = G().span(s, grid.cols, grid.rows);
      return z && z[0] <= grid.cols && z[1] <= grid.rows;
    }).map(function (s) {
      var why = Xe.cannotResize(it, s), ok = !why && !!resized(Xe, grid, id, s);
      return { size: s, on: s === it.size, ok: s === it.size || ok, why: s === it.size ? '' : why || (ok ? '' : 'No room') };
    });
  }
  function removed(grid, id) {
    var out = copy(grid);
    out.items = out.items.filter(function (it) { return it.id !== id; });
    return out;
  }
  // a new block of `card` at `size`, in the first space that fits in `view`
  // (the editor's variant: an accessory group's pages automatic, a room's
  // accessories scrolling); null: no room, or the layout is full
  function added(Xe, grid, card, size, view) {
    if (grid.items.length >= 24) return null;
    var at = Xe.firstSpace(grid, size, view || 0);
    if (!at) return null;
    var out = copy(grid), n = 1;
    while (out.items.some(function (it) { return it.id === 'b' + n; })) n++;
    var item = { id: 'b' + n, card: card, size: size, at: at };
    if (view) item.view = view;
    if (card === 'accessories') item.pages = { source: 'accessories' };
    if (card === 'room') item.opts = { accessory_display: 'scroll' };
    out.items.push(item);
    return Xe.valid(out) ? out : null;
  }
  // WHAT DONE SENDS: the whole layout, as the Home Grid editor's Save does
  // (with this screen's version: hk-edit.js adds expect_version); [] when it
  // is as it was
  function savesOf(initial, grid, dash) {
    if (!grid || J(grid) === J(initial)) return [];
    return [{ doc: 'board/' + dash, label: 'Home Grid',
              msg: { type: DOMAIN + '/board/set', dashboard: dash, changes: { home_grid: copy(grid) } } }];
  }
  // THE VIEW'S CARDS FOR A LAYOUT: its band first, then a card per block as
  // the strategy makes them (hkStrategy.homeGridView, with the house as the
  // view was handed it), then the cards that only listen -- matched to their
  // elements by index, as the view matches them
  function cardsFor(cfg, grid, tiles) {
    var S = global.hkStrategy, all = (cfg && cfg.cards) || [];
    var blocks = S.homeGridView(grid, {}, null, [], (cfg && cfg.grid_ctx) || {}, tiles).cards;
    return all.filter(function (c) { return c && c.hk_band; }).concat(blocks,
      all.filter(function (c) { return !(c && (c.hk_band || c.hk_cell)); }));
  }
  // a block's card without its cell: what says whether its element is kept
  function keyOf(c) {
    var o = Object.assign({}, c);
    delete o.hk_cell;
    return J(o);
  }

  // ------------------------------------------------------------ the look
  // in the view's shadow root while editing
  function viewCss() {
    var R = 'var(--hk-block-radius, ' + v('glass-radius', '23.5px') + ')', K = 'var(--hk-ge-k, 1)';
    return '#root.hk-ge-on{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
      // THE WIGGLE turns (`rotate`), the carry and the glide move (`translate`,
      // `scale`): never `transform`, which a screen's views slide by
      '#root.hk-ge-on>.cell[data-id]{animation:hk-ge-wiggle .3s ease-in-out infinite alternate;' +
      'animation-delay:calc(var(--hk-ge-i,0) * -.07s);touch-action:none}' +
      '#root.hk-ge-on>.cell.hk-ge-carried{animation:none;z-index:6;scale:1.04;filter:drop-shadow(0 14px 22px rgba(0,0,0,.3))}' +
      '@keyframes hk-ge-wiggle{from{rotate:-.4deg}to{rotate:.4deg}}' +
      '#root.hk-ge-on.hk-still>.cell[data-id]{animation:none}' +
      '@media (prefers-reduced-motion:reduce){#root.hk-ge-on>.cell[data-id]{animation:none}}' +
      // the block's cover: every press is Edit mode's, none reaches the card
      '#root.hk-ge-on>.cell>.hk-ge{position:absolute;inset:0;width:auto;height:auto;margin:0!important;z-index:4;display:block;' +
      'border-radius:' + R + ';cursor:grab;outline:none;-webkit-tap-highlight-color:transparent}' +
      '#root.hk-ge-on>.cell.hk-ge-carried>.hk-ge{cursor:grabbing}' +
      '#root.hk-ge-on>.cell>.hk-ge:focus-visible{box-shadow:0 0 0 calc(3px * ' + K + ') ' + v('accent', '#ff9f0a') + '}' +
      // Reduce Motion: still, and framed
      '#root.hk-ge-on.hk-still>.cell>.hk-ge{box-shadow:inset 0 0 0 calc(2px * ' + K + ') ' + v('mark', 'rgba(255,255,255,0.32)') + '}' +
      // the badges, the same size on the screen whatever the grid's scale
      '.hk-ge button{position:absolute;box-sizing:border-box;margin:0;border:0;padding:0;cursor:pointer;display:flex;align-items:center;' +
      'justify-content:center;background:' + v('overlay-solid', 'rgba(24,24,28,0.93)') + ';color:' + v('ink', 'rgba(255,255,255,0.94)') + ';' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25);-webkit-tap-highlight-color:transparent;font:600 calc(12px * ' + K + ')/1 ' + v('font-body', 'sans-serif') + '}' +
      '.hk-ge button:focus-visible{outline:calc(2px * ' + K + ') solid ' + v('accent', '#ff9f0a') + ';outline-offset:calc(2px * ' + K + ')}' +
      '.hk-ge .x{left:calc(-9px * ' + K + ');top:calc(-9px * ' + K + ');width:calc(28px * ' + K + ');height:calc(28px * ' + K + ');border-radius:50%}' +
      '.hk-ge .x svg{width:calc(14px * ' + K + ');height:calc(14px * ' + K + ')}' +
      // (the size at the block's foot, in the middle: never against the minus of the block beside it)
      '.hk-ge .sz{left:50%;bottom:calc(-11px * ' + K + ');transform:translateX(-50%);height:calc(28px * ' + K + ');padding:0 calc(8px * ' + K + ') 0 calc(11px * ' + K + ');' +
      'border-radius:calc(14px * ' + K + ');gap:calc(3px * ' + K + ');white-space:nowrap;letter-spacing:.1px}' +
      '.hk-ge .sz i{display:flex}.hk-ge .sz svg{width:calc(12px * ' + K + ');height:calc(12px * ' + K + ')}' +
      '#root.hk-ge-carrying .hk-ge button{opacity:0;transition:opacity .15s}' +
      // where the carried block would go; red: nowhere
      '#root>.hk-ge-target{pointer-events:none;z-index:5;box-sizing:border-box;border-radius:' + R + ';' +
      'border:calc(3px * ' + K + ') dashed ' + v('accent', '#ff9f0a') + ';background:rgba(255,255,255,.08)}' +
      '#root>.hk-ge-target.bad,#root>.hk-ge-target.replace{border-color:' + v('fail', '#ff453a') + ';background:rgba(255,69,58,.10)}' +
      // the blocks a placed card would replace: dimmed, framed red
      '#root.hk-ge-on>.cell.hk-ge-going{animation:none;opacity:.45}' +
      '#root.hk-ge-on>.cell.hk-ge-going>.hk-ge{box-shadow:inset 0 0 0 calc(3px * ' + K + ') ' + v('fail', '#ff453a') + ';background:rgba(255,69,58,.28)}';
  }
  var MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';

  // ------------------------------------------------------------ the session
  // one at a time: the part Edit mode is in on a Home Grid, or null
  var P = null;
  function name(it) { var Xe = X(); return (Xe && Xe.NAMES[it.card]) || it.card; }
  function sizeName(s) { var Xe = X(); return (Xe && Xe.SIZE_NAMES[s]) || s; }
  function say(text) { var EE = E(); if (EE && EE.say) EE.say(text); }

  function Part(ctx) {
    this.ctx = ctx;
    this.view = ctx.viewEl;
    this.cfg0 = this.view._config;
    this.els0 = (this.view._cards || []).slice();
    var b = board(ctx.dash);
    this.dash = ctx.dash;
    this.tiles = tilesOf(b);
    this.initial = copy(b.home_grid);
    this.grid = copy(b.home_grid);
    this.made = {};                     // block id -> { card key -> its element }
    this.ready = false;
    this.css = null;
    this.carry = null;
    this.placing = null;
    this.press = null;
    this.sheet = null;
    this.note = '';
    var self = this;
    this.buttons = [{ label: 'Add', run: function () { self.openAdd(); } }];
    // the elements the view was drawn with, by block
    (this.cfg0.cards || []).forEach(function (c, i) {
      if (c && c.hk_cell && c.hk_cell.id) (self.made[c.hk_cell.id] = {})[keyOf(c)] = self.els0[i];
    });
  }
  // does the view show this layout? (each block of it, by id: else the
  // page is not what the settings say, and Edit mode leaves it be)
  Part.prototype.matches = function () {
    var ids = (this.cfg0.cards || []).filter(function (c) { return c && c.hk_cell; }).map(function (c) { return c.hk_cell.id; });
    var mine = ((this.grid && this.grid.items) || []).map(function (it) { return it.id; });
    return !!this.grid && ids.length === mine.length && mine.every(function (id) { return ids.indexOf(id) >= 0; });
  };
  Part.prototype.begin = function () {
    if (P !== this || this.ready) return;
    this.ready = true;
    var self = this, sr = this.view._sr || this.view.shadowRoot, root = this.view._root, d = doc();
    this.css = d.createElement('style');
    this.css.textContent = viewCss();
    if (sr) sr.appendChild(this.css);
    root.classList.add('hk-ge-on');
    root.classList.toggle('hk-still', !motionOn());
    this.on = {
      pointerdown: function (e) { self.down(e); },
      click: function (e) { self.click(e); },
      contextmenu: function (e) { if (self.hit(e).cell) { e.stopPropagation(); e.preventDefault(); } },
      keydown: function (e) { self.key(e); },
      // a block carried: nothing under the finger scrolls
      touchmove: function (e) { if (self.carry || self.placing) e.preventDefault(); },
      resize: function () { self.scale(); }
    };
    ['pointerdown', 'click', 'contextmenu', 'keydown'].forEach(function (t) { root.addEventListener(t, self.on[t], true); });
    root.addEventListener('touchmove', this.on.touchmove, { passive: false });
    win().addEventListener('resize', this.on.resize);
    this.decorate();
    // (the bar's room shrinks the grid a frame later: the badges follow its scale)
    raf(function () { self.scale(); });
    setTimeout(function () { self.scale(); }, 400);
  };
  // THE BADGES' SIZE against the grid's scale (hk-layout.js _gridScale): 28 px
  // on the screen, less on cells drawn small (a tablet's grid on a phone),
  // never under 20 -- a third of a cell's height between
  Part.prototype.scale = function () {
    var root = this.view._root, k = this.view._gridScale || 1, b = this.view.cellBox && this.view.cellBox();
    var cell = b && b.rows ? (b.height - (b.rows - 1) * b.gap) / b.rows : 150 * k;
    var px = Math.max(20, Math.min(28, cell / 3));
    if (root && root.style) root.style.setProperty('--hk-ge-k', String(Math.round(1000 * px / 28 / k) / 1000));
  };
  Part.prototype.cells = function () {
    var root = this.view._root;
    return [].filter.call((root && root.children) || [], function (c) { return c.classList && c.classList.contains('cell') && c.getAttribute('data-id'); });
  };
  Part.prototype.cellOf = function (id) { return this.cells().filter(function (c) { return c.getAttribute('data-id') === id; })[0] || null; };
  // EACH BLOCK'S COVER: its name, its minus and its size
  Part.prototype.decorate = function () {
    var self = this, d = doc();
    this.scale();
    this.cells().forEach(function (cell, i) {
      var id = cell.getAttribute('data-id'), it = find(self.grid, id);
      [].slice.call(cell.children).forEach(function (k) { if (k.classList && k.classList.contains('hk-ge')) cell.removeChild(k); });
      if (!it) return;
      cell.style.setProperty('--hk-ge-i', String(i % 5));
      var cover = d.createElement('div');
      cover.className = 'hk-ge';
      cover.setAttribute('tabindex', '0');
      cover.setAttribute('role', 'group');
      cover.setAttribute('data-ge', id);
      cover.setAttribute('aria-label', name(it) + ', ' + sizeName(it.size) + '. Drag, or use the arrow keys, to move it.');
      var x = d.createElement('button');
      x.className = 'x'; x.type = 'button';
      x.setAttribute('data-ge-act', 'remove');
      x.setAttribute('aria-label', 'Remove ' + name(it));
      x.innerHTML = MINUS;
      cover.appendChild(x);
      var sizes = X() ? sizesOf(X(), self.grid, id) : [];
      if (sizes.length > 1) {
        var sz = d.createElement('button');
        sz.className = 'sz'; sz.type = 'button';
        sz.setAttribute('data-ge-act', 'size');
        sz.setAttribute('aria-haspopup', 'dialog');
        sz.setAttribute('aria-label', 'Size: ' + sizeName(it.size) + '. Change the size.');
        var t = d.createElement('span');
        t.textContent = (X() && X().SIZE_SHORT[it.size]) || it.size;
        var ch = d.createElement('i');
        ch.innerHTML = CHEVRON;
        sz.appendChild(t); sz.appendChild(ch);
        cover.appendChild(sz);
      }
      cell.appendChild(cover);
    });
  };
  Part.prototype.undecorate = function () {
    this.cells().forEach(function (cell) {
      [].slice.call(cell.children).forEach(function (k) { if (k.classList && k.classList.contains('hk-ge')) cell.removeChild(k); });
      cell.style.removeProperty('--hk-ge-i');
      cell.style.removeProperty('translate');
      cell.style.removeProperty('transition');
      cell.classList.remove('hk-ge-carried');
    });
  };

  // THE PAGE DRAWN FROM A LAYOUT: the view's config and its elements, a
  // block's element kept while its card is the same; every block glides from
  // where it was (`first`: its box now, unless given) to where it is now
  // (not with Reduce Motion)
  Part.prototype.paint = function (grid, first) {
    var self = this, view = this.view, C = cards();
    var cfgs = cardsFor(this.cfg0, grid, this.tiles), els = [], all = this.cfg0.cards || [];
    var band = all.filter(function (c) { return c && c.hk_band; }).length;
    var rest = this.els0.filter(function (el, i) { var c = all[i]; return !(c && (c.hk_band || c.hk_cell)); });
    cfgs.forEach(function (c, i) {
      if (c && c.hk_cell) {
        var have = self.made[c.hk_cell.id] || (self.made[c.hk_cell.id] = {}), k = keyOf(c);
        if (!have[k]) have[k] = C.createCard(c, self.ctx.h);
        els.push(have[k]);
      } else if (c && c.hk_band) els.push(self.els0[all.indexOf(c)]);
      else els.push(rest[i - band - grid.items.length]);
    });
    first = first || this.boxes();
    view.arrange(Object.assign({}, this.cfg0, { cards: cfgs }), els);
    this.decorate();
    this.glide(first);
  };
  // where each block's cell is now, by id (in the window's px)
  Part.prototype.boxes = function () {
    var out = {};
    this.cells().forEach(function (c) { var r = c.getBoundingClientRect(); out[c.getAttribute('data-id')] = { left: r.left, top: r.top }; });
    return out;
  };
  Part.prototype.glide = function (first, skip) {
    if (!motionOn()) { this.cells().forEach(function (c) { c.style.removeProperty('translate'); }); return; }
    var k = this.view._gridScale || 1, moving = [];
    this.cells().forEach(function (c) {
      if (c === skip) return;
      var f = first[c.getAttribute('data-id')];
      c.style.transition = 'none';
      c.style.removeProperty('translate');
      if (!f) return;
      var r = c.getBoundingClientRect(), dx = (f.left - r.left) / k, dy = (f.top - r.top) / k;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      c.style.setProperty('translate', dx + 'px ' + dy + 'px');
      moving.push(c);
    });
    if (!moving.length) return;
    void this.view._root.offsetWidth;                  // that start, drawn
    raf(function () {
      moving.forEach(function (c) {
        c.style.transition = 'translate ' + SETTLE + 'ms ' + ease();
        c.style.removeProperty('translate');
        var G2 = global.hkGlass;
        if (G2 && G2.moving) G2.moving(c, SETTLE + 140);
      });
    });
  };
  // the draft, changed: drawn at once
  Part.prototype.commit = function (grid, text) {
    if (!grid) return false;
    this.grid = grid;
    this.paint(grid);
    say(text || '');
    return true;
  };

  // ------------------------------------------------------------ the press
  Part.prototype.hit = function (e) {
    var path = e && e.composedPath ? e.composedPath() : [], act = null, cover = null, cell = null;
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || !el.getAttribute) continue;
      if (!act && el.getAttribute('data-ge-act')) act = el;
      if (!cover && el.getAttribute('data-ge')) cover = el;
      if (el.parentNode === this.view._root && el.classList && el.classList.contains('cell') && el.getAttribute('data-id')) { cell = el; break; }
    }
    return { act: act, cover: cover, cell: cell, id: cell && cell.getAttribute('data-id') };
  };
  Part.prototype.down = function (e) {
    if (this.placing) { this.placeDown(e); return; }
    var s = E() && E().active(), hit = this.hit(e);
    if (!hit.cell) return;                             // the grid between blocks: the views' swipe, the dots
    e.stopPropagation();
    if (hit.act || !s || s.saving || this.carry || this.press) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    var self = this, touch = e.pointerType === 'touch' || e.pointerType === 'pen', D = global.hkDrag;
    var slop = touch ? (D ? D.SLOP_TOUCH : 8) : (D ? D.SLOP_MOUSE : 5);
    var p = { id: hit.id, cell: hit.cell, x0: e.clientX, y0: e.clientY, pid: e.pointerId, last: e, timer: null };
    try { this.view._root.setPointerCapture(e.pointerId); } catch (x) { /* a test page */ }
    var move = function (ev) {
      if (ev.pointerId !== undefined && p.pid !== undefined && ev.pointerId !== p.pid) return;
      p.last = ev;
      if (self.carry) { self.carryMove(ev); return; }
      if (Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) >= slop) self.lift(p, ev);
    };
    var end = function (ev, cancelled) {
      if (ev && ev.pointerId !== undefined && p.pid !== undefined && ev.pointerId !== p.pid) return;
      stop();
      if (self.carry) self.drop(ev, cancelled);
    };
    var up = function (ev) { end(ev, false); };
    var cx = function (ev) { end(ev, true); };
    var stop = function () {
      clearTimeout(p.timer);
      var w = win();
      w.removeEventListener('pointermove', move, true); w.removeEventListener('pointerup', up, true); w.removeEventListener('pointercancel', cx, true);
      if (self.press === p) self.press = null;
    };
    p.stop = stop;
    if (touch) p.timer = setTimeout(function () { if (self.press === p && !self.carry) self.lift(p, p.last); }, HOLD_MS);
    var w = win();
    w.addEventListener('pointermove', move, true); w.addEventListener('pointerup', up, true); w.addEventListener('pointercancel', cx, true);
    this.press = p;
  };
  Part.prototype.click = function (e) {
    if (this.placing) { e.stopPropagation(); e.preventDefault(); return; }
    var hit = this.hit(e), s = E() && E().active();
    if (!hit.cell) return;
    e.stopPropagation(); e.preventDefault();
    if (!hit.act || !s || s.saving || this.carry) return;
    var what = hit.act.getAttribute('data-ge-act');
    if (what === 'remove') this.remove(hit.id);
    else if (what === 'size') this.openSize(hit.id);
  };
  // THE KEYBOARD on a block: an arrow moves it a cell (making room as a drag
  // does), Delete or Backspace removes it
  Part.prototype.key = function (e) {
    if (this.placing) return;                          // a card being placed has its own keys (placeKey)
    var hit = this.hit(e), s = E() && E().active();
    if (!hit.cell || !s || s.saving) return;
    if (hit.act && (e.key === 'Enter' || e.key === ' ')) return;          // the button's own click
    var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.stopPropagation(); e.preventDefault();
      var it = find(this.grid, hit.id), Xe = X();
      if (!it || !Xe) return;
      var next = Xe.makeRoom(this.grid, it.id, [it.at[0] + d[0], it.at[1] + d[1]]);
      if (next) { this.commit(next); this.focus(it.id); } else say('It can’t go further that way.');
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.stopPropagation(); e.preventDefault(); this.remove(hit.id); }
  };
  Part.prototype.focus = function (id) {
    var cell = this.cellOf(id), cover = cell && cell.querySelector && cell.querySelector('.hk-ge');
    if (cover && cover.focus) cover.focus();
  };
  Part.prototype.remove = function (id) {
    var it = find(this.grid, id);
    if (!it) return false;
    return this.commit(removed(this.grid, id), name(it) + ' removed. Cancel puts it back.');
  };

  // ------------------------------------------------------------ carrying
  Part.prototype.lift = function (p, ev) {
    var it = find(this.grid, p.id), box = this.view.cellBox && this.view.cellBox(), Xe = X();
    if (this.carry || !it || !box || !Xe) return false;
    clearTimeout(p.timer);
    var r = p.cell.getBoundingClientRect(), root = this.view._root;
    this.carry = { p: p, it: it, box: box, at: it.at.slice(), cand: this.grid, bad: false,
                   cx: r.left + r.width / 2, cy: r.top + r.height / 2, shown: this.grid };
    p.cell.style.transition = 'none';
    p.cell.classList.add('hk-ge-carried');
    root.classList.add('hk-ge-carrying');
    var G2 = global.hkGlass;
    if (G2 && G2.carry) G2.carry(p.cell, true);
    var t = doc().createElement('div');
    t.className = 'hk-ge-target';
    t.setAttribute('aria-hidden', 'true');
    root.appendChild(t);
    this.carry.target = t;
    this.aimAt(it.at, false);
    this.carryMove(ev);
    return true;
  };
  // the band's row above the cells (1), or none (0): hk-layout.js _place
  Part.prototype.bandRow = function () {
    var g = this.cfg0.grid || {};
    return g.band !== false && (this.cfg0.cards || []).some(function (x) { return x && x.hk_band; }) ? 1 : 0;
  };
  // the outline where the carried block would go
  Part.prototype.aimAt = function (at, bad) {
    var c = this.carry || this.placing, t = c && c.target, z = c && G().span(c.it ? c.it.size : c.size, this.grid.cols, this.grid.rows);
    if (!t) return;
    var top = this.bandRow();
    t.style.gridColumn = (at[0] + 1) + ' / span ' + z[0];
    t.style.gridRow = (at[1] + 1 + top) + ' / span ' + z[1];
    t.classList.toggle('bad', !!bad);
  };
  Part.prototype.carryMove = function (ev) {
    var c = this.carry;
    if (!c) return;
    var dx = ev.clientX - c.p.x0, dy = ev.clientY - c.p.y0, k = c.box.scale || 1;
    c.p.cell.style.setProperty('translate', (dx / k) + 'px ' + (dy / k) + 'px');
    var at = X().landing(c.cx + dx, c.cy + dy, c.box, c.box.cols, c.box.rows, c.box.gap, c.it.size);
    if (at[0] === c.at[0] && at[1] === c.at[1]) return;
    c.at = at;
    var home = at[0] === c.it.at[0] && at[1] === c.it.at[1];
    var cand = home ? this.grid : X().makeRoom(this.grid, c.it.id, at);
    c.cand = cand; c.bad = !cand;
    this.aimAt(at, !cand);
    // the others make room (or go back to their places): only the cells move
    this.show(cand || this.grid);
  };
  // the blocks other than the carried one at their places in `grid` (a card being placed carries none: all of them)
  Part.prototype.show = function (grid) {
    var c = this.carry || this.placing;
    if (!c || c.shown === grid) return;
    c.shown = grid;
    var first = this.boxes(), top = this.bandRow();
    this.cells().forEach(function (cell) {
      var it = find(grid, cell.getAttribute('data-id'));
      if (!it || (c.it && it.id === c.it.id)) return;
      var z = G().span(it.size, grid.cols, grid.rows);
      cell.style.gridColumn = (it.at[0] + 1) + ' / span ' + z[0];
      cell.style.gridRow = (it.at[1] + 1 + top) + ' / span ' + z[1];
    });
    this.glide(first, c.p && c.p.cell);
  };
  Part.prototype.drop = function (ev, cancelled) {
    var c = this.carry;
    if (!c) return;
    this.carry = null;
    var root = this.view._root, cell = c.p.cell;
    if (c.target && c.target.parentNode) c.target.parentNode.removeChild(c.target);
    root.classList.remove('hk-ge-carrying');
    var G2 = global.hkGlass;
    setTimeout(function () { if (G2 && G2.carry) G2.carry(cell, false); }, SETTLE + 60);
    var next = !cancelled && c.cand && c.cand !== this.grid ? c.cand : null;
    // the carried one glides from where it was let go (its translate, as the
    // first box) to its place; the others are where they were shown
    var first = this.boxes();
    cell.classList.remove('hk-ge-carried');
    if (next) this.grid = next;
    this.paint(this.grid, first);
    say(!next && !cancelled && c.bad ? 'There’s no room for it there.' : '');
  };
  // Escape while a block is carried, or a sheet is open: theirs, not Cancel's
  Part.prototype.escape = function () {
    if (this.sheet) { this.closeSheet(); return true; }
    if (this.placing) { this.placeEnd(false); say('Cancelled.'); return true; }
    if (this.carry) { if (this.press && this.press.stop) this.press.stop(); this.drop(null, true); return true; }
    return false;
  };

  // ------------------------------------------------------------ placing a card by hand
  // A CARD THERE IS NO FREE SPACE FOR (2026-10-31, the owner: "if there's no
  // room for the card, let me drag it onto the grid anyway ... it replaces
  // the blocks it covers"): Add offers its size, and choosing it ends the
  // sheet and starts PLACING -- a mouse's pointer, a finger down and moving,
  // or the arrow keys carry an outline over the grid (Enter, a click, or a
  // finger lifted over the grid drops the card there; Escape, or a finger
  // lifted off the grid, gives up). Where blocks are in the way the others
  // make room if they can, else the card takes the cells it covers and those
  // blocks are removed (hkGridEditor.addOver, the editor's own rule): they are
  // dimmed and framed red while it is held over them, and the bar's line names
  // them. Dropped, it is one change: Cancel puts everything back.
  Part.prototype.placeStart = function (card, size, view) {
    var box = this.view.cellBox && this.view.cellBox(), Xe = X(), root = this.view._root;
    if (!box || !Xe || !root) return false;
    this.placeEnd(false);
    var t = doc().createElement('div');
    t.className = 'hk-ge-target';
    t.setAttribute('aria-hidden', 'true');
    t.style.display = 'none';
    root.appendChild(t);
    var self = this, w = win(), p = this.placing = { card: card, size: size, view: view || 0, target: t, at: null, plan: null, key: null, down: false,
      shown: this.grid, what: sizeName(size) + ' ' + ((Xe.NAMES && Xe.NAMES[card]) || card) };
    root.classList.add('hk-ge-carrying');
    p.on = {
      move: function (e) { if (self.placing === p) self.placeAt(e.clientX, e.clientY); },
      up: function (e) {
        if (self.placing !== p || !p.down) return;
        p.down = false;
        self.placeAt(e.clientX, e.clientY);
        if (p.at) self.placeDrop(); else { self.placeEnd(false); say('Cancelled.'); }
      },
      cancel: function () { if (self.placing === p) { p.down = false; self.placeAim(null); } },
      key: function (e) { self.placeKey(e); }
    };
    w.addEventListener('pointermove', p.on.move, true); w.addEventListener('pointerup', p.on.up, true);
    w.addEventListener('pointercancel', p.on.cancel, true); w.addEventListener('keydown', p.on.key, true);
    say(this.placeHint());
    return true;
  };
  Part.prototype.placeEnd = function (keepShown) {
    var p = this.placing;
    if (!p) return;
    // (the others back where the draft has them, unless the drop is about to draw them where it puts them)
    if (!keepShown) this.show(this.grid);
    this.placing = null;
    var w = win(), root = this.view._root;
    w.removeEventListener('pointermove', p.on.move, true); w.removeEventListener('pointerup', p.on.up, true);
    w.removeEventListener('pointercancel', p.on.cancel, true); w.removeEventListener('keydown', p.on.key, true);
    if (p.target && p.target.parentNode) p.target.parentNode.removeChild(p.target);
    if (root) root.classList.remove('hk-ge-carrying');
    this.cells().forEach(function (c) { c.classList.remove('hk-ge-going'); });
    say('');
  };
  // the line in the bar: what a drop here would do
  Part.prototype.placeHint = function () {
    var p = this.placing, Xe = X();
    if (!p.at) return 'Drag the new ' + p.what + ' over the grid, onto the blocks it should replace, and let go. Escape cancels.';
    if (!p.plan) return 'The ' + p.what + ' doesn’t fit there.';
    if (p.plan.removed.length) return 'The ' + p.what + ' replaces ' + Xe.listOf(p.plan.removed) + ' here. Cancel puts ' + (p.plan.removed.length > 1 ? 'them' : 'it') + ' back.';
    return 'The ' + p.what + ' goes here' + (p.plan.moved.length ? '; the others make room.' : '.');
  };
  // the outline at the cells `at` (null: off the grid), and what it would do there
  Part.prototype.placeAim = function (at) {
    var p = this.placing, Xe = X();
    if (!p) return;
    var key = at ? at.join() : 'off';
    if (key === p.key) return;
    p.key = key; p.at = at;
    p.plan = at ? Xe.addOver(this.grid, p.card, p.size, at, p.view) : null;
    var gone = p.plan ? p.plan.removed.map(function (it) { return it.id; }) : [];
    p.target.style.display = at ? '' : 'none';
    if (at) this.aimAt(at, !p.plan);
    p.target.classList.toggle('replace', gone.length > 0);
    this.cells().forEach(function (c) { c.classList.toggle('hk-ge-going', gone.indexOf(c.getAttribute('data-id')) >= 0); });
    // the others that make room slide aside; the rest as the draft has them
    this.show(p.plan && p.plan.moved.length ? p.plan.grid : this.grid);
    say(this.placeHint());
  };
  Part.prototype.placeAt = function (x, y) {
    var p = this.placing, box = this.view.cellBox && this.view.cellBox(), Xe = X();
    if (!p || !box || !Xe) return;
    var inside = x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
    this.placeAim(inside ? Xe.landing(x, y, box, box.cols, box.rows, box.gap, p.size) : null);
  };
  Part.prototype.placeDown = function (e) {
    var p = this.placing;
    if (!p || (e.button !== undefined && e.button !== 0)) return;
    e.stopPropagation();
    if (e.pointerType === 'mouse') e.preventDefault();
    p.down = true;
    this.placeAt(e.clientX, e.clientY);
  };
  // the arrow keys move the outline a cell (from the middle of the grid at first), Enter drops the card; a button's
  // own keys (the bar's Done, Cancel and Add) stay its own
  Part.prototype.placeKey = function (e) {
    var p = this.placing, box = this.view.cellBox && this.view.cellBox(), Xe = X();
    if (!p || !box || !Xe) return;
    var path = e.composedPath ? e.composedPath() : [], t = path[0] || e.target;
    if (t && t.localName === 'button') return;
    var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key], z = G().span(p.size, box.cols, box.rows);
    if (d) {
      e.stopPropagation(); e.preventDefault();
      var from = p.at || [Math.floor((box.cols - z[0]) / 2), Math.floor((box.rows - z[1]) / 2)], to = p.at ? [from[0] + d[0], from[1] + d[1]] : from;
      this.placeAim([Math.max(0, Math.min(box.cols - z[0], to[0])), Math.max(0, Math.min(box.rows - z[1], to[1]))]);
    } else if ((e.key === 'Enter' || e.key === ' ') && p.at) {
      e.stopPropagation(); e.preventDefault();
      this.placeDrop();
    }
  };
  Part.prototype.placeDrop = function () {
    var p = this.placing;
    if (!p) return;
    var plan = p.plan, Xe = X();
    if (!plan) { say(this.placeHint()); return; }
    this.placeEnd(true);
    var added = plan.grid.items[plan.grid.items.length - 1];
    if (p.card === 'accessories') added.pages = { source: 'accessories' };
    if (p.card === 'room') added.opts = { accessory_display: 'scroll' };
    var gone = plan.removed, nm = (Xe.NAMES && Xe.NAMES[p.card]) || p.card;
    this.commit(plan.grid, gone.length ? Xe.listOf(gone) + (gone.length > 1 ? ' were' : ' was') + ' replaced by ' + nm + '. Cancel puts ' + (gone.length > 1 ? 'them' : 'it') + ' back.' : nm + ' added.');
    this.focus(added.id);
  };

  // ------------------------------------------------------------ the sheets
  function sheetCss() {
    return ':host{position:fixed!important;inset:0;z-index:12;height:auto!important;background:transparent!important;display:block}' +
      '.scrim{position:absolute;inset:0;background:rgba(0,0,0,.45)}' +
      '.pane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(540px,calc(100vw - 32px));' +
      'max-height:calc(100dvh - 48px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;' +
      'background:var(--hk-bg);border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.5)}' +
      '.pane.small{width:min(360px,calc(100vw - 32px))}' +
      '.nav{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:52px;padding:0 8px;' +
      'border-bottom:.5px solid var(--hk-sep)}' +
      '.nav h2{margin:0;font-size:17px;font-weight:600;letter-spacing:-.41px;text-align:center}' +
      '.nav button{appearance:none;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:17px;padding:10px 8px;min-height:44px;cursor:pointer}' +
      '.nav .ok{grid-column:3;justify-self:end;font-weight:600}' +
      '.body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:20px 16px 8px}' +
      '.chips{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto;justify-content:flex-end;max-width:55%}' +
      '.chip{appearance:none;border:0;min-height:32px;min-width:44px;padding:0 10px;border-radius:8px;background:var(--hk-fill);color:var(--hk-tint);' +
      'font:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
      '.chip[disabled]{color:var(--hk-label3);cursor:default}' +
      '.chip[data-replace]{color:var(--hk-label2)}' +
      '.chip:not([disabled]):active{background:var(--hk-press)}' +
      '.cell .why{margin-left:auto;font-size:13px;color:var(--hk-label2)}' +
      '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}';
  }
  // a sheet over the page: the kit's look, a title and Done, and `fill(body, K)`
  Part.prototype.openSheet = function (title, small, fill) {
    var self = this, s = E() && E().active();
    if (this.sheet || !s) return Promise.resolve(false);
    var back = doc() && doc().activeElement;
    return kit().then(function (K) {
      if (!K || P !== self || self.sheet) return false;
      var d = doc(), host = d.createElement('div');
      host.id = 'hk-edit-grid-sheet';
      var sr = host.attachShadow({ mode: 'open' });
      var h = s.h, dark = !(h && h.themes && h.themes.darkMode === false);
      if (dark) host.setAttribute('dark', '');
      sr.innerHTML = '<style>' + K.CSS + sheetCss() + '</style><div class="scrim"></div>' +
        '<div class="pane' + (small ? ' small' : '') + '" role="dialog" aria-modal="true" aria-labelledby="gt"><div class="nav">' +
        '<h2 id="gt" style="grid-column:2"></h2><button class="ok" type="button">Done</button></div>' +
        '<div class="body"></div></div>';
      sr.querySelector('#gt').textContent = title;
      var sh = { host: host, back: back, session: s };
      self.sheet = sh;
      sr.querySelector('.ok').addEventListener('click', function () { self.closeSheet(); });
      sr.querySelector('.scrim').addEventListener('click', function () { self.closeSheet(); });
      fill(sr.querySelector('.body'), K);
      host.setAttribute('data-open', '');
      // (hkEdit's Escape is Cancel; while this is open it is this sheet's: escape())
      var SH = global.hkShell, root = null;
      try { root = SH && SH.dialogRoot ? SH.dialogRoot() : null; } catch (e) { root = null; }
      (root || d.body).appendChild(host);
      var ok = sr.querySelector('.ok');
      if (ok && ok.focus) ok.focus();
      return true;
    }, function (err) {
      if (global.console) console.error('[hk-edit-grid] the sheet needs hk-settings-kit.js', err);
      return false;
    });
  };
  Part.prototype.closeSheet = function () {
    var sh = this.sheet;
    if (!sh) return;
    this.sheet = null;
    if (sh.host && sh.host.parentNode) sh.host.parentNode.removeChild(sh.host);
    if (sh.focusId) this.focus(sh.focusId);
    else if (sh.back && sh.back.focus) { try { sh.back.focus(); } catch (e) { /* gone */ } }
  };
  // A BLOCK'S SIZE: the sizes its card comes in, the one it is checked; one
  // with no room says so
  Part.prototype.openSize = function (id) {
    var self = this, it = find(this.grid, id), Xe = X();
    if (!it || !Xe) return Promise.resolve(false);
    return this.openSheet(name(it), true, function (body, K) {
      var rows = sizesOf(Xe, self.grid, id).map(function (o) {
        var row = K.check({ label: Xe.SIZE_NAMES[o.size], on: o.on, fk: 'size:' + o.size, onClick: function () {
          if (o.on) { self.closeSheet(); return; }
          var next = resized(Xe, self.grid, id, o.size);
          if (self.sheet) self.sheet.focusId = id;
          self.closeSheet();
          if (next) self.commit(next, name(it) + ' is ' + Xe.SIZE_NAMES[o.size] + '.');
        } });
        row.setAttribute('data-size', o.size);
        if (!o.ok) {
          row.disabled = true;
          row.setAttribute('aria-disabled', 'true');
          row.appendChild(K.h('span', { class: 'why', text: o.why }));
        }
        return row;
      });
      body.appendChild(K.group({ header: 'Size', footer: 'A size that doesn’t fit where it is goes to the nearest place it does; nothing else moves.' }, rows));
    });
  };
  // ADD A BLOCK: the catalog's cards in the editor's groups, each at the
  // sizes this grid holds; a size goes in the first space that fits in the
  // view shown
  Part.prototype.openAdd = function () {
    var self = this;
    return editor().then(function (Xe) {
      if (!Xe || P !== self) return false;
      return self.openSheet('Add a Block', false, function (body, K) {
        var cat = G().table(), view = (self.view.cellBox && self.view.cellBox() || {}).view || 0;
        Xe.GROUPS.forEach(function (g) {
          var rows = g[1].filter(function (key) { return cat[key] && NEEDS_A_CHOICE.indexOf(key) < 0; }).map(function (key) {
            var chips = K.h('span', { class: 'chips' });
            cat[key].sizes.forEach(function (s) {
              var z = G().span(s, self.grid.cols, self.grid.rows);
              if (!z || z[0] > self.grid.cols || z[1] > self.grid.rows) return;
              var room = !!added(Xe, self.grid, key, s, view);
              // (no free space for it: its chip still works -- the card is placed by hand over the blocks it replaces)
              var b = K.h('button', { class: 'chip', type: 'button', 'data-card': key, 'data-size': s, text: Xe.SIZE_SHORT[s],
                                      'aria-label': room ? 'Add ' + Xe.NAMES[key] + ', ' + Xe.SIZE_NAMES[s] : 'Add ' + Xe.NAMES[key] + ', ' + Xe.SIZE_NAMES[s] + ': no free space, place it over blocks to replace them',
                                      title: room ? '' : 'No free space for a ' + Xe.SIZE_NAMES[s] + ' block: place it over the blocks it replaces' });
              if (!room) b.setAttribute('data-replace', '');
              b.addEventListener('click', function () {
                var next = room && added(Xe, self.grid, key, s, view);
                self.closeSheet();
                if (next) { self.commit(next, Xe.NAMES[key] + ' added.'); self.focus(next.items[next.items.length - 1].id); }
                else if (!room) self.placeStart(key, s, view);
              });
              chips.appendChild(b);
            });
            if (!chips.children.length) return null;
            return K.h('div', { class: 'cell hasic', 'data-card': key },
              [K.icon(Xe.GLYPHS[key] || 'mdi:view-grid'), K.label(Xe.NAMES[key], Xe.DESCRIPTIONS[key]), chips]);
          }).filter(Boolean);
          if (rows.length) body.appendChild(K.group({ header: g[0] }, rows));
        });
        body.appendChild(K.h('p', { class: 'gf', text: 'To add one accessory or one scene, or to choose what a block shows, use Arrange Home Grid in Settings.' }));
      });
    });
  };

  // ------------------------------------------------------------ the part
  Part.prototype.saves = function () { return this.ready ? savesOf(this.initial, this.grid, this.dash) : []; };
  Part.prototype.dirty = function () { return this.saves().length > 0; };
  // Cancel, Reload, Discard: the view as it was drawn, its own elements
  Part.prototype.restore = function () {
    if (this.carry) this.drop(null, true);
    this.placeEnd(false);
    this.closeSheet();
    this.grid = copy(this.initial);
    if (this.ready) this.view.arrange(this.cfg0, this.els0);
  };
  Part.prototype.leave = function () {
    var root = this.view._root, self = this;
    if (this.press && this.press.stop) this.press.stop();
    if (this.carry) this.drop(null, true);
    this.placeEnd(false);
    this.closeSheet();
    if (this.ready) {
      ['pointerdown', 'click', 'contextmenu', 'keydown'].forEach(function (t) { root.removeEventListener(t, self.on[t], true); });
      root.removeEventListener('touchmove', this.on.touchmove, { passive: false });
      win().removeEventListener('resize', this.on.resize);
      this.undecorate();
      root.classList.remove('hk-ge-on'); root.classList.remove('hk-still'); root.classList.remove('hk-ge-carrying');
      root.style.removeProperty('--hk-ge-k');
      if (this.css && this.css.parentNode) this.css.parentNode.removeChild(this.css);
    }
    if (P === this) P = null;
  };

  // ------------------------------------------------------------ the surface
  function isGrid(view) { return !!view && view.type === VIEW_TYPE; }
  function register() {
    var EE = E();
    if (!EE || typeof EE.surface !== 'function') return false;
    if (EE.surfaces().indexOf('home-grid') >= 0) return true;
    EE.surface({
      id: 'home-grid', hint: HINT, grid: true,
      offers: function (view) {
        if (!isGrid(view)) return false;
        // (the editor's rules, fetched while the page is up: Edit begins at once)
        editor();
        return true;
      },
      enter: function (ctx) {
        var view = ctx.viewEl;
        if (P || !isGrid(ctx.view) || !view || typeof view.arrange !== 'function' || !view._root || !view._config) return null;
        var S = global.hkStrategy, C = cards();
        if (!G() || !S || !S.homeGridView || !C || !C.createCard) return null;
        var part = new Part(ctx);
        if (!part.matches()) return null;
        P = part;
        if (X()) part.begin();
        else editor().then(function (Xe) { if (Xe) part.begin(); else { var EE2 = E(); if (P === part && EE2) EE2.cancel(); } });
        return part;
      }
    });
    return true;
  }

  global.hkEditGrid = {
    version: '1.0.0',
    active: function () { return P; },
    _: { resized: resized, sizesOf: sizesOf, removed: removed, added: added, savesOf: savesOf, cardsFor: cardsFor, keyOf: keyOf,
         HINT: HINT, NEEDS_A_CHOICE: NEEDS_A_CHOICE, editor: editor }
  };

  // hkEdit loads in parallel with this file: whichever is last
  if (!register()) {
    var tries = 0;
    var again = function () { if (register()) { win().removeEventListener('hk-edit', again); return; } if (++tries < 40) setTimeout(again, 250); };
    win().addEventListener('hk-edit', again);
    setTimeout(again, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
