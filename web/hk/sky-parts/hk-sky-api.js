// hk-sky-api.js - watching, the focus pause and what moves.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-api'] = function (K) {
    var ST = K.ST;

    function watch() {
      if (ST.watching) return;
      ST.watching = true;
      document.addEventListener('visibilitychange', applyHidden);
    }
    // ASLEEP = the tablet's screensaver switch is on, OR HK Frontend's own
    // screensaver is showing (hk-saver.js) -- a screen with no switch (no
    // Tablet Room) still pauses behind its photos.
    //
    // THE SCREEN'S OWN PHOTO SWITCH IS HK-SAVER'S TO READ (2026-10-09). When the
    // sleep entity is the switch hk-saver follows, the sky is asleep only while
    // the photos are actually showing. The house's sleep turns that switch on
    // and puts the kiosk's Black screensaver up; the photos are not shown under
    // the black (hk-saver), yet the sky went .hidden there -- its layers let go
    // -- and took them all back as the wake turned the switch off: the bottom
    // of the scenery vanished for three frames, every scripted wake
    // (screen-recorded on the Loft: a direct wake that left the switch on never
    // did it; turning the switch off made it every time).
    function sleeping() {
      var S = window.hkSaver, running = !!(S && S.running && S.running());
      var c = S && S.config && S.config();
      if (c && c.entity && c.entity === ST.sleepEntity) return running;
      return ST.asleep || running;
    }
    var FOCUS_DEVICE = (function () {
      try { return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (e) { return false; }
    })();
    function focusPause() {
      var S = window.hkSettings, look = null;
      try { look = S && S.skyLook ? S.skyLook() : null; } catch (e) { look = null; }
      return !look || look.focusPause !== false;
    }
    function focusCheck() {
      var u = FOCUS_DEVICE && focusPause() && typeof document.hasFocus === 'function' && !document.hasFocus();
      if (u === ST.unfocused) return;
      ST.unfocused = u;
      applyHidden();
    }
    // WHAT MOVES ACROSS THE SCENE, by the animation that carries it: what
    // flies, falls, bursts, wanders, flashes -- bats, the witch and the
    // sleigh, geese, falling leaves and petals, flakes, fireworks and
    // confetti, meteors, lightning, fireflies, the glints. A still picture of
    // the sky (hk-skyshot.js, the Pre-rendered blur) leaves these out: frozen,
    // each would be a smudge where nothing is a moment later. What drifts
    // slowly stays in (the clouds, the fog's wisps, the aurora), and so do the
    // rain and snow decks (hk-fall): blurred, a veil, which they are live too.
    // Names here are prefixes (the flights' are made per speed: near-flock-x…).
    var MOVERS = ['hk-spfly', 'hk-spfall', 'hk-xfall', 'hk-spburst', 'near-swirl', 'hk-bolt', 'near-confetti',
                  'hk-meteor', 'near-glow', 'near-glint', 'hk-ffwander', 'hk-witchfly', 'hk-sleigh', 'hk-batfly',
                  'near-flock', 'hk-leaffall', 'hk-leaftumble', 'near-petal', 'near-geese',
                  // a motion theme's meteors (2026-10-31, hk-wallpapers.js)
                  'hk-wt-meteor'];
    // WHAT DRIFTS ACROSS THE SKY while staying in its picture: the clouds, the fog's wisps, the moon's mist, the
    // aurora -- and a moving wallpaper (hk-wall-*, a motion theme's hk-wt-* layers; its meteors are MOVERS), the only
    // drift a wallpaper's `static` page has (2026-11-07: the glass kept its first picture 30 s). A pre-rendered blur
    // (hk-glass.js) paints its picture again every couple of seconds while any of these runs -- the pills over a cloud
    // lag it otherwise (the user, 2026-10-11). Not what loops in place, nor a wallpaper's loop quicker than 4 s (a
    // candle's flicker, a twinkle, the rain and snow decks): a picture at a random moment of it would make glass pulse.
    var DRIFTS = ['hk-rc', 'hk-drift', 'hk-fwisp', 'near-wisp', 'near-aurora'], WALLS = ['hk-wall-', 'hk-wt-sway', 'hk-wt-loop', 'hk-wt-tile'];
    function drifting() {
      var el = ST.mounted && ST.mounted.isConnected ? ST.mounted : null;
      // (paused -- not on screen, the window not in focus, the kiosk's black -- is not drifting: nothing to follow)
      if (!el || !el.getAnimations || /(^|\s)(noanim|hidden|held)(\s|$)/.test(el.className)) return false;
      var still = /(^|\s)static(\s|$)/.test(el.className), list, j, d;
      try { list = el.getAnimations({ subtree: true }); } catch (e) { return false; }
      for (var i = 0; i < list.length; i++) {
        var an = list[i], nm = String(an.animationName || '');
        if (an.playState !== 'running' || !nm) continue;
        try { d = +an.effect.getTiming().duration || 0; } catch (e) { d = 0; }
        for (j = 0; j < WALLS.length; j++) if (nm.indexOf(WALLS[j]) === 0 && d >= 4000) return true;
        for (j = 0; !still && j < DRIFTS.length; j++) if (nm.indexOf(DRIFTS[j]) === 0) return true;
      }
      return false;
    }
    function moves(cs) {
      var names = String(cs && cs.animationName || '').split(',');
      for (var i = 0; i < names.length; i++) {
        var nm = names[i].trim();
        for (var j = 0; j < MOVERS.length; j++) if (nm.indexOf(MOVERS[j]) === 0) return true;
      }
      return false;
    }
    // ...and whether they are still on their way: wanted, but the manifest or
    // the ceiling's art not in yet
    function cloudsPending(el) {
      var l = el && el.querySelector ? el.querySelector('.rcl') : null;
      if (!l || !l._rcOn || ST.RC_FAILED) return false;
      if (!ST.RC_MAN) return true;
      var cvs = l.querySelectorAll('canvas');
      for (var i = 0; i < cvs.length; i++) if (cvs[i].__src && !cvs[i].__drawn) return true;
      return false;
    }
    function applyHidden() {
      var hid = document.hidden || sleeping(), still = ST.ksDark || ST.unfocused, z = sleeping() || still;
      if (ST.mounted) {
        ST.mounted.classList.toggle('hidden', hid);
        ST.mounted.classList.toggle('held', !hid && still);
      }
      // ...and tell the cards, which pause their own animations behind the
      // screensaver and the kiosk's black too (hk-base.js, hk-asleep). Only on
      // a change.
      if (!!window.__hkAsleep !== z) {
        window.__hkAsleep = z;
        try { window.dispatchEvent(new Event('hk-asleep')); } catch (e) { /* no window events: nothing to tell */ }
      }
    }

    // what the shell and the later parts use of this one
    K.applyHidden = applyHidden; K.cloudsPending = cloudsPending; K.drifting = drifting;
    K.FOCUS_DEVICE = FOCUS_DEVICE; K.focusCheck = focusCheck; K.moves = moves; K.sleeping = sleeping; K.watch = watch;
  };
})();
