// hk-saver-photos.js - start, photos, the mosaic, the forecast slide and its corner.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-photos'] = function (K) {
    var actionsNow = K.actionsNow, clientNow = K.clientNow, isFlat = K.isFlat, photoUrl = K.photoUrl,
        screenEdge = K.screenEdge, WAKE = K.WAKE;

    // THE PAGE'S OWN BACKGROUND BLACK while the dashboard is held hidden under
    // the kiosk's black: whatever the tablet has not drawn again yet shows it.
    var pageBg = null;
    function blackPage(black) {
      var st = document.documentElement && document.documentElement.style;
      if (!st || !st.setProperty) return;
      if (black && pageBg === null) {
        pageBg = { value: st.getPropertyValue('background-color'), priority: st.getPropertyPriority ? st.getPropertyPriority('background-color') : '' };
        st.setProperty('background-color', '#000', 'important');
      } else if (!black && pageBg !== null) {
        if (pageBg.value) st.setProperty('background-color', pageBg.value, pageBg.priority);
        else st.removeProperty('background-color');
        pageBg = null;
      }
    }
    // Once the host's opacity transition has ended -- or FADE_LATE after its
    // length, should it never (no transition at 0 ms, or none drawn).
    var FADE_LATE = 1500;
    function afterFade(h, ms, fn) {
      if (isFlat()) { fn(); return; }
      var done = false;
      var end = function (e) { if (!e || (e.target === h && e.propertyName === 'opacity')) go(); };
      var go = function () {
        if (done) return;
        done = true;
        if (h.removeEventListener) h.removeEventListener('transitionend', end);
        fn();
      };
      if (h.addEventListener) h.addEventListener('transitionend', end);
      setTimeout(go, ms ? ms + FADE_LATE : 50);
    }
    // Two frames drawn (the dashboard under the 99 % screensaver), then
    // WAKE.hold for its pictures to come in.
    // NO FRAME BY WAKE.max: the page is not being drawn -- under the kiosk's
    // Black screensaver (it runs the page but draws none of it: the house's
    // wake turns the photos off before it takes the black down, and a night's
    // power-off selects the dashboard under it), or hidden. A fade run then
    // went unseen, and the black came down on a dashboard not yet drawn, half
    // its tiles missing for a frame (screen-recorded, 2026-10-09). So
    // `paused` (plain black), and the wait goes on for the frames however
    // long, then WAKE.lit -- the whole dashboard is drawn again.
    // `slow`: as after a wait from the start.
    // `drawing`: at the first frame -- or after a wait, the third: a tablet
    // that has not drawn the page meanwhile has let go of what it had drawn,
    // the screensaver's black too, and its first frame back showed the
    // dashboard through the black not yet drawn again (screen-recorded).
    function afterDraw(fn, drawing, paused, slow) {
      var done = false, drawn = false, waited = !!slow;
      var go = function () { if (!done) { done = true; if (drawing) drawing(); fn(); } };
      var frames = function (n, then) { requestAnimationFrame(n > 1 ? function () { frames(n - 1, then); } : then); };
      if (typeof requestAnimationFrame !== 'function') { setTimeout(go, WAKE.max); return; }
      requestAnimationFrame(function () {
        if (drawn) return;                   // each step once
        drawn = true;
        if (!waited) {
          if (drawing) drawing();
          frames(1, function () { setTimeout(go, WAKE.hold); });
          return;
        }
        frames(2, function () {
          if (drawing) drawing();
          frames(2, function () { setTimeout(go, WAKE.lit); });
        });
      });
      setTimeout(function () {
        if (drawn || done) return;
        if (!paused) { if (!slow) go(); return; }
        waited = true; paused();
      }, WAKE.max);
    }

    // `el` inside `root`, across shadow roots
    function within(root, el) {
      for (var n = el; n; n = n.parentNode || n.host) if (n === root) return true;
      return false;
    }

    // ------------------------------------------------------------ photos
    function callWS(msg) {
      var h = clientNow();
      if (!h || !h.callWS) return Promise.reject(new Error('no connection'));
      return h.callWS(msg);
    }
    // A WRITE (or a service call over the WebSocket): the client's action port.
    function sendWS(msg) {
      var act = actionsNow();
      if (!act) return Promise.reject(new Error('no connection'));
      return act.callWS(msg);
    }
    // THE HOST'S OWN PHOTOS (hkShell.photoSource / listPhotos): a host with a
    // photo library of its own may give this screen one of its albums, and
    // lists the photos of a source it serves itself (each with its address).
    // Home Assistant has neither: the folder below, as always.
    function hostPhotoSource(src) {
      var SH = window.hkShell;
      var own = SH && typeof SH.photoSource === 'function' ? SH.photoSource(src) : null;
      return typeof own === 'string' && own ? own : null;
    }
    function hostPhotoList(src) {
      var SH = window.hkShell;
      var got = SH && typeof SH.listPhotos === 'function' ? SH.listPhotos(src) : null;
      return got && typeof got.then === 'function' ? got : null;
    }
    function load(item) {
      // (a landscape is a plain address; a photo of yours is resolved first)
      return (item.url ? Promise.resolve({ url: photoUrl(item, screenEdge(), window.devicePixelRatio) }) : callWS({ type: 'media_source/resolve_media', media_content_id: item.id })).then(function (r) {
        var url = r && r.url;
        if (!url) throw new Error('no url');
        return new Promise(function (ok, fail) {
          var im = new Image();
          im.decoding = 'async';
          im.onload = function () {
            (im.decode ? im.decode().catch(function () { /* drawn anyway */ }) : Promise.resolve())
              .then(function () { ok({ url: url, w: im.naturalWidth, h: im.naturalHeight, item: item, img: im }); });
          };
          im.onerror = function () { fail(new Error('load')); };
          im.src = url;
        });
      });
    }
    function shapeOfPh(ph) { return ph.h > ph.w ? 'portrait' : 'landscape'; }
    // THE BACKDROP: the photo drawn small and blurred (a 96 px wide copy at the
    // screen's shape, cover-cropped), which the canvas's CSS scales to the
    // screen -- the upscale itself is the softness. THE BLUR IS THE SCALING:
    // the photo goes into a copy a quarter that size first and comes back up
    // smoothly. A canvas filter (blur(2px)) did it before, and WebKit ignores
    // one: on a Mac or an iPad the copy was the photo at 96 px, enlarged --
    // pixelated behind the pane (HK Settings' preview, 2026-10-10).
    var BACKDROP_W = 96, BACKDROP_SMALL = 24;
    // `sky`: colour stops painted under the picture first ([[offset, colour]...]: a landscape's transparent sky)
    function drawBackdrop(c, img, small, ay, sky) {
      if (isFlat()) { clearCanvas(c); return; }
      if (!c || !img) return;
      var W = Math.max(1, window.innerWidth || 1280), H = Math.max(1, window.innerHeight || 800);
      c.width = BACKDROP_W; c.height = Math.max(1, Math.round(BACKDROP_W * H / W));
      var ctx = c.getContext && c.getContext('2d');
      if (!ctx) return;
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      var t = document.createElement('canvas'), sw = small || BACKDROP_SMALL;
      t.width = sw; t.height = Math.max(1, Math.round(sw * H / W));
      var tc = t.getContext && t.getContext('2d');
      if (!tc) return;
      var k = Math.max(t.width / iw, t.height / ih), dw = iw * k, dh = ih * k;
      tc.imageSmoothingQuality = 'high';
      if (sky && sky.length) {
        var gr = tc.createLinearGradient(0, 0, 0, t.height);
        sky.forEach(function (s) { try { gr.addColorStop(s[0], s[1]); } catch (e) { /* not a colour */ } });
        tc.fillStyle = gr;
        tc.fillRect(0, 0, t.width, t.height);
      }
      tc.drawImage(img, (t.width - dw) / 2, (t.height - dh) * (ay == null ? 0.5 : ay), dw, dh);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t, 0, 0, c.width, c.height);
    }
    function clearCanvas(c) { if (c && c.width) { c.width = 0; c.height = 0; } }
    // REDUCE MOTION (2026-10-29): a device that asks for it (prefers-reduced-motion), or a Flat look, gets still
    // photos -- no Slow Zoom (its CSS animation was neutralised for a single photo already, but the mosaic's cells
    // still crept and every photo still held a composited layer for it), and nothing else that moves. The static
    // frames stay: the crossfade is a transition the same query switches off. The sky's own rule is the same word
    // (hkSettings.skyLook().animations).
    function reducedMotion() {
      var HS = window.hkSettings;
      try {
        return !!((HS && HS.rendering && !HS.rendering().motion) ||
                  (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
      } catch (e) { return false; }
    }
    // THE PREVIEW, ONLY ITS PHOTO'S SETTINGS CHANGED (Portrait or Landscape
    // Photos): the photo on screen laid out again where it is -- no fade out
    // and in, so a crop or a blur can be judged as it changes
    // PHOTO TITLES AND TIME BEHIND on a photo's layer (paint; relayout): the album and the year, bottom right; the
    // time upper centre, behind the photo's subject where its cut-out covers some of the figures, else in front
    // WHERE THE PHOTO OPTIONS APPLY (2026-10-30, the owner: switched to Clock with Time Behind left on from Photos,
    // "there is no way to turn it off"): Photo Titles and Time Behind only where the photos are shown as photos --
    // Show: Photos and Both, and Clock on Photos that aren't Soft (the Screensaver page offers both toggles in each of
    // those). Anywhere else -- Clock on Soft photos, Landscapes or a background of its own, the Forecast, Glance, Month
    // and Day -- a saved option does nothing.
    function photoOpts(c) {
      var on = !!c && (c.show === 'photos' || c.show === 'both' || (c.show === 'clock' && c.clock_bg === 'photos' && !c.clock_photo_soft));
      return { titles: on && !!c.photo_titles, behind: on && !!c.time_behind };
    }
    // the options but the photos' own layout (shapeCfg's, and `fill`)
    function sansShapes(c) {
      var o = {};
      Object.keys(c || {}).forEach(function (k) { if (k !== 'portrait' && k !== 'landscape' && k !== 'fill') o[k] = c[k]; });
      return JSON.stringify(o);
    }
    // what a slide shows, as boxes on the screen: its words (each text's own box) and its small pictures -- glyphs, rings --
    // never its backdrop (a picture a third of the screen or more)
    function slideMarks(layer) {
      var out = [], W = window.innerWidth || 1280, H = window.innerHeight || 800;
      (function walk(n) {
        if (n.nodeType === 3) {
          if (!n.textContent.trim()) return;
          var rg = document.createRange(); rg.selectNodeContents(n);
          var r = rg.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) out.push(r);
          return;
        }
        if (n.nodeType !== 1 || n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
        var cs = getComputedStyle(n);
        // (the slide's own layer may be fading in: only what is hidden inside it doesn't count)
        if (cs.display === 'none' || cs.visibility === 'hidden' || (n !== layer && +cs.opacity === 0)) return;
        if (/^(svg|img|canvas)$/i.test(n.tagName)) {
          var q = n.getBoundingClientRect();
          if (q.width > 0 && q.width < W / 3 && q.height < H / 3) out.push(q);
          return;
        }
        if (n.shadowRoot) walk(n.shadowRoot);
        for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      })(layer);
      return out;
    }

    // what the shell and the later parts use of this one
    K.afterDraw = afterDraw; K.afterFade = afterFade; K.BACKDROP_SMALL = BACKDROP_SMALL; K.blackPage = blackPage;
    K.callWS = callWS; K.clearCanvas = clearCanvas; K.drawBackdrop = drawBackdrop; K.hostPhotoList = hostPhotoList;
    K.hostPhotoSource = hostPhotoSource; K.load = load; K.photoOpts = photoOpts; K.reducedMotion = reducedMotion;
    K.sansShapes = sansShapes; K.sendWS = sendWS; K.shapeOfPh = shapeOfPh; K.slideMarks = slideMarks;
    K.within = within;
  };
})();
