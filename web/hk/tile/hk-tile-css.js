// hk-tile-css.js - the tiles' CSS.
//
// PART OF THE TILE CARDS (hk-tile.js). Not a card and not run on its own: it registers one
// function, which hk-tile.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkTileParts = window.hkTileParts || {})['hk-tile-css'] = function (K) {
    var levelTile = K.levelTile, OFF_WELL = K.OFF_WELL, TILE = K.TILE, tinyTile = K.tinyTile,
        wideLevelTile = K.wideLevelTile, wideTile = K.wideTile;

    var CSS = [
      ':host{display:block}',
      'hk-plate.card{',
      '  box-sizing:border-box;',
      // --hk-pill: the pill everywhere but an iPad held upright (css/hk-responsive.css).
      '  height:' + TILE.h + 'px;width:' + TILE.css + ';min-width:' + TILE.css + ';max-width:' + TILE.css + ';',
      '  border-radius:' + window.hkCards.M.radius + ';',
      // 10.7 / 12.8 / 10.7 / 10.3 -- asymmetric on purpose, measured.
      '  padding:' + TILE.pad + ';',
      '  margin:0px;',
      // The lit top rim is the glass material -- NOT the gradient. Two surfaces
      // with byte-identical backgrounds and borders read as different materials
      // when only one has this line.
      '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-pill') + ');',
      '  border:' + window.hkCards.M.border + ';',
      '  ' + window.hkCards.M.glass + ';',
      // OFF, a tone of its own in Flat's Light (--hk-tile-off, 2026-10-17):
      // the ivory plate beside the lit white read the same, on or off
      '  background:var(--hk-tile-off,' + window.hkCards.M.bg + ');',
      '  display:flex;align-items:center;justify-content:center;',
      // These are inherited values, so they reach every descendant: text-align
      // and font-size in particular are what a child element silently inherits.
      // 1.2em, NOT 1.05rem. Both render 16.8px when the root is 16px, but the
      // root here is 14px, so rem gives 14.7px. em is relative to the inherited
      // size.
      '  overflow:hidden;text-align:center;font-size:1.2em;',
      '  cursor:pointer;',
      '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
      '  transition:background-color .25s ease,transform .12s ease;',
      '}',
      'hk-plate.card:active{transform:scale(0.97);filter:brightness(0.93)}',
      // Lit, the plate is opaque white: a blur behind it ("Blur each card")
      // would be composited every frame and never seen.
      'hk-plate.card[data-on="1"]{background:white;--hk-glass-backdrop:none}',
      // ...and on a light page (hk-base.js tone) lifts off it with a shadow
      ':host([data-hk-light]) hk-plate.card[data-on="1"]{box-shadow:var(--hk-on-shadow)}',

      '.grid{display:grid;width:100%;',
      '  grid-template-columns:42px minmax(0,1fr);',
      // TEXT ROWS OF A LINE EACH, not min-content: the 42 px circle spans
      // both rows, and min-content rows grew to share its height -- the name
      // and state stood 20.4 px apart, the Home app's 18.6 (2026-10-13)
      '  grid-template-rows:' + TILE.lineH + 'px ' + TILE.lineH + 'px;',
      '  row-gap:' + TILE.rowGap + 'px;column-gap:' + TILE.wellGap + 'px;align-content:center}',

      '.well{grid-area:i;width:42px;height:42px;border-radius:50%;',
      '  background:' + OFF_WELL + ';align-self:center;justify-self:center;',
      '  display:flex;align-items:center;justify-content:center;overflow:hidden;',
      '  transition:background-color .25s ease}',

      // --mdc-icon-size:100% with an explicit box. Setting the size directly
      // on --mdc-icon-size instead
      // renders the same today but diverges the moment a glyph is swapped for
      // one with different padding.
      // THE GLYPH MUST BE CENTRED IN ITS OWN BOX, or a spinning fan wobbles.
      // hk-state-icon (HA's ha-state-icon) renders its icon as an INLINE box, so without flex the
      // glyph's height comes from the line strut: it sits 1.31px above the box
      // centre -- the rotation axis -- and measures 20.2px tall instead of
      // 23.7px, slightly small and slightly high. The inner icon lives
      // inside the state icon's shadow root, so a style check of the card alone
      // misses it. Flex centring makes the shadow child fill and centre.
      '.icon{width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px;--mdc-icon-size:100%;' +
      '  display:flex;align-items:center;justify-content:center;line-height:0;',
      '  color:' + window.hkCards.v('glyph') + ';transition:color .25s ease}',

      '.name{grid-area:n;justify-self:stretch;text-align:left;align-self:center;',
      '  font-weight:600;font-size:15px;line-height:' + TILE.lineH + 'px;letter-spacing:-0.23px;',
      '  color:' + window.hkCards.v('ink') + ';',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      '  min-width:0;width:100%}',
      'hk-plate.card[data-on="1"] .name{color:black}',

      '.label{grid-area:l;justify-self:stretch;text-align:left;align-self:start;',
      '  font-weight:400;font-size:15px;letter-spacing:-0.23px;line-height:' + TILE.lineH + 'px;',
      '  color:' + window.hkCards.v('ink-2') + ';',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // IN A SECTION (HA's Sections view, not HK's grid): the tile fills its
      // cell, two to a section by default, instead of sitting pill-wide in it.
      ':host([data-hk-cell]) hk-plate.card{width:100%;min-width:0;max-width:none}',
      'hk-plate.card[data-on="1"] .label{color:' + window.hkCards.v('ink-on-state') + '}',
      // BRIGHT GLASS (2026-10-30): off, the second line the background's light
      // color into white (--hk-look-sub) and a light text shadow -- unset (as
      // before) in every other look
      'hk-plate.card:not([data-on="1"]) .label,hk-plate.card:not([data-on="1"]) .room{color:var(--hk-look-sub, ' + window.hkCards.v('ink-2') + ')}',
      'hk-plate.card:not([data-on="1"]) .grid{text-shadow:var(--hk-look-text-shadow, none)}',

      // ---- scene variant -------------------------------------------------
      // A scene is NOT a pill with a different grid. Diffing every resolved
      // property of the two gives 33 differences; the
      // outer box (the pill: 196 x 70, r23.5, 42px slot) is identical, which is what makes
      // them one family, but everything inside it differs. Each rule below is one
      // of those measured differences -- do not fold them back into the base.
      //
      // No outer shadow by default -- only the inset rim, which is what
      // carries the glass read here; `elevated` adds the pill shadow (the
      // scenes row opens room for it inside its clip, see hk-row-card).
      'hk-plate.card.scene{box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-scene') + ')}',
      // `elevated` -- the action tile -- is a scene with the outer shadow PUT
      // BACK.
      'hk-plate.card.scene.elevated{box-shadow:var(--hk-look-shadow, inset 0 1px 0 rgba(255,255,255,0.20),' +
      '  0 8px 22px rgba(0,0,0,0.12))}',
      '.card.scene .grid{grid-template-rows:1fr;row-gap:normal;align-items:center;column-gap:' + TILE.sceneWellGap + 'px}',
      // a scene's glyph and name stay where they were: its text already sits
      // where the Home app's does (the accessory pill's moved 0.5 / 0.9 left)
      'hk-plate.card.scene{padding-left:' + TILE.scenePadL + 'px}',
      // THE WELL IS NOT PAINTED. A scene centres a bare glyph in the same 42px
      // slot -- no circle, no fill. This is the single easiest difference to miss
      // by eye and the reason one card with four layouts cannot work.
      '.card.scene .well{background:none;border-radius:0}',
      // TILE.sceneGlyph: 28 px, measured off the Home app's iPad layout (the
      // HomeKit match, 2026-10-13): its scene glyph runs ~2 px smaller than the
      // 30 an iPhone screenshot gave (25.3 pt on a 60 pt plate = 0.428 x 70).
      // The accessory glyph is NOT the comparison to use here:
      // a scene has no well, so its glyph carries the whole icon slot and runs
      // bigger than the 25px welled glyphs it sits beside.
      '.card.scene .icon{width:' + TILE.sceneGlyph + 'px;height:' + TILE.sceneGlyph + 'px}',
      // 700 and a 2-LINE CLAMP, not 600 and an ellipsis: a scene name is a
      // phrase ("Good Morning"), not a device label, and is allowed to wrap.
      '.card.scene .name{font-weight:700;white-space:normal;',
      '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
      '.card.scene .label{display:none}',

      // ---------------------------------------------------- MOMENTARY FEEDBACK
      //
      // A scene has no on-state to settle into, so a press has to leave its own
      // trace: the white plate, and the ring that sweeps round the glyph.
      //
      // `--hk-tap: 1` is a MARKER, not a style. /hk/hk-tap.js reads it off the
      // computed style of the hk-plate under the finger and holds `.hk-tapped`
      // for 1050ms -- exactly one sweep of the ring. It finds this card through
      // composedPath, so a shadow root is no obstacle; the card only has to opt
      // in. Nothing else consumes the marker.
      'hk-plate.card.scene{--hk-tap:1;',
      '  transition:background-color 1.2s ease-out,transform .14s ease}',
      // ASYMMETRIC ON PURPOSE: no transition going in, so the flip is instant,
      // and a long one coming out, so the tile keeps glowing for about a second
      // after the finger leaves.
      '.card.scene .name,.card.scene .icon{transition:color 1.2s ease-out}',
      // The Home app does not "brighten" a tapped scene -- it flips the pill to the
      // same solid-white ACTIVE look a switched-on accessory gets. So the base
      // tile's brightness dim must not apply here.
      'hk-plate.card.scene:active{filter:none}',
      // THE WHITE PLATE IS .hk-tapped ONLY -- never `:active`.
      //
      // `:active` is set the instant a finger lands, and the browser cannot know
      // yet whether that finger is tapping or about to scroll. A phone page is
      // thousands of px tall, so the commonest thing a finger does to a scene
      // pill is push it out of the way -- and on `:active` the pill would flip
      // solid white on the way past, which reads as "I just ran that scene".
      //
      // hk-tap.js resolves the ambiguity (90ms of stillness, or an early lift,
      // and it cancels on 8px of travel) and only then adds .hk-tapped. The ring
      // below is .hk-tapped-only too.
      //
      // WHAT STILL FIRES ON `:active`: the base tile's scale(0.97) at the top of
      // this stylesheet. That is 3%, browser-managed, and it is the honest "your
      // finger is down" signal, so it is safe on the ambiguous event.
      // COST: if /hk/modules/hk-tap.js fails to load, a scene tap gets the scale
      // and no white flip.
      'hk-plate.card.scene.hk-tapped{',
      '  transition:none;background:rgba(255,255,255,0.96)}',
      // !important IS LOAD-BEARING: without it the glyph stays white on a
      // tapped scene while the name goes black. _render assigns
      // the icon's colour as an INLINE style (it is computed per state), and an
      // inline style beats a stylesheet rule -- but not an important one.
      'hk-plate.card.scene.hk-tapped .name,hk-plate.card.scene.hk-tapped .icon{',
      '  transition:none;color:rgba(0,0,0,0.92)!important;fill:rgba(0,0,0,0.92)!important}',
      // The ring is drawn INSIDE the well (inset:0) so it sits round the glyph
      // and the well's own overflow:hidden never touches it. Only the
      // positioning context is needed; the well's overflow stays as it is.
      '.card.scene .well{position:relative}',
      '.card.scene .well::after{content:"";position:absolute;inset:0;',
      '  border-radius:50%;',
      '  background:conic-gradient(rgba(0,0,0,0.32) var(--hk-ring,0deg),rgba(0,0,0,0) 0);',
      '  -webkit-mask:radial-gradient(closest-side,rgba(0,0,0,0) calc(100% - 2.5px),#000 calc(100% - 2.5px));',
      '  mask:radial-gradient(closest-side,rgba(0,0,0,0) calc(100% - 2.5px),#000 calc(100% - 2.5px));',
      '  opacity:0;pointer-events:none;transition:opacity .25s ease-out}',
      'hk-plate.card.scene.hk-tapped .well::after{',
      '  opacity:1;transition:none;animation:hk-ring-sweep 1.05s linear}',
      // --hk-ring has to be REGISTERED as an <angle> to interpolate at all --
      // an unregistered custom property is just a token stream and would jump
      // 0 -> 360 at the halfway mark. hk-tap.js registers it at document scope,
      // because @property inside a shadow-root stylesheet is not reliably
      // honoured. If that module never loads the ring stays invisible and the
      // rest of the feedback still works.
      '@keyframes hk-ring-sweep{from{--hk-ring:0deg}to{--hk-ring:360deg}}',
      // A PILL IN A COLOUR (HkSceneCard._tint), lit or tapped: its colour fills
      // a circle -- the accessory's well -- behind a white glyph at the
      // accessory's 25px, the ring sweeping round the circle. !important: the
      // tapped plate's near-black glyph above is !important too, and the well's
      // off background is written inline.
      '.card.scene.tinted .well{border-radius:50%;transition:background-color 1.2s ease-out}',
      'hk-plate.card.scene.tinted[data-on="1"] .icon,hk-plate.card.scene.tinted.hk-tapped .icon{width:25px;height:25px}',
      'hk-plate.card.scene.tinted.hk-tapped .well{transition:none;background:var(--hk-tint)!important}',
      'hk-plate.card.scene.tinted.hk-tapped .icon{color:#fff!important;fill:#fff!important}',
      '@media (prefers-reduced-motion:reduce){',
      '  hk-plate.card.scene,hk-plate.card.scene:active,hk-plate.card.scene.hk-tapped,',
      '  .card.scene .well,.card.scene .name,.card.scene .icon{',
      '    transition:none;transform:none}',
      '  hk-plate.card.scene.hk-tapped .well::after{animation:none;opacity:0}}',

      // A RUNNING FAN'S GLYPH SPINS: the fan tile defaults `animation: spin`,
      // and the on-state turns that into the hk-spin keyframe below. It is
      // easy to miss because a static screenshot of a spinning icon looks
      // correct.
      // ---- favourite variant ---------------------------------------------
      // Differences from the plain pill: a third text row above the name,
      // padding 9.7 not 10.7 (the extra row has to come from somewhere), and
      // the three rows EVENLY SPACED, 1px apart (lines 17.5px apart: 9.3 /
      // 26.8 / 44.3 from the plate's top), as the Home app spaces them
      // (2026-10-13, the user's side-by-side). It was row-gap 0 with 2px of
      // lead on the label only: 0 between room and name, 2 between name and
      // state. The block's height (51.5px) and so its centring are unchanged.
      // THREE LINES (`three-line`: the favourite and climate layouts, whatever
      // card draws them) -- the Home app's favorite is taller than its pill
      // (76.6 against 70, iPad points), and sits on a taller row (hk-strategy.js
      // pillGrid: TILE.favRow).
      'hk-plate.card.three-line{height:' + TILE.fav + 'px}',
      '.card.three-line{padding:' + TILE.favPadY + 'px 12.8px ' + TILE.favPadY + 'px ' + TILE.padL + 'px}',
      '.card.three-line .grid{grid-template-rows:' + TILE.lineH + 'px ' + TILE.lineH + 'px ' + TILE.lineH + 'px;row-gap:' + TILE.favRowGap + 'px}',
      '.card.three-line .label{align-self:center}',
      // The room line: 15px/400, the same as the label, NOT a smaller caption
      // -- 12px/600 here shifts the rows by 3.5px.
      '.room{grid-area:room;justify-self:stretch;text-align:left;align-self:center;',
      '  font-size:15px;font-weight:400;line-height:' + TILE.lineH + 'px;letter-spacing:-0.23px;',
      '  color:' + window.hkCards.v('ink-2') + ';min-width:0;width:100%;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      'hk-plate.card[data-on="1"] .room{color:' + window.hkCards.v('ink-on-room') + '}',

      // ---- tall variant ----------------------------------------------------
      // 17 differences from the pill, and the type is the one that surprises: a tall tile sets
      // 14px / -0.15px tracking rather than the 15px / -0.23px every other tile
      // uses. The icon row is a fixed 44px with the glyph starting rather than
      // centring, and the whole grid stretches instead of centring.
      // LEFT PADDING IS THE PILL'S 10.3px, NOT 12.8. A tall tile sits in the
      // same grid column as the pills above and below it, and the eye reads
      // straight down that column -- so its well has to start at the same inset.
      // At a symmetric 12.8 it sits 2.5px right of every pill (measured: well
      // inset 13.8px against the pills' 11.3px), which the eye catches at once
      // in a column of pills and tall tiles.
      // Top/bottom/right keep the tall tile's own 12.8.
      'hk-plate.card.tall{height:' + TILE.tall + 'px;padding:12.8px 12.8px 12.8px ' + TILE.padL + 'px;',
      '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-tall') + ')}',
      // align-self:stretch is load-bearing. hk-plate is flex with
      // align-items:center, so without it the grid is CENTRED inside the tall
      // card rather than filling it -- every row lands ~25px low, which no
      // colour or size check would notice.
      '.card.tall .grid{align-self:stretch;grid-template-columns:minmax(0,1fr);',
      '  grid-template-rows:44px 1fr ' + TILE.lineH + 'px ' + TILE.lineH + 'px;',
      '  row-gap:' + TILE.tallRowGap + 'px;column-gap:0px;align-content:stretch}',
      '.card.tall .well{align-self:start;justify-self:start}',
      '.card.tall .name{font-size:' + TILE.tallText + 'px;letter-spacing:-0.15px}',
      '.card.tall .label{font-size:' + TILE.tallText + 'px;letter-spacing:-0.15px;min-width:0;width:100%}',

      // ---- climate variant -------------------------------------------------
      // The temperature IS the icon. `temp` takes the glyph's grid area and the
      // well is removed from layout entirely -- not just hidden, or it would
      // still claim a track and push the text column right.
      //
      // 42px, NOT min-content. The Home app aligns its text column across every
      // tile kind: a welled lock's text and a thermostat's text both begin at
      // the same x. min-content sizes the column to the numeral, so "76" would
      // pull the text ~4px left of every neighbour.
      '.card.climate .well,.card.climate_tall .well{display:none}',
      '.card.climate .grid{grid-template-columns:42px minmax(0,1fr);column-gap:' + TILE.wellGap + 'px}',
      '.card.climate .temp{grid-area:temp;justify-self:center;align-self:center;',
      '  font-size:22px;letter-spacing:-0.26px;font-weight:700;line-height:1}',
      // 35.3px on the tall tile -- the hero scale, the same one the reading
      // tile (hk-rank-card) deliberately does NOT use for its seven-glyph wattages.
      '.card.climate_tall .temp{grid-area:temp;justify-self:start;align-self:start;',
      '  font-size:35.3px;letter-spacing:0.38px;font-weight:700;line-height:1}',

      '@keyframes hk-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      'hk-plate.card[data-on="1"] .icon.spin{animation:hk-spin 1.35s linear infinite}',
      // ANIMATIONS OFF (Sky / Background, hk-base.js hk-still, 2026-10-10): the
      // glyph stands upright. Running alone it kept the page drawing every
      // frame once the sky stood still (a Mac: 19% of a core with the sky
      // paused, 8% with the fans too).
      ':host([hk-still]) hk-plate.card .icon.spin{animation:none}',

      '@media (prefers-reduced-motion:reduce){',
      '  hk-plate.card,hk-plate.card:active,.well,.icon{transition:none;transform:none;animation:none}}',
      // ================================================ PHONE: FILL THE TRACK
      // Below 640px the room grids switch to `repeat(auto-fill, minmax(168px,
      // 1fr))` (see frontend/css/hk-responsive.css), so the track is no longer
      // the pill's width (196, the table's) and a pill pinned to it would overflow.
      // Here the pill fills whatever track it is given instead.
      //
      // WHY `calc(100% + 8px)` AND NOT `100%`: layout-card gives every grid child
      // 4px side margins, so the cell is always 8px narrower than the track
      // (layout-card's card_margin cannot change it). At 1280 the pill is 196px in a 188px
      // cell -- it already overflows by exactly 8px, and that is what makes the
      // visible gap come out at the grid's own (TILE.gridGap, 10). Plain `100%`
      // would shrink every pill to the cell and change the gap.
      //
      // `--hk-cell-bleed` exists because that 8px is NOT universal: inside
      // hk-row-card the child is sized directly with no layout-card margin, so
      // that card sets the bleed to 0 for its own children. Default 8px = the
      // grid case.
      //
      // No max-width: capping at the pill's width makes the track wider than the
      // pill on a large phone and the gap jumps (12px -> 25px, measured at 192).
      // Verified 375/402/440/1280.
      '@media (max-width:' + window.hkCards.BP.phone + 'px){',
      // NO `:host{width:100%}` HERE. These hosts are already `display:block`, so
      // an auto width fills the grid area MINUS the 4px side margins layout-card
      // gives every child -- which is exactly the cell (8 px under the track)
      // the pill is built to overflow by 8. Forcing width:100% resolves against
      // the full grid AREA instead and every tile comes out 8px too wide (190.95
      // measured against a 182.95 track), eating the gap (then 12px) to 4px.
      '  :host{max-width:none !important}',
      '  hk-plate.card{width:calc(100% + var(--hk-cell-bleed, 8px));min-width:0;max-width:none}',
      '}',
      // ================================================= ON A HOME GRID (G2)
      // A block is the tile (docs/phase11/HOME-GRID.md): S (1 x 1) and W
      // (2 x 1) draw the tall tile's layout -- the glyph at the top, the name
      // and state at the foot, as the Home app's large tiles have it -- and fill
      // the block. A thermostat's temperature takes the glyph's place
      // (climate_tall). A scene keeps its bare glyph and two-line name.
      ':host([data-group-fill])>div{height:100%}:host([data-group-fill]) hk-plate.card{height:100%;width:100%;min-width:0;max-width:none}',
      // (clear of a Square screen's outer corner: hk-layout.js cellInset, --hk-in-*)
      ':host([size]) hk-plate.card{width:100%;min-width:0;max-width:none;height:100%;padding:calc(12.8px + var(--hk-in-t,0px)) calc(12.8px + var(--hk-in-r,0px)) ' +
        'calc(12.8px + var(--hk-in-b,0px)) calc(' + TILE.padL + 'px + var(--hk-in-l,0px))}',
      ':host([size]) .card.tall .grid{grid-template-rows:44px minmax(0,1fr) auto auto}',
      ':host([size]) .card.scene.tall .grid{row-gap:0}',
      ':host([size]) .card.scene.tall .name{align-self:end;line-height:19px;font-size:17px}',
      // ...its corners on square cells (hk-home-grid-view's --hk-block-radius); a group's pills keep theirs
      ':host([size]:not([data-group-fill])) hk-plate.card{border-radius:var(--hk-block-radius, ' + window.hkCards.M.radius + ')}',
      // ...and a group's pills concentric with their block (2026-10-30): its radius less its inset (hk-layout.js
      // --hk-inner-radius), not the block's own -- 23.5 inside 34 swelled at the corners
      ':host([data-group-fill]) hk-plate.card{border-radius:var(--hk-inner-radius, ' + window.hkCards.M.radius + ')}',
      // Two room rows on a short tablet still use the tall tile hierarchy,
      // retaining the standard 42 px well and each accessory’s configured glyph.
      '@container hk-cell (max-height:120px){',
      '  :host([data-group-fill]) hk-plate.card.tall{padding:8px 12px}',
      '  :host([data-group-fill]) .card.tall .grid{grid-template-rows:44px minmax(0,1fr) auto auto;row-gap:2px}',
      '}',
      // ===================================================== CENTRED (2026-10-30)
      // The Tile Style that centres the glyph over the name and the room, as
      // HomeView does (docs/phase11/HOMEVIEW-LOOK.md Phase B; hk-base.js
      // TILE.centred): a Home Grid block's tile (`tile` set by its block) and a
      // room page's Tall pill (the screen's Tile Style, _render). The same tile
      // -- its taps, holds, states and press -- laid out again: the grid's
      // areas give way to places measured off HomeView. The second line is
      // the room when the tile is given one (`roomed`), else its state.
      ':host([tile=centred]) .grid{display:block;height:100%}',
      // ICONS (2026-11-07; the screen's, hkSettings.tileIcons): White as Bright Glass's, whatever the look; Color its own
      // even on Bright Glass (iconColour's --hk-look-glyph-off made unset)
      ':host([tile=centred][icons=white]){--hk-look-glyph-off:rgba(255,255,255,0.94)}',
      ':host([tile=centred][icons=color]){--hk-look-glyph-off:initial}',
      ':host([tile=centred]) .card.roomed .label{display:none !important}',
      // a thermostat's reading stands where the glyph would
      ':host([tile=centred]) .card .temp{position:absolute;left:50%;top:32%;translate:-50% -50%;font-size:44px;letter-spacing:-0.5px}',
      ':host([tile=centred]) .card.reading .well{visibility:hidden}:host([tile=centred]) .card.reading .temp{font-weight:600;line-height:1;color:' + window.hkCards.v('ink') + '}',
      window.hkCards.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.card', lit: 'hk-plate.card[data-on="1"]',
                                   well: '.well', icon: '.icon', name: '.name', sub: ['.label', '.room'] }),
      // (...a thermostat has no glyph: its reading is the glyph, as in its tall tile)
      ':host([tile=centred]) .card.climate_tall .well,:host([tile=centred]) .card.climate .well{display:none}',
      // ...and in a short place (under 124 px: a Large Room block's tiles under
      // its name) smaller, so the glyph and the two lines still stand apart (the
      // widget mock-up's Room, 2026-10-31) -- the glyph as large as the height
      // leaves, 46 % of it, 40 to 56 px, the name under it (2026-11-01, the
      // owner: a Room block's icons were "tiny" beside the Accessories block's,
      // one fixed 40 px on its 107 px tiles)
      '@container hk-cell (max-height:124px){' +
        ':host([tile=centred]){--hk-cg:clamp(40px,46cqh,56px)}' +
        ':host([tile=centred]) .well{width:calc(var(--hk-cg) + 6px) !important;height:calc(var(--hk-cg) + 6px) !important;top:30% !important}' +
        ':host([tile=centred]) .icon{width:var(--hk-cg) !important;height:var(--hk-cg) !important}' +
        ':host([tile=centred]) .name{top:calc(30% + var(--hk-cg) / 2 + 5px) !important;font-size:15px !important;line-height:19px !important}' +
        ':host([tile=centred]) .label,:host([tile=centred]) .room{top:calc(30% + var(--hk-cg) / 2 + 24px) !important;font-size:13px !important;line-height:17px !important}}',
      // THE WIDE TILE (see wideTile): Scene and Accessory at Wide, Centered. Home style is the pill (_layout).
      wideTile({ host: ':host([tile=centred][size=W])', well: '.well', icon: '.icon', name: '.name', sub: ['.label', '.room'], temp: '.card .temp' }),
      tinyTile({ host: ':host([tile=centred][size=XS])', plate: 'hk-plate.card', grid: '.grid', well: '.well', icon: '.icon', name: '.name', sub: ['.label', '.room'], temp: '.card .temp' }),
      // IN ITS OWN COLOR (2026-10-31, the owner's notes on the widget mock-up:
      // "Color: the same tile on a gradient of its own color"): a tile whose
      // block has Color on (`block_color` in its config). A scene stands on its
      // gradient always; an accessory while it is lit, in place of the white
      // plate -- off, it keeps the glass. The gradient is the app icons'
      // (hkCards.iconGradient); the glyph and the words white. A tapped scene
      // still flashes white (hk-tapped), as on the glass.
      'hk-plate.card[data-hk-grad]:not(.hk-tapped){background:linear-gradient(180deg,var(--hk-grad-a),var(--hk-grad-b)) !important;' +
        '--hk-glass-backdrop:none;-webkit-backdrop-filter:none;backdrop-filter:none}',
      // (over the lit plate's own colors, Centred's !important ones too)
      ':host hk-plate.card[data-hk-grad]:not(.hk-tapped) .name,:host([tile]) hk-plate.card[data-on][data-hk-grad]:not(.hk-tapped) .name{color:#fff !important}',
      ':host hk-plate.card[data-hk-grad]:not(.hk-tapped) .label,:host hk-plate.card[data-hk-grad]:not(.hk-tapped) .room,' +
        ':host([tile]) hk-plate.card[data-on][data-hk-grad]:not(.hk-tapped) .label,:host([tile]) hk-plate.card[data-on][data-hk-grad]:not(.hk-tapped) .room{color:rgba(255,255,255,0.85) !important}',
      // ================================================= THE TALL TILE (T, 2026-11-07, the review)
      // HomeView's Tall tile in a block two cells high. A thing with a level (a light, a fan, a shade, a speaker) has its
      // capsule under the glyph and the words (hk-tile.js _levelDraw: `level` on the host), filling the rest of the plate on
      // the block's inset (--hk-pad-*, 14 on tiles, 18 on square cells); a thing with none (a switch, a lock) is the tile
      // with a larger glyph. Centered: the glyph over the name and the second line, all centered; Home: the glyph top left.
      ':host([level][size=T]) hk-plate.card{position:relative;padding:var(--hk-pad-t,14px) var(--hk-pad-r,14px) var(--hk-pad-b,14px) var(--hk-pad-l,14px)}',
      ':host([level]) hk-plate.card:has(.lvl:active){transform:none;filter:none}',
      ':host([level]) .card.tall .grid{grid-template-areas:"i" "n" "l" "c" !important;grid-template-rows:44px auto auto minmax(0,1fr);row-gap:3px}',
      '.lvl{position:relative;grid-area:c;margin-top:10px;min-height:60px;box-sizing:border-box;border-radius:var(--hk-inner-radius,12px);overflow:hidden;',
      '  touch-action:none;cursor:pointer;outline:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;background:' + window.hkCards.v('key-strong') + '}',
      '.lvl:focus-visible{box-shadow:0 0 0 3px rgba(100,181,255,0.8)}',
      '.lvl .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:' + window.hkCards.v('track-fill') + ';transition:height .18s ease}',
      '.lvl.drag .fill{transition:none}',
      '.lvl b{position:absolute;left:0;right:0;bottom:12px;text-align:center;' + window.hkCards.typeCss('headline') + ';line-height:22px;font-variant-numeric:tabular-nums;',
      '  color:' + window.hkCards.v('ink') + ';text-shadow:' + window.hkCards.v('glow') + ';pointer-events:none}',
      // (lit, on the white plate: a dark track, the filled part its own color; on its gradient: a white wash, a white fill)
      'hk-plate.card[data-on="1"] .lvl{background:rgba(0,0,0,0.09)}',
      'hk-plate.card[data-on="1"] .lvl b{color:rgba(0,0,0,0.55);text-shadow:none}',
      'hk-plate.card[data-hk-grad] .lvl{background:rgba(255,255,255,0.24)}',
      'hk-plate.card[data-hk-grad] .lvl b{color:#fff;text-shadow:none}',
      // (the words over the filled part are dark on it, whatever lies under the rest)
      'hk-plate.card .lvl.hi b{color:rgba(0,0,0,0.55);text-shadow:none}',
      // CENTERED, the glyph and its words from the block's top inset, the capsule from under them (levelTile: the cell's numbers,
      // hk-base.js TILE.centred)
      levelTile(window.hkCards.TILE.centred.tall, 14, ''),
      levelTile(window.hkCards.TILE.centred.square, 18, '@container hk-cell style(--hk-cell-shape: square)'),
      // WIDE (2026-11-09, the owner: "the wide accessory card with slider doesn't match ... the tall"): the Tall turned sideways -- the
      // glyph and the words in a column on the left, the same capsule (the .lvl above: its radius, track, fill, percent) filling the rest
      // of the plate on the block's inset, its fill growing left to right (.side), the percent inside it at its start
      ':host([level][size=W]){--hk-wcol:46%}',
      ':host([level][size=W]) hk-plate.card{position:relative;padding:var(--hk-pad-t,14px) var(--hk-pad-r,14px) var(--hk-pad-b,14px) var(--hk-pad-l,14px)}',
      '.lvl.side{position:absolute;margin:0;min-height:0;grid-area:auto;left:var(--hk-wcol);right:var(--hk-pad-r,14px);top:var(--hk-pad-t,14px);bottom:var(--hk-pad-b,14px);touch-action:pan-y}',
      '.lvl.side .fill{right:auto;top:0;height:auto;width:0;transition:width .18s ease}',
      '.lvl.side.drag .fill{transition:none}',
      '.lvl.side b{left:12px;right:auto;bottom:auto;top:50%;transform:translateY(-50%);text-align:left}',
      // (Home, the pill: its glyph and words stay left of the capsule)
      ':host(:not([tile=centred])[level][size=W]) .card .grid{box-sizing:border-box;width:calc(var(--hk-wcol) - var(--hk-pad-l,14px) - 10px);min-width:0;flex:none}',
      ':host(:not([tile=centred])[level][size=W]) .card .grid .name,:host(:not([tile=centred])[level][size=W]) .card .grid .label{min-width:0;overflow:hidden;text-overflow:ellipsis;' +
        'white-space:nowrap}',
      wideLevelTile(window.hkCards.TILE.centred.tall, 14, ''),
      wideLevelTile(window.hkCards.TILE.centred.square, 18, '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square)'),
      // ...no level: the tile with its glyph larger, the group a little above the middle
      ':host([tile=centred][size=T]:not([level])) .well{width:104px !important;height:104px !important;top:37% !important}',
      ':host([tile=centred][size=T]:not([level])) .icon{width:96px !important;height:96px !important}',
      ':host([tile=centred][size=T]:not([level])) .name{top:62% !important}',
      ':host([tile=centred][size=T]:not([level])) .label,:host([tile=centred][size=T]:not([level])) .room{top:calc(62% + 27px) !important}',
      // ...Home: the glyph's well larger
      ':host(:not([tile=centred])[size=T]:not([level])) .well{width:60px;height:60px}',
      ':host(:not([tile=centred])[size=T]:not([level])) .icon{width:34px;height:34px}',
      ':host(:not([tile=centred])[size=T]:not([level])) .card.tall .grid{grid-template-rows:60px minmax(0,1fr) auto auto}'
    ].join('');

    // what the shell and the later parts use of this one
    K.CSS = CSS;
  };
})();
