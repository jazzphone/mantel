// hk-chip-scenes.js - the scenes row.
//
// PART OF THE CHIP CARDS (hk-chip.js). Not a card and not run on its own: it registers one
// function, which hk-chip.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkChipParts = window.hkChipParts || {})['hk-chip-scenes'] = function (K) {
    var accOf = K.accOf, C0 = K.C0, icEntry = K.icEntry, ICON_INTERCOM = K.ICON_INTERCOM, icWatch = K.icWatch,
        KIND_NAMES = K.KIND_NAMES, KIND_ORDER = K.KIND_ORDER, S = K.S, SCENE_ICON = K.SCENE_ICON,
        sceneTap = K.sceneTap;

    // between a Home Grid block's scenes (the widget mock-up's tight grid, 2026-10-31)
    var BLOCK_GAP = 8;
    function scenePill(client, id, look) {
      var st = client && client.states[id], ent = client && client.entities && client.entities[id];
      var a = (st && st.attributes) || {};
      // its accessory's name, glyph and colour (the gear) before its own
      var own = accOf(id);
      var pill = { type: 'custom:hk-scene-card', elevated: true, entity: id,
                   name: own.name || a.friendly_name || id,
                   icon: (own.icon && (/^mdi:/.test(own.icon) ? 'hk:' + own.icon.slice(4) : own.icon)) ||
                         (ent && ent.icon) || a.icon || SCENE_ICON[id.split('.')[0]] || 'mdi:circle-outline',
                   icon_color: own.color || 'white', tap_action: sceneTap(id) };
      return Object.assign(pill, look || {});
    }
    // A PILL THAT OPENS A PAGE (Home -> Scenes -> Pills that open a page): the
    // house's Live TV / Apple Music / Cameras pills, as settings. Its page on
    // this dashboard (the first of these paths it has), or no pill.
    var PAGE_PILLS = {
      weather: ['Weather', 'hk:weather-partly-cloudy', 'white', ['weather']],
      calendar: ['Calendar', 'mdi:calendar-month', 'white', ['calendar']],
      cameras: ['Cameras', 'hk:camera', 'white', ['cameras']],
      live_tv: ['Live TV', 'hk:television', 'white', ['live-tv']],
      security: ['Security', 'hk:shield-lock', 'white', ['security', 'alarm']],
      doors_windows: ['Doors & Windows', 'hk:door-closed-lock', 'white', ['doors-windows', 'doors', 'security']],
      climate: ['Climate', 'hk:thermostat', 'white', ['climate']],
      lights: ['Lights', 'hk:lightbulb', 'white', ['lights']],
      timers: ['Timers', 'hk:timer-sand', 'white', ['timers']],
      vacuums: ['Vacuums', 'hk:robot-vacuum', 'white', ['vacuums']],
      music: ['Music', 'hk:music', 'white', ['playmusic']],
      water: ['Water', 'hk:water', 'white', ['water']],
      // the Energy feature's page: drawn only where the screen has it (the
      // feature added, the page on its Pages)
      energy: ['Energy', 'mdi:lightning-bolt', 'white', ['energy']],
      // the House Timeline (a host that has one lists the page: hkShell.hostPage)
      timeline: ['Timeline', 'mdi:history', 'white', ['timeline']]
    };
    function pagePill(key, client) {
      // THE INTERCOM (More, on a screen's Scenes): its pill opens the sheet, and is there only where the chip would be
      if (key === 'intercom') {
        return icEntry(client) ? { type: 'custom:hk-scene-card', elevated: true, name: 'Intercom', icon: ICON_INTERCOM, icon_color: 'white',
                                   tap_action: { action: 'intercom' } } : null;
      }
      var p = PAGE_PILLS[key];
      if (!p) return null;
      var M = C0().menu, cfg = M && M.config ? M.config() : null, path = null;
      if (!cfg || !Array.isArray(cfg.views)) path = p[3][0];               // an editor preview
      else {
        for (var i = 0; i < p[3].length && !path; i++) {
          for (var j = 0; j < cfg.views.length; j++) {
            if (cfg.views[j] && cfg.views[j].path === p[3][i]) { path = p[3][i]; break; }
          }
        }
      }
      if (!path) return null;
      // the house's look for this pill (HK Settings, a screen's Scenes)
      var lk = (S('look.page_pills', null) || {})[key] || {};
      return { type: 'custom:hk-scene-card', elevated: true, name: lk.name || p[0], icon: lk.icon || p[1],
               icon_color: lk.color || p[2],
               tap_action: { action: 'navigate', navigation_path: './' + path } };
    }
    // THE GROUP'S TILES (2026-11-08, round three, the owner: "entities in a card should maintain dimensions"): the tile grid of a
    // Scenes, Accessories or Room block, DESIGNED per block size and cell shape -- columns x rows and one tile size, a number of
    // its own, never the block's room divided by the count (that stretched three tiles to 311 px, and spanned the last one).
    // Square cells (HomeView, 196 x 196, inset 18, tiles 10 apart) and tile cells (196 x 150, inset 14, 8 apart) each have
    // theirs; a bigger block shows more tiles. Each size's tile is what its full count of tiles fills (a Large block's four
    // 183 x 137 on a tile cell), so the full block is as it was and a short one is the same tiles, centered.
    //   o.head  what the block keeps above its tiles (a Room's heading and its gap); o.foot what it keeps below (its dots)
    //   o.pill  the Home app's pill, 70 px, as many rows as the block holds (Half) -- else the tall tile, two rows (one at Wide)
    // -> { sq, cols, rows, n (the places), tw, th, gap }; `el` says the cell shape: the grid's --hk-cell-h (196 on square cells)
    // (Small, 2026-11-08, the owner: "an Accessories Group card in the Small size ... 2 half height pills": one place, or its pills' rows)
    var GROUP_COLS = { S: 1, W: 2, T: 1, L: 2, XL: 3, XXL: 6 }, GROUP_ROWS = { S: 1, W: 1, T: 2, L: 2, XL: 2, XXL: 2 };
    // (the heading above the tiles of Scenes and Accessories: the label's row as drawn -- its 16 px line and the name's 1 + 2 px
    // padding, 19 (2026-11-08: at 16 the tiles came 3 px too tall and took it from the bottom margin) -- and its 8 px gap)
    var GROUP_HEAD = 27;
    // (out of the document -- a page held while another shows, its cards still fed -- it has no style to read: the shape it
    // last read in place, which a page put away cannot change. Read as tiles, a Kitchen group drew its two pills in one
    // column, and showed them so on the way back Home -- the owner's recording, 2026-11-08)
    function cellSquare(el) {
      if (el && el.isConnected === false && el.__hkSq !== undefined) return el.__hkSq;
      var h = 0;
      try { h = parseFloat(getComputedStyle(el).getPropertyValue('--hk-cell-h')); } catch (e) { h = 0; }
      if (el && el.isConnected) el.__hkSq = h >= 180;
      return h >= 180;
    }
    var PILL_MIN = 56, PILL_MAX = 82;      // the shortest a half pill may be (its 36 px glyph circle and two lines with their inset), and the tallest
    function groupGeom(el, size, o) {
      o = o || {};
      var T = C0().TILE, G = C0().HOME_GRID, sq = cellSquare(el), cw = T.w, ch = sq ? G.square.h : T.tall;
      // (the tiles on the shape inset -- 13 on a square cell, the grid's gap, their corners 34 - 13; a heading and the dots keep the
      // text's 18: 5 more each -- 2026-11-08, the owner: "this looks a lot better", "make sure [the headings don't shift]")
      var g = sq ? G.square.gap : G.gap, pad = sq ? 13 : 14, gap = sq ? 10 : 8, tin = sq ? 5 : 0;
      var c = GROUP_COLS[size] || 2, r = GROUP_ROWS[size] || 1;
      // (the plate's own 1 px edge is inside the block: 2 px less each way)
      var W = c * cw + (c - 1) * g - 2 * pad - 2, H = r * ch + (r - 1) * g - 2 * pad - 2 - (o.head ? o.head + tin : 0) - (o.foot ? o.foot + tin : 0);
      // HALF PILLS (the Home app's 70 px; 2026-11-08, the owner: a Wide block of four showed one row of two): as many
      // 70 px rows as fit -- but where that leaves one row and two fit at PILL_MIN, two rows of the height that fills
      // the room: still a designed size (the block's, never the count's or a measure), the second row not lost
      var rows = o.pill ? Math.max(1, Math.floor((H + gap) / (T.h + gap)), Math.min(2, Math.floor((H + gap) / (PILL_MIN + gap)))) : r;
      // (and up to PILL_MAX where that leaves the block's margins equal all round -- 2026-11-08, the owner: the pills sat 23 px from the
      // top and bottom, 19 from the sides; still the block size's design, never the count's)
      var th = o.pill ? Math.min(PILL_MAX, Math.floor((H - (rows - 1) * gap) / rows)) : Math.floor((H - (rows - 1) * gap) / rows);
      return { sq: sq, cols: c, rows: rows, n: c * rows, tw: Math.floor((W - (c - 1) * gap) / c), th: th, gap: gap };
    }
    function scenesPlan(cfg, b, client, away) {
      b = b || {};
      var T = C0().TILE;
      // A ROOM'S ROW (`room: true`, a room page's): exactly the scenes it was
      // given -- never the screen's Home row, its switch or its page pills
      if (cfg.room) b = { scenes: [], scenes_pages: [] };
      var show = (cfg.room || b.scenes_row !== false) && cfg.show !== false;
      var ids = (Array.isArray(b.scenes) && b.scenes.length) ? b.scenes
              : (Array.isArray(cfg.scenes) && cfg.scenes.length) ? cfg.scenes : null;
      if (cfg.room && !ids) return { auto: false, config: null };
      var auto = !ids;
      if (auto) {
        var st = (client && client.states) || {}, ents = (client && client.entities) || {};
        ids = Object.keys(st).filter(function (id) {
          return id.indexOf('scene.') === 0 && !(ents[id] && (ents[id].hidden || ents[id].entity_category));
        }).sort(function (x, y) {
          return String(st[x].attributes.friendly_name || x).localeCompare(String(st[y].attributes.friendly_name || y));
        });
      }
      var looks = cfg.looks || {};
      // An entry may be a whole card (a pill that opens a page and runs
      // nothing, like Live TV): used as it is.
      // A PILL THAT OPENS A PAGE: scenes_pages says which, and the scenes list
      // may place one among the scenes as "page:<kind>" (Order -> Scenes);
      // one not placed follows the scenes.
      var pages = Array.isArray(b.scenes_pages) ? b.scenes_pages : [];
      var placed = {};
      var pills = [];
      ids.forEach(function (id) {
        if (typeof id === 'object') { pills.push(id); return; }
        if (String(id).indexOf('page:') === 0) {
          var k = id.slice(5);
          if (pages.indexOf(k) < 0 || placed[k]) return;
          placed[k] = true;
          var p = pagePill(k, client);
          if (p) pills.push(p);
          return;
        }
        if (!client || client.states[id]) pills.push(scenePill(client, id, looks[id]));
      });
      pages.forEach(function (k) {
        if (placed[k]) return;
        var pp = pagePill(k, client);
        if (pp) pills.push(pp);
      });
      // (a Home Grid block with no scene to show is not gone: a plate that says so -- 2026-11-08, every state finished)
      if (show && !pills.length && cfg.hk_cell && C0().HOME_GRID.sizes[cfg.hk_cell] && !cfg.room) {
        return { auto: auto, config: { hk_cell: cfg.hk_cell, name: cfg.name || 'Scenes', surface: cfg.surface, half: false, color: false, pills: [] } };
      }
      if (!show || !pills.length) return { auto: auto, config: null };
      // ON A HOME GRID (docs/phase11/HOME-GRID.md): the block draws a designed grid of scene tiles (groupGeom: W two,
      // L four, XL six, the Half pills as many rows as the cell shape holds) -- each a scene tile of a fixed size, no
      // heading: the block is the scenes. The plan keeps every scene; `_grid` says how many show, and the last place
      // says "N more" when there are more (2026-11-08). (More scenes are the pager's pages, G4.)
      var cell = cfg.hk_cell && C0().HOME_GRID.sizes[cfg.hk_cell];
      // HEIGHT AND COLOR (2026-10-31, the owner's notes on the widget mock-up:
      // "Height Full or Half, Color on or off, on any style of dashboard"):
      // Full, a scene a cell -- W two, L four, XL six; Half, the shorter button,
      // the Home app's 70 px pill in the rows the block holds.
      if (cell) {
        return { auto: auto, config: { hk_cell: cfg.hk_cell, name: cfg.name || 'Scenes', surface: cfg.surface, half: cfg.height === 'half', color: !!cfg.color, pills: pills } };
      }
      return { auto: auto, config: { type: 'grid', columns: 1, square: false, cards: [
        { type: 'custom:hk-heading-card', name: cfg.name || 'Scenes' },
        { type: 'custom:hk-grid-card',
          layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': '114px', 'grid-auto-flow': 'row',
                    'grid-column-gap': '12px', 'grid-row-gap': '12px',
                    margin: away ? '-14px 0px -7px 0px' : '-14px -22px -7px -22px', padding: '0px' },
          // the pills' own width and gap (hk-base.js TILE), so the scenes line
          // up with the grids below; on a phone, half the row each (a grid's
          // 2-up track: half its width less half the gap, plus the 4 px of
          // grid-child margin the row has instead of a cell)
          cards: [{ type: 'custom:hk-row-card', card_width: 'var(--hk-pill, ' + T.w + 'px)', gap: T.gridGap,
                    pad_top: 14, pad_bottom: 30, pad_left: away ? 0 : 22, pad_right: away ? 0 : 22,
                    phone_card_width: 'calc((100% - ' + T.gridGap + 'px) / 2 + 4px)', phone_gap: T.gridGap + 'px', cards: pills }] }] } };
    }
    // A SCENE AS A BLOCK'S TILE (the plan's Height and Color): Full Centred,
    // "Scene" under its name; Half the pill. (The tile's own `tile`: a pill
    // outside a block answers the screen's Tile Style itself.)
    function blockPill(pill, plan) {
      return Object.assign({}, pill, plan.half ? { size: 'regular', tile: 'home' } : Object.assign({ tile: 'centred' }, pill.entity ? { room: 'Scene' } : {}),
                           plan.color ? { block_color: true } : {});
    }
    class HkScenesCard extends HTMLElement {
      constructor() {
        super();
        var self = this;
        this._key = null;
        this._wake = function () { self._plan(); };
      }
      setConfig(config) { this._cfgIn = Object.assign({}, config || {}); this._key = null; this._plan(); }
      // a Home Grid block's size (hk-home-grid-view sets it): planned again
      static get observedAttributes() { return ['size']; }
      attributeChangedCallback(name, was, now) { if (was !== now) this._plan(); }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (C0().place) C0().place(this);
        window.addEventListener('hk-module-ready', this._wake);
        this._plan();
        if (this._box) { this._glass(); this._gkey = null; this._watch(); this._fit(); }
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        window.removeEventListener('hk-module-ready', this._wake);
        if (this._icOff) { this._icOff(); this._icOff = null; }
        if (this._gRO) { this._gRO.disconnect(); this._gRO = null; }
        if (window.__hkGlassCards && window.__hkGlassCards.delete(this) && window.hkGlass) window.hkGlass.changed(this, false);
      }
      _glass() {
        if (this.isConnected && window.__hkGlassCards) { window.__hkGlassCards.add(this); if (window.hkGlass) { window.hkGlass.changed(this, true); window.hkGlass.rendered(this); } }
      }
      // Every scene, A to Z, follows the house's scenes: re-planned when the
      // number of entities moves (cheap), not on every push.
      // The count is taken only while the row follows them (_auto): a screen
      // that picks its own scenes -- every one in this house -- has nothing to
      // re-plan, and 4,195 keys on each of ~12 pushes a second was the cost.
      _onClient(client) {
        var first = !this._seenClient;
        var n = (first || this._auto) && client && client.states ? Object.keys(client.states).length : this._n;
        this._seenClient = client;
        if (C0().tone) C0().tone(this, client);
        if (first || (this._auto && n !== this._n)) { this._n = n; this._plan(); }
        if (this._el) window.hkHostClient.bridge(this._el, client);
        (this._tiles || []).forEach(function (t) { t.hkSetClient(client); });
      }
      getCardSize() { return 2; }
      _plan() {
        if (!this._cfgIn) return;
        var M = C0().menu;
        var size = this.getAttribute('size');
        var board = (M && M.board ? M.board() : null) || {};
        if (!this._cfgIn.room) icWatch(this, board, 'scenes_pages');
        var p = scenesPlan(size ? Object.assign({}, this._cfgIn, { hk_cell: size }) : this._cfgIn,
                           board, this.client, this.hasAttribute('data-hk-foreign'));
        this._auto = p.auto;
        var key = JSON.stringify(p.config);
        if (key === this._key) return;
        this._key = key;
        var on = !!p.config;
        this.style.display = on ? 'block' : 'none';
        if (this.hidden === on) {
          this.hidden = !on;
          if (this.isConnected) {
            this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
          }
        }
        if (!on) return;
        if (p.config.hk_cell) { this._grid(p.config); return; }
        if (this._box) { this.removeChild(this._box); this._box = null; this._tiles = null; }
        var wrapper = window.hkCards.cardWrapper();
        if (!wrapper) {
          // No Lovelace: the card itself (hkCards.createCard), made again for a
          // new plan, as Lovelace's wrapper builds its card again for a new config.
          var next = window.hkCards.createCard(p.config, this.client);
          if (this._el && this._el.parentNode === this) this.replaceChild(next, this._el);
          else this.appendChild(next);
          this._el = next;
          return;
        }
        if (!this._el) {
          this._el = document.createElement(wrapper);
          this._el.preview = false;
          this.appendChild(this._el);
        }
        window.hkHostClient.bridge(this._el, this.client);
        this._el.config = p.config;
        if (this._el.load) this._el.load();
      }
      // A HOME GRID BLOCK: the scene tiles, made as HK's own cards (never a host wrapper) so each can be told its size.
      // Full: HomeView's tile (Centred: the glyph large and bare over the name, "Scene" under it), on every dashboard;
      // Half: the scene pill, the Home app's button. Each sits in a place of its own that is its cell (hk-cell), so a
      // Centred tile takes the sizes for the room it has. Color: each on a gradient of its own color (hk-tile.js block_color).
      // THE TILES ARE A DESIGNED SIZE (2026-11-08, round three, groupGeom): the same size however many scenes there are and
      // whatever the block's room beyond its own, 8 px (10 on square cells) apart, the group -- its last row too --
      // centered. Half's rows are the
      // pill's own 70 px (2026-11-01, the owner: "Half Height cards should be the height of a standard pill card... not
      // stretch itself out"), as many as the block holds.
      // THE HEADING (2026-11-08, the lead's review: a sparse block read as a lost tile in an empty plate): a label row on the
      // top inset -- "Scenes" in the label role, "+N more" at its right when some do not fit (a 44 px key that opens them all
      // in a sheet; the grid has no "+N more" tile) -- and the tile group centered in the room under it. A Wide block on a
      // tile cell has no room for HomeView's tile under it (96 px): its row is the Home app's pill, as the Room block's is.
      _grid(plan) {
        if (this._el) { if (this._el.parentNode === this) this.removeChild(this._el); this._el = null; }
        if (!this._box) {
          this._box = document.createElement('div');
          this.appendChild(this._box);
        }
        var box = this._box;
        box.style.cssText = C0().plate('card') +
          ';box-sizing:border-box;padding:var(--hk-spad-t,12px) var(--hk-spad-r,12px) calc(var(--hk-spad-b,12px) + var(--hk-pager-safe,0px)) var(--hk-spad-l,12px);' +
          'display:flex;flex-direction:column;gap:8px;width:100%;height:100%;overflow:hidden;--hk-pill:100%';
        delete box._hkGroupBase; C0().groupSurface(box, plan.surface);
        this._gplan = plan; this._gkey = null;
        this._watch();
        this._fit();
        this._glass();
      }
      // (the view measures its cells after the cards are in, and again for a new cell style: drawn again when the
      // geometry it gives them is not the one drawn)
      _watch() {
        if (this._gRO || !this._box || typeof ResizeObserver !== 'function') return;
        var self = this;
        this._gRO = new ResizeObserver(function () { self._fit(); });
        this._gRO.observe(this._box);
      }
      _fit() {
        var plan = this._gplan, box = this._box, size = this.getAttribute('size');
        if (!plan || !box || !size) return;
        var pill = plan.half || (size === 'W' && !cellSquare(this));
        // (no title row: "Scenes" says nothing the scenes don't -- 2026-11-08, the owner; the tiles have the whole block and "N More" is
        // the last place, a tile like the others)
        var gm = groupGeom(this, size, { pill: pill, head: 0 }), n = plan.pills.length, shown = n > gm.n ? Math.max(0, gm.n - 1) : n, left = n - shown;
        var key = JSON.stringify([gm, n, pill]);
        if (key === this._gkey) return;
        this._gkey = key;
        var client = this.client, dim = 'flex:none;width:' + gm.tw + 'px;height:' + gm.th + 'px', ink2 = C0().v('ink-2'), glow = C0().v('glow');
        while (box.firstChild) box.removeChild(box.firstChild);
        var ids = plan.pills.map(function (p) { return p.entity; }).filter(Boolean);
        var tiles = document.createElement('div');
        // A ROW OF FEWER TILES STARTS IN THE LEFT COLUMN (2026-11-09, the owner: "Fix it" -- "Movie Night" centered under three): the rows start left in a box as wide as the widest row,
        // that box centered in the block (as a Room's tiles, hk-grid-room.js --gw); no scenes: the line centered
        var across = Math.max(1, Math.min(gm.cols, shown + (left ? 1 : 0)));
        // EXTRA LARGE AND FULL WIDTH (2026-11-09, mockup 8b, the owner: "I actually prefer your 8b"): Large's tile size, three across (six
        // at Full Width), from the top-left of the block, two rows -- never a short group centered in it
        var big = n && (size === 'XL' || size === 'XXL');
        tiles.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:' + (n ? 'flex-start' : 'center') + ';align-content:' + (big ? 'flex-start' : 'center') + ';flex:1;min-height:0;gap:' +
          gm.gap + 'px;width:100%;margin:' + (big ? '0' : '0 auto') + ';max-width:' + (n && !big ? (across * gm.tw + (across - 1) * gm.gap) + 'px' : '100%');
        box.appendChild(tiles);
        if (!n) {
          // NO SCENES (2026-11-08): the glyph and a line, centered in the block, in the secondary ink -- the block is there, saying what it holds
          var none = document.createElement('div'), ic = document.createElement('hk-icon'), nt = document.createElement('span');
          none.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;color:' + ink2 + ';text-shadow:' + glow + ';' + C0().typeCss('body');
          ic.style.cssText = 'width:34px;height:34px;--mdc-icon-size:100%;display:flex';
          ic.icon = 'mdi:palette-outline';
          nt.textContent = 'No scenes';
          none.appendChild(ic); none.appendChild(nt);
          tiles.appendChild(none);
          this._tiles = [];
          return;
        }
        this._tiles = plan.pills.slice(0, shown).map(function (p) {
          var cfg = blockPill(p, Object.assign({}, plan, { half: pill }));
          var slot = document.createElement('div');
          // (the tile's numbers: HomeView's square tile on square cells -- the one set of type and glyph for every tile of the group)
          slot.style.cssText = 'position:relative;min-width:0;min-height:0;container-type:size;container-name:hk-cell;' + dim +
            ';--hk-cell-shape:' + (gm.sq && !pill ? 'square' : 'none');
          var t = window.hkCards.create(cfg);
          t.setAttribute('data-group-fill', '');
          t.style.cssText = 'display:block;min-width:0;min-height:0;width:100%;height:100%';
          slot.appendChild(t);
          tiles.appendChild(slot);
          if (client) t.hkSetClient(client);
          return t;
        });
        if (left) {
          // "N MORE", THE LAST PLACE: a tile like the others -- the ellipsis in the glyph's place, "N More" in the name's role (as a Room's)
          var mo = document.createElement('button'), mi = document.createElement('hk-icon'), mt = document.createElement('span');
          mo.type = 'button';
          mo.setAttribute('aria-label', left + ' more scenes, open them all');
          mo.style.cssText = 'all:unset;box-sizing:border-box;' + dim + ';border-radius:var(--hk-inner-radius,16px);' + C0().plate('tile') + ';cursor:pointer;' +
            'display:flex;flex-direction:' + (pill ? 'row' : 'column') + ';align-items:center;justify-content:center;gap:' + (pill ? 10 : 6) + 'px;color:' + C0().v('ink') + ';' +
            C0().typeCss('headline') + ';text-shadow:' + glow + ';-webkit-tap-highlight-color:transparent';
          mi.icon = 'mdi:dots-horizontal';
          mi.style.cssText = 'width:' + (pill ? 28 : gm.sq ? 56 : 44) + 'px;height:' + (pill ? 28 : gm.sq ? 56 : 44) + 'px;--mdc-icon-size:100%;display:flex;color:' + ink2;
          mt.textContent = left + ' More';
          mo.appendChild(mi); mo.appendChild(mt);
          mo.addEventListener('click', function (e) {
            e.stopPropagation();
            var D = window.hkDetail;
            if (D && D.openGroup) D.openGroup('Scenes', ids, { icon: 'mdi:palette' });
          });
          tiles.appendChild(mo);
        }
      }
    }

    // register / firstOf are hk-base.js's -- a private copy drifts (the
    // hasOwnProperty stub guard is easy to lose).
    var C = window.hkCards, register = C.register, firstOf = C.firstOf;

    var KIND_OPTIONS = KIND_ORDER.map(function (k) { return { value: k, label: KIND_NAMES[k] }; });
    // A single chip may be Smoke & CO too; the row's lists may not -- it leads
    // every row on its own (rowPlan), so choosing it there would do nothing.
    var CHIP_KIND_OPTIONS = [{ value: 'smoke', label: KIND_NAMES.smoke }].concat(KIND_OPTIONS);

    // what the shell and the later parts use of this one
    K.blockPill = blockPill; K.C = C; K.cellSquare = cellSquare; K.CHIP_KIND_OPTIONS = CHIP_KIND_OPTIONS;
    K.firstOf = firstOf; K.GROUP_HEAD = GROUP_HEAD; K.groupGeom = groupGeom; K.HkScenesCard = HkScenesCard;
    K.KIND_OPTIONS = KIND_OPTIONS; K.pagePill = pagePill; K.register = register; K.scenePill = scenePill;
    K.scenesPlan = scenesPlan;
  };
})();
