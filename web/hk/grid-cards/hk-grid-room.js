// hk-grid-room.js - the room card, the entity card and the accessories card.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-room'] = function (K) {
    var areaOf = K.areaOf, C = K.C, COLS = K.COLS, dimCall = K.dimCall, dims = K.dims, dom = K.dom,
        dragged = K.dragged, friendly = K.friendly, GAP = K.GAP, HkBase = /** @type {HkLooseElementConstructor} */ (K.HkBase), HOLD_MS = K.HOLD_MS,
        layout = K.layout, percent = K.percent, pill = K.pill, roomLine = K.roomLine,
        roomOf = K.roomOf, roomHumidity = K.roomHumidity, roomParts = K.roomParts, roomTemp = K.roomTemp, sceneSays = K.sceneSays, sizeOf = K.sizeOf, SLOP = K.SLOP,
        speakerOf = K.speakerOf, TABLET_ROOM = K.TABLET_ROOM, twoOf = K.twoOf, type = K.type, v = K.v;

    // ===================================================== hk-grid-room-card
    var ROOM_CSS = [
      ':host{display:block;height:100%;position:relative}',
      '.room{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('14px', true) + ';gap:8px;' + C.plate('card') + ';',
      '  --hk-pill:100%}',
      // THE HEADING (2026-11-08, the owner: every block's title "the same gray color, format/layout and spacing", as Music's
      // RECENTLY PLAYED): one label row on the text's inset (the tiles are on the shape inset) -- a Room's name and the way into its
      // page (its chevron), what the room is doing at the right; an Accessory Group's title and "+N more" at the right (a 44 px key)
      '.hd{display:flex;align-items:center;justify-content:space-between;gap:10px;height:' + C.HEAD.row + 'px;min-width:0;flex:none;margin:var(--hk-text-in,0px) var(--hk-text-in,0px) 0}',
      '.nm{all:unset;position:relative;cursor:pointer;min-width:0;display:flex;align-items:center;gap:4px;-webkit-tap-highlight-color:transparent}',
      C.headCss('.nm span'), C.headCss('.nm i'), '.nm i{font-style:normal;flex:none}',
      // a 44 px target round the line (DESIGN.md: touch targets)
      '.nm::after{content:"";position:absolute;left:-8px;right:-8px;top:-14px;bottom:-14px}',
      '.nm:disabled{cursor:default}',
      '.nm:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
      // (the name first: the line gives way, and a Tall block's row is the name's alone)
      C.headCss('.st'), '.st{flex:0 100 auto;text-align:right}', '.nm{flex:0 1 auto}', '.room[size=T] .st{display:none}',
      '.st:empty{display:none}',
      '.mo{display:none}',
      '.room.lbl .st{display:none}',
      '.room.lbl .mo{all:unset;position:relative;display:block;flex:none;cursor:pointer;-webkit-tap-highlight-color:transparent}', C.headCss('.room.lbl .mo'),
      '.room.lbl .mo{overflow:visible}',
      '.room.lbl .mo::after{content:"";position:absolute;left:-10px;right:-10px;top:-14px;bottom:-14px}',
      '.room.lbl .mo[hidden]{display:none}',
      // THE TILES (2026-11-08, round three, the owner: "entities in a card should maintain dimensions"): a designed size --
      // --tw x --th, --gap apart (hk-chip.js groupGeom: per block size and cell shape, never the block's room divided by the
      // count) -- in rows the group centers, its last row too, in what the heading leaves. A bigger block shows more tiles.
      // (a row's tiles from the left column -- the owner, 2026-11-08: a Large Room's third tile sat centered under two, "If there is 1
      // card on a row, it should always be in the left column"; the group as wide as its widest row, centered in the block)
      '.tiles{display:flex;flex-wrap:wrap;justify-content:flex-start;align-content:center;gap:var(--gap,8px);flex:1;min-height:0;width:100%;margin:0 auto;max-width:var(--gw,100%)}',
      '.tiles > .slot,.tiles > .more{flex:none;width:var(--tw);height:var(--th);box-sizing:border-box}',
      // ...or scrolling: as many rows in sight as the block holds (the rest under them) -- up and down is the room's,
      // sideways the pager's
      // ...a Wide Room's row on the bottom inset, under its heading (2026-11-07, the review), not floating mid-block
      '.room.hdr[size=W] .tiles{align-content:flex-end}',
      '.tiles.scrolling{align-content:flex-start;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scrollbar-width:none}',
      '.tiles.scrolling::-webkit-scrollbar{display:none}',
      '.tiles.scrolling .slot{touch-action:pan-x pan-y}',
      // (a slot is a cell of its own, not the grid's: it is no square because the grid's cells are -- hk-layout.js)
      '.slot{container-type:size;container-name:hk-cell;--hk-cell-shape:none;min-width:0;min-height:0}.slot > *{display:block;width:100%;height:100%}',
      // "N MORE" AS A TILE (2026-11-08, the lead's review: its text was a speck in a full-size tile): the ellipsis in the tile's glyph place
      // and "N More" in its name role, like Security's "... 3 more" row
      '.more{border:0;border-radius:var(--hk-inner-radius,' + v('glass-radius') + ');' + C.plate('tile') + ';color:' + v('ink') + ';' + type('headline') + ';text-shadow:' + v('glow') + ';min-height:44px;cursor:pointer;',
      '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}',
      // (the Centred tile's own numbers: the glyph over the name, the name role, the glyph larger on a square cell)
      '.more hk-icon{width:44px;height:44px;--mdc-icon-size:100%;display:flex;color:' + v('ink-2') + '}',
      '.tiles[data-sq] .more hk-icon{width:56px;height:56px}',
      '.slot{position:relative;touch-action:pan-x;-webkit-user-select:none;user-select:none;',
      '  -webkit-touch-callout:none}',
      '.none{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;' + type('body') + ';color:' + v('ink-2') + ';text-shadow:' + v('glow') + '}',
      '.none hk-icon{width:34px;height:34px;--mdc-icon-size:100%;display:flex}',
      '.room[size=W] .none{flex-direction:row;gap:10px}.room[size=W] .none hk-icon{width:24px;height:24px}',
      // THE FOOT LINE (the owner, 2026-10-31: "dots for the rooms, then 'N
      // more below' (dots, not '1 of 4 rooms')"): one short line, centred --
      // the rooms' dots when the block pages through them, a tap beside the
      // current one a room back or on, and what is scrolled out of sight
      '.ft{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;height:16px;min-width:0;margin-bottom:var(--hk-text-in,0px);' + type('micro') + ';line-height:16px;color:' + v('ink-2') + ';text-shadow:' + v('glow') + '}',
      '.ft[hidden],.ft [hidden]{display:none}',
      '.fd{all:unset;position:relative;display:flex;gap:6px;align-items:center;height:16px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      // (the dots' 44 px target, reaching up over the tiles' gap and down into the inset)
      '.fd::after{content:"";position:absolute;left:-10px;right:-10px;top:-12px;bottom:-16px}',
      '.fd:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:8px}',
      '.fd i{width:7px;height:7px;border-radius:50%;background:' + v('mark') + ';flex:none}',
      '.fd i[aria-current=true]{background:' + v('ink') + '}',
      '.ft b{width:3px;height:3px;border-radius:50%;background:' + v('ink-3') + ';flex:none}',
      '.ft span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE DIMMER, while a light is held: the readout over its pill -- a
      // fill from the bottom and the percent -- on the near-solid overlay
      '.dim{position:absolute;inset:0;border-radius:var(--hk-inner-radius,' + v('glass-radius') + ');overflow:hidden;',
      '  background:' + v('overlay-solid') + ';display:flex;align-items:center;justify-content:center;',
      '  pointer-events:none;z-index:1}',
      '.dim i{position:absolute;left:0;right:0;bottom:0;background:' + v('track-fill') + ';opacity:0.32}',
      '.dim b{position:relative;' + type('title') + ';color:' + v('ink') + ';font-variant-numeric:tabular-nums}',
      // THE ROOM AS ONE TILE (S, 2026-11-07, the review): HomeView's tile -- the room's glyph, its name, what it is doing --
      // that opens the room's page. Home style: the glyph in its well at the top, the words at the foot, on the block's inset;
      // Centered: the Centered tile's numbers (hkCards.centredTile), as the other Small blocks.
      '.rs{display:none}',
      '.room[size=S].rt{display:block;position:relative;padding:0}',
      '.room[size=S].rt .hd,.room[size=S].rt .tiles,.room[size=S].rt .ft{display:none}',
      '.room[size=S].rt .rs{all:unset;position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;cursor:pointer;',
      '  padding:' + C.blockPad('14px') + ';-webkit-tap-highlight-color:transparent;border-radius:inherit}',
      '.room[size=S].rt .rs:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:-4px}',
      '.room[size=S].rt:active{transform:scale(0.97);filter:brightness(0.93)}',
      '.rs .well{width:42px;height:42px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.rs .icon{width:34px;height:34px;--mdc-icon-size:100%;display:flex;color:' + v('glyph') + '}',
      '.rs .tx{display:flex;flex-direction:column;min-width:0}',
      '.rs .name,.rs .state{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-0.23px}',
      '.rs .name{' + type('headline') + ';line-height:21px;color:' + v('ink') + ';text-shadow:' + v('glow') + '}',
      '.rs .state{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';text-shadow:' + v('glow') + '}',
      ':host([tile=centred]) .room[size=S].rt .rs{display:block}',
      // EXTRA LARGE IN TWO COLUMNS (2026-11-09, mockup 13, the owner approved): the room itself on the left -- its name (a tap
      // opens its page), the temperature, what is going on, two of its scenes -- its accessories on the right, as tiles in two
      // columns that fill the column's height (two rows for up to four, three for five and six; more scroll, the tiles keeping
      // their size). The columns are a block's inset apart; the left is 214 px.
      '.xb,.xs{display:none}',
      '.room.x2{display:grid;grid-template-columns:214px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;column-gap:var(--hk-pad-l,18px);',
      '  grid-template-areas:"hd rt" "xb rt" "xs rt"}',
      '.room.x2.pg{grid-template-rows:auto minmax(0,1fr) auto auto;grid-template-areas:"hd rt" "xb rt" "xs rt" "ft ft"}',
      '.room.x2 .hd{grid-area:hd}.room.x2 .st,.room.x2 .mo{display:none}.room.x2 .ft{grid-area:ft}',
      '.room.x2 .xb{grid-area:xb;display:flex;flex-direction:column;min-height:0;margin:0 var(--hk-text-in,0px);overflow:hidden}',
      '.room.x2 .xs{grid-area:xs;display:flex;flex-direction:column;gap:8px}',
      '.xt{margin-top:6px;font-size:60px;font-weight:300;line-height:64px;letter-spacing:-1px;color:' + v('ink') + ';text-shadow:' + v('glow') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.xh{margin-top:2px;' + type('body') + ';color:' + v('ink-2') + ';text-shadow:' + v('glow') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xw{display:flex;flex-direction:column;gap:8px;margin-top:18px;min-width:0}',
      '.xw > div{display:flex;align-items:center;gap:8px;min-width:0;' + type('body') + ';color:' + v('ink') + ';text-shadow:' + v('glow') + '}',
      '.xw hk-icon{width:18px;height:18px;--mdc-icon-size:100%;display:flex;flex:none}',
      '.xw span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.xw .off{color:' + v('ink-2') + '}.xw .off hk-icon{color:' + v('ink-3') + '}',
      // a scene's key: 56 px tall and the column's width, one over the other 8 px apart (the owner, 2026-11-09: "Should the Scenes be stacked on each other instead of side by side?")
      '.sc{all:unset;box-sizing:border-box;position:relative;flex:none;width:100%;height:56px;padding:0 8px;border-radius:28px;background:rgba(255,255,255,0.16);',
      '  display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;color:' + v('ink') + ';' + type('body') + ';font-weight:600;text-shadow:' + v('glow') + '}',
      '.sc span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.sc:active{background:rgba(255,255,255,0.28)}',
      '.sc:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      // its tiles: a grid of two columns, the rows the column's third or half (never the tile count's), from the left; what
      // does not fit scrolls under a soft fade at the foot -- the pattern of Up Next's list (hk-media-now.js .npql)
      '.room.x2 .tiles{grid-area:rt;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:var(--rh,96px);align-content:start;justify-content:stretch;',
      '  gap:var(--gap,8px);flex:none;width:auto;max-width:none;margin:0;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
      '  touch-action:pan-y;scrollbar-width:none;contain:size}',
      '.room.x2 .tiles::-webkit-scrollbar{display:none}',
      '.room.x2 .tiles.more{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent)}',
      '.room.x2 .tiles > .slot{width:auto;height:100%;touch-action:pan-x pan-y}',
      '.room.x2 .tiles > .none{grid-column:1 / -1;flex-direction:row;align-items:flex-start;text-align:left}.room.x2 .none hk-icon{display:none}',
      C.centredTile({ host: ':host([tile=centred])', plate: '.room[size=S].rt', lit: '.room[size=S].rt.lit', well: '.rs .well', icon: '.rs .icon', name: '.rs .name', sub: ['.rs .state'] })
    ].join('');

    class HkGridRoomCard extends HkBase {
      static get CSS() { return ROOM_CSS; }
      setConfig(config) { super.setConfig(Object.assign({ area: TABLET_ROOM }, config || {})); }
      getCardSize() { return 4; }
      _size() { var s = sizeOf(this); return COLS[s] ? s : 'L'; }
      _area() { return roomOf(this._config.area, this._config.fallback, this.client); }
      _height() {
        var h = this._h;
        if (!h) {
          var r = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
          h = r && r.height ? r.height : 0;
        }
        if (!h) {
          // not laid out yet: the size class's rows of HK's own grid
          var rows = (C.HOME_GRID.sizes[this._size()] || [2, 2])[1];
          h = rows * C.TILE.tall + (rows - 1) * C.HOME_GRID.gap;
        }
        return h;
      }
      // THE PAGER IT IS A PAGE OF (hk-layout.js hk-pager-card, a block whose
      // pages are the rooms): its page, "2 of 5" (the page's own label), and
      // the pager, to turn -- null when it pages nothing
      _paging() {
        if (!this.hasAttribute('data-grid-pager')) return null;
        var page = /** @type {Element | null} */ (this.parentNode), root = this.getRootNode ? /** @type {any} */ (this.getRootNode()) : null, pager = root && root.host;
        var m = page && page.getAttribute && /^(\d+) of (\d+)$/.exec(page.getAttribute('aria-label') || '');
        if (!m || !pager || typeof pager.goTo !== 'function') return null;
        return { at: +m[1] - 1, of: +m[2], pager: pager };
      }
      // THE TILES' DESIGNED GRID (hk-chip.js groupGeom): the places this block size has on this cell shape, and the size
      // of one -- what the heading above and the dots below take from them. `half`: the Home app's 70 px pill.
      _geom(size, half, head, foot) {
        return window.hkChip.groupGeom(this, size, { pill: half, head: head, foot: foot });
      }
      // the heading's room above the tiles: its label row and the gap under it, as every block's (hk-chip.js GROUP_HEAD)
      _head(size) { return window.hkChip.groupHead; }
      // what it draws, in one go: the room, its pills, its line
      /** @returns {any} */
      _plan() {
        var h = this.client, size = this._size(), area = this._area();
        if (!h || !h.states || !area) return { area: area, size: size, tiles: [], status: '', name: '' };
        var parts = roomParts(h, area), name = (h.areas[area] || {}).name || area, status = roomLine(h, area, parts, size);
        // THE ROOM AS ONE TILE (S): its glyph, name and line -- no accessories drawn
        if (size === 'S') return { area: area, size: size, tiles: [], more: 0, name: name, status: status, icon: this._roomGlyph(area) };
        // EXTRA LARGE (2026-11-09, mockup 13): every accessory the room's page has, as tiles in two columns, and the room's facts
        if (size === 'XL') {
          var xg = this._geom(size, false, 0, 0);
          return { area: area, size: size, xl: true, tiles: this._xTiles(parts),
                   more: 0, name: name, status: status, geom: xg, empty: 'No accessories in this room', x: this._facts(h, area, parts) };
        }
        // A WIDE ROOM'S ROW on a tile cell is the Home app's pill (2026-11-01, the owner: "half cards need to be fixed here like we
        // did on the Accessories card"): 70 px from the top, the glyph beside the words, never a Centred tile squeezed into a
        // short row. On a square cell (2026-11-08) it has the room for HomeView's tile under the heading: two of them, 130 px tall
        var sq = window.hkChip && window.hkChip.cellSquare ? window.hkChip.cellSquare(this) : false;
        var half = size === 'W' && !sq, pg = this.hasAttribute('data-grid-pager') ? 24 : 0, head = this._head(size);
        var gm = this._geom(size, half, head, pg);
        if (this._config.accessory_display === 'scroll') {
          // (the foot line's place, when more is under the tiles than shows)
          var all = parts.all.map(function (c) { return pill(c, ['light', 'switch', 'input_boolean', 'fan'].indexOf(dom(c.entity)) >= 0); });
          if (all.length > gm.n && !pg) gm = this._geom(size, half, head, 24);
          return { area: area, size: size, scroll: true, half: half, more: 0, name: name, status: status, tiles: all, geom: gm };
        }
        // TWO THINGS, ALWAYS (Wide and Tall, 2026-11-07, the review): the lights first, the speaker only if there is room;
        // "+N more" goes in the heading's line (it was a third tile, and no light)
        if (size === 'W' || size === 'T') {
          var two = twoOf(parts, h);
          return { area: area, size: size, parts: parts, tiles: two.tiles, more: 0, name: name, half: half, geom: gm,
                   status: status + (two.more ? (status ? ' · ' : '') + '+' + two.more + ' more' : '') };
        }
        // (the places the designed grid has, the last one the "N more" tile when there are more things than places)
        var places = gm.n, total = parts.lights.length + (speakerOf(h, parts.speakers) ? 1 : 0), more = total > places;
        return { area: area, size: size, parts: parts, tiles: layout(parts, size, Math.max(0, places - (more ? 1 : 0)), h),
                 more: more ? total - Math.max(0, places - 1) : 0, name: name, status: status, half: half, geom: gm };
      }
      // THE TILES, in the order the mockup has them: the lights (and fans), the speakers, then whatever else the room's page holds
      _xTiles(parts) {
        var rank = function (c) { return parts.lights.indexOf(c) >= 0 ? 0 : parts.speakers.indexOf(c) >= 0 ? 1 : 2; };
        return parts.all.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) { return rank(a.c) - rank(b.c) || a.i - b.i; })
          .map(function (o) { return pill(o.c, ['light', 'switch', 'input_boolean', 'fan'].indexOf(dom(o.c.entity)) >= 0); });
      }
      // WHAT THE LEFT COLUMN SAYS (Extra Large): the temperature, the humidity, one line per kind of thing going on (the lights'
      // and a speaker playing -- the facts roomLine has), and up to two of the scenes in the room's area, by name
      _facts(h, area, parts) {
        var st = h.states || {}, ents = h.entities || {}, lights = parts.all.filter(function (c) { return dom(c.entity) === 'light'; });
        var lit = lights.filter(function (c) { return st[c.entity] && st[c.entity].state === 'on'; }).length, lines = [];
        if (lights.length) lines.push({ k: 'light', on: lit > 0, text: lit ? lit + (lit === 1 ? ' light on' : ' lights on') : 'Lights off' });
        if (parts.speakers.some(function (c) { return st[c.entity] && st[c.entity].state === 'playing'; })) lines.push({ k: 'speaker', on: true, text: 'Speaker playing' });
        // (the house's scenes: HA's, and what Settings -> Accessories -> Scenes counts as one)
        var HC = window.hkCards, scenes = (HC && HC.sceneIds ? HC.sceneIds(h) : []).filter(function (id) {
          return areaOf(h, id) === area && !(ents[id] && (ents[id].hidden || ents[id].entity_category));
        }).map(function (id) { return { id: id, name: String((st[id].attributes || {}).friendly_name || id) }; })
          .sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, 2);
        return { temp: roomTemp(h, area), hum: roomHumidity(h, area), lines: lines, scenes: scenes };
      }
      _sigOf() {
        var p = this._plan();
        this._p = p;
        return JSON.stringify([p.area, p.size, p.name, p.status, p.icon, p.more, p.hmore, !!p.scroll, this._config.surface, p.tiles.map(function (t) { return t.entity; }),
                               p.geom, p.x, this._height(), !!window.hkStrategy, !!window.hkRoom, this.getAttribute('tile')]);
      }
      // EACH NEW CLIENT: every pill gets it (they gate their own draws)
      _receiveClient() {
        super._receiveClient();
        var c = this.client;
        (this._kids || []).forEach(function (k) {
          window.hkHostClient.bridge(k, c);
        });
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._ro && typeof ResizeObserver === 'function') {
          this._ro = new ResizeObserver(function (en) {
            var r = en && en[0] && en[0].contentRect, hh = r ? Math.round(r.height) : 0;
            if (hh && hh !== self._h) { self._h = hh; self.redraw(); }
            self._below();
          });
          this._ro.observe(this);
        }
      }
      disconnectedCallback() {
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._holdT) { clearTimeout(this._holdT); this._holdT = null; }
        super.disconnectedCallback();
      }
      _render() {
        var p = this._p || this._plan(), h = this.client, self = this;
        this._p = null;
        if (!this._built) {
          this._root.innerHTML = '<div class="room"><div class="hd"><button class="nm" type="button"><span></span>' +
            '<i aria-hidden="true">›</i></button><span class="st"></span><button class="mo" type="button" hidden></button></div>' +
            '<div class="xb"><div class="xt"></div><div class="xh"></div><div class="xw"></div></div><div class="xs"></div>' +
            '<div class="tiles" role="list"></div>' +
            '<div class="ft" hidden><button class="fd" type="button"></button><b></b><span></span></div>' +
            '<button class="rs" type="button"><div class="well"><hk-icon class="icon"></hk-icon></div><div class="tx"><div class="name"></div><div class="state"></div></div></button></div>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { box: q('.room'), hd: q('.hd'), xt: q('.xt'), xh: q('.xh'), xw: q('.xw'), xs: q('.xs'), nm: q('.nm'), name: q('.nm span'), chev: q('.nm i'), st: q('.st'), mo: q('.mo'), tiles: q('.tiles'),
                      ft: q('.ft'), fd: q('.fd'), sep: q('.ft b'), below: q('.ft span'), rs: q('.rs'), rsIcon: q('.rs .icon'), rsName: q('.rs .name'), rsState: q('.rs .state') };
          this._e.rs.addEventListener('click', function (e) { e.stopPropagation(); self._openRoom(true); });
          this._e.nm.addEventListener('click', function (e) { e.stopPropagation(); self._openRoom(); });
          this._e.mo.addEventListener('click', function (e) { e.stopPropagation(); self._openRoom(); });
          // a tap on the dots: a room back or on, by the side of the current dot it lands
          this._e.fd.addEventListener('click', function (e) {
            e.stopPropagation();
            var pg = self._paging(), cur = pg && self._e.fd.children[pg.at];
            if (!cur) return;
            var r = cur.getBoundingClientRect(), to = pg.at + (e.clientX < r.left + r.width / 2 ? -1 : 1);
            if (to >= 0 && to < pg.of) pg.pager.goTo(to, true);
          });
          this._e.tiles.addEventListener('scroll', function () { self._below(); }, { passive: true });
          this._kids = []; this._key = null;
          this._built = true;
        }
        var e = this._e;
        e.box.setAttribute('size', p.size);
        e.box.classList.toggle('x2', !!p.xl);
        e.box.classList.toggle('r3', !!p.xl && p.tiles.length > 4);
        this._xl = !!p.xl;
        if (p.xl) this._drawFacts(p.x);
        C.groupSurface(e.box, this._config.surface);
        e.hd.style.display = p.head === false ? 'none' : '';
        e.box.classList.toggle('hdr', p.head !== false);
        e.box.classList.toggle('lbl', !!p.lbl);
        var moText = p.hmore ? '+' + p.hmore + ' more' : '';
        if (e.mo.textContent !== moText) e.mo.textContent = moText;
        e.mo.hidden = !p.hmore;
        if (p.hmore) e.mo.setAttribute('aria-label', p.hmore + ' more, open them all');
        e.box.classList.toggle('rt', p.size === 'S' && !!p.area);      // (a Room's Small: the room as one tile -- .rt's styles)
        if (p.size === 'S' && p.area) {          // (a Room's Small is the room as one tile; an Accessory Group's Small is its pills)
          // (the tile's words; the glyph by what it draws, as the other Small tiles' -- TILE.centred.ink)
          if (e.rsName.textContent !== (p.name || 'Room')) e.rsName.textContent = p.name || 'Room';
          if (e.rsState.textContent !== (p.status || '')) e.rsState.textContent = p.status || '';
          if (e.rsIcon.icon !== p.icon) e.rsIcon.icon = p.icon;
          if (this.getAttribute('tile') === 'centred') e.rsIcon.setAttribute('ink', String(C.TILE.centred.ink)); else e.rsIcon.removeAttribute('ink');
          e.rs.setAttribute('aria-label', (p.name || 'Room') + (p.status ? ', ' + p.status : '') + ', open the room');
          this._key = null; e.tiles.innerHTML = ''; this._kids = [];
          e.fd.hidden = true; e.ft.hidden = true;
          return;
        }
        // HOW MANY ACROSS AND DOWN, AND HOW BIG (2026-11-08, round three): the designed grid of the block's size and cell
        // shape (p.geom: hk-chip.js groupGeom). The tiles keep that size whatever their count -- fewer than the places
        // leave the group centered, its last row too; more end on "N more" -- and a bigger block shows more of them.
        var gm = p.geom || this._geom(p.size, !!p.half, 0, 0), cols = gm.cols, rows = gm.rows;
        e.tiles.style.setProperty('--tw', gm.tw + 'px');
        e.tiles.style.setProperty('--th', gm.th + 'px');
        e.tiles.style.setProperty('--gap', gm.gap + 'px');
        var across = Math.max(1, Math.min(cols, p.tiles.length + (p.more ? 1 : 0)));
        e.tiles.style.setProperty('--gw', (across * gm.tw + (across - 1) * gm.gap) + 'px');
        if (gm.sq) e.tiles.setAttribute('data-sq', ''); else e.tiles.removeAttribute('data-sq');
        e.tiles.classList.toggle('scrolling', !!p.scroll && !p.xl && p.tiles.length > cols * rows);
        if (e.name.textContent !== (p.name || 'Room')) e.name.textContent = p.name || 'Room';
        if (e.st.textContent !== (p.status || '')) e.st.textContent = p.status || '';
        // (the chevron: somewhere to go -- the room's page, or the room as a sheet on a screen without one)
        var path = this._roomPath(p.area) || (p.area && window.hkRoom && window.hkRoom.openSheet ? 'sheet' : null);
        e.chev.style.display = path ? '' : 'none';
        e.nm.setAttribute('aria-label', (p.name || 'Room') + (path ? ', open the room' : ''));
        // the pills: made again only when what they are changes
        // CENTRED (2026-10-31, the owner: the Accessories block's tiles "don't
        // follow the sizing for HomeView styling", with no second line): the
        // block's Tile Style on each tile -- the glyph bare and large over the
        // name and its state, the cell's own sizes (hk-base.js TILE.centred).
        // An Accessories block's Full is Centred on every dashboard, its Half
        // the Home app's pill (p.centred, p.half); Color each lit one on its
        // own color's gradient (hk-tile.js block_color).
        var centred = !p.half && (p.centred || this.getAttribute('tile') === 'centred');
        // HALF PILLS ON A HOMEVIEW SCREEN (2026-11-08, the owner: "the grouped half tiles should work like the new tiny tiles with no
        // well/circle behind the glyph"): the Tiny tile's look (hk-tile.js tinyTile) -- the glyph bare, sized by the pill's height --
        // the screen's Tile Style choosing it, as it chooses Tiny's; Classic keeps the Home app's pill and its well
        var hvHalf = !!p.half && this.getAttribute('tile') === 'centred';
        var key = JSON.stringify([p.tiles, p.more, p.size, !!p.xl, !!p.scroll, centred, !!p.half, hvHalf, !!p.color, gm]);
        if (key !== this._key) {
          this._key = key;
          e.tiles.innerHTML = '';
          this._kids = [];
          if (!p.tiles.length) {
            var none = document.createElement('div');
            none.className = 'none';
            // (NOTHING TO SHOW, 2026-11-08: a quiet glyph over the line -- the block is there and says what it holds)
            var nic = document.createElement('hk-icon');
            nic.icon = p.area ? 'mdi:lightbulb-outline' : 'mdi:view-grid';
            none.appendChild(nic);
            var nt = document.createElement('span');
            nt.textContent = p.empty || (p.area ? (p.scroll ? 'No accessories in this room' : 'No lights in this room') : 'No room');
            none.appendChild(nt);
            e.tiles.appendChild(none);
          }
          p.tiles.forEach(function (t) {
            var slot = document.createElement('div');
            slot.className = 'slot';
            // (HomeView's square tile's type and glyph on a square cell -- the one set for every tile of the group, as its pills' own are not)
            if (gm.sq && !p.half) slot.style.setProperty('--hk-cell-shape', 'square');
            var tall = !p.half;
            if (tall) slot.setAttribute('size', 'S');
            slot.setAttribute('role', 'listitem');
            // (Wide: a row of the room's regular pills -- a thermostat's too, whose tall tile was cut above the foot line)
            var cfg = Object.assign({}, t, hvHalf ? { size: 'tall' } : p.half ? { size: 'regular', tile: 'home' } : tall ? { size: 'tall' } : { size: 'regular' }, p.color ? { block_color: true } : {});
            // (Centred: every glyph the tile's own size, bare, as an Accessories block's Full -- a room's pills kept the
            // room page's icon size and well, so a Room block's glyphs were a third the size: the owner, 2026-11-01)
            if (centred || hvHalf) { delete cfg.icon_size; delete cfg.bare_icon; delete cfg.well_background; }
            // (a sensor's reading takes the glyph's place: its room under its name in an Accessory Group, as Tiny's)
            if (hvHalf && !p.area && dom(t.entity) === 'sensor' && !(t.secondary && t.secondary.mode && t.secondary.mode !== 'auto')) {
              var ra = areaOf(h, t.entity), rn = ra && ((h && h.areas) || {})[ra];
              if (rn && rn.name) cfg.room = rn.name;
            }
            var el = C.createCard(cfg, h);
            if (tall) el.setAttribute('size', 'S');
            el.setAttribute('data-group-fill', '');
            if (centred) el.setAttribute('tile', 'centred');
            if (hvHalf) {
              // (one line of name in a pill -- a Tiny on a square cell's half has two; the glyph 56 % of the pill, 40 to 52 px, as Tiny's)
              el.setAttribute('size', 'XS'); el.setAttribute('tile', 'centred'); el.setAttribute('data-group-pill', '');
              el.style.setProperty('--hk-tg', Math.max(40, Math.min(52, Math.round(gm.th * 0.56))) + 'px');
            }
            slot.appendChild(el);
            e.tiles.appendChild(slot);
            self._kids.push(el);
            if (t.tap_action && dom(t.entity) === 'light') self._wireHold(slot, t.entity);
          });
          if (p.more) {
            var more = document.createElement('button'); more.className = 'more';
            var mic = document.createElement('hk-icon'), mt = document.createElement('span');
            mic.icon = 'mdi:dots-horizontal'; mt.textContent = p.more + ' More';
            more.appendChild(mic); more.appendChild(mt);
            more.setAttribute('aria-label', p.more + ' more, open them all');
            more.addEventListener('click', () => self._openRoom()); e.tiles.appendChild(more);
          }
        }
        // THE FOOT LINE: the rooms' dots while it pages, and -- scrolling --
        // a place for what is out of sight whenever there is more than shows
        var pg = this._paging();
        var fdKey = pg ? pg.at + '/' + pg.of : '';
        if (e.fd.getAttribute('data-k') !== fdKey) {
          e.fd.setAttribute('data-k', fdKey);
          e.fd.innerHTML = '';
          for (var i = 0; pg && i < pg.of; i++) {
            var d = document.createElement('i');
            if (i === pg.at) d.setAttribute('aria-current', 'true');
            e.fd.appendChild(d);
          }
          if (pg) e.fd.setAttribute('aria-label', (p.name || 'Room') + ', room ' + (pg.at + 1) + ' of ' + pg.of + '. Tap beside the dot for the room before or after.');
        }
        e.fd.hidden = !pg;
        e.box.classList.toggle('pg', !!pg && !!p.xl);
        this._scrolls = !!p.scroll && !p.xl && p.tiles.length > cols * rows;
        e.ft.hidden = !pg && !this._scrolls;
        this._below();
      }
      // "N MORE BELOW": the tiles not wholly in sight under the scroll's foot
      // (none once it is scrolled to the end)
      _below() {
        var e = this._e;
        if (!e) return;
        // (Extra Large: a fade at the tiles' foot while more is under them, not a line of words)
        var tl = e.tiles;
        tl.classList.toggle('more', !!this._xl && tl.scrollTop + tl.clientHeight < tl.scrollHeight - 1);
        // ...and its rows: the column's half (up to four tiles) or third (more), in px -- a percent of a grid in a grid's row
        // is left unresolved while it holds many tiles (2026-11-09)
        if (this._xl && tl.clientHeight) {
          var rows = e.box.classList.contains('r3') ? 3 : 2, gap = parseFloat(tl.style.getPropertyValue('--gap')) || 8;
          tl.style.setProperty('--rh', Math.floor((tl.clientHeight - (rows - 1) * gap) / rows) + 'px');
        }
        var n = 0;
        if (this._scrolls) {
          var t = e.tiles, bottom = t.scrollTop + t.clientHeight + 1;
          Array.prototype.forEach.call(t.children, function (c) { if (c.offsetTop + c.offsetHeight > bottom) n++; });
        }
        var text = n ? n + ' more below' : '';
        if (e.below.textContent !== text) e.below.textContent = text;
        e.below.hidden = !n;
        e.sep.hidden = !n || e.fd.hidden;
      }
      // the left column, drawn (Extra Large): the temperature large and light, the humidity under it, a glyph and a line for each
      // kind of thing going on, the scenes as keys; whatever the room has none of is not drawn
      _drawFacts(x) {
        var e = this._e, self = this, key = JSON.stringify(x);
        if (e.xKey === key) return;
        e.xKey = key;
        e.xt.hidden = x.temp === null; e.xt.textContent = x.temp === null ? '' : Math.round(x.temp) + '°';
        e.xh.hidden = x.hum === null || x.temp === null; e.xh.textContent = x.hum === null ? '' : x.hum + '% humidity';
        e.xw.style.marginTop = x.temp === null ? '4px' : '';
        e.xw.innerHTML = '';
        x.lines.forEach(function (l) {
          var row = document.createElement('div'), ic = document.createElement('hk-icon'), tx = document.createElement('span');
          ic.icon = l.k === 'light' ? 'hk:lightbulb' : 'hk:speaker';
          if (l.on) ic.style.color = l.k === 'light' ? C.ACCENTS.yellow : C.ACCENTS.pink;
          tx.textContent = l.text;
          if (!l.on) row.className = 'off';
          row.appendChild(ic); row.appendChild(tx); e.xw.appendChild(row);
        });
        e.xs.innerHTML = '';
        x.scenes.forEach(function (sc) {
          var b = document.createElement('button'), t = document.createElement('span');
          b.type = 'button'; b.className = 'sc'; t.textContent = sc.name; b.appendChild(t);
          b.setAttribute('aria-label', 'Run ' + sc.name);
          b.addEventListener('click', function (ev) { ev.stopPropagation(); var d = dom(sc.id), svc = d === 'scene' || d === 'script' ? 'turn_on' : 'press'; self._call(d, svc, { entity_id: sc.id }); });
          e.xs.appendChild(b);
        });
      }
      _roomPath(area) {
        var M = C.menu;
        try { return M && M.roomPath ? M.roomPath(area) : null; } catch (e) { return null; }
      }
      // ITS GLYPH (the Small tile's): the room page's own icon, as the dashboard's menu has it, else the sofa
      _roomGlyph(area) {
        var M = C.menu, cfg = null, icon = null;
        try { cfg = M && M.config ? M.config() : null; } catch (e) { cfg = null; }
        ((cfg && cfg.views) || []).forEach(function (view) {
          if (!icon && view && view.icon && (view.area === area || (view.strategy && view.strategy.area === area))) icon = view.icon;
        });
        var H = window.hkMenu && window.hkMenu._;
        return (H && H.glyph ? H.glyph(icon || 'mdi:sofa') : icon) || 'mdi:sofa';
      }
      // THE ROOM'S OWN WAYS IN -- the Small tile, the heading, "N More": where When Tapped says (its page, or the room as a
      // sheet, hk-room.js), the other when the screen has none of it. The Small tile IS the block's plate, so Nothing is
      // nothing there; the heading and "N More" say they open the room, so they still do (the page first).
      _openRoom(plate) {
        var a = this._area();
        if (!a || C.openTarget(this, this._tapTarget()) || plate) return;
        if (this._config.tap === 'none') C.openTarget({ _config: {} }, this._tapTarget());
      }
      // the room as a sheet: the room page's cards, in the shared detail sheet (hk-room.js hkRoom.openSheet)
      _openSheet() {
        var a = this._area(), R = window.hkRoom, h = this.client;
        if (!a || !R || typeof R.openSheet !== 'function') return false;
        return R.openSheet(a, { name: ((h && h.areas && h.areas[a]) || {}).name || a, icon: this._roomGlyph(a) });
      }
      // (the plate's tap, hk-base.js openTarget: the heading's, anywhere the block has no accessory) -- its page, else
      // (Detail Sheet first, or a screen with no page for the room) the room as a sheet (2026-11-09, the owner)
      _tapTarget() {
        var a = this._area(), self = this;
        return a ? [{ room: a }, { run: function () { if (!self._openSheet()) throw new Error('no sheet'); } }] : [];
      }

      // PRESS AND HOLD: the pill's own tap toggles; held still for HOLD_MS it
      // is the dimmer -- a drag up or down sets the brightness, sent once on
      // letting go -- or, held without moving, the light's sheet (its full
      // dimmer and colors). A light that doesn't dim opens its sheet at once.
      // The click that follows a hold is the hold's, not a toggle.
      _wireHold(slot, id) {
        var self = this, start = null, held = false, eat = false;
        var cancel = function () {
          if (self._holdT) { clearTimeout(self._holdT); self._holdT = null; }
        };
        slot.addEventListener('pointerdown', function (ev) {
          if (ev.button > 0) return;
          cancel();
          start = { x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
          held = false;
          self._holdT = setTimeout(function () {
            self._holdT = null;
            if (!start) return;
            held = true; eat = true;
            // the drag is the dimmer's now, not a swipe of the block's pages
            slot.setAttribute('data-hk-control', '');
            var st = self.client && self.client.states[id];
            if (!dims(id, st)) { start = null; window.hkShell.moreInfo(id, self); return; }
            start.pct = percent(st); start.now = start.pct; start.moved = false;
            try { slot.setPointerCapture(start.pid); } catch (e) { /* a test page */ }
            self._dimShow(slot, start.pct);
          }, HOLD_MS);
        });
        // Keep the initial move cancelable even over the child card's shadow
        // tree: a held light owns the gesture, a quick pan scrolls normally.
        slot.addEventListener('touchstart', function () {}, { passive: false });
        slot.addEventListener('touchmove', function (ev) { if (held && ev.cancelable) ev.preventDefault(); }, { passive: false });
        slot.addEventListener('pointermove', function (ev) {
          if (!start) return;
          var dy = ev.clientY - start.y, dx = ev.clientX - start.x;
          if (!held) {
            if (Math.hypot(dx, dy) > SLOP) { cancel(); start = null; }
            return;
          }
          if (Math.abs(dy) > SLOP) start.moved = true;
          if (!start.moved) return;
          ev.preventDefault();
          start.now = dragged(start.pct, dy);
          self._dimShow(slot, start.now);
        });
        var finish = function (send) {
          cancel();
          var s = start;
          start = null;
          slot.removeAttribute('data-hk-control');
          if (!held || !s) return;
          held = false;
          self._dimHide(slot);
          if (s.pct === undefined || !send) return;
          if (!s.moved) { window.hkShell.moreInfo(id, self); return; }
          var c = dimCall(id, s.now);
          self._call(c[0], c[1], c[2]);
        };
        slot.addEventListener('pointerup', function () { finish(true); });
        slot.addEventListener('pointercancel', function () { finish(false); });
        // the click after a hold: eaten before the pill sees it
        slot.addEventListener('click', function (ev) {
          if (!eat) return;
          eat = false;
          ev.stopPropagation();
          if (ev.preventDefault) ev.preventDefault();
        }, true);
        // a long press's own menu (Android, iOS) never shows over the dimmer
        slot.addEventListener('contextmenu', function (ev) { if (held || eat) ev.preventDefault(); });
      }
      _dimShow(slot, pct) {
        var d = slot.querySelector('.dim');
        if (!d) {
          d = document.createElement('div');
          d.className = 'dim';
          d.setAttribute('role', 'status');
          d.innerHTML = '<i></i><b></b>';
          slot.appendChild(d);
        }
        d.querySelector('i').style.height = pct + '%';
        d.querySelector('b').textContent = pct + '%';
      }
      _dimHide(slot) {
        var d = slot.querySelector('.dim');
        if (d && d.parentNode) d.parentNode.removeChild(d);
      }
    }

    // Resolve the actual room-page tile at runtime, with the card's own
    // client (including editor previews). Never store a client in grid config.
    // Settings changes and late registries/providers can then update the same
    // mounted card, including pages and conditional fallbacks.
    class HkGridEntityCard extends HkBase {
      static get CSS() { return ':host{display:block;height:100%}:host>div,:host>div>*{display:block;width:100%;height:100%}'; }
      static get observedAttributes() { return ['size', 'data-grid-pager', 'tile']; }
      attributeChangedCallback(name, was, now) {
        this._sizeChild();
        // (Centred names the room under the accessory: the tile is made again)
        // (...and a scene's line is what it does at Wide: made again for a new size)
        if ((name === 'tile' || name === 'size') && was !== now && this._config && this.client) this.redraw();
      }
      _tile() {
        var cfg = this._config || {}, h = this.client, t;
        if (!cfg.entity) return null;
        if (cfg.kind === 'scene') {
          var scenes = window.hkChip && window.hkChip.scenes;
          t = scenes && scenes.pill ? scenes.pill(h, cfg.entity) : { type: 'custom:hk-scene-card', entity: cfg.entity };
          // A SCENE BLOCK (2026-10-31, the owner's notes on the widget
          // mock-up): HomeView's tile on every dashboard, glass or on its own
          // color's gradient (`color`); at Wide its glyph beside its name and
          // what it does (hk-tile.js, :host([tile=centred][size=W]))
          var wide = (this.getAttribute('size') || cfg.size) === 'W';
          t = Object.assign({}, t, { elevated: false, room: wide ? sceneSays(h, cfg.entity) : 'Scene' }, cfg.color ? { block_color: true } : {});
        } else {
          var S = window.hkStrategy;
          t = S && S.tileFor && h ? S.tileFor(h, cfg.entity, friendly(h, cfg.entity)) : { type: 'custom:hk-tile-card', entity: cfg.entity };
          // COLOR (2026-11-07, the review: the Accessory block gains the option Scene and Accessories have): lit, on its own
          // color's gradient (hk-tile.js block_color)
          t = Object.assign({}, t, { secondary: cfg.secondary }, cfg.color ? { block_color: true } : {});
        }
        // The block owns geometry; the shared builder owns the accessory. (TINY, 2026-11-08, the owner: "essentially the
        // half height pill size": the Accessory Group's half pill -- its glyph beside its name -- in half a cell)
        var sz = this.getAttribute('size') || cfg.size, tiny = sz === 'XS';
        t.size = sz === 'W' || tiny ? 'regular' : 'tall';
        // (...on a HomeView-style screen HomeView's own tile at half height, its glyph bare and large: hk-tile.js tinyTile --
        // the owner, 2026-11-08: "it has to look like it belongs")
        this._tiny = tiny;
        if (tiny && this.getAttribute('tile') !== 'centred') { t.tile = 'home'; delete t.view_layout; delete t.hk_place; return t; }
        delete t.view_layout; delete t.hk_place;
        if (tiny) {
          t.size = 'tall'; delete t.icon_size; delete t.bare_icon; delete t.well_background;
          // (a sensor: its reading in the glyph's place, its room under its name -- as a Small one; hk-tile.js readingOf)
          var ra = cfg.entity.indexOf('sensor.') === 0 && areaOf(h, cfg.entity), rn = ra && ((h && h.areas) || {})[ra];
          if (rn && rn.name && !(cfg.secondary && cfg.secondary.mode && cfg.secondary.mode !== 'auto')) t.room = rn.name;
          return t;
        }
        // CENTRED (2026-10-30): the name over its room, as HomeView has it (a
        // scene's line says it is one); an accessory in no room keeps its state
        // -- and one whose Line Under Name is chosen shows that, not the room
        // (the owner, 2026-10-31: set to State, "it's still just showing Master Bedroom")
        var chosen = cfg.secondary && cfg.secondary.mode && cfg.secondary.mode !== 'auto';
        // ...and every glyph the block's own size, bare (the tile's Centred
        // rule): an accessory drawn at a room page's size (the alarm's 27 px)
        // was a speck beside the others (the owner, 2026-10-31)
        if (this.getAttribute('tile') === 'centred' || cfg.kind === 'scene') { delete t.icon_size; delete t.bare_icon; delete t.well_background; }
        if (this.getAttribute('tile') === 'centred' && !chosen && cfg.kind !== 'scene') {
          var area = areaOf(h, cfg.entity), areas = (h && h.areas) || {};
          var room = area && areas[area] && areas[area].name;
          if (room) t.room = room;
        }
        return t;
      }
      _sigOf() { return JSON.stringify(this._tile()); }
      _receiveClient() {
        super._receiveClient();
        if (this._child) window.hkHostClient.bridge(this._child, this.client);
      }
      _sizeChild() {
        if (!this._child) return;
        // (the half pill fills its half, as an Accessory Group's pills fill theirs: hk-chip.js data-group-fill)
        // (...its corners a block's, as a full-size HomeView tile's -- not the smaller ones of a pill inside a block)
        if (this._tiny) {
          var hv = this.getAttribute('tile') === 'centred';
          if (hv) { this._child.setAttribute('size', 'XS'); this._child.setAttribute('tile', 'centred'); } else { this._child.removeAttribute('size'); this._child.removeAttribute('tile'); }
          this._child.setAttribute('data-group-fill', '');
          if (this.hasAttribute('data-grid-pager')) this._child.setAttribute('data-grid-pager', ''); else this._child.removeAttribute('data-grid-pager');
          this._child.style.setProperty('--hk-inner-radius', 'var(--hk-block-radius, ' + window.hkCards.M.radius + ')');
          return;
        }
        this._child.removeAttribute('data-group-fill'); this._child.style.removeProperty('--hk-inner-radius');
        this._child.setAttribute('size', this.getAttribute('size') || (this._config || {}).size || 'S');
        if (this.hasAttribute('data-grid-pager')) this._child.setAttribute('data-grid-pager', '');
        else this._child.removeAttribute('data-grid-pager');
        if (this.getAttribute('tile') === 'centred' || (this._config || {}).kind === 'scene') this._child.setAttribute('tile', 'centred');
        else this._child.removeAttribute('tile');
      }
      _render() {
        var t = this._tile();
        if (!t) return;
        var key = JSON.stringify(t);
        if (key !== this._tileKey) {
          if (this._child && this._childType === t.type) this._child.setConfig(t);
          else {
            this._child = C.createCard(t, this.client);
            this._root.replaceChildren(this._child);
          }
          this._childType = t.type; this._tileKey = key;
        }
        this._sizeChild();
      }
    }

    // Custom collections share the room's plate, fixed rows and accessory
    // controls; their ordered contents and captions belong to this block.
    class HkGridAccessoriesCard extends HkGridRoomCard {
      _area() { return null; }
      _roomPath() { return null; }
      // ("N more": every accessory it names, in a sheet)
      _openRoom() {
        var D = window.hkDetail, ids = (this._config.accessories || []).map(function (a) { return a.entity; }).filter(Boolean);
        if (D && D.openGroup) D.openGroup(this._config.title || 'Accessories', ids, { icon: 'mdi:view-grid' });
      }
      _sigOf() { return super._sigOf() + JSON.stringify(this._config.accessories || []); }
      // HEIGHT AND COLOR (2026-10-31, the owner's notes on the widget
      // mock-up): the block is its tiles (2026-11-08: under a label row). Full, HomeView's tile
      // (Centred, the state under the name) on any dashboard -- W two, L
      // four, XL six; Half, the Home app's pill, as many rows as the block
      // holds. Color: each one lit on its own color.
      // THE TILES ARE A DESIGNED SIZE (2026-11-08, round three: hk-chip.js groupGeom) -- the same for one accessory as for
      // a full block, the group centered; more than the places, "+N more" in the label row (it opens them all in a sheet).
      // (Half's rows the pill's 70 px, 2026-11-01, never stretched: four in a Large block on square cells, three on tiles)
      _plan() {
        var client = this.client, size = this._size(), cfg = this._config;
        // (a Wide block on a tile cell has no room for HomeView's tile under its heading: the Home app's pill row, as the Room block's)
        // (Small: two half-height pills unless Full is chosen -- 2026-11-08)
        var sq = window.hkChip.cellSquare(this), half = cfg.height === 'half' || (size === 'W' && !sq) || (size === 'S' && cfg.height !== 'full');
        // (a page of an Accessory Group keeps its foot for the pager's dots, as a Room does: its tiles under the label, not over it -- 2026-11-08)
        // A TITLE ONLY WHEN IT SAYS SOMETHING (2026-11-08, the owner: "I'm not sure any cards need titles ... most cards should be self
        // explanatory"): the label row is a title the block was given ("Kitchen"), never a generic "Accessories"; without it the tiles
        // have the whole block and "N More" is the last place, a tile like the others
        var lbl = !!cfg.label;
        var gm = this._geom(size, half, lbl ? this._head(size) : 0, this.hasAttribute('data-grid-pager') ? 24 : 0), all = cfg.accessories || [];
        var over = all.length > gm.n, entries = all.slice(0, over && !lbl ? Math.max(0, gm.n - 1) : gm.n);
        var tiles = entries.map(function (entry) {
          var S = window.hkStrategy, id = entry.entity;
          var t = S && S.tileFor && client ? S.tileFor(client, id, friendly(client, id)) : { type: 'custom:hk-tile-card', entity: id };
          t = Object.assign({}, t, { secondary: entry.secondary });
          if (dom(id) === 'light') t.tap_action = { action: 'toggle' };
          // (Full: every glyph the tile's own size, bare -- as a Centred block's: hk-grid-entity-card)
          if (!half) { delete t.icon_size; delete t.bare_icon; delete t.well_background; }
          return t;
        });
        return { area: null, size: size, tiles: tiles, more: lbl ? 0 : all.length - entries.length, hmore: lbl ? all.length - entries.length : 0,
                 lbl: lbl, head: lbl ? undefined : false, name: cfg.title || 'Accessories',
                 empty: 'Choose accessories in the editor', geom: gm, half: half, centred: !half, color: !!cfg.color };
      }
      // the label row's room: its 19 px row and the 8 px under it (hk-chip.js GROUP_HEAD)
      _head(size) { return size ? window.hkChip.groupHead : 0; }
      _render() {
        super._render();
        this._e.nm.disabled = true;
      }
    }

    // what the shell and the later parts use of this one
    K.HkGridAccessoriesCard = HkGridAccessoriesCard; K.HkGridEntityCard = HkGridEntityCard;
    K.HkGridRoomCard = HkGridRoomCard;
  };
})();
