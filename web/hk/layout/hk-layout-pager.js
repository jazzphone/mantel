// hk-layout-pager.js - the pager.
//
// PART OF THE LAYOUT CARDS (hk-layout.js). Not a card and not run on its own: it registers one
// function, which hk-layout.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkLayoutParts = window.hkLayoutParts || {})['hk-layout-pager'] = function (K) {
    var HkBase = K.HkBase, passTile = K.passTile;

    // ---------------------------------------------------------- hk-pager-card
    //
    // A HOME GRID BLOCK THAT SWIPES (docs/phase11/HOME-GRID.md, "Blocks that
    // swipe"): its pages side by side, one cell wide, and dots at their foot. Only a block swipes, never the screen.
    //
    // The catalog builds it for a block with `pages` (hk-grid-catalog.js
    // config()): { item, ctx } -- the block as it is stored, and the house as the
    // screen sees it. Its pages are the catalog's (pages()), asked again when
    // the Music feature's speakers change, for a `speakers` block. A page's card
    // is made when it is on screen or next to it, and kept.
    //
    // THE START PAGE: the first; with `start: tablet_room` (rooms, thermostats)
    // the tablet's room's; a speakers block's the one playing, else this
    // user's own speaker, else the tablet's room's. It goes back there when the
    // screen's Return to Home timer fires (hk-idle.js: away() while it is off
    // its start page, then the window event hk-idle-return), so the kitchen
    // tablet doesn't stay on the den. A doorbell ring (the house's notification,
    // kind doorbell) turns a cameras block to the doorbell's page.
    //
    // GESTURES (2026-10-23: the browser's own scroll-snap missed about one
    // swipe in six -- a short flick snapped back, and a swipe on the dots went
    // nowhere; tools/headless/pager_swipe_check.py measures it). The track is
    // a scroller no finger can move: each page says touch-action pan-y, so an
    // up-and-down pan stays the browser's (a room that scrolls still does) and
    // a sideways one comes here as pointer events -- touch, pen and mouse
    // alike. The pager follows the finger and, on letting go, turns a page if
    // it went a fifth of the way or was flicked; else it goes back. A row inside
    // a page that really scrolls sideways keeps its own swipe (the browser
    // pans it and cancels ours).
    //
    // It claims only a drag that starts outside a control: one that starts on
    // a slider, the thermostat's dial (touch-action pan-y or none, a range,
    // role slider, data-hk-control) is the control's, and so is one in the left
    // 20 px, which are the menu's edge swipe. Taking the drag, it cancels the
    // touch for the card under it (pointercancel), as a browser's scroll does,
    // so a light's press-and-hold never fires mid-swipe; a light that is
    // already its dimmer says data-hk-control and keeps the drag.
    //
    // The dots are iOS's page control: one small group, centred, a dot every
    // PAGER_PITCH px (never a dot to a 44 px slot, which spread nine rooms'
    // dots across the whole block). The group is the target, as UIPageControl
    // is: 44 px tall, a tap on a dot goes to its page, a tap beside the
    // current one steps a page that way. Each page and dot is called "2 of 5";
    // a change is said politely, so VoiceOver hears where it is.
    var PAGER_EDGE = 20;          // the menu's edge swipe (hk-menu.js .edge)
    var PAGER_DOTS = 20;          // the dots' overlay at the page's foot, px
    var PAGER_DOT = 7;            // a dot, px (iOS's page control)
    var PAGER_PITCH = 16;         // dot to dot, px (iOS's: 7 px dots, 9 px apart)
    var PAGER_ROOM = 28;          // the plates' shadow room: as far as their shadows show
    var PAGER_GUTTER = 10;        // the grid's gap when it gives none (--g-gap: hk-home-grid-view)
    var PAGER_SLOP = 8;           // px a finger moves before it is a drag (and which way)
    var PAGER_TURN = 0.2;         // of a page's width: a drag that far turns it
    var PAGER_FLICK = 0.3;        // px/ms: a flick that fast turns it, however short
    var PAGER_STILL = 180;
    var PAGER_HANDS_OFF = 60000;  // ms after a swipe that a following block keeps still        // ms without a scroll: the track has come to rest
    var pagerSeq = 0;
    function pagerAreaOf(client, id) {
      var e = ((client && client.entities) || {})[id] || {}, devs = (client && client.devices) || {};
      return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
    }
    // WHICH PAGE TO START ON. live: { room, states, home } -- the tablet's
    // room, the house's states, this user's own speaker (hkMusic.home()).
    function pagerStart(pages, item, live) {
      var p = (item && item.pages) || {}, L = live || {}, list = pages || [];
      var at = function (fn) { for (var i = 0; i < list.length; i++) if (fn(list[i])) return i; return -1; };
      var i = -1;
      if (p.source === 'speakers') {
        i = at(function (pg) { var st = pg.entity && (L.states || {})[pg.entity]; return !!(st && st.state === 'playing'); });
        if (i < 0 && L.home) i = at(function (pg) { return pg.entity === L.home; });
        if (i < 0 && L.room) i = at(function (pg) { return pg.area === L.room; });
      } else if (p.source === 'rooms') {
        // A chosen room is the opening page, not an option silently replaced
        // by the automatic room list. Legacy tablet-room starts still work.
        var room = item && item.opts && item.opts.area;
        if (room === 'tablet_room' || (!room && p.start === 'tablet_room')) room = L.room;
        if (room) i = at(function (pg) { return pg.area === room; });
      } else if (p.start === 'tablet_room' && L.room && p.source === 'thermostats') {
        i = at(function (pg) { return pg.area === L.room; });
      }
      return i < 0 ? 0 : i;
    }
    // THE DOORBELL'S PAGE: the camera the ring names, else one called doorbell
    // A CAMERAS BLOCK THAT FOLLOWS (2026-10-24, the owner: "like the camera
    // strip does"; the block's `follow`): the page whose camera to show.
    //   selector  the select / input_select the block names, else the screen's
    //             Live Camera Follows (board camera_live), its option naming a
    //             camera as the strip's do (hk-cameras.js _optionOf: the
    //             camera's name, or the first words of it)
    //   motion    the camera in the room where motion was seen: a motion,
    //             occupancy or moving sensor on now (the latest to turn on),
    //             else the latest to change in the last PAGER_MOTION_MS
    // live: { states, entities, devices, board }. -1: nothing to follow.
    var PAGER_MOTION_MS = 15 * 60000;
    var PAGER_MOTION = { motion: 1, occupancy: 1, moving: 1, presence: 1 };
    function pagerFollow(pages, item, live) {
      var o = (item && item.opts) || {}, L = live || {}, st = L.states || {}, list = pages || [];
      if (!o.follow || !(item.pages && item.pages.source === 'cameras')) return -1;
      if (o.follow === 'selector') {
        var sel = o.follow_select || (L.board || {}).camera_live, ss = sel && st[sel];
        if (!ss || !ss.state) return -1;
        var want = String(ss.state).toLowerCase();
        for (var i = 0; i < list.length; i++) {
          var cs = st[list[i].entity], n = String((cs && cs.attributes && cs.attributes.friendly_name) || list[i].entity || '').toLowerCase();
          if (n === want || n.indexOf(want + ' ') === 0 || String(list[i].entity) === sel) return i;
        }
        return -1;
      }
      if (o.follow !== 'motion') return -1;
      var rooms = {};
      list.forEach(function (pg, k) { if (pg.area && rooms[pg.area] === undefined) rooms[pg.area] = k; });
      var client = { entities: L.entities || {}, devices: L.devices || {} }, now = Date.now(), best = null;
      Object.keys(st).forEach(function (id) {
        if (id.split('.')[0] !== 'binary_sensor') return;
        var s0 = st[id], a = s0.attributes || {}, e = (L.entities || {})[id] || {};
        if (!PAGER_MOTION[a.device_class] || e.hidden || e.disabled_by) return;
        var room = pagerAreaOf(client, id);
        if (room === null || rooms[room] === undefined) return;
        var at = Date.parse(s0.last_changed || s0.last_updated || '') || 0, on = s0.state === 'on';
        if (!on && now - at > PAGER_MOTION_MS) return;
        // on beats off; then the latest
        if (!best || (on && !best.on) || (on === best.on && at > best.at)) best = { on: on, at: at, page: rooms[room] };
      });
      return best ? best.page : -1;
    }
    function pagerDoorbell(pages, camera) {
      var list = pages || [], i;
      for (i = 0; camera && i < list.length; i++) if (list[i].entity === camera) return i;
      for (i = 0; i < list.length; i++) if (/doorbell/.test(String(list[i].entity || ''))) return i;
      return -1;
    }
    // NO SLIDE for a dot's tap under Reduce Motion, nor in Flat (its motion
    // off: hkSettings.rendering()): the page is simply there
    function pagerCalm() {
      try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch (e) { /* none */ }
      var HS = window.hkSettings, r = null;
      try { r = HS && typeof HS.rendering === 'function' ? HS.rendering() : null; } catch (e) { r = null; }
      return !!(r && r.motion === false);
    }
    // A CONTROL that owns its own sideways drag
    function pagerControl(el) {
      if (!el || el.nodeType !== 1 || !el.getAttribute) return false;
      if (el.localName === 'input' && String(el.type || el.getAttribute('type')).toLowerCase() === 'range') return true;
      if (el.getAttribute('role') === 'slider' || el.hasAttribute('data-hk-control')) return true;
      var ta = '';
      try { ta = typeof getComputedStyle === 'function' ? getComputedStyle(el).touchAction : ''; } catch (e) { ta = ''; }
      ta = ta || (el.style && el.style.touchAction) || '';
      return ta === 'none' || ta === 'pan-y';
    }
    // DOES THE PAGER TAKE THIS TOUCH: path is the event's composed path, from
    // the element touched up to (not past) `stop`; x its clientX. The pager's
    // own parts (a page, the dots: data-pager-part) are never a control.
    function pagerClaims(path, x, stop) {
      if (typeof x === 'number' && x < PAGER_EDGE) return false;
      var list = path || [];
      for (var i = 0; i < list.length && list[i] !== stop; i++) {
        var el = list[i];
        if (el && el.hasAttribute && el.hasAttribute('data-pager-part')) continue;
        if (pagerControl(el)) return false;
      }
      return true;
    }

    class HkPagerCard extends HkBase {
      static get CSS() {
        var C0 = window.hkCards, v = C0.v, S = PAGER_ROOM;
        // (:host>div: the card's own root, which holds the pager)
        //
        // THE PLATES' SHADOWS: a page's card fills the page, so the track
        // reaches S px past the block on every side (a negative margin, its
        // padding the same) and the pages are 2S apart: at rest a page's
        // shadow shows, its neighbour doesn't. The track takes no touches of
        // its own -- it reaches over the blocks beside it; its pages do.
        return ':host{display:block;position:relative;height:100%}:host>div{height:100%}' +
          '.pager{position:relative;display:flex;flex-direction:column;height:100%}' +
          // WHILE A PAGE MOVES it is a whole block (its corners, rim, shadow),
          // cut off halfway into the gutter beside the block (.win: half the
          // grid's --g-gap each side), never over the blocks beside it. Cut at
          // the block's edge, a frame stayed put as the pages slid through it
          // (the owner, 2026-11-06: "the whole block should move"). Sideways
          // only, and clip, not clip-path: no backdrop root for the shared blur.
          '.win{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;' +
          'margin:0 calc(var(--g-gap, ' + PAGER_GUTTER + 'px) / -2);padding:0 calc(var(--g-gap, ' + PAGER_GUTTER + 'px) / 2)}' +
          '.pager.moving .win{overflow-x:clip;overflow-y:visible}' +
          '.track{flex:1 1 auto;min-height:0;display:flex;gap:' + (2 * S) + 'px;margin:-' + S + 'px -' + S + 'px -' + S + 'px;' +
          // STILL A SIDEWAYS SCROLLER (overflow-x auto), though no finger
          // scrolls it (its pages say pan-y; the pager sets scrollLeft): the
          // shared blur (hk-glass.js) puts its layer inside the nearest
          // scroller, so the frost rides along with the pages. A clipped box
          // here left the layer on the page, re-measured behind the moving
          // pages -- the background slid out of line in Safari (2026-10-23).
          'padding:' + S + 'px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none}' +
          '.track::-webkit-scrollbar{display:none}' +
          '.track{pointer-events:none}.page{pointer-events:auto}' +
          '.track.dragging{cursor:grabbing;user-select:none;-webkit-user-select:none}' +
          // each page is the cell its card lays itself out in (hk-cell): the
          // full block size; dots sit inside its foot so adjacent plates align
          '.page{position:relative;flex:0 0 100%;width:100%;height:100%;min-width:0;' +
          'touch-action:pan-y;container-type:size;container-name:hk-cell}' +
          '.page>*{display:block;box-sizing:border-box;width:100%;height:100%;margin:0!important}' +
          '.dots{position:absolute;bottom:0;left:0;right:0;z-index:1;height:' + PAGER_DOTS + 'px;min-height:0;' +
          'display:flex;justify-content:center;align-items:flex-end;min-width:0;pointer-events:none}' +
          '.pc{position:relative;display:flex;flex:none;box-sizing:border-box;max-width:calc(100% - 12px);align-items:flex-end;justify-content:center;height:44px;padding:0 10px;pointer-events:auto;' +
            'cursor:pointer;' +
          'touch-action:pan-y;-webkit-tap-highlight-color:transparent}' +
          '.pc::before{content:"";position:absolute;bottom:3px;left:0;right:0;height:16px;border-radius:' + C0.R.capsule('16px') + ';background:rgba(30,30,36,.22);pointer-events:none}' +
          '.pager.one .dots,.pager.own .dots{display:none}' +
          // 44 px targets, reaching up over the page's foot
          '.dot{flex:0 1 ' + PAGER_PITCH + 'px;min-width:0;height:44px;margin:0;padding:0 0 7px;border:0;background:none;' +
          'display:flex;align-items:flex-end;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
          // a dot: the surface scale's `mark` (as notches and ticks are), the
          // page it is on in `ink`; a fade between them, none for Reduce Motion
          '.dot i{position:relative;display:block;width:' + PAGER_DOT + 'px;height:' + PAGER_DOT + 'px;border-radius:50%;background:' + v('mark') + ';' +
          'transition:background-color ' + C0.DUR.fade + ' ease}' +
          '.dot[aria-current=true] i{background:' + v('ink') + '}' +
          '@media (prefers-reduced-motion:reduce){.dot i{transition:none}}' +
          '.say{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}';
      }
      setConfig(config) {
        if (!config || !config.item) throw new Error('hk-pager: `item` (a Home Grid block) is required');
        this._key = this._key || ('pager-' + (++pagerSeq));
        this._moved = false;
        this._pgSig = null;
        this._pages = null;                       // a new block starts at its start
        super.setConfig(config);
      }
      getCardSize() { return 4; }
      // the pages' signature: a speakers block's change with the Music
      // feature's speakers; every other block's are its config's
      _sigOf() {
        var it = (this._config || {}).item || {};
        return it.pages && it.pages.source === 'speakers' ? this._pageSig(this._pageList()) : 'static';
      }
      _pageSig(pages) { return pages.map(function (p) { return (p.entity || p.area || '') + ''; }).join('|') + '#' + pages.length; }

      _ctx() {
        var cfg = this._config || {}, ctx = Object.assign({}, cfg.ctx || {});
        var it = cfg.item || {};
        if (it.pages && it.pages.source === 'speakers') {
          var HM = window.hkMusic, client = this.client;
          var sp = HM && HM.speakers ? HM.speakers() : [];
          // each room's speaker first, then the groups
          sp = sp.filter(function (s) { return !s.members; }).concat(sp.filter(function (s) { return !!s.members; }));
          ctx.speakers = sp.map(function (s) { return { entity: s.entity, area: pagerAreaOf(client, s.entity) }; });
        }
        return ctx;
      }
      _pageList() {
        var G = window.hkGridCatalog;
        return G && G.pages ? G.pages((this._config || {}).item, this._ctx()) : [];
      }
      _live() {
        var client = this.client, G = window.hkGridCatalog, HM = window.hkMusic;
        var M = window.hkCards && window.hkCards.menu;
        return { room: G && G.tabletRoom ? G.tabletRoom(client) : null,
                 states: (client && client.states) || {},
                 entities: (client && client.entities) || {}, devices: (client && client.devices) || {},
                 board: (M && M.board ? M.board() : null) || {},
                 home: HM && HM.home ? HM.home() : null };
      }
      // a following block starts (and comes back) on the camera it follows
      _startIndex() {
        var item = (this._config || {}).item, live = this._live(), f = pagerFollow(this._pages || [], item, live);
        return f >= 0 ? f : pagerStart(this._pages || [], item, live);
      }

      _render() {
        var pages = this._pageList(), sig = this._pageSig(pages);
        if (this._built && sig === this._pgSig) return;
        // a rebuild (a speaker came or went, a new size) keeps the page it was on
        var keep = this._pages && this._index >= 0 ? this._pages[this._index] : null;
        this._built = true;
        this._pgSig = sig;
        this._pages = pages;
        this._els = [];
        var self = this, n = pages.length, size = ((this._config || {}).item || {}).size;
        var root = this._root;
        root.innerHTML = '';
        var pager = document.createElement('div');
        // (a Room or Accessories block draws its pages' dots in its own foot line -- two rows of dots otherwise, 2026-11-08 --
        // hk-grid-cards.js, 2026-10-31)
        pager.className = 'pager' + (n < 2 ? ' one' : '') + (/^(room|accessories)$/.test(((this._config || {}).item || {}).card || '') ? ' own' : '');
        var track = document.createElement('div');
        track.className = 'track';
        var dots = document.createElement('div');
        dots.className = 'dots';
        var pc = document.createElement('div');
        pc.className = 'pc';
        pc.setAttribute('data-pager-part', '');
        pc.style.width = (n * PAGER_PITCH + 20) + 'px';
        dots.appendChild(pc);
        // beside the dots: a page back or on, by which side of the current dot
        pc.addEventListener('click', function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          var cur = self._dots[self._index];
          if (!cur || !cur.getBoundingClientRect) return;
          var r = cur.getBoundingClientRect(), to = self._index + (e.clientX < r.left + r.width / 2 ? -1 : 1);
          if (to < 0 || to >= n) return;
          self._moved = true; self._touchedAt = Date.now();
          self.goTo(to, true);
        });
        var say = document.createElement('div');
        say.className = 'say';
        say.setAttribute('aria-live', 'polite');
        this._slots = pages.map(function (pg, i) {
          var slot = document.createElement('div');
          slot.className = 'page';
          slot.setAttribute('data-pager-part', '');
          slot.setAttribute('role', 'group');
          slot.setAttribute('aria-label', (i + 1) + ' of ' + n);
          if (size) slot.setAttribute('size', size);
          track.appendChild(slot);
          return slot;
        });
        this._dots = pages.map(function (pg, i) {
          var b = document.createElement('button');
          b.className = 'dot';
          b.type = 'button';
          b.setAttribute('aria-label', (i + 1) + ' of ' + n);
          b.appendChild(document.createElement('i'));
          b.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            self._moved = true; self._touchedAt = Date.now();
            self.goTo(i, true);
          });
          pc.appendChild(b);
          return b;
        });
        var win = document.createElement('div');
        win.className = 'win';
        win.appendChild(track);
        pager.appendChild(win);
        pager.appendChild(dots);
        pager.appendChild(say);
        root.appendChild(pager);
        this._track = track;
        this._pager = pager;
        this._say = say;
        this._wireTrack(track, pager);
        if (this._ro) { this._ro.disconnect(); if (this.isConnected) this._ro.observe(track); }
        this._index = -1;
        var at = -1;
        if (keep) for (var k = 0; k < pages.length && at < 0; k++) if (this._pageSig([pages[k]]) === this._pageSig([keep])) at = k;
        this.goTo(at >= 0 ? at : this._startIndex(), false);
      }

      _wireTrack(track, pager) {
        var self = this;
        track.addEventListener('scroll', function () {
          self._moving();
          if (self._scrollQ) return;
          self._scrollQ = true;
          requestAnimationFrame(function () { self._scrollQ = false; self._settle(); });
        }, { passive: true });
        // Horizontal wheel/trackpad scrolling is navigation too. Without
        // this, the next state push follows the automatic start page again.
        track.addEventListener('wheel', function (e) {
          var dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
          if (!dx || (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(dx))) return;
          // A horizontally scrolling control inside the card owns its wheel.
          var path = e.composedPath ? e.composedPath() : [e.target];
          for (var k = 0; k < path.length && path[k] !== track; k++) {
            var el = path[k];
            if (!el || el.nodeType !== 1) continue;
            var ox = getComputedStyle(el).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) return;
          }
          e.preventDefault();
          self._moved = true; self._touchedAt = Date.now();
          // One page per wheel gesture, including its momentum tail.
          var now = Date.now();
          if (!self._wheelAt || now - self._wheelAt > 180) { self._wheelSum = 0; self._wheelTurn = false; }
          self._wheelAt = now;
          self._wheelSum += dx * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? track.clientWidth : 1);
          if (!self._wheelTurn && Math.abs(self._wheelSum) >= 24) {
            self._wheelTurn = true;
            self.goTo(self._index + (self._wheelSum > 0 ? 1 : -1), true);
          }
        }, { passive: false, capture: true });
        // THE DRAG, for every pointer (GESTURES above): on the whole pager, so
        // a swipe that starts on the dots turns the page too
        pager.addEventListener('pointerdown', function (e) {
          self._eatClick = false;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          self._moved = true; self._touchedAt = Date.now();               // touched: the start page stops following the house
          if ((self._pages || []).length < 2) return;
          var path = e.composedPath ? e.composedPath() : [e.target];
          if (!pagerClaims(path, e.clientX, pager)) return;
          if (path.some(function (el) { return el !== pager && el.matches && el.matches('input,select,textarea,[contenteditable=true]'); })) return;
          // (a page still gliding home stops under the finger)
          if (self._glide) { self._glide(); self._glide = null; }
          self._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: track.scrollLeft, from: self._index,
                         moved: false, target: path[0], pts: [[e.timeStamp, e.clientX]] };
        }, true);
        pager.addEventListener('pointermove', function (e) {
          var d = self._drag;
          if (!d || e.pointerId !== d.id) return;
          if (e.pointerType === 'mouse' && !e.buttons) { self._drag = null; return; }
          var dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved) {
            // a light held into its dimmer keeps the drag
            var path = e.composedPath ? e.composedPath() : [e.target];
            if (path.some(function (el) { return el !== pager && el.hasAttribute && el.hasAttribute('data-hk-control'); })) { self._drag = null; return; }
            if (Math.abs(dx) < PAGER_SLOP && Math.abs(dy) < PAGER_SLOP) return;
            if (Math.abs(dy) > Math.abs(dx)) { self._drag = null; return; }    // up or down: not ours
            d.moved = true;
            track.classList.add('dragging');
            self._moving();
            // the card under the finger lets go, as it would for a scroll
            try {
              d.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType,
                                                                         bubbles: true, composed: true }));
            } catch (x) { /* no PointerEvent: a test page */ }
            try { pager.setPointerCapture(e.pointerId); } catch (x) { /* already released */ }
          }
          // (measured once a drag: a read here is a layout under the finger)
          if (!d.scale) d.scale = track.getBoundingClientRect().width / track.clientWidth || 1;
          track.scrollLeft = d.left - dx / d.scale;
          self._moving();
          d.pts.push([e.timeStamp, e.clientX]);
          if (d.pts.length > 6) d.pts.shift();
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
        }, { capture: true, passive: false });
        var finish = function (e) {
          var d = self._drag;
          // (the pointercancel sent above is for the card, not for us; and
          // taking the capture makes the card lose its own: only ours counts)
          if (!d || e.pointerId !== d.id || (e.type === 'pointercancel' && !e.isTrusted) ||
              (e.type === 'lostpointercapture' && e.target !== pager)) return;
          self._drag = null;
          track.classList.remove('dragging');
          try { if (pager.hasPointerCapture(e.pointerId)) pager.releasePointerCapture(e.pointerId); } catch (x) { /* gone */ }
          if (!d.moved) return;
          self._eatClick = true;
          var w = track.clientWidth || 1, to = d.from, scale = d.scale || 1;
          var p0 = d.pts[0], p1 = d.pts[d.pts.length - 1], dt = p1[0] - p0[0];
          var speed = dt > 0 && e.timeStamp - p1[0] < 100 ? (p1[1] - p0[1]) / scale / dt : 0;
          var went = (e.clientX - d.x) / scale;
          // past a fifth, or flicked that way; flicked back, it goes back; the browser took it: back where it was
          if (e.type === 'pointerup' && window.hkDrag.lands(went, w, speed, { turn: PAGER_TURN, flick: PAGER_FLICK, min: PAGER_SLOP })) to = d.from + (went < 0 ? 1 : -1);
          self._glideTo(to, -speed);
        };
        pager.addEventListener('pointerup', finish, true);
        pager.addEventListener('pointercancel', finish, true);
        pager.addEventListener('lostpointercapture', finish, true);
        pager.addEventListener('dragstart', function (e) { e.preventDefault(); });
        pager.addEventListener('click', function (e) {
          if (!self._eatClick) return;
          self._eatClick = false;
          e.preventDefault(); e.stopImmediatePropagation();
        }, true);
      }
      // WHILE A PAGE MOVES -- a drag, its slide home, a dot's or the wheel's
      // turn -- the pages are cut off in the gutter beside the block (.win in
      // the CSS above): the track reaches PAGER_ROOM past the block for the
      // plates' shadows at rest, and a page passing through that reach slid
      // over the blocks beside it (the owner, 2026-10-24). The clip lets go
      // once the track has been still a moment and nobody is holding it.
      _moving() {
        var pager = this._track && this._pager, self = this;
        if (!pager) return;
        pager.classList.add('moving'); this.setAttribute('data-moving', '');
        if (window.hkDrag && window.hkDrag.motion) window.hkDrag.motion.begin('block');     // counted to its glide's end (hk-drag.js)
        clearTimeout(this._stillT);
        this._stillT = setTimeout(function () {
          if (self._drag && self._drag.moved) { self._moving(); return; }
          // ...and at rest ON its page: a smooth turn cut short (the block
          // drawn again, a hidden tab) left the plates a few px into the gap,
          // the block out of line with the ones under it (the owner,
          // 2026-10-31: "pushed to the right some")
          var t = self._track, w = t && t.clientWidth;
          if (w) { var at = self._pageLeft(Math.round(t.scrollLeft / w)); if (Math.abs(t.scrollLeft - at) > 0.5) t.scrollLeft = at; }
          pager.classList.remove('moving');
          self.removeAttribute('data-moving');
        }, PAGER_STILL);
      }
      // WHERE PAGE i SITS in the track: its own offset from the first page's, not i whole widths (2026-10-31, the
      // owner: the camera block "shifted to the right again"). The track's clientWidth is rounded to a whole pixel and
      // a page's width is not -- 594.6 px drawn, 595 asked -- so i x clientWidth drifted half a pixel a page: four or
      // five pixels into the gap by the sixth or the tenth camera. Each page's own offset is out by half a pixel at most.
      _pageLeft(i) {
        var s = this._slots || [], p = s[i], p0 = s[0], t = this._track;
        if (p && p0 && p.offsetParent === p0.offsetParent && p0.offsetParent) return p.offsetLeft - p0.offsetLeft;
        return i * ((t && t.clientWidth) || 0);
      }
      // the page the track has come to rest on
      _settle() {
        var t = this._track, w = t && t.clientWidth;
        if (!w) return;
        this._show(Math.round((t.scrollLeft || 0) / w));
      }

      // LET GO OF A DRAG: to page i, from where the track is, at the speed it was going (hk-drag.js; v: scrollLeft px/ms)
      _glideTo(i, v) {
        var n = (this._pages || []).length, t = this._track, self = this, H = window.hkDrag;
        if (!n || !t) return;
        i = Math.max(0, Math.min(n - 1, i | 0));
        if (pagerCalm() || !H || !H.glide) { this.goTo(i, false); return; }
        this._want = i;
        var at = this._pageLeft(i);
        if (this._glide) this._glide();
        this._glide = H.glide(t.scrollLeft, at, v, function (x) { t.scrollLeft = x; self._moving(); }, function () { self._glide = null; });
        this._show(i);
      }

      // TURN TO PAGE i: smooth for a tap, at once otherwise
      goTo(i, smooth) {
        if (this._glide) { this._glide(); this._glide = null; }
        var n = (this._pages || []).length;
        if (!n) return;
        i = Math.max(0, Math.min(n - 1, i | 0));
        this._want = i;
        var t = this._track, w = t && t.clientWidth;
        if (w) {
          var left = this._pageLeft(i);
          if (t.scrollTo) t.scrollTo({ left: left, behavior: smooth && !pagerCalm() ? 'smooth' : 'auto' });
          else t.scrollLeft = left;
        }
        this._show(i);
      }
      _show(i) {
        var n = (this._pages || []).length;
        if (!n) return;
        i = Math.max(0, Math.min(n - 1, i));
        for (var k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) this._make(k);
        if (i === this._index) return;
        this._index = i;
        (this._dots || []).forEach(function (d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
        if (this._say && n > 1) this._say.textContent = (i + 1) + ' of ' + n;
        this._away(i !== this._startIndex());
      }
      // a page's card, made the first time it is on screen or next to it
      _make(i) {
        if (this._els[i] || !this._pages[i]) return;
        var el = window.hkCards.createCard(this._pages[i].card, this.client);
        if (!el) return;
        var size = ((this._config || {}).item || {}).size;
        if (size && el.setAttribute) el.setAttribute('size', size);
        passTile(this, el);
        if (this._pages.length > 1 && el.setAttribute) {
          el.setAttribute('data-grid-pager', '');
          // Interactive footers stay above the dots' 44px hit targets.
          el.style.setProperty('--hk-pager-safe', '24px');
        }
        this._els[i] = el;
        this._slots[i].appendChild(el);
      }
      // off its start page: the Return to Home timer arms on Home too
      _away(on) {
        on = !!on && this.isConnected;
        if (on === !!this._isAway) return;
        this._isAway = on;
        var I = window.hkIdle;
        if (I && I.away) I.away(this._key, on);
      }
      // the timer fired: back to the start page, at once (nobody is looking)
      _return() {
        this._moved = false;
        this.goTo(this._startIndex(), false);
      }
      _ring(n) {
        var cfg = this._config || {}, it = cfg.item || {};
        if (!n || n.type !== 'notification' || n.kind !== 'doorbell') return;
        if (!it.pages || it.pages.source !== 'cameras') return;
        var i = pagerDoorbell(this._pages, n.camera);
        if (i < 0) return;
        this._moved = true;
        this.goTo(i, true);
      }

      // EACH NEW CLIENT: every page's card gets it; and until somebody touches
      // the block, the start page follows (the client may come after the first
      // draw, with what is playing)
      _receiveClient() {
        super._receiveClient();
        var els = this._els || [], client = this.client;
        for (var i = 0; i < els.length; i++) if (els[i]) window.hkHostClient.bridge(els[i], client);
        if (this._built && !this._moved && this._pages && this._pages.length > 1) {
          var s = this._startIndex();
          if (s !== this._index) this.goTo(s, false);
        }
        // A FOLLOWING BLOCK turns to the camera it follows when that changes --
        // unless someone swiped it in the last PAGER_HANDS_OFF ms
        var f = this._built ? pagerFollow(this._pages || [], (this._config || {}).item, this._live()) : -1;
        if (f >= 0 && f !== this._followed) {
          this._followed = f;
          if (f !== this._index && !(Date.now() - (this._touchedAt || 0) < PAGER_HANDS_OFF)) this.goTo(f, true);
        }
      }

      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._onIdle) {
          this._onIdle = function () { self._return(); };
          this._onHouse = function (e) { self._ring(e && e.detail); };
          this._onMusic = function () { self.redraw(); };
        }
        window.addEventListener('hk-idle-return', this._onIdle);
        window.addEventListener('hk-house-event', this._onHouse);
        var it = (this._config || {}).item || {};
        if (!this._offMusic && it.pages && it.pages.source === 'speakers' && window.hkMusic && window.hkMusic.onChange) {
          this._offMusic = window.hkMusic.onChange(function () {
            if (self._pgSig !== self._pageSig(self._pageList())) self._onMusic();
          });
        }
        // the track has its width now: turn to the page it should be on, and
        // keep it there through a resize (the tablet turned)
        if (!this._ro && typeof ResizeObserver !== 'undefined') {
          this._ro = new ResizeObserver(function () { if (!self._drag && self._index >= 0) self.goTo(self._index, false); });
        }
        if (this._ro && this._track) this._ro.observe(this._track);
        if (this._index >= 0) this.goTo(this._index, false);
        if (this._index >= 0) this._away(this._index !== this._startIndex());
      }
      disconnectedCallback() {
        window.removeEventListener('hk-idle-return', this._onIdle);
        window.removeEventListener('hk-house-event', this._onHouse);
        if (this._offMusic) { this._offMusic(); this._offMusic = null; }
        if (this._ro) this._ro.disconnect();
        clearTimeout(this._stillT);
        if (this._pager) this._pager.classList.remove('moving');
        this.removeAttribute('data-moving');
        var I = window.hkIdle;
        if (this._isAway && I && I.away) I.away(this._key, false);
        this._isAway = false;
        this._drag = null;
        super.disconnectedCallback();
      }
    }

    // what the shell and the later parts use of this one
    K.HkPagerCard = HkPagerCard; K.PAGER_EDGE = PAGER_EDGE; K.pagerClaims = pagerClaims;
    K.pagerControl = pagerControl; K.pagerDoorbell = pagerDoorbell; K.pagerFollow = pagerFollow;
    K.pagerStart = pagerStart;
  };
})();
