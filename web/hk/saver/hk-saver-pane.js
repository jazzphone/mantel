// hk-saver-pane.js - the dashboard's pane and the side pane.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-pane'] = function (K) {
    var BAND_H = K.BAND_H, BAND_W = K.BAND_W, clientNow = K.clientNow, mus = K.mus, musicNow = K.musicNow;

    function dashViews() { return mus.views.filter(function (v) { return v.kind === 'dash'; }); }
    function dashLive() { return mus.views.some(function (v) { return v.kind === 'dash' && v.live && v.el.isConnected; }); }
    // what plays for a pane: hkMusic's answer for this screen (hk-popup.js asks)
    function musicHas(h) { return !!musicNow(h || clientNow()); }
    var DASH_CSS = [
      // the card fills what the pop-up gives it: the pane, the card's whole box
      // (not clipped: the pane's shadow falls off its edge onto the page, as
      // onto the photos -- the pane itself clips its art)
      ':host{display:block;position:relative;height:100%;min-height:0;overflow:visible;color:var(--hk-ink,rgba(255,255,255,0.94));',
      // (a finger across it is its swipe away, never the page's pan: without
      // this a touch drag sideways was the browser's, and cancelled)
      '  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;--hk-ink:rgba(255,255,255,0.94);touch-action:pan-y}',
      '.pane{left:0;width:auto}',
      // (a left pane's edge and shadow on its right, toward the page)
      ':host([side="left"]) .pane{border-left:0;border-right:1px solid rgba(255,255,255,0.10);',
      '  box-shadow:18px 0 44px rgba(0,0,0,.42),3px 0 12px rgba(0,0,0,.26)}',
      // ITS PANEL (Speakers / Volume / Browse) stands where the pane was, so
      // it wears the pane's edge: the hairline and the shadow onto the page
      // (the pane itself is hidden under it)
      ':host .mpanel:not(.card){box-shadow:inset 1px 0 0 rgba(255,255,255,0.10),-18px 0 44px rgba(0,0,0,.42),-3px 0 12px rgba(0,0,0,.26)}',
      ':host([side="left"]) .mpanel:not(.card){box-shadow:inset -1px 0 0 rgba(255,255,255,0.10),18px 0 44px rgba(0,0,0,.42),3px 0 12px rgba(0,0,0,.26)}',
      // its controls take taps (the screensaver's find them by place)
      '.pm .mbtn,.pm .mvt,.pm .msq{pointer-events:auto;cursor:pointer}',
      '.pm .mvt{touch-action:none}',
      '.pm .mvt::before{content:"";position:absolute;left:-14px;right:-14px;top:-18px;bottom:-18px}',
      // (bare buttons, 2026-11-07: a pointer over one dims it, nothing drawn behind it)
      '@media (hover:hover){.pm .mbtn:hover{opacity:.75}}'
    ].join('\n');
    var DASH_SWIPE = 10;

    // ------------------------------------------------------------ the pane
    // the band's and the pane's scale: a 1280 x 800 tablet's layout, scaled up
    // whole on a bigger screen
    function scaleOf() {
      var W = window.innerWidth || 0, H = window.innerHeight || 0;
      if (!W) return 1;
      return Math.max(1, Math.floor(Math.min(W / BAND_W, (H || BAND_H) / BAND_H) * 100) / 100);
    }
    var PANE_VARS = ['--hk-pane-w', '--hk-ss-status-right', '--hk-ss-status-top', '--hk-ss-status-width', '--hk-pane-top',
                     '--hk-pane-bottom', '--hk-ss-now-left', '--hk-ss-now-max', '--hk-ss-now-bottom', '--hk-ss-np-art',
                     '--hk-ss-np-title', '--hk-ss-np-artist', '--hk-ss-np-gap', '--hk-ss-timers-left', '--hk-ss-timers-right',
                     '--hk-ss-timers-max', '--hk-ss-timers-bottom', '--hk-pane-pad', '--hk-pm-foot'];
    // what the photos and the cards beside the pane take from it, let go as it
    // goes (the pane's own look stays while it fades)
    var PANE_OWN = ['--hk-pane-w', '--hk-pane-pad', '--hk-pane-top', '--hk-pane-bottom', '--hk-pm-foot'];
    // THE SKY AND THE CAMERA STRIP REST UNDER ANY BLACK (hk-sky.js,
    // hk-cameras.js) -- ONCE THE CURTAIN IS ON THE SCREEN (2026-10-09). Told at
    // once, the strip let go of its live video in the same moment: the video's
    // own layer went at once, and the tile showed white for five frames before
    // the frame with the curtain came (screen-recorded on the Loft, HK's black).
    // So "on" waits two frames and a little (BLACK_TELL_MS; a page not drawing
    // -- hidden -- by BLACK_TELL_MAX); "off" is told at once.
    var blackTold = false, blackTellRun = 0, BLACK_TELL_MS = 50, BLACK_TELL_MAX = 300;
    function tellBlack(on) {
      var run = ++blackTellRun, sent = false;
      var send = function () {
        if (sent || run !== blackTellRun) return;
        sent = true;
        if (blackTold === on) return;
        blackTold = on;
        try { window.dispatchEvent(new CustomEvent('hk-black', { detail: { on: on } })); } catch (e) { /* no window events */ }
      };
      if (!on || typeof requestAnimationFrame !== 'function') { send(); return; }
      requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(send, BLACK_TELL_MS); }); });
      setTimeout(send, BLACK_TELL_MAX);
    }

    // ------------------------------------------------------------ the Now Playing page
    // THE NOW PLAYING PAGE (2026-11-07, the owner: "swipe right on the main dashboard screen to ... the interactive music
    // slide page for a full screen music player", and the mockup he picked, docs/mockups/now-playing-page.html): the
    // screensaver's music slide as a page. Its own view of the one music state (kind 'dash', the slide's look), its taps
    // its own, as the Side Pane's card's are; drawn and ticked with the others (renderMusic, musicTick). The page's sky is
    // the cover (sky_variant playmusic), so the view draws no backdrop of its own. Over it the slide's corner: the time,
    // the date and the weather, the home's status at the right (the screensaver's corner widgets). Beside the Side Pane,
    // the cover and the song side by side, Up Next beside the cover (the slide's murow layout, layoutMusicView).
    var PAGE_CSS = [
      ':host{display:block;position:relative;width:100%;height:var(--hk-npp-h,640px);color:rgba(255,255,255,0.94);',
      '  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}',
      '.pane{display:none!important}',
      '.mu{opacity:1;visibility:visible;background:none;transition:none}',
      '.mu .mbgf,.mu .mshade{display:none}',
      // (the page is narrowed by the Side Pane already: the slide's room for the screensaver's own pane is not taken)
      ':host([pane]) .mu .mbody{right:0;left:0}',
      '.mu .mbtn,.mu .mvt,.mu .msq{pointer-events:auto;cursor:pointer}',
      '.mu .mvt{touch-action:none}',
      '.mu .mvt::before{content:"";position:absolute;left:-14px;right:-14px;top:-18px;bottom:-18px}',
      '@media (hover:hover){.mu .mbtn:hover{opacity:.75}}',
      // THE CORNER on the page's own edges
      '.info{position:absolute;inset:0;z-index:2;pointer-events:none}',
      '.ptl,.ptr{position:absolute;top:var(--g,6px);display:flex;flex-direction:column;gap:var(--g,6px)}',
      '.ptl{left:0;align-items:flex-start}.ptr{right:0;align-items:flex-end}',
      '.ptl > *,.ptr > *{position:relative}',
      // (the Speakers / Volume / Queue / Browse panel's place: over the cover, as on the slide -- placePanel takes it)
      '.pbox{position:absolute;visibility:hidden;pointer-events:none}'
    ].join('\n');
    var pageV = null;
    // (the class: the shell registers it, hk-saver.js runParts -- a part registers no element)
    function pageCard() {
      var Page = class extends /** @type {HkLooseElementConstructor} */ (HTMLElement) {
        constructor() {
          super();
          this._root = this.attachShadow({ mode: 'open' });
          this._wg = {};
        }
        setConfig(c) { this._config = c || {}; }
        getCardSize() { return 12; }
        // each new client: the music again (at most once a second, dashWatch) and the corner; laid out again a moment
        // later, at most once a second (a new song's words)
        _onClient() {
          var self = this;
          if (this._v && this._v.live) K.dashWatch();
          if (!this._fitT) this._fitT = setTimeout(function () { self._fitT = null; if (self.isConnected) self._fit(); }, 1000);
        }
        connectedCallback() {
          var self = this;
          if (!this._root.querySelector('.info')) this._make();
          this._adopt();
          this._v.live = true;
          this._onWin = function () { self._fit(); };
          window.addEventListener('resize', this._onWin);
          window.addEventListener('hk-pane', this._onWin);
          if (typeof ResizeObserver === 'function') { this._ro = new ResizeObserver(this._onWin); this._ro.observe(this); }
          clearInterval(this._minT);
          this._minT = setInterval(function () { self._corner(); }, 15000);
          K.renderMusic();
          this._fit();
        }
        disconnectedCallback() {
          var v = this._v;
          window.removeEventListener('resize', this._onWin);
          window.removeEventListener('hk-pane', this._onWin);
          clearInterval(this._minT);
          clearTimeout(this._fitT); this._fitT = null;
          if (this._ro) { this._ro.disconnect(); this._ro = null; }
          if (!v || v.host !== this) return;
          K.panelDone(v);
          v.live = false;
          K.musicTick();
        }
        // the one view, into this card (a page built again hands it on, drawn already)
        _adopt() {
          var v = this._v = pageV, r = this._root;
          v.host = this; v.root = r; v.box = r.querySelector('.pbox');
          if (v.el.parentNode !== r) r.insertBefore(v.el, r.querySelector('.info'));
        }
        _make() {
          var r = this._root, CSS = K.CSS;
          r.innerHTML = '<style>' + CSS.slice(CSS.indexOf('.pane{position:absolute')) + '\n' + PAGE_CSS + '</style>' +
            '<div class="info" data-ink="white"><div class="ptl"></div><div class="ptr"></div></div><div class="pbox"></div>';
          /** @type {HTMLElement} */ (r.querySelector('.info')).style.setProperty('--lay-ink', '#ffffff');
          if (pageV) return;
          var v = pageV = K.musicView('dash', 'slide');
          v.live = false;
          if (!window.hkSaverPanel) v.el.setAttribute('nomx', '');
          // ITS BUTTONS, the art (Play Music) and the volume, as the Side Pane's card's (hk-saver.js MusicPane)
          v.el.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.mbtn') : null;
            if (b) { K.musicAct({ btn: b, view: v }); return; }
            if (e.target.closest && e.target.closest('.msq')) K.musicAct({ art: true, view: v });
          });
          var vt = v.vt;
          vt.addEventListener('pointerdown', function (e) {
            if (v.el.hasAttribute('novol')) return;
            e.preventDefault(); e.stopPropagation();
            try { vt.setPointerCapture(e.pointerId); } catch (x) { /* gone */ }
            K.musicAct({ vol: true, view: v }, e.clientX);
          });
          vt.addEventListener('pointermove', function (e) { if (mus.drag && mus.drag.view === v) K.volFrom(e.clientX); });
          var up = function () { if (mus.drag && mus.drag.view === v) K.volEnd(); };
          vt.addEventListener('pointerup', up);
          vt.addEventListener('pointercancel', up);
        }
        // AS TALL AS THE SCREEN LEAVES IT (the page's top to the tab bar's), the slide laid out in it, the panel's place
        _fit() {
          var v = this._v, de = document.documentElement;
          if (!v || v.host !== this || !this.isConnected) return;
          var top = Math.round(this.getBoundingClientRect().top);
          this.style.setProperty('--hk-npp-h', 'max(320px, calc(100dvh - ' + top + 'px - var(--hk-tabbar-top, 0px) - 12px))');
          K.setAttr(this, 'pane', /^(left|right)$/.test(de.getAttribute('hk-pane') || ''));
          var z = K.scaleOf();
          v.z = z;
          // The page supplies the cover even when the Now Playing bar is hidden.
          var pic = v.d && !v.d.idle ? v.d.pic || null : null;
          if (window.hkNowArt !== pic) {
            window.hkNowArt = pic;
            window.dispatchEvent(new CustomEvent('hk-now-art', { detail: { url: pic } }));
          }
          this._corner();
          K.layoutMusicView(v, this, this._root, null, z);
          var hb = this.getBoundingClientRect(), art = v.el.querySelector('.mart').getBoundingClientRect();
          var w = Math.max(280, Math.min(566 * z, hb.width - 48)), h = Math.max(300, Math.min(660 * z, hb.height - 24));
          var cx = Math.max(hb.left + 24 + w / 2, Math.min(hb.right - 24 - w / 2, art.left + art.width / 2));
          var pb = /** @type {HTMLElement} */ (this._root.querySelector('.pbox')).style;
          pb.left = Math.round(cx - w / 2 - hb.left) + 'px'; pb.top = Math.round((hb.height - h) / 2) + 'px';
          pb.width = Math.round(w) + 'px'; pb.height = Math.round(h) + 'px';
        }
        // THE CORNER: the time (2.6 times the corner's words), the date and the weather at the left, the home's status
        // at the right -- the screensaver's corner widgets, a size for the card's (once their files are here)
        _corner() {
          var WG = window.hkSaverWidgets, self = this, r = this._root;
          if (!WG) {
            if (!this._asked) { this._asked = true; K.layoutModules().then(function () { if (self.isConnected && window.hkSaverWidgets) self._fit(); }); }
            return;
          }
          var hb = this.getBoundingClientRect();
          if (!hb.width || !hb.height) return;
          var u = Math.min(hb.width, hb.height * 1.4) / 100;
          if (WG.sheet && !r.querySelector('.wgcss')) { var st = WG.sheet(); st.classList.add('wgcss'); r.insertBefore(st, r.firstChild); }
          if (this._u && Math.abs(this._u - u) > 0.05) { Object.keys(this._wg).forEach(function (k) { try { self._wg[k].destroy(); } catch (e) { /* gone */ } }); this._wg = {}; }
          this._u = u;
          /** @type {HTMLElement} */ (r.querySelector('.info')).style.setProperty('--g', (0.8 * u) + 'px');
          var c = clientNow(), now = new Date(), at = { time: [2.6, '.ptl'], date: [1, '.ptl'], weather: [1, '.ptl'], status: [1, '.ptr'] };
          ['time', 'date', 'weather', 'status'].forEach(function (k) {
            var w = self._wg[k];
            if (!w) {
              try { w = self._wg[k] = WG.create(k, 'inline', { u: u * at[k][0], back: 'none', color: 'auto', h24: K.clock24(), weather: K.weatherEntity() }); }
              catch (e) { return; }
              r.querySelector(at[k][1]).appendChild(w.el);
            }
            try { w.update(c, now, {}); } catch (e) { /* its own data */ }
          });
        }
      };
      K.PageCard = Page;
    }
    pageCard();

    // what the shell and the later parts use of this one
    K.DASH_CSS = DASH_CSS; K.DASH_SWIPE = DASH_SWIPE; K.dashLive = dashLive; K.dashViews = dashViews;
    K.musicHas = musicHas; K.PANE_OWN = PANE_OWN; K.PANE_VARS = PANE_VARS; K.scaleOf = scaleOf;
    K.tellBlack = tellBlack;
  };
})();
