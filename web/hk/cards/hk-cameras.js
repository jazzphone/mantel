// hk-cameras.js -- the camera strip mosaic and its editor
//
// hk-camera-mosaic-card (+ hk-camera-mosaic-editor), and hk-doorbell-card
// (the #doorbell sheet: live video with sound, hold-to-talk), and
// hk-tv-guide-card (Live TV's channels + the full-screen player). The mosaic's
// thumbnail cache lives in hk-base.js, because hk-campost.js reads it too.
//
// Shared pieces -- HkBase, the editor helpers, register(), create(), the
// snapshot cache -- come from hk-base.js through window.hkCards.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing -- see
  // hk-base.js).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-cameras] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkCameras) return;                  // double-load guard
  var HkBase = C.HkBase, register = C.register, hkEditor = C.editor,
      create = C.create, snapCacheGet = C.snapCache.get,
      snapCachePut = C.snapCache.put;
  // the live stream after the screensaver: this long after it is gone,
  // or at most this long after it stopped (_wakeLiveLater)
  var LIVE_AFTER_WAKE = 1500, LIVE_WAKE_MAX = 6000;
  // ...and after the kiosk's own Black screensaver: this long after it ends
  var AFTER_BLACK = 2500;
  // THE LIVE CARD IS HIDDEN UNTIL IT HAS A PICTURE ONLY ON ANDROID, whose
  // WebView draws video outside the page (see .live>hui-card.wait). Safari
  // will not start a hidden muted video at all, so there the card would wait
  // for ever (hk-campost.js, ANDROID ONLY).
  var VIDEO_OUTSIDE = /Android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');

  // Is this video's current frame solid black? 8x8 pixels on a scratch
  // canvas; a night camera's infrared grey is far above the line. Unreadable
  // (no canvas, a tainted frame): not black, as before.
  var scratch = null;
  function blackFrame(v) {
    try {
      if (!scratch) {
        scratch = document.createElement('canvas');
        scratch.width = scratch.height = 8;
        scratch.x = scratch.getContext('2d', { willReadFrequently: true });
      }
      if (!scratch.x || typeof scratch.x.getImageData !== 'function') return false;
      scratch.x.drawImage(v, 0, 0, 8, 8);
      var d = scratch.x.getImageData(0, 0, 8, 8).data, sum = 0;
      for (var i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum < 64 * 3 * 4;            // every channel of every pixel under ~4
    } catch (e) {
      return false;
    }
  }

  // ======================================================================
  // hk-camera-mosaic-card -- the Home app's camera strip, as one joined mosaic.
  //
  // ONE CARD, NOT A CONDITIONAL PER CAMERA. "Which camera is live" as
  // `state:` / `state_not:` conditionals is two per camera and hundreds of
  // hand-maintained lines. This resolves it at render time from the
  // selector, the same move hk-control.js makes for the Play Music page.
  //
  // THE PATTERN, measured off the Home app on an iPad:
  // equal-width columns, alternating ONE full-height tile and TWO stacked
  // half-height tiles, at 4:3 per column (measured w/h 1.320 and 1.325 on the
  // two full columns). The stacked tiles are a 4:3 column split in two.
  //
  //   [ live 16:9 ][ still ][ still ][ still ][ still ]
  //   [  360x203  ][-------][ 4:3   ][-------][ 4:3   ]
  //   [  slot 1   ][ still ][ full  ][ still ][ full  ]
  //
  // SLOT 1 IS DELIBERATELY NOT 4:3. The Home app crops its featured tile to
  // 4:3, which on a 16:9 feed throws away ~25% of the width -- and on many
  // cameras the sides carry real coverage. So the live tile keeps its full
  // 16:9 at 360x202.5. Only the stills take the 4:3 crop.
  //
  // THE STRIP MUST KEEP SCROLLING, and this is a performance constraint rather
  // than a style choice. MEASURED on a 4GB Android wall tablet: HA fetches
  // camera snapshots ONLY for cameras visible in the scroller -- 4 distinct
  // cameras at scrollLeft 0, 8 after scrolling to the end of a 3348px strip
  // in a 1265px row. Tile size changes nothing, because HA serves the
  // source-resolution snapshot whatever box it is drawn in. So the number of
  // cameras ON SCREEN *is* the fetch load. A mosaic sized to fit all nine at
  // once would take that from 4 to 9 permanently. At 270px columns this
  // shows ~6 in the same 1265px where a plain row of cards shows ~3.4 --
  // more cameras for a smaller increase, with the dial still in your hands.
  //
  // ONE PLATE, NOT NINE CARDS. The mosaic reads as a single object because the
  // radius and the shadow live on the plate and the tiles are clipped by it:
  //   - `overflow:hidden` + `border-radius` rounds the GROUP's outer corners;
  //   - `--ha-card-border-radius:0` squares every interior corner. Custom
  //     properties cross the shadow boundary, which is what makes this reach
  //     into each picture-entity without card_mod (a mosaic built on
  //     card_mod renders as a plain stack wherever it is not installed,
  //     because the CSS applies to nothing);
  //   - `--ha-card-box-shadow:none` stops nine shadows overlapping in the 2px
  //     seams. The plate carries the SAME `0 8px 22px` the theme uses, so
  //     the shadow's reach is unchanged and hk-row-card's pad/margin numbers
  //     (14/22/30/22 and the matching negative margin) do NOT move.
  //   - the seams show the plate's own dark background rather than the page.
  //     That is deliberately unlike iOS, whose page is always dark: our sky is
  //     bright in daytime and a transparent seam would cut a bright line
  //     through the mosaic.
  class HkCameraMosaicCard extends HkBase {
    static get CSS() {
      return [
        // A SNAPSHOT SLOT IS TWO STACKED <img>, and that is the whole fix for
        // the black flash. `hui-image` refreshes a camera by reassigning the
        // <img>'s src; the browser drops the old frame immediately and paints
        // nothing until the new bytes arrive, which on a slow tablet is long
        // enough to read as a blackout. Here the incoming frame loads into the
        // HIDDEN layer and only becomes visible once it has decoded, so there
        // is never a moment with no picture. The 240ms fade is what turns the
        // swap from a cut into a dissolve.
        '.snap{position:relative;overflow:hidden;background:#0b0d12}',
        // NO TRANSITION, AND THAT IS THE WHOLE POINT. A crossfade here runs on
        // BOTH images at once -- the outgoing one fades out while the incoming
        // one fades in -- so halfway through, the stack's total opacity is
        // below 1 and the dark plate behind it shows through. The tile dims
        // about 25% and comes back, and because the tiles are staggered 220ms
        // apart it ripples across the row as a pulse.
        //
        // Measured off a 60fps screen recording, mean luma of the camera band:
        //
        //   a 240ms crossfade           worst deviation 8.34   39 of 220 frames
        //   the Home app                worst deviation 0.22    0 of 740 frames
        //
        // The Home app does a HARD SWAP and its band is flat straight through a
        // refresh. So does this. The double buffer is what prevents the blank
        // frame -- reassigning one <img>'s src paints nothing until the bytes
        // arrive -- and a fade is never load-bearing, it only adds the artifact.
        // z-index keeps the incoming frame on top, so even if the two class
        // changes land in different paints the worst case is the new image
        // early, never a gap.
        '.snap img{position:absolute;inset:0;width:100%;height:100%;',
        '  object-fit:cover;opacity:0;z-index:0}',
        '.snap img.on{opacity:1;z-index:1}',
        // THE PICTURE IS A CANVAS, AND THE TWO <img> ARE ONLY ITS LOADERS.
        // Revealing the incoming <img> on every refresh makes the WebView
        // re-raster that part of the strip. On an Android tablet -- a small GPU
        // image cache, and checker-imaging -- that re-raster draws the tile
        // WITHOUT its image for a frame and then fills it in (in a 60fps
        // recording: frame 93 dark, 94 half, 95 done). decode() and a frame of
        // grace cannot stop it, because the reveal is what causes the raster. A
        // canvas holds its own finished pixels, so a refresh is one drawImage
        // and the next frame shows all of it. Desktop Chrome never shows the
        // fault, even with checker-imaging forced on -- its trace invalidates
        // zero images -- so only a tablet can verify this.
        //
        // [data-cv] is set only once a 2D context exists; without one the
        // <img> path above still shows the picture.
        '.snap canvas,.live>canvas{position:absolute;inset:0;width:100%;',
        '  height:100%;opacity:0;z-index:0}',
        '.snap canvas.on,.live>canvas.on{opacity:1}',
        '.snap[data-cv] img,.live[data-cv]>img{visibility:hidden}',
        '.snap.tap{cursor:pointer}',
        // THE AGE LABEL, measured off the Home app rather than guessed. From a 3x
        // iPhone screen recording, in source px: digit height 30, left inset
        // 40, bottom inset 49, on a 280px-tall tile -- so in CSS px, 10.0 /
        // 13.3 / 16.3 on a 93.3px tile. Our stacked half is 100.25px tall, near
        // enough that the Home app's own CSS values transfer directly rather
        // than needing to be re-derived as ratios.
        //
        // 10px of digit height is a ~14px font (SF Pro digits run about 0.72em)
        // and the stroke measures ~2px, which is Bold. The text sits over live
        // camera imagery, so it needs its own contrast: sampling around the
        // glyphs read 85 luma against 101 for the same band further along the
        // tile, i.e. the Home app carries a soft dark halo, not a scrim across
        // the bottom of the tile.
        //
        // A text-shadow is safe here despite .snap being overflow:hidden -- the
        // label is inset 13px, so the blur never reaches the clip. Overflow
        // does clip a text-shadow that comes closer to the edge.
        '.age{position:absolute;left:13px;bottom:16px;z-index:2;',
        '  font-size:14px;font-weight:700;line-height:1;color:#fff;',
        '  text-shadow:0 1px 3px rgba(0,0,0,.55);pointer-events:none;',
        '  font-variant-numeric:tabular-nums;letter-spacing:.01em}',
        // THE LIVE TILE GETS A STILL BEHIND IT. A <video> with no frames yet
        // paints nothing, so without something underneath, a stream that is
        // slow or dead reads as a black hole in the middle of the plate. The
        // poster is the same camera_proxy still the other tiles use, sized to
        // the live tile, and it sits UNDER the card rather than replacing it --
        // the moment the stream produces a frame the video covers it, with no
        // swap and no flicker. See _tick for why it costs nothing while the
        // stream is healthy.
        '.live{position:relative;overflow:hidden;background:#0b0d12}',
        // TWO POSTERS, for the same reason the stills have two. A single <img>
        // would reintroduce the very bug the stills are built to avoid: while a
        // stream is down the poster refreshes every ten seconds, and reassigning
        // one <img>'s src paints nothing until the new bytes arrive -- a blink
        // on an already-broken tile. Same hard swap, no transition, for the
        // same reason as above.
        // Both stay at z-index 0, BELOW the live card at 1, so the video
        // covers them the instant it has a frame.
        '.live>img{position:absolute;inset:0;width:100%;height:100%;',
        '  object-fit:cover;opacity:0;z-index:0}',
        '.live>img.on{opacity:1}',
        '.live>hui-card{position:absolute;inset:0;z-index:1;transition:opacity .3s ease}',
        // NO PICTURE, NO VIDEO (2026-10-09): until the stream has a frame,
        // and from the moment a navigation away begins, the live card is
        // out of sight and the frame copied under it shows (_grabLive). A
        // video without a picture showed the tablet's own background
        // through the page -- the tile went WHITE as the page was left and
        // black as it came back (screen-recorded). At once when it goes;
        // the picture fades in over the copied frame when it comes.
        // VISIBILITY, not opacity alone: the tablet draws a video outside
        // the page, where opacity does not reach -- a fresh live card at
        // opacity 0 still showed white for a frame (screen-recorded).
        '.live>hui-card.wait{opacity:0;visibility:hidden;transition:none}',
        // ...AND THE COPIED FRAME STAYS ON TOP until the video has DRAWN one
        // (2026-10-09). Shown the moment it reports a picture, the video's own
        // surface was still black for 60-350 ms in 3 returns to Home of 5
        // (screen-recorded) -- once the page stopped being held back after
        // every navigation, nothing hid that any more. So the still is lifted
        // over the card as the card comes back, and dropped one frame after
        // the video's first presented frame (_liveShown) -- as the camera
        // sheet does (.db.moving).
        '.live.lift>canvas,.live.lift>img{z-index:2}',
        // A LIVE TILE WITH A POP-UP TAKES NO INPUT ITSELF. HA's picture-entity
        // runs its action handler even with tap_action none, and on TOUCH that
        // handler preventDefault()s the touchend, so the browser never makes a
        // click -- the tile would open its pop-up with a mouse and do nothing
        // under a finger. The tap goes through the card to the .live box
        // instead, which opens the pop-up itself.
        '.live.pop>hui-card{pointer-events:none}',
        '.plate{display:grid;overflow:hidden;width:max-content;',
        // THE PLATE REPLACES THE PER-CARD THEME, it does not layer on top of
        // one. Passing a camera `theme:` to each tile AND setting these
        // properties on the plate brings the tiles back with radius 23.5px and
        // the full shadow, because HA applies a per-card theme's variables ON
        // the card element, and a value set on the element beats one inherited
        // from an ancestor (the tiles report `23.5px` and `0 8px 22px` with
        // both in place).
        //
        // So the tiles get NO theme and inherit all four from here. The first
        // two are what such a theme supplies and still matter (an opaque card
        // background shows as a square shoulder behind a rounded photo); the
        // last two are the mosaic's own doing -- square interior corners and
        // exactly one shadow, on the group.
        '  --ha-card-background:transparent;',
        '  --ha-card-border-width:0px;',
        '  --ha-card-border-radius:0px;',
        '  --ha-card-box-shadow:none}',
        '.plate > *{min-width:0;min-height:0}',
      ].join('');
    }

    // THE DASHBOARD'S OWN CAMERAS FIRST. Its item's Home -> Camera strip ->
    // Cameras, when it lists any, over this card's YAML -- the same rule as
    // the chips and the scenes (item, then card, then the home) -- so a
    // hand-written dashboard's strip is set in the UI too. A camera the YAML
    // also lists keeps its entry (name, `option:`).
    _board() {
      var M = window.hkCards && window.hkCards.menu;
      return (M && M.board ? M.board() : null) || {};
    }
    _cams() {
      var own = (this._config && this._config.cameras) || [];
      // a room's own cameras, not the screen's Home strip list
      if (this._config && this._config.own_cameras) return own;
      var ids = this._board().cameras;
      if (!Array.isArray(ids) || !ids.length) return own;
      var h = this._hass, by = {};
      own.forEach(function (c) { if (c && c.entity) by[c.entity] = c; });
      return ids.filter(function (id) { return !h || !h.states || h.states[id]; }).map(function (id) {
        if (by[id]) return by[id];
        var st = h && h.states && h.states[id];
        return { entity: id, name: (st && st.attributes && st.attributes.friendly_name) || id };
      });
    }
    // WHICH CAMERA IS LIVE: the item's "Live camera follows" (an
    // input_select / select), else this card's `selector:`. With no `option:`
    // on a camera, an option names it when the camera's name starts with it
    // -- "Deck" is "Deck Camera Low resolution channel" -- so a generated
    // strip follows an input_select such as a person-detection pick
    // without a table.
    _selector() {
      var b = this._board();
      return b.camera_live || (this._config && this._config.selector) || '';
    }
    // THE FIRST TILE PLAYS LIVE (Cameras -> Live First Camera, 2026-10-10):
    // this screen's own choice, else All Screens'. Off, it is a snapshot like
    // the others -- in its place and at its size, still the one Live Camera
    // Follows picks -- and no stream is decoded: lighter on the device.
    _liveOn() {
      var P = window.hkSettings;
      if (P && P.rendering && !P.rendering().autoplay) return false;
      var b = this._board();
      if (typeof b.camera_live_video === 'boolean') return b.camera_live_video;
      var S = window.hkSettings;
      return !(S && S.get && S.get('cameras.live', true) === false);
    }
    _optionOf(cam, opts) {
      if (cam.option) return cam.option;
      var h = this._hass, st = h && h.states && h.states[cam.entity];
      var names = [cam.name, st && st.attributes && st.attributes.friendly_name]
        .filter(Boolean).map(function (n) { return String(n).toLowerCase(); });
      var best = null;
      (opts || []).forEach(function (o) {
        var t = String(o).toLowerCase();
        var hit = names.some(function (n) { return n === t || n.indexOf(t + ' ') === 0; });
        if (hit && (!best || t.length > best.length)) best = String(o);
      });
      return best;
    }
    _num(k, d) {
      var v = this._config && this._config[k];
      return (typeof v === 'number' && isFinite(v)) ? v : d;
    }

    // Re-render ONLY when the live selection changes. Returning null here would
    // mean "always render", and the frontend hands a card a new hass 12x a
    // second -- see the note on HkBase.set hass. The camera images refresh
    // themselves; this card only decides WHICH camera sits in slot 1.
    // WITHOUT A SELECTOR THE PLAN NEVER CHANGES -- the first camera is live --
    // so the signature is a constant, not null. Null means "render on every
    // hass push", and a render rebuilds the plate: a generated dashboard's
    // strip (no selector) would re-create its live tile 12 times a second,
    // so the WebRTC stream is torn down before its first frame -- a black
    // tile, a flickering strip, and go2rtc churning through abandoned
    // sessions until it is restarted.
    _sigOf() {
      var h = this._hass, c = this._config;
      if (!h || !c) return null;
      // the item's cameras and live-camera choice change only when a setting
      // is saved -- never per hass push (the rebuild storm above)
      var b = this._board();
      var key = JSON.stringify([b.cameras || [], b.camera_live || '', this._liveOn()]);
      // AFTER A RECONNECT the live tile waits for its camera's first state
      // from the new server (hk-base.js STALE) and mounts when it arrives:
      // one render on the way in, one when the camera is back.
      if (C.staleEpoch()) {
        var pl = this._plan();
        if (pl && pl.live && !pl.still && C.stale(h.states[pl.live.entity])) key += '|wait';
      }
      var sel = this._selector();
      if (!sel) return 'fixed|' + key;
      var st = h.states[sel];
      return (st ? st.state : 'none') + '|' + key;
    }

    // Slot 1 is whichever camera the selector names; the rest keep config
    // order. An unknown selection falls back to the first camera rather than
    // rendering an empty slot.
    _plan() {
      var cams = this._cams();
      if (!cams.length) return null;
      // STILLS ONLY (a room page, 2026-10-09): no live tile -- every camera
      // in the pattern, starting with a full-height single, as the Home app
      // draws a room's cameras (one tall, then two stacked).
      var stillsOnly = !!(this._config && this._config.stills_only);
      if (stillsOnly) return { live: null, cols: this._columns(cams, false) };
      var selId = this._selector();
      var selSt = this._hass && selId ? this._hass.states[selId] : null;
      var sel = selSt ? selSt.state : null;
      var opts = (selSt && selSt.attributes && selSt.attributes.options) || [];
      var live = null;
      for (var i = 0; i < cams.length; i++) {
        if (sel && this._optionOf(cams[i], opts) === sel) { live = cams[i]; break; }
      }
      if (!live) live = cams[0];
      var stills = cams.filter(function (c) { return c !== live; });
      return { live: live, still: !this._liveOn(), cols: this._columns(stills, true) };
    }

    _columns(stills, stackFirst) {
      // Alternate starting with a STACK: slot 1 is already full-height, and two
      // full-height tiles side by side read as two big tiles, not a mosaic.
      // The Home app does the same -- the front door, then two others stacked.
      //
      // ONE LOOKAHEAD, and the unit tests are why it exists. Strict alternation
      // gives [2,1,1] for four stills -- it emits a single, then wants a stack,
      // finds one still left and emits a second single. Two full-height columns
      // end up adjacent, which is the "two big tiles side by side" this
      // alternation exists to avoid. So a single is only emitted when what
      // follows it can still be a stack (>=2 left) or nothing at all. Four
      // stills become [2,2] instead; eight stay [2,1,2,1,2].
      var cols = [];
      var j = 0, stack = stackFirst;
      while (j < stills.length) {
        var left = stills.length - j;
        var wantSingle = !stack;
        if (wantSingle && left - 1 === 1) wantSingle = false;   // would orphan one
        if (!wantSingle && left >= 2) { cols.push([stills[j], stills[j + 1]]); j += 2; stack = false; }
        else                          { cols.push([stills[j]]); j += 1; stack = true; }
      }
      return cols;
    }

    _pic(cam, live, ar) {
      var cfg = {
        type: 'picture-entity',
        entity: cam.entity,
        camera_image: cam.entity,
        camera_view: live ? 'live' : 'auto',
        show_name: false,
        show_state: false,
        fit_mode: 'cover',
        aspect_ratio: ar,
        // The live box's own click opens the camera (its pop-up, else its
        // camera sheet -- see _openCam); the card must not also act.
        // (A still is not a picture-entity at all.)
        tap_action: live ? { action: 'none' } : { action: 'more-info' }
      };
      // NO `theme:` here -- see the CSS note. A per-card theme sets the
      // ha-card variables on the tile itself and would win over the plate's
      // inherited values, putting the rounded corners and the nine shadows
      // straight back. `tile_theme` is still accepted in the config for the
      // rare case of wanting a different look, and then it is the caller's problem.
      if (this._config.tile_theme) cfg.theme = this._config.tile_theme;
      var el = document.createElement('hui-card');
      el.hass = this._hass;
      el.preview = false;
      el.config = cfg;
      el.load();
      (this._children = this._children || []).push(el);
      return el;
    }

    // A TAP ON A CAMERA OPENS ITS CAMERA SHEET, like every other device's
    // detail sheet: more-info, which hk-detail.js's CameraPanel answers --
    // live, with sound, talk where the camera has a speaker. Cameras are
    // treated just like the other detail pages, so per-camera `popup:`
    // hashes (#camera-driveway, #doorbell) are not opened by a tap; a
    // #doorbell pop-up stays for a doorbell-ring automation, which opens it
    // by URL, not by tap.
    _openCam(cam) {
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId: cam.entity }, bubbles: true, composed: true
      }));
    }

    // A STILL CAMERA IS RENDERED HERE, NOT BY picture-entity, and the reason is
    // the black flash. See the .snap CSS above for the mechanism; this is the
    // rest of it -- the URL, the interval, and which cameras get refreshed.
    //
    // The src is the entity's own `entity_picture`, a camera_proxy URL that
    // arrives pre-signed with a token. It is re-read from hass on EVERY tick
    // rather than cached, because HA rotates that token and a stale URL 401s
    // into a broken image.
    _snap(cam, cssW, cssH) {
      var self = this;
      var box = document.createElement('div');
      box.className = 'snap tap';
      var a = document.createElement('img');
      var b = document.createElement('img');
      a.decoding = 'async'; b.decoding = 'async';
      a.alt = ''; b.alt = '';
      var cv = this._canvasFor(box);
      if (cv.el) box.append(cv.el);
      box.append(a, b);
      var age = null;
      if (this._config.show_age !== false) {
        age = document.createElement('span');
        age.className = 'age';
        box.appendChild(age);
      }
      // more-info is what picture-entity's tap_action gave us -- or the
      // camera's own pop-up when it has one.
      box.addEventListener('click', function () { self._openCam(cam); });
      // `loading` lives on the slot, not in img.dataset: it is the card's own
      // state and has no business being stringified into a DOM attribute.
      var slot = { box: box, cam: cam, imgs: [a, b], front: -1, loading: [false, false],
                   cssW: cssW, cssH: cssH, age: age, cv: cv.el, ctx: cv.ctx };
      this._wireRestore(slot);
      // THE CACHED FRAME GOES ON IMMEDIATELY, before any request is made. It
      // is painted into imgs[1] and marked front, so the very first real load
      // -- which targets (front + 1) % 2, i.e. imgs[0] -- hard-swaps over it
      // exactly the way a refresh swaps over the previous frame. No extra
      // path, and no chance of the two fighting.
      var hit = snapCacheGet(cam.entity);
      if (hit) {
        // Onto the canvas once the data URL decodes -- unless a real frame
        // has taken the slot first.
        b.onload = function () {
          b.onload = null;
          if (slot.front === 1) self._blit(slot, b);
        };
        b.src = hit.d;
        b.classList.add('on');
        slot.front = 1;
        slot.at = hit.t;                       // so the age label tells the truth
        if (age) age.textContent = this._ageText(hit.t);
      }
      (this._snaps = this._snaps || []).push(slot);
      return box;
    }

    // A slot's canvas and its 2D context, or { el: null } when there is no
    // usable context -- then [data-cv] is never set and the <img> show as they
    // always did. `alpha:false` because a camera still has no transparency.
    _canvasFor(box) {
      try {
        var el = document.createElement('canvas');
        var ctx = el.getContext && el.getContext('2d', { alpha: false });
        if (!ctx || typeof ctx.drawImage !== 'function') return { el: null, ctx: null };
        box.setAttribute('data-cv', '1');
        return { el: el, ctx: ctx };
      } catch (e) {
        return { el: null, ctx: null };
      }
    }

    // A GPU reset on Android throws a canvas's pixels away and fires
    // `contextrestored` on the blank result. Redraw the front frame rather
    // than showing black until the next refresh.
    _wireRestore(slot) {
      if (!slot.cv || typeof slot.cv.addEventListener !== 'function') return;
      var self = this;
      slot.cv.addEventListener('contextrestored', function () {
        var im = slot.front >= 0 ? slot.imgs[slot.front] : null;
        if (im && slot.cv.classList.contains('on')) self._blit(slot, im);
      });
    }

    // DRAW A DECODED FRAME ONTO THE SLOT'S CANVAS, cropped exactly the way
    // `object-fit:cover` cropped the <img>: scale to cover the box, centre
    // the overflow. The backing store is the tile's DEVICE pixels, so it is
    // as sharp as the <img> was on the 1.5x and 2.0x tablets. Resizing a
    // canvas clears it, so the size is only written when it changes -- in
    // practice once, on the first frame.
    //
    // Any failure falls back to the <img> path by dropping [data-cv]: a tile
    // with a picture that may flicker beats a tile with no picture.
    _blit(slot, im) {
      if (!slot || !slot.ctx || !slot.cv) return false;
      var nw = im && im.naturalWidth, nh = im && im.naturalHeight;
      if (!nw || !nh) return false;
      try {
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        var W = Math.max(1, Math.round(slot.cssW * dpr));
        var H = Math.max(1, Math.round(slot.cssH * dpr));
        if (slot.cv.width !== W) slot.cv.width = W;
        if (slot.cv.height !== H) slot.cv.height = H;
        var k = Math.max(W / nw, H / nh);
        var sw = W / k, sh = H / k;
        slot.ctx.drawImage(im, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, W, H);
        slot.cv.classList.add('on');
        return true;
      } catch (e) {
        slot.ctx = null;
        slot.cv.classList.remove('on');
        if (slot.box && slot.box.removeAttribute) slot.box.removeAttribute('data-cv');
        return false;
      }
    }

    // ASK THE PROXY FOR A TILE-SIZED IMAGE. Without this each snapshot is the
    // camera's full frame -- measured on a camera whose entity is literally
    // named "low_resolution_channel": **1,797,946 bytes at 3840x2160**.
    // Eight of those every ten seconds is ~14 MB a cycle, decoded from 4K
    // into a 270x100 box, and on a 4GB tablet the later tiles simply starve
    // and stay black. hui-image passes these params; a card that renders
    // the images itself has to as well.
    //
    // BOTH width AND height ARE REQUIRED. Measured against the same camera:
    //
    //     (no params)            1,797,946 b   3840x2160
    //     &width=280             1,798,157 b   3840x2160   <- ignored
    //     &height=105            1,798,111 b   3840x2160   <- ignored
    //     &width=280&height=105     34,506 b    480x270    <- 52x smaller
    //
    // One alone is silently ignored. HA scales to COVER the request while
    // keeping the source aspect, so asking for the tile's device pixels gives
    // a crisp image and nothing larger.
    //
    // NEVER ASK TWICE WITH A CREDENTIAL THAT FAILED. The `connected ===
    // false` rule in _tick only covers the socket being DOWN. After an HA
    // restart the socket is back long before Protect has re-added its
    // cameras, and until it does the page still holds the old states and
    // their old tokens: the proxy answers 401 (no such camera yet), the ban
    // middleware logs it, and a strip that asks again every tick logs
    // hundreds of those in a burst after each restart. So a slot remembers
    // the entity_picture that failed and does not use it again; the new
    // HA's state carries a new token, and that is the next request. A
    // transient failure costs at most HA's token rotation (5 min) of
    // staleness, against a ban-counted request every ten seconds. `restored`
    // is the registry's placeholder for an entity not set up yet -- never a
    // picture to fetch.
    _picOf(cam) {
      var st = this._hass && this._hass.states[cam.entity];
      var a = st && st.attributes;
      if (!a || a.restored || C.stale(st)) return null;     // stale: see hk-base.js STALE
      return a.entity_picture || null;
    }

    _srcFor(cam, slot) {
      var ep = this._picOf(cam);
      if (!ep || (slot && slot.badPic === ep)) return null;
      // A MONOTONIC COUNTER, not Date.now(): two refreshes inside the same
      // millisecond would produce an identical URL and the browser would serve
      // the frame it already has, silently skipping the update. Ticks are ten
      // seconds apart in practice, but the counter costs nothing and removes
      // the case entirely.
      this._bust = (this._bust || 0) + 1;
      var q = ep + (ep.indexOf('?') < 0 ? '?' : '&') + '_hk=' + this._bust;
      if (slot && slot.cssW && slot.cssH) {
        // dPR so it is sharp on the 1.5x and 2.0x tablets, capped at 2 -- past
        // that the bytes grow faster than anyone can see.
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = Math.round(slot.cssW * dpr), h = Math.round(slot.cssH * dpr);
        // AND CAPPED AT THE TIER, which is the part that actually costs money.
        // Protect serves DISCRETE snapshot sizes, not arbitrary ones. Measured
        // walking the request up one step at a time:
        //
        //     request <= 480x270   ->  480x270    34 KB
        //     request >  480x270   ->  960x540   166 KB   <- 4.9x, no middle
        //
        // Asking for the tile's own size straddles that cliff by accident: a
        // stacked half asks for 405x150 (cheap tier) but a full-height column
        // asks for 405x304, so a 4:3 tile costs as much as ten stacked halves.
        // Asking for 480x270 instead upscales those tiles ~1.13x and cuts the
        // plate's steady-state transfer by about half.
        // ...BUT ONLY WHILE THE CAP DOES NOT COST TOO MUCH DETAIL, which is a
        // per-SCREEN question and not a per-config one. Measured in a dPR 2.0
        // browser, rendering both tiers into each tile's real
        // physical box and comparing gradient energy:
        //
        //   screen      tile    physical   scale   detail   PSNR
        //   1.5x        short   405x150    0.84    95%      32.7 dB
        //   1.5x        tall    405x304    1.13    76%      27.7 dB
        //   2.0x        short   540x201    1.13    77%      27.7 dB
        //   2.0x        tall    540x405    1.50    59%      24.9 dB
        //
        // The cap is only really free where the tile DOWNSCALES. Above 1x the
        // loss is measurable, and by 1.5x it is 41% of the detail -- a dPR 2
        // tablet's tall tiles, and exactly the case a single fixed cap gets
        // wrong. So cap only when covering the tile needs no more than
        // `max_upscale`; past that, ask for the device size and let it land on
        // the sharp tier. One setting, and each tablet resolves it for itself.
        var cap = this._snapCap();
        if (cap && Math.max(w / cap.w, h / cap.h) <= this._num('max_upscale', 1.2)) {
          w = Math.min(w, cap.w); h = Math.min(h, cap.h);
        }
        q += '&width=' + w + '&height=' + h;
      }
      return q;
    }

    // `snapshot_cap: '960x540'` to buy the sharper tier back, or `false` /
    // `'none'` to ask for the true device size and let the server decide.
    // `max_upscale` is the companion: 1.0 caps only where nothing is upscaled,
    // a large number caps everything regardless of softness.
    _snapCap() {
      var v = this._config && this._config.snapshot_cap;
      if (v === false || v === 0 || v === 'none') return null;
      var m = /^(\d+)\s*x\s*(\d+)$/.exec(String(v == null ? '480x270' : v));
      if (!m) return { w: 480, h: 270 };
      return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    }

    // ONLY REFRESH WHAT IS ON SCREEN. Rendering the images here would
    // otherwise throw away the saving HA gives for free: measured on a wall
    // tablet, HA fetches snapshots only for cameras visible in the scroller
    // (4 at scrollLeft 0, 8 scrolled to the end). A naive timer over all
    // nine would take the fetch load from ~6 to 9 on the slowest tablet. A
    // generous margin so a half-visible camera still updates.
    _onScreen(el) {
      // UNMEASURABLE MEANS VISIBLE, and that is deliberate rather than lazy.
      // The first tick fires immediately after _render, BEFORE the browser has
      // laid the plate out, so every rect is 0x0 at that moment. Returning
      // false there would paint nothing until the first interval -- a ten
      // second blank on every page load. The unit tests' DOM shim has no
      // getBoundingClientRect at all, which is the same condition.
      // Showing a picture we are not sure about beats showing none.
      if (!el || typeof el.getBoundingClientRect !== 'function') return true;
      var r = el.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) return true;
      var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      if (!vw || !vh) return true;
      return r.right > -80 && r.left < vw + 80 && r.bottom > -80 && r.top < vh + 80;
    }

    // IS THE LIVE STREAM ACTUALLY SHOWING ANYTHING? Not "did the card mount"
    // -- a dead stream mounts fine and paints nothing. The only honest test is
    // the <video> element itself: readyState >= 2 means it has decoded a frame
    // to show, and currentTime > 0 means it has moved. `ha-camera-stream` puts
    // the video inside its own shadow root, hence the walk.
    // The element found is KEPT while it is still on the page in the same
    // card: the walk went through every shadow root under the tile, two or
    // three times a second all day on every tablet's Home (the age labels'
    // tick). A video the player replaces, or a remounted card, is looked
    // for again.
    _liveVideo() {
      var slot = this._liveSlot;
      if (!slot || !slot.el) return null;
      var v0 = slot._video;
      if (v0 && v0.isConnected && slot._videoIn === slot.el) return v0;
      var seen = [], found = null;
      (function walk(root, d) {
        if (!root || d > 12 || found) return;
        var kids = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (var i = 0; i < kids.length; i++) {
          var e = kids[i];
          if (e.tagName === 'VIDEO') { found = e; return; }
          if (e.shadowRoot && seen.indexOf(e.shadowRoot) < 0) {
            seen.push(e.shadowRoot); walk(e.shadowRoot, d + 1);
          }
        }
      })(slot.el, 0);
      slot._video = found; slot._videoIn = slot.el;
      return found;
    }
    _livePlaying() {
      var v = this._liveVideo();
      return !!(v && v.readyState >= 2 && v.currentTime > 0 && !v.paused);
    }

    // IS THE VIDEO COVERING THE POSTER. A weaker question than _livePlaying()
    // and a different one: the live card is z-index 1 over the poster's 0, so
    // anything with a decoded frame hides it -- playing, paused or stalled.
    // The age label keys off this, because the label describes what is on
    // screen rather than what the stream is doing.
    _liveCovering() {
      var v = this._liveVideo();
      return !!(v && v.readyState >= 2 && v.videoWidth > 0);
    }

    // KEEP A STILL UNDER THE LIVE TILE WHILE THE STREAM IS NOT PLAYING.
    //
    // This is deliberately not "refresh the poster every tick". A healthy
    // stream is the normal case, and in that case the poster is completely
    // hidden behind the video -- fetching it would be one extra 160KB request
    // every ten seconds, on a tablet least able to afford it, to update
    // something nobody can see. So: playing -> fade the poster out and fetch
    // nothing; not playing -> keep it current on the same cadence as the
    // stills, which is what turns a black hole into a slightly stale picture.
    _tickPoster(every) {
      var slot = this._liveSlot;
      if (!slot || !slot.poster || !slot.poster.imgs) return;
      // STALLED COUNTS AS NOT PLAYING, and this is the case the obvious test
      // misses: a stream that dies mid-life keeps readyState 4 and paused
      // false forever, so `_livePlaying()` alone would call a frozen tile
      // healthy. The honest question is whether currentTime MOVED since the
      // last tick, ten seconds ago -- a live video gains ~10s, a stalled one
      // gains nothing. The first tick has nothing to compare against and
      // falls back to the predicate, which is fine: at that point the stream
      // has usually not started and the poster loads anyway.
      var v = this._liveVideo();
      var playing = this._livePlaying();
      if (playing && slot._ct !== undefined && v.currentTime <= slot._ct + 0.05) {
        playing = false;
      }
      if (v) slot._ct = v.currentTime;
      this._reviveLive(slot, playing);
      if (playing) {
        // stop fetching something nobody can see -- but keep a copy of the
        // live picture under the video (_grabLive), for whenever it is gone
        slot.poster.imgs[0].classList.remove('on');
        slot.poster.imgs[1].classList.remove('on');
        if (!this._grabLive() && slot.poster.cv && !slot.poster.black) slot.poster.cv.classList.remove('on');
        return;
      }
      this._loadSlot(slot.poster, every, 0);
    }

    // THE LIVE PICTURE, COPIED UNDER THE VIDEO: the current frame drawn
    // onto the poster's canvas, cropped as the stills are. Each refresh tick
    // while it plays, and as the screensaver or a navigation takes it away,
    // so a tile whose video is gone or not yet back shows a frame at most
    // one tick old rather than nothing. One drawImage of a tile-sized canvas.
    _grabLive() {
      var slot = this._liveSlot, ps = slot && slot.poster;
      var v = this._liveVideo();
      if (!ps || !ps.ctx || !ps.cv || !v || !(v.readyState >= 2) || !v.videoWidth || !v.videoHeight) return false;
      // A BLACK COPY IS NO COPY (2026-10-09): a video the tablet draws on its
      // own surface can copy out as solid black, and the tile came back black
      // on about every third return to Home (screen-recorded). Tested on 8x8
      // pixels first; black, the last good copy stays (and stays shown).
      if (blackFrame(v)) { ps.black = true; return false; }
      ps.black = false;
      try {
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        var W = Math.max(1, Math.round(ps.cssW * dpr)), H = Math.max(1, Math.round(ps.cssH * dpr));
        if (ps.cv.width !== W) ps.cv.width = W;
        if (ps.cv.height !== H) ps.cv.height = H;
        var nw = v.videoWidth, nh = v.videoHeight, k = Math.max(W / nw, H / nh), sw = W / k, sh = H / k;
        ps.ctx.drawImage(v, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, W, H);
        ps.cv.classList.add('on');
        ps.at = Date.now();
        return true;
      } catch (e) { return false; }
    }
    // LEAVING THE PAGE, THE STILLS GO INTO THE SHARED CACHE, with the time
    // each was taken: Home's Cameras button opens the cameras page, which
    // shows a cached frame only while it is fresh (two minutes) -- written
    // every five minutes at most, they mostly were not, and its tiles came
    // up empty one by one as the streams started (screen-recorded).
    _keepStills() {
      var snaps = this._snaps || [], now = Date.now();
      for (var i = 0; i < snaps.length; i++) {
        var s = snaps[i], im = s.front >= 0 ? s.imgs[s.front] : null;
        if (!im || !s.at || now - s.at > 120000 || !s.cam || !s.cam.entity) continue;
        snapCachePut(s.cam.entity, im, true, s.at);
      }
    }
    _liveShown() {
      // a navigation that did not leave after all (the path is back)
      if (this._leaving && location.pathname === this._navPath) this._leaving = false;
      var el = this._liveSlot && this._liveSlot.el;
      if (!el || !el.classList || !el.classList.contains('wait') || this._leaving) return;
      if (!this._liveCovering()) return;
      var box = this._liveSlot.box, v = this._liveVideo(), done = false;
      if (box && box.classList) box.classList.add('lift');
      el.classList.remove('wait');
      var drop = function () {
        if (done) return;
        done = true;
        requestAnimationFrame(function () { if (box && box.classList) box.classList.remove('lift'); });
      };
      if (v && typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(drop);
      // a video that never presents (it died just now): the still goes anyway
      setTimeout(drop, v && typeof v.requestVideoFrameCallback === 'function' ? 1000 : 400);
    }

    // THE STREAM BACK AFTER THE SCREENSAVER, GENTLY (2026-10-09). Started at
    // the screensaver's stop, under the kiosk's black, its video arrived a
    // second or two later in the middle of the tablet drawing the whole
    // page again -- and the bottom of the sky's land vanished for three
    // frames (screen-recorded). So the stream starts LIVE_AFTER_WAKE after
    // the screensaver is completely gone (hk-saver-done), the copied frame
    // showing meanwhile, and fades in over it. LIVE_WAKE_MAX if that is
    // never heard.
    _wakeLiveLater() {
      var self = this, slot = this._liveSlot;
      this._cancelWakeLater();
      if (!slot || !slot.asleep) return;
      var go = function () {
        self._cancelWakeLater();
        if (self.isConnected === false) return;
        if (window.hkSaver && window.hkSaver.running && window.hkSaver.running()) return;
        self._wakeLive();
      };
      this._onSaverDone = function () {
        window.removeEventListener('hk-saver-done', self._onSaverDone); self._onSaverDone = null;
        clearTimeout(self._wakeT);
        self._wakeT = setTimeout(go, LIVE_AFTER_WAKE);
      };
      window.addEventListener('hk-saver-done', this._onSaverDone);
      this._wakeT = setTimeout(go, LIVE_WAKE_MAX);
    }
    _cancelWakeLater() {
      if (this._wakeT) { clearTimeout(this._wakeT); this._wakeT = null; }
      if (this._onSaverDone) { window.removeEventListener('hk-saver-done', this._onSaverDone); this._onSaverDone = null; }
    }

    // A DEAD STREAM IS REMOUNTED, WITH BACKOFF. Home Assistant's WebRTC
    // player does not reconnect: when go2rtc restarts (and every HA restart
    // restarts it) each live tile's peer connection goes `failed` and the
    // tile sits on a frozen or black frame until the page is reloaded. So a
    // tile that has not played for two ticks (~20 s), after a 30 s grace
    // for a fresh mount to start, is re-created -- and then not again for
    // 60 s, 120 s ... at most every 5 minutes, because a remount opens a NEW
    // WebRTC session, and opening them in a loop is exactly what knocks
    // go2rtc over. Playing resets it all.
    _reviveLive(slot, playing) {
      var now = Date.now();
      if (!slot.born) slot.born = now;
      if (playing) { slot.dead = 0; slot.backoff = 0; return; }
      if (now - slot.born < 30000) return;
      slot.dead = (slot.dead || 0) + 1;
      if (slot.dead < 2) return;
      if (slot.revived && now - slot.revived < (slot.backoff || 0)) return;
      slot.backoff = Math.min((slot.backoff || 30000) * 2, 300000);
      slot.revived = now;
      slot.dead = 0;
      this._remountLive();
    }

    // ONE LOADER FOR EVERY IMAGE ON THE PLATE. The stills and the live poster
    // share this three-way release; two copies are exactly the shape of
    // duplication where a later fix lands in one copy and not the other.
    //
    // THREE WAYS OUT, and the third is the one that matters. A hung request
    // fires NEITHER onload nor onerror -- the socket just sits there. Without
    // a timeout the slot's loading flag stays set for the life of the page, so
    // a tile that never managed a FIRST frame stays black for good with no
    // retry.
    _load(im, url, every, delay, release, onOk, onFail) {
      var done = false;
      var free = function () { if (!done) { done = true; release(); } };
      // SWAP ON DECODE, NOT ON LOAD. `onload` means the bytes arrived, not that
      // the frame can be painted: Chrome decodes a large image lazily, off the
      // main thread, at raster time. Flipping `.on` in onload could therefore
      // put an undecoded image on top for a frame -- a refresh flicker that
      // shows on a dPR 2 tablet, which rasterises these tiles at four times
      // the pixels of a dPR 1.5 one, so the decode is what loses the race
      // there. decode() resolves once the frame is ready to paint; a decode
      // that rejects still shows the image rather than stranding the tile.
      //
      // AND THEN ONE ANIMATION FRAME AFTER THAT. decode() resolving is not
      // sufficient on every engine; some Android WebViews are ones where it is
      // not. MEASURED off a 60fps recording, mean luma of the camera band, two
      // refresh cycles 9.95s apart:
      //
      //     frame 92   bright, label "9s"      the outgoing frame
      //     frame 93   -25 luma, dark, smeared THE INCOMING ONE, MID-RASTER
      //     frame 94   -14 luma, half resolved
      //     frame 95   bright, label "now"     done
      //
      // Two frames, ~33ms, of a partially painted image on top. Not an opacity
      // gap -- a probe watching both layers every frame found the combined
      // opacity never left 1.00, which is why this is invisible from the DOM
      // and only a camera can see it.
      //
      // So the swap waits for a frame boundary after decode settles, which
      // gives the compositor one opportunity to raster the incoming image
      // while it is still hidden. It costs ~16ms on a swap that happens every
      // ten seconds. It covers BOTH ways this engine can betray the promise --
      // a decode that rejects (the reject path shows the image regardless, by
      // design, so it must be delayed too) and a decode that resolves before
      // the frame is really ready.
      //
      // THAT ALONE IS NOT ENOUGH, and the canvas is what fixes it -- see the
      // .snap CSS. The frame of grace stays: the canvas draw happens inside it,
      // so the new picture lands in exactly one frame.
      var show = function () {
        free();
        if (typeof requestAnimationFrame !== 'function') { onOk(); return; }
        requestAnimationFrame(function () { onOk(); });
      };
      im.onload = function () {
        if (typeof im.decode !== 'function') { show(); return; }
        im.decode().then(show, show);
      };
      // A camera that 401s or refuses. The slot is freed, and onFail marks
      // the credential spent (see _srcFor) so the next tick does not ask
      // with it again.
      im.onerror = function () { free(); if (onFail) onFail(); };
      // shorter than the refresh interval, so the very next tick retries
      // rather than waiting a whole cycle
      setTimeout(free, Math.max(2000, every * 1000 * 0.8));
      if (delay) setTimeout(function () { im.src = url; }, delay);
      else im.src = url;
    }

    // ONE SLOT'S REFRESH, separately callable so a reveal can freshen a single
    // tile without running the whole plate. Returns whether it actually fired.
    _loadSlot(s, every, order) {
      var pic = this._picOf(s.cam);
      var src = this._srcFor(s.cam, s);
      if (!src) return false;
      var next = (s.front + 1) % 2;
      if (s.loading[next]) return false;              // still fetching this one
      s.loading[next] = true;
      var self = this;
      // THE IIFE IS LOAD-BEARING. Everything the deferred callbacks touch has
      // to be a parameter: with `src` as a plain `var` in the caller's scope,
      // the staggered assignments would all read the LAST iteration's value,
      // and every tile would load the same camera.
      (function (slot, idx, im, u, p) {
        self._load(im, u, every, order * 220,
          function () { slot.loading[idx] = false; },
          function () {
            im.classList.add('on');
            var other = slot.imgs[(idx + 1) % 2];
            if (other !== im) other.classList.remove('on');
            slot.front = idx;
            self._blit(slot, im);            // what you actually see -- see .snap CSS
            slot.at = Date.now();            // drives the reveal check + label
            // _tickAges, NOT a direct write. Stamping 'now' here would be a
            // SECOND COPY of the label rule, one that does not know about the
            // live tile: when the poster refreshes under a stream that is already
            // covering it, it would print "now" over live video until the
            // once-a-second tick cleared it again. One rule, one place.
            self._tickAges();
            snapCachePut(slot.cam.entity, im);
          },
          function () { slot.badPic = p; });  // this credential failed: not again
      })(s, next, s.imgs[next], src, pic);
      return true;
    }

    // HOW OLD IS THE FRAME ON SCREEN. The Home app's wording exactly: the
    // moment after a refresh reads "now", then it counts seconds. The Home
    // app never gets past 10s because it refreshes on that cadence and
    // resets -- ours can,
    // because a tile scrolled off-screen deliberately stops refreshing, and in
    // that case saying "4m" is more honest than a stale picture with no label.
    _ageText(at) {
      if (!at) return '';
      var s = Math.floor((Date.now() - at) / 1000);
      if (s < 1)    return 'now';
      if (s < 60)   return s + 's';
      if (s < 3600) return Math.floor(s / 60) + 'm';
      return Math.floor(s / 3600) + 'h';
    }

    // Once a second, and it only writes when the STRING changes -- the label is
    // nine text nodes and this runs on a 4GB tablet too.
    // THE TICK IS 1Hz AND THE VIDEO DOES NOT WAIT FOR IT. Without these, a
    // label lingers ~180ms on the frame where the stream begins covering,
    // because that happens between ticks. `loadeddata`
    // and `playing` fire exactly at that transition, so one shot each removes
    // the flicker with no ongoing cost -- unlike `timeupdate`, which fires
    // ~4Hz forever for a 180ms problem.
    //
    // The flag lives on the ELEMENT, so a video replaced by a navigation or by
    // _remountLive is wired again on the next tick without any bookkeeping.
    _wireLiveLabel() {
      var v = this._liveVideo();
      if (!v || v.__hkAgeWired || !v.addEventListener) return;
      v.__hkAgeWired = true;
      var self = this;
      var sync = function () { self._tickAges(); };
      v.addEventListener('loadeddata', sync);
      v.addEventListener('playing', sync);
    }

    _tickAges() {
      this._wireLiveLabel();
      this._liveShown();
      var list = (this._snaps || []).slice();
      var ps = this._liveSlot && this._liveSlot.poster;
      if (ps) list.push(ps);
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s.age) continue;
        // THE LABEL BELONGS TO THE POSTER, and the test has to be "is the
        // poster what you can SEE" -- not "does a poster image still carry
        // .on".
        //
        // Those are different for up to TEN SECONDS. The poster sits at
        // z-index 0 and the live card at 1, so the video covers it the instant
        // it has a frame -- but the .on class is only cleared by _tickPoster,
        // which runs on the refresh interval. Measured: the stream playing at
        // t=7.5s with a poster image still .on and the label reading "7s". A
        // counter ticking over live video is exactly the lie the comment above
        // is written to prevent. It shows most often after leaving the
        // dashboard and coming back, which restarts the cycle.
        //
        // `videoWidth > 0` rather than _livePlaying(): the question is whether
        // the video is COVERING the poster, and a stream that has stalled on a
        // frame is still covering it. Labelling a frozen frame "3s" would be
        // the same lie in the other direction -- that is what _tickPoster's
        // stall detection and _remountLive are for.
        var showing = (s !== ps) || !this._liveCovering();
        var t = showing ? this._ageText(s.at) : '';
        if (s.age.textContent !== t) s.age.textContent = t;
      }
    }

    _tick() {
      // ONLY ON THE PAGE (`=== false`: the test DOM has no isConnected).
      if (this.isConnected === false) return;
      // ...and not on the way out: the page is changing (the now-playing bar
      // closing with it set this going) -- new stills for a page being left
      // were 11-18 ms of a tablet's page change (Master Bedroom, measured)
      // (the address, not _leaving: the bar closes before _onNav has heard)
      if (this._navPath && location.pathname !== this._navPath) return;
      // PAUSED WHILE A POP-UP COVERS THE PAGE. Each refresh swaps a decoded
      // snapshot onto a new layer; under the #alarm sheet's backdrop-filter,
      // that makes the tablet re-blur the whole region, and the entire screen
      // flashes on the strip's 10 s beat while the sheet is up. The strip is
      // under the dimmed backdrop anyway, so nothing is lost -- and it catches
      // up the moment the last sheet closes.
      // KEPT ON `this` SO _stopTimer CAN TAKE IT OFF AGAIN. An anonymous
      // handler with no reference would stay on `window` for the life of the
      // page holding this card -- and the card holds its decoded snapshots --
      // alive after the strip was gone. Every listener this card owns is
      // removed on disconnect.
      if (!this._onPopup) {
        var self = this;
        this._onPopup = function (e) {
          if (e.detail && (e.detail.cover || 0) === 0 && self.isConnected) self._tick();
        };
        window.addEventListener('hk-popup-change', this._onPopup);
      }
      // hkPopupCover, NOT hkPopupOpen. The pause exists to stop a decoded
      // snapshot being swapped under a backdrop-filter; a `modal: false`
      // sheet has no backdrop and covers ~80px, so pausing for it would freeze
      // every tile for as long as it is up -- which for the now-playing bar is
      // "while music plays". See the two counts in hk-popup.js.
      if ((window.hkPopupCover || 0) > 0) return;
      // NOT WHILE THE SOCKET IS DOWN. Every still URL carries a camera access
      // token that HA rotates, and a restart invalidates them all. A tick
      // between the drop and the reconnect asks the new HA with the old token:
      // one restart can log dozens of "invalid authentication" warnings from a
      // few tablets in seconds -- exactly what a home with ip_ban_enabled would
      // ban them for. The reconnect brings a fresh hass with fresh tokens, and
      // the next tick resumes on its own.
      if (this._hass && this._hass.connected === false) return;
      var snaps = this._snaps || [];
      var every = this._num('refresh', 10);
      if (every <= 0) every = 10;                     // timeout basis only
      this._tickPoster(every);
      var fired = 0;
      for (var i = 0; i < snaps.length; i++) {
        var s = snaps[i];
        // A COLD SLOT IGNORES THE VISIBILITY GATE. Measured on a wall tablet:
        // the plate is 1764px on a 1280px viewport, so the last column sits at
        // left=1484 against a cutoff of innerWidth+80 -- slots 7 and 8 would
        // never be requested AT ALL on a page load, and the scroller only
        // reveals them later: not a failed fetch, an omitted one, and black
        // tiles. The gate's job is to stop REFRESHING what nobody is looking
        // at; it has no business withholding a tile's FIRST frame, which is
        // what the user sees the moment they scroll. front < 0 means this slot
        // has never painted.
        if (s.front >= 0 && !this._onScreen(s.box)) continue;
        // STAGGER, so eight tiles do not stampede: `fired` only advances when
        // a request actually goes out, spreading them 220ms apart.
        if (this._loadSlot(s, every, fired)) fired++;
      }
    }

    // REMOUNT THE LIVE TILE ON WAKE, so no external machinery is needed to
    // bring the streams back (such as an input_boolean per room that a
    // wake script toggles, tearing down one conditional copy of the strip
    // and building another).
    //
    // The eight stills do not need any of it -- they are plain <img> on this
    // card's own timer, which ticks the instant the screen wakes. The LIVE
    // tile is still a picture-entity with a real stream, so it is the only
    // thing that could come back dead. Re-creating that ONE card is a far
    // smaller hammer than rebuilding the whole strip, and it keeps the
    // stills' loaded frames.
    _remountLive() {
      var slot = this._liveSlot;
      if (!slot || !slot.el || !slot.el.parentNode) return;
      var old = slot.el;
      var fresh = this._pic(slot.cam, true, slot.ar);
      if (VIDEO_OUTSIDE && fresh.classList) fresh.classList.add('wait');
      // The grid placement lives on the .live BOX, not on the card -- the card
      // is absolutely positioned inside it -- so there is nothing to copy over.
      old.parentNode.replaceChild(fresh, old);
      releaseMedia(old);
      this._children = (this._children || []).filter(function (k) { return k !== old; });
      slot.el = fresh;
      slot.born = Date.now();                  // a fresh mount gets its grace
      slot._ct = undefined;
    }

    // THE LIVE TILE BEHIND THE SCREENSAVER: its card (and so its stream) is
    // swapped for an empty box while the photos show, and a fresh one comes
    // back after (_remountLive). Its revive backoff never sees the gap: the
    // interval that counts dead frames is stopped for exactly as long.
    // RESTING (2026-10-10): a black screen is up, or the photos cover the
    // page. A render then -- Live Camera Follows picking another camera, a
    // rebuild -- builds the live tile ASLEEP: measured on the Kitchen, a pick
    // 6 s after its black went up mounted a fresh stream that decoded under
    // the black for as long as it lasted (~70 % of a core). The black's end,
    // the photos' or the page coming back wakes it, as it does any sleeper.
    _resting() {
      if (this._black) return true;
      var K = window.hkSky;
      if (K && K.dark && K.dark()) return true;
      var V = window.hkSaver;
      return !!(V && V.covered && V.covered());
    }
    _sleepLive() {
      var slot = this._liveSlot;
      if (!slot || slot.asleep || !slot.el || !slot.el.parentNode) return;
      this._grabLive();
      var old = slot.el, ph = document.createElement('div');
      old.parentNode.replaceChild(ph, old);
      releaseMedia(old);
      this._children = (this._children || []).filter(function (k) { return k !== old; });
      slot.el = ph;
      slot.asleep = true;
    }
    _wakeLive() {
      var slot = this._liveSlot;
      if (!slot || !slot.asleep) return;
      slot.asleep = false;
      this._remountLive();
    }

    // REFRESH A TILE THE MOMENT IT IS SCROLLED INTO VIEW. Without this, a tile
    // revealed after five minutes shows its five-minute-old first frame until
    // the next interval tick -- never black (the cold-slot rule guarantees a
    // frame) but up to ten seconds stale at exactly the moment someone is
    // looking at it.
    //
    // Only ALREADY-PAINTED slots are handled here (`front < 0` returns early).
    // Cold slots are _tick's job, it ignores the gate for them, and skipping
    // them removes the startup race: the observer fires on observe() with the
    // initial state, which would otherwise double-request every visible tile.
    _watchReveal() {
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (typeof IntersectionObserver !== 'function') return;   // jsdom, tests
      var self = this;
      this._io = new IntersectionObserver(function (entries) {
        var every = self._num('refresh', 10);
        if (every <= 0) every = 10;
        var now = Date.now();
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          var s = null, snaps = self._snaps || [];
          for (var j = 0; j < snaps.length; j++) {
            if (snaps[j].box === entries[i].target) { s = snaps[j]; break; }
          }
          if (!s || s.front < 0) continue;                 // _tick owns cold
          if (s.at && now - s.at < every * 1000) continue; // fresh enough
          self._loadSlot(s, every, 0);
        }
      }, { rootMargin: '80px' });
      var snaps = this._snaps || [];
      for (var k = 0; k < snaps.length; k++) this._io.observe(snaps[k].box);
    }

    _startInterval() {
      this._stopInterval();
      var every = this._num('refresh', 10);
      var self = this;
      // Paint at once so the plate is never empty, then again on the next
      // frame once layout exists, so the visibility test above has real rects
      // to work with rather than the all-zero ones it sees pre-layout. The
      // first frame is owed whatever `refresh` says: 0 means "never again",
      // not "never".
      // COMING BACK WITH ITS PAGE (a cached Home re-attached) the plate still
      // holds its stills: the frame's tick alone. Ticked at once, in the
      // middle of the page's build, the visibility test laid the half-built
      // page out (measured headless, 6x slower: ~34 ms of each return to
      // Home); at the frame's start the build is done and that layout is the
      // frame's own.
      if (!this._painted || typeof requestAnimationFrame !== 'function') this._tick();
      this._painted = true;
      // Kept, so a strip detached before that frame cancels it: run on a
      // detached card it registered the pop-up listener again and fetched
      // stills for nobody, holding the card for the life of the page.
      if (typeof requestAnimationFrame === 'function') {
        this._raf = requestAnimationFrame(function () { self._raf = null; self._tick(); });
      }
      if (every > 0) this._timer = setInterval(function () { self._tick(); }, every * 1000);
      // every second whether or not the labels show: it is also what brings
      // the live card back once its video has a picture (_liveShown)
      this._tickAges();
      this._ages = setInterval(function () { self._tickAges(); }, 1000);
    }

    // The listener is registered ONCE and kept, separately from the interval.
    // A handler that calls _startTimer(), which begins by removing the very
    // listener that is mid-call, works only by accident of how the browser
    // snapshots the listener list.
    _startTimer() {
      // Only on the page. _render calls this too, and a card fed `hass`
      // before it is attached (an editor preview, a row rebuilding) must not
      // start fetching stills nobody can see; connectedCallback starts it.
      // (`=== false`: the test DOM has no isConnected at all.)
      if (this.isConnected === false) return;
      var self = this;
      if (!this._vis) {
        // A wall tablet spends most of its life behind the screensaver.
        // Ticking there is pure waste -- and on a 4GB tablet, waste that
        // matters. document.hidden covers a backgrounded tab; HK's overlay
        // has its own lifecycle below.
        this._vis = function () {
          if (document.hidden) { self._stopInterval(); return; }
          if (window.hkSaver && window.hkSaver.covered && window.hkSaver.covered()) return;
          // put to sleep by a saver that was dismissed while the page was
          // hidden (its hk-saver event bailed): wake it, or the next cover
          // finds it "asleep" and leaves its stream decoding all night
          var slot = self._liveSlot;
          if (slot && slot.asleep) self._wakeLive(); else self._remountLive();
          self._startInterval();
        };
        document.addEventListener('visibilitychange', this._vis);
      }
      // ...AND BEHIND HK FRONTEND'S OWN PHOTO SCREENSAVER (hk-saver.js), which
      // does not hide the page from the browser: the stills stop as it starts,
      // and once it covers the dashboard (hk-saver-covered) the live tile lets
      // go of its stream (a WebRTC video decoded continuously for nobody --
      // ~10 % of a core, measured 2026-09-29). The photos going away brings
      // a fresh live tile back, the way a stalled stream is revived, and the
      // stills straight back.
      if (!this._onSaver) {
        this._onSaver = function (e) {
          // Stop still refreshes immediately, but leave the live picture in
          // place through the entrance fade. Removing it here flashes the
          // poster while the user can still see the mosaic.
          if (e && e.detail && e.detail.on) { self._grabLive(); self._stopInterval(); return; }
          if (document.hidden) return;
          self._startInterval();
          self._wakeLiveLater();
        };
        window.addEventListener('hk-saver', this._onSaver);
      }
      // UNDER THE KIOSK'S BLACK SCREENSAVER (2026-10-09): the same rest as
      // behind the photos. The page runs there but nothing is drawn, so the
      // stills were fetched and the live stream decoded for nobody -- and it
      // all resumed in the very moment of the wake, while the tablet drew the
      // whole page again: the bottom of the sky's scenery went missing for
      // three frames (screen-recorded on the Loft; none on a page without
      // the strip). So the frame is kept, everything stops, and starts again
      // AFTER_BLACK after the black has ended.
      if (!this._onBlack) {
        this._onBlack = function (e) {
          // (hk-black: HK's own black screen, or any black -- hk-saver.js)
          var up = e && (e.type === 'kiosksatellite:screensaverstart' || e.type === 'kiosksatellite:screenoff' ||
                         (e.type === 'hk-black' && !!(e.detail && e.detail.on)));
          clearTimeout(self._blackT); self._blackT = null;
          if (up) { self._black = true; self._grabLive(); self._stopInterval(); self._sleepLive(); return; }
          self._blackT = setTimeout(function () {
            self._blackT = null;
            self._black = false;
            if (self.isConnected === false || document.hidden) return;
            // behind the photos still: theirs to bring back (hk-saver events)
            if (window.hkSaver && window.hkSaver.running && window.hkSaver.running()) return;
            self._startInterval();
            self._wakeLive();
          }, AFTER_BLACK);
        };
        ['kiosksatellite:screensaverstart', 'kiosksatellite:screensaverstop',
         'kiosksatellite:screenoff', 'kiosksatellite:screenon', 'hk-black'].forEach(function (t) {
          window.addEventListener(t, self._onBlack);
        });
      }
      // LEAVING THE PAGE: its stills kept for the cameras page. A pop-up
      // opening changes the query, not the path, and is not a leave.
      this._navPath = location.pathname;
      this._leaving = false;
      if (!this._onNav) {
        this._onNav = function () {
          if (location.pathname === self._navPath) return;
          // (no copy of the live frame and no hiding the live tile till it
          // has a picture again: two video read-backs, 18-27 ms of a tablet's
          // page change, for a frame that is seldom seen -- 2026-10-11)
          self._keepStills();
          self._leaving = true;
        };
        window.addEventListener('location-changed', this._onNav);
      }
      if (!this._onSaverCovered) {
        this._onSaverCovered = function () { self._stopInterval(); self._sleepLive(); };
        window.addEventListener('hk-saver-covered', this._onSaverCovered);
      }
      // THE OBSERVER BELONGS HERE, NOT IN _render. _stopTimer disconnects it,
      // and _stopTimer runs on disconnectedCallback -- HA detaches and
      // reattaches cards while it lays a view out, so with the setup in
      // _render the observer would be torn down and never rebuilt (`_io` null
      // on a live page even though _render had plainly run). Setup and
      // teardown have to be the same pair of functions.
      this._watchReveal();
      // Cards can be reattached or rebuilt while the screensaver is up.
      if (window.hkSaver && window.hkSaver.covered && window.hkSaver.covered()) this._onSaverCovered();
      else if (!(window.hkSaver && window.hkSaver.running && window.hkSaver.running()) && !this._resting()) this._startInterval();
    }
    _stopInterval() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._ages) { clearInterval(this._ages); this._ages = null; }
      if (this._raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    _stopTimer() {
      this._stopInterval();
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (this._vis) { document.removeEventListener('visibilitychange', this._vis); this._vis = null; }
      if (this._onSaver) { window.removeEventListener('hk-saver', this._onSaver); this._onSaver = null; }
      if (this._onSaverCovered) { window.removeEventListener('hk-saver-covered', this._onSaverCovered); this._onSaverCovered = null; }
      if (this._onPopup) { window.removeEventListener('hk-popup-change', this._onPopup); this._onPopup = null; }
      if (this._onNav) { window.removeEventListener('location-changed', this._onNav); this._onNav = null; }
      if (this._onBlack) {
        var ob = this._onBlack;
        ['kiosksatellite:screensaverstart', 'kiosksatellite:screensaverstop',
         'kiosksatellite:screenoff', 'kiosksatellite:screenon', 'hk-black'].forEach(function (t) { window.removeEventListener(t, ob); });
        this._onBlack = null;
      }
      if (this._blackT) { clearTimeout(this._blackT); this._blackT = null; }
      this._cancelWakeLater();
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._config && this._hass) this._startTimer();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      this._stopTimer();
    }

    _render() {
      if (!this._root || !this._config || !this._hass) return;
      this._root.textContent = '';
      this._snaps = [];
      this._liveSlot = null;          // an empty `cameras:` must not keep the old poster ticking
      this._stopTimer();
      var plan = this._plan();
      if (!plan) return;

      var H    = this._num('height', 202.5);
      var SEAM = this._num('seam', 2);
      var liveW = Math.round(H * this._num('live_ratio', 16 / 9));
      var colW  = Math.round(H * this._num('column_ratio', 4 / 3));
      // ONE CAMERA, NO LIVE TILE (a room with a single camera): one still,
      // the live tile's 16:9 -- not a lone column, which read as a crop
      if (!plan.live && plan.cols.length === 1 && plan.cols[0].length === 1) colW = liveW;
      var halfH = (H - SEAM) / 2;

      this._children = [];
      var plate = document.createElement('div');
      plate.className = 'plate';
      var tracks = plan.live ? [liveW + 'px'] : [];
      for (var i = 0; i < plan.cols.length; i++) tracks.push(colW + 'px');
      plate.style.gridTemplateColumns = tracks.join(' ');
      plate.style.gridTemplateRows = halfH + 'px ' + halfH + 'px';
      plate.style.gap = SEAM + 'px';
      plate.style.height = H + 'px';
      plate.style.borderRadius = (this._config.radius || C.M.radius);
      plate.style.background = (this._config.seam_color || '#0b0d12');
      plate.style.boxShadow = (this._config.shadow || 'var(--hk-look-shadow, 0 8px 22px rgba(0,0,0,0.12))');

      if (plan.live && plan.still) {
        // slot 1 as a snapshot (Live First Camera off): the same box, no stream
        var first = this._snap(plan.live, liveW, H);
        first.style.gridColumn = '1';
        first.style.gridRow = '1 / 3';
        plate.appendChild(first);
      } else if (plan.live) {
        // slot 1: the live camera, full height, uncropped
        var liveAr = liveW + 'x' + Math.round(H);
        // no live card on a state the new server has not sent (see _sigOf): the
        // poster holds the slot until the camera is back
        var stale = C.stale(this._hass.states[plan.live.entity]), resting = !stale && this._resting();
        var lv = stale || resting ? document.createElement('div') : this._pic(plan.live, true, liveAr);
        if (VIDEO_OUTSIDE && lv.classList) lv.classList.add('wait');
        var liveBox = document.createElement('div');
        liveBox.className = 'live';
        liveBox.style.gridColumn = '1';
        liveBox.style.gridRow = '1 / 3';
        var pa = document.createElement('img'), pb = document.createElement('img');
        pa.decoding = 'async'; pb.decoding = 'async'; pa.alt = ''; pb.alt = '';
        var liveAge = null;
        if (this._config.show_age !== false) {
          liveAge = document.createElement('span');
          liveAge.className = 'age';
        }
        // The poster canvas goes FIRST so it stays under the live card (z 1).
        var pcv = this._canvasFor(liveBox);
        if (pcv.el) liveBox.append(pcv.el);
        liveBox.append(pa, pb, lv);
        if (liveAge) liveBox.appendChild(liveAge);
        // EVERY live tile takes its tap on the box, pop-up or not: left to
        // picture-entity, whose touch handler swallows the click, a finger
        // would open nothing -- and its more-info would go to HA's dialog. The
        // box opens the camera sheet.
        var me = this, liveCam = plan.live;
        liveBox.classList.add('pop', 'tap');
        liveBox.addEventListener('click', function () { me._openCam(liveCam); });
        plate.appendChild(liveBox);
        // The poster is SLOT-SHAPED on purpose: it then goes through the exact
        // same _loadSlot path as the stills -- double buffer, three-way release,
        // hard swap -- instead of a second copy of that logic.
        this._liveSlot = {
          el: lv, cam: plan.live, ar: liveAr, box: liveBox,
          poster: { box: liveBox, cam: plan.live, imgs: [pa, pb], front: -1,
                    loading: [false, false], cssW: liveW, cssH: H, age: liveAge,
                    cv: pcv.el, ctx: pcv.ctx }
        };
        // built resting: asleep, for the wake to remount (_resting)
        if (resting) this._liveSlot.asleep = true;
        this._wireRestore(this._liveSlot.poster);
      }

      var self = this;
      plan.cols.forEach(function (col, n) {
        var track = n + (plan.live ? 2 : 1);     // slot 1 is the live tile, when there is one
        if (col.length === 2) {
          [1, 2].forEach(function (rowN, k) {
            var el = self._snap(col[k], colW, halfH);
            el.style.gridColumn = String(track);
            el.style.gridRow = String(rowN);
            plate.appendChild(el);
          });
        } else {
          var el2 = self._snap(col[0], colW, H);
          el2.style.gridColumn = String(track);
          el2.style.gridRow = '1 / 3';
          plate.appendChild(el2);
        }
      });
      this._root.appendChild(plate);
      this._startTimer();
    }

    // HASS MUST REACH THE CHILDREN, and HkBase's setter does not do it --
    // it only gates the re-render. hk-row-card overrides for the same reason.
    // Without this the picture-entity cards keep whatever hass they were built
    // with and go stale between selector changes, which is most of the time
    // (this card deliberately re-renders only when the live camera changes).
    set hass(h) {
      this._hass = h;
      C.seen(h);                     // HkBase's hub: the reconnect hook (hk-base.js STALE)
      var kids = this._children || [];
      for (var i = 0; i < kids.length; i++) kids[i].hass = h;

      // NO WAKE-REBUILD HOOK, and that is a measured decision rather than an
      // omission. Swapping between two conditional copies of the strip on
      // every wake, purely to re-establish the camera streams after photo
      // mode, belongs to setups where WebRTC registration was unreliable per
      // restart.
      //
      // Tested on a wall tablet with nothing rebuilding the strip, across a
      // full WallPanel + Fully screensaver cycle:
      //
      //     pre  readyState 1  t= 0.0
      //     pre2 readyState 4  t=18.4      running before the sleep
      //     post readyState 4  t=80.4      still running after the wake
      //     post2 readyState 4 t=88.4      +8.0s in 8s -- genuinely live
      //
      // The stream never stopped. It cannot: the same run showed neither
      // screensaver makes the page hidden (visEvents=0, everHidden=0), so the
      // webview is never backgrounded and nothing tears the video down.
      //
      // The visibilitychange handler below stays. It is inert on a wall tablet
      // for the same reason, but a phone's tab really does background, and
      // there a returning stream does need remounting.
      var sig = this._sigOf();
      if (sig !== null && sig === this._hkSig) return;
      this._hkSig = sig;
      this._render();
    }
    get hass() { return this._hass; }

    // Two rows of tiles at ~100px each; HA only needs a rough number.
    getCardSize() { return 2; }

    static getConfigElement() {
      return document.createElement('hk-camera-mosaic-editor');
    }
    // THE HOUSE'S FIRST THREE CAMERAS, so the picker's card shows something:
    // an empty list draws nothing at all. No selector: the first is live.
    static getStubConfig(hass) {
      var ids = hass && hass.states ? Object.keys(hass.states) : [];
      var cams = ids.filter(function (id) { return id.indexOf('camera.') === 0; }).slice(0, 3);
      return { cameras: cams.map(function (id) { return { entity: id }; }) };
    }
  }
  // ---- editor -----------------------------------------------------------
  // A CUSTOM EDITOR, because ha-form cannot express this config. The scalars
  // (selector, height, seam) are a plain schema and go through hkEditor like
  // every other card here; the CAMERA LIST is an ordered list of objects with
  // add / remove / move, and `ha-form` has no selector for that.
  //
  // Built from plain <select>/<input>/<button> rather than ha-entity-picker and
  // friends. Those are nicer, but they are HA frontend internals with no
  // compatibility promise, and depending on undocumented behaviour has
  // cost this file before. A dropdown of camera entities is enough for a
  // strip of cameras.
  //
  // THE `option` FIELD IS A DROPDOWN OF THE SELECTOR'S OWN OPTIONS, not free
  // text. It has to match what the selector reports or that camera can
  // never be the live one -- a typo there fails silently and looks like a
  // broken camera. Reading the options off the entity makes it unmissable.
  class HkCameraMosaicEditor extends HTMLElement {
    setConfig(config) {
      this._config = Object.assign({ cameras: [] }, config);
      if (!Array.isArray(this._config.cameras)) this._config.cameras = [];
      this._build();
    }
    set hass(h) {
      this._hass = h;
      if (this._form) this._form.hass = h;
      // Only the pickers depend on hass; rebuilding on every hass would throw
      // away focus mid-typing.
      if (!this._builtOnce) this._build();
    }
    get hass() { return this._hass; }

    _emit() {
      var cfg = Object.assign({}, this._config);
      cfg.cameras = (cfg.cameras || []).filter(function (c) { return c && c.entity; });
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: cfg }, bubbles: true, composed: true
      }));
    }

    _cameraEntities() {
      var h = this._hass;
      if (!h) return [];
      return Object.keys(h.states).filter(function (e) {
        return e.indexOf('camera.') === 0;
      }).sort();
    }
    _selectorOptions() {
      var h = this._hass, sel = this._config && this._config.selector;
      if (!h || !sel || !h.states[sel]) return [];
      return (h.states[sel].attributes.options || []).slice();
    }

    _build() {
      if (!this._config) return;
      this._builtOnce = true;
      this.textContent = '';
      var self = this;

      // scalars, via the shared schema editor
      this._form = document.createElement(hkEditor('hk-camera-mosaic-card', [
        // NOT required: with none the first camera is the live one. Either
        // kind of list picks it (_selector reads its state and options).
        { name: 'selector', label: 'Live Camera Follows',
          selector: { entity: { filter: { domain: ['input_select', 'select'] } } },
          helper: 'A list whose choice is the camera shown live. Empty: the first camera.' },
        { type: 'grid', name: '', schema: [
          { name: 'own_cameras', label: 'Use These Cameras', selector: { boolean: {} },
            helper: 'On: this card\'s cameras, not the screen\'s camera list in HK Settings.' },
          { name: 'stills_only', label: 'Snapshots Only', selector: { boolean: {} } },
          { name: 'height', selector: { number: { min: 80, max: 400, step: 0.5, mode: 'box' } },
            helper: 'Strip height in px.' },
          { name: 'refresh', selector: { number: { min: 0, max: 120, step: 1, mode: 'box' } } },
          { name: 'seam', selector: { number: { min: 0, max: 12, step: 1, mode: 'box' } } },
          { name: 'radius', selector: { text: {} }, helper: 'Default 23.5px.' }
        ] }
      ]));
      this._form.hass = this._hass;
      this._form.setConfig(this._config);
      this._form.addEventListener('config-changed', function (ev) {
        ev.stopPropagation();
        // keep the camera list, which that form knows nothing about
        var cams = self._config.cameras;
        self._config = Object.assign({}, ev.detail.config);
        self._config.cameras = cams;
        self._emit();
      });
      this.appendChild(this._form);

      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:14px';
      var h4 = document.createElement('div');
      h4.textContent = 'Cameras, in order. For each: the camera, the selector option that makes it live, and a name. A tap opens the camera\'s sheet.';
      h4.style.cssText = 'font-weight:600;margin:0 0 8px 0;opacity:.85';
      wrap.appendChild(h4);

      var ents = this._cameraEntities();
      var opts = this._selectorOptions();
      (this._config.cameras || []).forEach(function (cam, i) {
        wrap.appendChild(self._row(cam, i, ents, opts));
      });

      var add = document.createElement('button');
      add.textContent = '+ Add camera';
      add.style.cssText = 'margin-top:8px;padding:6px 12px;cursor:pointer';
      add.addEventListener('click', function () {
        self._config.cameras = (self._config.cameras || []).concat(
          [{ name: '', option: '', entity: '' }]);
        self._build(); self._emit();
      });
      wrap.appendChild(add);
      this.appendChild(wrap);
    }

    _row(cam, i, ents, opts) {
      var self = this;
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';

      var ent = document.createElement('select');
      ent.style.cssText = 'flex:2 1 0;min-width:0';
      [''].concat(ents).forEach(function (e) {
        var o = document.createElement('option');
        o.value = e; o.textContent = e || '— pick a camera —';
        if (e === cam.entity) o.selected = true;
        ent.appendChild(o);
      });
      ent.addEventListener('change', function () {
        cam.entity = ent.value; self._emit();
      });

      var opt = document.createElement('select');
      opt.style.cssText = 'flex:1 1 0;min-width:0';
      [''].concat(opts).forEach(function (o1) {
        var o = document.createElement('option');
        o.value = o1; o.textContent = o1 || '— selector option —';
        o.title = 'The selector option that shows this camera live';
        if (o1 === cam.option) o.selected = true;
        opt.appendChild(o);
      });
      opt.addEventListener('change', function () {
        cam.option = opt.value;
        if (!cam.name) cam.name = opt.value;
        self._emit();
      });

      var nm = document.createElement('input');
      nm.type = 'text'; nm.placeholder = 'name';
      nm.value = cam.name || '';
      nm.style.cssText = 'flex:1 1 0;min-width:0';
      nm.addEventListener('input', function () { cam.name = nm.value; self._emit(); });

      function btn(label, title, fn) {
        var b = document.createElement('button');
        b.textContent = label; b.title = title;
        b.style.cssText = 'padding:4px 8px;cursor:pointer';
        b.addEventListener('click', fn);
        return b;
      }
      var up = btn('↑', 'Move up', function () { self._move(i, -1); });
      var dn = btn('↓', 'Move down', function () { self._move(i, 1); });
      var rm = btn('✕', 'Remove', function () {
        self._config.cameras.splice(i, 1); self._build(); self._emit();
      });
      up.disabled = i === 0;
      dn.disabled = i === (this._config.cameras.length - 1);

      row.append(ent, opt, nm, up, dn, rm);
      return row;
    }

    _move(i, d) {
      var a = this._config.cameras, j = i + d;
      if (j < 0 || j >= a.length) return;
      var t = a[i]; a[i] = a[j]; a[j] = t;
      this._build(); this._emit();
    }
  }
  if (!customElements.get('hk-camera-mosaic-editor')) {
    customElements.define('hk-camera-mosaic-editor', HkCameraMosaicEditor);
  }

  if (!customElements.get('hk-camera-mosaic-card')) {
    // its size in HA's Sections view (hk-base.js GRID)
    if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-camera-mosaic-card', HkCameraMosaicCard);
    customElements.define('hk-camera-mosaic-card', HkCameraMosaicCard);
  }

  // ------------------------------------------------------------------
  // THE CAMERAS PAGE'S TILES TAKE TURNS GOING LIVE (2026-10-09).
  //
  // Nine live cameras opened at once, and desktop Safari could not connect
  // them: each WebRTC connection sat in ICE "checking" for good, go2rtc
  // dropping the browser's candidates as not matching the session ("doesn't
  // match the current ufrags"). In a WebKit window, A/B: one live camera
  // connected 3 of 3 times; the page's nine connected in 2 of 12 tries,
  // with or without this file's other modules. Chrome connected all nine
  // every time. So the page's tiles open one at a time: each shows the
  // camera's still (a `camera_view: auto` picture card), and when its turn
  // comes the live card is laid over it. LIVE_AT_ONCE connect together (in
  // the WebKit window, three at a time: all nine live in 3 tries of 3, the
  // last 4-6 s after the first; one at a time took the ninth 18 s); a turn
  // ends as soon as its video plays, or LIVE_TURN_MS on at the most. A video with no
  // picture by LIVE_STUCK_MS is opened again (LIVE_RETRIES times). The still
  // goes once the video plays, so a tile is never blank.
  //
  // `hk-camera-live-card` is the strategy's (hk-strategy.js, the Cameras
  // page); it takes `entity`, `aspect_ratio` and `fit_mode`.
  var LIVE_AT_ONCE = 3, LIVE_TURN_MS = 2500, LIVE_STUCK_MS = 8000, LIVE_RETRIES = 3, LIVE_POLL_MS = 250;
  // A TILE WAITING ITS TURN SHOWS THE LAST FRAME KEPT FOR ITS CAMERA (the
  // shared cache: the Home strip's stills, this page's frames as it is left)
  // at once -- not Home Assistant's loading ring while it fetches the still --
  // until that still has loaded or the video plays. Older than SAVED_MAX_MS,
  // no frame at all: the ring, as before.
  var SAVED_MAX_MS = 15 * 60 * 1000, SAVED_GIVE_UP_MS = 20000, LIVE_PRESENT_MS = 1200;
  function loadedImg(root) {
    var stack = [root], n = 0;
    while (stack.length && n++ < 400) {
      var e = stack.pop();
      if (e.tagName === 'IMG' && e.complete && e.naturalWidth > 0) return e;
      if (e.shadowRoot) stack.push(e.shadowRoot);
      var k = e.children || [];
      for (var i = 0; i < k.length; i++) stack.push(k[i]);
    }
    return null;
  }
  function stillLoaded(root) { return !!loadedImg(root); }
  var liveQueue = [], liveTurns = [];
  function liveNext() {
    while (liveTurns.length < LIVE_AT_ONCE && liveQueue.length) {
      var slot = liveQueue.shift();
      if (slot.isConnected && !slot._live) { liveTurns.push(slot); slot._goLive(); }
    }
  }
  function liveDone(slot) {
    var i = liveTurns.indexOf(slot);
    if (i < 0) return;
    liveTurns.splice(i, 1);
    liveNext();
  }
  // The live card's <video>, through the shadow roots in between
  // (hui-card > picture card > hui-image > ha-camera-stream > player).
  function liveVideo(root) {
    var stack = [root], n = 0;
    while (stack.length && n++ < 400) {
      var e = stack.pop();
      if (e.tagName === 'VIDEO') return e;
      if (e.shadowRoot) stack.push(e.shadowRoot);
      var k = e.children || [];
      for (var i = 0; i < k.length; i++) stack.push(k[i]);
    }
    return null;
  }
  // The video that PLAYS: a camera card holds two (Home Assistant's WebRTC
  // player and its HLS fallback, which stays paused), so "the first video"
  // can be the wrong one.
  function playingVideo(root) {
    var stack = [root], n = 0;
    while (stack.length && n++ < 400) {
      var e = stack.pop();
      if (e.tagName === 'VIDEO' && e.readyState >= 2 && e.videoWidth > 0 && !e.paused) return e;
      if (e.shadowRoot) stack.push(e.shadowRoot);
      var k = e.children || [];
      for (var i = 0; i < k.length; i++) stack.push(k[i]);
    }
    return null;
  }
  function playing(root) { return !!playingVideo(root); }
  // A LIVE TILE TAKEN OFF THE PAGE LETS GO OF ITS VIDEO. Home Assistant's
  // stream player closes its connection when it leaves, but its <video>
  // keeps the stream as srcObject, unpaused -- and a media element with a
  // source still playing is kept alive by the browser even detached, and
  // with it every element up to the card (traced in a heap snapshot: each
  // retained by "Pending activities"). Every visit to the Cameras page left
  // its nine players behind (~980 elements, 68 listeners, ~0.3 MB a visit,
  // measured headless), and so did every sleep and wake of Home's live tile.
  function releaseMedia(root) {
    var stack = root ? [root] : [], n = 0;
    while (stack.length && n++ < 600) {
      var e = stack.pop();
      if (e.tagName === 'VIDEO' || e.tagName === 'AUDIO') {
        try {
          e.pause();
          if (e.srcObject) e.srcObject = null;
          if (e.getAttribute && e.getAttribute('src')) { e.removeAttribute('src'); e.load(); }
        } catch (x) { /* already gone */ }
      }
      if (e.shadowRoot) stack.push(e.shadowRoot);
      var k = e.children || [];
      for (var i = 0; i < k.length; i++) stack.push(k[i]);
    }
  }
  // WHEN NOBODY CAN SEE THE PAGE: behind HK's photo screensaver once it
  // covers the dashboard, under any black (HK's own or the kiosk's), or with
  // the page hidden -- the same signals the Home strip rests on above. rest()
  // when one starts; wake() when the last one ends (AFTER_BLACK after a
  // black, as the strip does). -> off()
  function restWatch(rest, wake) {
    var black = false, covered = false, wakeT = null, seq = 0;
    var later = function (ms) {
      clearTimeout(wakeT);
      var my = ++seq;
      wakeT = setTimeout(function () {
        if (my !== seq) return;
        wakeT = null;
        if (black || covered || document.hidden) return;
        if (window.hkSaver && window.hkSaver.running && window.hkSaver.running()) return;
        wake();
      }, ms);
    };
    var stop = function () { seq++; clearTimeout(wakeT); wakeT = null; };
    var on = {
      'hk-saver-covered': function () { covered = true; stop(); rest(); },
      'hk-saver': function (e) { if (!(e && e.detail && e.detail.on)) { covered = false; later(0); } },
      'hk-black': function (e) {
        black = !!(e && e.detail && e.detail.on);
        if (black) { stop(); rest(); } else later(AFTER_BLACK);
      },
      'kiosksatellite:screensaverstart': function () { black = true; stop(); rest(); },
      'kiosksatellite:screenoff': function () { black = true; stop(); rest(); },
      'kiosksatellite:screensaverstop': function () { black = false; later(AFTER_BLACK); },
      'kiosksatellite:screenon': function () { black = false; later(AFTER_BLACK); }
    };
    var vis = function () { if (document.hidden) { stop(); rest(); } else later(0); };
    Object.keys(on).forEach(function (t) { window.addEventListener(t, on[t]); });
    document.addEventListener('visibilitychange', vis);
    return function () {
      stop();
      Object.keys(on).forEach(function (t) { window.removeEventListener(t, on[t]); });
      document.removeEventListener('visibilitychange', vis);
    };
  }
  class HkCameraLiveCard extends HTMLElement {
    setConfig(c) {
      if (!c || !c.entity) throw new Error('hk-camera-live-card: entity is required');
      this._config = c;
      if (this._still) this._reset();
    }
    set hass(h) {
      this._hass = h;
      if (this._still) this._still.hass = h;
      if (this._liveEl) this._liveEl.hass = h;
      if (!this._still && this.isConnected && this._config) this._reset();
    }
    getCardSize() { return 3; }
    static getStubConfig(hass) {
      var id = Object.keys((hass && hass.states) || {}).filter(function (k) { return k.indexOf('camera.') === 0; })[0];
      return { entity: id || 'camera.front_door', aspect_ratio: '16x9', fit_mode: 'cover' };
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      this.style.display = 'block';
      this.style.position = 'relative';
      this.style.isolation = 'isolate';            // the layers below stack here, not on the page
      // THE LOOK'S SHADOW, as every plate on every page wears it (Flat's
      // contact shadow, Tinted's, the glass cards'), at the picture's corner --
      // HA's picture card gets none from the theme (the user, 2026-10-17)
      // ...at the plates' corner, 23.5 (DESIGN.md Corners: "the camera
      // mosaic" is a plate): HA's picture card and the layers over it read
      // --ha-card-border-radius, so one value rounds them all
      this.style.setProperty('--ha-card-border-radius', window.hkCards.v('glass-radius'));
      this.style.borderRadius = 'var(--ha-card-border-radius)';
      this.style.boxShadow = 'var(--hk-look-shadow,' + window.hkCards.v('glass-shadow-sm') + ')';
      if (this._config && this._hass && !this._still) this._reset();
      else if (this._still && !this._live && !this._frame) this._saved();
      this._tries = 0;
      var self = this;
      // RESTING WHILE NOBODY CAN SEE IT (2026-10-13): a tablet put to sleep on
      // the Cameras page kept every tile's stream decoding under the photos
      // or the black until the page changed
      if (!this._restOff) this._restOff = restWatch(function () { self._rest(); }, function () { self._wake(); });
      this._resting = document.hidden || !!(window.hkSaver && window.hkSaver.running && window.hkSaver.running());
      if (this._resting) return;
      if (liveQueue.indexOf(this) < 0) liveQueue.push(this);
      // after this task, so every tile attached together queues before the first goes
      setTimeout(liveNext, 0);
    }
    _rest() {
      if (this._resting) return;
      this._resting = true;
      this._stop();
      liveQueue = liveQueue.filter(function (s) { return s !== this; }, this);
      if (this._liveEl) { releaseMedia(this._liveEl); this._liveEl.remove(); this._liveEl = null; }
      this._live = false;
      if (this._still) this._still.style.visibility = '';
      liveDone(this);
    }
    _wake() {
      if (!this._resting || !this.isConnected) return;
      this._resting = false;
      this._tries = 0;
      if (liveQueue.indexOf(this) < 0) liveQueue.push(this);
      liveNext();
    }
    // LEFT (Home Assistant keeps the page): back to the still, so a return
    // takes turns again instead of opening all nine at once
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._restOff) { this._restOff(); this._restOff = null; }
      this._resting = false;
      this._stop();
      liveQueue = liveQueue.filter(function (s) { return s !== this; }, this);
      // the frame it is leaving, for a return (and the strip) to open on
      var v = this._liveEl && playingVideo(this._liveEl), C0 = window.hkCards;
      if (v && v.readyState >= 2 && v.videoWidth > 0 && C0 && C0.snapCache) C0.snapCache.put(this._config.entity, v, true);
      this._dropFrame();
      if (this._liveEl) { releaseMedia(this._liveEl); this._liveEl.remove(); this._liveEl = null; }
      this._live = false;
      if (this._still) this._still.style.visibility = '';
      liveDone(this);
    }
    _card(live) {
      var c = this._config;
      var el = document.createElement('hui-card');
      el.hass = this._hass;
      el.preview = false;
      el.config = { type: 'picture-entity', entity: c.entity, camera_view: live ? 'live' : 'auto',
                    show_name: false, show_state: false, aspect_ratio: c.aspect_ratio || '16x9',
                    fit_mode: c.fit_mode || 'cover' };
      el.load();
      return el;
    }
    _reset() {
      this._stop();
      this._dropFrame();
      if (this._liveEl) releaseMedia(this._liveEl);
      while (this.firstChild) this.removeChild(this.firstChild);
      this._liveEl = null;
      this._live = false;
      this._still = this._card(false);
      // THE LAYERS, bottom up: the live card (it connects underneath -- a
      // video still loading is a blank box with a spinner), the still, the
      // kept frame. The video is shown by taking the two above it away once
      // it PLAYS. Covered is not hidden: Safari starts it all the same.
      this._still.style.position = 'relative';
      this._still.style.zIndex = '1';
      this.appendChild(this._still);
      this._saved();
      this._keepStill();
    }
    _saved() {
      this._dropFrame();
      var C0 = window.hkCards, hit = C0 && C0.snapCache && C0.snapCache.get(this._config.entity, SAVED_MAX_MS);
      if (!hit || !hit.d) return;
      var im = document.createElement('img');
      im.alt = '';
      im.decoding = 'async';
      im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;' +
        'object-fit:' + (this._config.fit_mode === 'contain' ? 'contain' : 'cover') + ';' +
        'border-radius:var(--ha-card-border-radius,12px)';
      im.src = hit.d;
      this._frame = im;
      this.appendChild(im);
      var self = this, t0 = Date.now();
      this._framePoll = setInterval(function () {
        if (!self._frame) return;
        if (stillLoaded(self._still) || Date.now() - t0 > SAVED_GIVE_UP_MS) self._dropFrame();
      }, 300);
    }
    // EVERY STILL THAT LOADS IS KEPT (at most once a minute per camera, the
    // cache's own gap), so a camera that is not on Home's strip has a frame
    // for the next visit too
    _keepStill() {
      var self = this, t0 = Date.now(), C0 = window.hkCards;
      if (this._keepPoll || !C0 || !C0.snapCache) return;
      this._keepPoll = setInterval(function () {
        var im = loadedImg(self._still);
        if (im || Date.now() - t0 > SAVED_GIVE_UP_MS || !self.isConnected) {
          clearInterval(self._keepPoll); self._keepPoll = null;
          if (im) C0.snapCache.put(self._config.entity, im, false);
        }
      }, 500);
    }
    _dropFrame() {
      if (this._framePoll) { clearInterval(this._framePoll); this._framePoll = null; }
      if (this._frame) { this._frame.remove(); this._frame = null; }
    }
    _goLive() {
      if (!this.isConnected || this._resting) { liveDone(this); return; }
      this._live = true;
      var el = this._liveEl = this._card(true);
      el.style.cssText = 'position:absolute;inset:0;z-index:0';
      this.appendChild(el);
      var self = this, t0 = Date.now(), released = false;
      this._stop();
      this._poll = setInterval(function () {
        if (!self.isConnected) { self._stop(); return; }
        var on = playing(el), age = Date.now() - t0;
        if (on) {
          self._stop();
          liveDone(self);
          // UNCOVERED ONLY ONCE A FRAME IS ON SCREEN: Safari says `playing`
          // (a picture, the clock moving) before it has painted one, and the
          // tile went gray for half a second between the kept frame and the
          // video (screen-recorded). So: the video's first PRESENTED frame
          // (requestVideoFrameCallback), then two frames drawn, then the still
          // and the kept frame go -- as the camera sheet does (.db.moving).
          var v = playingVideo(el), done = false;
          var uncover = function () {
            if (done || self._liveEl !== el) return;
            done = true;
            var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (f) { setTimeout(f, 16); };
            raf(function () { raf(function () {
              if (self._liveEl !== el) return;
              self._dropFrame();
              if (self._still) self._still.style.visibility = 'hidden';
            }); });
          };
          if (v && typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(uncover);
          setTimeout(uncover, LIVE_PRESENT_MS);        // no callback (or none coming): uncover anyway
          return;
        }
        if (!released && age >= LIVE_TURN_MS) { released = true; liveDone(self); }
        if (age >= LIVE_STUCK_MS) {
          self._stop();
          releaseMedia(el);
          el.remove();
          self._liveEl = null;
          self._live = false;
          if (++self._tries <= LIVE_RETRIES) { liveQueue.push(self); liveNext(); }
          else self._live = true;                     // left on its still; no more turns
        }
      }, LIVE_POLL_MS);
    }
    _stop() {
      if (this._poll) { clearInterval(this._poll); this._poll = null; }
    }
  }
  register('hk-camera-live-card', HkCameraLiveCard, 'HK Camera Tile',
    'One live camera. On a page of them, each opens after the one before is playing, so they all connect.',
    [
      { name: 'entity', label: 'Camera', selector: { entity: { domain: 'camera' } } },
      { type: 'grid', name: '', schema: [
        { name: 'aspect_ratio', label: 'Shape', selector: { text: {} }, helper: 'Width by height, e.g. 16x9.' },
        { name: 'fit_mode', label: 'Fit', selector: { select: { mode: 'dropdown', options: [
          { value: 'cover', label: 'Fill the tile' }, { value: 'contain', label: 'Show it all' }] } } }
      ] }
    ]);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'hk-camera-mosaic-card',
    name: 'HK Camera Strip',
    description: 'One live camera followed by recent snapshots of the others, as in the Home app.',
    preview: false
  });
  // ======================================================================
  // hk-doorbell-card -- the #doorbell sheet: the front door, live, WITH its
  // sound, and a hold-to-talk button.
  //
  // WHY THIS CARD OWNS ITS OWN WEBRTC. With a stock picture-entity the
  // door's audio never plays. HA's player asks for a MUTED stream, and
  // although the doorbell sends Opus (the answer offers it and the packets
  // arrive -- ~340 KB in a minute, measured in Chrome), ha-web-rtc-player
  // leaves the audio track out of its <video>. Unmuting ha-camera-stream
  // does not help: it swaps to the HLS player, seconds behind and paused
  // until a tap. So this card negotiates through HA's public camera API
  // itself (camera/webrtc/get_client_config, camera/webrtc/offer and
  // /candidate -- the messages the frontend's own player sends) and plays
  // both tracks in one <video>: audio + video, connected in about a second.
  //
  // SOUND starts muted, because autoplay always allows that, and then tries
  // to unmute. With Fully Kiosk's "Autoplay audio" on, that sticks with no
  // tap. A browser that refuses pauses the video instead, so the card mutes
  // again, keeps playing, and the speaker button shows the sound is off: one
  // tap turns it on.
  //
  // TALK: hold and speak, and the words stream live to `speaker` (a UniFi
  // Protect doorbell, through talk_live.py) -- or, anywhere that cannot,
  // they are recorded and played through talk.py when the button is let go.
  // A press is one or the other, never both (see s.fail in _liveStart). The
  // microphone needs a secure page (https), so on plain http the button is
  // not drawn at all. While the button is held the door's sound is muted, so
  // the tablet does not record its own speaker.

  // LIVE TALK (talk_live.py): how long a press waits for the doorbell to
  // start listening before it goes on as a clip instead.
  var LIVE_WAIT_MS = 1500;
  // The AudioWorklet that turns the microphone into 16-bit PCM for the
  // websocket, CHUNK samples (40 ms) at a time. A worklet, not a
  // ScriptProcessor: it runs off the main thread, so a busy page (a 4K
  // video decoding next to it) cannot starve it into gaps.
  var PCM_TAP = [
    "class P extends AudioWorkletProcessor {",
    "  constructor(o) { super(); this.c = (o.processorOptions || {}).chunk || 1920;",
    "    this.b = new Int16Array(this.c); this.n = 0; this.out = null; var me = this;",
    "    this.port.onmessage = function (e) { if (e.data && e.data.port) me.out = e.data.port; }; }",
    "  process(inputs) {",
    "    var ch = inputs[0] && inputs[0][0];",
    "    if (!ch) return true;",
    "    for (var i = 0; i < ch.length; i++) {",
    "      var v = ch[i] < -1 ? -1 : ch[i] > 1 ? 1 : ch[i];",
    "      this.b[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;",
    "      if (this.n === this.c) {",
    "        if (this.out) this.out.postMessage(this.b.buffer, [this.b.buffer]);",
    "        this.b = new Int16Array(this.c); this.n = 0;",
    "      }",
    "    }",
    "    return true;",
    "  }",
    "}",
    "registerProcessor('hk-pcm-tap', P);"
  ].join('\n');
  // THE SENDER RUNS IN A WORKER, WITH ITS OWN SOCKET. Sent from the page's
  // main thread over HA's websocket, the chunks arrive with gaps: a
  // tablet's main thread stalls -- gaps of 97, 158 and 181 ms measured
  // between chunks the worklet produced exactly 40 ms apart, and one of
  // 1.3 s just after a restart (the dashboard redrawing). HA's cushion
  // runs dry and the door hears it. So the worklet posts straight to this
  // worker through a MessageChannel, and the worker holds its own
  // authenticated websocket to HA: nothing the page does can get between
  // the microphone and the doorbell. One socket per open sheet, one
  // subscription per hold.
  var TALK_WORKER = [
    "var ws = null, ready = null, subs = {}, stopped = {}, nextId = 1;",
    "function open(d) {",
    "  ready = new Promise(function (res, rej) {",
    "    ws = new WebSocket(d.url);",
    "    ws.onmessage = function (e) {",
    "      var m = JSON.parse(e.data), s;",
    "      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: d.token }));",
    "      else if (m.type === 'auth_ok') res();",
    "      else if (m.type === 'auth_invalid') rej(new Error('not signed in'));",
    "      else if (m.type === 'result' && !m.success && (s = subs[m.id])) {",
    "        postMessage({ id: s.key, error: (m.error && m.error.message) || 'refused' });",
    "        delete subs[m.id];",
    "      } else if (m.type === 'event' && (s = subs[m.id])) {",
    "        var ev = m.event || {};",
    "        if (ev.handler_id) { s.hid = ev.handler_id; postMessage({ id: s.key, live: true }); }",
    "        else if (ev.error) postMessage({ id: s.key, error: ev.error });",
    "      }",
    "    };",
    "    ws.onclose = function () {",
    "      rej(new Error('socket closed'));",
    "      for (var k in subs) postMessage({ id: subs[k].key, error: 'socket closed' });",
    "      subs = {}; ws = null; ready = null;",
    "    };",
    "  });",
    "  return ready;",
    "}",
    "onmessage = function (e) {",
    "  var d = e.data;",
    "  if (d.cmd === 'start') {",
    "    (ws && ready ? ready : open(d)).then(function () {",
    "      if (stopped[d.key]) { d.port.close(); return; }",
    "      var id = ++nextId, s = subs[id] = { key: d.key, port: d.port, hid: 0 };",
    "      d.port.onmessage = function (m) {",
    "        if (!s.hid || !ws || ws.readyState !== 1) return;",
    "        var pcm = new Uint8Array(m.data), out = new Uint8Array(pcm.length + 1);",
    "        out[0] = s.hid; out.set(pcm, 1);",
    "        ws.send(out);",
    "      };",
    "      ws.send(JSON.stringify({ id: id, type: 'hk_frontend/talk/live', entity_id: d.entity_id, rate: d.rate }));",
    "    }, function (err) { postMessage({ id: d.key, error: String(err && err.message || err) }); });",
    "  } else if (d.cmd === 'stop') {",
    "    stopped[d.key] = true;",
    "    for (var k in subs) {",
    "      if (subs[k].key !== d.key) continue;",
    "      try { subs[k].port.close(); } catch (x) { /* closed */ }",
    "      if (ws && ws.readyState === 1)",
    "        ws.send(JSON.stringify({ id: ++nextId, type: 'unsubscribe_events', subscription: +k }));",
    "      delete subs[k];",
    "    }",
    "  }",
    "};"
  ].join('\n');
  var TALK_MIN_MS = 600;       // shorter than this is a tap: "Hold to talk"
  var VOL_KEY = 'hk-tv-volume';
  var FULLY_MUSIC = 3;         // Android STREAM_MUSIC, for Fully's setAudioVolume
  var TALK_MAX_MS = 30000;
  var RETRY_MS = [2000, 5000, 10000, 20000];

  class HkDoorbellCard extends HkBase {
    // hk-popup opens a sheet holding this card at 1% until hkReady()
    // resolves: the live video has drawn its first frame (and one more), or
    // the stream failed. See hk-popup.js, PREPARED UNSEEN.
    static get hkPrepares() { return true; }

    hkReady() {
      var self = this;
      return new Promise(function (res) {
        if (self._readyDone) { res(); return; }
        var prev = self._readyWait;
        self._readyWait = function () { if (prev) prev(); res(); };
      });
    }

    _markReady() {
      this._readyDone = true;
      var w = this._readyWait;
      this._readyWait = null;
      if (w) w();
    }

    static get CSS() {
      return [
        // Never taller than a pop-up sheet may be (hk-popup caps it at the
        // screen height less 36px): in a short window the video crops a
        // little instead of pushing the buttons below the sheet's clip.
        // When the height cap bites, aspect-ratio narrows the box instead:
        // centred, and rounded like the sheet (the host inherits its radius).
        // The radius has to reach .db through the card's wrapper div too.
        // --hk-vh: the car's real window height in layout px, set only on a
        // zoomed car dashboard (tesla-viewport.js), where 100dvh is zoomed
        // too and would cap the video at ~2/3 of the screen. Unset -- every
        // other screen -- it falls back to the plain unit.
        ':host,:host>div{border-radius:inherit}',
        // --hk-db-max: a host that has more chrome than a pop-up (the camera
        // sheet's header) says how tall the picture may be.
        '.db{position:relative;overflow:hidden;background:#0b0d12;aspect-ratio:var(--db-ar,4/3);',
        '  max-height:var(--hk-db-max, calc(var(--hk-vh, 100dvh) - 36px));margin:0 auto;border-radius:inherit;',
        // NO MASK HERE. A -webkit-mask-image forces the video's corners round,
        // but on an Android tablet it makes the WHOLE sheet and its dim blink
        // out for a frame or three as the WebRTC tracks arrive -- 4 of 4 opens,
        // and 0 of 4 without it (adb screenrecord, frames measured). Rounded
        // overflow on the sheet plus the video's own border-radius keep the
        // corners round, checked on the same recordings with the video playing.
        '  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
        '.db>img,.db>video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;',
        '  display:block}',
        // The still stays under the video until the video is MOVING, so the
        // sheet never shows black while WebRTC connects.
        // NO FADE, and the still goes one frame AFTER the video shows. A video
        // that fades in over .25s from the moment it reports 'playing', while
        // the still under it vanishes at once, leaves a dark flash between the
        // two on a tablet (filmed at 60 fps). So the video appears on its first
        // PRESENTED frame (requestVideoFrameCallback) and the still is hidden on
        // the next, so there is always a picture.
        // 1%, not 0, before the first frame: an element at 0 is not drawn,
        // and the frame that first draws a live video blanks the sheet on
        // a tablet. At 1% that happens unseen (hk-popup: PREPARED UNSEEN).
        '.db>video{opacity:.01;border-radius:inherit}',
        '.db>video.on{opacity:1}',
        // THE STILL IS FOR TUNING ONLY. Once the video moves it goes: a
        // letterboxed TV frame (fill) does not cover the box, and the programme
        // art would show around -- and, in its bars, behind -- the picture. It
        // comes back only if the stream drops and reconnects.
        '.db.moving>img{visibility:hidden}',
        '.bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;',
        // flex-wrap: on a phone the slider + talk button outgrow the sheet,
        // so the talk button takes a second row rather than spilling out.
        '  justify-content:center;flex-wrap:wrap;gap:14px;padding:26px 20px 20px;',
        '  background:linear-gradient(to top,rgba(0,0,0,.5),rgba(0,0,0,0));',
        // The TV player fades these with its own controls (--hk-db-bar-*).
        '  opacity:var(--hk-db-bar-opacity,1);pointer-events:var(--hk-db-bar-events,auto);',
        '  transition:opacity .3s}',
        // VOLUME (the TV player and every camera pop-up): a slider in a plate
        // beside the speaker.
        '.vol{height:56px;padding:0 20px;border-radius:28px;display:flex;align-items:center;',
        '  background:rgba(28,28,30,.66);box-shadow:0 4px 14px rgba(0,0,0,.25)}',
        '.vol input{-webkit-appearance:none;appearance:none;width:180px;height:6px;border-radius:3px;',
        '  background:linear-gradient(to right,#fff var(--v,100%),rgba(255,255,255,.28) var(--v,100%));',
        '  outline:none;margin:0;touch-action:none}',
        '.vol input::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:13px;',
        '  background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.35)}',
        '.vol input::-moz-range-thumb{width:26px;height:26px;border:0;border-radius:13px;background:#fff}',
        // A PHONE (tested at 390 px): the live box is only ~206 px tall there,
        // and the bar -- speaker, slider and the talk button wrapped to a second
        // row -- would cover two thirds of it. A phone has volume buttons, so
        // the slider goes, and the bar tightens so the talk button stays on the
        // speaker's row.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.vol{display:none}.bar{gap:10px;padding:18px 12px 12px}',
        '  .talk{min-width:0;padding:0 18px 0 14px}}',
        // A still that failed (no artwork yet) must not leave a broken-image glyph.
        '.db>img.dead{visibility:hidden}',
        '.bar button{font:inherit;color:#fff;border:0;cursor:pointer;display:flex;',
        '  align-items:center;justify-content:center;gap:10px;height:56px;',
        '  -webkit-tap-highlight-color:transparent;background:rgba(28,28,30,.66);',
        '  box-shadow:0 4px 14px rgba(0,0,0,.25);--mdc-icon-size:26px}',
        '.snd{width:56px;border-radius:28px}',
        '.snd.off{color:rgba(255,255,255,.7)}',
        '.talk{padding:0 26px 0 20px;border-radius:28px;font-size:17px;font-weight:600;',
        '  min-width:200px;touch-action:none}',
        '.talk.rec{background:#ff3b30}',
        // Held, but the microphone is not open yet: nothing said now is kept.
        '.talk.wait{background:rgba(255,159,10,.85)}',
        '.talk.busy{color:rgba(255,255,255,.75)}',
        '.talk .dot{display:none;width:10px;height:10px;border-radius:5px;background:#fff;',
        '  animation:hk-db-pulse 1s ease-in-out infinite}',
        '.talk.rec .dot{display:block}',
        '.talk.rec ha-icon{display:none}',
        '@keyframes hk-db-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
        '.msg{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:8px 14px;',
        '  border-radius:14px;background:rgba(28,28,30,.75);color:#fff;font-size:15px;',
        '  white-space:nowrap;opacity:0;transition:opacity .2s;pointer-events:none}',
        '.msg.on{opacity:1}',
        // `name`: which camera this is, for the camera pop-ups (the doorbell
        // sheet has none -- a ring already says which door).
        // 34px tall at top 16 / left 18: the same line, height and inset as
        // the sheet's X (--hk-popup-x-* in the camera pop-ups' vars).
        '.cap{position:absolute;left:18px;top:16px;height:34px;box-sizing:border-box;',
        '  padding:0 14px;display:flex;align-items:center;border-radius:17px;',
        '  background:rgba(28,28,30,.62);color:#fff;font-size:16px;font-weight:600;',
        '  line-height:1;pointer-events:none}',
        '.snd.none{display:none}',
        // FILL (the live TV player): the whole box, letterboxed not cropped --
        // a broadcast frame must not lose its edges -- and no rounding.
        '.db.fill{aspect-ratio:auto;width:100%;height:100%;max-height:none;border-radius:0;',
        '  background:#000}',
        '.db.fill>img,.db.fill>video{object-fit:contain;border-radius:0}',
        // TUNING: what the player says until the picture moves, and why not.
        '.tune{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
        '  padding:14px 22px;border-radius:18px;background:rgba(28,28,30,.72);color:#fff;',
        '  font-size:18px;font-weight:600;text-align:center;max-width:70%;line-height:1.35;',
        '  pointer-events:none;transition:opacity .25s}',
        '.tune.off{opacity:0}'
      ].join('');
    }

    _render() {
      var c = this._config, h = this._hass;
      if (!c || !h) return;
      if (!this._built) this._build();
      var st = h.states[c.entity];
      var pic = st && st.attributes && !C.stale(st) && st.attributes.entity_picture;
      if (pic && !this._playing && this._poster.getAttribute('src') !== pic) {
        this._poster.setAttribute('src', pic);
      }
      if (this.isConnected && !this._pc && !this._retryT) this._start();
    }

    _build() {
      var c = this._config, self = this;
      this._stop();
      this._built = true;
      this._root.innerHTML = '';
      var db = document.createElement('div');
      db.className = c.fill ? 'db fill' : 'db';
      this._root.style.height = c.fill ? '100%' : '';
      // aspect_ratio: auto -- the camera's own shape, read off its still and
      // then its video (a doorbell is 4:3, most cameras 16:9); 16:9 until then.
      var auto = String(c.aspect_ratio || '') === 'auto';
      var ar = String(auto ? '16x9' : (c.aspect_ratio || '4x3')).split(/[x:\/]/);
      if (ar.length === 2 && +ar[0] > 0 && +ar[1] > 0) {
        db.style.setProperty('--db-ar', +ar[0] + '/' + +ar[1]);
      }
      var shape = function (w, h) {
        if (auto && w > 0 && h > 0) db.style.setProperty('--db-ar', w + '/' + h);
      };
      var img = document.createElement('img');
      img.alt = '';
      img.addEventListener('error', function () { img.classList.add('dead'); });
      img.addEventListener('load', function () { img.classList.remove('dead'); shape(img.naturalWidth, img.naturalHeight); });
      var v = document.createElement('video');
      v.addEventListener('loadedmetadata', function () { shape(v.videoWidth, v.videoHeight); });
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      var bar = document.createElement('div');
      bar.className = 'bar';
      var msg = document.createElement('div');
      msg.className = 'msg';
      db.append(img, v, bar, msg);
      this._tune = null;
      clearTimeout(this._tuneT);
      if (c.tuning) {
        var tune = document.createElement('div');
        tune.className = 'tune';
        tune.textContent = 'Tuning ' + c.tuning + '\u2026';
        db.append(tune);
        this._tune = tune;
        // A tuner the HDHomeRun cannot give us (all in use -- a media server,
        // another room) never produces a frame; say so instead of spinning forever.
        this._tuneT = setTimeout(function () {
          if (!self._playing && self._tune) {
            self._tune.textContent = 'Could not tune ' + c.tuning +
              '. Every tuner may be in use \u2014 try again in a minute.';
          }
        }, 25000);
      }
      if (c.name) {
        var cap = document.createElement('div');
        cap.className = 'cap';
        cap.textContent = c.name;
        db.append(cap);
      }
      this._root.append(db);
      this._poster = img; this._video = v; this._msg = msg;
      this._sndBtn = null; this._talkBtn = null;
      this._wantSound = c.sound !== false;
      this._blocked = false;
      v.addEventListener('playing', function () {
        self._playing = true;
        var frame = function (fn) {
          if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(fn);
          else requestAnimationFrame(function () { requestAnimationFrame(fn); });
        };
        frame(function () {
          if (!self._playing) return;            // torn down meanwhile
          v.classList.add('on');
          frame(function () {
            if (self._playing) db.classList.add('moving');
            self._markReady();
          });
        });
        if (self._tune) self._tune.classList.add('off');
        self._applySound(false);
        // A camera with no microphone answers video only: no speaker button
        // for a sound that does not exist.
        var src = v.srcObject;
        if (self._sndBtn && src && src.getAudioTracks) {
          self._sndBtn.classList.toggle('none', src.getAudioTracks().length === 0);
        }
      });
      if (c.sound !== false) {
        var snd = document.createElement('button');
        snd.className = 'snd';
        snd.setAttribute('aria-label', 'Sound');
        snd.innerHTML = '<ha-icon></ha-icon>';
        snd.addEventListener('click', function (e) {
          e.stopPropagation();
          // A tap is a user gesture: the browser allows sound from here.
          self._wantSound = self._blocked ? true : !self._wantSound;
          self._blocked = false;
          self._applySound(true);
        });
        bar.append(snd);
        this._sndBtn = snd;
        if (c.volume) {
          // WHICH TABLET: the one this page is on -- the slider is part of it.
          // In Fully Kiosk (JavaScript interface on) it sets the TABLET'S media
          // volume, exactly as its volume buttons do; the <video> stays at
          // full. Anywhere else it sets the video's own volume, remembered
          // per screen.
          var fk = window.fully && typeof window.fully.setAudioVolume === 'function' ? window.fully : null;
          var level = 1;
          if (fk && typeof fk.getAudioVolume === 'function') {
            try { level = Number(fk.getAudioVolume(FULLY_MUSIC)) / 100; } catch (e) { level = 1; }
          } else {
            try { level = parseFloat(localStorage.getItem(VOL_KEY)); } catch (e) { /* none */ }
          }
          if (!(level >= 0 && level <= 1)) level = 1;
          v.volume = fk ? 1 : level;
          var vol = document.createElement('div');
          vol.className = 'vol';
          var r = document.createElement('input');
          r.type = 'range'; r.min = '0'; r.max = '100'; r.step = '1';
          r.value = String(Math.round(level * 100));
          r.setAttribute('aria-label', 'Volume');
          var paint = function () { r.style.setProperty('--v', r.value + '%'); };
          paint();
          r.addEventListener('input', function (e) {
            e.stopPropagation();
            var x = Number(r.value) / 100;
            paint();
            if (fk) {
              try { fk.setAudioVolume(Math.round(x * 100), FULLY_MUSIC); } catch (err) { v.volume = x; }
            } else {
              v.volume = x;
              try { localStorage.setItem(VOL_KEY, String(x)); } catch (err) { /* private mode */ }
            }
            // Dragging the slider up is asking for sound: unmute (a gesture).
            if (x > 0 && !self._audible()) { self._wantSound = true; self._blocked = false; self._applySound(true); }
            if (x === 0 && self._audible()) { self._wantSound = false; self._applySound(true); }
          });
          ['pointerdown', 'click'].forEach(function (ev) {
            r.addEventListener(ev, function (e) { e.stopPropagation(); });
          });
          vol.append(r);
          bar.append(vol);
        }
      }
      if (c.speaker && window.isSecureContext && navigator.mediaDevices &&
          navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
        var t = document.createElement('button');
        t.className = 'talk';
        t.innerHTML = '<ha-icon icon="mdi:microphone"></ha-icon><span class="dot"></span><span class="lbl"></span>';
        t.addEventListener('pointerdown', function (e) {
          e.preventDefault(); e.stopPropagation();
          try { t.setPointerCapture(e.pointerId); } catch (x) { /* old engine */ }
          self._talkStart();
        });
        t.addEventListener('pointerup', function (e) { e.stopPropagation(); self._talkEnd(false); });
        t.addEventListener('pointercancel', function (e) { e.stopPropagation(); self._talkEnd(true); });
        t.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        t.addEventListener('click', function (e) { e.stopPropagation(); });
        bar.append(t);
        this._talkBtn = t;
        this._talkUi('idle');
      }
      if (!bar.children.length) bar.style.display = 'none';
      this._paintSound();
    }

    // ------------------------------------------------------------ sound
    _audible() { return this._wantSound && !this._blocked && !this._talk; }

    _applySound(fromTap) {
      var v = this._video, self = this;
      if (!v) return;
      if (!this._audible()) { v.muted = true; this._paintSound(); return; }
      if (!v.muted) { this._paintSound(); return; }
      v.muted = false;
      var p = v.play();
      var refused = function () {
        if (fromTap) return;
        self._blocked = true;
        v.muted = true;
        v.play().catch(function () { /* muted autoplay is always allowed */ });
        self._paintSound();
      };
      if (p && p.catch) p.catch(refused);
      // Some engines do not reject: they PAUSE the video they were told to
      // unmute. Look once it has had a moment.
      setTimeout(function () { if (v.isConnected && v.paused && !v.muted) refused(); }, 300);
      this._paintSound();
    }

    _paintSound() {
      var b = this._sndBtn;
      if (!b) return;
      var on = this._audible();
      b.classList.toggle('off', !on);
      var i = b.querySelector('ha-icon');
      if (i) i.setAttribute('icon', on ? 'mdi:volume-high' : 'mdi:volume-off');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    // ------------------------------------------------------------ webrtc
    _start() {
      var h = this._hass, c = this._config, self = this;
      if (!h || !h.connection || !c || !c.entity || !window.RTCPeerConnection) { this._markReady(); return; }
      var gen = this._gen = (this._gen || 0) + 1;
      this._readyDone = false;
      var conn = h.connection, entity = c.entity;
      var alive = function () { return self._gen === gen && self.isConnected; };
      this._pc = 'pending';
      conn.sendMessagePromise({ type: 'camera/webrtc/get_client_config', entity_id: entity })
        .catch(function () { return {}; })
        .then(function (cfg) {
          if (!alive()) return;
          var pc = self._pc = new RTCPeerConnection((cfg && cfg.configuration) || {});
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.addTransceiver('video', { direction: 'recvonly' });
          var stream = new MediaStream();
          pc.ontrack = function (e) {
            stream.addTrack(e.track);
            if (self._video && self._video.srcObject !== stream) self._video.srcObject = stream;
          };
          var session = null, pending = [];
          var send = function (cand) {
            conn.sendMessagePromise({ type: 'camera/webrtc/candidate', entity_id: entity,
              session_id: session, candidate: cand }).catch(function () { /* late */ });
          };
          pc.onicecandidate = function (e) {
            if (!e.candidate) return;
            var cand = e.candidate.toJSON();
            if (session) send(cand); else pending.push(cand);
          };
          pc.onconnectionstatechange = function () {
            if (!alive()) return;
            var s = pc.connectionState;
            if (s === 'connected') self._tries = 0;
            if (s === 'failed' || s === 'closed') self._again();
          };
          return pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () { return offer; });
          }).then(function (offer) {
            if (!alive()) return;
            return conn.subscribeMessage(function (m) {
              if (!alive()) return;
              if (m.type === 'session') {
                session = m.session_id;
                pending.splice(0).forEach(send);
              } else if (m.type === 'answer') {
                pc.setRemoteDescription({ type: 'answer', sdp: m.answer })
                  .catch(function (e) { console.error('[hk-doorbell] answer', e); self._again(); });
              } else if (m.type === 'candidate') {
                var ic = typeof m.candidate === 'string'
                  ? { candidate: m.candidate, sdpMLineIndex: 0 } : m.candidate;
                pc.addIceCandidate(ic).catch(function () { /* one bad candidate */ });
              } else if (m.type === 'error') {
                console.error('[hk-doorbell] camera refused WebRTC:', m.code, m.message);
                self._again();
              }
            }, { type: 'camera/webrtc/offer', entity_id: entity, offer: offer.sdp })
              .then(function (unsub) {
                if (alive()) { self._unsub = unsub; return; }
                var r = unsub();
                if (r && r.catch) r.catch(function () { /* the session already ended */ });
              });
          });
        })
        .catch(function (e) {
          console.error('[hk-doorbell] could not start', e);
          if (alive()) self._again();
        });
    }

    _again() {
      var self = this;
      this._markReady();                         // a failed stream holds no sheet
      this._teardown();
      if (!this.isConnected || this._retryT) return;
      var n = this._tries = (this._tries || 0) + 1;
      this._retryT = setTimeout(function () {
        self._retryT = null;
        if (self.isConnected) self._start();
      }, RETRY_MS[Math.min(n - 1, RETRY_MS.length - 1)]);
    }

    _teardown() {
      this._gen = (this._gen || 0) + 1;
      // unsub() RETURNS A PROMISE: a try/catch never saw its refusal, which
      // surfaced as an uncaught "Subscription not found" when the server had
      // already ended the WebRTC session (or the socket had reconnected)
      if (this._unsub) {
        try { var r = this._unsub(); if (r && r.catch) r.catch(function () { /* already ended */ }); }
        catch (e) { /* socket gone */ }
      }
      this._unsub = null;
      var pc = this._pc;
      this._pc = null;
      if (pc && pc.close) { try { pc.close(); } catch (e) { /* closed */ } }
      if (this._video) { this._video.srcObject = null; this._video.classList.remove('on'); }
      var box = this._video && this._video.parentNode;
      if (box && box.classList) box.classList.remove('moving');
      this._playing = false;
    }

    _stop() {
      clearTimeout(this._retryT);
      this._retryT = null;
      this._tries = 0;
      this._talkAbort();
      this._teardown();
      this._markReady();
    }

    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._built && this._hass && !this._pc) this._start();
    }

    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      // The sheet detaches its cards when it closes: no stream, no mic.
      this._stop();
    }

    // ------------------------------------------------------------ talk
    _talkUi(mode) {
      var t = this._talkBtn;
      if (!t) return;
      t.classList.toggle('rec', mode === 'rec' || mode === 'live');
      t.classList.toggle('wait', mode === 'wait');
      t.classList.toggle('busy', mode === 'busy');
      t.querySelector('.lbl').textContent =
        mode === 'live' ? 'Talking — release to stop' :
        mode === 'rec' ? 'Talk — release to send' : mode === 'wait' ? 'Wait…' :
        mode === 'busy' ? 'Sending…' : 'Hold to talk';
    }

    _flash(text) {
      var m = this._msg;
      if (!m) return;
      m.textContent = text;
      m.classList.add('on');
      clearTimeout(this._flashT);
      this._flashT = setTimeout(function () { m.classList.remove('on'); }, 1800);
    }

    // THE MICROPHONE OPENS ONCE PER SHEET. Opening it takes a moment (half a
    // second or more on a tablet), so a button that says "Release to send"
    // at the press loses the first words: clips of 0.8-1.3 s reach the
    // doorbell. The button says "Wait..." until the words will really be
    // heard, and the stream stays open until the sheet closes (disconnect ->
    // _stop -> _talkAbort), so every hold after the first starts at the
    // press.
    //
    // LIVE, WITH THE CLIP AS A NET. The words stream to the doorbell as they
    // are spoken (talk_live.py: raw PCM over the websocket, paced into the
    // doorbell's own talkback stream). A MediaRecorder clip of the same
    // words is kept all the while; if the live session cannot open, or
    // fails mid-sentence, release sends the clip through talk.py instead. A
    // speaker that is not a UniFi Protect doorbell only ever gets the clip.
    _talkStart() {
      if (this._talk || this._sending) return;
      var self = this;
      var s = this._talk = { t0: performance.now(), chunks: [] };
      this._applySound(false);                   // mutes the door while held
      this._audioCtx();                          // inside the press: allowed to run
      var mic = this._mic;
      if (mic && mic.active) { this._talkRecord(s, mic); return; }
      this._talkUi('wait');
      navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(function (stream) {
          if (!self.isConnected) { self._stopTracks(stream); return; }
          self._stopTracks(self._mic);
          self._mic = stream;                     // kept for the next hold
          if (s.ended || self._talk !== s) return;
          self._talkRecord(s, stream);
        })
        .catch(function (err) {
          if (self._talk === s) self._talk = null;
          self._talkUi('idle');
          self._applySound(false);
          self._flash(err && err.name === 'NotAllowedError'
            ? 'The microphone is not allowed' : 'No microphone');
          console.error('[hk-doorbell] microphone', err);
        });
    }

    _talkRecord(s, stream) {
      var self = this;
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0];
      var rec = s.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) s.chunks.push(e.data); };
      rec.onstop = function () { self._talkSend(s); };
      rec.start();
      s.recT0 = performance.now();
      s.maxT = setTimeout(function () { self._talkEnd(false); }, TALK_MAX_MS);
      if (this._config.live === false) { this._talkUi('rec'); return; }
      // Still "Wait..." until the doorbell is listening (a moment on the first
      // press; the session is remembered after that) -- or, if it will not
      // listen within LIVE_WAIT_MS, go on as a clip. Through s.fail, which
      // also shuts the live session: see there. (_liveStart below defines it
      // before anything else, so it exists before this can fire.)
      this._talkUi('wait');
      s.liveT = setTimeout(function () {
        if (!s.live && !s.ended) s.fail('not listening after ' + LIVE_WAIT_MS + ' ms');
      }, LIVE_WAIT_MS);
      this._liveStart(s, stream);
    }

    _audioCtx() {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !window.AudioWorkletNode || this._config.live === false) return null;
      if (!this._actx || this._actx.state === 'closed') {
        try { this._actx = new AC(); } catch (e) { return null; }
        this._actxMod = null;
      }
      if (this._actx.state === 'suspended') this._actx.resume().catch(function () {});
      return this._actx;
    }

    _talkWorker() {
      if (this._tw) return this._tw;
      if (!window.Worker || !window.MessageChannel) return null;
      var self = this, w;
      try {
        w = new Worker(URL.createObjectURL(new Blob([TALK_WORKER], { type: 'application/javascript' })));
      } catch (e) { return null; }
      w.onmessage = function (e) {
        var d = e.data || {}, s = self._talk;
        if (!s || s.key !== d.id) return;
        if (d.error) { s.fail(d.error); return; }
        if (d.live && !s.liveFailed && !s.ended) {
          s.live = true;
          clearTimeout(s.liveT);
          self._talkUi('live');
        }
      };
      w.onerror = function () { var s = self._talk; if (s && s.fail) s.fail('worker'); };
      this._tw = w;
      return w;
    }

    _liveStart(s, stream) {
      var self = this, h = this._hass, ctx = this._audioCtx(), auth = h && h.auth;
      // GIVING UP ON LIVE CLOSES IT. Flipping the flags and the label alone is
      // not enough: the session given up on may still be opening -- a first
      // press waits on a new socket, auth, and Protect handing out a talkback
      // session -- and when it answers, the worker would start streaming the
      // words anyway while the button says "release to send"; on release the
      // clip would go too, and the door would hear the message twice. So the
      // live half is stopped here (the worker unsubscribes, or never
      // subscribes if it has not yet), so a press is live OR a clip, never
      // both. What already played before a MID-SENTENCE failure is the one
      // overlap left, by design: the clip is the whole message.
      s.fail = function (why) {
        if (s.liveFailed) return;
        s.liveFailed = true;
        if (why) console.warn('[hk-doorbell] live talk:', why);
        self._liveStop(s);
        if (self._talk === s && !s.ended) self._talkUi('rec');
      };
      var worker = ctx && auth && this._talkWorker();
      if (!worker) { s.fail('not available here'); return; }
      if (!this._actxMod) {
        var url = URL.createObjectURL(new Blob([PCM_TAP], { type: 'application/javascript' }));
        this._actxMod = ctx.audioWorklet.addModule(url);
      }
      var base = (auth.data && auth.data.hassUrl) || location.origin;
      var wsUrl = base.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/websocket';
      Promise.all([this._actxMod,
                   auth.expired && auth.refreshAccessToken ? auth.refreshAccessToken() : null])
        .then(function () {
          if (s.ended || s.liveFailed) return;
          var src = ctx.createMediaStreamSource(stream);
          var node = new AudioWorkletNode(ctx, 'hk-pcm-tap',
            { processorOptions: { chunk: Math.round(ctx.sampleRate / 25) } });   // 40 ms
          var mute = ctx.createGain();
          mute.gain.value = 0;                    // pulled by the graph, never heard
          src.connect(node); node.connect(mute); mute.connect(ctx.destination);
          s.nodes = [src, node, mute];
          // The worklet talks to the worker directly: the page is not in the
          // path. The worker sends nothing until the doorbell listens, so
          // nothing said before the button turned red is queued (a backlog
          // would be a delay that never goes away).
          var ch = new MessageChannel();
          node.port.postMessage({ port: ch.port1 }, [ch.port1]);
          s.key = self._talkKey = (self._talkKey || 0) + 1;
          s.worker = worker;
          worker.postMessage({ cmd: 'start', key: s.key, url: wsUrl, token: auth.accessToken,
                               entity_id: self._config.speaker, rate: ctx.sampleRate,
                               port: ch.port2 }, [ch.port2]);
          if (s.ended) self._liveStop(s);         // let go while it was opening
        }).catch(function (err) { s.fail(err && (err.message || err.code || err)); });
    }

    _liveStop(s) {
      clearTimeout(s.liveT);
      (s.nodes || []).forEach(function (n) { try { n.disconnect(); } catch (e) { /* gone */ } });
      s.nodes = null;
      // Unsubscribing is "let go": the server plays out what it holds.
      if (s.worker && s.key) { s.worker.postMessage({ cmd: 'stop', key: s.key }); s.worker = null; }
    }

    _talkEnd(cancel) {
      var s = this._talk;
      if (!s || s.ended) return;
      s.ended = true;
      clearTimeout(s.maxT);
      if (!s.rec) {                              // released before the mic opened
        this._talk = null;
        this._talkUi('idle');
        this._applySound(false);
        if (!cancel) this._flash('Wait for the red button, then talk');
        return;
      }
      s.secs = (performance.now() - s.recT0) / 1000;
      s.cancel = cancel || s.secs * 1000 < TALK_MIN_MS;
      this._liveStop(s);
      try { s.rec.stop(); } catch (e) { this._talkSend(s); }
    }

    _stopTracks(stream) {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    }

    _talkAbort() {
      var s = this._talk;
      this._talk = null;
      if (s) {
        s.cancel = true; s.ended = true;
        clearTimeout(s.maxT);
        this._liveStop(s);
        if (s.rec && s.rec.state !== 'inactive') { try { s.rec.stop(); } catch (e) { /* stopped */ } }
      }
      this._stopTracks(this._mic);               // the sheet closed: mic off
      this._mic = null;
      if (this._actx) { try { this._actx.close(); } catch (e) { /* closed */ } }
      this._actx = null; this._actxMod = null;
      // Its socket closing ends any session on the server too.
      if (this._tw) { this._tw.terminate(); this._tw = null; }
    }

    _talkSend(s) {
      var self = this, c = this._config, h = this._hass;
      if (this._talk === s) this._talk = null;
      this._applySound(false);
      if (s.cancel) {
        this._talkUi('idle');
        if (this.isConnected) this._flash('Hold to talk');
        return;
      }
      if (s.live && !s.liveFailed) {             // already heard at the door
        this._talkUi('idle');
        return;
      }
      var blob = new Blob(s.chunks, { type: (s.rec && s.rec.mimeType) || 'audio/webm' });
      this._sending = true;
      this._talkUi('busy');
      var url = '/api/hk_frontend/talk?entity_id=' + encodeURIComponent(c.speaker);
      var init = { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } };
      var req = h && h.fetchWithAuth ? h.fetchWithAuth(url, init) : Promise.reject(new Error('not connected'));
      req.then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (b) {
            throw new Error(b.message || ('HTTP ' + r.status));
          });
        }
        self._flash('Sent \u00b7 ' + s.secs.toFixed(1) + ' s');
      }).catch(function (e) {
        console.error('[hk-doorbell] talk', e);
        self._flash('Could not send');
      }).then(function () {
        self._sending = false;
        self._talkUi('idle');
      });
    }

    getCardSize() { return 6; }
  }

  register('hk-doorbell-card', HkDoorbellCard, 'HK Live Camera',
    'A camera live with its sound, for a pop-up. Give it a speaker and it gets a hold-to-talk button, as on the doorbell.',
    [
      { name: 'entity', label: 'Camera', selector: { entity: { domain: 'camera' } } },
      { name: 'name', label: 'Label', selector: { text: {} },
        helper: 'Shown in the corner, e.g. Driveway. Leave empty for none.' },
      { name: 'speaker', label: 'Talk through', selector: { entity: { domain: 'media_player' } },
        helper: 'The doorbell speaker you talk through. Leave empty for no talk button. Talking needs the page on https.' },
      { type: 'grid', name: '', schema: [
        // `default: true`: ha-form shows a selector's default as its
        // placeholder while the key is absent, so the switch reads on, as
        // the card treats it (on unless `false`). The stub writes both too.
        { name: 'live', label: 'Talk live', selector: { boolean: {} }, default: true,
          helper: 'Stream as you speak (UniFi Protect doorbells). Off: a recorded message, played when you let go.' },
        { name: 'sound', label: 'Play the doorbell sound', selector: { boolean: {} }, default: true },
        { name: 'aspect_ratio', label: 'Shape', selector: { text: {} },
          helper: 'Width by height, e.g. 4x3.' },
        { name: 'fill', label: 'Fill the space', selector: { boolean: {} },
          helper: 'Fill the whole box, letterboxed, instead of keeping a shape.' },
        { name: 'tuning', label: 'Tuning message', selector: { text: {} },
          helper: 'Shown until the picture starts, e.g. the channel name.' }
      ] }
    ],
    function (hass) {
      var ids = hass ? Object.keys(hass.states) : [];
      var cam = ids.filter(function (id) { return id.indexOf('camera.') === 0; })[0];
      return { entity: cam || '', live: true, sound: true };
    });

  // ======================================================================
  // hk-tv-guide-card -- LIVE TV: the channels the Live TV feature serves,
  // what is on each, and a tap that plays it full screen.
  //
  // THE CHANNELS COME FROM THE INTEGRATION, not from this card's config:
  // ws `hk_tv/channels` lists them, in order, with their camera and "now
  // playing" sensor. Channels are added and removed in Live TV's settings,
  // and every page showing this card follows.
  //
  // THE PLAYER is not a pop-up config: one full-screen sheet, made for
  // whichever channel was tapped, holding an hk-doorbell-card (the same live
  // WebRTC camera card, with `fill` and a tuning message). While it is open:
  //   * ws `hk_tv/watching` every 60 s names this screen as a viewer, and
  //     the viewers sensor carries it to a tablet's sleep logic, which can
  //     keep the tablet on its dashboard;
  //   * hkIdle holds, so a subview is not abandoned mid-show;
  //   * the controls fade after a few seconds and come back on a touch.
  // Closing (X, Escape, or leaving the page) stops all three and drops the
  // stream, which frees the tuner a few seconds later.
  var TV_HEARTBEAT_MS = 60000;
  var TV_CONTROLS_MS = 4000;
  var TV_RETRY_MS = [5000, 15000, 60000, 300000];   // an empty channel list: look again

  function tvTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function tvLeft(end) {
    var m = Math.round((new Date(end) - Date.now()) / 60000);
    if (!(m > 0)) return '';
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm left' : m + 'm left';
  }
  function tvProgress(start, end) {
    var s = +new Date(start), e = +new Date(end), n = Date.now();
    if (!(e > s)) return 0;
    return Math.max(0, Math.min(100, (n - s) / (e - s) * 100));
  }

  class HkTvGuideCard extends HkBase {
    // EVERY CLASS IS tv-: BASE_CSS already styles .tile as the 70 px pill,
    // and a tv card would inherit it.
    static get CSS() {
      var M = C.M;
      return [
        '.tv-hd{font-size:20px;font-weight:700;margin:0 4px 10px}',
        '.tv-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr))}',
        '.tv-tile{' + M.glass + ';border:' + M.border + ';border-radius:' + M.radius + ';',
        '  box-shadow:' + M.shSm + ';overflow:hidden;cursor:pointer;display:flex;flex-direction:column;',
        '  text-align:left;padding:0;color:inherit;font:inherit;-webkit-tap-highlight-color:transparent}',
        '.tv-tile:active{transform:scale(.98)}',
        '.tv-art{position:relative;aspect-ratio:16/9;background:#0b0d12;overflow:hidden}',
        '.tv-pic{position:absolute;inset:0}',
        '.tv-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
        '.tv-art ha-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
        '  --mdc-icon-size:44px;color:rgba(255,255,255,.4)}',
        '.tv-live{position:absolute;left:10px;top:10px;padding:3px 8px;border-radius:8px;',
        '  background:#ff3b30;color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em}',
        '.tv-logo{position:absolute;right:10px;top:10px;height:28px;max-width:40%;padding:4px 8px;',
        '  border-radius:9px;background:rgba(255,255,255,.88);display:flex;align-items:center}',
        '.tv-logo img{position:static;height:100%;width:auto;object-fit:contain}',
        '.tv-txt{padding:12px 14px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}',
        '.tv-chan{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
        '.tv-chan b{color:' + window.hkCards.v('ink') + ';font-size:15px;margin-right:6px}',
        // (the theme's ink: inherited, it was white on Flat's Light card)
        '.tv-title{font-size:17px;font-weight:700;color:' + window.hkCards.v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tv-sub{font-size:14px;color:' + window.hkCards.v('ink-2') + ';',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:1.2em}',
        '.tv-bar{height:4px;border-radius:2px;background:' + window.hkCards.v('line-strong') + ';margin:8px 0 4px;overflow:hidden}',
        '.tv-bar i{display:block;height:100%;background:' + window.hkCards.v('ink') + ';border-radius:2px}',
        '.tv-times,.tv-next{font-size:12.5px;color:' + window.hkCards.v('ink-2') + ';',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tv-empty{padding:24px;border-radius:' + M.radius + ';' + M.glass + ';text-align:center;',
        '  color:' + window.hkCards.v('ink-2') + '}'
      ].join('');
    }

    // Every "now playing" sensor wakes the card. The channel list is not a
    // state: it is asked for (_fetchChannels) on the first render, again
    // whenever the socket comes back (an HA restart), and again on a
    // back-off while the answer is empty -- see there.
    _sigOf() {
      var h = this._hass;
      if (!h || !this._channels) return null;
      return this._channels.map(function (c) {
        var st = c.now && h.states[c.now];
        return c.number + '=' + (st ? st.last_updated : 'x');
      }).join(';');
    }

    set hass(h) {
      Object.getOwnPropertyDescriptor(HkBase.prototype, 'hass').set.call(this, h);
      if (this._player) this._player.update(h);
    }
    get hass() { return this._hass; }

    // THE CHANNEL LIST, ASKED FOR AGAIN WHENEVER IT CAN BE WRONG. Asked for
    // once per card, ever, a tablet that drew this page while HA was
    // restarting would be told "not configured" (Live TV not set up yet) or
    // have the call refused, and would say so until somebody reloaded it.
    // So:
    //   * the socket's `ready` -- it came back, i.e. HA restarted -- asks again;
    //   * an empty or unconfigured answer, or a refused call, asks again on a
    //     back-off (TV_RETRY_MS: 5 s, 15 s, 1 min, then every 5 min) while the
    //     card is on the page. One timer at most, never a tight loop;
    //   * an empty answer never replaces a list already drawn: right after a
    //     restart it means "not set up YET", and the back-off looks again.
    _fetchChannels() {
      var h = this._hass, self = this;
      if (this._loading || !h || !h.callWS) return;
      clearTimeout(this._chanT);
      this._chanT = null;
      this._loading = true;
      Promise.resolve(h.callWS({ type: 'hk_tv/channels' })).then(function (r) {
        var list = (r && r.channels) || [];
        if (list.length || !(self._channels && self._channels.length)) {
          self._channels = list;
          self._configured = !!(r && r.configured);
        }
        return list.length > 0;
      }, function () {
        if (!self._channels) { self._channels = []; self._configured = false; }
        return false;
      }).then(function (good) {
        self._loading = false;
        if (good) self._chanTries = 0; else self._retryChannels();
        self.redraw();
      });
    }

    _retryChannels() {
      if (this.isConnected === false || this._chanT) return;
      var self = this, n = this._chanTries = (this._chanTries || 0) + 1;
      this._chanT = setTimeout(function () { self._chanT = null; self._fetchChannels(); },
        TV_RETRY_MS[Math.min(n - 1, TV_RETRY_MS.length - 1)]);
    }

    // `ready` is what home-assistant-js-websocket fires when the socket comes
    // BACK -- every reconnect, never the first connect. One listener, on the
    // connection this card was handed, and only while the card is on the page.
    _watchConn() {
      var conn = this._hass && this._hass.connection;
      if (this.isConnected === false || !conn || conn === this._conn ||
          typeof conn.addEventListener !== 'function') return;
      this._unwatchConn();
      var self = this;
      this._conn = conn;
      this._onReady = function () { self._chanTries = 0; self._fetchChannels(); };
      conn.addEventListener('ready', this._onReady);
    }

    _unwatchConn() {
      if (this._conn && this._onReady && typeof this._conn.removeEventListener === 'function') {
        this._conn.removeEventListener('ready', this._onReady);
      }
      this._conn = null;
      this._onReady = null;
    }

    _render() {
      var h = this._hass, self = this;
      if (!h) return;
      this._watchConn();
      if (!this._channels) { this._fetchChannels(); return; }
      this._root.innerHTML = '';
      if (!this._channels.length) {
        var e = document.createElement('div');
        e.className = 'tv-empty';
        e.textContent = this._configured
          ? 'No channels yet. Add some in HK Settings → Features → Live TV.'
          : 'Add Live TV (HK Frontend → Add feature) to show channels here.';
        this._root.append(e);
        return;
      }
      if (this._config && this._config.title) {
        var hd = document.createElement('div');
        hd.className = 'tv-hd';
        hd.textContent = this._config.title;
        this._root.append(hd);
      }
      var grid = document.createElement('div');
      grid.className = 'tv-grid';
      this._bars = [];
      this._channels.forEach(function (ch) { grid.append(self._tile(ch)); });
      this._root.append(grid);
    }

    _tile(ch) {
      var self = this, st = (ch.now && this._hass.states[ch.now]) || { state: '', attributes: {} };
      var a = st.attributes || {};
      var t = document.createElement('button');
      t.className = 'tv-tile';
      var art = document.createElement('div');
      art.className = 'tv-art';
      // The picture gets its own box: _artImage's fallback replaces the box's
      // contents, and would take the LIVE badge and the logo with it.
      var pic = document.createElement('div');
      pic.className = 'tv-pic';
      art.append(pic);
      if (a.image) this._artImage(a.image, pic, '<ha-icon icon="mdi:television-classic"></ha-icon>', 600);
      else pic.innerHTML = '<ha-icon icon="mdi:television-classic"></ha-icon>';
      art.insertAdjacentHTML('beforeend', '<span class="tv-live">LIVE</span>');
      if (a.logo) {
        var lg = document.createElement('div');
        lg.className = 'tv-logo';
        this._artImage(a.logo, lg, '', 150);
        art.append(lg);
      }
      var txt = document.createElement('div');
      txt.className = 'tv-txt';
      var line = function (cls, text) {
        var d = document.createElement('div'); d.className = cls; d.textContent = text || ''; txt.append(d); return d;
      };
      var chan = line('tv-chan', ch.number);
      chan.insertAdjacentHTML('afterbegin', '<b></b>');
      chan.firstChild.textContent = ch.name;
      line('tv-title', st.state && st.state !== 'unknown' ? st.state : 'Live');
      line('tv-sub', a.subtitle || '');
      if (a.start && a.end) {
        var bar = document.createElement('div');
        bar.className = 'tv-bar';
        bar.innerHTML = '<i></i>';
        txt.append(bar);
        var times = line('tv-times', '');
        this._bars.push({ bar: bar.firstChild, times: times, a: a });
      }
      if (a.next_title) line('tv-next', 'Next: ' + a.next_title + (a.next_start ? ' · ' + tvTime(a.next_start) : ''));
      t.append(art, txt);
      t.addEventListener('click', function (e) { e.stopPropagation(); self._open(ch); });
      this._tick();
      return t;
    }

    // Progress moves every half minute without re-rendering the tiles.
    _tick() {
      (this._bars || []).forEach(function (b) {
        b.bar.style.width = tvProgress(b.a.start, b.a.end).toFixed(1) + '%';
        b.times.textContent = tvTime(b.a.start) + ' – ' + tvTime(b.a.end) +
          (tvLeft(b.a.end) ? ' · ' + tvLeft(b.a.end) : '');
      });
    }

    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      clearInterval(this._tickT);
      this._tickT = setInterval(function () { self._tick(); }, 30000);
      this._watchConn();
      // Back on the page with nothing to show: look again now, not at the
      // next step of a back-off that stopped when the page was left.
      if (this._channels && !this._channels.length) {
        this._chanTries = 0;
        this._fetchChannels();
      }
    }

    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      clearInterval(this._tickT);
      clearTimeout(this._chanT);
      this._chanT = null;
      this._unwatchConn();
      // Leaving the page ends the show: no stream, tuner or hold left behind.
      if (this._player) this._player.close();
    }

    _open(ch) {
      if (!ch.camera) return;
      if (this._player) this._player.close();
      this._player = tvPlayer(this, ch);
    }

    getCardSize() { return 6; }
  }

  // The full-screen player. Mounted in home-assistant's shadow root, like
  // hk-popup's sheets (position:fixed under a transformed view would be
  // placed against the view, not the screen).
  function tvPlayer(owner, ch) {
    var h = owner._hass;
    var ha = document.querySelector('home-assistant');
    var mount = (ha && ha.shadowRoot) || document.body;
    var el = document.createElement('div');
    el.className = 'hktv';
    el.innerHTML = '<style>' +
      '.hktv{position:fixed;inset:0;z-index:8;background:#000;display:flex;' +
      '  -webkit-tap-highlight-color:transparent}' +
      '.hktv>hk-doorbell-card{flex:1;height:100%;display:block}' +
      '.hktv .top{position:absolute;left:18px;right:18px;top:16px;display:flex;' +
      '  align-items:center;justify-content:space-between;gap:12px;transition:opacity .3s;z-index:2}' +
      // The X NEVER fades -- there is always a way out;
      // the caption and the sound controls do.
      '.hktv .cap{transition:opacity .3s}' +
      '.hktv.quiet .cap{opacity:0}' +
      '.hktv .cap{height:40px;padding:0 16px;border-radius:20px;display:flex;align-items:center;' +
      '  background:rgba(28,28,30,.66);color:#fff;font-size:17px;font-weight:600;' +
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80%}' +
      '.hktv .x{width:44px;height:44px;border-radius:22px;flex:none;display:flex;' +
      '  align-items:center;justify-content:center;background:rgba(28,28,30,.66);color:#fff;' +
      '  cursor:pointer;--mdc-icon-size:24px}' +
      '</style><div class="top"><div class="cap"></div>' +
      '<div class="x" role="button" aria-label="Close" tabindex="0"><ha-icon icon="mdi:close"></ha-icon></div></div>';
    var cam = C.create({ type: 'custom:hk-doorbell-card', entity: ch.camera, fill: true,
                         tuning: ch.name, volume: true, aspect_ratio: '16x9', glass: false });
    el.insertBefore(cam, el.firstChild);
    var cap = el.querySelector('.cap');
    var quietT = null, beatT = null, closed = false;
    function quiet(on) {
      el.classList.toggle('quiet', on);
      cam.style.setProperty('--hk-db-bar-opacity', on ? '0' : '1');
      cam.style.setProperty('--hk-db-bar-events', on ? 'none' : 'auto');
    }
    function wake() {
      quiet(false);
      clearTimeout(quietT);
      quietT = setTimeout(function () { quiet(true); }, TV_CONTROLS_MS);
    }
    // Runs on EVERY hass push (~10 a second) while the player is up, so it
    // writes only a caption that changed: an identical textContent still
    // replaces the text node, and that is a relayout and a repaint over
    // playing video for nothing.
    function caption(hh) {
      var st = ch.now && hh && hh.states[ch.now];
      var title = st && st.state && st.state !== 'unknown' ? st.state : '';
      var text = ch.name + (title ? ' · ' + title : '');
      if (cap.textContent !== text) cap.textContent = text;
    }
    function watching(on) {
      var hh = owner._hass;
      if (!hh || !hh.callWS) return;
      Promise.resolve(hh.callWS({ type: 'hk_tv/watching', channel: on ? ch.number : null }))
        .catch(function (e) { console.warn('[hk-tv] watching', e); });
    }
    var player = {
      update: function (hh) { if (!closed) { cam.hkSetHass(hh); caption(hh); } },
      close: function () {
        if (closed) return;
        closed = true;
        clearTimeout(quietT); clearInterval(beatT);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('pagehide', onHide);
        releaseMedia(el);
        if (el.parentNode) el.parentNode.removeChild(el);   // drops the stream
        watching(false);
        if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold('hk-tv', false);
        if (owner._player === player) owner._player = null;
      }
    };
    function onKey(e) { if (e.key === 'Escape') player.close(); }
    // A reload or navigation away never reaches close(): say so on the way
    // out (best effort -- the 150 s heartbeat expiry is the backstop).
    function onHide() { player.close(); }
    el.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); player.close(); });
    el.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pagehide', onHide);
    mount.appendChild(el);
    player.update(h);
    wake();
    watching(true);
    beatT = setInterval(function () { watching(true); }, TV_HEARTBEAT_MS);
    if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold('hk-tv', true);
    return player;
  }

  register('hk-tv-guide-card', HkTvGuideCard, 'HK Live TV Guide',
    'The Live TV channels with what is on now, and a tap that plays one full screen.',
    [{ name: 'title', label: 'Title', selector: { text: {} },
       helper: 'Optional heading. The channels themselves are added in HK Settings → Features → Live TV.' }],
    function () { return {}; });

  window.hkCameras = { version: '1.0.0' };
  // for tests: the Cameras page's take-turns queue (hk-camera-live-card)
  window.hkCameras._live = { queue: function () { return liveQueue; }, turns: function () { return liveTurns.slice(); },
                             video: liveVideo, TURN_MS: LIVE_TURN_MS, STUCK_MS: LIVE_STUCK_MS, SAVED_MAX_MS: SAVED_MAX_MS };
  });
})();
