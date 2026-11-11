// hk-cameras-helpers.js - what the camera cards share: the black-frame check, the video finders, releasing a video, the focus and rest watchers.
//
// PART OF THE CAMERA CARDS (hk-cameras.js). Not a card and not run on its own: it registers one
// function, which hk-cameras.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCamerasParts = window.hkCamerasParts || {})['hk-cameras-helpers'] = function (K) {
    // the live stream after the screensaver: this long after it is gone,
    // or at most this long after it stopped (_wakeLiveLater)
    var LIVE_AFTER_WAKE = 1500, LIVE_WAKE_MAX = 6000;
    // ...and after the kiosk's own Black screensaver: this long after it ends
    var AFTER_BLACK = 2500;
    // THE LIVE CARD IS HIDDEN UNTIL IT HAS A PICTURE ONLY ON ANDROID, whose
    // WebView draws video outside the page (see .live>hui-card.wait). Safari
    // will not start a hidden muted video at all, so there the card would wait
    // for ever (hk-campost.js, ANDROID ONLY).
    var VIDEO_OUTSIDE = /Android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');

    // Is this video's current frame solid black? 8x8 pixels on a scratch
    // canvas; a night camera's infrared grey is far above the line. Unreadable
    // (no canvas, a tainted frame): not black, as before.
    var scratch = null;
    function blackFrame(v) {
      try {
        if (!scratch) {
          scratch = document.createElement('canvas');
          scratch.width = scratch.height = 8;
          scratch.x = scratch.getContext('2d', { willReadFrequently: true });
        }
        if (!scratch.x || typeof scratch.x.getImageData !== 'function') return false;
        scratch.x.drawImage(v, 0, 0, 8, 8);
        var d = scratch.x.getImageData(0, 0, 8, 8).data, sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum < 64 * 3 * 4;            // every channel of every pixel under ~4
      } catch (e) {
        return false;
      }
    }
    function loadedImg(root) {
      var stack = [root], n = 0;
      while (stack.length && n++ < 400) {
        var e = stack.pop();
        if (e.tagName === 'IMG' && e.complete && e.naturalWidth > 0) return e;
        if (e.shadowRoot) stack.push(e.shadowRoot);
        var k = e.children || [];
        for (var i = 0; i < k.length; i++) stack.push(k[i]);
      }
      return null;
    }
    function stillLoaded(root) { return !!loadedImg(root); }
    // The live card's <video>, through the shadow roots in between
    // (hui-card > picture card > hui-image > ha-camera-stream > player).
    function liveVideo(root) {
      var stack = [root], n = 0;
      while (stack.length && n++ < 400) {
        var e = stack.pop();
        if (e.tagName === 'VIDEO') return e;
        if (e.shadowRoot) stack.push(e.shadowRoot);
        var k = e.children || [];
        for (var i = 0; i < k.length; i++) stack.push(k[i]);
      }
      return null;
    }
    // The video that PLAYS: a camera card holds two (Home Assistant's WebRTC
    // player and its HLS fallback, which stays paused), so "the first video"
    // can be the wrong one.
    function playingVideo(root) {
      var stack = [root], n = 0;
      while (stack.length && n++ < 400) {
        var e = stack.pop();
        if (e.tagName === 'VIDEO' && e.readyState >= 2 && e.videoWidth > 0 && !e.paused) return e;
        if (e.shadowRoot) stack.push(e.shadowRoot);
        var k = e.children || [];
        for (var i = 0; i < k.length; i++) stack.push(k[i]);
      }
      return null;
    }
    function playing(root) { return !!playingVideo(root); }
    // A LIVE TILE TAKEN OFF THE PAGE LETS GO OF ITS VIDEO. Home Assistant's
    // stream player closes its connection when it leaves, but its <video>
    // keeps the stream as srcObject, unpaused -- and a media element with a
    // source still playing is kept alive by the browser even detached, and
    // with it every element up to the card (traced in a heap snapshot: each
    // retained by "Pending activities"). Every visit to the Cameras page left
    // its nine players behind (~980 elements, 68 listeners, ~0.3 MB a visit,
    // measured headless), and so did every sleep and wake of Home's live tile.
    function releaseMedia(root) {
      var stack = root ? [root] : [], n = 0;
      while (stack.length && n++ < 600) {
        var e = stack.pop();
        if (e.tagName === 'VIDEO' || e.tagName === 'AUDIO') {
          try {
            e.pause();
            if (e.srcObject) e.srcObject = null;
            if (e.getAttribute && e.getAttribute('src')) { e.removeAttribute('src'); e.load(); }
          } catch (x) { /* already gone */ }
        }
        if (e.shadowRoot) stack.push(e.shadowRoot);
        var k = e.children || [];
        for (var i = 0; i < k.length; i++) stack.push(k[i]);
      }
    }
    // WHEN NOBODY CAN SEE THE PAGE: behind HK's photo screensaver once it
    // covers the dashboard, under any black (HK's own or the kiosk's), or with
    // the page hidden -- the same signals the Home strip rests on above. rest()
    // when one starts; wake() when the last one ends (AFTER_BLACK after a
    // black, as the strip does). -> off()
    // CAMERAS REST WHILE ANOTHER WINDOW HAS THE FOCUS (2026-10-21): on a
    // computer, live video decoded in a window nobody is looking at. Only
    // where there is a mouse (a wall tablet's or a phone's WebView can report
    // no focus until its first touch, as hk-sky.js says), and only while
    // Cameras -> Pause When Not in Focus is on (cameras.focus_pause): someone
    // may keep a window of cameras beside their work. The screensaver is not
    // this setting's: under it cameras always rest. 'hk-camera-focus' says
    // when it changes ({ away }).
    var CAM_FOCUS = (function () {
      var away = false, device = false;
      try { device = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (e) { device = false; }
      function wanted() {
        var S = window.hkSettings;
        return !(S && S.get && S.get('cameras.focus_pause', true) === false);
      }
      function check() {
        var u = device && wanted() && typeof document.hasFocus === 'function' && !document.hasFocus();
        if (u === away) return;
        away = u;
        try { window.dispatchEvent(new CustomEvent('hk-camera-focus', { detail: { away: u } })); } catch (e) { /* no window events */ }
      }
      if (device) {
        try {
          // after the blur settles: the focus moving into a frame on the page
          // blurs the window while the document keeps it
          window.addEventListener('blur', function () { setTimeout(check, 0); });
          window.addEventListener('focus', check);
          document.addEventListener('pointerdown', check, true);
          document.addEventListener('keydown', check, true);
          // the setting changed, or another screen's settings now apply
          window.addEventListener('hk-module-ready', check);
        } catch (e) { /* no window events */ }
      }
      return { away: function () { return away; }, check: check };
    })();
    // `focus`: this player also rests while another window has the focus
    // (CAM_FOCUS); every player rests behind the screensaver and the black
    function restWatch(rest, wake, focus) {
      var black = false, covered = false, wakeT = null, seq = 0, away = !!focus && CAM_FOCUS.away();
      var later = function (ms) {
        clearTimeout(wakeT);
        var my = ++seq;
        wakeT = setTimeout(function () {
          if (my !== seq) return;
          wakeT = null;
          if (black || covered || away || document.hidden) return;
          if (window.hkSaver && window.hkSaver.running && window.hkSaver.running()) return;
          wake();
        }, ms);
      };
      var stop = function () { seq++; clearTimeout(wakeT); wakeT = null; };
      var on = {
        'hk-saver-covered': function () { covered = true; stop(); rest(); },
        'hk-saver': function (e) { if (!(e && e.detail && e.detail.on)) { covered = false; later(0); } },
        'hk-black': function (e) {
          black = !!(e && e.detail && e.detail.on);
          if (black) { stop(); rest(); } else later(AFTER_BLACK);
        },
        'kiosksatellite:screensaverstart': function () { black = true; stop(); rest(); },
        'kiosksatellite:screenoff': function () { black = true; stop(); rest(); },
        'kiosksatellite:screensaverstop': function () { black = false; later(AFTER_BLACK); },
        'kiosksatellite:screenon': function () { black = false; later(AFTER_BLACK); }
      };
      if (focus) on['hk-camera-focus'] = function (e) {
        away = !!(e && e.detail && e.detail.away);
        if (away) { stop(); rest(); } else later(0);
      };
      var vis = function () { if (document.hidden) { stop(); rest(); } else later(0); };
      Object.keys(on).forEach(function (t) { window.addEventListener(t, on[t]); });
      document.addEventListener('visibilitychange', vis);
      return function () {
        stop();
        Object.keys(on).forEach(function (t) { window.removeEventListener(t, on[t]); });
        document.removeEventListener('visibilitychange', vis);
      };
    }

    // what the shell and the later parts use of this one
    K.AFTER_BLACK = AFTER_BLACK; K.blackFrame = blackFrame; K.CAM_FOCUS = CAM_FOCUS;
    K.LIVE_AFTER_WAKE = LIVE_AFTER_WAKE; K.LIVE_WAKE_MAX = LIVE_WAKE_MAX; K.liveVideo = liveVideo;
    K.loadedImg = loadedImg; K.playing = playing; K.playingVideo = playingVideo; K.releaseMedia = releaseMedia;
    K.restWatch = restWatch; K.stillLoaded = stillLoaded; K.VIDEO_OUTSIDE = VIDEO_OUTSIDE;
  };
})();
