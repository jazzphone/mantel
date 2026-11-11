// hk-saver-layout.js - the layout, home energy, the weather and the holidays, a timer's last minute.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-layout'] = function (K) {
    var ANALOG = K.ANALOG, BACKDROP_SMALL = K.BACKDROP_SMALL, behindAt = K.behindAt, cardConf = K.cardConf,
        ckFx = K.ckFx, cleanDepth = K.cleanDepth, clientNow = K.clientNow, clockModule = K.clockModule,
        coverShare = K.coverShare, CROSSFADE_MS = K.CROSSFADE_MS, dayFit = K.dayFit, deg = K.deg,
        drawBackdrop = K.drawBackdrop, drawnRect = K.drawnRect, FACE_SHOWS = K.FACE_SHOWS, faceScale = K.faceScale,
        facesModule = K.facesModule, fcVisible = K.fcVisible, hideForecastSlide = K.hideForecastSlide,
        inkOf = K.inkOf, isFlat = K.isFlat, landShares = K.landShares, layoutRoomOf = K.layoutRoomOf,
        nightCheck = K.nightCheck, photoOpts = K.photoOpts, pieceFile = K.pieceFile, piecesStarted = K.piecesStarted,
        reducedMotion = K.reducedMotion, ST = K.ST, TB_COVER = K.TB_COVER, tbShare = K.tbShare, timeNow = K.timeNow,
        timerHold = K.timerHold, updateBand = K.updateBand, weatherEntity = K.weatherEntity;
    // (phase 25: the owners' writers, docs/phase25/SAVER-STATE.md)
    var Black = K.Black, clock = K.clock, musicNow = K.musicNow, musicOf = K.musicOf, nightWatch = K.nightWatch,
        Pane = K.Pane, Run = K.Run, Screens = K.Screens, setAttr = K.setAttr, slideShown = K.slideShown;



    // WHAT IT OWNS ON ST (phase 25, A: others read these; only this file writes them; tools/state_owners.py)
    ST.ly = null;
    ST.enCtl = null;
    ST.enShowing = false;
    ST.TW = null;

    // ITS OWN STATE (phase 25, A: off the shared ST, which only this file used; tools/state_owners.py)
    /** @type {any} */ var lyRun = 0;
    /** @type {any} */ var lyLoad = null;
    /** @type {any} */ var lyClientAt = 0;
    /** @type {any} */ var enT = null;
    /** @type {any} */ var enRun = 0;
    // OVER THE FORECAST, ITS LANDSCAPE BLURRED (2026-10-31, the owner: Home Energy over the forecast "doesn't blur the
    // forecast backdrop" -- the big temperature and the details read through its dark wash): the season's landscape on
    // screen drawn small, as a photo's blurred copy is, its foot at the foot (hk-sky.js .land: cover, center bottom).
    // Its image is the one the sky shows, from the browser's cache; until it has loaded (or under Flat, which draws no
    // copies), the darkened sky as before.
    /** @type {any} */ var landIm = null;

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
      if (!ST.root || !ST.cfg || !ST.cfg.layout) return;
      var layoutLayer = document.createElement('div');
      layoutLayer.className = 'lay';
      ST.root.insertBefore(layoutLayer, ST.root.querySelector('.info'));
      ST.host.setAttribute('lay', '');
      var run = ++lyRun;
      ST.ly = { run: run, layer: layoutLayer, big: null, widgets: {}, soonT: null, minuteT: null, ro: null, last: '' };
      layoutModules().then(function (got) {
        if (!ST.ly || ST.ly.run !== run || !ST.on || !got[0]) return;
        // (the widgets' look: their sheet in this shadow tree, which the document's can't reach)
        if (got[1] && got[1].CSS) { var css = got[1].sheet ? got[1].sheet() : document.createElement('style'); if (!got[1].sheet) css.textContent = got[1].CSS; layoutLayer.appendChild(css); }
        // (the layout's groups' files at once: Notifications counts from the moment the screensaver comes up)
        if (got[0] && got[0].filesOf) got[0].filesOf(got[0].clean(ST.cfg.layout)).forEach(pieceFile);
        piecesStarted();
        layoutDraw();
        // the widgets' words on the minute; the cards' sizes once they have drawn
        ST.ly.minuteT = setTimeout(function tickMinute() {
          if (!ST.ly || ST.ly.run !== run) return;
          layoutDraw();
          ST.ly.minuteT = setTimeout(tickMinute, 60000 - Date.now() % 60000 + 50);
        }, 60000 - Date.now() % 60000 + 50);
        setTimeout(layoutSoon, 1200);
        // NIGHT MODE with a layout, whatever is behind it
        nightCheck();
        nightWatch();
        if (typeof ResizeObserver === 'function') { ST.ly.ro = new ResizeObserver(layoutSoon); ST.ly.ro.observe(ST.host); }
      });
    }
    function leaveLayout() {
      lyRun++;
      if (!ST.ly) { if (ST.host) ST.host.removeAttribute('lay'); return; }
      clearTimeout(ST.ly.soonT); clearTimeout(ST.ly.minuteT); clearInterval(ST.ly.secT);
      if (ST.ly.ro) ST.ly.ro.disconnect();
      layoutBigOff();
      Object.keys(ST.ly.widgets).forEach(function (k) { try { ST.ly.widgets[k].destroy(); } catch (e) { /* gone */ } });
      if (ST.ly.layer && ST.ly.layer.parentNode) ST.ly.layer.remove();
      ST.cards.forEach(function (c) { c.removeAttribute('lyhide'); c.style.removeProperty('left'); c.style.removeProperty('top'); });
      ST.ly = null;
      if (ST.host) { ST.host.removeAttribute('lay'); ST.host.removeAttribute('lyoff'); }
    }
    // UNDER A SLIDE: the music, the forecast among the photos or over a clock, the weather, Home Energy -- or Big Weather
    // in the photos' place, which tells the time itself. Every slide's coming and going passes updateBand(), which asks here.
    function layoutCovered() {
      return !!ST.ly && (ST.muShowing || ST.enShowing || WX.showing || HL.showing || ST.fcShowing || (ST.mode === 'forecast' && ST.host.hasAttribute('fcbig')));
    }
    function layoutSlides() {
      if (!ST.ly || !ST.host) return;
      var off = layoutCovered();
      if (off === ST.host.hasAttribute('lyoff')) return;
      setAttr(ST.host, 'lyoff', off);
      if (off) {
        // the layout's places and looks taken off the cards (their own variables, a corner's colors, the plates)
        ST.cards.forEach(function (c) {
          Array.prototype.slice.call(c.style).forEach(function (p) { if (/^--hk-ss-|^--hk-ink$/.test(p) || p === 'left' || p === 'top') c.style.removeProperty(p); });
          c.removeAttribute('lyhide');
        });
      }
      // each card's config for now: a corner's own sizes, or the layout's (cardConf)
      ST.cards.forEach(function (c) {
        var conf = c.__hkSaverConf;
        if (conf) { try { c.setConfig(cardConf(conf, String(conf.type || '').replace(/^custom:/, ''))); } catch (e) { /* as it was */ } }
      });
      // ...back where the plan puts them at once, and again once they have drawn at their sizes
      if (!off) { layoutDraw(); layoutSoon(); }
      // the cards fade in where they now are, with the slide, as the layout fades the other way (never a jump across the screen)
      var info = ST.root && ST.root.querySelector('.info');
      if (info && info.animate && !reducedMotion()) { try { info.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: 'ease' }); } catch (e) { /* shown */ } }
    }
    // drawn again soon, once for everything that asks at the same moment
    function layoutSoon() {
      if (!ST.ly || ST.ly.soonT) return;
      ST.ly.soonT = setTimeout(function () { if (ST.ly) { ST.ly.soonT = null; layoutDraw(); } }, 120);
    }
    function layoutClient() {
      if (!ST.ly) return;
      var now = Date.now();
      if (now - lyClientAt < 2000) return;         // the house's states change many times a second: the words, at most every 2 s
      lyClientAt = now;
      layoutSoon();
    }
    function layoutBigOff() {
      if (!ST.ly || !ST.ly.big) return;
      if (ST.ly.big.ctl) { try { ST.ly.big.ctl.destroy(); } catch (e) { /* gone */ } }
      if (ST.ly.big.el && ST.ly.big.el.parentNode) ST.ly.big.el.remove();
      ST.ly.big = null;
    }
    // the room the layout has: the screen less the Side Pane, beside it
    function layoutRoom() {
      var W = ST.host.clientWidth || window.innerWidth || 1280, H = ST.host.clientHeight || window.innerHeight || 800;
      var pw = ST.paneUp ? (ST.paneW || 0) : 0;
      return { W: W, H: H, room: { x: ST.cfg.pane_side === 'left' ? pw : 0, y: 0, w: Math.max(1, W - pw), h: H } };
    }
    // THE BIG ELEMENT: made (or kept) for what the layout asks, and its size as drawn -- {w, h, base} -- or null
    function layoutBig(b, R, u) {
      var key = [b.kind, b.depth, b.size, b.align, ST.cfg.clock_style, !!ST.cfg.clock_planted, ST.cfg.clock_color, ST.cfg.clock_24, ST.cfg.clock_today_music, ST.cfg.clock_today_weather,
        JSON.stringify(ST.cfg.clock_options), R.room.w, R.room.h, ST.cfg.show, ST.mode, !!ST.fcShowing].join('|');
      // (Behind only while photos show: over the forecast between them, or with no photos, the time stands in front)
      var planted = b.kind === 'time' && (b.depth === 'planted' || ST.cfg.clock_planted) && (ST.cfg.show === 'forecast' || (ST.cfg.show === 'clock' && ST.cfg.clock_bg === 'forecast')) && !!ST.fSky;
      if (ST.ly.big && ST.ly.big.key !== key) layoutBigOff();
      if (b.kind === 'none') return null;
      if (!ST.ly.big) {
        var el = document.createElement('div');
        el.className = 'lybig';
        // (under every piece: the subject's twin goes right over it, and the pieces over both)
        ST.ly.layer.insertBefore(el, ST.ly.layer.querySelector('.hksw'));
        ST.ly.big = { key: key, el: el, ctl: null, kind: b.kind, planted: planted };
      }
      var big = ST.ly.big, el2 = big.el, fs = b.size * u, client = clientNow();
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
        var season = window.hkSky && window.hkSky._land ? window.hkSky._land.season(client, ST.fSky) : 'fall';
        var txt = timeNow(), pk = [txt, ST.fSky.elev, ST.fSky.azim, ST.fSky.cover, season, b.align, b.size].join('|');
        if (big.pk !== pk) big.pk = F.plant(big.pl, txt, R.W, R.H, ST.fSky, season, layoutSoon, b.align, b.size) ? pk : null;
        var fig = big.pl.querySelector('.pd .b');
        if (!fig) return null;
        var r = fig.getBoundingClientRect(), hr = ST.host.getBoundingClientRect();
        return { w: r.width, h: r.height, base: r.height * 0.8, fixed: { x: r.left - hr.left, y: r.top - hr.top } };
      }
      if (b.kind === 'time') {
        var C = window.hkSaverClock;
        if (!C) { clockModule().then(layoutSoon); return null; }
        if (!big.ctl) {
          // the face drawn in a box the room's shape, measured, then scaled so its figures are the layout's size
          el2.className = 'lybig measuring';
          el2.style.cssText = 'left:0;top:0;width:' + R.room.w + 'px;height:' + R.room.h + 'px;container-type:size';
          big.ctl = C.mount(el2, { style: ST.cfg.clock_style, options: ST.cfg.clock_options, h24: ST.cfg.clock_24, color: ST.cfg.clock_color, bg: 'none', ground: false, scrim: false,
                                  timeOnly: true, weather: weatherEntity(), music: ST.cfg.clock_today_music, todayWeather: ST.cfg.clock_today_weather, client: client,
                                    minutely: !ANALOG[ST.cfg.clock_style] });
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
          var want = ANALOG[ST.cfg.clock_style] ? fs * 1.9 : fs * 0.72;
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
        for (var n = 1; n <= days; n++) cells += '<span style="display:flex;align-items:center;justify-content:center;width:' + cell.toFixed(1) + 'px;height:' + (cell * 0.84).toFixed(1) +
          'px;border-radius:50%' +
          (n === d.getDate() ? ';background:#e0302a;color:#fff' : '') + '">' + n + '</span>';
        html = '<div style="font-size:' + (fs * 0.16).toFixed(1) + 'px;font-weight:700;text-align:center;margin-bottom:' + (fs * 0.05).toFixed(1) + 'px">' +
          d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</div><div style="display:grid;grid-template-columns:repeat(7,auto);font-size:' + (fs * 0.09).toFixed(1) +
            'px;font-weight:600">' + cells + '</div>';
      }
      if (big.html !== html) { el2.innerHTML = html; big.html = html; el2.style.left = '0px'; el2.style.top = '0px'; }
      var bh = el2.offsetHeight, bi = inkOf(el2), br2 = el2.getBoundingClientRect();
      return { w: el2.offsetWidth, h: bh, base: bh * 0.85, t: bi ? Math.max(0, bi.y0 - br2.top) : 0, b: bi ? Math.max(0, br2.bottom - bi.y1) : 0 };
    }
    function layoutInk(L) {
      var want = L.ink || 'auto';
      if (want !== 'auto') return want;
      if (ST.host && ST.host.hasAttribute('cknight')) return 'white';
      if (ST.host && ST.host.hasAttribute('cklight')) return 'black';
      var photos = ST.mode === 'photos' && !ST.fcShowing;
      if (photos && ST.lyPhotoLum != null) {
        var dim = (photoOpts(ST.cfg).dim || ST.cfg.clock_photo_dim || 0) / 100;
        return ST.lyPhotoLum * (1 - dim) > 0.62 ? 'black' : 'white';
      }
      return 'white';
    }
    // THE PLAN, and everything put where it says
    function layoutDraw() {
      var LM = window.hkSaverLayout, WG = window.hkSaverWidgets;
      if (!ST.ly || !LM || !ST.root || !ST.cfg || !ST.cfg.layout) return;
      var L = LM.clean(ST.cfg.layout);
      if (!L) return;
      var R = layoutRoom(), O = LM.oriented(L, R.W, R.H), u = Math.min(R.room.w, R.room.h) / 100, zs = O.zones;
      // the screen's one ink, and its accents
      var ink = layoutInk(L);
      if (ST.ly.layer.getAttribute('data-ink') !== ink) ST.ly.layer.setAttribute('data-ink', ink);
      ST.ly.layer.style.setProperty('--lay-ink', ink === 'black' ? '#161616' : '#ffffff');
      setAttr(ST.ly.layer, 'data-acc', L.accents !== false);
      // the pieces this shape has (made once each, updated with the house)
      var want = {}, client = clientNow(), now = new Date();
      // (the photo showing: its title, and its year and date for On This Day -- only while photos show)
      var photoNow = ST.mode === 'photos' && !ST.fcShowing && ST.lyPhoto ? { year: ST.lyPhoto.year || null, date: ST.lyPhoto.date || null } : null;
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
          if (!ST.ly.widgets[key] && WG) {
            try {
              ST.ly.widgets[key] = WG.create(w.piece, w.shape, { u: wu, back: w.back, color: w.color, align: al, title: w.title, h24: ST.cfg.clock_24, weather: weatherEntity(), opts: w.opts || {} });
              if (ST.ly.widgets[key]) { var te = ST.ly.widgets[key].el, tk = LM.TAP_SHEETS && LM.TAP_SHEETS[w.piece]; te.setAttribute('data-tap', (w.opts && w.opts.tap) || 'page');
                if (tk && w.opts && w.opts[tk]) te.setAttribute('data-tap-entity', w.opts[tk]); ST.ly.layer.appendChild(te); }
            } catch (e) { console.warn('[hk-saver] piece', w.piece, w.shape, e && e.message); }
          }
          var ctl = ST.ly.widgets[key];
          if (ctl) { try { ctl.update(client, now, ctx); } catch (e) { /* its own data */ } ctl.zone = z; ctl.i = i; }
        });
      });
      // a timer running: its ring and its time each second, the pieces alone (nothing else moves)
      var live = Object.keys(ST.ly.widgets).some(function (k) { return want[k] && ST.ly.widgets[k].live; });
      if (live && !ST.ly.secT) ST.ly.secT = setInterval(function () {
        if (!ST.ly) return;
        var h = clientNow(), t = new Date();
        Object.keys(ST.ly.widgets).forEach(function (k) { var c = ST.ly.widgets[k];
          if (c.live) { try { c.update(h, t, { title: layoutTitle(), music: h ? musicOf(musicNow(h), h) : null }); } catch (e) { /* its own */ } } });
      }, 1000);
      else if (!live && ST.ly.secT) { clearInterval(ST.ly.secT); ST.ly.secT = null; }
      Object.keys(ST.ly.widgets).forEach(function (k) {
        if (want[k]) return;
        try { ST.ly.widgets[k].destroy(); } catch (e) { /* gone */ }
        if (ST.ly.widgets[k].el && ST.ly.widgets[k].el.parentNode) ST.ly.widgets[k].el.remove();
        delete ST.ly.widgets[k];
      });
      // (under a slide the pieces keep their words and their places; nothing is placed until it has gone)
      layoutSlides();
      if (ST.host.hasAttribute('lyoff')) return;
      // (the corner cards kept for the slides: hidden again once a slide has gone)
      ST.cards.forEach(function (c) { if (!c.hasAttribute('lyhide')) c.setAttribute('lyhide', ''); });
      var widgetAt = function (z, i) {
        var hit = null;
        Object.keys(ST.ly.widgets).forEach(function (k) { var c = ST.ly.widgets[k]; if (c.zone === z && c.i === i) hit = c; });
        return hit;
      };
      // WHAT IS PLANNED: a piece whose condition is met (w.show: the owner's "only shows when the Mail Has Arrived"), a fact shown once (rule 5: the face, the big element or the piece placed first
      // keeps it), and a
      // "shows when..." piece only while it shows -- ON THE TABLET IT COLLAPSES (rule 4), and the plan changes only when
      // one comes or goes; the editor's preview keeps its place, drawn dotted there ([empty])
      var claimed = LM.claims(O, ST.cfg);
      ST.ly.claims = claimed; ST.ly.empty = {};
      var planned = {};
      Object.keys(zs).forEach(function (z) {
        planned[z] = [];
        zs[z].forEach(function (w, i) {
          // (gone: nothing to show, or its condition -- "only when the mail has arrived" -- not met)
          var c = widgetAt(z, i), gone = (c && (c.showing === false || c.blank)) || !LM.met(w.show, client && client.states);
          if (gone) ST.ly.empty[z + ':' + i] = LM.idOf(w);
          // (...the editor keeps its place, dotted, where you can see it is there; any other screen, a Settings preview too,
          // closes up -- 2026-11-02, an empty title held Home Status off the bottom corners' one line in the preview's shots)
          var editing = ST.previewOn && !!ST.previewOver;
          // (no column without a big element of the layout's own: a Month's, or a face's that draws its own words -- the line
          // and the row wait, as the editor says)
          if ((z === 'line' || z === 'row') && (O.big.kind === 'month' || (O.big.kind === 'none' && FACE_SHOWS[ST.cfg.show]))) { if (c) c.el.style.display = 'none'; return; }
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
            if (r2.height) { var ci = inkOf(c.el); found.h = r2.height; found.w = Math.max(found.w || 0, r2.width);
              if (ci) { found.t = Math.max(0, ci.y0 - r2.top); found.b = Math.max(0, r2.bottom - ci.y1); } }
          }
          return found;
        }
      }, { w: R.W, h: R.H });
      // (the plan's indexes are the planned pieces': back to each zone's own)
      var back = function (z, i) { return planned[z][i] ? planned[z][i].__i : i; };
      P.row.items.forEach(function (it) { it.i = back('row', it.i); });
      Object.keys(P.corners).forEach(function (z) { P.corners[z].forEach(function (bx) { bx.i = back(z, bx.i); }); });
      P.moved.forEach(function (mv) { mv.i = back(mv.zone, mv.i); });
      ST.ly.plan = P;
      // OVER PHOTOS, its own Shadow and Outline (Clock's, ckFx: the photo under it can be anything)
      if (ST.ly.big && ST.ly.big.el && !ST.ly.big.planted) {
        // (...and over the Landscape, as busy a ground as a photo: Legibility wherever the background is -- phase 13)
        var overPhotos = ST.cfg.show === 'photos' || ST.cfg.show === 'both' || ST.cfg.show === 'forecast' ||
          (ST.cfg.show === 'clock' && (ST.cfg.clock_bg === 'photos' || ST.cfg.clock_bg === 'landscapes' || ST.cfg.clock_bg === 'forecast'));
        var fx = overPhotos ? ckFx(ST.cfg) : 'none';
        ST.ly.big.el.style.filter = fx !== 'none' ? fx : '';
      }
      // the big element where the plan says (Planted stands where the land puts it; Behind is Time Behind's)
      if (big && P.big) {
        if (ST.ly.big && !big.fixed) {
          if (ST.ly.big.scale) { ST.ly.big.el.style.left = (P.big.x - ST.ly.big.off.x) + 'px'; ST.ly.big.el.style.top = (P.big.y - ST.ly.big.off.y) + 'px'; }
          else { ST.ly.big.el.style.left = P.big.x + 'px'; ST.ly.big.el.style.top = P.big.y + 'px'; }
          // WHERE IT IS SET, BY WHAT SHOWS (2026-11-02, the owner on 0.1.118: the time right of center over some photos,
          // the Today face with a song under it): the face is measured once, as it first drew; what it shows since --
          // another song, the weather or not, other figures -- is put back on its Align by its ink (as it was measured:
          // what flickers, Neon's letters, counted while it is out)
          if (ST.ly.big.scale && ST.host && ST.host.getBoundingClientRect) {
            // (by its figures -- the lines under them needn't be even about them -- a range over all of .tm, its own text and
            // what is inside it, as inkOf looks only inside a node; a face without them, by all it draws)
            var all0 = inkOf(ST.ly.big.el, true), fig0 = ST.ly.big.el.querySelector('.tm'), fi0 = null;
            if (fig0 && document.createRange && /\d\D+\d/.test(fig0.textContent)) {
              var rg0 = document.createRange(); rg0.selectNodeContents(fig0);
              var fr0 = rg0.getBoundingClientRect && rg0.getBoundingClientRect();
              if (fr0 && fr0.width > 0) fi0 = { x0: fr0.left, x1: fr0.right };
            }
            var vi = fi0 || all0, hr0 = ST.host.getBoundingClientRect(), k0 = ST.host.offsetWidth ? hr0.width / ST.host.offsetWidth : 1;
            if (vi && k0 > 0) {
              // (where its ink is inside its own box -- the box and the ink measured together, so a box still on its way
              // from where it was doesn't count -- then the box put so that point is on the place)
              var al = O.big.align, at = al === 'left' ? P.big.x : al === 'right' ? P.big.x + P.big.w : P.big.x + P.big.w / 2;
              var er0 = ST.ly.big.el.getBoundingClientRect(), inside = ((al === 'left' ? vi.x0 : al === 'right' ? vi.x1 : (vi.x0 + vi.x1) / 2) - er0.left) / k0;
              var want0 = at - inside;
              if (Math.abs(want0 - parseFloat(ST.ly.big.el.style.left)) > 0.5) ST.ly.big.el.style.left = want0 + 'px';
              // (and its width for the next plan: a long song measured once kept the corners away from a short one)
              var vw = all0 ? (all0.x1 - all0.x0) / k0 : ST.ly.big.size.w;
              if (ST.ly.big.size && Math.abs(vw - ST.ly.big.size.w) > 2) { ST.ly.big.size.w = vw; layoutSoon(); }
            }
          }
        }
      }
      // BEHIND THE LAND (2026-11-01): the land drawn again over the big element -- its sky is clear, so what stands in the
      // sky still shows and the hills and the trees come in front -- in a box the big element's size, never the screen's
      var landOn = O.big.depth === 'behind' && O.big.kind !== 'none' && ST.fscene && ST.fscene.landShown && !!ST.fscene.landShown() &&
        (ST.cfg.show === 'forecast' || (ST.cfg.show === 'clock' && ST.cfg.clock_bg === 'forecast'));
      // (...where the land leaves enough of the time to read: past 35 % of its box, the time stands in front -- a phone on
      // its side hid nearly all of it under the trees, 2026-11-02)
      var landBox = landOn && P.big && ST.ly.big ? P.big : null;
      ST.ly.landShare = null;
      if (landBox) { var lsh = ST.ly.landShare = landShare(landBox, R); if (lsh === undefined || lsh > TB_COVER[1]) landBox = null; }
      layoutLand(landBox, R);
      // the photos' Darken, whatever stands in front of them (Photos and Both; Clock on Photos has its own)
      var phd = (ST.cfg.show === 'photos' || ST.cfg.show === 'both') ? (ST.cfg.tb_dim || 0) / 100 : 0;
      setAttr(ST.host, 'phdim', phd > 0);
      ST.host.style.setProperty('--ph-dim', String(phd));
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
      if (ST.cfg.show === 'day') requestAnimationFrame(dayFit);
    }
    // BEHIND THE PHOTO'S SUBJECT, ANY FACE (2026-11-02, phase 13, phase 3; the owner: "Every clock styling option works
    // with the time both in front of the photo's subject and behind it"): the order is the photo, the face, then the
    // subject cut out of the photo over the face. Each photo layer has a twin here, after the face and before the pieces:
    // the same picture masked by its cut-out, laid out as the photo is (its fit, focus, zoom and Darken), fading with it
    // (reveal) and zooming with it (Slow Zoom). The subject comes in front only where it covers 5 to 35 % of the face's
    // own box (its ink, from the plan) -- else, on a Mosaic, or on a photo with no cut-out, the time stands in front.
    // the big element a layout asks for ('none' leaves it to a face that draws its own words: Glance, Month, the Day face)
    function layoutBigKind() {
      var L = ST.cfg && ST.cfg.layout, b = L && (window.hkSaverLayout ? (window.hkSaverLayout.clean(L) || {}).big : L.big);
      return (b && b.kind) || 'time';
    }
    function cutWanted() {
      if (!ST.ly || !ST.ly.big || !ST.ly.plan || !ST.ly.plan.big || !ST.cfg || !ST.cfg.layout) return false;
      var b = (window.hkSaverLayout ? window.hkSaverLayout.clean(ST.cfg.layout) : ST.cfg.layout).big || {};
      var on2 = ST.cfg.show === 'photos' || ST.cfg.show === 'both' || (ST.cfg.show === 'clock' && ST.cfg.clock_bg === 'photos' && !ST.cfg.clock_photo_soft);
      return on2 && b.kind !== 'none' && b.depth === 'behind' && ST.mode === 'photos' && !ST.fcShowing && !(ST.moState && ST.displayLayer === ST.moState.layer);
    }
    function layoutCut() {
      if (!ST.ly || !ST.root) return;
      var want = cutWanted(), layers = ST.root.querySelectorAll('.ph');
      ST.ly.cuts = ST.ly.cuts || [];
      Array.prototype.forEach.call(layers, function (L0, i) {
        var tw = ST.ly.cuts[i], ph = L0.__ph, d = ph && cleanDepth(ph.item);
        if (!want || !d || !ph.w || !ph.h) { if (tw) tw.style.display = 'none'; return; }
        if (!tw) {
          tw = ST.ly.cuts[i] = document.createElement('div');
          tw.className = 'lycut';
          tw.appendChild(document.createElement('img'));
          tw.firstChild.alt = '';
        }
        // (shown again after a photo with no cut-out: from nothing, so it fades in -- out of display:none it would jump)
        if (tw.style.display === 'none') { tw.style.transition = 'none'; tw.classList.remove('top'); tw.style.display = ''; void tw.offsetWidth; }
        // (after the face, before the pieces)
        // (moved only when out of place: two twins each put right after the face swapped places at every draw, and an
        // element moved in the page drops its running fade -- the twins jumped to the end of every crossfade)
        if (ST.ly.big.el.parentNode === ST.ly.layer) {
          var after = tw.parentNode === ST.ly.layer && (ST.ly.big.el.compareDocumentPosition(tw) & 4), firstPc = ST.ly.layer.querySelector(':scope > .hksw');
          if (!after || (firstPc && !(tw.compareDocumentPosition(firstPc) & 4))) ST.ly.layer.insertBefore(tw, ST.ly.big.el.nextSibling);
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
        var R = layoutRoomOf(), pb = ST.ly.plan.big, pos = String(L0.style.getPropertyValue('--pos') || '50% 50%').split(/\s+/).map(
          function (v) { var n = parseFloat(v); return isFinite(n) ? n / 100 : 0.5; });
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
      var cur = ST.displayLayer && ST.displayLayer.classList && ST.displayLayer.classList.contains('ph') ? ST.displayLayer : null;
      tw.style.transition = (cur || L0).style.transition;
      // (no z-index of its photo's: its place in the layer -- after the face, before the pieces -- is its height)
      if (L0.classList.contains('zoom') !== tw.classList.contains('zoom')) {
        if (L0.classList.contains('zoom')) { void tw.offsetWidth; tw.classList.add('zoom'); } else tw.classList.remove('zoom');
      }
      tw.classList.toggle('top', cur ? L0 === cur : L0.classList.contains('top'));
    }
    function cutsFollow() {
      if (!ST.ly || !ST.ly.cuts || !ST.root) return;
      Array.prototype.forEach.call(ST.root.querySelectorAll('.ph'), function (L0, i) { cutFollow(L0, ST.ly.cuts[i]); });
    }
    function landShare(box, R) {
      var file = ST.fscene && ST.fscene.landShown && ST.fscene.landShown();
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
      if (!box) { if (ST.ly.land) { ST.ly.land.remove(); ST.ly.land = null; } return; }
      if (!ST.ly.land) { ST.ly.land = document.createElement('div'); ST.ly.land.className = 'lyland'; }
      if (ST.ly.big && ST.ly.big.el && ST.ly.land.previousSibling !== ST.ly.big.el) ST.ly.layer.insertBefore(ST.ly.land, ST.ly.big.el.nextSibling);
      // (where hk-sky.js's .land draws it: cover, center bottom, of the 2560 x 1600 art)
      var k = Math.max(R.W / 2560, R.H / 1600), aw = 2560 * k, ah = 1600 * k, ax = (R.W - aw) / 2, ay = R.H - ah, pad = 4;
      var sky = ST.root.querySelector('#hk-sky'), b = sky ? (sky.style.getPropertyValue('--landB') || '1') : '1';
      var st = ST.ly.land.style;
      st.left = (box.x - pad) + 'px'; st.top = (box.y - pad) + 'px'; st.width = (box.w + 2 * pad) + 'px'; st.height = (box.h + 2 * pad) + 'px';
      st.backgroundImage = 'url("/hk/sky/' + ST.fscene.landShown() + '")';
      st.backgroundSize = aw + 'px ' + ah + 'px';
      st.backgroundPosition = (ax - box.x + pad) + 'px ' + (ay - box.y + pad) + 'px';
      st.filter = 'brightness(' + b + ')';
    }
    function layoutTitle() {
      var it = ST.lyPhoto || {};
      return [it.album, it.year].filter(function (x) { return x; }).join(' \u00b7 ');
    }
    // at the start: the module, the Energy page's code, and the numbers asked
    // for -- so its first turn has them. `hold` (HK Settings' preview of Home
    // Energy): shown as soon as they are here, and kept up
    function energyPrep() {
      var run = ++enRun, hold = ST.previewOn && (ST.previewEnergy || ST.previewSelected === 'energy');
      if (!ST.cfg || (!ST.cfg.energy_slide && !hold)) return;
      slideModule(EN_MOD).then(function (X) { return X ? X.ready().then(function () { return X; }) : null; }).then(function (X) {
        if (!X || run !== enRun || !ST.on || !ST.root || !ST.cfg || (!ST.cfg.energy_slide && !hold)) return;
        // in its place at the start, as the weather's: put in at its first
        // turn, its layer was made as it came in (2026-10-19)
        if (!ST.enCtl) {
          ST.enCtl = X.create({ hide: ST.cfg.energy_hide, h24: ST.cfg.clock_24, corner: false });
          ST.root.insertBefore(ST.enCtl.el, ST.root.querySelector('.info'));
        } else ST.enCtl.setHide(ST.cfg.energy_hide);
        ST.enCtl.ready(clientNow());
        landImg();                         // (the landscape's image asked for now: its blurred copy ready at the first turn)
        if (!hold) return;
        var tries = 0, show = function () {
          if (run !== enRun || !ST.on || ST.enShowing || !ST.previewOn || (!ST.previewEnergy && ST.previewSelected !== 'energy')) return;
          // (at once: the preview is shown again after every change)
          if (showEnergySlide(true)) { Screens.extraIs('energy'); return; }
          if (++tries < 60) setTimeout(show, 500);
        };
        show();
      });
    }
    function energyReady() { return !!(ST.enCtl && ST.enCtl.ready(clientNow())); }
    // the photo on screen, for its blurred copy (a mosaic: its first cell)
    function curImg() {
      var L = ST.displayLayer;
      if (!L || !L.classList.contains('ph')) return null;
      var im = L.querySelector('img.fg');
      if (!L.classList.contains('mo') && im && im.getAttribute('src') && im.naturalWidth) return im;
      var c = L.querySelector('.mocell canvas');
      return c && c.width ? c : null;
    }
    function energyLook() {
      if (ST.mode === 'photos' && curImg()) return 'photo';
      if (ST.mode === 'forecast' || ST.fcShowing) return landImg() ? 'land' : 'sky';
      return 'plain';
    }
    function landImg() {
      if (isFlat() || !ST.root) return null;
      var i = ST.root.querySelector('.fc .land>i.on'), m = i && /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(i).backgroundImage || '');
      if (!m) return null;
      if (!landIm || landIm.hkSrc !== m[1]) { landIm = new Image(); landIm.hkSrc = m[1]; landIm.src = m[1]; }
      return landIm.complete && landIm.naturalWidth ? landIm : null;
    }
    // ...and the sky over it, as it is now: the art's top is transparent (the live sky shows through it), so its copy
    // alone left the sky, its clouds and Big Weather's words sharp above the land (2026-10-31, the owner: "only half
    // blurred"). The sky's own four stops, where a landed sky puts them (hk-sky.js .own.landed .grad)
    function skyStops() {
      var k = ST.root && ST.root.querySelector('.fc #hk-sky'), cs = k && getComputedStyle(k), out = [];
      if (!cs) return out;
      [0, 0.24, 0.44, 0.62].forEach(function (at, i) { var v = cs.getPropertyValue('--sk' + i).trim(); if (v) out.push([at, v]); });
      if (out.length) out.push([1, out[out.length - 1][1]]);
      return out;
    }
    // ITS ROOM: beside the pane (it tells the time itself, top left)
    function energyLayout() {
      if (!ST.enCtl || !ST.root || !ST.host) return;
      ST.enCtl.layout((window.innerWidth || 0) - (ST.paneUp ? ST.paneW : 0), window.innerHeight || 0);
    }
    // HOME ENERGY'S OR THE WEATHER'S LAYER, just under the corner cards: only
    // the other of the two between them (they never show at once). Moved only
    // when something else is -- a node moved is drawn again, its layers and
    // the whole sky in it made again (2026-10-19: the weather's moved under
    // Home Energy's at every other turn, and Home Energy's under the weather's)
    function underCards(el, info) {
      if (!info || el.parentNode !== ST.root) return false;
      for (var n = el.nextSibling; n; n = n.nextSibling) {
        if (n === info) return true;
        if (!n.classList || !(n.classList.contains('en') || n.classList.contains('wx') || n.classList.contains('hkhol'))) return false;
      }
      return false;
    }
    // (the landscape's blurred copy is drawn as a photo's is, its foot at the foot)
    function overBackdrop(c, h) {
      var look = energyLook(), img = look === 'photo' ? curImg() : look === 'land' ? landImg() : null, foot = look === 'land' ? 1 : 0.5, sky = foot === 1 ? skyStops() : null;
      return c.draw(h, look === 'land' ? 'photo' : look, img ? function (cv) { drawBackdrop(cv, img, BACKDROP_SMALL, foot, sky); } : null);
    }
    function showEnergySlide(first) {
      if (!ST.on || !ST.root || !ST.host || ST.enShowing || !ST.enCtl) return false;
      var h = clientNow(), info = ST.root.querySelector('.info');
      if (!ST.enCtl.ready(h)) return false;
      // above whatever came after it (a clock mounted again), under the corner cards
      if (!underCards(ST.enCtl.el, info)) ST.root.insertBefore(ST.enCtl.el, info);
      if (!overBackdrop(ST.enCtl, h)) return false;
      ST.enShowing = true; slideShown('energy');
      ST.host.setAttribute('enslide', '');
      updateBand();
      Black.forecastTick(false);                 // the forecast's sky holds still under it
      energyLayout();
      var el = ST.enCtl.el, run = ST.photoRun;
      el.style.setProperty('--hk-en-fade', (first ? 0 : CROSSFADE_MS) + 'ms');
      void el.offsetWidth;
      el.classList.add('on');
      if (enT) clearTimeout(enT);
      enT = setTimeout(function () { enT = null; if (ST.on && run === ST.photoRun && ST.enShowing && ST.enCtl) ST.enCtl.arrived(); }, first ? 50 : CROSSFADE_MS);
      if (first && ST.entrance) ST.entrance();
      return true;
    }
    function hideEnergySlide() {
      if (!ST.enShowing) return;
      ST.enShowing = false;
      if (enT) { clearTimeout(enT); enT = null; }
      if (ST.host) ST.host.removeAttribute('enslide');
      if (ST.enCtl) {
        ST.enCtl.leave();
        ST.enCtl.el.style.setProperty('--hk-en-fade', CROSSFADE_MS + 'ms');
        ST.enCtl.el.classList.remove('on');
      }
      updateBand();
      if (fcVisible()) Black.forecastTick(true);
    }
    function leaveEnergy() {
      enRun++;
      if (enT) { clearTimeout(enT); enT = null; }
      ST.enShowing = false;
      if (ST.enCtl) { try { ST.enCtl.destroy(); } catch (e) { /* gone */ } ST.enCtl = null; }
      if (ST.host) ST.host.removeAttribute('enslide');
    }

    // ------------------------------------------------------------ the weather and the holidays
    // WEATHER (2026-10-14, hk-saver-weather.js) and THE HOLIDAY SLIDE (phase 20, hk-saver-holiday.js), each loaded only
    // now: today's weather at a glance over the Live Sky (Sky Only), laid out as Home Energy is; how many days until the
    // next holiday, in its painted scene or outdoors. The same kind of layer (.wx, .hkhol: above the clock, under the corner
    // cards), opaque -- its own sky or scene -- faded in over what is there, and one set of steps for both (a slot each:
    // its controller, whether it shows, its fade's timer and its run). The holiday's only when one is near (ready).
    var WX = { key: 'weather', file: 'hk-saver-weather.js', glob: 'hkSaverWeather', attr: 'wxslide', fade: '--hk-wx-fade', ctl: null, load: null, showing: false, t: null, run: 0,
               make: function (X) { return X.create({ hide: ST.cfg.weather_hide, h24: ST.cfg.clock_24, corner: false }); }, again: function (c) { c.setHide(ST.cfg.weather_hide); } };
    var HL = { key: 'holiday', file: 'hk-saver-holiday.js', glob: 'hkSaverHoliday', attr: 'hlslide', fade: '--hk-hl-fade', ctl: null, load: null, showing: false, t: null, run: 0,
               make: function (X) { return X.create({ cfg: ST.cfg, h24: ST.cfg.clock_24 }); }, again: function (c) { c.setCfg(ST.cfg); } };
    // THE TIMER SLIDE (phase 21, hk-saver-timers.js): over a blurred photo as Home Energy is, so its own draw
    var TM = { key: 'timer', file: 'hk-saver-timers.js', glob: 'hkSaverTimers', attr: 'tmslide', fade: '--hk-tm-fade', ctl: null, load: null, showing: false, t: null, run: 0, draw: overBackdrop,
               make: function (X) { return X.create({ h24: ST.cfg.clock_24, sample: function () { return ST.previewOn; } }); }, again: function (c) { c.setH24(ST.cfg.clock_24); } };
    var EN_MOD = { key: 'energy', file: 'hk-saver-energy.js', glob: 'hkSaverEnergy', load: null };
    function slideModule(S) {
      if (window[S.glob]) return Promise.resolve(window[S.glob]);
      if (!S.load) {
        S.load = import('/hk/modules/' + S.file).then(function () { return window[S.glob]; })
          .catch(function (e) { S.load = null; console.warn('[hk-saver] ' + S.key, e && e.message); return null; });
      }
      return S.load;
    }
    // HK Settings' preview of it holds it up (Weather's own preview frame too)
    function slidePreviewed(S) { return ST.previewOn && (ST.previewSelected === S.key || (S === WX && ST.previewWeather)); }
    // at the start: the module (and what it needs), its controller in its place, unseen, and what it shows asked for
    function slidePrep(S) {
      var run = ++S.run, hold = slidePreviewed(S), want = function () { return !!ST.cfg && (ST.cfg[S.key + '_slide'] || hold); };
      if (!want()) return;
      slideModule(S).then(function (X) { return X && X.load ? X.load().then(function (ok) { return ok ? X : null; }) : X; }).then(function (X) {
        if (!X || run !== S.run || !ST.on || !ST.root || !want()) return;
        if (!S.ctl) { S.ctl = S.make(X); ST.root.insertBefore(S.ctl.el, ST.root.querySelector('.info')); } else S.again(S.ctl);
        // (its room known before it is first drawn, unseen: ready)
        slideLayout(S);
        S.ctl.ready(clientNow());
        if (!hold) return;
        var tries = 0, show = function () {
          if (run !== S.run || !ST.on || S.showing || !slidePreviewed(S)) return;
          if (slideShow(S, true)) { Screens.extraIs(S.key); return; }
          if (++tries < 60) setTimeout(show, 500);
        };
        show();
      });
    }
    function slideReady(S) { return !!(S.ctl && S.ctl.ready(clientNow())); }
    function slideLayout(S) {
      if (!S.ctl || !ST.root || !ST.host) return;
      S.ctl.layout((window.innerWidth || 0) - (ST.paneUp ? ST.paneW : 0), window.innerHeight || 0);
    }
    function slideShow(S, first) {
      if (!ST.on || !ST.root || !ST.host || S.showing || !S.ctl) return false;
      var h = clientNow(), info = ST.root.querySelector('.info');
      if (!S.ctl.ready(h)) return false;
      if (!underCards(S.ctl.el, info)) ST.root.insertBefore(S.ctl.el, info);
      slideLayout(S);
      if (!(S.draw ? S.draw(S.ctl, h) : S.ctl.draw(h))) { S.ctl.leave(); return false; }
      S.showing = true; slideShown(S.key);
      ST.host.setAttribute(S.attr, '');
      updateBand();
      Black.forecastTick(false);                 // the forecast's own sky holds still under it
      slideLayout(S);
      var el = S.ctl.el, run = ST.photoRun;
      el.style.setProperty(S.fade, (first ? 0 : CROSSFADE_MS) + 'ms');
      void el.offsetWidth;
      el.classList.add('on');
      if (S.t) clearTimeout(S.t);
      S.t = setTimeout(function () { S.t = null; if (ST.on && run === ST.photoRun && S.showing && S.ctl) S.ctl.arrived(); }, first ? 50 : CROSSFADE_MS);
      if (first && ST.entrance) ST.entrance();
      return true;
    }
    function slideHide(S) {
      if (!S.showing) return;
      S.showing = false;
      if (S.t) { clearTimeout(S.t); S.t = null; }
      if (ST.host) ST.host.removeAttribute(S.attr);
      if (S.ctl) {
        S.ctl.el.style.setProperty(S.fade, CROSSFADE_MS + 'ms');
        S.ctl.el.classList.remove('on');
        // its sky held still, its effects stopped, once it has faded
        var c = S.ctl;
        setTimeout(function () { if (c === S.ctl && !S.showing) c.leave(); }, CROSSFADE_MS + 100);
      }
      updateBand();
      if (fcVisible()) Black.forecastTick(true);
    }
    function slideLeave(S) {
      S.run++;
      if (S.t) { clearTimeout(S.t); S.t = null; }
      S.showing = false;
      if (S.ctl) { try { S.ctl.destroy(); } catch (e) { /* gone */ } S.ctl = null; }
      if (ST.host) ST.host.removeAttribute(S.attr);
    }
    function tmWatch() {
      (ST.TW = ST.TW || timerHold({
        up: function () { return ST.on && !!ST.cfg && !ST.previewOn; }, wanted: function () { return !!ST.cfg.timer_slide; }, now: function () { return clock.now(); },
        client: clientNow, slot: TM, prep: function () { slidePrep(TM); }, night: function () { return !!(ST.host && ST.host.hasAttribute('cknight')); },
        blocked: function () { return Pane.black() || document.hidden || !!ST.pnl; }, show: function () { return slideShow(TM); },
        clear: function () {     // everything else makes way: the additional screens, the music's takeover (musicWatch waits), the photos' slides
          Screens.exCancel();
          if (ST.exKind && ST.exKind !== 'timer') Screens.exHide();
          if (ST.muShowing) Screens.hideMusicSlide();
          if (ST.enShowing) hideEnergySlide();
          slideHide(WX); slideHide(HL);
          if (ST.fcShowing && ST.mode !== 'forecast') hideForecastSlide();
        },
        hold: function () { Screens.extraIs('timer'); }, again: Screens.exArm,
        leave: function (ended) { if (ST.exKind === 'timer') { Screens.exHide(); Screens.exArm(); } else { slideHide(TM); if (ended && ST.mode === 'photos') Run.showNext(false); else Screens.exArm();
          } }
      })).watch();
    }

    // what the shell and the later parts use of this one
    K.cutsFollow = cutsFollow; K.energyLayout = energyLayout; K.energyPrep = energyPrep; K.energyReady = energyReady;
    K.enterLayout = enterLayout; K.hideEnergySlide = hideEnergySlide; K.HL = HL; K.landImg = landImg;
    K.layoutBigKind = layoutBigKind; K.layoutClient = layoutClient; K.layoutCut = layoutCut;
    K.layoutDraw = layoutDraw; K.layoutModules = layoutModules; K.layoutRoom = layoutRoom;
    K.layoutSlides = layoutSlides; K.layoutSoon = layoutSoon; K.leaveEnergy = leaveEnergy;
    K.leaveLayout = leaveLayout; K.showEnergySlide = showEnergySlide; K.skyStops = skyStops; K.slideHide = slideHide;
    K.slideLayout = slideLayout; K.slideLeave = slideLeave; K.slidePrep = slidePrep; K.slideReady = slideReady;
    K.slideShow = slideShow; K.TM = TM; K.tmWatch = tmWatch; K.WX = WX;
    // (phase 25: what the earlier parts call of this one, through its exports object Layout, made by the shell)
    var Layout = K.Layout;
    Layout.HL = HL; Layout.layoutBigKind = layoutBigKind; Layout.layoutDraw = layoutDraw;
    Layout.layoutModules = layoutModules; Layout.layoutSlides = layoutSlides; Layout.layoutSoon = layoutSoon;
    Layout.showEnergySlide = showEnergySlide; Layout.slideShow = slideShow; Layout.TM = TM; Layout.WX = WX;
  };
})();
