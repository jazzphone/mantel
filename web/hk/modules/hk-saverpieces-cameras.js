// hk-saverpieces-cameras.js -- THE SCREENSAVER'S CAMERA PIECES (2026-11-02, phase 13 / 1b, wave B; docs/phase13/GLANCE-SPEC.md,
// "Cameras"): Camera (a camera's still) and Last Ring (the doorbell). One group, one file, loaded after hk-saverwidgets.js, which
// draws them: each piece is declared once (the plan's rule 1) with hkSaverWidgets.define() and drawn with the renderer's classes
// and helpers. The few rules this group needs go into the renderer's one sheet (hkSaverWidgets.addCss), in `--u`, on the
// spacing scale (.4 .8 1.2 1.6 2.4 3.2).
//
//   camera  rectangular, card   opts.camera (a camera entity; the default is the first in Settings' cameras.order that the house
//                               has, else the first camera.* alphabetically): its still as an <img> (object-fit: cover), its
//                               name in a small label on a soft dark gradient at the bottom left, 1.2 u in (opts.label: show it,
//                               custom -- opts.name's words -- or hide it, label and gradient both). A camera with no
//                               still (restored, stale, unavailable, none yet) is a dark placeholder with a camera glyph and the
//                               name. NEVER a live stream: a still, every ten seconds, while it is shown.
//   ring    inline, card        for 30 minutes after a doorbell event (window event hk-house-event, kind doorbell). Inline
//                               "Doorbell 4:02 PM" with a bell; card the ring's snapshot (signed, hk_notify/snap/sign, as the
//                               banner signs it) or, with none, the doorbell camera's still, with "Doorbell rang at 4:02 PM"
//                               under it.
//
// BOTH ARE OFF UNTIL PLACED (SCREENSAVER-UNIFIED.md decision 7: a screensaver is seen by anyone walking by): `off: true` in the
// declaration, so the editor never adds either by itself. Rule 6.
//
// THE STILL (hk-sidepane.js _cams and cards/hk-cameras.js _srcFor are the model; the address is built the same way):
//   * the entity's own `attributes.entity_picture`, read fresh each time (HA rotates its token), skipping a state that is
//     `restored`, stale (hkCards.stale) or unavailable;
//   * `_hk=<n>` a counter per camera (not the clock: two requests in one millisecond are two addresses), then `width=480&height=270`.
//     the house's still route answers ONLY width, height, v and _hk; anything else is a 400, and no size is the camera's whole 4K
//     frame (1.8 MB);
//   * a new still is loaded OFF screen (new Image) and put in, in place, only once it has a picture (naturalWidth): no flicker, no
//     broken image; at most every nine seconds; a picture that failed is not asked for again with the same address for a minute
//     (an HA restart brings the socket back long before Protect has its cameras, and every ask is logged and counted).
//
// THE ONE REFRESH TIMER (rule 3, one read per source; the renderer calls update() on the minute and on house changes, so a
// timer per piece would be N timers): ONE module-level setInterval (ten seconds) shared by every camera piece. It is
//   started when a camera piece updates and has a still to want, and
//   stopped when none is alive (destroy) or none has one to want (syncTimer() after every update and every destroy).
// Each tick GUARDS itself before it asks for anything: the page must be visible (document.visibilityState), and a camera is
// asked for only if one of its pieces is SHOWN (connected, not display:none or visibility:hidden, has a box). Two pieces on one
// camera ask once. A piece that hides (the plan hides a claimed or gone one) or a page in the background costs a no-op tick.
// The renderer has no create/destroy hook yet, so this file wraps hkSaverWidgets.create() for these two pieces only, to know
// which are alive and to put a new still into their <img> in place; nothing about the renderer is changed.
//
// THE RING: one module-level listener for hk-house-event from the moment this file loads (a ring before that is not seen). It
// keeps the latest ring { at, camera, snap } and WAKES the ring pieces a moment later (one coalesced setTimeout, never from inside
// a read: the 0.1.104 freeze); the minute's update ends the thirty minutes. The snapshot is signed once per snap, from the
// piece's read but deferred, cached eight minutes (the banner's own), used no longer than nine minutes after the ring (the file is
// kept ten); until it is signed the card is the placeholder, and if it cannot be signed or loaded the card falls back to the
// camera's still.
//
// THE RULES (SCREENSAVER-UNIFIED.md): nothing animates and nothing blurs (no backdrop filter); the screen's role decides the data
// (a camera the wall tablet may not read has no state: a placeholder, never an error); a missing state is not "nothing wrong".
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._ || !W.create) return;
  if (W._.cameras) return;                                      // loaded twice
  var H = W._;
  var esc = H.esc, inl = H.inl, tm = H.tm, ACC = H.ACC;

  var GROUP = 'Cameras';
  var REFRESH_MS = 10000;                                       // the still, while it is shown (the side pane's)
  var MIN_GAP = 9000;                                           // a still is not asked for more often (the side pane's)
  var BAD_MS = 60000;                                           // a picture that failed is not asked for again with the same address
  var LOST_MS = 30000;                                          // a picture that neither loads nor fails is given up
  var RING_MS = 1800000;                                        // a ring shows for thirty minutes
  var SIGN_KEEP = 480000;                                       // a signed snapshot address is kept eight minutes (hk-notify.js SIGN_KEEP_MS)
  var SNAP_KEEP = 540000;                                       // the snapshot file is kept ten; used for nine
  var AMBER = ACC.amber;                                        // Last Ring's accent

  // ------------------------------------------------------------ the look this group adds
  var CSS = [
    // the image box: a dark ground (the placeholder), the camera glyph on it, the still over it, the name over that
    '.hksw .cam{position:relative;display:block;flex:1;align-self:stretch;min-width:0;overflow:hidden;color:#fff;background:#1c1e24;text-shadow:none}',
    '.hksw .cam-ph{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:.5}',
    '.hksw .cam-ph svg{width:calc(var(--u) * 5);height:calc(var(--u) * 5)}',
    '.hksw .cam-img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}',
    '.hksw .cam-img:not([src]){display:none}',
    // the name: 1.2 u in from the bottom-left corner, on a soft dark gradient that fades toward the top right
    '.hksw .cam-g{position:absolute;left:0;bottom:0;width:80%;height:calc(var(--u) * 8);pointer-events:none;background:linear-gradient(to top right,rgba(0,0,0,.6),rgba(0,0,0,0) 75%)}',
    '.hksw .cam-n{position:absolute;left:calc(var(--u) * 1.2);bottom:calc(var(--u) * 1.2);max-width:calc(100% - var(--u) * 2.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:calc(var(--u) * 2);line-height:1.2;font-weight:600;letter-spacing:.01em;text-shadow:0 1px 4px rgba(0,0,0,.5)}',
    // rectangular: the still to the edge (the renderer's 29 x 13 u, its 2.2 u radius and its clip)
    '.hksw.k-rectangular.p-camera{padding:0}',
    // card: 30 u wide and 16.8 u of picture (the still is 16:9); the ring's card is as wide as its words, 30 u at least, with its
    // line under the picture 1.6 u from the picture and from the bottom, 2 u from the sides
    '.hksw.k-card.p-camera{padding:0;width:calc(var(--u) * 30)}',
    '.hksw.k-card.p-camera .cam, .hksw.k-card.p-ring .cam{flex:none;height:calc(var(--u) * 16.8)}',
    '.hksw.k-card.p-ring{padding:0;min-width:calc(var(--u) * 30)}',
    '.hksw .rgc{display:flex;align-items:center;min-width:0;padding:calc(var(--u) * 1.6) calc(var(--u) * 2);font-size:calc(var(--u) * 2.2);line-height:1.35;font-weight:600;white-space:nowrap}',
    '.hksw .rgc > span{min-width:0;overflow:hidden;text-overflow:ellipsis}'
  ].join('\n');
  if (W.addCss) W.addCss(CSS);

  // ------------------------------------------------------------ glyphs (ours: a video camera, a bell)
  var CAM_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M4.5 7h9A2.5 2.5 0 0 1 16 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 2 14.5v-5A2.5 2.5 0 0 1 4.5 7z"/><path d="M17.5 10.4 22 8v8l-4.5-2.4z"/></svg>';
  var BELL = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 3a1.4 1.4 0 0 1 1.4 1.4v.5a5.6 5.6 0 0 1 4.2 5.5v3.3l1.7 2.4a.9.9 0 0 1-.7 1.4H5.4a.9.9 0 0 1-.7-1.4l1.7-2.4v-3.3a5.6 5.6 0 0 1 4.2-5.5v-.5A1.4 1.4 0 0 1 12 3z"/><path d="M9.6 19h4.8a2.4 2.4 0 0 1-4.8 0z"/></svg>';

  // ------------------------------------------------------------ small helpers
  function defer(f) { return setTimeout(f, 0); }
  function hidden() {
    try { return document.visibilityState === 'hidden' || document.hidden === true; } catch (e) { return false; }
  }
  // a camera's name: its own, else the entity id in words ("camera.front_door" -> "Front Door")
  function nameOf(id, st) {
    var n = st && st.attributes && st.attributes.friendly_name;
    if (typeof n === 'string' && n.trim()) return n.trim();
    var s = String(id || '').replace(/^camera\./, '').replace(/_/g, ' ').trim();
    return s ? s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) : 'Camera';
  }
  // the camera to show: the piece's own pick, else the first of Settings' cameras.order the house has, else the first camera.*
  // alphabetically, else the first of the order (a camera this screen may not read: a placeholder)
  function pickCamera(X) {
    if (X.opts && X.opts.camera) return X.opts.camera;
    var HS = window.hkSettings, order = [], st = X.st || {};
    try { order = HS && typeof HS.get === 'function' ? HS.get('cameras.order', []) : []; } catch (e) { order = []; }
    if (!Array.isArray(order)) order = [];
    order = order.filter(function (id) { return typeof id === 'string' && id.indexOf('camera.') === 0; });
    for (var i = 0; i < order.length; i++) if (st[order[i]]) return order[i];
    var all = Object.keys(st).filter(function (k) { return k.indexOf('camera.') === 0; }).sort();
    return all[0] || order[0] || '';
  }
  // the picture to ask for: the entity's entity_picture, unless the state is restored, stale or unavailable (hk-sidepane.js _cams)
  function picOf(st) {
    var a = st && st.attributes, HC = window.hkCards;
    if (!a || a.restored || st.state === 'unavailable') return null;
    try { if (HC && HC.stale && HC.stale(st)) return null; } catch (e) { /* not stale if it cannot say */ }
    return typeof a.entity_picture === 'string' && a.entity_picture ? a.entity_picture : null;
  }
  // THE STILL'S ADDRESS, as the side pane builds it: the picture, `_hk=<n>` (a counter, so two asks are two addresses), and the
  // size the blocks ask (480 x 270: one tier; without a size it is the camera's whole frame). Only width, height, v and _hk
  // are answered; anything else is a 400
  function stillUrl(pic, n) { return pic + (pic.indexOf('?') < 0 ? '?' : '&') + '_hk=' + n + '&width=480&height=270'; }

  // ------------------------------------------------------------ the stills, one per camera for every piece
  //   { at: when it was last asked for, n: the counter, url: the last that loaded, busy, bad: a picture that failed, badAt }
  var STILLS = {};
  function stillOf(id) { return STILLS[id] || (STILLS[id] = { at: 0, n: 0, url: '', busy: false, bad: '', badAt: 0 }); }
  // the address an <img> starts with, by its key: 'cam:<entity>' the last still that loaded, 'snap:<snap>' the signed snapshot
  function urlFor(k) {
    if (!k) return '';
    if (k.indexOf('cam:') === 0) return (STILLS[k.slice(4)] || {}).url || '';
    if (k.indexOf('snap:') === 0) return (SNAPS[k.slice(5)] || {}).url || '';
    return '';
  }
  // PUT A NEW PICTURE INTO THE <img>s THAT SHOW IT, in place (the pieces are not drawn again: their spec has not changed)
  function place(k, url) {
    ENT.forEach(function (e) {
      var el = e.api && e.api.el, imgs;
      if (e.dead || !el || typeof el.querySelectorAll !== 'function') return;
      try { imgs = el.querySelectorAll('img.cam-img'); } catch (x) { return; }
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].getAttribute('data-k') === k && imgs[i].getAttribute('src') !== url) imgs[i].setAttribute('src', url);
      }
    });
  }
  // ask for a camera's next still: off screen first, in place once it has a picture
  function fetchStill(id, client, now) {
    var st = client && client.states && client.states[id], pic = picOf(st), s = stillOf(id);
    if (s.busy && now - s.at > LOST_MS) s.busy = false;
    if (!pic || s.busy || now - s.at < MIN_GAP || typeof Image !== 'function') return;
    if (s.bad === pic && now - s.badAt < BAD_MS) return;
    s.busy = true; s.at = now; s.n++;
    var url = stillUrl(pic, s.n), im = new Image();
    im.onload = function () {
      s.busy = false;
      if (!im.naturalWidth) { s.bad = pic; s.badAt = Date.now(); return; }
      s.url = url; s.bad = '';
      place('cam:' + id, url);
    };
    im.onerror = function () { s.busy = false; s.bad = pic; s.badAt = Date.now(); };
    im.src = url;
  }

  // ------------------------------------------------------------ the pieces alive, and the one timer
  var ENT = [];                                                 // { api, client, now, ctx, k (its image's key), cam (the camera it wants a still of), dead }
  var NOTE = null;                                              // the spec the read just made (read it right after update())
  var TIMER = { t: null }, KICK = { t: null };
  function note(spec) { NOTE = spec; return spec; }
  // a piece is shown when it is in the page, not hidden by the plan, and has a box
  function shown(e) {
    var el = e.api && e.api.el, s;
    if (!el || el.isConnected === false) return false;
    s = el.style || {};
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
    return true;
  }
  // THE TICK: nothing while the page is hidden; else a still for each camera that has a shown piece
  function tick() {
    if (hidden()) return;
    var now = Date.now(), want = {};
    ENT.forEach(function (e) { if (!e.dead && e.cam && e.client && shown(e)) want[e.cam] = e.client; });
    Object.keys(want).forEach(function (id) { fetchStill(id, want[id], now); });
  }
  // the first still (or the one after the page comes back) should not wait ten seconds: asked a moment later, coalesced
  function kick() {
    if (KICK.t) return;
    KICK.t = defer(function () { KICK.t = null; tick(); });
  }
  // the timer runs while any alive piece wants a still, and not otherwise
  function syncTimer() {
    var need = ENT.some(function (e) { return !e.dead && e.cam; });
    if (need && !TIMER.t) TIMER.t = setInterval(tick, REFRESH_MS);
    else if (!need && TIMER.t) { clearInterval(TIMER.t); TIMER.t = null; }
  }
  function track(api, piece) {
    var e = { api: api, piece: piece, client: null, now: null, ctx: null, k: '', cam: '', dead: false }, upd = api.update, des = api.destroy;
    ENT.push(e);
    api.update = function (client, now, ctx) {
      e.client = client; e.now = now; e.ctx = ctx;
      NOTE = null;
      var r = upd.apply(api, arguments);
      if (NOTE) { e.k = NOTE.k || ''; e.cam = e.k.indexOf('cam:') === 0 ? e.k.slice(4) : ''; }
      syncTimer();
      if (e.cam && !urlFor(e.k) && shown(e)) kick();
      return r;
    };
    api.destroy = function () {
      e.dead = true;
      var i = ENT.indexOf(e);
      if (i >= 0) ENT.splice(i, 1);
      syncTimer();
      return des.apply(api, arguments);
    };
  }
  var create = W.create;
  W.create = function (piece, shape) {
    var api = create.apply(this, arguments);
    if (api && typeof shape === 'string' && (piece === 'camera' || piece === 'ring')) track(api, piece);
    return api;
  };
  // the page coming back to the front asks for its stills at once
  try {
    if (document.addEventListener) document.addEventListener('visibilitychange', function () { if (!hidden() && TIMER.t) kick(); });
  } catch (e) { /* no document events */ }

  // ------------------------------------------------------------ the markup both pieces use
  //   the dark ground with its glyph, the <img> (no src until there is a picture), then the name on its gradient
  function pic(k, name) {
    var src = urlFor(k);
    return '<div class="cam"><span class="cam-ph">' + CAM_GLYPH + '</span><img class="cam-img" alt="" data-k="' + esc(k || '') + '"' + (src ? ' src="' + esc(src) + '"' : '') + '>' +
      (name ? '<i class="cam-g"></i><span class="cam-n">' + esc(name) + '</span>' : '') + '</div>';
  }

  // ------------------------------------------------------------ CAMERA
  function camRead(X) {
    var id = pickCamera(X), st = id && X.st ? X.st[id] : null, un = !picOf(st), s = id ? STILLS[id] : null;
    // (a camera that cannot give a picture shows none: an old frame is not now)
    if (un && s) s.url = '';
    // ITS NAME (2026-11-05): the camera's own (Show), the words given (Custom; none given, its own), or none (Hide): an
    // entity's name is often a device's ("G4 Doorbell Pro Package Camera"), not what a screen in the hall should say
    var o = X.opts || {}, label = o.label === 'hide' ? '' : o.label === 'custom' && typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : nameOf(id, st);
    return note({ cam: id, name: label, k: id && !un ? 'cam:' + id : '', un: un ? 1 : 0 });
  }
  function camDraw(s) { return pic(s.k, s.name); }
  W.define('camera', {
    name: 'Camera', group: GROUP, wave: 'B', facts: ['camera'], source: 'camera.entity_picture', when: null,
    wakes: ['minute', 'house'], pick: null, off: true, opts: { camera: 'entity:camera', label: ['show', 'custom', 'hide'], name: 'text' },
    defaults: { camera: '', label: 'show', name: '' }, accent: null,
    shapes: {
      rectangular: { read: camRead, draw: camDraw, sample: { cam: '', name: 'Front Door', k: '', un: 1 } },
      card: { read: camRead, draw: camDraw, h: function () { return 16.8; }, sample: { cam: '', name: 'Front Door', k: '', un: 1 } }
    }
  });

  // ------------------------------------------------------------ LAST RING
  //   the latest ring { at, camera, snap }: the window event, kept from the moment this file loads
  var RING = null;
  var SNAPS = {};                                               // snap -> { state: 'ask' | 'ok' | 'bad', url, at }
  var WAKE = { t: null };
  function ringsWake() {
    if (WAKE.t) return;
    WAKE.t = defer(function () {
      WAKE.t = null;
      ENT.slice().forEach(function (e) {
        if (e.dead || e.piece !== 'ring' || !e.client) return;
        try { e.api.update(e.client, e.now || new Date(), e.ctx); } catch (x) { /* its own data */ }
      });
    });
  }
  // a doorbell event's time: the server's (ts, seconds) when it is recent, else now
  function ringTime(ev) {
    var t = Number(ev && ev.ts), now = Date.now();
    if (isFinite(t) && t > 0) {
      if (t < 1e11) t *= 1000;
      if (Math.abs(now - t) < 86400000) return t;
    }
    return now;
  }
  function onHouseEvent(e) {
    var ev = e && e.detail;
    if (!ev || ev.kind !== 'doorbell' || (ev.type && ev.type !== 'notification')) return;
    RING = { at: ringTime(ev), camera: typeof ev.camera === 'string' ? ev.camera : '', snap: typeof ev.snap === 'string' && ev.snap ? ev.snap : '' };
    ringsWake();
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('hk-house-event', onHouseEvent);

  // THE SNAPSHOT, signed once per snap (hk-notify.js snapUrl: hk_notify/snap/sign), loaded off screen, and the cards drawn again
  // a moment later with it, or without it when it cannot be had
  function snapDone(snap, ok, url) {
    var S = SNAPS[snap] || (SNAPS[snap] = {});
    S.state = ok ? 'ok' : 'bad'; S.url = ok ? url : ''; S.at = Date.now();
    ringsWake();
  }
  function signSnap(snap, client) {
    SNAPS[snap] = { state: 'ask', url: '', at: Date.now() };
    defer(function () {
      if (!client || typeof client.callWS !== 'function') { snapDone(snap, false); return; }
      try {
        client.callWS({ type: 'hk_notify/snap/sign', snaps: [snap] }).then(function (r) {
          var u = r && r.signed && r.signed[snap];
          if (!u || typeof Image !== 'function') { snapDone(snap, false); return; }
          var im = new Image();
          im.onload = function () { snapDone(snap, !!im.naturalWidth, u); };
          im.onerror = function () { snapDone(snap, false); };
          im.src = u;
        }, function () { snapDone(snap, false); });
      } catch (e) { snapDone(snap, false); }
    });
  }
  // the ring now, or null: within thirty minutes of it (a little before it is a clock that is a minute behind)
  function ringNow(X) {
    var age = RING ? +X.now - RING.at : 0;
    return RING && age < RING_MS && age > -120000 ? RING : null;
  }
  function ringTimeText(r, X) { return tm(new Date(r.at), X.h24, true); }
  W.define('ring', {
    name: 'Last Ring', group: GROUP, wave: 'B', facts: ['ring'], source: 'hk-house-event', when: 'after the doorbell rings',
    wakes: ['minute', 'house'], pick: null, off: true, opts: {}, defaults: {}, accent: AMBER,
    shapes: {
      inline: {
        read: function (X) {
          var r = ringNow(X);
          return note(r ? { text: 'Doorbell ' + ringTimeText(r, X), gl: 1, k: '' } : { off: true, text: '', k: '' });
        },
        draw: function (s) { return inl(BELL, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Doorbell 4:02 PM', gl: 1 }
      },
      card: {
        read: function (X) {
          var r = ringNow(X);
          if (!r) return note({ off: true, k: '' });
          var id = /^camera\.[a-z0-9_]+$/.test(r.camera) ? r.camera : '', st = id && X.st ? X.st[id] : null, still = id && picOf(st) ? 'cam:' + id : '', k = still;
          if (r.snap) {
            var S = SNAPS[r.snap], t = Date.now();
            if (!S && t - r.at < SNAP_KEEP) { signSnap(r.snap, X.client); S = SNAPS[r.snap]; }
            if (S && S.state === 'ok' && t - S.at < SIGN_KEEP && t - r.at < SNAP_KEEP) k = 'snap:' + r.snap;
            else if (S && S.state === 'ask') k = '';           // (a moment: the placeholder, not the porch and then the face)
          }
          if (id && !still && STILLS[id]) STILLS[id].url = '';        // (a camera that gives no picture shows none)
          return note({ text: 'Doorbell rang at ' + ringTimeText(r, X), k: k });
        },
        draw: function (s) { return pic(s.k, '') + '<div class="rgc"><i class="dot a"></i><span>' + esc(s.text) + '</span></div>'; },
        h: function () { return 23; },
        sample: { text: 'Doorbell rang at 4:02 PM', k: '' }
      }
    }
  });

  // (for the tests, and a caller that wants the pieces' readings)
  H.cameras = { stillUrl: stillUrl, STILLS: STILLS, SNAPS: SNAPS, ENT: ENT, TIMER: TIMER, tick: tick, picOf: picOf, pickCamera: pickCamera, nameOf: nameOf,
                ring: function () { return RING; }, CSS: CSS, REFRESH_MS: REFRESH_MS, RING_MS: RING_MS };
})();
