// hk-saver-music.js - the music slide and its panel.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-music'] = function (K) {
    var actionsNow = K.actionsNow, clearCanvas = K.clearCanvas, clientNow = K.clientNow, clock = K.clock,
        dashConf = K.dashConf, isFlat = K.isFlat, mmss = K.mmss, sendWS = K.sendWS;

    // ------------------------------------------------------------ the music
    // WHAT PLAYS, BIG (options music_slide, music_pane): the album art over a
    // blurred copy of itself, the song, the room and its volume, how far in,
    // what comes next, and previous / play-pause / next that act WITHOUT
    // closing the screensaver. A slide among the photos, taking turns with the
    // forecast; over the forecast while music plays; and in the pane down the
    // right, under the calendar when both are on. One state, drawn into each
    // view that is up: what this screen follows (hkMusic -- its focus, else
    // what started playing, its own room first), held while it is on screen.
    var MU_GRACE = 30000;        // (the default of) how long the music stays once paused or stopped
    // HIDE AFTER A PAUSE (All Screens -> Now Playing, 2026-10-15): the music
    // paused or stopped stays this long -- the pane's and the slide's alike,
    // as the dashboard's bar and pane -- and a whole one again after its
    // last use (a touch on it, its panel open: somebody picking a song)
    function muGrace() {
      var Mn = window.hkCards && window.hkCards.menu;
      return (Mn && Mn.npGrace ? Mn.npGrace() : MU_GRACE / 1000) * 1000;
    }
    // somebody using the screensaver's music (a touch on it, its panel open)
    function musicUsed() { mus.lastActive = clock.now(); mus.lostAt = 0; }
    var MU_BG = 32;              // the blurred copy, drawn this small (the CSS scales it up)
    var MU_SLOP = 14;            // a finger's slop around a button
    var mus = { key: null, views: [], tick: null, next: null, nextFor: '', year: '', lostAt: 0, watchAt: 0, watchT: null, drag: null, vol: null,
                paneIn: false, paneNext: null, lastActive: 0 };
    var ICON = { prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z', next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6z',
                 play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
                 pause: 'M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
                 note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
                 lib: 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-1-2V5h4v2z',
                 vlo: 'M7 9v6h4l5 5V4l-5 5H7z',
                 vhi: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z' };
    function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

    // the music this screen follows: the one on screen while it is still
    // playing or paused, else hkMusic's answer while it plays, else the first
    // thing playing anywhere
    function musicNow(h) {
      var M = window.hkMusic;
      if (!M || !M.contexts || !h || !h.states) return null;
      var cs = M.contexts(h), i;
      if (mus.key) for (i = 0; i < cs.length; i++) if (cs[i].key === mus.key || cs[i].members.indexOf(mus.key) >= 0) return cs[i];
      var r = M.resolve ? M.resolve(h) : null;
      if (r && r.context && r.context.playing) return r.context;
      for (i = 0; i < cs.length; i++) if (cs[i].playing) return cs[i];
      // ...else this screen's own music, PAUSED (its focus): a page loaded
      // while it is paused shows it, as it was shown before the reload -- the
      // dashboard's pane drew "Not Playing" and gave way to the bar (2026-10-15)
      if (r && r.context && r.reason === 'focus') return r.context;
      return null;
    }
    function musicPlaying() { var c = musicNow(clientNow()); return !!(c && c.playing); }
    // A self-contained preview, with no entity, queue lookup or playback action.
    var SAMPLE_ART = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#243d7e"/><stop offset=".55" stop-color="#82658e"/><stop offset="1" stop-color="#edac79"/></linearGradient></defs><path fill="url(#g)" d="M0 0h800v800H0z"/><circle cx="400" cy="400" r="245" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/><circle cx="400" cy="400" r="190" fill="none" stroke="#fff" stroke-opacity=".2"/><path d="M300 480V285l220-45v195M300 330l220-45" fill="none" stroke="#fff" stroke-width="18" stroke-linejoin="round"/><ellipse cx="268" cy="480" rx="42" ry="30" fill="#fff"/><ellipse cx="488" cy="435" rx="42" ry="30" fill="#fff"/></svg>');
    function previewMusicData() {
      return { sample: true, idle: false, key: '', members: [], room: 'Sample Room', playing: false,
        title: 'Late Light', artist: 'The Harbor Quartet', album: 'Evening Session', pic: SAMPLE_ART,
        dur: 242, pos: 83, posAt: 0, vol: .38, next: { title: 'Morning Tide', artist: 'The Harbor Quartet', image: '' } };
    }
    function musicParts(v, hide) {
      if (!v || !v.el) return;
      ['room', 'album', 'progress', 'buttons', 'volume', 'next'].forEach(function (k) { v.el.classList.toggle('h-' + k, (hide || []).indexOf(k) >= 0); });
    }
    // what a view draws: the song, or (nothing playing) the room a play would start
    function musicOf(ctx, h) {
      var M = window.hkMusic;
      if (!ctx) {
        var r = M && M.resolve && h ? M.resolve(h) : null;
        return r && r.player ? { idle: true, key: r.player, room: r.name || '' } : null;
      }
      var st = h.states[ctx.key] || {}, a = st.attributes || {};
      // entity_picture_local first: Music Assistant's entity_picture is an
      // absolute address on its own port (hk-media.js, the now-playing card)
      var pic = a.entity_picture_local || a.entity_picture || '';
      if (pic && pic.charAt(0) === '/') pic = location.origin + pic;
      // A GROUP'S VOLUME IS ITS ROOMS' (2026-11-05, the owner: the screensaver's slider moved one speaker of a group, as the
      // Side Pane's did): the slider shows their average and sets every one, as the player's and the music panel's do
      var members = Array.isArray(ctx.members) && ctx.members.length > 1 ? ctx.members.slice() : [ctx.key];
      var vols = members.map(function (k) { var x = ((h.states[k] || {}).attributes || {}).volume_level; return typeof x === 'number' ? x : null; })
        .filter(function (x) { return x !== null; });
      var vol = members.length > 1 ? (vols.length ? vols.reduce(function (n, x) { return n + x; }, 0) / vols.length : null)
        : typeof a.volume_level === 'number' ? a.volume_level : null;
      return { idle: false, key: ctx.key, members: members, room: M.label ? M.label(ctx) : ctx.key, playing: st.state === 'playing',
               title: ctx.title || a.media_title || '', artist: ctx.artist || a.media_artist || '', album: a.media_album_name || '',
               pic: pic, dur: Number(a.media_duration) || 0, pos: Number(a.media_position) || 0,
               posAt: Date.parse(a.media_position_updated_at) || 0, vol: vol };
    }
    function elapsed(d) {
      var t = d.pos + (d.playing && d.posAt ? (Date.now() - d.posAt) / 1000 : 0);
      return d.dur ? Math.min(d.dur, Math.max(0, t)) : Math.max(0, t);
    }

    // ONE VIEW: the slide (.mu) or the pane's (.pm). Two of each picture,
    // the song's and the one before, faded between -- each on a layer of its
    // own for good (will-change on the frame, not the picture: a picture let
    // go took its layer with it, and what was round it was drawn again)
    // (look 'slide': a dashboard view drawn as the slide -- the Now Playing page, hk-saver-pane.js)
    function musicView(kind, look) {
      var el = document.createElement('div'), sl = kind === 'slide' || look === 'slide';
      el.className = sl ? 'mu' : 'pm';
      el.setAttribute('idle', '');
      el.innerHTML =
        (isFlat() ? '<div class="mbgf"></div><div class="mbgf"></div>' : '<div class="mbgf"><canvas class="mbg"></canvas></div><div class="mbgf"><canvas class="mbg"></canvas></div>') + '<div class="mshade"></div>' +
        '<div class="mbody">' + (sl ? '<div class="mstage">' : '') + '<div class="mart"><div class="msq"><div class="mph">' + svg(ICON.note) + '</div>' +
        '<div class="mfr"><img alt=""></div><div class="mfr"><img alt=""></div></div></div>' +
        '<div class="mcol">' + (sl ? '<div class="mmeta">' : '') + '<div class="mroom"></div><div class="mtitle"></div><div class="martist"></div><div class="malbum"></div>' + (sl ? '<div class="mq"></div></div>' : '') +
        '<div class="mprog"><div class="mbar"><i></i></div><div class="mtimes"><span></span><span></span></div></div>' +
        '<div class="mctl"><div class="mbtn mx" data-act="spk" aria-label="Speakers"><hk-icon icon="hk:homepod"></hk-icon></div>' +
        '<div class="mbtn" data-act="prev">' + svg(ICON.prev) + '</div><div class="mbtn mpp" data-act="pp">' +
        svg(ICON.play) + '</div><div class="mbtn" data-act="next">' + svg(ICON.next) + '</div>' +
        '<div class="mbtn mx" data-act="brw" aria-label="Browse Music">' + svg(ICON.lib) + '</div>' +
        '<div class="mvol">' + svg(ICON.vlo) + '<div class="mvt"><i></i><b></b></div>' + svg(ICON.vhi) + '</div></div>' +
        '<div class="mnext"><div class="mnth">' + svg(ICON.note) + '<img alt=""></div><div class="mnx"><div class="mnl">Up Next</div><div class="mnt"></div></div></div></div>' + (sl ? '</div>' : '<div class="mq"></div>') + '</div>';
      if (!window.hkSaverPanel) el.setAttribute('nomx', '');
      var q = function (s) { return el.querySelector(s); };
      var v = { kind: kind, el: el, flat: isFlat(), flip: 0, pic: null, d: null, ready: Promise.resolve(),
                bgf: el.querySelectorAll('.mbgf'), bg: /** @type {NodeListOf<HTMLCanvasElement>} */ (el.querySelectorAll('canvas.mbg')), fr: el.querySelectorAll('.mfr'),
                room: q('.mroom'), title: q('.mtitle'), artist: q('.martist'), album: q('.malbum'),
                bar: q('.mbar i'), t0: q('.mtimes span:first-child'), t1: q('.mtimes span:last-child'),
                pp: q('.mpp path'), nextImg: q('.mnext img'), nextT: q('.mnt'), vt: q('.mvt'), mq: q('.mq') };
      v.bg.forEach(function (c) { c.width = MU_BG; c.height = MU_BG; });
      v.nextImg.onerror = function () {
        v.nextImg.style.visibility = 'hidden';
        // a signed path that errors gets one fresh signature (an HA restart
        // kills them all), as hkCards' own artwork does
        var want = v.nextWant, C = window.hkCards;
        if (want && !v.nextRetried && C && C.artUrl && v.nextImg.getAttribute('src') !== want) {
          v.nextRetried = true;
          C.artUrl(want, NEXT_ART, function (p) { if (v.nextWant === want) v.nextImg.src = p; }, true);
        }
      };
      v.nextImg.onload = function () { v.nextImg.style.visibility = ''; };
      mus.views.push(v);
      return v;
    }
    function slideView() { return mus.views.filter(function (v) { return v.kind === 'slide'; })[0] || null; }
    function musicPaneView() { return mus.views.filter(function (v) { return v.kind === 'pane'; })[0] || null; }
    function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
    function setAttr(el, k, on) { if (on) { if (!el.hasAttribute(k)) el.setAttribute(k, ''); } else if (el.hasAttribute(k)) el.removeAttribute(k); }

    // album art, loaded and decoded once for every view (the last few kept)
    var artCache = {}, artOrder = [];
    function loadArt(url) {
      if (!url) return Promise.resolve(null);
      if (artCache[url]) return artCache[url];
      artOrder.push(url);
      if (artOrder.length > 4) delete artCache[artOrder.shift()];
      artCache[url] = new Promise(function (ok) {
        var im = new Image();
        im.decoding = 'async';
        im.onload = function () { (im.decode ? im.decode().catch(function () { /* drawn anyway */ }) : Promise.resolve()).then(function () { ok(im); }); };
        im.onerror = function () { ok(null); };
        im.src = url;
      });
      return artCache[url];
    }
    // THE BLURRED COPY: the art drawn tiny, then into MU_BG square (a soft
    // blur where the canvas has a filter; the two steps soften it where it
    // has none, as WebKit), darkened for the text; CSS covers the view with it.
    // THE SLIDE'S IS BRIGHTER AND RICHER (2026-10-11, the user: "let more
    // color show"): its colors pushed apart from their gray (on the pixels --
    // 1024 of them -- as WebKit's canvas has no filter) and darkened less. The
    // pane's stays as it was: its list needs the darker ground.
    var BLUR_LOOK = { slide: { sat: 1.35, dark: 0.24 }, pane: { sat: 1, dark: 0.38 } };
    function drawBlur(c, img, kind) {
      if (isFlat()) { clearCanvas(c); return; }
      var look = BLUR_LOOK[kind] || BLUR_LOOK.pane;
      var ctx = c && c.getContext && c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      // no artwork: no picture (an old song's blur left here showed through)
      if (!img) { ctx.clearRect(0, 0, MU_BG, MU_BG); return; }
      var t = document.createElement('canvas'); t.width = 10; t.height = 10;
      var tc = t.getContext('2d');
      if (!tc) return;
      tc.imageSmoothingQuality = 'high';
      var side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
      tc.drawImage(img, ((img.naturalWidth || img.width) - side) / 2, ((img.naturalHeight || img.height) - side) / 2, side, side, 0, 0, 10, 10);
      ctx.clearRect(0, 0, MU_BG, MU_BG);
      ctx.imageSmoothingQuality = 'high';
      try { ctx.filter = 'blur(2px)'; } catch (e) { /* the upscale alone */ }
      ctx.drawImage(t, -3, -3, MU_BG + 6, MU_BG + 6);
      try { ctx.filter = 'none'; } catch (e) { /* ignore */ }
      if (look.sat !== 1 && ctx.getImageData) {
        try {
          var px = ctx.getImageData(0, 0, MU_BG, MU_BG), d = px.data, s = look.sat;
          for (var i = 0; i < d.length; i += 4) {
            var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            d[i] = l + (d[i] - l) * s; d[i + 1] = l + (d[i + 1] - l) * s; d[i + 2] = l + (d[i + 2] - l) * s;
          }
          ctx.putImageData(px, 0, 0);
        } catch (e) { /* a picture from elsewhere: as it is */ }
      }
      ctx.fillStyle = 'rgba(0,0,0,' + look.dark + ')';
      ctx.fillRect(0, 0, MU_BG, MU_BG);
    }
    // a new song's art faded in over the last one's, once decoded
    function showArt(v, url) {
      v.ready = loadArt(url).then(function (im) {
        if (v.pic !== url) return;
        var n = 1 - v.flip, fr = v.fr[n], img = fr.querySelector('img');
        var done = function () {
          if (v.pic !== url) return;
          if (!isFlat()) drawBlur(v.bg[n], im, v.kind);
          setAttr(v.el, 'noart', !im);
          // THE DASHBOARD PANE'S FIRST ART is there as it comes in, not faded
          // in over the placeholder: the pane slides in once it is ready
          // (hk-popup.js), and a fade on top of the slide read as a fade-in
          var first = v.kind === 'dash' && !v.fr[v.flip].classList.contains('on');
          if (first) { fr.style.transition = 'none'; v.bgf[n].style.transition = 'none'; }
          fr.classList.add('on'); v.bgf[n].classList.add('on');
          if (first) { void fr.offsetWidth; setTimeout(function () { fr.style.transition = ''; v.bgf[n].style.transition = ''; }, 60); }
          v.fr[v.flip].classList.remove('on'); v.bgf[v.flip].classList.remove('on');
          v.flip = n;
        };
        // no artwork: this frame's picture let go (it still held one from a
        // song before, and showed it over the placeholder)
        if (!im) { img.removeAttribute('src'); done(); return; }
        img.src = url;
        return (img.decode ? img.decode().catch(function () { /* drawn anyway */ }) : Promise.resolve()).then(done);
      });
    }
    function drawMusic(v, d) {
      var idle = !d || d.idle;
      v.d = d;
      setAttr(v.el, 'sample', !!(d && d.sample));
      // (Speakers and Browse once their panel's code is here: a view made
      // before hk-saver-panel.js loaded kept them hidden for good -- the Side
      // Pane's player without them, 2026-10-30)
      setAttr(v.el, 'nomx', !window.hkSaverPanel);
      setAttr(v.el, 'idle', idle);
      setAttr(v.el, 'none', !d);
      setText(v.room, !d ? '' : d.room);
      setAttr(v.el, 'novol', idle || d.vol === null);
      if (!idle && d.vol !== null) {
        var vv = Math.max(0, Math.min(1, d.vol)).toFixed(3);
        if (v.vt.style.getPropertyValue('--v') !== vv) v.vt.style.setProperty('--v', vv);
      }
      setText(v.title, idle ? 'Not Playing' : d.title);
      setText(v.artist, idle ? '' : d.artist);
      setText(v.album, idle ? '' : [d.album, d.sample ? '' : mus.year].filter(Boolean).join(' · '));
      /** @type {any} */ var want = idle ? ICON.play : d.playing ? ICON.pause : ICON.play;
      if (v.pp.getAttribute('d') !== want) v.pp.setAttribute('d', want);
      var pic = idle ? '' : d.pic;
      if (pic !== v.pic) { v.pic = pic; showArt(v, pic); }
      if (v.mq) drawQueueRows(v, d);
      var nx = !idle && (d.sample ? d.next : mus.next && mus.nextFor === sigOf(d) ? mus.next : null);
      // (asking: the last song's row keeps its place, unseen, until the answer)
      var wait = !nx && !idle && !!mus.nextBusy && !!v.hadNext;
      if (nx) v.hadNext = true; else if (!wait) v.hadNext = false;
      setAttr(v.el, 'nextwait', wait);
      setAttr(v.el, 'nonext', !nx && !wait);
      if (nx) {
        setText(v.nextT, nx.title + (nx.artist ? ' — ' + nx.artist : ''));
        // THROUGH THE ART PROXY (hkCards.artUrl): Music Assistant names a CDN
        // the wall tablets cannot reach -- loaded directly, the cover never
        // came and the request held a socket till the WebView gave up
        if (v.nextWant !== (nx.image || '')) {
          var want = v.nextWant = nx.image || '', C = window.hkCards;
          v.nextRetried = false;
          v.nextImg.style.visibility = 'hidden';
          if (!want) v.nextImg.removeAttribute('src');
          else if (C && C.artUrl) C.artUrl(want, NEXT_ART, function (p) { if (v.nextWant === want) v.nextImg.src = p; });
          else v.nextImg.src = want;
        }
      }
      progress(v);
    }
    var DUR_GRACE = 4000;
    var NEXT_ART = 160;          // Up Next's cover, the pixels HA scales it to (art.py)
    function progress(v) {
      var d = v.d, has = !!(d && !d.idle && d.dur);
      // A SONG'S DURATION CAN BE A MOMENT BEHIND IT: the bar keeps its place,
      // empty, for DUR_GRACE (a stream with none lets it go after that)
      if (!has && v.hadDur && d && !d.idle) {
        if (!v.durLost) v.durLost = clock.now();
        if (clock.now() - v.durLost < DUR_GRACE) {
          if (v.bar.style.transform !== 'scaleX(0)') v.bar.style.transform = 'scaleX(0)';
          setText(v.t0, ''); setText(v.t1, '');
          if (!v.durT) v.durT = setTimeout(function () { v.durT = null; progress(v); }, DUR_GRACE + 50);
          return;
        }
      }
      v.durLost = 0; v.hadDur = has;
      setAttr(v.el, 'nodur', !has);
      if (!has) return;
      var t = elapsed(d);
      var tf = 'scaleX(' + (t / d.dur).toFixed(4) + ')';
      if (v.bar.style.transform !== tf) v.bar.style.transform = tf;
      setText(v.t0, mmss(t));
      setText(v.t1, mmss(d.dur));
    }
    // UP NEXT BESIDE THE COVER (2026-11-07, the owner: the queue "just where it makes sense when there is enough
    // vertical room...like in the side pane"): the slide beside a pane (murow) lists the next songs under the song,
    // in the room the cover leaves; a tap opens the panel's Queue. One ask per song (hk_music/queue), shared by the
    // views; elsewhere the CSS hides the rows and Browse's panel has the queue.
    // (the pane's view lists more: the Side Pane's Full player, under its buttons -- 2026-11-07, the owner: "add the
    // queue to the Music Player in the side pane when Full sizing is selected")
    var MQ_ROWS = 3, MQ_MAX = 12;
    function drawQueueRows(v, d) {
      var sig = d && !d.idle && !d.sample ? sigOf(d) : '';
      if (sig && mus.qFor !== sig) {
        mus.qFor = sig; mus.q = null;
        var h = clientNow();
        if (h && h.callWS) {
          h.callWS({ type: 'hk_music/queue', entity_id: d.key, limit: MQ_MAX + 1 }).then(function (r) {
            if (mus.qFor !== sig) return;
            mus.q = r && r.ok && Array.isArray(r.items) ? r.items.slice(1, MQ_MAX + 1) : [];
            mus.views.forEach(function (w) { if (w.mq) drawQueueRows(w, w.d); });
            if (K.layoutMusic) K.layoutMusic();
            mus.views.forEach(function (w) { if (w.mq && w.kind === 'dash' && w.host && w.host._fit) w.host._fit(); });   // (the Now Playing page)
          }, function () { if (mus.qFor === sig) mus.q = []; });
        }
      }
      var pane = !v.el.classList.contains('mu');
      var items = (sig && mus.qFor === sig && mus.q ? mus.q : []).slice(0, pane ? MQ_MAX : MQ_ROWS);
      var key = items.map(function (it) { return it.id + '|' + it.title + '|' + (it.image || ''); }).join('/');
      if (pane) setAttr(v.el, 'mqon', items.length > 0);
      if (v.mqKey === key) return;
      v.mqKey = key;
      var esc = function (t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      // (Apple's covers, 1000 px, asked for at a thumbnail's size -- as nextArt does)
      var small = function (u) { return String(u).replace(/\/(\d+)x(\d+)(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/, '/160x160$3.$4'); };
      // (the heading and the first row one piece: where the pane's list has room for neither, both go -- .mq1)
      v.mq.innerHTML = !items.length ? '' : items.map(function (it, i) {
        var row = '<div class="mbtn mqr" data-act="queue" aria-label="Queue: ' + esc(it.title) + '"><span class="mqt"' +
          (it.image ? ' style="background-image:url(&quot;' + esc(small(it.image)) + '&quot;)"' : '') + '></span><span class="mqx"><b>' + esc(it.title) +
          '</b><small>' + esc(it.artist) + '</small></span></div>';
        return i ? row : '<div class="mq1"><div class="mqh">Up Next</div>' + row + '</div>';
      }).join('');
    }
    function sigOf(d) { return d && !d.idle ? d.key + '|' + d.title + '|' + d.artist : ''; }
    // (the layout's Up Next piece hears the slide's read: one ask per song, phase 13)
    function upNextPiece(d, next) {
      var M = window.hkSaverWidgets && window.hkSaverWidgets._ && window.hkSaverWidgets._.media;
      if (M && M.setNext) { try { M.setNext(d.key, next ? { title: next.title, artist: next.artist } : null, { title: d.title, artist: d.artist }); } catch (e) { /* its own read */ } }
    }
    // THE NEXT SONG'S COVER: Music Assistant looks a song up only as it starts,
    // so the queue's next song has none (seen on every queue). Its search
    // finds it: the same track (its id), else the same album, else the first.
    // Once a song, and remembered.
    var nextArtSeen = {};
    function nextArt(d, sig, mi) {
      var h = clientNow(), str = function (x) { return typeof x === 'string' ? x : ''; };
      var tail = function (u) { u = str(u); var i = u.indexOf('://'); return i >= 0 ? u.slice(i + 3) : u; };
      var id = tail(mi.uri) || (str(mi.name) + '|' + str(mi.artists && mi.artists[0] && mi.artists[0].name));
      var put = function (url) {
        if (!url || mus.nextFor !== sig || !mus.next) return;
        // Apple's covers come 1000 px square for a 50 px thumbnail (4 MB
        // decoded on a tablet): its image server makes any size asked for
        url = url.replace(/\/(\d+)x(\d+)(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/, '/160x160$3.$4');
        mus.next.image = url;
        mus.views.forEach(function (v) { drawMusic(v, v.d); });
      };
      if (nextArtSeen[id] !== undefined) { put(nextArtSeen[id]); return; }
      // the Music Assistant this player is part of (its device's entry)
      var ent = h && h.entities && h.entities[d.key], dev = ent && h.devices && h.devices[ent.device_id];
      var entry = dev && (dev.primary_config_entry || (dev.config_entries || [])[0]);
      var artist = str(mi.artists && mi.artists[0] && mi.artists[0].name);
      if (!entry || !str(mi.name)) return;
      nextArtSeen[id] = '';
      sendWS({ type: 'call_service', domain: 'music_assistant', service: 'search', return_response: true,
               service_data: { config_entry_id: entry, name: str(mi.name), artist: artist || undefined, media_type: ['track'], limit: 5 } })
        .then(function (r) {
          var ts = (r && r.response && r.response.tracks) || [];
          var album = str(mi.album && mi.album.name).toLowerCase();
          var pick = ts.filter(function (t) { return tail(t.uri) === tail(mi.uri); })[0] ||
                     ts.filter(function (t) { return album && str(t.album && t.album.name).toLowerCase() === album; })[0] || ts[0];
          var url = pick ? (str(pick.image) || str(pick.album && pick.album.image)) : '';
          nextArtSeen[id] = url;
          var keys = Object.keys(nextArtSeen);
          if (keys.length > 50) delete nextArtSeen[keys[0]];
          put(url);
        }).catch(function () { /* no search: the note stays */ });
    }
    // this dashboard's Play Music page, when it has one (as weatherPage)
    function musicPage() {
      var conf = dashConf();
      var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'playmusic'; });
      return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/playmusic' : null;
    }
    // THE VOLUME: a finger down on its track sets it there and drags it
    // (sent at most every VOL_EVERY, and once more as the finger lifts)
    var VOL_EVERY = 200;
    function volFrom(x) {
      var dr = mus.drag, r = dr && dr.view.vt.getBoundingClientRect();
      if (!r || !r.width || x == null) return;
      var val = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100;
      var d = dr.view.d;
      if (!d || d.idle) return;
      mus.vol = { key: d.key, members: d.members || [d.key], val: val, until: clock.now() + 4000,
                  sent: mus.vol && mus.vol.key === d.key ? mus.vol.sent : null };
      mus.views.forEach(function (v) { if (v.d && v.d.key === d.key) { v.d.vol = val; drawMusic(v, v.d); } });
      var now = clock.now();
      if (now - dr.sent >= VOL_EVERY) volSend(); else if (!dr.t) dr.t = setTimeout(volSend, VOL_EVERY - (now - dr.sent));
    }
    function volSend() {
      var dr = mus.drag, act = actionsNow();
      if (dr && dr.t) { clearTimeout(dr.t); dr.t = null; }
      if (!mus.vol || !act) return;
      if (dr) dr.sent = clock.now();
      if (mus.vol.sent === mus.vol.val) return;
      mus.vol.sent = mus.vol.val;
      var to = mus.vol.members && mus.vol.members.length > 1 ? mus.vol.members.slice() : mus.vol.key;   // a group: every room, one call
      try { act.callService('media_player', 'volume_set', { entity_id: to, volume_level: mus.vol.val }); } catch (e) { /* offline */ }
    }
    function volEnd() {
      var dr = mus.drag;
      if (!dr) return;
      volSend();
      if (dr.t) clearTimeout(dr.t);
      setAttr(dr.view.el, 'dragging', false);
      mus.drag = null;
      if (mus.vol) mus.vol.until = clock.now() + 4000;   // the house catching up
    }

    // ------------------------------------------------------------ the music's panel
    // SPEAKERS AND BROWSE (hk-saver-panel.js draws them; 2026-10-11). The
    // slide's art, or the whole pane, turns over and the panel is on its back:
    // Speakers (ticks and Update), Volume (each room), Browse (the house's
    // playlists and the Browse Music page, on this music's speakers). While it
    // is open the screensaver holds its slide, taps on it reach it (every other
    // tap is swallowed here), a tap anywhere else closes it -- never a wake --
    // and it closes itself PANEL_IDLE untouched, when its music goes, and a
    // moment after a request has landed.
    var PANEL_IDLE = 30000, PANEL_TURN = [300, 420];

    // The text column below the clock, the weather and the date: what does
    // not fit goes, Up Next first, then the album
    function layoutMusicView(v, host, root, scn, scale) {
      if (!v || !host || !root) return;
      host.style.setProperty('--hk-mu-z', String(scale));
      var col = v.el.querySelector('.mcol'), info = root.querySelector('.info');
      if (!col || !info || !v.el.getBoundingClientRect().width) return;
      var body = v.el.querySelector('.mbody'), area = body.getBoundingClientRect();
      col.style.removeProperty('bottom');
      var H = area.height, W = area.width, top = area.top;
      // Use the slide's available area, including the space a left or right pane
      // takes. A tablet beside a pane often needs the same stack as an upright
      // screen, with a scale suited to its shorter column.
      var beside = host.hasAttribute('pane') && !host.hasAttribute('band');
      var narrow = H > W * (beside ? 0.74 : 1.05);
      var row = beside && (narrow || v.kind === 'dash') && W >= 620 && H >= 620, up = narrow && !row;
      var zs = Math.max(0.45, row ? Math.min(1.25, W / 780, H / 820) : up ? Math.min(W / 820, H / 1180) : Math.min(W / 1280, H / 800));
      host.style.setProperty('--hk-mu-zs', String(Math.round(zs * 100) / 100));
      setAttr(host, 'muup', up);
      setAttr(host, 'murow', row);
      // (under the slide corner, its words: the old corner cards are hidden under every slide now, phase 13)
      var over = scn && host.hasAttribute('scorner') ? [].slice.call(scn.tl.children).concat([].slice.call(scn.tr.children)) : info.children;
      Array.prototype.forEach.call(over, function (c) {
        if (c.tagName === 'STYLE' || c.style.display === 'none') return;
        var r = c.getBoundingClientRect();
        if (r.height > 0 && r.top < area.top + H / 2 && r.right > area.left && r.left < area.right) top = Math.max(top, r.bottom);
      });
      var room = top + Math.round((row ? 56 : 24) * zs), m = Math.round(row ? 60 * zs : Math.min(W, H) * 0.06);
      host.style.setProperty('--hk-mu-top', (room - area.top) + 'px');
      if (row) {
        var stage = v.el.querySelector('.mstage'), pad = 56 * zs, width = W - 2 * pad;
        var height = Math.max(0, area.bottom - m - room), a = Math.min(W * 0.38, H * 0.36, width * 0.48);
        host.style.setProperty('--hk-mu-stage-x', pad + 'px');
        host.style.setProperty('--hk-mu-stage-w', width + 'px');
        host.style.setProperty('--hk-mu-stage-h', height + 'px');
        body.style.setProperty('--a', a + 'px');
        var rowOverflow = function () {
          var bottom = stage.getBoundingClientRect().bottom, excess = 0;
          // Measure the rows themselves: the volume knob intentionally reaches
          // outside its thin track and must not make otherwise fitting text vanish.
          ['.mart', '.mmeta', '.mprog', '.mctl', '.mnext'].forEach(function (sel) {
            var rect = stage.querySelector(sel).getBoundingClientRect();
            if (rect.height) excess = Math.max(excess, rect.bottom - bottom);
          });
          return excess;
        };
        // (Up Next's rows beside the cover: as many as fit its height, none when none do -- drawQueueRows)
        var qrows = v.el.querySelectorAll('.mqr'), meta = v.el.querySelector('.mmeta'), shown = qrows.length;
        Array.prototype.forEach.call(qrows, function (q) { q.style.display = ''; });
        v.mq.style.display = '';
        while (shown && meta.getBoundingClientRect().height > a + 0.5) qrows[--shown].style.display = 'none';
        if (!shown) v.mq.style.display = 'none';
        setAttr(v.el, 'mqon', shown > 0);
        for (var r2 = 0; r2 <= 2; r2++) {
          v.el.setAttribute('tight', String(r2));
          if (rowOverflow() <= 1) break;
        }
        // Very tall corner widgets leave less room. Keep the controls in view
        // while the cover and its centered text block continue sharing a row.
        var extra = rowOverflow();
        if (extra) body.style.setProperty('--a', Math.max(v.el.querySelector('.mmeta').getBoundingClientRect().height, a - extra) + 'px');
        return;
      }
      // UPRIGHT: the art under the corner, the song and its buttons under the art (an iPhone's Now Playing): what does
      // not fit goes, Up Next first, then the album, then the art smaller
      if (up) {
        body.style.removeProperty('--a');
        for (var u2 = 0; u2 <= 4; u2++) {
          v.el.setAttribute('tight', String(Math.min(2, u2)));
          if (u2 > 2) body.style.setProperty('--a', 'min(' + (84 - (u2 - 2) * 12) + 'cqw,' + (36 - (u2 - 2) * 7) + 'cqh)');
          if (col.getBoundingClientRect().bottom <= area.bottom - m) break;
        }
        return;
      }
      body.style.removeProperty('--a');
      for (var t = 0; t <= 2; t++) {
        v.el.setAttribute('tight', String(t));
        // The transport shares the cover's bottom edge. Up Next hangs below
        // that edge without moving the song and controls when it comes or goes.
        var artBottom = v.el.querySelector('.mart').getBoundingClientRect().bottom;
        var ctl = col.querySelector('.mctl').getBoundingClientRect();
        var progress = col.querySelector('.mprog').getBoundingClientRect();
        var times = col.querySelector('.mtimes').getBoundingClientRect();
        var end = ctl.height ? ctl.bottom : progress.height ? Math.max(progress.bottom, times.bottom) : col.querySelector('.mmeta').getBoundingClientRect().bottom;
        Array.prototype.forEach.call(col.querySelectorAll('.mvol svg'), function (el) {
          var r = el.getBoundingClientRect();
          if (r.height && getComputedStyle(el).visibility !== 'hidden') end = Math.max(end, r.bottom);
        });
        var tail = col.getBoundingClientRect().bottom - end;
        col.style.bottom = (area.bottom - artBottom - tail) + 'px';
        var fitted = col.getBoundingClientRect();
        if (fitted.top >= room && fitted.bottom <= area.bottom - m) break;
      }
    }

    // what the shell and the later parts use of this one
    K.drawMusic = drawMusic; K.elapsed = elapsed; K.MU_BG = MU_BG; K.MU_GRACE = MU_GRACE; K.MU_SLOP = MU_SLOP;
    K.muGrace = muGrace; K.mus = mus; K.musicNow = musicNow; K.musicOf = musicOf; K.musicPage = musicPage;
    K.musicPaneView = musicPaneView; K.musicPlaying = musicPlaying; K.musicUsed = musicUsed; K.musicView = musicView;
    K.nextArt = nextArt; K.PANEL_IDLE = PANEL_IDLE; K.PANEL_TURN = PANEL_TURN; K.progress = progress;
    K.setAttr = setAttr; K.sigOf = sigOf; K.slideView = slideView; K.upNextPiece = upNextPiece; K.volEnd = volEnd;
    K.layoutMusicView = layoutMusicView;
    K.volFrom = volFrom; K.previewMusicData = previewMusicData; K.musicParts = musicParts;
  };
})();
