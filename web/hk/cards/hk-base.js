// hk-base.js -- the foundation every hk card file builds on.
//
// HkBase (the card base class: render gating, the tap contract, actions,
// confirmations), the shared material, the config-editor helpers, register()
// and firstOf() for defining a card, create() for nesting one card inside
// another, and the camera thumbnail cache. Publishes all of it as
// window.hkCards and fires `hk-cards-ready`, which every card file waits for.
//
// The cards themselves live in the other files under cards/. The event is
// named for window.hkCards, and every card file listens for it.
//
// WHY LOCAL CARDS AT ALL
//
// WHY THIS FILE EXISTS
// Some of what a dashboard holds is the HOUSE's state -- a lock, a timer, an
// alarm -- and belongs in entities, where automations, the phone app and voice
// can all reach it. Some of it is only ever ONE PERSON'S, for a few seconds,
// on ONE screen: the digits half-typed into a keypad, the rooms ticked before
// pressing Clean. Modelling that second kind as entities has three costs, and
// this file exists so that none of them is paid:
//
//   1. IT IS GLOBAL. An input_text keypad buffer is one buffer for the whole
//      house: two people typing on two tablets overwrite each other. A set of
//      input_boolean area helpers is worse -- a collision there
//      dispatches a robot to somebody else's selection.
//   2. IT IS A ROUND TRIP. Every keystroke is a service call, a state write,
//      a WebSocket broadcast to every connected client, and a re-render --
//      and a re-render that replaces an <input> takes the caret with it.
//   3. IT IS RECORDED, or has to be explicitly excluded; otherwise every
//      tick writes history rows.
//
// WHAT DOES *NOT* MOVE HERE
// The security boundary. The Alarm PIN feature's panel checks the
// entered code and forwards to the real alarm panel; that stays server-side, because a
// card cannot enforce anything -- anyone can call the service directly. A
// card collects the code. HA decides if it is right.
//
// THE LOOK
// Every surface here is the Home app's material. It is NOT hardcoded: the
// HK Kiosk theme (theme/hk_kiosk_theme.yaml) publishes it as
// --hk-glass-bg / --hk-glass-border / --hk-glass-shadow-sm / -lg /
// --hk-glass-radius / --hk-well-bg, so the theme is the single source and
// this file inherits it. The literals in the var() fallbacks are only for a
// card placed on a view with some other theme; if you change the material,
// change the THEME. (A few per-size shadow names -- -pill, -scene, -tall,
// -chip -- are read with a fallback but not published by the theme; they
// resolve to their literals until a theme defines them.)
//
// Geometry, by contrast, is measured off the Home app, and the numbers are
// load-bearing -- see the notes in hk-tile.js before touching any of them.
(function () {
  'use strict';

  function initialize() {
  if (window.hkCards) return;          // hk-loader may import this twice
  window.hkCards = { version: '1.1.0' };

  // ---------------------------------------------------------- the design table
  // EVERY DESIGN VALUE BY NAME, in one place (design consolidation,
  // hk_house/docs/DESIGN.md). The keys are the code's --hk-* names without the
  // prefix; the values are the DARK ones HK's own screens use. Write a value
  // into a CSS string with v(name):
  //
  //   v('ink-2')  ->  'var(--hk-ink-2,rgba(255,255,255,0.68))'
  //
  // -- the token wherever a theme, a look or a light page sets it (LIGHT
  // below), this table's value everywhere else. A new design value gets a
  // name here (and a design-system entry), never a literal in a card.
  var T = {
    // text: the three-step scale (test_textscale)
    'ink': 'rgba(255,255,255,0.94)',
    'ink-2': 'rgba(255,255,255,0.68)',
    'ink-3': 'rgba(255,255,255,0.40)',
    // not text, six surfaces (test_surfaces): a hairline / divider / grid
    // line, a track (slider, progress, a bar's empty), a key or chip on a
    // plate, a selected or pressed key, an off glyph with no color of its
    // own, a mark (chevron, tick, notch, dashed edge); and a progress fill
    'line': 'rgba(255,255,255,0.10)',
    'line-strong': 'rgba(255,255,255,0.18)',
    'key': 'rgba(255,255,255,0.10)',
    'key-strong': 'rgba(255,255,255,0.18)',
    'glyph': 'rgba(255,255,255,0.92)',
    'mark': 'rgba(255,255,255,0.32)',
    'track-fill': 'rgba(255,255,255,.92)',
    // the glass: plate, edge, shadows by size, corner, well (the HK Kiosk
    // theme publishes the same; M above reads them)
    'glass-bg': 'linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.056))',
    'glass-border': '1px solid rgba(255,255,255,0.13)',
    'glass-shadow-sm': '0 8px 22px rgba(0,0,0,0.12)',
    'glass-shadow-lg': '0 10px 28px rgba(0,0,0,0.12)',
    'glass-shadow-pill': 'inset 0 1px 0 rgba(255,255,255,0.20), 0 8px 22px rgba(0,0,0,0.12)',
    'glass-shadow-tall': 'inset 0 1px 0 rgba(255,255,255,0.20), 0 10px 28px rgba(0,0,0,0.12)',
    'glass-shadow-scene': 'inset 0 1px 0 rgba(255,255,255,0.20)',
    'glass-shadow-chip': 'inset 0 1px 0 rgba(255,255,255,0.20), 0 6px 18px rgba(0,0,0,0.10)',
    'glass-radius': '23.5px',
    'well-bg': 'rgba(0,0,0,0.14)',
    // status as text, and the accent (where you are; the logo's orange)
    'warn': '#FFB340',
    'fail': '#FF6961',
    'accent': '#ff9f0a',
    // overlay surfaces (OVER): translucent over its own blur (sheets, banners,
    // the menu, the tab bar and its More sheet in the Blur look), near-solid
    // with no blur (Tinted's menu and bar, the readout pill, the stash button,
    // the calendar's event editor), and the floating strip outside Tinted
    'overlay': 'rgba(28,28,32,0.52)',
    'overlay-solid': 'rgba(24,24,28,0.93)',
    'float-plate': 'rgba(28,28,30,0.62)',
    // A BATTERY'S FILL (the user's soft sheen, 2026-10-13): top-lit, through
    // HK's green at the middle, on every battery -- the House Battery, its
    // packs, the battery strip and the Power page's level bar -- and red at or
    // under the reserve. Not on a car's level bar (flat there: the user).
    'battery-fill': 'linear-gradient(180deg, #5ee283 0%, #30d158 48%, #26b449 100%)',
    'battery-fill-low': 'linear-gradient(180deg, #ff7a70 0%, #ff453a 48%, #d9362c 100%)',
    // what text carries over the sky or a photo
    'glow': '0 1px 3px rgba(0,0,0,0.30), 0 2px 8px rgba(0,0,0,0.22)',
    // ON A LIT (WHITE) PILL: the room line and the state, the Home app's
    // grays (measured 2026-10-13: room #464649, state #79797b). The state is
    // #767678, 3/255 darker, so it keeps 4.5:1 on white (#79797b is 4.34).
    // A lit pill is white on a light page too: no LIGHT entry.
    'ink-on-room': '#464649',
    'ink-on-state': '#767678',
    // THE FONT: the HK Kiosk theme's stack (theme/hk_kiosk_theme.yaml) --
    // SF Pro where the house has it (/hk/fonts), else the system's own on an
    // Apple device (the same SF), Roboto elsewhere
    'font-body': "'SF Pro', -apple-system, BlinkMacSystemFont, Roboto, Noto, sans-serif"
  };
  function v(name) {
    if (!Object.prototype.hasOwnProperty.call(T, name)) throw new Error('hkCards.v: no design value ' + name);
    return 'var(--hk-' + name + ',' + T[name] + ')';
  }
  // THE FONT ON A SURFACE MOUNTED OUTSIDE THE VIEW -- a sheet, a pop-up, the
  // menu, the tab bar, the banners: it hangs under <body> or Home Assistant's
  // shadow root, not under the view the HK Kiosk theme is put on, so it says
  // the font itself, and sets the theme's variable for the cards in it.
  var FONT_ROOT = '--ha-font-family-body:' + v('font-body') + ';font-family:' + v('font-body');
  // THE SIDE SAFE AREA (2026-10-30, the iPhone Duo): a strip of system
  // controls down one side -- the Duo's camera, a Live Activity, the time
  // and Wi-Fi in ~84 pt at its right -- or a phone turned with its Dynamic
  // Island at the side. The app's web view runs under it, as a native app's
  // backgrounds do (the sky, a Flat ground, the screensaver), and the page
  // keeps what is read and touched clear of it: the views, the tab bar, the
  // menu, the sheets. env(safe-area-inset-left / -right), 0 in a browser on
  // a computer, so nothing moves there. Read through --hk-safe-left /
  // --hk-safe-right first, as --hk-safe-top is (hk-menu.js), so a check can
  // stand one in: a headless browser has no inset of its own.
  var SAFE = { l: 'var(--hk-safe-left,env(safe-area-inset-left,0px))', r: 'var(--hk-safe-right,env(safe-area-inset-right,0px))',
               t: 'var(--hk-safe-top,env(safe-area-inset-top,0px))', b: 'var(--hk-safe-bottom,env(safe-area-inset-bottom,0px))' };
  // ...less what the page's own edge already clears on that side -- a docked
  // menu, the Now Playing pane (hk-menu.js --hk-page-left / -right): the room
  // the page keeps there
  SAFE.padL = 'max(0px,' + SAFE.l + ' - var(--hk-page-left,0px))';
  SAFE.padR = 'max(0px,' + SAFE.r + ' - var(--hk-page-right,0px))';
  // ...and in px, measured (the tab bar's strip, the page's width for its
  // band): a hidden probe padded by them. Zeros where it can't be read.
  var safeProbe = null;
  function safeArea() {
    var out = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      var d = document, host = d.body || d.documentElement;
      if (!host || typeof getComputedStyle !== 'function') return out;
      if (!safeProbe || !safeProbe.isConnected) {
        safeProbe = d.createElement('div');
        safeProbe.setAttribute('aria-hidden', 'true');
        safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;box-sizing:content-box;' +
          'padding:' + SAFE.t + ' ' + SAFE.r + ' ' + SAFE.b + ' ' + SAFE.l;
        host.appendChild(safeProbe);
      }
      var cs = getComputedStyle(safeProbe);
      ['top', 'right', 'bottom', 'left'].forEach(function (k) {
        var n = parseFloat(cs['padding' + k.charAt(0).toUpperCase() + k.slice(1)]);
        out[k] = n > 0 ? n : 0;
      });
    } catch (e) { /* no layout here: no inset */ }
    return out;
  }
  // ...and the document's root carries the table's font as --hk-font-body,
  // for a surface whose stylesheet is built before this file has loaded
  // (hk-notify, hk-popup, hk-saver: they read var(--hk-font-body)). A theme
  // that sets the variable wins (Home Assistant puts themes on as inline
  // styles).
  try {
    if (document.head && !document.getElementById('hk-font-body')) {
      var fontSheet = document.createElement('style');
      fontSheet.id = 'hk-font-body';
      fontSheet.textContent = ':root{--hk-font-body:' + T['font-body'] + '}';
      document.head.appendChild(fontSheet);
    }
  } catch (e) { /* no document (a test harness) */ }

  // ------------------------------------------------------------- the scales
  // A SMALL NAMED SCALE FOR EACH FAMILY (DESIGN.md has the tables and why).
  //
  // Spacing, three tiers on purpose: tiles (measured off the Home app, see
  // hk-tile.js), page cards (the Energy plate), cards in sheets (SP: every
  // gap in a detail sheet is one of these -- hk-detail.js reads it here).
  var SP = { region: 20, piece: 20, piecePhone: 16, block: 12, line: 6, cardR: 20,
             cardPad: '16px 18px 14px', rowsPad: '14px 18px', inset: 18 };
  // THE PILL, ONE SOURCE (plan 2026-10-13, the HomeKit match): every pill
  // dimension a card, a generated page or a sheet draws is read from here
  // (or from --hk-pill / --hk-gap in css/hk-responsive.css, which can't read
  // JS) -- tests/test_pillgeom.js holds the literals out.
  //   w, h        the pill (Home app: 196 x 70 in iPad points)
  //   gridGap     between pills, both directions -- a grid's column gap, and
  //               the row's share of `row`
  //   fav         a three-line pill (favourite / climate layouts)
  //   favPadY     its top and bottom padding (the text block is centered)
  //   padL        the pill's left padding: where the circle starts (Home: the
  //               circle 10.3 from the plate's edge, the name's first letter 62.9)
  //   wellGap     circle -> text
  //   scenePadL / sceneWellGap  a scene's: its text already matches Home's
  //   glyph       the default glyph in the circle (a measured glyph names its
  //               own size: hk-strategy.js PX)
  //   lineH       a text line's height (15 px type at 1.1); the text rows are
  //               this tall, so the 42 px circle beside them no longer
  //               stretches them (it made the name -> state pitch 20.4)
  //   rowGap      name -> state on a pill: pitch lineH + rowGap = 18.6, the
  //               Home app's; favRowGap a favorite's three lines (18.3)
  //   tallText    a tall tile's type (Home: 15); tallRowGap its name -> state
  //               (pitch 19.2, measured off the Home app's tall tile)
  //   sceneGlyph  a scene's bare glyph
  // Derived, not second numbers: row (a grid row: pill + gap), favRow (a
  // three-line pill's row), tall (two rows: 2 x h + gridGap), pad.
  var TILE = { w: 196, h: 70, gridGap: 10, fav: 76, favPadY: 12.25, padL: 9.8, wellGap: 9.6, glyph: 23,
               scenePadL: 10.3, sceneWellGap: 10,
               lineH: 16.5, rowGap: 2.1, favRowGap: 1.8, tallText: 15, tallRowGap: 2.7, sceneGlyph: 28 };
  TILE.row = TILE.h + TILE.gridGap;
  TILE.favRow = TILE.fav + TILE.gridGap;
  TILE.tall = 2 * TILE.h + TILE.gridGap;
  TILE.pad = '10.7px 12.8px 10.7px ' + TILE.padL + 'px';
  // CENTRED TILES (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase B): the
  // Tile Style that sets the glyph above the name and the room, all centred,
  // as HomeView does -- measured off its screenshot, side by side. Per cell:
  //   box / glyph  the glyph's box and its size, bare (off): 66 px in a 196
  //                cell, about 55 px of ink
  //   well / lit   lit: the glyph `lit` in a `well` of its colour
  //   at           the glyph's centre, % down the tile
  //   text         the name's top, % down; the room (or the state) under it
  //   name / sub / line   their sizes (600 and 400) and the lines they sit on
  // `tall`: a 196 x 150 tile (a room page's Tall pill, a tile-celled block);
  // `square`: a 196 x 196 cell. Home's numbers above are untouched.
  TILE.centred = {
    tall: { box: 56, glyph: 50, well: 50, lit: 30, at: 31, text: 55, name: 17, sub: 16, line: 22 },
    square: { box: 72, glyph: 66, well: 64, lit: 40, at: 33, text: 57.7, name: 21, sub: 20, line: 27 },
    track: -0.3, inset: 10 };
  // A pill's width as CSS: --hk-pill (the iPad band's, css/hk-responsive.css)
  // or the table's.
  var PILL_W = 'var(--hk-pill,' + TILE.w + 'px)';
  TILE.css = PILL_W;
  // The status chip (hk-chip.js): its height; the corner and margins follow.
  var CHIP = { h: 43 };
  var CARD = { pad: '20px 22px', y: 20, x: 22 };
  // HOME GRID (hk-home-grid-view, hk-layout.js; docs/phase11/HOME-GRID.md):
  // the size classes, [columns, rows] -- the same table as
  // hk-grid-catalog.js SIZES and hk_core home_grid.SIZES -- and the grid's
  // numbers: the gap between cells, the top band's height. A block's card
  // reads its class from its `size` attribute and its cell from
  // --hk-cell-w / --hk-cell-h. F (Full: the view's whole grid) is 0 x 0 here:
  // its cell says how many columns and rows (--hk-span-c / --hk-span-r).
  var HOME_GRID = { sizes: { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2], XXL: [6, 2], F: [0, 0] }, gap: TILE.gridGap, band: 60, pad: 1280 * 0.015 + 8 };
  // SQUARE CELLS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md "The numbers"): a
  // grid's `cell: square` -- 196 x 196, the tile's width with a square's
  // height, and HomeView's 13 px gap (6.7 % of a cell; tiles keep 10). A
  // Square screen's canvas edge is 14 px, about a gap from the glass, not the
  // page gutter. hk-grid-catalog.js CELLS is the same table (a test holds it).
  HOME_GRID.square = { w: TILE.w, h: 196, gap: 13, edge: 14 };
  // Breakpoints (px): screens for page structure, card widths for container
  // queries inside a card. A media query can't read a CSS variable, but every
  // card's CSS is a JS string, so these interpolate.
  var BP = { phone: 640, tabletUpright: 860, wide: 900, desk: 1176,
             cardSide: 560, cardList: 700, cardHero: 860, cardTwo: 1000, cardRows: 1100 };
  // Motion: four curves, six durations. `ease` / `linear` stay where they are
  // (presses, spins, shimmers).
  var EASE = { standard: 'cubic-bezier(.32,.72,0,1)',      // sheets, menu, tab bar
               spring: 'cubic-bezier(.34,1.24,.42,1)',     // a highlight that moves, a banner in
               build: 'cubic-bezier(.22,.8,.25,1)',        // graphs building
               exit: 'cubic-bezier(.4,0,.8,.4)' };         // a banner out
  var DUR = { press: '.12s', fade: '.2s', standard: '.34s', spring: '.42s', build: '.6s', ring: '.85s' };
  // Blur, three tiers: light (chips; the Blur look's glass at its 50%
  // default), medium (tab bar, floating strip, banners), heavy (sheets,
  // pop-ups, the menu, the More sheet). HA's dialogs and HK Settings' nav bar
  // keep their own.
  // ...and bright (2026-10-30): Bright Glass's plates (Shared Layer), tab
  // bar, menu and chips -- light, so a wallpaper's edges show through; its
  // sheets take blur(34px) saturate(2) (hk-settings.js BRIGHT)
  var BLUR = { light: 'blur(20px) saturate(1.4) brightness(0.82)',
               medium: 'blur(24px) saturate(1.6)',
               heavy: 'blur(34px) saturate(1.9)',
               bright: 'blur(4px) saturate(1.3) brightness(1.08)' };
  // Corners (px): the plate is THE corner; a capsule is half its height
  // (R.capsule('52px') -> 'calc(52px / 2)'). Settings (10 / 7) and the
  // iOS switch keep theirs.
  var R = { plate: 23.5, inner: 12, small: 8, sheet: 38, sheetPhone: 30, banner: 30, bannerPhone: 26,
            sheetSmall: 28, cardInSheet: 20, bigArt: 22,
            // square cells (HomeView's one radius, measured: 21 px on a 120 px
            // tile -> 34 in a 196 cell), and a Square screen's corner block's
            // outer corner, concentric with the display (45 -> 72)
            square: 34, 'square-screen': 72,
            capsule: function (h) { return 'calc(' + h + ' / 2)'; } };
  // Overlay surfaces: translucent over its own blur, near-solid with none,
  // and the floating strip outside the Tinted look.
  var OVER = { overlay: 'rgba(28,28,32,0.52)', solid: 'rgba(24,24,28,0.93)', float: 'rgba(28,28,30,0.62)' };
  // Type roles: size (px) / weight / tracking. Home-app-measured sizes (tile
  // text, chip text, the section heading) and HK Settings are not roles.
  var TYPE = {
    hero: { size: 44, weight: 600, track: '-1.5px' },
    'figure-l': { size: 36, weight: 700, track: '-1px' },
    figure: { size: 30, weight: 700, track: '-0.6px' },
    title: { size: 22, weight: 700, track: '-0.35px' },
    'page-title': { size: 34, weight: 700, track: '-0.6px' },
    headline: { size: 17, weight: 600 },
    body: { size: 15, weight: 500 },
    caption: { size: 13, weight: 500 },
    label: { size: 13, weight: 600, track: '0.3px', upper: true },
    'label-small': { size: 11, weight: 600, track: '0.4px', upper: true },
    micro: { size: 11, weight: 600 }
  };

  // ----------------------------------------------------------- the builders
  // A PLATE as one declaration: corner, the material (M.glass: the look's
  // plate first, the shared-blur marker, the Blur-each backdrop), the edge,
  // and the shadow by size -- the look's (--hk-look-shadow, Tinted's contact
  // shadow) first, as every plate has read it. A tile casts the pill's
  // shadow; a page card and a panel the tall one. Clipping is the card's call.
  var PLATE_SHADOW = { tile: 'glass-shadow-pill', card: 'glass-shadow-tall', panel: 'glass-shadow-tall' };
  // A BLOCK'S OWN BOX (2026-10-24, Home Grid's Hide Box): a card's or a
  // panel's plate reads --hk-block-* first, which a boxless grid cell sets
  // (clear, no edge, no shadow, no frost: --hk-block-glass 0 takes it out of
  // the shared blur). A tile's plate never does, so the pills and controls
  // inside a boxless block keep theirs.
  function plate(kind) {
    var sh = PLATE_SHADOW[kind];
    if (!sh) throw new Error('hkCards.plate: no plate ' + kind);
    if (kind === 'tile') {
      return 'border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border +
        ';box-shadow:var(--hk-look-shadow, ' + v(sh) + ')';
    }
    // (--hk-block-radius: a square cell's corners, hk-home-grid-view -- one
    // radius, or four where a Square screen's corner rounds one of them)
    return 'border-radius:var(--hk-block-radius, ' + M.radius + ');background:var(--hk-block-plate, ' + M.bg + ');--hk-glass-surface:var(--hk-block-glass, 1);' +
      'backdrop-filter:var(--hk-block-backdrop, var(--hk-glass-backdrop,none));-webkit-backdrop-filter:var(--hk-block-backdrop, var(--hk-glass-backdrop,none))' +
      ';border:var(--hk-block-edge, ' + M.border + ');box-shadow:var(--hk-block-shadow, var(--hk-look-shadow, ' + v(sh) + '))';
  }
  // A CENTRED TILE'S CSS (TILE.centred) over a tile's own parts, named by
  // `s`: { host (the variant's :host), plate, lit (the plate lit), well,
  // icon, name, sub (the second lines: a list) }. The tall cell's numbers,
  // then the square cell's where the block's cell (hk-cell) is square. The
  // tile's own rules for its layouts (a tall scene's two-line name, an
  // inline well) are more specific than a variant can be, so the variant's
  // say !important.
  function centredTile(s) {
    var C0 = TILE.centred, I = ' !important', off = s.plate + ':not(' + s.lit.slice(s.plate.length) + ')';
    var at = function (pre, parts) { return parts.map(function (p) { return s.host + ' ' + (pre ? pre + ' ' : '') + p; }).join(','); };
    var one = function (g) {
      return at('', [s.well]) + '{width:' + g.box + 'px' + I + ';height:' + g.box + 'px' + I + ';top:' + g.at + '%' + I + '}' +
        at('', [s.icon]) + '{width:' + g.glyph + 'px' + I + ';height:' + g.glyph + 'px' + I + '}' +
        at(s.lit, [s.well]) + '{width:' + g.well + 'px' + I + ';height:' + g.well + 'px' + I + '}' +
        at(s.lit, [s.icon]) + '{width:' + g.lit + 'px' + I + ';height:' + g.lit + 'px' + I + '}' +
        at('', [s.name]) + '{top:' + g.text + '%' + I + ';font-size:' + g.name + 'px' + I + ';line-height:' + g.line + 'px' + I + '}' +
        at('', s.sub) + '{top:calc(' + g.text + '% + ' + g.line + 'px)' + I + ';font-size:' + g.sub + 'px' + I + ';line-height:' + g.line + 'px' + I + '}';
    };
    var text = 'position:absolute' + I + ';left:' + C0.inset + 'px' + I + ';right:' + C0.inset + 'px' + I + ';margin:0' + I + ';width:auto' + I +
      ';display:block' + I + ';text-align:center' + I + ';white-space:nowrap' + I + ';overflow:hidden;text-overflow:ellipsis;letter-spacing:' + C0.track + 'px' + I;
    return at('', [s.plate]) + '{position:relative}' +
      at('', [s.well]) + '{position:absolute' + I + ';left:50%' + I + ';margin:0' + I + ';transform:translate(-50%,-50%);border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center}' +
      // off: the glyph bare, in its own colour; lit: in its circle on the white plate (HK's rule)
      at(off, [s.well]) + '{background:none' + I + '}' +
      at('', [s.name]) + '{' + text + ';font-weight:600' + I + '}' +
      at('', s.sub) + '{' + text + ';font-weight:400' + I + ';color:' + v('ink-2') + I + '}' +
      at(s.lit, s.sub) + '{color:' + v('ink-on-state') + I + '}' +
      one(C0.tall) + '@container hk-cell (min-height:180px){' + one(C0.square) + '}';
  }
  // ONE TITLE ROW (the Energy page's): the name left, the detail right, one
  // baseline, 20 px tall. `sel` is the row (default .ttl); its <b> is the
  // name, its <span> the detail.
  function titleRow(sel) {
    sel = sel || '.ttl';
    return sel + '{display:flex;justify-content:space-between;align-items:baseline;gap:10px;min-height:20px;line-height:20px;flex:none}' +
      sel + ' b{font-size:15px;font-weight:600;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      sel + ' span{font-size:13px;font-weight:500;color:' + v('ink-2') + ';white-space:nowrap}';
  }
  function typeOf(role, fallback) {
    var t = TYPE[role || fallback];
    if (!t) throw new Error('hkCards: no type role ' + role);
    return t;
  }
  // A LABEL (13 / 600 / 0.3 uppercase, secondary ink; `label-small` 11 /
  // 0.4): declarations, no braces.
  function labelCss(role) {
    var t = typeOf(role, 'label');
    return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '') +
      (t.upper ? ';text-transform:uppercase' : '') + ';color:' + v('ink-2');
  }
  // THE PAGE CARD (the Energy page's, and the page headers'): the plate and
  // padding at a fixed height (--hk-ep-h), the one title row (.ttl), and the
  // shared pieces -- .wait, .num, the figure (.big, its unit in <u>), the
  // caption (.cap) and the label (.k, its dot <i>). `cls` is the hk-plate's
  // class. Defined below figureCss (it uses it), hoisted.
  function pageCardCss(cls) {
    return [
      'hk-plate.' + cls + '{box-sizing:border-box;display:flex;flex-direction:column;height:var(--hk-ep-h,320px);',
      '  padding:' + CARD.pad + ';margin:0;' + plate('card') + ';overflow:hidden;',
      '  color:' + v('ink') + ';container-type:inline-size;',
      '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      // in a Sections view: the cell's own height
      ':host([data-hk-cell]) hk-plate.' + cls + '{height:100%}',
      // ONE TITLE ROW for every card: the name left, the detail right, one baseline
      titleRow('.ttl'),
      '.wait{margin:auto;font-size:14px;color:' + v('ink-3') + '}',
      '.num{font-variant-numeric:tabular-nums}',
      '.big{' + figureCss('figure') + ';white-space:nowrap}',
      '.big u{text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0;margin-left:3px;color:' + v('ink-2') + '}',
      '.cap{font-size:14px;line-height:18px;color:' + v('ink-2') + '}',
      '.k{display:flex;align-items:center;gap:7px;' + labelCss('label') + ';white-space:nowrap}',
      '.k i{width:10px;height:10px;border-radius:50%;flex:none}'
    ].join('');
  }
  // A FIGURE (30 / 700 / -0.6, a tight line): declarations, no braces.
  function figureCss(role) {
    var t = typeOf(role, 'figure');
    return 'font-size:' + t.size + 'px;font-weight:' + t.weight + ';line-height:1.05' +
      (t.track ? ';letter-spacing:' + t.track : '');
  }

  // ANY TYPE ROLE, as declarations, no braces: its size, weight and
  // tracking (the Home Grid's cards set their text by role, docs/phase11/HOME-GRID.md)
  function typeCss(role) {
    var t = typeOf(role);
    return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '') +
      (t.upper ? ';text-transform:uppercase' : '');
  }

  // -------------------------------------------------------------- material
  // One string, shared by every card below. var() with a literal fallback:
  // the theme supplies these on any HK Kiosk view, and the fallback keeps
  // a card honest anywhere else.
  var M = {
    // --hk-glass-plate is the look (hk-settings.js: clear / frosted / blur /
    // tinted); unset, the theme's plate, then the literal. --hk-plate-here
    // comes first: a dark sheet sets it to the look's plate for a card IN a
    // sheet (--hk-glass-plate-sheet: Tinted's dark plate on a dark sheet is a
    // hole); unset in every other look, so it falls through to today's.
    bg:      'var(--hk-plate-here, var(--hk-glass-plate, var(--hk-glass-bg, linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.056)))))',
    border:  'var(--hk-look-edge, ' + v('glass-border') + ')',
    shSm:    'var(--hk-look-shadow, ' + v('glass-shadow-sm') + ')',
    radius:  '' + v('glass-radius') + '',
    well:    'var(--hk-look-well, ' + v('well-bg') + ')'
  };
  // A GLASS SURFACE: the material, plus the marker hk-glass.js looks for to
  // cut the shared blur layer to this shape (look.glass = blur). Use it as a
  // whole declaration: `'.x{' + M.glass + ';...}'`. Every surface that is
  // glass should use it, and then joins the look with no other work.
  //
  // ...and its own blur, for the one look that has one: "Blur each card"
  // (look.glass = blur_each) sets --hk-glass-backdrop, and every
  // plate blurs what is behind it -- the way the status chips always have.
  // Unset (every other look), `none`: no layer, no cost. A card configured
  // `glass: false` sets it to none on its host (glassJoin), so a detail
  // sheet's panels, which sit on the sheet's own blur, never add another.
  M.glass = 'background:' + M.bg + ';--hk-glass-surface:1;' +
    'backdrop-filter:var(--hk-glass-backdrop,none);-webkit-backdrop-filter:var(--hk-glass-backdrop,none)';

  // A group's outer plate only. These properties never tint or fade its pills.
  function groupSurface(el, surface) {
    if (!el || !el.style || !surface && !el._hkGroupBase) return;
    var key = JSON.stringify(surface || null);
    if (key !== el._hkGroupSurfaceKey) {
      el._hkGroupSurfaceKey = key;
      var root = el.getRootNode(), owner = root.host || el.parentElement;
      if (window.hkGlass && owner) window.hkGlass.changed(owner, true);
    }
    var keys = ['background', 'backdrop-filter', '-webkit-backdrop-filter', '--hk-glass-surface'];
    var base = el._hkGroupBase;
    if (!base) { base = el._hkGroupBase = {}; keys.forEach(function (k) { base[k] = [el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]; }); }
    keys.forEach(function (k) { if (base[k][0]) el.style.setProperty(k, base[k][0], base[k][1]); else el.style.removeProperty(k); });
    el.removeAttribute('data-group-custom');
    if (!surface || !/^#[0-9a-f]{6}$/i.test(surface.color || '')) return;
    var hex = surface.color.slice(1), rgb = [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
    var opacity = Math.max(0, Math.min(100, Number(surface.opacity)));
    if (!Number.isFinite(opacity)) return;
    el.style.setProperty('background', 'rgba(' + rgb.join(',') + ',' + opacity / 100 + ')', 'important');
    el.setAttribute('data-group-custom', '');
    if (surface.blur && surface.blur !== 'screen') {
      var blur = surface.blur === 'none' ? 'none' : BLUR[surface.blur];
      if (!blur) return;
      el.style.setProperty('--hk-glass-surface', '0');
      el.style.setProperty('backdrop-filter', blur, 'important');
      el.style.setProperty('-webkit-backdrop-filter', blur, 'important');
    }
  }

  // ------------------------------------------------------ ON A LIGHT PAGE
  // Someone else's dashboard (place() below), Home Assistant in light mode,
  // and no HK sky behind the cards: the Home app's light look -- gray glass,
  // the theme's own text colors, white when on. Set as custom properties ON
  // THE CARD, so they reach every shadow root under it (an HK card nested in
  // another gets them too) and every literal they replace stays the fallback:
  //   var(--hk-ink, rgba(255,255,255,0.94))
  // is today's white wherever the tone is not set -- HK's own screens, a dark
  // theme, the sky, an overlay. Checked on every new client by tone() (a theme
  // switched to dark arrives as one): a property read, and nothing written
  // unless it changed. T above is the dark side of the same names.
  var LIGHT = {
    '--hk-glass-plate': 'rgba(118, 118, 128, 0.12)',
    '--hk-glass-bg': 'rgba(118, 118, 128, 0.12)',
    '--hk-glass-border': '1px solid rgba(0, 0, 0, 0.04)',
    '--hk-glass-shadow-sm': '0 1px 1px rgba(0, 0, 0, 0.03)',
    '--hk-glass-shadow-lg': '0 1px 2px rgba(0, 0, 0, 0.04)',
    '--hk-glass-shadow-pill': '0 1px 1px rgba(0, 0, 0, 0.03)',
    '--hk-glass-shadow-tall': '0 1px 1px rgba(0, 0, 0, 0.03)',
    '--hk-glass-shadow-scene': '0 1px 1px rgba(0, 0, 0, 0.03)',
    '--hk-glass-shadow-chip': '0 1px 1px rgba(0, 0, 0, 0.03)',
    '--hk-glass-backdrop': 'none',
    '--hk-well-bg': 'rgba(118, 118, 128, 0.16)',
    // text: the theme's own, so a custom light theme is followed too
    '--hk-ink': 'var(--primary-text-color, #1c1c1e)',
    '--hk-ink-2': 'var(--secondary-text-color, rgba(60, 60, 67, 0.62))',
    '--hk-ink-3': 'rgba(60, 60, 67, 0.42)',
    // a glyph with no color of its own, off
    '--hk-glyph': 'rgba(60, 60, 67, 0.78)',
    // a key or chip ON a plate (a tint, not a plate of its own), and selected
    '--hk-key': 'rgba(118, 118, 128, 0.14)',
    '--hk-key-strong': 'rgba(118, 118, 128, 0.24)',
    // a hairline, and a track
    '--hk-line': 'rgba(60, 60, 67, 0.16)',
    '--hk-line-strong': 'rgba(60, 60, 67, 0.24)',
    // NOT TEXT, so not on the text scale: a mark (a dial's off band, a chart
    // notch, a selection ring, a chevron) and a progress fill with no accent.
    // Each keeps its own dark value; on a light page, these.
    '--hk-mark': 'rgba(60, 60, 67, 0.5)',
    '--hk-track-fill': 'var(--secondary-text-color, rgba(60, 60, 67, 0.62))',
    // the drop shadows text carries over a photo or the sky
    '--hk-glow': 'none',
    // a warning and a failure, as text: the light-mode system orange and red
    // (the dark ones are too pale on a light page)
    '--hk-warn': '#c93400',
    '--hk-fail': '#d70015',
    // what is on: the white plate lifts off the page
    '--hk-on-shadow': '0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 18px rgba(0, 0, 0, 0.09)',
    // the look's own (Tinted, hk-settings.js), set on <html>: not here --
    // the light page's border, shadows and well above stand instead
    '--hk-look-edge': 'initial',
    '--hk-look-edge-color': 'initial',
    '--hk-look-shadow': 'initial',
    '--hk-look-well': 'initial',
    '--hk-look-dash': 'initial'
  };
  var LIGHT_KEYS = Object.keys(LIGHT);

  // Flat is the same material system, opaque and with a small contact shadow.
  // Applied to owned roots so HA view themes cannot replace its chosen tone.
  function flatTokens(light) {
    var plate = light ? '#FAF9F6' : '#2B2C30', key = light ? '#ECEAE5' : '#3A3B40';
    var elevated = light ? '#FFFFFF' : '#35363C';
    var shadow = light ? '0 2px 3px rgba(28,26,22,.12)' : '0 1px 2px rgba(0,0,0,.24)';
    var t = {
      '--hk-glass-plate': plate, '--hk-glass-bg': plate, '--hk-chip-plate': plate,
      '--hk-glass-plate-sheet': key, '--hk-plate-here': plate,
      '--hk-glass-backdrop': 'none', '--hk-chip-backdrop': 'none', '--hk-float-backdrop': 'none',
      '--hk-look-edge': '1px solid transparent', '--hk-look-edge-color': 'transparent',
      // a well a shade deeper than an off tile's stone on Light (it
      // vanished into --hk-tile-off), Dark's slate as the keys
      '--hk-look-shadow': shadow, '--hk-on-shadow': shadow, '--hk-look-well': key, '--hk-well-bg': key,
      '--hk-overlay': elevated, '--hk-overlay-solid': elevated, '--hk-float-plate': elevated,
      '--hk-flat-elevated': elevated, '--hk-flat-menu': light ? '#FAF9F6' : elevated,   // Light: the cards' ivory (the user's pick, 2026-10-16)
      // scenes wear the off tiles' tone (the user, 2026-10-17)
      '--hk-flat-scene': light ? '#F3F1EC' : '#323338',
      '--hk-flat-ground': light ? '#EEECE6' : '#17181A',
      '--hk-flat-elevated-shadow': light ? '0 5px 12px -3px rgba(28,26,22,.22)' : shadow,
      '--hk-ink': light ? '#252528' : '#F5F4F0',
      '--hk-ink-2': light ? '#626267' : '#C3C3C6',
      '--hk-ink-3': light ? '#626267' : '#A3A4A9',
      '--hk-glyph': light ? '#626267' : '#F5F4F0', '--hk-glow': 'none',
      '--hk-key': key, '--hk-key-strong': light ? '#D8D5CD' : '#48494F',
      '--hk-line': light ? '#D8D5CD' : '#48494F', '--hk-line-strong': light ? '#B9B6B0' : '#62636A',
      '--hk-mark': light ? '#77777C' : '#A3A4A9', '--hk-track-fill': light ? '#626267' : '#C3C3C6', '--hk-flat-chart-line': light ? '#626267' : '#C3C3C6',
      '--hk-battery-fill': '#30d158', '--hk-battery-fill-low': '#ff453a',
      '--hk-warn': light ? '#A25D00' : '#FFB340', '--hk-fail': light ? '#C42323' : '#FF6961',
      // the weather glyphs' white and cyan layers (hk-header.js WX_COLOUR)
      '--hk-wx-w': light ? '#A6A6AB' : '#FFFFFF', '--hk-wx-c': light ? '#1C9BD6' : '#64D2FF',
      // the segmented control (segCss): a track darker than the plate, the
      // choice white over it; the battery's shell and Limit mark, the house
      // bar's not-backed-up share (hk-energy.js) -- white on Light vanished
      '--hk-seg-track': key, '--hk-seg-on': '#FFFFFF', '--hk-seg-bw': '0px',
      '--hk-pill-bg': key,
      // a field or a control on the page itself (Music's search and Plays
      // on): the cards' surface and contact shadow, not a key's gray
      '--hk-field-bg': plate, '--hk-field-shadow': shadow,
      // the shadow under a sheet's header over what scrolls (hk-detail):
      // softer on Light's white sheet, where 30 % black read as a smudge
      '--hk-shade-a': light ? 'rgba(28,26,22,.12)' : 'rgba(0,0,0,.30)', '--hk-shade-b': light ? 'rgba(28,26,22,.04)' : 'rgba(0,0,0,.10)',
      // an off tile: stone a shade under the page on Light, so a lit (white)
      // one stands out as in the Home app; Dark's graphite does already
      '--hk-tile-off': light ? '#F3F1EC' : plate,
      // A SHEET'S SETTINGS PANE (hk-detail.js .acc; HK Settings sets the
      // same --acc-* set for its own): white at 8 % on Light's white sheet
      // was nothing at all -- groups, switches, the size choice, the icon
      // search (2026-10-17). Dark keeps the pane's own values.
      '--acc-cell': light ? key : 'rgba(255,255,255,0.08)', '--acc-sep': light ? '#D8D5CD' : 'rgba(255,255,255,0.09)',
      '--acc-seg': light ? key : 'rgba(255,255,255,0.08)', '--acc-seg-on': light ? '#FFFFFF' : 'rgba(255,255,255,0.24)',
      '--acc-glyph': light ? key : 'rgba(255,255,255,0.12)', '--acc-fill': light ? '#D8D5CD' : 'rgba(255,255,255,0.18)',
      '--acc-glyph-on-bg': light ? '#252528' : 'rgba(255,255,255,0.92)', '--acc-glyph-on-fg': light ? '#FFFFFF' : '#000',
      '--acc-text': light ? '#252528' : '#fff', '--acc-label2': light ? '#626267' : '#C3C3C6',
      '--acc-red': light ? '#C42323' : '#ff453a', '--acc-orange': light ? '#A25D00' : '#ff9f0a', '--acc-green': light ? '#248A3D' : '#34c759',
      '--hk-seg-on-shadow': light ? '0 1px 3px rgba(28,26,22,.18)' : 'none',
      // ...and one on the page itself (segCss raised): the cards' surface,
      // its choice a stone well on Light (white on Dark, where it reads)
      '--hk-seg-raised-track': plate, '--hk-seg-raised-on': light ? key : '#FFFFFF', '--hk-seg-raised-on-shadow': 'none',
      '--hk-battery-shell': light ? '#B9B6B0' : 'rgba(255,255,255,.42)', '--hk-battery-mark': light ? '#77777C' : 'rgba(255,255,255,.85)',
      '--hk-not-backed': light ? '#C9C6BF' : 'rgba(255,255,255,0.55)'
    };
    ['sm','lg','pill','tall','scene','chip'].forEach(function (k) { t['--hk-glass-shadow-' + k] = shadow; });
    return t;
  }
  var FLAT = { light: flatTokens(true), dark: flatTokens(false) };
  var FLAT_GROUNDS = {
    home: ['#EEECE6','#17181A'], climate: ['#EAF0ED','#151C1B'], lights: ['#F1ECE3','#1D1A16'],
    security: ['#E9EDF0','#171B20'], calendar: ['#EEEBF1','#1C1821'], weather: ['#E8EEF2','#151C23']
  };
  // doors & windows is Security's family
  FLAT_GROUNDS.doors_windows = FLAT_GROUNDS.security;
  function flatGround(page, theme) { return (FLAT_GROUNDS[page] || FLAT_GROUNDS.home)[theme === 'light' ? 0 : 1]; }
  // FLAT'S COLORS (Sky / Background while Flat is on): settings.py
  // FLAT_COLORS, which tests/py/test_flat.py holds this to -- a Light and a
  // Dark tone each. 'auto' is the page's own ground (flatGround).
  var FLAT_COLORS = [
    { id: 'stone', label: 'Stone', light: '#EEECE6', dark: '#17181A' },
    { id: 'paper', label: 'Paper', light: '#F7F6F2', dark: '#232427' },
    { id: 'sand', label: 'Sand', light: '#F1ECE3', dark: '#1D1A16' },
    { id: 'sage', label: 'Sage', light: '#EAF0ED', dark: '#151C1B' },
    { id: 'mist', label: 'Mist', light: '#E9EDF0', dark: '#171B20' },
    { id: 'sky', label: 'Sky', light: '#E6EEF5', dark: '#141C26' },
    { id: 'lavender', label: 'Lavender', light: '#EEEBF1', dark: '#1C1821' },
    { id: 'blush', label: 'Blush', light: '#F4EAE7', dark: '#211718' },
    { id: 'black', label: 'Black', light_label: 'Pebble', light: '#E2E1DC', dark: '#000000' }
  ];
  // a Flat color as drawn: 'auto' the page's ground, an id its theme's tone,
  // '#rrggbb' itself
  function flatColorHex(id, theme, page) {
    if (/^#[0-9a-f]{6}$/i.test(id || '')) return id;
    for (var i = 0; i < FLAT_COLORS.length; i++) if (FLAT_COLORS[i].id === id) return FLAT_COLORS[i][theme === 'light' ? 'light' : 'dark'];
    return pageTone(page, theme) || flatGround(page, theme);
  }
  // A PAGE'S AUTOMATIC GROUND FROM ITS ACCENT (2026-10-17, the user): the
  // page's Accent Color (HK Settings -> the page -> Look) a tenth of the
  // way into Light's paper, an eighth into Dark's near-black -- a red page
  // blush or deep wine, a blue one pale sky or navy. Home and the rooms,
  // which have no accent, keep the theme's stone. null: no accent.
  function pageTone(page, theme) {
    var hex = pageAccentHex(page);
    if (!hex) return null;
    var c = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
    var light = theme === 'light', base = light ? [244, 242, 238] : [20, 21, 23], f = light ? 0.10 : 0.13;
    return '#' + c.map(function (v, i) { var x = Math.round(v * f + base[i] * (1 - f)); return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  // a page kind's accent as a hex: its own (look.page_accents), else
  // PAGE_ACCENTS' default; null for a page that has none (home, rooms)
  function pageAccentHex(kind) {
    if (!kind || !PAGE_ACCENTS[kind]) return null;
    var S = window.hkSettings, own = S && S.get ? (S.get('look.page_accents', {}) || {})[kind] : null;
    var a = String(own || PAGE_ACCENTS[kind]).toLowerCase();
    return ACCENTS[a] || (/^#[0-9a-f]{6}$/.test(a) ? a : null);
  }
  // the photo's fade: the theme's own ground over it, `fade` 0..100
  function flatFade(fade, theme) {
    var f = Math.max(0, Math.min(100, fade == null ? 50 : +fade || 0)) / 100;
    return theme === 'light' ? 'rgba(238,236,230,' + (f * 0.92).toFixed(3) + ')' : 'rgba(10,11,12,' + (f * 0.9).toFixed(3) + ')';
  }
  // the accent a photo's Tint matches: Flat's chosen accent, else the
  // page's own highlight
  function flatAccentHex() { var p = flatPalette(); return (p && p.seed) || legacyAccentHex(); }

  // Shared by owned shadow roots and light-DOM overlays. No DOM traversal.
  // `keepMotion`: a card whose motion is its content -- the charts drawing
  // in, the water supply's waves, the power flows (a class's FLAT_MOTION).
  // They cost little and the user wants them (2026-10-16); Flat still takes
  // their blur and filters.
  function flatCss(prefix, keepMotion) {
    var p = prefix || ':host([hk-flat])';
    return p + ',' + p + ' *,' + p + ' *::before,' + p + ' *::after{' +
      (keepMotion ? '' : 'animation:none!important;transition:none!important;') + 'backdrop-filter:none!important;' +
      '-webkit-backdrop-filter:none!important;' + (keepMotion ? '' : 'filter:none!important;') + 'text-shadow:none!important;' +
      'scroll-behavior:auto!important;' + (keepMotion ? '' : 'will-change:auto!important') + '}' +
      (keepMotion ? '' : p + ' :active{transform:none!important}') +
      // (a scene lit -- running, or its request in flight -- is white, as a
      // tapped one is: feedback, never a state it keeps)
      p + ' .scene:not(.hk-tapped):not([data-on="1"]){background:var(--hk-flat-scene)!important}' +
      p + ' .scene:not(.tinted) .icon{color:var(--hk-ink)!important;fill:var(--hk-ink)!important}' +
      // white on a COLORED well only: a well left clear (the alarm's, its
      // glyph in its own color on the white tile) keeps its glyph's color
      // (Safari writes a clear well as `background: none`, Chrome as
      // `transparent`: both, or Safari painted the playing HomePod white)
      p + ' .card[data-on="1"] .well:not([style*="transparent"]):not([style*="background: none"]) .icon{color:white!important;fill:white!important}' +
      // FLAT COLORS (2026-10-17): a lit pill is pure white; an OFF one wears
      // its source's wash (hk-tile.js, flatIdle: --hk-idle-pill, its glyph
      // --hk-idle-glyph), so on and off read apart by color, not shade
      p + ' hk-plate.card[data-hk-idle]:not([data-on="1"]):not(.hk-tapped){background:var(--hk-idle-pill)!important}' +
      p + ' hk-plate.card.scene[data-hk-idle]:not([data-on="1"]):not(.hk-tapped) .icon{color:var(--hk-idle-glyph)!important;fill:var(--hk-idle-glyph)!important}' +
      p + ' .scene .well::after{display:none!important}' +
      (keepMotion ? '' : p + ' .anim,' + p + ' .anim>*{opacity:1;clip-path:none;transform:none}') +
      p + ' .vs{background:var(--hk-key)!important}' +
      p + ' .btn:not(.sel),'+p+' .bk button{background:var(--hk-key);color:var(--hk-ink)}' +
      p + ' .btn.menu .cur{color:var(--hk-ink-2)}' +
      p + ' .vs .gl:not(.dark){color:var(--hk-ink-2)}' +
      p + ' .prog-fill{animation:none!important}' +
      // (not an element focused by script -- a sheet takes focus as it
      // opens, tabindex -1, and Safari ringed the whole sheet in blue)
      p + ' :focus-visible:not([tabindex="-1"]){outline:2px solid var(--hk-accent,#0a84ff);outline-offset:3px}' +
      p + ' [tabindex="-1"]:focus{outline:none}';
  }
  // Contrast-adjust semantic colors, never infer roles from computed DOM.
  // A color is resolved once per role/theme and cached; no canvas sampling.
  var flatColors = {};
  // ON, BRIGHT (the user, 2026-10-17: muted while off, bright when on):
  // Apple's light-appearance system colors for the dark ones HK draws with
  // -- made for a pale ground, so a lit well or glyph keeps its color
  // instead of being darkened toward brown
  var APPLE_LIGHT = { '255,214,10': '#FFCC00', '255,204,0': '#FFCC00', '255,159,10': '#FF9500', '48,209,88': '#34C759',
    '100,210,255': '#32ADE6', '10,132,255': '#007AFF', '64,200,224': '#30B0C7', '99,230,226': '#00C7BE',
    '191,90,242': '#AF52DE', '255,69,58': '#FF3B30', '255,55,95': '#FF2D55', '94,92,230': '#5856D6' };
  function flatColor(color, role) {
    var S = window.hkSettings, a = S && S.rendering ? S.rendering() : {};
    // (Dark keeps every color as the other looks draw it -- a lit well was
    // darkened toward brown there too, 2026-10-17)
    if (!a.flat || a.theme !== 'light') return color;
    var key = color + '|' + role, hit = flatColors[key]; if (hit) return hit;
    var hex = /^#([0-9a-f]{6})$/i.exec(color), rgb = /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(color);
    var c = hex ? [0,2,4].map(function (i) { return parseInt(hex[1].slice(i,i+2),16); }) : rgb ? rgb.slice(1,4).map(Number) : null;
    if (!c) return color;
    // a lit well or a lit bare glyph on Light: the Apple color, else its own
    if ((role === 'well' || role === 'on') && a.theme === 'light') {
      var bright = APPLE_LIGHT[c.join(',')];
      if (bright || role === 'on') return flatColors[key] = bright || color;
    }
    function lum(v) { return v.map(function (x) { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055,2.4); }).reduce(function (n,x,i) { return n + x * [.2126,.7152,.0722][i]; },0); }
    var ground = FLAT.light['--hk-key'];
    var bg = role === 'well' ? 1 : lum([1,3,5].map(function (i) { return parseInt(ground.substr(i,2),16); })), target = role === 'text' ? 4.5 : 3;
    while ((Math.max(bg,lum(c))+.05)/(Math.min(bg,lum(c))+.05) < target && Math.max.apply(null,c) > 0) c = c.map(function (x) { return Math.floor(x*.96); });
    return flatColors[key] = 'rgb(' + c.join(',') + ')';
  }
  // FLAT COLORS' PALETTE (2026-10-17, PLAN-2026-10-17-flat-appearance-colors.md):
  // the page's resolved Accent Color and Off Pill Tint (hkSettings.flatColors)
  // turned into colors. Accent Color's presets, muted on purpose: a seed for a
  // pale or deep ground, the page's highlight and a matched tint.
  // hk-settings-model.js FLAT_ACCENTS is the same list (tests/test_flat.js).
  var FLAT_ACCENTS = [['amber', 'Amber', '#e09649'], ['sage', 'Sage', '#7e9b83'], ['harbor', 'Harbor', '#5c91bc'],
                      ['lavender', 'Lavender', '#9374bc'], ['rose', 'Rose', '#c17d91'], ['slate', 'Slate', '#64798e'],
                      ['teal', 'Teal', '#599b9c'], ['clay', 'Clay', '#ad8972']];
  // THE ROLES, each a blend of the source into the theme's own surface:
  //   ground  an Automatic background (as pageTone): 10 % into #F4F2EE / 13 % into #141517
  //   pill    an off pill or scene: 8 % into white / 20 % into graphite
  //   well    an off pill's circle: 22 % / 36 %
  // An off glyph is its source taken to 3:1 against what it sits on. A
  // white source (Apple TV, HomePod, a white light) is NEUTRAL first.
  var FLAT_MIX = { light: { ground: ['#F4F2EE', 0.10], pill: ['#FFFFFF', 0.08], well: ['#FFFFFF', 0.22] },
                   dark: { ground: ['#141517', 0.13], pill: ['#2B2C30', 0.20], well: ['#2B2C30', 0.36] } };
  var FLAT_NEUTRAL = '#8E8E93';
  function rgbOf(color) {
    var x = String(color || '').trim(), h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(x);
    if (h) {
      var d = h[1].length === 3 ? h[1].replace(/./g, '$&$&') : h[1];
      return [0, 2, 4].map(function (i) { return parseInt(d.slice(i, i + 2), 16); });
    }
    var m = /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i.exec(x);
    return m ? m.slice(1, 4).map(function (n) { return Math.max(0, Math.min(255, Math.round(+n))); }) : null;
  }
  function hexOfRgb(c) { return '#' + c.map(function (n) { n = Math.round(n); return (n < 16 ? '0' : '') + n.toString(16); }).join(''); }
  // `a` `t` of the way into `b`
  function blend(a, b, t) {
    var x = rgbOf(a), y = rgbOf(b);
    return hexOfRgb(x.map(function (n, i) { return n * t + y[i] * (1 - t); }));
  }
  function relLum(c) {
    return c.map(function (x) { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); })
            .reduce(function (n, x, i) { return n + x * [.2126, .7152, .0722][i]; }, 0);
  }
  function contrast(a, b) { var x = relLum(rgbOf(a)), y = relLum(rgbOf(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  // `color` taken toward black (on a pale ground) or white (a dark one)
  // until it reads at `target` against `ground`
  function readable(color, ground, target) {
    var c = color, toward = relLum(rgbOf(ground)) > .4 ? '#000000' : '#FFFFFF';
    for (var n = 0; n < 40 && contrast(c, ground) < (target || 3); n++) c = blend(c, toward, .92);
    return c;
  }
  // an accent as stored -> a hex: an ACCENTS name, a FLAT_ACCENTS id, '#rrggbb'
  function seedHex(v) {
    var a = String(v || '').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(a)) return a;
    if (ACCENTS[a]) return ACCENTS[a];
    for (var i = 0; i < FLAT_ACCENTS.length; i++) if (FLAT_ACCENTS[i][0] === a) return FLAT_ACCENTS[i][2];
    return null;
  }
  function flatRole(src, theme, role) {
    var m = FLAT_MIX[theme === 'light' ? 'light' : 'dark'][role];
    return blend(src, m[0], m[1]);
  }
  // THE PALETTE HERE: null outside Flat. seed -- the coordinated Accent
  // (null: Automatic); tint -- one hex every off pill takes (null: each
  // its own); tinted -- whether off pills are washed at all: always on
  // Light (the Flat White baseline), on Dark only for a tint chosen (Dark's
  // Automatic keeps its own surfaces, v1). `ctx`: hkSettings.flatColors'.
  var palMemo = { key: null, val: null };
  function flatPalette(ctx) {
    var S = window.hkSettings, a = S && S.rendering ? S.rendering() : {};
    if (!a.flat || !S.flatColors) return null;
    var r = S.flatColors(ctx), theme = a.theme === 'light' ? 'light' : 'dark';
    // a page keeping its own color (Flat Colors -> Pages): seeded by it,
    // whatever the Highlight Color says -- Climate blue on any screen
    var seed = r.accent.scope === 'own-page' ? pageAccentHex(r.accent.page)
             : r.accent.value === 'auto' ? null : seedHex(r.accent.value);
    var tv = r.off_tint.value, tint = null;
    // Match Accent with no accent of its own: the page's highlight as it is
    if (tv === 'accent') tint = seed || legacyAccentHex();
    else if (tv !== 'auto') tint = seedHex(tv);
    var key = theme + '|' + seed + '|' + tint;
    if (!ctx && palMemo.key === key) return palMemo.val;
    var pal = { theme: theme, seed: seed, tint: tint, tinted: theme === 'light' || !!tint, key: key, from: r,
                ground: seed ? flatRole(seed, theme, 'ground') : null };
    if (!ctx) { palMemo.key = key; palMemo.val = pal; }
    return pal;
  }
  // AN OFF PILL'S COLORS: `own` the accessory's color (its icon color, its
  // calm off color, a scene's chosen one; null: none of its own), `bare`
  // a glyph with no circle (a scene, Apple TV, HomePod, the alarm).
  // -> {pill, well (null when bare), glyph}. Cached by palette and source.
  var idleMemo = {};
  function flatIdle(own, bare, pal) {
    pal = pal || flatPalette();
    if (!pal) return null;
    var k = pal.key + '|' + own + '|' + (bare ? 1 : 0), hit = idleMemo[k];
    if (hit) return hit;
    var src = pal.tint;
    if (!src) {
      // Light's own colors as lit Light draws them (flatColor's Apple
      // light colors), white made neutral: the same rule for every kind
      var c = rgbOf(own);
      src = !c || Math.min.apply(null, c) > 230 ? FLAT_NEUTRAL
          : hexOfRgb(pal.theme === 'light' ? rgbOf(flatColor(own, 'well')) || c : c);
    }
    var pill = flatRole(src, pal.theme, 'pill'), well = bare ? null : flatRole(src, pal.theme, 'well');
    var out = { pill: pill, well: well, glyph: readable(src, well || pill, 3) };
    if (Object.keys(idleMemo).length > 400) idleMemo = {};
    return idleMemo[k] = out;
  }
  var FLAT_ROOTS = new Set();
  function flatSurface(el, kind) {
    if (!el || !el.style || !el.setAttribute || !el.removeAttribute) return;
    el._hkFlatKind = kind || el._hkFlatKind || '';
    FLAT_ROOTS.add(el);
    flatTone(el);
  }
  function flatTone(el) {
    var S = window.hkSettings, a = S && S.rendering ? S.rendering() : { flat: false };
    var key = a.flat ? (el._hkFlatKind === 'music' ? 'dark' : a.theme) : '';
    var own = !!key && (!el._hkNested || !!el._hkFlatKind);
    if (el._hkFlatTone === key && el._hkFlatOwn === own) return;
    var wasFlat = !!el._hkFlatTone && el._hkFlatOwn;
    el._hkFlatOwn = own;
    if (key && el.getAnimations && !(el.constructor && el.constructor.FLAT_MOTION)) {
      el.getAnimations({ subtree: true }).forEach(function (a) { try { a.cancel(); } catch (e) { /* already ended */ } });
    }
    if (key && el._progAnim) { try { el._progAnim.cancel(); } catch (e) {} el._progAnim = null; }
    el._hkFlatTone = key;
    if (key) el.setAttribute('hk-flat', key); else if (el.removeAttribute) el.removeAttribute('hk-flat');
    Object.keys(FLAT.light).forEach(function (k) {
      if (own) el.style.setProperty(k, FLAT[key][k]); else if (wasFlat) el.style.removeProperty(k);
    });
  }
  function syncFlat() {
    FLAT_ROOTS.forEach(function (el) { if (el.isConnected === false) FLAT_ROOTS.delete(el); else flatTone(el); });
    ON_PAGE.forEach(function (el) { tone(el, el.client); markAsleep(el); });
  }


  // A length option as CSS: numbers are px (`pad_left: 22`), strings pass
  // through (`pad_left: 22px`); null for nothing.
  function px(v) {
    if (v == null || v === '') return null;
    return typeof v === 'number' ? v + 'px' : String(v);
  }
  // The sideways BLEED of a `margin` shorthand: how far its left and right
  // sides pull the box out (positive numbers), or null when neither side is
  // negative or a side is not a plain px length. hk-row-card and
  // hk-grid-card publish this so the phone can clamp it to the gutter.
  function bleedSides(margin) {
    if (margin == null) return null;
    var t = String(margin).trim().split(/\s+/), l, r;
    if (t.length < 1 || t.length > 4) return null;
    r = t.length === 1 ? t[0] : t[1];
    l = t.length === 4 ? t[3] : r;
    var n = function (s) { var m = /^(-?[\d.]+)(px)?$/.exec(s); return m ? parseFloat(m[1]) : NaN; };
    var L = n(l), R = n(r);
    if (isNaN(L) || isNaN(R) || (L >= 0 && R >= 0)) return null;
    return { l: Math.max(0, -L), r: Math.max(0, -R) };
  }

  // TEXT GOING INTO MARKUP: & < > " ' as entities, null and undefined as
  // nothing. Safe in text and inside a quoted attribute.
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // A <div> THAT IS A BUTTON: role, focusable, and a tap or Enter / Space
  // runs `fn`. A tap hands `fn` its click event; the keys call it with none.
  // Returns the element.
  // ------------------------------------------------- a picture's art.json
  // THE HOUSE PICTURE WITHOUT THE WAIT (2026-10-16, the user: the house
  // "takes a bit to load"): the Power and Security pictures need their
  // folder's art.json before they can name an image, which made two requests
  // in a row on every page load. The last copy is kept in this browser and
  // answered at once; the file is asked for again behind it and, when it
  // differs, answered a second time -- so the picture is in the card's first
  // paint. `fn(json)`; null on a failed first load (a later call asks again).
  var ARTJ = {};
  function artJson(base, fn) {
    var a = ARTJ[base];
    if (a && a.json) { fn(a.json); a.fns.push(fn); return; }
    if (!a) {
      a = ARTJ[base] = { fns: [], json: null };
      var key = 'hk-art:' + base, kept = null;
      try { kept = JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (e) { kept = null; }
      if (kept) a.json = kept;
      (typeof fetch === 'function' ? fetch(base + 'art.json', { cache: 'no-cache' }) : Promise.reject(new Error('no fetch')))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (t) {
          var j = JSON.parse(t), same = a.json && JSON.stringify(a.json) === JSON.stringify(j);
          try { window.localStorage.setItem(key, t); } catch (e) { /* full or private: next load asks again */ }
          if (same) return;
          a.json = j;
          a.fns.slice().forEach(function (f) { f(j); });
        }).catch(function () {
          if (a.json) return;                 // the kept copy stands
          var w = a.fns; delete ARTJ[base];
          w.forEach(function (f) { f(null); });
        });
    }
    a.fns.push(fn);
    if (a.json) fn(a.json);
  }
  // ------------------------------------------------- one chart scrubber
  // HOVER, TOUCH OR KEYS ON A CHART (2026-10-16; PLAN-2026-10-17-hover-tap-
  // calendar-editing.md A1): every bar or line chart reads out the same way.
  // A mouse over it, or a finger held and dragged on it, lights the element
  // under it (`[data-i]` gets .hit, the box .on) and says it in the card's
  // readout; the chart takes focus, the arrow keys (Home, End) step it, the
  // readout is announced; leaving, lifting, Escape or Tab put the summary
  // back. Asked again on every paint (a repaint puts the markup's attributes
  // back), it keeps one set of listeners and reads the newest options.
  //   o: { say(i) -> text, count, nowI, rest, readout() -> element, name,
  //        index(x, y, box) -> i (default: across the svg), onPick(i | null) }
  // count, nowI and rest may be functions. A tap still taps: nothing here
  // stops a click, so a chart that opens a sheet keeps doing so.
  function scrub(card, box, o) {
    if (!box) return;
    box._hkO = o;
    var val = function (x) { return typeof x === 'function' ? x() : x; };
    box.setAttribute('tabindex', '0');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', (o.name || 'Chart') + '. Arrow keys move between bars.');
    var rd0 = o.readout && o.readout();
    if (rd0) rd0.setAttribute('aria-live', 'polite');
    if (box._hkScrub) return;
    box._hkScrub = true;
    var held = null, kb = -1;
    function opt() { return box._hkO || o; }
    function n() { return Math.max(1, val(opt().count) || 24); }
    function at(x, y) {
      var O = opt();
      if (O.index) return O.index(x, y, box);
      var svg = box.querySelector('svg');
      if (!svg) return -1;
      var r = svg.getBoundingClientRect();
      if (!r.width) return -1;
      return Math.max(0, Math.min(n() - 1, Math.floor((x - r.left) / r.width * n())));
    }
    function pick(i) {
      var O = opt();
      if (i < 0) return;
      box.classList.add('on');
      box.querySelectorAll('[data-i]').forEach(function (b) { b.classList.toggle('hit', +b.getAttribute('data-i') === i); });
      var rd = O.readout && O.readout();
      if (rd) rd.textContent = O.say(i);
      if (O.onPick) O.onPick(i);
    }
    function hide() {
      var O = opt();
      box.classList.remove('on');
      box.querySelectorAll('[data-i].hit').forEach(function (b) { b.classList.remove('hit'); });
      var rd = O.readout && O.readout();
      if (rd) rd.innerHTML = val(O.rest) || '';
      if (O.onPick) O.onPick(null);
    }
    box.addEventListener('keydown', function (e) {
      var k = e.key, m = n();
      if (k === 'Escape' || k === 'Tab') { kb = -1; hide(); return; }
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      // the first arrow lands on now, else the last
      var now = val(opt().nowI);
      if (kb < 0 && (k === 'ArrowLeft' || k === 'ArrowRight')) kb = now != null ? now : m - 1;
      else kb = k === 'Home' ? 0 : k === 'End' ? m - 1 : Math.max(0, Math.min(m - 1, kb + (k === 'ArrowLeft' ? -1 : 1)));
      pick(kb);
    });
    box.addEventListener('blur', function () { kb = -1; hide(); });
    box.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || held === e.pointerId) pick(at(e.clientX, e.clientY)); });
    // A DRAG IS NOT A TAP: a finger that moved along the chart reads it, and
    // the click that follows its lift is not passed on (a chart that opens a
    // sheet on a tap would otherwise open it at the end of every scrub)
    var x0 = 0, moved = false;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      held = e.pointerId; x0 = e.clientX; moved = false;
      try { box.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
      pick(at(e.clientX, e.clientY));
    });
    box.addEventListener('pointermove', function (e) { if (held === e.pointerId && Math.abs(e.clientX - x0) > 10) moved = true; });
    box.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    ['pointerup', 'pointercancel'].forEach(function (k) {
      box.addEventListener(k, function (e) { if (e.pointerType !== 'mouse') { held = null; hide(); } });
    });
    box.addEventListener('click', function (e) {
      if (!moved) return;
      moved = false;
      e.stopPropagation(); e.preventDefault();
    }, true);
  }

  function button(el, fn) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', fn);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
    return el;
  }

  // The first letter capitalised and the rest left alone ("heat cool" ->
  // "Heat cool") -- hk-tile's `sentence` label mode. The word-by-word
  // title-casings (hk-tile's `titled`, the fan label, hk-chip's label_case,
  // hk-control's _pretty, hk-header's titleCase) are different rules.
  function sentenceCase(v) {
    var s = String(v);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ------------------------------------------------------------- palette
  // What a colour NAME in a card config means: `icon_color: orange` on a
  // tile, `color: teal` on a control, `colour: blue` on a chart. One table of
  // hues, shared by hk-tile.js, hk-control.js and hk-charts.js.
  //
  // THE DIFFERENCES ARE KEPT, BY NAME, not settled here: each family keeps
  // its own alpha and its own gray, and which is right is a visual call.
  //
  //   icon    glyphs and wells -- hk-tile's NAME_MAP, and every card that
  //           resolves a name through it. Alpha 0.98, gray 0.80, and it also
  //           knows grey, white and black.
  //   accent  hk-control's `color:` (well, slider fill, active segment).
  //           Alpha 0.96, gray 0.85; no grey / white / black, so those three
  //           still reach CSS as keywords.
  //   chart   hk-charts' fills, as the rgb triples it softens. Its gray is
  //           Apple's system gray (142, 142, 147), not the icon gray; no
  //           grey / white / black, so those fall back to orange like any
  //           unknown name.
  var HUE = {
    yellow: [255, 204, 0],   orange: [255, 159, 10], blue:   [86, 189, 228],
    green:  [48, 209, 88],   red:    [255, 69, 58],  purple: [191, 90, 242],
    pink:   [255, 55, 95],   teal:   [64, 200, 224], cyan:   [50, 173, 230],
    brown:  [172, 142, 104], mint:   [99, 230, 226]
  };
  // The alpha is a string, so '0.80' stays '0.80' in the output.
  function paint(alpha, more) {
    var out = {};
    Object.keys(HUE).forEach(function (k) {
      out[k] = 'rgba(' + HUE[k].join(', ') + ', ' + alpha + ')';
    });
    return Object.assign(out, more);
  }
  var PALETTE = {
    icon: paint('0.98', {
      gray:  'rgba(200, 200, 200, 0.80)', grey: 'rgba(200, 200, 200, 0.80)',
      white: 'rgba(255, 255, 255, 0.95)', black: 'rgba(0, 0, 0, 0.95)'
    }),
    accent: paint('0.96', { gray: 'rgba(200, 200, 200, 0.85)' }),
    chart: Object.assign({}, HUE, { gray: [142, 142, 147] })
  };

  // ARTWORK THROUGH HOME ASSISTANT. Almost every album cover
  // Music Assistant names is on Apple's CDN (is1-ssl.mzstatic.com), which a
  // wall tablet without internet cannot reach even with the hosts allowed by name -- the CDN
  // answers each lookup with different addresses. So an image on ANOTHER
  // host is not loaded from there: HK Frontend signs a path to its own
  // /api/hk_frontend/art (art.py), where HA fetches it, scales it to `size`
  // and serves it from the page's own origin -- no internet on the tablet, no
  // mixed content over https. Signing is batched: every tile painted in one
  // task goes in one websocket call. A server without the command (an older
  // HK Frontend) answers with an error, and the tile loads the URL directly.
  var ART_RESIGN_MS = 20 * 3600 * 1000;       // the server signs for 24 h
  var artSigned = new Map();                  // size + ' ' + url -> {path, at}
  var artQueues = {};                         // size -> {waiters: Map, timer}
  function artRemote(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    try { return new URL(url).host !== location.host; } catch (e) { return false; }
  }
  // A SIGNATURE DIES WITH THE HA THAT MADE IT. HA signs
  // with a secret it draws at start-up and never saves, so after a restart
  // every path kept here is a 401 -- for up to ART_RESIGN_MS, on every tile
  // the browser had not already cached -- and each 401 is a line in the ban
  // log. So the cache is forgotten two ways: the socket's `ready` (it came
  // BACK, i.e. HA restarted -- home-assistant-js-websocket fires it on every
  // reconnect) clears it all, and an <img> that errors on a signed path
  // drops its own entry and asks for ONE fresh signature (_artImage).
  //
  // STATES THE NEW SERVER HAS NOT SENT YET. The same
  // `ready` comes before the resubscribe's snapshot, and Home Assistant's
  // websocket client keeps every pre-restart state object until the new
  // server sends that entity again -- for a Protect camera ~12 s later, its
  // entity_picture carrying a token the new HA never issued. HA also rebuilds
  // every card on a reconnect, so each new camera strip would spend one
  // request per camera on a dead token (a ban-log line each) and mount its
  // live tile on a camera HA does not
  // have yet ("Camera not found"). So the objects the page holds at `ready`
  // are marked; whatever the new server sends is a NEW object, so after a
  // mere network blip (everything re-sent at once) nothing is held back.
  //
  // THROUGH THE HOST'S SUBSCRIPTION PORT (HKClient.subscriptions), never the
  // raw connection: the port's identity follows the transport, so new state
  // snapshots on the same socket do not add listeners, and a replacement
  // socket gets its own. The states marked are the current client's.
  var artConn = null, STALE = null, staleEpoch = 0;
  // A client as is; a legacy host input through the host adapter.
  function asClient(source) {
    if (!source) return null;
    if (window.hkClient && window.hkClient.is(source)) return source;
    var host = window.hkHostClient;
    return host && host.from ? host.from(source) : null;
  }
  // A replaced port's listener goes with it: its late `ready` must not mark
  // the new server's states.
  function artReady() {
    artSigned.clear();
    var c = window.hkCards.client(), s = c && c.states, set = new WeakSet();
    if (s) for (var k in s) if (s[k] && typeof s[k] === 'object') set.add(s[k]);
    STALE = set;
    staleEpoch++;
  }
  function artWatch(client) {
    var conn = client && client.subscriptions;
    if (!conn || conn === artConn) return;
    if (artConn) artConn.removeEventListener('ready', artReady);
    artConn = conn;
    conn.addEventListener('ready', artReady);
  }
  // true while `st` is a state the server that is up now has not sent
  window.hkCards.stale = function (st) { return !!(STALE && st && STALE.has(st)); };
  // 0 until the first reconnect: a card can skip the question entirely
  window.hkCards.staleEpoch = function () { return staleEpoch; };
  function artForget(url, size) { artSigned.delete(size + ' ' + url); }
  // A PICTURE ON THIS PAGE'S OWN ORIGIN (a player's artwork, which Mantel serves itself): the host may ask for it at
  // the tile's size (hkShell.artSized, 2026-10-29), so a cover of several megabytes is not downloaded to draw 150
  // px. A host with nothing to say (or one that throws) leaves the address as it is.
  function artLocal(url, size) {
    var S = window.hkShell, got = null;
    try { got = S && typeof S.artSized === 'function' ? S.artSized(url, size) : null; } catch (e) { got = null; }
    return typeof got === 'string' && got ? got : url;
  }
  function artSign(source, url, size, cb) {
    var client = asClient(source);
    artWatch(client);
    var key = size + ' ' + url, hit = artSigned.get(key);
    if (hit && Date.now() - hit.at < ART_RESIGN_MS) { cb(hit.path); return; }
    if (!client || !client.callWS) { cb(url); return; }
    var q = artQueues[size] || (artQueues[size] = { waiters: new Map(), timer: null });
    if (!q.waiters.has(url)) q.waiters.set(url, []);
    q.waiters.get(url).push(cb);
    if (q.timer) return;
    q.timer = setTimeout(function () {
      delete artQueues[size];
      var urls = Array.from(q.waiters.keys());
      if (artSigned.size > 3000) artSigned.clear();
      for (var i = 0; i < urls.length; i += 200) (function (batch) {
        Promise.resolve(client.callWS({ type: 'hk_frontend/art/sign', urls: batch, size: size }))
          .then(function (res) {
            var got = (res && res.signed) || {};
            batch.forEach(function (u) {
              if (got[u]) artSigned.set(size + ' ' + u, { path: got[u], at: Date.now() });
              q.waiters.get(u).forEach(function (f) { f(got[u] || u); });
            });
          }, function () {
            batch.forEach(function (u) { q.waiters.get(u).forEach(function (f) { f(u); }); });
          });
      })(urls.slice(i, i + 200));
    }, 0);
  }

  // HOW LONG AN ARTWORK URL GETS BEFORE THE PLACEHOLDER WINS. See _artImage.
  //
  // 6 seconds, and the number is bounded on both sides by measurement rather
  // than taste. Below it: the slowest artwork that does load on a home
  // network (measured across a whole library) answers in well under a
  // second. Above it: a wall dashboard that shows a
  // row of empty squares for longer than this reads as broken, and a
  // tablet without internet answers a public CDN with "never" -- the request
  // hangs rather than being refused -- so every millisecond past the point of
  // doubt is a millisecond of looking wrong.
  var ART_TIMEOUT = 6000;

  // The SELECTED plate is a solid white, not glass. That contrast is the whole
  // signal and it is what the Home app does -- glass-on-glass is unreadable at
  // arm's length on a wall.
  // THE SELECTABLE PILL'S LABEL (13.5 / 600, the Music speakers' and Clean
  // Areas' rooms): declarations, no braces. The utility pages' capsules --
  // quick timers, the valve's On / Off, the timer sheet's quick names --
  // read it too, so the 40 px capsules all say the same size.
  var PILL_LABEL = 'font-size:13.5px;font-weight:600;letter-spacing:-0.1px';
  var SELECTED_BG   = 'rgba(255, 255, 255, 0.96)';
  var SELECTED_TEXT = 'rgba(0, 0, 0, 0.88)';
  var IDLE_TEXT     = 'rgba(255, 255, 255, 0.86)';

  // ------------------------------------------------------- confirmation
  //
  // `tap_action: {confirmation: {text: ...}}` -- a home battery's circuit
  // switches, say, because flipping the wrong breaker from a wall tablet
  // is not an undo-able mistake.
  //
  // WHY NOT HA's OWN DIALOG. HA confirms through `showConfirmationDialog`,
  // which fires a `show-dialog` event carrying a `dialogImport` closure over
  // an internal frontend module. A custom card cannot produce that closure,
  // and if `dialog-box` happens not to be defined yet the event resolves
  // nothing and the tap silently does nothing at all -- a failure that
  // looks like success.
  //
  // WHY NOT `confirm()`. Fully Kiosk can suppress JS dialogs outright. That
  // turns a guarded switch into either a dead control or an unguarded one,
  // and which of the two you get is a per-tablet setting nothing in this
  // frontend owns.
  //
  // So the sheet is ours: one element, reused, appended to the host shell's
  // dialog root (hkShell.dialogRoot(): document.body in Home Assistant, as it
  // always was; Mantel's overlay root) so no card's `overflow:hidden` can clip it. Escape and the backdrop cancel.
  //
  // TWO CHOICES, NOT ONE (opts). A circuit switch asks a
  // yes/no question where "no" means "do nothing", and Cancel says that
  // perfectly. Play Music asks a question where BOTH answers are actions --
  // "start here and stop the other rooms" or "start here and leave them" --
  // and the common answer is the one Cancel would have been. A sheet where
  // the frequent choice is spelled "Cancel" teaches people to dismiss it.
  //
  // opts: { detail, yes, no, onNo }. With no opts this is the plain
  // Cancel/Confirm sheet.
  // Escape and the backdrop always mean "neither" -- that is the only way out
  // once both buttons commit to something.
  var _sheet = null;
  // WHERE HK'S OWN DIALOGS MOUNT (Phase 2 P2.5): the host shell's dialog root,
  // and there again when a sheet made earlier is opened after the host's root
  // changed. Nothing to mount in: left where it is.
  function dialogMount(el) {
    var sh = window.hkShell, r = (sh && sh.dialogRoot ? sh.dialogRoot() : null) || document.body;
    if (r && el.parentNode !== r) r.appendChild(el);
  }
  // ------------------------------------------------------- chooseSheet
  //
  // A LIST TO PICK ONE OF, in the same material as confirmSheet below.
  //
  // Built for a pill that stands for several choices: six decade playlists
  // behind one tile rather than six more tiles in a row that already holds
  // five.
  //
  // ITS OWN ELEMENT, not a mode of confirmSheet. They share a look and nothing
  // else -- one asks a yes/no about a sentence, this offers a list -- and
  // folding both into one function would mean every future change to either
  // reasoning about the other. The styling is duplicated deliberately and is
  // ~15 lines; a shared stylesheet for two sheets would be the harder thing to
  // follow.
  //
  // DISMISSABLE THREE WAYS, like confirmSheet: the backdrop, Escape, and a
  // Cancel row. A sheet on a wall tablet with no way out is the dead end this
  // dashboard is built to avoid.
  // THE HEADER RIDES ON THE LIST (2026-10-11). Wherever a header stays put
  // and a list scrolls under it -- the detail sheets, the screensaver's
  // calendar pane and its music panel, the tab bar's sheets, the calendar's
  // pop-ups, the choose sheet -- a soft shadow lies along the list's top edge
  // once the list has scrolled under it, and none while it is at its top
  // (nothing is under the header then). One look, from here:
  //
  //   shade(scroller, target, opts)  `hk-scrolled` on `target` while
  //       `scroller` is off its top, and --hk-shade-top: the scroller's top
  //       edge, measured from target's. `target` may be a function (a header
  //       drawn again with its content); `opts.foot`: the shadow at the
  //       target's own foot instead (a sticky header inside the scroller).
  //       Returns a function that unhooks it.
  //   shadeCss(sel)  the shadow, as `sel`'s ::after: `sel` must be
  //       positioned, and its ::after free.
  //
  // A passive listener that writes only when the edge is crossed, and an
  // opacity fade: nothing per frame while a list scrolls on a wall tablet.
  var SHADE_AT = 2;
  function shade(scroller, target, opts) {
    if (!scroller || !target || !scroller.addEventListener) return function () {};
    var foot = !!(opts && opts.foot);
    var check = function () {
      var tg = typeof target === 'function' ? target() : target;
      if (!tg) return;
      if (!tg.setAttribute || !tg.hasAttribute) return;
      var want = scroller.scrollTop > SHADE_AT;
      if (want === tg.hasAttribute('hk-scrolled')) return;
      if (want) {
        if (!foot && scroller.getBoundingClientRect && tg.getBoundingClientRect && tg.style && tg.style.setProperty) {
          var a = scroller.getBoundingClientRect(), b = tg.getBoundingClientRect();
          tg.style.setProperty('--hk-shade-top', Math.round(a.top - b.top) + 'px');
        }
        tg.setAttribute('hk-scrolled', '');
      } else tg.removeAttribute('hk-scrolled');
    };
    scroller.addEventListener('scroll', check, { passive: true });
    check();
    var off = function () { scroller.removeEventListener('scroll', check); };
    off.check = check;
    return off;
  }
  // SCROLL EDGES (2026-10-17, the user: every list that scrolls, one way).
  // NONE: a list is cut clean at its frame's edge, as iOS cuts one under a
  // fixed header. Tried and dropped the same day -- shadows at both ends
  // (read as a rounded tube), then soft fades (the header's and footer's own
  // edge still showed through, so the effect was lost; strong enough to hide
  // it, rows vanished). The user: "no shadow, the simplest" -- and a shadow
  // is foreign to Flat anyway. The frame, `.hk-edge`, still holds the
  // scroller (its one child) so it can shrink to fit, and still carries
  // hk-scrolled / hk-scroll-more for anything that wants to know.
  //   markup  <div class="hk-edge"><div class="lst">...</div></div>, or the
  //           scroller alone marked `hk-fades` (it carries the marks itself)
  //   then    hkCards.edges(root) once it is in
  function edgeCss(scope) {
    var p = scope || '';
    return p + '.hk-edge{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}' +
      p + '.hk-edge>:first-child{flex:1 1 auto;min-height:0}';
  }
  // the frames under `root` (and root itself), each bound once to its
  // scroller -- a repaint that makes a new scroller binds the new one -- and
  // checked now, so a paint that adds rows shows its footer at once
  var EDGE_RO = null;
  function edgeCheck(sc) {
    var f = sc && sc._hkEdge;
    if (!f || !f.setAttribute) return;
    var top = sc.scrollTop > SHADE_AT, more = sc.scrollHeight - sc.clientHeight - sc.scrollTop > 2;
    if (top !== f.hasAttribute('hk-scrolled')) { if (top) f.setAttribute('hk-scrolled', ''); else f.removeAttribute('hk-scrolled'); }
    if (more !== f.hasAttribute('hk-scroll-more')) { if (more) f.setAttribute('hk-scroll-more', ''); else f.removeAttribute('hk-scroll-more'); }
  }
  function edgeScroll(e) { edgeCheck(e.currentTarget); }
  function edges(root) {
    if (!root || !root.querySelectorAll) return;
    var frames = Array.prototype.slice.call(root.querySelectorAll('.hk-edge, .hk-fades'));
    if (root.classList && (root.classList.contains('hk-edge') || root.classList.contains('hk-fades'))) frames.unshift(root);
    if (!EDGE_RO && typeof ResizeObserver !== 'undefined') {
      EDGE_RO = new ResizeObserver(function (es) {
        es.forEach(function (x) { if (x.target.isConnected === false) EDGE_RO.unobserve(x.target); else edgeCheck(x.target); });
      });
    }
    frames.forEach(function (f) {
      var sc = f.classList.contains('hk-fades') ? f : f.firstElementChild;
      if (!sc) return;
      if (sc._hkEdge !== f) {
        sc._hkEdge = f;
        sc.addEventListener('scroll', edgeScroll, { passive: true });
        if (EDGE_RO) EDGE_RO.observe(sc);
        if (typeof MutationObserver !== 'undefined') {
          new MutationObserver(function () { edgeCheck(sc); }).observe(sc, { childList: true });
        }
      }
      edgeCheck(sc);
    });
  }
  // the header's shadow once a list scrolls under it: none (SCROLL EDGES)
  function shadeCss() { return ''; }

  var _choose = null;
  function chooseSheet(title, options, onPick, opts) {
    opts = opts || {};
    if (!_choose) {
      _choose = document.createElement('div');
      _choose.id = 'hk-choose';
      _choose.innerHTML =
        '<style>' +
        '#hk-choose{position:fixed;inset:0;z-index:9999;display:none;' +
        '  align-items:center;justify-content:center;' +
        '  background:rgba(0,0,0,0.45);' + FONT_ROOT + '}' +
        '#hk-choose[data-open]{display:flex}' +
        // --hk-vh: the car's real window height, set only on the zoomed
        // Tesla dashboard (tesla-viewport.js), where 78vh is zoomed too and
        // is ~52% of the screen. Unset everywhere else: plain 100vh.
        '#hk-choose .box{position:relative;width:340px;max-height:calc(var(--hk-vh, 100vh) * .78);border-radius:16px;' +
        // no blur: at .94 over a dimmed page it could not be seen
        '  overflow:hidden;background:rgba(42,42,44,0.94);' +
        '  color:' + v('ink') + ';text-align:center;display:flex;flex-direction:column;' +
        '  box-shadow:0 24px 64px rgba(0,0,0,0.55),0 2px 10px rgba(0,0,0,0.35)}' +
        '#hk-choose .txt{padding:22px 24px 16px;font-size:15px;font-weight:600;' +
        '  line-height:1.35;color:' + v('ink') + '}' +
        // The list scrolls if it ever outgrows the sheet; six fit without it.
        '#hk-choose .list{overflow-y:auto;-webkit-overflow-scrolling:touch}' + edgeCss('#hk-choose ') +
        '#hk-choose .opt{appearance:none;border:0;background:none;width:100%;' +
        '  color:#0a84ff;font:inherit;font-size:17px;padding:15px 20px;' +
        '  cursor:pointer;display:block;' +
        '  box-shadow:inset 0 0.5px 0 rgba(255,255,255,0.18)}' +
        '#hk-choose .opt:active{background:rgba(255,255,255,0.08)}' +
        // Cancel is the last row and reads as the way out, not as a seventh
        // decade -- 600 against the options' regular weight, the same device
        // iOS uses to separate a sheet's dismissal from its choices.
        '#hk-choose .cancel{font-weight:600;' +
        '  box-shadow:inset 0 0.5px 0 rgba(255,255,255,0.18)}' +
        // the title riding on the list, once it scrolls (shade)
        '</style>' +
        '<div class="box"><div class="txt"></div>' +
        '<div class="list hk-fades"></div>' +
        '<button class="opt cancel" data-cancel>Cancel</button></div>';
      dialogMount(_choose);
      edges(_choose.querySelector('.list'));
    } else dialogMount(_choose);
    var close = function () {
      _choose.removeAttribute('data-open');
      document.removeEventListener('keydown', esc, true);
    };
    var esc = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    _choose.querySelector('.txt').textContent = title || 'Choose';
    _choose.querySelector('[data-cancel]').textContent = opts.cancel || 'Cancel';
    _choose.querySelector('[data-cancel]').onclick = close;
    _choose.onclick = function (e) { if (e.target === _choose) close(); };
    var list = _choose.querySelector('.list');
    list.innerHTML = '';
    list.scrollTop = 0;
    (options || []).forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.textContent = o.name;
      b.setAttribute('data-hk-name', o.name);
      b.onclick = function () { close(); onPick(o); };
      list.appendChild(b);
    });
    _choose.setAttribute('data-open', '1');
    document.addEventListener('keydown', esc, true);
    return _choose;
  }

  // NEVER A ONE-TAP TOGGLE: what opens the house, arms or disarms it, or runs
  // the water and the heat. A garage (or gate, or door) cover is a door; a
  // shade is not.
  var NEVER_TOGGLE = { lock: 1, alarm_control_panel: 1, valve: 1, climate: 1, water_heater: 1,
                       siren: 1, vacuum: 1, camera: 1 };
  var DOOR_COVERS = { garage: 1, gate: 1, door: 1 };
  function neverToggles(client, id) {
    if (!id || typeof id !== 'string') return false;
    var d = id.split('.')[0];
    if (NEVER_TOGGLE[d]) return true;
    if (d !== 'cover') return false;
    var st = client && client.states && client.states[id];
    return !!(st && st.attributes && DOOR_COVERS[st.attributes.device_class]);
  }

  // WAS THIS CONTEXTMENU A MOUSE'S? Chrome hands contextmenu over as a
  // PointerEvent that says so; Safari and older WebViews don't, so the press
  // that preceded it decides (a long press on Android is a 'touch' press).
  // Unknown counts as NOT a mouse: a wall tablet must never open a sheet
  // from a resting finger.
  var lastPress = '';
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', function (e) { lastPress = e.pointerType || ''; },
                              { capture: true, passive: true });
  }
  function fromMouse(e) {
    if (e.pointerType) return e.pointerType === 'mouse';
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return false;
    return lastPress === 'mouse';
  }

  // A TAP THAT CHANGES PAGE CHANGES IT AT ONCE (2026-10-11). It once dimmed
  // the control for one drawn frame first, so the tap was answered before
  // the page was -- a frame or two later on every page change, which cost
  // more than it gave (the whole page change measured on the tablets: twice
  // as fast with this and the other page-change holds gone). `el` is kept
  // for the callers.
  function navigate(path, el) {  // eslint-disable-line no-unused-vars
    window.hkShell.navigate(path);
  }

  function confirmSheet(text, onOk, opts) {
    opts = opts || {};
    if (!_sheet) {
      _sheet = document.createElement('div');
      _sheet.id = 'hk-confirm';
      _sheet.innerHTML =
        '<style>' +
        '#hk-confirm{position:fixed;inset:0;z-index:9999;display:none;' +
        '  align-items:center;justify-content:center;' +
        '  background:rgba(0,0,0,0.45);' + FONT_ROOT + '}' +
        '#hk-confirm[data-open]{display:flex}' +
        // A LIFT, like everything else on these pages: every card, pill and
        // tile carries a shadow, so without one this sheet would read as
        // painted on rather than above. Deeper than a card's
        // `0 6px 18px` because it floats much further off the page.
        // 340px, and the padding below is generous with it: at 270 with 16px
        // sides, "Leave Playing" leaves about 14px each side of its half --
        // which on a wall reads as text that only just fits rather than a
        // deliberate button.
        '#hk-confirm .box{width:340px;border-radius:16px;overflow:hidden;' +
        '  background:rgba(42,42,44,0.94);color:' + v('ink') + ';text-align:center;' +
        '  box-shadow:0 24px 64px rgba(0,0,0,0.55),' +
        '             0 2px 10px rgba(0,0,0,0.35)}' +
        '#hk-confirm .txt{padding:22px 24px 18px;font-size:15px;font-weight:600;' +
        '  line-height:1.35;color:' + v('ink') + '}' +
        // A second line for WHAT the question is about -- the rooms and what
        // they are playing. Collapsed to nothing when unused, so a sheet
        // without one is unchanged to the pixel.
        '#hk-confirm .det{display:none;padding:0 24px 20px;font-size:13px;' +
        '  font-weight:500;line-height:1.4;color:' + v('ink-2') + '}' +
        '#hk-confirm .det[data-on]{display:block}' +
        // The title owns the gap when it is alone; when a detail line follows
        // it, the detail owns the bottom and the title gives some back, or
        // the two lines drift apart into separate paragraphs.
        '#hk-confirm .txt + .det[data-on]{margin-top:-8px}' +
        // THE ROW STAYS FULL-BLEED, with the hairline divider. Inset button
        // plates stop the sheet reading as the system alert it is copied
        // from. The margin is bought with the box WIDTH instead: the labels are
        // centred in their halves, so a wider sheet gives them more air
        // without changing what the sheet is.
        '#hk-confirm .row{display:grid;grid-template-columns:1fr 1fr;' +
        '  border-top:0.5px solid rgba(255,255,255,0.18)}' +
        '#hk-confirm button{appearance:none;border:0;background:none;color:#0a84ff;' +
        '  font-family:inherit;font-size:17px;padding:14px 12px;cursor:pointer;' +
        '  white-space:nowrap}' +
        // NO BOLD ON EITHER BUTTON. The iOS convention emboldens the
        // default, and on a two-action pair that quietly recommends one half
        // -- often the destructive one. The divider separates them and the
        // words say what they do, so both buttons are one weight everywhere
        // and nothing is being recommended by typography.
        '#hk-confirm button + button{border-left:0.5px solid rgba(255,255,255,0.18)}' +
        // `destructive: true`: the action that takes something away is red
        // (Apple's destructive style), never bold
        '#hk-confirm[data-red] [data-yes]{color:#ff453a}' +
        '</style>' +
        '<div class="box" role="alertdialog" aria-modal="true">' +
        '<div class="txt"></div><div class="det"></div>' +
        '<div class="row"><button data-no>Cancel</button>' +
        '<button data-yes>Confirm</button></div></div>';
      dialogMount(_sheet);
    } else dialogMount(_sheet);
    var close = function () {
      _sheet.removeAttribute('data-open');
      document.removeEventListener('keydown', esc, true);
    };
    var esc = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    // Rebound every time: the handler closes over THIS call's onOk.
    _sheet.querySelector('[data-no]').onclick = function () {
      close();
      if (opts.onNo) opts.onNo();
    };
    _sheet.querySelector('[data-yes]').onclick = function () { close(); onOk(); };
    // Only the backdrop itself, never a click that bubbled out of the box.
    _sheet.onclick = function (e) { if (e.target === _sheet) close(); };
    _sheet.querySelector('.txt').textContent = text || 'Are you sure?';
    _sheet.querySelector('[data-no]').textContent = opts.no || 'Cancel';
    _sheet.querySelector('[data-yes]').textContent = opts.yes || 'Confirm';
    if (opts.destructive) _sheet.setAttribute('data-red', ''); else _sheet.removeAttribute('data-red');
    var det = _sheet.querySelector('.det');
    det.textContent = opts.detail || '';
    if (opts.detail) det.setAttribute('data-on', '1');
    else det.removeAttribute('data-on');
    _sheet.setAttribute('data-open', '1');
    document.addEventListener('keydown', esc, true);
    return _sheet;
  }

  // ------------------------------------------------ the snapshot cache
  //
  // PAINT THE LAST FRAME WE SAW, INSTANTLY, while the fresh one is fetched.
  //
  // MEASURED: a strip's nine tiles fill in
  // between 463ms and 2427ms from a cold load, and the cameras page's stills
  // take 1.6-3.1s EACH. That is not this code -- it is how long UniFi Protect
  // takes to produce a snapshot, measured straight off /api/camera_proxy. No
  // amount of loading earlier makes Protect answer faster, so the only way to
  // have something on screen at 0ms is to already have it.
  //
  // A THUMBNAIL, NOT THE FRAME. 160px wide at JPEG q0.5 is ~4KB against the
  // real still's ~34KB, so all nine fit in ~40KB of localStorage instead of
  // ~400. It is soft, and it should be: it is a placeholder that gets replaced
  // within a couple of seconds, and it must not be mistakable for live.
  //
  // THE AGE LABEL IS WHAT KEEPS IT HONEST. A cached frame restores the slot's
  // `at` timestamp too, so a tile painted from cache reads "4m" or "2h" until
  // the fresh one lands and resets it to "now". Showing an old picture with no
  // label would be worse than showing black.
  //
  // Every access is wrapped: localStorage throws outright in some contexts
  // (private windows, a browser set to block site data, thumbnail capture),
  // and a camera strip must not take the page down with it.
  var SNAP_KEY = 'hk-snap-v1';
  // 160, and the softness is WANTED. 320 would spare the cameras page's
  // 399x224 tiles a 2.5x upscale, but the soft frame is better: it reads as
  // a visual identifier of which
  // camera is which while the real one loads, and cannot be mistaken for live.
  // Nine cameras measure 37,643 bytes at 160 against 115,067 at 320.
  var SNAP_W = 160;              // thumbnail width; height follows the aspect
  var SNAP_MIN_GAP = 5 * 60 * 1000;   // write at most this often per camera

  // HOW STALE A CACHED FRAME MAY BE BEFORE IT IS A LIE.
  //
  // The strip can show an old frame safely because it draws an AGE LABEL over
  // every tile -- "1m", "2h" -- so nothing is presented as live that is not.
  // The cameras page has no such label, and a picture of the front door from
  // three hours ago shown as if it were live is worse than a black tile for
  // the second it takes the stream to start. This is a security surface.
  //
  // So the page only uses a cached frame while it is FRESH, which in practice
  // means "the dashboard was on screen a moment ago" -- exactly the case where
  // the wait is most annoying. Past that it gets HA's own poster and black,
  // as it would with no cache at all.
  var SNAP_FRESH = 2 * 60 * 1000;

  // IN MEMORY, SAVED LATER (2026-10-11). The cache was read from storage
  // and parsed whole on every lookup, and every save drew, JPEG-encoded and
  // re-wrote the whole of it -- synchronously. Leaving Home saved all eight
  // stills that way, one full rewrite each, while the next page waited:
  // 21-25 ms of the Master Bedroom tablet's page change on its own
  // (measured there, 2026-10-11). Now storage is read once; a save only
  // draws the small thumbnail (it has to be now: a video's frame is gone in
  // a moment); the encoding is done when someone asks for the picture (a
  // tile opening on it) or when the tablet is idle, and the whole cache is
  // written once, then.
  var SNAP_MEM = null, snapDirty = false, snapSaveT = null;
  function snapMem() {
    if (SNAP_MEM) return SNAP_MEM;
    SNAP_MEM = {};
    try {
      var all = JSON.parse(localStorage.getItem(SNAP_KEY) || '{}') || {};
      Object.keys(all).forEach(function (k) { if (all[k] && all[k].d) SNAP_MEM[k] = snapEntry(null, all[k].t, all[k].d); });
    } catch (e) { /* no storage: memory alone */ }
    return SNAP_MEM;
  }
  // { t, d } -- `d`, the data URL, encoded from the thumbnail on first use
  function snapEntry(cv, t, d) {
    var e = { t: t, _cv: cv, _d: d || null };
    Object.defineProperty(e, 'd', { enumerable: true, get: function () {
      if (!e._d && e._cv) {
        try { e._d = e._cv.toDataURL('image/jpeg', 0.5); } catch (x) { e._d = null; }
        e._cv = null;
      }
      return e._d;
    } });
    return e;
  }
  function snapFlush() {
    if (!snapDirty) return;
    snapDirty = false;
    try {
      var out = {}, mem = snapMem();
      Object.keys(mem).forEach(function (k) { var d = mem[k].d; if (d) out[k] = { d: d, t: mem[k].t }; });
      localStorage.setItem(SNAP_KEY, JSON.stringify(out));
    } catch (e) { /* quota or no storage: the memory copy still serves this page */ }
  }
  function snapSaveLater() {
    snapDirty = true;
    if (snapSaveT) return;
    var go = function () { snapSaveT = null; snapFlush(); };
    // when the tablet has a moment -- after the page change, never during
    if (typeof requestIdleCallback === 'function') snapSaveT = requestIdleCallback(go, { timeout: 8000 });
    else snapSaveT = setTimeout(go, 3000);
  }
  // (and before the page goes away, whatever is still waiting)
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', function () {
      if (!snapDirty) return;
      if (snapSaveT) {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(snapSaveT); else clearTimeout(snapSaveT);
        snapSaveT = null;
      }
      snapFlush();
    });
  }

  // `maxAge` is opt-in: the strip passes nothing (any age will do, the label
  // tells the truth) and the cameras page passes SNAP_FRESH.
  function snapCacheGet(entity, maxAge) {
    var hit = snapMem()[entity];
    if (!hit) return null;
    if (maxAge && (Date.now() - hit.t) > maxAge) return null;
    return hit.d ? hit : null;
  }

  // Called from a successful load. Cheap on the common path: it sees a
  // recent entry and returns before touching a canvas.
  // `img` may also be a playing <video> (its current frame), and `force`
  // writes whatever the age of the last entry: the cameras page keeps the
  // frames it is leaving (hk-campost.js), the strip its stills. `at`: when
  // the frame was TAKEN (a still can be older than now), so FRESH stays
  // honest. Returns the entry ({t, d}: d encoded only when read).
  function snapCachePut(entity, img, force, at) {
    try {
      var mem = snapMem(), prev = mem[entity];
      if (!force && prev && (Date.now() - prev.t) < SNAP_MIN_GAP) return null;
      var iw = img.naturalWidth || img.videoWidth, ih = img.naturalHeight || img.videoHeight;
      if (!iw || !ih) return null;
      var h = Math.max(1, Math.round(SNAP_W * ih / iw));
      var cv = document.createElement('canvas');
      cv.width = SNAP_W; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, SNAP_W, h);
      var e = mem[entity] = snapEntry(cv, at || Date.now(), null);
      snapSaveLater();
      return e;
    } catch (e) {
      // A tainted canvas, or no canvas at all. The strip works without the
      // cache; it just starts black again.
      return null;
    }
  }

  var BASE_CSS = [
    // Every hk card clears the WebView tap highlight itself too, rather than
    // relying on an ancestor HA happens to style (see hk-popup.js).
    ':host{display:block;-webkit-tap-highlight-color:transparent}',
    // THE FONT IS THE THEME'S: --ha-font-family-body, read here, at the card.
    // Inherited it was not: the theme is put on the VIEW, but Home Assistant
    // resolves font-family at <body> from its own default (Roboto) and every
    // element below inherits that resolved value -- so a card showed SF Pro
    // only when the user's own profile theme was HK Kiosk (measured
    // 2026-10-13). A card in a sheet or a pop-up (mounted outside the view)
    // reads the variable that surface sets on its root (FONT_ROOT, below).
    ':host{font-family:var(--ha-font-family-body,' + v('font-body') + ')}',
    '*{box-sizing:border-box;font-family:inherit}',
    // ON A HOME GRID (a block's card has `size`, hk-home-grid-view): the card
    // and its own root are the block's height, so a plate can fill it
    ':host([size]){height:100%}:host([size])>div{height:100%}',
    // every list that scrolls: a light fade at its ends (SCROLL EDGES)
    edgeCss(),
    // BEHIND THE PHOTO SCREENSAVER every animation in a card holds still: a
    // fan's spinning glyph, a pulse, a scrolling label. Nothing can be seen or
    // touched behind WallPanel, and on a wall tablet's Android WebView ANY
    // running animation keeps the page drawing a frame per screen refresh --
    // the fan glyphs alone were 30-50% of a core on an otherwise idle tablet
    // (measured 2026-09-29). hk-sky marks the cards (hk-asleep, below); they
    // resume where they were the moment the photos go. NOT the music progress
    // bar: it is a CSS animation started at the song's position, so pausing it
    // would leave it behind the song after the wake.
    ':host([hk-asleep]) *:not(.prog-fill){animation-play-state:paused!important}',

    // ---- the 40px selectable pill ----------------------------------------
    '.pill{height:40px;border-radius:20px;padding:0 14px;margin:0;',
    '  display:grid;grid-template-columns:minmax(0,1fr);align-content:center;',
    // (Flat's --hk-pill-bg: on its ivory cards a plate-colored pill
    // vanished -- the Clean Areas rooms; the look's plate elsewhere)
    '  ' + M.glass + ';background:var(--hk-pill-bg,' + M.bg + ');border:' + M.border + ';',
    '  box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10));',
    '  cursor:pointer;user-select:none;',
    '  transition:background-color .22s ease, transform .12s ease}',
    '.pill:active{transform:scale(0.96)}',
    '.pill > span{justify-self:center;' + PILL_LABEL + ';',
    '  white-space:nowrap;overflow:hidden;',
    '  text-overflow:ellipsis;color:' + v('ink') + ';transition:color .22s ease}',
    '.pill[aria-pressed="true"]{background:var(--hk-seg-on,' + SELECTED_BG + ');box-shadow:var(--hk-seg-on-shadow,var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10)))}',
    '.pill[aria-pressed="true"] > span{color:' + SELECTED_TEXT + '}',

    // ---- the 70px action tile --------------------------------------------
    // --hk-pill: the pill everywhere but an iPad held upright (css/hk-responsive.css).
    '.tile{height:' + TILE.h + 'px;width:' + PILL_W + ';min-width:' + PILL_W + ';max-width:' + PILL_W + ';',
    '  border-radius:' + M.radius + ';padding:' + TILE.pad + ';margin:0;',
    '  ' + M.glass + ';border:' + M.border + ';box-shadow:' + M.shSm + ';',
    '  display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:' + TILE.wellGap + 'px;',
    '  align-items:center;align-content:center;cursor:pointer;user-select:none;',
    '  transition:transform .12s ease}',
    '.tile:active{transform:scale(0.97)}',
    // Matches .start on the timer keypad. Set while a submission is in flight
    // so the tile reads as inert rather than as tappable-and-ignored.
    '.tile[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
    '.tile .well{width:42px;height:42px;border-radius:50%;background:' + M.well + ';',
    '  display:flex;align-items:center;justify-content:center;align-self:center;justify-self:center}',
    // display:flex, so the glyph sits in the middle of its circle, on
    // EVERY tile.
    //
    // hk-icon (like HA's ha-icon) renders its glyph as an INLINE-level child, so it is placed on
    // a baseline inside a line box built from the inherited line-height
    // (22.4px) against a 23px icon -- and the half-leading pushes it down.
    // The well is already a flex box and centres the hk-icon perfectly; it
    // is the next level down that drifts.
    //
    // Without it, measured on six category pills, the glyph sits
    // consistently 0.81px BELOW the circle's centre. Small, and on a wall tablet at
    // dPR 1.5-2.0 that is 1.2-1.6 device pixels of a 42px circle -- which
    // is exactly the kind of thing that reads as "slightly wrong" without
    // being nameable.
    //
    // Same family as the 5px offset that made the speaker pills' play glyph
    // sit low (see hk-media.js _pill, which solved it by dropping the icon element
    // for an inline <svg>). Making the hk-icon a flex container removes
    // baseline alignment entirely, which is the cause rather than the
    // symptom -- a -0.81px nudge would be a number nobody could justify
    // later.
    // WHITE, as the label is, unless a tile colors its own glyph (a scene's,
    // inline). Inherited, it took the page's text color -- black under a
    // light Home Assistant theme: the Browse Music categories (2026-10-10).
    '.tile .well hk-icon{--mdc-icon-size:' + TILE.glyph + 'px;width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px;color:' + v('glyph') + ';',
    '  display:flex;align-items:center;justify-content:center}',
    '.tile .txt{justify-self:stretch;text-align:left;align-self:center;',
    '  font-weight:600;font-size:15px;line-height:1.1;letter-spacing:-0.23px;',
    '  color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

    // ---- action status line (see _setStatus, below) ----------------------
    //
    // ONE ROW, IN THE FLOW, RESERVED WHETHER OR NOT IT SAYS ANYTHING. It is
    // not a toast and not an overlay: a toast on a wall tablet is read by
    // nobody, because the person who pressed the key has already looked up at
    // the room. Holding the row means the card does not resize when a message
    // arrives, which is what would actually pull the eye back to it.
    //
    // The four kinds are deliberately not four colours of "error". `sent` and
    // `warn` are the pair that matters: see the comment on _setStatus.
    '.hk-status{min-height:20px;margin:0 4px 10px 4px;font-size:13.5px;',
    '  font-weight:600;letter-spacing:-0.1px;line-height:20px;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    '  color:transparent;transition:color .18s ease}',
    '.hk-status[data-kind="pending"]{color:' + v('ink-3') + '}',
    '.hk-status[data-kind="sent"]{color:' + v('ink-2') + '}',
    '.hk-status[data-kind="warn"]{color:' + v('warn') + '}',
    '.hk-status[data-kind="failed"]{color:' + v('fail') + '}',
    '@media (prefers-reduced-motion: reduce){.hk-status{transition:none}}',

    // ---- section heading (transcribed from hk_section_heading) -----------
    '.head{font-size:22px;font-weight:700;letter-spacing:-0.4px;',
    '  color:' + v('ink') + ';padding:0 4px 10px 4px}',

    '@media (prefers-reduced-motion: reduce){',
    '  .pill,.pill:active,.pill > span,.tile,.tile:active{transition:none;transform:none}}',
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
    '@media (max-width:' + BP.phone + 'px){',
    // NO `:host{width:100%}` HERE. These hosts are already `display:block`, so
    // an auto width fills the grid area MINUS the 4px side margins layout-card
    // gives every child -- which is exactly the cell (8 px under the track)
    // the pill is built to overflow by 8. Forcing width:100% resolves against
    // the full grid AREA instead and every tile comes out 8px too wide (190.95
    // measured against a 182.95 track), eating the gap (then 12px) to 4px.
    '  :host{max-width:none !important}',
    '  .tile{width:calc(100% + var(--hk-cell-bleed, 8px));min-width:0;max-width:none}',
    '}',
  ].join('');

  // ------------------------------------------------------------------ base
  // The three methods Lovelace actually requires. Nothing here reaches into
  // HA internals -- that is the whole reason a card like this ages well while
  // hk-icons.js (which pokes ha-icon._legacy) needs watching.
  // ONE STYLESHEET PER CLASS, NOT PER INSTANCE.
  //
  // A <style> element per card is fine for a handful of cards and wrong at
  // the scale the card library reaches: one home view can hold 300 cards,
  // and that is 300 copies of the same CSS to parse and hold.
  //
  // hasOwnProperty, not a plain lookup: static properties are INHERITED, so a
  // subclass would otherwise find HkBase's sheet and every card in the file
  // would share the base's CSS with none of its own.
  function sheetFor(ctor) {
    if (!Object.prototype.hasOwnProperty.call(ctor, '_hkSheet')) {
      var sheet = null;
      try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(BASE_CSS + (ctor.CSS || '') + flatCss(null, !!ctor.FLAT_MOTION));
      } catch (e) {
        sheet = null;              // older engine -> <style> fallback below
      }
      ctor._hkSheet = sheet;
    }
    return ctor._hkSheet;
  }

  // ------------------------------------------------------------ MODULE WAKE
  // The card files and the modules they call (hk-tile's palette, hkChart,
  // hkStats, hkTimers, hkHeader) load in parallel, in no fixed order. A card
  // that draws before a module has run draws a fallback -- raw CSS colours, an
  // empty chart, no countdowns -- and the re-render gate then keeps that frame,
  // because no ENTITY changed -- a chip that stays wrong until a reload.
  //
  // Each module announces itself with `hk-module-ready` once its global is set.
  // That bumps GEN, which every card's gate compares, and redraws every live
  // card now. So "which modules are loaded" is an input to every card like any
  // entity, and a card is redrawn when that input changes -- not on a timer and
  // not on the hope that some unrelated state changes soon. A card on a cached,
  // detached view catches up on its next state push, because its _hkGen is behind.
  var GEN = { n: 0 };
  var LIVE = [];
  function track(el) {
    if (el._hkTracked || typeof WeakRef !== 'function') return;
    el._hkTracked = true;
    LIVE.push(new WeakRef(el));
  }
  function redrawAll() {
    GEN.n++;
    LIVE = LIVE.filter(function (r) { return !!r.deref(); });
    LIVE.forEach(function (r) {
      var el = r.deref();
      if (el && el.isConnected && el._config && el.client) {
        try { el.requestUpdate(); } catch (e) { console.error('[hk-cards] wake', e); }
      }
    });
  }
  window.addEventListener('hk-module-ready', redrawAll);
  // EVERY CARD ON THE PAGE DRAWN AGAIN, past its gate: for a host that must see what each card reads
  // (Mantel's narrowing pass, web/home.js). A gate whose signature reads no state -- the Energy page's
  // tab and five-second clock -- would otherwise skip the pass, and its sensors went unrecorded
  // (2026-10-29: the where-card's power sensors were left out of the narrowed subscription).
  window.hkCards.redrawAll = redrawAll;

  // THE SHARED BLUR'S MEMBERS (look.glass = blur; modules/hk-glass.js). A card
  // joins while it is on the page, unless its config says `glass: false`.
  // The set is global because hk-glass.js may load before or after this file.
  var GLASS = window.__hkGlassCards = window.__hkGlassCards || new Set();

  // THE CARDS ON THE PAGE, for the screensaver pause (BASE_CSS, hk-asleep).
  // hk-sky knows when the tablet's screensaver is up; it sets
  // window.__hkAsleep and fires `hk-asleep` on window whenever that changes,
  // whichever of the two files loaded first. A card joining while asleep is
  // marked at once.
  var ON_PAGE = window.__hkCardsOnPage = window.__hkCardsOnPage || new Set();
  // ...and whether this screen's Animations are off (hk-still): read from
  // its Sky / Background whenever a setting or the page changes. The cards
  // whose glyph spins (hk-tile.js, hk-chip.js) stand it upright then; a
  // class here in BASE_CSS would reach every card's own .spin.
  function stillNow() {
    var S = window.hkSettings;
    try { return !!(S && S.skyLook && S.skyLook().animations === false); } catch (e) { return false; }
  }
  var still = stillNow();
  function markAsleep(card) {
    // Touch the attribute only when it changes: nearly every card joins awake.
    var on = !!window.__hkAsleep;
    if (on !== !!card._hkAsleep) {
      card._hkAsleep = on;
      if (on) card.setAttribute('hk-asleep', ''); else card.removeAttribute('hk-asleep');
    }
    if (still !== !!card._hkStill) {
      card._hkStill = still;
      if (still) card.setAttribute('hk-still', ''); else card.removeAttribute('hk-still');
    }
  }
  window.addEventListener('hk-asleep', function () { ON_PAGE.forEach(markAsleep); });
  ['hk-module-ready', window.hkShell.navEvent].forEach(function (t) {
    window.addEventListener(t, function () {
      syncFlat();
      var now = stillNow();
      if (now === still) return;
      still = now;
      ON_PAGE.forEach(markAsleep);
    });
  });
  function glassJoin(card, on) {
    // ON A LIGHT PAGE (tone() below) the shared blur has no sky to frost: it
    // laid its tinted layer behind each plate and turned the light glass a
    // muddy gray. Out of it, as a card that says `glass: false` is.
    var off = !!(window.hkSettings && window.hkSettings.rendering && window.hkSettings.rendering().flat) || !!(card._config && card._config.glass === false) || !!card._hkLight;
    // Out of "Blur each card" too, and everything inside it (the variable
    // inherits into child cards' shadow roots).
    if (card.style) {
      if (off) card.style.setProperty('--hk-glass-backdrop', 'none');
      // (not a pill Edit mode is carrying: that blur is its own while it is
      // held, and moving it among its group re-joins it -- hkGlass.carry)
      else if (card.style.getPropertyValue('--hk-glass-backdrop') && !(window.hkGlass && window.hkGlass.carrying && window.hkGlass.carrying(card))) {
        card.style.removeProperty('--hk-glass-backdrop');
      }
    }
    var join = on && !off;
    if (join === GLASS.has(card)) return;
    if (join) GLASS.add(card); else GLASS.delete(card);
    // The card goes along: on a fresh page load hk-glass holds the first view
    // unpainted until its frost is placed, and this join is how it learns of
    // the view before the view's first paint.
    if (window.hkGlass) window.hkGlass.changed(card, join);
  }

  // ...and when one has drawn again: the shared blur looks again at a card
  // whose plates were replaced or added (hk-glass decides, cheaply). Without
  // this only its 2 s backstop found them.
  function glassRendered(card) {
    if (GLASS.has(card) && window.hkGlass && window.hkGlass.rendered) window.hkGlass.rendered(card);
  }

  // THE CLIENT HUB: the newest client any card was handed,
  // for things that are not cards and so are never handed one -- the detail
  // sheets (hk-detail.js) live outside the dashboard and still need every
  // state change. The frontend passes every card the SAME object per update,
  // so this is one identity compare per card per update, and the listeners
  // run once per new object, not once per card.
  var CLIENT_HUB = { last: null, fns: new Set() };
  var PREVIEW_CLIENTS = new WeakSet();
  // An inert gallery's readings belong to its card tree, never to the
  // page-wide client feed. Even a caller passing actions gets a read-only port.
  window.hkCards.previewClient = function (port) {
    var client = window.hkClient.create(Object.assign({}, port, { actions: null }));
    PREVIEW_CLIENTS.add(client);
    return client;
  };
  function clientSeen(client) {
    if (!client || PREVIEW_CLIENTS.has(client) || client === CLIENT_HUB.last) return;
    CLIENT_HUB.last = client;
    artWatch(client);              // the reconnect hook (above), from the first client
    CLIENT_HUB.fns.forEach(function (fn) {
      try { fn(client); } catch (e) { console.error('[hk-cards] client listener', e); }
    });
    try { window.dispatchEvent(new CustomEvent('hk-client-update')); } catch (e) { /* shell tests */ }
  }
  window.hkCards.client = function () {
    return (window.hkHostClient.current && window.hkHostClient.current()) || CLIENT_HUB.last;
  };
  window.addEventListener('hk-client-update', function () {
    if (window.hkHostClient.current) clientSeen(window.hkHostClient.current());
  });
  // THE ACTION PORT for code that is not a card: the given client's (or, for
  // a card family still handed the host input, that input's client through
  // the host adapter), else the current client's. Null with no client.
  window.hkCards.actions = function (source) {
    var c = source ? asClient(source) : window.hkCards.client();
    return (c && c.actions) || null;
  };
  // THE SUBSCRIPTION PORT the same way (Phase 1 slice 7): the given client's
  // (or a legacy host input's, through the host adapter), else the current
  // client's. One port per socket, so its identity says "same connection".
  // Null with no client or no transport.
  window.hkCards.subscriptions = function (source) {
    var c = source ? asClient(source) : window.hkCards.client();
    return (c && c.subscriptions) || null;
  };
  window.hkCards.onClient = function (fn) {
    CLIENT_HUB.fns.add(fn);
    return function () { CLIENT_HUB.fns.delete(fn); };
  };
  // A card's entry (the host adapter's hkHostClient.entry) reports each object
  // the host hands it: the hub moves on to its client.
  window.hkCards.seen = function (input) { clientSeen(asClient(input)); };

  class HkBase extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      var sheet = sheetFor(this.constructor);
      if (sheet && this.shadowRoot.adoptedStyleSheets) {
        this.shadowRoot.adoptedStyleSheets = [sheet];
      } else {
        // Kept so a browser without constructable stylesheets still renders.
        this._style = document.createElement('style');
        this._style.textContent = BASE_CSS + (this.constructor.CSS || '') + flatCss(null, !!this.constructor.FLAT_MOTION);
        this.shadowRoot.append(this._style);
      }
      this._root = document.createElement('div');
      this.shadowRoot.append(this._root);
      this._clientExplicit = false;
      this._hkClient = null;
      this._hkSig = null;
    }

    setConfig(config) {
      this._config = Object.assign({}, config);
      this._hkSig = null;                        // config change always redraws
      // ...and REBUILDS. Most cards build their DOM once, behind `_built`, from
      // the config they had then (a heading's link, a key's style, an info
      // block's type). The card editor's preview calls setConfig on the SAME
      // element for every edit, so without this the preview would keep the
      // first config's structure and the editor would look broken until a reload.
      // tests/render-audit's reconfig check holds every card to it.
      this._built = false;
      this._onConfig && this._onConfig();
      this._render();
      if (this.isConnected) glassJoin(this, true);   // `glass: false` may have changed
    }

    // RE-RENDER GATING, IN THE BASE CLASS, BY DEFAULT.
    //
    // Rendering on every new object the host hands a card would render on
    // EVERY state change in the house. MEASURED on a wall tablet: the
    // frontend hands a card a new object ~12x a second, and about 1% of
    // those change what a given card shows. Rendering on all of them is ~90x
    // the work, so a card without gating makes the tablets
    // SLOWER. That is why this lives here and not in each card: it has to be
    // the default, not something every new card remembers.
    //
    // _hkSig, not _sig: HkTimersCard already keeps its own _sig inside
    // _render(), and the two must not collide.
    //
    // LOVELACE'S ENTRY is the host adapter's (hkHostClient.entry(HkBase),
    // below the class): it keeps the object, reports it to the hub, and calls
    // _onClient with its client. A card is otherwise handed a client directly.
    _onClient() {
      this._clientExplicit = false;
      this._receiveClient();
    }

    get client() {
      return this._clientExplicit ? this._hkClient : (this._hkEntryClient || null);
    }
    set client(value) {
      this._clientExplicit = true;
      this._hkClient = value;
      clientSeen(value);
      this._receiveClient();
    }
    // A CLIENT BEFORE A CONFIG, without drawing: for a parent that must hand a
    // card its client before setConfig (setConfig draws at once). The next
    // client, or the host's object at the entry, replaces it as usual.
    adopt(client) {
      this._clientExplicit = true;
      this._hkClient = client;
    }
    _receiveClient() {
      tone(this, this.client);
      track(this);
      window.hkCardState.receive(this, GEN.n, glassRendered);
    }

    // Default signature: the last_updated of every entity the config names.
    // last_updated moves when the state OR any attribute changes, which is
    // exactly "this entity's data is different", and nothing else.
    //
    // Returning NULL means "always render" and is the safe answer when the
    // dependencies cannot be inferred -- the correct behaviour for
    // any card that does not declare its entities. Override in a card that
    // reads entities the config does not list.
    _sigOf() { return window.hkCardState.signature(this.client, this._config); }

    // THE hk-stats.js / hk-charts.js WAKE BRIDGE.
    //
    // Those modules resolve their history fetches asynchronously and then call
    // `card.requestUpdate()` to redraw whatever was waiting on the data. That
    // is a LitElement API; these cards are not Lit, so without this a card
    // that asks for statistics renders once with no data and NEVER updates --
    // the data arrives in ~100ms and then sits in the cache unread.
    //
    // It draws NOW rather than waiting for the gate, which would decide
    // nothing had changed (the ENTITY did not change -- the fetch completed)
    // and drop the render. Arguments are ignored; the bridge passes a property
    // name only because a Lit card's requestUpdate takes one.
    requestUpdate() { this.redraw(); }

    // REDRAW NOW, for a change the states do not show: data that arrived (a
    // channel list, artwork, a module), a choice made on the card. It draws,
    // and remembers the signature it drew at. Clearing _hkSig and calling
    // _render() instead drew the card AGAIN on the next push that changed
    // nothing -- a whole second build of the Live TV guide after every
    // channel fetch (the render audit's churn check, 2026-09-29).
    redraw() { window.hkCardState.redraw(this, GEN.n, glassRendered); }

    // ---------------------------------------------------------- actions
    //
    // THE CARD'S TAP AND THE ICON'S TAP ARE DIFFERENT ACTIONS, and they live
    // in the base class so no card loses the distinction: on the wall the
    // glyph toggles and the name opens detail. Collapsing that into one makes
    // every light more-info only -- no style changes, and the lights stop
    // turning on when tapped. A computed-style check cannot see behaviour; it
    // has to be carried on purpose.
    //
    // NO CARD HAS A HOLD: a long press falls through to the click and does
    // what a tap does.
    //
    // `defaultMoreInfo` is what an ABSENT action means: a card's own tap
    // opens detail, an inner element's tap does nothing unless configured.
    _bind(el, tapKey) {
      var self = this;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        self._act((self._config || {})[tapKey], tapKey === 'tap_action');
      });
    }

    // A RIGHT-CLICK OPENS DETAIL (tiles only, on a computer). On a light the
    // glyph's click toggles, so this is the mouse's way to the sheet without
    // aiming at the name. MOUSE ONLY: Android fires contextmenu on a long
    // press too, and a finger resting on a tile must still do what a tap does
    // (no card has a hold). A tile with no entity behind it keeps the
    // browser's own menu.
    _bindDetail(el) {
      var self = this;
      el.addEventListener('contextmenu', function (e) {
        var cfg = self._config || {};
        if (!cfg.entity || !fromMouse(e)) return;
        e.preventDefault();
        e.stopPropagation();
        self._act({ action: 'more-info' }, true);
      });
    }

    _act(spec, defaultMoreInfo) {
      var cfg = this._config || {};
      if (!spec && !defaultMoreInfo) return;
      spec = spec || { action: 'more-info' };
      var action = spec.action;
      if (action === 'none') return;
      // A door, the alarm, the water or the heat is NEVER one tap: whatever a
      // card's config says, `toggle` on one of these opens its detail instead
      // (homeassistant.toggle on a lock UNLOCKS it).
      if (action === 'toggle' && neverToggles(this.client, cfg.entity)) {
        spec = { action: 'more-info' };
        action = 'more-info';
      }
      // Ask first, then run the SAME path -- `_confirmed` is the only thing
      // that differs on the second pass, so there is no duplicate action code
      // to drift out of step with the guarded one.
      if (spec.confirmation && !spec._hkConfirmed) {
        var self = this;
        var again = Object.assign({}, spec, { _hkConfirmed: true });
        confirmSheet(spec.confirmation.text, function () {
          self._act(again, defaultMoreInfo);
        });
        return;
      }
      if (action === 'toggle') {
        this._call('homeassistant', 'toggle', { entity_id: cfg.entity });
        return;
      }
      if (action === 'navigate' && spec.navigation_path) {
        var p = spec.navigation_path;
        var seg = String(location.pathname).split('/')[1];
        // navigation_path_map: a dashboard where "./x" is the wrong answer
        // -- say, an energy dashboard whose battery page is a separate
        // dashboard of its own. Keyed on the url_path segment, so
        // the exception is data rather than a branch in every call site.
        var map = spec.navigation_path_map;
        if (map && Object.prototype.hasOwnProperty.call(map, seg)) {
          p = map[seg];
        }
        // "./x" is relative to the CURRENT dashboard, which is how one shared
        // config navigates correctly on every dashboard.
        if (p.slice(0, 2) === './') {
          p = '/' + seg + '/' + p.slice(2);
        }
        navigate(p, this);
        return;
      }
      // `url` is rare, and falling through to more-info would be the wrong
      // page rather than a visible error.
      // A NEW TAB, not this one. An Apple Music tile opens a player
      // page and the dashboard has to still be there behind it -- navigating
      // in place strands a wall tablet on a page with no way back.
      if (action === 'url' && spec.url_path) {
        window.open(spec.url_path, spec.target || '_blank');
        return;
      }
      if (action === 'call-service' || action === 'perform-action') {
        var svc = spec.service || spec.perform_action || '';
        // A `[[[ ]]]` service name is a button-card template these cards do not
        // evaluate. Falling through the split() below would do NOTHING at
        // all -- a tile dead on tap. Fail loudly instead.
        if (svc.indexOf('[[[') !== -1) {
          console.error('hk-card: service is a button-card JS template, which ' +
                        'this card cannot evaluate:', svc, this._config);
          return;
        }
        var parts = svc.split('.');
        if (parts.length === 2) {
          var data = Object.assign({}, spec.data || {}, spec.target || {});
          this._call(parts[0], parts[1], data);
        }
        return;
      }
      window.hkShell.moreInfo(cfg.entity, this);
    }

    getCardSize() { return 3; }

    // EVERY SERVICE CALL GOES THROUGH HERE. A bare `callService(...)`
    // written as a statement drops the promise it returns on the floor: a
    // call that REJECTS -- a dropped socket on a tablet's wifi, a script
    // renamed out from under a tile, bad variables, an exception inside the
    // script -- does nothing at all. No log, no UI change. The tap looks like
    // it worked and did not.
    //
    // Silent failure is the pattern worth killing, not any one instance of it.
    //
    // Returns the promise, so a caller that needs to know -- the timer keypad
    // and the area picker both do, so as not to throw away the user's
    // input before finding out -- can attach to it. A caller that does not
    // need to know can ignore it and still gets the logging.
    //
    // NOTE WHAT THIS DOES NOT PROMISE. Resolving means Home Assistant ACCEPTED
    // the call, not that the device did anything. For `script.turn_on` it does
    // not even mean the script finished -- that returns as soon as the script
    // starts. Proving a device acted needs the entity state afterwards and is
    // deliberately not attempted here.
    //
    // THROUGH THE CLIENT'S ACTION PORT. In Home Assistant that is the frontend's
    // own callService with exactly these arguments; in Mantel the port refuses
    // (`commands_disabled`) and sends nothing, which lands in the `false` below.
    _call(domain, service, data) {
      var act = this._actions();
      if (!act) return Promise.resolve();
      var p;
      try {
        p = act.callService(domain, service, data);
      } catch (e) {
        p = Promise.reject(e);
      }
      // RESOLVES WITH A BOOLEAN AND NEVER REJECTS. Rethrowing is the natural
      // shape -- and it would make every fire-and-forget call site a
      // potential unhandled rejection that each has to remember to .catch().
      // Getting that wrong would swap one silent failure for a noisier one.
      // `true` means accepted, `false` means
      // it did not go; a caller that ignores the result still gets the log.
      return Promise.resolve(p).then(function () { return true; }, function (err) {
        console.error('hk-card: ' + domain + '.' + service + ' failed', data, err);
        return false;
      });
    }

    // The action port of the client this card is shown, or null with none.
    _actions() {
      var c = this.client;
      return (c && c.actions) || null;
    }

    // _call, BUT KEEPING THE ERROR: {ok, error}. For a service that returns no
    // response yet can refuse -- an alarm panel rejecting a code -- where the
    // caller needs to know WHY it did not go.
    _callErr(domain, service, data) {
      var act = this._actions();
      if (!act) {
        return Promise.resolve({ ok: false, error: 'not connected' });
      }
      var p;
      try {
        // notifyOnError false: the caller shows the refusal itself (the
        // keypad's "Wrong code"); HA's toast on top of it would say it twice.
        p = act.callService(domain, service, data, undefined, false);
      } catch (e) {
        p = Promise.reject(e);
      }
      return Promise.resolve(p).then(function () { return { ok: true }; }, function (err) {
        console.error('hk-card: ' + domain + '.' + service + ' failed', data, err);
        return { ok: false, error: (err && (err.message || err.code)) || String(err) };
      });
    }

    // _call, BUT WAITING FOR THE ANSWER. A script called directly
    // -- `script.x`, not `script.turn_on` -- runs to the end before the call
    // returns, and one that ends in `stop: ... response_variable:` hands that
    // variable back. That is how a music request reports its outcome to the
    // screen that made it: non-admin users (every wall tablet) may not
    // subscribe to custom events, but they may read a service response.
    //
    // THIS ONLY WORKS ON A BLOCKING CALL. `script.turn_on` returns the moment
    // the script starts and can carry no response; the script must be called
    // as its own action (script.quick_timer_create, not script.turn_on with an
    // entity_id) so HA waits for it and collects what it returned.
    //
    // Same contract as _call: never rejects. {ok, response, error}, where
    // `response` is {} when the call went but answered nothing (an older HA,
    // or a script with no response) -- "accepted, outcome unknown".
    _callResp(domain, service, data) {
      var act = this._actions();
      if (!act) {
        return Promise.resolve({ ok: false, error: 'not connected' });
      }
      var p;
      try {
        // The 6th argument is returnResponse. The 4th (target) is undefined:
        // `data` already carries it. The 5th (notifyOnError) is FALSE -- HA's
        // own error toast is the wrong surface here, the card shows the
        // failure itself.
        p = act.callService(domain, service, data, undefined, false, true);
      } catch (e) {
        p = Promise.reject(e);
      }
      return Promise.resolve(p).then(function (res) {
        return { ok: true, response: (res && res.response) || {} };
      }, function (err) {
        console.error('hk-card: ' + domain + '.' + service + ' failed', data, err);
        return { ok: false, error: (err && (err.message || err.code)) || String(err) };
      });
    }

    // ------------------------------------------------- ARTWORK THAT MAY NEVER ANSWER
    //
    // `img.onerror` DOES NOT FIRE WHEN A HOST SIMPLY DOES NOT REPLY, and a
    // wall tablet with no internet meets exactly that on album art.
    //
    // Music Assistant hands out artwork as the PROVIDER's own url -- measured
    // across one large library, over 90% of them are
    // is1-ssl.mzstatic.com (Apple's CDN), a few r2.theaudiodb.com, and the
    // rest Music Assistant's own :8095 proxy. From a tablet with no route
    // to the public internet, Apple and
    // TheAudioDB both HANG -- no response, no refusal, no error event -- while
    // Home Assistant and MA's own :8095 answer fine.
    //
    // A dropped packet is not a failed load. The <img> sits there pending
    // forever, `error` never fires, and the placeholder the card carefully
    // installed in its error handler is never reached. Every tile stays an
    // empty grey square, permanently, with nothing anywhere saying why -- and
    // it looks perfect in Chrome on a machine that HAS internet.
    //
    // So a timeout, which is the only thing that can tell those two apart from
    // in here. The rule: no transient state may last
    // forever. This one resolves within ART_TIMEOUT either way.
    //
    // CANCELLED BY CLEARING src. Without that the request stays outstanding on
    // a page that may draw two hundred of these, and a scroll through the
    // library would leave the connection pool full of sockets waiting on a
    // host that is never going to speak.
    // `size` is the pixels the tile draws at; HA scales to it (art.py).
    _artImage(url, box, iconHtml, size) {
      var img = document.createElement('img');
      var done = false;
      var fail = function () {
        if (done) return;
        done = true;
        clearTimeout(t);
        // Stop the pending request before replacing the node it belongs to.
        try { img.src = ''; } catch (e) { /* not worth failing a paint over */ }
        box.innerHTML = iconHtml;
      };
      var t = setTimeout(function () {
        // `complete && naturalWidth` is the one honest test for "it arrived":
        // `complete` alone is also true for an image that failed.
        if (img.complete && img.naturalWidth > 0) { done = true; return; }
        fail();
      }, ART_TIMEOUT);
      img.addEventListener('load', function () { done = true; clearTimeout(t); });
      // A SIGNED PATH THAT ERRORS GETS ONE FRESH SIGNATURE (see artWatch):
      // after a restart the kept path is a 401, and a new one is the cure.
      // Once only -- `resigned` -- so an image that is simply missing costs
      // one extra request, never a loop; the second error is the placeholder.
      var self = this, sz = size || 300, signed = false, resigned = false;
      var put = function (p) { if (!done) { signed = p !== url; img.src = p; } };
      img.addEventListener('error', function () {
        if (signed && !resigned && !done) {
          resigned = true;
          artForget(url, sz);
          artSign(self.client, url, sz, put);
          return;
        }
        fail();
      });
      img.alt = '';
      if (artRemote(url)) artSign(this.client, url, sz, put);
      else img.src = artLocal(url, sz);
      box.appendChild(img);
      return img;
    }

    // ------------------------------------------------- ACTION FEEDBACK
    //
    // For the FORM-STYLE cards only -- the ones where you enter something and
    // then press a button: the timer keypad, the vacuum area picker. A tile
    // that toggles a lamp needs none of this; the lamp is the feedback, and
    // adding a status line to 300 tiles would be noise, not information.
    //
    // FOUR STATES, AND THE MIDDLE PAIR IS THE WHOLE POINT:
    //
    //   pending   the call is out, the button is inert
    //   sent      Home Assistant ACCEPTED it
    //   warn      accepted, and then the OUTCOME came back negative
    //   failed    dispatch rejected; the input is untouched, press again
    //
    // `sent` is not `done`. _call resolves `true` when HA took the call, and
    // for `script.turn_on` that means the script STARTED -- see the note on
    // _call. A quick timer fired into a full rack of slots returns `true` and
    // starts nothing. That gap is exactly what `warn` is for, and a card that
    // can observe its own outcome should report it rather than leaving `sent`
    // on screen as if it had worked.
    //
    // A card opts in by rendering _statusNode() somewhere in its tree. Cards
    // that never call _setStatus are completely unaffected.

    // The row itself. Build it once during _render and leave it in place --
    // it holds its height empty, so nothing moves when a message lands.
    _statusNode() {
      var d = document.createElement('div');
      d.className = 'hk-status';
      // A screen reader should ANNOUNCE this without the focus moving: the
      // keypad keeps focus on the button that was just pressed.
      d.setAttribute('role', 'status');
      d.setAttribute('aria-live', 'polite');
      this._paintStatus(d);
      return d;
    }

    // `ttl` clears the message after a while. Pass it for the states that are
    // merely informative (`sent`); do NOT pass one for `failed` or `warn`,
    // which describe something the person still has to act on and must not
    // disappear while they are reading it.
    _setStatus(kind, text, ttl) {
      if (this._hkStatusT) { clearTimeout(this._hkStatusT); this._hkStatusT = null; }
      this._hkStatus = kind ? { kind: kind, text: text || '' } : null;
      this._paintStatus();
      if (kind && ttl) {
        var self = this;
        this._hkStatusT = setTimeout(function () {
          self._hkStatusT = null;
          self._hkStatus = null;
          self._paintStatus();
        }, ttl);
      }
    }

    // Writes the row WITHOUT re-rendering the card. The timer keypad's <input>
    // and its caret do not survive a rebuild, and a status message must never
    // be the thing that eats what somebody is typing.
    _paintStatus(node) {
      var el = node || (this._root && this._root.querySelector('.hk-status'));
      if (!el) return;
      var s = this._hkStatus;
      el.textContent = s ? s.text : '';
      if (s) el.setAttribute('data-kind', s.kind);
      else el.removeAttribute('data-kind');
    }

    // THE DUPLICATE-SUBMISSION GUARD, in one place rather than re-typed per
    // card. Returns false when a submission is already in flight, so the
    // caller can simply `if (!this._begin()) return;`.
    _begin(text) {
      if (this._busy) return false;
      this._busy = true;
      this._setStatus('pending', text || 'Sending…');
      // REPAINT, so the button can show it is inert. _setStatus alone only
      // writes the status row, and a Start button that still says "Start" is
      // the thing that gets pressed twice. _render is the right call for both
      // shapes of card: one that builds once repaints through it, one that
      // rebuilds does so.
      this._render();
      return true;
    }

    // Always pair with _begin. Clears the guard BEFORE the caller repaints, so
    // a card that renders from inside the callback draws an idle button.
    _end() { this._busy = false; }

    // ------------------------------------------------------- TEARDOWN
    //
    // A CARD SAYS WHEN IT IS DONE. hk-stats holds subscriber sets so it can
    // wake whoever asked for a fetch, and without this it learns about a
    // dead card only reactively: notify() prunes what it happens to walk, and a
    // high-water sweep bounds a set when it gets implausibly large. Both are
    // bounded and neither is wrong, but nothing happens until the NEXT
    // response -- up to fifteen minutes for a daily chart, or never, for a
    // card nobody asks about again.
    //
    // release() is O(the sets this card joined), not a scan of anything. It is
    // safe on a card that never subscribed, and a card that is re-attached
    // subscribes again on its next render.
    //
    // A CARD THAT OVERRIDES THIS MUST CHAIN. Several do, for their own timers and
    // observers; tests/test_dispatch.js asserts every one of them calls
    // super.disconnectedCallback(). The hk-stats backstop still catches a card
    // that is replaced wholesale without ever disconnecting.
    disconnectedCallback() {
      glassJoin(this, false);
      if (this._blockRO) { this._blockRO.disconnect(); this._blockRO = null; }
      ON_PAGE.delete(this);
      if (this._hkStatusT) { clearTimeout(this._hkStatusT); this._hkStatusT = null; }
      if (window.hkStats && window.hkStats.release && window.hkStats.release(this)) {
        this._hkStatsLost = true;
      }
    }

    // THE OTHER HALF OF RELEASE. A card released while still waiting on a
    // fetch has lost its only wake-up, and re-attaching changes nothing the
    // render gate can see -- same entity, same signature -- so it would sit on
    // "Loading" until its sensor moved. Redraw once on the way back in: the
    // render asks hk-stats again, which either draws from the cache or
    // subscribes afresh. Only cards that were actually waiting pay for this.
    //
    // A CARD THAT OVERRIDES THIS MUST CHAIN, like disconnectedCallback.
    // IN A SECTION. Home Assistant's Sections view sets `layout = "grid"` on
    // every card it holds (Masonry and HK's own grid view set nothing), so a
    // tile can fill its cell there and keep its measured width everywhere
    // else (hk-tile.js, hk-stat.js: :host([data-hk-cell])).
    get layout() { return this._hkLayout; }
    set layout(v) {
      this._hkLayout = v;
      flag(this, 'data-hk-cell', v === 'grid');
    }

    connectedCallback() {
      place(this);
      tone(this, this.client);
      glassJoin(this, true);
      ON_PAGE.add(this);
      markAsleep(this);
      // Tint from Background (Frosted): tinted before it is first drawn
      if (window.hkFrostTint) window.hkFrostTint.joined(this);
      if (!this._hkStatsLost) return;
      this._hkStatsLost = false;
      if (this.client && this._config) this.requestUpdate();
    }

    // A HOME GRID BLOCK'S SIZE (docs/phase11/HOME-GRID.md): hk-home-grid-view
    // sets `size` (S, W, T, L, XL) on a block's card. A card laid out per
    // size reads it with _cellSize() or :host([size=..]); one that builds its
    // DOM once is rebuilt when it changes. Anywhere else it is null.
    static get observedAttributes() { return ['size']; }
    attributeChangedCallback(name, was, now) {
      if (name !== 'size' || was === now || !this._config) return;
      this._built = false;
      this._hkSig = null;
      this._render();
    }
    _cellSize() {
      var s = null;
      try { s = this.getAttribute('size'); } catch (e) { s = null; }    // (a test's bare element)
      return s && HOME_GRID.sizes[s] ? s : null;
    }
    // ...and the block in px: its cells (--hk-cell-w / -h, measured by the
    // view) and the gaps between them; null before the view has measured
    _block() {
      var sz = this._cellSize(), n = sz && HOME_GRID.sizes[sz];
      if (!n || typeof getComputedStyle !== 'function') return null;
      // (the grid's gap, --g-gap: square cells' is HomeView's 13)
      var cs = getComputedStyle(this), g = parseFloat(cs.getPropertyValue('--g-gap')) || HOME_GRID.gap;
      var cw = parseFloat(cs.getPropertyValue('--hk-cell-w')), ch = parseFloat(cs.getPropertyValue('--hk-cell-h'));
      if (!(cw > 0 && ch > 0)) return null;
      // (Full: the grid's own columns and rows, from its cell)
      if (!n[0] || !n[1]) n = [parseFloat(cs.getPropertyValue('--hk-span-c')) || 0, parseFloat(cs.getPropertyValue('--hk-span-r')) || 0];
      if (!(n[0] > 0 && n[1] > 0)) return null;
      return { w: Math.floor(n[0] * cw + (n[0] - 1) * g), h: Math.floor(n[1] * ch + (n[1] - 1) * g) };
    }
    // A CARD THAT LAYS OUT BY THE BLOCK'S PX (a camera's picture, how many
    // rows fit) calls this from _render: it is drawn again whenever the
    // block's size changes -- the view measures after the cards are in, and
    // again for a new window or the tab bar
    _watchBlock() {
      var b = this._block();
      this._blockKey = b ? b.w + 'x' + b.h : '';
      if (this._blockRO || typeof ResizeObserver === 'undefined' || !this._cellSize()) return;
      var self = this;
      this._blockRO = new ResizeObserver(function () {
        var n = self._block();
        if ((n ? n.w + 'x' + n.h : '') !== self._blockKey) self.redraw();
      });
      this._blockRO.observe(this);
    }

    _st(id) { return window.hkCardState.state(this.client, id); }
    _render() { /* subclasses */ }
  }


  // ========================================================= CONFIG EDITORS
  //
  // Many of these configs are written by hand in YAML -- one shared file
  // reaching several dashboards is what stops them drifting apart. An
  // editor is still worth having: it is what the card
  // PICKER and the preview pane use, which is how a card gets dropped onto a
  // page without looking up its options first.
  //
  // ha-form does the work. Two things about it that this depends on, both
  // verified against the served frontend rather than assumed:
  //   * it PRESERVES keys that are not in the schema (`type` above all), and
  //     emits the whole merged object -- so there is no manual merge here.
  //   * every selector these schemas use exists: entity, text, icon, select,
  //     boolean, object (a YAML sub-editor) and ui_action.
  //
  // The one rule the card set keeps: options must be
  // LEGIBLE AND FEW. A schema that needs a scrollbar is a card with too many
  // options, not a card that needs a bigger form.
  // WORDS ARE US ENGLISH, matching the rest of Home Assistant's UI ("color",
  // "Favorite"). The CONFIG KEYS keep their spelling (icon_color, colour in
  // chart opts) -- those are data, and renaming them would break every YAML
  // file. Only what a person reads is US English.
  //
  // A field missing from HK_LABELS falls back to a humanized key ("min_hour_col"
  // -> "Min hour col") so nothing ever shows a raw snake_case name; a schema
  // entry may also carry its own `label` / `helper` when a word means something
  // different on one card (the vacuum's `room` is a SENSOR, a tile's is text).
  var HK_LABELS = {
    // the status chips (hk-chip.js): a kind, and the row's lists
    kind: 'Kind', quiet: 'Only when there is something to report', chips: 'Chips',
    scenes: 'Scenes', looks: 'How each looks',
    // shared by most cards
    entity: 'Entity', name: 'Name', icon: 'Icon', icon_states: 'Icon for each state',
    icon_size: 'Icon size', icon_color: 'Icon color', bare_icon: 'Hide icon circle',
    bare_icon_color: 'Icon color without circle', well_background: 'Icon circle color',
    room: 'Room name', label: 'Status text (fixed)', label_mode: 'Status text',
    label_map: 'Status text for each state', label_default: 'Status text fallback',
    animation: 'Icon animation', layout: 'Layout', elevated: 'Drop shadow', size: 'Tile size',
    color: 'Color',
    option: 'Lit when state is', navigation_path: 'Link to page',
    chevron: 'Link text', height: 'Height', padding: 'Padding', margin: 'Margin',
    width: 'Width', gap: 'Gap', grid_rows: 'Row height',
    group: 'Group members', group_lit: 'Tile lights up when',
    tap_action: 'Tap action',
    icon_tap_action: 'Icon tap action',
    // readings
    value: 'Value (fixed text)', mode: 'Show', value_mode: 'Value format',
    value_attribute: 'Read attribute', value_suffix: 'Value suffix',
    value_peer: 'Energy meter sensor', idle_text: 'Idle text',
    power: 'Power sensor', stat: 'Energy statistic', peers: 'Compare with', cost_stat: 'Cost statistic',
    label_entity: 'Status from entity', label_suffix: 'Status suffix',
    label_decimals: 'Status decimals', icon_color_steps: 'Icon color by value',
    charge: 'Charging power sensor', discharge: 'Discharging power sensor',
    stored: 'Stored energy sensor', runtime: 'Backup runtime sensor',
    reserve: 'Backup reserve level', limit: 'Charge limit',
    opts: 'Chart options', trace: 'Graph options',
    // controls
    control: 'Control type', bare: 'No glass background', entity_from: 'Follow a selector',
    // layout
    card: 'Card', material: 'Background', phone: 'On a phone', parents: 'Parent pages', variant: 'Style',
    fill: 'Fill color', icon_colors: 'Icon color for each state',
    card_width: 'Card width', phone_card_width: 'Card width on phones',
    phone_gap: 'Gap on phones', pad_top: 'Top padding', pad_bottom: 'Bottom padding',
    pad_left: 'Left padding', pad_right: 'Right padding', cards: 'Cards',
    temperature: 'Temperature sensor', downstairs: 'Downstairs thermostat',
    upstairs: 'Upstairs thermostat', garage: 'Garage door',
    // weather and clock
    weather_path: 'Weather page', alarm_path: 'Security page', title: 'Title',
    source: 'Source name', caption: 'Caption', speed: 'Wind speed sensor',
    gust: 'Wind gust sensor', sun: 'Sun entity', phase: 'Moon phase sensor',
    uv: 'UV index sensor', hours: 'Hours to show', days: 'Days to show',
    min_hour_col: 'Narrowest hour column (px)', min_day_col: 'Narrowest day column (px)',
    now_width: 'Today’s column width (px)',
    plain: 'No plate (white text, shadowed)', narrow: 'Stood up (as on a phone)',
    place: 'Location label', time_size: 'Time size', ampm_size: 'AM/PM size',
    date_size: 'Date size', date_color: 'Date color', shadow: 'Text shadow',
    date_format: 'Date format', time_line_height: 'Time line height',
    main_size: 'Temperature size',
    detail_size: 'Detail text size', glyph_size: 'Weather icon size',
    dim_color: 'Secondary text color',
    // media
    meta_card: 'Controls card', browse_url: 'Browse page',
    players: 'Players, in priority order', selector: 'Selector',
    // home
    start_script: 'Clean script', floors: 'Floors and areas', order: 'Room order',
    create_script: 'Start timer script', name_chips: 'Suggested names',
    timers: 'Timers', empty_text: 'Text when nothing is running', tint: 'Accent color',
    bad_code_entity: 'Wrong code flag', battery: 'Battery sensor',
    progress: 'Cleaning progress sensor', error: 'Error sensor',
    dock_error: 'Dock error sensor', scale: 'Size', fixed: 'Pin to bottom of screen',
    plated: 'Glass behind each timer', chips: 'Chips',
    // cameras
    seam: 'Gap between images (px)', refresh: 'Snapshot refresh (seconds)',
    radius: 'Corner radius', seam_color: 'Gap color',
    // pop-up
    hash: 'Opens on', position: 'Position', background: 'Background',
    blur: 'Background blur', backdrop: 'Page dimming', clip: 'Clip to corners',
    vars: 'Card style variables', auto_close: 'Close after (ms)',
    close_outside: 'Close when tapping outside', trigger: 'Open when',
    trigger_close: 'Close when no longer true', dismissable: 'Stay closed once dismissed',
    dismiss_scope: 'Show again when these change', close_action: 'Action on close'
  };

  // One line under the field, only where the label cannot carry the meaning.
  var HK_HELPERS = {
    kind: 'Counts what HK finds for it (HK Settings → Accessories, that type’s page). Leave empty for a chip of your own (an entity).',
    chips: 'The row when this dashboard\'s settings (under Dashboards) name none. Empty: every kind the house has.',
    scenes: 'The row when this dashboard\'s settings name none. Empty: every scene, A to Z.',
    looks: 'YAML: entity: {name, icon, icon_color, tap_action}.',
    icon_size: 'CSS size, e.g. 30px. Leave empty for the default.',
    icon_states: 'YAML: state: icon. Quote on and off, e.g. "on": hk:lightbulb-on',
    bare_icon: 'While on, draw the icon without the colored circle behind it.',
    size: 'Tall spans two rows: give it view_layout grid-row: span 2. Empty: the card\'s own.',
    well_background: 'e.g. transparent. Leave empty for the default.',
    label: 'Replaces the status text completely.',
    label_mode: 'How the state becomes the status text under the name.',
    group: 'Other entities this tile stands for. Used by the "group" status texts.',
    group_lit: 'Light the tile from the main entity, or when any group member is on.',
    icon_tap_action: 'Tapping the icon does this; the rest of the tile uses Tap action.',
    room: 'Shown small, above the name.',
    option: 'Leave empty to light when on. Enter a state (e.g. Everywhere) to light when the entity equals it.',
    navigation_path: 'e.g. ./cameras. A path starting with ./ works on every dashboard.',
    chevron: 'Extra text after the title, e.g. "Details›".',
    grid_rows: 'CSS height of the heading row, e.g. 44px.',
    height: 'CSS height, e.g. 44px.', padding: 'CSS padding, e.g. 0px 0px 0px 3px.',
    margin: 'CSS margin, e.g. 0px 0px 12px 0px.', width: 'CSS width, e.g. 184px.',
    value: 'Shows this text instead of the reading.',
    value_mode: 'Leave empty to show the state as it is.',
    value_attribute: 'Temperature format: read this attribute instead of the state.',
    value_suffix: 'Temperature format: default °F.',
    value_peer: 'Cost format: the kWh meter shown after the price.',
    idle_text: 'Runtime and flow formats: shown when nothing is running.',
    power: 'Live power reading. Defaults to the entity.',
    stat: 'Today\'s energy, shown under the name.',
    peers: 'Other devices to compare today\'s use against.',
    label_entity: 'Status text is this entity\'s state instead.',
    icon_color_steps: 'YAML list, first match wins: - above: 60 / color: green, then - color: red. above is strict (more than 60), at_least inclusive -- as in a chip\'s when.',
    charge: 'Flow format: shown with + while charging.',
    discharge: 'Flow format: shown with − while discharging.',
    reserve: 'Number entity for the backup reserve %.', limit: 'Number entity for the charge limit %.',
    opts: 'YAML passed to the chart, e.g. colour: orange.',
    trace: 'YAML: hours: 3, colour: orange, title: Whole Home Power',
    control: 'Normally picked from the entity type.',
    bare: 'For use inside another card that already has a background.',
    entity_from: 'YAML: selector: input_select.x and map: {Option: entity}. Replaces Entity.',
    card: 'Any card, in YAML, e.g. type: energy-usage-graph',
    parents: 'YAML: page: parent page, for pages not opened from the dashboard, e.g. music-browse: playmusic',
    fill: 'Filled style only, e.g. rgba(255, 159, 10, 0.95).',
    icon_colors: 'Entity state type only. YAML: state: color.',
    temperature: 'Climate type only.', downstairs: 'Climate type only.', upstairs: 'Climate type only.',
    garage: 'Security type only.',
    phone_card_width: 'Used on screens narrower than 640px.', phone_gap: 'Used on screens narrower than 640px.',
    cards: 'The cards in the row, as a YAML list.',
    weather_path: 'Opened by tapping the weather. Default ./weather',
    alarm_path: 'Opened by tapping the security summary. Default ./alarm',
    title: 'Default: Severe Weather.', source: 'Default: National Weather Service.',
    speed: 'For Wind.', gust: 'For Wind.', sun: 'For Sunrise / sunset.',
    phase: 'For Moon. Empty: the built-in phase, the same one the live sky draws.', uv: 'For UV index.',
    min_hour_col: 'Hours are dropped rather than squeezed narrower than this.',
    now_width: 'Today’s conditions, left of the hours and days. 120 to 400; empty is 300.',
    min_day_col: 'Days are dropped rather than squeezed narrower than this.',
    plain: 'Drawn straight on what is behind it, as on the screensaver.',
    narrow: 'Today’s conditions above the hours and the days, whatever the width.',
    place: 'Shown at the top, e.g. HOME · SPRINGFIELD. Empty: Configure -> Weather, else the home name',
    meta_card: 'Drawn under the title — usually HK Media Controls following the same selector.',
    browse_url: 'Opened by the Browse button.',
    players: 'The first one playing is shown. List speaker groups before their members.',
    start_script: 'Optional. Receives the selected area ids. Empty: HK Clean Areas sends each vacuum the areas on its room map.',
    floors: 'Empty: the rooms Clean Areas offers (HK Settings → Features → Clean Areas), by floor, kept up to date. Or a YAML list: name, areas: [{id, name}] (id is the Home Assistant area id).',
    order: 'Optional, for automatic rooms: the order to show them in on each floor. Empty: this screen\'s Room order when it is used on pages, else A to Z.',
    create_script: 'Optional. Receives the duration and name. Empty: script.quick_timer_create (the shipped quick-timer helpers).', name_chips: 'Names offered as one-tap choices.',
    timers: 'YAML list: entity, label, glyph, label_entity.',
    bad_code_entity: 'Optional. Only for a panel that fails silently on a wrong code: an on/off entity turned on briefly when a code is rejected. A panel that refuses the code shows "Wrong code" without it.',
    progress: 'Percent complete while cleaning.',
    scale: '1 is normal size.', fixed: 'For the screensaver.',
    seam: 'Space between the camera images.', refresh: 'How often the snapshots update. 0 turns it off.',
    hash: 'The page address ending that opens it, e.g. #doorbell',
    backdrop: '0 to 1. Default 0.8.', auto_close: 'e.g. 60000 for one minute.',
    trigger: 'YAML list of conditions. Opens by itself when they become true.',
    dismissable: 'Closed by hand, it stays closed on this screen until the conditions end.',
    vars: 'YAML: CSS variable: value, e.g. ha-card-background: transparent'
  };

  // Readable names for the fixed choices. A value missing here is humanized.
  var HK_OPTION_LABELS = {
    // tile status texts
    on_off: 'On / Off', state: 'State (Open, Locked…)', sentence: 'State as a sentence',
    title: 'State in Title Case', on_off_sentence: 'On / Off, else the state',
    open_closed: 'Open / Closed', leak: 'Leak / Dry', alarm: 'Alarm (Home, Away…)',
    brightness: 'Brightness %', humidity: 'Humidity target', vacuum: 'Vacuum status',
    position: 'Position %', duration: 'Timer duration', group_brightness: 'Group: average brightness',
    group_count: 'Group: number on', setpoint: 'Target temperature',
    setpoint_verb: 'Target temperature with mode (Cool to 72°)',
    source_first: 'Source, else playback state',
    // other choices
    spin: 'Spin while on', none: 'None', entity: 'The entity is on', any: 'Any group member is on',
    hero: 'Value', pct: 'Percent', rank: 'Power use', energy: 'Energy today',
    temperature: 'Temperature', power: 'Power', runtime: 'Runtime', cost: 'Cost', cost_today: 'Cost today (statistics)',
    flow: 'Charge / discharge',
    glass: 'Glass', flat: 'Flat', filled: 'Filled',
    climate: 'Climate', security: 'Security', number: 'Slider', media_player: 'Media controls',
    wind: 'Wind', sun: 'Sunrise / sunset', moon: 'Moon', uv: 'UV index',
    weekday: 'Sunday, September 13th', monthday: 'September, 13th',
    center: 'Center', bottom: 'Bottom'
  };

  function humanize(key) {
    return sentenceCase(String(key || '').replace(/_/g, ' '));
  }

  // The colour names the tile colour map understands. custom_value stays on
  // because several tiles pass a literal rgba() instead of a name.
  var HK_COLOURS = ['yellow', 'orange', 'blue', 'green', 'red', 'purple',
                    'pink', 'teal', 'cyan', 'brown', 'gray', 'mint', 'white',
                    'black'];

  function selColour() {
    return { select: { mode: 'dropdown', custom_value: true,
                       options: HK_COLOURS.map(function (c) {
                         return { value: c, label: sentenceCase(c) };
                       }) } };
  }

  // values: strings (named through HK_OPTION_LABELS) or [value, label] pairs.
  // custom_value stays on so a hand-written value outside the list still shows
  // rather than being blanked by the dropdown.
  function selOptions(values) {
    return { select: { mode: 'dropdown', custom_value: true,
                       options: values.map(function (v) {
                         return Array.isArray(v) ? { value: v[0], label: v[1] }
                           : { value: v, label: HK_OPTION_LABELS[v] || humanize(v) };
                       }) } };
  }

  // A collapsible group of fields whose values stay FLAT in the config -- the
  // YAML does not change shape. Verified against the served frontend: ha-form
  // passes the whole data object to an expandable with `flatten` or no name.
  function section(title, schema, icon, expanded) {
    return { type: 'expandable', name: '', flatten: true, title: title,
             icon: icon, expanded: !!expanded, schema: schema };
  }

  function hkEditor(tag, schema) {
    var etag = tag + '-editor';
    if (customElements.get(etag)) return etag;

    class HkConfigEditor extends HTMLElement {
      setConfig(config) {
        this._config = Object.assign({}, config);
        this._render();
      }
      // each new client (the host adapter's entry, below): HA's ha-form
      // gets what goes with it through the adapter
      _onClient(c) {
        if (this._form) window.hkHostClient.bridge(this._form, c);
      }

      _render() {
        if (!this._form) {
          this._form = document.createElement('ha-form');
          // A schema entry's own label/helper wins -- including an EMPTY
          // helper, which means "none here" rather than "use the shared one".
          this._form.computeLabel = function (s) {
            return ('label' in s) ? s.label : (HK_LABELS[s.name] || humanize(s.name));
          };
          this._form.computeHelper = function (s) {
            return ('helper' in s) ? s.helper : ((s.name && HK_HELPERS[s.name]) || '');
          };
          this._form.addEventListener('value-changed', this._changed.bind(this));
          this.appendChild(this._form);
        }
        window.hkHostClient.bridge(this._form, this.client);
        this._form.schema = schema;
        this._form.data = this._config || {};
      }

      _changed(ev) {
        ev.stopPropagation();
        var cfg = Object.assign({}, ev.detail.value);
        // A cleared field should DISAPPEAR from the YAML rather than persist as
        // an empty string -- these configs are read by hand.
        Object.keys(cfg).forEach(function (k) {
          if (cfg[k] === '' || cfg[k] === null || cfg[k] === undefined) delete cfg[k];
        });
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: cfg }, bubbles: true, composed: true
        }));
      }
    }

    window.hkHostClient.entry(HkConfigEditor);
    customElements.define(etag, HkConfigEditor);
    return etag;
  }

  window.hkCards.editor = hkEditor;
  window.hkCards.LABELS = HK_LABELS;
  window.hkCards.COLOURS = HK_COLOURS;
  window.hkCards.selColour = selColour;
  window.hkCards.selOptions = selOptions;
  window.hkCards.section = section;
  window.hkCards.HELPERS = HK_HELPERS;
  window.hkCards.OPTION_LABELS = HK_OPTION_LABELS;

  // ------------------------------------------------------- nested cards
  //
  // A card that draws ANOTHER card inside itself -- the player's progress bar
  // and volume slider are an hk-media-control-card on the player's own glass.
  //
  // THE ORDER IS THE WHOLE POINT. A custom element that is not upgraded yet
  // has no setConfig, and HA's own cards throw if they are handed the frontend's
  // object before a config. So: create, wait for the definition if need be, then
  // setConfig, and only then start forwarding. `hkSetClient` is a function on
  // the returned element rather than a plain property assignment so a caller
  // can hand it the client on every render without knowing whether it is ready
  // yet; what the child gets goes through the host adapter (hkHostClient.bridge).
  function create(cfg) {
    if (!cfg || !cfg.type) return null;
    var t = String(cfg.type);
    var tag = t.indexOf('custom:') === 0 ? t.slice(7) : ('hui-' + t + '-card');
    var el = document.createElement(tag);
    var ready = false, pending = null;
    function configure() {
      try {
        el.setConfig(cfg);
        ready = true;
        if (pending) { window.hkHostClient.bridge(el, pending); pending = null; }
      } catch (e) {
        console.error('[hk] nested card setConfig failed', e, cfg);
      }
    }
    el.hkSetClient = function (source) {
      var c = asClient(source);
      if (!c) return;
      if (ready) window.hkHostClient.bridge(el, c); else pending = c;
    };
    if (typeof el.setConfig === 'function') configure();
    else if (window.customElements && customElements.whenDefined) {
      customElements.whenDefined(tag).then(configure, function () {
        console.error('[hk] nested card type never defined:', tag);
      });
    }
    return el;
  }
  // MAKE A CHILD CARD (Phase 2 P2.3): the one way a container card (hk-row,
  // the scenes row, the camera tiles) makes a card inside itself from a config.
  //
  // WITH LOVELACE -- the host names its card wrapper (hkShell.tags.card: HA's
  // hui-card) -- the child is that wrapper, made exactly as the containers
  // made it before: the wrapper owns lazy module loading, the error card for
  // an unknown type and the rebuild when a card's code arrives late, so HA's
  // behaviour does not change. WITHOUT LOVELACE (Mantel, HK's own panel) the
  // child is the card element itself, made by HK's view host the same way it
  // makes a view's cards (web/hk/shell/hk-view-host.js): `custom:` cards by
  // their tag, a few container types drawn by HK, a labelled placeholder for
  // any other Lovelace type -- never a host element.
  //
  // `client` is the container's own; the child gets what goes with it through
  // the host adapter's bridge, as every nested card does.
  function cardWrapper() {
    var S = window.hkShell;
    return (S && S.tags && S.tags.card) || null;
  }
  function createCard(config, client) {
    var tag = cardWrapper();
    if (tag) {
      var el = document.createElement(tag);
      window.hkHostClient.bridge(el, client);
      el.preview = false;
      el.config = config;
      el.load();
      return el;
    }
    var V = window.hkViewHost;
    if (V && V.createCardElement) return V.createCardElement(config, client);
    // neither (a bare page): an HK card by its tag, anything else a note
    var t = String((config && config.type) || '');
    if (t.indexOf('custom:') === 0) {
      var own = create(config);
      if (own && client) own.hkSetClient(client);
      return own;
    }
    var note = document.createElement('div');
    note.textContent = 'Not drawn here: ' + (t || 'a card with no type');
    return note;
  }
  window.hkCards.cardWrapper = cardWrapper;
  window.hkCards.createCard = createCard;

  // Exported for hk-campost.js, which reuses this cache as the cameras
  // page's video poster.
  window.hkCards.snapCache = { get: snapCacheGet, put: snapCachePut,
                               FRESH: SNAP_FRESH,
                               // tests only: read storage again; save now
                               _reset: function () { SNAP_MEM = null; snapDirty = false; snapSaveT = null; },
                               _flush: function () { snapSaveT = null; snapDirty = true; snapFlush(); } };
  window.hkCards.create = create;
  window.hkCards.BASE_CSS = BASE_CSS;
  window.hkCards.confirmSheet = confirmSheet;

  // THE SEGMENTED CONTROL, one for every page that has one (the calendar's
  // Day / Week / Month, the Energy tabs, a select's segments): HK's glass
  // plate 44 px tall, 36 px choices at 15 px, the choice white with dark text,
  // and the white SLIDING to the new choice with a spring (2026-10-10, as
  // the menu's and the tab bar's highlights do). The markup: `sel` holding
  // <button aria-selected> choices; after a choice changes, slideSeg(the new
  // button, segBox(the old one)) runs the slide.
  var SEG_SPRING = 'cubic-bezier(.34,1.24,.42,1)';
  //   o.item   a choice (default `button`)
  //   o.on     how the chosen one is marked (default `[aria-selected="true"]`;
  //            the control cards say `.active`, the sheets `.sel`)
  //   o.h      the capsule's height (default 44px; its choices 8 px less)
  //   o.font   the choices' size (default 15px)
  //   o.fill   true: the choices share the width equally
  //   o.plate  the capsule's own background and edge, where HK's glass is
  //            wrong (over a picture already blurred)
  //   o.raised a control on the page itself, not in a card (Calendar's
  //            Day / Week / Month, Energy's periods): in Flat it is raised
  //            as the cards are -- their surface and shadow -- and its
  //            choice a stone well (--hk-seg-raised-*, the user's pick,
  //            2026-10-17); every other look as before
  window.hkCards.segCss = function (sel, o) {
    sel = sel || '.seg';
    o = o || {};
    var it = sel + ' ' + (o.item || 'button'), on = it + (o.on || '[aria-selected="true"]');
    var h = o.h || '44px', ih = 'calc(' + h + ' - 8px)';
    return [
      // (--hk-seg-bw: Flat's 0 -- its edge is transparent, and WebKit snaps
      // a border to whole device pixels: at Safari's 85 % zoom the choice sat
      // 3.6 px from the top and 4.4 from the bottom. The padding makes up
      // the width, so the choice is 4 px in at every zoom.)
      sel + '{box-sizing:border-box;height:' + h + ';padding:calc(4px - var(--hk-seg-bw, 1px));border-radius:calc(' + h + ' / 2);' +
        // (Flat's own track, --hk-seg-track: on its ivory plate the plate's
        // color made the white choice vanish; the look's plate elsewhere)
        (o.plate || 'border:' + M.border + ';border-width:var(--hk-seg-bw, 1px);' + M.glass + ';background:' + (o.raised ? 'var(--hk-seg-raised-track,var(--hk-seg-track,' + M.bg + '));box-shadow:var(--hk-field-shadow,none)' : 'var(--hk-seg-track,' + M.bg + ')')) + ';display:flex;gap:2px;position:relative}',
      it + '{appearance:none;font:inherit;box-sizing:border-box;min-width:' + (o.fill ? '0' : '74px') + ';height:' + ih + ';' +
        // sharing the width, a long name wraps to two lines rather than lose its end
        // (NOT overflow:hidden: the chosen one's ::before starts the slide at the old choice's
        // box, outside this button, and a clip showed it only once it had slid in -- the old white
        // vanished and the new grew in place, 2026-10-18)
        (o.fill ? 'flex:1 1 0;padding:0 6px;overflow:visible;overflow-wrap:anywhere;text-align:center;line-height:1.1;' : 'padding:0 16px;white-space:nowrap;') +
        'border-radius:calc(' + ih + ' / 2);border:0;background:transparent;box-shadow:none;',
      '  font-size:' + (o.font || '15px') + ';font-weight:600;color:' + v('ink') + ';cursor:pointer;margin:0;',
      '  display:inline-flex;align-items:center;justify-content:center;gap:6px;',
      '  position:relative;isolation:isolate;transition:color .22s ease;-webkit-tap-highlight-color:transparent}',
      on + '{color:#1c1c1e;background:transparent;box-shadow:none}',
      on + '::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;' +
        (o.raised ? 'background:var(--hk-seg-raised-on,var(--hk-seg-on,#fff));box-shadow:var(--hk-seg-raised-on-shadow,var(--hk-seg-on-shadow,none));'
                  : 'background:var(--hk-seg-on,#fff);box-shadow:var(--hk-seg-on-shadow,none);'),
      '  transform-origin:0 0;transform:translate(var(--hx,0px),0) scale(var(--sx,1),1);transition:transform .42s ' + SEG_SPRING + '}',
      it + '.slide-from::before{transition:none}',
      '@media (prefers-reduced-motion:reduce){' + on + '::before,' + it + '{transition:none}}'
    ].join('');
  };
  // THE SLIDE ACROSS A REDRAW, for a card that draws its markup anew (the
  // control cards): where each control's choice was, before; then each new
  // choice slid from there. `on` is how a choice is marked.
  window.hkCards.segBefore = function (root, sel, on) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    root.querySelectorAll(sel).forEach(function (g) {
      var b = g.querySelector(on);
      out.push(b ? { i: Array.prototype.indexOf.call(g.children, b), box: window.hkCards.segBox(b) } : null);
    });
    return out;
  };
  window.hkCards.segAfter = function (root, sel, on, before) {
    if (!root || !root.querySelectorAll || !before || !before.length) return;
    root.querySelectorAll(sel).forEach(function (g, k) {
      var was = before[k], b = g.querySelector(on);
      if (!was || !b || Array.prototype.indexOf.call(g.children, b) === was.i) return;
      window.hkCards.slideSeg(b, was.box);
    });
  };
  window.hkCards.segBox = function (b) {
    var sg = b && b.parentNode && b.parentNode.getBoundingClientRect ? b.parentNode.getBoundingClientRect() : null;
    var r = b && b.getBoundingClientRect ? b.getBoundingClientRect() : null;
    return sg && r && r.width ? { x: r.left - sg.left, w: r.width } : null;
  };
  window.hkCards.slideSeg = function (b, from) {
    if (window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) return;
    var to = window.hkCards.segBox(b);
    if (!from || !to || Math.abs(from.x - to.x) < 1) return;
    b.classList.add('slide-from');
    b.style.setProperty('--hx', (from.x - to.x) + 'px');
    b.style.setProperty('--sx', String(from.w / to.w));
    void b.offsetWidth;                         // that start, drawn
    b.classList.remove('slide-from');
    b.style.removeProperty('--hx');
    b.style.removeProperty('--sx');
  };
  window.hkCards.navigate = navigate;
  window.hkCards.neverToggles = neverToggles;
  // WHAT A TAP ON A SCENE PILL DOES: runs it. A scene turns on, a script
  // runs, a button is pressed, an automation triggers; anything else opens
  // its sheet. The generated scene rows and a hand-placed hk-scene-card with
  // no tap_action of its own (the card picker's) both use this.
  window.hkCards.sceneTap = function (id) {
    var d = String(id || '').split('.')[0];
    var svc = d === 'scene' ? 'scene.turn_on' : d === 'script' ? 'script.turn_on'
            : (d === 'button' || d === 'input_button') ? d + '.press'
            : d === 'automation' ? 'automation.trigger' : null;
    return svc ? { action: 'perform-action', perform_action: svc, target: { entity_id: id } }
               : { action: 'more-info' };
  };
  // The door-like cover classes, so hk-detail.js draws a door as a door
  // (the lock's ring) from the same list this guard uses.
  window.hkCards.DOOR_COVERS = DOOR_COVERS;
  window.hkCards.chooseSheet = chooseSheet;
  window.hkCards.shade = shade;
  window.hkCards.edges = edges;
  window.hkCards.edgeCss = edgeCss;
  window.hkCards.shadeCss = shadeCss;
  window.hkCards.M = M;
  window.hkCards.PALETTE = PALETTE;
  window.hkCards.px = px;
  window.hkCards.bleedSides = bleedSides;
  window.hkCards.esc = esc;
  // MONEY in the house's currency (client.config.currency) and its language --
  // never a "$" of our own: the Energy page's Today's Cost and the detail
  // sheet's both come through here
  window.hkCards.money = function (h, v, digits) {
    var cur = String((h && h.config && h.config.currency) || 'USD').toUpperCase();
    var lang = (h && h.locale && h.locale.language) || (h && h.language) || undefined;
    try {
      return new Intl.NumberFormat(lang, { style: 'currency', currency: cur,
        minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    } catch (e) {
      return v.toFixed(digits) + ' ' + cur;
    }
  };
  window.hkCards._artRemote = artRemote;       // tests
  window.hkCards._artLocal = artLocal;
  window.hkCards._artSign = artSign;
  // ARTWORK FOR A SURFACE THAT IS NO CARD (the screensaver's music): a remote
  // URL through the same signed proxy as _artImage, so the offline wall
  // tablets get it from their own origin; anything else as it is. `fresh`
  // forgets a kept signature first (an <img> that errored on it). cb(src)
  window.hkCards.artUrl = function (url, size, cb, fresh) {
    if (!artRemote(url)) { cb(artLocal(url, size)); return; }
    if (fresh) artForget(url, size);
    artSign(window.hkCards.client(), url, size, cb);
  };
  window.hkCards.button = button;
  window.hkCards.scrub = scrub;
  window.hkCards.artJson = artJson;
  window.hkCards.sentenceCase = sentenceCase;
  // Lovelace's entry for every HkBase card, through the host adapter (loaded first)
  window.hkHostClient.entry(HkBase);
  window.hkCards.HkBase = HkBase;

  // ------------------------------------------- ON SOMEONE ELSE'S DASHBOARD
  // A card on a dashboard of the user's own (HA's Sections, Masonry or Panel
  // view, or the card editor's preview) and not on an HK screen: nothing of
  // HK's own -- no grid view, no sky -- is around it. The cards that lay out
  // differently there read the host's `data-hk-foreign` (the header stacks
  // when narrow, the chip and scene rows drop the bleed made for HK's page
  // padding). Walked up from the card through every shadow root once per
  // connect:
  //   hk-grid-view first          -> an HK screen (or a YAML dashboard of HK's view);
  //   or hk-home-grid-view           a Home Grid screen's Home
  //   HA's view or card editor    -> someone else's dashboard
  //   neither (the page body)     -> an HK overlay: the screensaver, a sheet,
  //                                  a pop-up, a banner -- HK's own surface
  var HK_PAGE = { 'hk-grid-view': 1, 'hk-home-grid-view': 1 };
  var HA_PAGE = {};                     // the host's own views and card editor (hk-host-shell.js)
  window.hkShell.foreignTags.forEach(function (t) { HA_PAGE[t] = 1; });
  // (Also notes on the card whether it sits INSIDE another HK card --
  // `_hkNested` -- which tone() reads: only the outermost sets the light look.)
  function foreign(el) {
    var n = el, nested = false;
    for (var i = 0; i < 80 && n; i++) {
      n = n.parentNode || null;
      if (n && n.host && !n.localName) n = n.host;         // out of a shadow root
      var t = n && n.localName;
      if (!t) continue;
      if (HK_PAGE[t]) { el._hkNested = nested; return false; }
      if (HA_PAGE[t]) { el._hkNested = nested; return true; }
      if (t.indexOf('hk-') === 0) nested = true;
    }
    el._hkNested = nested;
    return false;
  }
  // A hint for the layout: it never stops a card from drawing.
  function flag(el, name, on) {
    try { if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on); } catch (e) { /* not an element yet */ }
  }
  function place(el) {
    if (!el || !el.toggleAttribute) return false;
    var f = foreign(el);
    flag(el, 'data-hk-foreign', f);
    // NO BLEED. On a phone a tile or key is 8 px wider than its cell
    // (calc(100% + var(--hk-cell-bleed, 8px))) to cover the 4 px side
    // margins HK's own grid gives every card. A card placed straight in HA's
    // view has no such margins, so it overhung its column by 8 px.
    try {
      var top = f && el.parentNode && window.hkShell.is(el.parentNode, 'card');
      if (top) el.style.setProperty('--hk-cell-bleed', '0px');
      else if (el.style.getPropertyValue && el.style.getPropertyValue('--hk-cell-bleed')) el.style.removeProperty('--hk-cell-bleed');
    } catch (e) { /* a hint, never a failure */ }
    return f;
  }

  // ON A LIGHT PAGE: LIGHT and LIGHT_KEYS live beside the design table (T,
  // top of this file); tone() puts them on the outermost foreign card.
  function skyShown() {
    var S = window.hkSky, m = S && S.element ? S.element() : null;
    return !!(m && m.isConnected);
  }
  function tone(el, client) {
    if (!el || !el.style || !el.hasAttribute) return;
    var light = false;
    try {
      light = el.hasAttribute('data-hk-foreign') && !!client && !!client.themes &&
              client.themes.darkMode === false && !skyShown();
    } catch (e) { light = false; }
    // ONLY THE OUTERMOST HK CARD carries the tokens; a card inside it
    // inherits them -- so a dark plate inside a card (Now Playing's artwork,
    // the Music page's phone sheet) can set them back to `initial` for all it
    // holds. A nested card still gets `data-hk-light` for its own rules.
    var S = window.hkSettings, flat = !!(S && S.rendering && S.rendering().flat);
    if (flat) light = S.rendering().theme === 'light';
    flatTone(el);
    // a card that is not an HkBase (the scenes row, hk-chip.js) is toned by
    // its client alone: re-toned with the flat roots when the look changes
    // (syncFlat), or a quiet page kept Flat's plates after Flat was left
    if (!(el instanceof HkBase)) FLAT_ROOTS.add(el);
    var own = light && !el._hkNested && !flat;
    if (el._hkLight === light && el._hkOwnTone === own) return;
    el._hkLight = light;
    el._hkOwnTone = own;
    flag(el, 'data-hk-light', light);
    try {
      LIGHT_KEYS.forEach(function (k) {
        if (own) el.style.setProperty(k, LIGHT[k]); else if (!flat) el.style.removeProperty(k);
      });
    } catch (e) { /* a look, never a failure */ }
    // out of the shared blur while light, back in when not (glassJoin)
    if (el instanceof HkBase && el.isConnected) glassJoin(el, true);
  }

  // ---------------------------------------------------- SIZES IN SECTIONS
  // What each card asks HA's Sections view for (getGridOptions): of the
  // section's 12 columns, the tiles half, so two sit side by side and fill
  // it; the whole-page cards (the header, rows, the Music page, the
  // calendar...) the full width; the rest a full column they can be
  // narrowed from. Rows are always 'auto': every card has its own height.
  // The user's own size in the card's Layout tab wins, as for any card.
  // HK's own grid view never asks.
  function gridOf(columns, min) {
    return columns === 'full' ? { columns: 'full', rows: 'auto' }
                              : { columns: columns, rows: 'auto', min_columns: min || 3 };
  }
  var GRID = {};
  function sizeAs(o, tags) { tags.forEach(function (t) { GRID[t] = o; }); }
  sizeAs(gridOf(6, 3), ['hk-tile-card', 'hk-light-card', 'hk-fan-card', 'hk-cover-card',
    'hk-media-card', 'hk-favorite-card', 'hk-climate-card', 'hk-scene-card', 'hk-tall-card',
    'hk-climate-tall-card', 'hk-status-chip-card', 'hk-toggle-card', 'hk-stat-card',
    'hk-rank-card', 'hk-weather-tile-card', 'hk-key-card']);
  sizeAs(gridOf(3, 2), ['hk-back-card', 'hk-menu-button-card']);
  sizeAs(gridOf('full'), ['hk-header-card', 'hk-chips-card', 'hk-scenes-card', 'hk-row-card',
    'hk-grid-card', 'hk-heading-card', 'hk-weather-band-card', 'hk-calendar-card', 'hk-music-card',
    'hk-library-card', 'hk-speaker-picker-card', 'hk-browse-card', 'hk-timers-page-card',
    'hk-camera-mosaic-card', 'hk-tv-guide-card', 'hk-area-select-card', 'hk-page-status-card',
    'hk-room-status-card', 'hk-climate-status-card', 'hk-popup-card', 'hk-popup-group-card',
    'hk-screensaver-status-card', 'hk-screensaver-now-card']);
  // everything else (the controls, keypads, players, graphs, New Timer...)
  var GRID_REST = gridOf(12, 6);
  function gridFor(tag) { return GRID[tag] || GRID_REST; }
  // ON THE PROTOTYPE, unless the card has its own. register() and
  // wireEditor() do it; a card that defines itself calls hkCards.sized
  // just before its customElements.define.
  function sized(tag, Ctor) {
    if (!Ctor || !Ctor.prototype || Object.prototype.hasOwnProperty.call(Ctor.prototype, 'getGridOptions')) return;
    var o = gridFor(tag);
    Ctor.prototype.getGridOptions = function () { return Object.assign({}, o); };
  }
  // ------------------------------------------------ defining a card
  // register(): define the element, wire its editor from a schema, give the
  // picker a stub, list it in the card picker. Every card file uses it.
  function register(tag, Ctor, name, description, schema, stub) {
    sized(tag, Ctor);
    if (!customElements.get(tag)) customElements.define(tag, Ctor);
    if (schema) {
      var etag = hkEditor(tag, schema);
      Ctor.getConfigElement = function () { return document.createElement(etag); };
    }
    // hasOwnProperty, NOT a truthiness check: these cards EXTEND one another,
    // so HkLightCard inherits HkTileCard's static getStubConfig through the
    // prototype chain and a plain `!Ctor.getStubConfig` guard reads as "already
    // has one". The picker would then offer a switch as the stub for the light,
    // fan and cover cards.
    if (stub && !Object.prototype.hasOwnProperty.call(Ctor, 'getStubConfig')) {
      Ctor.getStubConfig = clientStub(stub);
    }
    window.customCards = window.customCards || [];
    window.customCards.push({ type: tag, name: name, description: description, preview: true });
  }

  // wireEditor(): editor + stub for a card that defines ITSELF (the older,
  // purpose-built cards call customElements.define in their own section).
  function wireEditor(tag, Ctor, schema, stub) {
    sized(tag, Ctor);
    if (!Object.prototype.hasOwnProperty.call(Ctor, 'getConfigElement')) {
      var etag = hkEditor(tag, schema);
      Ctor.getConfigElement = function () { return document.createElement(etag); };
    }
    if (stub && !Object.prototype.hasOwnProperty.call(Ctor, 'getStubConfig')) {
      Ctor.getStubConfig = clientStub(stub);
    }
  }
  // THE PICKER'S STUB GETS A CLIENT. Lovelace calls getStubConfig with its own
  // object; the stub is shared code, so it is handed the client made from it
  // (the host adapter's), and reads `client.states` like every card.
  function clientStub(stub) {
    return function (input) { return stub(asClient(input)); };
  }

  // The picker calls getStubConfig to build its preview, so it has to name an
  // entity that actually exists in THIS house or the preview renders empty.
  function firstOf(client, domain) {
    var ids = client && client.states ? Object.keys(client.states) : [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].indexOf(domain + '.') === 0) return ids[i];
    }
    return domain + '.example';
  }

  // ------------------------------------------------ morph(): update in place
  // Bring `el`'s children in line with `html` by CHANGING what differs -- a
  // text node's value, an attribute -- and replacing a node only where the
  // structure itself changed. Never `el.innerHTML = html` for something that
  // re-renders on a timer.
  //
  // WHY. A wall header that rebuilds its whole clock + weather block every
  // minute via innerHTML flickers: on a tablet's Android WebView, recreating
  // the elements -- the SVG glyph, the drop-shadowed text -- recreates their
  // compositing layers, once a minute, when the clock ticks. morph() turns the minute
  // tick into a single text-node change.
  function morph(el, html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    syncChildren(el, tpl.content);
    // (a scrolling list's edges, SCROLL EDGES: the sync took their marks off)
    edges(el);
  }
  function syncChildren(live, next) {
    var want = Array.prototype.slice.call(next.childNodes);
    for (var i = 0; i < want.length; i++) {
      var cur = live.childNodes[i];
      if (!cur) { live.appendChild(want[i]); continue; }
      if (!syncNode(cur, want[i])) live.replaceChild(want[i], cur);
    }
    while (live.childNodes.length > want.length) live.removeChild(live.lastChild);
  }
  function syncNode(cur, want) {
    if (cur.nodeType !== want.nodeType || cur.nodeName !== want.nodeName) return false;
    if (cur.nodeType === 3 || cur.nodeType === 8) {
      if (cur.nodeValue !== want.nodeValue) cur.nodeValue = want.nodeValue;
      return true;
    }
    if (cur.nodeType !== 1) return false;
    var i, a;
    for (i = cur.attributes.length - 1; i >= 0; i--) {
      a = cur.attributes[i].name;
      if (!want.hasAttribute(a)) cur.removeAttribute(a);
    }
    for (i = 0; i < want.attributes.length; i++) {
      a = want.attributes[i];
      if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
    }
    syncChildren(cur, want);
    return true;
  }

  // ================================================ hkMusic: the music model
  //
  // THE ONE ANSWER TO "WHAT IS THIS SCREEN ABOUT". Three jobs that a single
  // shared selector (an input_select) cannot do at once, kept apart:
  //
  //   TRUTH    what is playing where. contexts(): derived from Music
  //            Assistant's own states every time, never stored, so it cannot
  //            go stale and cannot disagree with the house.
  //   FOCUS    which of those this SCREEN shows. Per user -- each wall tablet
  //            is its own HA user -- kept in HA's own per-user store
  //            (frontend/set_user_data), so it survives a reload and a cache
  //            clear, and one tablet never rewrites another's page.
  //   COMMAND  which player a button acts on. Not here at all: every call
  //            names its player explicitly, so a tap acts on what was drawn.
  //
  // resolve() NEVER STRANDS A SCREEN. In order:
  //   1. the focused key, or the context it is part of, if that is playing
  //      or paused;
  //   2. the focused key while a request for it is in flight (HOLD) -- a
  //      playlist takes ~12s to start, and without this the page would show
  //      some other room's music for those twelve seconds;
  //   3. otherwise, music that STARTED since the focus was set -- this
  //      tablet's own room first, then the newest -- "follow whatever
  //      starts playing", per screen and with nothing written.
  //      ONLY NEW STARTS: Music Assistant turns a
  //      paused AirPlay room IDLE ~30 s after the pause, and "follow anything
  //      playing" would then yank the screen onto music that had been playing
  //      all along. A screen with no focus at all follows whatever plays;
  //   4. otherwise the focused key idle ("Ready on"), else the tablet's home
  //      room, else nothing.
  //
  // An unknown key (a renamed or removed speaker) is simply ignored, so the
  // worst a bad stored value can do is fall through to rule 3 or 4.

  // THE CONFIGURATION COMES FROM THE INTEGRATION. Speakers,
  // presets, floors, playlists and this user's home room are set up in the UI
  // (Settings -> Devices & services -> HK Frontend) and arrive over the
  // `hk_music/subscribe` websocket command -- now, and again whenever
  // anything is edited, with no reload. Until it arrives everything resolves
  // to "nothing", which every card already draws.
  var MUSIC = { configured: false, speakers: [], floors: [], playlists: [], home: null };

  var MUSIC_KEY = 'hk_music_focus';
  // Longer than the slowest measured playlist start (12.7s) with room for a
  // regroup ahead of it; bounded, so a request that never lands cannot pin a
  // screen to a silent room.
  var MUSIC_HOLD = 45000;

  var hkMusic = (function () {
    var byEntity = {};
    function index() {
      byEntity = {};
      MUSIC.speakers.forEach(function (s) { byEntity[s.entity] = s; });
    }
    index();
    // `seen`: the contexts already playing when this focus was chosen, by
    // key -> since. Taken on the first resolve after a change, because a
    // choice has no state of its own. Only music NOT in it can pull a screen
    // whose own music has gone quiet.
    var focus = { key: null, at: 0, hold: 0, seen: null };
    // The context this screen is following (rule 3), so a PAUSE does not let
    // go of it: the bar's own pause would otherwise drop the screen back to
    // its idle focus -- the bar gone at the tap, Play Music "Ready on" a
    // room nobody asked for (measured on the Living Room tablet, following
    // the Office). A focused key keeps its paused music (rule 1); a
    // followed one now does too, until it stops or something else starts.
    var follow = null;
    var listeners = [];
    // conn: the subscription port attached; writer: the newest client on it.
    var conn = null, writer = null, writing = 0, attachEpoch = 0, closers = [];

    function known(e) { return !!(e && byEntity[e]); }
    function isGroup(e) { return !!(byEntity[e] && byEntity[e].members); }
    function rooms() { return MUSIC.speakers.filter(function (s) { return !s.members; }); }
    function presets() { return MUSIC.speakers.filter(function (s) { return !!s.members; }); }
    function nameOf(e) { return (byEntity[e] && byEntity[e].name) || e; }
    // THIS USER'S room -- each wall tablet signs in as its own user, and the
    // integration's options map users to rooms.
    function home() { return known(MUSIC.home) ? MUSIC.home : null; }
    // Only explicit announcement evidence. Short tracks, missing metadata and
    // AirPlay's generic app name are also normal music, so never guess from them.
    function ignored(st) {
      if (!MUSIC.ignore_announcements || !st) return false;
      var a = st.attributes || {}, id = String(a.media_content_id || '');
      return MUSIC.announcements.indexOf(st.entity_id) >= 0 || a.announcement === true ||
        a.media_content_type === 'announcement' || id.indexOf('media-source://tts/') === 0 ||
        /^https?:\/\/[^/]+\/api\/tts_proxy\//.test(id);
    }
    function active(st) { return !!st && !ignored(st) && (st.state === 'playing' || st.state === 'paused'); }

    // localStorage is only the FIRST PAINT, before the server answers. It can
    // throw (private mode, blocked storage) and may be empty; both are fine.
    try {
      var raw = window.localStorage && localStorage.getItem(MUSIC_KEY);
      var v0 = raw && JSON.parse(raw);
      // NOT checked against the speakers here: they arrive from the
      // integration AFTER this runs. resolve() ignores a key it does not know.
      if (v0 && typeof v0.key === 'string') { focus.key = v0.key; focus.at = v0.at || 0; }
    } catch (e) { /* no storage: the server copy or the home room will do */ }

    function emit() {
      listeners.slice().forEach(function (fn) {
        try { fn(); } catch (e) { console.error('[hkMusic] listener failed', e); }
      });
    }

    // A PAIR ROOM (a stereo pair: a Music Assistant group picked as one
    // speaker, hk_core/music/groups.py) plays in a preset through its own
    // players, which no screen sees; its group player sits idle meanwhile.
    // So it is out of a playing preset only when that player is PLAYING
    // something else (a stale `paused` must not hide it).
    function isPair(e) { return !!(byEntity[e] && byEntity[e].pair); }
    function elsewhere(e, groupSt, states) {
      var st = states[e];
      if (!st || st.state !== 'playing') return false;
      var mine = (st.attributes || {}).media_content_id, theirs = ((groupSt && groupSt.attributes) || {}).media_content_id;
      return !!(mine && theirs && mine !== theirs);
    }

    // EVERY SEPARATE THING THE HOUSE IS PLAYING, derived fresh each call.
    //   preset  an MA sync group that is active with ALL of its rooms active
    //           (a pair room counts unless it plays something else)
    //   group   an ad-hoc join, keyed by its LEADER (group_members[0])
    //   room    one room on its own
    // A sync group is recognised by its OWN state, not by a room list that
    // happens to match, and it only claims its rooms when every one of them is
    // actually active -- a stale `paused` group must not hide a room that has
    // since started playing something else.
    function contexts(client) {
      var states = (client && client.states) || {};
      var seen = {}, out = [];
      function ctx(key, kind, members, st) {
        var a = (st && st.attributes) || {};
        return {
          key: key, kind: kind, leader: members[0], members: members,
          playing: !!st && st.state === 'playing', state: st ? st.state : 'unknown',
          title: a.media_title || '', artist: a.media_artist || '',
          image: a.entity_picture_local || a.entity_picture || null,
          since: Date.parse(st && st.last_changed) || 0,
          // (what streams() compares: where the music comes from, and how far in)
          app: a.app_id || a.source || '',
          pos: typeof a.media_position === 'number' ? a.media_position : null,
          posAt: Date.parse(a.media_position_updated_at) || 0
        };
      }
      presets().forEach(function (g) {
        var st = states[g.entity];
        if (!active(st)) return;
        if (g.members.some(function (m) { return seen[m] || (isPair(m) ? elsewhere(m, st, states) : !active(states[m])); })) return;
        g.members.forEach(function (m) { seen[m] = 1; });
        out.push(ctx(g.entity, 'preset', g.members.slice(), st));
      });
      rooms().forEach(function (r) {
        if (seen[r.entity]) return;
        var st = states[r.entity];
        if (!active(st)) return;
        var gm = ((st.attributes || {}).group_members || []).filter(function (e) {
          return known(e) && !isGroup(e) && !ignored(states[e]);
        });
        var members = gm.length > 1 ? gm : [r.entity];
        members.forEach(function (m) { seen[m] = 1; });
        var lead = members[0];
        out.push(ctx(lead, members.length > 1 ? 'group' : 'room', members,
                     states[lead] || st));
      });
      return out;
    }

    // THE SAME MUSIC IN SEVERAL ROOMS THAT ARE NOT JOINED (2026-10-14). An
    // iPhone AirPlaying Apple Music to every HomePod at once is nine players
    // to Music Assistant -- no group_members, no sync group -- so contexts()
    // is nine rooms, each "Dynamite", and the Music page's house list ran the
    // song and its controls off the foot of the Kitchen tablet. A LIST OF
    // WHAT PLAYS shows them as one: contexts with the same song, artist and
    // source, in the same play state and within SAME_POS seconds of each
    // other where both say how far in. {key, ctxs, members, title, artist,
    // image, playing, state}; `key` is its first context's.
    //
    // FOR DRAWING ONLY. Each context is still its own player: a stream is
    // never a COMMAND target -- a card hands the screen one of its contexts,
    // and the buttons act on that one player, as drawn.
    var SAME_POS = 10;
    function streams(ctxs, now) {
      now = now || Date.now();
      function at(c) {
        if (c.pos === null || c.pos === undefined) return null;
        return c.pos + (c.playing && c.posAt ? Math.max(0, now - c.posAt) / 1000 : 0);
      }
      function same(a, b) {
        if (!a.title || a.title !== b.title || a.artist !== b.artist || a.app !== b.app || a.playing !== b.playing) return false;
        var pa = at(a), pb = at(b);
        return pa === null || pb === null || Math.abs(pa - pb) <= SAME_POS;
      }
      var out = [];
      (ctxs || []).forEach(function (c) {
        var s = out.filter(function (x) { return same(x.ctxs[0], c); })[0];
        if (s) { s.ctxs.push(c); s.members = s.members.concat(c.members); return; }
        out.push({ key: c.key, ctxs: [c], members: c.members.slice(), title: c.title, artist: c.artist,
                   image: c.image, playing: c.playing, state: c.state });
      });
      return out;
    }

    function label(c, key) {
      if (!c) return key ? nameOf(key) : '';
      if (c.kind === 'preset') return nameOf(c.key);
      // "Kitchen + Loft" at two, "Kitchen +3" beyond -- the picker's
      // convention, and everyone's: a five-room list does not fit, and two
      // names do.
      var n = c.members.length;
      if (n === 2) return nameOf(c.members[0]) + ' + ' + nameOf(c.members[1]);
      return n > 2 ? nameOf(c.leader) + ' +' + (n - 1) : nameOf(c.leader);
    }

    // {player, context, reason, name}. `reason` says which rule answered, so a
    // card -- and a person debugging one -- can tell "you chose this" from
    // "this is what is playing".
    function resolve(client) {
      var ctxs = contexts(client);
      // (only the LAST answer's follow carries over: any other answer ends it)
      var was = follow; follow = null;
      var now = Date.now();
      var key = known(focus.key) ? focus.key : null;
      // FIRST RESOLVE AFTER A CHOICE: remember what was already playing, so
      // only something that starts later can pull this screen away.
      //
      // "ALREADY" MEANS WHEN THE CHOICE WAS MADE, not when this page loaded.
      // A choice restored from the server or the first-paint copy (a reload,
      // a cleared cache) was made at `at`: music that started after it was
      // being followed before the reload and must still be. Measured from
      // the load instead, every reload took it as already playing and
      // dropped it -- the Master Bedroom tablet, its choice Everywhere at
      // 14:13, Downstairs started at 16:11, after a cleared cache showed
      // "Ready on Everywhere" and two cards over the art (2026-10-11). A
      // choice made HERE (`fresh`) keeps the plain rule: whatever plays at
      // that tap, so a tablet's clock a few seconds off the server's cannot
      // count music already playing as new.
      if (key && focus.seen === null) {
        focus.seen = {};
        ctxs.forEach(function (c) {
          if (c.playing && (focus.fresh || !focus.at || c.since <= focus.at)) focus.seen[c.key] = c.since;
        });
      }
      var mine = key && ctxs.filter(function (c) {
        return c.key === key || c.members.indexOf(key) >= 0;
      })[0];
      if (mine) return { player: mine.key, context: mine, reason: 'focus', name: label(mine) };
      if (key && now < focus.hold) return { player: key, context: null, reason: 'pending', name: nameOf(key) };
      var seen = key ? focus.seen : null;
      var playing = ctxs.filter(function (c) {
        return (c.playing || c.key === was) && (!seen || seen[c.key] !== c.since);
      });
      if (playing.length) {
        var h = home();
        // music that is playing before the followed music paused, then this
        // tablet's own room, then the newest
        playing.sort(function (a, b) {
          var ah = h && a.members.indexOf(h) >= 0 ? 1 : 0;
          var bh = h && b.members.indexOf(h) >= 0 ? 1 : 0;
          return ((b.playing ? 1 : 0) - (a.playing ? 1 : 0)) || (bh - ah) || (b.since - a.since);
        });
        follow = playing[0].key;
        return { player: playing[0].key, context: playing[0], reason: 'following',
                 name: label(playing[0]) };
      }
      var fall = key || home();
      return { player: fall, context: null, reason: key ? 'idle' : (fall ? 'home' : 'none'),
               name: fall ? nameOf(fall) : '' };
    }

    // An explicit choice: a context card tapped, or a request sent. `hold`
    // keeps it on screen while the request is still landing.
    function setFocus(key, opts) {
      if (!known(key)) return false;
      var now = Date.now();
      focus.key = key; focus.at = now; focus.seen = null; focus.fresh = true; follow = null;
      focus.hold = opts && opts.hold ? now + MUSIC_HOLD : 0;
      try { if (window.localStorage) localStorage.setItem(MUSIC_KEY, JSON.stringify({ key: key, at: now })); }
      catch (e) { /* first-paint copy only */ }
      if (writer && writer.actions) {
        writing++;
        Promise.resolve(writer.actions.callWS({ type: 'frontend/set_user_data', key: MUSIC_KEY,
                                        value: { key: key, at: now } }))
          .catch(function (e) { console.error('[hkMusic] could not save focus', e); })
          .then(function () { writing--; });
      }
      emit();
      return true;
    }
    // A request that failed must not keep holding a silent room on screen.
    function release(key) {
      if (focus.key === key && focus.hold) { focus.hold = 0; emit(); }
    }

    // The server copy, followed live: the same user on another screen (your
    // phone and Chrome are one user) moves with it. Ignored while this screen
    // is mid-write, so its own older value cannot bounce back over a newer one.
    // The integration's answer: a new configuration replaces the old one
    // whole. A stored focus that is no longer a speaker is simply ignored by
    // resolve(), so an edit can never leave a screen pointing at nothing.
    function configure(cfg) {
      MUSIC = {
        configured: !!(cfg && cfg.configured),
        speakers: (cfg && cfg.speakers) || [],
        floors: (cfg && cfg.floors) || [],
        playlists: (cfg && cfg.playlists) || [],
        home: (cfg && cfg.home) || null,
        ignore_announcements: !!(cfg && cfg.ignore_announcements),
        announcements: (cfg && cfg.announcements) || [],
        volume: cfg && cfg.volume,
        library: (cfg && cfg.library_entry) || null
      };
      index();
      emit();
    }

    // ONE SET OF SUBSCRIPTIONS PER CONNECTION, retried (hkSettings.subscribe):
    // a subscribe that fails -- the page reconnected while Home Assistant was
    // still starting -- would otherwise leave every music card empty until a reload.
    function sub(c, msg, fn, label) {
      var s = window.hkSettings && window.hkSettings.subscribe;
      if (s) return s(c, msg, fn, label);
      c.subscribeMessage(fn, msg).catch(function (e) {    // a harness without hk-settings
        console.error('[' + label + '] not available', e);
      });
      return function () {};
    }

    // THROUGH THE HOST'S SUBSCRIPTION PORT: new state snapshots on the same
    // socket share one port, so they never subscribe twice. A replacement port
    // ends the old pair first, and an old pair's late answer is ignored.
    function attach(source) {
      var client = asClient(source), c = client && client.subscriptions;
      if (!c) return;
      if (c === conn) { writer = client; return; }
      closers.splice(0).forEach(function (close) { close(); });
      conn = c; writer = client;
      var my = ++attachEpoch;
      closers.push(sub(c, { type: 'hk_music/subscribe' }, function (cfg) {
        if (my === attachEpoch) configure(cfg);
      }, 'hkMusic'));
      closers.push(sub(c, { type: 'frontend/subscribe_user_data', key: MUSIC_KEY }, function (ev) {
        if (my !== attachEpoch) return;
        var v = ev && ev.value;
        // A key is taken even if the speaker list has not arrived yet (the
        // two subscriptions answer in either order); resolve() validates it.
        if (writing || !v || typeof v.key !== 'string' || v.key === focus.key) return;
        focus.key = v.key; focus.at = v.at || 0; focus.hold = 0; focus.seen = null; focus.fresh = false;
        try { if (window.localStorage) localStorage.setItem(MUSIC_KEY, JSON.stringify(v)); }
        catch (e) { /* first-paint copy only */ }
        emit();
      }, 'hkMusic focus'));
    }

    // ATTACHED BY THE PAGE, not only by the music cards: a Speakers chip
    // (count: {music: true}) or a popup opened by `entity_from: {music: true}`
    // needs the speaker list on a page with no music card on it.
    // The host adapter owns discovery; its events also catch a late adapter
    // and a replacement connection on a page with no music card.
    (function () {
      var tries = 0;
      function selfAttach() {
        var host = window.hkHostClient, client = null;
        try { client = host && host.current ? host.current() : null; } catch (e) { return true; }
        if (!(client && client.subscriptions)) return false;
        attach(client);
        return true;
      }
      window.addEventListener('hk-host-client-ready', selfAttach);
      window.addEventListener('hk-client-update', selfAttach);
      if (selfAttach()) return;
      var t = setInterval(function () {
        if (selfAttach() || ++tries >= 300) clearInterval(t);   // a minute; cards attach too
      }, 200);
    })();

    function onChange(fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }

    return {
      speakers: function () { return MUSIC.speakers.slice(); },
      rooms: rooms, presets: presets, known: known, isGroup: isGroup,
      nameOf: nameOf, home: home, ignored: ignored, active: active, contexts: contexts, streams: streams, resolve: resolve,
      player: function (client) { return resolve(client).player; },
      label: label, setFocus: setFocus, release: release, attach: attach,
      onChange: onChange, focus: function () { return focus.key; },
      configured: function () { return MUSIC.configured; },
      floors: function () { return MUSIC.floors.slice(); },
      playlists: function () { return MUSIC.playlists.slice(); },
      libraryEntry: function () { return MUSIC.library || null; },
      HOLD: MUSIC_HOLD,
      // Tests only: start from a clean slate, and hand in a configuration.
      _reset: function () { focus = { key: null, at: 0, hold: 0, seen: null }; follow = null; listeners = []; conn = null; writer = null; writing = 0; },
      _configure: configure
    };
  })();
  window.hkMusic = hkMusic;

  window.hkCards.morph = morph;
  // The dashboard settings (modules/hk-settings.js): the entity a card falls
  // back to when its own config names none. Read at call time.
  window.hkCards.setting = function (path, fallback) {
    var HS = window.hkSettings;
    return HS ? HS.get(path, fallback) : fallback;
  };
  // Is one of HK Frontend's features added and set up -- 'music', 'live_tv',
  // 'clean_areas', 'alarm_pin'? (The settings feed's `added`: a feature's
  // actions are registered whether or not it is added, so they cannot say.)
  window.hkCards.added = function (kind) {
    var a = window.hkCards.setting('added', null);
    return Array.isArray(a) && a.indexOf(kind) >= 0;
  };
  // ============================================================ THE MENU'S STATE
  //
  // modules/hk-menu.js draws the menu of pages and rooms. These say whether
  // THIS dashboard has it and which button opens it, for the cards that draw
  // a way in -- hk-menu-button-card (the pinned chip), hk-back-card (the round
  // button beside the chevron) and hk-header-card (the clock). One answer for
  // all of them, read from the settings and the dashboard's own config, so a
  // dashboard can never show the chip on one page and the edge tab on the
  // next.
  //
  //   style()  'chip' | 'tab' | null (no menu on this dashboard)
  //            chip -- the round button: the chip at the start of the chip
  //                    row on Home, beside the back chevron everywhere else
  //            tab  -- hk-menu.js's edge tab, on every page; no round buttons
  //   Automatic is the chip when the dashboard's HOME view carries a menu
  //   button card, else the tab. Phones always get the chip: a 16 px margin
  //   has no room for a tab without covering the tiles.
  // The panel element is kept while it is on the page: the menu's questions
  // and every room heading's link ask for it on each state push (three
  // shadow-root lookups a time). A dashboard switch replaces the panel, and
  // the one kept is then off the page and looked for again.
  var panelKept = null;
  function panelLovelace() {
    if (panelKept && panelKept.isConnected) {
      var lv = panelKept.lovelace, up = lv && lv.urlPath;
      if (!up || up === dashSeg()) return panelKept;
    }
    panelKept = window.hkShell.panel();
    return panelKept;
  }
  function lovelaceConfig() { return window.hkShell.dashboardConfig(panelLovelace()); }
  function dashSeg() { return String(location.pathname).split('/')[1] || ''; }
  // HIGHLIGHT COLOR AUTOMATIC (2026-10-16): each page in its own color --
  // the view's address, its kind's color; Home, the rooms and the rest
  // HK's orange
  // by page kind, each page's own (HK Settings -> the page -> Look ->
  // Highlight Color, look.page_accents, 2026-10-17) else these; a view's
  // address names its kind (PAGE_OF_PATH where the two differ).
  // hk-settings-model.js PAGE_ACCENTS is the same table (tests/test_flat.js).
  var PAGE_ACCENTS = { climate: 'blue', lights: 'yellow', security: 'teal', doors_windows: 'teal',
                       calendar: 'purple', weather: 'cyan', energy: 'green', power: 'green', water: 'cyan',
                       music: 'pink', live_tv: 'indigo', cameras: 'red', vacuums: 'mint', timers: 'orange' };
  var PAGE_OF_PATH = { 'doors-windows': 'doors_windows', playmusic: 'music', 'music-browse': 'music', 'live-tv': 'live_tv' };
  // THE HIGHLIGHT COLOR AS SAVED, here: the screen's (else All Screens',
  // resolved into the board), Automatic the page's own -- a hex
  function legacyAccentHex() {
    var a = String(boardOf(dashSeg()).accent || 'orange').toLowerCase();
    if (a === 'auto') a = pageAccent();
    return ACCENTS[a] || (/^#[0-9a-f]{6}$/.test(a) ? a : ACCENTS.orange);
  }
  function pageAccent() {
    var seg = String(location.pathname).split('/')[2] || '', kind = PAGE_OF_PATH[seg] || seg;
    var S = window.hkSettings, own = S && S.get ? (S.get('look.page_accents', {}) || {})[kind] : null;
    return own || PAGE_ACCENTS[kind] || 'orange';
  }
  var MENU_NARROW = 640;
  // A PHONE (the screen's Phones menu settings): a window under MENU_NARROW,
  // or a device whose screen's shorter side is under PHONE_SIDE -- a phone
  // held sideways (iPhones 375-440, Android phones 360-412) is still one.
  // The device's screen, not the window: an iPad mini (744), a 1024 x 600
  // tablet and the 1280 x 800 wall tablets stay tablets either way up, and a
  // short desktop window is never a phone.
  var PHONE_SIDE = 500;
  function menuNarrow() {
    if ((window.innerWidth || 1280) < MENU_NARROW) return true;
    var sc = window.screen, a = sc && Number(sc.width), b = sc && Number(sc.height);
    return a > 0 && b > 0 && Math.min(a, b) < PHONE_SIDE;
  }
  // THE EDGE TAB NEEDS A MARGIN TO LIVE IN: 26 px of it, beside a page
  // margin of 2% + 4 px -- 29.6 px on a 1280 wall tablet, 26.7 on an iPad
  // held sideways, but 18.9 on an iPad mini held upright, where the tab would
  // lie against the first chip and the weather. Below 1,024
  // px the dashboard uses the round button instead, as a phone always has.
  var TAB_MIN = 1024;
  // An always-open menu needs room for it: its item's "Always open when the
  // dashboard is at least" (dock_min, 1,000 px -- the menu's
  // 300 beside three tile columns: open on an iPad held sideways, folded on an
  // iPad mini held upright). Narrower, the menu folds into the dashboard's
  // button and comes back when there is room.
  var MENU_DOCK = 1000;
  function dockMin() {
    var v = Number(boardOf(dashSeg()).dock_min);
    return isFinite(v) && v > 0 ? v : MENU_DOCK;
  }
  // EACH DASHBOARD'S OWN MENU SETTINGS: the dashboard items
  // under Dashboards on the integration's page, handed over as `boards`, by
  // url path (settings.py board()). A dashboard with no item has no menu.
  var BOARD = { menu: 'auto', dock_min: MENU_DOCK, time_weather: 'page', ha_row: false,
                categories: [], tab_position: '', tab_size: 'large', tab_size_phone: 'standard', room_order: [], menu_rooms: 'az', home_rooms: 'as_is',
                page_rooms: 'floor', rooms_custom: false,
                // the cameras: All Screens' unless cameras_custom (settings.py resolved())
                cameras_custom: false,
                // the menu: All Screens' but for the settings in menu_own (settings.py resolved())
                menu_own: [], page_header: 'current', accent: 'orange', glyph: 'sidebar', clock: true,
                // 1.7: Home, Pages, Screen (settings.py BOARD_DEFAULTS). chips_quiet
                // null = the chip row's own default (hk-chip.js QUIET_DEFAULT).
                chips_row: true, chips: [], chips_quiet: null, chips_extra: [], camera_strip: true, cameras: [],
                camera_live: '', camera_live_video: null,
                scenes_row: true, scenes: [], scenes_pages: [], favorites: [], pages: [],
                glass: 'house', frost: null, blur: null, sky: true, idle_return: false, idle_room: '', car: false, kiosk: false,
                popups: true, notify: true, notify_saver: null, notify_dnd: null, now_playing: false,
                np_style: null, np_side: null, np_bar: null, np_bar_phone: null, screensaver: false, tablet_user: '', custom_pages: [],
                // the pages at the top of the menu (empty: the views' own)
                menu_top: [], phone_header: 'header', chips_custom: [], home_page: true, only_pages: [], home_view: '',
                // swipe right from the left edge opens the menu, at every width
                swipe: false, ha_place: 'rooms',
                // the tab bar (a device's Menu 'tabbar', hk-tabbar.js): menu settings
                tab_bar_scroll: 'shrink', tab_bar_rooms: 'more', tab_bar_glass: 'house', tab_bar_more: 'icons',
                tab_bar_more_phone: 'list', tab_bar_pos: 'bottom', tab_bar_fold: 'start',
                tab_bar_start: 'full', tab_bar_adjust: true, tab_bar_scroll_phone: 'shrink',
                tab_bar_tabs: 6, tab_bar_tabs_rail: 6, tab_bar_size: 'medium', tab_bar_labels: 'show',
                tab_bar_tabs_phone: 3,
                // the rail in a phone's side strip (hk-tabbar.js stripSide, 2026-10-30)
                tab_bar_strip: true,
                // Swipe Between Pages (hk-pageswipe.js, 2026-10-30): null,
                // Same as All Screens (hkSettings.swipePages)
                swipe_pages: null,
                // PHONES' OWN (phoneForm): the menu (null: as before there
                // was one -- phoneMenu), the button's style, More's rooms
                menu_phone: null, button_phone: 'chip', tab_bar_rooms_phone: 'more' };
  var ACCENTS = { orange: '#ff9f0a', yellow: '#ffd60a', green: '#30d158', mint: '#63e6e2', teal: '#40c8e0',
                  cyan: '#64d2ff', blue: '#0a84ff', indigo: '#5e5ce6', purple: '#bf5af2', pink: '#ff375f',
                  red: '#ff453a' };
  // White over the highlight, as Apple draws it over orange, green and teal
  // (contrast with white ~1.9-2.1); black over the pale ones -- yellow, mint,
  // cyan, a light colour of your own -- where white falls under 1.8.
  function accentText(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return 1.05 / (L + 0.05) >= 1.8 ? '#fff' : '#000';
  }
  // ONE COPY PER SETTINGS VERSION AND DASHBOARD. The menu's questions (sig,
  // style, on, clock...) each ask boardOf again, and the cards ask them on
  // every state push: ~95 keys copied a dozen times a push, measured as the
  // largest HK cost of an idle Home (headless, 6x slower). hk-settings counts
  // every feed it applies (version) and replaces the settings whole, never in
  // place. Callers here only read it; menu.board() hands out a copy. (A
  // settings stand-in with no version -- a test's -- is read fresh each time.)
  var boardMemo = { ver: null, all: null, dash: null, out: null };
  function boardOf(dash) {
    var HS = window.hkSettings, ver = HS && HS.version, all = msetting('boards', null);
    if (typeof ver !== 'number') return boardBuild(all, dash);
    var m = boardMemo;
    if (m.out && m.ver === ver && m.all === all && m.dash === dash) return m.out;
    var out = boardBuild(all, dash);
    boardMemo = { ver: ver, all: all, dash: dash, out: out };
    return out;
  }
  function boardBuild(all, dash) {
    var out = {}, k;
    for (k in BOARD) out[k] = BOARD[k];
    if (all && typeof all === 'object' && Object.keys(all).length) {
      var b = all[dash];
      if (!b || typeof b !== 'object') { out.menu = 'off'; return out; }
      for (k in BOARD) if (b[k] !== undefined && b[k] !== null) out[k] = b[k];
      return out;
    }
    // no item for any dashboard (a house not set up yet, a test): no menu
    out.menu = 'off';
    return out;
  }
  function panelWidth() {
    var p = panelLovelace(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
    return (r && r.width) || window.innerWidth || 0;
  }
  // Anywhere in a view's config: a chip row's `lead:`, a grid's `cards:`, a
  // conditional's `card:`. Bounded, because a config is data we did not write.
  function holdsCard(node, type, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return false;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) if (holdsCard(node[i], type, depth + 1)) return true;
      return false;
    }
    if (node.type === type) return true;
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k) && typeof node[k] === 'object' &&
          holdsCard(node[k], type, depth + 1)) return true;
    }
    return false;
  }
  // A MENU BUTTON IN A VIEW: written out, or the chips card's -- hk-chips-card
  // puts one at the start of its row unless its `lead` is false (hk-chip.js).
  // Counting only a written-out one, hk-menu.js would find no button on a
  // phone's Home whose chip row is hk-chips-card, and pin its own round one
  // over the weather: two menu buttons.
  function holdsMenuButton(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return false;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) if (holdsMenuButton(node[i], depth + 1)) return true;
      return false;
    }
    if (node.type === 'custom:hk-menu-button-card') return true;
    if (node.type === 'custom:hk-chips-card' && node.lead !== false &&
        (!node.lead || holdsMenuButton(node.lead, depth + 1))) return true;
    for (var k in node) {
      if (Object.prototype.hasOwnProperty.call(node, k) && typeof node[k] === 'object' &&
          holdsMenuButton(node[k], depth + 1)) return true;
    }
    return false;
  }
  // THE PHONES MENU, WHERE THE TABLETS' DOESN'T FIT (2026-10-09): a
  // tablet or computer whose own menu has no room -- an always-open menu
  // under Keep Open Down To, a button under TAB_MIN (the edge tab has no
  // margin there) -- shows the screen's Phones menu instead, with all of
  // Phones' settings: an iPad held upright, Split View, a narrow window.
  // The tab bar fits at every width, so a tablets' Tab Bar never folds.
  function compact() {
    if (menuNarrow()) return false;
    var m = boardOf(dashSeg()).menu;
    if (m === 'off' || m === 'tabbar') return false;
    return m === 'open' ? panelWidth() < dockMin() : (window.innerWidth || 1280) < TAB_MIN;
  }
  // Phones' menu and settings here: a phone, or a tablet whose menu doesn't fit
  function phoneForm() { return menuNarrow() || compact(); }
  // NOW PLAYING HERE (2026-10-15; All Screens -> Now Playing, a screen's
  // np_* over it): { phone, style: 'pane' | 'bar', side: 'right' | 'left',
  // bar: 'bottom' | 'top' }. A phone always has the bar, at Phones' place.
  // Whether a pane FITS is the pop-up's to say (hk-popup.js): it knows the
  // page's width beside it, a docked menu and Home Assistant's sidebar taken.
  var NP_DEFAULT = { style: 'bar', side: 'right', bar: 'bottom', bar_phone: 'bottom' };
  // ...AND HOW LONG IT STAYS once the music is paused or stopped, in seconds
  // (All Screens -> Now Playing -> Hide After a Pause): the bar, the pane and
  // the screensaver's music alike, each held longer while it is in use
  var NP_GRACES = [10, 20, 30, 60, 120];
  function npGrace() {
    var g = Number((msetting('now_playing', null) || {}).grace);
    return NP_GRACES.indexOf(g) >= 0 ? g : 30;
  }
  function nowPlaying() {
    var b = boardOf(dashSeg()), h = msetting('now_playing', null) || {};
    var pick = function (k, hk, ok) {
      return ok.indexOf(b[k]) >= 0 ? b[k] : ok.indexOf(h[hk]) >= 0 ? h[hk] : NP_DEFAULT[hk];
    };
    var bars = ['bottom', 'top'];
    if (menuNarrow()) return { phone: true, style: 'bar', side: 'right', bar: pick('np_bar_phone', 'bar_phone', bars) };
    return { phone: false, style: pick('np_style', 'style', ['pane', 'bar']), side: pick('np_side', 'side', ['right', 'left']),
             bar: pick('np_bar', 'bar', bars) };
  }
  // THE BUTTON'S STYLE where Phones' menu shows (button_phone): the chip,
  // the chip then the tab once scrolled past, the tab, or no button at all
  // (the swipe alone).
  function narrowStyle() {
    var n = boardOf(dashSeg()).button_phone;
    if (n === 'none') return swipeOn() ? 'none' : 'chip';
    return n === 'tab' || n === 'chip_scroll' ? n : 'chip';
  }
  // NO BUTTON leans on the swipe: with the swipe off it is never left with
  // no way in -- the button style is Automatic's, the phone's the chip.
  function swipeOn() { return !!boardOf(dashSeg()).swipe; }
  function folded() { return phoneForm(); }
  // Is Home the page showing? (its path, or none, or 0)
  function homeHere() {
    var here = String(location.pathname).split('/')[2] || '';
    var cfg = lovelaceConfig(), v0 = cfg && cfg.views && cfg.views[0];
    return !here || here === '0' || !!(v0 && v0.path === here);
  }
  var CHIPS = new Set();
  var homeButton = { cfg: null, v: false };
  function homeHasButton() {
    var cfg = lovelaceConfig();
    if (!cfg) return false;
    if (homeButton.cfg !== cfg) {
      var v0 = cfg.views && cfg.views[0];
      homeButton = { cfg: cfg, v: !!v0 && holdsMenuButton(v0, 0) };
    }
    return homeButton.v;
  }
  function msetting(path, fallback) {
    var HS = window.hkSettings;
    return HS ? HS.get(path, fallback) : fallback;
  }
  // A view is a ROOM PAGE when it names an area: `area:` (one, or a list for
  // a room that spans two -- a backyard and its deck), or the room strategy's.
  function areasOfView(v) {
    var a = v && (v.area || (v.strategy && v.strategy.area));
    return a ? [].concat(a).filter(Boolean) : [];
  }
  var roomPages = { cfg: null, map: {} };
  function roomIndex(area) {
    var cfg = lovelaceConfig();
    if (!cfg || !Array.isArray(cfg.views)) return null;
    if (roomPages.cfg !== cfg) {
      var map = {};
      cfg.views.forEach(function (v, i) {
        if (!i) return;                            // Home is never a room page
        areasOfView(v).forEach(function (a) { if (!(a in map)) map[a] = i; });
      });
      roomPages = { cfg: cfg, map: map };
    }
    var i = roomPages.map[area];
    return i === undefined ? null : i;
  }
  var dateLines = {};
  // v2: measured from the top of the PAGE (under any Home Assistant toolbar),
  // not of the panel -- a first load paints the toolbar for a moment before
  // kiosk mode hides it, and a v1 value taken then sat 56 px low.
  var DATE_KEY = 'hk-menu-date2:';
  // THE TOP OF THE PAGE AT REST, in the viewport, scroll or no scroll: the
  // dashboard panel's top plus Home Assistant's toolbar while it shows (kiosk
  // mode hides it). The document is what scrolls, so the panel's own rect
  // moves with it and the scroll has to be added back. Without it a menu sync
  // while the page is scrolled (any change in the page's height is one) puts
  // the edge tab that far up, and it stays there: measured, tab top 87 at
  // rest, -313 after a sync at scrollY 400, still -313 back at the top.
  function viewTop() {
    var p = panelLovelace();
    if (!p || !p.getBoundingClientRect) return 0;
    var top = p.getBoundingClientRect().top + (window.scrollY || 0);
    try {
      var h = window.hkShell.toolbar(p);
      if (h && getComputedStyle(h).display !== 'none') top += h.getBoundingClientRect().height;
    } catch (e) { /* no toolbar to find */ }
    return top;
  }
  // THE TAB BAR (hk-tabbar.js) IS THE MENU'S OTHER FORM, never beside it:
  // the tablets' Menu "tabbar" is the bar at every width and no side menu,
  // and Phones' Menu "tabbar" the bar on a phone and wherever the tablets'
  // menu doesn't fit (compact). Wherever the bar shows, the side menu is
  // off: no chip, no tab, no swipe, no clock tap.
  //
  // PHONES' MENU (menu_phone): off, a button (in button_phone's style) or
  // the tab bar -- never always open. Unset (a screen from before phones had
  // their own; settings.py phones_lifted writes it down): the tablets' Menu
  // when that is off or the tab bar, else a button.
  function phoneMenu(b) {
    var m = b.menu_phone;
    if (m === 'off' || m === 'button' || m === 'tabbar') return m;
    return b.menu === 'off' || b.menu === 'tabbar' ? b.menu : 'button';
  }
  // ...and where a tablet borrows it: Off would leave it with no way in at
  // all, so it is the chip
  function phoneMenuHere(b) {
    var m = phoneMenu(b);
    return m === 'off' && !menuNarrow() ? 'button' : m;
  }
  function sideMenu() {
    var b = boardOf(dashSeg());
    if (phoneForm()) return phoneMenuHere(b) === 'button';
    return b.menu !== 'off' && b.menu !== 'tabbar';
  }
  function dockedHere() {
    if (phoneForm()) return false;
    return boardOf(dashSeg()).menu === 'open' && panelWidth() >= dockMin();
  }
  function tabBarHere() {
    var b = boardOf(dashSeg());
    if (phoneForm()) return phoneMenuHere(b) === 'tabbar';
    return b.menu === 'tabbar';
  }
  var menuState = {
    // this dashboard's own settings (boardOf above)
    board: function () { return Object.assign({}, boardOf(dashSeg())); },
    on: function () { return sideMenu() && !tabBarHere(); },
    // the tab bar shows here, in the menu's place
    tabBar: tabBarHere,
    // a phone, by its width or its screen (menuNarrow): a phone's shape
    // (the tab bar's height, its fit, no rail)
    phone: menuNarrow,
    // Phones' menu and settings here: a phone, or a tablet whose own menu
    // doesn't fit (compact)
    phoneForm: phoneForm,
    compact: compact,
    // Phones' menu for a screen's settings `b`, as it resolves ('off',
    // 'button' or 'tabbar') -- HK Settings names what Automatic does
    phoneMenu: phoneMenu,
    // Shown beside the page all the time (its item's Menu: "Always open
    // beside the page"), when there is room for it.
    docked: dockedHere,
    // The time, date and weather at the top of the menu (its item's "Time
    // and weather": in the menu) -- only while it is docked here; the Home
    // header (hk-weather.js) steps aside for it.
    hasTime: function () {
      return menuState.docked() && boardOf(dashSeg()).time_weather === 'menu';
    },
    // 'tab', 'chip', or 'docked' -- a menu that is always there needs no
    // button at all: no tab, no chip, no round button beside the chevron.
    // Where the tablets' menu doesn't fit (folded: a phone, an always-open
    // menu under Keep Open Down To, a button under TAB_MIN) it is Phones'
    // button style (narrowStyle above).
    //
    // TWO MIXES:
    //   chip_scroll  the chip everywhere; the edge tab slides in while the
    //                chip is scrolled out of sight
    //   chip_home    the chip on Home (sliding to the tab the same way), the
    //                tab on every other page
    // Where the tab has no room (under TAB_MIN) Phones' button style decides.
    // 'none': no button at all -- the swipe (and the clock) open it.
    style: function () {
      if (!menuState.on()) return null;
      if (menuState.docked()) return 'docked';
      if (folded()) { var n = narrowStyle(); return n === 'tab' || n === 'none' ? n : 'chip'; }
      var b = boardOf(dashSeg()).menu;
      if (b === 'none' && swipeOn()) return 'none';
      if (b === 'chip' || b === 'tab') return b;
      if (b === 'chip_scroll') return 'chip';
      if (b === 'chip_home') return homeHere() ? 'chip' : 'tab';
      return homeHasButton() ? 'chip' : 'tab';
    },
    // Does a round button draw at this card? where: 'home' -- the menu chip
    // (hk-menu-button-card, Home's chip row lead); 'page' -- beside a
    // sub-page's back chevron. Answered by the CARD'S place, not the page
    // showing: Home's view stays cached while a sub-page is up, and must
    // come back with its chip.
    round: function (where) {
      var s = menuState.style();
      if (s !== 'chip' && s !== 'tab') return false;
      if (folded()) return narrowStyle() !== 'tab';
      if (boardOf(dashSeg()).menu === 'chip_home') return where === 'home';
      return s === 'chip';
    },
    // The edge tab here: 'always', 'scrolled' (only while every round button
    // on the page is out of sight -- hk-menu.js watches them) or 'never'.
    tab: function () {
      var s = menuState.style();
      if (s === 'tab') return 'always';
      if (s !== 'chip') return 'never';
      if (folded()) return narrowStyle() === 'chip_scroll' ? 'scrolled' : 'never';
      var b = boardOf(dashSeg()).menu;
      return b === 'chip_scroll' || b === 'chip_home' ? 'scrolled' : 'never';
    },
    // The round buttons on the page now (their <hk-plate>s), for the
    // scrolled tab. A card that draws one hands itself over when it draws or
    // is attached again (a cached view comes back without drawing), and takes
    // itself back when it leaves the page (chipGone) -- held any longer, every
    // card a rebuild or a chip-row replan discarded stayed alive with the
    // whole state snapshot it last had (4,195 entities).
    chipShown: function (card) {
      if (!card) return;
      CHIPS.add(card);
      window.dispatchEvent(new CustomEvent('hk-menu-chip'));
    },
    chipGone: function (card) { CHIPS.delete(card); },
    chips: function () {
      var out = [];
      CHIPS.forEach(function (card) {
        var el = card.shadowRoot && card.shadowRoot.querySelector('[data-hk-role="menu"]');
        if (!el) CHIPS.delete(card);
        else if (el.isConnected) out.push(el);
      });
      return out;
    },
    // the button's picture: the iPad sidebar glyph, or three lines
    // (each screen's, All Screens' unless it sets its own -- settings.py resolved())
    icon: function () { return boardOf(dashSeg()).glyph === 'lines' ? 'hk:menu' : 'hk:dock-left'; },
    clock: function () {
      return menuState.on() && !menuState.docked() && boardOf(dashSeg()).clock !== false;
    },
    // SWIPE FROM THE LEFT EDGE (the screen's Swipe from Left Edge): a drag
    // right from the dashboard's left edge pulls the menu out -- hk-menu.js
    // -- alongside whatever button there is, at every width; not while the
    // menu is docked, open already.
    swipe: function () { return menuState.on() && !menuState.docked() && swipeOn(); },
    // THE MENU'S HIGHLIGHT: its icons and the current page's row -- one of
    // Apple's system colours (dark-mode values), or the screen's own
    // "#rrggbb". `on`: the text over it, dark on the light ones.
    // `base`: everything else the highlight colors -- the menu's icons.
    // Automatic changes only the page you're on (the user, 2026-10-17): its
    // row takes the page's color, the rest keep HK's orange.
    // FLAT'S ACCENT COLOR (2026-10-17): chosen, it is the whole highlight in
    // Flat -- the page you're on and every other icon (the user: the icons
    // stayed orange, two tones) -- while the Highlight Color stays saved for
    // the other looks and for an Automatic Accent
    accent: function () {
      var a = String(boardOf(dashSeg()).accent || 'orange').toLowerCase(), auto = a === 'auto';
      var hex = legacyAccentHex();
      // (bright on Flat's Light too -- Apple's light color, not darkened:
      // the user, 2026-10-17)
      var color = flatColor(hex, 'on');
      var base = auto ? flatColor(ACCENTS.orange, 'on') : color;
      var pal = flatPalette();
      // IN FLAT the page you're on is always white over its fill, whatever
      // the color -- Lights' yellow and Weather's cyan too (the user,
      // 2026-10-17: the black text and glyph looked wrong); the Glass looks
      // keep black over their pale colors (accentText)
      var S = window.hkSettings, flatNow = !!(S && S.rendering && S.rendering().flat);
      if (pal && pal.seed) return { color: pal.seed, on: '#fff', base: pal.seed, flat: true };
      return { color: color, on: flatNow ? '#fff' : accentText(hex), base: base };
    },
    open: function () { if (window.hkMenu) window.hkMenu.open(); },
    toggle: function () { if (window.hkMenu) window.hkMenu.toggle(); },
    // a card that draws a way in signs on this, so it redraws when any of it changes
    sig: function () {
      var acc = boardOf(dashSeg()).accent;
      var pal = flatPalette();
      return [menuState.on(), menuState.style(), boardOf(dashSeg()).menu, menuState.icon(),
              menuState.clock(), acc === 'auto' ? 'auto:' + pageAccent() : acc, pal && pal.seed || ''].join('|');
    },
    // Where a room heading for `area` leads: this dashboard's room page for
    // it, while "Room headings open their room page" is on. null: stay a
    // plain heading.
    roomPath: function (area) {
      if (!area || msetting('rooms.headings', true) === false) return null;
      var i = roomIndex(area);
      if (i === null) return null;
      var v = lovelaceConfig().views[i];
      return '/' + dashSeg() + '/' + (v.path || i);
    },
    // Where this dashboard's page at view path `p` is (a Home Grid's Timers
    // block opens Timers); null: the screen has no such page
    pagePath: function (p) {
      var cfg = lovelaceConfig(), views = (cfg && cfg.views) || [];
      for (var i = 0; i < views.length; i++) if (views[i] && views[i].path === p) return '/' + dashSeg() + '/' + p;
      return null;
    },
    // THE DATE LINE, for the edge tab: hk-header-card measures where its
    // date's optical centre sits (px below the top of the dashboard's panel)
    // and publishes it here; hk-menu.js centres the tab on it. Kept per
    // dashboard, and across reloads, so a page opened straight onto a room
    // puts the tab where Home will.
    publishDate: function (y) {
      var d = dashSeg();
      if (dateLines[d] !== undefined && Math.abs(dateLines[d] - y) < 0.25) return;
      dateLines[d] = y;
      try { localStorage.setItem(DATE_KEY + d, String(Math.round(y * 10) / 10)); } catch (e) { /* private */ }
      window.dispatchEvent(new CustomEvent('hk-menu-date', { detail: { dash: d, y: y } }));
    },
    dateY: function () {
      var d = dashSeg();
      if (dateLines[d] === undefined) {
        try {
          var v = parseFloat(localStorage.getItem(DATE_KEY + d));
          if (isFinite(v)) dateLines[d] = v;
        } catch (e) { /* private */ }
      }
      return dateLines[d] === undefined ? null : dateLines[d];
    },
    areasOfView: areasOfView,
    viewTop: viewTop,
    config: lovelaceConfig, panel: panelLovelace, dash: dashSeg, holdsCard: holdsCard, nowPlaying: nowPlaying, npGrace: npGrace,
    homeButton: homeHasButton,
    NARROW: MENU_NARROW, DOCK: MENU_DOCK, TAB_MIN: TAB_MIN
  };
  window.hkCards.menu = menuState;
  // CROSSING THE PHONE WIDTH changes the style (a tab becomes the chip), so
  // every card redraws -- the same wake a settings change uses. Rare: a phone
  // turned sideways, a desktop window dragged narrow.
  try {
    window.matchMedia('(max-width: ' + (MENU_NARROW - 0.02) + 'px)').addEventListener('change', function () {
      window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: { module: 'hk-narrow' } }));
    });
  } catch (e) { /* no matchMedia (a test harness) */ }
  // ...and so does a docked menu appearing or going, or the tab giving way
  // to the round button, as a window is resized across MENU_DOCK or TAB_MIN:
  // the buttons come and go with them.
  var dockWas = null, dockRaf = 0;
  window.addEventListener('resize', function () {
    if (dockRaf) return;
    dockRaf = requestAnimationFrame(function () {
      dockRaf = 0;
      var d = menuState.style();
      if (dockWas !== null && d !== dockWas) {
        window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: { module: 'hk-dock' } }));
      }
      dockWas = d;
    });
  });

  window.hkCards.register = register;
  // OUT OF THE CARD PICKER: a card that only belongs to the screensaver (it is
  // pinned to a corner of the screen at no height, and on a dashboard's page
  // floats over Home Assistant). Still defined -- the screensaver and any YAML
  // that names it keep working -- just not offered in "Add card".
  window.hkCards.unlisted = function (tag) {
    var list = window.customCards || [];
    for (var i = list.length - 1; i >= 0; i--) if (list[i] && list[i].type === tag) list.splice(i, 1);
  };
  window.hkCards.place = place;            // a card that is not an HkBase calls it on connect
  window.hkCards.tone = tone;              // ...and this on every new client
  // A legacy host input or a client -> the client (null for neither). For the
  // few entry points the host calls with its own object (a picker stub defined
  // on the class itself, Lovelace's strategy hooks).
  window.hkCards.asClient = asClient;
  window.hkCards.FLAT = FLAT;
  window.hkCards.PAGE_ACCENTS = PAGE_ACCENTS;
  // ...and each page's as drawn (its own, else PAGE_ACCENTS'), the accents'
  // hexes, and a view's address as its page kind: the Pages screen's icons
  // (hk-pages-screen.js)
  window.hkCards.pageAccentHex = pageAccentHex;
  window.hkCards.ACCENTS = ACCENTS;
  window.hkCards.PAGE_OF_PATH = PAGE_OF_PATH;
  window.hkCards.pageTone = pageTone;
  window.hkCards.flatGround = flatGround;
  window.hkCards.FLAT_COLORS = FLAT_COLORS;
  window.hkCards.flatColorHex = flatColorHex;
  window.hkCards.flatFade = flatFade;
  // the pages that keep a tone of their own while the screen shows a photo:
  // the Glass looks' own-color pages (hk-settings-model.js SKY_OWN) and, in
  // Flat, Calendar and Weather too -- a photo behind them didn't look good
  // (the user, 2026-10-16). Home and the rooms take the screen's Background.
  var FLAT_OWN = { cameras: 1, live_tv: 1, security: 1, doors_windows: 1, climate: 1, lights: 1, timers: 1,
                   vacuums: 1, music: 1, water: 1, energy: 1, calendar: 1, weather: 1, power: 1 };
  window.hkCards.flatOwnGround = function (page) { return !!FLAT_OWN[page]; };
  window.hkCards.flatColor = flatColor;
  window.hkCards.FLAT_ACCENTS = FLAT_ACCENTS;
  window.hkCards.FLAT_MIX = FLAT_MIX;
  window.hkCards.flatPalette = flatPalette;
  window.hkCards.flatAccentHex = flatAccentHex;
  window.hkCards.flatIdle = flatIdle;
  window.hkCards.flatSeedHex = seedHex;
  window.hkCards.flatRole = flatRole;
  window.hkCards.contrast = contrast;
  window.hkCards.flatVars = function (theme) { return Object.keys(FLAT[theme]).map(function (k) { return k + ':' + FLAT[theme][k]; }).join(';'); };
  window.hkCards.flatCss = flatCss;
  window.hkCards.flatSurface = flatSurface;
  if (window.hkSettings && window.hkSettings.refreshLook) window.hkSettings.refreshLook();
  window.hkCards.LIGHT = LIGHT;            // tests
  window.hkCards.T = T;                    // the design table (DESIGN.md)
  window.hkCards.v = v;
  window.hkCards.FONT_ROOT = FONT_ROOT;
  window.hkCards.SAFE = SAFE;
  window.hkCards.safeArea = safeArea;
  // A SCROLLER THAT FITS TAKES NO SIDEWAYS PAN (2026-10-30, Swipe Between
  // Pages, hk-pageswipe.js): a scroll container takes every sideways pan for
  // itself, scrollable or not, so the browser cancelled the page's swipe over
  // a row with nothing to scroll (the favorites, a room's status row on a
  // tablet). One that fits says touch-action pan-y; one that scrolls keeps
  // its own. Measured in the next frame, once however often it is asked.
  window.hkCards.fitPan = function (el) {
    if (!el || el.__hkFitPan) return;
    var later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (f) { return setTimeout(f, 16); };
    el.__hkFitPan = later(function () {
      el.__hkFitPan = 0;
      if (el.scrollWidth <= el.clientWidth + 1) el.style.setProperty('touch-action', 'pan-y pinch-zoom');
      else el.style.removeProperty('touch-action');
    });
  };
  window.hkCards.SP = SP;
  window.hkCards.TILE = TILE;
  window.hkCards.CHIP = CHIP;
  window.hkCards.CARD = CARD;
  window.hkCards.HOME_GRID = HOME_GRID;
  window.hkCards.BP = BP;
  window.hkCards.EASE = EASE;
  window.hkCards.DUR = DUR;
  window.hkCards.BLUR = BLUR;
  window.hkCards.groupSurface = groupSurface;
  window.hkCards.R = R;
  window.hkCards.OVER = OVER;
  window.hkCards.TYPE = TYPE;
  window.hkCards.plate = plate;
  window.hkCards.centredTile = centredTile;
  window.hkCards.titleRow = titleRow;
  window.hkCards.labelCss = labelCss;
  window.hkCards.figureCss = figureCss;
  window.hkCards.typeCss = typeCss;
  window.hkCards.pageCardCss = pageCardCss;
  // `initial` for every token: a dark plate inside a card puts this in its
  // CSS so what is on it keeps today's white even on a light page
  window.hkCards.LIGHT_OFF = LIGHT_KEYS.map(function (k) { return k + ':initial'; }).join(';');
  window.hkCards.sized = sized;
  window.hkCards.gridFor = gridFor;        // tests
  window.hkCards.wireEditor = wireEditor;
  window.hkCards.firstOf = firstOf;
  window.hkCards.SELECTED_BG = SELECTED_BG;
  window.hkCards.PILL_LABEL = PILL_LABEL;
  window.hkCards.SELECTED_TEXT = SELECTED_TEXT;

  window.dispatchEvent(new Event('hk-cards-ready'));
  }
  var prerequisites = ['hk-client-ready', 'hk-card-state-ready', 'hk-host-client-ready'];
  function ready() {
    if (!window.hkClient || !window.hkCardState || !window.hkHostClient) return;
    prerequisites.forEach(function (event) { window.removeEventListener(event, ready); });
    initialize();
  }
  prerequisites.forEach(function (event) { window.addEventListener(event, ready); });
  ready();
})();
