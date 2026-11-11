// hk-saver.js -- HK Frontend's photo screensaver, for a wall tablet's own user.
//
// What it is, what it costs, its plan's history and THE SWITCH: docs/development/Design-Notes.md, "The screensaver's plan and its switch".
// @ts-check
(function () {
  'use strict';
  // THE SHARED STATE (tools/split_js.py state): the variables these functions set again and again, as properties of one
  // object, so the code that sets one can live in another file. ST.x is what was the variable x.
  var ST = /** @type {Record<string, any>} */ ({});
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

  function landscapes() { return !!(ST.cfg && ST.cfg.show === 'clock' && ST.cfg.clock_bg === 'landscapes'); }
  // ONE RENDERER (2026-11-02, phase 13, phase 4; decision 5: "Every screen through one renderer"): a screen with no
  // saved layout draws through the layout path too, with the layout its options make (hkSaverLayout.layoutFrom, the
  // editor's own starting point) -- its corners the pieces', its slides with the slide corner. Glance, Month and the Day
  // face keep their own words (their hand-made date and month): the layout made for them leaves its big element to the
  // face. Until hk-saverlayout.js has come (it is asked for here, then the screen read again) the screen draws as it
  // always did
  /** @type {any} */ var autoAsked = false;
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
        try { import('/hk/modules/hk-saverlayout.js').then(function () { if (window.hkSaverLayout) { forgetRaw(); refresh(); } }, function () { /* the old way */ }); } catch (
          e) { /* the old way */ }
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
      L.big = Object.assign({}, L.big, { kind: 'time', depth: 'behind', size: Math.max(12, Math.min(44, c.tb_size || 24)), pos: (c.tb_top || 0) <= 12 ? 'top' : (c.tb_top || 0) <= 30 ? 'upper' :
        'center' });
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
  // (designController: on ST, tools/split_js.py state)

  // ...and where a host draws the dashboard with HK's own view host, no
  // Lovelace (Mantel: the panel is the page, with no lovelace object), the
  // shell hands the config over instead. Read as the panel's alone, the
  // saver had no config at all there: no touches told, no black drawn or
  // confirmed, no backlight lowered (every wall tablet on Mantel,
  // 2026-10-19). shellConf: the config came from the shell, not a panel.
  ST.shellConf = false;
  function dashConf() {
    var p = panel(), conf = p && p.lovelace && p.lovelace.config;
    ST.shellConf = false;
    if (conf) return conf;
    var SH = window.hkShell;
    try { conf = SH && typeof SH.dashboardConfig === 'function' ? SH.dashboardConfig() : null; } catch (e) { conf = null; }
    ST.shellConf = !!conf && !(p && p.lovelace);
    return conf || null;
  }

  ST.host = null;
  ST.root = null;
  ST.lastInput = Date.now();
  ST.idleT = null;
  /** @type {any} */ var pendingSwitch = null;
  // the touch that stopped it: still down (up: null), or when it lifted
  ST.press = null;
  ST.pressStop = false;
  // the screensaver's fade in, waiting for its first photo (start)
  var ENTRANCE_MAX = 1500;
  // THE FORECAST (1.3): the live sky over the season's land (hkSky.scene),
  // with the forecast band -- when a screen asks for it, or has no photos
  // the forecast sky's last reading (hk-sky.js read()), for Big Weather's planted time: null without a landscape
  // THE CALENDAR PANE (option `calendar`): its element, its scroller, the
  // card in it, its width now, and the timer that scrolls it back to today
  ST.paneEl = null;
  ST.paneSc = null;
  /** @type {any} */ var paneResetT = null;
  // ...the side it was laid out for, and the Side Pane drawing other
  // sections in it (cfg.pane_list; hk-sidepane.js), with its tick
  // Photos & Forecast: the forecast as one slide every `forecast_every`
  // photos, over the photos, its sky still whenever it is not on screen
  // HK Settings' preview (hkSaver.preview): shown in the settings page's frame
  // whoever is signed in, deaf to the real tablet's switch, never writing it,
  // and rebuilt whenever the options change
  ST.previewOn = false;
  // ALL SCREENS' PREVIEW (1.8.1): HK Settings' All Screens -> Screensaver
  // shows its own settings on a screen of the house, whether or not that
  // screen follows them (before, the page had no preview once every screen
  // had settings of its own)
  ST.previewHouse = false;
  // ...and Home Energy's Options: the energy screen, held (2026-10-14)
  ST.previewEnergy = false;
  ST.previewWeather = false;
  ST.previewSelected = '';
  ST.previewPane = null;
  ST.previewPaneNote = '';
  // ...and the options HK Settings hands it as they change (2026-10-31, the owner: "just what they're changing,
  // updating in place"): drawn from them at once -- not after the save has gone round the server and back, and the
  // settings are next read (refreshSoon: every 2 s) -- and kept until the preview ends, so the save, when it comes
  // back, is the same block and changes nothing
  ST.previewOver = null;
  /** @type {any} */ var unsubCards = null;
  ST.cards = [];
  ST.force = false;           // hkSaver.force(true): ignore the user (tests)
  ST.asked = false;           // showMusic(): somebody asked for the music full screen -- shown whoever the screensaver is for

  // THIS PAGE IS THE BLOCK'S OWN TABLET: the one it names (1.14), else
  // signed in as its user -- the rule for every write and report
  function mine() {
    if (!ST.cfg) return false;
    if (ST.cfg.tablet) return tabletId() === ST.cfg.tablet;
    return !!ST.cfg.user && user() === ST.cfg.user;
  }
  // which tablet a report is about: its id, else (before 1.14) the screen
  function whoMsg(msg) {
    var id = (ST.cfg && ST.cfg.tablet) || '';
    if (id) msg.tablet = id; else msg.dashboard = String(location.pathname).split('/')[1] || '';
    return msg;
  }
  function allowed() {
    if (framed && !ST.previewOn) return false;
    return !!ST.cfg && (ST.force || gate(ST.cfg, user(), location.search, tabletId()));
  }

  // ------------------------------------------------------------ the switch
  function switchState(c) {
    c = c || ST.cfg;
    var h = clientNow();
    var s = c && c.entity && h && h.states[c.entity];
    return s ? s.state : null;
  }
  function writeSwitch(want, c) {
    c = c || ST.cfg;                  // (the options the screensaver showed with, when they just went: refresh)
    if (!c || !c.entity) return;
    // ONLY THE TABLET'S OWN USER WRITES IT -- never a forced test page
    // (?hk_saver=force, hkSaver.force()), whatever the gate lets it show
    if (!mine() || /[?&]hk_saver=force\b/.test(location.search) || ST.force) return;
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
  ST.touchSent = 0;
  function reportTouch() {
    if (!ST.cfg || !ST.cfg.entity || !/^switch\./.test(ST.cfg.entity)) return;
    if (!mine() || ST.force || /[?&]hk_saver=force\b/.test(location.search)) return;
    var now = Date.now();
    if (now - ST.touchSent < 10000) return;
    ST.touchSent = now;
    sendWS(whoMsg({ type: 'hk_frontend/screensaver/touch' })).catch(function () { /* older integration */ });
  }

  // Every new client: the switch decides, unless it is still echoing our own
  // write the other way.
  function onUpdate(h) {
    hkSync(h);
    if (ST.previewOn || !ST.cfg || !ST.cfg.entity || !allowed()) return;
    var st = switchState();
    if (pendingSwitch) {
      if (st === pendingSwitch.want || Date.now() > pendingSwitch.until) pendingSwitch = null;
      else return;
    }
    // ...but not over somebody watching Live TV or using a sheet (hk-idle's
    // hold, as the idle timer already honours): the switch turned on by an
    // automation or the Sleep Screen waits for the hold to end (2026-10-21)
    if (st === 'on' && !ST.on) { if (!held()) start('switch'); }
    else if (st === 'off' && ST.on) stop('switch');
  }

  // ------------------------------------------------------------ idle
  function armIdle() {
    if (ST.idleT) { clearTimeout(ST.idleT); ST.idleT = null; }
    if (ST.on || !ST.cfg || !allowed() || !(ST.cfg.starts_after > 0)) return;
    var wait = Math.max(250, ST.lastInput + ST.cfg.starts_after * 1000 - Date.now());
    ST.idleT = setTimeout(function () {
      ST.idleT = null;
      if (ST.on || !ST.cfg || !allowed()) return;
      if (Date.now() - ST.lastInput < ST.cfg.starts_after * 1000) { armIdle(); return; }
      // not while hidden (the tab is not on screen), nor held: ask again
      // shortly rather than start behind somebody's back
      if (document.hidden || held()) { ST.lastInput = Date.now() - ST.cfg.starts_after * 1000 + 15000; armIdle(); return; }
      start('idle');
    }, wait);
  }

  // ------------------------------------------------------------ input
  ST.mx = null;
  ST.my = null;
  // A TOUCH ON THE CALENDAR PANE scrolls it: the one place on the
  // screensaver a finger does not take it away
  function inPane(e) { return inPaneAt(e, ST.paneEl, ST.paneUp); }
  function paneTouched() {
    if (paneResetT) clearTimeout(paneResetT);
    paneResetT = setTimeout(function () {
      paneResetT = null;
      if (ST.paneSc) { try { ST.paneSc.scrollTo({ top: 0, behavior: isFlat() ? 'instant' : 'smooth' }); } catch (e) { ST.paneSc.scrollTop = 0; } }
    }, PANE_RESET_MS);
  }
  function onInput(e) {
    var t = e.type;
    if (ST.designController && ST.designController.input(e)) return;
    // A NOTIFICATION'S BANNER over the photos (hk-notify.js): a finger on it
    // is the banner's -- swiped away, opened -- never a wake; the screensaver
    // is in use while it does
    if (ST.on && window.hkNotify && window.hkNotify.owns(e)) {
      if (t !== 'pointermove' && t !== 'mousemove') saverTouched();
      return;
    }
    // A FINGER ON THE MUSIC'S VOLUME: everything it does is the drag
    if (ST.on && mus.drag) {
      if (t === 'pointermove' || t === 'mousemove' || t === 'touchmove') {
        var mp = t === 'touchmove' ? e.touches && e.touches[0] : e;
        if (mp) volFrom(mp.clientX);
      }
      return;
    }
    // A FINGER ON UP NEXT'S ROWS (below): a drag scrolls the list, a tap opens the Queue
    if (queueDrag(e, { on: ST.on, hit: musicHit, act: musicAct, touched: saverTouched, inPanel: !!(ST.pnl && inPanel(e)) })) return;
    // THE MUSIC'S PANEL OPEN: what is in it is its own (taps, scrolling, the
    // search box's typing); anything else closes it -- never a wake -- but
    // the music's buttons beside it still act
    if (ST.on && ST.pnl) {
      // (a mouse moving about it is followed, not counted: once it closes,
      // a move from here wakes, as before)
      if ((t === 'pointermove' || t === 'mousemove') && (!e.pointerType || e.pointerType === 'mouse')) { ST.mx = e.clientX; ST.my = e.clientY; }
      if (inPanel(e)) { if (t !== 'pointermove' && t !== 'mousemove') panelTouched(); return; }
      // (a finger lifting is not a tap: the one that opened it, lifting off its
      // button, read as a second tap and toggled it shut at once, 2026-11-06)
      if (t === 'pointermove' || t === 'mousemove' || t === 'wheel' || t === 'touchmove' || t === 'click' ||
          t === 'pointerup' || t === 'pointercancel') return;
      if ((t === 'touchstart' || t === 'mousedown') && window.PointerEvent) return;
      if (t === 'keydown') { if (!ST.pnl.p.typing()) closePanel(true); return; }
      var px = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientX) : e.clientX;
      var py = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientY) : e.clientY;
      var ph2 = musicHit(px, py);
      if (ph2 && !ph2.art) { musicAct(ph2, px); if (ST.pnl) panelTouched(); return; }
      saverTouched();
      closePanel(true);
      return;
    }
    if (ST.on && t !== 'keydown' && inPane(e)) {
      if (t !== 'pointermove' && t !== 'mousemove') { paneTouched(); saverTouched(); }
      // the music's buttons in the pane
      if (t === 'pointerdown' || (t === 'touchstart' && !window.PointerEvent)) {
        var pt = t === 'touchstart' ? e.touches && e.touches[0] : e, ph = pt && musicHit(pt.clientX, pt.clientY);
        if (ph) musicAct(ph, pt.clientX);
      }
      return;
    }
    if (ST.on) {
      // A MOUSE has to move, a finger just has to land.
      if (t === 'pointermove' || t === 'mousemove') {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (ST.mx === null) { ST.mx = e.clientX; ST.my = e.clientY; return; }
        if (Math.abs(e.clientX - ST.mx) + Math.abs(e.clientY - ST.my) < MOVE_PX) return;
        stop('touch'); return;
      }
      // ONE TAP, ONE STEP: a finger fires pointerdown, then touchstart, then
      // mousedown; where pointer events exist they alone count, or a tap on
      // an edge would skip two photos
      if ((t === 'touchstart' || t === 'mousedown') && window.PointerEvent) return;
      if (t === 'pointerdown' || t === 'touchstart' || t === 'mousedown') {
        var x = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientX) : e.clientX;
        var y = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientY) : e.clientY;
        // Time's Up on the Timer slide: its buttons, and a tap anywhere stops the sound, not the screensaver
        if (TM.showing && TM.ctl && TM.ctl.tap(x, y)) { ST.pressStop = true; return; }
        // THE MUSIC'S BUTTONS act and leave it up
        var mh = musicHit(x, y);
        if (mh) { ST.pressStop = !!mh.art; musicAct(mh, x); return; }
        // The alert banner opens the NWS wording, rather than the raw
        // count sensor or an unrelated Weather-page navigation.
        if (WX.showing && WX.ctl && WX.ctl.hitAlert && WX.ctl.hitAlert(x, y)) {
          ST.pressStop = true;
          var alertCtl = WX.ctl;
          stop('touch');
          alertCtl.openAlerts();
          return;
        }
        var wpage = (weatherAt(x, y) && weatherPage()) || widgetPage(x, y, ST.ly);   // (and any piece's page: its When Tapped)
        ST.pressStop = true;
        if (wpage) { stop('touch'); go(wpage); return; }
        // A TAP ON HOME ENERGY opens the Energy page (anywhere on it)
        if (ST.enShowing) { var epage = energyPage(); stop('touch'); if (epage) go(epage); return; }
        // ...and on the weather, the Weather page
        if (WX.showing) { var xpage = weatherPage(); stop('touch'); if (xpage) go(xpage); return; }
        // the edges of the PHOTOS: beside the calendar pane, its left edge
        var z = zoneOf(x, (window.innerWidth || 0) - (ST.paneUp ? ST.paneW : 0));
        // (on the forecast or the music a tap anywhere else wakes: there is no photo to step;
        // nor on Show: Clock, photos or Landscapes behind it included -- the
        // clock is what it shows, and an edge tap that only changed the
        // photo read as a tap that did not wake it, 1.8.1)
        if (z && ST.mode === 'photos' && !ST.muShowing && !ckPhotos()) { ST.pressStop = false; saverTouched(); if (z === 'next') nextPhoto(); else previousPhoto(); }
        else if (!(t === 'pointerdown' && ST.designController && ST.designController.hold(e))) stop('touch');
        return;
      }
      if (t === 'keydown' || t === 'wheel') stop('touch');
      return;
    }
    if (t === 'pointermove' || t === 'mousemove') {
      if (e.pointerType && e.pointerType !== 'mouse') return;
    }
    ST.lastInput = Date.now();
    armIdle();
    if (t !== 'pointermove' && t !== 'mousemove') reportTouch();
  }

  function weatherAt(x, y) {
    if (!ST.root || !ST.host || !ST.host.hasAttribute('band') || x == null || y == null) return false;
    var box = ST.root.querySelector('.fcband');
    return Array.prototype.slice.call((box && box.children) || []).some(function (el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;
    });
  }

  function build() {
    ST.host = document.createElement('hk-screensaver');
    ST.root = ST.host.attachShadow({ mode: 'open' });
    var font = viewFont();
    if (font) ST.host.style.setProperty('--hk-saver-font', font);
    // (the calendar pane's list rides under Home Status: hk-base.js shade --
    // the cards are loaded by the time a screensaver starts)
    var HC = window.hkCards;
    if (HC && HC.flatSurface) HC.flatSurface(ST.host, 'screensaver');
    var st = document.createElement('style'); st.textContent = CSS + (HC && HC.flatCss ? HC.flatCss() : '') +
      ':host([hk-flat]){background:var(--hk-flat-ground)}' +
      ':host([hk-flat]) .pane,:host([hk-flat]) .mu,:host([hk-flat]) .pm{' + (HC && HC.flatVars ? HC.flatVars('dark') : '') + ';background:#24252A}' +
      ':host([hk-flat]) .mbgf,:host([hk-flat]) .mshade{display:none}' +
      ':host([hk-flat]) .sc,:host([hk-flat]) .pane{color:var(--hk-ink)}'  + (HC && HC.edgeCss ? '\n' + HC.edgeCss() : ''); ST.root.appendChild(st);
    for (var i = 0; i < 2; i++) {
      var ph = document.createElement('div'); ph.className = 'ph';
      var bg = document.createElement(isFlat() ? 'div' : 'canvas'); bg.className = 'bg'; bg.hidden = true;
      var fg = document.createElement('img'); fg.className = 'fg'; fg.alt = '';
      var scrim = document.createElement('div'); scrim.className = 'phscrim';
      ph.appendChild(bg); ph.appendChild(fg); ph.appendChild(scrim); ST.root.appendChild(ph);
    }
    var pane = document.createElement('div'); pane.className = 'pane';
    var sc = document.createElement('div'); sc.className = 'sc'; pane.appendChild(sc); ST.root.appendChild(pane);
    // (its ends fade as it scrolls, as every list's do: hk-base.js SCROLL EDGES)
    sc.classList.add('hk-fades');
    if (HC && HC.edges) HC.edges(sc);
    ST.paneEl = pane; ST.paneSc = sc; paneCardGone();
    var info = document.createElement('div'); info.className = 'info'; ST.root.appendChild(info);
    var nw = document.createElement('div'); nw.className = 'nightwash'; ST.root.appendChild(nw);
    var blk = document.createElement('div'); blk.className = 'blk'; ST.root.appendChild(blk);
    // taps on the screensaver itself: the window listener above has already
    // decided (edge zone or stop); here they are only kept from reaching
    // anything else
    ['click', 'pointerup', 'mouseup', 'touchend', 'contextmenu'].forEach(function (t) {
      ST.host.addEventListener(t, function (e) {
        e.stopPropagation();
        // (the music's panel: its taps are its own -- a click, a field focused)
        if (t !== 'contextmenu' && inPanel(e)) return;
        if (e.cancelable) e.preventDefault();
      });
    });
    document.body.appendChild(ST.host);
    buildCards(info);
  }
  function teardown() {
    dropSide();
    if (ST.host) { ST.host.removeAttribute('dark'); ST.host.removeAttribute('undark'); }
    coverDashboard(false);
    blackPage(false);
    releaseVisuals();
    if (ST.host) ST.host.remove();
    ST.host = null; ST.root = null; ST.press = null;
    noteDrawn();
    // gone for good: the camera strip starts its live stream after this
    try { window.dispatchEvent(new Event('hk-saver-done')); } catch (e) { /* ignore */ }
  }
  // The transparent host may still be catching wake-up taps. Its graphics
  // and card subscriptions need not survive that interaction-only period.
  function releaseVisuals() {
    if (ST.fadeDone) ST.fadeDone();
    showsLayer(null);
    tbCancel();
    if (ST.host) ST.host.removeAttribute('tb');
    leaveExtras();
    leaveEnergy();
    slideLeave(WX); slideLeave(HL); slideLeave(TM); if (ST.TW) ST.TW.leave();
    leaveForecast();
    leaveMusic();
    leaveClock();
    leaveLayout();
    leaveCorner();
    if (unsubCards) { unsubCards(); unsubCards = null; }
    ST.cards = [];
    if (ST.host) {
      // let the browser drop the decoded photos now, not at the next GC
      ST.root.querySelectorAll('img').forEach(function (im) { im.removeAttribute('src'); });
      ST.root.querySelectorAll('canvas').forEach(clearCanvas);
      Array.from(ST.root.children).forEach(function (el) { if (el.tagName !== 'STYLE') el.remove(); });
      ST.host.setAttribute('released', '');
    }
    ST.paneEl = null; ST.paneSc = null; paneRelease();
    if (paneResetT) { clearTimeout(paneResetT); paneResetT = null; }
  }
  function cfgKey() { try { return JSON.stringify(ST.cfg); } catch (e) { return String(Math.random()); } }
  function buildCards(info) {
    var h = clientNow();
    ST.cards = [];
    (ST.cfg.cards || []).forEach(function (c, i) {
      var tag = tagOf(c.type);
      var make = function () {
        if (!ST.host || !ST.on || info.parentNode !== ST.root) return;
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
          ST.cards.push(el);
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
    if (ST.paneUp && tag === 'hk-screensaver-status-card') { conf.line1_size = '22px'; conf.line_size = '16px'; conf.align = 'left'; }
    if (ST.paneUp && tag === 'hk-timer-strip-card') conf.scale = Math.round(1.15 * scaleOf() * 100) / 100;
    if (ST.cfg && ST.cfg.layout && !(ST.host && ST.host.hasAttribute('lyoff'))) {
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
    ST.cards.forEach(function (c) { try { feedCard(c, h); } catch (e) { /* ignore */ } });
    if (ST.ckCtl) ST.ckCtl.setClient(h);
    if (ST.bigCtl) ST.bigCtl.setClient(h);
    if (ST.ly && ST.ly.big && ST.ly.big.ctl) ST.ly.big.ctl.setClient(h);
    if (ST.enCtl && ST.enShowing) ST.enCtl.setClient(h);
    [WX, HL].forEach(function (S) { if (S.ctl && S.showing) S.ctl.setClient(h); });
    // (layoutClient() takes no argument: h is passed and not used)
    layoutClient(h);
    cornerClient();
  }

  // ------------------------------------------------------------ the parts (generated by tools/split_js.py)
  // THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/saver/ (the PARTS below, in the order they
  // run) by tools/split_js.py from tools/split_manifests/saver.json; `split_js.py --find <name>` says which file holds
  // one. Each file registers one function in window.hkSaverParts; they run here, in this order (a later one may use
  // an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
  // they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
  // them (the suites) starts at once, in the same turn.
  // READY: window.__hkSplitReady['hk-saver'] is a promise that resolves once the parts have run (and rejects if they
  // never come), so a page that imports this file and uses it at once awaits it first (web/home.js imp, hk-loader).
  var PARTS = ['hk-saver-helpers.js', 'hk-saver-css.js', 'hk-saver-photos.js', 'hk-saver-music.js',
               'hk-saver-draw.js', 'hk-saver-layout.js', 'hk-saver-screens.js', 'hk-saver-pane.js',
               'hk-saver-black.js', 'hk-saver-start.js'];
  var PARTS_TRIES = 6;
  function partKey(file) { return file.replace(/\.js$/, ''); }
  function partsSettle(err) {
    var settle = (window.__hkSplitSettle || {})['hk-saver'];
    if (settle) settle(err);
  }
  // ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
  // (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
  // of their own -- a browser keeps a failed module's answer for its address
  function loadParts(then, n) {
    // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
    // must not run them twice: the flag is set at once, not when the parts have run
    var started = window.__hkSplitStarted = window.__hkSplitStarted || {};
    if (n === undefined) {
      if (started['hk-saver']) return;
      started['hk-saver'] = true;
      var ready = new Promise(function (resolve, reject) {
        (window.__hkSplitSettle = window.__hkSplitSettle || {})['hk-saver'] = function (err) { if (err) reject(err); else resolve(); };
      });
      ready.catch(function () { /* the console says so; an importer that awaits it reports it */ });
      (window.__hkSplitReady = window.__hkSplitReady || {})['hk-saver'] = ready;
    }
    n = n || 0;
    var have = window.hkSaverParts || {};
    var missing = PARTS.filter(function (file) { return !have[partKey(file)]; });
    if (!missing.length) {
      var failed = null;
      try { then(); } catch (err) { failed = err; console.error('[hk-saver] the parts did not start', err); }
      // (the checks that drive a page wait for every shell that started to say it is done)
      (window.__hkSplitDone = window.__hkSplitDone || {})['hk-saver'] = true;
      partsSettle(failed);
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
      if (n + 1 >= PARTS_TRIES) {
        console.error('[hk-saver] the parts did not start', err);
        partsSettle(err);
        // (given up: a later import of this file -- a page asking again at an address of its own -- starts over)
        delete started['hk-saver'];
        return;
      }
      console.warn('[hk-saver] a part did not load (' + err.message + '); again shortly');
      setTimeout(function () { loadParts(then, n + 1); }, Math.min(1000 * Math.pow(2, n), 15000));
    });
  }
  // ------------------------------------------------------------ end of the parts loader
  var actionsNow, alignOf, BACKDROP_SMALL, backdropSmall, beat, behindAt, bigWanted, black, blackChanged, blackPage,
      ckFx, ckPhotos, cleanDepth, cleanFocus, cleanVariants, clearCanvas, clientNow, clock, closePanel, cornerClient,
      coverDashboard, coverRect, coverShare, createDesignController, CSS, DASH_CSS, DASH_SWIPE, dashViews, dashWatch,
      dayFit, Deck, drawBackdrop, drawnRect, dropSide, energyLayout, energyPage, energyPrep, energyReady, exArm,
      exHide, exNext, EXTRA_ORDER, extrasOf, FACE_SHOWS, faceOrigin, faceWindow, feedCard, fitOf, framed, gate,
      glyphBox, go, held, hideEnergySlide, hideForecastExtra, hideForecastSlide, hideMusicSlide, hkSync, HL,
      hookClient, houseBlock, INKS, inPaneAt, inPanel, isFlat, isImage, justResumed, landImg, layoutClient,
      layoutDraw, layoutMusic, layoutOf, layoutPane, layoutRoom, leaveClock, leaveCorner, leaveEnergy, leaveExtras,
      leaveForecast, leaveLayout, leaveMusic, mmss, MOSAIC_COLORS, mosaicAssign, mosaicPlan, MOSAICS, MU_BG, MU_GRACE,
      mus, musicAct, musicHas, musicHit, musicNow, musicPaneView, musicPlaying, musicTick, musicView, musicWatch,
      nextPhoto, nightCheck, nightNow, noteDrawn, pageCard, panel, panelFor, panelTouched, paneOf, photoFaces,
      photoOpts, photoUrl, placePanel, previousPhoto, queueDrag, readCfg, reducedMotion, refresh, releasePh,
      renderMusic, restartPreview, saverTouched, scaleOf, schedule, sendWS, shapeOfPh, showEnergySlide,
      showForecastSlide, showMusicSlide, shuffle, skyStops, slideHide, slideLayout, slideLeave, slideOf, slidePrep,
      slideReady, slideShow, slideView, SLOP, start, stop, syncPreviewSlide, tabletId, tagOf, takeover, tbKey,
      tbShares, TM, tmWatch, turnOf, user, viewFont, volEnd, volFrom, weatherPage, widgetPage, withPane, WX, zoneOf;
  // (phase 25: what the shell asks of the parts that own the state it changes, docs/phase25/SAVER-STATE.md)
  var beatFrom, dashAgain, exCancel, extraIs, forgetRaw, hkAgain, keepPh, listAgain, paneCardGone, paneRelease,
      resumedNow, showsLayer, sinceSlide, tbCancel;

  // A wake held until the kiosk's black (or its panel off) has ended.
  // WHAT THE TABLET LAST SHOWED: after each change, seen in a frame's
  // callback -- one runs only when a frame is drawn, so never under the
  // kiosk's black -- and counted once two more frames have begun. One is not
  // enough: the frame the black went up on was begun and never shown (the
  // wake blinked from the old dashboard to black, screen-recorded).

  // HK SETTINGS' PREVIEW of Portrait or Landscape Photos (2026-10-13): a
  // photo of that shape (previewShape), and the same one again while the
  // settings change -- each change restarts the preview (restartPreview),
  // and a new photo every time would make a crop impossible to judge. Each
  // photo's shape is remembered once loaded, so the next pick skips the
  // others without loading them. Only the preview: a tablet keeps no photo.
  ST.previewShape = null;
  // NOTHING TURNS UNDER A BLACK (2026-10-29). The photos' timer also held
  // while the kiosk's black (or HK's own) was up, and woke every few seconds
  // to find it still was: a screen nobody can see, a timer, and (on a tablet
  // that keeps the page running) the next photo downloaded and decoded for
  // nobody. Now it is not armed at all while black() -- slideHeld notes that
  // it was wanted -- and litNow() arms it again once the black has ended.

  // ------------------------------------------------------------ the mosaic
  // A MOSAIC ON A LAYER (2026-10-13): each photo drawn into its own cell's
  // canvas, at the cell's size -- the full photo is dropped once it is drawn,
  // so five photos cost about what one full-screen photo does -- cropped by
  // its shape's Focus and Zoom. The two layers cross-fade as photos do.
  // Changes: One at a Time swaps one cell at a time in place (moState).
  // UP TO (2026-10-13): how many photos the mosaic shows now -- its own
  // number, or with Up To one picked from 1 to it, kept for mosaic_every
  // minutes (another each time); 1 is one photo, full screen
  // the time on the photos, as the screen's clock tells it (its 24-Hour Time), put right on the minute

  // BIG WEATHER (2026-10-30; the Forecast's Layout: Big): hk-saverfaces.js's, in the forecast's layer over its sky,
  // wherever the forecast shows on its own -- Show: Forecast, the slide among the photos, no photos -- never under a
  // clock (Behind the Clock: Forecast keeps the forecast's own details)
  // ------------------------------------------------------------ the slide corner
  // THE SLIDE CORNER (2026-11-02, phase 13: docs/phase13/SCREENSAVER-UNIFIED.md, "Slides: the slide corner"; the owner:
  // "A slide needs only the Time, Date, Weather and House Status, and only where they apply: the Weather slide needs no
  // extra weather"). Each slide says what it shows itself (hkSaverLayout.SLIDES); one corner, drawn by the pieces'
  // renderer, adds only what it lacks: the time and the date at the top left, the weather inline under them, House
  // Status at the top right. Its time takes the Look's face's font and color where the face has words (decision 4).
  // WHAT IT COSTS A WALL TABLET: four pieces made once, their words on the minute and when the house changes (at most
  // every 2 s), hidden by opacity with the slide; nothing moves.
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
  // THE SCREEN'S INK (2026-11-02, the owner: "change the colors based on luminance for whatever is in the
  // background... I don't want some widgets being white and some being black on the screen at the same time"): one ink
  // for every piece -- the layout's White or Black, or Auto: dark on a light ground (a light face's, [cklight]; a
  // light photo's, by its luminance), else white
  // the photo's title, for the Photo Title widget: the album and the year, as Titles drew them

  // ------------------------------------------------------------ the clocks
  // SHOW: CLOCK (2026-10-13): a full-screen clock (hk-saverclock.js, loaded
  // only now) over a background of its own -- or over the forecast (its sky
  // and land, the details along the bottom as set), or over the photos
  // turned into their blurred, dimmed copies ([ckphotos]: the cheap copy,
  // never a blur on the full photo). The corner cards stay: weather, what's
  // playing, the timers and Home Status, each as Over the Clock says.
  // NIGHT MODE (2026-10-13): StandBy's -- in the dark, the clock and its
  // corners a dim red on black. Always, or At Night (from .. to, across
  // midnight). Nothing behind the clock is drawn meanwhile (the photos, the
  // forecast and its background hidden; ckCtl.night holds the painter).
  ST.nightPreview = null;           // the editor's Day / Night (previewNight): null follows the clock
  // ------------------------------------------------------------ home energy
  // HOME ENERGY (2026-10-14, hk-saver-energy.js, loaded only now): today so
  // far against a usual day, the Energy page's own numbers. ONE LAYER OVER
  // WHAT IS THERE (.en, above the clock, under the corner cards), faded in
  // over it -- the photo, the forecast, the clock all stay opaque beneath,
  // so no hand-off ever passes through black. Behind its text: the photo's
  // blurred copy, the sky held still and darkened, or (over a clock's own
  // background) a gradient of its own. The rings draw once it has arrived.

  // ------------------------------------------------------------ a timer's last minute
  // THE LAST MINUTE (phase 21): hk-saver-helpers.js timerHold decides; these are what it does here

  // ------------------------------------------------------------ additional screens
  // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, one
  // every extra_every minutes for extra_for seconds -- the forecast (Show:
  // Clock), the music (only while it plays) and Home Energy, taking turns.
  // None while the music holds the screen, in the clock's Night Mode, under
  // the black, or on a hidden page; the timer just goes round again.


  // A TOUCH ON THE SCREENSAVER'S OWN CONTROLS (the music, its panel, a photo
  // stepped), told to the integration as such: Sleep Screen reads it as the
  // photos in use, not somebody at the dashboard (sleep_engine.py
  // saver_use) -- the kiosk's own report of the same tap would otherwise
  // wake the dashboard out from under the finger. At most every 3 s, only
  // from the tablet's own user (as reportTouch).

  // the dashboard's pane drawn again from the house, at most once a second
  // (the screensaver's own watch draws every view while it is up)
  // ITS PANEL closes with a tap anywhere else on the dashboard, and a touch
  // on it keeps it open (the screensaver routes both itself)
  // ONE VIEW FOR EVERY PAGE'S PANE (2026-10-15): each page of a dashboard
  // holds its own #media pop-up, so a page change builds a new card -- and a
  // new view started with no art, the placeholder showing until the cover had
  // loaded and faded in again (seen in Safari, every page change). The view
  // is made once and handed to whichever card is showing: its art, blur and
  // song move with it, drawn already.
  /** @type {any} */ var dashV = null;

  // the pane is up now: the calendar's, or the music's while it plays

  // KIOSK SATELLITE'S DARK. Its API is promise-based, so it cannot be asked
  // inline the way Fully is below; it announces its screensaver and the panel
  // power as window events instead, and these follow them. Its screensaver
  // usually also hides the page (Pause dashboard during screensaver), but
  // that is a setting, so the events are the fact.
  // (Listened for on any page: nothing else fires them.)
  ST.ksSaver = false;
  ST.ksOff = false;
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
  // UNDER THE KIOSK'S BLACK, THE DASHBOARD COMES BACK -- whatever had been
  // shown (2026-10-09, with Kiosk Satellite's "Pause dashboard during
  // screensaver" OFF on every tablet). Off, the tablet keeps the page it
  // drew and still draws for ~2 s after the black goes up, so the
  // screensaver taken down there leaves a whole, drawn dashboard to wake
  // onto. Kept up (dark) instead, it was put away at the wake itself, the
  // one moment a tablet cannot draw in time: a half-drawn dashboard, then
  // black, then the fade (screen-recorded on the Loft). The photos come back
  // after the black ends if they are still wanted (start(): LIT_GRACE).
  ST.DARK_UNDER_BLACK = false;

  // compared as written: a block made from the settings is a new object
  // every time

  // (the class: the shell registers it, hk-saver.js runParts -- a part registers no element)

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

  // WHAT THE PARTS ASK OF THE SHELL (phase 25, A): the only way a part changes the shell's state -- touch and idle,
  // the cards on the page, what the preview asked -- each the assignment it was, by name (docs/phase25/SAVER-STATE.md)
  function dropCard(card) { ST.cards = ST.cards.filter(function (c) { return c !== card; }); }
  function idleCancel() { if (ST.idleT) { clearTimeout(ST.idleT); ST.idleT = null; } }
  function inputFresh() { ST.mx = null; ST.my = null; ST.press = null; }   // a run starts: no pointer, no press yet
  function askedEnds() { if (ST.asked) { ST.asked = false; ST.force = ST.previewOn; } }
  function pressIs(press) { ST.press = press; }           // the touch that stopped it (onInput swallows its end)
  function pressStopped(v) { ST.pressStop = v; }          // a press that stops it does nothing else
  function noteInput() { ST.lastInput = Date.now(); }     // as good as a touch: idle counts from now
  function touchAgain() { ST.touchSent = 0; }             // the next touch is reported at once
  function paneNote(message) { ST.previewPaneNote = message; }

  function kit() {
    return {
      allowed: allowed, armIdle: armIdle, autoLayout: autoLayout, BAND_BESIDE_GUTTER: BAND_BESIDE_GUTTER,
      BAND_H: BAND_H, BAND_MAX: BAND_MAX, BAND_NOW_BESIDE: BAND_NOW_BESIDE, BAND_PAD: BAND_PAD,
      BAND_REVEAL_MS: BAND_REVEAL_MS, BAND_STACKED: BAND_STACKED, BAND_W: BAND_W, BAND_ZONE: BAND_ZONE, build: build,
      cardConf: cardConf, cfgKey: cfgKey, CROSSFADE_MS: CROSSFADE_MS, dashConf: dashConf,
      DEFAULT_CARD_WIDTH: DEFAULT_CARD_WIDTH, EDGE: EDGE, ENTRANCE_MAX: ENTRANCE_MAX, FADE_BACK_MS: FADE_BACK_MS,
      FADE_IN_MS: FADE_IN_MS, fromSettings: fromSettings, GHOST_MS: GHOST_MS, landscapes: landscapes,
      LIST_DEPTH: LIST_DEPTH, LIST_MAX: LIST_MAX, LIST_TTL_MS: LIST_TTL_MS, mine: mine, MU_ART_MS: MU_ART_MS,
      onUpdate: onUpdate, PANE_TOP: PANE_TOP, PANE_W: PANE_W, PRESS_MAX: PRESS_MAX, refreshSoon: refreshSoon,
      releaseVisuals: releaseVisuals, reportTouch: reportTouch, ST: ST, teardown: teardown, WAKE: WAKE,
      whoMsg: whoMsg, writeSwitch: writeSwitch, ZOOM: ZOOM,
      askedEnds: askedEnds, dropCard: dropCard, idleCancel: idleCancel, inputFresh: inputFresh, noteInput: noteInput,
      paneNote: paneNote, pressIs: pressIs, pressStopped: pressStopped, touchAgain: touchAgain,
      // EACH PART'S EXPORTS (phase 25): what an earlier part calls of a later one, made empty here and filled by the
      // part as it runs -- the run's (start), the black's, the Side Pane's, the extras' (screens), the layouts', the
      // clock and forecast's (draw), music's. A part reads a later one's only when called, never as it runs.
      Run: {}, Black: {}, Pane: {}, Screens: {}, Layout: {}, Draw: {}, Music: {}
    };
  }
  function runParts() {
    var K = kit();
    PARTS.forEach(function (file) { window.hkSaverParts[partKey(file)](K); });
    actionsNow = K.actionsNow; alignOf = K.alignOf; BACKDROP_SMALL = K.BACKDROP_SMALL;
    backdropSmall = K.backdropSmall; beat = K.beat; behindAt = K.behindAt; bigWanted = K.bigWanted; black = K.black;
    blackChanged = K.blackChanged; blackPage = K.blackPage; ckFx = K.ckFx; ckPhotos = K.ckPhotos;
    cleanDepth = K.cleanDepth; cleanFocus = K.cleanFocus; cleanVariants = K.cleanVariants;
    clearCanvas = K.clearCanvas; clientNow = K.clientNow; clock = K.clock; closePanel = K.closePanel;
    cornerClient = K.cornerClient; coverDashboard = K.coverDashboard; coverRect = K.coverRect;
    coverShare = K.coverShare; createDesignController = K.createDesignController; CSS = K.CSS; DASH_CSS = K.DASH_CSS;
    DASH_SWIPE = K.DASH_SWIPE; dashViews = K.dashViews; dashWatch = K.dashWatch; dayFit = K.dayFit; Deck = K.Deck;
    drawBackdrop = K.drawBackdrop; drawnRect = K.drawnRect; dropSide = K.dropSide; energyLayout = K.energyLayout;
    energyPage = K.energyPage; energyPrep = K.energyPrep; energyReady = K.energyReady; exArm = K.exArm;
    exHide = K.exHide; exNext = K.exNext; EXTRA_ORDER = K.EXTRA_ORDER; extrasOf = K.extrasOf;
    FACE_SHOWS = K.FACE_SHOWS; faceOrigin = K.faceOrigin; faceWindow = K.faceWindow; feedCard = K.feedCard;
    fitOf = K.fitOf; framed = K.framed; gate = K.gate; glyphBox = K.glyphBox; go = K.go; held = K.held;
    hideEnergySlide = K.hideEnergySlide; hideForecastExtra = K.hideForecastExtra;
    hideForecastSlide = K.hideForecastSlide; hideMusicSlide = K.hideMusicSlide; hkSync = K.hkSync; HL = K.HL;
    hookClient = K.hookClient; houseBlock = K.houseBlock; INKS = K.INKS; inPaneAt = K.inPaneAt; inPanel = K.inPanel;
    isFlat = K.isFlat; isImage = K.isImage; justResumed = K.justResumed; landImg = K.landImg;
    layoutClient = K.layoutClient; layoutDraw = K.layoutDraw; layoutMusic = K.layoutMusic; layoutOf = K.layoutOf;
    layoutPane = K.layoutPane; layoutRoom = K.layoutRoom; leaveClock = K.leaveClock; leaveCorner = K.leaveCorner;
    leaveEnergy = K.leaveEnergy; leaveExtras = K.leaveExtras; leaveForecast = K.leaveForecast;
    leaveLayout = K.leaveLayout; leaveMusic = K.leaveMusic; mmss = K.mmss; MOSAIC_COLORS = K.MOSAIC_COLORS;
    mosaicAssign = K.mosaicAssign; mosaicPlan = K.mosaicPlan; MOSAICS = K.MOSAICS; MU_BG = K.MU_BG;
    MU_GRACE = K.MU_GRACE; mus = K.mus; musicAct = K.musicAct; musicHas = K.musicHas; musicHit = K.musicHit;
    musicNow = K.musicNow; musicPaneView = K.musicPaneView; musicPlaying = K.musicPlaying; musicTick = K.musicTick;
    musicView = K.musicView; musicWatch = K.musicWatch; nextPhoto = K.nextPhoto; nightCheck = K.nightCheck;
    nightNow = K.nightNow; noteDrawn = K.noteDrawn; pageCard = K.pageCard; panel = K.panel; panelFor = K.panelFor;
    panelTouched = K.panelTouched; paneOf = K.paneOf; photoFaces = K.photoFaces; photoOpts = K.photoOpts;
    photoUrl = K.photoUrl; placePanel = K.placePanel; previousPhoto = K.previousPhoto; queueDrag = K.queueDrag;
    readCfg = K.readCfg; reducedMotion = K.reducedMotion; refresh = K.refresh; releasePh = K.releasePh;
    renderMusic = K.renderMusic; restartPreview = K.restartPreview; saverTouched = K.saverTouched;
    scaleOf = K.scaleOf; schedule = K.schedule; sendWS = K.sendWS; shapeOfPh = K.shapeOfPh;
    showEnergySlide = K.showEnergySlide; showForecastSlide = K.showForecastSlide; showMusicSlide = K.showMusicSlide;
    shuffle = K.shuffle; skyStops = K.skyStops; slideHide = K.slideHide; slideLayout = K.slideLayout;
    slideLeave = K.slideLeave; slideOf = K.slideOf; slidePrep = K.slidePrep; slideReady = K.slideReady;
    slideShow = K.slideShow; slideView = K.slideView; SLOP = K.SLOP; start = K.start; stop = K.stop;
    syncPreviewSlide = K.syncPreviewSlide; tabletId = K.tabletId; tagOf = K.tagOf; takeover = K.takeover;
    tbKey = K.tbKey; tbShares = K.tbShares; TM = K.TM; tmWatch = K.tmWatch; turnOf = K.turnOf; user = K.user;
    viewFont = K.viewFont; volEnd = K.volEnd; volFrom = K.volFrom; weatherPage = K.weatherPage;
    widgetPage = K.widgetPage; withPane = K.withPane; WX = K.WX; zoneOf = K.zoneOf;
    // (phase 25: the owners' writers the shell asks, docs/phase25/SAVER-STATE.md)
    beatFrom = K.beatFrom; dashAgain = K.dashAgain; exCancel = K.exCancel; extraIs = K.extraIs;
    forgetRaw = K.forgetRaw; hkAgain = K.hkAgain; keepPh = K.keepPh; listAgain = K.listAgain;
    paneCardGone = K.paneCardGone; paneRelease = K.paneRelease; resumedNow = K.resumedNow; showsLayer = K.showsLayer;
    sinceSlide = K.sinceSlide; tbCancel = K.tbCancel;
  }

  loadParts(function () {
    runParts();

    beatFrom();

    Deck.prototype.set = function (items) {
      var had = this.items.map(function (x) { return x.id; }).join('\n');
      this.items = items.slice();
      if (this.items.map(function (x) { return x.id; }).join('\n') !== had) { this.round = []; this.pos = 0; }
    };

    Deck.prototype.next = function () {
      if (this.back > 0) {                  // stepping forward again after previous()
        this.back--;
        return this.history[this.history.length - 1 - this.back] || null;
      }
      if (!this.items.length) return null;
      if (this.pos >= this.round.length) {
        var last = this.history[this.history.length - 1];
        this.round = this.order === 'sorted'
          ? this.items.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })
          : shuffle(this.items, this.rnd);
        if (this.order !== 'sorted' && last && this.round.length > 1 && this.round[0].id === last.id) {
          this.round.push(this.round.shift());
        }
        this.pos = 0;
      }
      var it = this.round[this.pos++];
      this.history.push(it);
      if (this.history.length > 50) this.history.shift();
      return it;
    };

    Deck.prototype.previous = function () {
      if (this.history.length - 1 - this.back <= 0) return null;
      this.back++;
      return this.history[this.history.length - 1 - this.back] || null;
    };

    pageCard();

    ST.designController = createDesignController({ client: clientNow, running: function () { return ST.on; }, preview: function () { return ST.previewOn; }, touched: saverTouched, stop: stop,
      refresh: refresh });
    // (the Now Playing page)
    if (ST.PageCard && window.hkHostClient && !customElements.get('hk-now-playing-page-card')) { window.hkHostClient.entry(ST.PageCard); customElements.define('hk-now-playing-page-card', ST.PageCard);
      }

    ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'wheel', 'keydown', 'click', 'mousedown', 'pointermove']
      .forEach(function (t) { window.addEventListener(t, onInput, { passive: true, capture: true }); });
    // the touch that stopped it, lifting
    ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach(function (t) {
      window.addEventListener(t, function () { if (ST.press && ST.press.up === null) ST.press.up = clock.now(); if (mus.drag) volEnd(); }, { passive: true, capture: true });
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
          if (ST.pnl && ST.pnl.view === v) closePanel(false);
          v.live = false;
          musicTick();
        }
        // the shared view, into this card's pane
        _adopt() {
          var v = this._v = dashV, box = this._root.querySelector('.pane');
          if (v.host === this && v.el.parentNode === box) return;
          if (ST.pnl && ST.pnl.view === v && v.host !== this) closePanel(false);
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
          if (v.live) { this._size(); if (!was) { dashAgain(); renderMusic(); } }
          else if (ST.pnl && ST.pnl.view === v) closePanel(false);
          musicTick();
        }
        // WHEN IT WAS LAST IN USE (hk-popup.js holds the sheet a grace after):
        // its panel open is now; else the last touch on it
        hkLastUse() {
          var v = this._v;
          if (v && v.host === this && ST.pnl && ST.pnl.view === v) return Date.now();
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
            ':host([hk-flat]) .pm{background:#24252A!important;color:#F5F4F0;--hk-ink:#F5F4F0;--hk-ink-2:#C3C3C6;--hk-ink-3:#A3A4A9;--hk-glyph:#F5F4F0;--hk-key:#3A3B40;--hk-line:#48494F;' +
              '--hk-line-strong:#62636A}' +
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
            var b = e.target.closest ? e.target.closest('.mbtn,.hksl') : null;
            if (b) { musicAct({ btn: b, view: v }); return; }
            if (e.target.closest && e.target.closest('.msq')) musicAct({ art: true, view: v });
          });
          var vt = v.vh;   // (the volume's whole row, its target: hk-np-strip.js)
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
            if (d || !self._v || (ST.pnl && ST.pnl.view === self._v) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
            var path = ev.composedPath ? ev.composedPath() : [];
            if (path.indexOf(self._v.vh) >= 0) return;
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
    window.addEventListener('kiosksatellite:screensaverstart', function () { ST.ksSaver = true; blackChanged(); });
    window.addEventListener('kiosksatellite:screensaverstop', function () { ST.ksSaver = false; blackChanged(); });
    window.addEventListener('kiosksatellite:screenoff', function () { ST.ksOff = true; blackChanged(); });
    window.addEventListener('kiosksatellite:screenon', function () { ST.ksOff = false; blackChanged(); });
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
    window.addEventListener('resize', function () { if (ST.on) { if (ST.previewOn) refresh(); layoutPane(); layoutMusic(); placePanel(); setTimeout(dayFit, 50); } });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { ST.lastInput = Date.now(); armIdle(); resumedNow(); }
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
        kind = ['music', 'weather', 'energy', 'holiday', 'timer', 'forecast'].indexOf(kind) >= 0 ? kind : '';
        var changed = ST.previewSelected !== kind;
        ST.previewSelected = kind;
        if (!ST.on || !ST.previewOn) return false;
        if (changed) {
          if (ST.muShowing) hideMusicSlide();
          slideHide(WX); slideHide(HL); slideHide(TM);
          if (ST.enShowing) hideEnergySlide();
          if (ST.fcShowing && ST.mode !== 'forecast') hideForecastExtra();
          extraIs('');
          exCancel();
          if (kind === 'energy') energyPrep();
          if (kind === 'weather' || kind === 'holiday' || kind === 'timer') slidePrep(kind === 'weather' ? WX : kind === 'timer' ? TM : HL);
        }
        return syncPreviewSlide();
      },
      previewPane: function (show) { var next = show === true ? true : show === false ? false : null;
        if (next !== ST.previewPane) { ST.previewPane = next; if (ST.previewOn) refresh(); } return ST.previewPane; },
      previewStatus: function () {
        return { selected: ST.previewSelected, ready: syncPreviewSlide() || ST.previewSelected === 'forecast' && ST.mode === 'forecast', pane: ST.paneUp, paneMessage: window.hkSidePane &&
          window.hkSidePane.placement(window.innerWidth, window.innerHeight, { width: ST.cfg && ST.cfg.pane_width }).kind === 'none' ?
          'The Side Pane needs more room. Choose Wall Tablet or iPad Upright to preview it.' : ST.previewPaneNote,
          message: ST.previewSelected === 'music' && !musicPlaying() ? 'Sample music · playback controls are inactive.' :
            ST.previewSelected === 'energy' && !energyReady() ? 'Home Energy needs energy data before its slide can be shown.' :
            ST.previewSelected === 'weather' && !slideReady(WX) ? 'Waiting for weather data…' : ST.previewSelected === 'holiday' && !slideReady(HL) ? 'No holiday is near enough to show.' :
              ST.previewSelected === 'forecast' && ST.mode === 'forecast' ? 'Forecast is already the background for this design.' : '' };
      },
      previewNight: function (v) { ST.nightPreview = v === true ? true : v === false ? false : null; nightCheck(); return ST.nightPreview; },
      layoutInfo: function () {
        var LM = window.hkSaverLayout;
        if (!ST.ly || !ST.ly.plan || !LM || !ST.cfg || !ST.cfg.layout || !ST.host) return null;
        var R = layoutRoom();
        var O = LM.oriented(LM.clean(ST.cfg.layout), R.W, R.H), empty = {};
        // (empty: a "shows when..." piece with nothing to show, by its catalog id; claims: who shows a fact a piece would)
        Object.keys(ST.ly.empty || {}).forEach(function (k) { empty[ST.ly.empty[k]] = true; });
        return { W: R.W, H: R.H, room: R.room, plan: ST.ly.plan, zones: O.zones, big: O.big, row_at: O.row_at, row_size: O.row_size, empty: empty,
                 emptyAt: Object.assign({}, ST.ly.empty), claims: Object.assign({}, ST.ly.claims), landShare: ST.ly.landShare };
      },
      running: function () { return ST.on; },
      chooseDesign: function () { if (ST.designController) ST.designController.open(); },
      covered: function () { return ST.on && !!ST.coveredPage; },
      // the forecast is what is showing (not photos)
      forecast: function () { return ST.on && ST.mode === 'forecast'; },
      // HK Settings' preview frame: show it now and keep it up; false takes it away
      // `shape`: 'portrait' or 'landscape' -- a photo of that shape (the
      // Portrait / Landscape Photos settings), held while they change
      // `house`: with All Screens' settings, not this screen's own
      // 'energy': Home Energy, held while its options change; 'weather': the weather
      // `over`: the options to show, as the page has them now (previewOver), else the saved ones
      preview: function (v, shape, house, over) {
        var sh = shape === 'portrait' || shape === 'landscape' ? shape : null, en = shape === 'energy', wx = shape === 'weather';
        ST.previewHouse = !!(v && house);
        ST.previewOver = v && over && typeof over === 'object' && !Array.isArray(over) ? over : null;
        if (sh !== ST.previewShape || en !== ST.previewEnergy || wx !== ST.previewWeather) {
          ST.previewShape = sh; ST.previewEnergy = en; ST.previewWeather = wx;
          if (ST.lastPh && sh && shapeOfPh(ST.lastPh) !== sh) keepPh(null);
          if (ST.previewOn && ST.on && v) setTimeout(restartPreview, 0);
        }
        ST.previewOn = !!v;
        if (!ST.previewOn) { keepPh(null); ST.nightPreview = null; ST.previewSelected = ''; ST.previewPane = null; ST.previewPaneNote = ''; }
        ST.force = ST.previewOn;
        refresh();
        if (ST.previewOn && !ST.on) start('preview');
        else if (!ST.previewOn && ST.on && ST.startedBy === 'preview') stop('manual');
        return ST.previewOn;
      },
      // Console / probe helpers. hkSaver.start() shows it now; stop() takes it
      // away (as a touch would, but without writing the switch).
      start: function () { refresh(); return start('manual'); },
      // THE MUSIC, FULL SCREEN (2026-11-01, the owner: the Side Pane's cover tapped): the screensaver now, on its music
      // slide; false where it can't (nothing playing, no screensaver on this screen), and nothing changed
      showMusic: function () {
        refresh();
        var ctx = musicNow(clientNow());
        if (!ctx || !ctx.playing || !ST.cfg) return false;
        if (!ST.on) {
          var was = ST.force;
          ST.asked = ST.force = true;
          if (!start('music')) { ST.asked = false; ST.force = was; return false; }
        }
        if (showMusicSlide(true)) return true;
        if (ST.startedBy === 'music') stop('manual');
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
      force: function (v) { ST.force = !!v; refresh(); return ST.force; },
      // THE HOST'S PHOTOS CHANGED (a screen's album, an album's photos): listed
      // again at the next photo, and the source asked again now
      photosChanged: function () { listAgain(); refresh(); },
      config: function () { return ST.cfg; },
      // what plays for the dashboard's Now Playing pane (hk-popup.js): there
      // (playing or paused), and playing
      music: { has: musicHas, playing: function (h) { var c = musicNow(h || clientNow()); return !!(c && c.playing); } },
      stats: function () {
        return { on: ST.on, startedBy: ST.startedBy, allowed: allowed(), photos: ST.deck ? ST.deck.items.length : null,
                 shown: ST.shown, failed: ST.failed, last: ST.lastPhoto, cards: ST.cards.length,
                 idleIn: ST.cfg && !ST.on && ST.cfg.starts_after ? Math.max(0, Math.round((ST.lastInput + ST.cfg.starts_after * 1000 - Date.now()) / 1000)) : null,
                 blocking: !!(ST.press && ST.host), switch: switchState(),
                 waking: !!(ST.host && ST.host.hasAttribute('waking')), fadeBack: ST.cfg ? ST.cfg.fade_back : null,
                 mode: ST.on ? ST.mode : null, clock: ST.ckCtl ? ST.ckCtl.style : null, clockColor: ST.ckCtl ? ST.ckCtl.color : null, night: !!(ST.host && ST.host.hasAttribute('cknight')),
                   mosaic: ST.moState && ST.displayLayer === ST.moState.layer ? { n: ST.moState.n, idx: ST.moState.idx, left: ST.moState.left } : null,
                   clockOver: !!(ST.host && ST.host.hasAttribute('ckphotos')) ? 'photos' : null, land: ST.fscene && ST.fscene.landShown ? ST.fscene.landShown() || null : null,
                 forecastSlide: ST.on && ST.fcShowing, sinceForecast: ST.sinceFc, preview: ST.previewOn, previewShape: ST.previewShape,
                 shown_shape: ST.lastPh ? shapeOfPh(ST.lastPh) : null, shown_url: ST.lastPh ? ST.lastPh.url : null,
                 band: !!(ST.host && ST.host.hasAttribute('band')),
                 calendar: !!(ST.host && ST.host.hasAttribute('pcal')), pane: !!(ST.host && ST.host.hasAttribute('pane')), paneW: ST.paneW, musicIn: mus.paneIn, paneNext: mus.paneNext,
                   musicFirst: takeover(), paneCard: !!ST.paneCard,
                 energySlide: ST.on && ST.enShowing, weatherSlide: ST.on && WX.showing, holidaySlide: ST.on && HL.showing, timerSlide: ST.on && TM.showing, timerHeld: !!(ST.TW && ST.TW.held()),
                   previewWeather: ST.previewWeather, extra: ST.exKind || null, extras: ST.cfg ? extrasOf(ST.cfg) : [], previewEnergy: ST.previewEnergy,
                 musicSlide: ST.on && ST.muShowing, musicPane: !!musicPaneView(), music: mus.key, upNext: mus.next ? mus.next.title : null,
                 panel: ST.pnl ? ST.pnl.p.tab() : null };
      },
      _: { darkUnderBlack: function (v) { ST.DARK_UNDER_BLACK = !!v; }, clock: clock, beat: beat, justResumed: function () { return justResumed(); },
           // tests: as a page just loaded, for HK's black (its first decision)
           hkFresh: function () { hkAgain(); },
           // tests: the next touch is told at once (not held by the 10 s between reports)
           touchFresh: function () { ST.touchSent = 0; },
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
           layoutNow: function () { if (ST.ly) layoutDraw(); },
           // tests: the slide without real photos to count
           slide: { show: showForecastSlide, hide: hideForecastSlide, since: function (n) { sinceSlide(n); }, schedule: function () { schedule(); } },
           paneOf: paneOf, withPane: withPane, slideOf: slideOf, turnOf: turnOf, extrasOf: extrasOf, mmss: mmss, EXTRA_ORDER: EXTRA_ORDER,
           // tests: Home Energy and the additional screens without waiting minutes
           energy: { show: showEnergySlide, hide: hideEnergySlide, ready: energyReady, prep: energyPrep, layout: energyLayout,
                     ctl: function () { return ST.enCtl; } },
           weather: { show: function (f) { return slideShow(WX, f); }, hide: function () { slideHide(WX); }, ready: function () { return slideReady(WX); }, prep: function () { slidePrep(WX); },
             layout: function () { slideLayout(WX); }, ctl: function () { return WX.ctl; } },
           timer: { show: function (f) { return slideShow(TM, f); }, hide: function () { slideHide(TM); }, ready: function () { return slideReady(TM); }, prep: function () { slidePrep(TM); },
             watch: function () { if (ST.TW) ST.TW.again(); tmWatch(); }, ctl: function () { return TM.ctl; } },
           holiday: { show: function (f) { return slideShow(HL, f); }, hide: function () { slideHide(HL); }, ready: function () { return slideReady(HL); }, prep: function () { slidePrep(HL); },
             layout: function () { slideLayout(HL); }, ctl: function () { return HL.ctl; } },
           extras: { next: exNext, hide: exHide, arm: exArm, kind: function () { return ST.exKind; }, last: function () { return ST.exLast; } },
           // tests: the music without real speakers
           music: { show: showMusicSlide, hide: hideMusicSlide, render: renderMusic, watch: function () { mus.watchAt = 0; musicWatch(); },
                    dash: dashViews,
                    hit: musicHit, act: musicAct, now: musicNow, layout: layoutMusic, grace: MU_GRACE,
                    // the panel: open on the slide or the pane, close
                    panel: function (kind, tab) {
                      if (!kind) { closePanel(true); return null; }
                      var v = kind === 'pane' ? musicPaneView() : slideView();
                      panelFor(v, tab || 'speakers');
                      return ST.pnl ? ST.pnl.p.tab() : null;
                    } } }
    };
  });
})();
