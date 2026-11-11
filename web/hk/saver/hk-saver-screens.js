// hk-saver-screens.js - the additional screens.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-screens'] = function (K) {
    var actionsNow = K.actionsNow, bigWeather = K.bigWeather, buildForecast = K.buildForecast,
        clientNow = K.clientNow, energyReady = K.energyReady, EX_PREVIEW_MS = K.EX_PREVIEW_MS,
        EXTRA_ORDER = K.EXTRA_ORDER, extrasOf = K.extrasOf, go = K.go, hideEnergySlide = K.hideEnergySlide,
        hideForecastSlide = K.hideForecastSlide, HL = K.HL, mine = K.mine, reducedMotion = K.reducedMotion,
        sendWS = K.sendWS, showEnergySlide = K.showEnergySlide, slideHide = K.slideHide, slideReady = K.slideReady,
        slideShow = K.slideShow, ST = K.ST, timedTurn = K.timedTurn, TM = K.TM, updateBand = K.updateBand,
        whoMsg = K.whoMsg, WX = K.WX;

    var black, clock, dashLive, dashOutside, drawMusic, elapsed, forecastTick, hostOf, layoutMusicView, muGrace, mus,
        musicIn, musicNow, musicOf, musicPage, musicPaneView, musicParts, musicPlaying, musicUsed, musicView, nextArt,
        PANEL_IDLE, PANEL_TURN, paneStack, previewMusicData, progress, queueRowAt, reveal, rootOf, scaleOf, schedule,
        setAttr, showNext, sigOf, slideView, stop, upNextPiece, volFrom;
    // (of later parts, used when called: bound once every part has run, runParts)
    K.ahead.push(function () {
      black = K.black; clock = K.clock; dashLive = K.dashLive; dashOutside = K.dashOutside; drawMusic = K.drawMusic;
      elapsed = K.elapsed; forecastTick = K.forecastTick; hostOf = K.hostOf; layoutMusicView = K.layoutMusicView;
      muGrace = K.muGrace; mus = K.mus; musicIn = K.musicIn; musicNow = K.musicNow; musicOf = K.musicOf;
      musicPage = K.musicPage; musicPaneView = K.musicPaneView; musicParts = K.musicParts;
      musicPlaying = K.musicPlaying; musicUsed = K.musicUsed; musicView = K.musicView; nextArt = K.nextArt;
      PANEL_IDLE = K.PANEL_IDLE; PANEL_TURN = K.PANEL_TURN; paneStack = K.paneStack;
      previewMusicData = K.previewMusicData; progress = K.progress; queueRowAt = K.queueRowAt; reveal = K.reveal;
      rootOf = K.rootOf; scaleOf = K.scaleOf; schedule = K.schedule; setAttr = K.setAttr; showNext = K.showNext;
      sigOf = K.sigOf; slideView = K.slideView; stop = K.stop; upNextPiece = K.upNextPiece; volFrom = K.volFrom;
    });

    function exArm() {
      if (ST.exT) { clearTimeout(ST.exT); ST.exT = null; }
      if (!ST.on || !ST.cfg || ST.previewOn || !extrasOf(ST.cfg).length) return;
      var run = ST.photoRun, wait = ST.cfg.extra_every * 60000;
      if (ST.previewOn) wait = Math.min(wait, EX_PREVIEW_MS);
      ST.exT = setTimeout(function () { ST.exT = null; if (ST.on && run === ST.photoRun) exNext(); }, wait);
    }
    function exNext() {
      var run = ST.photoRun;
      var held = document.hidden || ST.pnl || black() || ST.exKind || (ST.host && ST.host.hasAttribute('cknight')) || (ST.muShowing && takeover());
      if (ST.exLast && ST.exLast !== 'timer') ST.exBefore = ST.exLast;
      var kind = held ? null : timedTurn(ST.cfg, EXTRA_ORDER, extrasOf(ST.cfg).filter(function (k) {
        return k === 'music' ? musicPlaying() : k === 'energy' ? energyReady() : k === 'weather' ? slideReady(WX) : k === 'holiday' ? slideReady(HL) : k === 'timer' ? slideReady(TM) : true;
      }), ST.exLast, ST.exBefore);
      if (kind && exShow(kind)) {
        ST.exT = setTimeout(function () { ST.exT = null; if (ST.on && run === ST.photoRun) { exHide(); exArm(); } }, ST.cfg.extra_for * 1000);
        return;
      }
      exArm();
    }
    function exShow(kind) {
      var ok = kind === 'energy' ? showEnergySlide() : kind === 'weather' ? slideShow(WX) : kind === 'holiday' ? slideShow(HL) : kind === 'timer' ? slideShow(TM) : kind === 'music' ?
        showMusicSlide() : kind === 'forecast' ? showForecastExtra() : false;
      if (ok) { ST.exKind = kind; ST.exLast = kind; }
      return ok;
    }
    function exHide() {
      var kind = ST.exKind;
      ST.exKind = '';
      if (kind === 'energy') hideEnergySlide();
      else if (kind === 'weather' || kind === 'holiday' || kind === 'timer') slideHide(kind === 'weather' ? WX : kind === 'timer' ? TM : HL);
      else if (kind === 'music') { if (ST.muShowing && !takeover()) hideMusicSlide(); else return; }
      else if (kind === 'forecast') hideForecastExtra();
      else return;
      // the photos behind the clock: their layer was emptied as the screen
      // came over it, so the next photo comes in
      if (kind !== 'energy' && kind !== 'weather' && kind !== 'holiday' && kind !== 'timer' && ST.mode === 'photos') showNext(false);
    }
    // THE FORECAST AS AN ADDITIONAL SCREEN (Show: Clock): under a clock's own
    // background it is put there at once and the clock fades off it; over
    // the photos it fades in as the forecast slide does
    function showForecastExtra() {
      if (!ST.on || !ST.root || !ST.host || ST.mode === 'forecast') return false;
      var gen = ST.mode === 'clock';
      buildForecast();
      bigWeather();
      if (ST.exOutT) { clearTimeout(ST.exOutT); ST.exOutT = null; }
      ST.host.removeAttribute('fcout');
      ST.fcShowing = true;
      ST.host.setAttribute('fcslide', '');
      updateBand();
      forecastTick(true);
      reveal(ST.root.querySelector('.fc'), gen);
      return true;
    }
    function hideForecastExtra() {
      if (!ST.fcShowing) return;
      // (under a clock's own background the forecast stays drawn until the
      // clock has faded back over it: [fcout], set by hideForecastSlide)
      hideForecastSlide();
    }
    function leaveExtras() {
      if (ST.exT) { clearTimeout(ST.exT); ST.exT = null; }
      if (ST.exOutT) { clearTimeout(ST.exOutT); ST.exOutT = null; }
      ST.exKind = ''; ST.exLast = '';
      if (ST.host) ST.host.removeAttribute('fcout');
    }

    function dropView(v) {
      if (!v) return;
      if (ST.pnl && ST.pnl.view === v) closePanel(false);
      mus.views = mus.views.filter(function (x) { return x !== v; });
      if (v.el.parentNode) v.el.remove();
      musicTick();
    }

    // ONCE A SECOND, only while a view on screen shows music playing
    function musicTick() {
      var any = !document.hidden && mus.views.some(function (v) {
        if (v.kind === 'dash') return v.live && v.el.isConnected && v.d && !v.d.idle && v.d.playing;
        return ST.on && v.el.isConnected && (v.kind === 'pane' ? mus.paneIn : ST.muShowing) && v.d && !v.d.idle && v.d.playing;
      });
      if (any && !mus.tick) mus.tick = setInterval(function () { mus.views.forEach(progress); musicTick(); }, 1000);
      else if (!any && mus.tick) { clearInterval(mus.tick); mus.tick = null; }
    }
    // Everything again from the house: what plays, into each view
    function renderMusic() {
      var h = clientNow();
      if ((!ST.on && !dashLive()) || !h) return null;
      var ctx = musicNow(h), now = clock.now();
      if (ST.previewOn && ST.previewSelected === 'music' && !(ctx && ctx.playing)) {
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
      if (ST.pnl) { if (!ctx && !(d && !d.idle)) closePanel(true); else ST.pnl.p.update(); }
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
        if (ST.muShowing) layoutMusic();
        paneStack();
        if (mus.next && !mus.next.image && mi) nextArt(d, sig, mi);
      }).catch(function () {
        // not Music Assistant: no Up Next (its place let go)
        if (mus.nextFor !== sig) return;
        mus.nextBusy = false;
        upNextPiece(d, null);
        mus.views.forEach(function (v) { drawMusic(v, v.d); });
        if (ST.muShowing) layoutMusic();
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
        if (n === ST.host) break;
      }
      return true;
    }
    function musicHit(x, y) {
      if (x == null || y == null) return null;
      for (var i = 0; i < mus.views.length; i++) {
        var v = mus.views[i];
        // (the dashboard's pane takes its own taps -- and lies under this)
        if (v.kind === 'dash' || !v.el.isConnected || (v.kind === 'slide' && !ST.muShowing) || !seen(v.el)) continue;
        // THE STRIP'S CONTROLS BY THEIR OWN BOXES (hk-np-strip.js; 2026-11-09, the owner: a tap meant for play landed on
        // the volume) -- no slop round them, which reached 28 px over the room between the transport and the volume
        var sh = window.hkNpStrip.hitAt(v.el, x, y);   // (and the speaker line over the title, its 44 px touch area)
        if (sh) return sh.act !== 'vol' ? { btn: sh.el, view: v } : v.el.hasAttribute('novol') ? null : { vol: true, view: v };
        // (Up Next's rows by their own boxes, as far as the scrolling list shows them: hk-saver-music.js)
        var qb = queueRowAt(v.el, x, y);
        if (qb) return { btn: qb, view: v };
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
      ST.pressStop = true;
      stop('touch');
      if (page) go(page);
    }
    function volStart(hit, x) {
      mus.drag = { view: hit.view, sent: 0, t: null };
      mus.key = hit.view.d && hit.view.d.key; mus.lostAt = 0;
      setAttr(hit.view.el, 'dragging', true);
      volFrom(x);
      if (ST.muShowing && ST.mode === 'photos') schedule();
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
      if (ST.muShowing && ST.mode === 'photos') schedule();
    }
    function panelFor(v, tab) {
      var P = window.hkSaverPanel, proot = rootOf(v);
      if (!P || !proot || !v || !v.el.isConnected) return;
      if (ST.pnl && ST.pnl.view === v) {
        if (ST.pnl.p.tab() === tab) closePanel(true); else { ST.pnl.p.show(tab); panelButtons(); panelTouched(); }
        return;
      }
      if (ST.pnl) closePanel(false);
      if (!proot.querySelector('style.mpcss')) {
        var HC = window.hkCards;
        var st = document.createElement('style'); st.className = 'mpcss';
        st.textContent = P.CSS + (HC && HC.shadeCss ? '\n' + HC.shadeCss('.mpanel') : ''); proot.appendChild(st);
      }
      var me = { view: v, idleT: null, doneT: null, anim: null,
                 src: v.kind === 'pane' ? ST.paneEl : v.kind === 'dash' ? v.box : v.el.querySelector('.msq') };
      me.p = P.create({
        client: clientNow,             // its reads, and its buttons through client.actions
        ctx: function () { return musicNow(clientNow()); },
        art: function () { return (v.bg && v.bg[v.flip]) || (v.flat && v.fr[v.flip] && v.fr[v.flip].querySelector('img')) || null; },   // (Flat: the cover)
        // the music moved (Update, a new leader): the screensaver follows it
        follow: function (key) { if (key) { mus.key = key; mus.lostAt = 0; renderMusic(); } },
        done: function (ms) {
          if (ST.pnl !== me) return;
          if (me.doneT) clearTimeout(me.doneT);
          me.doneT = setTimeout(function () { me.doneT = null; if (ST.pnl === me) closePanel(true); }, ms || 0);
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
      ST.pnl = me;
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
      if (!ST.pnl || !hostOf(ST.pnl.view)) return;
      var v = ST.pnl.view, el = ST.pnl.p.el, z = v.kind === 'dash' ? v.z || 1 : scaleOf(), b, off = { x: 0, y: 0 };
      if (v.kind === 'pane' || v.kind === 'dash') {
        var r = (v.kind === 'dash' ? v.box : ST.paneEl).getBoundingClientRect();
        b = { x: r.left, y: r.top, w: r.width, h: r.height };
        // (the dashboard's card is the panel's box: placed in it, not the screen)
        if (v.kind === 'dash') { var hr = v.host.getBoundingClientRect(); off = { x: hr.left, y: hr.top }; }
      } else {
        var area = v.el.querySelector('.mbody').getBoundingClientRect(), col = v.el.querySelector('.mcol').getBoundingClientRect();
        var art = v.el.querySelector('.mart').getBoundingClientRect(), H0 = window.innerHeight || area.height;
        var lower = ST.host.hasAttribute('murow') || ST.host.hasAttribute('muup');
        var lo = (lower ? area.left : col.right) + 24 * z, hi = area.right - 24 * z;
        var w = Math.max(280 * z, Math.min(566 * z, hi - lo));
        var cx = Math.max(lo + w / 2, Math.min(hi - w / 2, art.left + art.width / 2));
        var top = (ST.paneUp ? 40 : 100) * z, bot = H0 - 36 * z;
        if (bot - top < 300 * z) top = Math.max(12 * z, bot - 300 * z);     // the keyboard up: as tall as there is
        var h = Math.min(660 * z, bot - top);
        var cy = Math.max(top + h / 2, Math.min(bot - h / 2, art.top + art.height / 2));
        b = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
      }
      ST.pnl.box = b;
      ST.pnl.wide = b.w >= 500 * z;
      // A SHORT SCREEN (a tablet's keyboard up for the search): the panel
      // alone over the art -- the song's column and the clock would only be
      // squeezed under it -- and the field kept in sight
      var kb = (window.innerHeight || 800) < 560 * z;
      setAttr(hostOf(v), 'mpkb', kb);
      if (kb || ST.pnl.kb) ST.pnl.p.reveal();
      ST.pnl.kb = kb;
      el.style.left = Math.round(b.x - off.x) + 'px'; el.style.top = Math.round(b.y - off.y) + 'px';
      el.style.width = Math.round(b.w) + 'px'; el.style.height = Math.round(b.h) + 'px';
      ST.pnl.p.size(b.w, b.h, z);
    }
    // THE TURN: the art (or the pane) to edge-on as it grows toward the
    // panel's box, then the panel from edge-on to flat. Transforms only.
    function turnPanel(opening, done, rec) {
      var me = rec || ST.pnl, el = me.p.el, src = me.src, B = me.box;
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
      var hide = function (hiding) {
        src.style.visibility = hiding ? 'hidden' : '';
        if (me.view.kind !== 'slide') setAttr(hostOf(me.view), 'mpp', hiding);
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
      var me = ST.pnl;
      if (!me) return;
      ST.pnl = null;
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
      if (animated && (ST.on || me.view.kind === 'dash') && me.src && me.src.isConnected && me.view.el.isConnected) turnPanel(false, finish, me);
      else { if (me.anim) { try { me.anim.cancel(); } catch (e) { /* done */ } } finish(); }
      // the slide's turn among the photos starts again now
      if (ST.on && ST.muShowing && ST.mode === 'photos') schedule();
    }
    // a touch on it: not closed for PANEL_IDLE more, and the house told
    function panelTouched() {
      var me = ST.pnl;
      if (!me) return;
      if (me.view.kind !== 'dash') { saverTouched(); musicUsed(); }
      if (me.idleT) clearTimeout(me.idleT);
      var check = function () {
        me.idleT = null;
        if (ST.pnl !== me) return;
        if (me.p.busy()) { me.idleT = setTimeout(check, 5000); return; }
        closePanel(true);
      };
      me.idleT = setTimeout(check, PANEL_IDLE);
    }
    function panelButtons() {
      mus.views.forEach(function (v) {
        Array.prototype.forEach.call(v.el.querySelectorAll('.mbtn.mx,.hksl'), function (b) {
          var tab = { spk: 'speakers', queue: 'queue' }[b.getAttribute('data-act')] || 'browse';
          b.classList.toggle('on', !!ST.pnl && ST.pnl.view === v && ST.pnl.p.tab() === tab);
        });
      });
    }
    function inPanel(e) {
      if (!ST.pnl) return false;
      var path = e.composedPath ? e.composedPath() : [];
      return path.indexOf(ST.pnl.p.el) >= 0;
    }
    function saverTouched() {
      if (!ST.cfg || !ST.cfg.entity || !/^switch\./.test(ST.cfg.entity)) return;
      if (!mine() || ST.force || /[?&]hk_saver=force\b/.test(location.search)) return;
      var now = Date.now();
      if (now - ST.saverSent < 3000) return;
      ST.saverSent = now;
      sendWS(whoMsg({ type: 'hk_frontend/screensaver/touch', saver: true })).catch(function () { /* older integration */ });
    }

    // THE SLIDE: built the first time, then kept like the forecast's layer
    function buildMusicSlide() {
      var v = slideView();
      if (v && v.el.isConnected) return v;
      if (v) dropView(v);
      if (!ST.root) return null;
      v = musicView('slide');
      ST.root.insertBefore(v.el, ST.root.querySelector('.info'));
      return v;
    }
    // false: nothing plays (nothing shown). first: the screensaver's first view
    function showMusicSlide(first) {
      if (!ST.on || !ST.root || !ST.host || ST.muShowing) return ST.muShowing;
      var ctx = musicNow(clientNow());
      if ((!ctx || !ctx.playing) && !(ST.previewOn && ST.previewSelected === 'music')) return false;
      var v = buildMusicSlide(), run = ST.photoRun;
      // (Home Energy over everything: the music in its place)
      if (ST.enShowing) { hideEnergySlide(); if (ST.exKind === 'energy') ST.exKind = ''; }
      [WX, HL, TM].forEach(function (S) { if (S.showing) { slideHide(S); if (ST.exKind === S.key) ST.exKind = ''; } });
      ST.muShowing = true; ST.sinceFc = 0; ST.lastSlide = 'music'; mus.lostAt = 0;
      musicParts(v, ST.cfg.music_hide);
      renderMusic();
      ST.host.setAttribute('muslide', '');
      updateBand();
      forecastTick(false);                 // the forecast's sky holds still under it
      layoutMusic();
      // IN ONCE ITS ART IS DECODED (never more than a moment): faded in on
      // the placeholder, the cover popped in halfway through
      var go = false, reveal1 = function () {
        if (go) return; go = true;
        if (!(ST.on && ST.muShowing && run === ST.photoRun && v.el.isConnected)) return;
        reveal(v.el, !!first);
        if (first && ST.entrance) ST.entrance();
      };
      v.ready.then(function () { requestAnimationFrame(reveal1); });
      setTimeout(reveal1, 1500);
      return true;
    }
    function hideMusicSlide() {
      if (!ST.muShowing) return;
      if (ST.pnl && ST.pnl.view.kind === 'slide') closePanel(false);
      ST.muShowing = false;
      mus.lostAt = 0;
      if (ST.host) ST.host.removeAttribute('muslide');
      if (!musicPaneView()) mus.key = null;
      updateBand();
      musicTick();
      // over the forecast: back to it
      if (ST.mode === 'forecast' && ST.root && ST.root.querySelector('.fc')) { reveal(ST.root.querySelector('.fc'), false); forecastTick(true); }
    }
    // The music module lays out the current view with the shell's live frame.
    function layoutMusic() {
      if (!ST.host || !ST.root) return;
      layoutMusicView(slideView(), ST.host, ST.root, ST.scn, scaleOf());
    }
    // OVER THE FORECAST, the house decides: the slide while music plays, the
    // forecast again MU_GRACE after it stops. Every view follows the house.
    // At most once a second (a new client comes many times a second).
    // THE MUSIC TAKES THE SCREEN while it plays: Music First, or (as before
    // Music First) the music over the forecast
    function takeover() { return !ST.previewOn && !!ST.cfg && (ST.cfg.music_first || (ST.cfg.music_slide && ST.mode !== 'photos')); }
    function musicWatch() {
      if (!ST.on || !ST.cfg || !ST.root || !(ST.cfg.music_slide || ST.cfg.music_pane || ST.cfg.music_first || (ST.cfg.extra_music && ST.muShowing))) return;
      var now = clock.now();
      if (now - mus.watchAt < 1000) {
        if (!mus.watchT) mus.watchT = setTimeout(function () { mus.watchT = null; musicWatch(); }, 1000 - (now - mus.watchAt));
        return;
      }
      mus.watchAt = now;
      var ctx = mus.views.length ? renderMusic() : musicNow(clientNow());
      // the pane's music: while something plays, or its panel is open, and the
      // grace after (paused music goes too, once the grace is up)
      var g = muGrace(), inUse = !!ST.pnl && ST.pnl.view.kind !== 'dash';
      if ((ctx && ctx.playing) || inUse) mus.lastActive = now;
      if (ST.cfg.music_pane) musicIn(now - mus.lastActive < g);
      // (looked at again as the grace runs out: a paused house sends nothing)
      if (mus.lastActive && now - mus.lastActive < g) {
        clearTimeout(mus.graceT);
        mus.graceT = setTimeout(function () { mus.watchAt = 0; musicWatch(); }, g - (now - mus.lastActive) + 100);
      }
      if (!takeover()) return;
      if (!ST.muShowing) { if (ctx && ctx.playing && !(ST.TW && ST.TW.held())) showMusicSlide(); return; }
      if ((ctx && ctx.playing) || inUse) mus.lostAt = 0;
      else if (!mus.lostAt) mus.lostAt = Math.max(now, mus.lastActive);
      else if (now - Math.max(mus.lostAt, mus.lastActive) > g) {
        // back to the forecast, or to the photos (the next one takes the music away)
        mus.lostAt = 0;
        if (ST.mode !== 'photos') hideMusicSlide(); else showNext(false);
      }
    }
    // the pane's music, there or not
    function musicPane(want) {
      var v = musicPaneView();
      if (!want) { if (v) dropView(v); return; }
      if (v && v.el.parentNode === ST.paneEl) return;
      if (v) dropView(v);
      if (!ST.paneEl || !ST.host) return;
      ST.host.style.setProperty('--hk-mu-z', String(scaleOf()));
      v = musicView('pane');
      ST.paneEl.appendChild(v.el);
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
      ST.muShowing = false; ST.lastSlide = '';
      if (ST.host) ST.host.removeAttribute('muslide');
    }

    // what the shell and the later parts use of this one
    K.closePanel = closePanel; K.dropView = dropView; K.exArm = exArm; K.exHide = exHide; K.exNext = exNext;
    K.hideForecastExtra = hideForecastExtra; K.hideMusicSlide = hideMusicSlide; K.inPanel = inPanel;
    K.layoutMusic = layoutMusic; K.leaveExtras = leaveExtras; K.leaveMusic = leaveMusic; K.musicAct = musicAct;
    K.musicHit = musicHit; K.musicPane = musicPane; K.musicTick = musicTick; K.musicWatch = musicWatch;
    K.panelFor = panelFor; K.panelTouched = panelTouched; K.placePanel = placePanel; K.renderMusic = renderMusic;
    K.saverTouched = saverTouched; K.showForecastExtra = showForecastExtra; K.showMusicSlide = showMusicSlide;
    K.takeover = takeover;
  };
})();
