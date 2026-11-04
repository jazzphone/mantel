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
      '@media (hover:hover){.pm .mbtn:hover{background:rgba(255,255,255,.22)}.pm .mbtn.mpp:hover{background:#fff}}'
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

    // what the shell and the later parts use of this one
    K.DASH_CSS = DASH_CSS; K.DASH_SWIPE = DASH_SWIPE; K.dashLive = dashLive; K.dashViews = dashViews;
    K.musicHas = musicHas; K.PANE_OWN = PANE_OWN; K.PANE_VARS = PANE_VARS; K.scaleOf = scaleOf;
    K.tellBlack = tellBlack;
  };
})();
