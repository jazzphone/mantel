// hk-tile.js -- the tile family as native Lovelace cards.
//
// A Lovelace resource; needs hk-base.js (window.hkCards) and waits for its
// ready event.
//
// TILES ONLY. The other cards live in hk-media.js, hk-home.js, hk-energy.js
// and hk-layout.js.
//
// WHAT A TILE IS, AND WHY THESE ARE SUBCLASSES
// Measured, not assumed: the pill, the scene, the action tile, the favorite
// and the tall tile all render a box the pill's width (hk-base.js TILE.w)
// with a 23.5px radius and a 42px icon slot. THAT is what makes them one
// family; grouping them by what they DO (a scene triggers a scene) rather
// than by the measured box gives the wrong card set.
//
// The grid differs per variant and `layout` selects it:
//
//   "i n"                  ->  layout: action     (no label)
//   "i n" "i l"            ->  layout: standard   (label)
//   "i room" "i n" "i l"   ->  layout: favourite  (room line above)
//   "i" "." "n" "l"        ->  layout: tall       (vertical)
//
// BUT THE LAYOUT STRING IS NOT THE WHOLE DIFFERENCE. Diffing every resolved
// style property of a pill and a scene gives 33 differences: the well
// is not painted at all on a scene, the glyph is larger, the name is
// weight 700 with a 2-line clamp rather than 600 with an ellipsis, and there
// is no outer box-shadow. So each variant is a SUBCLASS carrying its own
// deltas, not an options bag on one card.
//
// The lesson: the measured box is the right way to GROUP tiles and the
// wrong way to conclude they are interchangeable. Diff every resolved property
// before adding a variant.
//
// FIDELITY
// Every number here is a load-bearing measurement of the Home app -- the
// 42px well is 0.602 of tile height (median of 21 Home app pills), the 2.2px
// row-gap was derived on a canvas with real font metrics, the 10px column-gap
// is 0.267 of the well against the Home app's measured 0.262. Do not "tidy"
// any of them.
//
// The material (background, border, the lit top rim) comes from the THEME as
// --hk-glass-* so every glass surface agrees; the
// literals in the var() fallbacks are only for a card on some other theme.
(function () {
  'use strict';

  if (window.hkTile) return;                 // double-load guard
  window.hkTile = { version: '1.0.0' };

  // hk-base.js is a LOVELACE RESOURCE, not a hk-loader module, and resources
  // are fetched in parallel -- so window.hkCards.HkBase may not exist yet when
  // this file runs. Bailing here would define no cards at all, roughly half
  // the time, with the only symptom being an empty card. So wait for it.
  //
  // WAIT FOR THE BASE CLASS BY EVENT, NOT BY POLLING.
  //
  // hk-base.js is a Lovelace RESOURCE like this file, and resources are
  // fetched in parallel, so window.hkCards.HkBase may not exist yet. Polling
  // with requestAnimationFrame is wrong in a way that only shows up in a
  // hidden tab: rAF NEVER FIRES there, and setTimeout is throttled to >=1s,
  // so the retry never runs and NO CARD IS EVER DEFINED -- window.hkTile
  // exists with only `version` on it, which reads like a completely
  // different bug. A background tab, or a tablet behind a screensaver, hits
  // exactly that.
  //
  // (A poll has a second trap worth remembering: writing
  // `(window.requestAnimationFrame || setTimeout)(fn)` detaches the function
  // from its receiver and Chrome throws "Illegal invocation".)
  //
  // An event fires regardless of visibility. The immediate check first, in
  // case hk-base.js already finished; `once` so a re-dispatch cannot define
  // the elements twice.
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards.HkBase);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards.HkBase);
      else console.error('[hk-tile] hk-cards-ready fired without HkBase');
    }, { once: true });
  }

  whenBase(function (HkBase) {

  // THE COLOUR MAP: hk-base.js's icon palette (hkCards.PALETTE.icon). It
  // feeds several properties (the well's background, the glyph's colour) --
  // which is why it lives in one place.
  var NAME_MAP = window.hkCards.PALETTE.icon;

  var DOMAIN_MAP = {
    light: NAME_MAP.yellow,
    switch: NAME_MAP.orange,
    fan: NAME_MAP.blue,
    cover: NAME_MAP.blue,
    lock: NAME_MAP.green,
    climate: NAME_MAP.red,
    input_button: NAME_MAP.purple,
    media_player: NAME_MAP.red,
    sensor: NAME_MAP.blue,
    weather: NAME_MAP.yellow,
    script: NAME_MAP.purple
  };

  // The states that light a tile: 'on', and every state that means open,
  // unlocked, armed or busy.
  var ON_STATES = [
    'on',
    'open', 'opening', 'closing',
    'unlocked',
    'armed_home', 'armed_away', 'armed_night', 'armed_vacation',
    'cleaning', 'returning', 'paused'
  ];

  var LAYOUTS = {
    action:    '"i n"',
    standard:  '"i n" "i l"',
    favourite: '"i room" "i n" "i l"',
    tall:      '"i" "." "n" "l"',
    // THE THERMOSTATS PUT THE TEMPERATURE WHERE THE GLYPH GOES. Same two
    // shapes as above with `i` swapped for `temp`; the well is display:none
    // under .climate so it takes no track.
    climate:      '"temp room" "temp n" "temp l"',
    climate_tall: '"temp" "." "n" "l"',
    // a thermostat as a regular pill (size: regular): the favourite's shape
    // without its room line
    climate_pill: '"temp n" "temp l"'
  };
  // THE TILE'S HEIGHT, A CHOICE (`size`, 2026-10-01): any tile can be tall
  // or regular, whatever its card draws by default -- a light as a tall tile,
  // a lock as a pill. The layout swaps for its other-height twin; the grid
  // cell it sits in is the dashboard's to size (`view_layout: {grid-row:
  // span 2}`, which the generated dashboard sets from the accessory's Size).
  var TALL_OF = { standard: 'tall', action: 'tall', climate: 'climate_tall', climate_pill: 'climate_tall' };
  var SHORT_OF = { tall: 'standard', climate_tall: 'climate_pill' };
  function sizedLayout(layout, size) {
    if (size === 'tall') return TALL_OF[layout] || layout;
    if (size === 'regular') return SHORT_OF[layout] || layout;
    return layout;
  }

  // THE ONE COLOUR MAP: a named colour maps, an arbitrary CSS colour passes
  // through, otherwise the domain decides. The same expression feeds the
  // well and the glyph, which is why it is one function here.
  function colourFor(cfg, stateObj) {
    var override = cfg.icon_color ? String(cfg.icon_color).toLowerCase().trim() : '';
    if (override) return NAME_MAP[override] || cfg.icon_color;
    var d = stateObj && stateObj.entity_id ? stateObj.entity_id.split('.')[0] : '';
    return DOMAIN_MAP[d] || NAME_MAP.gray;
  }

  // BARE_ICON IS AN ON-STATE RULE ONLY, and getting this wrong is invisible
  // until something is playing. Transparency belongs to the ON state's well
  // colour alone -- OFF stays rgba(0,0,0,0.14). A card that wants a
  // well-less glyph while OFF says so itself with `well_background:
  // transparent`.
  // (the look's well first -- Tinted's Dark or Light, hk-settings.js --
  // then the page's: a light page's gray, the theme's; the literal last)
  var OFF_WELL = 'var(--hk-look-well, ' + window.hkCards.v('well-bg') + ')';
  function wellColour(cfg, stateObj, on) {
    if (!on) return OFF_WELL;
    if (cfg.bare_icon) return 'transparent';
    return window.hkCards.flatColor(colourFor(cfg, stateObj), 'well');
  }

  // OFF uses the same map as the well. ON is white unless the glyph is bare,
  // in which case bare_icon_color wins -- that is the only place it applies.
  // `off_icon_color`: the glyph's own color while off, where the lit color
  // would alarm (a quiet leak sensor's drop is calm blue; its leak is red)
  function iconColour(cfg, stateObj, on) {
    if (!on && cfg.off_icon_color) {
      var o = String(cfg.off_icon_color).toLowerCase().trim();
      return window.hkCards.flatColor(NAME_MAP[o] || cfg.off_icon_color, 'glyph');
    }
    // (Bright Glass, 2026-10-30: white, the background supplies the color --
    // --hk-look-glyph-off, unset in every other look)
    if (!on) return 'var(--hk-look-glyph-off, ' + window.hkCards.flatColor(colourFor(cfg, stateObj), 'glyph') + ')';
    if (!cfg.bare_icon) return 'white';
    // (lit and bare: Flat's Light takes the bright color, hk-base flatColor)
    return window.hkCards.flatColor(cfg.bare_icon_color || colourFor(cfg, stateObj), 'on');
  }

  // TWO LEVELS, not one:
  //
  //   hk-plate#card  material box -- flex, overflow:hidden, text-align:center
  //     div.grid     the grid -- areas, gaps, align-content:center
  //       .well / .name / .label
  //
  // The material box centres and the grid lays out: one element cannot be
  // both a flex box and a grid box.
  //
  // <hk-plate> rather than a div: it carries the card plate's styling (HA's
  // ha-card rules under HK's name, elements/hk-elements.js) and the
  // --ha-card-* variables, as every HK card's plate does.
  var TILE = window.hkCards.TILE;
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
    ':host([size]) hk-plate.card{width:100%;min-width:0;max-width:none;height:100%;padding:12.8px 12.8px 12.8px ' + TILE.padL + 'px}',
    ':host([size]) .card.tall .grid{grid-template-rows:44px minmax(0,1fr) auto auto}',
    ':host([size]) .card.scene.tall .grid{row-gap:0}',
    ':host([size]) .card.scene.tall .name{align-self:end;line-height:19px;font-size:17px}',
    // ...its corners on square cells (hk-home-grid-view's --hk-block-radius); a group's pills keep theirs
    ':host([size]:not([data-group-fill])) hk-plate.card{border-radius:var(--hk-block-radius, ' + window.hkCards.M.radius + ')}',
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
    ':host([tile=centred]) .card.roomed .label{display:none !important}',
    // a thermostat's reading stands where the glyph would
    ':host([tile=centred]) .card .temp{position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font-size:44px;letter-spacing:-0.5px}',
    window.hkCards.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.card', lit: 'hk-plate.card[data-on="1"]',
                                 well: '.well', icon: '.icon', name: '.name', sub: ['.label', '.room'] }),
    // (...a thermostat has no glyph: its reading is the glyph, as in its tall tile)
    ':host([tile=centred]) .card.climate_tall .well{display:none}',
  ].join('');

  // `on:` UNQUOTED IN YAML IS THE BOOLEAN true, so an icon_states map keyed on
  // entity states silently becomes {true: ...} and the lookup against the
  // string 'on' never matches -- so a humidifier or dehumidifier shows its
  // idle glyph while running. The generator quotes these keys;
  // this is the safety net for a map written by hand, where the mistake is
  // invisible in the YAML and invisible in the rendering (it just never
  // changes). Same trap as `name: Off` becoming false.
  function normaliseIconStates(config) {
    var m = config && config.icon_states;
    if (!m || typeof m !== 'object') return config;
    var fixed = null;
    Object.keys(m).forEach(function (k) {
      if (k === 'true' || k === 'false') {
        fixed = fixed || Object.assign({}, m);
        delete fixed[k];
        fixed[k === 'true' ? 'on' : 'off'] = m[k];
      }
    });
    if (!fixed) return config;
    var out = Object.assign({}, config);
    out.icon_states = fixed;
    return out;
  }

  // ------------------------------------------------------------- base tile
  var PRESS_MS = 1500;                 // a momentary tile's light after a tap

  class HkTileBase extends HkBase {
    // A MOMENTARY ACCESSORY LIGHTS WHEN TAPPED (2026-09-30). A button -- a
    // computer's Wake on LAN, an input_button -- has no on or off: its state
    // is the time it was last pressed, so its tile never lit and a tap looked
    // like it did nothing. A tap that fires its action now lights the tile
    // for PRESS_MS, as HomeKit does for a momentary accessory, and goes dark
    // at once if Home Assistant refused the call.
    _momentary() {
      var d = String((this._config || {}).entity || '').split('.')[0];
      return d === 'button' || d === 'input_button';
    }
    _pressed() { return !!this._pressUntil && Date.now() < this._pressUntil; }
    // (Not an override of _call: a card never shadows an HkBase helper --
    // tests/test_dispatch.js.) A confirmation is asked first by HkBase, which
    // then comes back here with the answer.
    _act(spec, defaultMoreInfo) {
      var a = spec && spec.action;
      var svc = spec ? String(spec.service || spec.perform_action || '') : '';
      var parts = svc.split('.');
      if ((a === 'call-service' || a === 'perform-action') && this._momentary() && parts.length === 2 &&
          svc.indexOf('[[[') === -1 && !(spec.confirmation && !spec._hkConfirmed)) {
        var self = this;
        this._press();
        this._call(parts[0], parts[1], Object.assign({}, spec.data || {}, spec.target || {}))
          .then(function (ok) { if (!ok) self._unpress(); });
        return;
      }
      return super._act(spec, defaultMoreInfo);
    }
    _press() {
      var self = this;
      this._pressUntil = Date.now() + PRESS_MS;
      clearTimeout(this._pressT);
      this._pressT = setTimeout(function () { self._unpress(); }, PRESS_MS + 20);
      this.redraw();
    }
    _unpress() {
      clearTimeout(this._pressT);
      this._pressT = null; this._pressUntil = 0;
      this.redraw();
    }
    static get CSS() { return CSS; }

    setConfig(config) {
      if (!config || (!config.entity && !this._entityOptional(config))) {
        throw new Error('hk-tile: `entity` is required');
      }
      super.setConfig(normaliseIconStates(config));
    }
    // A tile that shows a state needs the entity it shows. One that is only
    // an action (a scene pill that navigates, like Live TV) does not.
    _entityOptional() { return false; }

    getCardSize() { return this._layout() === 'tall' || this._layout() === 'climate_tall' ? 2 : 1; }
    _layout() {
      var cfg = this._config || {};
      // on a Home Grid the block decides: its tall layout, whatever the size
      return sizedLayout(LAYOUTS[cfg.layout] ? cfg.layout : 'standard', this._cellSize() ? 'tall' : cfg.size);
    }

    // Subclasses answer these four; everything else is shared.

    // "ON" IS NOT JUST 'on'. ON_STATES lists ten more states that light the
    // tile up; missing them renders every open blind, unlocked door and armed
    // alarm in the OFF material.
    _isOn(st) {
      // `group_lit: any` -- a tile standing for SEVERAL entities that has no
      // group entity of its own to ask. "Vanity + Shower Lights" is two plain
      // lights, so the plate lights when either does; without this the tile
      // reads OFF while half the room is lit.
      //
      // The DEFAULT is still the card's own entity: a tile whose entity is a
      // light group (light.bathroom_lights) must follow the group, not its
      // members.
      if (this._config && this._config.group_lit === 'any') {
        return this._groupOn().length > 0;
      }
      if (!st) return false;
      return ON_STATES.indexOf(st.state) !== -1;
    }

    // The members of `group:` that are currently on, as state objects.
    // `group` is a plain list of entity ids; HkBase._sigOf reads it too, so a
    // member changing wakes the tile.
    _groupOn() {
      var ids = (this._config && this._config.group) || [];
      var out = [];
      for (var i = 0; i < ids.length; i++) {
        var g = this._st(ids[i]);
        if (g && g.state === 'on') out.push(g);
      }
      return out;
    }
    _label(st) { return st ? st.state : ''; }
    // A stateful glyph -- a blind that closes, a lock that opens, a humidifier
    // that starts -- is a
    // state->icon map: `icon` is the default and icon_states names the
    // exceptions. Declarative, so it survives being authored by hand in YAML.
    _icon(st) {
      var m = this._config.icon_states;
      if (m && st && m[st.state] != null) return m[st.state];
      return this._config.icon;
    }
    // Overridable because a tile may replace the pill's colour rule
    // entirely -- the media tile does.
    _iconColour(cfg, st, on) { return iconColour(cfg, st, on); }
    // A CSS class rather than inline styles, so a variant's deltas live in the
    // shared stylesheet and cost nothing per instance.
    _variant() { return ''; }
    _wellBackground(cfg, st, on) { return cfg.well_background || wellColour(cfg, st, on); }
    // AN OFF PILL'S OWN COLOR, for Flat Colors' Automatic tint: a calm off
    // color where it has one (a leak sensor's drop), else its color -- the
    // same for every kind, media too. Unavailable has none of its own.
    _idleSource(cfg, st) {
      if (st && (st.state === 'unavailable' || st.state === 'unknown')) return null;
      if (cfg.off_icon_color) {
        var o = String(cfg.off_icon_color).toLowerCase().trim();
        return NAME_MAP[o] || cfg.off_icon_color;
      }
      return colourFor(cfg, st);
    }
    // A GLYPH WITH NO CIRCLE, by what the card says rather than how a
    // browser writes it back (Safari's `none` for transparent): a bare icon,
    // a well asked to be clear, or none drawn (null: the stylesheet's)
    _bareWell(cfg, wb) {
      return !!cfg.bare_icon || wb === null || /^\s*(transparent|none)\s*$/i.test(String(wb));
    }
    // A variant with no label row does not RENDER the element at all, rather
    // than leaving a display:none div behind.
    _hasLabel() { return true; }
    _animation() { return this._config.animation || 'none'; }
    // NO CARD IN THIS SET HAS A HOLD. Returning null means
    // the timer is never armed, so a slow press does exactly what a quick one
    // does -- which is what a wall tablet wants: a hold that does something
    // different is undiscoverable, and it fired by accident every time someone
    // rested a finger on a tile. Any `hold_action` left in a config is inert.
    // Override this in a card that genuinely needs one.

    _render() {
      var cfg = this._config || {};
      var st = this._st(cfg.entity);
      var on = !!this._isOn(st) || this._pressed();
      var layout = this._layout();

      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="card" data-hk-role="card">' +
          '  <div class="grid">' +
          '    <div class="well" data-hk-role="well"><hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon></div>' +
          '    <div class="name" data-hk-role="name"></div>' +
          '    <div class="label" data-hk-role="label"></div>' +
          // AFTER the label in DOM order. grid-area puts it on the top row
          // regardless, so this is free -- and the card's text then reads
          // "Front Door / Locked / Living Room", the accessory first.
          '    <div class="room"></div>' +
          '  </div>' +
          '</hk-plate>';
        this._els = {
          card: this._root.querySelector('.card'),
          grid: this._root.querySelector('.grid'),
          well: this._root.querySelector('.well'),
          icon: this._root.querySelector('.icon'),
          room: this._root.querySelector('.room'),
          name: this._root.querySelector('.name'),
          label: this._root.querySelector('.label')
        };
        if (!this._config.room) { this._els.room.remove(); this._els.room = null; }
        if (!this._hasLabel()) {
          this._els.label.remove();
          this._els.label = null;
        }
        // THE HOME APP SPLITS THE TAP TARGET: tapping the GLYPH toggles the
        // accessory and tapping the name opens detail. One target for both
        // makes every light tile more-info only: no style differs, and the
        // lights simply stop turning on when you tap them. Behaviour is not
        // visible to a computed-style check -- it has to be carried
        // deliberately, which is what icon_tap_action does.
        this._bind(this._els.card, 'tap_action');
        // a right-click (a mouse's, never a finger's) opens detail: hk-base
        this._bindDetail(this._els.card);
        if (this._config.icon_tap_action) {
          this._bind(this._els.well, 'icon_tap_action', null);
        }
        this._built = true;
      }

      var e = this._els;
      e.grid.style.gridTemplateAreas = LAYOUTS[layout];
      e.card.setAttribute('data-on', on ? '1' : '0');
      var variant = this._variant();
      // A variant may be two classes ('scene elevated'), so split it. Its
      // height classes follow the LAYOUT, not the variant: a tall tile made
      // regular (size) loses `tall`, a pill made tall gains it, and a
      // thermostat's tall tile made regular wears the pill's `climate`.
      var cls = (variant ? variant.split(' ') : []).filter(function (c) { return c && c !== 'tall' && c !== 'climate_tall'; });
      if (layout === 'climate_tall') cls.push('climate_tall');
      if (layout === 'climate_pill' && cls.indexOf('climate') < 0) cls.push('climate');
      cls.forEach(function (c) { e.card.classList.add(c); });
      e.card.classList.toggle('tall', layout === 'tall' || layout === 'climate_tall');
      // THREE LINES (a room line over the name and state): the favourite and
      // the climate favourite's layouts, whatever card draws them -- the
      // group sheet's favourite-layout pills carry no `favourite` variant.
      // Its height and row are the table's fav / favRow (hk-base.js TILE).
      e.card.classList.toggle('three-line', layout === 'favourite' || layout === 'climate');
      if (layout !== 'climate_tall') e.card.classList.remove('climate_tall');
      if (e.label) e.label.style.display = (layout === 'action') ? 'none' : '';

      // well_background is the per-card escape hatch -- the Home app draws
      // Apple TV and HomePod
      // with no well in EVERY state, and that is how those cards say so.
      // An inline style would beat the variant's stylesheet rule, so a card
      // that paints no well (scene) returns null and CSS decides. This is the
      // whole reason _wellBackground exists rather than a direct assignment.
      var wb = this._wellBackground(cfg, st, on);
      var ic = this._iconColour(cfg, st, on);
      // FLAT COLORS (2026-10-17; hk-base flatPalette / flatIdle): OFF, the
      // pill takes a wash of its source -- its own color, or the one tint
      // chosen -- its circle a deeper one and its glyph that color at 3:1.
      // A glyph with no circle (a scene, Apple TV, HomePod, the alarm)
      // stays bare. Lit pills are white, their wells their own colors.
      var C = window.hkCards, pal = !on && C.flatPalette ? C.flatPalette() : null;
      var idle = pal && pal.tinted ? C.flatIdle(this._idleSource(cfg, st), this._bareWell(cfg, wb), pal) : null;
      if (idle) {
        if (idle.well) wb = idle.well;
        ic = idle.glyph;
        e.card.setAttribute('data-hk-idle', '');
        e.card.style.setProperty('--hk-idle-pill', idle.pill);
        e.card.style.setProperty('--hk-idle-glyph', idle.glyph);
      } else if (e.card.hasAttribute('data-hk-idle')) {
        e.card.removeAttribute('data-hk-idle');
        e.card.style.removeProperty('--hk-idle-pill');
        e.card.style.removeProperty('--hk-idle-glyph');
      }
      if (wb !== null) e.well.style.background = wb;
      e.icon.style.color = ic;
      if (cfg.icon_size) {
        e.icon.style.width = cfg.icon_size;
        e.icon.style.height = cfg.icon_size;
      }

      // `spin` is a config option so a card can ask for it; HkFanCard
      // defaults it on.
      e.icon.classList.toggle('spin', this._animation() === 'spin');

      var cl = this.client; if (cl) cl.bindStateIcon(e.icon, st);
      var ic = this._icon(st);
      if (ic) e.icon.icon = ic;

      if (e.room && e.room.textContent !== cfg.room) e.room.textContent = cfg.room;
      e.card.classList.toggle('roomed', !!e.room);
      // TILE STYLE ON A PAGE (2026-10-30): a Tall pill that is no Home Grid
      // block's (its block sets `tile` on it) takes its own `tile`, else the
      // screen's (hkSettings.tileStyle: its own, else All Screens'). A
      // regular pill stays as it is: wide and short, centred reads badly.
      if (!this.hasAttribute('size') && !this.hasAttribute('data-group-fill')) {
        var HS = window.hkSettings, tall = layout === 'tall' || layout === 'climate_tall';
        var centred = cfg.tile ? cfg.tile === 'centred' : tall && !!HS && typeof HS.tileStyle === 'function' && HS.tileStyle() === 'centred';
        if (centred) this.setAttribute('tile', 'centred'); else this.removeAttribute('tile');
      }
      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (e.name.textContent !== nm) e.name.textContent = nm;
      if (e.label) {
        var lb = this._label(st) || '', secondary = cfg.secondary;
        if (secondary && secondary.mode !== 'auto') {
          var a = st && st.attributes || {}, value;
          if (secondary.mode === 'none') lb = '';
          else if (secondary.mode === 'state') lb = st ? titled(st.state) : 'Unavailable';
          else if (secondary.mode === 'brightness') lb = brightnessLabel(st);
          else if (secondary.mode === 'attribute') {
            value = a[secondary.attribute];
            lb = value == null || typeof value === 'object' ? '—' : String(value) + (secondary.unit ? ' ' + secondary.unit : '');
          }
        }
        if (e.label.textContent !== lb) e.label.textContent = lb;
      }
    }
  }

  // ------------------------------------------------------------- hk-media
  // A TV or speaker tile: what it is playing, or its input.
  class HkMediaCard extends HkTileBase {
    // A real player from this home, so the picker preview is not empty.
    static getStubConfig(input) {
      var client = window.hkCards.asClient(input), ids = client ? Object.keys(client.states) : [];
      for (var i = 0; i < ids.length; i++) {
        if (ids[i].indexOf('media_player.') === 0) return { entity: ids[i] };
      }
      return { entity: 'media_player.example' };
    }

    // ON is `playing`, PLUS the pill's extended ON_STATES -- not `playing ||
    // on` alone. The difference is not theoretical: 'paused' is in that list,
    // so a paused HomePod renders as an ON tile (white plate, black text). A
    // test of idle/on/off/playing/unavailable alone never exercises it --
    // test paused too.
    _isOn(st) {
      if (!st) return false;
      return st.state === 'playing' || ON_STATES.indexOf(st.state) !== -1;
    }

    _label(st) {
      var s = (st && st.state) || 'unavailable';
      var at = (st && st.attributes) || {};
      // `source_first` is the televisions' variant: whatever the box is showing
      // ("HDMI 1") is more useful than its transport state, so a source wins
      // even when the player reports idle or standby.
      if (this._config.label_mode === 'source_first') {
        if (s === 'off') return 'Off';
        if (s === 'unavailable' || s === 'unknown') return 'Unavailable';
        if (at.source) return String(at.source);
        if (s === 'playing') return 'Playing';
        if (s === 'paused') return 'Paused';
        if (s === 'idle' || s === 'standby' || s === 'on') return 'Not Playing';
        return sentence(s);
      }
      // THE HOMEPODS AND THE APPLE TVS read as the Home app's do: Playing,
      // Paused, Not Playing. A source is not what is playing --
      // Music Assistant's HomePods report "Music Assistant Queue" -- and an
      // Apple TV's app ("YouTube") read differently from every HomePod.
      if (s === 'playing') return 'Playing';
      if (s === 'paused') return 'Paused';
      if (s === 'idle' || s === 'standby' || s === 'on') return 'Not Playing';
      if (s === 'off') return 'Off';
      if (s === 'unavailable' || s === 'unknown') return 'Unavailable';
      return sentence(s);
    }

    // icon_color is cyan by default; a card config may override it.
    setConfig(config) {
      var c = Object.assign({ icon_color: 'cyan' }, config);
      super.setConfig(c);
    }

    // A media tile REPLACES the pill's icon colour rather than inheriting it:
    // the glyph is a flat white unless it is bare, in which case icon_color
    // paints the glyph itself because there is no well to carry the colour.
    // The inherited colour map would tint every media glyph cyan.
    _iconColour(cfg, st, on) {
      if (!on) {
        // (through flatColor: Flat's Light darkens the white glyph made for
        // the dark glass, or it vanished on the ivory tile -- Apple TV, HomePod)
        return (cfg.bare_icon && cfg.icon_color) ? window.hkCards.flatColor(cfg.icon_color, 'glyph') : '' + window.hkCards.v('glyph') + '';
      }
      return super._iconColour(cfg, st, on);
    }
  }

  if (!customElements.get('hk-media-card')) {
    // its size in HA's Sections view (hk-base.js GRID)
    if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-media-card', HkMediaCard);
    customElements.define('hk-media-card', HkMediaCard);
    if (window.hkCards && window.hkCards.editor) {
      var K = window.hkCards;
      var mediaEditor = K.editor('hk-media-card', [
        { name: 'entity', required: true, selector: { entity: { filter: { domain: 'media_player' } } } },
        { type: 'grid', name: '', schema: [
          { name: 'name', selector: { text: {} } },
          // source_first is the televisions' status: what the box is SHOWING
          // beats what its transport reports.
          { name: 'label_mode', selector: K.selOptions(['source_first']) }
        ] },
        K.section('Appearance', [
          { type: 'grid', name: '', schema: [
            { name: 'icon', selector: { icon: {} } },
            { name: 'icon_color', selector: K.selColour() },
            { name: 'icon_size', selector: { text: {} } },
            { name: 'bare_icon', selector: { boolean: {} } },
            { name: 'bare_icon_color', selector: K.selColour() },
            { name: 'well_background', selector: { text: {} } }
          ] }
        ], 'mdi:palette'),
        K.section('Interactions', [
          { name: 'tap_action', selector: { ui_action: {} } },
          { name: 'icon_tap_action', selector: { ui_action: {} } }
        ], 'mdi:gesture-tap')
      ]);
      HkMediaCard.getConfigElement = function () { return document.createElement(mediaEditor); };
    }
  }

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'hk-media-card',
    name: 'HK Media Tile',
    description: 'A TV or speaker tile that shows what it is playing or its input.',
    preview: true
  });

  // ---------------------------------------------------------------- cards
  // One class per kind of tile. They are SUBCLASSES, not options on one
  // card, because the per-kind deltas are real: see the scene note above.
  // A subclass is ~15 lines and its
  // differences are legible; an options bag covering all of them would not be.

  // ------------------------------------------------------------- editors
  // One schema shared by the whole tile family, plus the per-card
  // deltas. Kept deliberately short: these configs are often written by
  // hand, and a card needing a scrollbar of options is a card with
  // too many options.
  var C = window.hkCards;
  // The dropdown in every tile editor. `brightness` and `humidity` read
  // ATTRIBUTES rather than mapping the state, which is why they are handled
  // before the state->text table -- but they are still label modes and belong
  // in the list. `source_first` is media-only and lives in that card's schema.
  var LABEL_MODE_VALUES = ['on_off', 'state', 'sentence', 'title',
                           'on_off_sentence', 'open_closed', 'leak', 'alarm',
                           'brightness', 'humidity', 'vacuum', 'position',
                           'duration', 'group_brightness', 'group_count',
                           'setpoint', 'setpoint_verb'];

  // THE TILE EDITOR, grouped the way HA's own tile editor is: what the tile
  // IS up top, then Appearance, Group and Interactions as collapsible
  // sections. Everything stays flat in the YAML.
  //
  // labelModes: omit for the full list; [] when the card computes its own
  // status text (light, fan, cover) -- the field is then LEFT OUT, not shown
  // as a Status text dropdown with no options in it (and `[] || x` would
  // keep the empty array: an array is truthy).
  // appearanceExtra: fields that belong with the icon (circle colour, well,
  // animation); extraTop: fields that belong beside the name (room line).
  // opts (the per-card deltas the shared schema cannot guess):
  //   domains   the entity picker's filter -- a light tile offers lights.
  //             Omitted: any entity (the plain, tall and favorite tiles).
  //   climate   a thermostat tile: no icon circle (CSS hides .well) and lit
  //             by its own _isOn, so the icon, Group and icon-tap fields
  //             would edit nothing. The code still reads them; only the
  //             editor leaves them out.
  //   map       offer label_map / label_default -- only where the status
  //             text goes through HkTileCard's state->text table (a light,
  //             fan or cover tile computes its own and never reads them).
  //   spin      offer `animation` -- a switch drawn as a fan spins too.
  function tileSchema(extraTop, labelModes, appearanceExtra, opts) {
    opts = opts || {};
    var pick = opts.domains
      ? { filter: opts.domains.map(function (d) { return { domain: d }; }) } : {};
    var top = [
      { name: 'entity', required: true, selector: { entity: pick } },
      { type: 'grid', name: '', schema: [
        { name: 'name', selector: { text: {} } }
      ].concat(extraTop || []) }
    ];
    var modes = labelModes === undefined ? LABEL_MODE_VALUES : labelModes;
    if (modes.length) {
      top.push({ type: 'grid', name: '', schema: [
        { name: 'label_mode', selector: C.selOptions(modes) },
        { name: 'label', selector: { text: {} } }
      ] });
    } else {
      top.push({ name: 'label', selector: { text: {} } });
    }
    // OFF-BY-DEFAULT EXTRAS, folded away: a hand-written map, the detail
    // sheet switch, the spin.
    var advanced = [];
    if (opts.map) {
      advanced.push(
        { name: 'label_map', label: 'Status Text for Each State',
          helper: 'A state -> text map, e.g. on: Running. Replaces the Status Text choice\'s own map.',
          selector: { object: {} } },
        { name: 'label_default', label: 'Status Text Fallback',
          helper: 'For a state the map does not list: fixed text, or sentence, title or spaces to reword the state.',
          selector: { text: {} } });
    }
    if (opts.spin) {
      advanced.push({ name: 'animation', label: 'Icon Animation',
        helper: 'Spin: the icon turns while it is on, for a fan on a switch.',
        selector: C.selOptions(['spin', 'none']) });
    }
    advanced.push({ name: 'detail', label: 'Detail Sheet', default: true,
      helper: 'Off: a tap does what Tap Action says, never the HK sheet.',
      selector: { boolean: {} } });

    if (opts.climate) {
      // the temperature stands where the icon would: size is all there is
      return top.concat([
        C.section('Appearance', [
          { name: 'size', selector: C.selOptions(['regular', 'tall']) }
        ].concat(appearanceExtra || []), 'mdi:palette'),
        C.section('Interactions', [
          { name: 'tap_action', selector: { ui_action: {} } }
        ], 'mdi:gesture-tap'),
        C.section('Advanced', advanced, 'mdi:cog')
      ]);
    }
    return top.concat([
      C.section('Appearance', [
        { type: 'grid', name: '', schema: [
          { name: 'icon', selector: { icon: {} } },
          { name: 'icon_color', selector: C.selColour() },
          { name: 'icon_size', selector: { text: {} } },
          { name: 'bare_icon', selector: { boolean: {} } },
          { name: 'size', selector: C.selOptions(['regular', 'tall']) }
        ].concat(appearanceExtra || []) },
        // A state -> icon map. An object selector (a small YAML editor) rather
        // than a bespoke row builder: the map is two or three lines and this is
        // the one place a free-form shape is honest.
        { name: 'icon_states', selector: { object: {} } }
      ], 'mdi:palette'),
      // A tile standing for SEVERAL entities: the group_* status texts read
      // these, and group_lit: any lights the plate when any member is on.
      C.section('Group', [
        { name: 'group', selector: { entity: { multiple: true } } },
        { name: 'group_lit', selector: C.selOptions(['entity', 'any']) }
      ], 'mdi:group'),
      // The split tap target: the Home app toggles from the glyph and opens detail
      // from the rest of the pill. Its own two actions, so the card can say so.
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } },
        { name: 'icon_tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap'),
      C.section('Advanced', advanced, 'mdi:cog')
    ]);
  }

  // register() and firstOf() live in hk-base.js -- every card file uses
  // them, not just the tiles.
  var register = C.register, firstOf = C.firstOf;

  // ------------------------------------------------------------ label modes
  //
  // Most status texts are ONE shape: a state->text map with a fallback. So
  // each is a named mode rather than a map repeated in every config -- these
  // files are often authored by hand, and an eight-entry map per tile reads
  // badly.
  //
  // `label_map` and `label_default` are the mechanism underneath, for anything
  // a preset does not cover. A default of 'sentence', 'title' or 'spaces' is a
  // transform of the state; anything else is a literal.
  var LOCK_MAP = {
    on: 'On', off: 'Off', open: 'Open', opening: 'Open',
    closed: 'Closed', closing: 'Closed', unlocked: 'Unlocked', locked: 'Locked'
  };
  var LABEL_MODES = {
    // `entity.state === 'on' ? 'On' : 'Off'` -- note that anything NOT on,
    // including unavailable, reads "Off". That is intended.
    on_off: { map: { on: 'On' }, dflt: 'Off' },
    state: { map: LOCK_MAP, dflt: 'title' },
    sentence: { map: {}, dflt: 'sentence' },
    title: { map: {}, dflt: 'title' },
    on_off_sentence: { map: { on: 'On', off: 'Off' }, dflt: 'sentence' },
    // `brightness` and `humidity` are handled before this table -- they read
    // attributes, not just the state, so they are not state->text maps.
    open_closed: { map: { on: 'Open', off: 'Closed' }, dflt: 'sentence' },
    // MOISTURE. The default is deliberately NOT 'sentence' -- it would render
    // "Unknown", and for many leak sensors unknown is the ORDINARY state, not
    // a fault. Sleepy battery Zigbee devices only report on a
    // change, so they sit at `unknown` from one restart to the next and read
    // that way for days at a time. "No Report" says the honest thing (nothing
    // has come in) without implying the device is broken. The distinction
    // matters because it is the whole reason the Water page can be a status
    // list at all.
    leak: { map: { on: 'Leak Detected', off: 'Dry' }, dflt: 'No Report' },
    alarm: {
      map: {
        armed_home: 'Home', armed_away: 'Away', armed_night: 'Night',
        armed_vacation: 'Vacation', armed_custom_bypass: 'Custom',
        disarmed: 'Off', triggered: 'Triggered', arming: 'Arming',
        pending: 'Pending', unavailable: 'Unavailable'
      },
      // Underscores to spaces, with NO capitalisation -- the alarm mode is the
      // only one that does not title-case its fallback.
      dflt: 'spaces'
    },
    // THE VACUUMS. `docked` and `idle` both read "Ready": on a wall tile the
    // useful distinction is "will start when asked" against "is working", and
    // a robot sitting on its dock is no more or less ready than one parked
    // mid-floor. Anything unlisted title-cases, so a new firmware state shows
    // up legibly instead of vanishing.
    vacuum: {
      map: {
        cleaning: 'Cleaning', returning: 'Returning', paused: 'Paused',
        docked: 'Ready', idle: 'Ready', error: 'Error'
      },
      dflt: 'title'
    }
  };

  // Every hvac_mode that means "make it warmer". `eco`, `performance`, `gas`
  // and `electric` are water-heater modes -- the same card draws those.
  var HEAT_STATES = ['heat', 'heat_pump', 'eco', 'performance', 'gas', 'electric'];

  // THE TEMPERATURE'S INK TRACKS WHAT THE SYSTEM IS DOING, not what it is set
  // to: blue while the compressor runs, red while the heat does, and the
  // ordinary text colour when it is simply holding. hvac_action, not state --
  // a thermostat set to `heat` and idle is not heating right now.
  function tempColour(st, on) {
    var action = st && st.attributes && st.attributes.hvac_action;
    if (action === 'cooling') return 'rgba(86, 189, 228, 0.98)';
    if (action === 'heating') return 'rgba(255, 69, 58, 0.98)';
    return on ? 'rgba(0, 0, 0, 0.92)' : '' + window.hkCards.v('ink') + '';
  }

  var sentence = C.sentenceCase;
  function titled(s) {
    return String(s).replace(/_/g, ' ').split(' ')
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
      .join(' ');
  }

  // The plain tile. A label is a static string, a named mode, or
  // (falling through) the on/off default.
  class HkTileCard extends HkTileBase {
    _sigOf() {
      var sig = super._sigOf(), mode = (this._config || {}).label_mode;
      if (mode === 'climate_temperature' || mode === 'climate_humidity') {
        sig += ';reading:' + !!(window.hkRoom && window.hkRoom.climateReading) + ':' +
          window.hkLocale.units().temp;
      }
      return sig;
    }
    // NOT REPORTING (the generated Water page's Sensor Coverage):
    // how many of `group` have said nothing -- neither on nor off -- shown
    // lit, since the tile is only there while that is more than none.
    // It stands for its group: no entity of its own.
    _entityOptional(c) { return !!(c && c.label_mode === 'unreported' && Array.isArray(c.group) && c.group.length); }
    _unreported() {
      var h = this.client, grp = Array.isArray(this._config.group) ? this._config.group : [];
      return grp.filter(function (id) { var x = h && h.states[id]; return !x || (x.state !== 'on' && x.state !== 'off'); }).length;
    }
    _isOn(st) {
      if (this._config && this._config.label_mode === 'unreported') return this._unreported() > 0;
      return super._isOn(st);
    }
    _label(st) {
      var cfg = this._config;
      if (cfg.label != null) return cfg.label;
      if (cfg.label_mode === 'unreported') return String(this._unreported());
      var s = (st && st.state) || 'unknown';
      if (cfg.label_mode === 'climate_temperature' || cfg.label_mode === 'climate_humidity') {
        var kind = cfg.label_mode.slice(8), R = window.hkRoom;
        var reading = R && R.climateReading && this.client ? R.climateReading(this.client, cfg.entity, kind) : null;
        return reading == null ? 'Unavailable' : Math.round(reading) + (kind === 'temperature' ? '°' : '%');
      }

      // The Home app names the JOB, not the state: "Lowering to 45%" on a
      // dehumidifier, the same way a thermostat reads "Cool to 72" rather than
      // "On". Keyed on device_class, not on `action`, so the phrase is stable
      // whether the unit is actively running or idling at its target -- which
      // is what the thermostat label does too.
      if (cfg.label_mode === 'brightness') return brightnessLabel(st);
      // A BLIND READS ITS POSITION, not its state: "45%" says more than
      // "Open", and the two endpoints still read Closed / Open so a fully
      // shut blind never says "0%". Falls back to the state when the cover
      // reports no position (some do not).
      if (cfg.label_mode === 'position') {
        if (s === 'unknown' || s === 'unavailable') return titled(s);
        var pos = st && st.attributes && st.attributes.current_position;
        if (pos != null && !isNaN(Number(pos))) {
          var pp = Math.round(Number(pos));
          if (pp <= 0) return 'Closed';
          if (pp >= 100) return 'Open';
          return pp + '%';
        }
        if (s === 'open' || s === 'opening') return 'Open';
        if (s === 'closed' || s === 'closing') return 'Closed';
        return titled(s);
      }
      // An IDLE TIMER shows what it is about to run for -- "45 min", "2 hr 30
      // min" -- so the tile is its own label AND its own button. `duration` is
      // an H:MM:SS string; a timer with no duration says "Start".
      if (cfg.label_mode === 'duration') {
        var dur = st && st.attributes && st.attributes.duration;
        if (!dur) return 'Start';
        var parts = String(dur).split(':').map(Number);
        if (parts.some(isNaN)) return 'Start';
        while (parts.length < 3) parts.unshift(0);
        var hh = parts[0], mm = parts[1];
        if (!hh && !mm) return 'Start';
        if (hh && mm) return hh + ' hr ' + mm + ' min';
        return hh ? (hh + ' hr') : (mm + ' min');
      }
      // ---- the two GROUP labels. See `group` on HkTileBase below.
      if (cfg.label_mode === 'group_brightness') {
        var lit = this._groupOn();
        if (!lit.length) return 'Off';
        var pcts = [];
        for (var gi = 0; gi < lit.length; gi++) {
          var gb = lit[gi].attributes && lit[gi].attributes.brightness;
          if (gb != null && !isNaN(Number(gb))) {
            pcts.push(Math.round((Number(gb) / 255) * 100));
          }
        }
        if (!pcts.length) return 'On';
        var sum = 0;
        for (var pi = 0; pi < pcts.length; pi++) sum += pcts[pi];
        return Math.round(sum / pcts.length) + '%';
      }
      if (cfg.label_mode === 'group_count') {
        // Gated on the card's OWN entity, not on the group: this tile's
        // entity is the group light itself, and "Off" means that group is
        // off. Counting members would say "1 On" for a group reporting off.
        if (s !== 'on') return 'Off';
        var n = this._groupOn().length;
        return n > 1 ? (n + ' On') : 'On';
      }
      // A THERMOSTAT'S SETPOINT. Two modes because the two tiles say it
      // differently: the favourite row has no space for a verb and reads
      // "68\u00b0\u201372\u00b0"; the tall tile has the width and reads
      // "Heat to 72\u00b0", which is what the Home app does.
      if (cfg.label_mode === 'setpoint' || cfg.label_mode === 'setpoint_verb') {
        var at = (st && st.attributes) || {};
        var num = function (v) { return v != null && !isNaN(Number(v)); };
        var deg = function (v) { return Math.round(Number(v)) + '\u00b0'; };
        var verb = cfg.label_mode === 'setpoint_verb';
        if (verb && s === 'off') return 'Off';
        if (num(at.target_temp_low) && num(at.target_temp_high)) {
          return deg(at.target_temp_low) + '\u2013' + deg(at.target_temp_high);
        }
        if (num(at.temperature)) {
          if (!verb) return deg(at.temperature);
          if (HEAT_STATES.indexOf(s) !== -1) return 'Heat to ' + deg(at.temperature);
          if (s === 'cool') return 'Cool to ' + deg(at.temperature);
          return 'Set to ' + deg(at.temperature);
        }
        // The plain mode does NOT title-case its fallback; the verb one does.
        return verb ? titled(s) : String(s).replace(/_/g, ' ');
      }
      if (cfg.label_mode === 'humidity') {
        if (s === 'off') return 'Off';
        if (s === 'unavailable' || s === 'unknown') return 'Unavailable';
        var at = (st && st.attributes) || {};
        var target = at.humidity;
        if (target == null || isNaN(Number(target))) return 'On';
        var down = at.device_class === 'dehumidifier' || at.action === 'drying';
        return (down ? 'Lowering to ' : 'Raising to ') + Math.round(Number(target)) + '%';
      }

      var preset = LABEL_MODES[cfg.label_mode];
      var map = cfg.label_map || (preset && preset.map);
      var dflt = cfg.label_default != null
        ? cfg.label_default : (preset && preset.dflt);
      if (map && map[s] != null) return map[s];
      if (dflt == null) {
        if (!st) return '';
        return s === 'on' ? 'On' : (s === 'off' ? 'Off' : s);
      }
      if (dflt === 'sentence') return sentence(s);
      if (dflt === 'title') return titled(s);
      if (dflt === 'spaces') return String(s).replace(/_/g, ' ');
      return dflt;
    }
  }

  // The light tile's status: brightness while on. The rule lives here once,
  // not in every light's config.
  //
  // Also reachable as `label_mode: brightness` on any tile, because the
  // favourites row wants a light's brightness on a FAVOURITE tile (which has a
  // room line and so is not an hk-light-card).
  function brightnessLabel(st) {
    var s = (st && st.state) || 'unknown';
    if (s === 'unknown' || s === 'unavailable') return titled(s);
    if (s === 'on') {
      var b = st.attributes && st.attributes.brightness;
      if (b !== undefined && b !== null && !isNaN(Number(b))) {
        return Math.round((Number(b) / 255) * 100) + '%';
      }
    }
    return s === 'on' ? 'On' : 'Off';
  }

  class HkLightCard extends HkTileCard {
    _label(st) {
      if (this._config.label != null) return this._config.label;
      return brightnessLabel(st);
    }
  }

  // The fan tile -- percentage when running.
  class HkFanCard extends HkTileCard {
    // Spins by default; a config can still turn it off.
    _animation() { return this._config.animation || 'spin'; }
    _label(st) {
      if (this._config.label != null) return this._config.label;
      var s = (st && st.state) || 'unknown';
      if (s === 'on') {
        var pct = st.attributes && st.attributes.percentage;
        if (pct !== undefined && pct !== null && !isNaN(Number(pct))) {
          return Math.round(Number(pct)) + '%';
        }
        return 'On';
      }
      if (s === 'off') return 'Off';
      return String(s).replace(/_/g, ' ').split(' ')
        .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
        .join(' ');
    }
  }

  // The cover tile -- position wins over state, because a blind at 40% is neither
  // open nor closed and saying "Open" there is wrong.
  class HkCoverCard extends HkTileCard {
    _label(st) {
      if (this._config.label != null) return this._config.label;
      var s = (st && st.state) || 'unknown';
      if (s === 'unknown' || s === 'unavailable') return titled(s);
      var pos = st && st.attributes && st.attributes.current_position;
      if (pos !== undefined && pos !== null && !isNaN(Number(pos))) {
        var p = Math.round(Number(pos));
        if (p <= 0) return 'Closed';
        if (p >= 100) return 'Open';
        return p + '%';
      }
      if (s === 'open' || s === 'opening') return 'Open';
      if (s === 'closed' || s === 'closing') return 'Closed';
      return sentence(s);
    }
  }

  // The scene tile -- the variant with the 33 deltas. Also the action tile,
  // which is a scene with `elevated: true`.
  class HkSceneCard extends HkTileBase {
    // A TAP RUNS IT. One placed by hand (the card picker's, written without a
    // tap_action) runs its scene, script or automation like the generated
    // rows' pills, rather than opening its sheet. A tap_action of its own wins.
    setConfig(config) {
      var c = config || {};
      if (c.entity && !c.tap_action) c = Object.assign({}, c, { tap_action: window.hkCards.sceneTap(String(c.entity)) });
      super.setConfig(c);
    }
    _variant() {
      return this._config.elevated ? 'scene elevated' : 'scene';
    }
    // A scene pill may be just an action: the Live TV pill navigates to the
    // Live TV page and has no entity. It then never lights (no state).
    _entityOptional() { return true; }
    // ...and no state change can change it, so it draws once. HkBase's default
    // signature is NULL -- "render on every push" -- when the config names no
    // entity, which would put an entity-less pill on several renders a second
    // on every dashboard that has one. 'static', like the back chevron. A
    // parent that lights a pill itself (_hkLit) already clears _hkSig to
    // redraw it (hk-media.js _paintBusy), so the gate does not hide that.
    _sigOf() {
      var c = this._config || {};
      if (!c.entity && !(Array.isArray(c.group) && c.group.length)) return 'static';
      return super._sigOf();
    }
    // (No tile has a hold -- see HkTileBase.)
    // A scene lights only on 'on' -- it does NOT get the pill's extended
    // ON_STATES, so a scene must not light up for 'open' or 'paused'.
    // _hkLit: set by a parent that decides on its own -- the speaker picker's
    // playlist pills have no entity at all, and light while
    // THIS screen's request for them is in flight.
    _isOn(st) {
      if (this._hkLit) return !!this._hkLit();
      return !!st && st.state === 'on';
    }
    _hasLabel() { return false; }
    _label() { return ''; }
    // ITS COLOUR, AS CHOSEN: an accessory's Color (its detail sheet), a page
    // pill's (HK Settings). White -- or none chosen -- is the Home app's own
    // scene: a bare white glyph, and a tapped one flips to near-black on the
    // white plate. A COLOUR is worn as an accessory wears it: off, the glyph
    // takes it; lit (a running script, a scene the moment it is tapped:
    // .hk-tapped), it fills a circle behind a white glyph on the white plate.
    _tint(cfg) {
      var c = cfg.icon_color ? String(cfg.icon_color).toLowerCase().trim() : '';
      return c && c !== 'white' ? colourFor(cfg, null) : null;
    }
    // no well unless lit in a colour: the scene stylesheet owns it otherwise
    _wellBackground(cfg, st, on) {
      var t = this._tint(cfg);
      return t ? (on ? t : 'none') : null;
    }
    _iconColour(cfg, st, on) {
      var t = this._tint(cfg);
      if (t) return on ? 'white' : t;
      return on ? 'rgba(0, 0, 0, 0.95)' : '' + window.hkCards.v('ink') + '';
    }
    // (Flat Colors: its chosen color, else neutral -- never the domain's)
    _idleSource(cfg) { return this._tint(cfg); }
    _render() {
      super._render();
      var e = this._els, t = this._tint(this._config || {});
      if (!e || !e.card) return;
      e.card.classList.toggle('tinted', !!t);
      if (t) e.card.style.setProperty('--hk-tint', t);
    }
  }

  // The favorite tile -- adds a room line above the name. `room` is a plain
  // string in the config: a card authored by hand in YAML needs options
  // that read cleanly, not expressions.
  class HkFavoriteCard extends HkTileCard {
    _variant() { return 'favourite'; }
    setConfig(config) { super.setConfig(Object.assign({ layout: 'favourite' }, config)); }
  }

  // The climate favorite and the tall climate tile -- one class, two layouts.
  //
  // The two differ in three things and nothing else: the grid, the
  // type scale (both in CSS above), and WHEN THE PLATE IS LIT. The favourite
  // one is lit always -- a thermostat on
  // the favourites row is a reading, not a switch. The tall one lights only
  // while the system is on, like every other tall tile in the room grid.
  class HkClimateCard extends HkTileCard {
    _variant() { return 'climate'; }
    setConfig(config) { super.setConfig(Object.assign({ layout: 'climate' }, config)); }
    // Always the lit material.
    _isOn() { return true; }
    _render() {
      super._render();
      var e = this._els;
      // parentNode check, not just existence: a config edit rebuilds the grid
      // (HkBase.setConfig), and a kept reference would point at the old one.
      if (!this._tempEl || this._tempEl.parentNode !== e.grid) {
        this._tempEl = document.createElement('div');
        this._tempEl.className = 'temp';
        this._tempEl.setAttribute('data-hk-role', 'temp');
        e.grid.appendChild(this._tempEl);
      }
      var st = this._st(this._config.entity);
      var t = st && st.attributes && st.attributes.current_temperature;
      var txt = (t == null || isNaN(Number(t))) ? this._noTemp()
                                                : (Math.round(Number(t)) + '\u00b0');
      if (this._tempEl.textContent !== txt) this._tempEl.textContent = txt;
      this._tempEl.style.color = tempColour(st, !!this._isOn(st));
    }
    // "--\u00b0" on the favourite row, where the column would otherwise
    // collapse and drag the text left; EMPTY on the tall tile, which has a
    // fixed 44px row and simply shows nothing.
    _noTemp() { return '--\u00b0'; }
  }

  class HkClimateTallCard extends HkClimateCard {
    _variant() { return 'climate_tall tall'; }
    setConfig(config) {
      super.setConfig(Object.assign({ layout: 'climate_tall' }, config));
    }
    _isOn(st) {
      var s = st && st.state;
      return !!s && ['off', 'unavailable', 'unknown'].indexOf(s) === -1;
    }
    _noTemp() { return ''; }
  }

  class HkTallCard extends HkTileCard {
    _variant() { return 'tall'; }
    setConfig(config) { super.setConfig(Object.assign({ layout: 'tall' }, config)); }
  }

  var WELL = { name: 'well_background', selector: { text: {} } };
  var BARE_COLOUR = { name: 'bare_icon_color', selector: C.selColour() };
  var ROOM = { name: 'room', selector: { text: {} } };
  // the same card draws a water heater (HEAT_STATES' eco, gas, electric)
  var CLIMATE = ['climate', 'water_heater'];

  register('hk-favorite-card', HkFavoriteCard, 'HK Favorite Tile',
    'A tile with the room name above the entity name, for a favorites row.',
    tileSchema([ROOM], undefined, [BARE_COLOUR, WELL], { map: true, spin: true }),
    function (client) { return { entity: firstOf(client, 'light'), room: 'Living Room' }; });

  register('hk-climate-card', HkClimateCard, 'HK Climate Favorite Tile',
    'A favorites tile for a thermostat, with the current temperature in place of the icon.',
    tileSchema([ROOM], ['setpoint', 'setpoint_verb'], undefined, { domains: CLIMATE, climate: true }),
    function (client) { return { entity: firstOf(client, 'climate'), room: 'Hallway' }; });

  register('hk-climate-tall-card', HkClimateTallCard, 'HK Climate Tall Tile',
    'A double-height thermostat tile with the current temperature and target.',
    tileSchema([], ['setpoint_verb', 'setpoint'], undefined, { domains: CLIMATE, climate: true }),
    function (client) { return { entity: firstOf(client, 'climate') }; });

  register('hk-tall-card', HkTallCard, 'HK Tall Tile',
    'A double-height tile for any entity, like the lock and garage tiles in the Home app.',
    tileSchema([], undefined, [BARE_COLOUR, WELL], { map: true, spin: true }),
    function (client) { return { entity: firstOf(client, 'lock') }; });

  register('hk-tile-card', HkTileCard, 'HK Tile',
    'A Home app–style tile for any entity: icon, name and a status line.',
    tileSchema([], undefined, [BARE_COLOUR, WELL], { map: true, spin: true }),
    function (client) { return { entity: firstOf(client, 'switch') }; });

  register('hk-light-card', HkLightCard, 'HK Light Tile',
    'A light tile that shows brightness. Tap the icon to switch it on or off.',
    // The status text is the whole point of this card -- it computes
    // brightness -- so no status choice is offered.
    tileSchema([], [], [BARE_COLOUR, WELL], { domains: ['light'] }),
    function (client) { return { entity: firstOf(client, 'light'), icon_tap_action: { action: 'toggle' } }; });

  register('hk-fan-card', HkFanCard, 'HK Fan Tile',
    'A fan tile that shows its speed, with a spinning icon while on.',
    tileSchema([], [], [{ name: 'animation', selector: C.selOptions(['spin', 'none']) }], { domains: ['fan'] }),
    function (client) { return { entity: firstOf(client, 'fan'), icon_tap_action: { action: 'toggle' } }; });

  register('hk-cover-card', HkCoverCard, 'HK Cover Tile',
    'A blind, shade or garage door tile that shows how far open it is.',
    tileSchema([], [], undefined, { domains: ['cover'] }),
    function (client) { return { entity: firstOf(client, 'cover'), icon_tap_action: { action: 'toggle' } }; });

  register('hk-scene-card', HkSceneCard, 'HK Scene Tile',
    'A tile that runs a scene or script when tapped, and lights up while it runs.',
    // A scene draws no status text and has no hold, so neither appears here.
    [
      // NOT required: a pill may be only an action (Live TV navigates)
      { name: 'entity', selector: { entity: {
          filter: [{ domain: 'scene' }, { domain: 'script' }, { domain: 'automation' }] } } },
      { name: 'name', selector: { text: {} } },
      C.section('Appearance', [
        { type: 'grid', name: '', schema: [
          { name: 'icon', selector: { icon: {} } },
          { name: 'icon_color', selector: C.selColour() },
          { name: 'icon_size', selector: { text: {} } },
          { name: 'elevated', selector: { boolean: {} } }
        ] }
      ], 'mdi:palette'),
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ],
    function (client) { return { entity: firstOf(client, 'script') }; });

  window.hkTile.HkTileCard = HkTileCard;
  window.hkTile.HkSceneCard = HkSceneCard;
  window.hkTile.HkTileBase = HkTileBase;
  window.hkTile.LAYOUTS = LAYOUTS;
  window.hkTile.NAME_MAP = NAME_MAP;
  window.hkTile.wellColour = wellColour;
  window.hkTile.colourFor = colourFor;
  window.hkTile.ON_STATES = ON_STATES;   // hk-chip.js reuses this
  window.hkTile.iconColour = iconColour;
  // hk-chip / hk-stat drawn before this file ran used fallback colours:
  // tell them the palette is here (MODULE WAKE, hk-base.js).
  window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkTile' }));
  });
})();
