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
        dragged = K.dragged, fit = K.fit, friendly = K.friendly, GAP = K.GAP, HkBase = /** @type {HkLooseElementConstructor} */ (K.HkBase), HOLD_MS = K.HOLD_MS,
        layout = K.layout, percent = K.percent, pill = K.pill, PILL_H = K.PILL_H, roomLine = K.roomLine,
        roomOf = K.roomOf, roomParts = K.roomParts, sceneSays = K.sceneSays, sizeOf = K.sizeOf, SLOP = K.SLOP,
        speakerOf = K.speakerOf, TABLET_ROOM = K.TABLET_ROOM, type = K.type, v = K.v;

    // ===================================================== hk-grid-room-card
    var ROOM_CSS = [
      ':host{display:block;height:100%;position:relative}',
      '.room{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('14px') + ';gap:8px;' + C.plate('card') + ';',
      '  --hk-pill:100%}',
      // THE NAME (the widget mock-up, 2026-10-31): Wide, a headline with what
      // the room is doing at its right on the same line; Large and up, a
      // title with that line under it -- and the way into its page, when it has one
      '.hd{display:flex;align-items:baseline;gap:10px;min-width:0;flex:none;padding:0 2px}',
      '.room:not([size=W]) .hd{flex-direction:column;align-items:flex-start;gap:1px}',
      '.nm{all:unset;position:relative;cursor:pointer;min-width:0;max-width:100%;display:flex;align-items:center;gap:5px;',
      '  ' + type('headline') + ';line-height:22px;color:' + v('ink') + ';text-shadow:' + v('glow') + ';-webkit-tap-highlight-color:transparent}',
      '.room:not([size=W]) .nm{' + type('title') + ';line-height:27px}',
      // a 44 px target round the line (DESIGN.md: touch targets)
      '.nm::after{content:"";position:absolute;left:-8px;right:-8px;top:-12px;bottom:-12px}',
      '.nm:disabled{cursor:default}',
      '.nm span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0 2px 1px}',
      '.nm i{font-style:normal;opacity:0.62;flex:none}',
      '.nm:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
      '.st{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';text-shadow:' + v('glow') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.room[size=W] .st{margin-left:auto}',
      '.st:empty{display:none}',
      // THE TILES, in whole rows, 8 px apart (the mock-up's tight grid)
      '.tiles{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));',
      '  grid-template-rows:repeat(var(--rows,2),minmax(0,1fr));gap:' + GAP + 'px;flex:1;min-height:0}',
      // ...or scrolling: as many rows showing as the block has, the rest
      // under them -- up and down is the room's, sideways the pager's
      // ...or HALF (an Accessories block's Height, 2026-11-01, the owner: "Half Height cards should be the height
      // of a standard pill card... not stretch itself out", DESIGN.md: Half is the Home app's button): rows the
      // pill's own 70 px, from the top, as many as fit
      '.tiles.half{grid-template-rows:repeat(var(--rows,2),' + PILL_H + 'px);align-content:start}',
      // ...scrolling, a Wide Room's: a pill's height each, the rest under them -- or the height there is, when the foot
      // line leaves less (~62 px on 150 px tiles): one whole row in sight, never one cut through
      '.tiles.scrolling.half{grid-template-rows:none;grid-auto-rows:min(' + PILL_H + 'px,100%)}',
      '.tiles.scrolling{grid-template-rows:none;grid-auto-rows:calc((100% - var(--scroll-gaps,' + GAP + 'px))/var(--rows,2));align-content:start;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scrollbar-width:none}',
      '.tiles.scrolling::-webkit-scrollbar{display:none}',
      '.tiles.scrolling .slot{touch-action:pan-x pan-y}',
      // (a slot is a cell of its own, not the grid's: it is no square because the grid's cells are -- hk-layout.js)
      '.slot{container-type:size;container-name:hk-cell;--hk-cell-shape:none;min-width:0;min-height:0}.slot > *{display:block;width:100%;height:100%}',
      '.more{border:0;border-radius:var(--hk-inner-radius,' + v('glass-radius') + ');' + C.plate('tile') + ';color:' + v('ink') + ';' + type('body') + ';min-height:44px;cursor:pointer}',
      '.slot{position:relative;touch-action:pan-x;-webkit-user-select:none;user-select:none;',
      '  -webkit-touch-callout:none}',
      '.none{' + type('body') + ';color:' + v('ink-3') + ';text-shadow:' + v('glow') + '}',
      // THE FOOT LINE (the owner, 2026-10-31: "dots for the rooms, then 'N
      // more below' (dots, not '1 of 4 rooms')"): one short line, centred --
      // the rooms' dots when the block pages through them, a tap beside the
      // current one a room back or on, and what is scrolled out of sight
      '.ft{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;height:16px;min-width:0;' + type('micro') + ';line-height:16px;color:' + v('ink-2') + ';text-shadow:' + v('glow') + '}',
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
      '.dim b{position:relative;' + type('title') + ';color:' + v('ink') + ';font-variant-numeric:tabular-nums}'
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
      // what it draws, in one go: the room, its pills, its line
      /** @returns {any} */
      _plan() {
        var h = this.client, size = this._size(), area = this._area();
        if (!h || !h.states || !area) return { area: area, size: size, tiles: [], status: '', name: '' };
        var parts = roomParts(h, area), name = (h.areas[area] || {}).name || area, status = roomLine(h, area, parts, size);
        // A WIDE ROOM'S ROW is the Home app's pill (2026-11-01, the owner: "half cards need to be fixed here like we did on
        // the Accessories card"): 70 px from the top, the glyph beside the words, never a Centred tile squeezed into a
        // short row (stretched to 86 px, or cut through its second line at 62)
        var half = size === 'W';
        if (this._config.accessory_display === 'scroll') {
          return { area: area, size: size, scroll: true, half: half, more: 0, name: name, status: status,
                   tiles: parts.all.map(function (c) { return pill(c, ['light', 'switch', 'input_boolean', 'fan'].indexOf(dom(c.entity)) >= 0); }) };
        }
        // (the foot line's room, when it pages: hk-layout.js leaves a paged room its own dots)
        var places = fit(size, this._height() - (this.hasAttribute('data-grid-pager') ? 24 : 0));
        var total = parts.lights.length + (speakerOf(h, parts.speakers) ? 1 : 0), more = total > places;
        return { area: area, size: size, parts: parts, tiles: layout(parts, size, Math.max(0, places - (more ? 1 : 0)), h),
                 more: more ? total - Math.max(0, places - 1) : 0, name: name, status: status, half: half };
      }
      _sigOf() {
        var p = this._plan();
        this._p = p;
        return JSON.stringify([p.area, p.size, p.name, p.status, p.more, !!p.scroll, this._config.surface, p.tiles.map(function (t) { return t.entity; }),
                               this._height(), !!window.hkStrategy, !!window.hkRoom, this.getAttribute('tile')]);
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
            '<i aria-hidden="true">›</i></button><span class="st"></span></div>' +
            '<div class="tiles" role="list"></div>' +
            '<div class="ft" hidden><button class="fd" type="button"></button><b></b><span></span></div></div>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { box: q('.room'), hd: q('.hd'), nm: q('.nm'), name: q('.nm span'), chev: q('.nm i'), st: q('.st'), tiles: q('.tiles'),
                      ft: q('.ft'), fd: q('.fd'), sep: q('.ft b'), below: q('.ft span') };
          this._e.nm.addEventListener('click', function (e) { e.stopPropagation(); self._openRoom(); });
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
        C.groupSurface(e.box, this._config.surface);
        e.hd.style.display = p.head === false ? 'none' : '';
        // HOW MANY ACROSS AND DOWN: the block's own (Accessories: by its
        // Height), else the room's columns and its rows -- as many pills as
        // it has fill the block: fewer than a row's worth, one row of taller
        // ones, not a second row of nothing (2026-10-30)
        var nPills = (p.tiles || []).length + (p.more ? 1 : 0), cols = p.cols || COLS[p.size];
        var oneRow = p.size !== 'W' && !p.scroll && nPills > 0 && nPills <= cols;
        var rows = p.rows || (p.size === 'W' || oneRow ? 1 : 2);
        e.tiles.style.setProperty('--cols', String(cols));
        e.tiles.style.setProperty('--rows', String(rows));
        e.tiles.style.setProperty('--scroll-gaps', ((rows - 1) * GAP) + 'px');
        e.tiles.classList.toggle('scrolling', !!p.scroll);
        e.tiles.classList.toggle('half', !!p.half);
        if (e.name.textContent !== (p.name || 'Room')) e.name.textContent = p.name || 'Room';
        if (e.st.textContent !== (p.status || '')) e.st.textContent = p.status || '';
        var path = this._roomPath(p.area);
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
        var key = JSON.stringify([p.tiles, p.more, p.size, !!p.scroll, centred, !!p.half, !!p.color]);
        if (key !== this._key) {
          this._key = key;
          e.tiles.innerHTML = '';
          this._kids = [];
          if (!p.tiles.length) {
            var none = document.createElement('div');
            none.className = 'none';
            none.textContent = p.empty || (p.area ? (p.size === 'W' ? '' : (p.scroll ? 'No accessories in this room' : 'No lights in this room')) : 'No room');
            e.tiles.appendChild(none);
          }
          p.tiles.forEach(function (t) {
            var slot = document.createElement('div');
            slot.className = 'slot';
            var tall = p.size !== 'W' && !p.half;
            if (tall) slot.setAttribute('size', 'S');
            slot.setAttribute('role', 'listitem');
            // (Wide: a row of the room's regular pills -- a thermostat's too, whose tall tile was cut above the foot line)
            var cfg = Object.assign({}, t, p.half ? { size: 'regular', tile: 'home' } : tall ? { size: 'tall' } : { size: 'regular' }, p.color ? { block_color: true } : {});
            // (Centred: every glyph the tile's own size, bare, as an Accessories block's Full -- a room's pills kept the
            // room page's icon size and well, so a Room block's glyphs were a third the size: the owner, 2026-11-01)
            if (centred) { delete cfg.icon_size; delete cfg.bare_icon; delete cfg.well_background; }
            var el = C.createCard(cfg, h);
            if (tall) el.setAttribute('size', 'S');
            el.setAttribute('data-group-fill', '');
            if (centred) el.setAttribute('tile', 'centred');
            slot.appendChild(el);
            e.tiles.appendChild(slot);
            self._kids.push(el);
            if (t.tap_action && dom(t.entity) === 'light') self._wireHold(slot, t.entity);
          });
          if (p.more) {
            var more = document.createElement('button'); more.className = 'more';
            more.textContent = '+' + p.more + ' more';
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
        this._scrolls = !!p.scroll && p.tiles.length > cols * rows;
        e.ft.hidden = !pg && !this._scrolls;
        this._below();
      }
      // "N MORE BELOW": the tiles not wholly in sight under the scroll's foot
      // (none once it is scrolled to the end)
      _below() {
        var e = this._e;
        if (!e) return;
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
      _roomPath(area) {
        var M = C.menu;
        try { return M && M.roomPath ? M.roomPath(area) : null; } catch (e) { return null; }
      }
      _openRoom() {
        var path = this._roomPath(this._area());
        if (path) C.navigate(path, this);
      }
      // (the plate's tap, hk-base.js openTarget: the heading's, anywhere the block has no accessory)
      _tapTarget() { var a = this._area(); return a ? [{ room: a }] : []; }

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
          t = Object.assign({}, t, { secondary: cfg.secondary });
        }
        // The block owns geometry; the shared builder owns the accessory.
        t.size = (this.getAttribute('size') || cfg.size) === 'W' ? 'regular' : 'tall';
        delete t.view_layout; delete t.hk_place;
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
      _openRoom() {}
      _sigOf() { return super._sigOf() + JSON.stringify(this._config.accessories || []); }
      // HEIGHT AND COLOR (2026-10-31, the owner's notes on the widget
      // mock-up): the block is its tiles, no heading. Full, HomeView's tile
      // (Centred, the state under the name) on any dashboard -- W two, L
      // four, XL six; Half, the Home app's pill, twice as many rows. The grid
      // takes as many as are chosen, never an empty row (as Scenes does:
      // hk-chip.js scenesPlan). Color: each one lit on its own color.
      // (Half's rows the pill's 70 px, 2026-11-01, never stretched: as many as
      // the block's height holds -- four in a Large block on square cells,
      // three on 150 px tiles)
      _plan() {
        var client = this.client, size = this._size(), cfg = this._config, half = cfg.height === 'half';
        var cell = C.HOME_GRID.sizes[size] || [2, 2], cols = cell[0], rows = cell[1] * (half ? 2 : 1);
        if (half) rows = Math.max(1, Math.min(rows, this._halfRows()));
        var entries = (cfg.accessories || []).slice(0, cols * rows), n = entries.length;
        if (n <= cols) { cols = Math.max(1, n); rows = 1; } else rows = Math.ceil(n / cols);
        var tiles = entries.map(function (entry) {
          var S = window.hkStrategy, id = entry.entity;
          var t = S && S.tileFor && client ? S.tileFor(client, id, friendly(client, id)) : { type: 'custom:hk-tile-card', entity: id };
          t = Object.assign({}, t, { secondary: entry.secondary });
          if (dom(id) === 'light') t.tap_action = { action: 'toggle' };
          // (Full: every glyph the tile's own size, bare -- as a Centred block's: hk-grid-entity-card)
          if (!half) { delete t.icon_size; delete t.bare_icon; delete t.well_background; }
          return t;
        });
        return { area: null, size: size, tiles: tiles, more: 0, name: cfg.title || 'Accessories', empty: 'Choose accessories in the editor',
                 head: false, cols: cols, rows: rows, half: half, centred: !half, color: !!cfg.color };
      }
      // how many 70 px rows the tiles' place holds (the block less its inset, before it is laid out)
      _halfRows() {
        var t = this._e && this._e.tiles, room = t && t.clientHeight ? t.clientHeight : this._height() - 36;
        return Math.floor((room + GAP) / (PILL_H + GAP));
      }
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
