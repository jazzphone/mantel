// hk-saver-black.js - HK's own black and the loop.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-black'] = function (K) {
    var clientNow = K.clientNow, refresh = K.refresh, tabletNow = K.tabletNow;

    var BLACK_KEY = 'hk-black', BRIGHT_KEY = 'hk-black-bright';
    function dashSeg() { return String(location.pathname).split('/')[1] || ''; }
    function rememberedTabletId() { try { return localStorage.getItem('hk-tablet') || ''; } catch (e) { return ''; } }
    // WHAT THE BLACK READS: this page's tablet's Black Screen and switch
    // (1.14; before, the screen's -- hkSettings.tablet() reads those then)
    function hkBoard() { return tabletNow(); }
    function kiosk() { return window.kioskSatellite || null; }
    function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* no storage */ } }
    function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function setBacklight(v) {
      var k = kiosk();
      if (!k || typeof k.setBrightness !== 'function') return;
      try { Promise.resolve(k.setBrightness(v)).catch(function () { /* the kiosk said no */ }); } catch (e) { /* the kiosk said no */ }
    }
    // the backlight up to `v` (0-1) over `ms`, with the curtain's fade
    var rampRun = 0, rampAt = 0;
    function rampBacklight(v, ms) {
      var run = ++rampRun, steps = 6;
      rampAt = 0;
      for (var i = 1; i <= steps; i++) {
        (function (i) {
          setTimeout(function () {
            // each step once, and only ever up
            if (run !== rampRun || i <= rampAt) return;
            rampAt = i;
            setBacklight(+(v * i / steps).toFixed(3));
          }, Math.round(ms * (i - 1) / steps));
        })(i);
      }
    }
    // what to come back to: the house's (the switch's brightness, 0-255),
    // else what it was before this black
    function wakeBrightness(h) {
      var b = hkBoard(), st = b && h && h.states && h.states[b.black_switch];
      var a = st && st.attributes && st.attributes.brightness;
      if (typeof a === 'number' && a >= 0) return Math.max(0.004, Math.min(1, a / 255));
      var saved = parseFloat(stored(BRIGHT_KEY));
      return isFinite(saved) && saved > 0 ? saved : null;
    }
    function hkUnheard(h) {
      var b = hkBoard(), st = b && b.black_switch && h && h.states && h.states[b.black_switch];
      return !!(st && st.state === 'on' && st.attributes && st.attributes.confirmed === false);
    }

    // ------------------------------------------------------------ the loop
    // The config follows the page: on each view change, and on each new client
    // (cheap -- a property read, and the dashboard config object is the same
    // object until the dashboard changes).
    // A DASHBOARD HK FRONTEND DOES NOT DRAW (an existing dashboard given HK
    // settings) has no hk_screensaver in its config: its screen's settings
    // make the same block (hk-strategy.js saverBlock). Its own YAML's
    // hk_screensaver -- or a WallPanel block -- always wins.
    function fromSettings(conf) {
      if (!conf || conf.wallpanel) return null;
      var HS = window.hkSettings, S = window.hkStrategy;
      var all = HS && HS.get ? HS.get('boards', null) : null;
      var b = all && all[String(location.pathname).split('/')[1] || ''];
      return b && b.screensaver && S && S.saverBlock ? S.saverBlock(clientNow(), b) : null;
    }
    var refreshedAt = 0;
    function refreshSoon() {
      // on every update (~40 a second in a busy house) the switch is checked, but
      // the config only every 2 s: it changes when the dashboard does
      var now = Date.now();
      if (now - refreshedAt < 2000) return;
      refreshedAt = now;
      refresh();
    }

    // what the shell and the later parts use of this one
    K.BLACK_KEY = BLACK_KEY; K.BRIGHT_KEY = BRIGHT_KEY; K.dashSeg = dashSeg; K.fromSettings = fromSettings;
    K.hkBoard = hkBoard; K.hkUnheard = hkUnheard; K.kiosk = kiosk; K.rampBacklight = rampBacklight;
    K.refreshSoon = refreshSoon; K.rememberedTabletId = rememberedTabletId; K.setBacklight = setBacklight;
    K.store = store; K.wakeBrightness = wakeBrightness;
  };
})();
