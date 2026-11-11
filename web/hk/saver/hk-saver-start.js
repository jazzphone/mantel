// hk-saver-start.js - starting and stopping the screensaver.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-start'] = function (K) {
    var afterDraw = K.afterDraw, afterFade = K.afterFade, allowed = K.allowed, armIdle = K.armIdle, black = K.black,
        blackPage = K.blackPage, build = K.build, callWS = K.callWS, cfgKey = K.cfgKey, ckPhotos = K.ckPhotos,
        cleanDepth = K.cleanDepth, cleanFocus = K.cleanFocus, cleanVariants = K.cleanVariants,
        clearCanvas = K.clearCanvas, clock = K.clock, closePanel = K.closePanel, CROSSFADE_MS = K.CROSSFADE_MS,
        cutsFollow = K.cutsFollow, Deck = K.Deck, drawBackdrop = K.drawBackdrop, energyPrep = K.energyPrep,
        energyReady = K.energyReady, enterClock = K.enterClock, enterForecast = K.enterForecast,
        enterLayout = K.enterLayout, ENTRANCE_MAX = K.ENTRANCE_MAX, exArm = K.exArm, FACE_SHOWS = K.FACE_SHOWS,
        FADE_BACK_MS = K.FADE_BACK_MS, FADE_IN_MS = K.FADE_IN_MS, GHOST_MS = K.GHOST_MS,
        hideEnergySlide = K.hideEnergySlide, hideForecastSlide = K.hideForecastSlide,
        hideMusicSlide = K.hideMusicSlide, HL = K.HL, hostPhotoList = K.hostPhotoList, isFlat = K.isFlat,
        isImage = K.isImage, justResumed = K.justResumed, LANDSCAPES = K.LANDSCAPES, landscapes = K.landscapes,
        layOut = K.layOut, layoutCut = K.layoutCut, leaveClock = K.leaveClock, LIST_DEPTH = K.LIST_DEPTH,
        LIST_MAX = K.LIST_MAX, LIST_TTL_MS = K.LIST_TTL_MS, LIT_GRACE = K.LIT_GRACE, load = K.load,
        moCount = K.moCount, mosaicOn = K.mosaicOn, mountClock = K.mountClock, mus = K.mus,
        musicPlaying = K.musicPlaying, paintMosaic = K.paintMosaic, photoFaces = K.photoFaces,
        PRESS_MAX = K.PRESS_MAX, reducedMotion = K.reducedMotion, releaseVisuals = K.releaseVisuals,
        resetForecast = K.resetForecast, setAttr = K.setAttr, setPane = K.setPane, setupPane = K.setupPane,
        shapeOfPh = K.shapeOfPh, showEnergySlide = K.showEnergySlide, showForecastSlide = K.showForecastSlide,
        showMusicSlide = K.showMusicSlide, slideHide = K.slideHide, slideOf = K.slideOf, slidePrep = K.slidePrep,
        slideReady = K.slideReady, slideShow = K.slideShow, ST = K.ST, syncPreviewSlide = K.syncPreviewSlide,
        takeover = K.takeover, teardown = K.teardown, TM = K.TM, tmWatch = K.tmWatch, updateBand = K.updateBand,
        within = K.within, writeSwitch = K.writeSwitch, WX = K.WX;

    // ------------------------------------------------------------ start / stop
    function start(reason) {
      if (ST.on || !ST.cfg || !allowed()) return false;
      // NOTHING STARTS UNDER THE KIOSK'S BLACK (2026-10-09). The house's sleep
      // turns the photos on and puts the black up in the same moment; started
      // under it and turned black at once, the screensaver was never shown --
      // the tablet's last frame was the dashboard -- yet the wake went through
      // black: dashboard, black, dashboard (screen-recorded on the Loft). Under
      // the black nobody sees photos anyway. The switch asks again on every
      // update, so they start when the black has ended -- after LIT_GRACE, the
      // house's answer to a tap (photos off within 2 s, TABLET-INVARIANTS 16c).
      if (black()) return false;
      if (reason === 'switch' && clock.now() - ST.litAt < LIT_GRACE) return false;
      if (ST.idleT) { clearTimeout(ST.idleT); ST.idleT = null; }
      ST.on = true; ST.startedBy = reason || 'idle'; ST.mx = null; ST.my = null; ST.press = null; ST.shownAt = 0;
      ST.photoRun++; ST.busy = false; ST.queued = null; ST.litWait = null;
      // BUILT FOR OTHER SETTINGS: its cards were set up for them (Home Status
      // sized for the calendar pane, or for the corner), and a host kept from
      // an earlier start kept them -- the pane turned off on HK Settings left
      // Home Status small, halfway along the top (2026-10-01). Built again.
      if (ST.host && (ST.host.hasAttribute('blocking') || ST.host.hasAttribute('released') || ST.builtFor !== cfgKey())) teardown();
      if (!ST.host) { build(); ST.builtFor = cfgKey(); }
      ST.host.style.setProperty('--fade', FADE_IN_MS + 'ms');
      if (ST.cfg.zoom && !reducedMotion()) ST.host.setAttribute('zoom', ''); else ST.host.removeAttribute('zoom');
      ST.host.removeAttribute('blocking');
      ST.host.removeAttribute('waking');       // started again while waking
      ST.host.removeAttribute('dark');
      // Once fully covered, release the dashboard's paint layers. Pausing its
      // animations alone still retains clouds, glass and offscreen cards. On
      // Android those plus the forecast exceeded the tile memory budget and
      // the WebView dropped photos, the clock and forecast days from the screen.
      // Counted from the frame the fade starts, not from here: a hidden page
      // runs timeouts but no frames, and would hide the dashboard under a saver
      // still at opacity 0.
      if (ST.coverT) clearTimeout(ST.coverT);
      ST.coverT = null;
      // THE FADE STARTS ONCE THERE IS SOMETHING TO SHOW (2026-10-09): the first
      // photo decoded and painted -- or the forecast built -- and two frames
      // drawn at [prep]'s barely-there opacity, so the tablet has rastered it;
      // never later than ENTRANCE_MAX
      ST.host.setAttribute('prep', '');
      var run = ST.photoRun, entered = false;
      ST.entrance = function (forceIt) {
        if (entered) return;
        // ...AND THE FORECAST BAND IN ITS PLACE (2026-10-09): it is built
        // hidden, centred, drawn again for its width beside the calendar pane
        // and only then shown (addBand, ~0.65 s). Started before that, the fade
        // ran over its redraw, and a tablet shows frames during a fade before
        // what changed is drawn: the band vanished for two frames halfway
        // through (screen-recorded on the Kitchen). Its `placed` calls this
        // again; ENTRANCE_MAX forces it.
        if (!forceIt && ST.fband && !ST.fband.__hkPlaced && ST.host && ST.host.hasAttribute('band')) return;
        entered = true; ST.entrance = null;
        var f1 = false, f2 = false;           // each frame's step once
        requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
          if (f2) return; f2 = true;
          if (!ST.on || !ST.host || ST.photoRun !== run) return;
          ST.host.removeAttribute('prep');
          ST.host.setAttribute('on', '');
          ST.shownAt = clock.now();
          noteDrawn();
          if (ST.coverT) clearTimeout(ST.coverT);
          ST.coverT = setTimeout(function () { ST.coverT = null; if (ST.on) coverDashboard(true); }, FADE_IN_MS + 100);
        }); });
      };
      setTimeout(function () { if (ST.photoRun === run && ST.entrance) ST.entrance(true); }, ENTRANCE_MAX);
      tellOthers();
      if (reason !== 'switch') writeSwitch('on');
      resetForecast();            // an element still fading out is reused
      setupPane();
      leaveClock();
      if (ST.cfg.show === 'clock' || FACE_SHOWS[ST.cfg.show]) enterClock();
      else if (ST.cfg.show === 'forecast') enterForecast();
      // MUSIC FIRST, music playing: straight into it
      else if (!ST.previewOn && ST.cfg.music_first && musicPlaying()) { updateBand(); if (!showMusicSlide(true)) showNext(true); }
      else { updateBand(); showNext(true); }
      // A LARGE CLOCK over the photos or the forecast (the corner one is a card)
      if (ST.cfg.show !== 'clock' && !FACE_SHOWS[ST.cfg.show] && ST.cfg.clock_large) mountClock('none');
      // THE LAYOUT over whatever background that was (2026-11-01, the Screensaver editor's)
      if (ST.cfg.layout) enterLayout();
      // HOME ENERGY: its numbers asked for now, so its first turn has them;
      // the additional screens' timer
      energyPrep();
      slidePrep(WX); slidePrep(HL); tmWatch();
      exArm();
      if (ST.previewOn) setTimeout(syncPreviewSlide, 0);
      return true;
    }
    function stop(reason) {
      if (!ST.on) return false;
      if (ST.designController) ST.designController.clear();
      if (ST.asked) { ST.asked = false; ST.force = ST.previewOn; }
      closePanel(false);
      ST.on = false;
      ST.entrance = null;
      if (ST.host) ST.host.removeAttribute('prep');
      // JUST WOKEN FROM A FROZEN PAGE (justResumed): what the screensaver shows
      // is stale and half drawn, so it wakes from black -- plain black at once,
      // the dashboard drawn under it, then the usual fade back to it
      if (ST.host && justResumed()) { ST.host.setAttribute('dark', ''); ST.host.setAttribute('on', ''); }
      noteDrawn();
      ST.photoRun++; ST.busy = false; ST.queued = null;
      // UNDER THE KIOSK'S BLACK, A DASHBOARD HIDDEN UNDER THE PHOTOS STAYS
      // HIDDEN until the tablet draws again (afterDraw's `drawing`): shown
      // where nothing is drawn, the tablet's first frame back had to draw all
      // of it at once, and showed it half drawn over everything for a frame
      // (screen-recorded)
      var keep = !!(ST.host && ST.host.hasAttribute('dark') && black());
      if (!keep) coverDashboard(false);
      if (ST.slideT) { clearTimeout(ST.slideT); ST.slideT = null; }
      if (ST.exT) { clearTimeout(ST.exT); ST.exT = null; }
      var ms = isFlat() ? 0 : ST.cfg ? ST.cfg.fade_back : FADE_BACK_MS;
      if (reason === 'touch') { writeSwitch('off'); ST.press = { up: ST.pressStop ? null : clock.now(), at: clock.now() }; }
      ST.pressStop = false;
      // the dashboard, its sky and its cameras wake now, under the screensaver
      tellOthers();
      var h = ST.host, stoppedRun = ST.photoRun;
      if (h) {
        var still = function () { return !ST.on && ST.host === h && ST.photoRun === stoppedRun; };
        h.style.setProperty('--fade', '0ms');
        h.setAttribute('waking', '');
        var fade = function () {
          if (!still()) return;
          h.style.setProperty('--fade', ms + 'ms');
          h.removeAttribute('on');
          h.removeAttribute('waking');
          noteDrawn();
          if (reason === 'touch') h.setAttribute('blocking', '');
          if (reason === 'touch') setTimeout(function () { if (still()) releaseVisuals(); }, ms + 50);
          // a touch's host stays until the taps are no longer swallowed;
          // otherwise it goes when its fade has ENDED, not when a timer of the
          // fade's length says so: just woken, the page is busy, the fade's
          // frames start late, and the timer cut its last fifth off -- the
          // dashboard stepped up at the end (screen-recorded)
          if (reason === 'touch') {
            var faded = false, p = ST.press;
            var release = function () {
              if (!still() || !faded) return;
              var now = clock.now(), up = p && p.up !== null ? p.up : (p && now - p.at >= PRESS_MAX ? now - GHOST_MS : null);
              if (up === null) { setTimeout(release, 100); return; }          // the finger is still down
              if (now < up + GHOST_MS) { setTimeout(release, up + GHOST_MS - now + 5); return; }
              teardown();
            };
            afterFade(h, ms, function () { faded = true; release(); });
          } else afterFade(h, ms, function () { if (still()) teardown(); });
        };
        var whenShown = function () { if (still()) { coverDashboard(false); blackPage(false); } };
        // AS IT COMES BACK the tablet first shows the frame it last drew
        // (through the kiosk's own fade off its black), so the wake goes on
        // from that frame -- never a cut to something else
        var fromLast = function () {
          if (!still()) return;
          if (ST.drawnAs === 'dark') h.setAttribute('dark', '');      // black, then the fade
          else if (ST.drawnAs === 'dashboard') {                       // the dashboard, at once
            whenShown();
            h.removeAttribute('on'); h.removeAttribute('waking'); h.removeAttribute('dark');
          }
          else { whenShown(); h.removeAttribute('dark'); }             // the photos, then the fade
        };
        if (keep) {
          // STOPPED UNDER THE KIOSK'S BLACK (the house's wake turns the photos
          // off just before it takes the black down): nothing until the black
          // has ended. The tablet draws the page again a moment BEFORE it ends,
          // and its first frames after the black left out the screensaver's
          // own black -- the dashboard showed through, half drawn, for a frame
          // (screen-recorded). So the dashboard stays hidden over the page's
          // black background until frames have been drawn after it.
          blackPage(true);
          ST.litWait = function () { fromLast(); afterDraw(fade, whenShown, null, ST.drawnAs === 'dark'); };
        } else afterDraw(fade, whenShown, fromLast);
      }
      ST.lastInput = Date.now();
      armIdle();
      return true;
    }
    function lit() {
      if (black() || !ST.litWait) return;
      var fn = ST.litWait; ST.litWait = null; fn();
    }
    function noteDrawn() {
      if (typeof requestAnimationFrame !== 'function') return;
      var run = ++ST.noteRun, seen = null;
      requestAnimationFrame(function () {
        if (seen) return;                    // each step once
        seen = !ST.host || !ST.host.hasAttribute('on') ? 'dashboard' : ST.host.hasAttribute('dark') ? 'dark' : 'photos';
        requestAnimationFrame(function () { requestAnimationFrame(function () { if (run === ST.noteRun) ST.drawnAs = seen; }); });
      });
    }
    // The sky, the cards and a dismissed pop-up's record all follow this.
    function tellOthers() {
      try { if (window.hkSky && window.hkSky.saverChanged) window.hkSky.saverChanged(); } catch (e) { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('hk-saver', { detail: { on: ST.on } })); } catch (e) { /* ignore */ }
    }

    // visibility preserves layout, scroll position and the connected HA data
    // subscription. Restore it before the screensaver fades out, and preserve
    // any visibility style that was already set by the page.
    function coverDashboard(covered) {
      if (!covered) {
        if (ST.coverT) { clearTimeout(ST.coverT); ST.coverT = null; }
        if (ST.coveredPage) {
          var st = ST.coveredPage.style;
          if (ST.pageVisibility.value) st.setProperty('visibility', ST.pageVisibility.value, ST.pageVisibility.priority);
          else st.removeProperty('visibility');
        }
        ST.coveredView.forEach(function (c) {
          if (c.value) c.el.style.setProperty('visibility', c.value, c.priority); else c.el.style.removeProperty('visibility');
        });
        ST.coveredPage = null; ST.pageVisibility = null; ST.coveredView = [];
        return;
      }
      if (ST.coveredPage) return;
      var page = window.hkShell.root();
      if (!page || !page.style) return;
      ST.coveredPage = page;
      ST.pageVisibility = { value: page.style.getPropertyValue('visibility'), priority: page.style.getPropertyPriority('visibility') };
      page.style.setProperty('visibility', 'hidden', 'important');
      // THE VIEW, WHERE THE HOST KEEPS IT OUTSIDE ITS ROOT (Mantel: #view
      // beside #hk-shell-root, 2026-10-21). Left showing under the photos, the
      // whole dashboard -- its sky, its cards, the shared blur's layers -- kept
      // its compositing layers through the screensaver (~7 screens of them at
      // 1920 x 1200, headless), and Return to Home made a new page's ~120 under
      // it mid-turn. Hidden with the root, as Home Assistant's whole page is.
      var view = window.hkShell.viewContainer ? window.hkShell.viewContainer() : null;
      if (view && view.style && !within(page, view)) {
        ST.coveredView.push({ el: view, value: view.style.getPropertyValue('visibility'), priority: view.style.getPropertyPriority('visibility') });
        view.style.setProperty('visibility', 'hidden', 'important');
      }
      // BACK TO THE TOP, UNSEEN (2026-10-04). The house's sleep script used to
      // do this with a Fully `javascript:` load_url -- which stole the
      // foreground from a running app (TABLET-INVARIANTS section 2) and which
      // Kiosk Satellite cannot run at all. The page is covered and hidden now,
      // so the jump is never seen, and the next wake lands on the top of the
      // dashboard whichever kiosk app is showing it.
      if (typeof window.scrollTo === 'function') {
        try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
      }
      // Camera teardown can visibly replace live video with its poster. Only
      // allow that once the entrance fade has covered and hidden the dashboard.
      try { window.dispatchEvent(new Event('hk-saver-covered')); } catch (e) { /* ignore */ }
    }

    // Every image under the folder (sub-folders to LIST_DEPTH), at most LIST_MAX.
    function listPhotos() {
      var land = landscapes();
      var key = (land ? LANDSCAPES : ST.cfg.photos) + '|' + ST.cfg.order;
      if (ST.deck && ST.listKey === key && Date.now() - ST.listAt < LIST_TTL_MS && ST.deck.items.length) return Promise.resolve(ST.deck);
      if (ST.listing && ST.listing.key === key) return ST.listing;
      var out = [];
      function walk(id, depth) {
        if (out.length >= LIST_MAX) return Promise.resolve();
        return callWS({ type: 'media_source/browse_media', media_content_id: id }).then(function (r) {
          var kids = (r && r.children) || [];
          var sub = [];
          // (the folder's own title: its photos' album, for Photo Titles)
          var album = r && typeof r.title === 'string' ? r.title : '';
          kids.forEach(function (k) {
            if (out.length >= LIST_MAX) return;
            if (k.can_expand && depth < LIST_DEPTH) sub.push(k.media_content_id);
            else if (!k.can_expand && isImage(k)) out.push(album ? { id: k.media_content_id, title: k.title || '', album: album } : { id: k.media_content_id, title: k.title || '' });
          });
          return sub.reduce(function (p, s) { return p.then(function () { return walk(s, depth + 1); }); }, Promise.resolve());
        });
      }
      var hostList = land ? null : hostPhotoList(ST.cfg.photos);
      var source = land
        ? fetch(LANDSCAPES + 'index.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
            ((j && j.photos) || []).forEach(function (p) {
              if (p && typeof p.file === 'string' && /^[\w.-]+\.(webp|jpe?g|png)$/i.test(p.file)) out.push({ id: 'hk-landscape/' + p.file, title: p.title || '', url: LANDSCAPES + p.file });
            });
          })
        // the host's own: a plain address each, as a landscape's (load)
        : hostList ? hostList.then(function (items) {
            (Array.isArray(items) ? items : []).forEach(function (p) {
              if (out.length < LIST_MAX && p && typeof p.id === 'string' && typeof p.url === 'string' && p.url) {
                var it = { id: 'host/' + p.id, title: typeof p.title === 'string' ? p.title : '', url: p.url }, fc = cleanFocus(p), vs = cleanVariants(p);
                if (vs.length) it.variants = vs;
                if (fc.focus) it.focus = fc.focus;
                if (fc.faces) it.faces = fc.faces;
                // Photo Titles and Time Behind: the album, the year, the cut-out
                var dp = cleanDepth(p);
                if (dp) it.depth = dp;
                if (typeof p.album === 'string' && p.album) it.album = p.album.slice(0, 80);
                if (typeof p.year === 'number' && isFinite(p.year) && p.year >= 1900 && p.year <= 2100) it.year = Math.round(p.year);
                // (the day it was taken, where the server knows it: On This Day, phase 13)
                if (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) it.date = p.date;
                out.push(it);
              }
            });
          })
        : walk(ST.cfg.photos, 0);
      ST.listing = source.then(function () {
        if (!ST.deck || ST.deck.order !== ST.cfg.order) ST.deck = new Deck(ST.cfg.order);
        ST.deck.set(out);
        ST.listAt = Date.now(); ST.listKey = key;
        return ST.deck;
      }).catch(function (e) {
        console.warn('[hk-saver] photos', land ? LANDSCAPES : ST.cfg.photos, e && e.message);
        if (!ST.deck) ST.deck = new Deck(ST.cfg.order);
        ST.listAt = Date.now() - LIST_TTL_MS + 60000;   // try again in a minute
        return ST.deck;
      }).then(function (d) { ST.listing = null; return d; });
      ST.listing.key = key;
      return ST.listing;
    }
    // THE DECODED PHOTO LET GO (2026-10-29): load() holds the picture in an
    // Image of its own (to know its size and to draw the backdrop or a mosaic
    // cell from), and the layer's <img> decodes it again. Once what is drawn
    // from it has been drawn, that Image's source is dropped, so a tablet that
    // shows photos all day holds one decoded photo, not two plus the last. The
    // preview keeps its photo (relayout draws from it again); ph.w and ph.h stay.
    function releasePh(ph) {
      var im = ph && ph.img;
      if (!im || (ST.previewOn && ph === ST.lastPh)) return;
      im.onload = im.onerror = null;
      try { im.removeAttribute('src'); } catch (e) { /* not an element */ }
      ph.img = null;
    }
    var shapes = {};
    function showNext(first) { advance(function () { return ST.deck && ST.deck.next(); }, first); }
    function nextPhoto() { ST.moTap = true; advance(function () { return ST.deck && ST.deck.next(); }); }
    function previousPhoto() { ST.moTap = true; advance(function () { return ST.deck && ST.deck.previous(); }); }
    function advance(pick, first) {
      if (!ST.on || ST.mode !== 'photos') return;
      if (ST.busy) { ST.queued = pick; return; }
      ST.busy = true;
      var run = ST.photoRun, saverRoot = ST.root;
      function active() { return ST.on && run === ST.photoRun && ST.root === saverRoot; }
      if (ST.slideT) { clearTimeout(ST.slideT); ST.slideT = null; }
      var tries = 0, looks = 0;
      var want = ST.previewOn && ST.previewShape ? ST.previewShape : null;
      function attempt() {
        return listPhotos().then(function (d) {
          if (!active()) return null;
          // NO PHOTOS (an empty folder, one that can't be read): the forecast
          if (!d || !d.items || !d.items.length) {
            if (ST.on && (ST.cfg.fallback || ST.cfg.show === 'both')) enterForecast();
            return null;
          }
          // the preview, restarted by a change: the same photo again
          if (first && ST.previewOn && ST.lastPh && d.items.some(function (it) { return it.id === ST.lastPh.item.id; }) && (!want || shapeOfPh(ST.lastPh) === want)) return ST.lastPh;
          var item = pick();
          // the preview's shape: skip the photos known to be the other one
          for (var k = 0; want && item && shapes[item.id] && shapes[item.id] !== want && k < d.items.length; k++) item = d.next();
          if (!item) return null;
          return load(item).then(function (ph) {
            shapes[item.id] = shapeOfPh(ph);
            if (want && shapes[item.id] !== want && ++looks < 12 && active()) { pick = function () { return d.next(); }; return attempt(); }
            return ph;
          }, function (e) {
            if (!active()) return null;
            ST.failed++;
            if (++tries < 3) { pick = function () { return d.next(); }; return attempt(); }
            throw e;
          });
        });
      }
      // THE MOSAIC: its photos, all of them for a new layout -- or one, for a
      // cell of the one on screen (Changes: One at a Time; a tap on an edge
      // always brings a whole new mosaic)
      function attemptMosaic() {
        return listPhotos().then(function (d) {
          if (!active()) return null;
          if (!d || !d.items || !d.items.length) {
            if (ST.on && (ST.cfg.fallback || ST.cfg.show === 'both')) enterForecast();
            return null;
          }
          var n = Math.min(moCount(), d.items.length);
          if (n < 2) return attempt();
          var one = !first && !ST.moTap && ST.cfg.mosaic_change === 'one' && ST.moState && ST.moState.n === n && ST.moState.left > 0 && ST.moState.layer === ST.displayLayer;
          ST.moTap = false;
          var want = one ? 1 : n, got = [], misses = 0;
          var step = function () {
            if (got.length >= want || !active()) return got;
            var item = got.length ? d.next() : pick();
            if (!item) return got;
            return load(item).then(function (ph) { shapes[item.id] = shapeOfPh(ph); got.push(ph); return step(); },
                                   function () { ST.failed++; return ++misses < 4 ? step() : got; });
          };
          return Promise.resolve(step()).then(function (phs) {
            if (!active() || !phs.length) return null;
            if (one) return { mosaicOne: phs[0] };
            return phs.length >= 2 ? { mosaic: phs } : phs[0];
          });
        });
      }
      (mosaicOn() ? attemptMosaic() : attempt()).then(function (ph) {
        if (ph && active()) { if (ph.mosaic || ph.mosaicOne) paintMosaic(ph, first); else paint(ph, first); return true; }
        return false;
      }).catch(function () { return false; }).then(function (painted) {
        if (!active()) return;
        if (painted && ST.mode === 'photos' && !ST.exKind) { hideForecastSlide(); hideMusicSlide(); hideEnergySlide(); slideHide(WX); slideHide(HL); slideHide(TM); }
        ST.busy = false;
        if (!ST.on) return;
        if (ST.mode !== 'photos') { ST.queued = null; return; }
        if (ST.queued) { var q = ST.queued; ST.queued = null; advance(q); return; }
        schedule();
      });
    }
    function schedule() {
      if (ST.slideT) clearTimeout(ST.slideT);
      ST.slideT = null;
      if (ST.previewOn) return;
      if (black()) { ST.slideHeld = true; return; }
      ST.slideHeld = false;
      ST.slideT = setTimeout(function () {
        ST.slideT = null;
        if (!ST.on || !ST.cfg) return;             // stopped (its config gone) meanwhile
        if (black()) { ST.slideHeld = true; return; }    // the black went up while it waited
        // a hidden page (a backgrounded tab) does not turn photos, nor one
        // with the music's panel open
        if (document.hidden || ST.pnl) { schedule(); return; }
        // the music holding the screen stays (musicWatch lets it go); an
        // additional screen over the photos behind the clock holds them
        if ((ST.muShowing && takeover()) || ST.exKind) { schedule(); return; }
        if (ST.fcShowing || ST.muShowing || ST.enShowing || WX.showing || HL.showing || TM.showing) { showNext(false); return; }    // advance() takes the slide away
        // A SLIDE every few photos: the music, the forecast and Home Energy
        // take turns (the music only while it plays)
        if (ST.sinceFc >= ST.cfg.forecast_every) {
          if (ST.lastSlide && ST.lastSlide !== 'timer') ST.slideBefore = ST.lastSlide;
          var s = slideOf(ST.cfg, musicPlaying(), ST.lastSlide, energyReady(), slideReady(WX), slideReady(HL), slideReady(TM), ST.slideBefore);
          if (s === 'music' && showMusicSlide()) { schedule(); return; }
          if ((s === 'weather' || s === 'holiday' || s === 'timer') && slideShow(s === 'weather' ? WX : s === 'timer' ? TM : HL)) { schedule(); return; }
          if (s === 'energy' && showEnergySlide()) { schedule(); return; }
          if (s && ST.cfg.show === 'both') { showForecastSlide(); schedule(); return; }
        }
        showNext(false);
      }, ST.cfg.each_photo * 1000);
    }
    // Fade the incoming view ABOVE an opaque outgoing view. Swapping a photo
    // underneath an opaque forecast leaves it occluded: Android WebView can
    // defer rasterizing it until after the forecast has already faded to black.
    // The clock/pane and forecast details have fixed stacking levels above both.
    function reveal(next, first) {
      if (ST.fadeDone) ST.fadeDone();
      if (next === ST.displayLayer) return;
      var old = ST.displayLayer;
      next.style.transition = 'none';
      next.classList.remove('top');
      next.style.zIndex = '2';
      if (old) old.style.zIndex = '1';
      void next.offsetWidth;
      next.style.transition = first || !old ? 'none' : '';
      next.classList.add('top');
      ST.displayLayer = next;
      // (the subject's twin over the layout's face, in step: phase 3)
      if (ST.ly) { layoutCut(); cutsFollow(); }
      var timer;
      var done = ST.fadeDone = function () {
        if (ST.fadeDone !== done) return;
        clearTimeout(timer);
        // An edge tap can interrupt a fade. Finish its incoming view before
        // removing the opaque backing, so the next handoff never starts dim.
        next.style.transition = 'none';
        void next.offsetWidth;
        if (old) {
          old.style.transition = 'none';
          old.classList.remove('top');
          old.style.zIndex = '0';
          if (old.classList.contains('ph')) {
            old.classList.remove('zoom');
            old.querySelectorAll('img').forEach(function (im) { im.removeAttribute('src'); });
            old.querySelectorAll('canvas').forEach(clearCanvas);
          }
        }
        next.style.zIndex = '1';
        ST.fadeDone = null;
        if (ST.ly) cutsFollow();
      };
      if (isFlat()) done(); else timer = setTimeout(done, first || !old ? 0 : CROSSFADE_MS + 100);
    }
    function paint(ph, first) {
      if (!ST.root) return;
      if (ST.fadeDone) ST.fadeDone();
      var layers = ST.root.querySelectorAll('.ph');
      var next = layers[1 - ST.layer];
      var bg = next.querySelector('canvas.bg'), fg = next.querySelector('img.fg');
      next.classList.remove('zoom');
      // (a mosaic's cells, from before: gone)
      next.classList.remove('mo');
      next.querySelectorAll('.mowrap').forEach(function (w) { w.querySelectorAll('canvas').forEach(clearCanvas); w.remove(); });
      ST.moState = null;
      var L = layOut(next, ph), fit = L.fit, lay = L.lay;
      // (the preview keeps it, to show again as its settings change)
      ST.lastPh = ST.previewOn ? ph : null;
      fg.src = ph.url;
      photoFaces(next, ph, L);
      // (with the calendar pane the blurred copy is always there: it is the
      // pane's background)
      // THE PANE comes or goes with a new photo (music_pane alone, as music
      // starts or stops): each photo is laid out for the pane as it came in
      // ([pw]), so the one fading out never moves
      if (mus.paneNext !== null) { var pn = mus.paneNext; mus.paneNext = null; setPane(pn); }
      setAttr(next, 'pw', ST.paneUp);
      if (fit.backdrop || ST.paneUp || ckPhotos()) { drawBackdrop(bg, ph.img, lay.small); bg.hidden = false; } else { bg.hidden = true; clearCanvas(bg); }
      releasePh(ph);
      if (ST.cfg.zoom && !reducedMotion()) {
        next.style.setProperty('--zd', (ST.cfg.each_photo * 1000 + CROSSFADE_MS) + 'ms');
        void next.offsetWidth;               // restart the zoom from 1
        next.classList.add('zoom');
      }
      reveal(next, first);
      ST.layer = 1 - ST.layer;
      // the first photo is in: the screensaver may fade in now (start)
      if (first && ST.entrance) ST.entrance();
      ST.shown++; ST.sinceFc++; ST.lastPhoto = ph.item.title || ph.item.id;
    }

    // what the shell and the later parts use of this one
    K.coverDashboard = coverDashboard; K.lit = lit; K.nextPhoto = nextPhoto; K.noteDrawn = noteDrawn; K.paint = paint;
    K.previousPhoto = previousPhoto; K.releasePh = releasePh; K.reveal = reveal; K.schedule = schedule;
    K.showNext = showNext; K.start = start; K.stop = stop; K.tellOthers = tellOthers;
  };
})();
