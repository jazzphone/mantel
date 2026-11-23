// hk-media-npsheet.js - the sheet the Now Playing block's cover opens: Browse, Queue and Speakers.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom. (The shell defines its element:
// hk-music-sheet, the tag the Now Playing block's cover opens in a detail sheet.)
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-npsheet'] = function (K) {
    var HkBase = /** @type {any} */ (K.HkBase);

    // THE COVER'S SHEET (the owner, round 12: "Taping the artwork can open up browse or queue pop ups with the 3 tabs at the top to change
    // (Browse/Queue/Speaker ..etc..)"): a detail sheet (hkDetail, as the other blocks' are) with a segmented control at its top -- Browse,
    // Queue, Speakers -- opening on the tab the card asks for, Queue when something plays. Each tab is the screensaver music panel's own
    // (hk-saver-panel.js: the house's rooms ticked where the music plays, each one's volume; the song and what comes next, a tap
    // plays it; the playlists and the Browse Music page), told to act on the music this block follows (its speaker, else the screen's).
    // The sheet is a dark one in every look: the panel's rows are white on a dark ground.
    /** @param {any} h @param {string} at */
    function resolve(h, at) {
      var G = window.hkGridCatalog, M = window.hkMusic;
      if (at && G && G.musicAt && h) return G.musicAt(h, at);
      return M && h ? M.resolve(h) : { player: null, context: null, reason: 'none', name: '' };
    }
    // the sheet's own touches of the panel: it fills the sheet's body, takes no cover behind it and no X (the sheet's header has one)
    var CSS = function () {
      var P = /** @type {any} */ (window.hkSaverPanel), HC = /** @type {any} */ (window.hkCards);
      return (P ? P.CSS : '') + (HC && HC.shadeCss ? HC.shadeCss('.mpanel') : '') + [
        ':host{display:block;position:relative;min-height:0;color:' + (HC ? HC.v('ink') : '#fff') + '}',
        // (filling the sheet's body whatever way its height is made: laid on it, not a percent of it)
        '.mpanel{position:absolute;inset:0;display:block;background:transparent;overflow:hidden;z-index:0}',
        '.mpanel .mpin{position:absolute;inset:0;width:auto !important;height:auto !important;zoom:1 !important}',
        '.mpanel .mpbg,.mpanel .mpshade,.mpanel .mpx{display:none}',
        '.mpanel .mphd{padding:4px 20px 10px}',
        '.mpanel .mpt{padding-left:20px;padding-right:20px}'
      ].join('');
    };

    class HkMusicSheet extends HkBase {
      static get CSS() { return CSS(); }
      // ROOMY (the owner, 2026-11-23: "we could probably make it wider/bigger too"): 740 wide where the screen has the room (the frame
      // caps it at the screen less 32 and a phone's own rules take over) and as tall as the frame lets a sheet be -- 820, held to the screen
      // less 32 -- so Browse shows more covers across and Queue and Speakers breathe. It was 520 x 680.
      hkWidthKind() { return 740; }
      hkHeightKind() { return 820; }
      hkFill() { return true; }
      hkNoGear() { return true; }
      // dark whatever the screen's look (the panel's rows are white on dark)
      hkSheetAppearance() { return { look: 'flat', flat_theme: 'dark' }; }
      /** @param {any} h @param {any} d */
      hkHead(h, d) {
        d.well.style.background = '';
        d.icon.style.color = window.hkCards.v('ink');
        d.icon.icon = 'mdi:music';
        d.tt.textContent = 'Now Playing';
        return true;
      }
      _ctx() { var r = resolve(this.client, (this._config || {}).at); return r && r.context ? r.context : null; }
      _receiveClient() {
        if (window.hkMusic) window.hkMusic.attach(this.client);
        super._receiveClient();
        // the panel follows the house, a few times a second at most (rooms joining, levels, the queue's song)
        var p = this._p;
        if (p && Date.now() - (this._tk || 0) > 400) { this._tk = Date.now(); p.update(); }
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        // the music changing under it (a request landing) draws it again without a client
        if (!this._musicOff && window.hkMusic) this._musicOff = window.hkMusic.onChange(function () { if (self._p) self._p.update(); });
      }
      // THE PANEL'S WIDE LAYOUT (two columns of rooms, three of playlists, the wider shelf) from the sheet's own width, the number the
      // screensaver's card uses (hk-saver-screens.js: 500); a phone's sheet is under it. One observer, on this sheet alone.
      /** @param {number} w */
      _fit(w) { if (this._p && w) this._p.el.toggleAttribute('wide', w >= 500); }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._musicOff) { this._musicOff(); this._musicOff = null; }
        if (this._p) { this._p.destroy(); this._p = null; this._built = false; }
      }
      _render() {
        var P = /** @type {any} */ (window.hkSaverPanel), self = this, cfg = this._config || {};
        if (!P || !this.client) return;
        if (!this._p) {
          this._p = P.create({
            tabs: ['browse', 'queue', 'speakers'],
            client: function () { return self.client; },
            ctx: function () { return self._ctx(); },
            art: function () { return null; },
            stop: true,
            follow: function (/** @type {string} */ key) { var Mu = window.hkMusic; if (key && Mu && Mu.known(key)) Mu.setFocus(key); },
            // a pick played: the sheet closes a moment after, back on the page it was opened from
            done: function (/** @type {number} */ ms) {
              clearTimeout(self._doneT);
              self._doneT = setTimeout(function () { if (self.hkSheet && self.hkSheet.close) self.hkSheet.close(); }, ms || 0);
            },
            wide: function () { return false; }
          });
          this._p.el.classList.add('up');
          this._root.appendChild(this._p.el);
          this._p.show(cfg.tab === 'browse' || cfg.tab === 'speakers' ? cfg.tab : 'queue');
          this._built = true;
          this._fit(this.clientWidth);
          if (typeof ResizeObserver === 'function' && !this._ro) {
            this._ro = new ResizeObserver(function (/** @type {any} */ es) { var e = es && es[0]; if (e) self._fit(e.contentRect.width); });
            this._ro.observe(/** @type {any} */ (this));
          }
        }
        this._p.update();
      }
    }
    // what the shell and the later parts use of this one
    K.HkMusicSheet = HkMusicSheet;
  };
})();
