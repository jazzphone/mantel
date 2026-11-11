// hk-saver-photos.js - photos and the mosaic.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-photos'] = function (K) {
    var actionsNow = K.actionsNow, alignOf = K.alignOf, behindAt = K.behindAt, cleanDepth = K.cleanDepth,
        clientNow = K.clientNow, coverRect = K.coverRect, CROSSFADE_MS = K.CROSSFADE_MS, drawnRect = K.drawnRect,
        faceOrigin = K.faceOrigin, faceWindow = K.faceWindow, fitOf = K.fitOf, FOCUS_F = K.FOCUS_F,
        glyphBox = K.glyphBox, isFlat = K.isFlat, layoutOf = K.layoutOf, MOSAIC_COLORS = K.MOSAIC_COLORS,
        mosaicAssign = K.mosaicAssign, mosaicPlan = K.mosaicPlan, photoUrl = K.photoUrl, screenEdge = K.screenEdge,
        ST = K.ST, TB_WAIT = K.TB_WAIT, tbKey = K.tbKey, tbShare = K.tbShare, teardown = K.teardown, WAKE = K.WAKE;
    // (phase 25: the owners' writers, docs/phase25/SAVER-STATE.md)
    var clock = K.clock, Draw = K.Draw, Layout = K.Layout, Music = K.Music, Pane = K.Pane, Run = K.Run,
        Screens = K.Screens, setAttr = K.setAttr;
    var Deck = K.Deck;


    // WHAT IT OWNS ON ST (phase 25, A: others read these; only this file writes them; tools/state_owners.py)
    ST.deck = null;
    ST.layer = 0;            // which of the two photo layers is on top
    ST.displayLayer = null;
    ST.sinceFc = 0;
    ST.shown = 0;
    ST.lastPhoto = null;
    ST.lastPh = null;
    ST.moState = null;
    ST.tbT = null;
    ST.lastSlide = '';
    ST.lyPhotoLum = null;
    ST.lyPhoto = null;

    // WHAT THE OTHERS ASK OF IT (phase 25, A): the only way another file changes the photos' state. Each is the
    // assignment it was, by name. A photo or a mosaic up counts toward the next slide; a slide up counts from 0.
    function countPhoto() { ST.shown++; ST.sinceFc++; }
    function lastPhotoIs(title) { ST.lastPhoto = title; }
    function slideShown(kind) { ST.sinceFc = 0; ST.lastSlide = kind; }
    function slideGone() { ST.lastSlide = ''; }
    function sinceSlide(n) { ST.sinceFc = n; }
    function flipLayer() { ST.layer = 1 - ST.layer; }
    function mosaicGone() { ST.moState = null; }
    function keepPh(ph) { ST.lastPh = ph; }               // the preview keeps the photo on screen (null: none)
    function deckFor(order) { if (!ST.deck || ST.deck.order !== order) ST.deck = new Deck(order); }
    function dropDeck() { ST.deck = null; }
    function showsLayer(el) { ST.displayLayer = el; }    // the photo layer on top (null: none)
    function tbCancel() { if (ST.tbT) { clearTimeout(ST.tbT); ST.tbT = null; } }

    // ITS OWN STATE (phase 25, A: off the shared ST, which only this file used; tools/state_owners.py)
    /** @type {any} */ var moRand = null;

    function mosaicOn() { return !!(ST.cfg && ST.cfg.mosaic && ST.mode === 'photos' && !(Draw.ckPhotos() && ST.cfg.clock_photo_soft)); }
    function moGap() {
      if (ST.cfg.mosaic_gap === 'none') return 0;
      return ST.cfg.mosaic_line > 0 ? ST.cfg.mosaic_line : ST.cfg.mosaic_gap === 'rounded' ? 12 : 3;
    }
    function moCount() {
      if (!ST.cfg.mosaic_random) { moRand = null; return ST.cfg.mosaic_count; }
      var now = clock.now();
      if (!moRand || now >= moRand.until || moRand.max !== ST.cfg.mosaic_count) {
        var max = ST.cfg.mosaic_count, prev = moRand ? moRand.n : 0, k = prev, tries = 0;
        while (k === prev && tries++ < 8) k = 1 + Math.floor(Math.random() * max);
        moRand = { n: k, max: max, until: now + ST.cfg.mosaic_every * 60000 };
      }
      return moRand.n;
    }
    function moDraw(cell, ph) {
      var r = cell.getBoundingClientRect ? cell.getBoundingClientRect() : { width: 0, height: 0 };
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var cw = Math.max(1, Math.round((r.width || 200) * dpr)), ch = Math.max(1, Math.round((r.height || 200) * dpr));
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      var sc = shapeOfPh(ph) === 'portrait' ? ST.cfg.portrait : ST.cfg.landscape, x = cv.getContext && cv.getContext('2d');
      if (x) {
        var zm = ((sc || {}).zoom || 100) / 100, kv = faceWindow(ph.item, ph.w, ph.h, cw, ch, zm);
        var R = kv ? coverRect(ph.w, ph.h, cw, ch, kv.fx, kv.fy, zm)
          : coverRect(ph.w, ph.h, cw, ch, FOCUS_F[(sc || {}).x] != null ? FOCUS_F[sc.x] : 0.5, FOCUS_F[(sc || {}).y] != null ? FOCUS_F[sc.y] : 0.5, zm);
        x.imageSmoothingQuality = 'high';
        try { x.drawImage(ph.img, R.sx, R.sy, R.sw, R.sh, 0, 0, cw, ch); } catch (e) { /* not drawable */ }
      }
      return cv;
    }
    function paintMosaic(m, first) {
      if (!ST.root) return;
      if (ST.fadeDone) ST.fadeDone();
      // ONE CELL, in place: the new photo fades in over the old one
      if (m.mosaicOne && ST.moState && ST.moState.layer === ST.displayLayer) {
        var cells = ST.moState.layer.querySelectorAll('.mocell');
        var choices = [];
        for (var i = 0; i < cells.length; i++) if (i !== ST.moState.lastCell) choices.push(i);
        var ci = choices[Math.floor(Math.random() * choices.length)], cell = cells[ci];
        var old = cell.querySelector('canvas'), cv = moDraw(cell, m.mosaicOne);
        Run.releasePh(m.mosaicOne);
        cv.style.opacity = '0';
        cell.appendChild(cv);
        void cv.offsetWidth;
        cv.style.opacity = '1';
        setTimeout(function () { if (old && old.parentNode) { clearCanvas(old); old.parentNode.removeChild(old); } }, CROSSFADE_MS + 100);
        ST.moState.lastCell = ci; ST.moState.left--;
        ST.shown++; ST.sinceFc++;
        return;
      }
      // a one-cell change whose mosaic is no longer on screen (the music slide
      // took the screen while its photo loaded): that photo on its own
      if (m.mosaicOne) { Run.paint(m.mosaicOne, first); return; }
      var layers = ST.root.querySelectorAll('.ph'), next = layers[1 - ST.layer];
      next.querySelectorAll('.mowrap').forEach(function (w) { w.querySelectorAll('canvas').forEach(clearCanvas); w.remove(); });
      // (a mosaic has no titles, and no time behind: the clock as set)
      next.querySelectorAll('.tb,.ttl').forEach(function (n) { n.remove(); });
      if (ST.host) setAttr(ST.host, 'tb', false);
      next.classList.remove('zoom');
      next.classList.add('mo');
      var fg = next.querySelector('img.fg'), bgc = next.querySelector('canvas.bg');
      if (fg) fg.removeAttribute('src');
      if (bgc) { bgc.hidden = true; clearCanvas(bgc); }
      if (Music.mus.paneNext !== null) { var pn = Music.mus.paneNext; Music.mus.paneNext = null; Pane.setPane(pn); }
      setAttr(next, 'pw', ST.paneUp);
      var W = Math.max(1, (window.innerWidth || 1280) - (ST.paneUp ? ST.paneW || 0 : 0)), H = Math.max(1, window.innerHeight || 800);
      var ports = m.mosaic.filter(function (ph) { return shapeOfPh(ph) === 'portrait'; }).length;
      var plan = mosaicPlan(m.mosaic.length, W, H, Math.random, ST.moState ? ST.moState.idx : -1, ports);
      var pick = mosaicAssign(plan.cells, m.mosaic.map(function (ph) { return shapeOfPh(ph) === 'portrait'; }), W, H);
      var g = moGap(), wrap = document.createElement('div');
      wrap.className = 'mowrap' + (ST.cfg.mosaic_gap === 'rounded' ? ' round' : '');
      wrap.style.padding = (g / 2) + 'px';
      wrap.style.background = MOSAIC_COLORS[ST.cfg.mosaic_color] || '#000';
      next.insertBefore(wrap, next.querySelector('.phscrim'));
      plan.cells.forEach(function (c, i) {
        var cell = document.createElement('div');
        cell.className = 'mocell';
        cell.style.left = 'calc(' + (c.x * 100) + '% + ' + (g / 2) + 'px)';
        cell.style.top = 'calc(' + (c.y * 100) + '% + ' + (g / 2) + 'px)';
        cell.style.width = 'calc(' + (c.w * 100) + '% - ' + g + 'px)';
        cell.style.height = 'calc(' + (c.h * 100) + '% - ' + g + 'px)';
        wrap.appendChild(cell);
        var ph = m.mosaic[pick[i]];
        if (ph) cell.appendChild(moDraw(cell, ph));
      });
      m.mosaic.forEach(Run.releasePh);            // (drawn into the cells: the full photos are let go)
      if (ST.cfg.zoom && !reducedMotion()) {
        next.style.setProperty('--zd', (ST.cfg.each_photo * 1000 + CROSSFADE_MS) + 'ms');
        void next.offsetWidth;
        next.classList.add('zoom');
      }
      ST.lastPh = null;
      Run.reveal(next, first);
      ST.layer = 1 - ST.layer;
      // a whole new mosaic now and then: after each cell has changed about twice
      ST.moState = { n: m.mosaic.length, idx: plan.idx, layer: next, left: m.mosaic.length * 2, lastCell: -1 };
      if (first && ST.entrance) ST.entrance();
      ST.shown++; ST.sinceFc++; ST.lastPhoto = (m.mosaic[0].item && (m.mosaic[0].item.title || m.mosaic[0].item.id)) || ST.lastPhoto;
    }
    // ONE PHOTO'S LAYOUT on its layer: whole or filled, the focus, the zoom,
    // the copy's dim (paint; and relayout, the preview's in-place change)
    function layOut(el, ph) {
      var fit = fitOf(ph.w, ph.h, ST.cfg.fill, ST.cfg.portrait && ST.cfg.portrait.fill);
      var sc = fit.portrait ? ST.cfg.portrait : ST.cfg.landscape, lay = layoutOf(sc);
      // KEEP IN VIEW: a photo with a focus is cropped around it (filled), and
      // the zoom closes in on it (filled or whole); without one, as before
      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      var W = (r && r.width) || window.innerWidth || 1280, H = (r && r.height) || window.innerHeight || 800;
      var zm = ((sc || {}).zoom || 100) / 100, kv = faceWindow(ph.item, ph.w, ph.h, W, H, zm), org = '';
      if (kv) {
        var ax = FOCUS_F[(sc || {}).x] != null ? FOCUS_F[sc.x] : 0.5, ay = FOCUS_F[(sc || {}).y] != null ? FOCUS_F[sc.y] : 0.5;
        if (fit.fit === 'cover') {
          var k1 = Math.max(W / ph.w, H / ph.h);
          ax = alignOf(kv.cx, Math.min(1, W / k1 / ph.w)); ay = alignOf(kv.cy, Math.min(1, H / k1 / ph.h));
          lay.pos = (ax * 100).toFixed(2) + '% ' + (ay * 100).toFixed(2) + '%';
        }
        var o = faceOrigin(kv.cx, kv.cy, ph.w, ph.h, W, H, fit.fit, ax, ay, zm);
        org = (o.ox * 100).toFixed(2) + '% ' + (o.oy * 100).toFixed(2) + '%';
      }
      el.style.setProperty('--fit', fit.fit);
      el.style.setProperty('--pos', lay.pos);
      el.style.setProperty('--org', org);
      el.style.setProperty('--zm', lay.zoom);
      el.style.setProperty('--bgdim', lay.dim);
      return { fit: fit, lay: lay };
    }
    // TIME BEHIND'S SIZE, HEIGHT AND DARKENING (2026-10-31, the owner: "adjust the clock's size and position
    // vertically", and dim the photo as Clock on Photos can): on the host, for the CSS; the darkening on Photos and
    // Both only (on Clock the photos' own Darken, --hk-ckdim, is the one)
    function tbLook(c) {
      if (!ST.host || !ST.host.style) return;
      var behindOn = !!c && photoOpts(c).behind;
      ST.host.style.setProperty('--tb-size', String(behindOn ? c.tb_size : 24));
      ST.host.style.setProperty('--tb-top', String(behindOn ? c.tb_top : 6));
      ST.host.style.setProperty('--tb-dim', String(behindOn && c.show !== 'clock' ? (c.tb_dim || 0) / 100 : 0));
    }
    function photoFaces(lay, ph, L, c) {
      c = c || ST.cfg;
      // (the photo this layer shows, for the layout's cut-out: layoutCut)
      lay.__ph = ph; lay.__fit = L && L.fit ? L.fit.fit : 'cover';
      lay.querySelectorAll('.tb,.ttl').forEach(function (n) { n.remove(); });
      if (!c || !ph || !ph.item) return;
      var it = ph.item, before = lay.querySelector('.phscrim');
      var po = photoOpts(c);
      // (the layout's Photo Title widget says this photo's album and year)
      if (ST.ly && (ST.lyPhoto = it)) {
        // (and its luminance, for the screen's ink: read once the photo has loaded)
        ST.lyPhotoLum = null;
        var im0 = ph.img;
        if (im0 && im0.complete) ST.lyPhotoLum = Draw.photoLum(im0);
        else if (im0 && im0.addEventListener) im0.addEventListener('load', function () { if (ST.ly) { ST.lyPhotoLum = Draw.photoLum(im0); Layout.layoutSoon(); } }, { once: true });
        Layout.layoutSoon();
      }
      if (po.titles && (it.album || it.year)) {
        var ttl = document.createElement('div'), tt = document.createElement('div');
        ttl.className = 'ttl'; tt.className = 'tt';
        if (it.album) { var b = document.createElement('b'); b.textContent = it.album; tt.appendChild(b); }
        if (it.year) { var y = document.createElement('span'); y.textContent = String(it.year); tt.appendChild(y); }
        ttl.appendChild(tt);
        lay.insertBefore(ttl, before);
      }
      if (ST.host) setAttr(ST.host, 'tb', po.behind);
      tbLook(c);
      if (!po.behind) return;
      var r = lay.getBoundingClientRect ? lay.getBoundingClientRect() : null;
      var W = Math.max(1, ((r && r.width) || window.innerWidth || 1280) - (ST.paneUp ? ST.paneW || 0 : 0)), H = (r && r.height) || window.innerHeight || 800;
      var pos = String((lay.style.getPropertyValue && lay.style.getPropertyValue('--pos')) || '50% 50%').split(/\s+/).map(function (v) { var n = parseFloat(v); return isFinite(n) ? n / 100 : 0.5; });
      if (pos[1] == null) pos[1] = 0.5;
      var tb = document.createElement('div'), t = document.createElement('div'), d = cleanDepth(it);
      t.className = 'tbt';
      t.textContent = timeNow();
      tb.appendChild(t);
      var cutIn = false, behind = function (yes) {
        tb.className = 'tb ' + (yes ? 'behind' : 'front');
        if (!yes || cutIn) return;
        cutIn = true;
        var cut = document.createElement('img'), m = 'url("' + d.mask + '")';
        cut.className = 'tbcut'; cut.alt = '';
        cut.style.setProperty('-webkit-mask-image', m);
        cut.style.setProperty('mask-image', m);
        cut.src = ph.url;
        tb.appendChild(cut);
      };
      if (d && ph.w && ph.h) {
        // (hidden until weighed -- the mask is a moment away the first time -- and never longer than TB_WAIT)
        var key = tbKey(d.mask, W, H, L.fit.fit, pos, t.textContent, c), settled = false;
        var settle = function (share) { if (settled) return; settled = true; behind(behindAt(share)); };
        tb.className = 'tb wait';
        tbShare(d.mask, drawnRect(ph.w, ph.h, W, H, L.fit.fit, pos[0], pos[1]), glyphBox(W, H, t.textContent, c), key, settle);
        if (!settled) setTimeout(function () { settle(null); }, TB_WAIT);
      } else behind(false);
      // (under the title: the subject cut out over the time, the album's name over them all)
      lay.insertBefore(tb, lay.querySelector('.ttl') || before);
      tbArm();
    }
    function timeNow() {
      var d = new Date(), h = d.getHours();
      if (!ST.cfg || !ST.cfg.clock_24) { h = h % 12; if (h === 0) h = 12; }
      return (ST.cfg && ST.cfg.clock_24 && h < 10 ? '0' : '') + h + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }
    function tbArm() {
      if (ST.tbT) return;
      ST.tbT = setTimeout(function () {
        ST.tbT = null;
        if (!ST.on || !ST.root || !ST.cfg || !photoOpts(ST.cfg).behind) return;
        var s = timeNow();
        ST.root.querySelectorAll('.tb .tbt').forEach(function (e) { if (e.textContent !== s) e.textContent = s; });
        tbArm();
      }, 60000 - Date.now() % 60000 + 50);
    }
    function relayout() {
      var top = ST.root && ST.root.querySelectorAll('.ph')[ST.layer];
      if (!top || !ST.lastPh || ST.mode !== 'photos') return false;
      var L = layOut(top, ST.lastPh), bg = top.querySelector('canvas.bg');
      photoFaces(top, ST.lastPh, L);
      if (L.fit.backdrop || ST.paneUp || Draw.ckPhotos()) { drawBackdrop(bg, ST.lastPh.img, L.lay.small); bg.hidden = false; } else { bg.hidden = true; clearCanvas(bg); }
      return true;
    }
    // A preview selection survives asynchronous module loads and option rebuilds.
    // It never enables a real screen's slides or writes settings.
    function syncPreviewSlide() {
      if (!ST.previewOn || !ST.on) return false;
      var kind = ST.previewSelected;
      if (!kind) return true;
      var ok = kind === 'music' ? (ST.muShowing || Screens.showMusicSlide()) : kind === 'weather' ? (Layout.WX.showing || Layout.slideShow(Layout.WX)) : kind === 'holiday' ?
        (Layout.HL.showing || Layout.slideShow(Layout.HL)) : kind === 'timer' ?
        (Layout.TM.showing || Layout.slideShow(Layout.TM)) :
        kind === 'energy' ? (ST.enShowing || Layout.showEnergySlide()) : ST.fcShowing || Screens.showForecastExtra();
      if (ok) Screens.extraIs(kind);
      return !!ok;
    }
    function restartPreview() {
      if (!ST.previewOn || !ST.on) return;
      Run.runOff();
      Run.slideCancel();
      teardown();
      Run.start('preview');
      setTimeout(syncPreviewSlide, 0);
    }

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
    function within(inRoot, el) {
      for (var n = el; n; n = n.parentNode || n.host) if (n === inRoot) return true;
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
      return (item.url ? Promise.resolve({ url: photoUrl(item, screenEdge(), window.devicePixelRatio) }) : callWS({ type: 'media_source/resolve_media', media_content_id: item.id })).then(
        function (r) {
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
      var photosOn = !!c && (c.show === 'photos' || c.show === 'both' || (c.show === 'clock' && c.clock_bg === 'photos' && !c.clock_photo_soft));
      return { titles: photosOn && !!c.photo_titles, behind: photosOn && !!c.time_behind };
    }

    // the options but the photos' own layout (shapeCfg's, and `fill`)
    function sansShapes(c) {
      var o = {};
      Object.keys(c || {}).forEach(function (k) { if (k !== 'portrait' && k !== 'landscape' && k !== 'fill') o[k] = c[k]; });
      return JSON.stringify(o);
    }

    // what a slide shows, as boxes on the screen: its words (each text's own box) and its small pictures -- glyphs, rings --
    // never its backdrop (a picture a third of the screen or more)
    function slideMarks(marksLayer) {
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
        if (cs.display === 'none' || cs.visibility === 'hidden' || (n !== marksLayer && +cs.opacity === 0)) return;
        if (/^(svg|img|canvas)$/i.test(n.tagName)) {
          var q = n.getBoundingClientRect();
          if (q.width > 0 && q.width < W / 3 && q.height < H / 3) out.push(q);
          return;
        }
        if (n.shadowRoot) walk(n.shadowRoot);
        for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      })(marksLayer);
      return out;
    }

    // what the shell and the later parts use of this one
    K.afterDraw = afterDraw; K.afterFade = afterFade; K.BACKDROP_SMALL = BACKDROP_SMALL; K.blackPage = blackPage;
    K.callWS = callWS; K.clearCanvas = clearCanvas; K.drawBackdrop = drawBackdrop; K.hostPhotoList = hostPhotoList;
    K.hostPhotoSource = hostPhotoSource; K.layOut = layOut; K.load = load; K.moCount = moCount; K.mosaicOn = mosaicOn;
    K.paintMosaic = paintMosaic; K.photoFaces = photoFaces; K.photoOpts = photoOpts; K.reducedMotion = reducedMotion;
    K.relayout = relayout; K.restartPreview = restartPreview; K.sansShapes = sansShapes; K.sendWS = sendWS;
    K.shapeOfPh = shapeOfPh; K.slideMarks = slideMarks; K.syncPreviewSlide = syncPreviewSlide; K.timeNow = timeNow;
    K.within = within;
    K.countPhoto = countPhoto; K.lastPhotoIs = lastPhotoIs; K.slideShown = slideShown; K.slideGone = slideGone;
    K.sinceSlide = sinceSlide; K.flipLayer = flipLayer; K.mosaicGone = mosaicGone; K.keepPh = keepPh; K.deckFor = deckFor;
    K.dropDeck = dropDeck; K.showsLayer = showsLayer; K.tbCancel = tbCancel;
  };
})();
