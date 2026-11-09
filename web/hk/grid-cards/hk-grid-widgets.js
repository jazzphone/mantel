// hk-grid-widgets.js - the action, everything, suggested scene and On Now blocks.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-widgets'] = function (K) {
    var ACC = K.ACC, APP_CORNER = K.APP_CORNER, areaOf = K.areaOf, attr = K.attr, C = K.C, clockText = K.clockText,
        dom = K.dom, esc = K.esc, gly = K.gly, hidesOf = K.hidesOf, HkBase = /** @type {HkLooseElementConstructor} */ (K.HkBase), HkGridKey = /** @type {HkLooseElementConstructor} */ (K.HkGridKey),
        houseMinutes = K.houseMinutes, inner = K.inner, isGroup = K.isGroup, KEY_CSS = K.KEY_CSS, own = K.own,
        plan = K.plan, plural = K.plural, roomOf = K.roomOf, setting = K.setting, sizeOf = K.sizeOf,
        suggestion = K.suggestion, TILE = K.TILE, type = K.type, v = K.v, WG_CSS = K.WG_CSS;

    // ===================================================== hk-action-card
    // ONE ACTION, THE WHOLE BLOCK ITS BUTTON (2026-10-31, the owner's notes on
    // the widget mock-up): on a HomeView dashboard HomeView's tile (Centred:
    // the glyph large over its name, what it will do under it), on the glass
    // or -- `color` -- a gradient of its own color; on a standard one
    // Shortcuts' button, always in its color. Its color: All Lights Off the
    // Lights page's yellow, Lock Up and Garage Security's teal, a scene or
    // script its accessory's Color, else a tint of its own (hk-tile.js ownTint).
    var YELLOW = (C.PALETTE.icon && C.PALETTE.icon.yellow) || null;
    function actionHex(client, action) {
      var A = C.ACCENTS, T = window.hkTile || {};
      if (action === 'lights_off') return A.yellow;
      if (action === 'lock_up' || action === 'garage') return A.teal;
      var acc = ((setting('accessories', {}) || {}).entities || {})[action] || {};
      return (acc.color && T.hexOf && T.hexOf(acc.color)) || (T.ownTint ? T.ownTint(action) : A.purple);
    }
    // WIDE (2026-11-07, the review; the coordinator's spec for every Wide tile: this, Accessory, Scene and Intercom draw
    // one geometry). Home style: Apple Home's wide tile -- the 42 px well at the left inset, vertically centered, the name
    // (15 / 600) over the state (15 / 500) on 18.6 px lines beside it, the pair centered. Centered style: HomeView's tile laid
    // sideways -- the glyph bare, at the size the Centered Small tile draws it on that cell (TILE.centred tall or square: the
    // box and the glyph), its box centered at a third of the block's width (balancing a name of usual length); the name over the state left-aligned, the text column
    // 16 px right of the glyph's box, the pair centered on the glyph's center, an ellipsis at the right inset. In its color's
    // gradient as Small has it. The Centered rules (hkCards.centredTile, all !important) are outvoted by longer selectors.
    var AW = ':host([size=W]) hk-plate.k', AH = ':host([size=W]:not([tile=centred])) hk-plate.k', AC = ':host([size=W][tile=centred]) hk-plate.k';
    var IMP = function (css) { return css.split(';').filter(Boolean).map(function (d) { return d + ' !important'; }).join(';'); };
    var CT = TILE.centred, SQ = '@container hk-cell (min-height:180px) or (max-aspect-ratio: 6 / 5) or style(--hk-cell-shape: square)';
    var ACTION_W_CSS = [
      AW + '{display:flex !important;flex-direction:row;align-items:center;justify-content:flex-start;padding:' + C.blockPad('14px') + ' !important;--wbox:' + CT.tall.box + 'px;--wglyph:' + CT.tall.glyph + 'px;--wname:' + CT.tall.name + 'px;--wsub:' + CT.tall.sub + 'px;--wline:' + CT.tall.line + 'px}',
      AW + ' .tx .name,' + AW + ' .tx .state{' + IMP('position:static;display:block;width:auto;margin:0;text-align:left;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') + '}',
      AW + ' .tx{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0}',
      // HOME STYLE
      AH + '{gap:9.6px}',
      AH + ' .well{' + IMP('position:static;transform:none;width:42px;height:42px;margin:0;border-radius:50%') + ';flex:none;background:' + v('key') + ' !important}',
      AH + '[data-paint] .well{background:rgba(255,255,255,0.22) !important}',
      AH + ' .icon{' + IMP('width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px') + '}',
      AH + ' .tx{flex:1}',
      AH + ' .tx .name{' + IMP('font-size:15px;font-weight:600;line-height:18.6px') + '}',
      AH + ' .tx .state{' + IMP('font-size:15px;font-weight:500;line-height:18.6px') + '}',
      // CENTERED STYLE
      AC + ' .well{' + IMP('position:absolute;left:33.33%;top:50%;transform:translate(-50%,-50%);margin:0;background:none;border-radius:50%;width:var(--wbox);height:var(--wbox)') + '}',
      AC + ' .icon{' + IMP('width:var(--wglyph);height:var(--wglyph)') + '}',
      AC + ' .tx{' + IMP('position:absolute;left:calc(33.33% + var(--wbox) / 2 + 16px);right:var(--hk-pad-r,14px);top:50%;transform:translateY(-50%)') + '}',
      AC + ' .tx .name{' + IMP('font-size:var(--wname);font-weight:600;line-height:var(--wline)') + '}',
      AC + ' .tx .state{' + IMP('font-size:var(--wsub);font-weight:400;line-height:var(--wline)') + '}',
      SQ + '{' + AW + '{--wbox:' + CT.square.box + 'px;--wglyph:' + CT.square.glyph + 'px;--wname:' + CT.square.name + 'px;--wsub:' + CT.square.sub + 'px;--wline:' + CT.square.line + 'px}}'
    ].join('');
    class HkActionCard extends HkGridKey {
      static get CSS() { return KEY_CSS + ACTION_W_CSS; }
      setConfig(config) {
        if (!config || !config.action) throw new Error('hk-action: `action` is required');
        super.setConfig(config);
      }
      _plan() {
        var c = this._config;
        return plan(this.client, c.action, c.action === 'lights_off' ? roomOf(c.area, null, this.client) : null);
      }
      _sigOf() {
        var p = this._plan();
        return JSON.stringify([p.name, p.icon, p.state, p.hot, this._said || null, this.getAttribute('tile'), !!this._config.color, sizeOf(this)]);
      }
      _look() {
        var p = this._plan(), a = this._config.action;
        var color = !p.hot ? null : a === 'lights_off' ? YELLOW : a === 'lock_up' || a === 'garage' ? v('warn') : null;
        var paint = this.getAttribute('tile') !== 'centred' || this._config.color ? actionHex(this.client, a) : null;
        return { name: p.name, icon: p.icon, state: p.state, color: color, paint: paint };
      }
      _tap() {
        var p = this._plan(), self = this;
        if (p.sheet) { window.hkShell.moreInfo(p.sheet, this); return; }
        // NOTHING TO DO, said (2026-11-01, the owner: "Nothing really happens when I tap it"): every lock already
        // locked, every light already off -- the tap says so in the state's place for a moment
        if (!p.calls.length) {
          var a = this._config.action;
          var none = a === 'lock_up' ? (p.state === 'All Locked' ? 'Already All Locked' : p.state)
                   : a === 'lights_off' ? 'Already Off' : a === 'garage' ? p.state : '';
          if (none) this._say('none', none, 2000);
          return;
        }
        Promise.all(p.calls.map(function (c) { return self._call(c[0], c[1], c[2]); })).then(function (done) {
          if (done.some(function (x) { return !x; })) self._say('failed', 'Couldn’t Send');
        });
      }
    }
    var ACTION_OPTIONS = [{ value: 'lock_up', label: 'Lock Up' }, { value: 'lights_off', label: 'All Lights Off' },
                          { value: 'garage', label: 'Garage' }];

    // ===================================================== hk-everything-card
    // THE WAY TO EVERY PAGE AND ROOM (what More opens), as app icons
    // (2026-10-31, the owner's notes on the widget mock-up): Small, four of
    // them as a folder over the name and what is on now; Wide, Large and Extra
    // Large the icons themselves -- the tab bar's and the Pages screen's look,
    // a page in its accent, a room in its tint by its place among the menu's
    // rooms (hkCards.iconGradient / roomTint) -- a tap goes straight there, the
    // last place opens the rest; a heading says what is on. Tall (2026-11-07): two columns of icons, labels on. The
    // plate's own tap is More, When Tapped choosing as elsewhere.
    // MORE PLACES (`more`, 2026-11-08, the owner: "scroll within the card or go to the page with the + button"): + Opens
    // the Page (the default) -- the last place, "+N", opens the Pages screen where the screen has one, else More, as
    // before -- or Scroll in the Block: every place, the rows the size shows at a time, the rest scrolled up to.
    function menuItems(client) {
      var M = C.menu, H = window.hkMenu && window.hkMenu._, cfg = null;
      try { cfg = M && M.config ? M.config() : null; } catch (e) { cfg = null; }
      if (!H || !H.model || !cfg || !Array.isArray(cfg.views)) return null;
      var b = (M.board ? M.board() : null) || {};
      var m = H.model(cfg, client && client.areas, { dash: M.dash ? M.dash() : '', order: b.menu_rooms === 'order' ? 'order' : 'az',
        roomOrder: b.room_order, user: client && client.user && client.user.id, categories: b.categories, top: b.menu_top, chips: b.chips,
        chipsRow: b.chips_row, pageOrder: H.pagePaths ? H.pagePaths(b.pages, b.custom_pages) : [], ha: false }) || {};
      var A = C.ACCENTS, PO = C.PAGE_OF_PATH || {}, glyph = H.glyph || function (i) { return i; };
      var pages = (m.top || []).concat(m.categories || []).map(function (it) {
        var p = String((it.paths || [])[1] != null ? it.paths[1] : (it.paths || [])[0]);
        return { title: it.title, icon: glyph(it.icon), path: it.path, hex: (C.pageAccentHex && C.pageAccentHex(PO[p] || p)) || A.orange };
      });
      var rooms = (m.rooms || []).map(function (it, i) {
        return { title: it.title, icon: glyph(it.icon), path: it.path, hex: A[C.roomTint ? C.roomTint(i) : 'orange'] || A.orange };
      });
      var all = pages.concat(rooms);
      // (the Pages screen, Phase J, where the screen has it: "+N"'s page)
      /** @type {any} */ (all).pagesPath = m.pages ? m.pages.path : null;
      return all;
    }
    // WHAT IS ON NOW: the lights, switches and fans on, the speakers playing
    // (none hidden, none a group)
    function onNow(client) {
      var st = (client && client.states) || {}, n = 0;
      ['light', 'switch', 'fan'].forEach(function (d) { own(client, d).forEach(function (id) { if (st[id].state === 'on') n++; }); });
      own(client, 'media_player').forEach(function (id) { if (st[id].state === 'playing') n++; });
      return n;
    }
    function onNowText(n) { return n ? n + ' on now' : 'All off'; }
    // [columns, rows, labels] at each size (the mock-up's: Wide a row of
    // five, Large four by three, Extra Large six by three); Tall (2026-11-07, the review) two columns of as many rows
    // as its height holds -- rows 0, worked out in _render
    var EV_GRID = { W: [5, 1, false], T: [2, 0, true], L: [4, 3, true], XL: [6, 3, true], XXL: [10, 3, true] };
    var EV_CSS = [
      'hk-plate.ev{box-sizing:border-box;height:100%;display:flex;flex-direction:column;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + ';color:' + v('ink') + '}',
      // (2026-11-08, the owner: "if the card's name is printed on the card...it can go": no "Everything" row, no "9 on now" -- the apps take its room)
      '.apps{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--c),minmax(0,1fr));column-gap:8px;row-gap:var(--rg);',
      '  justify-items:center;align-content:center}',
      '.app{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;max-width:100%;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.app i{display:flex;align-items:center;justify-content:center;flex:none;width:var(--px);height:var(--px);border-radius:' + APP_CORNER + ';color:#fff;font-style:normal;',
      '  box-shadow:0 4px 10px rgba(0,0,0,0.22);transition:transform ' + C.DUR.press + ' ease}',
      '.app i hk-icon{width:calc(var(--px) * 0.53);height:calc(var(--px) * 0.53);--mdc-icon-size:100%;display:flex;color:#fff}',
      '.app:active i{transform:scale(0.94)}',
      '.app:focus-visible i{outline:2px solid ' + v('ink-2') + ';outline-offset:3px}',
      '.app small{' + type('micro') + ';line-height:14px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:' + v('glow') + '}',
      '.app.mo i{background:rgba(255,255,255,0.2);' + type('headline') + '}',
      // SCROLL IN THE BLOCK (`more: scroll`, 2026-11-08): every place, the rows the block shows at a time, the rest under
      // them -- up and down is the block's, sideways the pager's; a row stops where a row starts
      '.apps.scroll{align-content:start;grid-auto-rows:var(--rh);overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scrollbar-width:none;',
      '  scroll-snap-type:y mandatory;touch-action:pan-y}',
      '.apps.scroll::-webkit-scrollbar{display:none}.apps.scroll .app{scroll-snap-align:start;touch-action:pan-y}',
      '@media (prefers-reduced-motion:reduce){.app i{transition:none}.app:active i{transform:none}}'
    ].join('');
    class HkEverythingCard extends HkGridKey {
      static get CSS() { return KEY_CSS + EV_CSS; }
      _size() { return sizeOf(this) || 'S'; }
      _items() { return menuItems(this.client) || []; }
      _sigOf() {
        return JSON.stringify([this._items().map(function (x) { return x.path; }), onNow(this.client), this._size(), this._blockKey || '', (this._config || {}).more || '',
                               C.menu && C.menu.sig ? C.menu.sig() : '']);
      }
      _look() {
        var items = this._items(), n = onNow(this.client);
        // four of its places, as a folder (none yet: the menu button's own glyph)
        var icon = 'hk:menu';
        try { if (C.menu && C.menu.icon) icon = C.menu.icon() || icon; } catch (e) { /* hk:menu */ }
        return { name: 'Everything', icon: icon, state: onNowText(n), color: null,
                 folder: items.length >= 4 ? items.slice(0, 4).map(function (x) { return [x.hex, x.icon]; }) : null };
      }
      // THE SCREEN'S OWN NAVIGATION, never a second menu: with the tab bar
      // showing, its More sheet (what the bar's menu opens); else the side
      // menu, as the menu button opens it
      _tap() {
        // (When Tapped, 2026-11-07: Nothing leaves even the key still)
        if ((this._config || {}).tap === 'none') return;
        var M = C.menu, B = window.hkTabBar;
        if (M && M.tabBar && M.tabBar() && B && typeof B.open === 'function') { B.open('more'); return; }
        if (M && M.open) M.open();
      }
      // "+N" (`more: page`, the default): the page of every place -- the Pages screen, where the screen has it -- else
      // what the plate opens, More
      _more() {
        var p = this._items().pagesPath;
        if (p) { C.navigate(p, this); return; }
        this._tap();
      }
      // (the plate's tap, hk-base.js openTarget) the same, from anywhere on a larger block than the key
      _tapTarget() { var self = this; return [{ run: function () { self._tap(); } }]; }
      _render() {
        var size = this._size();
        if (size === 'S' || !EV_GRID[size]) {
          if (this._mode !== 'S') { this._mode = 'S'; this._built = false; this._foldKey = null; }
          return super._render();
        }
        this._watchBlock();
        var self = this, items = this._items(), g = EV_GRID[size], cols = g[0], rows = g[1], labels = g[2];
        // THE ICONS' SIZE (2026-11-07, the review: Wide's five sat on the foot under a big empty band): by the room the
        // block has -- what is under its heading, less the labels -- as large as the width lets them (60 at most),
        // and the rows in the middle of it. Tall: as many rows as hold icons of 48 and over, in two columns.
        var box = inner(this, size), rg = size === 'W' ? 0 : 12, free = box.ih, lab = labels ? 20 : 0;
        if (!rows) rows = Math.max(2, Math.min(6, Math.floor((free + rg) / (48 + lab + rg))));
        var sizeAt = function (n, gap) { return Math.max(36, Math.min(labels ? 62 : 60, Math.floor((box.iw - (cols - 1) * 8) / cols) - (labels ? 6 : 0),
                                                                   Math.floor((free - (n - 1) * gap) / n) - lab)); };
        var px = sizeAt(rows, rg);
        // ANOTHER ROW WHERE ONE FITS (2026-11-08, the owner, once the heading had gone: "the everything cards, wide, large, and xlarge
        // could get another row?"): as many rows as the block holds without the icons shrinking (4 px at most) -- on square cells
        // Wide two, Large and Extra Large four; a tile cell's keep theirs
        if (g[1]) for (var n = rows + 1, gap = size === 'W' ? 8 : rg; n <= rows + 3; n++) {
          if (sizeAt(n, gap) < px - 4) break;
          var keep = n; px = Math.min(px, sizeAt(n, gap));
        }
        if (keep) { rows = keep; if (size === 'W') rg = 8; px = sizeAt(rows, rg); }
        if (this._mode !== size || !this._built) {
          this._mode = size;
          this._root.innerHTML = '<hk-plate class="ev" data-hk-role="card"><div class="apps" role="list"></div></hk-plate>';
          this._ev = { card: this._root.querySelector('.ev'), apps: this._root.querySelector('.apps') };
          this._appKey = null;
          this._built = true;
        }
        var e = this._ev;
        e.apps.style.setProperty('--c', String(cols));
        e.apps.style.setProperty('--px', px + 'px');
        e.apps.style.setProperty('--rg', rg + 'px');
        // (scroll: every place, `rows` of them in sight at a time; else the last place says "+N")
        var scroll = (this._config || {}).more === 'scroll', places = cols * rows;
        var cut = !scroll && items.length > places, shown = cut ? items.slice(0, places - 1) : items;
        e.apps.classList.toggle('scroll', scroll);
        // (a row's height from the list's own: a scroller's percentages are of no definite height)
        var ch = scroll ? e.apps.clientHeight : 0;
        e.apps.style.setProperty('--rh', (ch > 0 ? ch : free) / rows - (rows - 1) * rg / rows + 'px');
        // (and a gap under Wide's one row, so the next starts out of sight)
        if (scroll && !rg) e.apps.style.setProperty('--rg', '14px');
        var key = JSON.stringify([shown, cut ? items.length - shown.length : 0, labels, scroll]);
        if (key === this._appKey) return;
        this._appKey = key;
        e.apps.innerHTML = '';
        shown.forEach(function (x) {
          var gr = C.iconGradient(x.hex), a = document.createElement('button');
          a.type = 'button'; a.className = 'app'; a.setAttribute('role', 'listitem'); a.setAttribute('aria-label', x.title);
          a.innerHTML = '<i><hk-icon></hk-icon></i>' + (labels ? '<small></small>' : '');
          a.querySelector('i').style.background = 'linear-gradient(180deg,' + gr[0] + ',' + gr[1] + ')';
          a.querySelector('hk-icon').icon = x.icon;
          if (labels) a.querySelector('small').textContent = x.title;
          a.addEventListener('click', function (ev) { ev.stopPropagation(); C.navigate(x.path, self); });
          e.apps.appendChild(a);
        });
        if (cut) {
          var m = document.createElement('button'), rest = items.length - shown.length;
          m.type = 'button'; m.className = 'app mo'; m.setAttribute('role', 'listitem'); m.setAttribute('aria-label', rest + ' more: every page and room');
          m.innerHTML = '<i></i>' + (labels ? '<small>All</small>' : '');
          m.querySelector('i').textContent = '+' + rest;
          m.addEventListener('click', function (ev) { ev.stopPropagation(); self._more(); });
          e.apps.appendChild(m);
        }
      }
    }

    // ===================================================== hk-suggested-scene-card
    // THE ART follows the scene: a sky for its time of day (content, not
    // design values: DESIGN.md "Content is not design"), its own color in
    // its well.
    var ART = {
      morning: 'linear-gradient(160deg, #f5a463, #e9707f)',
      day: 'linear-gradient(160deg, #4fb4e2, #3570c4)',
      evening: 'linear-gradient(160deg, #e8900c, #81409c)',
      night: 'linear-gradient(160deg, #2a3a88, #0b1033)'
    };
    var SCENE_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.sg{box-sizing:border-box;height:100%;position:relative;display:flex;align-items:center;gap:16px;',
      '  padding:' + C.blockPad(C.CARD.pad) + ';cursor:pointer;overflow:hidden;' + C.plate('card') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
      '  transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease}',
      'hk-plate.sg:active{transform:scale(0.98);filter:brightness(0.93)}',
      'hk-plate.sg:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.art{position:absolute;inset:0;pointer-events:none;transition:background ' + C.DUR.build + ' ease}',
      '.well{position:relative;width:56px;height:56px;border-radius:50%;flex:none;display:flex;align-items:center;',
      '  justify-content:center;background:' + v('well-bg') + ';transition:background-color ' + C.DUR.fade + ' ease}',
      '.icon{width:' + TILE.sceneGlyph + 'px;height:' + TILE.sceneGlyph + 'px;--mdc-icon-size:100%;display:flex;color:#fff}',
      '.tx{position:relative;display:flex;flex-direction:column;gap:4px;min-width:0}',
      // (2026-11-08, the owner: every block's heading alike) the time of day is the block heading, Music's
      C.headCss('.lb'),
      ':host(:not([size="S"])) .lb{margin-bottom:' + C.HEAD.gap / 2 + 'px}', // (stays on its scene name: 8 px with the .tx gap)
      '.nm{' + type('title') + ';line-height:26px;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cap{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // the art is lit: its words keep the dark plate's white on a light page
      'hk-plate.sg.lit{' + C.LIGHT_OFF + '}',
      'hk-plate.sg.lit .tx{text-shadow:' + v('glow') + '}',
      // L, and T (2026-11-07, the review: Large's composition at 1 x 2): the glyph at the top, the words at the bottom
      ':host([size="L"]) hk-plate.sg,:host([size="T"]) hk-plate.sg{flex-direction:column;align-items:flex-start;justify-content:space-between}',
      ':host([size="L"]) .well,:host([size="T"]) .well{width:64px;height:64px}',
      // S (2026-11-07, the review): the scene as one tile -- its glyph bare, its name, and its time of day (the label) as the
      // second line, nothing else. Centered: HomeView's (hkCards.centredTile over the card's own parts); Home: the glyph at
      // the top and the two lines at the foot, a tile's padding.
      ':host([size="S"]) .cap{display:none}',
      ':host([size="S"]) .lb{' + type('caption') + ';text-transform:none;letter-spacing:0;font-weight:400;line-height:17px}',
      ':host([size="S"]:not([tile=centred])) hk-plate.sg{flex-direction:column;align-items:flex-start;justify-content:space-between;gap:0;',
      '  padding:calc(12.8px + var(--hk-in-t,0px)) calc(12.8px + var(--hk-in-r,0px)) calc(12.8px + var(--hk-in-b,0px)) calc(' + TILE.padL + 'px + var(--hk-in-l,0px))}',
      ':host([size="S"]:not([tile=centred])) .well{width:34px;height:34px;background:none !important}',
      ':host([size="S"]:not([tile=centred])) .icon{width:34px;height:34px}',
      ':host([size="S"]:not([tile=centred])) .tx{gap:0;width:100%}',
      ':host([size="S"]:not([tile=centred])) .nm{' + type('headline') + ';line-height:21px;order:1}',
      ':host([size="S"]:not([tile=centred])) .lb{order:2}',
      ':host([size="S"][tile=centred]) .tx{display:contents}',
      C.centredTile({ host: ':host([size="S"][tile=centred])', plate: 'hk-plate.sg', lit: 'hk-plate.sg.never', well: '.well', icon: '.icon', name: '.nm', sub: ['.lb'] }),
      'hk-plate.sg.hk-tapped .well{background:rgba(255, 255, 255, 0.92)}',
      'hk-plate.sg.hk-tapped .icon{color:#000}',
      '@media (prefers-reduced-motion:reduce){hk-plate.sg,hk-plate.sg:active,.art,.well{transition:none;transform:none}}'
    ].join('');

    class HkSuggestedSceneCard extends HkBase {
      static get CSS() { return SCENE_CSS; }
      getCardSize() { return 2; }
      _now() { return houseMinutes(this._clock ? this._clock() : new Date()); }
      _pick() { return suggestion(this.client, this._config.windows, this._now()); }
      _sigOf() {
        var s = this._pick();
        return JSON.stringify([s, sizeOf(this)]);
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        // the time of day moves on: look again every minute
        if (!this._tick) this._tick = setInterval(function () { self._sigCheck(); }, 60000);
      }
      _sigCheck() {
        var sig = this._sigOf();
        if (sig !== this._lastSig) this.redraw();
      }
      disconnectedCallback() {
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        if (this._tapT) { clearTimeout(this._tapT); this._tapT = null; }
        super.disconnectedCallback();
      }
      _render() {
        var self = this;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="sg" data-hk-role="card" role="button" tabindex="0">' +
            '<div class="art"></div><div class="well"><hk-icon class="icon"></hk-icon></div>' +
            '<div class="tx"><div class="lb"></div><div class="nm"></div><div class="cap"></div></div></hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('.sg'), art: q('.art'), well: q('.well'), icon: q('.icon'), lb: q('.lb'), nm: q('.nm'), cap: q('.cap') };
          this._e.card.addEventListener('click', function (ev) { ev.stopPropagation(); self._run(); });
          this._e.card.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); self._run(); }
          });
          this._built = true;
        }
        var e = this._e, s = this._pick();
        this._lastSig = JSON.stringify([s, sizeOf(this)]);
        this._s = s;
        if (!s) {
          e.art.style.background = '';
          e.card.classList.remove('lit');
          e.icon.icon = 'mdi:palette';
          e.lb.textContent = 'Scenes';
          e.nm.textContent = 'No Scene for Now';
          e.cap.textContent = 'Set its times in the block’s options';
          e.card.setAttribute('aria-label', 'No scene for now');
          return;
        }
        var acc = ((setting('accessories', {}) || {}).entities || {})[s.scene] || {};
        var ent = ((this.client && this.client.entities) || {})[s.scene] || {};
        var st = this.client && this.client.states[s.scene];
        e.art.style.background = ART[s.art] || ART.day;
        e.card.classList.add('lit');
        var icon = acc.icon || ent.icon || attr(st, 'icon') || 'mdi:palette';
        if (e.icon.icon !== icon) e.icon.icon = icon;
        var tint = acc.color && C.PALETTE.icon[acc.color];
        e.well.style.background = tint || '';
        var label = s.next ? 'Next' + (s.label ? ' · ' + s.label : '') : (s.label || ({ morning: 'Morning', day: 'Day', evening: 'Evening', night: 'Night' })[s.art]);
        var cap = s.next ? 'From ' + clockText(s.start) : 'Until ' + clockText(s.end);
        if (e.lb.textContent !== label) e.lb.textContent = label;
        if (e.nm.textContent !== s.name) e.nm.textContent = s.name;
        if (e.cap.textContent !== cap) e.cap.textContent = cap;
        e.card.setAttribute('aria-label', s.name + ', ' + label + ', ' + cap);
      }
      // the scene, run as a scene pill runs it (hkCards.sceneTap), and the
      // pill's tapped look for a moment
      _run() {
        var s = this._s, self = this;
        if (!s) return;
        this._act(C.sceneTap(s.scene), false);
        this._e.card.classList.add('hk-tapped');
        if (this._tapT) clearTimeout(this._tapT);
        this._tapT = setTimeout(function () { self._tapT = null; if (self._e) self._e.card.classList.remove('hk-tapped'); }, 1100);
      }
    }

    // ===================================================== hk-on-now-card
    // ON NOW (2026-10-31, the owner's widget mock-up, "On Now (new)"): what
    // is on in the house right now -- the lights, the speakers playing, the
    // fans and the room's switches -- counted as the Reminders widget counts,
    // each kind in its color. All Off is a house command through the card's
    // action port, as the room pages' toggles are (a speaker pauses).
    // ROUND TWO (2026-11-08, the owner: Wide "isn't really utilizing its space ... pretty small touch areas", Large
    // "seems cluttered ... I prefer the categories, but more info for each category in the larger cards"; "On Now and
    // Home Status shared a similar look"; of tiles, "not a fan ... Let's be intentional on layout"): composed of House
    // Status's parts (hk-house-status.js, `tiles`), from the first Tall he liked -- the count as the headline (quiet:
    // "All Off", once), every kind the house has as a line in the same place, its glyph on a disc lit in its color while
    // something is on, its count, where, and on Large and Extra Large how bright, how fast, what is playing:
    //   S   the count over the kinds' discs             W   the count in a third, the kinds as discs with their counts
    //   T   the count over the lines (All Off above)    L   the count and a sentence over lines of 56
    //   XL  a column for the count beside the lines
    // A KIND'S TAP (`open`, the owner: "Each category should either show a pop up or go to those pages... users
    // decisions"): Show a Sheet (the default) -- the things of that kind that are on, or, none on, all of them -- or Go
    // to Its Page (the Lights page; a kind with no page here, its sheet). A kind is a button (hk-base.js TAP_CONTROLS),
    // so the plate's own tap -- the On Now sheet -- is left for the heading and the gaps.
    // The house's own lists (Status & Chips, hkStrategy.inventory) less what
    // it hides; a group light is its lights, never counted twice.
    var ON_KINDS = [
      { key: 'lights', one: 'light', many: 'lights', icon: 'mdi:lightbulb', color: ACC.yellow, call: ['light', 'turn_off'], off: 'Off', title: 'Lights On', pages: ['lights'], rest: 'Off' },
      { key: 'speakers', one: 'speaker', many: 'speakers', icon: 'mdi:speaker', color: ACC.pink, call: ['media_player', 'media_pause'], off: 'Pause', title: 'Speakers Playing', pages: ['playmusic', 'speakers', 'music'], rest: 'Idle' },
      { key: 'fans', one: 'fan', many: 'fans', icon: 'mdi:fan', color: ACC.cyan, call: ['fan', 'turn_off'], off: 'Off', title: 'Fans On', pages: ['fans', 'climate'], rest: 'Off' },
      { key: 'switches', one: 'switch', many: 'switches', icon: 'mdi:power-plug', color: ACC.green, call: ['switch', 'turn_off'], off: 'Off', title: 'Switches On', pages: ['switches', 'plugs'], rest: 'Off' }
    ];
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    // -> {kinds: [{kind, ids}] of the kinds with something on, every: [{kind, ids, all}] of every kind the house has,
    // things: [{id, kind, name, room}] each thing on, n}
    function whatsOn(client) {
      var st = (client && client.states) || {}, ents = (client && client.entities) || {}, areas = (client && client.areas) || {};
      /** @type {any} */ var inv = null, G = hidesOf();
      try { inv = window.hkStrategy && window.hkStrategy.inventory ? window.hkStrategy.inventory(client, G) : null; } catch (e) { inv = null; }
      inv = inv || {};
      var has = function (list, id) { return Array.isArray(list) && list.indexOf(id) >= 0; };
      var hid = function (id) {
        var e = ents[id] || {}, a = areaOf(client, id);
        return !!(e.hidden || e.entity_category || has(G.exclude_entities, id) || (a && has(G.exclude_areas, a)) || (e.device_id && has(G.exclude_devices, e.device_id)));
      };
      var real = function (id) { return st[id] && !isGroup(st[id]); };
      var is = function (state) { return function (id) { return real(id) && st[id].state === state; }; };
      var all = {
        lights: (inv.lights || []).filter(real), speakers: (inv.speakers || []).filter(real), fans: (inv.fans || []).filter(real),
        // a switch in a room (a car's charging or an integration's own setting is not "on" in the house)
        switches: Object.keys(st).filter(function (id) { return dom(id) === 'switch' && areaOf(client, id) && !hid(id); }).sort()
      };
      var lists = { lights: all.lights.filter(is('on')), speakers: all.speakers.filter(is('playing')), fans: all.fans.filter(is('on')), switches: all.switches.filter(is('on')) };
      var short = window.hkStrategy && window.hkStrategy.shortName;
      var kinds = [], every = [], things = [];
      ON_KINDS.forEach(function (k) {
        var ids = lists[k.key];
        if (all[k.key].length) every.push({ kind: k, ids: ids, all: all[k.key] });
        if (!ids.length) return;
        kinds.push({ kind: k, ids: ids });
        ids.map(function (id) {
          var a = areaOf(client, id), room = a && areas[a] ? areas[a].name : '', full = (C.accName && C.accName(id)) || attr(st[id], 'friendly_name') || id;
          // the room's name off the front ("Kitchen Pendants" in the Kitchen), unless
          // all that is left is what it is ("Porch Light" stays itself)
          var name = short ? short(full, room) : full;
          if (/^(light|lights|lamp|fan|speaker|switch|plug)$/i.test(name)) name = full;
          var under = name === room ? '' : room;
          return { id: id, kind: k, name: name, room: k.key === 'speakers' ? (under ? under + ' · Playing' : 'Playing') : under, area: room };
        }).sort(function (x, y) { return (x.room + x.name).localeCompare(y.room + y.name); }).forEach(function (t) { things.push(t); });
      });
      return { kinds: kinds, every: every, things: things, n: things.length };
    }
    // WHAT A KIND'S TILE SAYS beyond its count (the owner: "more info for each category"): where (the rooms, or the
    // things' names where they have no room) and a level -- the lights' brightness, the fans' speed, what is playing
    function kindLines(client, x, things) {
      var st = (client && client.states) || {}, mine = things.filter(function (t) { return t.kind === x.kind; });
      if (!x.ids.length) return { detail: plural(x.all.length, x.kind.one, x.kind.many), extra: null };
      var where = [];
      mine.forEach(function (t) { var w = x.kind.key === 'switches' || !t.area ? t.name : t.area; if (where.indexOf(w) < 0) where.push(w); });
      var extra = null, level = null;
      if (x.kind.key === 'lights' || x.kind.key === 'fans') {
        var lv = x.ids.map(function (id) {
          var a = (st[id] && st[id].attributes) || {};
          return x.kind.key === 'lights' ? (typeof a.brightness === 'number' ? Math.round(a.brightness / 2.55) : null) : (typeof a.percentage === 'number' ? a.percentage : null);
        }).filter(function (n) { return n != null; });
        if (lv.length) {
          var avg = Math.round(lv.reduce(function (s, n) { return s + n; }, 0) / lv.length);
          extra = (x.kind.key === 'lights' ? 'Brightness ' : 'Speed ') + (lv.length > 1 ? 'about ' : '') + avg + '%';
          level = avg;
        }
      } else if (x.kind.key === 'speakers') {
        var a0 = (st[x.ids[0]] && st[x.ids[0]].attributes) || {};
        extra = [a0.media_title, a0.media_artist].filter(Boolean).join(' · ') || null;
      }
      return { detail: where.join(', ') || null, extra: extra, level: level };
    }
    var ON_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.wg{text-shadow:none}',
      '.none{' + type('body') + ';color:' + v('ink-2') + '}'
    ].join('');
    // THE PARTS, House Status's file (a lazy one): asked for once, the card drawn again when it is here
    function sumKit(card) {
      var T = window.hkHouseStatus && window.hkHouseStatus.tiles;
      if (T) {
        if (!card._kitCss) { card._kitCss = document.createElement('style'); card._kitCss.textContent = T.CSS; card.shadowRoot.appendChild(card._kitCss); }
        return T;
      }
      if (!card._kitWait && window.customElements) {
        card._kitWait = true;
        window.customElements.whenDefined('hk-house-status-card').then(function () { card._hkSig = null; card.redraw(); });
      }
      return null;
    }
    class HkOnNowCard extends HkBase {
      static get CSS() { return WG_CSS + ON_CSS; }
      getCardSize() { return 4; }
      // (the plate's tap, hk-base.js openTarget) what is on, as a sheet of those things; one thing, its own sheet;
      // nothing on, the first kind the house has, as its tile would open it
      _tapTarget() {
        var o = whatsOn(this.client), ids = o.things.map(function (t) { return t.id; });
        if (ids.length > 1) return [{ group: ['On Now', ids, { icon: 'mdi:power' }] }];
        if (ids.length) return [{ sheet: ids[0] }];
        var x = o.every[0];
        return x ? [{ page: x.kind.pages[0] }, { group: [cap(x.kind.many), x.all.slice(), { icon: x.kind.icon }] }] : [];
      }
      _sigOf() {
        var o = whatsOn(this.client), st = (this.client && this.client.states) || {};
        return JSON.stringify([o.every.map(function (x) { return x.kind.key + x.all.length; }), o.things.map(function (t) { return t.id + (st[t.id] ? st[t.id].last_updated : ''); }),
                               sizeOf(this), this._blockKey || '', !!(window.hkHouseStatus && window.hkHouseStatus.tiles)]);
      }
      _render() {
        var self = this;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="wg" data-hk-role="card" role="group" aria-label="On now"></hk-plate>';
          this._plate = this._root.querySelector('hk-plate');
          this._plate.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button');
            if (!b) return;
            e.stopPropagation();
            if (b.hasAttribute('data-open-kind')) { self._openKind(b.getAttribute('data-open-kind')); return; }
            if (b.hasAttribute('data-open-all')) { C.openTarget(self, self._tapTarget()); return; }
            self._off(b.getAttribute('data-off'), b.getAttribute('data-off-kind'), b.hasAttribute('data-all'));
          });
          this._built = true;
        }
        var T = sumKit(this), size = sizeOf(this) || 'L', o = whatsOn(this.client);
        if (!T) { C.morph(this._plate, '<div class="sm-h"><div class="sm-l">On Now</div></div>'); return; }
        var box = inner(this, size), P = T.plan(size, box.iw, box.ih, o.every.length, {}), rich = size === 'L' || size === 'XL';
        var phrase = function (list) {
          var w = list.map(function (x) { return plural(x.ids.length, x.kind.one, x.kind.many); });
          return w.length > 1 ? w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1] : w.join('');
        };
        // All Off: the label row's key; Wide's and Extra Large's at the foot of the headline's column, a finger tall
        var all = function (cls) { return o.n ? '<button type="button" class="sm-k' + cls + '" data-all aria-label="' + esc('Turn off all ' + o.n + ' things on') + '">All Off</button>' : ''; };
        var model = {
          label: 'On Now', key: size === 'XL' ? '' : all(''), side: all(' f'), // (Wide: the kinds as their discs with the counts under them, the Batteries widget's way -- drawn both ways on
          // 2026-11-08, the lines two across cut "Speakers" and "Switches" to "Spe..." and "S...")
          discs: size === 'S' || size === 'W',
          // the headline: the count on, or, quiet, a calm All Off said once
          head: o.n ? { num: o.n, unit: 'On' } : { words: 'All Off' },
          // (quiet, Extra Large's column says so under All Off, over the kinds' discs at rest)
          sentence: o.n ? esc(phrase(o.kinds)) : size === 'XL' ? 'Nothing is on' : '', restDiscs: !o.n && size === 'XL',
          small: { attrs: 'data-open-all', aria: o.n ? 'On now: ' + phrase(o.kinds) : 'On now: all off' },
          rows: o.every.map(function (x) {
            var on = x.ids.length, ln = kindLines(self.client, x, o.things), many = cap(x.kind.many);
            // (Large and Extra Large say more: where, and how bright, how fast, or what is playing)
            var detail = on ? (rich && ln.extra && x.kind.key !== 'lights' ? [ln.detail, ln.extra].filter(Boolean).join(' · ') : ln.detail) : ln.detail;
            return { live: true, rest: !on, attrs: 'data-open-kind="' + x.kind.key + '"', name: many, count: on || x.kind.rest,
              icon: function (px, col) { return gly(x.kind.icon, px, col || null); }, lit: on ? x.kind.color : null,
              aria: 'Open ' + (on ? plural(on, x.kind.one, x.kind.many) + (x.kind.key === 'speakers' ? ' playing' : ' on') : many + ', ' + x.kind.rest.toLowerCase()),
              reading: on ? String(on) : x.kind.rest, detail: detail, level: rich && on && x.kind.key === 'lights' ? ln.level : null };
          }) };
        C.morph(this._plate, o.every.length || size === 'S' ? T.compose(model, size, box, P) : '<div class="sm-h"><div class="sm-l">On Now</div></div><div class="none" style="margin:auto">Nothing to show</div>');
      }
      // A KIND'S TAP (`open`): its page, where the screen has one and the block says so; else its sheet -- the things
      // of that kind that are on ("Lights On", "Fans On", "Speakers Playing", "Switches On"), none on, all of them; one
      // thing, its own sheet
      _openKind(key) {
        var x = whatsOn(this.client).every.filter(function (k) { return k.kind.key === key; })[0], D = window.hkDetail, M = C.menu;
        if (!x) return;
        if ((this._config || {}).open === 'page' && M && M.pagePath) {
          for (var i = 0; i < x.kind.pages.length; i++) {
            var path = M.pagePath(x.kind.pages[i]);
            if (path) { C.navigate(path, this); return; }
          }
        }
        var ids = x.ids.length ? x.ids : x.all;
        if (ids.length === 1) { window.hkShell.moreInfo(ids[0], this); return; }
        if (D && D.openGroup) D.openGroup(x.ids.length ? x.kind.title : cap(x.kind.many), ids.slice(), { icon: x.kind.icon });
      }
      // OFF: one thing, a kind, or everything on -- one call per kind, the
      // room pages' own commands (HkBase._call: the host's action port)
      _off(id, kindKey, everything) {
        var o = whatsOn(this.client), self = this;
        var groups = everything ? o.kinds : o.kinds.filter(function (x) { return x.kind.key === kindKey; });
        if (id) {
          var t = o.things.filter(function (x) { return x.id === id; })[0];
          groups = t ? [{ kind: t.kind, ids: [id] }] : [];
        }
        groups.forEach(function (x) { self._call(x.kind.call[0], x.kind.call[1], { entity_id: x.ids.length === 1 ? x.ids[0] : x.ids.slice() }); });
      }
    }

    // what the shell and the later parts use of this one
    K.ACTION_OPTIONS = ACTION_OPTIONS; K.actionHex = actionHex; K.HkActionCard = HkActionCard;
    K.HkEverythingCard = HkEverythingCard; K.HkOnNowCard = HkOnNowCard; K.HkSuggestedSceneCard = HkSuggestedSceneCard;
    K.menuItems = menuItems; K.onNow = onNow; K.whatsOn = whatsOn;
  };
})();
