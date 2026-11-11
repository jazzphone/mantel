// hk-cameras-mosaic.js - the camera mosaic.
//
// PART OF THE CAMERA CARDS (hk-cameras.js). Not a card and not run on its own: it registers one
// function, which hk-cameras.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkCamerasParts = window.hkCamerasParts || {})['hk-cameras-mosaic'] = function (K) {
    var AFTER_BLACK = K.AFTER_BLACK, blackFrame = K.blackFrame, C = K.C, CAM_FOCUS = K.CAM_FOCUS, HkBase = K.HkBase,
        LIVE_AFTER_WAKE = K.LIVE_AFTER_WAKE, LIVE_WAKE_MAX = K.LIVE_WAKE_MAX, releaseMedia = K.releaseMedia,
        snapCacheGet = K.snapCacheGet, snapCachePut = K.snapCachePut, VIDEO_OUTSIDE = K.VIDEO_OUTSIDE;

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
          // ...and HK's own picture-entity where there is no Lovelace (Mantel, HK's panel: made by
          // hkCards.createCard through HK's view host), the same rule for each of the three
          '.live>hk-picture-entity{position:absolute;inset:0;z-index:1;transition:opacity .3s ease}',
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
          '.live>hk-picture-entity.wait{opacity:0;visibility:hidden;transition:none}',
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
          '.live.pop>hk-picture-entity{pointer-events:none}',
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
          // THE CAMERAS FACE (`grid`, 2026-10-30; hk-grid-cards.js
          // hk-grid-cameras-card): not one joined plate but a tile per camera,
          // apart, each with the block's corner and shadow, its name in a pill at
          // the foot and its age in one at the top; the live one (a ringing
          // doorbell) ringed red, LIVE where its age was
          // (the plate itself has none of the strip's own: no corner, colour or shadow is set on it here)
          '.plate.grid{width:100%;height:100%;overflow:visible}',
          '.plate.grid>.snap,.plate.grid>.live{border-radius:' + C.M.radius + ';box-shadow:var(--hk-look-shadow, 0 8px 22px rgba(0,0,0,0.12))}',
          '.plate.grid>.snap:focus-visible,.plate.grid>.live:focus-visible{outline:3px solid ' + C.v('ink') + ';outline-offset:2px}',
          '.plate.grid .cn,.plate.blk .cn{position:absolute;left:10px;bottom:10px;z-index:3;max-width:calc(100% - 20px);box-sizing:border-box;',
          '  height:25px;padding:6px 9px;border-radius:' + C.R.capsule('25px') + ';background:' + C.v('float-plate') + ';color:#fff;font-size:13px;font-weight:600;line-height:13px;',
          '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}',
          // (a block's name clear of the pager's dots at the foot's middle; 2026-11-07, the review: in from the corner by the block's inset like the age, and Tall's has its width)
          '.plate.blk .cn{max-width:calc(50% - 30px);left:var(--hk-block-pad,10px);bottom:var(--hk-block-pad,10px)}.plate.blk[data-sz=T] .cn{max-width:calc(100% - 2 * var(--hk-block-pad,10px))}',
          // (the block's Name: Hide, or Automatic on HomeView's square cells -- the owner, 2026-10-31: the name
          // in the corner, "Front Door Camera Low resolution cha...", wasn't wanted there; 2026-11-07: Small and Wide are one row of cells, the rest two -- a tile's tall block is 314, not a square
          // cell's)
          '.plate.blk[data-name=hide] .cn{display:none}',
          '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){.plate.blk[data-sz=S]:not([data-name=show]) .cn,.plate.blk[data-sz=W]:not([data-name=show]) .cn{display:none}}' +
            '@container hk-cell (min-height:360px){.plate.blk:not([data-name=show]) .cn{display:none}}',
          // (in from the corner by the block's own inset -- 18 on square cells, 14 on tiles -- so the capsule sits about
          // concentric with the block's curve: at 10 it was "really close to the edge", 2026-10-31, the owner)
          '.plate.grid .age,.plate.blk .age{left:auto;bottom:auto;right:var(--hk-block-pad,10px);top:var(--hk-block-pad,10px);box-sizing:border-box;height:21px;padding:5px 8px;border-radius:' +
            C.R.capsule('21px') + ';',
          '  background:' + C.v('float-plate') + ';font-size:11px;font-weight:600;line-height:11px;color:' + C.v('ink-2') + ';text-shadow:none}',
          '.plate.grid .age:empty,.plate.blk .age:empty{display:none}',
          '.plate.grid>.on .age{display:none}',
          '.plate.grid .lv{position:absolute;right:var(--hk-block-pad,10px);top:var(--hk-block-pad,10px);z-index:3;box-sizing:border-box;height:21px;padding:5px 8px;border-radius:' +
            C.R.capsule('21px') + ';',
          '  background:#ff3b30;color:#fff;font-size:11px;font-weight:700;line-height:11px;letter-spacing:.06em;pointer-events:none}',
          '.plate.grid>.on::after{content:"";position:absolute;inset:0;z-index:2;border-radius:inherit;box-shadow:inset 0 0 0 3px #ff3b30;pointer-events:none}',
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
        var h = this.client, by = {};
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
        var h = this.client, st = h && h.states && h.states[cam.entity];
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
      // mean "always render", and the frontend hands a card a new state object
      // 12x a second -- see the gating note in HkBase. The camera images refresh
      // themselves; this card only decides WHICH camera sits in slot 1.
      // WITHOUT A SELECTOR THE PLAN NEVER CHANGES -- the first camera is live --
      // so the signature is a constant, not null. Null means "render on every
      // state push", and a render rebuilds the plate: a generated dashboard's
      // strip (no selector) would re-create its live tile 12 times a second,
      // so the WebRTC stream is torn down before its first frame -- a black
      // tile, a flickering strip, and go2rtc churning through abandoned
      // sessions until it is restarted.
      _sigOf() {
        var h = this.client, c = this._config;
        if (!h || !c) return null;
        // the item's cameras and live-camera choice change only when a setting
        // is saved -- never per state push (the rebuild storm above)
        var b = this._board();
        var key = JSON.stringify([b.cameras || [], b.camera_live || '', this._liveOn()]);
        // AFTER A RECONNECT the live tile waits for its camera's first state
        // from the new server (hk-base.js STALE) and mounts when it arrives:
        // one render on the way in, one when the camera is back.
        if (C.staleEpoch()) {
          var pl = this._plan();
          if (pl && pl.live && !pl.still && C.stale(h.states[pl.live.entity])) key += '|wait';
        }
        // (the Cameras face: its own cameras; its live tile is a new config)
        if (c.grid) return 'grid|' + key;
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
        // THE CAMERAS FACE (`grid: [columns, rows]`): as many as it has places,
        // in order, `live` the one live in its place (a ringing doorbell)
        var grid = this._config && this._config.grid;
        if (Array.isArray(grid) && grid[0] > 0 && grid[1] > 0) {
          var shown = cams.slice(0, grid[0] * grid[1]), want = this._config.live;
          return { grid: [grid[0], grid[1]], cams: shown, live: shown.filter(function (c) { return c.entity === want; })[0] || null };
        }
        // STILLS ONLY (a room page, 2026-10-09): no live tile -- every camera
        // in the pattern, starting with a full-height single, as the Home app
        // draws a room's cameras (one tall, then two stacked).
        var stillsOnly = !!(this._config && this._config.stills_only);
        if (stillsOnly) return { live: null, cols: this._columns(cams, false) };
        var selId = this._selector();
        var h = this.client, selSt = h && selId ? h.states[selId] : null;
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
        // HA draws it (in Lovelace's card wrapper): the adapter decides what it gets
        var el = window.hkCards.createCard(cfg, this.client);
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
        window.hkShell.moreInfo(cam.entity, this);
      }

      // A STILL CAMERA IS RENDERED HERE, NOT BY picture-entity, and the reason is
      // the black flash. See the .snap CSS above for the mechanism; this is the
      // rest of it -- the URL, the interval, and which cameras get refreshed.
      //
      // The src is the entity's own `entity_picture`, a camera_proxy URL that
      // arrives pre-signed with a token. It is re-read from the client on EVERY tick
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
        var h = this.client, st = h && h.states[cam.entity];
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
        } else {
          // A SIZE EVEN BEFORE THE TILE IS MEASURED (2026-10-29): a slot not laid out yet asked for the camera's
          // full frame. The cap (the tile's tier, 480x270 unless configured) is the least that is sharp enough.
          var fb = this._snapCap() || { w: 960, h: 540 };
          q += '&width=' + fb.w + '&height=' + fb.h;
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
        // ban them for. The reconnect brings fresh states with fresh tokens, and
        // the next tick resumes on its own.
        if (this.client && this.client.connected === false) return;
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
        if (CAM_FOCUS.away()) return true;
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
        // Only on the page. _render calls this too, and a card fed a client
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
            if (CAM_FOCUS.away()) return;            // (the focus coming back wakes it: _onFocus)
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
          window.hkShell.onNavigate(this._onNav);
        }
        if (!this._onSaverCovered) {
          this._onSaverCovered = function () { self._stopInterval(); self._sleepLive(); };
          window.addEventListener('hk-saver-covered', this._onSaverCovered);
        }
        // ANOTHER WINDOW IN FRONT (CAM_FOCUS, Cameras -> Pause When Not in
        // Focus): the stills stop and the live tile lets go of its stream, as
        // behind the screensaver; the focus back brings them back -- unless
        // something else still has them resting
        if (!this._onFocus) {
          this._onFocus = function (e) {
            if (e && e.detail && e.detail.away) { self._grabLive(); self._stopInterval(); self._sleepLive(); return; }
            if (document.hidden || self._resting()) return;
            if (window.hkSaver && window.hkSaver.running && window.hkSaver.running()) return;
            self._startInterval();
            self._wakeLive();
          };
          window.addEventListener('hk-camera-focus', this._onFocus);
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
        if (this._onFocus) { window.removeEventListener('hk-camera-focus', this._onFocus); this._onFocus = null; }
        if (this._onPopup) { window.removeEventListener('hk-popup-change', this._onPopup); this._onPopup = null; }
        if (this._onNav) { window.hkShell.offNavigate(this._onNav); this._onNav = null; }
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
        if (this._config && this.client) this._startTimer();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        this._stopTimer();
      }

      _render() {
        if (!this._root || !this._config || !this.client) return;
        this._root.textContent = '';
        this._snaps = [];
        this._liveSlot = null;          // an empty `cameras:` must not keep the old poster ticking
        this._stopTimer();
        var plan = this._plan();
        if (!plan) return;
        if (plan.grid) { this._renderGrid(plan); return; }

        var H    = this._num('height', 202.5);
        var SEAM = this._num('seam', 2);
        var liveW = Math.round(H * this._num('live_ratio', 16 / 9));
        var colW  = Math.round(H * this._num('column_ratio', 4 / 3));
        // ONE CAMERA, NO LIVE TILE (a room with a single camera): one still,
        // the live tile's 16:9 -- not a lone column, which read as a crop
        if (!plan.live && plan.cols.length === 1 && plan.cols[0].length === 1) colW = liveW;
        // ON A HOME GRID (G2): the block's size, from one cell's (--hk-cell-w /
        // -h): W and XL one camera filling it, L two stacked (a 16:9 picture
        // each at 402 x 162) -- the rest are the pager's (G4)
        this._watchBlock();
        var block = this._block(), under = null, liveH = H;
        if (block && plan.live) {
          H = this._num('fit_h', block.h); liveW = this._num('fit_w', block.w); liveH = H;
          under = this._cellSize() === 'L' && plan.cols.length ? plan.cols[0][0] : null;
          if (under) liveH = (H - SEAM) / 2;
          plan.cols = [];
        }
        var liveRow = under ? '1' : '1 / 3';
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
        // (a block's own corners on square cells: hk-home-grid-view's --hk-block-radius)
        plate.style.borderRadius = (this._config.radius || (block ? 'var(--hk-block-radius, ' + C.M.radius + ')' : C.M.radius));
        plate.style.background = (this._config.seam_color || '#0b0d12');
        plate.style.boxShadow = (this._config.shadow || 'var(--hk-look-shadow, 0 8px 22px rgba(0,0,0,0.12))');

        if (plan.live && plan.still) {
          // slot 1 as a snapshot (Live First Camera off): the same box, no stream
          var first = this._snap(plan.live, liveW, liveH);
          first.style.gridColumn = '1';
          first.style.gridRow = liveRow;
          plate.appendChild(first);
        } else if (plan.live) {
          // slot 1: the live camera, full height, uncropped
          var liveBox = this._liveBox(plan.live, liveW, liveH);
          liveBox.style.gridColumn = '1';
          liveBox.style.gridRow = liveRow;
          plate.appendChild(liveBox);
        }
        // A HOME GRID BLOCK NAMES ITS CAMERA (2026-10-31, against the HomeView
        // mock-up): the name at the foot, its age at the top -- the Cameras
        // face's own tags
        if (block && plan.live) {
          plate.classList.add('blk');
          plate.setAttribute('data-name', /^(show|hide)$/.test((this._config || {}).name_tag || '') ? this._config.name_tag : 'auto'); plate.setAttribute('data-sz', this._cellSize() || '');
          var cn = document.createElement('span');
          cn.className = 'cn';
          cn.textContent = this._nameOf(plan.live);
          plate.firstElementChild.appendChild(cn);
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
        if (under) {
          var low = this._snap(under, liveW, liveH);
          low.style.gridColumn = '1';
          low.style.gridRow = '2';
          plate.appendChild(low);
        }
        this._root.appendChild(plate);
        this._startTimer();
      }


      // THE CAMERAS FACE: each camera a tile in the block's grid, a still at
      // its tile's own size (_srcFor: the server shares one fetch of a size
      // between tablets, camera_still.py), the live one in its place
      _renderGrid(plan) {
        this._watchBlock();
        var b = this._block(), g = plan.grid, gap = this._num('seam', C.HOME_GRID.gap), self = this;
        var cw = b ? (b.w - (g[0] - 1) * gap) / g[0] : 320, ch = b ? (b.h - (g[1] - 1) * gap) / g[1] : 180;
        this._children = [];
        var plate = document.createElement('div');
        plate.className = 'plate grid';
        plate.style.gridTemplateColumns = 'repeat(' + g[0] + ', minmax(0, 1fr))';
        plate.style.gridTemplateRows = 'repeat(' + g[1] + ', minmax(0, 1fr))';
        plate.style.gap = gap + 'px';
        plan.cams.forEach(function (cam) {
          var on = plan.live === cam, el = on ? self._liveBox(cam, cw, ch) : self._snap(cam, cw, ch);
          var name = self._nameOf(cam);
          if (on) el.classList.add('on');
          el.setAttribute('role', 'button');
          el.setAttribute('tabindex', '0');
          el.setAttribute('aria-label', name + (on ? ', live' : ''));
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._openCam(cam); }
          });
          var cn = document.createElement('span');
          cn.className = 'cn';
          cn.textContent = name;
          el.appendChild(cn);
          if (on) {
            var lv = document.createElement('span');
            lv.className = 'lv';
            lv.textContent = 'LIVE';
            el.appendChild(lv);
          }
          plate.appendChild(el);
        });
        this._root.appendChild(plate);
        this._startTimer();
      }
      _nameOf(cam) {
        var st = this.client && this.client.states && this.client.states[cam.entity];
        return cam.name || (st && st.attributes && st.attributes.friendly_name) || cam.entity;
      }

      // THE LIVE TILE: the camera's own card (a stream), over two posters of its
      // still (the same slot as a still's, so the same _loadSlot path), the
      // tap on the box. Kept as this._liveSlot -- one live tile per card.
      _liveBox(cam, liveW, liveH) {
        var liveAr = liveW + 'x' + Math.round(liveH);
        // no live card on a state the new server has not sent (see _sigOf): the
        // poster holds the slot until the camera is back
        var stale = C.stale(this.client.states[cam.entity]), resting = !stale && this._resting();
        var lv = stale || resting ? document.createElement('div') : this._pic(cam, true, liveAr);
        if (VIDEO_OUTSIDE && lv.classList) lv.classList.add('wait');
        var liveBox = document.createElement('div');
        liveBox.className = 'live';
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
        var me = this, liveCam = cam;
        liveBox.classList.add('pop', 'tap');
        liveBox.addEventListener('click', function () { me._openCam(liveCam); });
        // The poster is SLOT-SHAPED on purpose: it then goes through the exact
        // same _loadSlot path as the stills -- double buffer, three-way release,
        // hard swap -- instead of a second copy of that logic.
        this._liveSlot = {
          el: lv, cam: cam, ar: liveAr, box: liveBox,
          poster: { box: liveBox, cam: cam, imgs: [pa, pb], front: -1,
                    loading: [false, false], cssW: liveW, cssH: liveH, age: liveAge,
                    cv: pcv.el, ctx: pcv.ctx }
        };
        // built resting: asleep, for the wake to remount (_resting)
        if (resting) this._liveSlot.asleep = true;
        this._wireRestore(this._liveSlot.poster);
        return liveBox;
      }

      // EACH NEW CLIENT MUST REACH THE CHILDREN, and HkBase's default does not
      // do it -- it only gates the re-render. hk-row-card does the same.
      // Without this the picture-entity cards keep whatever they were built
      // with and go stale between selector changes, which is most of the time
      // (this card deliberately re-renders only when the live camera changes).
      // HkBase's entry has already told its hub (the reconnect hook, hk-base.js
      // STALE); this replaces the rest of HkBase's step, as the setter it
      // replaces did: its own gate, no tone or wake tracking.
      _receiveClient() {
        var c = this.client, kids = this._children || [];
        for (var i = 0; i < kids.length; i++) window.hkHostClient.bridge(kids[i], c);

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

      // Two rows of tiles at ~100px each; HA only needs a rough number.
      getCardSize() { return 2; }

      static getConfigElement() {
        return document.createElement('hk-camera-mosaic-editor');
      }
      // THE HOUSE'S FIRST THREE CAMERAS, so the picker's card shows something:
      // an empty list draws nothing at all. No selector: the first is live.
      static getStubConfig(input) {
        var client = C.asClient(input), ids = client && client.states ? Object.keys(client.states) : [];
        var cams = ids.filter(function (id) { return id.indexOf('camera.') === 0; }).slice(0, 3);
        return { cameras: cams.map(function (id) { return { entity: id }; }) };
      }
    }

    // what the shell and the later parts use of this one
    K.HkCameraMosaicCard = HkCameraMosaicCard;
  };
})();
