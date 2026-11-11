// hk-saver-black.js - HK's own black.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-black'] = function (K) {
    var allowed = K.allowed, armIdle = K.armIdle, black = K.black, blackChanged = K.blackChanged,
        centerBand = K.centerBand, clientNow = K.clientNow, closePanel = K.closePanel, CURTAIN_FADE = K.CURTAIN_FADE,
        CURTAIN_HOLD_HK = K.CURTAIN_HOLD_HK, curtainDown = K.curtainDown, dashConf = K.dashConf,
        drawCurtain = K.drawCurtain, energyLayout = K.energyLayout, fcVisible = K.fcVisible, framed = K.framed,
        fromSettings = K.fromSettings, HL = K.HL, hostPhotoSource = K.hostPhotoSource, houseBlock = K.houseBlock,
        isFlat = K.isFlat, layoutPane = K.layoutPane, layoutSoon = K.layoutSoon, mine = K.mine, mus = K.mus,
        musicWatch = K.musicWatch, onUpdate = K.onUpdate, previewPaneOf = K.previewPaneOf, readCfg = K.readCfg,
        refreshSoon = K.refreshSoon, relayout = K.relayout, remountClock = K.remountClock,
        reportTouch = K.reportTouch, restartPreview = K.restartPreview, sansClock = K.sansClock,
        sansShapes = K.sansShapes, sansSlides = K.sansSlides, sendWS = K.sendWS, slideLayout = K.slideLayout,
        slidesAgain = K.slidesAgain, ST = K.ST, syncPreviewSlide = K.syncPreviewSlide, tabletNow = K.tabletNow,
        teardown = K.teardown, TM = K.TM, tmWatch = K.tmWatch, user = K.user, withPane = K.withPane,
        writeSwitch = K.writeSwitch, WX = K.WX;
    // (phase 25: the owners' writers, docs/phase25/SAVER-STATE.md)
    var clock = K.clock, curtainOpts = K.curtainOpts, curtainStale = K.curtainStale, dropDeck = K.dropDeck,
        forecastSig = K.forecastSig, forecastSky = K.forecastSky, idleCancel = K.idleCancel, noteInput = K.noteInput,
        paneNote = K.paneNote, Run = K.Run, touchAgain = K.touchAgain;

    // WHAT IT OWNS ON ST (phase 25, A: others read these; only this file writes them; tools/state_owners.py)
    ST.hkFirst = true;
    ST.lastRaw = '';
    ST.resumedAt = 0;
    ST.cfg = null;    // the config in force (null: none here)
    ST.hkOn = false;
    ST.litAt = 0;

    // ITS OWN STATE (phase 25, A: off the shared ST, which only this file used; tools/state_owners.py)
    /** @type {any} */ var hkRun = 0;
    /** @type {any} */ var hkAcked = false;
    /** @type {any} */ var hkDown = false;
    /** @type {any} */ var hkAckTry = 0;
    /** @type {any} */ var hkWokeAt = 0;
    /** @type {any} */ var lightRun = 0;
    /** @type {any} */ var hubOff = null;

    // WHAT THE OTHERS ASK OF IT (phase 25, A): the only way another file changes the config's or the heartbeat's
    // state, each the assignment it was, by name
    function forgetRaw() { ST.lastRaw = null; }             // the next refresh reads the config afresh
    function hkAgain() { ST.hkFirst = true; }               // the house's black: the next sync is a first one
    function beatFrom() { ST.lastBeat = clock.now(); }      // the heartbeat counts from now
    function resumedNow() { ST.resumedAt = clock.now(); }   // the page was shown again

    var HK_WOKE_HOLD = 6000;
    // BLACK OR NOT -- OR NOT KNOWN YET (null): a page loading has its settings,
    // its screensaver's config, its user and the switch arrive one by one, and
    // "not known" is not "not black". Read as no, a page reloaded under its
    // black (the 00:02 app restart, a cache clear) faded its cover, showed
    // the dashboard, then went black again a moment later (the Loft,
    // 2026-10-09). Until it can tell, nothing changes: the cover stays.
    function hkWanted(h) {
      var HS = window.hkSettings, live = !!(HS && HS.live);
      // the tablet is known by its user (or its address): until the user is
      // there, not known -- a cover over a reload stays
      if (!user() && !(HS && HS.tablet && rememberedTabletId())) return null;
      var b = hkBoard();
      if (!b) return live ? false : null;
      if (b.black_screen !== 'hk') return false;
      // only on the screen's own tablet, as for the photos
      if (framed || ST.previewOn || ST.force) return false;
      if (/[?&](hk_saver|wp_enabled)=(force|off|false)\b/.test(location.search)) return false;
      if (!b.black_switch) return live ? false : null;
      if (!ST.cfg) return null;
      if (!mine()) return false;
      // woken by a tap a moment ago: the switch is on its way off
      if (clock.now() - hkWokeAt < HK_WOKE_HOLD) return false;
      var st = h && h.states && h.states[b.black_switch];
      return st ? st.state === 'on' : null;
    }
    function hkAck(ackOn) {
      var t = hkBoard();
      sendWS(t && !t.legacy ? { type: 'hk_frontend/screensaver/black', tablet: t.id, black: ackOn }
                            : { type: 'hk_frontend/screensaver/black', dashboard: dashSeg(), black: ackOn })
        .then(function () { if (ackOn) hkAcked = true; }, function () { /* older integration: the sleep falls back */ });
    }
    // black: once the curtain is drawn, the backlight down, then say so
    function hkDarken() {
      var run = ++hkRun, done = false;
      var go = function () {
        if (done || run !== hkRun || !ST.hkOn) return;
        done = true;
        var k = kiosk(), down = function () { if (run === hkRun && ST.hkOn) { setBacklight(0); hkDown = true; hkAckTry = clock.now(); hkAck(true); } };
        if (k && typeof k.getBrightness === 'function') {
          try {
            Promise.resolve(k.getBrightness()).then(function (b) {
              // (a page reloaded while black reads its own minimum: keep the one before)
              if (typeof b === 'number' && b > 0.02) store(BRIGHT_KEY, b);
            }, function () {}).then(down);
          } catch (e) { down(); }
        } else down();
      };
      setTimeout(go, 600);
      if (typeof requestAnimationFrame !== 'function') { go(); return; }
      var f1 = false;
      requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(go); });
    }
    function hkLeave(h) {
      hkRun++; hkAcked = false; hkDown = false;
      store(BLACK_KEY, null);
      var v = wakeBrightness(h);
      // kept until the black really ends: under the kiosk's black as well (the
      // house's fallback), the backlight comes up as THAT one comes down
      curtainOpts({ hold: CURTAIN_HOLD_HK, onFade: function () { if (v != null) rampBacklight(v, CURTAIN_FADE); } });
      blackChanged();
    }
    // every new client and every settings change
    function hkSync(h) {
      h = h || clientNow();
      var want = hkWanted(h);
      if (want === null) return;                 // not known yet: as it is
      var first = ST.hkFirst;
      ST.hkFirst = false;
      if (want === ST.hkOn) {
        // black, but not yet heard by the house (the connection was not up):
        // say so again, every few seconds
        if (want && hkDown && !hkAcked && clock.now() - hkAckTry > 3000) { hkAckTry = clock.now(); hkAck(true); }
        // ...or the house no longer has it (its server restarted, and the black came again while this page
        // was already black, 2026-10-21): the switch says unconfirmed, so say it again, every few seconds
        else if (want && hkDown && hkUnheard(h) && clock.now() - hkAckTry > 3000) { hkAckTry = clock.now(); hkAck(true); }
        // a page loaded under a black that is no longer wanted: the cover
        // fades, and the backlight the last page lowered comes back with it
        if (first && !want) bootCover(true, h);
        return;
      }
      ST.hkOn = want;
      if (want) { store(BLACK_KEY, dashSeg()); blackChanged(); if (ST.curtain) ST.curtain.style.pointerEvents = 'auto'; hkDarken(); }
      else hkLeave(h);
    }
    // a tap on the curtain: awake now, here -- the house hears it from the
    // switch going off and from the touch
    function hkTapWake() {
      if (!ST.hkOn) return;
      hkWokeAt = clock.now();
      ST.hkOn = false;
      hkAck(false);
      touchAgain(); reportTouch();
      noteInput();
      hkLeave(clientNow());
    }
    // THE BLACK THROUGH A RELOAD: hk-settings.js puts a cover up at once on a
    // page that was black (BLACK_KEY); here it gives way to the curtain --
    // removed under it, or, when the black is no longer wanted, swapped for it
    // and faded out. Never kept AS the curtain: it keeps its id (the next
    // black's bootCover(false) would remove it) and its 30 s backstop.
    function bootCover(fade, h) {
      var el = document.getElementById && document.getElementById('hk-black-boot');
      if (!el) return;
      if (!fade || (ST.curtain && ST.curtain.parentNode)) { el.remove(); return; }
      curtainStale();
      var drawn = drawCurtain(), v = wakeBrightness(h);
      el.remove();
      if (drawn) curtainDown({ hold: 0, onFade: function () { if (v != null) rampBacklight(v, CURTAIN_FADE); } });
    }
    var SHOWN_MIN = 500;
    function unstart() {
      Run.runEnds(); lightRun++;
      Run.coverCancel();
      Run.slideCancel();
      teardown();
      Run.tellOthers();
    }
    function goDark() {
      if (!ST.on || !ST.host) return;
      if (!ST.DARK_UNDER_BLACK || ST.host.hasAttribute('prep') || !ST.shownAt || clock.now() - ST.shownAt < SHOWN_MIN) { unstart(); return; }
      Run.noEntrance(); lightRun++;
      ST.host.style.setProperty('--fade', '0ms');
      ST.host.style.setProperty('--blk', '0ms');
      ST.host.removeAttribute('prep');
      ST.host.removeAttribute('undark');
      ST.host.setAttribute('dark', '');
      ST.host.setAttribute('on', '');
      Run.coverCancel();
      Run.noteDrawn();
    }
    // ...and as it ends. The house's wake turns the photos off under the
    // black, and stop() fades from black to the dashboard. Still on after
    // LIGHT_WAIT (a tap ended the black, and the house -- which turns the
    // photos off within 2 s of a tap -- still wants them): the photos come
    // back out of the black, drawn under .blk for two frames, then its fade
    // off them. Not sooner: the photos for a moment, then the dashboard, was
    // a flash of the wrong thing.
    var LIGHT_WAIT = 2500;
    var LIGHT_FADE = 600;
    // THE BLACK HAS ENDED: as good as a touch (no screensaver straight back by
    // idle), and the switch is heard again after LIT_GRACE (start())
    var LIT_GRACE = 2500;
    function litNow() {
      if (black()) return;
      ST.litAt = clock.now();
      noteInput();
      armIdle();
      // the photos' timer, held under the black (schedule()), runs again
      if (ST.slideHeld) { Run.slideFree(); if (ST.on && ST.cfg && ST.mode === 'photos' && !ST.busy) Run.schedule(); }
      setTimeout(function () { var h = clientNow(); if (h && !ST.on) onUpdate(h); }, LIT_GRACE + 50);
    }
    function lightSoon() {
      if (black() || !ST.on || !ST.host || !ST.host.hasAttribute('dark')) return;
      var h = ST.host, run = ++lightRun;
      var still = function () { return !black() && ST.on && ST.host === h && lightRun === run && h.hasAttribute('dark'); };
      setTimeout(function () {
        if (!still()) return;
        h.setAttribute('undark', '');
        var f1 = false, f2 = false;           // each frame's step once
        requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
          if (f2) return; f2 = true;
          if (!still()) return;
          h.style.setProperty('--blk', LIGHT_FADE + 'ms');
          h.removeAttribute('dark');
          h.removeAttribute('undark');
          Run.noteDrawn();
        }); });
      }, LIGHT_WAIT);
    }
    // Every few seconds: the sky follows the sun and the weather; it holds still
    // while the screen is dark (the kiosk's own screensaver or screen off --
    // the page cannot tell, so Fully is asked and Kiosk Satellite is listened
    // to -- or a hidden page); and the corner rows stay above the band.
    function forecastTick(forceNow) {
      var h = clientNow();
      if (ST.fscene && h && h.states) {
        var HS = window.hkSettings, sun = h.states['sun.sun'];
        var wid = HS && HS.weatherId ? HS.weatherId(h.states) : null, w = wid && h.states[wid];
        var sig = (sun ? sun.last_updated : '') + '|' + (w ? w.last_updated : '') + '|' + Math.floor(Date.now() / 600000);
        if (forceNow || sig !== ST.fSig) {
          forecastSig(sig);
          try { forecastSky(ST.fscene.update(h) || null); } catch (e) { console.warn('[hk-saver] forecast sky', e); }
          // Big Weather's planted time is lit by the same reading (and a layout's)
          if (ST.bigCtl && ST.bigCtl.light) ST.bigCtl.light(ST.fSky);
          if (ST.ly) layoutSoon();
        }
      }
      var F = window.fully, dark = !!document.hidden || black();
      try {
        if (F && ((typeof F.isInScreensaver === 'function' && F.isInScreensaver()) ||
                  (typeof F.getScreenOn === 'function' && F.getScreenOn() === false))) dark = true;
      } catch (e) { /* no Fully interface */ }
      // not on screen (between forecast slides) holds still too
      if (ST.fscene) ST.fscene.pause(dark || !fcVisible());
      layoutPane();
      if (ST.enShowing) energyLayout();
      [WX, HL, TM].forEach(function (S) { if (S.showing) slideLayout(S); });
      // The band is measured and centred only while it shows: it was every
      // tick (~20 rects each) for the whole of a Photos & Forecast session,
      // between forecast slides and under the black as well. Shown again, it
      // is centred at once (showForecastSlide / enterForecast force a tick).
      if (ST.host && ST.root) {
        var b = !dark && ST.host.hasAttribute('band') && ST.fband && ST.fband.isConnected ? ST.fband : null;
        var r = b && b.getBoundingClientRect();
        if (b) centerBand(b);
        if (b && r && r.height) ST.host.style.setProperty('--hk-ss-corner-bottom', Math.round((window.innerHeight || 0) - r.top + 18) + 'px');
        else if (!dark && ST.host.style.removeProperty) ST.host.style.removeProperty('--hk-ss-corner-bottom');
      }
    }
    function refresh() {
      var conf = dashConf();
      var raw = conf && conf.hk_screensaver;
      if (conf && raw === undefined) raw = fromSettings(conf);
      // A HOST WITH NO LOVELACE drew the screen from the strategy once, at its
      // load: the block it made then names the tablet's switch only if that
      // switch's state was already there (hk-strategy.js screensaverOf), and
      // Mantel's own arrive a moment after its settings. The settings make the
      // same block again, now -- else the one the strategy made.
      else if (ST.shellConf && raw && !raw.entity) raw = fromSettings(conf) || raw;
      var picked = ST.designController && ST.designController.options();
      if (!ST.previewOn && picked) raw = houseBlock(picked) || raw;
      if (ST.previewOn && ST.previewHouse) raw = houseBlock() || raw;
      if (ST.previewOn && ST.previewOver) raw = houseBlock(ST.previewOver) || raw;
      var HS = window.hkSettings;
      if (raw && HS && HS.get) {
        var bAll = HS.get('boards', null), bNow = bAll && bAll[String(location.pathname).split('/')[1] || ''];
        var pvPane = previewPaneOf((bNow && bNow.side_pane_read) || HS.get('side_pane', null), ST.previewOn ? ST.previewPane : null);
        raw = withPane(raw, pvPane.settings); paneNote(ST.previewOn ? pvPane.message : '');
      }
      var SP = window.hkSidePane;
      if (raw && SP && SP.placement(window.innerWidth, window.innerHeight, { width: raw.pane_width }).kind === 'none') raw = Object.assign({}, raw,
        { calendar: false, music_pane: false, pane_list: null });
      if (HS && HS.lovelacePanel && HS.lovelacePanel() === false) raw = null;
      // the host's own album for this screen, in place of the house's photos
      // (hostPhotoSource; none in Home Assistant)
      var ownPhotos = raw ? hostPhotoSource(raw.photos) : null;
      if (ownPhotos && ownPhotos !== raw.photos) raw = Object.assign({}, raw, { photos: ownPhotos });
      // Derive effective options without changing any saved screensaver choice.
      if (raw && isFlat()) raw = Object.assign({}, raw, {
        zoom: false, photo_layout: 'single', portrait_blur: 0, landscape_blur: 0,
        portrait_dim: 0, landscape_dim: 0, portrait_zoom: 100, landscape_zoom: 100,
        clock_style: 'classic', clock_bg: ['photos','landscapes','black'].indexOf(raw.clock_bg) >= 0 ? raw.clock_bg : 'black',
        clock_motion: 'still', clock_speed: 0, clock_depth: 0, clock_photo_soft: false,
        clock_text_shadow: 0, clock_text_outline: 0
      });
      var key = raw ? JSON.stringify(raw) + '|' + isFlat() : '';
      if (key !== ST.lastRaw) {
        ST.lastRaw = key;
        var was = ST.cfg;
        ST.cfg = readCfg(raw);
        if (was && ST.on && !ST.previewOn && ST.cfg) { var reason = ST.startedBy; Run.stop('appearance'); teardown(); Run.start(reason); }
        // the preview follows the settings page: rebuilt with the new options
        // -- or, when only the photos' layout changed, laid out again in place
        if (ST.previewOn && ST.on && ST.cfg) {
          // ...or only the clock's face changed (its style, 24-hour): drawn again
          // where it is, no fade out and in -- a style can be judged as chosen
          if (was && sansSlides(was) === sansSlides(ST.cfg) && slidesAgain()) { /* the slide's parts again */ }
          else if (was && sansShapes(was) === sansShapes(ST.cfg) && relayout()) { /* laid out again */ }
          else if (was && sansClock(was) === sansClock(ST.cfg) && remountClock()) { /* the clock again */ }
          else setTimeout(restartPreview, 0);
        }
        // ...and a preview asked for before there was a config (the frame's
        // dashboard, or its settings, still arriving) starts once there is one
        if (ST.previewOn && !ST.on && ST.cfg) setTimeout(function () { if (ST.previewOn && !ST.on && ST.cfg) Run.start('preview'); }, 0);
        // turned off while it shows: its switch goes off too (stop('config') alone left it on, and turning the
        // screensaver back on started it at once, "by the switch", instead of after Starts After)
        if (!ST.cfg && ST.on) { writeSwitch('off', was); Run.stop('config'); }
        if (ST.deck && ST.cfg && ST.deck.order !== ST.cfg.order) dropDeck();
        // a new Starts After counts from the last touch now, not when the old (longer) timer runs out
        if (was && ST.cfg && !ST.on && ST.idleT) armIdle();
      }
      if (!ST.cfg) { idleCancel(); return; }
      if (!allowed()) { if (ST.on) { writeSwitch('off'); Run.stop('config'); } idleCancel(); return; }
      if (!ST.idleT && !ST.on) armIdle();
    }
    // A FROZEN PAGE. Kiosk Satellite's Black screensaver stops the tablet
    // DRAWING the page but not running it (traced 2026-10-09: its events, the
    // house's messages and the timers all arrive under it; goDark and
    // afterDraw handle that). A page the system has frozen outright -- an app
    // sent to the background, a device asleep -- gets everything the house
    // did meanwhile in one burst as it comes back. Whether the page is just
    // back: a heartbeat that went quiet, or a visibility change, in the last
    // RESUME_MS. (The heartbeat gap catches a message handled before the
    // timer that would have noticed.)
    var RESUME_MS = 2500;
    function beat() {
      if (ST.previewOn && ST.previewSelected) syncPreviewSlide();
      var n = clock.now();
      if (n - ST.lastBeat > RESUME_MS) ST.resumedAt = n;
      ST.lastBeat = n;
    }
    function justResumed() {
      var n = clock.now();
      return n - ST.resumedAt < RESUME_MS || n - ST.lastBeat > RESUME_MS;
    }
    function hookClient() {
      if (hubOff || !(window.hkCards && window.hkCards.onClient)) return false;
      hubOff = window.hkCards.onClient(function (h) { refreshSoon(); onUpdate(h); if (ST.on) { musicWatch(); tmWatch(); } });
      if (window.hkMusic && window.hkMusic.onChange) window.hkMusic.onChange(function () {
        if (ST.on) { mus.watchAt = 0; musicWatch(); }
      });
      return true;
    }

    // (the Now Playing page's, hk-saver-pane.js: once the kit's own entries)
    function panelDone(v) { if (ST.pnl && ST.pnl.view === v) closePanel(false); }

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

    // what the shell and the later parts use of this one
    K.beatFrom = beatFrom; K.forgetRaw = forgetRaw; K.hkAgain = hkAgain; K.resumedNow = resumedNow;
    K.beat = beat; K.bootCover = bootCover; K.forecastTick = forecastTick;
    K.goDark = goDark; K.hkSync = hkSync; K.hkTapWake = hkTapWake; K.hookClient = hookClient;
    K.justResumed = justResumed; K.lightSoon = lightSoon; K.LIT_GRACE = LIT_GRACE; K.litNow = litNow;
    K.panelDone = panelDone; K.refresh = refresh;
    // (phase 25: what the earlier parts call of this one, through its exports object Black, made by the shell)
    var Black = K.Black;
    Black.bootCover = bootCover; Black.forecastTick = forecastTick; Black.goDark = goDark;
    Black.hkTapWake = hkTapWake; Black.lightSoon = lightSoon; Black.litNow = litNow; Black.panelDone = panelDone;
  };
})();
