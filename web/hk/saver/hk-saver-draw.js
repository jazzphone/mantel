// hk-saver-draw.js - drawing: the backdrop, the clocks, the slide corner and the forecast.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-draw'] = function (K) {
    var clientNow = K.clientNow, CROSSFADE_MS = K.CROSSFADE_MS, dashConf = K.dashConf, FACE_SHOWS = K.FACE_SHOWS,
        FC_TICK_MS = K.FC_TICK_MS, isFlat = K.isFlat, slideMarks = K.slideMarks, ST = K.ST, sunDown = K.sunDown;

    var addBand, dropView, exHide, forecastTick, HL, layoutBigKind, layoutDraw, layoutModules, layoutMusic,
        layoutSlides, layoutSoon, mus, musicParts, musicWatch, reveal, setAttr, showNext, slideView, takeover, TM, WX;
    // (of later parts, used when called: bound once every part has run, runParts)
    K.ahead.push(function () {
      addBand = K.addBand; dropView = K.dropView; exHide = K.exHide; forecastTick = K.forecastTick; HL = K.HL;
      layoutBigKind = K.layoutBigKind; layoutDraw = K.layoutDraw; layoutModules = K.layoutModules;
      layoutMusic = K.layoutMusic; layoutSlides = K.layoutSlides; layoutSoon = K.layoutSoon; mus = K.mus;
      musicParts = K.musicParts; musicWatch = K.musicWatch; reveal = K.reveal; setAttr = K.setAttr;
      showNext = K.showNext; slideView = K.slideView; takeover = K.takeover; TM = K.TM; WX = K.WX;
    });

    // ------------------------------------------------------------ the forecast
    // The forecast's layer: built the first time it is needed, then kept for
    // as long as the screensaver shows (Photos & Forecast brings it back every
    // few photos); its sky holds still whenever it is not on screen.
    function buildForecast() {
      if (!ST.root) return;
      // (Behind the Clock: Sky Only -- the forecast's sky without its land and
      // decorations; a kept layer drawn the other way is drawn again)
      var skyOnly = !!(ST.cfg && ST.cfg.show === 'clock' && ST.cfg.clock_bg === 'skyonly');
      var had = ST.root.querySelector('.fc');
      if (had) {
        var k = had.querySelector('#hk-sky');
        if (!k || k.classList.contains('skyonly') === skyOnly) return;
        if (ST.fscene) { try { ST.fscene.destroy(); } catch (e) { /* gone with the element */ } ST.fscene = null; }
        ST.fSky = null;
        had.remove();
      }
      var fc = document.createElement('div');
      fc.className = 'fc';
      ST.root.insertBefore(fc, ST.root.querySelector('.info'));
      var sky = document.createElement('div');
      sky.className = 'fsky';
      fc.appendChild(sky);
      try { ST.fscene = !isFlat() && window.hkSky && window.hkSky.scene ? window.hkSky.scene(sky, { skyOnly: skyOnly }) : null; } catch (e) { ST.fscene = null; }
      startTick();
    }
    // the details' layer, built the first time they are wanted
    function buildBand() {
      if (!ST.root || ST.root.querySelector('.fcb')) return;
      var fcb = document.createElement('div');
      fcb.className = 'fcb';
      ST.root.insertBefore(fcb, ST.root.querySelector('.info'));
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
      if (!ST.fTick) ST.fTick = setInterval(function () { forecastTick(false); }, FC_TICK_MS);
    }
    // Whether the details show now: on the forecast (Forecast, the slide, the
    // no-photos fallback) by `band`; over the photos by `band_photos`.
    function bandWanted() {
      if (!ST.on || !ST.cfg || ST.muShowing || ST.enShowing || WX.showing || HL.showing) return false;
      // (a layout's forecast as the background -- Show: Forecast, or Photos with none to show -- has its details as a piece
      // of its own, the Weather band, if it has them at all: the old band's today, its rules and its scrim were drawn over
      // the layout's pieces, 2026-11-02. As a slide the forecast is the slide's, band and all)
      if (ST.cfg.layout && !ST.fcShowing) return false;
      // (Big Weather is the forecast's details itself)
      return fcVisible() ? ST.cfg.band !== false && !bigWanted() : ST.cfg.band_photos === true;
    }
    // (with a layout too, where the forecast is a slide: layoutCfg made it Classic where the forecast is the background)
    // (a layout: the forecast as a slide over any Look takes the Slides section's Classic / Big -- layoutCfg made it
    // Classic where the forecast is the background)
    function bigWanted() { return !!(ST.cfg && ST.cfg.forecast_layout === 'big' && (ST.cfg.layout || (ST.cfg.show !== 'clock' && !FACE_SHOWS[ST.cfg.show]))); }
    function bigWeather() {
      if (!ST.root || !ST.host) return;
      var want = bigWanted();
      setAttr(ST.host, 'fcbig', want);
      var fc = ST.root.querySelector('.fc');
      // (its big number changed -- the temperature or the time: drawn again)
      if (ST.bigCtl && (!want || ST.bigFor !== ST.cfg.forecast_big + '|' + ST.cfg.forecast_planted)) { try { ST.bigCtl.destroy(); } catch (e) { /* gone */ } ST.bigCtl = null; }
      if (!want || !fc || ST.bigCtl) return;
      var run = ++ST.bigRun;
      facesModule().then(function (F) {
        if (!F || run !== ST.bigRun || !ST.on || !fc.isConnected || ST.bigCtl) return;
        ST.bigFor = ST.cfg.forecast_big + '|' + ST.cfg.forecast_planted;
        ST.bigCtl = F.mount(fc, { kind: 'weather', h24: ST.cfg.clock_24, big: ST.cfg.forecast_big, weather: weatherEntity(), client: clientNow(),
                               planted: ST.cfg.forecast_planted, sky: ST.fSky,
                               onReadings: function (n) { if (ST.host) ST.host.setAttribute('fcn', String(n)); } });
      });
    }
    function updateBand() {
      if (!ST.host) return;
      var want = bandWanted();
      if (want) buildBand();
      if (want) ST.host.setAttribute('band', ''); else ST.host.removeAttribute('band');
      if (ST.on && ST.cfg && ST.cfg.band_photos === true) ST.host.setAttribute('bandph', ''); else ST.host.removeAttribute('bandph');
      layoutSlides();
      slideCorner();
    }
    function slideNow() {
      if (!ST.on) return null;
      if (ST.muShowing) return 'music';
      if (ST.enShowing) return 'energy';
      if (WX.showing) return 'weather';
      if (TM.showing) return 'timer';
      if (HL.showing) return 'holiday';
      if (ST.fcShowing) return bigWanted() ? 'forecast_big' : 'forecast';
      return null;
    }
    // the Look's time as words: the font and color of the face on the screen (the layout's big element, else the
    // clock's), or Classic's where the face has no words (Analog, Flip)
    function faceWords() {
      var root0 = (ST.ly && ST.ly.big && ST.ly.big.el) || (ST.root && ST.root.querySelector('.ck .face'));
      if (!root0) return null;
      var hit = null;
      (function walk(n) {
        if (hit || !n) return;
        if (n.nodeType === 1 && n.tagName !== 'STYLE' && n.tagName !== 'svg') {
          for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\d/.test(c.textContent)) { hit = n; return; }
          for (var k = n.firstElementChild; k; k = k.nextElementSibling) walk(k);
        }
      })(root0);
      if (!hit || (ST.cfg && ANALOG[ST.cfg.clock_style]) || (ST.cfg && ST.cfg.clock_style === 'flip')) return null;
      var cs = getComputedStyle(hit);
      return { font: cs.fontStyle + ' ' + cs.fontWeight + ' 1em ' + cs.fontFamily, family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle,
               color: /^rgba?\(0, 0, 0, 0\)$|transparent/.test(cs.color) ? null : cs.color };
    }
    function slideCorner() {
      if (!ST.host || !ST.root) return;
      var key = slideNow(), LM = window.hkSaverLayout, WG = window.hkSaverWidgets;
      setAttr(ST.host, 'scorner', !!key);
      if (!key) { if (ST.scn) ST.scn.key = null; return; }
      // (the pieces' files asked for once: a load that fails is not asked again from here -- asking again on its failure
      // spun the page, 2026-11-02, the harness's forecast slide; the 0.1.104 rule: nothing wakes itself)
      if (!LM || !WG) {
        if (!ST.cornerAsked) { ST.cornerAsked = true; layoutModules().then(function (got) { if (ST.on && got && got[0] && got[1]) slideCorner(); }); }
        return;
      }
      if (!ST.scn || !ST.scn.el.isConnected) {
        var el = document.createElement('div');
        el.className = 'scn';
        el.setAttribute('data-ink', 'white');
        el.setAttribute('data-acc', '');
        el.style.setProperty('--lay-ink', '#ffffff');
        if (WG.sheet) el.appendChild(WG.sheet());
        var tl = document.createElement('div'), tr = document.createElement('div');
        tl.className = 'scs tl'; tr.className = 'scs tr';
        el.append(tl, tr);
        ST.root.insertBefore(el, ST.root.querySelector('.blk'));
        ST.scn = { el: el, tl: tl, tr: tr, p: {}, u: 0, minT: null };
      }
      cornerDraw(key);
      // (and once the slide has come in and drawn its words: what it shows is laid out as it fades in)
      if (ST.scn.key !== key) { ST.scn.key = key; clearTimeout(ST.scn.againT); ST.scn.againT = setTimeout(function () { if (ST.scn && slideNow() === key) cornerDraw(key); }, CROSSFADE_MS + 150); }
      if (!ST.scn.minT) ST.scn.minT = setTimeout(function tick() { if (!ST.scn) return; ST.scn.minT = setTimeout(tick, 60000 - Date.now() % 60000 + 50); if (slideNow()) cornerDraw(slideNow()); },
                                           60000 - Date.now() % 60000 + 50);
    }
    function cornerDraw(key) {
      var LM = window.hkSaverLayout, WG = window.hkSaverWidgets;
      if (!ST.scn || !LM || !WG) return;
      var R = layoutRoomOf(), u = Math.min(R.room.w, R.room.h) / 100, m = 6 * u, client = clientNow(), now = new Date();
      // (what the slide lacks, less what the corner is set to leave out; its time at its own size -- the Slides section)
      var want = LM.cornerFor(key).filter(function (k) { return (ST.cfg.corner_hide || []).indexOf(k) < 0; }), tsz = (ST.cfg.corner_time_size || 100) / 100;
      ST.scn.el.style.left = R.room.x + 'px'; ST.scn.el.style.width = R.room.w + 'px';
      ST.scn.el.style.setProperty('--m', m + 'px'); ST.scn.el.style.setProperty('--g', (0.8 * u) + 'px');
      if (Math.abs(ST.scn.u - u) > 0.01 || ST.scn.tsz !== tsz) { Object.keys(ST.scn.p).forEach(function (k) { ST.scn.p[k].destroy(); }); ST.scn.p = {}; ST.scn.u = u; ST.scn.tsz = tsz; }
      // (the time a little larger than the corner's words, the Look's own; the date and the weather a line each; Home Status a line)
      var spec = { time: ['time', 'inline', 2.6 * tsz, ST.scn.tl], date: ['date', 'inline', 1, ST.scn.tl], weather: ['weather', 'inline', 1, ST.scn.tl], status: ['status', 'inline', 1, ST.scn.tr] };
      var face = faceWords(), ctx = { face: face ? { font: face.family } : null };
      ['time', 'date', 'weather', 'status'].forEach(function (k) {
        var on2 = want.indexOf(k) >= 0, c = ST.scn.p[k];
        if (on2 && !c) {
          try { c = ST.scn.p[k] = WG.create(spec[k][0], spec[k][1], { u: u * spec[k][2], back: 'none', color: 'auto', h24: ST.cfg.clock_24, weather: weatherEntity() }); spec[k][3].appendChild(c.el); }
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
      var hr1 = ST.host.getBoundingClientRect(), k1 = ST.host.offsetWidth ? hr1.width / ST.host.offsetWidth : 1; if (WG.alignLeft) WG.alignLeft(ST.scn.tl, k1);
      [ST.scn.tl, ST.scn.tr].forEach(function (st) {
        st.style.marginTop = '';
        var first = [].filter.call(st.children, function (e) { return e.style.display !== 'none'; })[0], ink = first && inkOf(first);
        if (!ink || !(k1 > 0)) return;
        st.style.marginTop = -((ink.y0 - st.getBoundingClientRect().top) / k1) + 'px';
      });
      // CLEAR OF THE SLIDE'S OWN WORDS (2026-11-03, the owner: "Sometimes the Widgets... overlap or collide with the
      // Slides"): each side's stack drops below whatever of the slide it would meet -- Big Weather's two lines at the top,
      // the Weather slide's and Home Energy's own -- by the words and small pictures the slide shows (the music's words
      // move under the corner instead: layoutMusic)
      var sl = key === 'energy' ? ST.enCtl && ST.enCtl.el : key === 'weather' ? WX.ctl && WX.ctl.el : key === 'holiday' ? HL.ctl && HL.ctl.el : key === 'timer' ? TM.ctl && TM.ctl.el : key ===
        'forecast' || key === 'forecast_big' ? ST.root.querySelector('.fc') : null;
      if (sl && k1 > 0) {
        var marks = slideMarks(sl), gap1 = 1.6 * u * k1;
        [ST.scn.tl, ST.scn.tr].forEach(function (st) {
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
      var W = ST.host.clientWidth || window.innerWidth || 1280, H = ST.host.clientHeight || window.innerHeight || 800;
      var pw = ST.paneUp ? (ST.paneW || 0) : 0;
      return { W: W, H: H, room: { x: ST.cfg && ST.cfg.pane_side === 'left' ? pw : 0, y: 0, w: Math.max(1, W - pw), h: H } };
    }
    function cornerClient() {
      if (!ST.scn || !slideNow()) return;
      var t = Date.now();
      if (t - ST.cornerAt < 2000) return;
      ST.cornerAt = t;
      cornerDraw(slideNow());
    }
    function leaveCorner() {
      if (!ST.scn) return;
      clearTimeout(ST.scn.minT); clearTimeout(ST.scn.againT);
      Object.keys(ST.scn.p).forEach(function (k) { try { ST.scn.p[k].destroy(); } catch (e) { /* gone */ } });
      if (ST.scn.el.parentNode) ST.scn.el.remove();
      ST.scn = null;
      if (ST.host) ST.host.removeAttribute('scorner');
    }
    // (the music slide over it hides it)
    function fcVisible() { return (ST.mode === 'forecast' || ST.fcShowing) && !ST.muShowing && !ST.enShowing && !WX.showing && !HL.showing; }
    function ckPhotos() { return !!(ST.host && ST.host.hasAttribute('ckphotos')); }
    function clockModule() {
      if (window.hkSaverClock) return Promise.resolve(window.hkSaverClock);
      if (!ST.ckLoad) {
        // (/hk/ revalidates: a changed file is fetched afresh, as the
        // loader's modules are)
        ST.ckLoad = import('/hk/modules/hk-saverclock.js').then(function () { return window.hkSaverClock; })
          .catch(function (e) { ST.ckLoad = null; console.warn('[hk-saver] clock', e && e.message); return null; });
      }
      return ST.ckLoad;
    }
    function enterClock() {
      var bgk = ST.cfg.clock_bg;
      ST.host.setAttribute('ckmode', '');
      // GLANCE, MONTH, DAY: a whole screen of their own, as Show: Clock on a background of its own
      if (FACE_SHOWS[ST.cfg.show]) {
        ST.mode = 'clock';
        ST.host.setAttribute('ckgen', '');
        ST.host.setAttribute('ckface', ST.cfg.show);
        updateBand();
        mountClock('face');
        return;
      }
      if (bgk === 'forecast' || bgk === 'skyonly') { enterForecast(); mountClock('none'); return; }
      if (bgk === 'photos' || bgk === 'landscapes') {
        ST.host.setAttribute('ckphotos', '');
        setAttr(ST.host, 'cksoft', !!ST.cfg.clock_photo_soft);
        ST.host.style.setProperty('--hk-ckdim', String((ST.cfg.clock_photo_dim || 0) / 100));
        updateBand(); showNext(true); mountClock('none', true); return;
      }
      ST.mode = 'clock';
      ST.host.setAttribute('ckgen', '');
      updateBand();
      mountClock(bgk);
    }
    // the clock's layer, under the corner cards; `dimmed`: over the photos'
    // blurred copies, which need no scrim of their own
    function mountClock(bg, dimmed) {
      if (!ST.root) return;
      // (a layout draws its own time: over the photos or the forecast there is nothing of the clock's to draw)
      if (ST.cfg && ST.cfg.layout && bg === 'none') return;
      ST.ckArgs = [bg, dimmed];
      var run = ++ST.ckRun, clockLayer = document.createElement('div');
      clockLayer.className = 'ck';
      // OVER PHOTOS, the clock's text stands out by its own Shadow and Outline
      if (ckPhotos() || ST.cfg.show === 'photos' || ST.cfg.show === 'both') {
        var fx = ckFx(ST.cfg);
        if (fx !== 'none') clockLayer.style.filter = fx;
      }
      ST.root.insertBefore(clockLayer, ST.root.querySelector('.lay') || ST.root.querySelector('.info'));
      var face = bg === 'face';
      Promise.all([clockModule(), face ? facesModule() : null]).then(function (got) {
        var C = got[0], F = got[1];
        if (run !== ST.ckRun || !ST.on || !clockLayer.isConnected) return;
        if (!C || (face && !F)) { clockLayer.remove(); if (ST.mode === 'clock') { ST.mode = 'photos'; ST.host.removeAttribute('ckgen'); ST.host.removeAttribute('ckface'); enterForecast(); } return; }
        ST.ckCtl = face
          ? F.mount(clockLayer, { kind: ST.cfg.show, h24: ST.cfg.clock_24, weather: weatherEntity(), look: ST.cfg.day_look, clocks: C, client: clientNow(), groundOnly: !!ST.cfg.layout &&
            layoutBigKind() !== 'none' })
          : C.mount(clockLayer, { style: ST.cfg.clock_style, options: ST.cfg.clock_options, h24: ST.cfg.clock_24, music: ST.cfg.clock_today_music, todayWeather: ST.cfg.clock_today_weather,
            color: ST.cfg.clock_color, bg: bg, motion: ST.cfg.clock_motion, face: !ST.cfg.layout,
                             speed: ST.cfg.clock_speed, depth: ST.cfg.clock_depth, weather: weatherEntity(),
                             // a Wallpaper: its night version while the sun is down, as the dashboard's After Sunset
                             wallpaper: bg === 'wallpaper' ? { id: ST.cfg.clock_wallpaper, color: ST.cfg.clock_wallpaper_color, night: sunDown() } : null,
                             // (a face with a ground of its own keeps it off over the photos or the forecast)
                             ground: bg !== 'none',
                             client: clientNow(), scrim: !dimmed });
        // a light face (Month, the Day face's light look): the corners' words go dark on it
        if (ST.host && face) setAttr(ST.host, 'cklight', faceLight(F));
        // (the Day face clear of the corner: once its words and the corner's are drawn)
        if (face && ST.cfg.show === 'day') { requestAnimationFrame(dayFit); setTimeout(dayFit, 600); setTimeout(dayFit, 2000); }
        // TODAY carries its own weather and music: the corners' step aside
        if (ST.host) setAttr(ST.host, 'ckown', ST.cfg.clock_style === 'today');
        nightCheck();
        if (!ST.nightT) ST.nightT = setInterval(nightCheck, 30000);
        // Show: Clock on a background of its own: there is something to show
        if (ST.mode === 'clock' && ST.entrance) ST.entrance();
      });
    }
    // whether the face on screen has a light ground, by its luminance (hkSaverFaces inkFor): dark ink in the corners
    function faceLight(F) {
      var X = F && F._;
      return !!(ST.cfg && FACE_SHOWS[ST.cfg.show] && X && X.inkFor && X.inkFor(ST.cfg.show, ST.cfg.day_look, new Date()) === 'dark');
    }
    function slidesAgain() {
      if (ST.muShowing) { musicParts(slideView(), ST.cfg.music_hide); layoutMusic(); }
      if (ST.scn && slideNow()) cornerDraw(slideNow());
      return true;
    }
    function remountClock() {
      var laid = !!ST.ly;
      if (laid) { layoutDraw(); layoutSoon(); }
      if (!ST.ckArgs || !ST.root || !ST.root.querySelector('.ck')) return laid;
      var a = ST.ckArgs;
      ST.ckRun++;
      if (ST.ckCtl) { try { ST.ckCtl.destroy(); } catch (e) { /* gone */ } ST.ckCtl = null; }
      ST.root.querySelectorAll('.ck').forEach(function (n) { n.remove(); });
      mountClock(a[0], a[1]);
      return true;
    }
    function nightNow(d, c) {
      c = c || ST.cfg;
      if (ST.previewOn && ST.nightPreview !== null) return ST.nightPreview;
      if (!c || c.clock_night === 'off') return false;
      if (c.clock_night === 'always') return true;
      d = d || new Date();
      var m = d.getHours() * 60 + d.getMinutes(), a = minsOf(c.clock_night_from), b = minsOf(c.clock_night_to);
      return a <= b ? m >= a && m < b : m >= a || m < b;
    }
    function nightCheck() {
      if (!ST.host) return;
      // (a layout's too: over the photos or the Landscape there is no clock of the clock's own, and Night Mode did
      // nothing -- phase 13)
      var dark = !!((ST.ckCtl || ST.ly) && ST.on) && nightNow();
      setAttr(ST.host, 'cknight', dark);
      // (the Day face by the time of day: the corners' words follow its light and dark)
      if (ST.cfg && window.hkSaverFaces && ST.host.hasAttribute('ckface')) setAttr(ST.host, 'cklight', faceLight(window.hkSaverFaces));
      dayFit();
      // (...but in the editor's preview Night leaves a slide shown with See a Slide where it is)
      if (dark && ST.exKind && !ST.previewOn) exHide();
      if (ST.ckCtl && ST.ckCtl.night) ST.ckCtl.night(dark);
    }
    // THE DAY FACE AND THE CORNER (2026-10-31): where the corner's words (the time, the date, the weather) would meet
    // the day's name or its date -- a screen held upright, a phone, a long day's name -- both move down, clear of
    // them (--hk-day-push on the screensaver, the face's .wd and .dn translated by it). Measured from the words
    // themselves, not their boxes (the corner's column is wider than what it says): when the face is put up, on a
    // resize, and with the minute (a wider time)
    function cornerInk(withStatus) {
      var info = ST.root && ST.root.querySelector('.info'), box = null;
      if (!info) return null;
      // (the corner's words: the old cards', or a layout's pieces at the top -- phase 13, the Day face drawn with a layout)
      var lay = ST.root.querySelector('.lay'), H = (ST.host && ST.host.clientHeight) || window.innerHeight || 800;
      var pieces = lay ? [].filter.call(lay.querySelectorAll('.hksw.p-time, .hksw.p-weather' + (withStatus ? ', .hksw.p-status' : '')), function (e) {
        var r = e.getBoundingClientRect(); return r.height > 0 && r.top < H / 2 && getComputedStyle(e).display !== 'none';
      }) : [];
      [].forEach.call(info.querySelectorAll(':scope > hk-clock-card, :scope > hk-weather-strip-card' + (withStatus ? ', :scope > hk-screensaver-status-card' : '')),
        function (card) { pieces.push(card); });
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
      if (!ST.host || !ST.root || !ST.on || !ST.cfg || ST.cfg.show !== 'day' || !ST.host.hasAttribute('ckface')) return;
      var wd = ST.root.querySelector('.ck .hkf.day .wd'), dn = ST.root.querySelector('.ck .hkf.day .dn');
      if (!wd || !dn) return;
      var px = function (k) { return parseFloat(ST.host.style.getPropertyValue(k)) || 0; };
      var curW = px('--hk-day-push'), curD = px('--hk-day-push-dn'), sc = px('--hk-day-scale') || 1;
      // ON A PHONE Home Status has no room beside the corner's time ("Disarme..." drawn over it): under its words,
      // the corner's own margin, as wide as the phone, at a phone's size -- and the day measured against all of it
      var phone = (window.innerWidth || 0) < 600 && !ST.paneUp, words = phone ? cornerInk() : null;
      if (phone && words) ST.host.style.setProperty('--hk-ss-status-top', Math.round(words.b + 8) + 'px');
      else if (!ST.paneUp) ST.host.style.removeProperty('--hk-ss-status-top');
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
      var face = ST.root.querySelector('.ck .hkf.day'), foot = face ? face.getBoundingClientRect().bottom : (window.innerHeight || 0);
      var pk = ST.root.querySelector('.ck .hkf.day .art .pk'), pr = pk && pk.getBoundingClientRect();
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
      var put = function (k, v, none) { if (v === none) ST.host.style.removeProperty(k); else ST.host.style.setProperty(k, String(v) + (k === '--hk-day-scale' ? '' : 'px')); };
      if (pushW !== curW) put('--hk-day-push', pushW, 0);
      if (pushD !== curD) put('--hk-day-push-dn', pushD, 0);
      if (scale !== sc) put('--hk-day-scale', scale, 1);
    }
    function leaveClock() {
      ST.ckArgs = null;
      if (ST.nightT) { clearInterval(ST.nightT); ST.nightT = null; }
      if (ST.host) { ST.host.removeAttribute('cknight'); ST.host.removeAttribute('ckown'); ST.host.removeAttribute('ckface'); ST.host.removeAttribute('cklight');
        if (ST.host.style.removeProperty) ['--hk-day-push', '--hk-day-push-dn', '--hk-day-scale'].concat(ST.paneUp ? [] : ['--hk-ss-status-top']).forEach(
          function (k) { ST.host.style.removeProperty(k); }); }
      ST.ckRun++;
      if (ST.ckCtl) { try { ST.ckCtl.destroy(); } catch (e) { /* gone */ } ST.ckCtl = null; }
      if (ST.root) ST.root.querySelectorAll('.ck').forEach(function (n) { n.remove(); });
      if (ST.host) { ST.host.removeAttribute('ckmode'); ST.host.removeAttribute('ckgen'); ST.host.removeAttribute('ckphotos'); ST.host.removeAttribute('cksoft'); }
      if (ST.mode === 'clock') ST.mode = 'photos';
    }
    // the whole screensaver: no photos, or Show: Forecast
    function enterForecast() {
      if (ST.mode === 'forecast' || !ST.root) return;
      ST.mode = 'forecast';
      ST.fcShowing = false;
      if (ST.slideT) { clearTimeout(ST.slideT); ST.slideT = null; }
      ST.host.removeAttribute('fcslide');
      ST.host.setAttribute('forecast', '');
      buildForecast();
      bigWeather();
      updateBand();
      forecastTick(true);
      reveal(ST.root.querySelector('.fc'), true);
      if (ST.entrance) ST.entrance();
      // music already playing: its slide, over the forecast
      if (takeover()) setTimeout(function () { mus.watchAt = 0; musicWatch(); }, 0);
    }
    // one slide among the photos (Photos & Forecast)
    function showForecastSlide() {
      if (!ST.on || !ST.root || ST.mode === 'forecast') return;
      buildForecast();
      bigWeather();
      ST.fcShowing = true; ST.sinceFc = 0; ST.lastSlide = 'forecast';
      ST.host.setAttribute('fcslide', '');
      updateBand();
      forecastTick(true);
      reveal(ST.root.querySelector('.fc'), false);
      layoutSoon();
    }
    function hideForecastSlide() {
      if (!ST.fcShowing) return;
      ST.fcShowing = false;
      // [fcout] WHILE IT FADES (2026-11-09): the slide corner stays put -- its date jumped up as the photo came in (Loft)
      if (ST.host) {
        ST.host.setAttribute('fcout', '');
        clearTimeout(ST.exOutT);
        ST.exOutT = setTimeout(function () { ST.exOutT = null; if (ST.host && !ST.fcShowing) ST.host.removeAttribute('fcout'); }, CROSSFADE_MS + 100);
        ST.host.removeAttribute('fcslide');
      }
      updateBand();
      forecastTick(false);
      layoutSoon();
    }
    function leaveForecast() {
      ST.bigRun++;
      if (ST.bigCtl) { try { ST.bigCtl.destroy(); } catch (e) { /* gone with the element */ } ST.bigCtl = null; }
      if (ST.host) { ST.host.removeAttribute('fcbig'); ST.host.removeAttribute('fcn'); }
      if (ST.fTick) { clearInterval(ST.fTick); ST.fTick = null; }
      if (ST.fscene) { try { ST.fscene.destroy(); } catch (e) { /* gone with the element */ } ST.fscene = null; }
      ST.fSky = null;
      if (ST.fband) ST.cards = ST.cards.filter(function (c) { return c !== ST.fband; });
      ST.fband = null; ST.fSig = ''; ST.mode = 'photos'; ST.fcShowing = false; ST.sinceFc = 0;
    }
    function resetForecast() {
      if (ST.fadeDone) ST.fadeDone();
      // A host reused from a stop that had not yet torn it down still has its
      // last photo on top: hand it to the first reveal as the outgoing view, so
      // that reveal un-tops and empties it rather than leaving it opaque over
      // the new photo (or under the forecast, decoded, for the whole session).
      var last = ST.root && ST.root.querySelectorAll('.ph')[ST.layer];
      ST.displayLayer = last && last.classList.contains('top') ? last : null;
      leaveForecast();
      if (ST.root) ST.root.querySelectorAll('.fc,.fcb').forEach(function (n) { n.remove(); });
      // the slide goes with the forecast's layers; the pane's music stays with the pane
      dropView(slideView());
      ST.muShowing = false; ST.lastSlide = '';
      if (ST.host) ST.host.removeAttribute('muslide');
      if (ST.host) {
        ST.host.removeAttribute('forecast'); ST.host.removeAttribute('fcslide'); ST.host.removeAttribute('band'); ST.host.removeAttribute('bandph');
        if (ST.host.style.removeProperty) ST.host.style.removeProperty('--hk-ss-corner-bottom');
      }
    }

    var ANALOG = { analog: 1, numbers: 1, giant: 1, scattered: 1, ring: 1, arc: 1, solar: 1, prism: 1, world: 1, hotel: 1, terminal: 1, atelier: 1, meridian: 1, markets: 1, brief: 1, modular: 1 };

    function faceScale(want, width, height, room, bounded) {
      var scale = want / Math.max(1, height);
      return bounded ? Math.min(scale, room.w * .9 / Math.max(1, width), room.h * .9 / Math.max(1, height)) : scale;
    }

    // WHERE THE INK IS (2026-11-01, the owner: "alignment is key"): a box around words holds the line's room above and
    // below the letters, so boxes on one line don't put the letters on one. inkOf(node): the union of what `node` draws
    // -- its words by their letters (the font's own measure: the room above the figures and below them taken off), its
    // pictures whole -- in page px, {x0, y0, x1, y1}, or null; shadow roots too. Measured, not a frame's work: only when
    // the layout is planned (the minute, a resize, the house's words)
    var inkCtx = null, inkRange = null;

    // a text node's letters: the top of its first line's letters and its last line's baseline, in page px -- from its own
    // line boxes (a Range's: wherever a flex box or padding put them) and the font's measure of how far the letters
    // reach inside a line box (k: a line box as drawn, scaled or not, against the font's own)
    function wordsInk(t, cs) {
      var txt = t.textContent.trim();
      if (!txt) return null;
      try {
        if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d');
        if (!inkRange) inkRange = document.createRange();
        inkCtx.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
        var mt = inkCtx.measureText(txt), fa = mt.fontBoundingBoxAscent, fd = mt.fontBoundingBoxDescent || 0;
        if (!(fa > 0) || !(mt.actualBoundingBoxAscent > 0)) return null;
        inkRange.selectNodeContents(t);
        var rs = inkRange.getClientRects();
        if (!rs.length) return null;
        var a = rs[0], z = rs[rs.length - 1], k = a.height / (fa + fd) || 1;
        var x0 = 1e9, x1 = -1e9;
        Array.prototype.forEach.call(rs, function (r) { x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); });
        return { x0: x0, x1: x1, y0: a.top + k * (fa - mt.actualBoundingBoxAscent), y1: z.top + (z.height / (fa + fd) || 1) * fa };
      } catch (e) { return null; }
    }

    // the ink's box: its top the highest letter's or picture's, its foot the last line's baseline (lines of words on one
    // line are on one baseline, whatever hangs below it), or the pictures' foot where there are no words
    // (`hidden`: count what is hidden too -- the big element's face is measured unseen)
    function inkOf(node, hidden) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, wy1 = -1e9, py1 = -1e9, lineH = 0, bigPy1 = -1e9;
      var walk = function (r) {
        Array.prototype.forEach.call(r.querySelectorAll('*'), function (n) {
          if (n.shadowRoot) walk(n.shadowRoot);
          var tag = n.tagName.toLowerCase();
          if (tag === 'style' || tag === 'script' || (n.closest && n.closest('svg') && tag !== 'svg')) return;
          /** @type {any} */ var cs = null, seen = function () {
            if (!cs) cs = getComputedStyle(n);
            return cs.display !== 'none' && (hidden || (cs.visibility !== 'hidden' && +cs.opacity !== 0));
          };
          if (tag === 'svg' || tag === 'img' || tag === 'canvas') {
            var q = n.getBoundingClientRect();
            if (!q.width || !q.height || !seen()) return;
            x0 = Math.min(x0, q.left); x1 = Math.max(x1, q.right); y0 = Math.min(y0, q.top); py1 = Math.max(py1, q.bottom);
            // (a picture taller than lines of words -- a song's art -- is what a card's foot is, not a glyph hanging on a line)
            if (q.height > 2.2 * lineH && lineH) bigPy1 = Math.max(bigPy1, q.bottom); else if (!lineH) pics.push(q);
            return;
          }
          for (var c = n.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 3 || !c.textContent.trim() || !seen()) continue;
            var w = wordsInk(c, cs);
            if (!w) continue;
            // (only what shows: words cut off by a box that hides its overflow -- Today's long song title, ellipsized --
            // measured their whole length, so the face's box ran past them and the time sat left of center, the
            // owner, 2026-11-01)
            for (var a = n; a && a.nodeType === 1; a = a.parentNode) {
              if (getComputedStyle(a).overflowX === 'visible') continue;
              var ab = a.getBoundingClientRect();
              w.x0 = Math.max(w.x0, ab.left); w.x1 = Math.min(w.x1, ab.right);
            }
            if (!(w.x1 > w.x0)) continue;
            x0 = Math.min(x0, w.x0); x1 = Math.max(x1, w.x1); y0 = Math.min(y0, w.y0); wy1 = Math.max(wy1, w.y1);
            lineH = Math.max(lineH, parseFloat(cs.fontSize) || 0);
          }
        });
      };
      var pics = [];
      walk(node.shadowRoot || node);
      // (pictures met before any words: judged once the words' size is known)
      pics.forEach(function (q) { if (lineH && q.height > 2.2 * lineH) bigPy1 = Math.max(bigPy1, q.bottom); });
      var y1 = wy1 > -1e9 ? Math.max(wy1, bigPy1) : py1;
      return x1 > x0 && y1 > y0 ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
    }

    // A GLANCE GROUP'S FILE (hk-saverpieces-<group>.js, phase 1b): loaded the first time a layout places one of its
    // pieces, then the layout drawn again
    var pieceFiles = {};

    function pieceFile(f) {
      if (pieceFiles[f]) return;
      pieceFiles[f] = import('/hk/modules/hk-saverpieces-' + f + '.js').then(function () { if (f === 'home') piecesStarted(); layoutSoon(); })
        .catch(function (e) { console.warn('[hk-saver] pieces', f, e && e.message); });
    }

    // THE SCREENSAVER HAS COME UP: what "since" means to the pieces that count what arrives (Notifications)
    function piecesStarted() {
      var H = window.hkSaverWidgets && window.hkSaverWidgets._ && window.hkSaverWidgets._.home;
      if (H && H.reset) { try { H.reset(); } catch (e) { /* its own */ } }
    }

    function deg(v) { return v == null || !isFinite(v) ? '—' : Math.round(v) + '°'; }

    function photoLum(img) {
      try {
        if (!img || !img.naturalWidth) return null;
        var cv = document.createElement('canvas'); cv.width = cv.height = 8;
        var x = cv.getContext('2d');
        x.drawImage(img, 0, 0, 8, 8);
        var d = x.getImageData(0, 0, 8, 8).data, sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        return sum / (d.length / 4);
      } catch (e) { return null; }         // (a photo from another host can't be read: white, as before)
    }

    // HOW MUCH OF A BOX THE LAND COVERS (its art's alpha, laid out as hk-sky.js's .land draws it: cover, center bottom, of
    // the 2560 x 1600 art): the share at half or more, weighed once per land, screen and box; undefined until it is known
    var landShares = {};

    // a Show of hk-saverfaces.js's (Glance, Month, Day): loaded only now
    var fcxLoad = null;

    function facesModule() {
      if (window.hkSaverFaces) return Promise.resolve(window.hkSaverFaces);
      if (!fcxLoad) {
        fcxLoad = import('/hk/modules/hk-saverfaces.js').then(function () { return window.hkSaverFaces; })
          .catch(function (e) { fcxLoad = null; console.warn('[hk-saver] faces', e && e.message); return null; });
      }
      return fcxLoad;
    }

    // THE CLOCK'S TEXT OVER PHOTOS (2026-10-13): Outline, four hard shadows a
    // stroke's width out (any face: text, canvas or SVG), then Shadow, one soft
    // one below -- as a filter on the clock's layer, drawn once per change
    function ckFx(c) {
      var o = (c.clock_text_outline || 0) / 100, s = (c.clock_text_shadow || 0) / 100, out = [];
      if (o > 0) {
        var w = +(0.5 + o * 2.5).toFixed(2), a = (0.55 + o * 0.4).toFixed(2);
        [[w, 0], [-w, 0], [0, w], [0, -w]].forEach(function (d) { out.push('drop-shadow(' + d[0] + 'px ' + d[1] + 'px 0 rgba(0,0,0,' + a + '))'); });
      }
      if (s > 0) out.push('drop-shadow(0 ' + (1 + s * 3).toFixed(1) + 'px ' + (2 + s * 22).toFixed(1) + 'px rgba(0,0,0,' + (0.25 + s * 0.6).toFixed(2) + '))');
      return out.join(' ') || 'none';
    }

    // the options but the clock's face (its style, 24-hour)
    // THE SLIDES' OWN SETTINGS changed alone (the editor's Slides section, a slide on show): drawn again in place
    function sansSlides(c) {
      var o = {};
      Object.keys(c || {}).forEach(function (k) { if (['corner_time_size', 'corner_hide', 'music_hide'].indexOf(k) < 0) o[k] = c[k]; });
      return JSON.stringify(o);
    }

    function sansClock(c) {
      var o = {};
      Object.keys(c || {}).forEach(function (k) { if (['clock_style', 'clock_options', 'clock_24', 'clock_today_music', 'clock_today_weather', 'clock_color', 'clock_speed', 'clock_depth',
        'clock_night', 'clock_night_from', 'clock_night_to', 'clock_text_shadow', 'clock_text_outline'].indexOf(k) < 0) o[k] = c[k]; });
      return JSON.stringify(o);
    }

    function minsOf(hhmm) { var p = String(hhmm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }

    function textBox(el) {
      var rg = document.createRange(); rg.selectNodeContents(el);
      var r = rg.getBoundingClientRect();
      return r && r.width > 0 ? r : null;
    }

    var DAY_GAP = 14;

    // the screen's weather service (Weather), for Today
    function weatherEntity() {
      var HS = window.hkSettings;
      return (HS && HS.get && HS.get('weather.entity', null)) || null;
    }

    // this dashboard's Energy page, when it has one: a tap on Home Energy opens it
    function energyPage() {
      var conf = dashConf();
      var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'energy'; });
      return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/energy' : null;
    }

    var EX_PREVIEW_MS = 8000;              // HK Settings' preview: the first one soon

    // what the shell and the later parts use of this one
    K.ANALOG = ANALOG; K.bigWanted = bigWanted; K.bigWeather = bigWeather; K.buildForecast = buildForecast;
    K.ckFx = ckFx; K.ckPhotos = ckPhotos; K.clockModule = clockModule; K.cornerClient = cornerClient;
    K.dayFit = dayFit; K.deg = deg; K.energyPage = energyPage; K.enterClock = enterClock;
    K.enterForecast = enterForecast; K.EX_PREVIEW_MS = EX_PREVIEW_MS; K.faceScale = faceScale;
    K.facesModule = facesModule; K.fcVisible = fcVisible; K.hideForecastSlide = hideForecastSlide; K.inkOf = inkOf;
    K.landShares = landShares; K.layoutRoomOf = layoutRoomOf; K.leaveClock = leaveClock; K.leaveCorner = leaveCorner;
    K.leaveForecast = leaveForecast; K.mountClock = mountClock; K.nightCheck = nightCheck; K.nightNow = nightNow;
    K.photoLum = photoLum; K.pieceFile = pieceFile; K.piecesStarted = piecesStarted; K.remountClock = remountClock;
    K.resetForecast = resetForecast; K.sansClock = sansClock; K.sansSlides = sansSlides;
    K.showForecastSlide = showForecastSlide; K.slidesAgain = slidesAgain; K.updateBand = updateBand;
    K.weatherEntity = weatherEntity;
  };
})();
