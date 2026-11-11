// hk-saver-pane.js - the dashboard's pane and the Now Playing page.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-pane'] = function (K) {
    var BAND_BESIDE_GUTTER = K.BAND_BESIDE_GUTTER, BAND_H = K.BAND_H, BAND_NOW_BESIDE = K.BAND_NOW_BESIDE,
        BAND_REVEAL_MS = K.BAND_REVEAL_MS, BAND_STACKED = K.BAND_STACKED, BAND_W = K.BAND_W, cardConf = K.cardConf,
        clientNow = K.clientNow, closePanel = K.closePanel, CSS = K.CSS, dayFit = K.dayFit, feedCard = K.feedCard,
        layoutModules = K.layoutModules, layoutMusicView = K.layoutMusicView, layoutSoon = K.layoutSoon, mus = K.mus,
        musicAct = K.musicAct, musicNow = K.musicNow, musicPane = K.musicPane, musicPaneView = K.musicPaneView,
        musicTick = K.musicTick, musicView = K.musicView, PANE_TOP = K.PANE_TOP, PANE_W = K.PANE_W,
        panelTouched = K.panelTouched, paneOf = K.paneOf, renderMusic = K.renderMusic, setAttr = K.setAttr, ST = K.ST,
        volEnd = K.volEnd, volFrom = K.volFrom, weatherEntity = K.weatherEntity;
    // (phase 25: the owners' writers, docs/phase25/SAVER-STATE.md)
    var bandIs = K.bandIs, Black = K.Black, clock = K.clock, clock24 = K.clock24, dropCard = K.dropCard, Run = K.Run;


    // WHAT IT OWNS ON ST (phase 25, A: others read these; only this file writes them; tools/state_owners.py)
    ST.paneCard = null;
    ST.dashAt = 0;
    ST.paneT = null;
    ST.paneUp = false;
    ST.downOpts = null;
    ST.curtainRun = 0;
    ST.paneW = 0;
    ST.curtain = null;
    ST.PageCard = null;

    // ITS OWN STATE (phase 25, A: off the shared ST, which only this file used; tools/state_owners.py)
    /** @type {any} */ var paneSide = 'right';
    /** @type {any} */ var sidePane = null;
    /** @type {any} */ var sideT = null;
    /** @type {any} */ var dashT = null;
    /** @type {any} */ var dashOut = null;
    /** @type {any} */ var wasBlack = false;

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
    function hostOf(v) { return v && v.kind === 'dash' ? v.host : ST.host; }
    function rootOf(v) { return v && v.kind === 'dash' ? v.root : ST.root; }
    function dashWatch() {
      if (ST.on || !dashLive()) return;
      var now = Date.now();
      if (now - ST.dashAt < 1000) {
        if (!dashT) dashT = setTimeout(function () { dashT = null; dashWatch(); }, 1000 - (now - ST.dashAt));
        return;
      }
      ST.dashAt = now;
      renderMusic();
    }
    function dashOutside(want) {
      if (!want) {
        if (dashOut) { document.removeEventListener('pointerdown', dashOut, true); dashOut = null; }
        return;
      }
      if (dashOut) return;
      dashOut = function (e) {
        if (!ST.pnl || ST.pnl.view.kind !== 'dash') return;
        var path = e.composedPath ? e.composedPath() : [];
        if (path.indexOf(ST.pnl.p.el) >= 0) { panelTouched(); return; }
        // (its own buttons: Speakers / Browse switch or close it themselves)
        var mixers = ST.pnl.view.el.querySelectorAll('.mbtn.mx,.hksl');
        for (var i = 0; i < mixers.length; i++) if (path.indexOf(mixers[i]) >= 0) return;
        closePanel(true);
      };
      document.addEventListener('pointerdown', dashOut, true);
    }
    function setPane(up) {
      if (!ST.host) return;
      ST.paneUp = !!up;
      setAttr(ST.host, 'pane', ST.paneUp);
      if (ST.paneUp) {
        layoutPane();
        // what Home Status, the music and the timers take comes and goes with
        // the house: measured again every moment (a few rect reads)
        if (!ST.paneT) ST.paneT = setInterval(function () { if (ST.on) paneStack(); }, 1500);
      } else {
        if (ST.host.style.removeProperty) PANE_VARS.forEach(function (v) { if (PANE_OWN.indexOf(v) < 0) ST.host.style.removeProperty(v); });
        ST.paneW = 0;
        if (ST.paneT) { clearInterval(ST.paneT); ST.paneT = null; }
      }
      // Home Status and the timers: into the pane or back to their corners;
      // the forecast details beside it or across
      ST.cards.forEach(function (el) {
        if (el.__hkSaverConf) { try { el.setConfig(cardConf(el.__hkSaverConf, el.localName)); } catch (e) { /* as it was */ } }
      });
      if (ST.fband && ST.fband.isConnected && ST.fband._config) {
        try { ST.fband.setConfig(Object.assign({}, ST.fband._config, { hours: ST.paneUp ? 8 : 12, now_width: ST.paneUp ? BAND_NOW_BESIDE : undefined })); } catch (e) { /* as it was */ }
        setTimeout(function () { if (ST.fband && ST.fband.isConnected) centerBand(ST.fband); }, 350);
      }
    }
    // THE MUSIC IN THE PANE, there while music plays (or is paused), and
    // MU_GRACE after: under the calendar at once; alone, the pane comes and
    // goes with the next photo (over the forecast, at once)
    function musicIn(want) {
      if (!ST.host || !ST.cfg || !ST.cfg.music_pane || want === mus.paneIn) return;
      mus.paneIn = want;
      setAttr(ST.host, 'pm', want);
      musicTick();
      if (ST.cfg.calendar) { paneStack(); return; }
      var photo = ST.displayLayer && ST.displayLayer.classList.contains('ph') && ST.mode === 'photos' && !ST.muShowing && !ST.fcShowing;
      if (photo) mus.paneNext = want;
      else { mus.paneNext = null; setPane(want); }
    }
    function setupPane() {
      if (!ST.host) return;
      var dropCal = function () {
        if (ST.paneCard) { dropCard(ST.paneCard); ST.paneCard.remove(); ST.paneCard = null; }
      };
      mus.paneNext = null;
      if (!paneOf(ST.cfg)) {
        dropSide();
        ST.host.removeAttribute('panecfg'); ST.host.removeAttribute('pcal'); ST.host.removeAttribute('pm'); ST.host.removeAttribute('pside'); ST.host.removeAttribute('pbare');
        mus.paneIn = false;
        setPane(false);
        if (ST.host.style.removeProperty) PANE_VARS.forEach(function (v) { ST.host.style.removeProperty(v); });
        dropCal();
        musicPane(false);
        return;
      }
      ST.host.setAttribute('panecfg', '');
      setAttr(ST.host, 'pside', ST.cfg.pane_side === 'left');
      if (ST.cfg.pane_list) {
        ST.host.removeAttribute('pcal'); ST.host.removeAttribute('pm');
        mus.paneIn = false;
        dropCal();
        musicPane(false);
        sideSections();
        return;
      }
      dropSide();
      // THE CALENDAR ([pcal]) and THE MUSIC ([pm], while it plays) share it:
      // either fills it, both put the calendar above the music
      setAttr(ST.host, 'pcal', ST.cfg.calendar);
      // (playing, not paused: a song left paused does not bring the pane back
      // each time the screensaver starts)
      var c0 = ST.cfg.music_pane ? musicNow(clientNow()) : null, playing = !!(c0 && c0.playing);
      mus.paneIn = playing; mus.lastActive = playing ? clock.now() : 0;
      setAttr(ST.host, 'pm', playing);
      musicPane(ST.cfg.music_pane);
      setPane(ST.cfg.calendar || playing);
      if (!ST.cfg.calendar) { dropCal(); return; }
      var tag = 'hk-calendar-pane-card', days = ST.cfg.calendar_days;
      if (ST.paneCard) {
        if ((ST.paneCard._config || {}).days !== days) ST.paneCard.setConfig({ type: 'custom:' + tag, days: days });
        return;
      }
      var make = function () {
        if (!ST.host || !ST.paneSc || ST.paneCard || !ST.cfg || !ST.cfg.calendar) return;
        try {
          var el = /** @type {any} */ (document.createElement(tag));
          el.setConfig({ type: 'custom:' + tag, days: ST.cfg.calendar_days });
          feedCard(el, clientNow());
          ST.paneSc.appendChild(el);
          ST.cards.push(el);
          ST.paneCard = el;
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
      if (!ST.host || !ST.cfg || !ST.cfg.pane_list || !SP) return;
      var box = ST.paneEl || (ST.root && ST.root.querySelector('.pane'));
      if (!box) return;
      if (!sidePane) { sidePane = SP.create('saver'); box.appendChild(sidePane); }
      var list = SP.saverList({ saver: { show: 'own', sections: ST.cfg.pane_list } }, clientNow());
      setPane(list.length > 0);
      var w = ST.paneW || Math.round(PANE_W * scaleOf());
      sidePane.show({ list: list, place: { kind: 'side', w: w }, side: ST.cfg.pane_side });
      if (!sideT) sideT = setInterval(function () { if (ST.on && ST.cfg && ST.cfg.pane_list) sideSections(); }, 1500);
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
      if (!ST.host || !ST.paneUp) return;
      var z = scaleOf(), SP = window.hkSidePane, w = Math.round(((SP && SP.WIDTHS[ST.cfg.pane_width]) || PANE_W) * z);
      // the list scaled with the screen (its card may arrive after the width)
      if (ST.paneCard && (ST.paneCard.style.zoom || '1') !== String(z)) ST.paneCard.style.zoom = z === 1 ? '' : String(z);
      var sideNow = (ST.cfg && ST.cfg.pane_side) || 'right';
      if (w === ST.paneW && sideNow === paneSide && ST.host.style.getPropertyValue && ST.host.style.getPropertyValue('--hk-pane-w')) return;
      ST.paneW = w; paneSide = sideNow;
      // a new width for the pane is a new room for the band beside it
      if (ST.fband && ST.fband.isConnected) setTimeout(function () { if (ST.fband && ST.fband.isConnected) centerBand(ST.fband); }, 0);
      var px = function (n) { return Math.round(n * z) + 'px'; };
      ST.host.style.setProperty('--hk-pane-w', w + 'px');
      // one margin for everything in the pane: the list, Home Status, its foot
      ST.host.style.setProperty('--hk-pane-pad', px(28));
      // WHAT PLAYS AND THE TIMERS, in the pane's foot (hk-media.js,
      // hk-timers.js): on its 28 px margins, left-aligned with the list,
      // smaller than in a corner of the photos. Their left edge is measured
      // from the screen's RIGHT (100% of the screen-sized host, the box their
      // position:fixed resolves against), so a window resized or a screen
      // turned at the same scale -- the pane's width unchanged, this skipped --
      // leaves them in the pane, never where the old width put them.
      var left = ST.cfg && ST.cfg.pane_side === 'left';
      var footLeft = left ? px(28) : 'calc(100% - ' + (w - Math.round(28 * z)) + 'px)';
      ST.host.style.setProperty('--hk-ss-now-left', footLeft);
      ST.host.style.setProperty('--hk-ss-now-max', (w - Math.round(56 * z)) + 'px');
      ST.host.style.setProperty('--hk-ss-np-art', px(64));
      ST.host.style.setProperty('--hk-ss-np-title', px(20));
      ST.host.style.setProperty('--hk-ss-np-artist', px(16));
      ST.host.style.setProperty('--hk-ss-np-gap', px(14));
      ST.host.style.setProperty('--hk-ss-timers-left', footLeft);
      ST.host.style.setProperty('--hk-ss-timers-right', px(28));
      ST.host.style.setProperty('--hk-ss-timers-max', (w - Math.round(56 * z)) + 'px');
      ST.host.style.setProperty('--hk-ss-status-right', (left ? (window.innerWidth || 0) - w + Math.round(28 * z) : Math.round(28 * z)) + 'px');
      ST.host.style.setProperty('--hk-ss-status-top', Math.round(26 * z) + 'px');
      ST.host.style.setProperty('--hk-ss-status-width', (w - Math.round(56 * z)) + 'px');
      paneStack();
      layoutSoon();
    }
    // THE PANE'S LIST between Home Status (one line, or two or three when
    // much is open) and its foot (what plays above the running timers, each
    // only while there is one): measured, so nothing overlaps whatever shows
    function paneStack() {
      if (!ST.host || !ST.root || !ST.paneUp) return;
      var z = scaleOf(), pad = Math.round(22 * z), gap = Math.round(14 * z);
      var hOf = function (tag, sel) {
        var el = null;
        for (var i = 0; i < ST.cards.length; i++) if (ST.cards[i].localName === tag) { el = ST.cards[i]; break; }
        var n = el && el.shadowRoot && el.shadowRoot.querySelector(sel);
        if (!n || !n.getBoundingClientRect) return null;
        var r = n.getBoundingClientRect();
        return r.height > 1 ? r : null;
      };
      var st = hOf('hk-screensaver-status-card', '.sscorner');
      var np = hOf('hk-screensaver-now-card', '.sscorner'), tm = hOf('hk-timer-strip-card', 'div[style*="position:fixed"]');
      var tH = tm ? Math.round(tm.height) : 0, nH = np ? Math.round(np.height) : 0, set = function (k, v) { if (ST.host.style.getPropertyValue(k) !== v) ST.host.style.setProperty(k, v); };
      // ROOM ABOVE ONLY FOR A HOME STATUS IN THE PANE (2026-11-05: on the photo it left an empty band; one not drawn yet keeps it)
      var pr = ST.paneEl ? ST.paneEl.getBoundingClientRect() : null, mid = st ? (st.left + st.right) / 2 : 0,
        bare = !ST.cards.some(function (c) { return c.localName === 'hk-screensaver-status-card'; });
      if (st && pr && pr.width > 1 && (mid < pr.left || mid > pr.right)) { st = null; bare = true; }
      setAttr(ST.host, 'pbare', bare);   // (pbare: no rule over the list)
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
        if (ST.cfg.calendar && ST.host.hasAttribute('pm')) set('--hk-pane-bottom', ((body && body.offsetHeight) || 0) + 'px');
      }
    }

    // the weather band: today's conditions, the next hours and the coming days
    function addBand(box) {
      var tag = 'hk-weather-band-card';
      var make = function () {
        if (!ST.host || !box.isConnected) return;
        var h = clientNow(), HS = window.hkSettings;
        var wid = h && HS && HS.weatherId ? HS.weatherId(h.states) : null;
        if (!wid) return;
        try {
          var el = /** @type {any} */ (document.createElement(tag));
          // beside the calendar pane: today beside the hours and days, as on
          // the other screens, its column slimmer and fewer hours
          el.setConfig({ type: 'custom:' + tag, entity: wid, hours: ST.paneUp ? 8 : 12, days: 6, plain: true,
                         now_width: ST.paneUp ? BAND_NOW_BESIDE : undefined });
          feedCard(el, h);
          // NOT SEEN UNTIL IT IS IN PLACE: it can only be centred once it has
          // drawn (centerBand measures it), so it drew ~25 px off and jumped
          // a quarter second into the slide -- and beside the calendar pane
          // again when it redrew for its width (2026-10-01). Hidden until it is
          // where it stays, then faded in.
          el.style.opacity = '0';
          box.appendChild(el);
          ST.cards.push(el);
          bandIs(el);
          var placed = function () {
            if (ST.fband !== el || !el.isConnected) return;
            centerBand(el);
            el.style.transition = 'opacity ' + BAND_REVEAL_MS + 'ms ease';
            el.style.opacity = '';
            el.__hkPlaced = true;
            if (ST.entrance) ST.entrance();               // the fade may begin now
          };
          // centred as soon as it has drawn, not at the next tick -- beside the
          // pane once more after it has redrawn for its width
          setTimeout(function () {
            if (ST.fband !== el || !el.isConnected) return;
            centerBand(el);
            setTimeout(placed, ST.paneUp ? 400 : 0);
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
      if (ST.paneUp && !ST.paneW) layoutPane();
      // the scale first (a bigger screen: the tablet's band, bigger) -- CSS
      // zoom, so it lays out as on the tablet and takes its scaled room
      var z = scaleOf();
      if (String(z) !== (card.style.zoom || '1')) card.style.zoom = z === 1 ? '' : String(z);
      // BESIDE THE CALENDAR PANE: the photos' (the land's) width is the room,
      // the band stands up no wider than BAND_STACKED, and its zone is the
      // meadow of the land as it covers that narrower box
      var RW = W - (ST.paneUp ? ST.paneW : 0), box = card.parentNode;
      if (box && box.style) {
        if (ST.paneUp) {
          box.style.height = Math.round(Math.max(0.356 * H, 0.2225 * RW)) + 'px';
          box.style.padding = '';
          var mw = Math.max(BAND_STACKED, Math.round(RW / z) - 2 * BAND_BESIDE_GUTTER) + 'px';
          if (card.style.maxWidth !== mw) {
            card.style.maxWidth = mw;
            // the band redraws its columns for the new width a moment later
            // (its own ResizeObserver): centre it again once it has
            setTimeout(function () { if (ST.fband === card && card.isConnected) centerBand(card); }, 350);
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
      var x0 = ST.paneUp && ST.cfg && ST.cfg.pane_side === 'left' ? ST.paneW : 0;
      var want = Math.round(cur + ((x0 + RW - hi) - (lo - x0)) / 2 / z);
      if (Math.abs(want - cur) >= 1) card.style.setProperty('--hk-band-shift', want + 'px');
    }
    // UNDER A BLACK: the kiosk's Black screensaver, its panel off, or HK's own
    // (Black Screen: HK Frontend, below)
    function black() { return ST.ksSaver || ST.ksOff || ST.hkOn; }
    function blackChanged() {
      var now = black();
      if (now === wasBlack) return;
      wasBlack = now;
      if (now) { ST.downOpts = null; curtainUp(); Black.goDark(); }
      else { var d = ST.downOpts; ST.downOpts = null; Run.lit(); Black.lightSoon(); Black.litNow(); curtainDown(d); }
      tellBlack(now);
    }
    var CURTAIN_HOLD = 300;
    var CURTAIN_HOLD_HK = 60;
    var CURTAIN_FADE = 450;
    var CURTAIN_MAX = 2000;
    function curtainUp() {
      ST.curtainRun++;
      if (drawCurtain()) Black.bootCover(false);
    }
    // the curtain on the page, opaque, now
    function drawCurtain() {
      if (!document.body || typeof document.createElement !== 'function') return false;
      if (!ST.curtain) {
        ST.curtain = document.createElement('div');
        ST.curtain.setAttribute('data-hk-curtain', '');
        if (ST.curtain.addEventListener) ST.curtain.addEventListener('pointerdown', curtainTapped, true);
      }
      var cs = ST.curtain.style;
      cs.position = 'fixed'; cs.inset = '0'; cs.top = cs.left = '0'; cs.width = '100vw'; cs.height = '100vh';
      cs.zIndex = '2147483647'; cs.background = '#000'; cs.pointerEvents = ST.hkOn ? 'auto' : 'none';
      cs.transition = 'none'; cs.opacity = '1';
      if (ST.curtain.parentNode !== document.body) document.body.appendChild(ST.curtain);
      return true;
    }
    // `opts`: { hold: ms after two frames, onFade: called as the fade starts }
    function curtainDown(opts) {
      opts = opts || {};
      if (black()) return;
      // no curtain to fade (a page that never drew one): the backlight all the same
      if (!ST.curtain || !ST.curtain.parentNode) { if (opts.onFade) { try { opts.onFade(); } catch (e) { /* none */ } } return; }
      var run = ++ST.curtainRun, c = ST.curtain, going = false;
      var go = function () {
        if (going || run !== ST.curtainRun) return;
        going = true;
        c.style.transition = 'opacity ' + CURTAIN_FADE + 'ms ease';
        c.style.opacity = '0';
        if (opts.onFade) { try { opts.onFade(); } catch (e) { /* the curtain goes all the same */ } }
        // a tap still catching it is swallowed until it is gone
        setTimeout(function () { if (run === ST.curtainRun && c.parentNode) c.remove(); }, CURTAIN_FADE + 80);
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
      if (!ST.hkOn) return;
      if (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
      Black.hkTapWake();
    }

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
      // its controls take taps (the screensaver's find them by place) -- the volume's whole row, its target (2026-11-09:
      // a ::before reached 18 px over the room above the track, toward the play button; hk-np-strip.js)
      '.pm .mbtn,.pm .mvol,.pm .msq,.pm .hksl,.pm .mql{pointer-events:auto;cursor:pointer}',
      // (bare buttons, 2026-11-07: a pointer over one dims it, nothing drawn behind it)
      '@media (hover:hover){.pm .mbtn:hover{opacity:.75}}',
      // THE SIDE PANE'S FULL (inpane, hk-sidepane.js; 2026-11-07, the owner): the art's shadow kept inside the pane's
      // margin (its 60 px blur was cut off either side of the art), and Up Next a list under the buttons -- the art at
      // the pane's width first, the list in the height left, whole rows only (a row that does not fit wraps to a
      // column out of sight), its first row and heading together
      ':host([inpane]) .msq{box-shadow:0 calc(12px * var(--z)) calc(26px * var(--z)) rgba(0,0,0,.42)}',
      ':host([inpane]:not([compact])) .pm[mqon] .mart{flex:0 1 calc(100cqw - 2 * var(--hk-pane-pad,28px))}',
      ':host([inpane]:not([compact])) .pm[mqon] .mnext{display:none}',
      // (Up Next listed right under the keys: the row's right end empty, the keys still centered -- mockup 12h, 2026-11-09)
      ':host([inpane]:not([compact])) .pm[mqon] .hks [data-act=queue]{visibility:hidden;pointer-events:none}',
      ':host([inpane]:not([compact])) .pm .mq:not(:empty){display:flex;flex-direction:column;flex:1 1 0;' +
        'min-height:0;overflow:hidden;margin-top:calc(24px * var(--z));text-align:left}',
      // (the box takes the room under the buttons and the rows scroll in it -- .mql, hk-saver-css.js)
      ':host([inpane]) .pm .mbtn.mqr{width:auto;height:auto}',
      ':host([inpane]) .pm .mqt{width:calc(44px * var(--z));height:calc(44px * var(--z))}'
    ].join('\n');

    var DASH_SWIPE = 10;

    // WHAT THE OTHERS ASK OF IT (phase 25, A): the only way another file changes the pane's or the curtain's state,
    // each the assignment it was, by name
    function curtainOpts(opts) { ST.downOpts = opts; }     // how the next curtain comes down (the house's black)
    function curtainStale() { ST.curtainRun++; }            // a curtain under way is not this one any more
    function dashAgain() { ST.dashAt = 0; }                 // the dashboard's music view is live again: draw it now
    function paneCardGone() { ST.paneCard = null; }         // a new page: no calendar card on it yet
    function paneRelease() {                                // the page let go (releaseVisuals)
      ST.paneCard = null; ST.paneUp = false;
      if (ST.paneT) { clearInterval(ST.paneT); ST.paneT = null; }
    }

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

    function tellBlack(blackOn) {
      var run = ++blackTellRun, sent = false;
      var send = function () {
        if (sent || run !== blackTellRun) return;
        sent = true;
        if (blackTold === blackOn) return;
        blackTold = blackOn;
        try { window.dispatchEvent(new CustomEvent('hk-black', { detail: { on: blackOn } })); } catch (e) { /* no window events */ }
      };
      if (!blackOn || typeof requestAnimationFrame !== 'function') { send(); return; }
      requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(send, BLACK_TELL_MS); }); });
      setTimeout(send, BLACK_TELL_MAX);
    }

    // ------------------------------------------------------------ the Now Playing page
    // THE NOW PLAYING PAGE (2026-11-07, the owner: "swipe right on the main dashboard screen to ... the interactive music
    // slide page for a full screen music player", and the mockup he picked, docs/mockups/now-playing-page.html): the
    // screensaver's music slide as a page. Its own view of the one music state (kind 'dash', the slide's look), its taps
    // its own, as the Side Pane's card's are; drawn and ticked with the others (renderMusic, musicTick). The page's sky is
    // the cover (sky_variant playmusic), so the view draws no backdrop of its own. Over it the slide's corner: the time,
    // the date and the weather, the home's status at the right (the screensaver's corner widgets). Beside the Side Pane,
    // the cover and the song side by side, Up Next beside the cover (the slide's murow layout, layoutMusicView).
    var PAGE_CSS = [
      ':host{display:block;position:relative;width:100%;height:var(--hk-npp-h,640px);color:rgba(255,255,255,0.94);',
      '  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}',
      '.pane{display:none!important}',
      '.mu{opacity:1;visibility:visible;background:none;transition:none}',
      '.mu .mbgf,.mu .mshade{display:none}',
      // (the page is narrowed by the Side Pane already: the slide's room for the screensaver's own pane is not taken)
      ':host([pane]) .mu .mbody{right:0;left:0}',
      '.mu .mbtn,.mu .mvol,.mu .msq,.mu .hksl,.mu .mql{pointer-events:auto;cursor:pointer}',
      '@media (hover:hover){.mu .mbtn:hover{opacity:.75}}',
      // THE CORNER on the page's own edges
      '.info{position:absolute;inset:0;z-index:2;pointer-events:none}',
      '.ptl,.ptr{position:absolute;top:var(--g,6px);display:flex;flex-direction:column;gap:var(--g,6px)}',
      '.ptl{left:0;align-items:flex-start}.ptr{right:0;align-items:flex-end}',
      '.ptl > *,.ptr > *{position:relative}',
      // (the Speakers / Volume / Queue / Browse panel's place: over the cover, as on the slide -- placePanel takes it)
      '.pbox{position:absolute;visibility:hidden;pointer-events:none}'
    ].join('\n');

    var pageV = null;

    function pageCard() {
      var Page = class extends /** @type {HkLooseElementConstructor} */ (HTMLElement) {
        constructor() {
          super();
          this._root = this.attachShadow({ mode: 'open' });
          this._wg = {};
        }
        setConfig(c) { this._config = c || {}; }
        getCardSize() { return 12; }
        // each new client: the music again (at most once a second, dashWatch) and the corner; laid out again a moment
        // later, at most once a second (a new song's words)
        _onClient() {
          var self = this;
          if (this._v && this._v.live) dashWatch();
          if (!this._fitT) this._fitT = setTimeout(function () { self._fitT = null; if (self.isConnected) self._fit(); }, 1000);
        }
        connectedCallback() {
          var self = this;
          if (!this._root.querySelector('.info')) this._make();
          this._adopt();
          this._v.live = true;
          this._onWin = function () { self._fit(); };
          window.addEventListener('resize', this._onWin);
          window.addEventListener('hk-pane', this._onWin);
          if (typeof ResizeObserver === 'function') { this._ro = new ResizeObserver(this._onWin); this._ro.observe(this); }
          clearInterval(this._minT);
          this._minT = setInterval(function () { self._corner(); }, 15000);
          renderMusic();
          this._fit();
        }
        disconnectedCallback() {
          var v = this._v;
          window.removeEventListener('resize', this._onWin);
          window.removeEventListener('hk-pane', this._onWin);
          clearInterval(this._minT);
          clearTimeout(this._fitT); this._fitT = null;
          if (this._ro) { this._ro.disconnect(); this._ro = null; }
          if (!v || v.host !== this) return;
          Black.panelDone(v);
          v.live = false;
          musicTick();
        }
        // the one view, into this card (a page built again hands it on, drawn already)
        _adopt() {
          var v = this._v = pageV, r = this._root;
          v.host = this; v.root = r; v.box = r.querySelector('.pbox');
          if (v.el.parentNode !== r) r.insertBefore(v.el, r.querySelector('.info'));
        }
        _make() {
          var r = this._root;
          r.innerHTML = '<style>' + CSS.slice(CSS.indexOf('.pane{position:absolute')) + '\n' + PAGE_CSS + '</style>' +
            '<div class="info" data-ink="white"><div class="ptl"></div><div class="ptr"></div></div><div class="pbox"></div>';
          /** @type {HTMLElement} */ (r.querySelector('.info')).style.setProperty('--lay-ink', '#ffffff');
          if (pageV) return;
          var v = pageV = musicView('dash', 'slide');
          v.live = false;
          if (!window.hkSaverPanel) v.el.setAttribute('nomx', '');
          // ITS BUTTONS, the art (Play Music) and the volume, as the Side Pane's card's (hk-saver.js MusicPane)
          v.el.addEventListener('click', function (e) {
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
        // AS TALL AS THE SCREEN LEAVES IT (the page's top to the tab bar's), the slide laid out in it, the panel's place
        _fit() {
          var v = this._v, de = document.documentElement;
          if (!v || v.host !== this || !this.isConnected) return;
          var top = Math.round(this.getBoundingClientRect().top);
          this.style.setProperty('--hk-npp-h', 'max(320px, calc(100dvh - ' + top + 'px - var(--hk-tabbar-top, 0px) - 12px))');
          setAttr(this, 'pane', /^(left|right)$/.test(de.getAttribute('hk-pane') || ''));
          var z = scaleOf();
          v.z = z;
          // The page supplies the cover even when the Now Playing bar is hidden.
          var pic = v.d && !v.d.idle ? v.d.pic || null : null;
          if (window.hkNowArt !== pic) {
            window.hkNowArt = pic;
            window.dispatchEvent(new CustomEvent('hk-now-art', { detail: { url: pic } }));
          }
          this._corner();
          layoutMusicView(v, this, this._root, null, z);
          var hb = this.getBoundingClientRect(), art = v.el.querySelector('.mart').getBoundingClientRect();
          var w = Math.max(280, Math.min(566 * z, hb.width - 48)), h = Math.max(300, Math.min(660 * z, hb.height - 24));
          var cx = Math.max(hb.left + 24 + w / 2, Math.min(hb.right - 24 - w / 2, art.left + art.width / 2));
          var pb = /** @type {HTMLElement} */ (this._root.querySelector('.pbox')).style;
          pb.left = Math.round(cx - w / 2 - hb.left) + 'px'; pb.top = Math.round((hb.height - h) / 2) + 'px';
          pb.width = Math.round(w) + 'px'; pb.height = Math.round(h) + 'px';
        }
        // THE CORNER: the time (2.6 times the corner's words), the date and the weather at the left, the home's status
        // at the right -- the screensaver's corner widgets, a size for the card's (once their files are here)
        _corner() {
          var WG = window.hkSaverWidgets, self = this, r = this._root;
          if (!WG) {
            if (!this._asked) { this._asked = true; layoutModules().then(function () { if (self.isConnected && window.hkSaverWidgets) self._fit(); }); }
            return;
          }
          var hb = this.getBoundingClientRect();
          if (!hb.width || !hb.height) return;
          var u = Math.min(hb.width, hb.height * 1.4) / 100;
          if (WG.sheet && !r.querySelector('.wgcss')) { var st = WG.sheet(); st.classList.add('wgcss'); r.insertBefore(st, r.firstChild); }
          if (this._u && Math.abs(this._u - u) > 0.05) { Object.keys(this._wg).forEach(function (k) { try { self._wg[k].destroy(); } catch (e) { /* gone */ } }); this._wg = {}; }
          this._u = u;
          /** @type {HTMLElement} */ (r.querySelector('.info')).style.setProperty('--g', (0.8 * u) + 'px');
          var c = clientNow(), now = new Date(), at = { time: [2.6, '.ptl'], date: [1, '.ptl'], weather: [1, '.ptl'], status: [1, '.ptr'] };
          ['time', 'date', 'weather', 'status'].forEach(function (k) {
            var w = self._wg[k];
            if (!w) {
              try { w = self._wg[k] = WG.create(k, 'inline', { u: u * at[k][0], back: 'none', color: 'auto', h24: clock24(), weather: weatherEntity() }); }
              catch (e) { return; }
              r.querySelector(at[k][1]).appendChild(w.el);
            }
            try { w.update(c, now, {}); } catch (e) { /* its own data */ }
          });
          if (WG.alignLeft) WG.alignLeft(r.querySelector('.ptl'), this.offsetWidth ? hb.width / this.offsetWidth : 1);
        }
      };
      ST.PageCard = Page;
    }

    // what the shell and the later parts use of this one
    K.curtainOpts = curtainOpts; K.curtainStale = curtainStale; K.dashAgain = dashAgain; K.paneCardGone = paneCardGone; K.paneRelease = paneRelease;
    K.addBand = addBand; K.black = black; K.blackChanged = blackChanged; K.centerBand = centerBand;
    K.CURTAIN_FADE = CURTAIN_FADE; K.CURTAIN_HOLD_HK = CURTAIN_HOLD_HK; K.curtainDown = curtainDown;
    K.DASH_CSS = DASH_CSS; K.DASH_SWIPE = DASH_SWIPE; K.dashLive = dashLive; K.dashOutside = dashOutside;
    K.dashViews = dashViews; K.dashWatch = dashWatch; K.drawCurtain = drawCurtain; K.dropSide = dropSide;
    K.hostOf = hostOf; K.layoutPane = layoutPane; K.musicHas = musicHas; K.musicIn = musicIn; K.pageCard = pageCard;
    K.paneStack = paneStack; K.rootOf = rootOf; K.scaleOf = scaleOf; K.setPane = setPane; K.setupPane = setupPane;
    // (phase 25: what the earlier parts call of this one, through its exports object Pane, made by the shell)
    var Pane = K.Pane;
    Pane.addBand = addBand; Pane.black = black; Pane.dashLive = dashLive; Pane.dashOutside = dashOutside;
    Pane.hostOf = hostOf; Pane.musicIn = musicIn; Pane.paneStack = paneStack; Pane.rootOf = rootOf;
    Pane.scaleOf = scaleOf; Pane.setPane = setPane;
  };
})();
