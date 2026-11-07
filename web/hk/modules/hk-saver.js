// hk-saver.js -- HK Frontend's photo screensaver, for a wall tablet's own user.
//
// WHAT IT IS
// A generated wall tablet's screen (Screens -> the screen -> Behavior ->
// Photo Screensaver, with a Tablet User) gets `hk_screensaver:` in its
// dashboard config (hk-strategy.js hkSaver()); a YAML dashboard can write the
// same block, or get it from its screen's HK settings (fromSettings below).
// After the screen has been left alone for `starts_after` seconds -- or the
// moment its switch turns on -- the house's photos cross-fade
// full screen, with the clock, the weather, what is playing and the running
// timers over them (the same HK cards the header and the pages use). A touch
// takes it away again, and does not press whatever was under the finger.
//
// Written for HK Frontend from its own plan (hk_house/docs/PLAN-HK-SCREENSAVER.md)
// and from how the tablets behave; it replaces WallPanel (HACS), which a
// screen can still choose instead (screensaver_engine).
//
// THE SWITCH (input_boolean.wallpanel_screensaver_<room>, the name kept from
// the WallPanel days so no automation changes) is two-way, exactly as the
// house's tablet scripts and want sensor expect:
//   * the screensaver starting by itself turns it ON; a touch turns it OFF --
//     the only way a tablet gets back to photos while it is awake;
//   * the house turning it on (the sleep script, under Fully's dark) starts
//     the screensaver; turning it off (wake, the doorbell) stops it.
// Only the tablet's own user ever runs this, so only the tablet writes it: a
// desk opening the same dashboard never gets a screensaver and never touches
// the switch.
//
// WHAT IT COSTS. Nothing while the dashboard is in use: no element, no timer
// but one idle timeout, no listener work beyond noting the time. While the
// photos show, only the 3 s cross-fade animates, once per photo; the sky and
// every card behind the photos hold still (hk-sky `hidden`, hk-base
// `hk-asleep`), which on a wall tablet's WebView is what lets the page stop
// drawing frames between photos.
// @ts-check
(function () {
  'use strict';
  if (window.hkSaver) return;              // hk-loader may import this twice

  // ------------------------------------------------------------ constants
  var FADE_IN_MS = 3000;                   // the screensaver appears
  // BACK TO THE DASHBOARD (option fade_back, ms; 0: no fade). A touch, the
  // switch turned off by the house, or the console -- all the same fade.
  var FADE_BACK_MS = 500;
  // ...and first, the dashboard drawn UNDER the screensaver. It was hidden
  // (coverDashboard) and its graphics let go; shown again in the same frame
  // the fade starts, it painted in pieces under the fading photo -- the sky,
  // then the scenes, the cameras last (headless frames, 2026-10-04). An
  // opaque layer over it would keep the browser from drawing it at all
  // (it is occluded), so for this hold the screensaver is 99 % opaque.
  // (an object, so the tests and a probe can change them)
  var WAKE = { hold: 150,                  // after two frames, this much more
               max: 600,                   // no frame by then: not being drawn
               lit: 400 };                 // ...and the hold once it is again
  var CROSSFADE_MS = 3000;                 // photo to photo
  var MU_ART_MS = 900;                     // the music: one song's art to the next
  // AFTER A TOUCH STOPS IT, ONLY THAT TOUCH IS SWALLOWED: it stops on the
  // finger landing, so the screensaver stays (invisible, catching taps)
  // until the dashboard has faded back AND that finger has lifted, then
  // GHOST_MS more for the click a browser makes of a touch after it. It
  // was WallPanel's 3 s of every tap ignored (control_reactivation_time),
  // and the dashboard seemed slow to answer after a wake (2026-10-10).
  // A finger held down is waited for, at most PRESS_MAX.
  var GHOST_MS = 400, PRESS_MAX = 5000;
  var EDGE = 0.15;                         // left/right 15 %: previous/next photo
  var LIST_TTL_MS = 30 * 60 * 1000;        // re-list the folder
  var LIST_MAX = 5000, LIST_DEPTH = 3;
  var ECHO_MS = 6000;                      // our own switch write coming back
  var MOVE_PX = 12;                        // a mouse has to MOVE, not jitter
  var ZOOM = 1.1;                          // Slow Zoom's end scale
  var DEFAULT_CARD_WIDTH = 600;
  // THE FORECAST DETAILS' ZONE: the meadow, below the land's tree line --
  // 35.6 % of the art from its bottom (the 2560x1600 landscapes). The art
  // covers the screen from the bottom, so that is 35.6 % of the height on a
  // screen no wider than 16:10, and of the width / 1.6 on a wider one. The
  // details are centred in it, up and down and side to side.
  var BAND_ZONE = 'max(35.6vh,22.25vw)';
  var BAND_PAD = 16;                       // ...never nearer the bottom than this
  // THE SAME BAND ON EVERY SCREEN: laid out as on a 1280x800 tablet (1280
  // less the 30 px sides) and, on a bigger screen, scaled up to it whole --
  // never its hours and days stretched apart, never left small
  var BAND_MAX = 1220, BAND_W = 1280, BAND_H = 800;
  // THE CALENDAR PANE (1.4, option `calendar`): 400 px down the right of a
  // 1280 x 800 tablet, scaled with the band on a bigger screen. The photos
  // (or the forecast) take the rest; beside the pane the forecast details
  // stand up, as on a phone, no wider than BAND_STACKED.
  var PANE_W = 400, BAND_STACKED = 680, BAND_PAD_STACKED = 30;
  // ...since 1.4.3 side by side there too, as on every other screen: today's column this wide (the
  // tablet's band has 300), the band as wide as the photos' room allows
  var BAND_NOW_BESIDE = 200, BAND_BESIDE_GUTTER = 30;
  // the forecast details fade in once in place (addBand)
  var BAND_REVEAL_MS = 260;
  var PANE_TOP = 74;                       // Home Status sits above the list (at least)
  var PANE_RESET_MS = 45000;               // untouched this long: back to today

  // ------------------------------------------------------------ the parts (generated by tools/split_js.py)
  // THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/saver/ (the PARTS below, in the order they
  // run) by tools/split_js.py from tools/split_manifests/saver.json; `split_js.py --find <name>` says which file holds
  // one. Each file registers one function in window.hkSaverParts; they run here, in this order (a later one may use
  // an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
  // they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
  // them (the suites) starts at once, in the same turn.
  var PARTS = ['hk-saver-helpers.js', 'hk-saver-css.js', 'hk-saver-photos.js', 'hk-saver-draw.js',
               'hk-saver-music.js', 'hk-saver-pane.js', 'hk-saver-black.js'];
  var PARTS_TRIES = 6;
  function partKey(file) { return file.replace(/\.js$/, ''); }
  // ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
  // (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
  // of their own -- a browser keeps a failed module's answer for its address
  function loadParts(then, n) {
    // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
    // must not run them twice: the flag is set at once, not when the parts have run
    if (n === undefined) {
      var started = window.__hkSplitStarted = window.__hkSplitStarted || {};
      if (started['hk-saver']) return;
      started['hk-saver'] = true;
    }
    n = n || 0;
    var have = window.hkSaverParts || {};
    var missing = PARTS.filter(function (file) { return !have[partKey(file)]; });
    if (!missing.length) {
      try { then(); } catch (err) { console.error('[hk-saver] the parts did not start', err); }
      // (the checks that drive a page wait for every shell that started to say it is done)
      (window.__hkSplitDone = window.__hkSplitDone || {})['hk-saver'] = true;
      return;
    }
    // (window.hkV: the build's ?v= on an address put together here, web/shim/base.js)
    Promise.all(missing.map(function (file) {
      var u = '/hk/saver/' + file, href = window.hkV ? window.hkV(u) : u;
      var got = n ? import(href + (href.indexOf('?') < 0 ? '?' : '&') + 'retry=' + n) : import(href);
      return got.catch(function (err) { return err; });
    })).then(function (got) {
      var err = got.filter(function (r) { return r instanceof Error; })[0];
      var left = PARTS.filter(function (file) { return !(window.hkSaverParts || {})[partKey(file)]; });
      if (!left.length) { loadParts(then, n); return; }
      err = err || new Error(left[0] + ' ran without registering');
      if (n + 1 >= PARTS_TRIES) { console.error('[hk-saver] the parts did not start', err); return; }
      console.warn('[hk-saver] a part did not load (' + err.message + '); again shortly');
      setTimeout(function () { loadParts(then, n + 1); }, Math.min(1000 * Math.pow(2, n), 15000));
    });
  }
  // ------------------------------------------------------------ end of the parts loader
  var actionsNow, afterDraw, afterFade, alignOf, ANALOG, BACKDROP_SMALL, backdropSmall, behindAt, BLACK_KEY,
      blackPage, BRIGHT_KEY, callWS, ckFx, cleanDepth, cleanFocus, cleanVariants, clearCanvas, clientNow, coverRect,
      coverShare, CSS, DASH_CSS, DASH_SWIPE, dashLive, dashSeg, dashViews, DAY_GAP, deg, drawBackdrop, drawMusic,
      drawnRect, elapsed, energyPage, EX_PREVIEW_MS, EXTRA_ORDER, extrasOf, FACE_SHOWS, faceOrigin, facesModule,
      faceWindow, FC_TICK_MS, feedCard, faceScale, fitOf, FOCUS_F, framed, fromSettings, gate, glyphBox, go, held, hkBoard,
      hkUnheard, hostPhotoList, hostPhotoSource, houseBlock, inkOf, INKS, isFlat, isImage, kiosk, LANDSCAPES,
      landShares, layoutOf, layoutMusicView, load, minsOf, mmss, MOSAIC_COLORS, mosaicAssign, mosaicPlan, MOSAICS, MU_BG, MU_GRACE,
      MU_SLOP, muGrace, mus, musicHas, musicNow, musicOf, musicPage, musicPaneView, musicParts, musicPlaying, musicUsed, previewMusicData, previewPaneOf,
      musicView, nextArt, PANE_OWN, PANE_VARS, panel, PANEL_IDLE, PANEL_TURN, paneOf, photoLum, photoOpts, photoUrl,
      pieceFile, piecesStarted, progress, rampBacklight, readCfg, reducedMotion, refreshSoon, rememberedTabletId,
      sansClock, sansShapes, sansSlides, scaleOf, sendWS, setAttr, setBacklight, shapeOfPh, shuffle, sigOf,
      slideMarks, slideOf, slideView, SLOP, store, sunDown, tabletId, tagOf, TB_COVER, TB_WAIT, tbKey, tbShare,
      tbShares, tellBlack, textBox, turnOf, upNextPiece, user, viewFont, volEnd, volFrom, wakeBrightness,
      weatherEntity, weatherPage, within, withPane, zoneOf;

  function landscapes() { return !!(cfg && cfg.show === 'clock' && cfg.clock_bg === 'landscapes'); }
  // ONE RENDERER (2026-11-02, phase 13, phase 4; decision 5: "Every screen through one renderer"): a screen with no
  // saved layout draws through the layout path too, with the layout its options make (hkSaverLayout.layoutFrom, the
  // editor's own starting point) -- its corners the pieces', its slides with the slide corner. Glance, Month and the Day
  // face keep their own words (their hand-made date and month): the layout made for them leaves its big element to the
  // face. Until hk-saverlayout.js has come (it is asked for here, then the screen read again) the screen draws as it
  // always did
  var autoAsked = false;
  function autoLayout(raw, c) {
    if (!c || c.layout) return c;
    // (BIG WEATHER keeps its own face -- its glassy temperature, its readings with their glyphs, its small time over
    // Home Status -- the owner's favorite, as Glance, Month and the Day face keep their own words; a layout the editor
    // saves for the Landscape draws it with the pieces)
    if (c.show === 'forecast' && c.forecast_layout === 'big') return c;
    // (...and Month, whose page tells the time at its top right where the corner's Home Status would stand)
    if (c.show === 'month') return c;
    var LM = window.hkSaverLayout;
    if (!LM || !LM.layoutFrom) {
      if (!autoAsked && typeof window.fetch === 'function') {
        autoAsked = true;
        // (the screen read again once it has come: the same options, a layout now -- so not the same read)
        try { import('/hk/modules/hk-saverlayout.js').then(function () { if (window.hkSaverLayout) { lastRaw = null; refresh(); } }, function () { /* the old way */ }); } catch (e) { /* the old way */ }
      }
      return c;
    }
    var has = function (t) { return (Array.isArray(raw.cards) ? raw.cards : []).some(function (x) { return x && x.type === 'custom:' + t; }); };
    var o = Object.assign({}, c, { clock_over: raw.clock_over, clock: has('hk-clock-card') || c.clock_large, weather: has('hk-weather-strip-card'),
                                   music: has('hk-screensaver-now-card'), timers: has('hk-timer-strip-card'), status: has('hk-screensaver-status-card') });
    var L = LM.clean(LM.layoutFrom(o));
    if (FACE_SHOWS[c.show]) L.big = Object.assign({}, L.big, { kind: 'none' });
    // (Clock over sharp photos with Time Behind on: behind, as Photos has it)
    if (c.show === 'clock' && c.clock_bg === 'photos' && !c.clock_photo_soft && raw.time_behind === true) {
      L.big = Object.assign({}, L.big, { kind: 'time', depth: 'behind', size: Math.max(12, Math.min(44, c.tb_size || 24)), pos: (c.tb_top || 0) <= 12 ? 'top' : (c.tb_top || 0) <= 30 ? 'upper' : 'center' });
    }
    // (the Day face: its corner clock top left, smaller, the weather a line under it -- as the face was drawn for)
    if (c.show === 'day') {
      var tc = L.zones.tr.filter(function (w) { return w.piece === 'time'; })[0], wc = L.zones.br.filter(function (w) { return w.piece === 'weather'; })[0];
      if (tc) { L.zones.tr = L.zones.tr.filter(function (w) { return w !== tc; }); L.zones.tl.unshift(Object.assign({}, tc, { size: 100 })); }
      if (wc && L.zones.tl.length < 2) { L.zones.br = L.zones.br.filter(function (w) { return w !== wc; }); L.zones.tl.push(Object.assign({}, wc, { shape: 'inline', size: 110 })); }
    }
    // ...as the screen looked: its corners' weather and Home Status were a line each, large; its photo's title large at
    // the bottom right (Titles)
    Object.keys(L.zones).forEach(function (z) {
      L.zones[z] = L.zones[z].map(function (w) {
        if ((w.piece === 'weather' || w.piece === 'status') && w.shape === 'card') return Object.assign({}, w, { shape: 'inline', size: 120 });
        if (w.piece === 'time' && w.shape === 'card' && !FACE_SHOWS[c.show]) return Object.assign({}, w, { size: 150 });
        return w;
      });
    });
    // (Glance, Month and the Day face had Home Status at the top right whatever else was there)
    if (FACE_SHOWS[c.show] && o.status && !L.zones.tr.some(function (w) { return w.piece === 'status'; }) && L.zones.tr.length < 2)
      L.zones.tr.push({ piece: 'status', shape: 'inline', back: 'none', color: 'auto', size: 120 });
    var title = L.zones.line.filter(function (w) { return w.piece === 'title'; })[0];
    if (title && L.zones.br.length < 2) { L.zones.line = L.zones.line.filter(function (w) { return w !== title; }); L.zones.br.push(Object.assign({}, title, { size: 200 })); }
    c.layout = L;
    c.layoutAuto = true;
    return c;
  }
  var Deck, designController;

  // ...and where a host draws the dashboard with HK's own view host, no
  // Lovelace (Mantel: the panel is the page, with no lovelace object), the
  // shell hands the config over instead. Read as the panel's alone, the
  // saver had no config at all there: no touches told, no black drawn or
  // confirmed, no backlight lowered (every wall tablet on Mantel,
  // 2026-10-19). shellConf: the config came from the shell, not a panel.
  var shellConf = false;
  function dashConf() {
    var p = panel(), conf = p && p.lovelace && p.lovelace.config;
    shellConf = false;
    if (conf) return conf;
    var SH = window.hkShell;
    try { conf = SH && typeof SH.dashboardConfig === 'function' ? SH.dashboardConfig() : null; } catch (e) { conf = null; }
    shellConf = !!conf && !(p && p.lovelace);
    return conf || null;
  }

  var cfg = null;              // the config in force (null: none here)
  var on = false;              // showing (or fading in)
  var startedBy = '';
  var host = null, root = null;
  var lastInput = Date.now();
  var idleT = null, slideT = null, pendingSwitch = null;
  // the touch that stopped it: still down (up: null), or when it lifted
  var press = null, pressStop = false;
  var deck = null, listAt = 0, listing = null, listKey = '';
  var layer = 0;               // which of the two photo layers is on top
  var displayLayer = null, fadeDone = null, photoRun = 0;
  // the screensaver's fade in, waiting for its first photo (start)
  var entrance = null, ENTRANCE_MAX = 1500;
  var coverT = null, coveredPage = null, pageVisibility = null, coveredView = [];
  // THE FORECAST (1.3): the live sky over the season's land (hkSky.scene),
  // with the forecast band -- when a screen asks for it, or has no photos
  var mode = 'photos', fscene = null, fband = null, fTick = null, fSig = '';
  // the forecast sky's last reading (hk-sky.js read()), for Big Weather's planted time: null without a landscape
  var fSky = null;
  // THE CALENDAR PANE (option `calendar`): its element, its scroller, the
  // card in it, its width now, and the timer that scrolls it back to today
  var paneEl = null, paneSc = null, paneCard = null, paneW = 0, paneResetT = null;
  // ...the side it was laid out for, and the Side Pane drawing other
  // sections in it (cfg.pane_list; hk-sidepane.js), with its tick
  var paneSide = 'right', sidePane = null, sideT = null;
  // Photos & Forecast: the forecast as one slide every `forecast_every`
  // photos, over the photos, its sky still whenever it is not on screen
  var fcShowing = false, sinceFc = 0;
  // HK Settings' preview (hkSaver.preview): shown in the settings page's frame
  // whoever is signed in, deaf to the real tablet's switch, never writing it,
  // and rebuilt whenever the options change
  var previewOn = false;
  // ALL SCREENS' PREVIEW (1.8.1): HK Settings' All Screens -> Screensaver
  // shows its own settings on a screen of the house, whether or not that
  // screen follows them (before, the page had no preview once every screen
  // had settings of its own)
  var previewHouse = false;
  // ...and Home Energy's Options: the energy screen, held (2026-10-14)
  var previewEnergy = false, previewWeather = false;
  var previewSelected = '', previewPane = null, previewPaneNote = '';
  // ...and the options HK Settings hands it as they change (2026-10-31, the owner: "just what they're changing,
  // updating in place"): drawn from them at once -- not after the save has gone round the server and back, and the
  // settings are next read (refreshSoon: every 2 s) -- and kept until the preview ends, so the save, when it comes
  // back, is the same block and changes nothing
  var previewOver = null;
  var unsubCards = null, cards = [];
  var shown = 0, failed = 0, lastPhoto = null;
  var force = false;           // hkSaver.force(true): ignore the user (tests)
  var asked = false;           // showMusic(): somebody asked for the music full screen -- shown whoever the screensaver is for

  // THIS PAGE IS THE BLOCK'S OWN TABLET: the one it names (1.14), else
  // signed in as its user -- the rule for every write and report
  function mine() {
    if (!cfg) return false;
    if (cfg.tablet) return tabletId() === cfg.tablet;
    return !!cfg.user && user() === cfg.user;
  }
  // which tablet a report is about: its id, else (before 1.14) the screen
  function whoMsg(msg) {
    var id = (cfg && cfg.tablet) || '';
    if (id) msg.tablet = id; else msg.dashboard = String(location.pathname).split('/')[1] || '';
    return msg;
  }
  function allowed() {
    if (framed && !previewOn) return false;
    return !!cfg && (force || gate(cfg, user(), location.search, tabletId()));
  }

  // ------------------------------------------------------------ the switch
  function switchState(c) {
    c = c || cfg;
    var h = clientNow();
    var s = c && c.entity && h && h.states[c.entity];
    return s ? s.state : null;
  }
  function writeSwitch(want, c) {
    c = c || cfg;                  // (the options the screensaver showed with, when they just went: refresh)
    if (!c || !c.entity) return;
    // ONLY THE TABLET'S OWN USER WRITES IT -- never a forced test page
    // (?hk_saver=force, hkSaver.force()), whatever the gate lets it show
    if (!mine() || /[?&]hk_saver=force\b/.test(location.search) || force) return;
    var act = actionsNow();
    if (!act || switchState(c) === want) return;
    pendingSwitch = { want: want, until: Date.now() + ECHO_MS };
    try {
      act.callService(c.entity.split('.')[0], want === 'on' ? 'turn_on' : 'turn_off', { entity_id: c.entity });
    } catch (e) { /* offline: the next state change sorts it out */ }
  }
  // A TOUCH ON THE SCREEN, told to the integration (screensaver.py): its
  // "Screen In Use" sensor and the switch's last_touch. At most every 10 s,
  // and only from the tablet's own user -- the same rule as the switch.
  var touchSent = 0;
  function reportTouch() {
    if (!cfg || !cfg.entity || !/^switch\./.test(cfg.entity)) return;
    if (!mine() || force || /[?&]hk_saver=force\b/.test(location.search)) return;
    var now = Date.now();
    if (now - touchSent < 10000) return;
    touchSent = now;
    sendWS(whoMsg({ type: 'hk_frontend/screensaver/touch' })).catch(function () { /* older integration */ });
  }

  // Every new client: the switch decides, unless it is still echoing our own
  // write the other way.
  function onUpdate(h) {
    hkSync(h);
    if (previewOn || !cfg || !cfg.entity || !allowed()) return;
    var st = switchState();
    if (pendingSwitch) {
      if (st === pendingSwitch.want || Date.now() > pendingSwitch.until) pendingSwitch = null;
      else return;
    }
    // ...but not over somebody watching Live TV or using a sheet (hk-idle's
    // hold, as the idle timer already honours): the switch turned on by an
    // automation or the Sleep Screen waits for the hold to end (2026-10-21)
    if (st === 'on' && !on) { if (!held()) start('switch'); }
    else if (st === 'off' && on) stop('switch');
  }

  // ------------------------------------------------------------ idle
  function armIdle() {
    if (idleT) { clearTimeout(idleT); idleT = null; }
    if (on || !cfg || !allowed() || !(cfg.starts_after > 0)) return;
    var wait = Math.max(250, lastInput + cfg.starts_after * 1000 - Date.now());
    idleT = setTimeout(function () {
      idleT = null;
      if (on || !cfg || !allowed()) return;
      if (Date.now() - lastInput < cfg.starts_after * 1000) { armIdle(); return; }
      // not while hidden (the tab is not on screen), nor held: ask again
      // shortly rather than start behind somebody's back
      if (document.hidden || held()) { lastInput = Date.now() - cfg.starts_after * 1000 + 15000; armIdle(); return; }
      start('idle');
    }, wait);
  }

  // ------------------------------------------------------------ input
  var mx = null, my = null;
  // A TOUCH ON THE CALENDAR PANE scrolls it: the one place on the
  // screensaver a finger does not take it away
  var inPane;
  function paneTouched() {
    if (paneResetT) clearTimeout(paneResetT);
    paneResetT = setTimeout(function () {
      paneResetT = null;
      if (paneSc) { try { paneSc.scrollTo({ top: 0, behavior: isFlat() ? 'instant' : 'smooth' }); } catch (e) { paneSc.scrollTop = 0; } }
    }, PANE_RESET_MS);
  }
  function onInput(e) {
    var t = e.type;
    if (designController && designController.input(e)) return;
    // A NOTIFICATION'S BANNER over the photos (hk-notify.js): a finger on it
    // is the banner's -- swiped away, opened -- never a wake; the screensaver
    // is in use while it does
    if (on && window.hkNotify && window.hkNotify.owns(e)) {
      if (t !== 'pointermove' && t !== 'mousemove') saverTouched();
      return;
    }
    // A FINGER ON THE MUSIC'S VOLUME: everything it does is the drag
    if (on && mus.drag) {
      if (t === 'pointermove' || t === 'mousemove' || t === 'touchmove') {
        var mp = t === 'touchmove' ? e.touches && e.touches[0] : e;
        if (mp) volFrom(mp.clientX);
      }
      return;
    }
    // THE MUSIC'S PANEL OPEN: what is in it is its own (taps, scrolling, the
    // search box's typing); anything else closes it -- never a wake -- but
    // the music's buttons beside it still act
    if (on && pnl) {
      // (a mouse moving about it is followed, not counted: once it closes,
      // a move from here wakes, as before)
      if ((t === 'pointermove' || t === 'mousemove') && (!e.pointerType || e.pointerType === 'mouse')) { mx = e.clientX; my = e.clientY; }
      if (inPanel(e)) { if (t !== 'pointermove' && t !== 'mousemove') panelTouched(); return; }
      // (a finger lifting is not a tap: the one that opened it, lifting off its
      // button, read as a second tap and toggled it shut at once, 2026-11-06)
      if (t === 'pointermove' || t === 'mousemove' || t === 'wheel' || t === 'touchmove' || t === 'click' ||
          t === 'pointerup' || t === 'pointercancel') return;
      if ((t === 'touchstart' || t === 'mousedown') && window.PointerEvent) return;
      if (t === 'keydown') { if (!pnl.p.typing()) closePanel(true); return; }
      var px = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientX) : e.clientX;
      var py = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientY) : e.clientY;
      var ph2 = musicHit(px, py);
      if (ph2 && !ph2.art) { musicAct(ph2, px); if (pnl) panelTouched(); return; }
      saverTouched();
      closePanel(true);
      return;
    }
    if (on && t !== 'keydown' && inPane(e)) {
      if (t !== 'pointermove' && t !== 'mousemove') { paneTouched(); saverTouched(); }
      // the music's buttons in the pane
      if (t === 'pointerdown' || (t === 'touchstart' && !window.PointerEvent)) {
        var pt = t === 'touchstart' ? e.touches && e.touches[0] : e, ph = pt && musicHit(pt.clientX, pt.clientY);
        if (ph) musicAct(ph, pt.clientX);
      }
      return;
    }
    if (on) {
      // A MOUSE has to move, a finger just has to land.
      if (t === 'pointermove' || t === 'mousemove') {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (mx === null) { mx = e.clientX; my = e.clientY; return; }
        if (Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < MOVE_PX) return;
        stop('touch'); return;
      }
      // ONE TAP, ONE STEP: a finger fires pointerdown, then touchstart, then
      // mousedown; where pointer events exist they alone count, or a tap on
      // an edge would skip two photos
      if ((t === 'touchstart' || t === 'mousedown') && window.PointerEvent) return;
      if (t === 'pointerdown' || t === 'touchstart' || t === 'mousedown') {
        var x = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientX) : e.clientX;
        var y = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientY) : e.clientY;
        // A TAP ON THE FORECAST DETAILS opens the Weather page (ahead of
        // the edges: the details run under both)
        // THE MUSIC'S BUTTONS act and leave it up
        var mh = musicHit(x, y);
        if (mh) { pressStop = !!mh.art; musicAct(mh, x); return; }
        // The alert banner opens the NWS wording, rather than the raw
        // count sensor or an unrelated Weather-page navigation.
        if (wxShowing && wxCtl && wxCtl.hitAlert && wxCtl.hitAlert(x, y)) {
          pressStop = true;
          var alertCtl = wxCtl;
          stop('touch');
          alertCtl.openAlerts();
          return;
        }
        var wpage = weatherAt(x, y) && weatherPage();
        pressStop = true;
        if (wpage) { stop('touch'); go(wpage); return; }
        // A TAP ON HOME ENERGY opens the Energy page (anywhere on it)
        if (enShowing) { var epage = energyPage(); stop('touch'); if (epage) go(epage); return; }
        // ...and on the weather, the Weather page
        if (wxShowing) { var xpage = weatherPage(); stop('touch'); if (xpage) go(xpage); return; }
        // the edges of the PHOTOS: beside the calendar pane, its left edge
        var z = zoneOf(x, (window.innerWidth || 0) - (paneUp ? paneW : 0));
        // (on the forecast or the music a tap anywhere else wakes: there is no photo to step;
        // nor on Show: Clock, photos or Landscapes behind it included -- the
        // clock is what it shows, and an edge tap that only changed the
        // photo read as a tap that did not wake it, 1.8.1)
        if (z && mode === 'photos' && !muShowing && !ckPhotos()) { pressStop = false; saverTouched(); if (z === 'next') nextPhoto(); else previousPhoto(); }
        else if (!(t === 'pointerdown' && designController && designController.hold(e))) stop('touch');
        return;
      }
      if (t === 'keydown' || t === 'wheel') stop('touch');
      return;
    }
    if (t === 'pointermove' || t === 'mousemove') {
      if (e.pointerType && e.pointerType !== 'mouse') return;
    }
    lastInput = Date.now();
    armIdle();
    if (t !== 'pointermove' && t !== 'mousemove') reportTouch();
  }

  function weatherAt(x, y) {
    if (!root || !host || !host.hasAttribute('band') || x == null || y == null) return false;
    var box = root.querySelector('.fcband');
    return Array.prototype.slice.call((box && box.children) || []).some(function (el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;
    });
  }

  function build() {
    host = document.createElement('hk-screensaver');
    root = host.attachShadow({ mode: 'open' });
    var font = viewFont();
    if (font) host.style.setProperty('--hk-saver-font', font);
    // (the calendar pane's list rides under Home Status: hk-base.js shade --
    // the cards are loaded by the time a screensaver starts)
    var HC = window.hkCards;
    if (HC && HC.flatSurface) HC.flatSurface(host, 'screensaver');
    var st = document.createElement('style'); st.textContent = CSS + (HC && HC.flatCss ? HC.flatCss() : '') +
      ':host([hk-flat]){background:var(--hk-flat-ground)}' +
      ':host([hk-flat]) .pane,:host([hk-flat]) .mu,:host([hk-flat]) .pm{' + (HC && HC.flatVars ? HC.flatVars('dark') : '') + ';background:#24252A}' +
      ':host([hk-flat]) .mbgf,:host([hk-flat]) .mshade{display:none}' +
      ':host([hk-flat]) .sc,:host([hk-flat]) .pane{color:var(--hk-ink)}'  + (HC && HC.edgeCss ? '\n' + HC.edgeCss() : ''); root.appendChild(st);
    for (var i = 0; i < 2; i++) {
      var ph = document.createElement('div'); ph.className = 'ph';
      var bg = document.createElement(isFlat() ? 'div' : 'canvas'); bg.className = 'bg'; bg.hidden = true;
      var fg = document.createElement('img'); fg.className = 'fg'; fg.alt = '';
      var scrim = document.createElement('div'); scrim.className = 'phscrim';
      ph.appendChild(bg); ph.appendChild(fg); ph.appendChild(scrim); root.appendChild(ph);
    }
    var pane = document.createElement('div'); pane.className = 'pane';
    var sc = document.createElement('div'); sc.className = 'sc'; pane.appendChild(sc); root.appendChild(pane);
    // (its ends fade as it scrolls, as every list's do: hk-base.js SCROLL EDGES)
    sc.classList.add('hk-fades');
    if (HC && HC.edges) HC.edges(sc);
    paneEl = pane; paneSc = sc; paneCard = null;
    var info = document.createElement('div'); info.className = 'info'; root.appendChild(info);
    var nw = document.createElement('div'); nw.className = 'nightwash'; root.appendChild(nw);
    var blk = document.createElement('div'); blk.className = 'blk'; root.appendChild(blk);
    // taps on the screensaver itself: the window listener above has already
    // decided (edge zone or stop); here they are only kept from reaching
    // anything else
    ['click', 'pointerup', 'mouseup', 'touchend', 'contextmenu'].forEach(function (t) {
      host.addEventListener(t, function (e) {
        e.stopPropagation();
        // (the music's panel: its taps are its own -- a click, a field focused)
        if (t !== 'contextmenu' && inPanel(e)) return;
        if (e.cancelable) e.preventDefault();
      });
    });
    document.body.appendChild(host);
    buildCards(info);
  }
  function teardown() {
    dropSide();
    if (host) { host.removeAttribute('dark'); host.removeAttribute('undark'); }
    coverDashboard(false);
    blackPage(false);
    releaseVisuals();
    if (host) host.remove();
    host = null; root = null; press = null;
    noteDrawn();
    // gone for good: the camera strip starts its live stream after this
    try { window.dispatchEvent(new Event('hk-saver-done')); } catch (e) { /* ignore */ }
  }
  // The transparent host may still be catching wake-up taps. Its graphics
  // and card subscriptions need not survive that interaction-only period.
  function releaseVisuals() {
    if (fadeDone) fadeDone();
    displayLayer = null;
    if (tbT) { clearTimeout(tbT); tbT = null; }
    if (host) host.removeAttribute('tb');
    leaveExtras();
    leaveEnergy();
    leaveWeather();
    leaveForecast();
    leaveMusic();
    leaveClock();
    leaveLayout();
    leaveCorner();
    if (unsubCards) { unsubCards(); unsubCards = null; }
    cards = [];
    if (host) {
      // let the browser drop the decoded photos now, not at the next GC
      root.querySelectorAll('img').forEach(function (im) { im.removeAttribute('src'); });
      root.querySelectorAll('canvas').forEach(clearCanvas);
      Array.from(root.children).forEach(function (el) { if (el.tagName !== 'STYLE') el.remove(); });
      host.setAttribute('released', '');
    }
    paneEl = null; paneSc = null; paneCard = null; paneUp = false;
    if (paneT) { clearInterval(paneT); paneT = null; }
    if (paneResetT) { clearTimeout(paneResetT); paneResetT = null; }
  }
  var builtFor = null;
  function cfgKey() { try { return JSON.stringify(cfg); } catch (e) { return String(Math.random()); } }
  function buildCards(info) {
    var h = clientNow();
    cards = [];
    (cfg.cards || []).forEach(function (c, i) {
      var tag = tagOf(c.type);
      var make = function () {
        if (!host || !on || info.parentNode !== root) return;
        try {
          var el = document.createElement(tag);
          el.__hkSaverConf = c;
          // (the corner clock under a big one: there only under the music)
          if (c.music_only) el.setAttribute('muonly', '');
          if (c.ly_spare) el.setAttribute('lyhide', '');
          el.setConfig(cardConf(c, tag));
          feedCard(el, h);
          // IN THE ORDER WRITTEN, whenever each one is defined: a page
          // reloaded under the switch started this before hk-weather.js had
          // loaded, and the weather (defined first there) came in above the
          // clock (2026-10-04)
          el.__hkSaverIdx = i;
          var after = Array.prototype.filter.call(info.children, function (x) { return x.__hkSaverIdx > i; })[0];
          if (after) info.insertBefore(el, after); else info.appendChild(el);
          cards.push(el);
        } catch (e) { console.warn('[hk-saver] card', tag, e); }
      };
      // the card files load after this module; by the time a screensaver
      // starts they are normally defined, but a page reloaded straight into
      // the sleep script may still be loading them
      if (customElements.get(tag)) make();
      else if (customElements.whenDefined) customElements.whenDefined(tag).then(make);
    });
    if (window.hkCards && window.hkCards.onClient) unsubCards = window.hkCards.onClient(onClientCards);
  }
  function cardConf(c, tag) {
    var conf = Object.assign({}, c, { type: c.type });
    Object.keys(INKS).forEach(function (k) {
      if (typeof conf[k] === 'string' && conf[k] && conf[k].indexOf('var(') < 0) conf[k] = 'var(' + INKS[k] + ',' + conf[k] + ')';
    });
    if (paneUp && tag === 'hk-screensaver-status-card') { conf.line1_size = '22px'; conf.line_size = '16px'; conf.align = 'left'; }
    if (paneUp && tag === 'hk-timer-strip-card') conf.scale = Math.round(1.15 * scaleOf() * 100) / 100;
    if (cfg && cfg.layout && !(host && host.hasAttribute('lyoff'))) {
      if (tag === 'hk-clock-card' || tag === 'hk-weather-strip-card') conf.margin = '0px';
      // (the layout's Clock card is a small time, a corner's: the big one is the big element)
      // (each times its own size in the layout: c.__lyK, set where the layout places it)
      var vk = function (n) { return (n * (c.__lyK || 1)).toFixed(2) + 'vmin'; };
      if (tag === 'hk-clock-card') Object.assign(conf, { time_size: vk(9), ampm_size: vk(3), date_size: vk(3), date_gap: '2px' });
      // (...and the weather a corner's, in the screen's units: its 36 px and 60 px glyph ran off a phone)
      if (tag === 'hk-weather-strip-card') Object.assign(conf, { main_size: vk(4.4), glyph_size: vk(6.6), temp_gap: vk(3.4), icon_gap: vk(1.4) });
      if (tag === 'hk-timer-strip-card' && c.__lyK && c.__lyK !== 1) conf.scale = Math.round((conf.scale || 1) * c.__lyK * 100) / 100;
      if (tag === 'hk-screensaver-status-card' && c.__lyLeft) conf.align = 'left';
    }
    return conf;
  }
  function onClientCards(h) {
    cards.forEach(function (c) { try { feedCard(c, h); } catch (e) { /* ignore */ } });
    if (ckCtl) ckCtl.setClient(h);
    if (bigCtl) bigCtl.setClient(h);
    if (ly && ly.big && ly.big.ctl) ly.big.ctl.setClient(h);
    if (enCtl && enShowing) enCtl.setClient(h);
    if (wxCtl && wxShowing) wxCtl.setClient(h);
    // @ts-expect-error layoutClient() takes no argument (h is passed and not used)
    layoutClient(h);
    cornerClient();
  }

  // ------------------------------------------------------------ start / stop
  function start(reason) {
    if (on || !cfg || !allowed()) return false;
    // NOTHING STARTS UNDER THE KIOSK'S BLACK (2026-10-09). The house's sleep
    // turns the photos on and puts the black up in the same moment; started
    // under it and turned black at once, the screensaver was never shown --
    // the tablet's last frame was the dashboard -- yet the wake went through
    // black: dashboard, black, dashboard (screen-recorded on the Loft). Under
    // the black nobody sees photos anyway. The switch asks again on every
    // update, so they start when the black has ended -- after LIT_GRACE, the
    // house's answer to a tap (photos off within 2 s, TABLET-INVARIANTS 16c).
    if (black()) return false;
    if (reason === 'switch' && clock.now() - litAt < LIT_GRACE) return false;
    if (idleT) { clearTimeout(idleT); idleT = null; }
    on = true; startedBy = reason || 'idle'; mx = null; my = null; press = null; shownAt = 0;
    photoRun++; busy = false; queued = null; litWait = null;
    // BUILT FOR OTHER SETTINGS: its cards were set up for them (Home Status
    // sized for the calendar pane, or for the corner), and a host kept from
    // an earlier start kept them -- the pane turned off on HK Settings left
    // Home Status small, halfway along the top (2026-10-01). Built again.
    if (host && (host.hasAttribute('blocking') || host.hasAttribute('released') || builtFor !== cfgKey())) teardown();
    if (!host) { build(); builtFor = cfgKey(); }
    host.style.setProperty('--fade', FADE_IN_MS + 'ms');
    if (cfg.zoom && !reducedMotion()) host.setAttribute('zoom', ''); else host.removeAttribute('zoom');
    host.removeAttribute('blocking');
    host.removeAttribute('waking');       // started again while waking
    host.removeAttribute('dark');
    // Once fully covered, release the dashboard's paint layers. Pausing its
    // animations alone still retains clouds, glass and offscreen cards. On
    // Android those plus the forecast exceeded the tile memory budget and
    // the WebView dropped photos, the clock and forecast days from the screen.
    // Counted from the frame the fade starts, not from here: a hidden page
    // runs timeouts but no frames, and would hide the dashboard under a saver
    // still at opacity 0.
    if (coverT) clearTimeout(coverT);
    coverT = null;
    // THE FADE STARTS ONCE THERE IS SOMETHING TO SHOW (2026-10-09): the first
    // photo decoded and painted -- or the forecast built -- and two frames
    // drawn at [prep]'s barely-there opacity, so the tablet has rastered it;
    // never later than ENTRANCE_MAX
    host.setAttribute('prep', '');
    var run = photoRun, entered = false;
    entrance = function (force) {
      if (entered) return;
      // ...AND THE FORECAST BAND IN ITS PLACE (2026-10-09): it is built
      // hidden, centred, drawn again for its width beside the calendar pane
      // and only then shown (addBand, ~0.65 s). Started before that, the fade
      // ran over its redraw, and a tablet shows frames during a fade before
      // what changed is drawn: the band vanished for two frames halfway
      // through (screen-recorded on the Kitchen). Its `placed` calls this
      // again; ENTRANCE_MAX forces it.
      if (!force && fband && !fband.__hkPlaced && host && host.hasAttribute('band')) return;
      entered = true; entrance = null;
      var f1 = false, f2 = false;           // each frame's step once
      requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
        if (f2) return; f2 = true;
        if (!on || !host || photoRun !== run) return;
        host.removeAttribute('prep');
        host.setAttribute('on', '');
        shownAt = clock.now();
        noteDrawn();
        if (coverT) clearTimeout(coverT);
        coverT = setTimeout(function () { coverT = null; if (on) coverDashboard(true); }, FADE_IN_MS + 100);
      }); });
    };
    setTimeout(function () { if (photoRun === run && entrance) entrance(true); }, ENTRANCE_MAX);
    tellOthers();
    if (reason !== 'switch') writeSwitch('on');
    resetForecast();            // an element still fading out is reused
    setupPane();
    leaveClock();
    if (cfg.show === 'clock' || FACE_SHOWS[cfg.show]) enterClock();
    else if (cfg.show === 'forecast') enterForecast();
    // MUSIC FIRST, music playing: straight into it
    else if (!previewOn && cfg.music_first && musicPlaying()) { updateBand(); if (!showMusicSlide(true)) showNext(true); }
    else { updateBand(); showNext(true); }
    // A LARGE CLOCK over the photos or the forecast (the corner one is a card)
    if (cfg.show !== 'clock' && !FACE_SHOWS[cfg.show] && cfg.clock_large) mountClock('none');
    // THE LAYOUT over whatever background that was (2026-11-01, the Screensaver editor's)
    if (cfg.layout) enterLayout();
    // HOME ENERGY: its numbers asked for now, so its first turn has them;
    // the additional screens' timer
    energyPrep();
    weatherPrep();
    exArm();
    if (previewOn) setTimeout(syncPreviewSlide, 0);
    return true;
  }
  function stop(reason) {
    if (!on) return false;
    if (designController) designController.clear();
    if (asked) { asked = false; force = previewOn; }
    closePanel(false);
    on = false;
    entrance = null;
    if (host) host.removeAttribute('prep');
    // JUST WOKEN FROM A FROZEN PAGE (justResumed): what the screensaver shows
    // is stale and half drawn, so it wakes from black -- plain black at once,
    // the dashboard drawn under it, then the usual fade back to it
    if (host && justResumed()) { host.setAttribute('dark', ''); host.setAttribute('on', ''); }
    noteDrawn();
    photoRun++; busy = false; queued = null;
    // UNDER THE KIOSK'S BLACK, A DASHBOARD HIDDEN UNDER THE PHOTOS STAYS
    // HIDDEN until the tablet draws again (afterDraw's `drawing`): shown
    // where nothing is drawn, the tablet's first frame back had to draw all
    // of it at once, and showed it half drawn over everything for a frame
    // (screen-recorded)
    var keep = !!(host && host.hasAttribute('dark') && black());
    if (!keep) coverDashboard(false);
    if (slideT) { clearTimeout(slideT); slideT = null; }
    if (exT) { clearTimeout(exT); exT = null; }
    var ms = isFlat() ? 0 : cfg ? cfg.fade_back : FADE_BACK_MS;
    if (reason === 'touch') { writeSwitch('off'); press = { up: pressStop ? null : clock.now(), at: clock.now() }; }
    pressStop = false;
    // the dashboard, its sky and its cameras wake now, under the screensaver
    tellOthers();
    var h = host, stoppedRun = photoRun;
    if (h) {
      var still = function () { return !on && host === h && photoRun === stoppedRun; };
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
          var faded = false, p = press;
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
      var shown = function () { if (still()) { coverDashboard(false); blackPage(false); } };
      // AS IT COMES BACK the tablet first shows the frame it last drew
      // (through the kiosk's own fade off its black), so the wake goes on
      // from that frame -- never a cut to something else
      var fromLast = function () {
        if (!still()) return;
        if (drawnAs === 'dark') h.setAttribute('dark', '');      // black, then the fade
        else if (drawnAs === 'dashboard') {                       // the dashboard, at once
          shown();
          h.removeAttribute('on'); h.removeAttribute('waking'); h.removeAttribute('dark');
        }
        else { shown(); h.removeAttribute('dark'); }             // the photos, then the fade
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
        litWait = function () { fromLast(); afterDraw(fade, shown, null, drawnAs === 'dark'); };
      } else afterDraw(fade, shown, fromLast);
    }
    lastInput = Date.now();
    armIdle();
    return true;
  }
  // A wake held until the kiosk's black (or its panel off) has ended.
  var litWait = null;
  function lit() {
    if (black() || !litWait) return;
    var fn = litWait; litWait = null; fn();
  }
  // WHAT THE TABLET LAST SHOWED: after each change, seen in a frame's
  // callback -- one runs only when a frame is drawn, so never under the
  // kiosk's black -- and counted once two more frames have begun. One is not
  // enough: the frame the black went up on was begun and never shown (the
  // wake blinked from the old dashboard to black, screen-recorded).
  var drawnAs = 'dashboard', noteRun = 0;
  function noteDrawn() {
    if (typeof requestAnimationFrame !== 'function') return;
    var run = ++noteRun, seen = null;
    requestAnimationFrame(function () {
      if (seen) return;                    // each step once
      seen = !host || !host.hasAttribute('on') ? 'dashboard' : host.hasAttribute('dark') ? 'dark' : 'photos';
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (run === noteRun) drawnAs = seen; }); });
    });
  }
  // The sky, the cards and a dismissed pop-up's record all follow this.
  function tellOthers() {
    try { if (window.hkSky && window.hkSky.saverChanged) window.hkSky.saverChanged(); } catch (e) { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('hk-saver', { detail: { on: on } })); } catch (e) { /* ignore */ }
  }

  // visibility preserves layout, scroll position and the connected HA data
  // subscription. Restore it before the screensaver fades out, and preserve
  // any visibility style that was already set by the page.
  function coverDashboard(covered) {
    if (!covered) {
      if (coverT) { clearTimeout(coverT); coverT = null; }
      if (coveredPage) {
        var st = coveredPage.style;
        if (pageVisibility.value) st.setProperty('visibility', pageVisibility.value, pageVisibility.priority);
        else st.removeProperty('visibility');
      }
      coveredView.forEach(function (c) {
        if (c.value) c.el.style.setProperty('visibility', c.value, c.priority); else c.el.style.removeProperty('visibility');
      });
      coveredPage = null; pageVisibility = null; coveredView = [];
      return;
    }
    if (coveredPage) return;
    var page = window.hkShell.root();
    if (!page || !page.style) return;
    coveredPage = page;
    pageVisibility = { value: page.style.getPropertyValue('visibility'), priority: page.style.getPropertyPriority('visibility') };
    page.style.setProperty('visibility', 'hidden', 'important');
    // THE VIEW, WHERE THE HOST KEEPS IT OUTSIDE ITS ROOT (Mantel: #view
    // beside #hk-shell-root, 2026-10-21). Left showing under the photos, the
    // whole dashboard -- its sky, its cards, the shared blur's layers -- kept
    // its compositing layers through the screensaver (~7 screens of them at
    // 1920 x 1200, headless), and Return to Home made a new page's ~120 under
    // it mid-turn. Hidden with the root, as Home Assistant's whole page is.
    var view = window.hkShell.viewContainer ? window.hkShell.viewContainer() : null;
    if (view && view.style && !within(page, view)) {
      coveredView.push({ el: view, value: view.style.getPropertyValue('visibility'), priority: view.style.getPropertyPriority('visibility') });
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
    var key = (land ? LANDSCAPES : cfg.photos) + '|' + cfg.order;
    if (deck && listKey === key && Date.now() - listAt < LIST_TTL_MS && deck.items.length) return Promise.resolve(deck);
    if (listing && listing.key === key) return listing;
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
    var hostList = land ? null : hostPhotoList(cfg.photos);
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
      : walk(cfg.photos, 0);
    listing = source.then(function () {
      if (!deck || deck.order !== cfg.order) deck = new Deck(cfg.order);
      deck.set(out);
      listAt = Date.now(); listKey = key;
      return deck;
    }).catch(function (e) {
      console.warn('[hk-saver] photos', land ? LANDSCAPES : cfg.photos, e && e.message);
      if (!deck) deck = new Deck(cfg.order);
      listAt = Date.now() - LIST_TTL_MS + 60000;   // try again in a minute
      return deck;
    }).then(function (d) { listing = null; return d; });
    listing.key = key;
    return listing;
  }
  // THE DECODED PHOTO LET GO (2026-10-29): load() holds the picture in an
  // Image of its own (to know its size and to draw the backdrop or a mosaic
  // cell from), and the layer's <img> decodes it again. Once what is drawn
  // from it has been drawn, that Image's source is dropped, so a tablet that
  // shows photos all day holds one decoded photo, not two plus the last. The
  // preview keeps its photo (relayout draws from it again); ph.w and ph.h stay.
  function releasePh(ph) {
    var im = ph && ph.img;
    if (!im || (previewOn && ph === lastPh)) return;
    im.onload = im.onerror = null;
    try { im.removeAttribute('src'); } catch (e) { /* not an element */ }
    ph.img = null;
  }
  var busy = false, queued = null;
  // HK SETTINGS' PREVIEW of Portrait or Landscape Photos (2026-10-13): a
  // photo of that shape (previewShape), and the same one again while the
  // settings change -- each change restarts the preview (restartPreview),
  // and a new photo every time would make a crop impossible to judge. Each
  // photo's shape is remembered once loaded, so the next pick skips the
  // others without loading them. Only the preview: a tablet keeps no photo.
  var lastPh = null, previewShape = null, shapes = {};
  function showNext(first) { advance(function () { return deck && deck.next(); }, first); }
  function nextPhoto() { moTap = true; advance(function () { return deck && deck.next(); }); }
  function previousPhoto() { moTap = true; advance(function () { return deck && deck.previous(); }); }
  function advance(pick, first) {
    if (!on || mode !== 'photos') return;
    if (busy) { queued = pick; return; }
    busy = true;
    var run = photoRun, saverRoot = root;
    function active() { return on && run === photoRun && root === saverRoot; }
    if (slideT) { clearTimeout(slideT); slideT = null; }
    var tries = 0, looks = 0;
    var want = previewOn && previewShape ? previewShape : null;
    function attempt() {
      return listPhotos().then(function (d) {
        if (!active()) return null;
        // NO PHOTOS (an empty folder, one that can't be read): the forecast
        if (!d || !d.items || !d.items.length) {
          if (on && (cfg.fallback || cfg.show === 'both')) enterForecast();
          return null;
        }
        // the preview, restarted by a change: the same photo again
        if (first && previewOn && lastPh && (!want || shapeOfPh(lastPh) === want)) return lastPh;
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
          failed++;
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
          if (on && (cfg.fallback || cfg.show === 'both')) enterForecast();
          return null;
        }
        var n = Math.min(moCount(), d.items.length);
        if (n < 2) return attempt();
        var one = !first && !moTap && cfg.mosaic_change === 'one' && moState && moState.n === n && moState.left > 0 && moState.layer === displayLayer;
        moTap = false;
        var want = one ? 1 : n, got = [], misses = 0;
        var step = function () {
          if (got.length >= want || !active()) return got;
          var item = got.length ? d.next() : pick();
          if (!item) return got;
          return load(item).then(function (ph) { shapes[item.id] = shapeOfPh(ph); got.push(ph); return step(); },
                                 function () { failed++; return ++misses < 4 ? step() : got; });
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
      if (painted && mode === 'photos' && !exKind) { hideForecastSlide(); hideMusicSlide(); hideEnergySlide(); hideWeatherSlide(); }
      busy = false;
      if (!on) return;
      if (mode !== 'photos') { queued = null; return; }
      if (queued) { var q = queued; queued = null; advance(q); return; }
      schedule();
    });
  }
  // NOTHING TURNS UNDER A BLACK (2026-10-29). The photos' timer also held
  // while the kiosk's black (or HK's own) was up, and woke every few seconds
  // to find it still was: a screen nobody can see, a timer, and (on a tablet
  // that keeps the page running) the next photo downloaded and decoded for
  // nobody. Now it is not armed at all while black() -- slideHeld notes that
  // it was wanted -- and litNow() arms it again once the black has ended.
  var slideHeld = false;
  function schedule() {
    if (slideT) clearTimeout(slideT);
    slideT = null;
    if (previewOn) return;
    if (black()) { slideHeld = true; return; }
    slideHeld = false;
    slideT = setTimeout(function () {
      slideT = null;
      if (!on || !cfg) return;             // stopped (its config gone) meanwhile
      if (black()) { slideHeld = true; return; }    // the black went up while it waited
      // a hidden page (a backgrounded tab) does not turn photos, nor one
      // with the music's panel open
      if (document.hidden || pnl) { schedule(); return; }
      // the music holding the screen stays (musicWatch lets it go); an
      // additional screen over the photos behind the clock holds them
      if ((muShowing && takeover()) || exKind) { schedule(); return; }
      if (fcShowing || muShowing || enShowing || wxShowing) { showNext(false); return; }    // advance() takes the slide away
      // A SLIDE every few photos: the music, the forecast and Home Energy
      // take turns (the music only while it plays)
      if (sinceFc >= cfg.forecast_every) {
        var s = slideOf(cfg, musicPlaying(), lastSlide, energyReady(), weatherReady());
        if (s === 'music' && showMusicSlide()) { schedule(); return; }
        if (s === 'weather' && showWeatherSlide()) { schedule(); return; }
        if (s === 'energy' && showEnergySlide()) { schedule(); return; }
        if (s && cfg.show === 'both') { showForecastSlide(); schedule(); return; }
      }
      showNext(false);
    }, cfg.each_photo * 1000);
  }
  // Fade the incoming view ABOVE an opaque outgoing view. Swapping a photo
  // underneath an opaque forecast leaves it occluded: Android WebView can
  // defer rasterizing it until after the forecast has already faded to black.
  // The clock/pane and forecast details have fixed stacking levels above both.
  function reveal(next, first) {
    if (fadeDone) fadeDone();
    if (next === displayLayer) return;
    var old = displayLayer;
    next.style.transition = 'none';
    next.classList.remove('top');
    next.style.zIndex = '2';
    if (old) old.style.zIndex = '1';
    void next.offsetWidth;
    next.style.transition = first || !old ? 'none' : '';
    next.classList.add('top');
    displayLayer = next;
    // (the subject's twin over the layout's face, in step: phase 3)
    if (ly) { layoutCut(); cutsFollow(); }
    var timer;
    var done = fadeDone = function () {
      if (fadeDone !== done) return;
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
      fadeDone = null;
      if (ly) cutsFollow();
    };
    if (isFlat()) done(); else timer = setTimeout(done, first || !old ? 0 : CROSSFADE_MS + 100);
  }
  function paint(ph, first) {
    if (!root) return;
    if (fadeDone) fadeDone();
    var layers = root.querySelectorAll('.ph');
    var next = layers[1 - layer];
    var bg = next.querySelector('canvas.bg'), fg = next.querySelector('img.fg');
    next.classList.remove('zoom');
    // (a mosaic's cells, from before: gone)
    next.classList.remove('mo');
    next.querySelectorAll('.mowrap').forEach(function (w) { w.querySelectorAll('canvas').forEach(clearCanvas); w.remove(); });
    moState = null;
    var L = layOut(next, ph), fit = L.fit, lay = L.lay;
    // (the preview keeps it, to show again as its settings change)
    lastPh = previewOn ? ph : null;
    fg.src = ph.url;
    photoFaces(next, ph, L);
    // (with the calendar pane the blurred copy is always there: it is the
    // pane's background)
    // THE PANE comes or goes with a new photo (music_pane alone, as music
    // starts or stops): each photo is laid out for the pane as it came in
    // ([pw]), so the one fading out never moves
    if (mus.paneNext !== null) { var pn = mus.paneNext; mus.paneNext = null; setPane(pn); }
    setAttr(next, 'pw', paneUp);
    if (fit.backdrop || paneUp || ckPhotos()) { drawBackdrop(bg, ph.img, lay.small); bg.hidden = false; } else { bg.hidden = true; clearCanvas(bg); }
    releasePh(ph);
    if (cfg.zoom && !reducedMotion()) {
      next.style.setProperty('--zd', (cfg.each_photo * 1000 + CROSSFADE_MS) + 'ms');
      void next.offsetWidth;               // restart the zoom from 1
      next.classList.add('zoom');
    }
    reveal(next, first);
    layer = 1 - layer;
    // the first photo is in: the screensaver may fade in now (start)
    if (first && entrance) entrance();
    shown++; sinceFc++; lastPhoto = ph.item.title || ph.item.id;
  }

  // ------------------------------------------------------------ the mosaic
  // A MOSAIC ON A LAYER (2026-10-13): each photo drawn into its own cell's
  // canvas, at the cell's size -- the full photo is dropped once it is drawn,
  // so five photos cost about what one full-screen photo does -- cropped by
  // its shape's Focus and Zoom. The two layers cross-fade as photos do.
  // Changes: One at a Time swaps one cell at a time in place (moState).
  var moState = null, moTap = false;
  function mosaicOn() { return !!(cfg && cfg.mosaic && mode === 'photos' && !(ckPhotos() && cfg.clock_photo_soft)); }
  function moGap() {
    if (cfg.mosaic_gap === 'none') return 0;
    return cfg.mosaic_line > 0 ? cfg.mosaic_line : cfg.mosaic_gap === 'rounded' ? 12 : 3;
  }
  // UP TO (2026-10-13): how many photos the mosaic shows now -- its own
  // number, or with Up To one picked from 1 to it, kept for mosaic_every
  // minutes (another each time); 1 is one photo, full screen
  var moRand = null;
  function moCount() {
    if (!cfg.mosaic_random) { moRand = null; return cfg.mosaic_count; }
    var now = clock.now();
    if (!moRand || now >= moRand.until || moRand.max !== cfg.mosaic_count) {
      var max = cfg.mosaic_count, prev = moRand ? moRand.n : 0, k = prev, tries = 0;
      while (k === prev && tries++ < 8) k = 1 + Math.floor(Math.random() * max);
      moRand = { n: k, max: max, until: now + cfg.mosaic_every * 60000 };
    }
    return moRand.n;
  }
  function moDraw(cell, ph) {
    var r = cell.getBoundingClientRect ? cell.getBoundingClientRect() : { width: 0, height: 0 };
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = Math.max(1, Math.round((r.width || 200) * dpr)), ch = Math.max(1, Math.round((r.height || 200) * dpr));
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var sc = shapeOfPh(ph) === 'portrait' ? cfg.portrait : cfg.landscape, x = cv.getContext && cv.getContext('2d');
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
    if (!root) return;
    if (fadeDone) fadeDone();
    // ONE CELL, in place: the new photo fades in over the old one
    if (m.mosaicOne && moState && moState.layer === displayLayer) {
      var cells = moState.layer.querySelectorAll('.mocell');
      var choices = [];
      for (var i = 0; i < cells.length; i++) if (i !== moState.lastCell) choices.push(i);
      var ci = choices[Math.floor(Math.random() * choices.length)], cell = cells[ci];
      var old = cell.querySelector('canvas'), cv = moDraw(cell, m.mosaicOne);
      releasePh(m.mosaicOne);
      cv.style.opacity = '0';
      cell.appendChild(cv);
      void cv.offsetWidth;
      cv.style.opacity = '1';
      setTimeout(function () { if (old && old.parentNode) { clearCanvas(old); old.parentNode.removeChild(old); } }, CROSSFADE_MS + 100);
      moState.lastCell = ci; moState.left--;
      shown++; sinceFc++;
      return;
    }
    // a one-cell change whose mosaic is no longer on screen (the music slide
    // took the screen while its photo loaded): that photo on its own
    if (m.mosaicOne) { paint(m.mosaicOne, first); return; }
    var layers = root.querySelectorAll('.ph'), next = layers[1 - layer];
    next.querySelectorAll('.mowrap').forEach(function (w) { w.querySelectorAll('canvas').forEach(clearCanvas); w.remove(); });
    // (a mosaic has no titles, and no time behind: the clock as set)
    next.querySelectorAll('.tb,.ttl').forEach(function (n) { n.remove(); });
    if (host) setAttr(host, 'tb', false);
    next.classList.remove('zoom');
    next.classList.add('mo');
    var fg = next.querySelector('img.fg'), bgc = next.querySelector('canvas.bg');
    if (fg) fg.removeAttribute('src');
    if (bgc) { bgc.hidden = true; clearCanvas(bgc); }
    if (mus.paneNext !== null) { var pn = mus.paneNext; mus.paneNext = null; setPane(pn); }
    setAttr(next, 'pw', paneUp);
    var W = Math.max(1, (window.innerWidth || 1280) - (paneUp ? paneW || 0 : 0)), H = Math.max(1, window.innerHeight || 800);
    var ports = m.mosaic.filter(function (ph) { return shapeOfPh(ph) === 'portrait'; }).length;
    var plan = mosaicPlan(m.mosaic.length, W, H, Math.random, moState ? moState.idx : -1, ports);
    var pick = mosaicAssign(plan.cells, m.mosaic.map(function (ph) { return shapeOfPh(ph) === 'portrait'; }), W, H);
    var g = moGap(), wrap = document.createElement('div');
    wrap.className = 'mowrap' + (cfg.mosaic_gap === 'rounded' ? ' round' : '');
    wrap.style.padding = (g / 2) + 'px';
    wrap.style.background = MOSAIC_COLORS[cfg.mosaic_color] || '#000';
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
    m.mosaic.forEach(releasePh);            // (drawn into the cells: the full photos are let go)
    if (cfg.zoom && !reducedMotion()) {
      next.style.setProperty('--zd', (cfg.each_photo * 1000 + CROSSFADE_MS) + 'ms');
      void next.offsetWidth;
      next.classList.add('zoom');
    }
    lastPh = null;
    reveal(next, first);
    layer = 1 - layer;
    // a whole new mosaic now and then: after each cell has changed about twice
    moState = { n: m.mosaic.length, idx: plan.idx, layer: next, left: m.mosaic.length * 2, lastCell: -1 };
    if (first && entrance) entrance();
    shown++; sinceFc++; lastPhoto = (m.mosaic[0].item && (m.mosaic[0].item.title || m.mosaic[0].item.id)) || lastPhoto;
  }
  // ONE PHOTO'S LAYOUT on its layer: whole or filled, the focus, the zoom,
  // the copy's dim (paint; and relayout, the preview's in-place change)
  function layOut(el, ph) {
    var fit = fitOf(ph.w, ph.h, cfg.fill, cfg.portrait && cfg.portrait.fill);
    var sc = fit.portrait ? cfg.portrait : cfg.landscape, lay = layoutOf(sc);
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
    if (!host || !host.style) return;
    var on = !!c && photoOpts(c).behind;
    host.style.setProperty('--tb-size', String(on ? c.tb_size : 24));
    host.style.setProperty('--tb-top', String(on ? c.tb_top : 6));
    host.style.setProperty('--tb-dim', String(on && c.show !== 'clock' ? (c.tb_dim || 0) / 100 : 0));
  }
  function photoFaces(lay, ph, L, c) {
    c = c || cfg;
    // (the photo this layer shows, for the layout's cut-out: layoutCut)
    lay.__ph = ph; lay.__fit = L && L.fit ? L.fit.fit : 'cover';
    lay.querySelectorAll('.tb,.ttl').forEach(function (n) { n.remove(); });
    if (!c || !ph || !ph.item) return;
    var it = ph.item, before = lay.querySelector('.phscrim');
    var po = photoOpts(c);
    // (the layout's Photo Title widget says this photo's album and year)
    if (ly && (lyPhoto = it)) {
      // (and its luminance, for the screen's ink: read once the photo has loaded)
      lyPhotoLum = null;
      var im0 = ph.img;
      if (im0 && im0.complete) lyPhotoLum = photoLum(im0);
      else if (im0 && im0.addEventListener) im0.addEventListener('load', function () { if (ly) { lyPhotoLum = photoLum(im0); layoutSoon(); } }, { once: true });
      layoutSoon();
    }
    if (po.titles && (it.album || it.year)) {
      var ttl = document.createElement('div'), tt = document.createElement('div');
      ttl.className = 'ttl'; tt.className = 'tt';
      if (it.album) { var b = document.createElement('b'); b.textContent = it.album; tt.appendChild(b); }
      if (it.year) { var y = document.createElement('span'); y.textContent = String(it.year); tt.appendChild(y); }
      ttl.appendChild(tt);
      lay.insertBefore(ttl, before);
    }
    if (host) setAttr(host, 'tb', po.behind);
    tbLook(c);
    if (!po.behind) return;
    var r = lay.getBoundingClientRect ? lay.getBoundingClientRect() : null;
    var W = Math.max(1, ((r && r.width) || window.innerWidth || 1280) - (paneUp ? paneW || 0 : 0)), H = (r && r.height) || window.innerHeight || 800;
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
  // the time on the photos, as the screen's clock tells it (its 24-Hour Time), put right on the minute
  var tbT = null;
  function timeNow() {
    var d = new Date(), h = d.getHours();
    if (!cfg || !cfg.clock_24) { h = h % 12; if (h === 0) h = 12; }
    return (cfg && cfg.clock_24 && h < 10 ? '0' : '') + h + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function tbArm() {
    if (tbT) return;
    tbT = setTimeout(function () {
      tbT = null;
      if (!on || !root || !cfg || !photoOpts(cfg).behind) return;
      var s = timeNow();
      root.querySelectorAll('.tb .tbt').forEach(function (e) { if (e.textContent !== s) e.textContent = s; });
      tbArm();
    }, 60000 - Date.now() % 60000 + 50);
  }
  function relayout() {
    var top = root && root.querySelectorAll('.ph')[layer];
    if (!top || !lastPh || mode !== 'photos') return false;
    var L = layOut(top, lastPh), bg = top.querySelector('canvas.bg');
    photoFaces(top, lastPh, L);
    if (L.fit.backdrop || paneUp || ckPhotos()) { drawBackdrop(bg, lastPh.img, L.lay.small); bg.hidden = false; } else { bg.hidden = true; clearCanvas(bg); }
    return true;
  }
  // A preview selection survives asynchronous module loads and option rebuilds.
  // It never enables a real screen's slides or writes settings.
  function syncPreviewSlide() {
    if (!previewOn || !on) return false;
    var kind = previewSelected;
    if (!kind) return true;
    var ok = kind === 'music' ? (muShowing || showMusicSlide()) : kind === 'weather' ? (wxShowing || showWeatherSlide()) :
      kind === 'energy' ? (enShowing || showEnergySlide()) : fcShowing || showForecastExtra();
    if (ok) exKind = kind;
    return !!ok;
  }
  function restartPreview() {
    if (!previewOn || !on) return;
    on = false;
    if (slideT) { clearTimeout(slideT); slideT = null; }
    teardown();
    start('preview');
    setTimeout(syncPreviewSlide, 0);
  }

  // ------------------------------------------------------------ the forecast
  // The forecast's layer: built the first time it is needed, then kept for
  // as long as the screensaver shows (Photos & Forecast brings it back every
  // few photos); its sky holds still whenever it is not on screen.
  function buildForecast() {
    if (!root) return;
    // (Behind the Clock: Sky Only -- the forecast's sky without its land and
    // decorations; a kept layer drawn the other way is drawn again)
    var skyOnly = !!(cfg && cfg.show === 'clock' && cfg.clock_bg === 'skyonly');
    var had = root.querySelector('.fc');
    if (had) {
      var k = had.querySelector('#hk-sky');
      if (!k || k.classList.contains('skyonly') === skyOnly) return;
      if (fscene) { try { fscene.destroy(); } catch (e) { /* gone with the element */ } fscene = null; }
      fSky = null;
      had.remove();
    }
    var fc = document.createElement('div');
    fc.className = 'fc';
    root.insertBefore(fc, root.querySelector('.info'));
    var sky = document.createElement('div');
    sky.className = 'fsky';
    fc.appendChild(sky);
    try { fscene = !isFlat() && window.hkSky && window.hkSky.scene ? window.hkSky.scene(sky, { skyOnly: skyOnly }) : null; } catch (e) { fscene = null; }
    startTick();
  }
  // the details' layer, built the first time they are wanted
  function buildBand() {
    if (!root || root.querySelector('.fcb')) return;
    var fcb = document.createElement('div');
    fcb.className = 'fcb';
    root.insertBefore(fcb, root.querySelector('.info'));
    var scrim = document.createElement('div');
    scrim.className = 'fcscrim';
    fcb.appendChild(scrim);
    var band = document.createElement('div');
    band.className = 'fcband';
    fcb.appendChild(band);
    addBand(band);
    startTick();
  }
  function startTick() {
    if (!fTick) fTick = setInterval(function () { forecastTick(false); }, FC_TICK_MS);
  }
  // Whether the details show now: on the forecast (Forecast, the slide, the
  // no-photos fallback) by `band`; over the photos by `band_photos`.
  function bandWanted() {
    if (!on || !cfg || muShowing || enShowing || wxShowing) return false;
    // (a layout's forecast as the background -- Show: Forecast, or Photos with none to show -- has its details as a piece
    // of its own, the Weather band, if it has them at all: the old band's today, its rules and its scrim were drawn over
    // the layout's pieces, 2026-11-02. As a slide the forecast is the slide's, band and all)
    if (cfg.layout && !fcShowing) return false;
    // (Big Weather is the forecast's details itself)
    return fcVisible() ? cfg.band !== false && !bigWanted() : cfg.band_photos === true;
  }
  // BIG WEATHER (2026-10-30; the Forecast's Layout: Big): hk-saverfaces.js's, in the forecast's layer over its sky,
  // wherever the forecast shows on its own -- Show: Forecast, the slide among the photos, no photos -- never under a
  // clock (Behind the Clock: Forecast keeps the forecast's own details)
  var bigCtl = null, bigRun = 0, bigFor = '';
  // (with a layout too, where the forecast is a slide: layoutCfg made it Classic where the forecast is the background)
  // (a layout: the forecast as a slide over any Look takes the Slides section's Classic / Big -- layoutCfg made it
  // Classic where the forecast is the background)
  function bigWanted() { return !!(cfg && cfg.forecast_layout === 'big' && (cfg.layout || (cfg.show !== 'clock' && !FACE_SHOWS[cfg.show]))); }
  function bigWeather() {
    if (!root || !host) return;
    var want = bigWanted();
    setAttr(host, 'fcbig', want);
    var fc = root.querySelector('.fc');
    // (its big number changed -- the temperature or the time: drawn again)
    if (bigCtl && (!want || bigFor !== cfg.forecast_big + '|' + cfg.forecast_planted)) { try { bigCtl.destroy(); } catch (e) { /* gone */ } bigCtl = null; }
    if (!want || !fc || bigCtl) return;
    var run = ++bigRun;
    facesModule().then(function (F) {
      if (!F || run !== bigRun || !on || !fc.isConnected || bigCtl) return;
      bigFor = cfg.forecast_big + '|' + cfg.forecast_planted;
      bigCtl = F.mount(fc, { kind: 'weather', h24: cfg.clock_24, big: cfg.forecast_big, weather: weatherEntity(), client: clientNow(),
                             planted: cfg.forecast_planted, sky: fSky,
                             onReadings: function (n) { if (host) host.setAttribute('fcn', String(n)); } });
    });
  }
  function updateBand() {
    if (!host) return;
    var want = bandWanted();
    if (want) buildBand();
    if (want) host.setAttribute('band', ''); else host.removeAttribute('band');
    if (on && cfg && cfg.band_photos === true) host.setAttribute('bandph', ''); else host.removeAttribute('bandph');
    layoutSlides();
    slideCorner();
  }
  // ------------------------------------------------------------ the slide corner
  // THE SLIDE CORNER (2026-11-02, phase 13: docs/phase13/SCREENSAVER-UNIFIED.md, "Slides: the slide corner"; the owner:
  // "A slide needs only the Time, Date, Weather and House Status, and only where they apply: the Weather slide needs no
  // extra weather"). Each slide says what it shows itself (hkSaverLayout.SLIDES); one corner, drawn by the pieces'
  // renderer, adds only what it lacks: the time and the date at the top left, the weather inline under them, House
  // Status at the top right. Its time takes the Look's face's font and color where the face has words (decision 4).
  // WHAT IT COSTS A WALL TABLET: four pieces made once, their words on the minute and when the house changes (at most
  // every 2 s), hidden by opacity with the slide; nothing moves.
  var scn = null, cornerAsked = false;
  function slideNow() {
    if (!on) return null;
    if (muShowing) return 'music';
    if (enShowing) return 'energy';
    if (wxShowing) return 'weather';
    if (fcShowing) return bigWanted() ? 'forecast_big' : 'forecast';
    return null;
  }
  // the Look's time as words: the font and color of the face on the screen (the layout's big element, else the
  // clock's), or Classic's where the face has no words (Analog, Flip)
  function faceWords() {
    var root0 = (ly && ly.big && ly.big.el) || (root && root.querySelector('.ck .face'));
    if (!root0) return null;
    var hit = null;
    (function walk(n) {
      if (hit || !n) return;
      if (n.nodeType === 1 && n.tagName !== 'STYLE' && n.tagName !== 'svg') {
        for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\d/.test(c.textContent)) { hit = n; return; }
        for (var k = n.firstElementChild; k; k = k.nextElementSibling) walk(k);
      }
    })(root0);
    if (!hit || (cfg && ANALOG[cfg.clock_style]) || (cfg && cfg.clock_style === 'flip')) return null;
    var cs = getComputedStyle(hit);
    return { font: cs.fontStyle + ' ' + cs.fontWeight + ' 1em ' + cs.fontFamily, family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle,
             color: /^rgba?\(0, 0, 0, 0\)$|transparent/.test(cs.color) ? null : cs.color };
  }
  function slideCorner() {
    if (!host || !root) return;
    var key = slideNow(), LM = window.hkSaverLayout, WG = window.hkSaverWidgets;
    setAttr(host, 'scorner', !!key);
    if (!key) { if (scn) scn.key = null; return; }
    // (the pieces' files asked for once: a load that fails is not asked again from here -- asking again on its failure
    // spun the page, 2026-11-02, the harness's forecast slide; the 0.1.104 rule: nothing wakes itself)
    if (!LM || !WG) {
      if (!cornerAsked) { cornerAsked = true; layoutModules().then(function (got) { if (on && got && got[0] && got[1]) slideCorner(); }); }
      return;
    }
    if (!scn || !scn.el.isConnected) {
      var el = document.createElement('div');
      el.className = 'scn';
      el.setAttribute('data-ink', 'white');
      el.setAttribute('data-acc', '');
      el.style.setProperty('--lay-ink', '#ffffff');
      if (WG.sheet) el.appendChild(WG.sheet());
      var tl = document.createElement('div'), tr = document.createElement('div');
      tl.className = 'scs tl'; tr.className = 'scs tr';
      el.append(tl, tr);
      root.insertBefore(el, root.querySelector('.blk'));
      scn = { el: el, tl: tl, tr: tr, p: {}, u: 0, minT: null };
    }
    cornerDraw(key);
    // (and once the slide has come in and drawn its words: what it shows is laid out as it fades in)
    if (scn.key !== key) { scn.key = key; clearTimeout(scn.againT); scn.againT = setTimeout(function () { if (scn && slideNow() === key) cornerDraw(key); }, CROSSFADE_MS + 150); }
    if (!scn.minT) scn.minT = setTimeout(function tick() { if (!scn) return; scn.minT = setTimeout(tick, 60000 - Date.now() % 60000 + 50); if (slideNow()) cornerDraw(slideNow()); },
                                         60000 - Date.now() % 60000 + 50);
  }
  function cornerDraw(key) {
    var LM = window.hkSaverLayout, WG = window.hkSaverWidgets;
    if (!scn || !LM || !WG) return;
    var R = layoutRoomOf(), u = Math.min(R.room.w, R.room.h) / 100, m = 6 * u, client = clientNow(), now = new Date();
    // (what the slide lacks, less what the corner is set to leave out; its time at its own size -- the Slides section)
    var want = LM.cornerFor(key).filter(function (k) { return (cfg.corner_hide || []).indexOf(k) < 0; }), tsz = (cfg.corner_time_size || 100) / 100;
    scn.el.style.left = R.room.x + 'px'; scn.el.style.width = R.room.w + 'px';
    scn.el.style.setProperty('--m', m + 'px'); scn.el.style.setProperty('--g', (0.8 * u) + 'px');
    if (Math.abs(scn.u - u) > 0.01 || scn.tsz !== tsz) { Object.keys(scn.p).forEach(function (k) { scn.p[k].destroy(); }); scn.p = {}; scn.u = u; scn.tsz = tsz; }
    // (the time a little larger than the corner's words, the Look's own; the date and the weather a line each; Home Status a line)
    var spec = { time: ['time', 'inline', 2.6 * tsz, scn.tl], date: ['date', 'inline', 1, scn.tl], weather: ['weather', 'inline', 1, scn.tl], status: ['status', 'inline', 1, scn.tr] };
    var face = faceWords(), ctx = { face: face ? { font: face.family } : null };
    ['time', 'date', 'weather', 'status'].forEach(function (k) {
      var on2 = want.indexOf(k) >= 0, c = scn.p[k];
      if (on2 && !c) {
        try { c = scn.p[k] = WG.create(spec[k][0], spec[k][1], { u: u * spec[k][2], back: 'none', color: 'auto', h24: cfg.clock_24, weather: weatherEntity() }); spec[k][3].appendChild(c.el); }
        catch (e) { console.warn('[hk-saver] corner', k, e && e.message); return; }
      }
      if (!c) return;
      c.el.style.display = on2 ? '' : 'none';
      if (!on2) return;
      try { c.update(client, now, ctx); } catch (e) { /* its own data */ }
      if (k === 'time') {
        c.el.style.color = face && face.color ? face.color : '';
        c.el.style.fontWeight = face ? face.weight : '';
        c.el.style.fontStyle = face ? face.style : '';
      }
    });
    // (both top corners' first letters on the margin, as a layout's are: a larger time has more room above its letters)
    var hr1 = host.getBoundingClientRect(), k1 = host.offsetWidth ? hr1.width / host.offsetWidth : 1;
    [scn.tl, scn.tr].forEach(function (st) {
      st.style.marginTop = '';
      var first = [].filter.call(st.children, function (e) { return e.style.display !== 'none'; })[0], ink = first && inkOf(first);
      if (!ink || !(k1 > 0)) return;
      st.style.marginTop = -((ink.y0 - st.getBoundingClientRect().top) / k1) + 'px';
    });
    // CLEAR OF THE SLIDE'S OWN WORDS (2026-11-03, the owner: "Sometimes the Widgets... overlap or collide with the
    // Slides"): each side's stack drops below whatever of the slide it would meet -- Big Weather's two lines at the top,
    // the Weather slide's and Home Energy's own -- by the words and small pictures the slide shows (the music's words
    // move under the corner instead: layoutMusic)
    var sl = key === 'energy' ? enCtl && enCtl.el : key === 'weather' ? wxCtl && wxCtl.el : key === 'forecast' || key === 'forecast_big' ? root.querySelector('.fc') : null;
    if (sl && k1 > 0) {
      var marks = slideMarks(sl), gap1 = 1.6 * u * k1;
      [scn.tl, scn.tr].forEach(function (st) {
        for (var n = 0; n < 4; n++) {
          var b = st.getBoundingClientRect();
          if (!b.height) return;
          var hit = marks.filter(function (r) { return r.left < b.right + gap1 && b.left < r.right + gap1 && r.top < b.bottom + gap1 && b.top < r.bottom + gap1; });
          if (!hit.length) return;
          var low = Math.max.apply(null, hit.map(function (r) { return r.bottom; }));
          st.style.marginTop = (parseFloat(st.style.marginTop) || 0) + (low + gap1 - b.top) / k1 + 'px';
        }
      });
    }
    // (the music's words below the corner, wherever its words now end)
    if (key === 'music') layoutMusic();
  }
  // the room the corner has: the screen less the Side Pane (as a layout's)
  function layoutRoomOf() {
    var W = host.clientWidth || window.innerWidth || 1280, H = host.clientHeight || window.innerHeight || 800;
    var pw = paneUp ? (paneW || 0) : 0;
    return { W: W, H: H, room: { x: cfg && cfg.pane_side === 'left' ? pw : 0, y: 0, w: Math.max(1, W - pw), h: H } };
  }
  var cornerAt = 0;
  function cornerClient() {
    if (!scn || !slideNow()) return;
    var t = Date.now();
    if (t - cornerAt < 2000) return;
    cornerAt = t;
    cornerDraw(slideNow());
  }
  function leaveCorner() {
    if (!scn) return;
    clearTimeout(scn.minT); clearTimeout(scn.againT);
    Object.keys(scn.p).forEach(function (k) { try { scn.p[k].destroy(); } catch (e) { /* gone */ } });
    if (scn.el.parentNode) scn.el.remove();
    scn = null;
    if (host) host.removeAttribute('scorner');
  }
  // (the music slide over it hides it)
  function fcVisible() { return (mode === 'forecast' || fcShowing) && !muShowing && !enShowing && !wxShowing; }
  // ------------------------------------------------------------ the layout
  // THE LAYOUT (2026-11-01, the owner: "Lets do the editor!"; docs/phase12/SCREENSAVER-EDITOR.md): the Screensaver
  // editor's -- one big element and widgets in zones -- over the background the Show's own path drew. The big element
  // in .lay: the time as a Clock face in a box of its own (its faces are sized by their box), the temperature, the
  // date or the month; Planted, the time standing in the meadow (hkSaverFaces.plant); Behind the photo's subject,
  // Time Behind's own figures at the layout's size and height. The widgets are hkSaverWidgets'; the corner cards are
  // the screensaver's own, placed through their own --hk-ss-* variables. ONE PLAN places all of it
  // (hkSaverLayout.plan, the editor's overlay's too): a corner the big element reaches moves out of its way.
  // WHAT IT COSTS A WALL TABLET: nothing moves but what moved before (a face's second hand, the clock's own tick);
  // the plan is arithmetic, made again on a resize, the minute, the sky's reading or the pane -- coalesced -- and the
  // widgets redraw only when their words change.
  var ly = null, lyRun = 0, lyLoad = null;
  function layoutModules() {
    if (!lyLoad) {
      // (each on its own: without the widgets' file the big element and the cards still draw)
      var get = function (name, file) {
        return window[name] ? Promise.resolve(window[name]) : import('/hk/modules/' + file).then(function () { return window[name]; })
          .catch(function (e) { console.warn('[hk-saver] layout', file, e && e.message); return null; });
      };
      lyLoad = Promise.all([get('hkSaverLayout', 'hk-saverlayout.js'), get('hkSaverWidgets', 'hk-saverwidgets.js')])
        .then(function (got) { if (!got[0]) lyLoad = null; return got; });
    }
    return lyLoad;
  }
  function enterLayout() {
    leaveLayout();
    if (!root || !cfg || !cfg.layout) return;
    var layer = document.createElement('div');
    layer.className = 'lay';
    root.insertBefore(layer, root.querySelector('.info'));
    host.setAttribute('lay', '');
    var run = ++lyRun;
    ly = { run: run, layer: layer, big: null, widgets: {}, soonT: null, minuteT: null, ro: null, last: '' };
    layoutModules().then(function (got) {
      if (!ly || ly.run !== run || !on || !got[0]) return;
      // (the widgets' look: their sheet in this shadow tree, which the document's can't reach)
      if (got[1] && got[1].CSS) { var css = got[1].sheet ? got[1].sheet() : document.createElement('style'); if (!got[1].sheet) css.textContent = got[1].CSS; layer.appendChild(css); }
      // (the layout's groups' files at once: Notifications counts from the moment the screensaver comes up)
      if (got[0] && got[0].filesOf) got[0].filesOf(got[0].clean(cfg.layout)).forEach(pieceFile);
      piecesStarted();
      layoutDraw();
      // the widgets' words on the minute; the cards' sizes once they have drawn
      ly.minuteT = setTimeout(function tickMinute() {
        if (!ly || ly.run !== run) return;
        layoutDraw();
        ly.minuteT = setTimeout(tickMinute, 60000 - Date.now() % 60000 + 50);
      }, 60000 - Date.now() % 60000 + 50);
      setTimeout(layoutSoon, 1200);
      // NIGHT MODE with a layout, whatever is behind it
      nightCheck();
      if (!nightT) nightT = setInterval(nightCheck, 30000);
      if (typeof ResizeObserver === 'function') { ly.ro = new ResizeObserver(layoutSoon); ly.ro.observe(host); }
    });
  }
  function leaveLayout() {
    lyRun++;
    if (!ly) { if (host) host.removeAttribute('lay'); return; }
    clearTimeout(ly.soonT); clearTimeout(ly.minuteT); clearInterval(ly.secT);
    if (ly.ro) ly.ro.disconnect();
    layoutBigOff();
    Object.keys(ly.widgets).forEach(function (k) { try { ly.widgets[k].destroy(); } catch (e) { /* gone */ } });
    if (ly.layer && ly.layer.parentNode) ly.layer.remove();
    cards.forEach(function (c) { c.removeAttribute('lyhide'); c.style.removeProperty('left'); c.style.removeProperty('top'); });
    ly = null;
    if (host) { host.removeAttribute('lay'); host.removeAttribute('lyoff'); }
  }
  // UNDER A SLIDE: the music, the forecast among the photos or over a clock, the weather, Home Energy -- or Big Weather
  // in the photos' place, which tells the time itself. Every slide's coming and going passes updateBand(), which asks here.
  function layoutCovered() {
    return !!ly && (muShowing || enShowing || wxShowing || fcShowing || (mode === 'forecast' && host.hasAttribute('fcbig')));
  }
  function layoutSlides() {
    if (!ly || !host) return;
    var off = layoutCovered();
    if (off === host.hasAttribute('lyoff')) return;
    setAttr(host, 'lyoff', off);
    if (off) {
      // the layout's places and looks taken off the cards (their own variables, a corner's colors, the plates)
      cards.forEach(function (c) {
        Array.prototype.slice.call(c.style).forEach(function (p) { if (/^--hk-ss-|^--hk-ink$/.test(p) || p === 'left' || p === 'top') c.style.removeProperty(p); });
        c.removeAttribute('lyhide');
      });
    }
    // each card's config for now: a corner's own sizes, or the layout's (cardConf)
    cards.forEach(function (c) {
      var conf = c.__hkSaverConf;
      if (conf) { try { c.setConfig(cardConf(conf, String(conf.type || '').replace(/^custom:/, ''))); } catch (e) { /* as it was */ } }
    });
    // ...back where the plan puts them at once, and again once they have drawn at their sizes
    if (!off) { layoutDraw(); layoutSoon(); }
    // the cards fade in where they now are, with the slide, as the layout fades the other way (never a jump across the screen)
    var info = root && root.querySelector('.info');
    if (info && info.animate && !reducedMotion()) { try { info.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'ease' }); } catch (e) { /* shown */ } }
  }
  // drawn again soon, once for everything that asks at the same moment
  function layoutSoon() {
    if (!ly || ly.soonT) return;
    ly.soonT = setTimeout(function () { if (ly) { ly.soonT = null; layoutDraw(); } }, 120);
  }
  var lyClientAt = 0;
  function layoutClient() {
    if (!ly) return;
    var now = Date.now();
    if (now - lyClientAt < 2000) return;         // the house's states change many times a second: the words, at most every 2 s
    lyClientAt = now;
    layoutSoon();
  }
  function layoutBigOff() {
    if (!ly || !ly.big) return;
    if (ly.big.ctl) { try { ly.big.ctl.destroy(); } catch (e) { /* gone */ } }
    if (ly.big.el && ly.big.el.parentNode) ly.big.el.remove();
    ly.big = null;
  }
  // the room the layout has: the screen less the Side Pane, beside it
  function layoutRoom() {
    var W = host.clientWidth || window.innerWidth || 1280, H = host.clientHeight || window.innerHeight || 800;
    var pw = paneUp ? (paneW || 0) : 0;
    return { W: W, H: H, room: { x: cfg.pane_side === 'left' ? pw : 0, y: 0, w: Math.max(1, W - pw), h: H } };
  }
  // THE BIG ELEMENT: made (or kept) for what the layout asks, and its size as drawn -- {w, h, base} -- or null
  function layoutBig(b, R, u) {
    var key = [b.kind, b.depth, b.size, b.align, cfg.clock_style, !!cfg.clock_planted, cfg.clock_color, cfg.clock_24, cfg.clock_today_music, cfg.clock_today_weather, JSON.stringify(cfg.clock_options), R.room.w, R.room.h, cfg.show, mode, !!fcShowing].join('|');
    // (Behind only while photos show: over the forecast between them, or with no photos, the time stands in front)
    var planted = b.kind === 'time' && (b.depth === 'planted' || cfg.clock_planted) && (cfg.show === 'forecast' || (cfg.show === 'clock' && cfg.clock_bg === 'forecast')) && !!fSky;
    if (ly.big && ly.big.key !== key) layoutBigOff();
    if (b.kind === 'none') return null;
    if (!ly.big) {
      var el = document.createElement('div');
      el.className = 'lybig';
      // (under every piece: the subject's twin goes right over it, and the pieces over both)
      ly.layer.insertBefore(el, ly.layer.querySelector('.hksw'));
      ly.big = { key: key, el: el, ctl: null, kind: b.kind, planted: planted };
    }
    var big = ly.big, el2 = big.el, fs = b.size * u, client = clientNow();
    if (planted) {
      // standing in the meadow: plant() places it on the land's ground line; only its box is measured
      var F = window.hkSaverFaces;
      if (!F || !F.plant) { facesModule().then(layoutSoon); return null; }
      el2.style.cssText = 'left:0;top:0;width:' + R.W + 'px;height:' + R.H + 'px';
      if (!big.pl) {
        // (its look is the faces' own sheet: .hkf.weather .pl)
        el2.className = 'lybig hkf weather planted';
        var css = document.createElement('style');
        css.textContent = F._.CSS;
        big.pl = document.createElement('div');
        big.pl.className = 'pl';
        el2.append(css, big.pl);
      }
      var season = window.hkSky && window.hkSky._land ? window.hkSky._land.season(client, fSky) : 'fall';
      var txt = timeNow(), pk = [txt, fSky.elev, fSky.azim, fSky.cover, season, b.align, b.size].join('|');
      if (big.pk !== pk) big.pk = F.plant(big.pl, txt, R.W, R.H, fSky, season, layoutSoon, b.align, b.size) ? pk : null;
      var fig = big.pl.querySelector('.pd .b');
      if (!fig) return null;
      var r = fig.getBoundingClientRect(), hr = host.getBoundingClientRect();
      return { w: r.width, h: r.height, base: r.height * 0.8, fixed: { x: r.left - hr.left, y: r.top - hr.top } };
    }
    if (b.kind === 'time') {
      var C = window.hkSaverClock;
      if (!C) { clockModule().then(layoutSoon); return null; }
      if (!big.ctl) {
        // the face drawn in a box the room's shape, measured, then scaled so its figures are the layout's size
        el2.className = 'lybig measuring';
        el2.style.cssText = 'left:0;top:0;width:' + R.room.w + 'px;height:' + R.room.h + 'px;container-type:size';
        big.ctl = C.mount(el2, { style: cfg.clock_style, options: cfg.clock_options, h24: cfg.clock_24, color: cfg.clock_color, bg: 'none', ground: false, scrim: false,
                                timeOnly: true, weather: weatherEntity(), music: cfg.clock_today_music, todayWeather: cfg.clock_today_weather, client: client, minutely: !ANALOG[cfg.clock_style] });
        big.scale = 0;
      }
      if (!big.scale) {
        var face = el2.querySelector('.face'), fr = face && face.getBoundingClientRect(), br = el2.getBoundingClientRect();
        if (!face || !fr.width) return null;
        // its figures: the union of what the face drew, by its ink -- its words by their letters, its pictures
        // whole (Neon's figures are words with glow inside them: taking only the innermost things measured its
        // colon, 2026-11-01) -- so its top is its figures' top, on the line the top corners' words are on
        var ink = inkOf(face, true), x0 = ink ? ink.x0 : fr.left, y0 = ink ? ink.y0 : fr.top, x1 = ink ? ink.x1 : fr.right, y1 = ink ? ink.y1 : fr.bottom;
        // (the figures 0.72 of the size, as Time Behind's are: the same size is the same time, in front or behind)
        var want = ANALOG[cfg.clock_style] ? fs * 1.9 : fs * 0.72;
        big.scale = faceScale(want, x1 - x0, y1 - y0, R.room, !!el2.querySelector('.df'));
        big.off = { x: (x0 - br.left) * big.scale, y: (y0 - br.top) * big.scale };
        big.size = { w: (x1 - x0) * big.scale, h: (y1 - y0) * big.scale };
        el2.style.width = R.room.w * big.scale + 'px';
        el2.style.height = R.room.h * big.scale + 'px';
        el2.className = 'lybig';
      }
      return { w: big.size.w, h: big.size.h, base: big.size.h * 0.86 };
    }
    // the temperature, the date, the month: drawn here, after Big Weather, Day and Month
    var d = new Date(), html;
    if (b.kind === 'temp') {
      var R2 = window.hkWxReadings, w = R2 && client ? R2.read(client, { entity: weatherEntity() }) : null;
      html = '<div style="font-size:' + fs + 'px;font-weight:600;letter-spacing:-.05em">' + deg(w && w.temp) + '</div>';
    } else if (b.kind === 'date') {
      html = '<div style="font-size:' + (fs * 0.28).toFixed(1) + 'px;font-weight:600;margin-bottom:' + (fs * 0.04).toFixed(1) + 'px">' +
        d.toLocaleDateString(undefined, { weekday: 'long' }) + '</div><div style="font-size:' + fs + 'px;font-weight:600;letter-spacing:-.04em">' + d.getDate() + '</div>';
    } else {
      var first = new Date(d.getFullYear(), d.getMonth(), 1).getDay(), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), cell = fs * 0.24, cells = '';
      for (var i = 0; i < first; i++) cells += '<span></span>';
      for (var n = 1; n <= days; n++) cells += '<span style="display:flex;align-items:center;justify-content:center;width:' + cell.toFixed(1) + 'px;height:' + (cell * 0.84).toFixed(1) + 'px;border-radius:50%' +
        (n === d.getDate() ? ';background:#e0302a;color:#fff' : '') + '">' + n + '</span>';
      html = '<div style="font-size:' + (fs * 0.16).toFixed(1) + 'px;font-weight:700;text-align:center;margin-bottom:' + (fs * 0.05).toFixed(1) + 'px">' +
        d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</div><div style="display:grid;grid-template-columns:repeat(7,auto);font-size:' + (fs * 0.09).toFixed(1) + 'px;font-weight:600">' + cells + '</div>';
    }
    if (big.html !== html) { el2.innerHTML = html; big.html = html; el2.style.left = '0px'; el2.style.top = '0px'; }
    var bh = el2.offsetHeight, bi = inkOf(el2), br2 = el2.getBoundingClientRect();
    return { w: el2.offsetWidth, h: bh, base: bh * 0.85, t: bi ? Math.max(0, bi.y0 - br2.top) : 0, b: bi ? Math.max(0, br2.bottom - bi.y1) : 0 };
  }
  // THE SCREEN'S INK (2026-11-02, the owner: "change the colors based on luminance for whatever is in the
  // background... I don't want some widgets being white and some being black on the screen at the same time"): one ink
  // for every piece -- the layout's White or Black, or Auto: dark on a light ground (a light face's, [cklight]; a
  // light photo's, by its luminance), else white
  var lyPhotoLum = null;
  function layoutInk(L) {
    var want = L.ink || 'auto';
    if (want !== 'auto') return want;
    if (host && host.hasAttribute('cknight')) return 'white';
    if (host && host.hasAttribute('cklight')) return 'black';
    var photos = mode === 'photos' && !fcShowing;
    if (photos && lyPhotoLum != null) {
      var dim = (photoOpts(cfg).dim || cfg.clock_photo_dim || 0) / 100;
      return lyPhotoLum * (1 - dim) > 0.62 ? 'black' : 'white';
    }
    return 'white';
  }
  // THE PLAN, and everything put where it says
  function layoutDraw() {
    var LM = window.hkSaverLayout, WG = window.hkSaverWidgets;
    if (!ly || !LM || !root || !cfg || !cfg.layout) return;
    var L = LM.clean(cfg.layout);
    if (!L) return;
    var R = layoutRoom(), O = LM.oriented(L, R.W, R.H), u = Math.min(R.room.w, R.room.h) / 100, zs = O.zones;
    // the screen's one ink, and its accents
    var ink = layoutInk(L);
    if (ly.layer.getAttribute('data-ink') !== ink) ly.layer.setAttribute('data-ink', ink);
    ly.layer.style.setProperty('--lay-ink', ink === 'black' ? '#161616' : '#ffffff');
    setAttr(ly.layer, 'data-acc', L.accents !== false);
    // the pieces this shape has (made once each, updated with the house)
    var want = {}, client = clientNow(), now = new Date();
    // (the photo showing: its title, and its year and date for On This Day -- only while photos show)
    var photoNow = mode === 'photos' && !fcShowing && lyPhoto ? { year: lyPhoto.year || null, date: lyPhoto.date || null } : null;
    var ctx = { title: layoutTitle(), music: client ? musicOf(musicNow(client), client) : null, photo: photoNow };
    Object.keys(zs).forEach(function (z) {
      zs[z].forEach(function (w, i) {
        // (its own size, else the row's one size: its unit, times its size)
        var k = (w.size || (z === 'row' ? O.row_size : 100) || 100) / 100, wu = u * k;
        // (its words by its own Align, else by its side: the right corners' to the screen's right edge)
        var al = w.align || (z === 'tr' || z === 'br' ? 'right' : 'left');
        var key = [z, i, w.piece, w.shape, w.back, w.color, al, w.title === false ? 'nt' : '', JSON.stringify(w.opts || {}), wu.toFixed(2)].join(':');
        want[key] = 1;
        // (a glance piece whose group's file hasn't come yet: asked for, drawn once it lands)
        if (WG && !WG.has(w.piece, w.shape)) { var gf = LM.PIECES[w.piece] && LM.PIECES[w.piece][4]; if (gf) pieceFile(gf); return; }
        if (!ly.widgets[key] && WG) {
          try {
            ly.widgets[key] = WG.create(w.piece, w.shape, { u: wu, back: w.back, color: w.color, align: al, title: w.title, h24: cfg.clock_24, weather: weatherEntity(), opts: w.opts || {} });
            if (ly.widgets[key]) ly.layer.appendChild(ly.widgets[key].el);
          } catch (e) { console.warn('[hk-saver] piece', w.piece, w.shape, e && e.message); }
        }
        var ctl = ly.widgets[key];
        if (ctl) { try { ctl.update(client, now, ctx); } catch (e) { /* its own data */ } ctl.zone = z; ctl.i = i; }
      });
    });
    // a timer running: its ring and its time each second, the pieces alone (nothing else moves)
    var live = Object.keys(ly.widgets).some(function (k) { return want[k] && ly.widgets[k].live; });
    if (live && !ly.secT) ly.secT = setInterval(function () {
      if (!ly) return;
      var h = clientNow(), t = new Date();
      Object.keys(ly.widgets).forEach(function (k) { var c = ly.widgets[k]; if (c.live) { try { c.update(h, t, { title: layoutTitle(), music: h ? musicOf(musicNow(h), h) : null }); } catch (e) { /* its own */ } } });
    }, 1000);
    else if (!live && ly.secT) { clearInterval(ly.secT); ly.secT = null; }
    Object.keys(ly.widgets).forEach(function (k) {
      if (want[k]) return;
      try { ly.widgets[k].destroy(); } catch (e) { /* gone */ }
      if (ly.widgets[k].el && ly.widgets[k].el.parentNode) ly.widgets[k].el.remove();
      delete ly.widgets[k];
    });
    // (under a slide the pieces keep their words and their places; nothing is placed until it has gone)
    layoutSlides();
    if (host.hasAttribute('lyoff')) return;
    // (the corner cards kept for the slides: hidden again once a slide has gone)
    cards.forEach(function (c) { if (!c.hasAttribute('lyhide')) c.setAttribute('lyhide', ''); });
    var widgetAt = function (z, i) {
      var hit = null;
      Object.keys(ly.widgets).forEach(function (k) { var c = ly.widgets[k]; if (c.zone === z && c.i === i) hit = c; });
      return hit;
    };
    // WHAT IS PLANNED: a piece whose condition is met (w.show: the owner's "only shows when the Mail Has Arrived"), a fact shown once (rule 5: the face, the big element or the piece placed first keeps it), and a
    // "shows when..." piece only while it shows -- ON THE TABLET IT COLLAPSES (rule 4), and the plan changes only when
    // one comes or goes; the editor's preview keeps its place, drawn dotted there ([empty])
    var claimed = LM.claims(O, cfg);
    ly.claims = claimed; ly.empty = {};
    var planned = {};
    Object.keys(zs).forEach(function (z) {
      planned[z] = [];
      zs[z].forEach(function (w, i) {
        // (gone: nothing to show, or its condition -- "only when the mail has arrived" -- not met)
        var c = widgetAt(z, i), gone = (c && (c.showing === false || c.blank)) || !LM.met(w.show, client && client.states);
        if (gone) ly.empty[z + ':' + i] = LM.idOf(w);
        // (...the editor keeps its place, dotted, where you can see it is there; any other screen, a Settings preview too,
        // closes up -- 2026-11-02, an empty title held Home Status off the bottom corners' one line in the preview's shots)
        var editing = previewOn && !!previewOver;
        // (no column without a big element of the layout's own: a Month's, or a face's that draws its own words -- the line
        // and the row wait, as the editor says)
        if ((z === 'line' || z === 'row') && (O.big.kind === 'month' || (O.big.kind === 'none' && FACE_SHOWS[cfg.show]))) { if (c) c.el.style.display = 'none'; return; }
        if (claimed[z + ':' + i] || (gone && !editing)) { if (c) c.el.style.display = 'none'; return; }
        // (in the editor's preview its place is kept, drawn by the editor's dotted outline: the piece itself draws nothing)
        if (c) { c.el.style.display = ''; c.el.style.visibility = gone ? 'hidden' : ''; }
        planned[z].push(Object.assign({}, w, { __i: i }));
      });
    });
    var OP = Object.assign({}, O, { zones: planned });
    var big = layoutBig(O.big, R, u);
    var P = LM.plan(R.room, OP, {
      big: big,
      widget: function (w, z) {
        var c = widgetAt(z, w.__i), found = c && c.measure ? c.measure() : null;
        if (found && c.el && w.shape === 'inline') {
          var r = c.el.getBoundingClientRect(), wi = r.height ? inkOf(c.el) : null;
          if (wi) { found.t = Math.max(0, wi.y0 - r.top); found.b = Math.max(0, r.bottom - wi.y1); }
        }
        // (a card: as tall as it draws, its ink inside that)
        if (found && c.el && w.shape === 'card') {
          var r2 = c.el.getBoundingClientRect();
          if (r2.height) { var ci = inkOf(c.el); found.h = r2.height; found.w = Math.max(found.w || 0, r2.width); if (ci) { found.t = Math.max(0, ci.y0 - r2.top); found.b = Math.max(0, r2.bottom - ci.y1); } }
        }
        return found;
      }
    }, { w: R.W, h: R.H });
    // (the plan's indexes are the planned pieces': back to each zone's own)
    var back = function (z, i) { return planned[z][i] ? planned[z][i].__i : i; };
    P.row.items.forEach(function (it) { it.i = back('row', it.i); });
    Object.keys(P.corners).forEach(function (z) { P.corners[z].forEach(function (bx) { bx.i = back(z, bx.i); }); });
    P.moved.forEach(function (mv) { mv.i = back(mv.zone, mv.i); });
    ly.plan = P;
    // OVER PHOTOS, its own Shadow and Outline (Clock's, ckFx: the photo under it can be anything)
    if (ly.big && ly.big.el && !ly.big.planted) {
      // (...and over the Landscape, as busy a ground as a photo: Legibility wherever the background is -- phase 13)
      var overPhotos = cfg.show === 'photos' || cfg.show === 'both' || cfg.show === 'forecast' || (cfg.show === 'clock' && (cfg.clock_bg === 'photos' || cfg.clock_bg === 'landscapes' || cfg.clock_bg === 'forecast'));
      var fx = overPhotos ? ckFx(cfg) : 'none';
      ly.big.el.style.filter = fx !== 'none' ? fx : '';
    }
    // the big element where the plan says (Planted stands where the land puts it; Behind is Time Behind's)
    if (big && P.big) {
      if (ly.big && !big.fixed) {
        if (ly.big.scale) { ly.big.el.style.left = (P.big.x - ly.big.off.x) + 'px'; ly.big.el.style.top = (P.big.y - ly.big.off.y) + 'px'; }
        else { ly.big.el.style.left = P.big.x + 'px'; ly.big.el.style.top = P.big.y + 'px'; }
        // WHERE IT IS SET, BY WHAT SHOWS (2026-11-02, the owner on 0.1.118: the time right of center over some photos,
        // the Today face with a song under it): the face is measured once, as it first drew; what it shows since --
        // another song, the weather or not, other figures -- is put back on its Align by its ink (as it was measured:
        // what flickers, Neon's letters, counted while it is out)
        if (ly.big.scale && host && host.getBoundingClientRect) {
          // (by its figures -- the lines under them needn't be even about them -- a range over all of .tm, its own text and
          // what is inside it, as inkOf looks only inside a node; a face without them, by all it draws)
          var all0 = inkOf(ly.big.el, true), fig0 = ly.big.el.querySelector('.tm'), fi0 = null;
          if (fig0 && document.createRange && /\d\D+\d/.test(fig0.textContent)) {
            var rg0 = document.createRange(); rg0.selectNodeContents(fig0);
            var fr0 = rg0.getBoundingClientRect && rg0.getBoundingClientRect();
            if (fr0 && fr0.width > 0) fi0 = { x0: fr0.left, x1: fr0.right };
          }
          var vi = fi0 || all0, hr0 = host.getBoundingClientRect(), k0 = host.offsetWidth ? hr0.width / host.offsetWidth : 1;
          if (vi && k0 > 0) {
            // (where its ink is inside its own box -- the box and the ink measured together, so a box still on its way
            // from where it was doesn't count -- then the box put so that point is on the place)
            var al = O.big.align, at = al === 'left' ? P.big.x : al === 'right' ? P.big.x + P.big.w : P.big.x + P.big.w / 2;
            var er0 = ly.big.el.getBoundingClientRect(), inside = ((al === 'left' ? vi.x0 : al === 'right' ? vi.x1 : (vi.x0 + vi.x1) / 2) - er0.left) / k0;
            var want0 = at - inside;
            if (Math.abs(want0 - parseFloat(ly.big.el.style.left)) > 0.5) ly.big.el.style.left = want0 + 'px';
            // (and its width for the next plan: a long song measured once kept the corners away from a short one)
            var vw = all0 ? (all0.x1 - all0.x0) / k0 : ly.big.size.w;
            if (ly.big.size && Math.abs(vw - ly.big.size.w) > 2) { ly.big.size.w = vw; layoutSoon(); }
          }
        }
      }
    }
    // BEHIND THE LAND (2026-11-01): the land drawn again over the big element -- its sky is clear, so what stands in the
    // sky still shows and the hills and the trees come in front -- in a box the big element's size, never the screen's
    var landOn = O.big.depth === 'behind' && O.big.kind !== 'none' && fscene && fscene.landShown && !!fscene.landShown() &&
      (cfg.show === 'forecast' || (cfg.show === 'clock' && cfg.clock_bg === 'forecast'));
    // (...where the land leaves enough of the time to read: past 35 % of its box, the time stands in front -- a phone on
    // its side hid nearly all of it under the trees, 2026-11-02)
    var landBox = landOn && P.big && ly.big ? P.big : null;
    ly.landShare = null;
    if (landBox) { var lsh = ly.landShare = landShare(landBox, R); if (lsh === undefined || lsh > TB_COVER[1]) landBox = null; }
    layoutLand(landBox, R);
    // the photos' Darken, whatever stands in front of them (Photos and Both; Clock on Photos has its own)
    var phd = (cfg.show === 'photos' || cfg.show === 'both') ? (cfg.tb_dim || 0) / 100 : 0;
    setAttr(host, 'phdim', phd > 0);
    host.style.setProperty('--ph-dim', String(phd));
    layoutCut();
    // the pieces
    var put = function (ctl, box) {
      if (!ctl || !ctl.el) return;
      if (!box) { ctl.el.style.display = 'none'; return; }
      ctl.el.style.display = '';
      ctl.el.style.left = box.x.toFixed(1) + 'px'; ctl.el.style.top = box.y.toFixed(1) + 'px';
      // (a card is as tall as it draws, and stands at its side's edge: only where it goes)
      if (ctl.shape === 'card') { ctl.el.style.width = ''; ctl.el.style.height = ''; return; }
      ctl.el.style.width = box.w.toFixed(1) + 'px'; ctl.el.style.height = box.h.toFixed(1) + 'px';
    };
    if (planned.line.length) put(widgetAt('line', planned.line[0].__i), P.line.ghost ? null : P.line);
    P.row.items.forEach(function (it) { put(widgetAt('row', it.i), it); });
    if (planned.bottom.length) put(widgetAt('bottom', planned.bottom[0].__i), P.bottom.ghost ? null : P.bottom);
    ['tl', 'tr', 'bl', 'br'].forEach(function (z) {
      (P.corners[z] || []).forEach(function (box) {
        var c = widgetAt(z, box.i);
        if (!c) return;
        // (a card on the right: its right edge on the margin, however wide it drew)
        if (c.shape === 'card' && box.x + box.w / 2 > R.W / 2 && c.el.offsetWidth) box = Object.assign({}, box, { x: box.x + box.w - c.el.offsetWidth });
        put(c, box);
      });
    });
    P.moved.forEach(function (mv) { if (mv.to === null) { var c = widgetAt(mv.zone, mv.i); if (c) put(c, null); } });
    // (the Day face's own words clear of the corner's, once the pieces are where they go)
    if (cfg.show === 'day') requestAnimationFrame(dayFit);
  }
  // BEHIND THE PHOTO'S SUBJECT, ANY FACE (2026-11-02, phase 13, phase 3; the owner: "Every clock styling option works
  // with the time both in front of the photo's subject and behind it"): the order is the photo, the face, then the
  // subject cut out of the photo over the face. Each photo layer has a twin here, after the face and before the pieces:
  // the same picture masked by its cut-out, laid out as the photo is (its fit, focus, zoom and Darken), fading with it
  // (reveal) and zooming with it (Slow Zoom). The subject comes in front only where it covers 5 to 35 % of the face's
  // own box (its ink, from the plan) -- else, on a Mosaic, or on a photo with no cut-out, the time stands in front.
  // the big element a layout asks for ('none' leaves it to a face that draws its own words: Glance, Month, the Day face)
  function layoutBigKind() {
    var L = cfg && cfg.layout, b = L && (window.hkSaverLayout ? (window.hkSaverLayout.clean(L) || {}).big : L.big);
    return (b && b.kind) || 'time';
  }
  function cutWanted() {
    if (!ly || !ly.big || !ly.plan || !ly.plan.big || !cfg || !cfg.layout) return false;
    var b = (window.hkSaverLayout ? window.hkSaverLayout.clean(cfg.layout) : cfg.layout).big || {};
    var on2 = cfg.show === 'photos' || cfg.show === 'both' || (cfg.show === 'clock' && cfg.clock_bg === 'photos' && !cfg.clock_photo_soft);
    return on2 && b.kind !== 'none' && b.depth === 'behind' && mode === 'photos' && !fcShowing && !(moState && displayLayer === moState.layer);
  }
  function layoutCut() {
    if (!ly || !root) return;
    var want = cutWanted(), layers = root.querySelectorAll('.ph');
    ly.cuts = ly.cuts || [];
    Array.prototype.forEach.call(layers, function (L0, i) {
      var tw = ly.cuts[i], ph = L0.__ph, d = ph && cleanDepth(ph.item);
      if (!want || !d || !ph.w || !ph.h) { if (tw) tw.style.display = 'none'; return; }
      if (!tw) {
        tw = ly.cuts[i] = document.createElement('div');
        tw.className = 'lycut';
        tw.appendChild(document.createElement('img'));
        tw.firstChild.alt = '';
      }
      // (shown again after a photo with no cut-out: from nothing, so it fades in -- out of display:none it would jump)
      if (tw.style.display === 'none') { tw.style.transition = 'none'; tw.classList.remove('top'); tw.style.display = ''; void tw.offsetWidth; }
      // (after the face, before the pieces)
      // (moved only when out of place: two twins each put right after the face swapped places at every draw, and an
      // element moved in the page drops its running fade -- the twins jumped to the end of every crossfade)
      if (ly.big.el.parentNode === ly.layer) {
        var after = tw.parentNode === ly.layer && (ly.big.el.compareDocumentPosition(tw) & 4), firstPc = ly.layer.querySelector(':scope > .hksw');
        if (!after || (firstPc && !(tw.compareDocumentPosition(firstPc) & 4))) ly.layer.insertBefore(tw, ly.big.el.nextSibling);
      }
      var im = tw.firstChild, m = 'url("' + d.mask + '")';
      if (im.getAttribute('src') !== ph.url) {
        im.style.setProperty('-webkit-mask-image', m); im.style.setProperty('mask-image', m);
        im.src = ph.url;
      }
      // as the photo is laid out: its fit and focus, its zoom, beside any pane
      ['--pos', '--fit', '--zm', '--org', '--zd'].forEach(function (v) { var x = L0.style.getPropertyValue(v); if (x) tw.style.setProperty(v, x); else tw.style.removeProperty(v); });
      setAttr(tw, 'pw', L0.hasAttribute('pw'));
      cutFollow(L0, tw);
      // weighed on the face's own box, where the plan put it
      var R = layoutRoomOf(), pb = ly.plan.big, pos = String(L0.style.getPropertyValue('--pos') || '50% 50%').split(/\s+/).map(function (v) { var n = parseFloat(v); return isFinite(n) ? n / 100 : 0.5; });
      var fit = L0.__fit || 'cover', g = [pb.x - R.room.x, pb.y - R.room.y, pb.w, pb.h];
      var key = [d.mask, Math.round(R.room.w), Math.round(R.room.h), fit, pos.join(' '), g.map(Math.round).join(',')].join('|');
      // (whether the subject comes in front -- known once its cut-out is weighed -- fades its picture in or out, never
      // a display that pops: the owner, 2026-11-03, "It just pops up when the transition starts")
      // (...and only once its own copy of the photo is in: a picture arriving halfway through the fade would pop too)
      var show = function () { im.style.opacity = tw.__share !== undefined && behindAt(tw.__share) && im.complete && im.naturalWidth ? '' : '0'; };
      if (!im.__shows) { im.__shows = true; im.addEventListener('load', function () { if (tw.__show) tw.__show(); }); }
      tw.__show = show;
      if (tw.__key === key && tw.__share !== undefined) { show(); return; }
      // (a new photo starts unseen; the same photo weighed again -- the time's box changed with its figures at the turn
      // of a minute -- stays as it is until it is known: the owner, 2026-11-03, "when the time changes... it pops out in
      // front of the face and then the faces fades back over it")
      var samePhoto = tw.__mask === d.mask && tw.__share !== undefined;
      tw.__key = key; tw.__mask = d.mask;
      if (!samePhoto) { tw.__share = undefined; im.style.transition = 'none'; im.style.opacity = '0'; void im.offsetWidth; im.style.transition = ''; }
      tbShare(d.mask, drawnRect(ph.w, ph.h, R.room.w, R.room.h, fit, pos[0], pos[1] == null ? 0.5 : pos[1]), g, key, function (share) {
        if (tw.__key !== key) return;
        tw.__share = share;
        show();
      });
    });
  }
  // a twin follows its photo's layer: shown with it, fading as it fades (the same transition), zooming as it zooms.
  // THE CROSSFADE (2026-11-03, the owner's recordings: the outgoing people stayed solid over the time while the rest
  // of the screen changed, then vanished): the incoming photo fades in over the outgoing one, which stays opaque under
  // it -- but the twins are both over the face, so the outgoing one fades out as the incoming one fades in, at its pace
  function cutFollow(L0, tw) {
    if (!tw) return;
    var cur = displayLayer && displayLayer.classList && displayLayer.classList.contains('ph') ? displayLayer : null;
    tw.style.transition = (cur || L0).style.transition;
    // (no z-index of its photo's: its place in the layer -- after the face, before the pieces -- is its height)
    if (L0.classList.contains('zoom') !== tw.classList.contains('zoom')) {
      if (L0.classList.contains('zoom')) { void tw.offsetWidth; tw.classList.add('zoom'); } else tw.classList.remove('zoom');
    }
    tw.classList.toggle('top', cur ? L0 === cur : L0.classList.contains('top'));
  }
  function cutsFollow() {
    if (!ly || !ly.cuts || !root) return;
    Array.prototype.forEach.call(root.querySelectorAll('.ph'), function (L0, i) { cutFollow(L0, ly.cuts[i]); });
  }
  function landShare(box, R) {
    var file = fscene && fscene.landShown && fscene.landShown();
    if (!file) return undefined;
    var key = [file, Math.round(R.W), Math.round(R.H), Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)].join('|');
    if (key in landShares) return landShares[key];
    landShares[key] = undefined;
    if (typeof Image === 'undefined') { landShares[key] = null; return null; }
    var img = new Image();
    img.onload = function () {
      var share = null;
      try {
        var k = Math.max(R.W / 2560, R.H / 1600), aw = 2560 * k, ah = 1600 * k, ax = (R.W - aw) / 2, ay = R.H - ah;
        var cw = 96, ch = Math.max(8, Math.round(cw * box.h / Math.max(1, box.w))), s2 = cw / Math.max(1, box.w);
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        var x = cv.getContext('2d');
        x.drawImage(img, (ax - box.x) * s2, (ay - box.y) * s2, aw * s2, ah * s2);
        share = coverShare(x.getImageData(0, 0, cw, ch).data);
      } catch (e) { share = null; }
      landShares[key] = share;
      layoutSoon();
    };
    img.onerror = function () { landShares[key] = null; };
    img.src = '/hk/sky/' + file;
    return undefined;
  }
  function layoutLand(box, R) {
    if (!box) { if (ly.land) { ly.land.remove(); ly.land = null; } return; }
    if (!ly.land) { ly.land = document.createElement('div'); ly.land.className = 'lyland'; }
    if (ly.big && ly.big.el && ly.land.previousSibling !== ly.big.el) ly.layer.insertBefore(ly.land, ly.big.el.nextSibling);
    // (where hk-sky.js's .land draws it: cover, center bottom, of the 2560 x 1600 art)
    var k = Math.max(R.W / 2560, R.H / 1600), aw = 2560 * k, ah = 1600 * k, ax = (R.W - aw) / 2, ay = R.H - ah, pad = 4;
    var sky = root.querySelector('#hk-sky'), b = sky ? (sky.style.getPropertyValue('--landB') || '1') : '1';
    var st = ly.land.style;
    st.left = (box.x - pad) + 'px'; st.top = (box.y - pad) + 'px'; st.width = (box.w + 2 * pad) + 'px'; st.height = (box.h + 2 * pad) + 'px';
    st.backgroundImage = 'url("/hk/sky/' + fscene.landShown() + '")';
    st.backgroundSize = aw + 'px ' + ah + 'px';
    st.backgroundPosition = (ax - box.x + pad) + 'px ' + (ay - box.y + pad) + 'px';
    st.filter = 'brightness(' + b + ')';
  }
  // the photo's title, for the Photo Title widget: the album and the year, as Titles drew them
  var lyPhoto = null;
  function layoutTitle() {
    var it = lyPhoto || {};
    return [it.album, it.year].filter(function (x) { return x; }).join(' \u00b7 ');
  }

  // ------------------------------------------------------------ the clocks
  // SHOW: CLOCK (2026-10-13): a full-screen clock (hk-saverclock.js, loaded
  // only now) over a background of its own -- or over the forecast (its sky
  // and land, the details along the bottom as set), or over the photos
  // turned into their blurred, dimmed copies ([ckphotos]: the cheap copy,
  // never a blur on the full photo). The corner cards stay: weather, what's
  // playing, the timers and Home Status, each as Over the Clock says.
  var ckCtl = null, ckLoad = null, ckRun = 0, ckArgs = null;
  function ckPhotos() { return !!(host && host.hasAttribute('ckphotos')); }
  function clockModule() {
    if (window.hkSaverClock) return Promise.resolve(window.hkSaverClock);
    if (!ckLoad) {
      // (/hk/ revalidates: a changed file is fetched afresh, as the
      // loader's modules are)
      ckLoad = import('/hk/modules/hk-saverclock.js').then(function () { return window.hkSaverClock; })
        .catch(function (e) { ckLoad = null; console.warn('[hk-saver] clock', e && e.message); return null; });
    }
    return ckLoad;
  }
  function enterClock() {
    var bgk = cfg.clock_bg;
    host.setAttribute('ckmode', '');
    // GLANCE, MONTH, DAY: a whole screen of their own, as Show: Clock on a background of its own
    if (FACE_SHOWS[cfg.show]) {
      mode = 'clock';
      host.setAttribute('ckgen', '');
      host.setAttribute('ckface', cfg.show);
      updateBand();
      mountClock('face');
      return;
    }
    if (bgk === 'forecast' || bgk === 'skyonly') { enterForecast(); mountClock('none'); return; }
    if (bgk === 'photos' || bgk === 'landscapes') {
      host.setAttribute('ckphotos', '');
      setAttr(host, 'cksoft', !!cfg.clock_photo_soft);
      host.style.setProperty('--hk-ckdim', String((cfg.clock_photo_dim || 0) / 100));
      updateBand(); showNext(true); mountClock('none', true); return;
    }
    mode = 'clock';
    host.setAttribute('ckgen', '');
    updateBand();
    mountClock(bgk);
  }
  // the clock's layer, under the corner cards; `dimmed`: over the photos'
  // blurred copies, which need no scrim of their own
  function mountClock(bg, dimmed) {
    if (!root) return;
    // (a layout draws its own time: over the photos or the forecast there is nothing of the clock's to draw)
    if (cfg && cfg.layout && bg === 'none') return;
    ckArgs = [bg, dimmed];
    var run = ++ckRun, layer = document.createElement('div');
    layer.className = 'ck';
    // OVER PHOTOS, the clock's text stands out by its own Shadow and Outline
    if (ckPhotos() || cfg.show === 'photos' || cfg.show === 'both') {
      var fx = ckFx(cfg);
      if (fx !== 'none') layer.style.filter = fx;
    }
    root.insertBefore(layer, root.querySelector('.lay') || root.querySelector('.info'));
    var face = bg === 'face';
    Promise.all([clockModule(), face ? facesModule() : null]).then(function (got) {
      var C = got[0], F = got[1];
      if (run !== ckRun || !on || !layer.isConnected) return;
      if (!C || (face && !F)) { layer.remove(); if (mode === 'clock') { mode = 'photos'; host.removeAttribute('ckgen'); host.removeAttribute('ckface'); enterForecast(); } return; }
      ckCtl = face
        ? F.mount(layer, { kind: cfg.show, h24: cfg.clock_24, weather: weatherEntity(), look: cfg.day_look, clocks: C, client: clientNow(), groundOnly: !!cfg.layout && layoutBigKind() !== 'none' })
        : C.mount(layer, { style: cfg.clock_style, options: cfg.clock_options, h24: cfg.clock_24, music: cfg.clock_today_music, todayWeather: cfg.clock_today_weather, color: cfg.clock_color, bg: bg, motion: cfg.clock_motion, face: !cfg.layout,
                           speed: cfg.clock_speed, depth: cfg.clock_depth, weather: weatherEntity(),
                           // a Wallpaper: its night version while the sun is down, as the dashboard's After Sunset
                           wallpaper: bg === 'wallpaper' ? { id: cfg.clock_wallpaper, color: cfg.clock_wallpaper_color, night: sunDown() } : null,
                           // (a face with a ground of its own keeps it off over the photos or the forecast)
                           ground: bg !== 'none',
                           client: clientNow(), scrim: !dimmed });
      // a light face (Month, the Day face's light look): the corners' words go dark on it
      if (host && face) setAttr(host, 'cklight', faceLight(F));
      // (the Day face clear of the corner: once its words and the corner's are drawn)
      if (face && cfg.show === 'day') { requestAnimationFrame(dayFit); setTimeout(dayFit, 600); setTimeout(dayFit, 2000); }
      // TODAY carries its own weather and music: the corners' step aside
      if (host) setAttr(host, 'ckown', cfg.clock_style === 'today');
      nightCheck();
      if (!nightT) nightT = setInterval(nightCheck, 30000);
      // Show: Clock on a background of its own: there is something to show
      if (mode === 'clock' && entrance) entrance();
    });
  }
  // whether the face on screen has a light ground, by its luminance (hkSaverFaces inkFor): dark ink in the corners
  function faceLight(F) {
    var X = F && F._;
    return !!(cfg && FACE_SHOWS[cfg.show] && X && X.inkFor && X.inkFor(cfg.show, cfg.day_look, new Date()) === 'dark');
  }
  function slidesAgain() {
    if (muShowing) { musicParts(slideView(), cfg.music_hide); layoutMusic(); }
    if (scn && slideNow()) cornerDraw(slideNow());
    return true;
  }
  function remountClock() {
    var laid = !!ly;
    if (laid) { layoutDraw(); layoutSoon(); }
    if (!ckArgs || !root || !root.querySelector('.ck')) return laid;
    var a = ckArgs;
    ckRun++;
    if (ckCtl) { try { ckCtl.destroy(); } catch (e) { /* gone */ } ckCtl = null; }
    root.querySelectorAll('.ck').forEach(function (n) { n.remove(); });
    mountClock(a[0], a[1]);
    return true;
  }
  // NIGHT MODE (2026-10-13): StandBy's -- in the dark, the clock and its
  // corners a dim red on black. Always, or At Night (from .. to, across
  // midnight). Nothing behind the clock is drawn meanwhile (the photos, the
  // forecast and its background hidden; ckCtl.night holds the painter).
  var nightT = null;
  var nightPreview = null;           // the editor's Day / Night (previewNight): null follows the clock
  function nightNow(d, c) {
    c = c || cfg;
    if (previewOn && nightPreview !== null) return nightPreview;
    if (!c || c.clock_night === 'off') return false;
    if (c.clock_night === 'always') return true;
    d = d || new Date();
    var m = d.getHours() * 60 + d.getMinutes(), a = minsOf(c.clock_night_from), b = minsOf(c.clock_night_to);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }
  function nightCheck() {
    if (!host) return;
    // (a layout's too: over the photos or the Landscape there is no clock of the clock's own, and Night Mode did
    // nothing -- phase 13)
    var dark = !!((ckCtl || ly) && on) && nightNow();
    setAttr(host, 'cknight', dark);
    // (the Day face by the time of day: the corners' words follow its light and dark)
    if (cfg && window.hkSaverFaces && host.hasAttribute('ckface')) setAttr(host, 'cklight', faceLight(window.hkSaverFaces));
    dayFit();
    // (...but in the editor's preview Night leaves a slide shown with See a Slide where it is)
    if (dark && exKind && !previewOn) exHide();
    if (ckCtl && ckCtl.night) ckCtl.night(dark);
  }
  // THE DAY FACE AND THE CORNER (2026-10-31): where the corner's words (the time, the date, the weather) would meet
  // the day's name or its date -- a screen held upright, a phone, a long day's name -- both move down, clear of
  // them (--hk-day-push on the screensaver, the face's .wd and .dn translated by it). Measured from the words
  // themselves, not their boxes (the corner's column is wider than what it says): when the face is put up, on a
  // resize, and with the minute (a wider time)
  function cornerInk(withStatus) {
    var info = root && root.querySelector('.info'), box = null;
    if (!info) return null;
    // (the corner's words: the old cards', or a layout's pieces at the top -- phase 13, the Day face drawn with a layout)
    var lay = root.querySelector('.lay'), H = (host && host.clientHeight) || window.innerHeight || 800;
    var pieces = lay ? [].filter.call(lay.querySelectorAll('.hksw.p-time, .hksw.p-weather' + (withStatus ? ', .hksw.p-status' : '')), function (e) {
      var r = e.getBoundingClientRect(); return r.height > 0 && r.top < H / 2 && getComputedStyle(e).display !== 'none';
    }) : [];
    [].forEach.call(info.querySelectorAll(':scope > hk-clock-card, :scope > hk-weather-strip-card' + (withStatus ? ', :scope > hk-screensaver-status-card' : '')), function (card) { pieces.push(card); });
    pieces.forEach(function (card) {
      if (getComputedStyle(card).display === 'none') return;
      var walk = function (n) {
        if (n.nodeType === 3) {
          if (!n.textContent.trim()) return;
          var rg = document.createRange(); rg.selectNodeContents(n);
          var r = rg.getBoundingClientRect();
          if (r.width > 0) box = box ? { l: Math.min(box.l, r.left), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) } : { l: r.left, r: r.right, b: r.bottom };
          return;
        }
        [].forEach.call(n.childNodes || [], walk);
      };
      walk(card.shadowRoot || card);
    });
    return box;
  }
  function dayFit() {
    if (!host || !root || !on || !cfg || cfg.show !== 'day' || !host.hasAttribute('ckface')) return;
    var wd = root.querySelector('.ck .hkf.day .wd'), dn = root.querySelector('.ck .hkf.day .dn');
    if (!wd || !dn) return;
    var px = function (k) { return parseFloat(host.style.getPropertyValue(k)) || 0; };
    var curW = px('--hk-day-push'), curD = px('--hk-day-push-dn'), sc = px('--hk-day-scale') || 1;
    // ON A PHONE Home Status has no room beside the corner's time ("Disarme..." drawn over it): under its words,
    // the corner's own margin, as wide as the phone, at a phone's size -- and the day measured against all of it
    var phone = (window.innerWidth || 0) < 600 && !paneUp, words = phone ? cornerInk() : null;
    if (phone && words) host.style.setProperty('--hk-ss-status-top', Math.round(words.b + 8) + 'px');
    else if (!paneUp) host.style.removeProperty('--hk-ss-status-top');
    var ink = cornerInk(phone);
    // the day's name and the date as laid out, before any push or scale (the date is scaled from its top centre);
    // the date's figures, not its line: set at a line-height of 1, they run from a fifth of its box to 85 % of it
    var w = textBox(wd), d = textBox(dn);
    if (!w || !d) return;
    var wTop = w.top - curW, wBot = w.bottom - curW, cx = (d.left + d.right) / 2, dW = d.width / sc, dH = d.height / sc;
    var dTop = d.top - curD, dL = cx - dW / 2, dR = cx + dW / 2, gTop = dTop + dH * 0.2;
    var across = function (l, r) { return ink && l < ink.r + DAY_GAP && r > ink.l - DAY_GAP; };
    // the day's name below the corner's words where they meet; the date below them, and below the day's name
    var pushW = across(w.left, w.right) && wTop < ink.b + DAY_GAP ? Math.ceil(ink.b + DAY_GAP - wTop) : 0;
    var face = root.querySelector('.ck .hkf.day'), foot = face ? face.getBoundingClientRect().bottom : (window.innerHeight || 0);
    var pk = root.querySelector('.ck .hkf.day .art .pk'), pr = pk && pk.getBoundingClientRect();
    // ...and where that takes its foot off the face, or (moved) onto the pumpkin under it, the date smaller -- never
    // under half its size. Smaller from its top, its figures start higher: settled together, twice over.
    var pushD = 0, scale = 1;
    for (var pass = 0; pass < 3; pass++) {
      var g = dH * 0.2 * scale;
      pushD = Math.max(0, across(dL, dR) && dTop + g < ink.b + DAY_GAP ? Math.ceil(ink.b + DAY_GAP - dTop - g) : 0,
                       Math.ceil(wBot + pushW + DAY_GAP - dTop - g));
      var fb = foot;
      if (pushD > 0 && pr && pr.width && pr.left < dR && pr.right > dL && pr.top > dTop + pushD) fb = Math.min(fb, pr.top + pr.height * 0.1);
      var room = fb - DAY_GAP - (dTop + pushD), need = dH * 0.85;
      scale = need > room && need > 0 ? Math.max(0.5, Math.round(room / need * 100) / 100) : 1;
    }
    var put = function (k, v, none) { if (v === none) host.style.removeProperty(k); else host.style.setProperty(k, String(v) + (k === '--hk-day-scale' ? '' : 'px')); };
    if (pushW !== curW) put('--hk-day-push', pushW, 0);
    if (pushD !== curD) put('--hk-day-push-dn', pushD, 0);
    if (scale !== sc) put('--hk-day-scale', scale, 1);
  }
  function leaveClock() {
    ckArgs = null;
    if (nightT) { clearInterval(nightT); nightT = null; }
    if (host) { host.removeAttribute('cknight'); host.removeAttribute('ckown'); host.removeAttribute('ckface'); host.removeAttribute('cklight');
      if (host.style.removeProperty) ['--hk-day-push', '--hk-day-push-dn', '--hk-day-scale'].concat(paneUp ? [] : ['--hk-ss-status-top']).forEach(function (k) { host.style.removeProperty(k); }); }
    ckRun++;
    if (ckCtl) { try { ckCtl.destroy(); } catch (e) { /* gone */ } ckCtl = null; }
    if (root) root.querySelectorAll('.ck').forEach(function (n) { n.remove(); });
    if (host) { host.removeAttribute('ckmode'); host.removeAttribute('ckgen'); host.removeAttribute('ckphotos'); host.removeAttribute('cksoft'); }
    if (mode === 'clock') mode = 'photos';
  }
  // the whole screensaver: no photos, or Show: Forecast
  function enterForecast() {
    if (mode === 'forecast' || !root) return;
    mode = 'forecast';
    fcShowing = false;
    if (slideT) { clearTimeout(slideT); slideT = null; }
    host.removeAttribute('fcslide');
    host.setAttribute('forecast', '');
    buildForecast();
    bigWeather();
    updateBand();
    forecastTick(true);
    reveal(root.querySelector('.fc'), true);
    if (entrance) entrance();
    // music already playing: its slide, over the forecast
    if (takeover()) setTimeout(function () { mus.watchAt = 0; musicWatch(); }, 0);
  }
  // one slide among the photos (Photos & Forecast)
  function showForecastSlide() {
    if (!on || !root || mode === 'forecast') return;
    buildForecast();
    bigWeather();
    fcShowing = true; sinceFc = 0; lastSlide = 'forecast';
    host.setAttribute('fcslide', '');
    updateBand();
    forecastTick(true);
    reveal(root.querySelector('.fc'), false);
    layoutSoon();
  }
  function hideForecastSlide() {
    if (!fcShowing) return;
    fcShowing = false;
    if (host) host.removeAttribute('fcslide');
    updateBand();
    forecastTick(false);
    layoutSoon();
  }
  function leaveForecast() {
    bigRun++;
    if (bigCtl) { try { bigCtl.destroy(); } catch (e) { /* gone with the element */ } bigCtl = null; }
    if (host) { host.removeAttribute('fcbig'); host.removeAttribute('fcn'); }
    if (fTick) { clearInterval(fTick); fTick = null; }
    if (fscene) { try { fscene.destroy(); } catch (e) { /* gone with the element */ } fscene = null; }
    fSky = null;
    if (fband) cards = cards.filter(function (c) { return c !== fband; });
    fband = null; fSig = ''; mode = 'photos'; fcShowing = false; sinceFc = 0;
  }
  function resetForecast() {
    if (fadeDone) fadeDone();
    // A host reused from a stop that had not yet torn it down still has its
    // last photo on top: hand it to the first reveal as the outgoing view, so
    // that reveal un-tops and empties it rather than leaving it opaque over
    // the new photo (or under the forecast, decoded, for the whole session).
    var last = root && root.querySelectorAll('.ph')[layer];
    displayLayer = last && last.classList.contains('top') ? last : null;
    leaveForecast();
    if (root) root.querySelectorAll('.fc,.fcb').forEach(function (n) { n.remove(); });
    // the slide goes with the forecast's layers; the pane's music stays with the pane
    dropView(slideView());
    muShowing = false; lastSlide = '';
    if (host) host.removeAttribute('muslide');
    if (host) {
      host.removeAttribute('forecast'); host.removeAttribute('fcslide'); host.removeAttribute('band'); host.removeAttribute('bandph');
      if (host.style.removeProperty) host.style.removeProperty('--hk-ss-corner-bottom');
    }
  }
  // ------------------------------------------------------------ home energy
  // HOME ENERGY (2026-10-14, hk-saver-energy.js, loaded only now): today so
  // far against a usual day, the Energy page's own numbers. ONE LAYER OVER
  // WHAT IS THERE (.en, above the clock, under the corner cards), faded in
  // over it -- the photo, the forecast, the clock all stay opaque beneath,
  // so no hand-off ever passes through black. Behind its text: the photo's
  // blurred copy, the sky held still and darkened, or (over a clock's own
  // background) a gradient of its own. The rings draw once it has arrived.
  var enCtl = null, enLoad = null, enShowing = false, enT = null, enRun = 0;
  function energyModule() {
    if (window.hkSaverEnergy) return Promise.resolve(window.hkSaverEnergy);
    if (!enLoad) {
      enLoad = import('/hk/modules/hk-saver-energy.js').then(function () { return window.hkSaverEnergy; })
        .catch(function (e) { enLoad = null; console.warn('[hk-saver] energy', e && e.message); return null; });
    }
    return enLoad;
  }
  // at the start: the module, the Energy page's code, and the numbers asked
  // for -- so its first turn has them. `hold` (HK Settings' preview of Home
  // Energy): shown as soon as they are here, and kept up
  function energyPrep() {
    var run = ++enRun, hold = previewOn && (previewEnergy || previewSelected === 'energy');
    if (!cfg || (!cfg.energy_slide && !hold)) return;
    energyModule().then(function (X) { return X ? X.ready().then(function () { return X; }) : null; }).then(function (X) {
      if (!X || run !== enRun || !on || !root || !cfg || (!cfg.energy_slide && !hold)) return;
      // in its place at the start, as the weather's: put in at its first
      // turn, its layer was made as it came in (2026-10-19)
      if (!enCtl) {
        enCtl = X.create({ hide: cfg.energy_hide, h24: cfg.clock_24, corner: false });
        root.insertBefore(enCtl.el, root.querySelector('.info'));
      } else enCtl.setHide(cfg.energy_hide);
      enCtl.ready(clientNow());
      landImg();                         // (the landscape's image asked for now: its blurred copy ready at the first turn)
      if (!hold) return;
      var tries = 0, show = function () {
        if (run !== enRun || !on || enShowing || !previewOn || (!previewEnergy && previewSelected !== 'energy')) return;
        // (at once: the preview is shown again after every change)
        if (showEnergySlide(true)) { exKind = 'energy'; return; }
        if (++tries < 60) setTimeout(show, 500);
      };
      show();
    });
  }
  function energyReady() { return !!(enCtl && enCtl.ready(clientNow())); }
  // the photo on screen, for its blurred copy (a mosaic: its first cell)
  function curImg() {
    var L = displayLayer;
    if (!L || !L.classList.contains('ph')) return null;
    var im = L.querySelector('img.fg');
    if (!L.classList.contains('mo') && im && im.getAttribute('src') && im.naturalWidth) return im;
    var c = L.querySelector('.mocell canvas');
    return c && c.width ? c : null;
  }
  function energyLook() {
    if (mode === 'photos' && curImg()) return 'photo';
    if (mode === 'forecast' || fcShowing) return landImg() ? 'land' : 'sky';
    return 'plain';
  }
  // OVER THE FORECAST, ITS LANDSCAPE BLURRED (2026-10-31, the owner: Home Energy over the forecast "doesn't blur the
  // forecast backdrop" -- the big temperature and the details read through its dark wash): the season's landscape on
  // screen drawn small, as a photo's blurred copy is, its foot at the foot (hk-sky.js .land: cover, center bottom).
  // Its image is the one the sky shows, from the browser's cache; until it has loaded (or under Flat, which draws no
  // copies), the darkened sky as before.
  /** @type {any} */ var landIm = null;
  function landImg() {
    if (isFlat() || !root) return null;
    var i = root.querySelector('.fc .land>i.on'), m = i && /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(i).backgroundImage || '');
    if (!m) return null;
    if (!landIm || landIm.hkSrc !== m[1]) { landIm = new Image(); landIm.hkSrc = m[1]; landIm.src = m[1]; }
    return landIm.complete && landIm.naturalWidth ? landIm : null;
  }
  // ...and the sky over it, as it is now: the art's top is transparent (the live sky shows through it), so its copy
  // alone left the sky, its clouds and Big Weather's words sharp above the land (2026-10-31, the owner: "only half
  // blurred"). The sky's own four stops, where a landed sky puts them (hk-sky.js .own.landed .grad)
  function skyStops() {
    var k = root && root.querySelector('.fc #hk-sky'), cs = k && getComputedStyle(k), out = [];
    if (!cs) return out;
    [0, 0.24, 0.44, 0.62].forEach(function (at, i) { var v = cs.getPropertyValue('--sk' + i).trim(); if (v) out.push([at, v]); });
    if (out.length) out.push([1, out[out.length - 1][1]]);
    return out;
  }
  // ITS ROOM: beside the pane (it tells the time itself, top left)
  function energyLayout() {
    if (!enCtl || !root || !host) return;
    enCtl.layout((window.innerWidth || 0) - (paneUp ? paneW : 0), window.innerHeight || 0);
  }
  // HOME ENERGY'S OR THE WEATHER'S LAYER, just under the corner cards: only
  // the other of the two between them (they never show at once). Moved only
  // when something else is -- a node moved is drawn again, its layers and
  // the whole sky in it made again (2026-10-19: the weather's moved under
  // Home Energy's at every other turn, and Home Energy's under the weather's)
  function underCards(el, info) {
    if (!info || el.parentNode !== root) return false;
    for (var n = el.nextSibling; n; n = n.nextSibling) {
      if (n === info) return true;
      if (!n.classList || !(n.classList.contains('en') || n.classList.contains('wx'))) return false;
    }
    return false;
  }
  function showEnergySlide(first) {
    if (!on || !root || !host || enShowing || !enCtl) return false;
    var h = clientNow(), info = root.querySelector('.info');
    if (!enCtl.ready(h)) return false;
    // above whatever came after it (a clock mounted again), under the corner cards
    if (!underCards(enCtl.el, info)) root.insertBefore(enCtl.el, info);
    var look = energyLook(), img = look === 'photo' ? curImg() : look === 'land' ? landImg() : null;
    // (the landscape's blurred copy is drawn as a photo's is, its foot at the foot)
    var foot = look === 'land' ? 1 : 0.5;
    if (look === 'land') look = 'photo';
    var sky = foot === 1 ? skyStops() : null;
    if (!enCtl.draw(h, look, img ? function (c) { drawBackdrop(c, img, BACKDROP_SMALL, foot, sky); } : null)) return false;
    enShowing = true; sinceFc = 0; lastSlide = 'energy';
    host.setAttribute('enslide', '');
    updateBand();
    forecastTick(false);                 // the forecast's sky holds still under it
    energyLayout();
    var el = enCtl.el, run = photoRun;
    el.style.setProperty('--hk-en-fade', (first ? 0 : CROSSFADE_MS) + 'ms');
    void el.offsetWidth;
    el.classList.add('on');
    if (enT) clearTimeout(enT);
    enT = setTimeout(function () { enT = null; if (on && run === photoRun && enShowing && enCtl) enCtl.arrived(); }, first ? 50 : CROSSFADE_MS);
    if (first && entrance) entrance();
    return true;
  }
  function hideEnergySlide() {
    if (!enShowing) return;
    enShowing = false;
    if (enT) { clearTimeout(enT); enT = null; }
    if (host) host.removeAttribute('enslide');
    if (enCtl) {
      enCtl.leave();
      enCtl.el.style.setProperty('--hk-en-fade', CROSSFADE_MS + 'ms');
      enCtl.el.classList.remove('on');
    }
    updateBand();
    if (fcVisible()) forecastTick(true);
  }
  function leaveEnergy() {
    enRun++;
    if (enT) { clearTimeout(enT); enT = null; }
    enShowing = false;
    if (enCtl) { try { enCtl.destroy(); } catch (e) { /* gone */ } enCtl = null; }
    if (host) host.removeAttribute('enslide');
  }

  // ------------------------------------------------------------ the weather
  // WEATHER (2026-10-14, hk-saver-weather.js, loaded only now): today's
  // weather at a glance over the Live Sky (Sky Only), laid out as Home
  // Energy is. The same kind of layer (.wx, above the clock, under the
  // corner cards), opaque -- its own sky -- faded in over what is there.
  var wxCtl = null, wxLoad = null, wxShowing = false, wxT = null, wxRun = 0;
  function weatherModule() {
    if (window.hkSaverWeather) return Promise.resolve(window.hkSaverWeather);
    if (!wxLoad) {
      wxLoad = import('/hk/modules/hk-saver-weather.js').then(function () { return window.hkSaverWeather; })
        .catch(function (e) { wxLoad = null; console.warn('[hk-saver] weather', e && e.message); return null; });
    }
    return wxLoad;
  }
  // at the start: the module, its forecast asked for and its sky readied;
  // HK Settings' preview of Weather holds it up
  function weatherPrep() {
    var run = ++wxRun, hold = previewOn && (previewWeather || previewSelected === 'weather');
    if (!cfg || (!cfg.weather_slide && !hold)) return;
    weatherModule().then(function (X) {
      if (!X || run !== wxRun || !on || !root || !cfg || (!cfg.weather_slide && !hold)) return;
      if (!wxCtl) {
        wxCtl = X.create({ hide: cfg.weather_hide, h24: cfg.clock_24, corner: false });
        root.insertBefore(wxCtl.el, root.querySelector('.info'));
      } else wxCtl.setHide(cfg.weather_hide);
      // (its room known before it is first drawn, unseen: ready)
      weatherLayout();
      wxCtl.ready(clientNow());
      if (!hold) return;
      var tries = 0, show = function () {
        if (run !== wxRun || !on || wxShowing || !previewOn || (!previewWeather && previewSelected !== 'weather')) return;
        if (showWeatherSlide(true)) { exKind = 'weather'; return; }
        if (++tries < 60) setTimeout(show, 500);
      };
      show();
    });
  }
  function weatherReady() { return !!(wxCtl && wxCtl.ready(clientNow())); }
  function weatherLayout() {
    if (!wxCtl || !root || !host) return;
    wxCtl.layout((window.innerWidth || 0) - (paneUp ? paneW : 0), window.innerHeight || 0);
  }
  function showWeatherSlide(first) {
    if (!on || !root || !host || wxShowing || !wxCtl) return false;
    var h = clientNow(), info = root.querySelector('.info');
    if (!wxCtl.ready(h)) return false;
    if (!underCards(wxCtl.el, info)) root.insertBefore(wxCtl.el, info);
    weatherLayout();
    if (!wxCtl.draw(h)) { wxCtl.leave(); return false; }
    wxShowing = true; sinceFc = 0; lastSlide = 'weather';
    host.setAttribute('wxslide', '');
    updateBand();
    forecastTick(false);                 // the forecast's own sky holds still under it
    weatherLayout();
    var el = wxCtl.el, run = photoRun;
    el.style.setProperty('--hk-wx-fade', (first ? 0 : CROSSFADE_MS) + 'ms');
    void el.offsetWidth;
    el.classList.add('on');
    if (wxT) clearTimeout(wxT);
    wxT = setTimeout(function () { wxT = null; if (on && run === photoRun && wxShowing && wxCtl) wxCtl.arrived(); }, first ? 50 : CROSSFADE_MS);
    if (first && entrance) entrance();
    return true;
  }
  function hideWeatherSlide() {
    if (!wxShowing) return;
    wxShowing = false;
    if (wxT) { clearTimeout(wxT); wxT = null; }
    if (host) host.removeAttribute('wxslide');
    if (wxCtl) {
      wxCtl.el.style.setProperty('--hk-wx-fade', CROSSFADE_MS + 'ms');
      wxCtl.el.classList.remove('on');
      // its sky held still once it has faded
      var c = wxCtl;
      setTimeout(function () { if (c === wxCtl && !wxShowing) c.leave(); }, CROSSFADE_MS + 100);
    }
    updateBand();
    if (fcVisible()) forecastTick(true);
  }
  function leaveWeather() {
    wxRun++;
    if (wxT) { clearTimeout(wxT); wxT = null; }
    wxShowing = false;
    if (wxCtl) { try { wxCtl.destroy(); } catch (e) { /* gone */ } wxCtl = null; }
    if (host) host.removeAttribute('wxslide');
  }

  // ------------------------------------------------------------ additional screens
  // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, one
  // every extra_every minutes for extra_for seconds -- the forecast (Show:
  // Clock), the music (only while it plays) and Home Energy, taking turns.
  // None while the music holds the screen, in the clock's Night Mode, under
  // the black, or on a hidden page; the timer just goes round again.
  var exT = null, exKind = '', exLast = '', exOutT = null;
  function exArm() {
    if (exT) { clearTimeout(exT); exT = null; }
    if (!on || !cfg || previewOn || !extrasOf(cfg).length) return;
    var run = photoRun, wait = cfg.extra_every * 60000;
    if (previewOn) wait = Math.min(wait, EX_PREVIEW_MS);
    exT = setTimeout(function () { exT = null; if (on && run === photoRun) exNext(); }, wait);
  }
  function exNext() {
    var run = photoRun;
    var held = document.hidden || pnl || black() || exKind || (host && host.hasAttribute('cknight')) || (muShowing && takeover());
    var kind = held ? null : turnOf(EXTRA_ORDER, extrasOf(cfg).filter(function (k) {
      return k === 'music' ? musicPlaying() : k === 'energy' ? energyReady() : k === 'weather' ? weatherReady() : true;
    }), exLast);
    if (kind && exShow(kind)) {
      exT = setTimeout(function () { exT = null; if (on && run === photoRun) { exHide(); exArm(); } }, cfg.extra_for * 1000);
      return;
    }
    exArm();
  }
  function exShow(kind) {
    var ok = kind === 'energy' ? showEnergySlide() : kind === 'weather' ? showWeatherSlide() : kind === 'music' ? showMusicSlide() : kind === 'forecast' ? showForecastExtra() : false;
    if (ok) { exKind = kind; exLast = kind; }
    return ok;
  }
  function exHide() {
    var kind = exKind;
    exKind = '';
    if (kind === 'energy') hideEnergySlide();
    else if (kind === 'weather') hideWeatherSlide();
    else if (kind === 'music') { if (muShowing && !takeover()) hideMusicSlide(); else return; }
    else if (kind === 'forecast') hideForecastExtra();
    else return;
    // the photos behind the clock: their layer was emptied as the screen
    // came over it, so the next photo comes in
    if (kind !== 'energy' && kind !== 'weather' && mode === 'photos') showNext(false);
  }
  // THE FORECAST AS AN ADDITIONAL SCREEN (Show: Clock): under a clock's own
  // background it is put there at once and the clock fades off it; over
  // the photos it fades in as the forecast slide does
  function showForecastExtra() {
    if (!on || !root || !host || mode === 'forecast') return false;
    var gen = mode === 'clock';
    buildForecast();
    bigWeather();
    if (exOutT) { clearTimeout(exOutT); exOutT = null; }
    host.removeAttribute('fcout');
    fcShowing = true;
    host.setAttribute('fcslide', '');
    updateBand();
    forecastTick(true);
    reveal(root.querySelector('.fc'), gen);
    return true;
  }
  function hideForecastExtra() {
    if (!fcShowing) return;
    var gen = mode === 'clock';
    // (under a clock's own background the forecast stays drawn until the
    // clock has faded back over it)
    if (gen && host) {
      host.setAttribute('fcout', '');
      if (exOutT) clearTimeout(exOutT);
      exOutT = setTimeout(function () { exOutT = null; if (host && !fcShowing) host.removeAttribute('fcout'); }, CROSSFADE_MS + 100);
    }
    hideForecastSlide();
  }
  function leaveExtras() {
    if (exT) { clearTimeout(exT); exT = null; }
    if (exOutT) { clearTimeout(exOutT); exOutT = null; }
    exKind = ''; exLast = '';
    if (host) host.removeAttribute('fcout');
  }

  var muShowing = false, lastSlide = '';

  function dropView(v) {
    if (!v) return;
    if (pnl && pnl.view === v) closePanel(false);
    mus.views = mus.views.filter(function (x) { return x !== v; });
    if (v.el.parentNode) v.el.remove();
    musicTick();
  }

  // ONCE A SECOND, only while a view on screen shows music playing
  function musicTick() {
    var any = !document.hidden && mus.views.some(function (v) {
      if (v.kind === 'dash') return v.live && v.el.isConnected && v.d && !v.d.idle && v.d.playing;
      return on && v.el.isConnected && (v.kind === 'pane' ? mus.paneIn : muShowing) && v.d && !v.d.idle && v.d.playing;
    });
    if (any && !mus.tick) mus.tick = setInterval(function () { mus.views.forEach(progress); musicTick(); }, 1000);
    else if (!any && mus.tick) { clearInterval(mus.tick); mus.tick = null; }
  }
  // Everything again from the house: what plays, into each view
  function renderMusic() {
    var h = clientNow();
    if ((!on && !dashLive()) || !h) return null;
    var ctx = musicNow(h), now = clock.now();
    if (previewOn && previewSelected === 'music' && !(ctx && ctx.playing)) {
      mus.views.forEach(function (v) { drawMusic(v, v.kind === 'slide' ? previewMusicData() : musicOf(ctx, h)); }); musicTick(); return ctx;
    }
    var d = musicOf(ctx, h);
    // A PAUSE THAT READS AS "IDLE" (2026-10-15): Music Assistant's AirPlay
    // speakers -- the house's HomePods -- report a pause as idle, so the
    // music on screen seemed to end on a pause, and the player went to
    // "Not Playing" with a lone play button. The song shown is kept, paused,
    // for Hide After a Pause from when it was last there (its play button
    // resumes it); after that it goes, as stopped music does.
    if (d && !d.idle) mus.held = { d: d, at: now, frozen: null };
    else if (mus.held && now - mus.held.at < muGrace()) {
      var hd = mus.held;
      if (!hd.frozen) hd.frozen = Object.assign({}, hd.d, { playing: false, pos: elapsed(hd.d), posAt: 0 });
      d = hd.frozen;
    } else mus.held = null;
    mus.key = ctx ? ctx.key : (d && !d.idle ? d.key : null);
    var sig = sigOf(d);
    // the volume a finger is setting, not the house's last word on it
    if (d && !d.idle && mus.vol && mus.vol.key === d.key && (mus.drag || clock.now() < mus.vol.until)) d.vol = mus.vol.val;
    if (sig && sig !== mus.nextFor && mus.views.length) upNext(d, sig);
    mus.views.forEach(function (v) { drawMusic(v, d); });
    musicTick();
    // (its panel stays while the paused song is held: somebody picking music)
    if (pnl) { if (!ctx && !(d && !d.idle)) closePanel(true); else pnl.p.update(); }
    return ctx;
  }
  // UP NEXT (and the album's year): Music Assistant's queue, asked once a
  // song. Not Music Assistant: neither.
  function upNext(d, sig) {
    mus.nextFor = sig; mus.next = null; mus.year = ''; mus.nextBusy = true;
    var str = function (x) { return typeof x === 'string' ? x : ''; };
    sendWS({ type: 'call_service', domain: 'music_assistant', service: 'get_queue',
             service_data: { entity_id: d.key }, return_response: true }).then(function (r) {
      if (mus.nextFor !== sig) return;
      mus.nextBusy = false;
      var q = r && r.response && r.response[d.key];
      var n = q && q.next_item, mi = n && n.media_item, cm = q && q.current_item && q.current_item.media_item;
      mus.next = n ? { title: str(mi && mi.name) || str(n.name),
                       artist: mi && mi.artists && mi.artists[0] ? str(mi.artists[0].name) : '',
                       image: str(mi && mi.image) || str(mi && mi.album && mi.album.image) } : null;
      var y = cm && (cm.year || (cm.album && cm.album.year));
      mus.year = y ? String(y) : '';
      upNextPiece(d, mus.next);
      mus.views.forEach(function (v) { drawMusic(v, v.d); });
      if (muShowing) layoutMusic();
      paneStack();
      if (mus.next && !mus.next.image && mi) nextArt(d, sig, mi);
    }).catch(function () {
      // not Music Assistant: no Up Next (its place let go)
      if (mus.nextFor !== sig) return;
      mus.nextBusy = false;
      upNextPiece(d, null);
      mus.views.forEach(function (v) { drawMusic(v, v.d); });
      if (muShowing) layoutMusic();
    });
  }
  // A BUTTON, where it is drawn (the views take no pointer events)
  // ON SCREEN: not hidden, and not faded out with anything it sits in. The
  // pane stays laid out at opacity 0 when it is down (.pane, :host([pane])),
  // its music with it: its art kept its box over the clock's right side, and
  // a tap on the clock opened Play Music instead of waking to the dashboard
  // (2026-10-21).
  function seen(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      if (n === host) break;
    }
    return true;
  }
  function musicHit(x, y) {
    if (x == null || y == null) return null;
    for (var i = 0; i < mus.views.length; i++) {
      var v = mus.views[i];
      // (the dashboard's pane takes its own taps -- and lies under this)
      if (v.kind === 'dash' || !v.el.isConnected || (v.kind === 'slide' && !muShowing) || !seen(v.el)) continue;
      if (!v.el.hasAttribute('novol')) {
        var tr = v.vt.getBoundingClientRect();
        if (tr.width && x >= tr.left - MU_SLOP && x <= tr.right + MU_SLOP && y >= tr.top - 2 * MU_SLOP && y <= tr.bottom + 2 * MU_SLOP) return { vol: true, view: v };
      }
      var bs = v.el.querySelectorAll('.mbtn');
      for (var j = 0; j < bs.length; j++) {
        var r = bs[j].getBoundingClientRect();
        if (r.width && x >= r.left - MU_SLOP && x <= r.right + MU_SLOP && y >= r.top - MU_SLOP && y <= r.bottom + MU_SLOP &&
            getComputedStyle(bs[j]).visibility !== 'hidden') return { btn: bs[j], view: v };
      }
      // THE ALBUM ART opens Play Music
      var ar = v.el.querySelector('.msq').getBoundingClientRect();
      if (ar.width && x >= ar.left && x <= ar.right && y >= ar.top && y <= ar.bottom) return { art: true, view: v };
    }
    return null;
  }
  // A TAP ON THE ART: the screensaver closes onto Play Music, showing that
  // music (this screen's focus, as a tap on it there would make it)
  function openMusic(hit) {
    var d = hit.view.d, M = window.hkMusic, page = musicPage();
    if (d && d.key && M && M.setFocus) { try { M.setFocus(d.key); } catch (e) { /* the page follows what plays */ } }
    // (the dashboard's pane: there is no screensaver to close)
    if (hit.view.kind === 'dash') { if (page) go(page); return; }
    pressStop = true;
    stop('touch');
    if (page) go(page);
  }
  function volStart(hit, x) {
    mus.drag = { view: hit.view, sent: 0, t: null };
    mus.key = hit.view.d && hit.view.d.key; mus.lostAt = 0;
    setAttr(hit.view.el, 'dragging', true);
    volFrom(x);
    if (muShowing && mode === 'photos') schedule();
  }
  function musicAct(hit, x) {
    if (hit && hit.view.d && hit.view.d.sample) return;
    if (!hit || hit.view.kind !== 'dash') { saverTouched(); musicUsed(); }
    if (hit && hit.art) { openMusic(hit); return; }
    if (hit && hit.vol) { volStart(hit, x); return; }
    var port = actionsNow(), d = hit && hit.view.d, act = hit && hit.btn.getAttribute('data-act');
    if (!port || !d || !d.key || !act) return;
    if (act === 'spk' || act === 'brw' || act === 'queue') { panelFor(hit.view, act === 'spk' ? 'speakers' : act === 'queue' ? 'queue' : 'browse'); return; }
    var svc = act === 'prev' ? 'media_previous_track' : act === 'next' ? 'media_next_track'
            : !d.idle && d.playing ? 'media_pause' : 'media_play';
    try { port.callService('media_player', svc, { entity_id: d.key }); } catch (e) { /* offline */ }
    var b = hit.btn;
    b.classList.add('hit');
    setTimeout(function () { b.classList.remove('hit'); }, 180);
    // the music touched stays the music on screen, paused or not
    mus.key = d.key; mus.lostAt = 0;
    if (act === 'pp' && !d.idle) {
      d.playing = !d.playing; d.pos = elapsed(Object.assign({}, d, { playing: !d.playing })); d.posAt = Date.now();
      mus.views.forEach(function (v) { if (v.d === d) drawMusic(v, d); });
      musicTick();
    }
    // a slide among the photos stays its full turn after a touch
    if (muShowing && mode === 'photos') schedule();
  }

  var pnl = null;               // { p: the panel, view, idleT, doneT, src, anim }
  function panelFor(v, tab) {
    var P = window.hkSaverPanel, proot = rootOf(v);
    if (!P || !proot || !v || !v.el.isConnected) return;
    if (pnl && pnl.view === v) {
      if (pnl.p.tab() === tab) closePanel(true); else { pnl.p.show(tab); panelButtons(); panelTouched(); }
      return;
    }
    if (pnl) closePanel(false);
    if (!proot.querySelector('style.mpcss')) {
      var HC = window.hkCards;
      var st = document.createElement('style'); st.className = 'mpcss';
      st.textContent = P.CSS + (HC && HC.shadeCss ? '\n' + HC.shadeCss('.mpanel') : ''); proot.appendChild(st);
    }
    var me = { view: v, idleT: null, doneT: null, anim: null,
               src: v.kind === 'pane' ? paneEl : v.kind === 'dash' ? v.box : v.el.querySelector('.msq') };
    me.p = P.create({
      client: clientNow,             // its reads, and its buttons through client.actions
      ctx: function () { return musicNow(clientNow()); },
      art: function () { return v.bg[v.flip] || null; },
      // the music moved (Update, a new leader): the screensaver follows it
      follow: function (key) { if (key) { mus.key = key; mus.lostAt = 0; renderMusic(); } },
      done: function (ms) {
        if (pnl !== me) return;
        if (me.doneT) clearTimeout(me.doneT);
        me.doneT = setTimeout(function () { me.doneT = null; if (pnl === me) closePanel(true); }, ms || 0);
      },
      wide: function () { return !!me.wide; },
      // the pane's back: what plays, and play / pause and next, at its foot
      mini: function () { return v.kind === 'pane' || v.kind === 'dash'; },
      now: function () { return v.d; },
      transport: function (k) {
        var b = v.el.querySelector('.mbtn[data-act="' + (k === 'pp' ? 'pp' : 'next') + '"]');
        if (b) musicAct({ btn: b, view: v });
      }
    });
    pnl = me;
    if (v.kind !== 'slide') me.p.el.classList.remove('card'); else me.p.el.classList.add('card');
    proot.appendChild(me.p.el);
    if (v.kind === 'dash') dashOutside(true);
    placePanel();
    me.p.show(tab);
    panelButtons();
    panelTouched();
    turnPanel(true);
  }
  // WHERE IT SITS: the pane's own box; or, on the slide, a card over the art
  // (a little bigger than it) between the song's column and the screen's
  // edge -- again whenever the screen changes size (a tablet's keyboard)
  function placePanel() {
    if (!pnl || !hostOf(pnl.view)) return;
    var v = pnl.view, el = pnl.p.el, z = v.kind === 'dash' ? v.z || 1 : scaleOf(), b, off = { x: 0, y: 0 };
    if (v.kind === 'pane' || v.kind === 'dash') {
      var r = (v.kind === 'dash' ? v.box : paneEl).getBoundingClientRect();
      b = { x: r.left, y: r.top, w: r.width, h: r.height };
      // (the dashboard's card is the panel's box: placed in it, not the screen)
      if (v.kind === 'dash') { var hr = v.host.getBoundingClientRect(); off = { x: hr.left, y: hr.top }; }
    } else {
      var area = v.el.querySelector('.mbody').getBoundingClientRect(), col = v.el.querySelector('.mcol').getBoundingClientRect();
      var art = v.el.querySelector('.mart').getBoundingClientRect(), H0 = window.innerHeight || area.height;
      var lower = host.hasAttribute('murow') || host.hasAttribute('muup');
      var lo = (lower ? area.left : col.right) + 24 * z, hi = area.right - 24 * z;
      var w = Math.max(280 * z, Math.min(566 * z, hi - lo));
      var cx = Math.max(lo + w / 2, Math.min(hi - w / 2, art.left + art.width / 2));
      var top = (paneUp ? 40 : 100) * z, bot = H0 - 36 * z;
      if (bot - top < 300 * z) top = Math.max(12 * z, bot - 300 * z);     // the keyboard up: as tall as there is
      var h = Math.min(660 * z, bot - top);
      var cy = Math.max(top + h / 2, Math.min(bot - h / 2, art.top + art.height / 2));
      b = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
    }
    pnl.box = b;
    pnl.wide = b.w >= 500 * z;
    // A SHORT SCREEN (a tablet's keyboard up for the search): the panel
    // alone over the art -- the song's column and the clock would only be
    // squeezed under it -- and the field kept in sight
    var kb = (window.innerHeight || 800) < 560 * z;
    setAttr(hostOf(v), 'mpkb', kb);
    if (kb || pnl.kb) pnl.p.reveal();
    pnl.kb = kb;
    el.style.left = Math.round(b.x - off.x) + 'px'; el.style.top = Math.round(b.y - off.y) + 'px';
    el.style.width = Math.round(b.w) + 'px'; el.style.height = Math.round(b.h) + 'px';
    pnl.p.size(b.w, b.h, z);
  }
  // THE TURN: the art (or the pane) to edge-on as it grows toward the
  // panel's box, then the panel from edge-on to flat. Transforms only.
  function turnPanel(opening, done, rec) {
    var me = rec || pnl, el = me.p.el, src = me.src, B = me.box;
    if (!src || !B) { if (done) done(); return; }
    var reduce = reducedMotion();
    var r = src.getBoundingClientRect(), R = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (!opening && me.hidRect) R = me.hidRect;
    var Mid = { x: (R.x + B.x) / 2, y: (R.y + B.y) / 2, w: (R.w + B.w) / 2, h: (R.h + B.h) / 2 };
    var per = Math.round(1500 * (me.view.kind === 'dash' ? me.view.z || 1 : scaleOf()));
    var xf = function (from, to, deg) {
      return 'perspective(' + per + 'px) translate(' + ((from.x + from.w / 2) - (to.x + to.w / 2)) + 'px,' +
             ((from.y + from.h / 2) - (to.y + to.h / 2)) + 'px) rotateY(' + deg + 'deg) scale(' + (from.w / to.w) + ',' + (from.h / to.h) + ')';
    };
    var hide = function (on) {
      src.style.visibility = on ? 'hidden' : '';
      if (me.view.kind !== 'slide') setAttr(hostOf(me.view), 'mpp', on);
    };
    // (both halves on one schedule, the panel painted before it moves: hk-saver-panel.js turn)
    var P = window.hkSaverPanel;
    var can = !reduce && typeof el.animate === 'function' && typeof src.animate === 'function' && !!(P && P.turn);
    if (me.anim) { try { me.anim.cancel(); } catch (e) { /* done */ } me.anim = null; }
    var o = { el: el, src: src, flat: xf(Mid, B, -90), edge: xf(Mid, R, 90), srcGone: hide };
    if (opening) {
      me.hidRect = R;
      el.classList.add('up');
      if (me.view.kind !== 'slide') setAttr(hostOf(me.view), 'mpp', true);
      if (!can) { hide(true); if (done) done(); return; }
      o.out = [PANEL_TURN[0], 'cubic-bezier(.45,0,.9,.5)']; o.in = [PANEL_TURN[1], 'cubic-bezier(.1,.5,.25,1)'];
      var tr = me.anim = P.turn(Object.assign(o, { done: function () { if (me.anim === tr) me.anim = null; if (done) done(); } }), true);
    } else {
      if (!can) { el.classList.remove('up'); hide(false); if (done) done(); return; }
      o.out = [PANEL_TURN[0], 'cubic-bezier(.45,0,.9,.5)']; o.in = [PANEL_TURN[1], 'cubic-bezier(.1,.5,.25,1)'];
      me.anim = P.turn(Object.assign(o, { done: function () { me.anim = null; el.classList.remove('up'); if (done) done(); } }), false);
    }
  }
  // closed: turned back (animated), or at once (its view gone, the
  // screensaver stopping)
  function closePanel(animated) {
    var me = pnl;
    if (!me) return;
    pnl = null;
    // (its closing is its last use: the music stays a whole grace after it,
    // however it closed -- a tap, a request landed, idle)
    if (me.view.kind === 'dash') { if (me.view.host) me.view.host._usedAt = Date.now(); } else musicUsed();
    if (hostOf(me.view)) setAttr(hostOf(me.view), 'mpkb', false);
    if (me.view.kind === 'dash') dashOutside(false);
    if (me.idleT) clearTimeout(me.idleT);
    if (me.doneT) clearTimeout(me.doneT);
    // (a field focused on a tablet: its keyboard goes with it)
    try { var a = me.p.el.getRootNode && me.p.el.getRootNode().activeElement; if (a && a.blur) a.blur(); } catch (e) { /* ignore */ }
    try { document.activeElement && /** @type {HTMLElement} */ (document.activeElement).blur && /** @type {HTMLElement} */ (document.activeElement).blur(); } catch (e) { /* ignore */ }
    panelButtons();
    var finish = function () {
      me.p.destroy();
      if (me.src) { me.src.style.visibility = ''; me.src.style.transition = ''; }
      if (me.view.kind !== 'slide' && hostOf(me.view)) setAttr(hostOf(me.view), 'mpp', false);
    };
    if (animated && (on || me.view.kind === 'dash') && me.src && me.src.isConnected && me.view.el.isConnected) turnPanel(false, finish, me);
    else { if (me.anim) { try { me.anim.cancel(); } catch (e) { /* done */ } } finish(); }
    // the slide's turn among the photos starts again now
    if (on && muShowing && mode === 'photos') schedule();
  }
  // a touch on it: not closed for PANEL_IDLE more, and the house told
  function panelTouched() {
    var me = pnl;
    if (!me) return;
    if (me.view.kind !== 'dash') { saverTouched(); musicUsed(); }
    if (me.idleT) clearTimeout(me.idleT);
    var check = function () {
      me.idleT = null;
      if (pnl !== me) return;
      if (me.p.busy()) { me.idleT = setTimeout(check, 5000); return; }
      closePanel(true);
    };
    me.idleT = setTimeout(check, PANEL_IDLE);
  }
  function panelButtons() {
    mus.views.forEach(function (v) {
      Array.prototype.forEach.call(v.el.querySelectorAll('.mbtn.mx'), function (b) {
        var tab = b.getAttribute('data-act') === 'spk' ? 'speakers' : 'browse';
        b.classList.toggle('on', !!pnl && pnl.view === v && pnl.p.tab() === tab);
      });
    });
  }
  function inPanel(e) {
    if (!pnl) return false;
    var path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(pnl.p.el) >= 0;
  }
  // A TOUCH ON THE SCREENSAVER'S OWN CONTROLS (the music, its panel, a photo
  // stepped), told to the integration as such: Sleep Screen reads it as the
  // photos in use, not somebody at the dashboard (sleep_engine.py
  // saver_use) -- the kiosk's own report of the same tap would otherwise
  // wake the dashboard out from under the finger. At most every 3 s, only
  // from the tablet's own user (as reportTouch).
  var saverSent = 0;
  function saverTouched() {
    if (!cfg || !cfg.entity || !/^switch\./.test(cfg.entity)) return;
    if (!mine() || force || /[?&]hk_saver=force\b/.test(location.search)) return;
    var now = Date.now();
    if (now - saverSent < 3000) return;
    saverSent = now;
    sendWS(whoMsg({ type: 'hk_frontend/screensaver/touch', saver: true })).catch(function () { /* older integration */ });
  }

  // THE SLIDE: built the first time, then kept like the forecast's layer
  function buildMusicSlide() {
    var v = slideView();
    if (v && v.el.isConnected) return v;
    if (v) dropView(v);
    if (!root) return null;
    v = musicView('slide');
    root.insertBefore(v.el, root.querySelector('.info'));
    return v;
  }
  // false: nothing plays (nothing shown). first: the screensaver's first view
  function showMusicSlide(first) {
    if (!on || !root || !host || muShowing) return muShowing;
    var ctx = musicNow(clientNow());
    if ((!ctx || !ctx.playing) && !(previewOn && previewSelected === 'music')) return false;
    var v = buildMusicSlide(), run = photoRun;
    // (Home Energy over everything: the music in its place)
    if (enShowing) { hideEnergySlide(); if (exKind === 'energy') exKind = ''; }
    if (wxShowing) { hideWeatherSlide(); if (exKind === 'weather') exKind = ''; }
    muShowing = true; sinceFc = 0; lastSlide = 'music'; mus.lostAt = 0;
    musicParts(v, cfg.music_hide);
    renderMusic();
    host.setAttribute('muslide', '');
    updateBand();
    forecastTick(false);                 // the forecast's sky holds still under it
    layoutMusic();
    // IN ONCE ITS ART IS DECODED (never more than a moment): faded in on
    // the placeholder, the cover popped in halfway through
    var go = false, reveal1 = function () {
      if (go) return; go = true;
      if (!(on && muShowing && run === photoRun && v.el.isConnected)) return;
      reveal(v.el, !!first);
      if (first && entrance) entrance();
    };
    v.ready.then(function () { requestAnimationFrame(reveal1); });
    setTimeout(reveal1, 1500);
    return true;
  }
  function hideMusicSlide() {
    if (!muShowing) return;
    if (pnl && pnl.view.kind === 'slide') closePanel(false);
    muShowing = false;
    mus.lostAt = 0;
    if (host) host.removeAttribute('muslide');
    if (!musicPaneView()) mus.key = null;
    updateBand();
    musicTick();
    // over the forecast: back to it
    if (mode === 'forecast' && root && root.querySelector('.fc')) { reveal(root.querySelector('.fc'), false); forecastTick(true); }
  }
  // The music module lays out the current view with the shell's live frame.
  function layoutMusic() {
    if (!host || !root) return;
    layoutMusicView(slideView(), host, root, scn, scaleOf());
  }
  // OVER THE FORECAST, the house decides: the slide while music plays, the
  // forecast again MU_GRACE after it stops. Every view follows the house.
  // At most once a second (a new client comes many times a second).
  // THE MUSIC TAKES THE SCREEN while it plays: Music First, or (as before
  // Music First) the music over the forecast
  function takeover() { return !previewOn && !!cfg && (cfg.music_first || (cfg.music_slide && mode !== 'photos')); }
  function musicWatch() {
    if (!on || !cfg || !root || !(cfg.music_slide || cfg.music_pane || cfg.music_first || (cfg.extra_music && muShowing))) return;
    var now = clock.now();
    if (now - mus.watchAt < 1000) {
      if (!mus.watchT) mus.watchT = setTimeout(function () { mus.watchT = null; musicWatch(); }, 1000 - (now - mus.watchAt));
      return;
    }
    mus.watchAt = now;
    var ctx = mus.views.length ? renderMusic() : musicNow(clientNow());
    // the pane's music: while something plays, or its panel is open, and the
    // grace after (paused music goes too, once the grace is up)
    var g = muGrace(), inUse = !!pnl && pnl.view.kind !== 'dash';
    if ((ctx && ctx.playing) || inUse) mus.lastActive = now;
    if (cfg.music_pane) musicIn(now - mus.lastActive < g);
    // (looked at again as the grace runs out: a paused house sends nothing)
    if (mus.lastActive && now - mus.lastActive < g) {
      clearTimeout(mus.graceT);
      mus.graceT = setTimeout(function () { mus.watchAt = 0; musicWatch(); }, g - (now - mus.lastActive) + 100);
    }
    if (!takeover()) return;
    if (!muShowing) { if (ctx && ctx.playing) showMusicSlide(); return; }
    if ((ctx && ctx.playing) || inUse) mus.lostAt = 0;
    else if (!mus.lostAt) mus.lostAt = Math.max(now, mus.lastActive);
    else if (now - Math.max(mus.lostAt, mus.lastActive) > g) {
      // back to the forecast, or to the photos (the next one takes the music away)
      mus.lostAt = 0;
      if (mode !== 'photos') hideMusicSlide(); else showNext(false);
    }
  }
  // the pane's music, there or not
  function musicPane(want) {
    var v = musicPaneView();
    if (!want) { if (v) dropView(v); return; }
    if (v && v.el.parentNode === paneEl) return;
    if (v) dropView(v);
    if (!paneEl || !host) return;
    host.style.setProperty('--hk-mu-z', String(scaleOf()));
    v = musicView('pane');
    paneEl.appendChild(v.el);
    renderMusic();
  }
  function leaveMusic() {
    closePanel(false);
    if (mus.tick) { clearInterval(mus.tick); mus.tick = null; }
    if (mus.watchT) { clearTimeout(mus.watchT); mus.watchT = null; }
    mus.views.filter(function (v) { return v.kind !== 'dash'; }).forEach(dropView);
    if (mus.drag && mus.drag.t) clearTimeout(mus.drag.t);
    mus.key = null; mus.next = null; mus.nextFor = ''; mus.year = ''; mus.lostAt = 0; mus.drag = null; mus.vol = null;
    mus.paneIn = false; mus.paneNext = null;
    muShowing = false; lastSlide = '';
    if (host) host.removeAttribute('muslide');
  }

  // ------------------------------------------------------- THE DASHBOARD'S PANE
  // NOW PLAYING AS A PANE ON THE DASHBOARD (2026-10-15; the screen's Now
  // Playing -> Side Pane, hk-popup.js placeFor). The screensaver's own music
  // pane, the same view (kind 'dash') in a card of its own
  // (hk-music-pane-card) that the docked #media pop-up stands up down one
  // side of the screen: the same art, song, buttons, volume, Up Next and
  // Speakers / Browse panel, drawn from the same state -- so it is the music
  // the screensaver shows, and the screensaver coming up over it shows the
  // same. Unlike the screensaver's it takes taps the ordinary way (the page
  // is not covered), and touching it is somebody at the dashboard, not at
  // the screensaver (no saverTouched).
  function hostOf(v) { return v && v.kind === 'dash' ? v.host : host; }
  function rootOf(v) { return v && v.kind === 'dash' ? v.root : root; }
  // the dashboard's pane drawn again from the house, at most once a second
  // (the screensaver's own watch draws every view while it is up)
  var dashAt = 0, dashT = null;
  function dashWatch() {
    if (on || !dashLive()) return;
    var now = Date.now();
    if (now - dashAt < 1000) {
      if (!dashT) dashT = setTimeout(function () { dashT = null; dashWatch(); }, 1000 - (now - dashAt));
      return;
    }
    dashAt = now;
    renderMusic();
  }
  // ITS PANEL closes with a tap anywhere else on the dashboard, and a touch
  // on it keeps it open (the screensaver routes both itself)
  var dashOut = null;
  function dashOutside(want) {
    if (!want) {
      if (dashOut) { document.removeEventListener('pointerdown', dashOut, true); dashOut = null; }
      return;
    }
    if (dashOut) return;
    dashOut = function (e) {
      if (!pnl || pnl.view.kind !== 'dash') return;
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(pnl.p.el) >= 0) { panelTouched(); return; }
      // (its own buttons: Speakers / Browse switch or close it themselves)
      var mx = pnl.view.el.querySelectorAll('.mbtn.mx');
      for (var i = 0; i < mx.length; i++) if (path.indexOf(mx[i]) >= 0) return;
      closePanel(true);
    };
    document.addEventListener('pointerdown', dashOut, true);
  }
  // ONE VIEW FOR EVERY PAGE'S PANE (2026-10-15): each page of a dashboard
  // holds its own #media pop-up, so a page change builds a new card -- and a
  // new view started with no art, the placeholder showing until the cover had
  // loaded and faded in again (seen in Safari, every page change). The view
  // is made once and handed to whichever card is showing: its art, blur and
  // song move with it, drawn already.
  var dashV = null;

  var paneT = null;
  // the pane is up now: the calendar's, or the music's while it plays
  var paneUp = false;
  function setPane(up) {
    if (!host) return;
    paneUp = !!up;
    setAttr(host, 'pane', paneUp);
    if (paneUp) {
      layoutPane();
      // what Home Status, the music and the timers take comes and goes with
      // the house: measured again every moment (a few rect reads)
      if (!paneT) paneT = setInterval(function () { if (on) paneStack(); }, 1500);
    } else {
      if (host.style.removeProperty) PANE_VARS.forEach(function (v) { if (PANE_OWN.indexOf(v) < 0) host.style.removeProperty(v); });
      paneW = 0;
      if (paneT) { clearInterval(paneT); paneT = null; }
    }
    // Home Status and the timers: into the pane or back to their corners;
    // the forecast details beside it or across
    cards.forEach(function (el) {
      if (el.__hkSaverConf) { try { el.setConfig(cardConf(el.__hkSaverConf, el.localName)); } catch (e) { /* as it was */ } }
    });
    if (fband && fband.isConnected && fband._config) {
      try { fband.setConfig(Object.assign({}, fband._config, { hours: paneUp ? 8 : 12, now_width: paneUp ? BAND_NOW_BESIDE : undefined })); } catch (e) { /* as it was */ }
      setTimeout(function () { if (fband && fband.isConnected) centerBand(fband); }, 350);
    }
  }
  // THE MUSIC IN THE PANE, there while music plays (or is paused), and
  // MU_GRACE after: under the calendar at once; alone, the pane comes and
  // goes with the next photo (over the forecast, at once)
  function musicIn(want) {
    if (!host || !cfg || !cfg.music_pane || want === mus.paneIn) return;
    mus.paneIn = want;
    setAttr(host, 'pm', want);
    musicTick();
    if (cfg.calendar) { paneStack(); return; }
    var photo = displayLayer && displayLayer.classList.contains('ph') && mode === 'photos' && !muShowing && !fcShowing;
    if (photo) mus.paneNext = want;
    else { mus.paneNext = null; setPane(want); }
  }
  function setupPane() {
    if (!host) return;
    var dropCal = function () {
      if (paneCard) { cards = cards.filter(function (c) { return c !== paneCard; }); paneCard.remove(); paneCard = null; }
    };
    mus.paneNext = null;
    if (!paneOf(cfg)) {
      dropSide();
      host.removeAttribute('panecfg'); host.removeAttribute('pcal'); host.removeAttribute('pm'); host.removeAttribute('pside'); host.removeAttribute('pbare');
      mus.paneIn = false;
      setPane(false);
      if (host.style.removeProperty) PANE_VARS.forEach(function (v) { host.style.removeProperty(v); });
      dropCal();
      musicPane(false);
      return;
    }
    host.setAttribute('panecfg', '');
    setAttr(host, 'pside', cfg.pane_side === 'left');
    if (cfg.pane_list) {
      host.removeAttribute('pcal'); host.removeAttribute('pm');
      mus.paneIn = false;
      dropCal();
      musicPane(false);
      sideSections();
      return;
    }
    dropSide();
    // THE CALENDAR ([pcal]) and THE MUSIC ([pm], while it plays) share it:
    // either fills it, both put the calendar above the music
    setAttr(host, 'pcal', cfg.calendar);
    // (playing, not paused: a song left paused does not bring the pane back
    // each time the screensaver starts)
    var c0 = cfg.music_pane ? musicNow(clientNow()) : null, playing = !!(c0 && c0.playing);
    mus.paneIn = playing; mus.lastActive = playing ? clock.now() : 0;
    setAttr(host, 'pm', playing);
    musicPane(cfg.music_pane);
    setPane(cfg.calendar || playing);
    if (!cfg.calendar) { dropCal(); return; }
    var tag = 'hk-calendar-pane-card', days = cfg.calendar_days;
    if (paneCard) {
      if ((paneCard._config || {}).days !== days) paneCard.setConfig({ type: 'custom:' + tag, days: days });
      return;
    }
    var make = function () {
      if (!host || !paneSc || paneCard || !cfg || !cfg.calendar) return;
      try {
        var el = /** @type {any} */ (document.createElement(tag));
        el.setConfig({ type: 'custom:' + tag, days: cfg.calendar_days });
        feedCard(el, clientNow());
        paneSc.appendChild(el);
        cards.push(el);
        paneCard = el;
        layoutPane();
      } catch (e) { console.warn('[hk-saver] calendar pane', e); }
    };
    if (customElements.get(tag)) make();
    else if (customElements.whenDefined) customElements.whenDefined(tag).then(make);
  }
  // THE SIDE PANE'S SECTIONS in the pane (cfg.pane_list): those with
  // something to show (When There's Something), fitted by the Side Pane; the
  // pane up while any shows, looked at again every 1.5 s while it runs
  function sideSections() {
    var SP = window.hkSidePane;
    if (!host || !cfg || !cfg.pane_list || !SP) return;
    var box = paneEl || (root && root.querySelector('.pane'));
    if (!box) return;
    if (!sidePane) { sidePane = SP.create('saver'); box.appendChild(sidePane); }
    var list = SP.saverList({ saver: { show: 'own', sections: cfg.pane_list } }, clientNow());
    setPane(list.length > 0);
    var w = paneW || Math.round(PANE_W * scaleOf());
    sidePane.show({ list: list, place: { kind: 'side', w: w }, side: cfg.pane_side });
    if (!sideT) sideT = setInterval(function () { if (on && cfg && cfg.pane_list) sideSections(); }, 1500);
  }
  function dropSide() {
    if (sideT) { clearInterval(sideT); sideT = null; }
    if (sidePane) { sidePane.show(null); if (sidePane.parentNode) sidePane.parentNode.removeChild(sidePane); sidePane = null; }
  }
  // its width and Home Status's place in it, for this screen (and again
  // every few seconds: a tablet turned, a window resized)
  function layoutPane() {
    // (the face beside the pane is narrower: the Day face measured again once it is laid out)
    setTimeout(dayFit, 80);
    if (!host || !paneUp) return;
    var z = scaleOf(), SP = window.hkSidePane, w = Math.round(((SP && SP.WIDTHS[cfg.pane_width]) || PANE_W) * z);
    // the list scaled with the screen (its card may arrive after the width)
    if (paneCard && (paneCard.style.zoom || '1') !== String(z)) paneCard.style.zoom = z === 1 ? '' : String(z);
    var sideNow = (cfg && cfg.pane_side) || 'right';
    if (w === paneW && sideNow === paneSide && host.style.getPropertyValue && host.style.getPropertyValue('--hk-pane-w')) return;
    paneW = w; paneSide = sideNow;
    // a new width for the pane is a new room for the band beside it
    if (fband && fband.isConnected) setTimeout(function () { if (fband && fband.isConnected) centerBand(fband); }, 0);
    var px = function (n) { return Math.round(n * z) + 'px'; };
    host.style.setProperty('--hk-pane-w', w + 'px');
    // one margin for everything in the pane: the list, Home Status, its foot
    host.style.setProperty('--hk-pane-pad', px(28));
    // WHAT PLAYS AND THE TIMERS, in the pane's foot (hk-media.js,
    // hk-timers.js): on its 28 px margins, left-aligned with the list,
    // smaller than in a corner of the photos. Their left edge is measured
    // from the screen's RIGHT (100% of the screen-sized host, the box their
    // position:fixed resolves against), so a window resized or a screen
    // turned at the same scale -- the pane's width unchanged, this skipped --
    // leaves them in the pane, never where the old width put them.
    var left = cfg && cfg.pane_side === 'left';
    var footLeft = left ? px(28) : 'calc(100% - ' + (w - Math.round(28 * z)) + 'px)';
    host.style.setProperty('--hk-ss-now-left', footLeft);
    host.style.setProperty('--hk-ss-now-max', (w - Math.round(56 * z)) + 'px');
    host.style.setProperty('--hk-ss-np-art', px(64));
    host.style.setProperty('--hk-ss-np-title', px(20));
    host.style.setProperty('--hk-ss-np-artist', px(16));
    host.style.setProperty('--hk-ss-np-gap', px(14));
    host.style.setProperty('--hk-ss-timers-left', footLeft);
    host.style.setProperty('--hk-ss-timers-right', px(28));
    host.style.setProperty('--hk-ss-timers-max', (w - Math.round(56 * z)) + 'px');
    host.style.setProperty('--hk-ss-status-right', (left ? (window.innerWidth || 0) - w + Math.round(28 * z) : Math.round(28 * z)) + 'px');
    host.style.setProperty('--hk-ss-status-top', Math.round(26 * z) + 'px');
    host.style.setProperty('--hk-ss-status-width', (w - Math.round(56 * z)) + 'px');
    paneStack();
    layoutSoon();
  }
  // THE PANE'S LIST between Home Status (one line, or two or three when
  // much is open) and its foot (what plays above the running timers, each
  // only while there is one): measured, so nothing overlaps whatever shows
  function paneStack() {
    if (!host || !root || !paneUp) return;
    var z = scaleOf(), pad = Math.round(22 * z), gap = Math.round(14 * z);
    var hOf = function (tag, sel) {
      var el = null;
      for (var i = 0; i < cards.length; i++) if (cards[i].localName === tag) { el = cards[i]; break; }
      var n = el && el.shadowRoot && el.shadowRoot.querySelector(sel);
      if (!n || !n.getBoundingClientRect) return null;
      var r = n.getBoundingClientRect();
      return r.height > 1 ? r : null;
    };
    var st = hOf('hk-screensaver-status-card', '.sscorner');
    var np = hOf('hk-screensaver-now-card', '.sscorner'), tm = hOf('hk-timer-strip-card', 'div[style*="position:fixed"]');
    var tH = tm ? Math.round(tm.height) : 0, nH = np ? Math.round(np.height) : 0, set = function (k, v) { if (host.style.getPropertyValue(k) !== v) host.style.setProperty(k, v); };
    // ROOM ABOVE ONLY FOR A HOME STATUS IN THE PANE (2026-11-05: on the photo it left an empty band; one not drawn yet keeps it)
    var pr = paneEl ? paneEl.getBoundingClientRect() : null, mid = st ? (st.left + st.right) / 2 : 0, bare = !cards.some(function (c) { return c.localName === 'hk-screensaver-status-card'; });
    if (st && pr && pr.width > 1 && (mid < pr.left || mid > pr.right)) { st = null; bare = true; }
    setAttr(host, 'pbare', bare);   // (pbare: no rule over the list)
    set('--hk-pane-top', (bare ? (sidePane ? 0 : Math.round(26 * z)) : Math.max(Math.round(PANE_TOP * z), st ? Math.round(st.bottom + 16 * z) : 0)) + 'px');
    set('--hk-ss-timers-bottom', pad + 'px'); set('--hk-ss-now-bottom', (pad + (tH ? tH + gap : 0)) + 'px');
    var stack = nH + tH + (nH && tH ? gap : 0); set('--hk-pane-bottom', (stack ? stack + pad + Math.round(18 * z) : 0) + 'px');
    // THE MUSIC IN THE PANE: over the timers (the now-playing row steps
    // aside for it); under the calendar, as tall as it is, the list above it
    var pm = musicPaneView();
    if (pm) {
      set('--hk-pm-foot', (pad + (tH ? tH + gap : 0)) + 'px');
      // (the music's own part: its background is the whole pane)
      var body = pm.el.querySelector('.mbody');
      if (cfg.calendar && host.hasAttribute('pm')) set('--hk-pane-bottom', ((body && body.offsetHeight) || 0) + 'px');
    }
  }

  // the weather band: today's conditions, the next hours and the coming days
  function addBand(box) {
    var tag = 'hk-weather-band-card';
    var make = function () {
      if (!host || !box.isConnected) return;
      var h = clientNow(), HS = window.hkSettings;
      var wid = h && HS && HS.weatherId ? HS.weatherId(h.states) : null;
      if (!wid) return;
      try {
        var el = /** @type {any} */ (document.createElement(tag));
        // beside the calendar pane: today beside the hours and days, as on
        // the other screens, its column slimmer and fewer hours
        el.setConfig({ type: 'custom:' + tag, entity: wid, hours: paneUp ? 8 : 12, days: 6, plain: true,
                       now_width: paneUp ? BAND_NOW_BESIDE : undefined });
        feedCard(el, h);
        // NOT SEEN UNTIL IT IS IN PLACE: it can only be centred once it has
        // drawn (centerBand measures it), so it drew ~25 px off and jumped
        // a quarter second into the slide -- and beside the calendar pane
        // again when it redrew for its width (2026-10-01). Hidden until it is
        // where it stays, then faded in.
        el.style.opacity = '0';
        box.appendChild(el);
        cards.push(el);
        fband = el;
        var placed = function () {
          if (fband !== el || !el.isConnected) return;
          centerBand(el);
          el.style.transition = 'opacity ' + BAND_REVEAL_MS + 'ms ease';
          el.style.opacity = '';
          el.__hkPlaced = true;
          if (entrance) entrance();               // the fade may begin now
        };
        // centred as soon as it has drawn, not at the next tick -- beside the
        // pane once more after it has redrawn for its width
        setTimeout(function () {
          if (fband !== el || !el.isConnected) return;
          centerBand(el);
          setTimeout(placed, paneUp ? 400 : 0);
        }, 250);
      } catch (e) { console.warn('[hk-saver] forecast band', e); }
    };
    if (customElements.get(tag)) make();
    else if (customElements.whenDefined) customElements.whenDefined(tag).then(make);
  }
  // SIDE TO SIDE BY WHAT IS DRAWN, not by the card's box: its left column
  // is a fixed 300 px with today's stack centred in it, and its hours and
  // days are centred in their cells, so the box centred leaves more empty
  // screen on the left than on the right. The text's own left and right
  // edges are measured and the band shifted until the two margins match.
  function centerBand(card) {
    var sr = card.shadowRoot, W = window.innerWidth || 0, H = window.innerHeight || 0;
    if (!sr || !W) return;
    // THE PANE'S WIDTH FIRST: centred before the pane had measured itself,
    // the band was centred on the whole screen and ran under the pane
    if (paneUp && !paneW) layoutPane();
    // the scale first (a bigger screen: the tablet's band, bigger) -- CSS
    // zoom, so it lays out as on the tablet and takes its scaled room
    var z = scaleOf();
    if (String(z) !== (card.style.zoom || '1')) card.style.zoom = z === 1 ? '' : String(z);
    // BESIDE THE CALENDAR PANE: the photos' (the land's) width is the room,
    // the band stands up no wider than BAND_STACKED, and its zone is the
    // meadow of the land as it covers that narrower box
    var RW = W - (paneUp ? paneW : 0), box = card.parentNode;
    if (box && box.style) {
      if (paneUp) {
        box.style.height = Math.round(Math.max(0.356 * H, 0.2225 * RW)) + 'px';
        box.style.padding = '';
        var mw = Math.max(BAND_STACKED, Math.round(RW / z) - 2 * BAND_BESIDE_GUTTER) + 'px';
        if (card.style.maxWidth !== mw) {
          card.style.maxWidth = mw;
          // the band redraws its columns for the new width a moment later
          // (its own ResizeObserver): centre it again once it has
          setTimeout(function () { if (fband === card && card.isConnected) centerBand(card); }, 350);
        }
      } else {
        box.style.height = ''; box.style.padding = ''; card.style.maxWidth = '';
      }
    }
    var lo = Infinity, hi = -Infinity;
    sr.querySelectorAll('.now > *, .cell > *').forEach(function (e) {
      var q = e.getBoundingClientRect();
      if (q.width) { lo = Math.min(lo, q.left); hi = Math.max(hi, q.right); }
    });
    if (!(hi > lo)) return;
    var cur = parseFloat(card.style.getPropertyValue('--hk-band-shift')) || 0;
    // (the shift is in the band's own pixels, which the zoom scales)
    // (a pane on the left: the room starts at its edge)
    var x0 = paneUp && cfg && cfg.pane_side === 'left' ? paneW : 0;
    var want = Math.round(cur + ((x0 + RW - hi) - (lo - x0)) / 2 / z);
    if (Math.abs(want - cur) >= 1) card.style.setProperty('--hk-band-shift', want + 'px');
  }
  // KIOSK SATELLITE'S DARK. Its API is promise-based, so it cannot be asked
  // inline the way Fully is below; it announces its screensaver and the panel
  // power as window events instead, and these follow them. Its screensaver
  // usually also hides the page (Pause dashboard during screensaver), but
  // that is a setting, so the events are the fact.
  // (Listened for on any page: nothing else fires them.)
  var ksSaver = false, ksOff = false, hkOn = false;
  // UNDER A BLACK: the kiosk's Black screensaver, its panel off, or HK's own
  // (Black Screen: HK Frontend, below)
  function black() { return ksSaver || ksOff || hkOn; }
  var wasBlack = false, downOpts = null;
  function blackChanged() {
    var now = black();
    if (now === wasBlack) return;
    wasBlack = now;
    if (now) { downOpts = null; curtainUp(); goDark(); }
    else { var d = downOpts; downOpts = null; lit(); lightSoon(); litNow(); curtainDown(d); }
    tellBlack(now);
  }
  // OUR OWN CURTAIN UNDER THE KIOSK'S BLACK (2026-10-09). As the black
  // comes down the tablet draws the whole page again, and its largest layers
  // -- the sky's scenery -- arrive two or three frames after the rest: the
  // bottom of the screen showed bare sky for a moment (screen-recorded on the
  // Loft, at a fixed 60 Hz, two wakes in five). So a plain black layer goes
  // up over everything as the kiosk's black does -- one solid color, nothing
  // to draw late -- and comes away only once the page has drawn: two frames,
  // CURTAIN_HOLD, then a CURTAIN_FADE fade. Never held longer than
  // CURTAIN_MAX after the black ends, frames or none.
  //
  // IT IS ALSO HK'S OWN BLACK SCREEN (Black Screen: HK Frontend, below): it
  // then catches taps (a tap wakes the screen, and is swallowed -- the card
  // under it is not pressed), and as it fades the backlight comes up with it
  // (onFade). Out of HK's own black it comes down sooner, CURTAIN_HOLD_HK: the
  // page was drawn under it all along.
  var curtain = null, curtainRun = 0, CURTAIN_HOLD = 300, CURTAIN_HOLD_HK = 60, CURTAIN_FADE = 450, CURTAIN_MAX = 2000;
  function curtainUp() {
    curtainRun++;
    if (drawCurtain()) bootCover(false);
  }
  // the curtain on the page, opaque, now
  function drawCurtain() {
    if (!document.body || typeof document.createElement !== 'function') return false;
    if (!curtain) {
      curtain = document.createElement('div');
      curtain.setAttribute('data-hk-curtain', '');
      if (curtain.addEventListener) curtain.addEventListener('pointerdown', curtainTapped, true);
    }
    var cs = curtain.style;
    cs.position = 'fixed'; cs.inset = '0'; cs.top = cs.left = '0'; cs.width = '100vw'; cs.height = '100vh';
    cs.zIndex = '2147483647'; cs.background = '#000'; cs.pointerEvents = hkOn ? 'auto' : 'none';
    cs.transition = 'none'; cs.opacity = '1';
    if (curtain.parentNode !== document.body) document.body.appendChild(curtain);
    return true;
  }
  // `opts`: { hold: ms after two frames, onFade: called as the fade starts }
  function curtainDown(opts) {
    opts = opts || {};
    if (black()) return;
    // no curtain to fade (a page that never drew one): the backlight all the same
    if (!curtain || !curtain.parentNode) { if (opts.onFade) { try { opts.onFade(); } catch (e) { /* none */ } } return; }
    var run = ++curtainRun, c = curtain, going = false;
    var go = function () {
      if (going || run !== curtainRun) return;
      going = true;
      c.style.transition = 'opacity ' + CURTAIN_FADE + 'ms ease';
      c.style.opacity = '0';
      if (opts.onFade) { try { opts.onFade(); } catch (e) { /* the curtain goes all the same */ } }
      // a tap still catching it is swallowed until it is gone
      setTimeout(function () { if (run === curtainRun && c.parentNode) c.remove(); }, CURTAIN_FADE + 80);
    };
    setTimeout(go, CURTAIN_MAX);
    if (typeof requestAnimationFrame !== 'function') return;
    var f1 = false, f2 = false;                // each frame's step once
    requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
      if (f2) return; f2 = true;
      setTimeout(go, opts.hold != null ? opts.hold : CURTAIN_HOLD);
    }); });
  }
  function curtainTapped(e) {
    if (!hkOn) return;
    if (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
    hkTapWake();
  }

  // ------------------------------------------------------------ HK's own black
  // BLACK SCREEN: HK FRONTEND (2026-10-09; a screen's When Idle -> Black
  // Screen). In place of Kiosk Satellite's Black screensaver, the screen's
  // black is this page's: the curtain over everything, the sky and the cards
  // held, and the backlight at its lowest (Kiosk Satellite's page API --
  // setBrightness(0) is the same minimum its own black uses, measured). The
  // house turns switch.<screen>_black_screen on and off
  // (hk_frontend.set_black_screen, which also carries the brightness to come
  // back to); the page says when it is black (the sleep waits for that, and
  // falls back to Kiosk's black without it), and a tap on the curtain wakes
  // it at once, here, and turns the switch off. Only on the screen's own
  // tablet, as for the photos: a desk showing the same screen never goes
  // black. docs/TABLET-INVARIANTS.md 16p.
  var hkRun = 0, hkAcked = false, hkDown = false, hkAckTry = 0, hkWokeAt = 0, HK_WOKE_HOLD = 6000, hkFirst = true;
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
    if (framed || previewOn || force) return false;
    if (/[?&](hk_saver|wp_enabled)=(force|off|false)\b/.test(location.search)) return false;
    if (!b.black_switch) return live ? false : null;
    if (!cfg) return null;
    if (!mine()) return false;
    // woken by a tap a moment ago: the switch is on its way off
    if (clock.now() - hkWokeAt < HK_WOKE_HOLD) return false;
    var st = h && h.states && h.states[b.black_switch];
    return st ? st.state === 'on' : null;
  }
  function hkAck(on) {
    var t = hkBoard();
    sendWS(t && !t.legacy ? { type: 'hk_frontend/screensaver/black', tablet: t.id, black: on }
                          : { type: 'hk_frontend/screensaver/black', dashboard: dashSeg(), black: on })
      .then(function () { if (on) hkAcked = true; }, function () { /* older integration: the sleep falls back */ });
  }
  // black: once the curtain is drawn, the backlight down, then say so
  function hkDarken() {
    var run = ++hkRun, done = false;
    var go = function () {
      if (done || run !== hkRun || !hkOn) return;
      done = true;
      var k = kiosk(), down = function () { if (run === hkRun && hkOn) { setBacklight(0); hkDown = true; hkAckTry = clock.now(); hkAck(true); } };
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
    downOpts = { hold: CURTAIN_HOLD_HK, onFade: function () { if (v != null) rampBacklight(v, CURTAIN_FADE); } };
    blackChanged();
  }
  // every new client and every settings change
  function hkSync(h) {
    h = h || clientNow();
    var want = hkWanted(h);
    if (want === null) return;                 // not known yet: as it is
    var first = hkFirst;
    hkFirst = false;
    if (want === hkOn) {
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
    hkOn = want;
    if (want) { store(BLACK_KEY, dashSeg()); blackChanged(); if (curtain) curtain.style.pointerEvents = 'auto'; hkDarken(); }
    else hkLeave(h);
  }
  // a tap on the curtain: awake now, here -- the house hears it from the
  // switch going off and from the touch
  function hkTapWake() {
    if (!hkOn) return;
    hkWokeAt = clock.now();
    hkOn = false;
    hkAck(false);
    touchSent = 0; reportTouch();
    lastInput = Date.now();
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
    if (!fade || (curtain && curtain.parentNode)) { el.remove(); return; }
    curtainRun++;
    var drawn = drawCurtain(), v = wakeBrightness(h);
    el.remove();
    if (drawn) curtainDown({ hold: 0, onFade: function () { if (v != null) rampBacklight(v, CURTAIN_FADE); } });
  }
  // UNDER THE KIOSK'S BLACK, BLACK (2026-10-09). The tablet stops drawing
  // the page under it and, as it comes down, shows the last frame the page
  // drew until the page draws again: the photos as they were when the
  // tablet slept -- a stale photo flashed before the fade to the dashboard
  // (screen-recorded on the Living Room tablet, 0.9 s of it). So the
  // screensaver goes plain black at once, its photos out of sight. The
  // dashboard is NOT let go under it (and a pending cover is dropped): one
  // hidden there is drawn again from nothing as the black comes down.
  // BLACK WHILE IT WAS STILL STARTING: never really shown -- still getting
  // ready, or fading in for under SHOWN_MIN. The house's sleep turns the
  // photos on 0.1-0.2 s before the black goes up; turned black, a start
  // like that left the tablet showing the dashboard it had drawn, yet the
  // wake went through black: dashboard, black, dashboard (screen-recorded on
  // the Loft, a real sleep). Such a start is taken back instead, as if it
  // had never begun, and asks again once the black has ended (start()).
  var shownAt = 0, SHOWN_MIN = 500;
  function unstart() {
    on = false; entrance = null; photoRun++; busy = false; queued = null; lightRun++;
    if (coverT) { clearTimeout(coverT); coverT = null; }
    if (slideT) { clearTimeout(slideT); slideT = null; }
    teardown();
    tellOthers();
  }
  // UNDER THE KIOSK'S BLACK, THE DASHBOARD COMES BACK -- whatever had been
  // shown (2026-10-09, with Kiosk Satellite's "Pause dashboard during
  // screensaver" OFF on every tablet). Off, the tablet keeps the page it
  // drew and still draws for ~2 s after the black goes up, so the
  // screensaver taken down there leaves a whole, drawn dashboard to wake
  // onto. Kept up (dark) instead, it was put away at the wake itself, the
  // one moment a tablet cannot draw in time: a half-drawn dashboard, then
  // black, then the fade (screen-recorded on the Loft). The photos come back
  // after the black ends if they are still wanted (start(): LIT_GRACE).
  var DARK_UNDER_BLACK = false;
  function goDark() {
    if (!on || !host) return;
    if (!DARK_UNDER_BLACK || host.hasAttribute('prep') || !shownAt || clock.now() - shownAt < SHOWN_MIN) { unstart(); return; }
    entrance = null; lightRun++;
    host.style.setProperty('--fade', '0ms');
    host.style.setProperty('--blk', '0ms');
    host.removeAttribute('prep');
    host.removeAttribute('undark');
    host.setAttribute('dark', '');
    host.setAttribute('on', '');
    if (coverT) { clearTimeout(coverT); coverT = null; }
    noteDrawn();
  }
  // ...and as it ends. The house's wake turns the photos off under the
  // black, and stop() fades from black to the dashboard. Still on after
  // LIGHT_WAIT (a tap ended the black, and the house -- which turns the
  // photos off within 2 s of a tap -- still wants them): the photos come
  // back out of the black, drawn under .blk for two frames, then its fade
  // off them. Not sooner: the photos for a moment, then the dashboard, was
  // a flash of the wrong thing.
  var LIGHT_WAIT = 2500, LIGHT_FADE = 600, lightRun = 0;
  // THE BLACK HAS ENDED: as good as a touch (no screensaver straight back by
  // idle), and the switch is heard again after LIT_GRACE (start())
  var LIT_GRACE = 2500, litAt = 0;
  function litNow() {
    if (black()) return;
    litAt = clock.now();
    lastInput = Date.now();
    armIdle();
    // the photos' timer, held under the black (schedule()), runs again
    if (slideHeld) { slideHeld = false; if (on && cfg && mode === 'photos' && !busy) schedule(); }
    setTimeout(function () { var h = clientNow(); if (h && !on) onUpdate(h); }, LIT_GRACE + 50);
  }
  function lightSoon() {
    if (black() || !on || !host || !host.hasAttribute('dark')) return;
    var h = host, run = ++lightRun;
    var still = function () { return !black() && on && host === h && lightRun === run && h.hasAttribute('dark'); };
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
        noteDrawn();
      }); });
    }, LIGHT_WAIT);
  }
  // Every few seconds: the sky follows the sun and the weather; it holds still
  // while the screen is dark (the kiosk's own screensaver or screen off --
  // the page cannot tell, so Fully is asked and Kiosk Satellite is listened
  // to -- or a hidden page); and the corner rows stay above the band.
  function forecastTick(force) {
    var h = clientNow();
    if (fscene && h && h.states) {
      var HS = window.hkSettings, sun = h.states['sun.sun'];
      var wid = HS && HS.weatherId ? HS.weatherId(h.states) : null, w = wid && h.states[wid];
      var sig = (sun ? sun.last_updated : '') + '|' + (w ? w.last_updated : '') + '|' + Math.floor(Date.now() / 600000);
      if (force || sig !== fSig) {
        fSig = sig;
        try { fSky = fscene.update(h) || null; } catch (e) { console.warn('[hk-saver] forecast sky', e); }
        // Big Weather's planted time is lit by the same reading (and a layout's)
        if (bigCtl && bigCtl.light) bigCtl.light(fSky);
        if (ly) layoutSoon();
      }
    }
    var F = window.fully, dark = !!document.hidden || black();
    try {
      if (F && ((typeof F.isInScreensaver === 'function' && F.isInScreensaver()) ||
                (typeof F.getScreenOn === 'function' && F.getScreenOn() === false))) dark = true;
    } catch (e) { /* no Fully interface */ }
    // not on screen (between forecast slides) holds still too
    if (fscene) fscene.pause(dark || !fcVisible());
    layoutPane();
    if (enShowing) energyLayout();
    if (wxShowing) weatherLayout();
    // The band is measured and centred only while it shows: it was every
    // tick (~20 rects each) for the whole of a Photos & Forecast session,
    // between forecast slides and under the black as well. Shown again, it
    // is centred at once (showForecastSlide / enterForecast force a tick).
    if (host && root) {
      var b = !dark && host.hasAttribute('band') && fband && fband.isConnected ? fband : null;
      var r = b && b.getBoundingClientRect();
      if (b) centerBand(b);
      if (b && r && r.height) host.style.setProperty('--hk-ss-corner-bottom', Math.round((window.innerHeight || 0) - r.top + 18) + 'px');
      else if (!dark && host.style.removeProperty) host.style.removeProperty('--hk-ss-corner-bottom');
    }
  }

  // compared as written: a block made from the settings is a new object
  // every time
  var lastRaw = '';
  function refresh() {
    var conf = dashConf();
    var raw = conf && conf.hk_screensaver;
    if (conf && raw === undefined) raw = fromSettings(conf);
    // A HOST WITH NO LOVELACE drew the screen from the strategy once, at its
    // load: the block it made then names the tablet's switch only if that
    // switch's state was already there (hk-strategy.js screensaverOf), and
    // Mantel's own arrive a moment after its settings. The settings make the
    // same block again, now -- else the one the strategy made.
    else if (shellConf && raw && !raw.entity) raw = fromSettings(conf) || raw;
    var picked = designController && designController.options();
    if (!previewOn && picked) raw = houseBlock(picked) || raw;
    if (previewOn && previewHouse) raw = houseBlock() || raw;
    if (previewOn && previewOver) raw = houseBlock(previewOver) || raw;
    var HS = window.hkSettings;
    if (raw && HS && HS.get) {
      var bAll = HS.get('boards', null), bNow = bAll && bAll[String(location.pathname).split('/')[1] || ''];
      var pvPane = previewPaneOf((bNow && bNow.side_pane_read) || HS.get('side_pane', null), previewOn ? previewPane : null);
      raw = withPane(raw, pvPane.settings); previewPaneNote = previewOn ? pvPane.message : '';
    }
    var SP = window.hkSidePane;
    if (raw && SP && SP.placement(window.innerWidth, window.innerHeight, { width: raw.pane_width }).kind === 'none') raw = Object.assign({}, raw, { calendar: false, music_pane: false, pane_list: null });
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
    if (key !== lastRaw) {
      lastRaw = key;
      var was = cfg;
      cfg = readCfg(raw);
      if (was && on && !previewOn && cfg) { var reason = startedBy; stop('appearance'); teardown(); start(reason); }
      // the preview follows the settings page: rebuilt with the new options
      // -- or, when only the photos' layout changed, laid out again in place
      if (previewOn && on && cfg) {
        // ...or only the clock's face changed (its style, 24-hour): drawn again
        // where it is, no fade out and in -- a style can be judged as chosen
        if (was && sansSlides(was) === sansSlides(cfg) && slidesAgain()) { /* the slide's parts again */ }
        else if (was && sansShapes(was) === sansShapes(cfg) && relayout()) { /* laid out again */ }
        else if (was && sansClock(was) === sansClock(cfg) && remountClock()) { /* the clock again */ }
        else setTimeout(restartPreview, 0);
      }
      // ...and a preview asked for before there was a config (the frame's
      // dashboard, or its settings, still arriving) starts once there is one
      if (previewOn && !on && cfg) setTimeout(function () { if (previewOn && !on && cfg) start('preview'); }, 0);
      // turned off while it shows: its switch goes off too (stop('config') alone left it on, and turning the
      // screensaver back on started it at once, "by the switch", instead of after Starts After)
      if (!cfg && on) { writeSwitch('off', was); stop('config'); }
      if (deck && cfg && deck.order !== cfg.order) deck = null;
      // a new Starts After counts from the last touch now, not when the old (longer) timer runs out
      if (was && cfg && !on && idleT) armIdle();
    }
    if (!cfg) { if (idleT) { clearTimeout(idleT); idleT = null; } return; }
    if (!allowed()) { if (on) { writeSwitch('off'); stop('config'); } if (idleT) { clearTimeout(idleT); idleT = null; } return; }
    if (!idleT && !on) armIdle();
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
  // (`clock`: the tests drive it; the page reads the wall clock)
  var RESUME_MS = 2500, clock = { now: function () { return Date.now(); } };
  var resumedAt = 0, lastBeat = clock.now();
  function beat() {
    if (previewOn && previewSelected) syncPreviewSlide();
    var n = clock.now();
    if (n - lastBeat > RESUME_MS) resumedAt = n;
    lastBeat = n;
  }
  function justResumed() {
    var n = clock.now();
    return n - resumedAt < RESUME_MS || n - lastBeat > RESUME_MS;
  }
  var hubOff = null;
  function hookClient() {
    if (hubOff || !(window.hkCards && window.hkCards.onClient)) return false;
    hubOff = window.hkCards.onClient(function (h) { refreshSoon(); onUpdate(h); if (on) musicWatch(); });
    if (window.hkMusic && window.hkMusic.onChange) window.hkMusic.onChange(function () {
      if (on) { mus.watchAt = 0; musicWatch(); }
    });
    return true;
  }

  function kit() {
    return {
      autoLayout: autoLayout, BAND_H: BAND_H, BAND_MAX: BAND_MAX, BAND_PAD: BAND_PAD, BAND_W: BAND_W,
      BAND_ZONE: BAND_ZONE, clock: clock, CROSSFADE_MS: CROSSFADE_MS, dashConf: dashConf,
      DEFAULT_CARD_WIDTH: DEFAULT_CARD_WIDTH, EDGE: EDGE, FADE_BACK_MS: FADE_BACK_MS, layoutMusic: layoutMusic, layoutSoon: layoutSoon,
      MU_ART_MS: MU_ART_MS, PANE_TOP: PANE_TOP, PANE_W: PANE_W, refresh: refresh, WAKE: WAKE, ZOOM: ZOOM, dashWatch: dashWatch, musicAct: musicAct, renderMusic: renderMusic, musicTick: musicTick, layoutModules: layoutModules, panelDone: function (v) { if (pnl && pnl.view === v) closePanel(false); }, clock24: function () { return !!(cfg && cfg.clock_24); } // (the last seven: the Now Playing page, hk-saver-pane.js)
    };
  }
  function runParts() {
    var K = kit();
    PARTS.forEach(function (file) { window.hkSaverParts[partKey(file)](K); });
    Deck = K.Deck; inPane = function (e) { return K.inPane(e, paneEl, paneUp); };
    designController = K.createDesignController({ client: K.clientNow, running: function () { return on; }, preview: function () { return previewOn; }, touched: saverTouched, stop: stop, refresh: refresh });
    actionsNow = K.actionsNow; afterDraw = K.afterDraw; afterFade = K.afterFade; alignOf = K.alignOf;
    ANALOG = K.ANALOG; BACKDROP_SMALL = K.BACKDROP_SMALL; backdropSmall = K.backdropSmall; behindAt = K.behindAt;
    BLACK_KEY = K.BLACK_KEY; blackPage = K.blackPage; BRIGHT_KEY = K.BRIGHT_KEY; callWS = K.callWS; ckFx = K.ckFx;
    cleanDepth = K.cleanDepth; cleanFocus = K.cleanFocus; cleanVariants = K.cleanVariants;
    clearCanvas = K.clearCanvas; clientNow = K.clientNow; coverRect = K.coverRect; coverShare = K.coverShare;
    CSS = K.CSS; DASH_CSS = K.DASH_CSS; DASH_SWIPE = K.DASH_SWIPE; dashLive = K.dashLive; dashSeg = K.dashSeg;
    dashViews = K.dashViews; DAY_GAP = K.DAY_GAP; deg = K.deg; drawBackdrop = K.drawBackdrop; drawMusic = K.drawMusic;
    drawnRect = K.drawnRect; elapsed = K.elapsed; energyPage = K.energyPage; EX_PREVIEW_MS = K.EX_PREVIEW_MS;
    EXTRA_ORDER = K.EXTRA_ORDER; extrasOf = K.extrasOf; FACE_SHOWS = K.FACE_SHOWS; faceOrigin = K.faceOrigin;
    facesModule = K.facesModule; faceWindow = K.faceWindow; FC_TICK_MS = K.FC_TICK_MS; feedCard = K.feedCard;
    faceScale = K.faceScale; fitOf = K.fitOf; FOCUS_F = K.FOCUS_F; framed = K.framed; fromSettings = K.fromSettings; gate = K.gate;
    glyphBox = K.glyphBox; go = K.go; held = K.held; hkBoard = K.hkBoard; hkUnheard = K.hkUnheard;
    hostPhotoList = K.hostPhotoList; hostPhotoSource = K.hostPhotoSource; houseBlock = K.houseBlock; inkOf = K.inkOf;
    INKS = K.INKS; isFlat = K.isFlat; isImage = K.isImage; kiosk = K.kiosk; LANDSCAPES = K.LANDSCAPES;
    landShares = K.landShares; layoutOf = K.layoutOf; layoutMusicView = K.layoutMusicView; load = K.load; minsOf = K.minsOf; mmss = K.mmss;
    MOSAIC_COLORS = K.MOSAIC_COLORS; mosaicAssign = K.mosaicAssign; mosaicPlan = K.mosaicPlan; MOSAICS = K.MOSAICS;
    MU_BG = K.MU_BG; MU_GRACE = K.MU_GRACE; MU_SLOP = K.MU_SLOP; muGrace = K.muGrace; mus = K.mus;
    previewMusicData = K.previewMusicData; previewPaneOf = K.previewPaneOf; musicParts = K.musicParts; musicHas = K.musicHas; musicNow = K.musicNow; musicOf = K.musicOf; musicPage = K.musicPage;
    musicPaneView = K.musicPaneView; musicPlaying = K.musicPlaying; musicUsed = K.musicUsed; musicView = K.musicView;
    nextArt = K.nextArt; PANE_OWN = K.PANE_OWN; PANE_VARS = K.PANE_VARS; panel = K.panel; PANEL_IDLE = K.PANEL_IDLE;
    PANEL_TURN = K.PANEL_TURN; paneOf = K.paneOf; photoLum = K.photoLum; photoOpts = K.photoOpts;
    photoUrl = K.photoUrl; pieceFile = K.pieceFile; piecesStarted = K.piecesStarted; progress = K.progress;
    rampBacklight = K.rampBacklight; readCfg = K.readCfg; reducedMotion = K.reducedMotion;
    refreshSoon = K.refreshSoon; rememberedTabletId = K.rememberedTabletId; sansClock = K.sansClock;
    sansShapes = K.sansShapes; sansSlides = K.sansSlides; scaleOf = K.scaleOf; sendWS = K.sendWS; setAttr = K.setAttr;
    setBacklight = K.setBacklight; shapeOfPh = K.shapeOfPh; shuffle = K.shuffle; sigOf = K.sigOf;
    slideMarks = K.slideMarks; slideOf = K.slideOf; slideView = K.slideView; SLOP = K.SLOP; store = K.store;
    sunDown = K.sunDown; tabletId = K.tabletId; tagOf = K.tagOf; TB_COVER = K.TB_COVER; TB_WAIT = K.TB_WAIT;
    tbKey = K.tbKey; tbShare = K.tbShare; tbShares = K.tbShares; tellBlack = K.tellBlack; textBox = K.textBox;
    turnOf = K.turnOf; upNextPiece = K.upNextPiece; user = K.user; viewFont = K.viewFont; volEnd = K.volEnd;
    volFrom = K.volFrom; wakeBrightness = K.wakeBrightness; weatherEntity = K.weatherEntity;
    weatherPage = K.weatherPage; within = K.within; withPane = K.withPane; zoneOf = K.zoneOf; if (K.PageCard && window.hkHostClient && !customElements.get('hk-now-playing-page-card')) { window.hkHostClient.entry(K.PageCard); customElements.define('hk-now-playing-page-card', K.PageCard); }   // (the Now Playing page, hk-saver-pane.js)
  }

  loadParts(function () {
    runParts();

    ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'wheel', 'keydown', 'click', 'mousedown', 'pointermove']
      .forEach(function (t) { window.addEventListener(t, onInput, { passive: true, capture: true }); });
    // the touch that stopped it, lifting
    ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach(function (t) {
      window.addEventListener(t, function () { if (press && press.up === null) press.up = clock.now(); if (mus.drag) volEnd(); }, { passive: true, capture: true });
    });
    if (!customElements.get('hk-music-pane-card')) {
      var MusicPane = class extends /** @type {HkLooseElementConstructor} */ (HTMLElement) {
        constructor() {
          super();
          this._root = this.attachShadow({ mode: 'open' });
        }
        setConfig(c) { this._config = c || {}; }
        getCardSize() { return 0; }
        // Lovelace's entry (hkHostClient.entry below) hands each new client here
        _onClient() { if (this._v && this._v.live) dashWatch(); }
        connectedCallback() {
          if (!this._root.querySelector('.pane')) this._make();
          this._adopt();
          this._size();
          if (this._want) this.active(true);
        }
        disconnectedCallback() {
          var v = this._v;
          // (only the card holding the view lets it rest: one a new page's
          // card has taken it from keeps drawing there)
          if (!v || v.host !== this) return;
          if (pnl && pnl.view === v) closePanel(false);
          v.live = false;
          musicTick();
        }
        // the shared view, into this card's pane
        _adopt() {
          var v = this._v = dashV, box = this._root.querySelector('.pane');
          if (v.host === this && v.el.parentNode === box) return;
          if (pnl && pnl.view === v && v.host !== this) closePanel(false);
          v.host = this; v.root = this._root; v.box = box; v.z = null;
          box.appendChild(v.el);
        }
        // shown (the pop-up a pane) or not (the bar): drawn and ticking only shown
        active(want) {
          this._want = !!want;
          var v = this._v;
          if (!v) return;
          if (want && this.isConnected) this._adopt();
          else if (v.host !== this) return;
          var was = v.live;
          v.live = this._want && this.isConnected;
          if (v.live) { this._size(); if (!was) { dashAt = 0; renderMusic(); } }
          else if (pnl && pnl.view === v) closePanel(false);
          musicTick();
        }
        // WHEN IT WAS LAST IN USE (hk-popup.js holds the sheet a grace after):
        // its panel open is now; else the last touch on it
        hkLastUse() {
          var v = this._v;
          if (v && v.host === this && pnl && pnl.view === v) return Date.now();
          return this._usedAt || 0;
        }
        // ready to be seen: its music drawn and its art in (or none to wait for)
        whenReady() {
          var v = this._v;
          if (!v) return Promise.resolve();
          if (!v.live) this.active(true);
          return Promise.resolve(v.ready).then(function () { return v.ready; });
        }
        // its scale: the screensaver's pane is 400 px at z 1
        _size() {
          var v = this._v, w = this.getBoundingClientRect().width || parseFloat(getComputedStyle(this).getPropertyValue('--hk-pane-w')) || 400;
          var z = Math.max(0.85, Math.min(1.3, w / PANE_W));
          if (v.z === z) return;
          v.z = z;
          var px = function (n) { return Math.round(n * z) + 'px'; };
          this.style.setProperty('--hk-mu-z', String(z));
          this.style.setProperty('--hk-pane-pad', px(28));
          this.style.setProperty('--hk-pane-top', px(30));
          this.style.setProperty('--hk-pm-foot', px(26));
        }
        _make() {
          var r = this._root, self = this;
          var css = CSS.slice(CSS.indexOf('.pane{position:absolute'));
          window.hkCards.flatSurface(this, 'music');
          r.innerHTML = '<style>' + css + '\n' + DASH_CSS + window.hkCards.flatCss() +
            ':host([hk-flat]) .pm{background:#24252A!important;color:#F5F4F0;--hk-ink:#F5F4F0;--hk-ink-2:#C3C3C6;--hk-ink-3:#A3A4A9;--hk-glyph:#F5F4F0;--hk-key:#3A3B40;--hk-line:#48494F;--hk-line-strong:#62636A}' +
            ':host([hk-flat]) .mbgf,:host([hk-flat]) .mshade{display:none}' +
            ':host([hk-flat]) .pane,:host([hk-flat]) .mpanel{box-shadow:var(--hk-flat-elevated-shadow)!important;background:#24252A}' +
            // IN THE SIDE PANE (nobg, hk-sidepane.js): on the pane's own album-art
            // backdrop -- none of its own, no box (2026-10-30)
            ':host([nobg]) .mbgf,:host([nobg]) .mshade{display:none!important}' +
            ':host([nobg]) .pane,:host([nobg]) .pm,:host([nobg]) .mu{background:none!important;box-shadow:none!important;border:0!important}' +
            // COMPACT (the Side Pane's More): the player without Up Next and the
            // album, its art smaller (2026-10-30)
            ':host([compact]) .mnext,:host([compact]) .malbum{display:none!important}' +
            ':host([compact]) .mart{width:70%!important;margin-left:auto!important;margin-right:auto!important}' + '</style><div class="pane"></div>';
          this.addEventListener('pointerdown', function () { self._usedAt = Date.now(); }, true);
          // the screensaver's pane, as its host's attributes draw it
          ['panecfg', 'pane', 'pm'].forEach(function (a) { self.setAttribute(a, ''); });
          this._swipe();
          if (dashV) return;
          // THE VIEW, made once (dashV): its taps are wired on it, so they
          // work in whichever card holds it
          var v = dashV = musicView('dash');
          v.live = false;
          if (!window.hkSaverPanel) v.el.setAttribute('nomx', '');
          // ITS BUTTONS, the art (Play Music) and the volume (dragged), as a
          // tap on the screensaver's does -- by the element, not the place
          v.el.addEventListener('click', function (e) {
            var sw = v.host && v.host._swallow;
            if (sw && Date.now() - sw < 400) return;
            var b = e.target.closest ? e.target.closest('.mbtn') : null;
            if (b) { musicAct({ btn: b, view: v }); return; }
            if (e.target.closest && e.target.closest('.msq')) musicAct({ art: true, view: v });
          });
          var vt = v.vt;
          vt.addEventListener('pointerdown', function (e) {
            if (v.el.hasAttribute('novol')) return;
            e.preventDefault(); e.stopPropagation();
            try { vt.setPointerCapture(e.pointerId); } catch (x) { /* gone */ }
            musicAct({ vol: true, view: v }, e.clientX);
          });
          vt.addEventListener('pointermove', function (e) { if (mus.drag && mus.drag.view === v) volFrom(e.clientX); });
          var up = function () { if (mus.drag && mus.drag.view === v) volEnd(); };
          vt.addEventListener('pointerup', up);
          vt.addEventListener('pointercancel', up);
        }
        // SWIPED TOWARD ITS EDGE, PUT AWAY: the bar's swipe down, sideways --
        // the docked sheet follows the finger and goes past 35% of its width or
        // on a flick, else springs back; then hk-popup's own close (the hash
        // cleared), which with `dismissable` leaves the stash button
        _swipe() {
          var self = this, d = null;
          var sheetOf = function () {
            var n = /** @type {any} */ (self.parentNode);
            while (n && !(n.classList && n.classList.contains('sheet'))) n = n.parentNode;
            return n;
          };
          this.addEventListener('pointerdown', function (ev) {
            if (d || !self._v || (pnl && pnl.view === self._v) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
            var path = ev.composedPath ? ev.composedPath() : [];
            if (path.indexOf(self._v.vt) >= 0) return;
            var sh = sheetOf();
            if (!sh) return;
            d = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sh: sh, w: sh.offsetWidth || 400, on: false,
                  dir: self.getAttribute('side') === 'left' ? -1 : 1, last: [ev.timeStamp, ev.clientX], prev: null };
          });
          this.addEventListener('pointermove', function (ev) {
            if (!d || ev.pointerId !== d.id) return;
            var dx = (ev.clientX - d.x) * d.dir, dy = ev.clientY - d.y;
            if (!d.on) {
              if (Math.abs(dy) > DASH_SWIPE && Math.abs(dy) > Math.abs(dx)) { d = null; return; }
              if (dx < -DASH_SWIPE) { d = null; return; }
              if (!(dx > DASH_SWIPE && dx > Math.abs(dy) * 1.4)) return;
              d.on = true;
              try { self.setPointerCapture(d.id); } catch (x) { /* gone */ }
              d.sh.style.transition = 'none';
            }
            d.sh.style.transform = 'translateX(' + (d.dir * Math.max(0, dx - DASH_SWIPE)) + 'px)';
            d.prev = d.last; d.last = [ev.timeStamp, ev.clientX];
          });
          var end = function (ev) {
            if (!d || ev.pointerId !== d.id) return;
            var g = d, sh = g.sh;
            d = null;
            if (!g.on) return;
            self._swallow = Date.now();
            var x = (ev.clientX - g.x) * g.dir - DASH_SWIPE;
            var vel = g.prev ? (g.last[1] - g.prev[1]) * g.dir / Math.max(1, g.last[0] - g.prev[0]) : 0;
            if (ev.type === 'pointerup' && (x > g.w * 0.35 || (vel > 0.5 && x > 20))) {
              sh.style.transition = 'transform .2s cubic-bezier(.4,0,1,1)';
              sh.style.transform = 'translateX(' + (g.dir * 104) + '%)';
              setTimeout(function () {
                if (location.hash) {
                  history.replaceState(null, '', location.pathname + location.search);
                  window.dispatchEvent(new HashChangeEvent('hashchange'));
                }
                sh.style.transition = ''; sh.style.transform = '';
              }, 200);
            } else {
              sh.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
              sh.style.transform = '';
              setTimeout(function () { if (!sh.style.transform) sh.style.transition = ''; }, 300);
            }
          };
          this.addEventListener('pointerup', end);
          this.addEventListener('pointercancel', end);
        }
      };
      window.hkHostClient.entry(MusicPane);
      customElements.define('hk-music-pane-card', MusicPane);
    }
    window.addEventListener('kiosksatellite:screensaverstart', function () { ksSaver = true; blackChanged(); });
    window.addEventListener('kiosksatellite:screensaverstop', function () { ksSaver = false; blackChanged(); });
    window.addEventListener('kiosksatellite:screenoff', function () { ksOff = true; blackChanged(); });
    window.addEventListener('kiosksatellite:screenon', function () { ksOff = false; blackChanged(); });
    try {
      var HS0 = window.hkSettings;
      if (HS0 && HS0.onChange) HS0.onChange(function () { hkSync(); });
    } catch (e) { /* no settings module (a test harness) */ }
    window.addEventListener('hk-module-ready', function (e) {
      if (e.detail && e.detail.module === 'hk-settings') { refresh(); mus.views.forEach(function (v) {
        var flat = isFlat();
        if (v.flat === flat) return;
        v.flat = flat;
        if (flat) v.bg.forEach(function (c) { clearCanvas(c); c.remove(); });
        else v.bgf.forEach(function (f) { var c = document.createElement('canvas'); c.className = 'mbg'; c.width = MU_BG; c.height = MU_BG; f.appendChild(c); });
        v.bg = v.el.querySelectorAll('canvas.mbg'); v.pic = null;
      }); renderMusic(); }
    });
    window.hkShell.onNavigate(function () { setTimeout(refresh, 0); });
    window.addEventListener('popstate', function () { setTimeout(refresh, 0); });
    window.addEventListener('resize', function () { if (on) { if (previewOn) refresh(); layoutPane(); layoutMusic(); placePanel(); setTimeout(dayFit, 50); } });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { lastInput = Date.now(); armIdle(); resumedAt = clock.now(); }
      musicTick();
    });
    setInterval(beat, 1000);
    // hk-base (the cards) loads after this module; until it does, poll lightly
    (function wait(n) {
      refresh();
      var h = clientNow();
      if (h) onUpdate(h);
      if (hookClient()) return;
      setTimeout(function () { wait(n + 1); }, n < 60 ? 1000 : 5000);
    })(0);

    window.hkSaver = {
      // THE PLAN IT DREW (2026-11-01, the Screensaver editor's overlay: the zones as the screen places them, never as
      // the editor guesses): the room, the plan's boxes and the zones, in this page's px; null without a layout
      // THE EDITOR'S SEE A SLIDE AND DAY / NIGHT (phase 13): in the preview only -- a slide shown now, with its slide
      // corner (null: none), and Night Mode on or off whatever the hour (null: as the clock says). Nothing is saved
      previewSlide: function (kind) {
        kind = ['music', 'weather', 'energy', 'forecast'].indexOf(kind) >= 0 ? kind : '';
        var changed = previewSelected !== kind;
        previewSelected = kind;
        if (!on || !previewOn) return false;
        if (changed) {
          if (muShowing) hideMusicSlide();
          if (wxShowing) hideWeatherSlide();
          if (enShowing) hideEnergySlide();
          if (fcShowing && mode !== 'forecast') hideForecastExtra();
          exKind = '';
          if (exT) { clearTimeout(exT); exT = null; }
          if (kind === 'energy') energyPrep();
          if (kind === 'weather') weatherPrep();
        }
        return syncPreviewSlide();
      },
      previewPane: function (show) { var next = show === true ? true : show === false ? false : null; if (next !== previewPane) { previewPane = next; if (previewOn) refresh(); } return previewPane; },
      previewStatus: function () {
        return { selected: previewSelected, ready: syncPreviewSlide() || previewSelected === 'forecast' && mode === 'forecast', pane: paneUp, paneMessage: window.hkSidePane && window.hkSidePane.placement(window.innerWidth, window.innerHeight, { width: cfg && cfg.pane_width }).kind === 'none' ? 'The Side Pane needs more room. Choose Wall Tablet or iPad Upright to preview it.' : previewPaneNote,
          message: previewSelected === 'music' && !musicPlaying() ? 'Sample music · playback controls are inactive.' :
            previewSelected === 'energy' && !energyReady() ? 'Home Energy needs energy data before its slide can be shown.' :
            previewSelected === 'weather' && !weatherReady() ? 'Waiting for weather data…' : previewSelected === 'forecast' && mode === 'forecast' ? 'Forecast is already the background for this design.' : '' };
      },
      previewNight: function (v) { nightPreview = v === true ? true : v === false ? false : null; nightCheck(); return nightPreview; },
      layoutInfo: function () {
        var LM = window.hkSaverLayout;
        if (!ly || !ly.plan || !LM || !cfg || !cfg.layout || !host) return null;
        var R = layoutRoom();
        var O = LM.oriented(LM.clean(cfg.layout), R.W, R.H), empty = {};
        // (empty: a "shows when..." piece with nothing to show, by its catalog id; claims: who shows a fact a piece would)
        Object.keys(ly.empty || {}).forEach(function (k) { empty[ly.empty[k]] = true; });
        return { W: R.W, H: R.H, room: R.room, plan: ly.plan, zones: O.zones, big: O.big, row_at: O.row_at, row_size: O.row_size, empty: empty,
                 emptyAt: Object.assign({}, ly.empty), claims: Object.assign({}, ly.claims), landShare: ly.landShare };
      },
      running: function () { return on; },
      chooseDesign: function () { if (designController) designController.open(); },
      covered: function () { return on && !!coveredPage; },
      // the forecast is what is showing (not photos)
      forecast: function () { return on && mode === 'forecast'; },
      // HK Settings' preview frame: show it now and keep it up; false takes it away
      // `shape`: 'portrait' or 'landscape' -- a photo of that shape (the
      // Portrait / Landscape Photos settings), held while they change
      // `house`: with All Screens' settings, not this screen's own
      // 'energy': Home Energy, held while its options change; 'weather': the weather
      // `over`: the options to show, as the page has them now (previewOver), else the saved ones
      preview: function (v, shape, house, over) {
        var sh = shape === 'portrait' || shape === 'landscape' ? shape : null, en = shape === 'energy', wx = shape === 'weather';
        previewHouse = !!(v && house);
        previewOver = v && over && typeof over === 'object' && !Array.isArray(over) ? over : null;
        if (sh !== previewShape || en !== previewEnergy || wx !== previewWeather) {
          previewShape = sh; previewEnergy = en; previewWeather = wx;
          if (lastPh && sh && shapeOfPh(lastPh) !== sh) lastPh = null;
          if (previewOn && on && v) setTimeout(restartPreview, 0);
        }
        previewOn = !!v;
        if (!previewOn) { lastPh = null; nightPreview = null; previewSelected = ''; previewPane = null; previewPaneNote = ''; }
        force = previewOn;
        refresh();
        if (previewOn && !on) start('preview');
        else if (!previewOn && on && startedBy === 'preview') stop('manual');
        return previewOn;
      },
      // Console / probe helpers. hkSaver.start() shows it now; stop() takes it
      // away (as a touch would, but without writing the switch).
      start: function () { refresh(); return start('manual'); },
      // THE MUSIC, FULL SCREEN (2026-11-01, the owner: the Side Pane's cover tapped): the screensaver now, on its music
      // slide; false where it can't (nothing playing, no screensaver on this screen), and nothing changed
      showMusic: function () {
        refresh();
        var ctx = musicNow(clientNow());
        if (!ctx || !ctx.playing || !cfg) return false;
        if (!on) {
          var was = force;
          asked = force = true;
          if (!start('music')) { asked = false; force = was; return false; }
        }
        if (showMusicSlide(true)) return true;
        if (startedBy === 'music') stop('manual');
        return false;
      },
      stop: function () { return stop('manual'); },
      // as a tap that wakes it would (the switch written): a notification that
      // wakes the screen, one that opens a camera (hk-notify.js)
      wake: function () { return stop('touch'); },
      // somebody is using it (a notification's banner over it)
      touched: function () { saverTouched(); },
      // the screen is dark (Kiosk's screensaver or display off, HK's black)
      black: function () { return black(); },
      next: nextPhoto,
      previous: previousPhoto,
      force: function (v) { force = !!v; refresh(); return force; },
      // THE HOST'S PHOTOS CHANGED (a screen's album, an album's photos): listed
      // again at the next photo, and the source asked again now
      photosChanged: function () { listKey = ''; refresh(); },
      config: function () { return cfg; },
      // what plays for the dashboard's Now Playing pane (hk-popup.js): there
      // (playing or paused), and playing
      music: { has: musicHas, playing: function (h) { var c = musicNow(h || clientNow()); return !!(c && c.playing); } },
      stats: function () {
        return { on: on, startedBy: startedBy, allowed: allowed(), photos: deck ? deck.items.length : null,
                 shown: shown, failed: failed, last: lastPhoto, cards: cards.length,
                 idleIn: cfg && !on && cfg.starts_after ? Math.max(0, Math.round((lastInput + cfg.starts_after * 1000 - Date.now()) / 1000)) : null,
                 blocking: !!(press && host), switch: switchState(),
                 waking: !!(host && host.hasAttribute('waking')), fadeBack: cfg ? cfg.fade_back : null,
                 mode: on ? mode : null, clock: ckCtl ? ckCtl.style : null, clockColor: ckCtl ? ckCtl.color : null, night: !!(host && host.hasAttribute('cknight')), mosaic: moState && displayLayer === moState.layer ? { n: moState.n, idx: moState.idx, left: moState.left } : null, clockOver: !!(host && host.hasAttribute('ckphotos')) ? 'photos' : null, land: fscene && fscene.landShown ? fscene.landShown() || null : null,
                 forecastSlide: on && fcShowing, sinceForecast: sinceFc, preview: previewOn, previewShape: previewShape,
                 shown_shape: lastPh ? shapeOfPh(lastPh) : null, shown_url: lastPh ? lastPh.url : null,
                 band: !!(host && host.hasAttribute('band')),
                 calendar: !!(host && host.hasAttribute('pcal')), pane: !!(host && host.hasAttribute('pane')), paneW: paneW, musicIn: mus.paneIn, paneNext: mus.paneNext, musicFirst: takeover(), paneCard: !!paneCard,
                 energySlide: on && enShowing, weatherSlide: on && wxShowing, previewWeather: previewWeather, extra: exKind || null, extras: cfg ? extrasOf(cfg) : [], previewEnergy: previewEnergy,
                 musicSlide: on && muShowing, musicPane: !!musicPaneView(), music: mus.key, upNext: mus.next ? mus.next.title : null,
                 panel: pnl ? pnl.p.tab() : null };
      },
      _: { darkUnderBlack: function (v) { DARK_UNDER_BLACK = !!v; }, clock: clock, beat: beat, justResumed: function () { return justResumed(); },
           // tests: as a page just loaded, for HK's black (its first decision)
           hkFresh: function () { hkFirst = true; },
           // tests: the next touch is told at once (not held by the 10 s between reports)
           touchFresh: function () { touchSent = 0; },
           readCfg: readCfg, gate: gate, wake: WAKE, zoneOf: zoneOf, fitOf: fitOf, layoutOf: layoutOf, backdropSmall: backdropSmall, nightNow: nightNow,
           ckFx: ckFx, MOSAIC_COLORS: MOSAIC_COLORS,
           mosaicPlan: mosaicPlan, mosaicAssign: mosaicAssign, coverRect: coverRect, MOSAICS: MOSAICS,
           reducedMotion: reducedMotion,
           cleanFocus: cleanFocus, cleanVariants: cleanVariants, cleanDepth: cleanDepth, drawnRect: drawnRect, glyphBox: glyphBox, coverShare: coverShare,
           behindAt: behindAt, tbKey: tbKey, tbShares: tbShares, houseBlock: houseBlock,
           photoFaces: function (lay, ph, L, c) { return photoFaces(lay, ph, L, c); }, photoOpts: photoOpts, FACE_SHOWS: FACE_SHOWS, bigWanted: function () { return bigWanted(); },
           // (Home Energy's backdrop over the forecast, as it would be painted now: the landscape's copy over the sky)
           energyBackdrop: function (c) { var im = landImg(); if (!im) return false; drawBackdrop(c, im, BACKDROP_SMALL, 1, skyStops()); return true; },
           // tools/headless/saver_faces_check.py: the saver's own CSS around a photo's layers
           CSS: CSS,
           photoUrl: photoUrl, releasePh: releasePh, faceWindow: faceWindow, faceOrigin: faceOrigin, alignOf: alignOf, shuffle: shuffle, Deck: Deck, isImage: isImage,
           // tests: the layout drawn again now (what the face shows changed under it)
           layoutNow: function () { if (ly) layoutDraw(); },
           // tests: the slide without real photos to count
           slide: { show: showForecastSlide, hide: hideForecastSlide, since: function (n) { sinceFc = n; }, schedule: function () { schedule(); } },
           paneOf: paneOf, withPane: withPane, slideOf: slideOf, turnOf: turnOf, extrasOf: extrasOf, mmss: mmss,
           // tests: Home Energy and the additional screens without waiting minutes
           energy: { show: showEnergySlide, hide: hideEnergySlide, ready: energyReady, prep: energyPrep, layout: energyLayout,
                     ctl: function () { return enCtl; } },
           weather: { show: showWeatherSlide, hide: hideWeatherSlide, ready: weatherReady, prep: weatherPrep, layout: weatherLayout,
                      ctl: function () { return wxCtl; } },
           extras: { next: exNext, hide: exHide, arm: exArm, kind: function () { return exKind; }, last: function () { return exLast; } },
           // tests: the music without real speakers
           music: { show: showMusicSlide, hide: hideMusicSlide, render: renderMusic, watch: function () { mus.watchAt = 0; musicWatch(); },
                    dash: dashViews,
                    hit: musicHit, act: musicAct, now: musicNow, layout: layoutMusic, grace: MU_GRACE,
                    // the panel: open on the slide or the pane, close
                    panel: function (kind, tab) {
                      if (!kind) { closePanel(true); return null; }
                      var v = kind === 'pane' ? musicPaneView() : slideView();
                      panelFor(v, tab || 'speakers');
                      return pnl ? pnl.p.tab() : null;
                    } } }
    };
  });
})();
