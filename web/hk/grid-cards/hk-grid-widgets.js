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
    // gradient as Small has it. The Centred rules (hkCards.centredTile, all !important) are outvoted by longer selectors.
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
      return pages.concat(rooms);
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
      '.evh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;min-width:0}',
      '.evh b{' + type('headline') + ';white-space:nowrap}',
      '.evh span{' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.apps{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--c),minmax(0,1fr));column-gap:8px;row-gap:var(--rg);',
      '  justify-items:center;align-content:center;padding-top:10px}',
      '.app{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;max-width:100%;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.app i{display:flex;align-items:center;justify-content:center;flex:none;width:var(--px);height:var(--px);border-radius:' + APP_CORNER + ';color:#fff;font-style:normal;',
      '  box-shadow:0 4px 10px rgba(0,0,0,0.22);transition:transform ' + C.DUR.press + ' ease}',
      '.app i hk-icon{width:calc(var(--px) * 0.53);height:calc(var(--px) * 0.53);--mdc-icon-size:100%;display:flex;color:#fff}',
      '.app:active i{transform:scale(0.94)}',
      '.app:focus-visible i{outline:2px solid ' + v('ink-2') + ';outline-offset:3px}',
      '.app small{' + type('micro') + ';line-height:14px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:' + v('glow') + '}',
      '.app.mo i{background:rgba(255,255,255,0.2);' + type('headline') + '}',
      '@media (prefers-reduced-motion:reduce){.app i{transition:none}.app:active i{transform:none}}'
    ].join('');
    class HkEverythingCard extends HkGridKey {
      static get CSS() { return KEY_CSS + EV_CSS; }
      _size() { return sizeOf(this) || 'S'; }
      _items() { return menuItems(this.client) || []; }
      _sigOf() {
        return JSON.stringify([this._items().map(function (x) { return x.path; }), onNow(this.client), this._size(), this._blockKey || '',
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
        var box = inner(this, size), rg = size === 'W' ? 0 : 12, free = box.ih - 22 - 10, lab = labels ? 20 : 0;
        if (!rows) rows = Math.max(2, Math.min(6, Math.floor((free + rg) / (48 + lab + rg))));
        var px = Math.max(36, Math.min(labels ? 62 : 60, Math.floor((box.iw - (cols - 1) * 8) / cols) - (labels ? 6 : 0),
                                      Math.floor((free - (rows - 1) * rg) / rows) - lab));
        if (this._mode !== size || !this._built) {
          this._mode = size;
          this._root.innerHTML = '<hk-plate class="ev" data-hk-role="card"><div class="evh"><b>Everything</b><span></span></div><div class="apps" role="list"></div></hk-plate>';
          this._ev = { card: this._root.querySelector('.ev'), say: this._root.querySelector('.evh span'), apps: this._root.querySelector('.apps') };
          this._appKey = null;
          this._built = true;
        }
        var e = this._ev, said = onNowText(onNow(this.client));
        if (e.say.textContent !== said) e.say.textContent = said;
        e.apps.style.setProperty('--c', String(cols));
        e.apps.style.setProperty('--px', px + 'px');
        e.apps.style.setProperty('--rg', rg + 'px');
        var places = cols * rows, cut = items.length > places, shown = cut ? items.slice(0, places - 1) : items;
        var key = JSON.stringify([shown, cut ? items.length - shown.length : 0, labels]);
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
          m.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
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
      '.lb{' + C.labelCss('label') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.nm{' + type('title') + ';line-height:26px;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cap{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // the art is lit: its words keep the dark plate's white on a light page
      'hk-plate.sg.lit{' + C.LIGHT_OFF + '}',
      'hk-plate.sg.lit .tx{text-shadow:' + v('glow') + '}',
      // L, and T (2026-11-07, the review: Large's composition at 1 x 2): the glyph at the top, the words at the bottom
      ':host([size="L"]) hk-plate.sg,:host([size="T"]) hk-plate.sg{flex-direction:column;align-items:flex-start;justify-content:space-between}',
      ':host([size="L"]) .well,:host([size="T"]) .well{width:64px;height:64px}',
      // S (2026-11-07, the review): the scene as one tile -- its glyph bare, its name, and its time of day (the label) as the
      // second line, nothing else. Centred: HomeView's (hkCards.centredTile over the card's own parts); Home: the glyph at
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
    // each kind in its color. Off and All Off are house commands through the
    // card's action port, as the room pages' toggles are (a speaker pauses).
    //   S       the count large, and what it is
    //   W       each kind a chip: its body opens that kind's sheet, its own small Off key turns that kind off
    //   T       each kind with its count, a 44 px button that opens that kind's sheet, and All Off
    //   L, XL   each thing that is on, its row opening that thing's sheet, its own Off, "+N more", All Off
    //           (XL the count in a column of its own beside them)
    // TAP ZONES (2026-11-07, the review; the owner: "lights and fans should go to lights or to fans depending on which
    // one you tap"): a kind and a thing are buttons (hk-base.js TAP_CONTROLS), so the plate's own tap -- the On Now
    // sheet -- is left for the heading and the glass between them.
    // The house's own lists (Status & Chips, hkStrategy.inventory) less what
    // it hides; a group light is its lights, never counted twice.
    var ON_KINDS = [
      { key: 'lights', one: 'light', many: 'lights', icon: 'mdi:lightbulb', color: ACC.yellow, call: ['light', 'turn_off'], off: 'Off', title: 'Lights On' },
      { key: 'speakers', one: 'speaker', many: 'speakers', icon: 'mdi:speaker', color: ACC.pink, call: ['media_player', 'media_pause'], off: 'Pause', title: 'Speakers Playing' },
      { key: 'fans', one: 'fan', many: 'fans', icon: 'mdi:fan', color: ACC.cyan, call: ['fan', 'turn_off'], off: 'Off', title: 'Fans On' },
      { key: 'switches', one: 'switch', many: 'switches', icon: 'mdi:power-plug', color: ACC.green, call: ['switch', 'turn_off'], off: 'Off', title: 'Switches On' }
    ];
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    // -> [{kind, ids}] of the kinds with something on, and [{id, kind, name, room}] each thing
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
      var is = function (state) { return function (id) { return st[id] && st[id].state === state && !isGroup(st[id]); }; };
      var lists = {
        lights: (inv.lights || []).filter(is('on')),
        speakers: (inv.speakers || []).filter(is('playing')),
        fans: (inv.fans || []).filter(is('on')),
        // a switch in a room (a car's charging or an integration's own setting is not "on" in the house)
        switches: Object.keys(st).filter(function (id) { return dom(id) === 'switch' && st[id].state === 'on' && areaOf(client, id) && !hid(id); }).sort()
      };
      var short = window.hkStrategy && window.hkStrategy.shortName;
      var kinds = [], things = [];
      ON_KINDS.forEach(function (k) {
        var ids = lists[k.key];
        if (!ids.length) return;
        kinds.push({ kind: k, ids: ids });
        ids.map(function (id) {
          var a = areaOf(client, id), room = a && areas[a] ? areas[a].name : '', full = (C.accName && C.accName(id)) || attr(st[id], 'friendly_name') || id;
          // the room's name off the front ("Kitchen Pendants" in the Kitchen), unless
          // all that is left is what it is ("Porch Light" stays itself)
          var name = short ? short(full, room) : full;
          if (/^(light|lights|lamp|fan|speaker|switch|plug)$/i.test(name)) name = full;
          var under = name === room ? '' : room;
          return { id: id, kind: k, name: name, room: k.key === 'speakers' ? (under ? under + ' · Playing' : 'Playing') : under };
        }).sort(function (x, y) { return (x.room + x.name).localeCompare(y.room + y.name); }).forEach(function (t) { things.push(t); });
      });
      return { kinds: kinds, things: things, n: things.length };
    }
    var ON_CSS = [
      ':host{display:block;height:100%}',
      '.ws.wrap{white-space:normal}',
      // the controls: a chip per kind, Off per thing, All Off -- 44 px each
      '.on-b{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px;cursor:pointer;',
      '  border-radius:22px;background:' + v('key') + ';color:' + v('ink') + ';' + type('caption') + ';font-weight:600;-webkit-tap-highlight-color:transparent}',
      '.on-b:active{filter:brightness(0.9)}.on-b:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.on-b.all{' + type('body') + ';font-weight:600;padding:0 22px}',
      '.chips{display:grid;gap:4px;align-content:center;min-width:0}',
      // (W: a chip is its body -- the kind's sheet -- and, at its end, a small Off key with a 44 px hit area)
      '.on-c{display:flex;align-items:center;min-width:0;min-height:44px;border-radius:22px;background:' + v('key') + '}',
      '.on-o,.on-k,.on-t{all:unset;box-sizing:border-box;display:flex;align-items:center;min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent;color:' + v('ink') + '}',
      '.on-o{flex:1;gap:6px;height:44px;padding:0 4px 0 12px;' + type('caption') + ';font-weight:600}',
      '.on-o span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.on-z{all:unset;position:relative;box-sizing:border-box;flex:none;display:grid;place-items:center;height:32px;margin-right:6px;padding:0 12px;border-radius:16px;',
      '  background:' + v('key-strong') + ';color:' + v('ink') + ';' + type('caption') + ';font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.on-z::after{content:"";position:absolute;left:-5px;right:-5px;top:-6px;bottom:-6px}',
      '.on-o:active,.on-k:active,.on-t:active{opacity:.7}.on-z:active{filter:brightness(0.9)}',
      '.on-o:focus-visible,.on-k:focus-visible,.on-t:focus-visible,.on-z:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      // (T: a kind's row, 44 px, the count at its end)
      '.on-k{gap:10px;height:44px;flex:none;border-bottom:1px solid ' + v('line') + '}',
      '.on-k:last-child{border-bottom:0}',
      // (Tall: the kinds share the height the count and All Off leave, each up to 60 px -- 2026-11-07, the review: three rows under the count left a band of bare plate over All Off)
      '.wr.ok{flex:1;min-height:0;justify-content:center}.wr.ok .on-k{flex:1 1 0;min-height:44px;max-height:60px}',
      '.on-k b{' + type('body') + ';font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.on-k em{font-style:normal;' + type('caption') + ';color:' + v('ink-2') + '}',
      '.on-l{display:flex;flex-direction:column;min-height:0}',
      // (L, XL: a thing's row, its body a button to its sheet, its Off beside it)
      '.on-l>div{display:flex;align-items:center;gap:10px;box-sizing:border-box;height:48px;flex:none;border-bottom:1px solid ' + v('line') + '}',
      '.on-l>div:last-child{border-bottom:0}',
      '.on-t{flex:1;gap:10px;height:100%}',
      '.on-l .tx{flex:1;min-width:0;display:flex;flex-direction:column;text-align:left}',
      '.on-l .tx b{' + type('body') + ';font-weight:600;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.on-l .tx small{' + type('caption') + ';line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.on-l .on-b{padding:0 12px;flex:none}',
      '.on-hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none}',
      '.on-ft{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:8px;flex:none}',
      '.on-x{display:flex;gap:22px;flex:1;min-height:0}.on-x>.wcol:last-child{flex:1}',
      '.none{' + type('body') + ';color:' + v('ink-2') + '}'
    ].join('');
    class HkOnNowCard extends HkBase {
      static get CSS() { return WG_CSS + ON_CSS; }
      getCardSize() { return 4; }
      // (the plate's tap, hk-base.js openTarget) what is on, as a sheet of those things; one thing, its own sheet
      _tapTarget() {
        var ids = whatsOn(this.client).things.map(function (t) { return t.id; });
        return ids.length > 1 ? [{ group: ['On Now', ids, { icon: 'mdi:power' }] }] : ids.length ? [{ sheet: ids[0] }] : [];
      }
      _sigOf() {
        var o = whatsOn(this.client), st = (this.client && this.client.states) || {};
        return JSON.stringify([o.things.map(function (t) { return t.id + (st[t.id] ? st[t.id].last_updated : ''); }), sizeOf(this), this._blockKey || '']);
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
            if (b.hasAttribute('data-open-thing')) { window.hkShell.moreInfo(b.getAttribute('data-open-thing'), self); return; }
            self._off(b.getAttribute('data-off'), b.getAttribute('data-off-kind'), b.hasAttribute('data-all'));
          });
          this._built = true;
        }
        var size = sizeOf(this) || 'L', box = inner(this, size), o = whatsOn(this.client);
        var lab = '<div class="wl" style="color:' + ACC.orange + '">On Now</div>';
        var all = o.n ? '<button type="button" class="on-b all" data-all>All Off</button>' : '';
        var thing = function (t) {
          return '<div><button type="button" class="on-t" data-open-thing="' + esc(t.id) + '" aria-label="' + esc('Open ' + t.name) + '">' + gly(t.kind.icon, 20, t.kind.color) +
            '<span class="tx"><b>' + esc(t.name) + '</b>' + (t.room ? '<small>' + esc(t.room) + '</small>' : '') + '</span></button>' +
            '<button type="button" class="on-b" data-off="' + esc(t.id) + '" aria-label="' + esc(t.kind.off + ' ' + t.name) + '">' + t.kind.off + '</button></div>';
        };
        // as many things as fit in `room` px (rows of 48): the rest are "+N more"
        var list = function (room) {
          var fit = Math.max(1, Math.floor(room / 48)), shown = o.things.slice(0, fit);
          return { html: '<div class="on-l">' + shown.map(thing).join('') + '</div>', more: o.n - shown.length };
        };
        var html;
        if (size === 'S') {
          var first = o.kinds[0], rest = o.kinds.slice(1);
          html = lab + '<div class="wb xl">' + o.n + '</div><div class="ws wf wrap">' + (o.n ? esc(plural(first.ids.length, first.kind.one, first.kind.many)) +
            (rest.length ? '<br>' + esc(rest.map(function (x) { return plural(x.ids.length, x.kind.one, x.kind.many); }).join(' · ')) : '') : 'Nothing on') + '</div>';
        } else if (size === 'W') {
          var rows = Math.max(1, Math.floor((box.ih + 4) / 48)), two = o.kinds.length > rows;
          html = '<div class="wsplit"><div class="wcol" style="flex:0 0 ' + (two ? 90 : 120) + 'px">' + lab + '<div class="wb xl">' + o.n + '</div></div>' +
            (o.n ? '<div class="chips" style="grid-template-columns:repeat(' + (two ? 2 : 1) + ',minmax(0,1fr))">' + o.kinds.map(function (x) {
              var many = plural(x.ids.length, x.kind.one, x.kind.many);
              return '<div class="on-c"><button type="button" class="on-o" data-open-kind="' + x.kind.key + '" aria-label="' + esc('Open ' + many) + '">' +
                // (two across, on a tile cell: the glyph says what, the number how many)
                gly(x.kind.icon, 18, x.kind.color) + '<span>' + esc(two ? String(x.ids.length) : plural(x.ids.length, cap(x.kind.one), cap(x.kind.many))) + '</span></button>' +
                '<button type="button" class="on-z" data-off-kind="' + x.kind.key + '" aria-label="' + esc(x.kind.off + ' ' + many) + '">' + x.kind.off + '</button></div>';
            }).join('') + '</div>' : '<div class="wcol" style="justify-content:center"><div class="none">Nothing is on</div></div>') + '</div>';
        } else if (size === 'T') {
          // the count takes what its rows (44 px each) and All Off leave: the large figure, else the hero's 44
          var room = box.ih - 19 - 6 - 52 - o.kinds.length * 44;
          html = lab + '<div class="wb' + (room >= 76 ? ' xl' : '') + '">' + o.n + '</div>' +
            (o.n ? '<div class="wr ok" style="margin-top:6px">' + o.kinds.map(function (x) {
              return '<button type="button" class="on-k" data-open-kind="' + x.kind.key + '" aria-label="' + esc('Open ' + plural(x.ids.length, x.kind.one, x.kind.many)) + '">' +
                gly(x.kind.icon, 20, x.kind.color) + '<b>' + esc(cap(x.kind.many)) + '</b><em>' + x.ids.length + '</em></button>';
            }).join('') + '</div>' : '<div class="none">Nothing is on</div>') +
            '<div class="on-ft">' + all.replace('class="on-b all"', 'class="on-b all" style="flex:1"') + '</div>';
        } else if (size === 'L') {
          var l = list(box.ih - 19 - 6 - 52);
          html = '<div class="on-hd">' + lab + '<span class="ws">' + o.n + ' on</span></div>' +
            (o.n ? l.html : '<div class="none" style="margin:auto">Nothing is on</div>') +
            '<div class="on-ft"><span class="ws">' + (l.more ? '+' + l.more + ' more' : '') + '</span>' + all + '</div>';
        } else {
          var x2 = list(box.ih - (o.n > Math.floor(box.ih / 48) ? 24 : 0));
          html = '<div class="on-x"><div class="wcol" style="flex:0 0 150px">' + lab + '<div class="wb xl">' + o.n + '</div>' +
            '<div class="ws wrap">' + (o.n ? o.kinds.map(function (x) { return esc(plural(x.ids.length, x.kind.one, x.kind.many)); }).join('<br>') : 'Nothing on') + '</div><div class="wf">' + all.replace('class="on-b all"', 'class="on-b all" style="width:100%"') + '</div></div>' +
            '<div class="wcol">' + (o.n ? x2.html + (x2.more ? '<div class="ws" style="margin-top:4px">+' + x2.more + ' more</div>' : '') : '<div class="none" style="margin:auto">Nothing is on</div>') + '</div></div>';
        }
        C.morph(this._plate, html);
      }
      // A KIND'S SHEET: the things of that kind that are on ("Lights On", "Fans On", "Speakers Playing", "Switches On"); one
      // thing, its own sheet
      _openKind(key) {
        var x = whatsOn(this.client).kinds.filter(function (k) { return k.kind.key === key; })[0], D = window.hkDetail;
        if (!x) return;
        if (x.ids.length === 1) { window.hkShell.moreInfo(x.ids[0], this); return; }
        if (D && D.openGroup) D.openGroup(x.kind.title, x.ids.slice(), { icon: x.kind.icon });
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
