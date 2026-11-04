// hk-grid-faces.js - the clock block and the Cameras face.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-faces'] = function (K) {
    var C = K.C, CAM_MAX = K.CAM_MAX, camGrid = K.camGrid, camRing = K.camRing, FULL_CSS = K.FULL_CSS,
        HkGridFull = /** @type {HkLooseElementConstructor} */ (K.HkGridFull), setting = K.setting, sizeOf = K.sizeOf;

    // THE CLOCK BLOCK (2026-10-24, the owner: "many clocks", for a phone on
    // a nightstand): HK's own clock (hk-clock-card, the header's type), or
    // one of the screensaver's faces (hk-saverclock.js, sized by container
    // units, so they fit a block as they fit a screen) -- with its plate,
    // or `bare` on the wallpaper. CLOCK_FACES (hk-grid-catalog.js) are the
    // faces that read at a block's size; the rest need a screen of their own.
    function clockModule() {
      if (window.hkSaverClock) return Promise.resolve(window.hkSaverClock);
      if (!/** @type {any} */ (clockModule).p) {
        /** @type {any} */ (clockModule).p = import('/hk/modules/hk-saverclock.js').then(function () { return window.hkSaverClock; })
          .catch(function (e) { /** @type {any} */ (clockModule).p = null; console.warn('[hk-grid] clock', e && e.message); return null; });
      }
      return /** @type {any} */ (clockModule).p;
    }
    // (the block clips the face, not the face itself: scaled down, its own box is smaller than its drawing)
    var CLOCK_CSS = '.body{height:100%}.ck .ckroot{overflow:visible}.ck{position:relative;height:100%;box-sizing:border-box;overflow:hidden;border-radius:var(--hk-block-radius, ' + C.R.plate + 'px)}' +
      '.ck.plate{' + C.plate('card') + '}';
    class HkGridClockCard extends HkGridFull {
      static get CSS() { return FULL_CSS + CLOCK_CSS; }
      getCardSize() { return 2; }
      // (the plate's tap, hk-base.js openTarget) a clock leads to the Timers page, as iOS's clock widget opens Clock
      _tapTarget() { return [{ page: 'timers' }]; }
      // 24-hour as the screen's screensaver clock is (its 24-Hour Clock; off, as HK's own clock reads)
      _h24() {
        var M = window.hkCards.menu, b = M && M.board ? M.board() || {} : {}, so = b.screensaver_options || {};
        return so.clock_24 === true || (so.clock_24 == null && setting('look.saver.clock_24', false) === true);
      }
      // its box hidden: its own option (0.1.72), or its block's Hide Box (the cell's --hk-bare)
      _bare() {
        if ((this._config || {}).bare) return true;
        try { return getComputedStyle(this).getPropertyValue('--hk-bare').trim() === '1'; } catch (e) { return false; }
      }
      _sigOf() { var c = this._config || {}; return JSON.stringify([c.clock_style || '', this._bare(), sizeOf(this), this._h24()]); }
      _render() {
        var c = Object.assign({}, this._config || {}, { bare: this._bare() }), style = c.clock_style || '', key = this._sigOf(), self = this;
        if (this._built && this._key === key) { if (this._face && this._face.setClient) this._face.setClient(this.client); return; }
        this._key = key; this._built = true; this._kids = [];
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        if (!style) {
          // HK's clock: its own plate, or none and the header's glow to read on the wallpaper
          this._root.innerHTML = '<div class="body"></div>';
          var k = this._mount(this._root.querySelector('.body'), Object.assign({ type: 'custom:hk-clock-card' }, c.bare ? { shadow: true } : {}), sizeOf(this) || 'W');
          if (c.bare) k.setAttribute('bare', '');
          return;
        }
        this._root.innerHTML = '<div class="ck' + (c.bare ? '' : ' plate') + '"></div>';
        var box = this._root.querySelector('.ck'), run = this._run = (this._run || 0) + 1;
        clockModule().then(function (M) {
          if (!M || run !== self._run || !box.isConnected) return;
          self._face = M.mount(box, { style: style, h24: self._h24(), bg: 'none', scrim: false, client: self.client });
          self._fillWatch(box, !!c.bare, style);
        });
      }
      // THE FACE FILLS ITS BLOCK (2026-10-24, the owner on the nightstand
      // layouts: StandBy's digits fill the screen). A face is sized for a
      // whole screen -- its time a third of the height -- so in a block it
      // is scaled until its drawing reaches the block's edges, less a margin
      // (more inside the box) -- up, or down when a face sized by the block's
      // height is wider than a Tall block. Measured again as the block
      // resizes and once the face's fonts are in.
      // (Analog Numbers bare fills its block to the edge of its disc, as HomeView's does)
      _fillWatch(box, bare, style) {
        var root = box.querySelector('.ckroot'), self = this;
        if (!root) return;
        var fill = function () {
          root.style.transform = '';
          var b = box.getBoundingClientRect(), face = root.querySelector('.face'), l = Infinity, t = Infinity, r = -Infinity, btm = -Infinity;
          if (!face || !b.width || !b.height) return;
          face.querySelectorAll('*').forEach(function (e) {
            var q = e.getBoundingClientRect();
            if (!q.width || !q.height || q.width >= b.width * 0.999 && q.height >= b.height * 0.999) return;
            l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); btm = Math.max(btm, q.bottom);
          });
          if (!(r > l && btm > t)) return;
          var m = bare ? (style === 'numbers' ? 1 : 0.92) : 0.8, k = Math.min(b.width * m / (r - l), b.height * m / (btm - t), 3);
          // centred on the drawing's own middle, not the block's
          var dx = (b.left + b.width / 2) - (l + r) / 2, dy = (b.top + b.height / 2) - (t + btm) / 2;
          if (Math.abs(k - 1) > 0.02) root.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + k.toFixed(3) + ')';
        };
        root.style.transformOrigin = '50% 50%';
        if (this._fillRO) this._fillRO.disconnect();
        if (typeof ResizeObserver !== 'undefined') { this._fillRO = new ResizeObserver(function () { fill(); }); this._fillRO.observe(box); }
        [60, 700, 2500].forEach(function (ms) { setTimeout(function () { if (self._face) fill(); }, ms); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fill);
      }
      // back on the page (the view host takes a view out and puts it back): the face it let go of is drawn again;
      // nothing else redraws a card whose state did not change, so the block stayed empty
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._config && !this._built) this.redraw();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        if (this._fillRO) { this._fillRO.disconnect(); this._fillRO = null; }
        this._built = false; this._run = (this._run || 0) + 1;
      }
    }

    // ===================================================== hk-grid-cameras-card
    // THE CAMERAS FACE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase G):
    // the cameras named, else every camera in Cameras' order, up to nine at
    // once in the block's arrangement (camGrid). The stills are the camera
    // strip's own (hk-cameras.js, its `grid` layout): double-buffered, each
    // at its tile's size every `refresh` s and only while on screen, never
    // under the screensaver. A tap opens that camera live (its camera sheet).
    // ONE LIVE FEED AT A TIME (a tablet decodes one well; nine never connect:
    // hk-cameras.js): the face opens none of its own but the doorbell's tile
    // while it rings -- for RING_MS, and never under a sheet, the camera
    // sheet's being the one then.
    var RING_MS = 60000;
    // ...and of two faces on one screen, the first to hear the ring has it
    var camLive = null;
    var CAMS_CSS = ':host{display:block;height:100%}.cams{height:100%}.cams > *{display:block;height:100%}';
    class HkGridCamerasCard extends HkGridFull {
      static get CSS() { return CAMS_CSS; }
      getCardSize() { return 6; }
      _size() { var s = this.getAttribute && this.getAttribute('size'); return CAM_MAX[s] || s === 'F' ? s : 'XL'; }
      // its cameras: those the house has (a removed one leaves no hole)
      _ids() {
        var st = (this.client && this.client.states) || {};
        return (this._config.cameras || []).filter(function (id) { return !!st[id]; });
      }
      // (Full: the view's columns, from its cell -- 2 on a phone)
      _cols() {
        try { return parseFloat(getComputedStyle(this).getPropertyValue('--hk-span-c')) || 0; } catch (e) { return 0; }
      }
      _arrange(n) { var b = this._block(); return camGrid(this._size(), n, b && b.w, b && b.h, this._cols()); }
      _live(ids) {
        var P = window.hkSettings, id;
        if (!this._ringing || (window.hkPopupCover || 0) > 0) return null;
        if (P && P.rendering && !P.rendering().autoplay) return null;     // (a tablet that plays no video)
        if (camLive && camLive !== this && camLive.isConnected !== false && camLive._ringing) return null;
        id = camRing(ids, this._ringing === true ? null : this._ringing);
        if (id) camLive = this;
        return id;
      }
      _cfg() {
        var ids = this._ids(), g = this._arrange(ids.length), shown = ids.slice(0, g[0] * g[1]), live = this._live(shown);
        return Object.assign({ type: 'custom:hk-camera-mosaic-card', own_cameras: true, grid: g, seam: C.HOME_GRID.gap,
                               refresh: this._config.refresh || 10, cameras: shown.map(function (id) { return { entity: id }; }) },
                             live ? { live: live } : {});
      }
      _sigOf() { return JSON.stringify([this._ids(), this._size(), this._blockKey || '', this._ringing || '', (window.hkPopupCover || 0) > 0]); }
      // a new box for what it shows (the mosaic, or the stand-in)
      _box() {
        var box = document.createElement('div');
        box.className = 'cams';
        this._root.textContent = '';
        this._root.appendChild(box);
        this._kids = [];
        return box;
      }
      _render() {
        if (!this.client) return;                      // (which cameras the house has: not known yet)
        this._watchBlock();
        var cfg = this._cfg(), key = JSON.stringify(cfg);
        if (!cfg.cameras.length) {
          // (none of its cameras in the house: the catalog's stand-in, as a block with nothing to show)
          if (this._key === '') return;
          this._key = ''; this._mosaic = null;
          this._mount(this._box(), { type: 'custom:hk-key-card', name: 'Cameras', icon: 'hk:camera' });
          return;
        }
        if (this._mosaic && this._key === key) return;
        this._key = key;
        if (this._mosaic) {
          if (this._mosaic.getAttribute('size') !== this._size()) this._mosaic.setAttribute('size', this._size());
          this._mosaic.setConfig(cfg);
          return;
        }
        this._mosaic = this._mount(this._box(), cfg, this._size());
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        if (!this._onRing) {
          // A RING: the doorbell's tile live for a minute (a later ring, a minute from then)
          this._onRing = function (e) {
            var n = e && e.detail;
            if (!n || n.type !== 'notification' || n.kind !== 'doorbell') return;
            self._ringing = n.camera || true;
            clearTimeout(self._ringT);
            self._ringT = setTimeout(function () { self._ringing = null; if (camLive === self) camLive = null; self.redraw(); }, RING_MS);
            self.redraw();
          };
          // a sheet opening takes the live tile back to its still; closing gives it back
          this._onCover = function () { if (self._ringing) self.redraw(); };
        }
        window.addEventListener('hk-house-event', this._onRing);
        window.addEventListener('hk-popup-change', this._onCover);
      }
      disconnectedCallback() {
        window.removeEventListener('hk-house-event', this._onRing);
        window.removeEventListener('hk-popup-change', this._onCover);
        clearTimeout(this._ringT);
        this._ringing = null;
        if (camLive === this) camLive = null;
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
    }

    // what the shell and the later parts use of this one
    K.HkGridCamerasCard = HkGridCamerasCard; K.HkGridClockCard = HkGridClockCard;
  };
})();
